const mongoose = require('mongoose');
const Product = require('../models/Product');
const ProductionPlan = require('../models/ProductionPlan');
const JobCard = require('../models/JobCard');
const Vendor = require('../models/Vendor');
const Material = require('../models/Material'); 

// @desc    Get All Products
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find().populate('bom.material').sort({ createdAt: -1 }); 
    res.json(products);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Create New Product
exports.createProduct = async (req, res) => {
  try {
    const { name, sku, category, subCategory, fabricType, color, costPerUnit, sellingPrice, bom } = req.body;
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const productId = `PROD-${name.substring(0,3).toUpperCase()}-${suffix}`;
    const product = await Product.create({
      productId, sku, name, category, subCategory, fabricType, color,         
      costPerUnit: Number(costPerUnit), sellingPrice: Number(sellingPrice), bom, 
      stock: { warehouse: 0, reserved: 0, batches: [] }
    });
    res.status(201).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Delete Product
exports.deleteProduct = async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ msg: 'Product not found' });
      await product.deleteOne();
      res.json({ success: true, msg: 'Product removed' });
    } catch (error) {
      res.status(500).json({ msg: error.message });
    }
};

// @desc    Get Pending Plans 
// 🟢 UPDATED: Filter out plans that are satisfied by Dispatch
// backend/controllers/productionController.js
exports.getPendingPlans = async (req, res) => {
  try {
    const plans = await ProductionPlan.find({ 
      status: { $nin: ['Completed', 'Fulfilled_By_Stock'] } 
    })
      .populate('orderId') 
      .populate({
          path: 'product',
          populate: { 
            path: 'bom.material', // 🟢 CRITICAL: This pulls the Fabric/Thread details
            model: 'Material' 
          } 
      })
      .sort({ createdAt: -1 });

    const activePlans = plans.filter(plan => {
        const total = plan.totalQtyToMake;
        const planned = plan.plannedQty || 0;
        const dispatched = plan.dispatchedQty || 0;
        return (total - planned - dispatched) > 0;
    });

    res.json(activePlans);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Confirm Strategy (PARTIAL PLANNING)
// @desc    Confirm Strategy (PARTIAL + OPTIMAL INVENTORY PLANNING)
exports.confirmStrategy = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId, splits, isManual, productId, totalQty, planIds } = req.body; 

    let plan = null;
    let maxAllowedLimit = 0;
    let remainingForOrder = 0;
    let refillNeeded = 0;

    // --- 🟢 BRANCH 1: HANDLE MANUAL PRODUCTION (Internal Stock / No Order) ---
    if (isManual) {
      if (!productId || !totalQty) {
        throw new Error("Product ID and Total Quantity are required for manual planning.");
      }
      // For manual plans, the limit is exactly what the user requested in the UI
      maxAllowedLimit = Number(totalQty);
    } 
    // --- 🟢 BRANCH 2: HANDLE GLOBAL BATCHING (Multiple Orders) ---
    else if (planIds && planIds.length > 0) {
      const plans = await ProductionPlan.find({ _id: { $in: planIds } }).session(session);
      if (!plans.length) throw new Error("Batch Production Plans not found");
      
      // Calculate total pending requirement across all plans in the batch
      maxAllowedLimit = plans.reduce((acc, p) => acc + (p.totalQtyToMake - (p.plannedQty || 0)), 0);
    }
    // --- 🟢 BRANCH 3: HANDLE STANDARD SALES ORDER ---
    else {
      plan = await ProductionPlan.findById(planId).populate('product').session(session);
      if (!plan) throw new Error('Production Plan not found');

      const alreadyPlanned = plan.plannedQty || 0;
      const dispatched = plan.dispatchedQty || 0;
      
      remainingForOrder = Math.max(0, plan.totalQtyToMake - alreadyPlanned - dispatched);
      
      // Math for Inventory Health (Refill to Optimal Level)
      const currentStock = plan.product?.stock?.warehouse || 0;
      const targetStock = plan.product?.stockAtLeast || 0;
      refillNeeded = Math.max(0, targetStock - currentStock);

      // Total allowed = Order requirement + Inventory health refill
      maxAllowedLimit = remainingForOrder + refillNeeded;
    }

    // --- 🛡️ VALIDATION ---
    const currentQtyToPlan = splits.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
    // Strict validation only for non-manual plans to prevent accidental over-production
    if (!isManual && currentQtyToPlan > maxAllowedLimit) {
        throw new Error(`Invalid Qty: You are trying to plan ${currentQtyToPlan}, but the max allowed is ${maxAllowedLimit}.`);
    }

    const createdJobs = [];
    const newJobIds = []; 

    // --- 🟢 CREATE JOB CARDS (Universal Logic for all Branches) ---
    for (const split of splits) {
      if (split.qty <= 0) continue;

      const mode = split.mode || split.type; 
      let finalVendorId = split.vendorId || null;
      let finalCost = Number(split.unitCost || split.cost) || 0;

      // Resolve Job ID Prefix
      const suffix = Math.floor(1000 + Math.random() * 9000);
      let prefix = mode === 'Full-Buy' ? 'TR-REQ' : 'JC-IN'; 
      if (isManual) prefix = 'MAN-STK'; // Unique prefix for internal stock jobs
      if (mode === 'Manufacturing' && split.routing?.cutting?.type === 'Job Work') prefix = 'JC-JW';

      // Determine starting step and DB type
      let initialStep = mode === 'Full-Buy' ? 'Procurement_Pending' : 'Material_Pending';
      let typeForDb = mode === 'Full-Buy' ? 'Full-Buy' : (mode === 'Manufacturing' ? 'In-House' : 'Job-Work');

      const jobId = `${prefix}-${suffix}`;
      
      // Auto-resolve Vendor ID from routing if not provided (for Job Work stages)
      if (mode === 'Manufacturing' && split.routing && !finalVendorId) {
          const targetName = split.routing.cutting?.vendorName || split.routing.stitching?.vendorName;
          if (targetName) {
              const vendorDoc = await Vendor.findOne({ name: targetName }).session(session);
              finalVendorId = vendorDoc ? vendorDoc._id : null;
          }
      }

      const newJobData = {
        jobId,
        isBatch: !!(planIds && planIds.length > 0),
        planId: isManual ? null : (planId || null), 
        orderId: isManual ? null : (plan?.orderId || null), 
        productId: isManual ? productId : plan.product._id, 
        totalQty: split.qty, 
        type: typeForDb,
        vendorId: finalVendorId, 
        unitCost: finalCost,        
        status: 'Pending',
        currentStep: initialStep,
        source: isManual ? 'Internal Stock' : 'Sales Order',
        timeline: [{ 
            stage: 'Created', 
            action: isManual ? `Manual Stock Job Created (${split.qty})` : `Partial Plan Created (${split.qty})`, 
            timestamp: new Date(), 
            performedBy: 'Admin' 
        }]
      };

      if (mode === 'Manufacturing' && split.routing) {
          newJobData.routing = split.routing;
      }

      const job = await JobCard.create([newJobData], { session });
      createdJobs.push(job[0]);
      newJobIds.push(jobId);
    }

    // --- 🟢 UPDATE TRACKING (Sales Orders & Batching only) ---
    let isOrderSatisfied = false;
    
    if (isManual) {
        // Manual plans don't update ProductionPlan models as they aren't linked to demand
        console.log(`✅ Manual Stock Job Initialized: ${currentQtyToPlan} units.`);
    } else if (planIds && planIds.length > 0) {
        // Update multiple plans for Batching
        await ProductionPlan.updateMany(
            { _id: { $in: planIds } },
            { $set: { status: 'Planned' }, $inc: { plannedQty: 9999 } }, // Flagging as planned
            { session }
        );
    } else if (plan) {
        const newPlannedTotal = (plan.plannedQty || 0) + currentQtyToPlan;
        isOrderSatisfied = (newPlannedTotal + (plan.dispatchedQty || 0)) >= plan.totalQtyToMake;
        
        plan.plannedQty = newPlannedTotal;
        plan.status = isOrderSatisfied ? 'Scheduled' : 'Partially Planned';
        
        if(newJobIds.length > 0) {
            plan.linkedJobIds.push(...newJobIds);
        }
        
        // Preserve split history in the plan model
        splits.forEach(s => {
            if (plan.splits) {
                plan.splits.push({ 
                    qty: s.qty, 
                    mode: s.mode || s.type, 
                    createdAt: new Date() 
                });
            }
        });

        await plan.save({ session });
    }

    await session.commitTransaction();
    
    res.json({ 
        success: true, 
        msg: isManual ? 'Internal Production Job Started' : (isOrderSatisfied ? 'Order Scheduled (Inventory Refill Included)' : 'Partial Plan Created Successfully'), 
        jobs: createdJobs 
    });

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Strategy Confirmation Error:", error);
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};

// @desc    Get Active Jobs (Shop Floor)
// backend/controllers/productionController.js

exports.getActiveJobs = async (req, res) => {
  try {
    const jobs = await JobCard.find({ 
        currentStep: { 
            $in: [
                'Cutting_Pending', 'Cutting_Started', 'Cutting_Completed',
                'Stitching_Pending', 'Stitching_Started', 'Stitching_Completed',
                'Packaging_Pending', 'Packaging_Started', 'QC_Pending', 
                'QC_Review_Needed', 'QC_Completed'
            ] 
        } 
    })
      .populate('productId', 'name sku color') // 🟢 Only fetch needed fields
      .populate({ 
          path: 'planId', 
          select: 'totalQtyToMake status', // 🟢 Safely select fields
          populate: { path: 'product', select: 'name' } 
      }) 
      .sort({ updatedAt: -1 });

    // 🟢 Filter out any jobs that might have broken data links to prevent frontend crashes
    const validJobs = jobs.filter(job => job.productId !== null);

    res.json(validJobs);
  } catch (error) {
    console.error("Production Floor Error:", error); // 🟢 This will show the exact error in your terminal
    res.status(500).json({ msg: "Error loading production floor data" });
  }
};

// @desc    Get Jobs for Kitting (Material_Pending)
exports.getKittingJobs = async (req, res) => {
  try {
    const jobs = await JobCard.find({ currentStep: 'Material_Pending' })
      .populate('orderId') 
      .populate({
          path: 'productId',
          populate: { path: 'bom.material' } 
      })
      .sort({ createdAt: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// ... [Keep existing imports] ...

// 🟢 NEW: Get all vendors for selection in Strategy Modal
exports.getAllVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find({}, 'name category services email');
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Confirm Strategy (Updated to capture Vendor & Routing)
// exports.confirmStrategy = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { planId, splits } = req.body; 
//     const plan = await ProductionPlan.findById(planId).populate('product').session(session);
//     if (!plan) throw new Error('Production Plan not found');

//     const createdJobs = [];
//     const newJobIds = []; 

//     for (const split of splits) {
//       if (split.qty <= 0) continue;

//       const mode = split.mode || split.type; 
//       let finalVendorId = null;
//       let finalCost = Number(split.unitCost || split.cost) || 0;

//       // 🟢 Logic: Find Vendor ID from the Routing object
//       if (mode === 'Manufacturing') {
//         // If Cutting is Job Work, use that vendor. Otherwise, if Stitching is Job Work, use that.
//         const routing = split.routing;
//         let targetVendorName = "";

//         if (routing.cutting.type === 'Job Work') targetVendorName = routing.cutting.vendorName;
//         else if (routing.stitching.type === 'Job Work') targetVendorName = routing.stitching.vendorName;

//         if (targetVendorName) {
//           const vendorDoc = await Vendor.findOne({ name: targetVendorName }).session(session);
//           finalVendorId = vendorDoc ? vendorDoc._id : null;
//         }
//       } else if (mode === 'Full-Buy') {
//         finalVendorId = split.trading?.vendorId || null;
//         finalCost = Number(split.trading?.cost) || 0;
//       }

//       const suffix = Math.floor(1000 + Math.random() * 9000);
//       let prefix = mode === 'Full-Buy' ? 'TR-REQ' : 'JC-IN'; 
//       if (mode === 'Manufacturing' && split.routing?.cutting?.type === 'Job Work') prefix = 'JC-JW';

//       const jobId = `${prefix}-${suffix}`;
      
//       const newJobData = {
//         jobId,
//         planId: plan._id, 
//         productId: plan.product._id, 
//         totalQty: split.qty, 
//         type: mode === 'Full-Buy' ? 'Full-Buy' : 'In-House',
//         vendorId: finalVendorId, // 🔗 Links to Rakesh's Portal
//         unitCost: finalCost,        
//         status: 'Pending',
//         currentStep: mode === 'Full-Buy' ? 'Procurement_Pending' : 'Material_Pending', 
//         routing: split.routing || null,
//         timeline: [{ stage: 'Created', action: 'Plan Strategy Confirmed', timestamp: new Date() }]
//       };

//       const job = await JobCard.create([newJobData], { session });
//       createdJobs.push(job[0]);
//       newJobIds.push(jobId);
//     }

//     // ... [Keep existing Plan update logic] ...
//     plan.plannedQty += splits.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
//     plan.status = 'Scheduled';
//     await plan.save({ session });

//     await session.commitTransaction();
//     res.json({ success: true, jobs: createdJobs });
//   } catch (error) {
//     await session.abortTransaction();
//     res.status(500).json({ msg: error.message });
//   } finally { session.endSession(); }
// };

// @desc    Issue Materials with LOT MANAGEMENT
exports.issueMaterials = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId, customBOM, materialsToIssue, sendToFloor, issuerName, issuerRole } = req.body;
    
    const job = await JobCard.findOne({ jobId }).session(session);
    if (!job) throw new Error('Job not found');

    if (customBOM && customBOM.length > 0) {
        job.customBOM = customBOM; 
    }

    if (materialsToIssue && materialsToIssue.length > 0) {
        for (const item of materialsToIssue) {
            const materialDoc = await Material.findById(item.materialId).session(session);
            if (!materialDoc) throw new Error(`Material not found: ${item.materialName}`);

            if (materialDoc.stock.current < item.issueQty) {
                throw new Error(`Insufficient Stock for ${materialDoc.name}. Available: ${materialDoc.stock.current}`);
            }

            let remainingToDeduct = Number(item.issueQty);

            if (item.lotNumber) {
               const batchIndex = materialDoc.stock.batches.findIndex(b => b.lotNumber === item.lotNumber);
               if (batchIndex > -1) {
                  if(materialDoc.stock.batches[batchIndex].qty >= remainingToDeduct) {
                      materialDoc.stock.batches[batchIndex].qty -= remainingToDeduct;
                  } else {
                      throw new Error(`Batch ${item.lotNumber} only has ${materialDoc.stock.batches[batchIndex].qty}, but you tried to issue ${remainingToDeduct}`);
                  }
               }
            } 

            materialDoc.stock.current -= remainingToDeduct;
            materialDoc.stock.batches = materialDoc.stock.batches.filter(b => b.qty > 0);

            await materialDoc.save({ session });

            job.issuedMaterials.push({
                materialId: item.materialId,
                materialName: item.materialName,
                qtyIssued: Number(item.issueQty),
                lotNumber: item.lotNumber || "General Stock",
                issuedTo: item.issuedTo,
                issuedBy: issuerName || "Store Manager",
                role: issuerRole || "Store",
                remarks: item.remarks,
                date: new Date()
            });
        }
    }

    if (sendToFloor) {
        job.currentStep = 'Cutting_Pending';
        job.history.push({
            step: 'Kitting',
            status: 'Materials Issued',
            details: `Full Materials issued by ${issuerName}. Sent to Cutting Floor.`,
            timestamp: new Date()
        });
    }

    await job.save({ session });
    await session.commitTransaction();

    res.json({ 
        success: true, 
        msg: sendToFloor ? 'Job Sent to Cutting Floor! ✂️' : 'Partial Issue Saved ✅',
        jobId: job.jobId
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Kitting Error:", error);
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};

exports.getIssueHistory = async (req, res) => {
  try {
    const jobs = await JobCard.find({ "issuedMaterials.0": { $exists: true } })
      .populate('productId', 'name sku') 
      .select('jobId productId issuedMaterials totalQty createdAt') 
      .sort({ updatedAt: -1 });

    res.json(jobs);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const result = await ProductionPlan.findByIdAndDelete(req.params.id);
    if (!result) await ProductionPlan.deleteOne({ _id: req.params.id });
    res.json({ success: true, msg: 'Plan deleted' });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
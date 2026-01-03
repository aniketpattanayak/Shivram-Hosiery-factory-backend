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
exports.getPendingPlans = async (req, res) => {
  try {
    const plans = await ProductionPlan.find({ 
      // Fetch anything not marked strictly 'Completed' or 'Fulfilled_By_Stock'
      status: { $nin: ['Completed', 'Fulfilled_By_Stock'] } 
    })
      .populate('orderId') 
      .populate('product')
      .sort({ createdAt: -1 });

    // Client-side logic will calculate Unplanned, but we can filter here too
    // Filter: Only send plans where (Total - Planned - Dispatched) > 0
    const activePlans = plans.filter(plan => {
        const total = plan.totalQtyToMake;
        const planned = plan.plannedQty || 0;
        const dispatched = plan.dispatchedQty || 0;
        return (total - planned - dispatched) > 0;
    });

    res.json(activePlans);
  } catch (error) {
    console.error("Error fetching pending plans:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Confirm Strategy (PARTIAL PLANNING)
// @desc    Confirm Strategy (PARTIAL + OPTIMAL INVENTORY PLANNING)
exports.confirmStrategy = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId, splits } = req.body; 

    // 1. Fetch Plan and Populate Product to get stock metrics
    const plan = await ProductionPlan.findById(planId).populate('product').session(session);
    if (!plan) throw new Error('Production Plan not found');

    // 2. 🟢 NEW CALCULATION LOGIC: Order Pending + Refill to Optimal
    const currentQtyToPlan = splits.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
    const alreadyPlanned = plan.plannedQty || 0;
    const dispatched = plan.dispatchedQty || 0;
    
    // Calculate what is still needed specifically for the Sales Order
    const remainingForOrder = Math.max(0, plan.totalQtyToMake - alreadyPlanned - dispatched);

    // Calculate Refill quantity needed to reach 100% Health (Stock At Least)
    const currentStock = plan.product?.stock?.warehouse || 0;
    const targetStock = plan.product?.stockAtLeast || 0;
    const refillNeeded = Math.max(0, targetStock - currentStock);

    // The true limit allowed is now the sum of Order Needs and Inventory Health Needs
    const maxAllowedLimit = remainingForOrder + refillNeeded;

    // 🟢 UPDATED VALIDATION: Check against maxAllowedLimit instead of just remainingQty
    if (currentQtyToPlan > maxAllowedLimit) {
        throw new Error(`Invalid Qty: You are trying to plan ${currentQtyToPlan}, but the max allowed (Order Pending + Refill) is ${maxAllowedLimit}.`);
    }

    const createdJobs = [];
    const newJobIds = []; 

    // 3. Create Job Cards (Existing Logic Preserved)
    for (const split of splits) {
      if (split.qty <= 0) continue;

      const mode = split.mode || split.type; 
      let finalVendorId = split.vendorId || null;
      let finalCost = Number(split.unitCost || split.cost) || 0;

      const suffix = Math.floor(1000 + Math.random() * 9000);
      let prefix = mode === 'Full-Buy' ? 'TR-REQ' : 'JC-IN'; 
      if (mode === 'Manufacturing' && split.routing?.cutting?.type === 'Job Work') prefix = 'JC-JW';

      let initialStep = mode === 'Full-Buy' ? 'Procurement_Pending' : 'Material_Pending';
      let typeForDb = mode === 'Full-Buy' ? 'Full-Buy' : (mode === 'Manufacturing' ? 'In-House' : 'Job-Work');

      const jobId = `${prefix}-${suffix}`;
      
      const newJobData = {
        jobId,
        isBatch: false,
        planId: plan._id, 
        orderId: plan.orderId, 
        productId: plan.product._id, 
        totalQty: split.qty, 
        type: typeForDb,
        vendorId: finalVendorId, 
        unitCost: finalCost,        
        status: 'Pending',
        currentStep: initialStep, 
        timeline: [{ 
            stage: 'Created', 
            action: `Partial Plan Created (${split.qty})`, 
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

    // 4. Update Production Plan Tracking
    const newPlannedTotal = alreadyPlanned + currentQtyToPlan;
    
    // Check if fully satisfied based on original Order (Planned + Dispatched >= Total)
    const isOrderSatisfied = (newPlannedTotal + dispatched) >= plan.totalQtyToMake;

    plan.plannedQty = newPlannedTotal;
    
    // If order is satisfied or we've planned into the "Refill" zone, mark as Scheduled
    plan.status = isOrderSatisfied ? 'Scheduled' : 'Partially Planned';
    
    if(newJobIds.length > 0) {
        plan.linkedJobIds.push(...newJobIds);
    }
    
    // Preserve history of splits
    splits.forEach(s => plan.splits.push({ 
        qty: s.qty, 
        mode: s.mode || s.type, 
        createdAt: new Date() 
    }));

    await plan.save({ session });

    await session.commitTransaction();
    console.log(`✅ Strategy Applied: ${currentQtyToPlan} units planned (Incl. potential inventory refill).`);
    
    res.json({ 
        success: true, 
        msg: isOrderSatisfied ? 'Order Scheduled (Inventory Refill Included)' : 'Partial Plan Created Successfully', 
        jobs: createdJobs 
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Strategy Error:", error);
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
exports.confirmStrategy = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId, splits } = req.body; 
    const plan = await ProductionPlan.findById(planId).populate('product').session(session);
    if (!plan) throw new Error('Production Plan not found');

    const createdJobs = [];
    const newJobIds = []; 

    for (const split of splits) {
      if (split.qty <= 0) continue;

      const mode = split.mode || split.type; 
      let finalVendorId = null;
      let finalCost = Number(split.unitCost || split.cost) || 0;

      // 🟢 Logic: Find Vendor ID from the Routing object
      if (mode === 'Manufacturing') {
        // If Cutting is Job Work, use that vendor. Otherwise, if Stitching is Job Work, use that.
        const routing = split.routing;
        let targetVendorName = "";

        if (routing.cutting.type === 'Job Work') targetVendorName = routing.cutting.vendorName;
        else if (routing.stitching.type === 'Job Work') targetVendorName = routing.stitching.vendorName;

        if (targetVendorName) {
          const vendorDoc = await Vendor.findOne({ name: targetVendorName }).session(session);
          finalVendorId = vendorDoc ? vendorDoc._id : null;
        }
      } else if (mode === 'Full-Buy') {
        finalVendorId = split.trading?.vendorId || null;
        finalCost = Number(split.trading?.cost) || 0;
      }

      const suffix = Math.floor(1000 + Math.random() * 9000);
      let prefix = mode === 'Full-Buy' ? 'TR-REQ' : 'JC-IN'; 
      if (mode === 'Manufacturing' && split.routing?.cutting?.type === 'Job Work') prefix = 'JC-JW';

      const jobId = `${prefix}-${suffix}`;
      
      const newJobData = {
        jobId,
        planId: plan._id, 
        productId: plan.product._id, 
        totalQty: split.qty, 
        type: mode === 'Full-Buy' ? 'Full-Buy' : 'In-House',
        vendorId: finalVendorId, // 🔗 Links to Rakesh's Portal
        unitCost: finalCost,        
        status: 'Pending',
        currentStep: mode === 'Full-Buy' ? 'Procurement_Pending' : 'Material_Pending', 
        routing: split.routing || null,
        timeline: [{ stage: 'Created', action: 'Plan Strategy Confirmed', timestamp: new Date() }]
      };

      const job = await JobCard.create([newJobData], { session });
      createdJobs.push(job[0]);
      newJobIds.push(jobId);
    }

    // ... [Keep existing Plan update logic] ...
    plan.plannedQty += splits.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
    plan.status = 'Scheduled';
    await plan.save({ session });

    await session.commitTransaction();
    res.json({ success: true, jobs: createdJobs });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ msg: error.message });
  } finally { session.endSession(); }
};

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
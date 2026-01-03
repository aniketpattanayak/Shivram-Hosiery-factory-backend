const mongoose = require('mongoose');
const ProductionPlan = require('../models/ProductionPlan');
const JobCard = require('../models/JobCard');
const Product = require('../models/Product');
const Material = require('../models/Material');

// @desc    Execute Production Strategy (Split: In-House / Outsource / Buy)
// @route   POST /api/production/confirm-strategy
exports.confirmStrategy = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId, splits } = req.body;
    // splits = [{ method: 'In_House', qty: 60 }, { method: 'Trading_Buy', qty: 20 }]

    // 1. Fetch the Plan & Product Recipe (BOM)
    const plan = await ProductionPlan.findOne({ planId }).populate('product').session(session);
    
    if (!plan) throw new Error('Production Plan not found');
    if (plan.status !== 'Pending Strategy') throw new Error('Strategy already applied.');

    // 2. Validate Totals
    const totalSplitQty = splits.reduce((sum, s) => sum + s.qty, 0);
    if (totalSplitQty !== plan.totalQtyToMake) {
      throw new Error(`Split total (${totalSplitQty}) does not match required Qty (${plan.totalQtyToMake})`);
    }

    // 3. Process Each Split Path
    const processedSplits = [];

    for (const split of splits) {
      let referenceId = null;

      // === PATH A: IN-HOUSE or JOB WORK (Requires Raw Material) ===
      if (split.method === 'In_House' || split.method === 'Job_Work') {
        
        // A1. Calculate Raw Material Needs based on BOM
        const productBom = plan.product.bom; // The Recipe
        
        for (const bomItem of productBom) {
          const qtyNeeded = bomItem.qtyRequired * split.qty; // e.g. 1.5m * 60 shirts = 90m
          
          const material = await Material.findById(bomItem.material).session(session);
          
          // A2. The "Gatekeeper" Health Check
          // (We reserve stock even if it dips below safety, but we log a warning)
          material.stock.reserved += qtyNeeded;
          await material.save({ session });
        }

        // A3. Generate Document (Job Card or Gate Pass)
        const typePrefix = split.method === 'In_House' ? 'JOB' : 'GP'; // Job Card vs Gate Pass
        referenceId = `${typePrefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const newJobCard = new JobCard({
          jobId: referenceId,
          planId: plan._id,
          currentStep: split.method === 'In_House' ? 'Cutting' : 'Outsourced',
          history: [{
            step: 'Created',
            status: 'Started',
            timestamp: new Date(),
            vendor: split.method === 'Job_Work' ? split.vendorId : 'Internal'
          }]
        });
        await newJobCard.save({ session });
      }

      // === PATH B: TRADING (Full Buy) ===
      else if (split.method === 'Trading_Buy') {
        // B1. No Raw Material Deduction!
        // B2. Generate Purchase Order for Finished Goods
        referenceId = `PO-FG-${Date.now()}`;
        // (Logic to create a PO entry in PurchaseOrder collection would go here)
      }

      // Add to updated plan array
      processedSplits.push({
        method: split.method,
        qty: split.qty,
        status: 'Active',
        referenceId: referenceId
      });
    }

    // 4. Update the Master Plan
    plan.splits = processedSplits;
    plan.status = 'In Production'; // Global status
    await plan.save({ session });

    // 5. Commit Transaction
    await session.commitTransaction();

    // 6. Real-Time Events (Update Dashboard)
    req.io.emit('production_update', {
      message: `Plan ${plan.planId} moved to Execution.`,
      planId: plan.planId
    });

    res.status(200).json({ success: true, msg: 'Production Strategy Executed', data: plan });

  } catch (error) {
    await session.abortTransaction();
    console.error(error);
    res.status(500).json({ success: false, msg: error.message });
  } finally {
    session.endSession();
  }
};

// @desc    Get Plans waiting for Strategy
// @route   GET /api/production/pending
exports.getPendingPlans = async (req, res) => {
  try {
    const plans = await ProductionPlan.find({ status: 'Pending Strategy' })
      .populate('product', 'name category fabricType') // Fetch product details
      .populate('orderId', 'orderId customer'); // Fetch order details
      
    res.json(plans);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
const mongoose = require('mongoose');
const Material = require('../models/Material');
const Product = require('../models/Product');
const JobCard = require('../models/JobCard');
const ProductionPlan = require('../models/ProductionPlan');

// @desc    Issue Raw Material (Store -> Floor)
exports.issueMaterial = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { jobId } = req.body;
    const job = await JobCard.findOne({ jobId }).populate('planId').session(session);
    if (!job) throw new Error('Job Card not found');

    const plan = await ProductionPlan.findById(job.planId).populate('product').session(session);
    // Find the specific split strategy for this job
    const jobSplit = plan.splits.find(s => s.referenceId === jobId);
    
    if (!jobSplit) throw new Error('Job split reference not found');

    const qtyToMake = jobSplit.qty;
    const bom = plan.product.bom;

    for (const item of bom) {
      const material = await Material.findById(item.material).session(session);
      if (!material) continue; // Skip if material deleted
      
      const qtyNeeded = item.qtyRequired * qtyToMake;
      material.stock.current -= qtyNeeded;
      material.stock.reserved -= qtyNeeded;
      
      await material.save({ session });
    }

    job.currentStep = 'Cutting_Started';
    job.history.push({ step: 'Material Issued', timestamp: new Date(), status: 'Completed' });
    await job.save({ session });

    await session.commitTransaction();
    res.json({ success: true, msg: 'Material Issued.' });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};

// 🟢 NEW: Update Raw Material
exports.updateMaterial = async (req, res) => {
  try {
      const { name, costPerUnit, reorderLevel, avgConsumption, leadTime, safetyStock, unit } = req.body;
      
      const material = await Material.findById(req.params.id);
      if (!material) return res.status(404).json({ msg: 'Material not found' });

      if (name) material.name = name;
      if (unit) material.unit = unit;
      if (costPerUnit !== undefined) material.costPerUnit = Number(costPerUnit);
      if (avgConsumption !== undefined) material.avgConsumption = Number(avgConsumption);
      if (leadTime !== undefined) material.leadTime = Number(leadTime);
      if (safetyStock !== undefined) material.safetyStock = Number(safetyStock);
      
      if (reorderLevel !== undefined) {
           if (!material.stock) material.stock = {};
           material.stock.reorderLevel = Number(reorderLevel);
      }

      await material.save();
      res.json({ success: true, material });
  } catch (error) {
      res.status(500).json({ msg: error.message });
  }
};

// @desc    QC Approval (Gateway for SFG and FG with HOLD Logic)
exports.approveQC = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { jobId, qtyPassed, qtyRejected, type } = req.body; // type: 'SFG' (Assembly) or 'FG' (Final)
    const job = await JobCard.findOne({ jobId }).populate('planId').session(session);
    if (!job) throw new Error('Job Card not found');

    const plan = await ProductionPlan.findById(job.planId).session(session);
    const product = await Product.findById(plan.product).session(session);

    // 🟢 RESTORED: QC HOLD LOGIC
    // If there is any rejection, the job is put on HOLD for manager review
    if (Number(qtyRejected) > 0) {
      job.currentStep = 'QC_Hold';
      job.history.push({ 
        step: 'QC Inspection', 
        status: 'Hold', 
        timestamp: new Date(), 
        note: `REJECTED: ${qtyRejected}. Job moved to Hold status for review.` 
      });
    } else {
      job.currentStep = 'QC_Completed';
      job.history.push({ 
        step: 'QC Inspection', 
        status: 'Completed', 
        timestamp: new Date(), 
        note: `PASSED: ${qtyPassed}` 
      });
    }

    // 🟢 SFG vs FG GATEWAY
    // Moves pieces to the correct stock location in the Product Master based on inspection stage
    if (type === 'SFG') {
      // Logic for Assembly/Stitching Inspection (moves to Semi-Finished Goods array)
      if (!product.stock.semiFinished) product.stock.semiFinished = [];
      product.stock.semiFinished.push({
        lotNumber: job.lotNumber || `JOB-${jobId}`,
        qty: Number(qtyPassed),
        jobId: job.jobId,
        date: new Date()
      });
    } else {
      // Logic for Final Inspection (moves directly to Warehouse Finished Goods)
      product.stock.warehouse += Number(qtyPassed);
    }

    await job.save({ session });
    await product.save({ session });

    await session.commitTransaction();
    res.json({ 
        success: true, 
        msg: qtyRejected > 0 ? 'QC Warning: Rejections found, Job put on HOLD.' : 'QC Approved Successfully.' 
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};

// @desc    Get Live Stock (For Inventory Page)
exports.getStock = async (req, res) => {
  try {
    const materials = await Material.find().sort({ name: 1 });
    res.json(materials);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Add New Raw Material
exports.addMaterial = async (req, res) => {
  try {
    const { 
      materialId, name, materialType, unit, 
      costPerUnit, reorderLevel, openingStock,
      batchNumber,
      // New Metrics
      avgConsumption, leadTime, safetyStock 
    } = req.body;
    
    // Check for Duplicate ID
    const existing = await Material.findOne({ materialId });
    if (existing) return res.status(400).json({ msg: 'Material ID already exists' });

    // Prepare Batches
    let initialBatches = [];
    if (Number(openingStock) > 0) {
      initialBatches.push({
          lotNumber: batchNumber || "OPENING-STOCK", 
          qty: Number(openingStock),
          addedAt: new Date()
      });
    }

    const material = await Material.create({
      materialId,
      name,
      materialType,
      unit,
      costPerUnit: Number(costPerUnit) || 0,
      
      // Save Metrics
      avgConsumption: Number(avgConsumption) || 0,
      leadTime: Number(leadTime) || 0,
      safetyStock: Number(safetyStock) || 0,

      stock: { 
          current: Number(openingStock) || 0, 
          reserved: 0, 
          reorderLevel: Number(reorderLevel) || 100,
          batches: initialBatches
      }
    });

    res.status(201).json({ success: true, material });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// 🟢 FORCE RECALCULATION (Fixes Calculation Discrepancies)
exports.recalculateAll = async (req, res) => {
  try {
    const materials = await Material.find();
    
    // Loop through every material and save it.
    // This triggers the 'pre-save' hook in the Model, applying the new Math formula.
    for (const mat of materials) {
        await mat.save();
    }

    res.json({ success: true, msg: `Recalculated ${materials.length} items with new formula.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: error.message });
  }
};

// Aliases for compatibility
exports.createMaterial = exports.addMaterial;
exports.getAllStock = exports.getStock;
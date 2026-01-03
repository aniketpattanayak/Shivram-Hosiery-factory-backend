const mongoose = require('mongoose');
const JobCard = require('../models/JobCard');
const Material = require('../models/Material');
const Product = require('../models/Product');

exports.issueMaterial = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.body;
    
    // 🟢 1. Deep Populate to get Material Batches
    const job = await JobCard.findOne({ jobId })
        .populate({
            path: 'productId',
            populate: { path: 'bom.material', model: 'Material' }
        })
        .session(session);

    if (!job) throw new Error("Job Card not found");
    if (job.currentStep !== 'Material_Pending') throw new Error("Material already issued");

    const pickingListUI = []; // Data for Frontend
    const issuedMaterialsDB = []; // Data for Database (JobCard)

    // 🟢 2. Iterate BOM & Apply FIFO Logic
    for (const bomItem of job.productId.bom) {
      const material = bomItem.material;
      if (!material) continue;

      const qtyNeeded = bomItem.qtyRequired * job.totalQty;
      let qtyToDeduct = qtyNeeded;

      // Object for Frontend Response
      const uiFeedback = {
        materialName: material.name,
        totalQty: qtyNeeded,
        batches: [] 
      };

      // 🟢 FIFO: Sort Batches by Date (Oldest First)
      if (material.stock && material.stock.batches) {
        material.stock.batches.sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt));

        for (const batch of material.stock.batches) {
          if (qtyToDeduct <= 0) break;
          if (batch.qty <= 0) continue;

          let take = Math.min(batch.qty, qtyToDeduct);
          
          // Update Batch in Memory
          batch.qty -= take;
          qtyToDeduct -= take;

          // Add to Frontend List
          uiFeedback.batches.push({
            lotNumber: batch.lotNumber,
            qty: take
          });

          // Add to Database List (Flat Structure for JobCard)
          issuedMaterialsDB.push({
            materialName: material.name,
            lotNumber: batch.lotNumber,
            qtyIssued: take,
            issuedAt: new Date()
          });
        }
      }

      // 🟢 Update Material Stock Levels
      material.stock.batches = material.stock.batches.filter(b => b.qty > 0); // Remove empty
      material.stock.current = material.stock.batches.reduce((sum, b) => sum + b.qty, 0); // Recalculate total
      
      await material.save({ session });
      pickingListUI.push(uiFeedback);
    }

    // 🟢 3. Save to JobCard (Using your Clue!)
    job.currentStep = 'Cutting_Started';
    job.issuedMaterials.push(...issuedMaterialsDB); // <--- SAVING HERE
    
    // Add to Timeline
    job.timeline.push({
        stage: 'Material_Pending',
        action: 'Material Issued',
        details: `Issued ${issuedMaterialsDB.length} batches for production.`,
        timestamp: new Date(),
        performedBy: 'Store Keeper'
    });

    await job.save({ session });
    await session.commitTransaction();

    // 🟢 4. Send Response
    res.json({ 
      success: true, 
      msg: "Stock Issued & Recorded", 
      pickingList: pickingListUI // Frontend uses this to show the green box
    });

  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};
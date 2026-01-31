const JobCard = require('../models/JobCard');
const Product = require('../models/Product');
const PurchaseOrder = require('../models/PurchaseOrder');

// @desc    Get Jobs Pending QC
// @route   GET /api/quality/pending
exports.getPendingQC = async (req, res) => {
  try {
    const jobs = await JobCard.find({ 
        currentStep: { $in: ['Stitching_QC_Pending', 'QC_Pending'] }, 
        status: { $ne: 'Completed' }
    })
    .populate('productId', 'name sku currentStock') 
    .populate('planId', 'clientName')
    .sort({ updatedAt: -1 });
    
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Submit QC Result (Gatekeeper with Fixed Hold Logic)
// @route   POST /api/quality/submit
exports.submitQC = async (req, res) => {
  try {
    const { jobId, sampleSize, qtyRejected, notes } = req.body;
    const job = await JobCard.findOne({ jobId });
    if (!job) return res.status(404).json({ msg: 'Job not found' });

    const product = await Product.findById(job.productId);
    const rejected = Number(qtyRejected) || 0;
    const passedQty = Math.max(0, job.totalQty - rejected);

    // 🟢 GATE 1: STITCHING QC Logic
   // 🟢 UPDATED GATE 1: STITCHING QC Logic with Hold Trigger
   if (job.currentStep === 'Stitching_QC_Pending') {
    const rejectionThreshold = 0.20; // 20% limit
    const currentRejectionRate = rejected / sampleSize;

    if (currentRejectionRate >= rejectionThreshold) {
        // 🛑 TRIGGER ADMIN REVIEW
        job.status = 'QC_HOLD';
        job.currentStep = 'Stitching_QC_Pending'; // Keep it here for admin to see context
        
        job.history.push({ 
            step: 'Stitching QC', 
            status: 'QC_HOLD',
            remarks: notes,
            details: `🚨 HIGH REJECTION RATE (${(currentRejectionRate * 100).toFixed(2)}%). Sent to Admin for review.`,
            timestamp: new Date() 
        });
    } else {
        // ✅ AUTO-PASS
        job.currentStep = 'Ready_For_Packaging';
        job.status = 'Ready_For_Packing';
        
        job.history.push({ 
            step: 'Stitching QC', 
            status: 'Passed',
            details: `1st QC Complete. ${passedQty} units moved to Packaging floor.`,
            timestamp: new Date() 
        });
    }
}
    // 🟢 GATE 2: FINAL QC Logic
    else if (job.currentStep === 'QC_Pending') {
        job.status = 'Completed';
        job.currentStep = 'QC_Completed';
        product.stock.warehouse += passedQty; // Add to final stock

        job.history.push({ 
            step: 'Final QC', 
            status: 'Completed',
            details: `Final QC Passed. ${passedQty} units added to Warehouse.`,
            timestamp: new Date() 
        });
    }

    await product.save();
    await job.save();
    res.json({ success: true, msg: "QC Successfully Logged" });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get All Jobs on QC HOLD (Admin View)
exports.getHeldQC = async (req, res) => {
  try {
    const JobCard = require('../models/JobCard');
    const PurchaseOrder = require('../models/PurchaseOrder');

    // 1. Fetch Production holds
    const productionHolds = await JobCard.find({ status: 'QC_HOLD' })
      .populate('productId', 'name sku')
      .lean();

    // 2. Fetch Purchase Order holds
    const reviewOrders = await PurchaseOrder.find({ "items.status": "QC_Review" })
        .populate('vendor_id', 'name')
        .lean();

    // 3. 🟢 FLATTEN PO items so they match the Frontend review structure
    let flattenedPOs = [];
    for (const order of reviewOrders) {
        for (const item of order.items) {
            if (item.status === 'QC_Review') {
                const lastLog = item.history[item.history.length - 1] || {};
                flattenedPOs.push({
                    _id: item._id, // Unique ID for React key
                    orderId: order._id, // 🎯 CRITICAL: Frontend uses this to detect isPO
                    itemId: item.item_id, // 🎯 CRITICAL: For decision API
                    poNumber: order._id.toString().slice(-6),
                    date: order.createdAt,
                    createdAt: order.createdAt,
                    inspector: lastLog.receivedBy || "Inspector",
                    feedback: lastLog.status || "High Rejection Rate",
                    rejectedQty: Number(lastLog.rejected || 0),
                    receivedQty: Number(lastLog.qty || 0),
                    sampleSize: Number(item.qcSampleQty || lastLog.qty || 1),
                    itemName: item.itemName,
                    itemType: item.itemType,
                    isPO: true 
                });
            }
        }
    }

    // 4. Combine both lists
    const allHolds = [...productionHolds, ...flattenedPOs].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json(allHolds);
  } catch (error) {
    console.error("Unified Approval Hub Fetch Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Admin Decision: Approve or Reject Held Batch
// @route   POST /api/quality/review

// backend/controllers/qualityController.js

exports.reviewQC = async (req, res) => {
  try {
    const { jobId, decision, adminNotes } = req.body; 

    const job = await JobCard.findOne({ jobId });
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    
    const product = await Product.findById(job.productId);
    if (!product) return res.status(404).json({ msg: 'Product not found' });

    const adminName = req.user ? req.user.name : "Admin";

    if (decision === 'approve') {
        const passedQty = job.qcResult?.passedQty || (job.totalQty - (job.qcResult?.rejectedQty || 0));
        
        // Use existing history to see if this is Assembly (SFG) or Final (FG)
        const isAssemblyGate = !job.history?.some(h => h.step === 'Assembly QC');
        
        if (passedQty > 0) {
            if (isAssemblyGate) {
                // MOVE TO SEMI-FINISHED (SFG)
                const sfgLot = `SFG-${job.jobId.split('-').pop()}-OVR`;
                if (!product.stock.semiFinished) product.stock.semiFinished = [];
                
                product.stock.semiFinished.push({
                    lotNumber: sfgLot,
                    qty: Number(passedQty),
                    date: new Date(),
                    jobId: job.jobId
                });
                job.currentStep = 'Packaging_Pending';
                job.status = 'Ready_For_Packing'; 
            } else {
                // MOVE TO WAREHOUSE (FG)
                product.stock.warehouse += Number(passedQty);
                if (!product.stock.batches) product.stock.batches = [];
                
                product.stock.batches.push({
                    lotNumber: `FG-${job.jobId.split('-').pop()}-OVR`, 
                    qty: Number(passedQty),
                    date: new Date(),
                    inspector: `${adminName} (Override)`
                });
                job.status = 'Completed'; 
                job.currentStep = 'QC_Completed';
            }
            await product.save();
        } else {
            // 🟢 FIX: If Passed Qty is 0, we use your EXISTING valid statuses
            // This prevents the "Validation Failed" error you saw
            job.status = 'Completed'; 
            job.currentStep = 'QC_Completed';
        }

        job.history.push({
            step: 'Admin QC Review',
            status: 'Approved',
            details: `Admin ${adminName} accepted. Passed: ${passedQty}. Notes: ${adminNotes}`,
            timestamp: new Date()
        });

      } else if (decision === 'rework') {
        // 🟢 REWORK LOOP LOGIC
        let returnStage = '';
        let stageLabel = '';

        if (job.currentStep === 'Stitching_QC_Pending' || job.status === 'QC_HOLD') {
            // If it failed Stitching QC, send back to Cutting
            returnStage = 'Cutting_Started';
            stageLabel = 'Cutting Floor';
        } else if (job.currentStep === 'QC_Pending') {
            // If it failed Final QC, send back to Packaging
            returnStage = 'Packaging_Started';
            stageLabel = 'Packaging Floor';
        }

        job.currentStep = returnStage;
        job.status = 'In_Progress'; // Reset status to active

        job.history.push({
            step: 'Admin QC Review',
            status: 'Rework Assigned',
            remarks: adminNotes, // 🎯 Capturing rework instructions
            details: `Admin assigned rework. Job moved back to ${stageLabel}.`,
            timestamp: new Date()
        });

        // Add to main timeline for visibility on Shop Floor
        job.timeline.push({
            stage: 'Rework',
            action: 'Sent back for Rework',
            details: `Rework instructions: ${adminNotes}`,
            performedBy: adminName,
            timestamp: new Date()
        });
    }

    // 🟢 Save the Job: Since status is no longer 'QC_HOLD', it will disappear from review
    await job.save();

    res.json({ 
        success: true, 
        msg: decision === 'approve' ? '✅ Batch Accepted & Stock Updated' : '❌ Batch Scrapped' 
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
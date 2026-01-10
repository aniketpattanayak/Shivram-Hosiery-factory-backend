const JobCard = require('../models/JobCard');
const Product = require('../models/Product');
const PurchaseOrder = require('../models/PurchaseOrder');

// @desc    Get Jobs Pending QC
// @route   GET /api/quality/pending
exports.getPendingQC = async (req, res) => {
  try {
    const jobs = await JobCard.find({ 
        currentStep: { $in: ['QC_Pending', 'Sewing_Started', 'Cutting_Started', 'Production_Completed'] }, 
        status: { $ne: 'Completed' }
    })
    .populate('productId', 'name sku currentStock') 
    .populate('planId', 'clientName')
    .sort({ createdAt: -1 });
    
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Submit QC Result (Gatekeeper with Fixed Hold Logic)
// @route   POST /api/quality/submit
exports.submitQC = async (req, res) => {
  try {
    // 🟢 Capture sampleSource from frontend ('Main' or 'Loose')
    const { jobId, sampleSize, qtyRejected, notes, sampleSource } = req.body;

    const job = await JobCard.findOne({ jobId });
    if (!job) return res.status(404).json({ msg: 'Job not found' });

    // Ensure physical receipt before QC
    if (job.logisticsStatus === 'In_Transit') {
      return res.status(400).json({ 
        msg: 'Physical Receipt Required! You must receive these goods on the Shop Floor before performing QC.' 
      });
    }

    const product = await Product.findById(job.productId);
    if (!product) return res.status(404).json({ msg: 'Product not found' });

    const totalBatchQty = job.totalQty || 0; 
    const rejected = Number(qtyRejected) || 0;
    const passedQty = Math.max(0, totalBatchQty - rejected); 
    const inspectorName = req.user ? req.user.name : "Unknown Inspector";

    // 🟢 1. CALCULATE REJECTION RATE & TRIGGER HOLD LOGIC
    const sample = Number(sampleSize) || 1; // Prevent division by zero
    const rejectionRate = (rejected / sample) * 100;
    const isHold = rejectionRate >= 20;

    // 🟢 2. SOURCE-SPECIFIC REJECTION DEDUCTION (If applicable)
    if (rejected > 0) {
        const targetBatch = product.stock.batches.find(b => 
            sampleSource === 'Loose' 
            ? (b.lotNumber.includes('LOOSE') && b.jobId === job.jobId) 
            : (!b.lotNumber.includes('LOOSE') && b.jobId === job.jobId)
        );

        if (targetBatch) {
            targetBatch.qty = Math.max(0, targetBatch.qty - rejected);
            product.stock.warehouse = Math.max(0, product.stock.warehouse - rejected);
        }
    }

    // 🟢 3. SAVE QC METADATA (Crucial for Admin Review Page display)
    job.qcResult = {
        status: isHold ? 'Held' : 'Passed',
        sampleSize: Number(sampleSize),
        rejectedQty: rejected,
        passedQty: passedQty,
        notes: notes || "No remarks",
        inspector: inspectorName,
        sampleSource: sampleSource,
        rejectionRate: rejectionRate.toFixed(2), // 🎯 Stored for review
        timestamp: new Date()
    };

    // 🟢 4. DIVERSE PATH LOGIC BASED ON THRESHOLD
    if (isHold) {
        job.status = 'QC_HOLD';
        job.currentStep = 'QC_Review_Needed';
        
        if (!job.history) job.history = [];
        job.history.push({ 
            step: 'Quality Control', 
            status: 'Held',
            details: `⚠️ CRITICAL: ${rejectionRate.toFixed(1)}% Rejection. Sent to Admin Review. Source: ${sampleSource}`,
            timestamp: new Date() 
        });

        await product.save();
        await job.save();
        
        return res.json({ 
            success: true, // Use true so the frontend Alert shows correctly
            hold: true, 
            msg: `⚠️ High Rejection (${rejectionRate.toFixed(1)}%). Batch moved to Admin Review.` 
        });
    }

    // --- Path Logic (Only runs if rejection < 20%) ---
    const hasPassedAssembly = job.history?.some(h => h.step === 'Assembly QC');

    if (!hasPassedAssembly) {
        // --- GATE 1: ASSEMBLY QC ---
        const sfgLotId = `SFG-${job.jobId.split('-').pop()}`;
        
        product.stock.semiFinished.push({
          lotNumber: sfgLotId,
          qty: Number(passedQty),
          date: new Date(),
          jobId: job.jobId
        });

        job.currentStep = 'Packaging_Pending'; 
        job.status = 'Ready_For_Packing'; 

        if (!job.history) job.history = [];
        job.history.push({ 
            step: 'Assembly QC', 
            status: `SFG Verified`,
            details: `Passed Assembly Gate. Moved to Storage. Source: ${sampleSource}`,
            timestamp: new Date() 
        });
    } else {
        // --- GATE 2: FINAL QC ---
        product.stock.warehouse += Number(passedQty);
        product.stock.batches.push({
            lotNumber: `FG-${job.jobId.split('-').pop()}`, 
            qty: Number(passedQty),
            date: new Date(),
            inspector: inspectorName,
            sampleSource: sampleSource,
            jobId: job.jobId
        });

        product.stock.semiFinished = product.stock.semiFinished.filter(lot => lot.jobId !== job.jobId);
        job.status = 'Completed';
        job.currentStep = 'QC_Completed';

        if (!job.history) job.history = [];
        job.history.push({ 
            step: 'Final Quality Control', 
            status: `Verified (Final)`,
            details: `Finished Goods moved to Warehouse. Source: ${sampleSource}`,
            timestamp: new Date() 
        });
    }

    await product.save();
    await job.save();

    res.json({ success: true, msg: `✅ QC Approved! Status: ${job.currentStep}` });
  } catch (error) {
    console.error("QC Submission Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get All Jobs on QC HOLD (Admin View)
exports.getHeldQC = async (req, res) => {
  try {
    // 🟢 Ensure both models are available to this function
    const JobCard = require('../models/JobCard');
    const PurchaseOrder = require('../models/PurchaseOrder');

    // 1. Fetch Production holds (Status: 'QC_HOLD')
    const productionHolds = await JobCard.find({ status: 'QC_HOLD' })
      .populate('productId', 'name sku')
      .lean();

    // 2. Fetch Purchase Order holds (Status: 'QC_Review')
    // Note: We use 'QC_Review' because that is what your receiveOrder function sets
    const purchaseHolds = await PurchaseOrder.find({ status: 'QC_Review' })
      .populate('vendor_id', 'name')
      .lean();

    // 3. Normalize Purchase Orders so the UI can read them as "Jobs"
    const formattedPOs = purchaseHolds.map(po => ({
      ...po,
      jobId: `PO-${po._id.toString().substr(-6)}`, // Display ID
      isPO: true, // Flag for the frontend mapping logic
      // Ensure the frontend has direct access to the product name
      productName: po.itemName, 
      updatedAt: po.updatedAt || po.createdAt
    }));

    // 4. Combine both lists into one single array for the table
    const allHolds = [...productionHolds, ...formattedPOs].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
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

    } else if (decision === 'reject') {
        // Use existing valid rejection statuses
        job.status = 'QC_Rejected';
        job.currentStep = 'Scrapped';
        
        job.history.push({
            step: 'Admin QC Review',
            status: 'Rejected',
            details: `Rejected by Admin ${adminName}. Notes: ${adminNotes}`,
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
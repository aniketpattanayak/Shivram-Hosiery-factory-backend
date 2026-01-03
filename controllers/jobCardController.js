const JobCard = require("../models/JobCard");
const Material = require("../models/Material");
const Product = require("../models/Product");
const Vendor = require("../models/Vendor");

// @desc    Get Active Job Cards (Shop Floor)
exports.getJobCards = async (req, res) => {
  try {
    let query = {};

    if (!req.user) {
      return res.status(401).json({ msg: "Not authorized, no user data" });
    }

    if (req.user.role === "Vendor") {
      if (!req.user.vendorId) {
        return res
          .status(403)
          .json({ msg: "Vendor profile not linked to this account." });
      }
      query = { vendorId: req.user.vendorId };
    }

    const jobs = await JobCard.find(query)
      .populate("productId", "name sku color stockAtLeast stock") // Added stock fields for SFG visibility
      .populate("vendorId", "name")
      .sort({ createdAt: -1 });

    res.json(jobs);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get Job Cards for the Logged-in Vendor
exports.getVendorJobs = async (req, res) => {
  try {
    const query =
      req.user.role === "Admin" ? {} : { vendorId: req.user.vendorId };

    const jobs = await JobCard.find(query)
      .populate("productId", "name sku")
      .populate("vendorId", "name")
      .sort({ createdAt: -1 });

    res.json(jobs);
  } catch (error) {
    res.status(500).json({ msg: "Error loading vendor jobs" });
  }
};

// @desc    Get Jobs Ready for QC (Covers both Assembly and Final QC)
exports.getQCJobs = async (req, res) => {
  try {
    const jobs = await JobCard.find({ currentStep: "QC_Pending" })
      .populate("productId")
      .populate("planId")
      .sort({ updatedAt: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Issue Raw Material
exports.issueMaterial = async (req, res) => {
  try {
    const { jobId } = req.body;
    const job = await JobCard.findOne({ jobId }).populate("productId");
    if (!job) return res.status(404).json({ msg: "Job Card not found" });

    if (job.currentStep !== "Material_Pending") {
      return res
        .status(400)
        .json({ msg: "Material already issued or invalid state" });
    }

    const routingName = job.routing?.cutting?.vendorName || "Internal";
    const assignedVendor = await Vendor.findOne({ name: routingName });

    if (assignedVendor) {
      job.vendorId = assignedVendor._id;
    }

    let pickingList = [];
    const product = job.productId;

    for (const item of product.bom) {
      const material = await Material.findById(item.material);
      if (!material) continue;

      const requiredQty = item.qtyRequired * job.totalQty;
      if (!material.stock.batches) material.stock.batches = [];
      material.stock.batches.sort(
        (a, b) => new Date(a.addedAt) - new Date(b.addedAt)
      );

      let remainingToIssue = requiredQty;
      const updatedBatches = [];

      for (const batch of material.stock.batches) {
        if (remainingToIssue <= 0) {
          updatedBatches.push(batch);
          continue;
        }

        if (batch.qty <= remainingToIssue) {
          pickingList.push({
            materialId: material._id,
            materialName: material.name,
            lotNumber: batch.lotNumber,
            qty: batch.qty,
          });
          remainingToIssue -= batch.qty;
        } else {
          pickingList.push({
            materialId: material._id,
            materialName: material.name,
            lotNumber: batch.lotNumber,
            qty: remainingToIssue,
          });
          batch.qty -= remainingToIssue;
          remainingToIssue = 0;
          updatedBatches.push(batch);
        }
      }

      material.stock.batches = updatedBatches;
      material.stock.current -= requiredQty;
      await material.save();
    }

    job.issuedMaterials = pickingList.map((p) => ({
      materialId: p.materialId,
      materialName: p.materialName,
      lotNumber: p.lotNumber,
      qtyIssued: p.qty,
      issuedBy: req.user.name,
      date: new Date(),
    }));

    job.currentStep = "Cutting_Pending";
    job.status = "In_Progress";

    job.timeline.push({
      stage: "Kitting",
      action: "Handover to Vendor",
      vendorName: routingName,
      details: `Materials issued for production.`,
      performedBy: req.user.name,
    });

    await job.save();
    res.json({
      success: true,
      msg: `Materials handed over to ${routingName} successfully.`,
      job,
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

exports.dispatchJob = async (req, res) => {
  try {
    const { jobId, actualQty, wastage } = req.body;
    const job = await JobCard.findOne({ jobId: jobId });
    if (!job) return res.status(404).json({ msg: "Job not found" });

    // 🟢 FIX: Ensure values are treated as numbers and default to 0
    const qtyProduced = Number(actualQty) || 0;
    const qtyWasted = Number(wastage) || 0;

    job.productionData.vendorDispatch = {
      isReady: true,
      actualQtyProduced: qtyProduced,
      wastageQty: qtyWasted,
      dispatchDate: new Date()
    };
    
    job.logisticsStatus = 'In_Transit'; 
    job.status = 'In_Progress'; 

    job.timeline.push({
      stage: 'Vendor Dispatch',
      action: `Dispatched to Factory`,
      details: `Vendor reported ${qtyProduced} pcs dispatched. Wastage: ${qtyWasted}kg.`,
      performedBy: req.user.name
    });

    await job.save();
    res.json({ success: true, msg: "Goods dispatched successfully!" });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
exports.receiveHandshake = async (req, res) => {
  try {
    const { jobId, receivedQty } = req.body;
    const job = await JobCard.findOne({ jobId });
    if (!job) return res.status(404).json({ msg: "Job not found" });

    job.receivedLogs.push({
      stage: job.currentStep,
      expectedQty: job.totalQty,
      receivedQty: Number(receivedQty),
      receivedBy: req.user.name,
    });
    job.logisticsStatus = "Received_At_Factory"; // 🔓 The "Gate" is now open

    job.timeline.push({
      stage: "Logistics",
      action: "Received",
      details: `Received ${receivedQty} units at Factory.`,
      performedBy: req.user.name,
    });
    await job.save();
    res.json({ success: true, msg: "Goods Received" });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Admin: Final Verification & Stock Receipt (Gate 2)
exports.receiveProcessV2 = async (req, res) => {
  try {
    const { jobId, finalQty, qcStatus, remarks } = req.body;
    const job = await JobCard.findOne({ jobId: jobId });
    if (!job) return res.status(404).json({ msg: "Job not found" });

    const newLot = `FG-${job.jobId.split("-").pop()}`;

    job.productionData.adminReceipt = {
      isReceived: true,
      finalQtyReceived: Number(finalQty),
      newLotNumber: newLot,
      receivedAt: new Date(),
      qcStatus: qcStatus,
    };

    if (qcStatus === "Pass") {
      const product = await Product.findById(job.productId);
      if (product) {
        product.stock.warehouse += Number(finalQty);
        if (!product.stock.batches) product.stock.batches = [];
        product.stock.batches.push({
          lotNumber: newLot,
          qty: Number(finalQty),
          date: new Date(),
        });
        await product.save();
      }
    }

    job.currentStep = "QC_Completed";
    job.status = qcStatus === "Pass" ? "Completed" : "QC_HOLD";

    job.timeline.push({
      stage: "Final Verification",
      action: `Admin verified ${finalQty} units`,
      details: `Finished Goods Lot: ${newLot}.`,
      performedBy: req.user.name,
    });

    await job.save();
    res.json({ success: true, msg: `Stock updated. Lot ${newLot} created.` });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Vendor: Stage Progression
// backend/controllers/jobCardController.js

// @desc    Vendor: Stage Progression (Fixed to break the loop)
// @desc    Vendor: Internal Stage Progression (Cutting -> Stitching)
// @desc    Vendor: Internal Stage Progression (No Handshake Trigger)
// backend/controllers/jobCardController.js
exports.updateJobStage = async (req, res) => {
  try {
    const { jobId, stageResult } = req.body;
    const job = await JobCard.findOne({ jobId });
    if (!job) return res.status(404).json({ msg: "Job card not found" });

    // 🟢 KEEPING ALL YOUR ORIGINAL INTERNAL TRANSITIONS
    if (stageResult === "Cutting_Started") {
      job.currentStep = "Cutting_Started";
    } 
    else if (stageResult === "Cutting_Completed") {
      job.currentStep = "Stitching_Pending"; 
    }
    else if (stageResult === "Sewing_Started") {
      job.currentStep = "Sewing_Started";
    }
    else if (stageResult === "Packaging_Started") {
      job.currentStep = "Packaging_Started";
    }

    // 🟢 UPDATED: History now captures 'performedBy' from the logged-in user
    job.history.push({
      step: stageResult.replace("_", " "),
      status: job.currentStep,
      // This maps the active user to your Analytics spreadsheet
      performedBy: req.user.name, 
      timestamp: new Date()
    });

    await job.save();
    
    // 🟢 Professional log to verify who moved the stage
    console.log(`[Factory Intelligence] Stage updated to ${job.currentStep} by ${req.user.name}`);

    res.json({ 
      success: true, 
      msg: `Internal stage updated by ${req.user.name}`, 
      nextStep: job.currentStep 
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
// ---------------------------------------------------------
// 🟢 UPDATED: RECEIVE PROCESS WITH SFG & DUAL-QC SUPPORT
// ---------------------------------------------------------
exports.receiveProcess = async (req, res) => {
  try {
    const { jobId, nextStage } = req.body;
    const job = await JobCard.findOne({ jobId });
    if (!job) return res.status(404).json({ msg: "Job not found" });

    let historyLog = {
      timestamp: new Date(),
      performedBy: req.user ? req.user.name : "Production Mgr",
    };

    // 🟢 DETECT TRANSITION FOR TIMELINE
    if (job.currentStep === "Cutting_Started") {
      historyLog.action = "Cutting Completed";
      historyLog.details = "Panels cut and sent to Stitching.";
    } else if (job.currentStep === "Sewing_Started") {
      historyLog.action = "Stitching Completed";
      historyLog.details = "Stitched items sent to Gate 1 Assembly QC.";
    } else if (job.currentStep === "Packaging_Pending") {
      historyLog.action = "Packaging Started";
      historyLog.details = `Started packing using SFG Lot: SFG-${job.jobId
        .split("-")
        .pop()}`;
    } else if (job.currentStep === "Packaging_Started") {
      historyLog.action = "Packaging Completed";
      historyLog.details = "Packed goods sent to Gate 2 Final QC.";
    }

    if (historyLog.action) {
      job.timeline.push(historyLog);
    }

    // 🟢 UPDATE STATE
    job.currentStep = nextStage;

    // Logic: If next is QC, status must be QC_Pending to show on QC page
    if (nextStage === "QC_Pending") {
      job.status = "QC_Pending";
    } else {
      job.status = "In_Progress";
    }

    await job.save();
    res.json({ success: true, msg: "Stage Advanced", job });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

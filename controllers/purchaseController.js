const PurchaseOrder = require("../models/PurchaseOrder");
const Product = require("../models/Product");
const Material = require("../models/Material");
const SurplusLedger = require("../models/SurplusLedger");
const Vendor = require("../models/Vendor");
const mongoose = require("mongoose");

// @desc    Get All Open Orders (excluding Completed and those in QC Review hold)
// @desc    Get All Open Orders for the Receipt Page
// This function ensures only orders ready to be received are sent to the frontend
// @desc    Get All Open Orders for the Receipt Page
// This ensures that only orders ready for stock intake are visible
exports.getOpenOrders = async (req, res) => {
    try {
      // 🎯 RESTORED ORIGINAL LOGIC: Show everything EXCEPT 'Completed' or 'QC_Review'
      // This ensures any status (Ordered, Pending, Partial, Sent, etc.) is visible.
      const openOrders = await PurchaseOrder.find({
        status: { $nin: ["Completed", "QC_Review"] },
      })
        .populate("vendor_id", "name") // Required to show Vendor Name in the frontend table
        .sort({ createdAt: -1 }); // 🎯 FIX: Using 'createdAt' (Standard Mongoose field) instead of 'created_at'
  
      res.json(openOrders);
    } catch (error) {
      console.error("Fetch Open Orders Error:", error);
      res.status(500).json({ msg: error.message });
    }
  };

// @desc    Get items specifically waiting for Admin Review (Rejection > 20%)
exports.getQCReviewList = async (req, res) => {
  try {
    const reviewOrders = await PurchaseOrder.find({
      "items.status": "QC_Review",
    })
      .populate("vendor_id", "name")
      .sort({ updatedAt: -1 });

    let flattenedReviewList = [];

    for (const order of reviewOrders) {
      for (const item of order.items) {
        if (item.status === "QC_Review") {
          const lastLog = item.history[item.history.length - 1] || {};

          flattenedReviewList.push({
            orderId: order._id,
            itemId: item.item_id,
            poNumber: order._id.toString().slice(-6),
            date: order.createdAt,
            vendorName: order.vendor_id?.name || "Unknown Vendor",
            itemName:
              item.itemName ||
              "Product ID: " + item.item_id.toString().slice(-4),
            itemType: item.itemType || "Raw Material",

            // Metrics
            rejectedQty: Number(lastLog.rejected || 0),
            receivedQty: Number(lastLog.qty || 0),
            sampleSize: Number(item.qcSampleQty || lastLog.qty || 1),
            inspector: lastLog.receivedBy || "Inspector",
            feedback: lastLog.status || "High Rejection Rate",
            totalBatchValue: lastLog.totalBatchValue || 0,
          });
        }
      }
    }
    res.json(flattenedReviewList);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get History of all partially or fully received orders
exports.getCompletedHistory = async (req, res) => {
  try {
    const orders = await PurchaseOrder.find({
      "items.receivedQty": { $gt: 0 },
    })
      .populate("vendor_id", "name")
      .sort({ updated_at: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Receive Goods (Standard or QC Mode)
exports.receiveOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      const {
        itemId,
        qtyReceived,
        lotNumber,
        billNumber,    // 🎯 Captured from frontend
        receivedDate,  // 🎯 Captured from frontend
        mode,
        qcBy,
        sampleSize,
        rejectedQty,
        breakdown,
        discountPercent,
        gstPercent,
      } = req.body;
  
      const order = await PurchaseOrder.findById(id)
        .session(session)
        .populate("vendor_id");
      if (!order) return res.status(404).json({ msg: "Order not found" });
  
      const itemIndex = order.items.findIndex(
        (i) => i.item_id.toString() === itemId.toString()
      );
      if (itemIndex === -1) {
        await session.abortTransaction();
        return res.status(404).json({ msg: "Item not found in this Purchase Order" });
      }
      const currentItem = order.items[itemIndex];
  
      // 1. Calculate Quantity
      let finalReceivedQty = 0;
      if (breakdown && typeof breakdown === "object") {
        finalReceivedQty =
          Number(breakdown.noOfBoxes || 0) * Number(breakdown.qtyPerBox || 0) +
          Number(breakdown.looseQty || 0);
      } else {
        finalReceivedQty = Number(qtyReceived) || 0;
      }
  
      if (finalReceivedQty <= 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, msg: "Received quantity is 0." });
      }
  
      // 2. Financials
      const unitPrice = Number(currentItem.unitPrice) || 0;
      const discRate = discountPercent !== undefined ? Number(discountPercent) : Number(order.discountPercent) || 0;
      const taxRate = gstPercent !== undefined ? Number(gstPercent) : Number(order.gstPercent) || 18;
  
      const batchGross = finalReceivedQty * unitPrice;
      const batchTaxable = batchGross - batchGross * (discRate / 100);
      const batchFinalTotal = batchTaxable + batchTaxable * (taxRate / 100);
  
      // 3. QC Logic & Stock prep
      let stockToAdd = 0;
      let isHighRejection = false;
      let historyStatus = "Received";
      let responseMsg = "";
      
      // 🎯 Use Manual Bill Number in Lot Number if none provided
      const baseBatchId = lotNumber || `LOT-${billNumber || order._id.toString().substr(-4)}`;
      
      // 🎯 Use Manual Date or default to now
      const finalDate = receivedDate ? new Date(receivedDate) : new Date();
  
      if (mode === "qc") {
        const size = Number(sampleSize) > 0 ? Number(sampleSize) : finalReceivedQty;
        const rejectionRate = (Number(rejectedQty) / size) * 100;
  
        if (rejectionRate > 20) {
          isHighRejection = true;
          currentItem.status = "QC_Review";
          historyStatus = `QC Failed (${rejectionRate.toFixed(1)}%) - Sent to Admin`;
          stockToAdd = 0;
          responseMsg = `⚠️ High Rejection (${rejectionRate.toFixed(1)}%). Sent for Admin Approval.`;
        } else {
          historyStatus = "QC Passed";
          stockToAdd = finalReceivedQty - Number(rejectedQty);
          responseMsg = `✅ QC Passed. Added ${stockToAdd} Good Units.`;
        }
      } else {
        stockToAdd = finalReceivedQty;
        responseMsg = `✅ Standard Receipt Processed.`;
      }
  
      // 4. Update Stock & Vendor Balance (Only if not high rejection)
      if (!isHighRejection) {
        if (batchFinalTotal > 0 && order.vendor_id) {
          await Vendor.findByIdAndUpdate(order.vendor_id, {
            $inc: { balance: batchFinalTotal },
          }).session(session);
        }
  
        const batchesToCreate = [
          { lotNumber: baseBatchId, qty: stockToAdd, date: finalDate }, // 🎯 Date saved
        ];
  
        if (currentItem.itemType === "Raw Material") {
          await Material.findByIdAndUpdate(currentItem.item_id, {
            $inc: { "stock.current": stockToAdd },
            $push: { "stock.batches": { $each: batchesToCreate } },
          }, { session });
        } else {
          await Product.findByIdAndUpdate(currentItem.item_id, {
            $inc: { "stock.warehouse": stockToAdd },
            $push: { "stock.batches": { $each: batchesToCreate } },
          }, { session });
        }
  
        currentItem.receivedQty += finalReceivedQty;
        currentItem.status = currentItem.receivedQty >= currentItem.orderedQty ? "Completed" : "Partial";
      }
  
      // 5. Update History with Bill Number and Manual Date
      if (!currentItem.history) currentItem.history = [];
      currentItem.history.push({
        date: finalDate, // 🎯 Manual Date
        billNumber: billNumber || "N/A", // 🎯 Manual Bill Number
        qty: finalReceivedQty,
        sampleSize: Number(sampleSize) || finalReceivedQty,
        rejected: Number(rejectedQty) || 0,
        mode: mode,
        receivedBy: qcBy || "Store Manager",
        status: historyStatus,
        lotNumber: baseBatchId,
        breakdown: breakdown,
        discountPercent: discRate,
        gstPercent: taxRate,
        totalBatchValue: batchFinalTotal,
      });
  
      // 6. Update Global PO Status
      const anyInReview = order.items.some(i => i.status === "QC_Review");
      const allCompleted = order.items.every((i) => i.status === "Completed" || i.status === "Rejected");
  
      if (anyInReview) order.status = "QC_Review";
      else if (allCompleted) order.status = "Completed";
      else order.status = "Partial";
  
      await order.save({ session });
      await session.commitTransaction();
      
      res.json({
        success: true,
        msg: responseMsg || "Receipt Processed",
        finalAmount: batchFinalTotal,
      });
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      console.error("Receive Order Error:", error.message);
      res.status(500).json({ msg: error.message });
    } finally {
      session.endSession();
    }
  };

// @desc    Admin: Process Decision for items held in QC Review
exports.processPurchaseQCDecision = async (req, res) => {
  try {
    const { orderId, itemId, decision, adminNotes } = req.body;

    const order = await PurchaseOrder.findById(orderId);
    if (!order)
      return res.status(404).json({ msg: "Purchase Order not found" });

    const itemIndex = order.items.findIndex(
      (i) => i.item_id.toString() === itemId.toString()
    );
    if (itemIndex === -1)
      return res.status(404).json({ msg: "Item not found in this PO" });

    const item = order.items[itemIndex];
    const lastLog = item.history[item.history.length - 1];

    if (!lastLog)
      return res
        .status(400)
        .json({ msg: "No QC history found for this item." });

    if (decision === "approve") {
      const stockToAdd = lastLog.qty - (lastLog.rejected || 0);

      if (stockToAdd > 0) {
        const batchEntry = {
          lotNumber: lastLog.lotNumber || `ADMIN-OK-${Date.now()}`,
          qty: stockToAdd,
          addedAt: new Date(),
        };

        if (item.itemType === "Raw Material") {
          await Material.findByIdAndUpdate(item.item_id, {
            $inc: { "stock.current": stockToAdd },
            $push: { "stock.batches": batchEntry },
          });
        } else {
          await Product.findByIdAndUpdate(item.item_id, {
            $inc: { "stock.warehouse": stockToAdd },
            $push: { "stock.batches": batchEntry },
          });
        }

        const batchValue = lastLog.totalBatchValue || 0;
        await Vendor.findByIdAndUpdate(order.vendor_id, {
          $inc: { balance: batchValue },
        });
      }

      item.receivedQty += lastLog.qty;
      item.status =
        item.receivedQty >= item.orderedQty ? "Completed" : "Partial";
      lastLog.status = "Admin Approved";
    } else {
      // ACTION: REJECT/SCRAP
      item.status = "Rejected";
      lastLog.status = "Rejected by Admin";
    }

    lastLog.adminNotes = adminNotes;

    const allFinished = order.items.every((i) =>
      ["Completed", "Rejected"].includes(i.status)
    );
    order.status = allFinished ? "Completed" : "Partial";

    await order.save();
    res.json({
      success: true,
      msg: `PO Batch ${
        decision === "approve" ? "Accepted" : "Rejected"
      } successfully.`,
    });
  } catch (error) {
    console.error("Decision Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Legacy Decision logic (if still used by older components)
exports.processQCDecision = async (req, res) => {
  try {
    const { orderId, decision, adminNotes } = req.body;
    const order = await PurchaseOrder.findById(orderId);
    if (!order) return res.status(404).json({ msg: "Order not found" });

    const lastLog = order.history[order.history.length - 1];
    if (!lastLog)
      return res.status(400).json({ msg: "No QC history found to review." });

    if (decision === "approve") {
      const stockToAdd = lastLog.qty - (lastLog.rejected || 0);
      if (stockToAdd > 0) {
        const batchEntry = {
          lotNumber: lastLog.lotNumber || `FORCE-QC-${Date.now()}`,
          qty: stockToAdd,
          addedAt: new Date(),
        };
        if (order.itemType === "Raw Material") {
          await Material.findByIdAndUpdate(order.item_id, {
            $inc: { "stock.current": stockToAdd },
            $push: { "stock.batches": batchEntry },
          });
        } else {
          await Product.findByIdAndUpdate(order.item_id, {
            $inc: { "stock.warehouse": stockToAdd },
            $push: { "stock.batches": batchEntry },
          });
        }
      }
      order.receivedQty += lastLog.qty;
      order.status =
        order.receivedQty >= order.orderedQty ? "Completed" : "Partial";
      lastLog.status = "Force Approved (Admin)";
    } else {
      order.status = "Rejected";
      lastLog.status = "Rejected by Admin";
    }
    await order.save();
    res.json({ success: true, msg: `Batch processed successfully.` });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

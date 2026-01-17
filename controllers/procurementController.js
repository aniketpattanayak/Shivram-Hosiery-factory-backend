const PurchaseOrder = require("../models/PurchaseOrder");
const Product = require("../models/Product");
const Material = require("../models/Material");
const SurplusLedger = require("../models/SurplusLedger");
const Vendor = require("../models/Vendor");
const mongoose = require("mongoose");
// Add this line at the top of your controller
const DirectEntryLog = require("../models/DirectEntryLog");

// @desc    Get All Open Orders (excluding Completed and those in QC Review hold)
// @desc    Get All Open Orders for the Receipt Page
exports.getOpenOrders = async (req, res) => {
    try {
      // 🎯 FIX 1: Explicitly include statuses that are ready to be received
      // Standard statuses: "Ordered", "Partial", "Pending"
      const openOrders = await PurchaseOrder.find({
        status: { $in: ["Ordered", "Partial", "Pending", "Sent"] },
      })
        .populate("vendor_id", "name") 
        .sort({ createdAt: -1 }); // 🎯 FIX 2: Use createdAt (Standard Mongoose field)
  
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
            date: lastLog.date || order.createdAt, 
            billNumber: lastLog.billNumber || "N/A", // 🎯 Added Bill Number to Review List
            vendorName: order.vendor_id?.name || "Unknown Vendor",
            itemName: item.itemName || "Product ID: " + item.item_id.toString().slice(-4),
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

// 🟢 UPDATED: Receive Goods (Standard or QC Mode) with Manual Date & Bill #
exports.receiveOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const {
      itemId,
      qtyReceived,
      lotNumber,
      billNumber,    // 🎯 Captured from frontend modal
      receivedDate,  // 🎯 Captured from frontend modal
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
      return res.status(404).json({ msg: "Item not found in this PO" });
    }
    const currentItem = order.items[itemIndex];

    // 1. Calculate Quantity
    let finalReceivedQty = 0;
    if (breakdown && typeof breakdown === "object") {
      finalReceivedQty =
        (Number(breakdown.noOfBoxes || 0) * Number(breakdown.qtyPerBox || 0)) +
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

    // 3. Stock Logic & Manual Date Processing
    let stockToAdd = 0;
    let isHighRejection = false;
    let historyStatus = "Received";
    let responseMsg = "";
    
    // 🎯 Use Bill Number to generate Lot if empty
    const baseBatchId = lotNumber || `LOT-${billNumber || order._id.toString().substr(-4)}`;
    // 🎯 Use manual date from frontend or current time
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

    // 4. Update Database only if not held for QC Review
    if (!isHighRejection) {
      if (batchFinalTotal > 0 && order.vendor_id) {
        await Vendor.findByIdAndUpdate(order.vendor_id._id, {
          $inc: { balance: batchFinalTotal },
        }).session(session);
      }

      const batchEntry = { lotNumber: baseBatchId, qty: stockToAdd, date: finalDate }; // 🎯 Save manual date

      if (currentItem.itemType === "Raw Material") {
        await Material.findByIdAndUpdate(currentItem.item_id, {
          $inc: { "stock.current": stockToAdd },
          $push: { "stock.batches": batchEntry },
        }, { session });
      } else {
        await Product.findByIdAndUpdate(currentItem.item_id, {
          $inc: { "stock.warehouse": stockToAdd },
          $push: { "stock.batches": batchEntry },
        }, { session });
      }

      currentItem.receivedQty += finalReceivedQty;
      currentItem.status = (currentItem.receivedQty >= currentItem.orderedQty) ? "Completed" : "Partial";
    }

    // 5. Update History Log
    if (!currentItem.history) currentItem.history = [];
    currentItem.history.push({
      date: finalDate, // 🎯 Save manual date
      billNumber: billNumber || "N/A", // 🎯 Save bill number
      qty: finalReceivedQty,
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
    const allFinished = order.items.every((i) => ["Completed", "Rejected"].includes(i.status));

    if (anyInReview) order.status = "QC_Review";
    else if (allFinished) order.status = "Completed";
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

// 🟢 UPDATED: Admin Decision (Carries over Manual Date/Details)
exports.processPurchaseQCDecision = async (req, res) => {
  try {
    const { orderId, itemId, decision, adminNotes } = req.body;
    const order = await PurchaseOrder.findById(orderId);
    if (!order) return res.status(404).json({ msg: "PO not found" });

    const itemIndex = order.items.findIndex(i => i.item_id.toString() === itemId.toString());
    if (itemIndex === -1) return res.status(404).json({ msg: "Item not found" });

    const item = order.items[itemIndex];
    const lastLog = item.history[item.history.length - 1];
    if (!lastLog) return res.status(400).json({ msg: "No history found" });

    if (decision === "approve") {
      const stockToAdd = lastLog.qty - (lastLog.rejected || 0);
      if (stockToAdd > 0) {
        const batchEntry = {
          lotNumber: lastLog.lotNumber,
          qty: stockToAdd,
          date: lastLog.date, // 🎯 Use the recorded manual date
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

        await Vendor.findByIdAndUpdate(order.vendor_id, {
          $inc: { balance: lastLog.totalBatchValue || 0 },
        });
      }

      item.receivedQty += lastLog.qty;
      item.status = item.receivedQty >= item.orderedQty ? "Completed" : "Partial";
      lastLog.status = "Admin Approved";
    } else {
      item.status = "Rejected";
      lastLog.status = "Rejected by Admin";
    }

    lastLog.adminNotes = adminNotes;
    const allFinished = order.items.every(i => ["Completed", "Rejected"].includes(i.status));
    order.status = allFinished ? "Completed" : "Partial";

    await order.save();
    res.json({ success: true, msg: `Decision processed successfully.` });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Legacy Decision preserved
exports.processQCDecision = async (req, res) => {
  try {
    const { orderId, decision, adminNotes } = req.body;
    const order = await PurchaseOrder.findById(orderId);
    if (!order) return res.status(404).json({ msg: "Order not found" });

    const lastLog = order.history ? order.history[order.history.length - 1] : null;
    if (!lastLog) return res.status(400).json({ msg: "No history found." });

    if (decision === "approve") {
      const stockToAdd = lastLog.qty - (lastLog.rejected || 0);
      if (stockToAdd > 0) {
        const batchEntry = { lotNumber: lastLog.lotNumber, qty: stockToAdd, date: lastLog.date };
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
      order.status = order.receivedQty >= order.orderedQty ? "Completed" : "Partial";
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

// @desc    Create a new Purchase Order
// 🎯 This is the missing logic that actually saves the PO to your database
// 🟢 Add this function to procurementController.js
exports.createPurchase = async (req, res) => {
    try {
      const { vendorId, items, totalAmount, gstPercent, discountPercent } = req.body;
  
      // 1. Validation to prevent the "NaN" error
      if (!totalAmount || isNaN(totalAmount)) {
        return res.status(400).json({ msg: "Total Amount is missing or invalid." });
      }
  
      if (!vendorId) {
        return res.status(400).json({ msg: "Vendor ID is required." });
      }
  
      // 2. Create the document matching your Model's strict rules
      const newPO = new PurchaseOrder({
        vendor_id: vendorId, // 🎯 FIX: Matches your "Path vendor_id is required" error
        items: items.map(item => ({
          item_id: item.itemId,
          itemName: item.itemName,
          itemType: item.itemType,
          orderedQty: Number(item.qty || 0), 
          receivedQty: 0,
          unitPrice: Number(item.rate || 0),
          status: "Pending" // Individual item status
        })),
        totalAmount: Number(totalAmount), // 🎯 FIX: Prevents "Cast to Number failed"
        gstPercent: Number(gstPercent) || 18,
        discountPercent: Number(discountPercent) || 0,
        
        // 🎯 FIX: Change "Ordered" to "Pending" or "Active" 
        // Based on your previous code, "Pending" is a safer valid enum value.
        status: "Pending" 
      });
  
      await newPO.save();
      res.status(201).json({ success: true, data: newPO });
  
    } catch (error) {
      console.error("PO Creation Error:", error);
      res.status(500).json({ msg: "Server Error: " + error.message });
    }
  };
// --- BACKEND FIX ---
exports.createDirectEntry = async (req, res) => {
    try {
      const { vendorId, billNumber, receivedDate, items } = req.body;
  
      if (!items || items.length === 0) {
        return res.status(400).json({ msg: "No items provided for entry." });
      }
  
      const processedLogs = [];
  
      // Loop through each item sent from the frontend
      for (const item of items) {
        console.log(`Processing ${item.itemType}: ${item.searchQuery}`);
  
        // 1. UPDATE LIVE STOCK
        let updateResult;
        const qtyToAdd = Number(item.qty);
  
        if (item.itemType === "Raw Material") {
          updateResult = await Material.findByIdAndUpdate(
            item.itemId,
            { 
              $inc: { "stock.current": qtyToAdd },
              $push: {
                "stock.batches": {
                  lotNumber: item.batch || `DIR-${Date.now()}`,
                  qty: qtyToAdd,
                  receivedDate: receivedDate || new Date()
                }
              }
            },
            { new: true } // Returns the updated document
          );
        } else {
          updateResult = await Product.findByIdAndUpdate(
            item.itemId,
            { $inc: { "stock.current": qtyToAdd } },
            { new: true }
          );
        }
  
        // 🎯 SAFETY CHECK: If updateResult is null, the Item ID was wrong
        if (!updateResult) {
          console.error(`❌ Item Not Found in DB: ${item.itemId} (${item.searchQuery})`);
          continue; // Skip this item if it doesn't exist in inventory
        }
  
        // 2. SAVE TO HISTORY (Matches exactly what your frontend expects)
        const newLog = new DirectEntryLog({
          vendor_id: vendorId,
          billNumber: billNumber,
          receivedDate: receivedDate || new Date(),
          itemId: item.itemId,
          itemName: item.searchQuery || item.itemName || "Unknown Item",
          itemType: item.itemType,
          receivedQty: qtyToAdd,
          rate: Number(item.rate || 0),
          totalAmount: Number(item.totalAmount || 0),
          batch: item.batch || "N/A",
          breakdown: {
            noOfBoxes: Number(item.breakdown?.noOfBoxes || 0),
            qtyPerBox: Number(item.breakdown?.qtyPerBox || 0),
            looseQty: Number(item.breakdown?.looseQty || 0)
          }
        });
  
        await newLog.save();
        processedLogs.push(newLog);
        console.log(`✅ Success: Updated stock and saved history for ${item.searchQuery}`);
      }
  
      res.status(201).json({ 
        msg: `Success! ${processedLogs.length} items added to stock and history.`,
        count: processedLogs.length
      });
  
    } catch (error) {
      console.error("CRITICAL ERROR in Direct Entry:", error);
      res.status(500).json({ msg: "Server Error: " + error.message });
    }
  };
  
  // 🎯 HISTORY RETRIEVAL FUNCTION
  // Ensure this exists so the history table can fetch data!
  exports.getDirectEntryHistory = async (req, res) => {
    try {
      const logs = await DirectEntryLog.find()
        .populate("vendor_id", "name") // Pulls vendor name for the table
        .sort({ createdAt: -1 })      // Shows newest entries at the top
        .limit(50);                   // Performance boost
      res.json(logs);
    } catch (error) {
      res.status(500).json({ msg: error.message });
    }
  };
const PurchaseOrder = require('../models/PurchaseOrder'); 
const Product = require('../models/Product');
const Material = require('../models/Material');
const SurplusLedger = require('../models/SurplusLedger');
const Vendor = require('../models/Vendor');

exports.getOpenOrders = async (req, res) => {
    try {
        // 🔴 CHANGE: Use $nin (Not In) to hide Completed AND QC_Review items
        const openOrders = await PurchaseOrder.find({ 
            status: { $nin: ['Completed', 'QC_Review'] } 
        })
        .populate('vendor_id', 'name')
        .sort({ created_at: -1 });
        
        res.json(openOrders);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
  };

  // 🟢 NEW: Get items waiting for Admin Review (Rejection > 20%)
  exports.getQCReviewList = async (req, res) => {
    try {
        // Find POs where any item is in 'QC_Review'
        const reviewOrders = await PurchaseOrder.find({ "items.status": "QC_Review" })
            .populate('vendor_id', 'name')
            .sort({ updatedAt: -1 });

        let flattenedReviewList = [];

        for (const order of reviewOrders) {
            for (const item of order.items) {
                if (item.status === 'QC_Review') {
                    const lastLog = item.history[item.history.length - 1] || {};
                    
                    // 🎯 SAFETY: If itemName is missing in the array, we can use a fallback
                    // or do a quick lookup if needed. For now, we trust the item.itemName 
                    // we saved during createPurchase.
                    
                    flattenedReviewList.push({
                        orderId: order._id,
                        itemId: item.item_id,
                        poNumber: order._id.toString().slice(-6),
                        date: order.createdAt,
                        vendorName: order.vendor_id?.name || "Unknown Vendor",
                        itemName: item.itemName || "Product ID: " + item.item_id.toString().slice(-4), 
                        itemType: item.itemType || "Raw Material",
                        
                        // Metrics
                        rejectedQty: Number(lastLog.rejected || 0),
                        receivedQty: Number(lastLog.qty || 0),
                        sampleSize: Number(item.qcSampleQty || lastLog.qty || 1), 
                        inspector: lastLog.receivedBy || "Inspector",
                        feedback: lastLog.status || "High Rejection Rate",
                        totalBatchValue: lastLog.totalBatchValue || 0
                    });
                }
            }
        }
        res.json(flattenedReviewList);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

// 🟢 NEW: Get Completed History
exports.getCompletedHistory = async (req, res) => {
    try {
        // Find any PO where at least one item has been partially or fully received
        const orders = await PurchaseOrder.find({ 
            "items.receivedQty": { $gt: 0 } 
        })
        .populate('vendor_id', 'name')
        .sort({ updated_at: -1 }); 
        
        res.json(orders);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};


exports.processQCDecision = async (req, res) => {
    try {
        const { orderId, decision, adminNotes } = req.body; // decision = 'approve' or 'reject'
        
        const order = await PurchaseOrder.findById(orderId);
        if (!order) return res.status(404).json({ msg: 'Order not found' });

        // Find the last history entry (the one that failed QC)
        const lastLog = order.history[order.history.length - 1];
        if (!lastLog) return res.status(400).json({ msg: 'No QC history found to review.' });

        if (decision === 'approve') {
            // --- ACTION: FORCE ACCEPT ---
            
            // 1. Calculate Stock to Add (Total - Rejected)
            // Note: If you want to force accept *everything* (including rejected), use lastLog.qty.
            // Assuming we accept the "good" portion or override rejection:
            const stockToAdd = lastLog.qty - (lastLog.rejected || 0);

            if (stockToAdd > 0) {
                 const batchEntry = {
                    lotNumber: lastLog.lotNumber || `FORCE-QC-${Date.now()}`,
                    qty: stockToAdd,
                    addedAt: new Date()
                };

                // Update Stock Levels
                if (order.itemType === 'Raw Material') {
                    await Material.findByIdAndUpdate(order.item_id, {
                        $inc: { 'stock.current': stockToAdd },
                        $push: { 'stock.batches': batchEntry }
                    });
                } else if (order.itemType === 'Finished Good') {
                    await Product.findByIdAndUpdate(order.item_id, {
                        $inc: { 'stock.warehouse': stockToAdd },
                        $push: { 'stock.batches': batchEntry }
                    });
                }
            }

            // 2. Update Order Status
            order.receivedQty += lastLog.qty; // Account for the quantity received
            order.status = (order.receivedQty >= order.orderedQty) ? 'Completed' : 'Partial';
            order.qcStatus = 'Passed'; // Override status
            
            // 3. Update History Log
            lastLog.status = 'Force Approved (Admin)';
            // You can push a new log note if you prefer, or just edit the status
            
        } else {
            // --- ACTION: REJECT & DISCARD ---
            // We do NOT add stock. We just close the loop.
            order.status = 'Rejected'; // Or 'Partial' if you want to keep PO open for new stock
            lastLog.status = 'Rejected by Admin';
        }

        await order.save();
        res.json({ success: true, msg: `Batch ${decision === 'approve' ? 'Accepted' : 'Rejected'} successfully.` });

    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: error.message });
    }
};




exports.receiveOrder = async (req, res) => {
    const session = await require('mongoose').startSession();
    session.startTransaction();
    try {
        const { id } = req.params; // The PO ID
        const { 
            itemId, // 🎯 NEW: Identifies which item in the array is being received
            qtyReceived, lotNumber, 
            mode, qcBy, sampleSize, rejectedQty,
            breakdown,
            discountPercent, 
            gstPercent 
        } = req.body;

        const order = await PurchaseOrder.findById(id).session(session).populate('vendor_id');
        if (!order) return res.status(404).json({ msg: 'Order not found' });

        // 1. 🎯 FIND THE SPECIFIC ITEM in the items array
        const itemIndex = order.items.findIndex(i => i.item_id.toString() === itemId.toString());
        if (itemIndex === -1) {
            await session.abortTransaction();
            return res.status(404).json({ msg: "Item not found in this Purchase Order" });
        }
        const currentItem = order.items[itemIndex];

        // 2. Robust calculation for total quantity
        let finalReceivedQty = 0;
        if (breakdown && typeof breakdown === 'object') {
            finalReceivedQty = (Number(breakdown.noOfBoxes || 0) * Number(breakdown.qtyPerBox || 0)) + Number(breakdown.looseQty || 0);
        } else {
            finalReceivedQty = Number(qtyReceived) || 0;
        }

        if (finalReceivedQty <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, msg: "Received quantity is 0." });
        }

        // 3. FINANCIAL CALCULATION (Per Item Lot)
        const unitPrice = Number(currentItem.unitPrice) || 0;
        const discRate = Number(discountPercent) !== undefined ? Number(discountPercent) : (Number(order.discountPercent) || 0);
        const taxRate = Number(gstPercent) !== undefined ? Number(gstPercent) : (Number(order.gstPercent) || 18);

        const batchGross = finalReceivedQty * unitPrice;
        const batchTaxable = batchGross - (batchGross * (discRate / 100));
        const batchFinalTotal = batchTaxable + (batchTaxable * (taxRate / 100));

        let stockToAdd = 0;
        let isHighRejection = false; 
        let historyStatus = 'Received';
        const baseBatchId = lotNumber || `PO-${order._id.toString().substr(-4)}-${Date.now()}`;

        // 4. QC LOGIC
        // --- QC LOGIC ---
        // --- QC LOGIC INSIDE receiveOrder ---
if (mode === 'qc') {
    // 1. Calculate the rejection percentage for this batch
    const size = Number(sampleSize) > 0 ? Number(sampleSize) : finalReceivedQty;
    const rejectionRate = (Number(rejectedQty) / size) * 100;
    
    if (rejectionRate > 20) {
        // 🎯 TRIGGER ADMIN REVIEW HOLD
        isHighRejection = true;
        
        // Update statuses to QC_Review (requires the updated Model enum)
        order.status = 'QC_Review'; 
        currentItem.status = 'QC_Review'; 
        
        historyStatus = `QC Failed (${rejectionRate.toFixed(1)}%) - Sent to Admin`;
        
        // 🛡️ IMPORTANT: Stock and Vendor Balance updates are skipped
        stockToAdd = 0; 
        responseMsg = `⚠️ High Rejection (${rejectionRate.toFixed(1)}%). Sent for Admin Approval.`;
    } else {
        // 🎯 QC PASSED (Normal Flow)
        historyStatus = 'QC Passed';
        stockToAdd = finalReceivedQty - Number(rejectedQty); 
        responseMsg = `✅ QC Passed. Added ${stockToAdd} Good Units.`;
    }
}

        // 5. UPDATE VENDOR BALANCE & INVENTORY
        if (!isHighRejection) {
            if (batchFinalTotal > 0) {
                const Vendor = require('../models/Vendor');
                await Vendor.findByIdAndUpdate(order.vendor_id, { $inc: { balance: batchFinalTotal } }).session(session);
            }

            // Inventory Update
            const batchesToCreate = [{ lotNumber: baseBatchId, qty: stockToAdd, addedAt: new Date() }];
            if (currentItem.itemType === 'Raw Material') {
                await Material.findByIdAndUpdate(currentItem.item_id, {
                    $inc: { 'stock.current': stockToAdd },
                    $push: { 'stock.batches': { $each: batchesToCreate } }
                }, { session });
            } else {
                await Product.findByIdAndUpdate(currentItem.item_id, {
                    $inc: { 'stock.warehouse': stockToAdd },
                    $push: { 'stock.batches': { $each: batchesToCreate } }
                }, { session });
            }

            // Update Item Status
            currentItem.receivedQty += finalReceivedQty;
            if (currentItem.receivedQty >= currentItem.orderedQty) currentItem.status = 'Completed';
            else currentItem.status = 'Partial';
        }

        // 6. LOG HISTORY TO THE SPECIFIC ITEM
        if (!currentItem.history) currentItem.history = [];
        currentItem.history.push({
            date: new Date(),
            qty: finalReceivedQty,
            rejected: Number(rejectedQty) || 0,
            mode: mode,
            receivedBy: qcBy || "Store Manager",
            status: historyStatus,
            lotNumber: baseBatchId,
            breakdown: breakdown,
            discountPercent: discRate,
            gstPercent: taxRate,
            totalBatchValue: batchFinalTotal
        });

        // 7. Overall PO Status
        const allCompleted = order.items.every(i => i.status === 'Completed');
        if (allCompleted) order.status = 'Completed';
        else if (order.status !== 'QC_Review') order.status = 'Partial';

        await order.save({ session });
        await session.commitTransaction();
        res.json({ success: true, msg: "Receipt Processed Successfully", finalAmount: batchFinalTotal });

    } catch (error) {
        await session.abortTransaction();
        console.error("Receive Order Error:", error.message);
        res.status(500).json({ msg: error.message });
    } finally {
        session.endSession();
    }
};
// 🟢 NEW: Handle Admin Decision for Held Purchase Orders
// backend/controllers/purchaseController.js

exports.processPurchaseQCDecision = async (req, res) => {
    try {
        // 🎯 itemId is required to know which product in the array to approve/reject
        const { orderId, itemId, decision, adminNotes } = req.body; 
        
        const Vendor = require('../models/Vendor');
        const Material = require('../models/Material');
        const Product = require('../models/Product');

        const order = await PurchaseOrder.findById(orderId);
        if (!order) return res.status(404).json({ msg: 'Purchase Order not found' });

        // 🎯 Find the specific item being reviewed in the multi-product array
        const itemIndex = order.items.findIndex(i => i.item_id.toString() === itemId.toString());
        if (itemIndex === -1) return res.status(404).json({ msg: 'Item not found in this PO' });
        
        const item = order.items[itemIndex];
        const lastLog = item.history[item.history.length - 1];
        
        if (!lastLog) return res.status(400).json({ msg: 'No QC history found for this item.' });

        if (decision === 'approve') {
            // --- ACTION: ACCEPT BATCH ---
            const stockToAdd = lastLog.qty - (lastLog.rejected || 0);

            if (stockToAdd > 0) {
                const batchEntry = {
                    lotNumber: lastLog.lotNumber || `ADMIN-OK-${Date.now()}`,
                    qty: stockToAdd,
                    addedAt: new Date()
                };

                // Update physical stock based on Item Type
                if (item.itemType === 'Raw Material') {
                    await Material.findByIdAndUpdate(item.item_id, {
                        $inc: { 'stock.current': stockToAdd },
                        $push: { 'stock.batches': batchEntry }
                    });
                } else {
                    await Product.findByIdAndUpdate(item.item_id, {
                        $inc: { 'stock.warehouse': stockToAdd },
                        $push: { 'stock.batches': batchEntry }
                    });
                }

                // 🟢 Update Vendor Balance officially
                const batchValue = lastLog.totalBatchValue || 0;
                await Vendor.findByIdAndUpdate(order.vendor_id, { 
                    $inc: { balance: batchValue } 
                });
            }

            // Update item-level totals and status
            item.receivedQty += lastLog.qty;
            item.status = (item.receivedQty >= item.orderedQty) ? 'Completed' : 'Partial';
            lastLog.status = 'Admin Approved';
            
        } else {
            // --- ACTION: SCRAP/REJECT ---
            item.status = 'Rejected'; 
            lastLog.status = 'Rejected by Admin';
        }

        // Log the admin decision in the history details
        lastLog.adminNotes = adminNotes;

        // 🎯 Check if all items in the PO are finished to close the overall PO status
        const allFinished = order.items.every(i => ['Completed', 'Rejected'].includes(i.status));
        order.status = allFinished ? 'Completed' : 'Partial';
        
        await order.save();
        res.json({ 
            success: true, 
            msg: `PO Batch ${decision === 'approve' ? 'Accepted' : 'Rejected'} successfully.` 
        });

    } catch (error) {
        console.error("Decision Error:", error);
        res.status(500).json({ msg: error.message });
    }
};


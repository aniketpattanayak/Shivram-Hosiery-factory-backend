const PurchaseOrder = require('../models/PurchaseOrder'); 
const Product = require('../models/Product');
const Material = require('../models/Material');
const SurplusLedger = require('../models/SurplusLedger');

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
        const reviewList = await PurchaseOrder.find({ 
            status: 'QC_Review' 
        })
        .populate('vendor_id', 'name')
        .sort({ updated_at: -1 });
        
        res.json(reviewList);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

// 🟢 NEW: Get Completed History
exports.getCompletedHistory = async (req, res) => {
    try {
        // Fetch Completed orders OR Partial orders with some history
        const orders = await PurchaseOrder.find({ 
            receivedQty: { $gt: 0 } 
        })
        .populate('vendor_id', 'name')
        .sort({ 'history.date': -1 }); // Sort by latest activity
        
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
        const { id } = req.params;
        const { 
            qtyReceived, lotNumber, 
            mode, qcBy, sampleSize, rejectedQty 
        } = req.body;

        const order = await PurchaseOrder.findById(id).session(session).populate('vendor_id');
        if (!order) return res.status(404).json({ msg: 'Order not found' });

        let stockToAdd = 0;
        let finalStatus = 'Partial'; 
        let historyStatus = 'Received';
        let responseMsg = "";
        let isHighRejection = false; 

        // 🟢 ARCHITECT FIX: Generate the Lot Number ONCE to ensure consistency
        // This variable is now shared between SurplusLedger and Inventory Batches
        const finalLotNumber = lotNumber && lotNumber.trim() !== "" 
            ? lotNumber 
            : `PO-${order._id.toString().substr(-4)}-${Date.now()}`;

        // --- QC LOGIC ---
        if (mode === 'qc') {
            const size = Number(sampleSize) > 0 ? Number(sampleSize) : Number(qtyReceived);
            const rejectionRate = (Number(rejectedQty) / size) * 100;
            
            if (rejectionRate > 20) {
                isHighRejection = true;
                order.status = 'QC_Review';
                order.qcStatus = 'Failed'; 
                historyStatus = `QC Failed (${rejectionRate.toFixed(1)}%)`;
                responseMsg = `⚠️ High Rejection (${rejectionRate.toFixed(1)}%). Sent to Admin Review.`;
                stockToAdd = 0; 
            } else {
                historyStatus = 'QC Passed';
                stockToAdd = Number(qtyReceived) - Number(rejectedQty); 
                responseMsg = `✅ QC Passed. Added ${stockToAdd} Good Units.`;
            }
        } else {
            stockToAdd = Number(qtyReceived);
            historyStatus = 'Direct Receive';
            responseMsg = `✅ Direct Receive. Added ${stockToAdd} Units.`;
        }

        // --- 🟢 SURPLUS TRACKING LOGIC (Using synchronized finalLotNumber) ---
        if (stockToAdd > 0 && !isHighRejection) {
            const totalAfterThis = order.receivedQty + Number(qtyReceived);
            
            if (totalAfterThis > order.orderedQty) {
                const previousSurplus = Math.max(0, order.receivedQty - order.orderedQty);
                const newTotalSurplus = Math.max(0, totalAfterThis - order.orderedQty);
                const surplusFromThisBatch = newTotalSurplus - previousSurplus;

                if (surplusFromThisBatch > 0) {
                    await SurplusLedger.create([{
                        lotNumber: finalLotNumber, // 🎯 Matches Inventory Batch exactly
                        vendorName: order.vendor_id?.name || "PO Vendor",
                        itemId: order.item_id,
                        itemName: order.itemName,
                        itemType: order.itemType,
                        orderedQty: order.orderedQty,
                        receivedQty: Number(qtyReceived),
                        surplusAdded: surplusFromThisBatch
                    }], { session });
                }
            }
        }

        // --- 1. UPDATE INVENTORY (Using synchronized finalLotNumber) ---
        if (stockToAdd > 0 && !isHighRejection) {
            const batchEntry = {
                lotNumber: finalLotNumber, // 🎯 Matches Surplus Ledger exactly
                qty: stockToAdd,
                addedAt: new Date()
            };

            if (order.itemType === 'Raw Material') {
                await Material.findByIdAndUpdate(order.item_id, {
                    $inc: { 'stock.current': stockToAdd },
                    $push: { 'stock.batches': batchEntry }
                }, { session });
            } else if (order.itemType === 'Finished Good') {
                await Product.findByIdAndUpdate(order.item_id, {
                    $inc: { 'stock.warehouse': stockToAdd },
                    $push: { 'stock.batches': batchEntry }
                }, { session });
            }
        }

        // --- 2. UPDATE PO STATUS ---
        if (!isHighRejection) {
            order.receivedQty += Number(qtyReceived); 
            if (order.receivedQty >= order.orderedQty) finalStatus = 'Completed';
            if (order.status !== 'QC_Review') order.status = finalStatus;
        }

        // --- 3. HISTORY LOG ---
        order.history.push({
            date: new Date(),
            qty: Number(qtyReceived),
            rejected: Number(rejectedQty) || 0,
            mode: mode,
            receivedBy: qcBy || "Store Manager",
            status: historyStatus,
            lotNumber: finalLotNumber // 🎯 Logged for traceability
        });

        await order.save({ session });
        await session.commitTransaction();

        res.json({ success: true, msg: responseMsg, isFlagged: isHighRejection });

    } catch (error) {
        await session.abortTransaction();
        console.error(error);
        res.status(500).json({ msg: error.message });
    } finally {
        session.endSession();
    }
};
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
            mode, qcBy, sampleSize, rejectedQty,
            breakdown,
            // 🟢 NEW: Financial Overrides from Frontend
            discountPercent, 
            gstPercent 
        } = req.body;

        const order = await PurchaseOrder.findById(id).session(session).populate('vendor_id');
        if (!order) return res.status(404).json({ msg: 'Order not found' });

        // Import Vendor model locally if not already at the top of the file
        const Vendor = require('../models/Vendor');

        // 1. Robust calculation for total quantity
        let finalReceivedQty = 0;
        if (breakdown && typeof breakdown === 'object') {
            finalReceivedQty = (Number(breakdown.noOfBoxes || 0) * Number(breakdown.qtyPerBox || 0)) + Number(breakdown.looseQty || 0);
        } else {
            finalReceivedQty = Number(qtyReceived) || 0;
        }

        // 2. STOP: Prevents "NaN" or empty requests from processing
        if (finalReceivedQty <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ 
                success: false, 
                msg: "Error: Received quantity is 0. Please check your Box/Loose inputs." 
            });
        }

        // 🟢 3. FINANCIAL CALCULATION FOR THIS BATCH
        // Calculate based on current batch qty and overrides
        const unitPrice = Number(order.unitPrice) || 0;
        const discRate = Number(discountPercent) !== undefined ? Number(discountPercent) : (Number(order.discountPercent) || 0);
        const taxRate = Number(gstPercent) !== undefined ? Number(gstPercent) : (Number(order.gstPercent) || 18);

        const batchGross = finalReceivedQty * unitPrice;
        const batchDiscountAmount = batchGross * (discRate / 100);
        const batchTaxable = batchGross - batchDiscountAmount;
        const batchTaxAmount = batchTaxable * (taxRate / 100);
        const batchFinalTotal = batchTaxable + batchTaxAmount;

        let stockToAdd = 0;
        let finalStatus = 'Partial'; 
        let historyStatus = 'Received';
        let responseMsg = "";
        let isHighRejection = false; 

        const baseBatchId = lotNumber && lotNumber.trim() !== "" 
            ? lotNumber 
            : `PO-${order._id.toString().substr(-4)}-${Date.now()}`;

        // --- QC LOGIC ---
        if (mode === 'qc') {
            const size = Number(sampleSize) > 0 ? Number(sampleSize) : finalReceivedQty;
            const rejectionRate = (Number(rejectedQty) / size) * 100;
            
            if (rejectionRate > 20) {
                isHighRejection = true;
                order.status = 'QC_Review'; // 🎯 Status used for Material Purchases
                order.qcStatus = 'Failed'; 
                
                // 🟢 ADD: Store metadata so the Admin Review table can display it
                order.qcResult = {
                    rejectedQty: Number(rejectedQty),
                    sampleSize: Number(sampleSize),
                    notes: req.body.reason || "High Rejection during GRN",
                    rejectionRate: rejectionRate.toFixed(2),
                    timestamp: new Date()
                };
                
                historyStatus = `QC Failed (${rejectionRate.toFixed(1)}%)`;
                responseMsg = `⚠️ High Rejection (${rejectionRate.toFixed(1)}%). Sent to Admin Review.`;
                stockToAdd = 0; 
            } else {
                historyStatus = 'QC Passed';
                stockToAdd = finalReceivedQty - Number(rejectedQty); 
                responseMsg = `✅ QC Passed. Added ${stockToAdd} Good Units. Batch Value: ₹${batchFinalTotal.toFixed(2)}`;
            }
        } else {
            stockToAdd = finalReceivedQty;
            historyStatus = 'Direct Receive';
            responseMsg = `✅ Direct Receive. Added ${stockToAdd} Units. Batch Value: ₹${batchFinalTotal.toFixed(2)}`;
        }

        // 🟢 4. UPDATE VENDOR BALANCE
        // Only update balance if stock is actually accepted (not held in QC review)
        if (!isHighRejection && batchFinalTotal > 0) {
            await Vendor.findByIdAndUpdate(order.vendor_id, {
                $inc: { balance: batchFinalTotal }
            }).session(session);
        }

        // 5. SUB-BATCH LOGIC (BOX vs LOOSE)
        const batchesToCreate = [];
        if (stockToAdd > 0 && !isHighRejection) {
            if (breakdown) {
                if (Number(breakdown.noOfBoxes) > 0) {
                    batchesToCreate.push({
                        lotNumber: `${baseBatchId}-BOX`,
                        qty: (Number(breakdown.noOfBoxes) * Number(breakdown.qtyPerBox)),
                        boxCount: Number(breakdown.noOfBoxes),
                        isLoose: false,
                        addedAt: new Date()
                    });
                }
                if (Number(breakdown.looseQty) > 0) {
                    batchesToCreate.push({
                        lotNumber: `${baseBatchId}-LOOSE`,
                        qty: Number(breakdown.looseQty),
                        isLoose: true,
                        addedAt: new Date()
                    });
                }
            } else {
                batchesToCreate.push({ lotNumber: baseBatchId, qty: stockToAdd, addedAt: new Date() });
            }
        }

        // --- SURPLUS TRACKING ---
        if (stockToAdd > 0 && !isHighRejection) {
            const totalAfterThis = order.receivedQty + finalReceivedQty;
            if (totalAfterThis > order.orderedQty) {
                const previousSurplus = Math.max(0, order.receivedQty - order.orderedQty);
                const newTotalSurplus = Math.max(0, totalAfterThis - order.orderedQty);
                const surplusFromThisBatch = newTotalSurplus - previousSurplus;

                if (surplusFromThisBatch > 0) {
                    await SurplusLedger.create([{
                        lotNumber: baseBatchId, 
                        vendorName: order.vendor_id?.name || "PO Vendor",
                        itemId: order.item_id,
                        itemName: order.itemName,
                        itemType: order.itemType,
                        orderedQty: order.orderedQty,
                        receivedQty: finalReceivedQty,
                        surplusAdded: surplusFromThisBatch
                    }], { session });
                }
            }
        }

        // --- UPDATE INVENTORY ---
        if (batchesToCreate.length > 0 && !isHighRejection) {
            if (order.itemType === 'Raw Material') {
                await Material.findByIdAndUpdate(order.item_id, {
                    $inc: { 'stock.current': stockToAdd },
                    $push: { 'stock.batches': { $each: batchesToCreate } }
                }, { session });
            } else {
                await Product.findByIdAndUpdate(order.item_id, {
                    $inc: { 'stock.warehouse': stockToAdd },
                    $push: { 'stock.batches': { $each: batchesToCreate } }
                }, { session });
            }
        }

        // 6. Update PO Status
        if (!isHighRejection) {
            order.receivedQty += finalReceivedQty; 
            if (order.receivedQty >= order.orderedQty) finalStatus = 'Completed';
            if (order.status !== 'QC_Review') order.status = finalStatus;
        }

        // 🟢 7. LOG HISTORY WITH FINANCIALS
        order.history.push({
            date: new Date(),
            qty: finalReceivedQty,
            rejected: Number(rejectedQty) || 0,
            mode: mode,
            receivedBy: qcBy || "Store Manager",
            status: historyStatus,
            lotNumber: baseBatchId,
            breakdown: breakdown,
            // Track specific financials used for this specific lot
            discountPercent: discRate,
            gstPercent: taxRate,
            totalBatchValue: batchFinalTotal
        });

        await order.save({ session });
        await session.commitTransaction();

        res.json({ success: true, msg: responseMsg, finalAmount: batchFinalTotal });

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
        const { orderId, decision, adminNotes } = req.body; 
        
        // 🟢 Ensure models are available locally to prevent "not defined" errors
        const Vendor = require('../models/Vendor');
        const Material = require('../models/Material');
        const Product = require('../models/Product');

        const order = await PurchaseOrder.findById(orderId);
        if (!order) return res.status(404).json({ msg: 'Purchase Order not found' });

        // Get the most recent history entry that was held
        const lastLog = order.history[order.history.length - 1];
        if (!lastLog) return res.status(400).json({ msg: 'No QC history found for this order.' });

        if (decision === 'approve') {
            // --- ACTION: ACCEPT BATCH ---
            // Calculate accepted qty (Received - Rejected)
            const stockToAdd = lastLog.qty - (lastLog.rejected || 0);

            if (stockToAdd > 0) {
                const batchEntry = {
                    lotNumber: lastLog.lotNumber || `ADMIN-OK-${Date.now()}`,
                    qty: stockToAdd,
                    addedAt: new Date()
                };

                // Update physical stock
                if (order.itemType === 'Raw Material') {
                    await Material.findByIdAndUpdate(order.item_id, {
                        $inc: { 'stock.current': stockToAdd },
                        $push: { 'stock.batches': batchEntry }
                    });
                } else {
                    await Product.findByIdAndUpdate(order.item_id, {
                        $inc: { 'stock.warehouse': stockToAdd },
                        $push: { 'stock.batches': batchEntry }
                    });
                }

                // 🟢 Update Vendor Balance officially
                // This uses the total value calculated during the initial intake
                const batchValue = lastLog.totalBatchValue || 0;
                await Vendor.findByIdAndUpdate(order.vendor_id, { 
                    $inc: { balance: batchValue } 
                });
            }

            // Update PO level totals
            order.receivedQty += lastLog.qty;
            order.status = (order.receivedQty >= order.orderedQty) ? 'Completed' : 'Partial';
            lastLog.status = 'Admin Approved';
            
        } else {
            // --- ACTION: SCRAP/REJECT ---
            // PO stays open so the user can try to receive the correct stock again
            order.status = 'Partial'; 
            lastLog.status = 'Rejected by Admin';
        }

        // Log the admin decision in the history details
        lastLog.adminNotes = adminNotes;
        
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


const Material = require('../models/Material');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const PurchaseOrder = require('../models/PurchaseOrder'); 
const JobCard = require('../models/JobCard');
const SurplusLedger = require('../models/SurplusLedger');

// @desc Process Purchase (PO Generation - Standard)
exports.createPurchase = async (req, res) => {
    try {
        const { vendor, items, discountPercent, gstPercent } = req.body;

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ msg: "Items array is required" });
        }

        let calculatedItems = [];
        let subtotalGross = 0;

        for (const item of items) {
            // 🎯 Ensure we use the exact keys sent by frontend
            const { itemId, itemType, qty, unitPrice } = item;
            let fetchedItem = null;

            // 🟢 Handle potential casing or spacing differences
            const normalizedType = itemType ? itemType.trim() : "";

            if (normalizedType === 'Raw Material') {
                fetchedItem = await Material.findById(itemId);
            } else if (normalizedType === 'Finished Good') {
                fetchedItem = await Product.findById(itemId);
            }

            if (!fetchedItem) {
                // 🎯 This tells you EXACTLY what the backend received
                return res.status(404).json({ 
                    msg: `Item not found. ID: ${itemId} | Type Received: "${itemType}"` 
                });
            }

            subtotalGross += Number(qty) * Number(unitPrice);
            calculatedItems.push({
                item_id: itemId,
                itemName: fetchedItem.name,
                itemType: normalizedType,
                orderedQty: Number(qty),
                receivedQty: 0,
                unitPrice: Number(unitPrice),
                status: 'Pending'
            });
        }

        const totalAmount = (subtotalGross - (subtotalGross * (Number(discountPercent || 0) / 100))) * (1 + (Number(gstPercent || 18) / 100));

        const newPO = await PurchaseOrder.create({
            vendor_id: vendor,
            items: calculatedItems,
            discountPercent: Number(discountPercent),
            gstPercent: Number(gstPercent),
            totalAmount: totalAmount,
            status: 'Pending',
            orderDate: new Date()
        });

        res.status(201).json({ success: true, msg: "PO Created!", order: newPO });

    } catch (error) {
        console.error("Purchase Error:", error);
        res.status(500).json({ msg: error.message });
    }
};

// 🟢 NEW: Direct Stock Entry (Updates Stock & Creates Batch)
// 🟢 UPDATED: Direct Stock Entry with Box + Loose Lot Management
exports.createDirectEntry = async (req, res) => {
    const session = await require('mongoose').startSession();
    session.startTransaction();
    try {
        const { vendorId, items, discountPercent, gstPercent } = req.body; 
        let grandTotalGross = 0;
        let calculatedItems = [];

        for (const item of items) {
            const calculatedQty = (Number(item.breakdown?.noOfBoxes || 0) * Number(item.breakdown?.qtyPerBox || 0)) + Number(item.breakdown?.looseQty || 0);
            const finalQty = calculatedQty > 0 ? calculatedQty : (Number(item.qty) || 0);
        
            if (finalQty <= 0) continue; 
        
            const lineGross = finalQty * Number(item.rate || 0);
            grandTotalGross += lineGross;

            let itemName = "Unknown";
            const baseBatch = item.batch || `DIR-${Date.now()}-${Math.floor(Math.random()*1000)}`;
            const batchesToCreate = [];
        
            // Box + Loose Lot Splitting
            if (item.breakdown?.noOfBoxes > 0) {
                batchesToCreate.push({
                    lotNumber: `${baseBatch}-BOX`,
                    qty: Number(item.breakdown.noOfBoxes) * Number(item.breakdown.qtyPerBox),
                    boxCount: Number(item.breakdown.noOfBoxes),
                    isLoose: false,
                    addedAt: new Date()
                });
            }
            if (item.breakdown?.looseQty > 0) {
                batchesToCreate.push({
                    lotNumber: `${baseBatch}-LOOSE`,
                    qty: Number(item.breakdown.looseQty),
                    isLoose: true,
                    addedAt: new Date()
                });
            }
            if (batchesToCreate.length === 0) {
                batchesToCreate.push({ lotNumber: baseBatch, qty: finalQty, addedAt: new Date() });
            }
        
            // Update Inventory logic
            if (item.itemType === 'Raw Material') {
                const mat = await Material.findById(item.itemId).session(session);
                if (mat) {
                    mat.stock.current += finalQty;
                    if (!mat.stock.batches) mat.stock.batches = [];
                    mat.stock.batches.push(...batchesToCreate);
                    itemName = mat.name;
                    await mat.save({ session });
                }
            } else if (item.itemType === 'Finished Good') {
                const prod = await Product.findById(item.itemId).session(session);
                if (prod) {
                    prod.stock.warehouse += finalQty;
                    if (!prod.stock.batches) prod.stock.batches = [];
                    prod.stock.batches.push(...batchesToCreate);
                    itemName = prod.name;
                    await prod.save({ session });
                }
            }
        
            // Build the item object for the PO array
            calculatedItems.push({
                item_id: item.itemId,
                itemName: itemName,
                itemType: item.itemType,
                orderedQty: finalQty,
                receivedQty: finalQty, // Direct entry is immediately received
                unitPrice: Number(item.rate),
                status: 'Completed',
                history: [{
                    date: new Date(),
                    qty: finalQty,
                    mode: 'direct',
                    receivedBy: 'System (Direct)',
                    lotNumber: baseBatch,
                    status: 'Received',
                    breakdown: item.breakdown
                }]
            });
        }

        // Final Financial Calculations
        const discAmt = grandTotalGross * (Number(discountPercent || 0) / 100);
        const taxable = grandTotalGross - discAmt;
        const finalTotal = taxable + (taxable * (Number(gstPercent || 18) / 100));

        const entry = await PurchaseOrder.create([{
            vendor_id: vendorId,
            items: calculatedItems,
            discountPercent: Number(discountPercent || 0),
            gstPercent: Number(gstPercent || 18),
            totalAmount: finalTotal,
            isDirectEntry: true,
            status: 'Completed'
        }], { session });

        if (vendorId) {
            await Vendor.findByIdAndUpdate(vendorId, { $inc: { balance: finalTotal } }).session(session);
        }

        await session.commitTransaction();
        res.status(201).json({ success: true, msg: "Stock Added via Direct Entry!", entry: entry[0] });
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ msg: error.message });
    } finally {
        session.endSession();
    }
};

// 🟢 Get History
exports.getDirectHistory = async (req, res) => {
    try {
        const history = await PurchaseOrder.find({ isDirectEntry: true })
            .populate('vendor_id', 'name category')
            .sort({ created_at: -1 });
        res.json(history);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

// Trading Exports (Keep existing)
exports.getTradingRequests = async (req, res) => {
    try {
        const requests = await JobCard.find({ type: 'Full-Buy', currentStep: 'Procurement_Pending' }).populate('productId').sort({ createdAt: -1 });
        res.json(requests);
    } catch (error) { res.status(500).json({ msg: error.message }); }
};

exports.createTradingPO = async (req, res) => {
    try {
        const { jobId, vendorId, costPerUnit } = req.body;
        const job = await JobCard.findById(jobId).populate('productId');
        if (!job) return res.status(404).json({ msg: "Request not found" });

        const validItemName = job.productId ? job.productId.name : "Unknown Product";
        const totalAmount = job.totalQty * costPerUnit;

        const po = await PurchaseOrder.create({
            vendor_id: vendorId,
            items: [{
                item_id: job.productId._id, 
                itemName: validItemName, 
                itemType: 'Finished Good',  
                orderedQty: job.totalQty,
                receivedQty: 0,
                unitPrice: costPerUnit,
                status: 'Pending'
            }],
            totalAmount: totalAmount,
            status: 'Pending',
            orderDate: new Date()
        });

        // Job Card updates
        job.currentStep = 'PO_Raised';
        job.status = 'In_Progress';
        job.history.push({ step: 'PO Created', status: 'PO_Raised', timestamp: new Date() });
        await job.save();

        await Vendor.findByIdAndUpdate(vendorId, { $inc: { balance: totalAmount } });

        res.json({ success: true, msg: "Trading PO Created!", po });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};



exports.getAllVendors = async (req, res) => {
    try {
        // 🟢 FIX: You must include 'category' in the second argument string
        const vendors = await Vendor.find({}, 'name category services'); 
        res.json(vendors);
    } catch (error) {
        console.error("Fetch Vendors Error:", error);
        res.status(500).json({ msg: error.message });
    }
};
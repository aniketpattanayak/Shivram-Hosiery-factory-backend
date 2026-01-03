const Material = require('../models/Material');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const PurchaseOrder = require('../models/PurchaseOrder'); 
const JobCard = require('../models/JobCard');
const SurplusLedger = require('../models/SurplusLedger');

// @desc Process Purchase (PO Generation - Standard)
exports.createPurchase = async (req, res) => {
    try {
        const { vendor, itemId, itemType, qty, unitPrice } = req.body;
        const totalAmount = Number(qty) * Number(unitPrice);
        
        let itemName = 'Unknown Item';
        let fetchedItem = null;

        if (itemType === 'Raw Material') {
            fetchedItem = await Material.findById(itemId);
            if (fetchedItem) itemName = fetchedItem.name;
        } 
        else if (itemType === 'Finished Good') {
            fetchedItem = await Product.findById(itemId);
            if (fetchedItem) itemName = fetchedItem.name; 
        }

        if (!fetchedItem) return res.status(404).json({ msg: 'Item not found' });

        const newPO = await PurchaseOrder.create({
            item_id: itemId,
            vendor_id: vendor,
            itemName: itemName, 
            itemType: itemType,
            orderedQty: Number(qty),
            receivedQty: 0,
            unitPrice: Number(unitPrice),
            totalAmount: totalAmount,
            status: 'Pending'
        });

        res.status(201).json({ success: true, msg: `Purchase Order Created.`, order: newPO });

    } catch (error) {
        console.error("PO Error:", error); 
        res.status(500).json({ msg: error.message });
    }
};

// 🟢 NEW: Direct Stock Entry (Updates Stock & Creates Batch)
exports.createDirectEntry = async (req, res) => {
    const session = await require('mongoose').startSession();
    session.startTransaction();
    try {
        const { vendorId, items } = req.body; 
        const createdEntries = [];
        let grandTotal = 0;

        const vendorDoc = await Vendor.findById(vendorId).session(session);
        const vendorName = vendorDoc ? vendorDoc.name : "Unknown Vendor";

        for (const item of items) {
            const lineTotal = Number(item.qty) * Number(item.rate);
            grandTotal += lineTotal;
            let itemName = "Unknown";
            
            // 🟢 ARCHITECT FIX: Generate ID ONCE for both Ledger and Batch
            const finalBatchNumber = item.batch && item.batch.trim() !== "" 
                ? item.batch 
                : `DIR-${Date.now()}-${Math.floor(Math.random()*1000)}`;

            const batchEntry = {
                lotNumber: finalBatchNumber,
                qty: Number(item.qty),
                addedAt: new Date()
            };

            // 🟢 SURPLUS LOGIC (Using synchronized finalBatchNumber)
            const orderedAmount = Number(item.orderedQty) || Number(item.qty); 
            if (Number(item.qty) > orderedAmount) {
                await SurplusLedger.create([{
                    lotNumber: finalBatchNumber, // 🎯 Synchronized
                    vendorName: vendorName,
                    itemId: item.itemId,
                    itemName: item.label || "Item",
                    itemType: item.itemType,
                    orderedQty: orderedAmount,
                    receivedQty: Number(item.qty),
                    surplusAdded: Number(item.qty) - orderedAmount
                }], { session });
            }

            // 🟢 UPDATE INVENTORY (Using synchronized finalBatchNumber)
            if (item.itemType === 'Raw Material') {
                const mat = await Material.findById(item.itemId).session(session);
                if (mat) {
                    mat.stock.current += Number(item.qty);
                    if (!mat.stock.batches) mat.stock.batches = [];
                    mat.stock.batches.push(batchEntry);
                    itemName = mat.name;
                    await mat.save({ session });
                }
            } else if (item.itemType === 'Finished Good') {
                const prod = await Product.findById(item.itemId).session(session);
                if (prod) {
                    prod.stock.warehouse += Number(item.qty);
                    if (!prod.stock) prod.stock = { warehouse: 0, reserved: 0, batches: [] };
                    if (!prod.stock.batches) prod.stock.batches = [];
                    prod.stock.batches.push(batchEntry);
                    itemName = prod.name;
                    await prod.save({ session });
                }
            }

            const entry = await PurchaseOrder.create([{
                item_id: item.itemId,
                vendor_id: vendorId,
                itemName: itemName,
                itemType: item.itemType,
                orderedQty: orderedAmount,
                receivedQty: Number(item.qty),
                unitPrice: Number(item.rate),
                totalAmount: lineTotal,
                isDirectEntry: true,
                status: 'Completed',
                batchNumber: finalBatchNumber // 🎯 Traceable ID
            }], { session });
            
            createdEntries.push(entry[0]);
        }

        if (vendorId) {
            await Vendor.findByIdAndUpdate(vendorId, { $inc: { balance: grandTotal } }).session(session);
        }

        await session.commitTransaction();
        res.status(201).json({ success: true, msg: "Stock Added!", entries: createdEntries });
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

        const po = await PurchaseOrder.create({
            po_id: `PO-TR-${Math.floor(1000 + Math.random() * 9000)}`,
            vendor_id: vendorId,
            item_id: job.productId._id, 
            itemName: validItemName, 
            itemType: 'Finished Good',  
            orderedQty: job.totalQty,
            receivedQty: 0,
            unitCost: costPerUnit,
            totalAmount: job.totalQty * costPerUnit,
            status: 'Pending',
            expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) 
        });

        job.currentStep = 'PO_Raised';
        job.status = 'In_Progress';
        job.history.push({ step: 'PO Created', status: 'PO_Raised', timestamp: new Date() });
        await job.save();

        await Vendor.findByIdAndUpdate(vendorId, { $inc: { balance: (job.totalQty * costPerUnit) } });

        res.json({ success: true, msg: "Purchase Order Created!", po });
    } catch (error) {
        console.error(error);
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
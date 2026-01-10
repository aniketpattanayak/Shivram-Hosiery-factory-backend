const Material = require('../models/Material');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const PurchaseOrder = require('../models/PurchaseOrder'); 
const JobCard = require('../models/JobCard');
const SurplusLedger = require('../models/SurplusLedger');

// @desc Process Purchase (PO Generation - Standard)
exports.createPurchase = async (req, res) => {
    try {
        const { vendor, itemId, itemType, qty, unitPrice, discountPercent, gstPercent } = req.body;
        
        // Calculation Logic
        const gross = Number(qty) * Number(unitPrice);
        const discountAmount = gross * (Number(discountPercent || 0) / 100);
        const taxable = gross - discountAmount;
        const totalAmount = taxable + (taxable * (Number(gstPercent || 0) / 100));
        
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
            discountPercent: Number(discountPercent || 0), // Save original discount
            gstPercent: Number(gstPercent || 0),           // Save original GST
            totalAmount: totalAmount,                      // Final Calculated Total
            status: 'Pending'
        });

        res.status(201).json({ success: true, msg: `Purchase Order Created.`, order: newPO });

    } catch (error) {
        console.error("PO Error:", error); 
        res.status(500).json({ msg: error.message });
    }
};

// 🟢 NEW: Direct Stock Entry (Updates Stock & Creates Batch)
// 🟢 UPDATED: Direct Stock Entry with Box + Loose Lot Management
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
            // 🟢 Robust calculation for Direct Entry row
            const calculatedQty = (Number(item.breakdown?.noOfBoxes || 0) * Number(item.breakdown?.qtyPerBox || 0)) + Number(item.breakdown?.looseQty || 0);
            const finalQty = calculatedQty > 0 ? calculatedQty : (Number(item.qty) || 0);
        
            // 🛑 Skip if invalid to prevent NaN ledger entries
            if (finalQty <= 0) continue; 
        
            const lineTotal = Number(item.totalAmount) || (finalQty * Number(item.rate || 0));
            grandTotal += lineTotal;
            let itemName = "Unknown";
            
            const baseBatch = item.batch && item.batch.trim() !== "" 
                ? item.batch 
                : `DIR-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        
            const batchesToCreate = [];
        
            // 🟢 Box + Loose Lot Splitting
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
        
            // Update Inventory
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
        
            const entry = await PurchaseOrder.create([{
                item_id: item.itemId,
                vendor_id: vendorId,
                itemName: itemName,
                itemType: item.itemType,
                orderedQty: finalQty,
                receivedQty: finalQty,
                unitPrice: Number(item.rate),
                totalAmount: lineTotal,
                isDirectEntry: true,
                status: 'Completed',
                batchNumber: baseBatch,
                breakdown: item.breakdown
            }], { session });
            
            createdEntries.push(entry[0]);
        }

        // Update Vendor Balance
        if (vendorId) {
            await Vendor.findByIdAndUpdate(vendorId, { $inc: { balance: grandTotal } }).session(session);
        }

        await session.commitTransaction();
        res.status(201).json({ success: true, msg: "Stock Added with Box/Loose breakdown!", entries: createdEntries });
    } catch (error) {
        await session.abortTransaction();
        console.error("Direct Entry Error:", error);
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
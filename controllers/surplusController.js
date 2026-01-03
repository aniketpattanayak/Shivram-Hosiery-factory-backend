const SurplusLedger = require('../models/SurplusLedger');
const Material = require('../models/Material');
const Product = require('../models/Product');
const mongoose = require('mongoose');

exports.getSurplusReport = async (req, res) => {
    try {
        const surplusEntries = await SurplusLedger.find().sort({ receivedAt: -1 });
        const detailedReport = [];

        for (const entry of surplusEntries) {
            let currentLotQty = 0;
            let found = false;

            const searchId = new mongoose.Types.ObjectId(entry.itemId);

            // 🟢 BUG FIX: Specific logic for Raw Material batches
            if (entry.itemType === 'Raw Material') {
                const mat = await Material.findById(searchId);
                // In Material.js, stock is under 'stock' object
                if (mat && mat.stock && mat.stock.batches) {
                    const batch = mat.stock.batches.find(b => b.lotNumber === entry.lotNumber);
                    if (batch) {
                        currentLotQty = batch.qty;
                        found = true;
                    }
                }
            } 
            // 🟢 BUG FIX: Specific logic for Finished Good batches
            else if (entry.itemType === 'Finished Good') {
                const prod = await Product.findById(searchId);
                // In Product.js, stock is also under 'stock' object
                if (prod && prod.stock && prod.stock.batches) {
                    const batch = prod.stock.batches.find(b => b.lotNumber === entry.lotNumber);
                    if (batch) {
                        currentLotQty = batch.qty;
                        found = true;
                    }
                }
            }

            // Logic B: Surplus stays at max until main stock is gone
            let remainingSurplus = 0;
            if (found) {
                remainingSurplus = Math.min(entry.surplusAdded, currentLotQty);
            }

            detailedReport.push({
                _id: entry._id,
                lotNumber: entry.lotNumber,
                vendorName: entry.vendorName,
                itemName: entry.itemName,
                itemType: entry.itemType,
                orderedQty: entry.orderedQty,
                receivedQty: entry.receivedQty,
                originalSurplus: entry.surplusAdded,
                currentTotalInLot: currentLotQty, 
                remainingSurplus: remainingSurplus,
                receivedAt: entry.receivedAt
            });
        }

        res.json(detailedReport);
    } catch (error) {
        console.error("Surplus Report Error:", error);
        res.status(500).json({ msg: error.message });
    }
};
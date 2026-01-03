const express = require('express');
const router = express.Router();
const surplusController = require('../controllers/surplusController');

// Route to get the calculated surplus report
router.get('/report', surplusController.getSurplusReport);
// 🟢 EMERGENCY PATCH: Link orphaned Surplus entries to Inventory Batches
router.get('/patch-ids', async (req, res) => {
    try {
        const orphaned = await SurplusLedger.find();
        let fixedCount = 0;

        for (const entry of orphaned) {
            let actualBatch = null;
            if (entry.itemType === 'Raw Material') {
                const mat = await Material.findById(entry.itemId);
                actualBatch = mat?.stock?.batches?.[mat.stock.batches.length - 1];
            } else {
                const prod = await Product.findById(entry.itemId);
                actualBatch = prod?.stock?.batches?.[prod.stock.batches.length - 1];
            }

            if (actualBatch && entry.lotNumber !== actualBatch.lotNumber) {
                entry.lotNumber = actualBatch.lotNumber; // Sync the IDs
                await entry.save();
                fixedCount++;
            }
        }
        res.json({ msg: `Successfully repaired ${fixedCount} entries.` });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
});

module.exports = router;
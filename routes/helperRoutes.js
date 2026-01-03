const express = require('express');
const router = express.Router();
const Material = require('../models/Material'); // Ensure path is correct
const Vendor = require('../models/Vendor');     // Ensure path is correct

// @route   GET /api/inventory/materials
// @desc    Get simple list of materials for dropdowns
router.get('/materials', async (req, res) => {
    try {
        const materials = await Material.find().select('name unit stock');
        res.json(materials);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

// @route   GET /api/procurement/vendors
// @desc    Get simple list of vendors for dropdowns
// backend/routes/helperRoute.js

// backend/routes/helperRoute.js

// @route   GET /api/procurement/vendors
router.get('/vendors', async (req, res) => {
    try {
        // 🟢 FIX: Select 'category' to match your "Add New Vendor" modal
        const vendors = await Vendor.find().select('name category services');
        res.json(vendors);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});


module.exports = router;
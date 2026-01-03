const express = require('express');
const router = express.Router();
// 🟢 Note: Ensure the controller filename matches (reportController.js)
const controller = require('../controllers/reportsController');

router.get('/sales', controller.getSalesReport);
router.get('/production', controller.getProductionReport);
router.get('/inventory', controller.getInventoryReport);

// 🟢 ADDED: Route for Phase 5 Accountability Report
router.get('/vendor-efficiency', controller.getVendorEfficiency);

module.exports = router;
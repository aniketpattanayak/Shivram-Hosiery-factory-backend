const express = require('express');
const router = express.Router();
const dispatchController = require('../controllers/dispatchController');
const { protect } = require('../middleware/auth');

// 🟢 GET Routes for the Tabs
router.get('/pending', protect, dispatchController.getDispatchOrders);
router.get('/history', protect, dispatchController.getDispatchHistory);

// 🔵 POST Route for Dispatching
router.post('/dispatch', protect, dispatchController.shipOrder);

module.exports = router;
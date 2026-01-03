const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
// Import your auth middleware if you have one
// const { protect } = require('../middleware/authMiddleware'); 

// This matches the frontend call: api.get("/analytics/factory-intelligence")
router.get('/factory-intelligence', analyticsController.getFactoryIntelligence);

module.exports = router;
const express = require('express');
const router = express.Router();
const procurementController = require('../controllers/procurementController');
const purchaseController = require('../controllers/purchaseController'); 
const { protect, admin } = require('../middleware/auth');
const shopFloorController = require('../controllers/jobCardController');

router.post('/dispatch-job', protect, shopFloorController.dispatchJob);
router.post('/receive-handshake', protect, shopFloorController.receiveHandshake);

// --- Standard Purchase & Direct Entry ---
router.post('/purchase', procurementController.createPurchase);
router.post('/direct-entry', procurementController.createDirectEntry);
router.get('/direct-entry', procurementController.getDirectHistory);
// backend/routes/procurementRoutes.js
// Add this line below your receive-handshake route
router.post('/update-stage', protect, shopFloorController.updateJobStage);

// 🟢 NEW: Route to fetch vendors for the Production Split Strategy Modal
// This connects the frontend StrategyModal to the backend list of vendors
router.get('/vendors', procurementController.getAllVendors); 

// --- Receipt & QC Logic ---
router.get('/open-orders', purchaseController.getOpenOrders); 
router.post('/purchase', protect, procurementController.createPurchase);
// NEW: Add this line here to connect the Admin Page!
router.get('/qc-review-list', purchaseController.getQCReviewList); 

router.get('/received-history', purchaseController.getCompletedHistory);
router.put('/receive/:id', purchaseController.receiveOrder); 

// --- Trading Logic ---
router.get('/trading', procurementController.getTradingRequests);
router.post('/create-trading-po', procurementController.createTradingPO);

// NEW: Add this line to fix the 404 on button click
router.post('/qc-decision', purchaseController.processQCDecision);

module.exports = router;
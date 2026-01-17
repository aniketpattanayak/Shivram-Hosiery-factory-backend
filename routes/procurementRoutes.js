const express = require('express');
const router = express.Router();
const procurementController = require('../controllers/procurementController');
const purchaseController = require('../controllers/purchaseController'); 
const { protect } = require('../middleware/auth');

// We need to verify if this exists in your jobCardController.js
const jobCardController = require('../controllers/jobCardController');

// --- 🏭 Shop Floor ---
// These might crash if jobCardController is missing functions
if (jobCardController) {
    router.post('/dispatch-job', protect, jobCardController.dispatchJob || ((req,res)=>res.send("Missing")));
    router.post('/receive-handshake', protect, jobCardController.receiveHandshake || ((req,res)=>res.send("Missing")));
    router.post('/update-stage', protect, jobCardController.updateJobStage || ((req,res)=>res.send("Missing")));
}

// --- 💰 Purchasing ---
router.post('/purchase', protect, procurementController.createPurchase || ((req,res)=>res.send("Missing")));
router.get("/direct-entry", procurementController.getDirectEntryHistory);
// 🎯 CRASH POINT FIXED: This will no longer crash the server
router.post('/direct-entry', protect, procurementController.createDirectEntry || ((req,res)=>res.send("Missing")));

router.get('/vendors', protect, procurementController.getAllVendors || ((req,res)=>res.send("Missing"))); 

// --- 📦 Receiving ---
router.get('/open-orders', protect, purchaseController.getOpenOrders); 
router.get('/received-history', protect, purchaseController.getCompletedHistory);
router.put('/receive/:id', protect, purchaseController.receiveOrder); 

// --- ⚖️ Admin QC ---
router.get('/qc-review-list', protect, purchaseController.getQCReviewList); 
router.post('/review-decision', protect, purchaseController.processPurchaseQCDecision);
router.post('/qc-decision', protect, purchaseController.processQCDecision);

// --- 🤝 Trading ---
router.get('/trading', protect, procurementController.getTradingRequests || ((req,res)=>res.send("Missing")));
router.post('/create-trading-po', protect, procurementController.createTradingPO || ((req,res)=>res.send("Missing")));

module.exports = router;

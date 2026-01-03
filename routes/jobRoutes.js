// backend/routes/jobRoutes.js
const express = require('express');
const router = express.Router();
const jobCardController = require('../controllers/jobCardController');
const { protect } = require('../middleware/auth'); 


// 1. Get Active Shop Floor Jobs
// 🟢 FIX: Added 'protect' so req.user is available in the controller
router.get('/', protect, jobCardController.getJobCards); 
router.post('/receive-v2', protect, jobCardController.receiveProcessV2);

// 2. Get Jobs Ready for QC
router.get('/qc', protect, jobCardController.getQCJobs);

// 3. Actions
router.post('/issue', protect, jobCardController.issueMaterial);
router.post('/receive', protect, jobCardController.receiveProcess); 

module.exports = router;
const express = require('express');
const router = express.Router();

// 1. Import Middleware (To verify Rakesh is logged in)
const { protect } = require('../middleware/auth');

// 2. Import Controllers
const { getVendors, createVendor, deleteVendor } = require('../controllers/vendorController');
const jobCardController = require('../controllers/jobCardController');

// --- ADMIN ROUTES (Managing Vendor Profiles) ---
router.get('/', protect, getVendors);
router.post('/', protect, createVendor);
router.delete('/:id', protect, deleteVendor);

// --- VENDOR PORTAL ROUTES (Rakesh's Actions) ---
// Phase 1: Vendor sees their assigned jobs
router.get('/my-jobs', protect, jobCardController.getVendorJobs);

// 🟢 NEW: Vendor updates progress (e.g., Cutting_Completed, Stitching_Completed)
// This enables the "Mark Cutting Done" buttons to update the database
router.post('/update-stage', protect, jobCardController.updateJobStage);

// Phase 3: Vendor reports final production qty and wastage
router.post('/dispatch', protect, jobCardController.dispatchJob);

module.exports = router;
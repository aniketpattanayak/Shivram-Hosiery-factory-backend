const express = require('express');
const router = express.Router();
const controller = require('../controllers/qualityController');
const auth = require('../middleware/auth'); // Ensure auth is here

router.get('/pending', controller.getPendingQC);
router.post('/submit', auth, controller.submitQC); // Worker Route

// 🟢 NEW ADMIN ROUTES
router.get('/held', auth, controller.getHeldQC);
router.post('/review', auth, controller.reviewQC);

module.exports = router;
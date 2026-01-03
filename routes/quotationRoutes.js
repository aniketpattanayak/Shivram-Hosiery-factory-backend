const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // 🟢 CRITICAL: Import Auth

const { createQuotation, getQuotations, getSingleQuotation } = require('../controllers/quotationController');

// 🟢 All routes now protected by 'auth'
router.post('/', auth, createQuotation);
router.get('/', auth, getQuotations);
router.get('/:id', auth, getSingleQuotation);

module.exports = router;
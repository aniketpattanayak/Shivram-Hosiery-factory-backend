const express = require('express');
const router = express.Router();
const upload = require('../utils/s3Config'); // 🟢 Ensure path is correct
const { createExpense, getExpenses, updateExpenseStatus } = require('../controllers/expenseController');

// 🟢 ARCHITECT FIX: upload.single('receipt') MUST be the second argument
// This parses the FormData and populates req.body BEFORE createExpense runs
router.post('/', upload.array('receipts', 5), createExpense);

router.get('/', getExpenses);
router.put('/:id/status', updateExpenseStatus);


module.exports = router;
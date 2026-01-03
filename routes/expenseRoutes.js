const express = require('express');
const router = express.Router();
const { createExpense, getExpenses, updateExpenseStatus } = require('../controllers/expenseController');

router.post('/', createExpense);
router.get('/', getExpenses);
router.put('/:id/status', updateExpenseStatus);

module.exports = router;
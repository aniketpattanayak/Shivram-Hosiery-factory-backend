const Expense = require('../models/Expense');

// @desc    Log New Expense(s) - Supports Single or Batch
// @route   POST /api/sales/expenses
exports.createExpense = async (req, res) => {
  try {
    const body = req.body;
    
    // 1. Normalize Data: Ensure we are working with an Array
    // If frontend sends { ... }, make it [{ ... }]
    // If frontend sends [{ ... }, { ... }], keep it as is.
    const items = Array.isArray(body) ? body : [body];

    if (items.length === 0) {
        return res.status(400).json({ msg: "No expense data provided" });
    }

    // 2. Get Starting Count for ID Generation
    let currentCount = await Expense.countDocuments();

    // 3. Prepare Batch Data with IDs
    const expensesToSave = items.map(item => {
        currentCount++; // Increment for unique IDs
        const expenseId = `EXP-${String(currentCount).padStart(4, '0')}`;
        
        return {
            expenseId,
            salesPerson: item.salesPerson,
            date: item.date,
            category: item.category,
            amount: Number(item.amount),
            description: item.description,
            status: 'Pending' // Default
        };
    });

    // 4. Bulk Insert (One DB Call)
    const result = await Expense.insertMany(expensesToSave);

    res.status(201).json({ 
        success: true, 
        msg: `Successfully logged ${result.length} expense(s).`, 
        data: result 
    });

  } catch (error) {
    console.error("Expense Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

// ... (Keep getExpenses and updateExpenseStatus exactly as they were) ...
exports.getExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find().sort({ createdAt: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

exports.updateExpenseStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ msg: "Expense not found" });

    expense.status = status;
    if (status === 'Rejected') expense.rejectionReason = reason || 'No reason provided';
    
    await expense.save();
    res.json(expense);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
const Expense = require('../models/Expense');

// @desc    Log New Expense(s) - Supports Single or Batch with AWS S3 Receipt
// @route   POST /api/sales/expenses
// @desc    Log New Expense(s) with Receipt Upload support
// @route   POST /api/sales/expenses
// @desc    Log New Expense(s) with Receipt Upload support
// @route   POST /api/sales/expenses
// @desc    Log New Expense(s) with Optional Multi-Receipt Upload support
// @route   POST /api/sales/expenses
exports.createExpense = async (req, res) => {
  try {
    // 1. Safety check for req.body
    if (!req.body) {
        return res.status(400).json({ msg: "Backend received an empty request body. Check Multer setup." });
    }

    let items;
    // 2. Handle the stringified 'body' from FormData (Next.js sends this as a string)
    if (req.body.body) {
        try {
            items = JSON.parse(req.body.body);
        } catch (e) {
            return res.status(400).json({ msg: "Invalid JSON format in expense body." });
        }
    } else {
        // Fallback for standard JSON (non-image) requests
        items = Array.isArray(req.body) ? req.body : [req.body];
    }

    // 🟢 ARCHITECT FIX: Support Multiple Optional Uploads
    // Extract all S3 URLs from req.files (plural). If none, defaults to empty array [].
    const receiptUrls = req.files ? req.files.map(file => file.location) : [];

    // 3. Check if we actually have items to save
    if (!items || items.length === 0 || (items.length === 1 && !items[0].amount)) {
        return res.status(400).json({ msg: "No valid expense data found." });
    }

    // 4. Get Starting Count for ID Generation
    let currentCount = await Expense.countDocuments();

    // 5. Map items to Schema with Sequential IDs and Cloud Links
    const expensesToSave = items.map(item => {
        currentCount++; 
        const expenseId = `EXP-${String(currentCount).padStart(4, '0')}`;
        
        return {
            expenseId,
            salesPerson: item.salesPerson || "Unknown",
            date: item.date || new Date(),
            category: item.category || "Other",
            amount: Number(item.amount) || 0,
            description: item.description || "",
            // 🟢 ARCHITECT FIX: Save the array of links (works even if empty)
            receiptUrls: receiptUrls, 
            status: 'Pending'
        };
    });

    // 6. Bulk Insert
    const result = await Expense.insertMany(expensesToSave);

    res.status(201).json({ 
        success: true, 
        msg: `Successfully logged ${result.length} expense(s).`, 
        data: result 
    });

  } catch (error) {
    console.error("CRITICAL EXPENSE ERROR:", error);
    res.status(500).json({ msg: "Failed to process expense: " + error.message });
  }
};

// @desc    Get All Expenses
// @route   GET /api/sales/expenses
exports.getExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find().sort({ createdAt: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Update Expense Status (Approve/Reject)
// @route   PUT /api/sales/expenses/:id/status
exports.updateExpenseStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ msg: "Expense not found" });

    expense.status = status;
    if (status === 'Rejected') {
        expense.rejectionReason = reason || 'No reason provided';
    }
    
    await expense.save();
    res.json(expense);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
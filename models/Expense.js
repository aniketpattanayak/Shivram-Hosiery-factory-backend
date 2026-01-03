const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  expenseId: { type: String, unique: true }, // e.g. EXP-001
  salesPerson: { type: String, required: true },
  
  date: { type: Date, required: true },
  category: { 
    type: String, 
    enum: ['Travel', 'Food', 'Lodging', 'Fuel', 'Other'],
    required: true 
  },
  amount: { type: Number, required: true },
  description: { type: String }, // e.g., "Lunch with Client X"
  
  status: { 
    type: String, 
    enum: ['Pending', 'Approved', 'Rejected'], 
    default: 'Pending' 
  },
  rejectionReason: { type: String } // Only if rejected

}, { timestamps: true });

module.exports = mongoose.model('Expense', ExpenseSchema);
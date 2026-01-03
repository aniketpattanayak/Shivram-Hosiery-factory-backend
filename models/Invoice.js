const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
  invoiceId: { type: String, required: true, unique: true }, // e.g., INV-2025-001
  
  // Link to the original Order
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  
  customerName: { type: String, required: true },
  
  // We snapshot items here (in case product prices change later)
  items: [
    {
      productName: String,
      qty: Number,
      unitPrice: Number,
      lineTotal: Number
    }
  ],
  
  // Financials
  subTotal: Number,
  taxRate: { type: Number, default: 18 }, // e.g., 18% GST/VAT
  taxAmount: Number,
  grandTotal: Number,
  
  status: { 
    type: String, 
    enum: ['Unpaid', 'Paid', 'Overdue', 'Cancelled'], 
    default: 'Unpaid' 
  },
  
  dueDate: Date,
  paidAt: Date

}, { timestamps: true });

module.exports = mongoose.model('Invoice', InvoiceSchema);
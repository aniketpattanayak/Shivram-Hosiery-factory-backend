const mongoose = require('mongoose');

const QuotationSchema = new mongoose.Schema({
  quoteId: { type: String, unique: true }, // e.g. QTN-2025-001
  
  // Client Snapshot (Saved at time of quote)
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  clientName: { type: String, required: true },
  clientAddress: { type: String },
  clientGst: { type: String },
  
  // Sales Info
  salesPerson: { type: String, required: true },
  subject: { type: String }, // e.g., "Quote for 500kg Wire"
  validUntil: { type: Date },

  // Items
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    description: String,
    qty: { type: Number, required: true },
    rate: { type: Number, required: true },
    gstPercent: { type: Number, default: 18 },
    amount: { type: Number } // qty * rate
  }],

  // Financials
  subTotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },

  // Commercial Terms
  terms: {
    delivery: String,
    payment: String,
    validity: String
  },

  status: { 
    type: String, 
    enum: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Converted'], 
    default: 'Draft' 
  }
}, { timestamps: true });

module.exports = mongoose.model('Quotation', QuotationSchema);
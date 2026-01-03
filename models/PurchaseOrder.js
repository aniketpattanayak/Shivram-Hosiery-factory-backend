const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
  item_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    refPath: 'itemTypeModel' 
  },
  vendor_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Vendor', 
    required: true 
  },
  itemName: String, 
  itemType: {
    type: String,
    enum: ['Raw Material', 'Finished Good'],
    required: true
  },
  
  // Financials
  orderedQty: { type: Number, required: true },
  receivedQty: { type: Number, default: 0 }, 
  unitPrice: { type: Number, default: 0 },    
  totalAmount: { type: Number, default: 0 },   
  isDirectEntry: { type: Boolean, default: false },

  // QC Fields (Last Status)
  qcStatus: { type: String, enum: ['Not Checked', 'Passed', 'Failed'], default: 'Not Checked' },
  qcBy: String,
  qcSampleQty: Number,
  qcRejectedQty: Number,
  qcReason: String,

  // 🟢 NEW: History Log (Tracks every receive action)
  history: [{
    date: { type: Date, default: Date.now },
    qty: Number,
    rejected: { type: Number, default: 0 }, // ✅ ADDED THIS
    mode: String, // 'direct' or 'qc'
    receivedBy: String,
    lotNumber: String,
    status: String // 'Passed', 'Failed', 'Received'
  }],

  status: { 
    type: String, 
    enum: ['Pending', 'Partial', 'Completed', 'QC_Review', 'Rejected'], // Added 'Rejected' for safety
    default: 'Pending' 
  },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
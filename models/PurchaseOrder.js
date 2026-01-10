const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
  item_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    // Note: ensure your controller sets 'itemTypeModel' if using dynamic refs
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

  // QC Fields (Last Status summary)
  qcStatus: { type: String, enum: ['Not Checked', 'Passed', 'Failed'], default: 'Not Checked' },
  qcBy: String,
  qcSampleQty: Number,
  qcRejectedQty: Number,
  qcReason: String,

  // 🟢 UPDATED: History Log (Detailed audit for every receipt)
  history: [{
    date: { type: Date, default: Date.now },
    qty: { type: Number, required: true }, // Total calculated qty
    rejected: { type: Number, default: 0 },
    mode: String, // 'direct' or 'qc'
    receivedBy: String,
    lotNumber: String,
    status: String, // 'Passed', 'Failed', 'Received'
    discountPercent: { type: Number, default: 0 }, // 🟢 User can change during receipt
    gstPercent: { type: Number, default: 0 },
    
    // 🎯 NEW: Storage for the Box + Loose breakdown
    breakdown: {
      noOfBoxes: { type: Number, default: 0 },
      qtyPerBox: { type: Number, default: 0 },
      looseQty: { type: Number, default: 0 }
    }
  }],

  status: { 
    type: String, 
    enum: ['Pending', 'Partial', 'Completed', 'QC_Review', 'Rejected'],
    default: 'Pending' 
  },
  created_at: { type: Date, default: Date.now }
}, { timestamps: true }); // Added timestamps for better record tracking

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
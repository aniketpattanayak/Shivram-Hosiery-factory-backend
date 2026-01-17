const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
  vendor_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Vendor', 
    required: true 
  },
  
  // 🟢 Array to support multiple products in one PO
  items: [{
    item_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      required: true 
    },
    itemName: String, 
    itemType: {
      type: String,
      enum: ['Raw Material', 'Finished Good'],
      required: true
    },
    orderedQty: { type: Number, required: true },
    receivedQty: { type: Number, default: 0 }, 
    unitPrice: { type: Number, default: 0 },    
    
    // QC Fields (Per Item summary)
    qcStatus: { 
      type: String, 
      enum: ['Not Checked', 'Passed', 'Failed'], 
      default: 'Not Checked' 
    },
    qcBy: String,
    qcSampleQty: Number,
    qcRejectedQty: Number,
    qcReason: String,

    // 🟢 History Log nested inside items
    history: [{
      // 🎯 UPDATED: Date is now required but defaults to now if not sent
      date: { type: Date, default: Date.now }, 
      
      // 🎯 NEW: Manual Bill/Invoice Number storage
      billNumber: { type: String, default: "N/A" }, 
      
      qty: { type: Number, required: true }, 
      rejected: { type: Number, default: 0 },
      mode: String, // 'direct' or 'qc'
      receivedBy: String,
      lotNumber: String,
      status: String, // 'Passed', 'Failed', 'Received'
      
      // Breakdown storage
      breakdown: {
        noOfBoxes: { type: Number, default: 0 },
        qtyPerBox: { type: Number, default: 0 },
        looseQty: { type: Number, default: 0 }
      },
      
      // 🎯 NEW: Specific line-item total value for financial history
      totalBatchValue: { type: Number, default: 0 }
    }],
    
    status: { 
      type: String, 
      // 🟢 FIX: Included all possible item-level workflow states
      enum: ['Pending', 'Partial', 'Completed', 'Rejected', 'QC_Review'], 
      default: 'Pending' 
    }
  }],

  // Global Financials
  discountPercent: { type: Number, default: 0 },
  gstPercent: { type: Number, default: 18 },
  totalAmount: { type: Number, default: 0 },   
  isDirectEntry: { type: Boolean, default: false },
  
  // 🎯 NEW: Global Remarks/Instructions field
  remarks: { type: String, default: "" },

  // Global PO Status
  status: { 
    type: String, 
    enum: ['Pending', 'Partial', 'Completed', 'QC_Review', 'Rejected'],
    default: 'Pending' 
  },
  
  // 🎯 Keep created_at for legacy and use timestamps for modern auditing
  created_at: { type: Date, default: Date.now }
}, { 
  timestamps: true // Automatically manages createdAt and updatedAt
});

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
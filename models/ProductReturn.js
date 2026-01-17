const mongoose = require('mongoose');

const ProductReturnSchema = new mongoose.Schema({
  returnId: { 
    type: String, 
    required: true, 
    unique: true,
    default: () => `RMA-${Date.now().toString().slice(-6)}` 
  },
  
  // 🟢 CHANGE: Make this NOT required for Direct Returns
  orderObjectId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Order', 
    required: false 
  },
  
  // orderId can be a manual string like "DIR-RET-1234"
  orderId: { type: String, required: true }, 
  customerName: { type: String, required: true },
  
  items: [{
    productId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Product', 
      required: true 
    },
    productName: { type: String },
    sku: { type: String },
    returnQty: { type: Number, required: true, min: 0 },
    reason: { type: String, default: "Direct Return" }, 
    condition: { 
      type: String, 
      enum: ['Good', 'Damaged', 'Defective'], 
      default: 'Good' 
    }
  }],

  qcStatus: { 
    type: String, 
    enum: ['QC_PENDING', 'APPROVED', 'REJECTED'], 
    default: 'QC_PENDING' 
  },
  
  adminNotes: { type: String },
  addedToInventory: { type: Boolean, default: false },
  generatedLotNumber: { type: String }, 
  
  processedBy: { type: String }, 
  processedAt: { type: Date }

}, { timestamps: true });

module.exports = mongoose.model('ProductReturn', ProductReturnSchema);
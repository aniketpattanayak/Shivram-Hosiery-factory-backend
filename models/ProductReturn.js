const mongoose = require('mongoose');

const ProductReturnSchema = new mongoose.Schema({
  returnId: { 
    type: String, 
    required: true, 
    unique: true,
    default: () => `RMA-${Date.now().toString().slice(-6)}` // Generates a unique RMA ID
  },
  
  // Link to existing Order
  orderObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  orderId: { type: String, required: true }, // For quick display
  
  customerName: { type: String, required: true },
  
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: String,
    sku: String,
    returnQty: { type: Number, required: true },
    reason: { type: String, required: true },
    condition: { type: String, enum: ['Good', 'Damaged', 'Defective'], default: 'Good' }
  }],

  // Workflow Tracking
  qcStatus: { 
    type: String, 
    enum: ['QC_PENDING', 'APPROVED', 'REJECTED'], 
    default: 'QC_PENDING' 
  },
  
  adminNotes: String,
  
  // Storage logic after approval
  addedToInventory: { type: Boolean, default: false },
  generatedLotNumber: String, // e.g., RMA-RET-1234
  
  processedBy: { type: String }, // Name of the Admin/User who approved
  processedAt: Date

}, { timestamps: true });

module.exports = mongoose.model('ProductReturn', ProductReturnSchema);
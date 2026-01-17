const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  
  customerName: { type: String, required: true }, // Can be existing Client or New Name
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' }, // Optional (Null if new customer)
  
  // 🟢 NEW: Advance Payment Fields
  advanceReceived: { type: Boolean, default: false },
  advanceAmount: { type: Number, default: 0 },
  remarks: { type: String, default: "" },
  items: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      productName: String,
      qtyOrdered: Number,
      qtyAllocated: Number,
      qtyToProduce: Number,
      
      // 🟢 NEW: Item-specific Promise Date
      promiseDate: Date,

      // Financial Fields
      unitPrice: { type: Number, default: 0 },
      itemTotal: { type: Number, default: 0 } 
    }
  ],

  billToAddress: String,
  shippingAddress: String,
  contactPerson: String,
  billingContact: String,
  paymentTerms: { type: String, default: '30 Days' },
  // Order Total
  grandTotal: { type: Number, default: 0 },

  // Global Delivery Date (Target)
  deliveryDate: Date,
  priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  
  status: { 
    type: String, 
    enum: ['Pending', 'Production_Queued', 'Ready_Dispatch', 'Dispatched', 'Partially_Dispatched'], 
    default: 'Pending' 
  },

  dispatchDetails: {
      vehicleNo: String,
      trackingId: String,
      driverName: String,
      driverPhone: String,
      packagingNote: String, 
      dispatchedAt: Date
  }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);
const mongoose = require('mongoose');

const ProductionPlanSchema = new mongoose.Schema({
  planId: { type: String, required: true, unique: true }, 
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  
  totalQtyToMake: { type: Number, required: true },
  
  // 🟢 PROGRESS TRACKING
  plannedQty: { type: Number, default: 0 }, 
  linkedJobIds: [{ type: String }], // e.g. ["JC-IN-101", "JC-IN-102"]

  // 🟢 TRACKING DISPATCH VS PRODUCTION
  dispatchedQty: { type: Number, default: 0 },

  status: { 
    type: String, 
    enum: [
      'Pending Strategy', 
      'Partially Planned', 
      'Scheduled', 
      'In Progress', 
      'Completed', 
      'Fulfilled_By_Stock'
    ], 
    default: 'Pending Strategy' 
  },

  splits: [
    {
      _id: false,
      qty: { type: Number, required: true },
      mode: { type: String, enum: ['Manufacturing', 'Full-Buy'], required: true }, 
      vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
      cost: { type: Number, default: 0 },
      routing: {
        cutting: { type: { type: String, enum: ['In-House', 'Job Work'], default: 'In-House' }, vendorName: { type: String, default: '' } },
        stitching: { type: { type: String, enum: ['In-House', 'Job Work'], default: 'In-House' }, vendorName: { type: String, default: '' } },
        packing: { type: { type: String, enum: ['In-House', 'Job Work'], default: 'In-House' }, vendorName: { type: String, default: '' } }
      },
      // Track when this specific split was created
      createdAt: { type: Date, default: Date.now }
    }
  ],

  batchNumber: String,
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ProductionPlan', ProductionPlanSchema);
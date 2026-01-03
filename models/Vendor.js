const mongoose = require('mongoose');

const VendorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  
  // What kind of vendor is this?
  category: { 
    type: String, 
    enum: ['Material Supplier', 'Job Worker', 'Full Service Factory', 'Trading'], 
    required: true 
  },

  // If Job Worker, what processes do they handle?
  services: [{
    type: String,
    enum: ['Cutting', 'Stitching', 'Finishing', 'Packaging', 'Full CMT']
  }],

  // Basic Info
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' }, // 🟢 Added Email
  gst: { type: String, default: '' },
  address: { type: String, default: '' },
  
  balance: { type: Number, default: 0 } 
}, { timestamps: true });

module.exports = mongoose.model('Vendor', VendorSchema);
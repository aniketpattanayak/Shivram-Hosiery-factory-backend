const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  leadId: { type: String, unique: true }, // Auto-generated LD-001
  clientName: { type: String, required: true },
  contactPerson: { type: String },
  phone: { type: String, required: true },
  location: { type: String },
  
  // Product Interest
  productCategory: { type: String },
  selectedItem: { type: String },
  expectedQuantity: { type: String },
  
  // Sales Info
  salesPerson: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['New', 'Attempted', 'Connected', 'Interested', 'Quotation Sent', 'Negotiation', 'Won', 'Lost'],
    default: 'New' 
  },
  
  // The Activity Timeline
  activityLog: [{
    date: { type: Date, default: Date.now },
    status: String,
    remarks: String,
    updatedBy: String
  }]
}, { timestamps: true });

module.exports = mongoose.model('Lead', LeadSchema);
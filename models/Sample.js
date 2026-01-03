const mongoose = require('mongoose');

const SampleSchema = new mongoose.Schema({
  sampleId: { type: String, required: true, unique: true }, 
  name: { type: String, required: true },
  type: { type: String, enum: ['New Design', 'Existing Product'], required: true },
  
  // Link for Existing
  originalProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  
  // --- NEW FIELDS ---
  category: { type: String },       // e.g. Men, Women, Kids
  subCategory: { type: String },    // e.g. Shirt, Pant, Dress
  fabricType: { type: String },     // e.g. Cotton 60s, Denim, Silk
  color: { type: String },          // e.g. Navy Blue, Red
  sku: { type: String },            // Optional manual SKU for samples
  
  // 🟢 UPDATED: Keeping single remarks for compatibility, but added activityLog for history
  remarks: { type: String, default: "" },
  activityLog: [
    {
      status: String,
      remarks: String,
      updatedBy: String,
      date: { type: Date, default: Date.now }
    }
  ],
  // ------------------

  client: { type: String, default: 'Internal' },
  description: { type: String },
  
  bom: [{
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    qtyRequired: { type: Number, required: true }, 
    lotNumber: { type: String, default: "" }, // 🟢 NEW: Store Lot Number here during issue
    notes: String
  }],
  
  status: { 
    type: String, 
    enum: ['Design', 'Pattern', 'Cutting', 'Stitching', 'Packaging', 'Finishing', 'Review', 'Approved'], 
  default: 'Design'
  },
  
  materialsIssued: { type: Boolean, default: false },
  approvalStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  convertedProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }

}, { timestamps: true });

module.exports = mongoose.model('Sample', SampleSchema);
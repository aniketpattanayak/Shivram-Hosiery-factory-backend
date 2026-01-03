const mongoose = require('mongoose');

const QualityReportSchema = new mongoose.Schema({
  batchId: { type: String, required: true }, // e.g., "PROD-2024-001"
  stage: { type: String, required: true }, // e.g., "Sewing", "Finishing"
  
  // 🟢 NEW: Production Data
  totalQuantity: { type: Number, required: true }, // e.g., 100
  
  // 🟢 NEW: Inspection Data
  sampleSize: { type: Number, required: true }, // e.g., 10
  rejectedQuantity: { type: Number, required: true, default: 0 }, // e.g., 2
  acceptedQuantity: { type: Number, required: true }, // e.g., 98 (Auto-calculated)
  
  defectRate: { type: Number }, // e.g., 20% (For analytics only)

  // 🟢 NEW: Who did it?
  inspectorName: { type: String, required: true }, // "Lalit Raj"
  inspectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  status: { 
    type: String, 
    enum: ['Passed', 'Failed', 'Rectified'], // Rectified = Some bad, mostly good
    default: 'Passed' 
  },
  
  comments: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('QualityReport', QualityReportSchema);
const mongoose = require('mongoose');

const AttributeSchema = new mongoose.Schema({
  type: { 
    type: String, 
    required: true, 
    // 🟢 UPDATE: Add 'materialType' and 'unit' to this list
    enum: ['fabric', 'color', 'materialType', 'unit'] 
  },
  value: { type: String, required: true }
});

// Ensure no duplicate values for the same type
AttributeSchema.index({ type: 1, value: 1 }, { unique: true });

module.exports = mongoose.model('Attribute', AttributeSchema);
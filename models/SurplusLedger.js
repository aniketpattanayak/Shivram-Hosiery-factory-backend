const mongoose = require('mongoose');

const SurplusLedgerSchema = new mongoose.Schema({
  lotNumber: { type: String, required: true, unique: true },
  vendorName: String,
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  itemName: String,
  itemType: { type: String, enum: ['Raw Material', 'Finished Good'] },
  
  orderedQty: { type: Number, required: true }, // The 100 in your example
  receivedQty: { type: Number, required: true }, // The 110 in your example
  surplusAdded: { type: Number, required: true }, // The 10 pc extra
  
  receivedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('SurplusLedger', SurplusLedgerSchema);
const mongoose = require("mongoose");

const DirectEntryLogSchema = new mongoose.Schema({
  vendor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vendor", // Make sure this matches your Vendor model name
    required: true,
  },
  billNumber: {
    type: String,
    required: true,
  },
  receivedDate: {
    type: Date,
    default: Date.now,
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    // Note: Since this could be a Material OR a Product, 
    // we don't use a single 'ref' here.
  },
  itemName: {
    type: String,
    required: true,
  },
  itemType: {
    type: String,
    enum: ["Raw Material", "Finished Good"],
    required: true,
  },
  receivedQty: {
    type: Number,
    required: true,
  },
  rate: {
    type: Number,
    default: 0,
  },
  totalAmount: {
    type: Number,
    default: 0,
  },
  batch: String,
  breakdown: {
    noOfBoxes: Number,
    qtyPerBox: Number,
    looseQty: Number,
  }
}, { timestamps: true });

module.exports = mongoose.model("DirectEntryLog", DirectEntryLogSchema);
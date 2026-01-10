// backend/models/Product.js
const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    productId: { type: String, unique: true },
    name: { type: String, required: true },
    sku: { type: String, required: true, unique: true },

    category: { type: String, required: true },
    subCategory: String,
    fabricType: String,
    color: String,

    costPerUnit: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },

    // 🟢 NEW: Planning Metrics (Added to match Raw Material Logic)
    avgConsumption: { type: Number, default: 0 }, // Daily Demand
    leadTime: { type: Number, default: 0 }, // Days to Manufacture
    safetyStock: { type: Number, default: 0 }, // Buffer

    // Auto-Calculated Fields
    stockAtLeast: { type: Number, default: 0 }, // Reorder Point
    status: { type: String, default: "HEALTHY" }, // Health Status

    bom: [
      {
        material: { type: mongoose.Schema.Types.ObjectId, ref: "Material" },
        qtyRequired: { type: Number, required: true },
      },
    ],

    // ... existing schema ...
    // backend/models/Product.js
    stock: {
      warehouse: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      // 🟢 SFG Array: Tracks pieces that are stitched but not packed
      semiFinished: [
        {
          lotNumber: String,
          qty: Number,
          jobId: String,
          date: { type: Date, default: Date.now },
        },
      ],
      batches: [
        {
          lotNumber: String,
          qty: Number,
          date: { type: Date, default: Date.now },
          isLoose: { type: Boolean, default: false }, // 🟢 NEW: Identifies loose pieces
          boxCount: { type: Number, default: 0 },
        },
      ],
    },
  },
  { timestamps: true }
);

// 🟢 NEW: Pre-Save Hook to Auto-Calculate Health Status
ProductSchema.pre("save", function (next) {
  // 1. Calculate Target Level (Stock At Least)
  // Formula: (Avg Daily Demand * Lead Time) + Safety Stock
  const baseDemand = this.avgConsumption * this.leadTime;
  const multiplier = this.safetyStock > 0 ? this.safetyStock : 1;
  this.stockAtLeast = baseDemand * multiplier;

  // 2. Calculate Health % (Current vs Target)
  const target = this.stockAtLeast > 0 ? this.stockAtLeast : 1; // Prevent division by zero
  const current = this.stock.warehouse || 0;
  const ratio = (current / target) * 100;

  // 3. Determine Status
  if (ratio < 33) {
    this.status = "CRITICAL";
  } else if (ratio >= 33 && ratio < 66) {
    this.status = "MEDIUM";
  } else if (ratio >= 66 && ratio <= 100) {
    this.status = "OPTIMAL";
  } else {
    this.status = "EXCESS"; // Over 100%
  }

  if (typeof next === "function") {
    next();
  }
});

module.exports = mongoose.model("Product", ProductSchema);

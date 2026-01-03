const mongoose = require("mongoose");

const MaterialSchema = new mongoose.Schema(
  {
    materialId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    materialType: { type: String, required: true },
    unit: { type: String, required: true },
    costPerUnit: { type: Number, default: 0 },

    // Metrics
    avgConsumption: { type: Number, default: 0 }, 
    leadTime: { type: Number, default: 0 }, 
    safetyStock: { type: Number, default: 0 }, 
    stockAtLeast: { type: Number, default: 0 }, 

    stock: {
      current: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      reorderLevel: { type: Number, default: 100 }, 
      batches: [
        {
          lotNumber: { type: String, required: true },
          qty: { type: Number, required: true },
          addedAt: { type: Date, default: Date.now },
        },
      ],
    },
    status: { type: String, default: "HEALTHY" },
  },
  { timestamps: true }
);

// 🟢 PRE-SAVE: STRICT 100.00% CUTOFF LOGIC
MaterialSchema.pre("save", function (next) {
  
  // 1. Calculate Target
  const baseDemand = this.avgConsumption * this.leadTime;
  const multiplier = this.safetyStock > 0 ? this.safetyStock : 1; 
  this.stockAtLeast = baseDemand * multiplier;

  // 2. Calculate Ratio
  const target = this.stockAtLeast > 0 ? this.stockAtLeast : 1;
  const ratio = (this.stock.current / target) * 100;

  // 3. STRICT STATUS RULES
  if (ratio <= 33) {
    this.status = "CRITICAL";
  } else if (ratio > 33 && ratio <= 66) { 
    this.status = "MEDIUM";
  } else if (ratio > 66 && ratio <= 100) {
    this.status = "OPTIMAL"; // Stops exactly at 100
  } else {
    this.status = "EXCESS"; // 100.01 and above becomes EXCESS
  }

  if (typeof next === "function") {
    next();
  }
});

module.exports = mongoose.model("Material", MaterialSchema);
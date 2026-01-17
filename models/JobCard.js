const mongoose = require('mongoose');

const JobCardSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true }, 
  
  isBatch: { type: Boolean, default: false },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionPlan' },
  batchPlans: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductionPlan' }],
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  unitCost: { type: Number, default: 0 },

  type: { 
    type: String, 
    enum: ['In-House', 'Job-Work', 'Full-Buy'], 
    required: true 
  },

  totalQty: { type: Number, required: true },
  
  status: { 
    type: String, 
    enum: [
      'Pending', 'In_Progress', 'Completed', 
      'QC_Pending', 'QC_Passed', 'QC_Failed', 
      'QC_HOLD', 'QC_Rejected', 'Ready_For_Packing'
    ], 
    default: 'Pending' 
  },
  
  currentStep: { 
    type: String, 
    enum: [
      'Material_Pending',     
      'Cutting_Pending',      
      'Cutting_Started', 
      'Cutting_Completed',
      'Stitching_Pending',   
      'Sewing_Started',      
      'Stitching_Completed', 
      'Packaging_Pending',   // 🟢 DIRECT LINK: Now follows Stitching_Completed
      'Packaging_Started',   
      'QC_Pending',          // 🟢 Final QC Only (Gate 2)
      'QC_Completed',        
      'Procurement_Pending', 
      'PO_Raised',
      'QC_Review_Needed',
      'Scrapped'
    ],
    default: 'Material_Pending' 
  },
  logisticsStatus: { 
    type: String, 
    enum: ['At_Source', 'In_Transit', 'Received_At_Factory'], 
    default: 'At_Source' 
  },
  receivedLogs: [{
    stage: String,
    expectedQty: Number,
    receivedQty: Number,
    receivedBy: String,
    date: { type: Date, default: Date.now }
  }],

  customBOM: [{ 
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' }, 
    materialName: String, 
    unit: String,
    requiredQty: Number 
  }],

  productionData: {
    vendorDispatch: {
      isReady: { type: Boolean, default: false },
      actualQtyProduced: { type: Number, default: 0 },
      wastageQty: { type: Number, default: 0 }, 
      dispatchDate: { type: Date }
    },
    adminReceipt: {
      isReceived: { type: Boolean, default: false },
      finalQtyReceived: { type: Number, default: 0 },
      receivedAt: { type: Date }
    },
    // 🟢 SFG TRACEABILITY SLOT
    sfgSource: {
        lotNumber: String,
        qtyUsed: Number
    }
  },

  issuedMaterials: [{ 
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    materialName: String,
    qtyIssued: Number,
    lotNumber: String,
    issuedTo: String,   
    issuedBy: String,   
    role: String,     
    remarks: String,
    date: { type: Date, default: Date.now }
  }],

  qcResult: {
    totalBatchQty: Number,
    sampleSize: Number,
    passedQty: Number,
    rejectedQty: Number,
    defectRate: String,
    inspectorName: String,
    status: String,
    notes: String,
    date: Date
  },

  routing: {
    cutting: { 
      type: { type: String, enum: ['In-House', 'Job Work', 'Job-Work'] }, 
      vendorName: String 
    },
    stitching: { 
      type: { type: String, enum: ['In-House', 'Job Work', 'Job-Work'] }, 
      vendorName: String 
    },
    packing: { 
      type: { type: String, enum: ['In-House', 'Job Work', 'Job-Work'] }, 
      vendorName: String 
    }
  },

  timeline: [
    {
      stage: String,
      action: String,
      vendorName: String,
      details: String,
      remarks: String,
      timestamp: { type: Date, default: Date.now },
      performedBy: String
    }
  ],

  history: [{
    step: String,
    status: String,
    remarks: String,
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('JobCard', JobCardSchema);
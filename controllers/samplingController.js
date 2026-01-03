const Sample = require('../models/Sample');
const Product = require('../models/Product');
const Material = require('../models/Material');

// @desc    Get All Samples
exports.getSamples = async (req, res) => {
  try {
    const samples = await Sample.find()
      .populate('bom.material')
      .populate('originalProductId')
      .sort({ createdAt: -1 });
    res.json(samples);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Create New Sample
exports.createSample = async (req, res) => {
    try {
      let { 
          name, type, originalProductId, client, description, manualBom,
          category, subCategory, fabricType, color 
      } = req.body;
      
      if (originalProductId === "") { originalProductId = null; }
  
      const suffix = Math.floor(1000 + Math.random() * 9000);
      const sampleId = `SMP-${suffix}`;
      let finalBom = [];
  
      if (type === 'Existing Product' && originalProductId) {
          const product = await Product.findById(originalProductId);
          if (product && product.bom) {
              finalBom = product.bom.map(item => ({
                  material: item.material,
                  qtyRequired: item.qtyRequired,
                  notes: 'Copied from Master'
              }));
          }
      } else {
          finalBom = manualBom || [];
      }
  
      const newSample = await Sample.create({
          sampleId, name, type, originalProductId, client, description, 
          bom: finalBom,
          category, subCategory, fabricType, color,
          // 🟢 Initialize log
          activityLog: [{ status: 'Design', remarks: 'Sample Entry Created', date: new Date() }]
      });
  
      res.status(201).json(newSample);
    } catch (error) {
      console.error(error);
      res.status(500).json({ msg: error.message });
    }
};

// @desc    Issue Material (🟢 UPDATED: NOW SAVES LOT NUMBERS)
exports.issueSampleStock = async (req, res) => {
  try {
    const { sampleId } = req.body;
    const sample = await Sample.findById(sampleId).populate('bom.material');
    if (!sample) return res.status(404).json({ msg: 'Sample not found' });
    if (sample.materialsIssued) return res.status(400).json({ msg: 'Materials already issued' });

    for (let item of sample.bom) {
        const material = await Material.findById(item.material._id);
        if (!material || material.stock.current < item.qtyRequired) {
            return res.status(400).json({ msg: `Insufficient Stock: ${material ? material.name : 'Unknown'}` });
        }

        // 🟢 LOGIC: Find the first available lot with stock (FIFO)
        const activeLot = material.lots?.find(l => l.qty > 0) || { lotNumber: "AUTO-GEN" };
        item.lotNumber = activeLot.lotNumber; // Save Lot Number to Sample BOM

        material.stock.current -= item.qtyRequired;
        
        // If your Material schema has lots, deduct from the specific lot here
        if (material.lots && material.lots.length > 0) {
            material.lots[0].qty -= item.qtyRequired;
        }

        await material.save();
    }

    sample.materialsIssued = true;
    sample.status = 'Cutting'; 
    sample.activityLog.push({ 
        status: 'Materials Issued', 
        remarks: 'Inventory deducted and Lot Numbers assigned', 
        date: new Date() 
    });

    await sample.save();
    res.json({ success: true, msg: 'Materials Issued & Lot Numbers Tracked' });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Move Kanban Stage (🟢 UPDATED: NOW STORES HISTORY LOG)
// @desc    Move Kanban Stage (🟢 FIXED: Prevents "Error updating status" crash)
exports.updateStatus = async (req, res) => {
  try {
    const { sampleId, status, remarks } = req.body;
    
    const sample = await Sample.findById(sampleId);
    if (!sample) return res.status(404).json({ msg: "Sample not found" });

    // 🟢 CRITICAL SAFETY CHECK: If activityLog doesn't exist (old data), create it
    if (!sample.activityLog) {
      sample.activityLog = [];
    }

    sample.status = status;
    sample.remarks = remarks; 

    // 🟢 PUSH TO HISTORY
    sample.activityLog.push({
      status: status,
      remarks: remarks || "Stage updated",
      date: new Date(),
      // 🟢 Safe access to user name
      updatedBy: req.user ? req.user.name : "System Operator" 
    });

    await sample.save();
    res.json(sample);
  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Approve & Convert
exports.convertToProduct = async (req, res) => {
  try {
    const { sampleId, finalPrice } = req.body;
    const sample = await Sample.findById(sampleId);
    if (!sample) return res.status(404).json({ msg: 'Sample not found' });

    const newProduct = await Product.create({
        name: sample.name,
        sku: `PROD-${sample.sampleId}`,
        category: sample.category || 'Apparel',
        costPerUnit: 0,
        sellingPrice: finalPrice || 0,
        stock: { warehouse: 0, shopFloor: 0 },
        bom: sample.bom 
    });

    sample.approvalStatus = 'Approved';
    sample.convertedProductId = newProduct._id;
    sample.status = 'Approved';
    sample.activityLog.push({ status: 'Approved', remarks: 'Converted to Master Product', date: new Date() });
    
    await sample.save();
    res.json({ success: true, msg: 'Sample Converted!', product: newProduct });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
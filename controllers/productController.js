const Product = require('../models/Product');

// @desc    Get All Products
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find().populate('bom.material').sort({ createdAt: -1 }); 
    res.json(products);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Create New Product (with Recipe & Price)
exports.createProduct = async (req, res) => {
  try {
    // 🟢 Destructure the NEW fields from req.body
    const { 
        name, sku, category, subCategory, fabricType, color, 
        costPerUnit, sellingPrice, bom,
        avgConsumption, leadTime, safetyStock // <--- NEW INPUTS
    } = req.body;
    
    // Generate internal System ID
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const productId = `PROD-${name.substring(0,3).toUpperCase()}-${suffix}`;

    const product = await Product.create({
      productId,
      sku,           
      name,
      category,
      subCategory,
      fabricType,
      color,         
      costPerUnit: Number(costPerUnit),   
      sellingPrice: Number(sellingPrice), 
      bom, 
      
      // 🟢 Save the Planning Metrics
      avgConsumption: Number(avgConsumption) || 0,
      leadTime: Number(leadTime) || 0,
      safetyStock: Number(safetyStock) || 0,

      // Note: 'status' and 'stockAtLeast' will be auto-calculated by the Model Hook!

      stock: { warehouse: 0, reserved: 0, batches: [] }
    });

    res.status(201).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { 
        name, sku, category, subCategory, fabricType, color, 
        costPerUnit, sellingPrice, bom,
        avgConsumption, leadTime, safetyStock 
    } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ msg: 'Product not found' });

    // Update Fields
    product.name = name || product.name;
    product.sku = sku || product.sku;
    product.category = category || product.category;
    product.subCategory = subCategory || product.subCategory;
    product.fabricType = fabricType || product.fabricType;
    product.color = color || product.color;
    
    product.costPerUnit = Number(costPerUnit) || 0;
    product.sellingPrice = Number(sellingPrice) || 0;
    
    // Update Metrics
    product.avgConsumption = Number(avgConsumption) || 0;
    product.leadTime = Number(leadTime) || 0;
    product.safetyStock = Number(safetyStock) || 0;

    // Update BOM
    if (bom) product.bom = bom;

    // Save (Triggers the Pre-Save Hook to Recalculate Health Status!)
    await product.save();

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Delete a Product
exports.deleteProduct = async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ msg: 'Product not found' });
  
      await product.deleteOne();
      res.json({ success: true, msg: 'Product removed' });
    } catch (error) {
      res.status(500).json({ msg: error.message });
    }
};



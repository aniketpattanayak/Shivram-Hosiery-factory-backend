const ProductReturn = require('../models/ProductReturn');
const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');

// 🔍 SEARCH ORDER FOR RETURN (Kept for legacy support if needed)
exports.searchOrderForReturn = async (req, res) => {
    try {
      const { query } = req.query;
      if (!query) return res.json([]);
  
      const orders = await Order.find({
        status: { $in: ['Dispatched', 'Partially_Dispatched'] },
        $or: [
          { orderId: { $regex: query, $options: 'i' } },
          { customerName: { $regex: query, $options: 'i' } }
        ]
      }).populate('items.product').limit(10);
  
      res.json(orders);
    } catch (error) {
      res.status(500).json({ msg: error.message });
    }
};

// 📝 CREATE RETURN REQUEST (Now supports Direct Inventory Update)
exports.createReturnRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { customerName, items, type, directEntry } = req.body;

    const newReturn = new ProductReturn({
      returnId: `RET-${Date.now().toString().slice(-6)}`,
      customerName,
      items,
      type: type || 'CUSTOMER',
      qcStatus: 'APPROVED',
      addedToInventory: true,
      processedBy: req.user.name,
      processedAt: new Date()
    });

    if (directEntry) {
      const lotNumber = `LOT-RMA-${newReturn.returnId}`;
      newReturn.generatedLotNumber = lotNumber;

      for (const item of items) {
        // Vendor = Subtract, Customer = Add
        const change = (type === 'VENDOR') ? -Math.abs(item.returnQty) : Math.abs(item.returnQty);

        if (item.itemType === 'Raw Material') {
          // 🟢 UPDATE MATERIALS COLLECTION
          const Material = require('../models/Material');
          const mat = await Material.findById(item.productId).session(session);
          if (mat) {
            mat.stock.current += change;
            if (!mat.stock.batches) mat.stock.batches = [];
            mat.stock.batches.push({ lotNumber, qty: change, date: new Date() });
            await mat.save({ session });
          }
        } else {
          // 🟢 UPDATE PRODUCTS COLLECTION
          const Product = require('../models/Product');
          const prod = await Product.findById(item.productId).session(session);
          if (prod) {
            prod.stock.warehouse += change;
            if (!prod.stock.batches) prod.stock.batches = [];
            prod.stock.batches.push({ lotNumber, qty: change, date: new Date() });
            await prod.save({ session });
          }
        }
      }
    }

    await newReturn.save({ session });
    await session.commitTransaction();
    res.status(201).json({ success: true, msg: "Inventory Adjusted Successfully." });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};

// ✅ ADMIN APPROVAL (For legacy/QC-based returns)
exports.approveReturn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { adminNotes, processedBy } = req.body;

    const returnRequest = await ProductReturn.findById(id).session(session);
    if (!returnRequest || returnRequest.qcStatus !== 'QC_PENDING') {
      return res.status(400).json({ msg: "Invalid or already processed return request." });
    }

    const rmaLotNumber = `LOT-RMA-${returnRequest.returnId}`;

    for (const item of returnRequest.items) {
      if (item.condition === 'Good') {
        const product = await Product.findById(item.productId).session(session);
        if (product) {
          product.stock.warehouse += Number(item.returnQty);
          if (!product.stock.batches) product.stock.batches = [];
          product.stock.batches.push({
            lotNumber: rmaLotNumber,
            qty: item.returnQty,
            date: new Date()
          });
          await product.save({ session });
        }
      }
    }

    returnRequest.qcStatus = 'APPROVED';
    returnRequest.addedToInventory = true;
    returnRequest.generatedLotNumber = rmaLotNumber;
    returnRequest.adminNotes = adminNotes;
    returnRequest.processedBy = processedBy;
    returnRequest.processedAt = new Date();

    await returnRequest.save({ session });
    await session.commitTransaction();

    res.json({ success: true, msg: "Inventory updated and Lot Number generated.", lotNumber: rmaLotNumber });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};

// 📜 GET RETURN HISTORY
exports.getReturnHistory = async (req, res) => {
    try {
        const history = await ProductReturn.find().sort({ createdAt: -1 });
        res.json(history);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
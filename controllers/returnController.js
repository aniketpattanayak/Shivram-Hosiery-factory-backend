const ProductReturn = require('../models/ProductReturn');
const Order = require('../models/Order');
const Product = require('../models/Product');

// 🔍 SEARCH ORDER FOR RETURN
// 🔍 DYNAMIC SEARCH: Order ID or Customer Name
exports.searchOrderForReturn = async (req, res) => {
    try {
      const { query } = req.query; // General search string from frontend
      
      if (!query) return res.json([]);
  
      // 🕵️‍♂️ Search for Dispatched orders matching ID OR Customer Name
      const orders = await Order.find({
        status: { $in: ['Dispatched', 'Partially_Dispatched'] },
        $or: [
          { orderId: { $regex: query, $options: 'i' } },
          { customerName: { $regex: query, $options: 'i' } }
        ]
      }).populate('items.product').limit(10); // Limit to 10 for speed
  
      res.json(orders);
    } catch (error) {
      res.status(500).json({ msg: error.message });
    }
  };

// 📝 CREATE RETURN REQUEST (QC HOLD)
exports.createReturnRequest = async (req, res) => {
  try {
    const { orderObjectId, orderId, customerName, items } = req.body;

    // Create the record in "QC_PENDING" status
    const newReturn = await ProductReturn.create({
      orderObjectId,
      orderId,
      customerName,
      items,
      qcStatus: 'QC_PENDING'
    });

    res.status(201).json({ 
      success: true, 
      msg: "Return request sent to QC Hold. Awaiting Admin Approval.", 
      returnId: newReturn.returnId 
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// ✅ ADMIN APPROVAL (THE INVENTORY HANDSHAKE)
exports.approveReturn = async (req, res) => {
  try {
    const { id } = req.params; // Return Request Object ID
    const { adminNotes, processedBy } = req.body;

    const returnRequest = await ProductReturn.findById(id);
    if (!returnRequest || returnRequest.qcStatus !== 'QC_PENDING') {
      return res.status(400).json({ msg: "Invalid or already processed return request." });
    }

    // Generate the unique Lot Number for this return
    const rmaLotNumber = `LOT-RMA-${returnRequest.returnId}`;

    // Update each product's inventory
    for (const item of returnRequest.items) {
      const product = await Product.findById(item.productId);
      if (product) {
        // Increase Warehouse Stock
        product.stock.warehouse += Number(item.returnQty);
        
        // Push to Batches array for tracking
        product.stock.batches.push({
          lotNumber: rmaLotNumber,
          qty: item.returnQty,
          date: new Date()
        });

        await product.save();
      }
    }

    // Mark return request as Approved and Add History
    returnRequest.qcStatus = 'APPROVED';
    returnRequest.addedToInventory = true;
    returnRequest.generatedLotNumber = rmaLotNumber;
    returnRequest.adminNotes = adminNotes;
    returnRequest.processedBy = processedBy;
    returnRequest.processedAt = new Date();

    await returnRequest.save();

    res.json({ success: true, msg: "Inventory updated and Lot Number generated.", lotNumber: rmaLotNumber });
  } catch (error) {
    res.status(500).json({ msg: error.message });
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
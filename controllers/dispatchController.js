const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductionPlan = require('../models/ProductionPlan');

// @desc    Get Orders Ready for Dispatch
exports.getDispatchOrders = async (req, res) => {
  try {
    const orders = await Order.find({ status: { $nin: ['Dispatched', 'Cancelled'] } })
      .populate('items.product')
      .populate({ path: 'clientId', select: 'address' }); 
      
    res.json(orders);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get Dispatch History
exports.getDispatchHistory = async (req, res) => {
  try {
    const history = await Order.find({ 
        status: { $in: ['Dispatched', 'Partially_Dispatched'] } 
    })
      .populate('items.product')
      .populate({ path: 'clientId', select: 'address' })
      .sort({ 'dispatchDetails.dispatchedAt': -1 });
      
    res.json(history);
  } catch (error) {
    console.error("History Fetch Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Dispatch Order (Warehouse -> Customer)
exports.shipOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { orderId, transportDetails, itemsToShip } = req.body;
    
    // 🟢 Safety Check: Ensure order exists
    const order = await Order.findOne({ orderId }).session(session);
    if (!order) throw new Error(`Order ${orderId} not found in database.`);

    let allItemsFullyShipped = true;

    for (const shipItem of itemsToShip) {
      // 🛡️ SHIELD: Fix for 'toString' of undefined error
      if (!shipItem || !shipItem.productId) {
          console.error("Skipping item: Product ID is missing in request payload.");
          continue;
      }

      const qtyToShip = Number(shipItem.qtyToShip);
      if (qtyToShip <= 0) continue; 

      // 🛡️ SHIELD: Ensure the item actually exists in this specific order
      const itemInOrder = order.items.find(i => i.product && i.product.toString() === shipItem.productId.toString());
      if (!itemInOrder) {
          console.warn(`Warning: Product ID ${shipItem.productId} is not part of Order ${orderId}.`);
          continue;
      }

      // 1. DEDUCT PHYSICAL STOCK
      const product = await Product.findById(shipItem.productId).session(session);
      if (product) {
        // Ensure we don't go below zero stock accidentally
        product.stock.warehouse = Math.max(0, product.stock.warehouse - qtyToShip);
        await product.save({ session });

        // 2. UPDATE PRODUCTION PLAN
        // 🟢 ARCHITECT FIX: Try finding plan by both MongoDB _id and String orderId
        const plan = await ProductionPlan.findOne({ 
            $or: [{ orderId: order._id }, { orderId: order.orderId }], 
            product: product._id 
        }).session(session);

        if (plan) {
            plan.dispatchedQty = (plan.dispatchedQty || 0) + qtyToShip;
            // Mark fulfilled if Target is met
            if ((plan.producedQty || 0) >= plan.totalQtyToMake && plan.dispatchedQty >= plan.totalQtyToMake) {
                plan.status = 'Fulfilled_By_Stock'; 
            }
            await plan.save({ session });
        }
      }

      // 3. UPDATE ORDER ITEM DISPATCHED COUNT
      itemInOrder.qtyDispatched = (itemInOrder.qtyDispatched || 0) + qtyToShip;
    }

    // 4. DETERMINE FINAL ORDER STATUS
    for (const item of order.items) {
        if ((item.qtyDispatched || 0) < item.qtyOrdered) {
            allItemsFullyShipped = false;
            break;
        }
    }

    order.status = allItemsFullyShipped ? 'Dispatched' : 'Partially_Dispatched';
    
    // 5. UPDATE DISPATCH LOGS
    if (!order.dispatchHistory) order.dispatchHistory = [];
    order.dispatchHistory.push({
        ...transportDetails,
        itemsShipped: itemsToShip,
        dispatchedAt: new Date()
    });

    // Support for legacy UI field
    order.dispatchDetails = {
        ...transportDetails,
        dispatchedAt: new Date()
    };
    
    await order.save({ session });
    await session.commitTransaction();
    
    res.json({ 
        success: true, 
        msg: allItemsFullyShipped ? 'Order Fully Dispatched.' : 'Partial Dispatch Recorded.',
        status: order.status
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Critical Dispatch Error:", error.message);
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};
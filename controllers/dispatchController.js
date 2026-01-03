const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductionPlan = require('../models/ProductionPlan'); // 🟢 Required to update plan

// @desc    Get Orders Ready for Dispatch
exports.getDispatchOrders = async (req, res) => {
  try {
    // 🟢 UPDATED: Show orders that are NOT fully dispatched
    const orders = await Order.find({ status: { $nin: ['Dispatched', 'Cancelled'] } })
      .populate('items.product')
      .populate({ path: 'clientId', select: 'address' }); 
      
    res.json(orders);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get Dispatch History (Including Partially Dispatched Orders)
exports.getDispatchHistory = async (req, res) => {
  try {
    // 🟢 ARCHITECT FIX: Use $in to find both Fully and Partially dispatched orders
    const history = await Order.find({ 
        status: { $in: ['Dispatched', 'Partially_Dispatched'] } 
    })
      .populate('items.product')
      .populate({ path: 'clientId', select: 'address' })
      .sort({ 'dispatchDetails.dispatchedAt': -1 }); // Show most recent first
      
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
    // 🟢 itemsToShip = [{ productId, qtyToShip }]
    const { orderId, transportDetails, itemsToShip } = req.body;
    
    const order = await Order.findOne({ orderId }).session(session);
    if (!order) throw new Error('Order not found');

    let allItemsFullyShipped = true;

    for (const shipItem of itemsToShip) {
      const qtyToShip = Number(shipItem.qtyToShip);
      if (qtyToShip <= 0) continue; 

      // Find corresponding item in the Order
      const itemInOrder = order.items.find(i => i.product.toString() === shipItem.productId);
      if (!itemInOrder) continue;

      // 1. DEDUCT PHYSICAL STOCK
      const product = await Product.findById(shipItem.productId).session(session);
      if (product) {
        product.stock.warehouse -= qtyToShip;
        await product.save({ session });

        // 2. UPDATE PRODUCTION PLAN
        const plan = await ProductionPlan.findOne({ 
            orderId: order._id, 
            product: product._id 
        }).session(session);

        if (plan) {
            plan.dispatchedQty = (plan.dispatchedQty || 0) + qtyToShip;
            // Complete plan if total made + total dispatched hits the target
            if ((plan.plannedQty || 0) + plan.dispatchedQty >= plan.totalQtyToMake) {
                plan.status = 'Fulfilled_By_Stock'; 
            }
            await plan.save({ session });
        }
      }

      // 3. UPDATE ORDER ITEM DISPATCHED COUNT
      itemInOrder.qtyDispatched = (itemInOrder.qtyDispatched || 0) + qtyToShip;
    }

    // 4. DETERMINE FINAL ORDER STATUS
    // Check if every item in the order is now fully dispatched
    for (const item of order.items) {
        if ((item.qtyDispatched || 0) < item.qtyOrdered) {
            allItemsFullyShipped = false;
            break;
        }
    }

    order.status = allItemsFullyShipped ? 'Dispatched' : 'Partially_Dispatched';
    
    // Save Dispatch History for this specific truck/trip
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
    console.error("Ship Error:", error);
    res.status(500).json({ msg: error.message });
  } finally {
    session.endSession();
  }
};
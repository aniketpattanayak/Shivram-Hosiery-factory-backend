const Invoice = require('../models/Invoice');
const Order = require('../models/Order');

// @desc    Get All Invoices
// @route   GET /api/finance/invoices
exports.getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get Orders Pending Invoicing (Dispatched but not billed)
// @route   GET /api/finance/pending
exports.getPendingOrders = async (req, res) => {
  try {
    // Find orders that are Dispatched but don't have an invoice yet
    // Note: In a real app, we'd check if an invoice exists for this order. 
    // For MVP, we'll just show all Dispatched orders.
    const orders = await Order.find({ status: 'Dispatched' });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Generate Invoice from Order
// @route   POST /api/finance/create
exports.createInvoice = async (req, res) => {
  try {
    const { orderId, taxRate = 18 } = req.body;

    // 1. Fetch the Order
    const order = await Order.findOne({ orderId }).populate('items.product'); // Populate to get latest price if needed
    if (!order) return res.status(404).json({ msg: 'Order not found' });

    // 2. Check if invoice already exists
    const existing = await Invoice.findOne({ orderId: order._id });
    if (existing) return res.status(400).json({ msg: 'Invoice already exists for this order' });

    // 3. Calculate Totals
    let subTotal = 0;
    const invoiceItems = order.items.map(item => {
        // Use price from order if saved, otherwise from product master
        const price = item.product?.sellingPrice || 0; 
        const lineTotal = item.qtyAllocated * price;
        subTotal += lineTotal;
        
        return {
            productName: item.productName || item.product?.name,
            qty: item.qtyAllocated,
            unitPrice: price,
            lineTotal: lineTotal
        };
    });

    const taxAmount = (subTotal * taxRate) / 100;
    const grandTotal = subTotal + taxAmount;

    // 4. Create Invoice
    const newInvoice = new Invoice({
        invoiceId: `INV-${Math.floor(100000 + Math.random() * 900000)}`,
        orderId: order._id,
        customerName: order.customerName || 'Unknown Customer',
        items: invoiceItems,
        subTotal,
        taxRate,
        taxAmount,
        grandTotal,
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // Due in 15 days
    });

    await newInvoice.save();
    res.json({ success: true, invoice: newInvoice });

  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Mark Invoice as Paid
// @route   PUT /api/finance/:id/pay
exports.markPaid = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if(!invoice) return res.status(404).json({msg: 'Invoice not found'});
        
        invoice.status = 'Paid';
        invoice.paidAt = new Date();
        await invoice.save();
        
        res.json({ success: true, msg: 'Invoice marked as Paid' });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
}
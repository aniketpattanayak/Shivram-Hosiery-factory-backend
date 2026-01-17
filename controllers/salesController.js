const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductionPlan = require('../models/ProductionPlan');
const Client = require('../models/Client'); 
const Lead = require('../models/Lead');
// 🟢 Ensure this matches your actual filename (Quote.js or Quotation.js)
const Quote = require('../models/Quotation'); 

// ==========================================
// 1. QUOTATION MANAGEMENT (🟢 FIXED & MERGED)
// ==========================================

exports.createQuote = async (req, res) => {
  try {
    const { 
      clientId, clientName, clientAddress, clientGst, 
      subject, items, terms 
    } = req.body;

    let { salesPerson } = req.body;

    // 🟢 1. STRICT OWNERSHIP: Force Salesman Name
    if (req.user.role === 'Sales Man' || req.user.role === 'Salesman') {
        salesPerson = req.user.name;
    } else if (!salesPerson) {
        salesPerson = req.user.name; 
    }

    // 🟢 2. CRITICAL FIX: Sanitize clientId (Convert "" to null)
    let finalClientId = (clientId && mongoose.Types.ObjectId.isValid(clientId)) ? clientId : null;

    // 🟢 3. HYBRID CLIENT LOGIC: Find or Create Client
    // 🟢 FIXED: Respecting the selected Lead Tier
if (!finalClientId && clientName) {
  const existingClient = await Client.findOne({ name: { $regex: new RegExp(`^${clientName}$`, "i") } });
  
  if (existingClient) {
      finalClientId = existingClient._id;
  } else {
      // Capture the leadType sent from frontend, or default to 'Silver'
      const { leadType } = req.body; 

      const newClient = await Client.create({
          name: clientName,
          address: clientAddress,
          billToAddress: clientAddress, 
          gstNumber: clientGst,
          salesPerson: salesPerson || req.user?.name || 'Admin',
          status: 'Interested', 
          // 🟢 FIX: Use the variable leadType instead of a fixed 'Gold' string
          leadType: leadType || 'Silver' 
      });
      finalClientId = newClient._id;
  }
}

    // 4. Calculate Totals
    let subTotal = 0;
    let taxAmount = 0;
    
    // Process items to ensure numbers
    const processedItems = items.map(item => {
      const lineTotal = Number(item.qty) * Number(item.rate);
      // If you have a gstPercent field on items, calculate tax here
      const lineTax = lineTotal * ((Number(item.gstPercent) || 0) / 100);
      
      subTotal += lineTotal;
      taxAmount += lineTax;

      return {
        ...item,
        amount: lineTotal
      };
    });

    const grandTotal = subTotal + taxAmount;

    // 5. Generate Quote ID
    const year = new Date().getFullYear();
    const count = await Quote.countDocuments();
    const quoteId = `QTN-${year}-${String(count + 1).padStart(3, '0')}`;

    // 6. Save Quote
    const newQuote = await Quote.create({
        quoteId,
        client: finalClientId, // 🟢 Now safely an ObjectId or null
        clientName,
        clientAddress,
        clientGst,
        salesPerson,
        subject,
        validUntil: new Date(Date.now() + 30*24*60*60*1000),
        items: processedItems,
        terms,
        subTotal,
        taxAmount,
        grandTotal,
        status: 'Draft'
    });

    res.status(201).json(newQuote);

  } catch (error) {
    console.error("Create Quote Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

exports.getQuotes = async (req, res) => {
    try {
        let query = {};
        // 🟢 VIEW FILTER: Salesman sees only their own quotes
        if (req.user.role === 'Sales Man' || req.user.role === 'Salesman') {
            query.salesPerson = req.user.name;
        }
        const quotes = await Quote.find(query).sort({ createdAt: -1 });
        res.json(quotes);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.getSingleQuotation = async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if(!quote) return res.status(404).json({ msg: "Quotation not found" });

    // Security Check
    const isSalesMan = (req.user.role === 'Sales Man' || req.user.role === 'Salesman');
    if (isSalesMan && quote.salesPerson !== req.user.name) {
        return res.status(403).json({ msg: "Access Denied" });
    }
    res.json(quote);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};



exports.createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { 
        customerName, customerId, items, deliveryDate, 
        advanceReceived, advanceAmount,
        // 🟢 Destructure new commercial fields
        billToAddress, shippingAddress, contactPerson, billingContact, paymentTerms, remarks, 
    } = req.body;
    
    let finalCustomerId = customerId;

    // 🟢 NEW: Logic to create a new Client if they don't exist in Master
    if (!finalCustomerId || finalCustomerId === "") {
        const newClient = await Client.create([{
            name: customerName,
            address: shippingAddress,
            billToAddress: billToAddress,
            contactPerson: contactPerson,
            billingContact: billingContact,
            paymentTerms: paymentTerms || '30 Days',
            status: 'Customer',
            leadType: 'Silver' // Default tier for new entries
        }], { session });
        finalCustomerId = newClient[0]._id;
    }

    // 1. Resolve Customer Tier for Priority
    let clientDoc = await Client.findById(finalCustomerId).session(session);
    let mappedPriority = 'Low';
    if (clientDoc?.leadType === 'Diamond') mappedPriority = 'High';
    else if (clientDoc?.leadType === 'Gold') mappedPriority = 'Medium';
    else mappedPriority = 'Low';

    // 2. Map Items
    const processedItems = items.map(item => ({
        product: item.productId,
        productName: item.productName,
        qtyOrdered: Number(item.qtyOrdered),
        qtyAllocated: 0, 
        qtyToProduce: Number(item.qtyOrdered),
        unitPrice: item.unitPrice || 0
    }));

    // 🟢 Updated Order creation with Commercial fields
    const newOrder = new Order({
      orderId: `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName,
      clientId: finalCustomerId, 
      billToAddress,
      shippingAddress,
      contactPerson,
      billingContact,
      paymentTerms,
      items: processedItems,
      deliveryDate,
      priority: mappedPriority, 
      status: 'Production_Queued',
      advanceReceived,
      remarks,
      advanceAmount: Number(advanceAmount) || 0
    });

    await newOrder.save({ session });

    // 3. 🟢 GLOBAL WATERFALL RE-ALLOCATION (Keep your existing logic here)
    const uniqueProductNames = [...new Set(items.map(i => i.productName))];
    for (const pName of uniqueProductNames) {
      const product = await Product.findOne({ name: pName }).session(session);
      if (!product) continue;

      const allPending = await Order.find({ 
        'items.productName': pName, 
        status: { $in: ['Production_Queued', 'Ready_Dispatch', 'Partially_Dispatched'] } 
      }).session(session);

      let totalPhysicalPool = product.stock.warehouse || 0;
      allPending.forEach(ord => {
        const target = ord.items?.find(i => i.productName === pName);
        if (target) {
            totalPhysicalPool += (target.qtyAllocated || 0);
            target.qtyAllocated = 0; 
        }
      });

      const weightMap = { 'High': 3, 'Medium': 2, 'Low': 1 };
      allPending.sort((a, b) => {
        const weightA = weightMap[a.priority] || 0;
        const weightB = weightMap[b.priority] || 0;
        if (weightB !== weightA) return weightB - weightA;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });

      let remainingStock = totalPhysicalPool;
      for (const ord of allPending) {
        const itemInOrd = ord.items?.find(i => i.productName === pName);
        if (!itemInOrd) continue;
        const needed = (itemInOrd.qtyOrdered || 0) - (itemInOrd.qtyDispatched || 0);
        if (remainingStock > 0) {
          const allocation = Math.min(needed, remainingStock);
          itemInOrd.qtyAllocated = allocation;
          itemInOrd.qtyToProduce = needed - allocation;
          remainingStock -= allocation;
        } else {
          itemInOrd.qtyAllocated = 0;
          itemInOrd.qtyToProduce = needed;
        }
        const isFullySecured = ord.items?.every(i => (i.qtyAllocated || 0) >= ((i.qtyOrdered || 0) - (i.qtyDispatched || 0)));
        ord.status = isFullySecured ? 'Ready_Dispatch' : 'Production_Queued';
        await ord.save({ session });
      }

      product.stock.warehouse = Math.max(0, remainingStock); 
      await product.save({ session });

      const affectedOrderIds = allPending.map(o => o._id).filter(id => id != null);
      await ProductionPlan.deleteMany({ orderId: { $in: affectedOrderIds }, status: 'Pending Strategy' }).session(session);

      const plansToInsert = [];
      for (const ord of allPending) {
        const item = ord.items?.find(i => i.productName === pName);
        if (ord._id && item && item.qtyToProduce > 0) {
          plansToInsert.push({
            planId: `PP-${Date.now()}-${Math.floor(Math.random() * 999)}`,
            orderId: ord._id, 
            product: product._id, 
            totalQtyToMake: item.qtyToProduce,
            status: 'Pending Strategy'
          });
        }
      }
      if (plansToInsert.length > 0) await ProductionPlan.insertMany(plansToInsert, { session });
    }

    await session.commitTransaction();
    res.status(201).json({ success: true, order: newOrder });

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Order Creation Error:", error.message);
    res.status(500).json({ success: false, msg: error.message });
  } finally {
    session.endSession();
  }
};

exports.getOrders = async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

// ==========================================
// 3. LEAD MANAGEMENT
// ==========================================

exports.getLeads = async (req, res) => {
  try {
    let query = {};
    if (req.user && (req.user.role === 'Sales Man' || req.user.role === 'Salesman')) {
        query.salesPerson = req.user.name;
    }
    const leads = await Lead.find(query).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};


// @desc    Get Single Client by ID
// @route   GET /api/sales/clients/:id
exports.getSingleClient = async (req, res) => {
  try {
    // We use Client.findById to fetch the specific document
    const client = await Client.findById(req.params.id);
    
    if (!client) {
      return res.status(404).json({ msg: "Client not found" });
    }

    // Security Check: Salesman can only fetch their own clients
    if ((req.user.role === 'Sales Man' || req.user.role === 'Salesman') && 
        client.salesPerson !== req.user.name) {
      return res.status(403).json({ msg: "Access Denied: You do not own this client record" });
    }
    
    res.json(client);
  } catch (error) {
    console.error("Get Single Client Error:", error.message);
    // If the ID is not a valid MongoDB ObjectId, return 404 instead of 500
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: "Client not found" });
    }
    res.status(500).send("Server Error");
  }
};
exports.createLead = async (req, res) => {
  try {
    // 1. Maintain your Lead ID generation logic
    const count = await Lead.countDocuments();
    const leadId = `LD-${String(count + 1).padStart(3, '0')}`;
    
    // 2. Maintain your Salesperson ownership logic
    let salesPersonName = req.body.salesPerson;
    if (req.user && (req.user.role === 'Sales Man' || req.user.role === 'Salesman')) {
        salesPersonName = req.user.name;
    }

    // 3. Create the Lead
    // We spread req.body, but since you've removed Lead Tier and Commercials 
    // from the frontend, those fields will naturally be empty/undefined here.
    const newLead = await Lead.create({
      ...req.body, 
      salesPerson: salesPersonName, 
      leadId,
      // We set a default leadType since the UI field is removed
      leadType: 'Silver', 
      activityLog: [{ 
        status: 'New', 
        remarks: 'Lead Created (Simplified Form)', 
        updatedBy: req.user ? req.user.name : 'System',
        date: new Date() 
      }]
    });

    res.status(201).json(newLead);
  } catch (error) {
    console.error("Create Lead Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

exports.updateLeadActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, updatedBy } = req.body;
    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ msg: "Lead not found" });
    lead.status = status;
    lead.activityLog.push({ status, remarks, updatedBy, date: new Date() });
    await lead.save();
    res.json(lead);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// ==========================================
// 4. CLIENT MASTER
// ==========================================

// ==========================================
// 4. CLIENT MASTER (🟢 UPDATED WITH BILLING CONTACT)
// ==========================================

// ==========================================
// 4. CLIENT MASTER (🟢 UPDATED WITH BILLING CONTACT)
// ==========================================

exports.getClients = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";
    const skip = (page - 1) * limit;
    let query = {};
    
    // View Restriction
    if (req.user && (req.user.role === 'Sales Man' || req.user.role === 'Salesman')) {
        query.salesPerson = req.user.name;
    }
    
    // Search
    if (search) {
      const searchFilter = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { gstNumber: { $regex: search, $options: "i" } }
        ]
      };
      if (query.salesPerson) {
        query = { $and: [{ salesPerson: query.salesPerson }, searchFilter] };
      } else {
        query = searchFilter;
      }
    }
    
    const total = await Client.countDocuments(query);
    const clients = await Client.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
    
    res.json({ data: clients, total, currentPage: page, hasMore: (page * limit) < total });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

exports.createClient = async (req, res) => {
  try {
    let salesPersonName = req.body.salesPerson;
    if (req.user && (req.user.role === 'Sales Man' || req.user.role === 'Salesman')) {
        salesPersonName = req.user.name;
    }
    // 🟢 Capture billingContact and billToAddress during creation
    const newClient = await Client.create({ 
        ...req.body, 
        salesPerson: salesPersonName 
    });
    res.status(201).json(newClient);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { 
        name, gstNumber, address, billToAddress, contactPerson, contactNumber, 
        billingContact, email, paymentTerms, salesPerson, 
        interestedProducts, leadType, status, lastActivity 
    } = req.body;
    
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ msg: 'Client not found' });

    const isAdmin = req.user && (req.user.role === 'Admin' || req.user.role === 'Manager');

    // 🟢 ALLOW ADMINS TO UPDATE MASTER FIELDS
    if (isAdmin) {
        if (name) client.name = name;
        if (gstNumber) client.gstNumber = gstNumber;
        if (address) client.address = address;
        if (billToAddress) client.billToAddress = billToAddress; // Added
        if (contactPerson) client.contactPerson = contactPerson;
        if (contactNumber) client.contactNumber = contactNumber;
        if (billingContact !== undefined) client.billingContact = billingContact; // 🟢 Added Billing Phone
        if (email) client.email = email;
        if (paymentTerms) client.paymentTerms = paymentTerms;
        if (salesPerson) client.salesPerson = salesPerson;
        if (interestedProducts) client.interestedProducts = interestedProducts;
        if (leadType) client.leadType = leadType;
    }

    // 🟢 ALLOW ALL ROLES TO UPDATE STATUS/ACTIVITY
    if (status || lastActivity) {
      if (status) client.status = status;
      if (!client.activityLog) client.activityLog = [];
      client.activityLog.push({
        updatedBy: req.user.name,
        status: status || client.status,
        type: lastActivity?.type || 'Update',
        remark: lastActivity?.remark || 'Status Updated',
        date: new Date()
      });
    }

    await client.save();
    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

exports.getSingleQuotation = async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if(!quote) return res.status(404).json({ msg: "Quotation not found" });

    // Security: Restrict Salesmen to their own quotes
    const isSalesMan = (req.user.role === 'Sales Man' || req.user.role === 'Salesman');
    if (isSalesMan && quote.salesPerson !== req.user.name) {
        return res.status(403).json({ msg: "Access Denied" });
    }

    res.json(quote);
  } catch (error) {
    console.error("Get Single Quote Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

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
    if (!finalClientId && clientName) {
        // Check if client exists by name to avoid duplicates
        const existingClient = await Client.findOne({ name: { $regex: new RegExp(`^${clientName}$`, "i") } });
        
        if (existingClient) {
            finalClientId = existingClient._id;
        } else {
            // Create New Client in Master automatically
            const newClient = await Client.create({
                name: clientName,
                address: clientAddress,
                billToAddress: clientAddress, 
                gstNumber: clientGst,
                salesPerson: salesPerson,
                status: 'Interested', 
                leadType: 'Medium'
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

// ==========================================
// 2. SALES ORDER MANAGEMENT (🟢 FIXED CAST ERROR)
// ==========================================

// ... existing imports ...

// ==========================================
// 2. SALES ORDER MANAGEMENT (🟢 UPDATED: PRIORITY DISPLACEMENT ENGINE)
// ==========================================

exports.createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { 
        customerName, customerId, items, deliveryDate, 
        advanceReceived, advanceAmount 
    } = req.body;
    
    // 1. Resolve Customer Identity & Tier
    let finalCustomerId = (customerId && mongoose.Types.ObjectId.isValid(customerId)) ? customerId : null;
    let clientDoc = null;

    if (!finalCustomerId && customerName) {
         clientDoc = await Client.findOne({ name: { $regex: new RegExp(`^${customerName}$`, "i") } }).session(session);
         if (clientDoc) {
             finalCustomerId = clientDoc._id;
         } else {
             clientDoc = new Client({
                 name: customerName,
                 salesPerson: req.user ? req.user.name : 'Admin',
                 status: 'Customer',
                 leadType: 'Silver' // Default
             });
             await clientDoc.save({ session });
             finalCustomerId = clientDoc._id;
         }
    } else if (finalCustomerId) {
        clientDoc = await Client.findById(finalCustomerId).session(session);
    }

    // 🟢 PRIORITY MAPPING (Diamond -> High, Gold -> Medium, Silver -> Low)
    let mappedPriority = 'Low';
    if (clientDoc?.leadType === 'Diamond') mappedPriority = 'High';
    else if (clientDoc?.leadType === 'Gold') mappedPriority = 'Medium';
    else mappedPriority = 'Low';

    const processedItems = [];
    const productionPlansToCreate = [];
    let grandTotal = 0;
    let orderRequiresProduction = false;

    for (const item of items) {
      const product = await Product.findOne({ name: item.productName }).session(session);
      let availableStock = product ? product.stock.warehouse : 0;
      const qtyRequested = Number(item.qtyOrdered);

      // 🟢 DISPLACEMENT LOGIC: Diamond orders "steal" from Silver/Gold
      if (clientDoc?.leadType === 'Diamond' && availableStock < qtyRequested) {
          // Find orders sitting in Dispatch that are lower priority
          const shiftableOrders = await Order.find({
              status: 'Ready_Dispatch',
              priority: { $in: ['Low', 'Medium'] },
              'items.productName': item.productName
          }).session(session);

          for (const lowOrder of shiftableOrders) {
              if (availableStock >= qtyRequested) break;

              // Displacement: Take stock, push back to Production
              lowOrder.status = 'Production_Queued';
              const lowItem = lowOrder.items.find(i => i.productName === item.productName);
              
              availableStock += (lowItem.qtyAllocated || 0);
              lowItem.qtyAllocated = 0;
              lowItem.qtyToProduce = lowItem.qtyOrdered;
              
              await lowOrder.save({ session });

              // Create new Production Plan for the "robbed" order
              await ProductionPlan.create([{
                  planId: `PP-DISP-${Date.now()}-${Math.floor(Math.random() * 9000)}`,
                  orderId: lowOrder._id,
                  product: lowItem.product,
                  totalQtyToMake: lowItem.qtyOrdered,
                  status: 'Pending Strategy'
              }], { session });
          }
      }

      // 2. Allocation Decision
      const canAllocate = availableStock >= qtyRequested;
      const qtyAllocated = canAllocate ? qtyRequested : 0;
      const qtyToProduce = canAllocate ? 0 : qtyRequested;

      if (qtyToProduce > 0) {
        orderRequiresProduction = true;
        productionPlansToCreate.push({
          planId: `PP-${Date.now()}-${Math.floor(Math.random() * 9000)}`, 
          product: product?._id, 
          totalQtyToMake: qtyToProduce, 
          status: 'Pending Strategy'
        });
      }

      const finalPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : (product?.sellingPrice || 0);
      grandTotal += (finalPrice * qtyRequested);

      processedItems.push({
        product: product ? product._id : null,
        productName: item.productName,
        qtyOrdered: qtyRequested,
        qtyAllocated: qtyAllocated,
        qtyToProduce: qtyToProduce,
        unitPrice: finalPrice,
        itemTotal: (finalPrice * qtyRequested),
        promiseDate: item.promiseDate 
      });
    }

    // 3. Final Routing
    const finalStatus = orderRequiresProduction ? 'Production_Queued' : 'Ready_Dispatch';

    const newOrder = new Order({
      orderId: `ORD-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000)}`,
      customerName: customerName,
      clientId: finalCustomerId, 
      items: processedItems,
      grandTotal: grandTotal, 
      deliveryDate: deliveryDate,
      priority: mappedPriority, 
      status: finalStatus,
      advanceReceived: advanceReceived || false, 
      advanceAmount: advanceReceived ? (advanceAmount || 0) : 0
    });

    await newOrder.save({ session });

    if (productionPlansToCreate.length > 0) {
      const plans = productionPlansToCreate.map(plan => ({ ...plan, orderId: newOrder._id }));
      await ProductionPlan.insertMany(plans, { session });
    }

    await session.commitTransaction();
    res.status(201).json({ success: true, order: newOrder });

  } catch (error) {
    await session.abortTransaction();
    console.error("Create Order Error:", error);
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

exports.createLead = async (req, res) => {
  try {
    const count = await Lead.countDocuments();
    const leadId = `LD-${String(count + 1).padStart(3, '0')}`;
    let salesPersonName = req.body.salesPerson;
    if (req.user && (req.user.role === 'Sales Man' || req.user.role === 'Salesman')) {
        salesPersonName = req.user.name;
    }
    const newLead = await Lead.create({
      ...req.body,
      salesPerson: salesPersonName, 
      leadId,
      activityLog: [{ status: 'New', remarks: 'Lead Created', updatedBy: req.user ? req.user.name : 'System' }]
    });
    res.status(201).json(newLead);
  } catch (error) {
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

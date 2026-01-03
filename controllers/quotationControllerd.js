const Quotation = require('../models/Quotation');
const Client = require('../models/Client');

// @desc    Generate New Quotation
// @route   POST /api/sales/quotes
exports.createQuotation = async (req, res) => {
  try {
    const { clientId, items, terms, subject } = req.body;
    let { salesPerson } = req.body;

    // 🟢 1. STRICT OWNERSHIP:
    // If the user is a Sales Man, FORCE the quote to be in their name.
    // They cannot create a quote for "Amit" if they are "Pramod".
    if (req.user.role === 'Sales Man' || req.user.role === 'Salesman') {
        salesPerson = req.user.name;
    } 
    // If Admin, they can choose the salesPerson manually (or default to themselves)
    else if (!salesPerson) {
        salesPerson = req.user.name; 
    }

    // 2. Fetch Client Details (to freeze them in the quote)
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ msg: "Client not found" });

    // 3. Calculate Totals
    let subTotal = 0;
    let taxAmount = 0;
    
    const processedItems = items.map(item => {
      const lineTotal = Number(item.qty) * Number(item.rate);
      const lineTax = lineTotal * (Number(item.gstPercent) / 100);
      
      subTotal += lineTotal;
      taxAmount += lineTax;

      return {
        ...item,
        amount: lineTotal
      };
    });

    const grandTotal = subTotal + taxAmount;

    // 4. Generate Quote ID (QTN-YEAR-NUMBER)
    const year = new Date().getFullYear();
    const count = await Quotation.countDocuments();
    const quoteId = `QTN-${year}-${String(count + 1).padStart(3, '0')}`;

    // 5. Create Record
    const newQuote = await Quotation.create({
      quoteId,
      client: client._id,
      clientName: client.name,
      clientAddress: client.billToAddress || client.address,
      clientGst: client.gstNumber,
      salesPerson, // 🟢 Locked to the correct user
      subject,
      validUntil: new Date(Date.now() + 30*24*60*60*1000), // Default 30 days validity
      items: processedItems,
      subTotal,
      taxAmount,
      grandTotal,
      terms
    });

    res.status(201).json(newQuote);

  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get All Quotations
// @route   GET /api/sales/quotes
exports.getQuotations = async (req, res) => {
  try {
    let query = {};

    // 🟢 2. VIEW FILTER:
    // If Sales Man, only show quotes WHERE salesPerson == "Pramod"
    if (req.user.role === 'Sales Man' || req.user.role === 'Salesman') {
        query.salesPerson = req.user.name;
    }

    const quotes = await Quotation.find(query).sort({ createdAt: -1 });
    res.json(quotes);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get Single Quote (For Print View)
// @route   GET /api/sales/quotes/:id
exports.getSingleQuotation = async (req, res) => {
  try {
    const quote = await Quotation.findById(req.params.id);
    if(!quote) return res.status(404).json({ msg: "Quotation not found" });

    // 🟢 3. SECURITY CHECK:
    // If a Sales Man tries to open someone else's quote via URL, block them.
    const isSalesMan = (req.user.role === 'Sales Man' || req.user.role === 'Salesman');
    
    if (isSalesMan && quote.salesPerson !== req.user.name) {
        return res.status(403).json({ msg: "Access Denied: You can only view your own quotations." });
    }

    res.json(quote);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
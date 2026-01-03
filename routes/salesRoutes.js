const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); 

const { 
  createOrder, getOrders, 
  getLeads, createLead, updateLeadActivity,
  getClients, createClient, updateClient,
  createQuote, getQuotes, 
  // 🟢 NEW: Import the single quote function
  getSingleQuotation 
} = require('../controllers/salesController');

// ==========================
// 1. QUOTATIONS 
// ==========================
router.post('/quotes', auth, createQuote);
router.get('/quotes', auth, getQuotes);
// 🟢 NEW ROUTE: Fixes "Error fetching quotation"
router.get('/quotes/:id', auth, getSingleQuotation);

// ==========================
// 2. ORDERS
// ==========================
router.post('/orders', auth, createOrder);
router.get('/orders', auth, getOrders);

// ==========================
// 3. LEADS
// ==========================
router.get('/leads', auth, getLeads);
router.post('/leads', auth, createLead);
router.put('/leads/:id/activity', auth, updateLeadActivity);

// ==========================
// 4. CLIENTS
// ==========================
router.get('/clients', auth, getClients); 
router.post('/clients', auth, createClient);
router.put('/clients/:id', auth, updateClient);

module.exports = router;
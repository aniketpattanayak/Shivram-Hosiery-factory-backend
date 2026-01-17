const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
// Import Logic from Inventory Controller
const { 
  issueMaterial, 
  approveQC, 
  getStock, 
  createMaterial,
  recalculateAll,
  // 🟢 Ensure this is imported
  updateMaterial ,
  adjustStockManually,
} = require('../controllers/inventoryController');

// Import Logic from Dispatch Controller
const { 
  shipOrder, 
  getDispatchOrders 
} = require('../controllers/dispatchController');

// --- Routes ---

// 1. Inventory Management
router.get('/stock', getStock);              
router.post('/materials', createMaterial);   
router.post('/issue-material', issueMaterial); 

// 🟢 Route for Editing Material
router.put('/:id', updateMaterial);
// Add this route with the Admin check
router.post('/adjust-stock', protect, adjustStockManually);
router.post('/qc-pass', approveQC);          
router.post('/recalculate', recalculateAll);

// 2. Dispatch / Logistics
router.get('/orders', getDispatchOrders);    
router.post('/ship', shipOrder);             

module.exports = router;
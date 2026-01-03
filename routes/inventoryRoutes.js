const express = require('express');
const router = express.Router();

// Import Logic from Inventory Controller
const { 
  issueMaterial, 
  approveQC, 
  getStock, 
  createMaterial,
  recalculateAll,
  // 🟢 Ensure this is imported
  updateMaterial 
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

router.post('/qc-pass', approveQC);          
router.post('/recalculate', recalculateAll);

// 2. Dispatch / Logistics
router.get('/orders', getDispatchOrders);    
router.post('/ship', shipOrder);             

module.exports = router;
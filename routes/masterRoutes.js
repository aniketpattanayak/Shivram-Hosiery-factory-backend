const express = require('express');
const router = express.Router();
const { 
  getCategories, addCategory, updateCategory, // 🟢 Import updateCategory
  getAttributes, addAttribute 
} = require('../controllers/masterController');

// Categories
router.get('/categories', getCategories);
router.post('/categories', addCategory);
router.put('/categories/:id', updateCategory); // 🟢 This fixes the 404 Error

// Attributes
router.get('/attributes', getAttributes);
router.post('/attributes', addAttribute);

module.exports = router;
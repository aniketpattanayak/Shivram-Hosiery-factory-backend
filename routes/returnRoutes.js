const express = require('express');
const router = express.Router();
const returnController = require('../controllers/returnController');

router.get('/search', returnController.searchOrderForReturn);
router.post('/request', returnController.createReturnRequest);
router.put('/approve/:id', returnController.approveReturn);
router.get('/history', returnController.getReturnHistory);

module.exports = router;
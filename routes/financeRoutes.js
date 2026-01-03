const express = require('express');
const router = express.Router();
const controller = require('../controllers/invoiceController');

router.get('/invoices', controller.getInvoices);
router.get('/pending', controller.getPendingOrders);
router.post('/create', controller.createInvoice);
router.put('/:id/pay', controller.markPaid);

module.exports = router;
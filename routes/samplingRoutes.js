const express = require('express');
const router = express.Router();
const controller = require('../controllers/samplingController');

router.get('/', controller.getSamples);
router.post('/', controller.createSample);
router.post('/issue', controller.issueSampleStock);
router.put('/status', controller.updateStatus);
router.post('/convert', controller.convertToProduct);

module.exports = router;
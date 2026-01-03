const express = require('express');
const router = express.Router();
const { 
  confirmStrategy, 
  getPendingPlans, 
  getActiveJobs,
  getKittingJobs, 
  issueMaterials,
  getIssueHistory, // 🟢 Import New Function
  deletePlan 
} = require('../controllers/productionController');

router.get('/pending', getPendingPlans);
router.get('/jobs', getActiveJobs);
router.get('/kitting', getKittingJobs); 
router.get('/kitting/history', getIssueHistory); // 🟢 Add New Route for Global History

router.post('/confirm-strategy', confirmStrategy);
router.post('/kitting/issue', issueMaterials);

router.delete('/:id', deletePlan); 

module.exports = router;
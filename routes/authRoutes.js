const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getAllUsers, deleteUser , updateUser} = require('../controllers/authController');

// Public / Auth
router.post('/register', registerUser);
router.post('/login', loginUser);

// 🟢 NEW: User Management Routes (Protected usually, assuming middleware logic later)
router.get('/users', getAllUsers);
router.delete('/users/:id', deleteUser);
router.put('/users/:id', updateUser);

module.exports = router;
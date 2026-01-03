const express = require('express');
const router = express.Router();
const { getUsers, createUser, updateUser, deleteUser } = require('../controllers/userController');

router.get('/', getUsers);
router.post('/', createUser);      // 🟢 New Create Route
router.put('/:id', updateUser);    // 🟢 New Update Route
router.delete('/:id', deleteUser);

module.exports = router;
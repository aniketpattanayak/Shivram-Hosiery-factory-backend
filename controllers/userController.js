const User = require('../models/User');
const bcrypt = require('bcryptjs');

// @desc    Get All Users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Add New User (With Permissions)
exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, permissions } = req.body;

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: 'User already exists' });

    // 🔴 REMOVED MANUAL HASHING HERE to avoid double-encryption.
    // The User model's pre('save') hook now handles it automatically.

    // Create User
    user = new User({
      name,
      email,
      password, // 🟢 Pass plain text; Model will encrypt it
      role,
      permissions // 🟢 Save the custom matrix
    });

    await user.save();
    res.json({ msg: "User Created Successfully", user });

  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Update User Permissions
exports.updateUser = async (req, res) => {
  try {
    const { name, email, role, permissions } = req.body;
    
    // Find and Update
    const user = await User.findByIdAndUpdate(req.params.id, {
      name, email, role, permissions
    }, { new: true }).select('-password');

    res.json(user);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Delete User
exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ msg: "User removed" });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
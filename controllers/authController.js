const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Helper: Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, 'secret_key_123', { expiresIn: '30d' });
};

// @desc    Register a new user (Used by Admin Panel)
// @route   POST /api/auth/register
exports.registerUser = async (req, res) => {
    try {
      // 🟢 UPDATED: Added vendorId to destructuring
      const { name, email, password, role, permissions, vendorId } = req.body;
      
      const userExists = await User.findOne({ email });
      if (userExists) return res.status(400).json({ msg: 'User already exists' });
  
      // Use permissions passed from UI, default to empty
      const userPermissions = permissions || [];
  
      const user = await User.create({ 
        name, 
        email, 
        password, 
        role,
        permissions: userPermissions,
        vendorId: vendorId || null // 🟢 UPDATED: Save the link if provided
      });
  
      if (user) {
        res.status(201).json({
          msg: "User created successfully",
          user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              role: user.role,
              permissions: user.permissions,
              vendorId: user.vendorId // 🟢 UPDATED: Include in response
          }
        });
      }
    } catch (error) {
      res.status(500).json({ msg: error.message });
    }
};

// @desc    Login User & Get Token
// @route   POST /api/auth/login
exports.loginUser = async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
  
      if (user && (await user.matchPassword(password))) {
        // 🟢 FIX: Structure response as { token, user: {} }
        // 🟢 UPDATED: Added vendorId to the user object
        res.json({
          token: generateToken(user._id),
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            permissions: user.permissions || [],
            vendorId: user.vendorId || null // 🟢 BRIDGE: Critical for Vendor Dashboard
          }
        });
      } else {
        res.status(401).json({ msg: 'Invalid email or password' });
      }
    } catch (error) {
      res.status(500).json({ msg: error.message });
    }
};

// @desc    Get All Users (For Admin Settings)
// @route   GET /api/auth/users
exports.getAllUsers = async (req, res) => {
  try {
    // 🟢 UPDATED: Added .populate('vendorId') so you can see vendor names in User Settings
    const users = await User.find()
      .select('-password')
      .populate('vendorId', 'name')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Delete User
// @route   DELETE /api/auth/users/:id
exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ msg: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Update User Details
// @route   PUT /api/auth/users/:id
exports.updateUser = async (req, res) => {
  try {
    const { name, email, role, permissions, password, vendorId } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ msg: "User not found" });

    // Update Fields if provided
    user.name = name || user.name;
    user.email = email || user.email;
    user.role = role || user.role;
    user.permissions = permissions || user.permissions;
    user.vendorId = vendorId !== undefined ? vendorId : user.vendorId; // 🟢 UPDATED: Allow changing vendor link

    // Only update password if a new one is provided
    if (password && password.trim() !== "") {
        user.password = password; 
    }

    await user.save();
    
    // Return user without password
    const updatedUser = user.toObject();
    delete updatedUser.password;
    
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get current logged in user (FRESH DATA)
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    // req.user comes from middleware
    const userId = req.user._id || req.user.id; 
    
    // 🟢 UPDATED: Added .populate('vendorId') so the frontend state always knows the vendor
    const user = await User.findById(userId)
      .select('-password')
      .populate('vendorId', 'name');
    
    if (!user) {
        return res.status(401).json({ msg: 'User no longer exists' });
    }

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
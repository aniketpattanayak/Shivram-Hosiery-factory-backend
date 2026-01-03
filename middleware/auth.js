const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, 'secret_key_123'); 
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ msg: 'User not found' });
    }
    req.user = user; 
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

// 🟢 THE TRICK: Export the function ITSELF, but also attach 'protect' to it.
// This way: 
// 1. Sales routes can still use: const auth = require('./auth')
// 2. Logistics can now use: const { protect } = require('./auth')
module.exports = auth; 
module.exports.protect = auth;
const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // e.g. "Manager"
  permissions: [{ type: String }], // e.g. ["dashboard", "inventory"]
  isSystem: { type: Boolean, default: false } // True for "Admin" (cannot be deleted)
}, { timestamps: true });

module.exports = mongoose.model('Role', RoleSchema);
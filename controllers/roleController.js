const Role = require('../models/Role');

// @desc Get All Roles (Initialize defaults if empty)
exports.getRoles = async (req, res) => {
  try {
    const roles = await Role.find();
    
    // If first time running, create default templates
    if (roles.length === 0) {
        const defaults = [
            { name: 'Admin', permissions: ['all'], isSystem: true },
            { name: 'Manager', permissions: ['dashboard', 'inventory', 'production'], isSystem: false },
            { name: 'Worker', permissions: ['shop-floor'], isSystem: false }
        ];
        const created = await Role.insertMany(defaults);
        return res.json(created);
    }
    
    res.json(roles);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc Create New Role
exports.createRole = async (req, res) => {
  try {
    const { name } = req.body;
    const existing = await Role.findOne({ name });
    if(existing) return res.status(400).json({ msg: "Role already exists" });

    const newRole = await Role.create({ 
        name, 
        permissions: ['dashboard'], 
        isSystem: false 
    });
    res.status(201).json(newRole);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc Update Role Permissions
exports.updateRole = async (req, res) => {
  try {
    const { permissions } = req.body;
    const role = await Role.findByIdAndUpdate(req.params.id, { permissions }, { new: true });
    res.json(role);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc Delete Role
exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if(role.isSystem) return res.status(400).json({ msg: "Cannot delete System Role" });
    
    await role.deleteOne();
    res.json({ msg: "Role Removed" });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
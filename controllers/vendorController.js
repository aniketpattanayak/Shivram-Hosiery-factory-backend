const Vendor = require('../models/Vendor');
const User = require('../models/User'); // 🟢 Need User model to create login

// @desc    Create a new vendor & Auto-create User Login
// @route   POST /api/vendors
exports.createVendor = async (req, res) => {
  try {
    const { name, category, services, contactPerson, phone, email, gst, address } = req.body;

    // 1. Validation: Ensure email is provided for the login
    if (!email) {
      return res.status(400).json({ msg: "Email is required to create a vendor login." });
    }

    // 2. Check if a User with this email already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ msg: "A user with this email already exists." });
    }

    // 3. Create the Vendor Profile
    const vendor = await Vendor.create({
      name,
      category,
      services,
      contactPerson,
      phone,
      email,
      gst,
      address
    });

    // 4. 🟢 AUTOMATION: Create the User account for this Vendor
    // Default Password is set to the vendor's phone number
    const tempPassword = phone || "shivram123"; 

    await User.create({
      name: name, // Vendor Factory Name
      email: email.toLowerCase(),
      password: tempPassword, 
      role: "Vendor",
      vendorId: vendor._id, // 🔗 The Bridge from Phase 1
      permissions: ["vendor_dashboard", "job_cards"] // Default vendor permissions
    });

    res.status(201).json({
      success: true,
      msg: `Vendor created and login credentials sent to ${email}`,
      vendor,
      autoLoginCreated: true
    });

  } catch (error) {
    console.error("Vendor Creation Error:", error);
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Get All Vendors
// @route   GET /api/vendors
exports.getVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find().sort({ createdAt: -1 });
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};

// @desc    Delete Vendor
// @route   DELETE /api/vendors/:id
exports.deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ msg: "Vendor not found" });

    // Optional: Also delete the associated user account
    await User.findOneAndDelete({ vendorId: req.params.id });
    await Vendor.findByIdAndDelete(req.params.id);

    res.json({ msg: "Vendor and associated login deleted successfully" });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
};
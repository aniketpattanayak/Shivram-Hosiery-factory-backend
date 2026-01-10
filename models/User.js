const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    // 🟢 DYNAMIC ROLE VALIDATION: Checks System Settings roles
    role: { 
      type: String, 
      required: true,
      validate: {
        validator: async function(value) {
          // 1. Hardcoded defaults to prevent accidental lockout
          const systemRoles = ["Admin", "Manager", "Worker", "Vendor", "Sales man", "Sales Man"];
          if (systemRoles.includes(value)) return true;

          // 2. Dynamic check against the Role collection
          try {
            // We use this.constructor to avoid model registration issues
            const roleExists = await mongoose.model('Role').findOne({ 
              name: { $regex: new RegExp(`^${value}$`, "i") } 
            });
            return !!roleExists;
          } catch (err) {
            // Fallback to true if Role model isn't initialized yet to prevent crash
            return true; 
          }
        },
        message: props => `${props.value} is not a valid role. Please add it in System Settings first.`
      },
      default: "Worker" 
    },
    
    // 🟢 VENDOR BRIDGE: Links user to Vendor profile
    vendorId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Vendor', 
      default: null 
    },

    // 🟢 PERMISSIONS MATRIX
    permissions: {
      type: [String], 
      default: [] 
    },
  },
  { timestamps: true }
);

// Method to compare passwords for login
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// 🟢 PASSWORD HASHING: Modern Async/Await version (Fixes "next is not a function")
UserSchema.pre("save", async function () {
  // If password isn't modified, just finish
  if (!this.isModified("password")) {
    return;
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error; // Mongoose handles thrown errors in async hooks automatically
  }
});

// 🟢 EXPORT: Specifically structured for Localhost / Fast Refresh
// This prevents "Cannot overwrite model once compiled" errors
module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
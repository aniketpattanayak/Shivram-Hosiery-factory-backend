const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    // 🟢 UPDATED: Explicitly adding 'Vendor' to roles
    role: { 
      type: String, 
      enum: ["Admin", "Manager", "Worker", "Vendor"], 
      default: "Worker" 
    },
    
    // 🟢 THE BRIDGE: Links this user to a specific Vendor profile
    vendorId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Vendor', 
      default: null 
    },

    permissions: {
      type: [String], 
      default: [] 
    },
  },
  { timestamps: true }
);

UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return; 
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model("User", UserSchema);
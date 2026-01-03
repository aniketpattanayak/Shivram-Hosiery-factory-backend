const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  subCategories: [{ type: String }] // Array of strings e.g. ["Shirt", "Trousers"]
});

module.exports = mongoose.model('Category', CategorySchema);
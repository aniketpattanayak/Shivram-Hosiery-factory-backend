const Category = require("../models/Category");
const Attribute = require("../models/Attribute");

// --- CATEGORY LOGIC ---
exports.getCategories = async (req, res) => {
  try {
    const cats = await Category.find();
    res.json(cats);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

exports.addCategory = async (req, res) => {
  try {
    const { name } = req.body;
    const newCat = await Category.create({ name, subCategories: [] });
    res.json(newCat);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// 🟢 NEW: Handles the PUT request from Frontend for Sub-Categories
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { subCategories } = req.body; // Expecting the updated array

    const cat = await Category.findById(id);
    if (!cat) return res.status(404).json({ msg: "Category not found" });

    if (subCategories) {
      cat.subCategories = subCategories;
    }
    
    await cat.save();
    res.json(cat);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// --- ATTRIBUTE LOGIC (Color, Fabric, MaterialType, Unit) ---
exports.getAttributes = async (req, res) => {
  try {
    const attrs = await Attribute.find();
    const grouped = {};

    attrs.forEach((a) => {
      if (!grouped[a.type]) {
        grouped[a.type] = [];
      }
      grouped[a.type].push(a.value);
    });

    res.json(grouped);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

exports.addAttribute = async (req, res) => {
  try {
    const { type, value } = req.body;
    const newAttr = await Attribute.create({ type, value });
    res.json(newAttr);
  } catch (err) {
    res.status(400).json({ msg: err.message });
  }
};
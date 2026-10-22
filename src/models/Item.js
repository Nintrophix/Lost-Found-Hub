'use strict';

const mongoose = require('mongoose');

const TYPES = ['lost', 'found'];
const STATUSES = ['open', 'claimed', 'resolved'];
const CATEGORIES = ['electronics', 'ids-cards', 'keys', 'bags', 'clothing', 'books', 'jewelry', 'other'];

const CATEGORY_LABELS = {
  electronics: 'Electronics',
  'ids-cards': 'IDs and cards',
  keys: 'Keys',
  bags: 'Bags',
  clothing: 'Clothing',
  books: 'Books and notes',
  jewelry: 'Jewelry',
  other: 'Other',
};

const STATUS_LABELS = { open: 'Open', claimed: 'Claimed', resolved: 'Returned' };

const itemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: TYPES, required: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    category: { type: String, enum: CATEGORIES, required: true },
    color: { type: String, trim: true, maxlength: 30, default: '' },
    location: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    dateLostOrFound: { type: Date, required: true },
    images: {
      type: [String],
      default: [],
      validate: { validator: (v) => v.length <= 4, message: 'An item can have at most 4 images.' },
    },
    status: { type: String, enum: STATUSES, default: 'open' },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Full-text search across the fields people actually describe items with.
itemSchema.index(
  { title: 'text', description: 'text', location: 'text' },
  { name: 'item_text', weights: { title: 5, location: 3, description: 1 } }
);
itemSchema.index({ type: 1, category: 1, status: 1, createdAt: -1 });
itemSchema.index({ reporter: 1, createdAt: -1 });
itemSchema.index({ status: 1, createdAt: -1 });

const Item = mongoose.model('Item', itemSchema);
Item.TYPES = TYPES;
Item.STATUSES = STATUSES;
Item.CATEGORIES = CATEGORIES;
Item.CATEGORY_LABELS = CATEGORY_LABELS;
Item.STATUS_LABELS = STATUS_LABELS;

module.exports = Item;

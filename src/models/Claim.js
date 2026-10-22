'use strict';

const mongoose = require('mongoose');

const STATUSES = ['pending', 'approved', 'rejected'];

const claimSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    claimant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Proof of ownership: identifying details only the owner would know.
    message: { type: String, required: true, trim: true, minlength: 20, maxlength: 1000 },
    status: { type: String, enum: STATUSES, default: 'pending' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

claimSchema.index({ item: 1, status: 1 });
claimSchema.index({ claimant: 1, createdAt: -1 });
// A person can only have one pending claim per item at a time.
claimSchema.index(
  { item: 1, claimant: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_claim' }
);

const Claim = mongoose.model('Claim', claimSchema);
Claim.STATUSES = STATUSES;

module.exports = Claim;

'use strict';

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  participants: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    validate: {
      validator: (v) => v.length === 2 && String(v[0]) !== String(v[1]),
      message: 'A conversation has exactly two different participants.',
    },
  },
  // "<itemId>:<smallerUserId>:<largerUserId>" so each pair has one thread per item.
  key: { type: String, required: true, unique: true },
  lastMessageAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

conversationSchema.index({ participants: 1, lastMessageAt: -1 });
conversationSchema.index({ item: 1 });

conversationSchema.methods.hasParticipant = function hasParticipant(userId) {
  return this.participants.some((p) => String(p._id || p) === String(userId));
};

conversationSchema.methods.otherParticipant = function otherParticipant(userId) {
  return this.participants.find((p) => String(p._id || p) !== String(userId));
};

/** Returns the single conversation for this item and pair of users, creating it if needed. */
conversationSchema.statics.findOrCreate = async function findOrCreate(itemId, userA, userB) {
  const ids = [String(userA), String(userB)].sort();
  const key = `${itemId}:${ids[0]}:${ids[1]}`;
  try {
    return await this.findOneAndUpdate(
      { key },
      { $setOnInsert: { item: itemId, participants: ids, key, lastMessageAt: new Date() } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Two simultaneous upserts can race on the unique key; the loser just reads.
    if (err && err.code === 11000) return this.findOne({ key });
    throw err;
  }
};

module.exports = mongoose.model('Conversation', conversationSchema);

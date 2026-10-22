'use strict';

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

/** Total unread messages across all of a user's conversations. */
async function countUnread(userId) {
  const conversationIds = await Conversation.find({ participants: userId }).distinct('_id');
  if (!conversationIds.length) return 0;
  return Message.countDocuments({
    conversation: { $in: conversationIds },
    sender: { $ne: userId },
    readBy: { $ne: userId },
  });
}

/**
 * For each conversation id: the unread count for this user and the latest message.
 * Returns a Map keyed by conversation id string.
 */
async function summarizeConversations(userId, conversationIds) {
  const summary = new Map();
  if (!conversationIds.length) return summary;
  const uid = toObjectId(userId);

  const rows = await Message.aggregate([
    { $match: { conversation: { $in: conversationIds.map(toObjectId) } } },
    { $sort: { _id: -1 } },
    {
      $group: {
        _id: '$conversation',
        last: { $first: { body: '$body', sender: '$sender', createdAt: '$createdAt' } },
        unread: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ['$sender', uid] }, { $not: [{ $in: [uid, '$readBy'] }] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  rows.forEach((row) => summary.set(String(row._id), { unread: row.unread, last: row.last }));
  return summary;
}

module.exports = { countUnread, summarizeConversations };

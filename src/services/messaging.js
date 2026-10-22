'use strict';

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { countUnread } = require('./unread');
const { truncate } = require('../utils/format');
const { HttpError, isValidId } = require('../utils/http');

const roomFor = (conversationId) => `conversation:${conversationId}`;
const userRoom = (userId) => `user:${userId}`;

/** Trims a message body and caps it at Message.MAX_BODY characters. */
function cleanBody(raw) {
  return String(typeof raw === 'string' ? raw : '')
    .trim()
    .slice(0, Message.MAX_BODY)
    .replace(/[\uD800-\uDBFF]$/, '');
}

/** The JSON shape of a message sent to browsers. */
function serializeMessage(message, senderName) {
  const sender = message.sender && message.sender.name !== undefined ? message.sender : null;
  return {
    id: String(message._id),
    conversationId: String(message.conversation),
    sender: {
      id: String(sender ? sender._id : message.sender),
      firstName: User.firstNameOf(sender ? sender.name : senderName),
    },
    body: message.body,
    readBy: (message.readBy || []).map(String),
    createdAt: message.createdAt,
  };
}

/** Loads a conversation the user participates in, or throws 404. */
async function loadConversationFor(conversationId, userId) {
  if (!isValidId(String(conversationId))) throw new HttpError(404, 'Conversation not found.');
  const conversation = await Conversation.findOne({ _id: conversationId, participants: userId });
  if (!conversation) throw new HttpError(404, 'Conversation not found.');
  return conversation;
}

/**
 * Persists a message, then broadcasts it to the conversation room and sends a
 * notification (with the recipient's new unread total) to the other participant.
 */
async function postMessage({ io, conversationId, senderId, body }) {
  const text = cleanBody(body);
  if (!text) throw new HttpError(422, 'Message cannot be empty.');

  const conversation = await loadConversationFor(conversationId, senderId);
  const message = await Message.create({
    conversation: conversation._id,
    sender: senderId,
    body: text,
    readBy: [senderId],
  });
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();

  const sender = await User.findById(senderId, 'name').lean();
  const payload = serializeMessage(message, sender ? sender.name : '');

  if (io) {
    io.to(roomFor(conversation._id)).emit('message:new', { message: payload });
    const recipientId = String(conversation.otherParticipant(senderId));
    const unreadTotal = await countUnread(recipientId);
    io.to(userRoom(recipientId)).emit('notification', {
      conversationId: String(conversation._id),
      preview: `${payload.sender.firstName}: ${truncate(text, 80)}`,
      unreadTotal,
    });
  }
  return payload;
}

/**
 * Marks every message from the other person as read by this user.
 * Tells the room (for read receipts) and the user's other tabs (for the badge).
 */
async function markRead({ io, conversationId, userId }) {
  const conversation = await loadConversationFor(conversationId, userId);
  const result = await Message.updateMany(
    { conversation: conversation._id, sender: { $ne: userId }, readBy: { $ne: userId } },
    { $addToSet: { readBy: userId } }
  );
  if (io) {
    if (result.modifiedCount > 0) {
      io.to(roomFor(conversation._id)).emit('message:read', {
        conversationId: String(conversation._id),
        userId: String(userId),
      });
    }
    io.to(userRoom(userId)).emit('unread:count', { total: await countUnread(userId) });
  }
  return result.modifiedCount;
}

module.exports = {
  roomFor,
  userRoom,
  cleanBody,
  serializeMessage,
  loadConversationFor,
  postMessage,
  markRead,
};

'use strict';

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
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

/** Loads a conversation the user participates in, or throws 404. */
async function loadConversationFor(conversationId, userId) {
  if (!isValidId(String(conversationId))) throw new HttpError(404, 'Conversation not found.');
  const conversation = await Conversation.findForUser(conversationId, userId);
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
  const row = await Message.create({ conversationId: conversation.id, senderId, body: text });
  await Conversation.touch(conversation.id, row.created_at);
  const payload = Message.serialize(row, conversation.participants);

  if (io) {
    io.to(roomFor(conversation.id)).emit('message:new', { message: payload });
    const recipientId = Conversation.otherParticipant(conversation, senderId);
    if (recipientId) {
      io.to(userRoom(recipientId)).emit('notification', {
        conversationId: conversation.id,
        preview: `${payload.sender.firstName}: ${truncate(text, 80)}`,
        unreadTotal: await countUnread(recipientId),
      });
    }
  }
  return payload;
}

/**
 * Marks every message from the other person as read by this user.
 * Tells the room (for read receipts) and the user's other tabs (for the badge).
 */
async function markRead({ io, conversationId, userId }) {
  const conversation = await loadConversationFor(conversationId, userId);
  const changed = await Message.markRead(conversation.id, userId);
  if (io) {
    if (changed > 0) {
      io.to(roomFor(conversation.id)).emit('message:read', { conversationId: conversation.id, userId: String(userId) });
    }
    io.to(userRoom(userId)).emit('unread:count', { total: await countUnread(userId) });
  }
  return changed;
}

module.exports = { roomFor, userRoom, cleanBody, loadConversationFor, postMessage, markRead };

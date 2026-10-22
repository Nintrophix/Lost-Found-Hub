'use strict';

const User = require('../models/User');
const Conversation = require('../models/Conversation');
const { postMessage, markRead, roomFor, userRoom } = require('../services/messaging');
const { isValidId } = require('../utils/http');

const SEND_LIMIT = 10;
const SEND_WINDOW_MS = 10 * 1000;

/** Calls an acknowledgement callback if the client supplied one. */
function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function errorReply(ack, message) {
  reply(ack, { ok: false, error: message });
}

/** Sliding-window limit of SEND_LIMIT messages per SEND_WINDOW_MS for one socket. */
function allowSend(socket) {
  const now = Date.now();
  const recent = (socket.data.sendTimes || []).filter((t) => now - t < SEND_WINDOW_MS);
  if (recent.length >= SEND_LIMIT) {
    socket.data.sendTimes = recent;
    return false;
  }
  recent.push(now);
  socket.data.sendTimes = recent;
  return true;
}

async function isParticipant(conversationId, userId) {
  if (!isValidId(String(conversationId || ''))) return false;
  return Boolean(await Conversation.exists({ _id: conversationId, participants: userId }));
}

/**
 * Registers all Socket.io handlers.
 * Sockets are authenticated with the shared express-session; each user joins
 * a personal room for notifications and may only join conversation rooms they
 * participate in (checked against the database, never trusted from the client).
 */
function registerChatHandlers(io) {
  io.use(async (socket, next) => {
    try {
      const session = socket.request.session;
      const userId = session && session.userId;
      if (!userId || !(await User.exists({ _id: userId }))) return next(new Error('unauthorized'));
      socket.data.userId = String(userId);
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));

    socket.on('conversation:join', async (payload, ack) => {
      try {
        const conversationId = payload && String(payload.conversationId || '');
        if (!(await isParticipant(conversationId, userId))) return errorReply(ack, 'Conversation not found.');
        socket.join(roomFor(conversationId));
        return reply(ack, { ok: true });
      } catch (err) {
        console.error('conversation:join failed', err);
        return errorReply(ack, 'Could not join the conversation.');
      }
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        if (!allowSend(socket)) {
          return errorReply(ack, 'You are sending messages too quickly. Wait a few seconds and try again.');
        }
        const conversationId = payload && String(payload.conversationId || '');
        if (!(await isParticipant(conversationId, userId))) return errorReply(ack, 'Conversation not found.');
        const message = await postMessage({
          io,
          conversationId,
          senderId: userId,
          body: payload && payload.body,
        });
        return reply(ack, { ok: true, message });
      } catch (err) {
        if (err.status && err.status < 500) return errorReply(ack, err.message);
        console.error('message:send failed', err);
        return errorReply(ack, 'Your message could not be sent. Please try again.');
      }
    });

    socket.on('typing', (payload) => {
      const conversationId = payload && String(payload.conversationId || '');
      const room = roomFor(conversationId);
      // Only relay for rooms this socket was allowed to join.
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('typing', { conversationId, userId, isTyping: Boolean(payload.isTyping) });
    });

    socket.on('message:read', async (payload, ack) => {
      try {
        const conversationId = payload && String(payload.conversationId || '');
        if (!(await isParticipant(conversationId, userId))) return errorReply(ack, 'Conversation not found.');
        await markRead({ io, conversationId, userId });
        return reply(ack, { ok: true });
      } catch (err) {
        console.error('message:read failed', err);
        return errorReply(ack, 'Could not update read status.');
      }
    });
  });
}

module.exports = { registerChatHandlers };

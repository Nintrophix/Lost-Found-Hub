'use strict';

const Item = require('../models/Item');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { errorMap } = require('../middleware/validate');
const { countUnread } = require('../services/unread');
const { postMessage, markRead, loadConversationFor } = require('../services/messaging');
const { HttpError, isValidId } = require('../utils/http');

const PAGE_SIZE = 50;

/** Loads one page of messages (newest PAGE_SIZE before a given id), oldest first. */
async function loadMessages(conversation, { before = null, limit = PAGE_SIZE } = {}) {
  const { rows, hasMore } = await Message.page(conversation.id, { before, limit });
  return { messages: rows.map((row) => Message.serialize(row, conversation.participants)), hasMore };
}

/** Conversations for a user with the other person, item, unread count and last message (one query). */
function listConversations(userId, limit = null) {
  return Conversation.listForUser(userId, limit);
}

exports.listConversations = listConversations;

exports.index = async (req, res) => {
  const conversations = await listConversations(req.session.userId);
  res.render('pages/chat/index', {
    title: 'Messages',
    description: 'Your private conversations with finders and owners.',
    noindex: true,
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Messages' }],
    conversations,
  });
};

/** "Message reporter": opens (or reuses) the conversation about this item. */
exports.start = async (req, res) => {
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  if (!isValidId(itemId)) throw new HttpError(404, 'Item not found.');
  const item = await Item.findById(itemId);
  if (!item) throw new HttpError(404, 'Item not found.');
  if (String(item.reporterId) === String(req.session.userId)) {
    req.flash('error', 'You reported this item. Conversations with you appear in your messages.');
    return res.redirect(`/items/${item._id}`);
  }
  const conversation = await Conversation.findOrCreate(item._id, req.session.userId, item.reporterId);
  return res.redirect(`/chat/${conversation._id}`);
};

/** Loads a lost item the current user can respond to with "I found this". */
async function loadFoundable(itemId, userId) {
  if (!isValidId(itemId)) throw new HttpError(404, 'Item not found.');
  const item = await Item.findById(itemId);
  if (!item) throw new HttpError(404, 'Item not found.');
  let problem = null;
  if (item.type !== 'lost') problem = 'This is a found item. If it is yours, use "Claim this item".';
  else if (String(item.reporterId) === String(userId)) problem = 'You reported this item.';
  else if (item.status === 'resolved') problem = 'This item was already returned to its owner.';
  return { item, problem };
}

function renderFoundForm(res, { item, values = {}, errors = {}, status = 200 }) {
  return res.status(status).render('pages/items/found', {
    title: `I found: ${item.title}`,
    description: 'Tell the owner where and when you found their item.',
    noindex: true,
    breadcrumbs: [
      { name: 'Home', url: '/' },
      { name: 'Browse items', url: '/items' },
      { name: item.title, url: `/items/${item._id}` },
      { name: 'I found this' },
    ],
    item,
    values,
    errors,
  });
}

exports.showFound = async (req, res) => {
  const { item, problem } = await loadFoundable(req.params.id, req.session.userId);
  if (problem) {
    req.flash('error', problem);
    return res.redirect(`/items/${item._id}`);
  }
  return renderFoundForm(res, { item });
};

exports.found = async (req, res) => {
  const { item, problem } = await loadFoundable(req.params.id, req.session.userId);
  if (problem) {
    req.flash('error', problem);
    return res.redirect(`/items/${item._id}`);
  }
  const values = { message: typeof req.body.message === 'string' ? req.body.message : '' };
  if (req.formErrors) {
    return renderFoundForm(res, { item, values, errors: errorMap(req.formErrors), status: 422 });
  }

  const conversation = await Conversation.findOrCreate(item._id, req.session.userId, item.reporterId);
  await postMessage({
    io: req.app.get('io'),
    conversationId: conversation._id,
    senderId: req.session.userId,
    body: values.message,
  });
  req.flash('success', 'Message sent to the owner. Keep chatting here to arrange the hand-off.');
  return res.redirect(`/chat/${conversation._id}`);
};

exports.room = async (req, res) => {
  const userId = String(req.session.userId);
  const conversation = await loadConversationFor(req.params.id, userId);

  // Opening the page reads the thread; refresh the header badge to match.
  const [, detail, history] = await Promise.all([
    markRead({ io: req.app.get('io'), conversationId: conversation.id, userId }),
    Conversation.roomDetail(conversation.id),
    loadMessages(conversation),
  ]);
  res.locals.unreadCount = await countUnread(userId);

  const item = detail.item_id
    ? { _id: detail.item_id, title: detail.title, type: detail.type, status: detail.status, images: detail.images, reporter: detail.reporter_id }
    : null;
  const otherIsA = detail.a_id !== userId;
  const other = { id: otherIsA ? detail.a_id : detail.b_id, name: otherIsA ? detail.a_name : detail.b_name };

  res.render('pages/chat/room', {
    title: item ? `Chat about ${item.title}` : 'Conversation',
    description: 'Private conversation between the finder and the owner.',
    noindex: true,
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Messages', url: '/chat' }, { name: item ? item.title : 'Conversation' }],
    conversationId: conversation.id,
    item,
    other: { id: other.id || '', firstName: other.name ? User.firstNameOf(other.name) : 'Former member' },
    // Receipts are only shown on the viewer's own messages, which markRead does not change.
    messages: history.messages,
    hasMore: history.hasMore,
    maxBody: Message.MAX_BODY,
    pageScripts: ['/js/chat.js'],
  });
};

/** No-JavaScript fallback for sending a message. */
exports.send = async (req, res) => {
  const conversation = await loadConversationFor(req.params.id, req.session.userId);
  if (req.formErrors) {
    req.flash('error', req.formErrors[0].message);
    return res.redirect(`/chat/${conversation._id}`);
  }
  await postMessage({
    io: req.app.get('io'),
    conversationId: conversation._id,
    senderId: req.session.userId,
    body: req.body.body,
  });
  return res.redirect(`/chat/${conversation._id}#latest`);
};

/** GET /api/conversations/:id/messages?before=&limit= for "Load older messages". */
exports.apiMessages = async (req, res) => {
  const conversation = await loadConversationFor(req.params.id, req.session.userId);
  const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : PAGE_SIZE;
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  res.json(await loadMessages(conversation, { before, limit }));
};

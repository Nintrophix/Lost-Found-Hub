'use strict';

const Item = require('../models/Item');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { errorMap } = require('../middleware/validate');
const { summarizeConversations, countUnread } = require('../services/unread');
const {
  postMessage,
  markRead,
  serializeMessage,
  loadConversationFor,
} = require('../services/messaging');
const { HttpError, isValidId } = require('../utils/http');

const PAGE_SIZE = 50;

/** Loads one page of messages (newest PAGE_SIZE before a given id), oldest first. */
async function loadMessages(conversationId, { before, limit = PAGE_SIZE } = {}) {
  const filter = { conversation: conversationId };
  if (before) filter._id = { $lt: before };
  const rows = await Message.find(filter).sort({ _id: -1 }).limit(limit + 1).populate('sender', 'name').lean();
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse().map((m) => serializeMessage(m)), hasMore };
}

/** Conversations for a user with the other person, item, unread count and last message. */
async function listConversations(userId, limit = 0) {
  let query = Conversation.find({ participants: userId })
    .sort({ lastMessageAt: -1 })
    .populate('item', 'title type status images')
    .populate('participants', 'name')
    .lean();
  if (limit) query = query.limit(limit);
  const conversations = await query;
  const summary = await summarizeConversations(userId, conversations.map((c) => c._id));

  return conversations.map((c) => {
    const other = c.participants.find((p) => String(p._id) !== String(userId));
    const info = summary.get(String(c._id)) || { unread: 0, last: null };
    return {
      id: String(c._id),
      item: c.item,
      otherFirstName: other ? User.firstNameOf(other.name) : 'Former member',
      unread: info.unread,
      last: info.last,
      lastIsMine: Boolean(info.last && String(info.last.sender) === String(userId)),
      lastMessageAt: c.lastMessageAt,
    };
  });
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
  const item = await Item.findById(itemId).lean();
  if (!item) throw new HttpError(404, 'Item not found.');
  if (String(item.reporter) === String(req.session.userId)) {
    req.flash('error', 'You reported this item. Conversations with you appear in your messages.');
    return res.redirect(`/items/${item._id}`);
  }
  const conversation = await Conversation.findOrCreate(item._id, req.session.userId, item.reporter);
  return res.redirect(`/chat/${conversation._id}`);
};

/** Loads a lost item the current user can respond to with "I found this". */
async function loadFoundable(itemId, userId) {
  if (!isValidId(itemId)) throw new HttpError(404, 'Item not found.');
  const item = await Item.findById(itemId).lean();
  if (!item) throw new HttpError(404, 'Item not found.');
  let problem = null;
  if (item.type !== 'lost') problem = 'This is a found item. If it is yours, use "Claim this item".';
  else if (String(item.reporter) === String(userId)) problem = 'You reported this item.';
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

  const conversation = await Conversation.findOrCreate(item._id, req.session.userId, item.reporter);
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
  const userId = req.session.userId;
  const conversation = await loadConversationFor(req.params.id, userId);
  await conversation.populate([
    { path: 'item', select: 'title type status images reporter' },
    { path: 'participants', select: 'name' },
  ]);

  // Opening the page reads the thread; refresh the header badge to match.
  await markRead({ io: req.app.get('io'), conversationId: conversation._id, userId });
  res.locals.unreadCount = await countUnread(userId);

  const other = conversation.participants.find((p) => String(p._id) !== String(userId));
  const { messages, hasMore } = await loadMessages(conversation._id);
  const item = conversation.item;

  res.render('pages/chat/room', {
    title: item ? `Chat about ${item.title}` : 'Conversation',
    description: 'Private conversation between the finder and the owner.',
    noindex: true,
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Messages', url: '/chat' }, { name: item ? item.title : 'Conversation' }],
    conversationId: String(conversation._id),
    item,
    other: { id: other ? String(other._id) : '', firstName: other ? User.firstNameOf(other.name) : 'Former member' },
    messages,
    hasMore,
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
  const before = typeof req.query.before === 'string' ? req.query.before : undefined;
  const page = await loadMessages(conversation._id, { before, limit });
  res.json(page);
};

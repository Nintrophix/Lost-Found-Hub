'use strict';

const Item = require('../models/Item');
const Claim = require('../models/Claim');
const Conversation = require('../models/Conversation');
const { errorMap } = require('../middleware/validate');
const { userRoom } = require('../services/messaging');
const { countUnread } = require('../services/unread');
const { truncate } = require('../utils/format');
const { HttpError, isValidId } = require('../utils/http');

/** Loads an item and checks the viewer may claim it. Returns { item, problem }. */
async function loadClaimable(itemId, userId) {
  if (!isValidId(itemId)) throw new HttpError(404, 'Item not found.');
  const item = await Item.findById(itemId).lean();
  if (!item) throw new HttpError(404, 'Item not found.');

  let problem = null;
  if (item.type !== 'found') problem = 'Only found items can be claimed. For lost items, use "I found this".';
  else if (String(item.reporter) === String(userId)) problem = 'You reported this item, so you cannot claim it.';
  else if (item.status !== 'open') problem = 'This item is no longer open for claims.';
  else if (await Claim.exists({ item: item._id, claimant: userId, status: 'pending' })) {
    problem = 'You already have a pending claim on this item. The finder will review it soon.';
  }
  return { item, problem };
}

function renderClaimForm(res, { item, values = {}, errors = {}, status = 200 }) {
  return res.status(status).render('pages/claims/new', {
    title: `Claim ${item.title}`,
    description: 'Prove this item is yours by describing details only the owner would know.',
    noindex: true,
    breadcrumbs: [
      { name: 'Home', url: '/' },
      { name: 'Browse items', url: '/items' },
      { name: item.title, url: `/items/${item._id}` },
      { name: 'Claim' },
    ],
    item,
    values,
    errors,
  });
}

/** Notifies a user in real time (toast plus current unread total). */
async function notify(req, userId, conversationId, preview) {
  const io = req.app.get('io');
  if (!io) return;
  io.to(userRoom(userId)).emit('notification', {
    conversationId: conversationId ? String(conversationId) : null,
    preview,
    unreadTotal: await countUnread(userId),
  });
}

exports.showNew = async (req, res) => {
  const { item, problem } = await loadClaimable(req.params.id, req.session.userId);
  if (problem) {
    req.flash('error', problem);
    return res.redirect(`/items/${item._id}`);
  }
  return renderClaimForm(res, { item });
};

exports.create = async (req, res) => {
  const { item, problem } = await loadClaimable(req.params.id, req.session.userId);
  if (problem) {
    req.flash('error', problem);
    return res.redirect(`/items/${item._id}`);
  }
  const values = { message: typeof req.body.message === 'string' ? req.body.message : '' };
  if (req.formErrors) {
    return renderClaimForm(res, { item, values, errors: errorMap(req.formErrors), status: 422 });
  }

  try {
    await Claim.create({ item: item._id, claimant: req.session.userId, message: values.message });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  await notify(req, item.reporter, null, `New claim on "${truncate(item.title, 50)}". Review it on your dashboard.`);
  req.flash('success', 'Your claim was sent. The finder will compare your details and reply.');
  return res.redirect(`/items/${item._id}`);
};

/** Lists claims I made and claims on items I reported. */
exports.index = async (req, res) => {
  const userId = req.session.userId;
  const myItemIds = await Item.find({ reporter: userId }).distinct('_id');
  const [madeByMe, onMyItems] = await Promise.all([
    Claim.find({ claimant: userId }).sort({ createdAt: -1 }).populate('item', 'title type status').lean(),
    Claim.find({ item: { $in: myItemIds } })
      .sort({ createdAt: -1 })
      .populate('item', 'title type status')
      .populate('claimant', 'name')
      .lean(),
  ]);

  res.render('pages/claims/index', {
    title: 'Claims',
    description: 'Claims you have made and claims other people made on items you reported.',
    noindex: true,
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Dashboard', url: '/dashboard' }, { name: 'Claims' }],
    madeByMe,
    pendingOnMyItems: onMyItems.filter((c) => c.status === 'pending'),
    reviewedOnMyItems: onMyItems.filter((c) => c.status !== 'pending'),
  });
};

/** Loads a claim whose item the current user reported. */
async function loadOwnClaim(claimId, userId) {
  if (!isValidId(claimId)) throw new HttpError(404, 'Claim not found.');
  const claim = await Claim.findById(claimId).populate('item');
  if (!claim || !claim.item) throw new HttpError(404, 'Claim not found.');
  if (String(claim.item.reporter) !== String(userId)) {
    throw new HttpError(403, 'Only the person who reported this item can review its claims.');
  }
  return claim;
}

function backTo(req) {
  return req.body.returnTo === 'claims' ? '/claims' : '/dashboard';
}

/**
 * Approving a claim marks the item as claimed, rejects the other pending
 * claims and opens a conversation between the reporter and the claimant.
 */
exports.approve = async (req, res) => {
  const userId = req.session.userId;
  const claim = await loadOwnClaim(req.params.id, userId);
  if (claim.status !== 'pending') {
    req.flash('error', 'This claim was already reviewed.');
    return res.redirect(backTo(req));
  }

  const item = await Item.findOneAndUpdate(
    { _id: claim.item._id, status: 'open' },
    { status: 'claimed' },
    { new: true }
  );
  if (!item) {
    req.flash('error', 'This item is no longer open, so the claim cannot be approved.');
    return res.redirect(backTo(req));
  }

  await Claim.updateOne({ _id: claim._id, status: 'pending' }, { status: 'approved' });
  await Claim.updateMany({ item: item._id, _id: { $ne: claim._id }, status: 'pending' }, { status: 'rejected' });
  const conversation = await Conversation.findOrCreate(item._id, userId, claim.claimant);

  await notify(
    req,
    claim.claimant,
    conversation._id,
    `Your claim on "${truncate(item.title, 50)}" was approved. Open the chat to arrange the hand-off.`
  );
  req.flash('success', 'Claim approved. Use this conversation to agree on a time and place for the hand-off.');
  return res.redirect(`/chat/${conversation._id}`);
};

exports.reject = async (req, res) => {
  const claim = await loadOwnClaim(req.params.id, req.session.userId);
  if (claim.status !== 'pending') {
    req.flash('error', 'This claim was already reviewed.');
    return res.redirect(backTo(req));
  }
  await Claim.updateOne({ _id: claim._id, status: 'pending' }, { status: 'rejected' });
  await notify(req, claim.claimant, null, `Your claim on "${truncate(claim.item.title, 50)}" was not approved.`);
  req.flash('success', 'Claim rejected.');
  return res.redirect(backTo(req));
};

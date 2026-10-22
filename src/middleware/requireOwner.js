'use strict';

const Item = require('../models/Item');
const { HttpError, asyncHandler, isValidId } = require('../utils/http');

/**
 * Loads the item from :id and allows the request only for its reporter or an admin.
 * Ownership is always checked against the logged-in session, never request data.
 * The loaded item is available as req.item.
 */
module.exports = asyncHandler(async function requireOwner(req, res, next) {
  if (!isValidId(req.params.id)) throw new HttpError(404, 'Item not found.');

  const item = await Item.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Item not found.');

  const isReporter = String(item.reporter) === String(req.session.userId);
  const isAdmin = res.locals.currentUser && res.locals.currentUser.role === 'admin';
  if (!isReporter && !isAdmin) {
    throw new HttpError(403, 'Only the person who reported this item can change it.');
  }

  req.item = item;
  return next();
});

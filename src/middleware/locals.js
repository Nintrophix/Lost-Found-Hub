'use strict';

const User = require('../models/User');
const Item = require('../models/Item');
const { countUnread } = require('../services/unread');
const site = require('../config/site');
const config = require('../config/env');
const format = require('../utils/format');
const icons = require('../utils/icons');
const { asyncHandler } = require('../utils/http');

/**
 * Loads the logged-in user (if any) and exposes it as res.locals.currentUser.
 * A session pointing at a deleted user is cleaned up.
 */
const loadUser = asyncHandler(async (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.unreadCount = 0;

  const userId = req.session && req.session.userId;
  if (!userId) return next();

  const user = await User.findById(userId).lean();
  if (!user) {
    delete req.session.userId;
    return next();
  }

  res.locals.currentUser = {
    id: String(user._id),
    name: user.name,
    firstName: User.firstNameOf(user.name),
    email: user.email,
    role: user.role,
  };

  // The header badge needs the unread count on every rendered page,
  // including forms re-rendered after a POST with validation errors.
  if (!req.path.startsWith('/api/')) {
    res.locals.unreadCount = await countUnread(user._id);
  }
  return next();
});

/**
 * Values every template can rely on: site identity, current path, formatting
 * helpers and labels. Page metadata (title, description, breadcrumbs,
 * canonical path, robots, JSON-LD) is passed per render by controllers.
 */
function viewLocals(req, res, next) {
  res.locals.siteName = site.SITE_NAME;
  res.locals.siteShortName = site.SITE_SHORT_NAME;
  res.locals.siteOrigin = site.originFor(req);
  res.locals.currentPath = req.path;
  res.locals.fmt = format;
  res.locals.icon = (name, cls) => icons.svg(name, cls ? { cls: `icon ${cls}` } : undefined);
  res.locals.categoryLabels = Item.CATEGORY_LABELS;
  res.locals.statusLabels = Item.STATUS_LABELS;
  res.locals.categories = Item.CATEGORIES;
  res.locals.year = new Date().getFullYear();
  res.locals.maxUploadMb = config.maxUploadMb;
  // Safe defaults in case an error page renders before later middleware ran.
  res.locals.currentUser = null;
  res.locals.unreadCount = 0;
  res.locals.csrfToken = () => '';
  res.locals.takeFlash = () => [];
  next();
}

module.exports = { loadUser, viewLocals };

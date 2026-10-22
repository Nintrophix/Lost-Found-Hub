'use strict';

const { HttpError, isApiRequest } = require('../utils/http');

/**
 * Lets the request through only when a valid user is logged in.
 * Pages redirect to /login (remembering where to come back to); the API returns 401.
 */
module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.userId && res.locals.currentUser) return next();

  if (isApiRequest(req)) {
    return next(new HttpError(401, 'You need to log in to do that.'));
  }

  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.flash('error', 'Please log in to continue.');
  return res.redirect('/login');
};

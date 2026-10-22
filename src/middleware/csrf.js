'use strict';

const crypto = require('crypto');
const { HttpError } = require('../utils/http');
const { removeUploadedFiles } = require('../services/files');

/**
 * Synchronizer-token CSRF protection.
 * A random token lives in the session; forms send it as `_csrf` and fetch()
 * calls send it in the `X-CSRF-Token` header.
 *
 * Multipart (file upload) bodies are only parsed after Multer runs, so those
 * routes are allow-listed here and call `verifyCsrfAfterUpload` themselves.
 * Any other multipart request is checked here and fails without a token.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UPLOAD_ROUTES = [
  { method: 'POST', pattern: /^\/items$/ },
  { method: 'POST', pattern: /^\/items\/[a-f0-9]{24}\/edit$/i },
  { method: 'POST', pattern: /^\/api\/items$/ },
  { method: 'PATCH', pattern: /^\/api\/items\/[a-f0-9]{24}$/i },
];

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function tokensMatch(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function providedToken(req) {
  const header = req.get('x-csrf-token');
  if (header) return header;
  return req.body && typeof req.body._csrf === 'string' ? req.body._csrf : undefined;
}

function isMultipart(req) {
  return (req.get('content-type') || '').toLowerCase().startsWith('multipart/form-data');
}

function isUploadRoute(req) {
  return UPLOAD_ROUTES.some((r) => r.method === req.method && r.pattern.test(req.path));
}

const invalidTokenError = () =>
  new HttpError(403, 'Your form expired or was sent from another site. Reload the page and try again.');

function csrfProtection(req, res, next) {
  // Lazily created so anonymous visitors who never see a form get no session.
  res.locals.csrfToken = () => ensureToken(req);

  if (SAFE_METHODS.has(req.method)) return next();

  if (isMultipart(req) && isUploadRoute(req) && !req.get('x-csrf-token')) {
    req.csrfDeferred = true;
    return next();
  }

  if (!tokensMatch(req.session && req.session.csrfToken, providedToken(req))) {
    return next(invalidTokenError());
  }
  return next();
}

/** Runs after Multer on upload routes; removes any written files if the token is wrong. */
async function verifyCsrfAfterUpload(req, res, next) {
  if (!req.csrfDeferred) return next();
  if (tokensMatch(req.session && req.session.csrfToken, providedToken(req))) return next();
  await removeUploadedFiles(req.files);
  return next(invalidTokenError());
}

module.exports = { csrfProtection, verifyCsrfAfterUpload };

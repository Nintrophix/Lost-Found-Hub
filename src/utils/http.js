'use strict';

const mongoose = require('mongoose');

/** An error that carries an HTTP status and optional validation details. */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details) this.details = details;
  }
}

/** Wraps an async route handler so rejected promises reach the error handler. */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/');
}

function isValidId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value) && mongoose.isValidObjectId(value);
}

/** Only allow same-site relative paths as post-login destinations. */
function safeReturnPath(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

module.exports = { HttpError, asyncHandler, isApiRequest, isValidId, safeReturnPath };

'use strict';

const rateLimit = require('express-rate-limit');
const { HttpError } = require('../utils/http');

function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => next(new HttpError(429, message)),
  });
}

// Login and registration attempts per IP.
const authLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many login or sign-up attempts. Please wait 15 minutes and try again.',
});

// General API traffic per IP (live search sends a request per pause in typing).
const apiLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: 'Too many requests. Please slow down and try again shortly.',
});

// Creating listings, claims and messages over HTTP.
const writeLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: 'You have submitted a lot in the last hour. Please try again later.',
});

module.exports = { authLimiter, apiLimiter, writeLimiter };

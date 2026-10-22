'use strict';

const session = require('express-session');
const MongoStore = require('connect-mongo');
const config = require('./env');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Builds the express-session middleware backed by MongoDB.
 * The same instance is shared with Socket.io so sockets are authenticated
 * with the user's existing login session.
 */
function createSessionMiddleware() {
  return session({
    name: 'lf.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: config.mongoUri,
      collectionName: 'sessions',
      ttl: SEVEN_DAYS_MS / 1000,
      touchAfter: 24 * 60 * 60,
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: SEVEN_DAYS_MS,
    },
  });
}

module.exports = { createSessionMiddleware };

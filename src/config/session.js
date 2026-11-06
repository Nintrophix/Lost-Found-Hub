'use strict';

const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const config = require('./env');
const { getPool } = require('./db');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Builds the express-session middleware backed by Postgres (table user_sessions,
 * created by the migration). The same instance is shared with Socket.io so
 * sockets are authenticated with the user's existing login session.
 */
function createSessionMiddleware() {
  return session({
    name: 'lf.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new PgSession({
      pool: getPool(),
      tableName: 'user_sessions',
      ttl: SEVEN_DAYS_MS / 1000,
      // Expired sessions are swept every 15 minutes.
      pruneSessionInterval: 15 * 60,
      // The cookie is not rolling, so refreshing the row's expiry on every request
      // would only add a database write per page view.
      disableTouch: true,
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

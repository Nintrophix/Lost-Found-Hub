'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');

const config = require('./config/env');
const { createSessionMiddleware } = require('./config/session');
const { UPLOAD_DIR } = require('./config/multer');
const flash = require('./middleware/flash');
const { csrfProtection } = require('./middleware/csrf');
const { loadUser, viewLocals } = require('./middleware/locals');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const ROOT = path.join(__dirname, '..');

/**
 * The Socket.io browser client, served from our own origin without its
 * sourceMappingURL comment so no source maps are exposed in production.
 */
function loadSocketClient() {
  // The package does not export client-dist, so locate it from the package's main entry (dist/index.js).
  const packageRoot = path.join(path.dirname(require.resolve('socket.io')), '..');
  const file = path.join(packageRoot, 'client-dist', 'socket.io.min.js');
  return fs.readFileSync(file, 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/gm, '');
}

/**
 * Builds the Express app. Returns the session middleware too, so the
 * Socket.io server can share the exact same sessions.
 */
function createApp() {
  const app = express();
  const sessionMiddleware = createSessionMiddleware();

  // Behind a reverse proxy (required for a custom domain with HTTPS) trust its headers.
  if (config.isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // "simple" parsing keeps query values as strings/arrays, never nested objects.
  app.set('query parser', 'simple');

  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.set('layout', 'layouts/main');
  app.use(expressLayouts);

  // Redirect any other hostname (www, raw IP, old domain) to the canonical custom domain.
  if (config.isProd && config.siteUrl) {
    const canonical = new URL(config.siteUrl);
    app.use((req, res, next) => {
      if (req.path === '/healthz' || req.hostname === canonical.hostname) return next();
      return res.redirect(301, `${canonical.origin}${req.originalUrl}`);
    });
  }

  // Per-request nonce for the few inline <script type="application/ld+json"> blocks.
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
          styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      strictTransportSecurity: config.isProd,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // Static assets. Files are served as-is: there are no build steps or source maps.
  const staticOptions = { maxAge: config.isProd ? '7d' : 0, index: false, dotfiles: 'ignore' };
  app.use(express.static(path.join(ROOT, 'public'), staticOptions));
  app.use('/uploads', express.static(UPLOAD_DIR, { ...staticOptions, maxAge: config.isProd ? '30d' : 0 }));

  const socketClient = loadSocketClient();
  app.get('/js/vendor/socket.io.min.js', (req, res) => {
    res.type('application/javascript');
    if (config.isProd) res.set('Cache-Control', 'public, max-age=604800');
    res.send(socketClient);
  });

  app.use(viewLocals);
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware);
  app.use(flash);
  app.use(loadUser);
  app.use(csrfProtection);

  app.use('/', require('./routes/pages'));
  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/claims'));
  app.use('/items', require('./routes/items'));
  app.use('/chat', require('./routes/chat'));
  app.use('/api', require('./routes/api'));

  app.use(notFound);
  app.use(errorHandler);

  return { app, sessionMiddleware };
}

module.exports = { createApp };

'use strict';

const http = require('http');
const { Server } = require('socket.io');

const config = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const { createApp } = require('./app');
const { registerChatHandlers } = require('./sockets/chat');

/**
 * Only accept Socket.io connections from our own pages (protects against
 * cross-site WebSocket hijacking, since WebSockets are not covered by CORS).
 */
function sameOrigin(req, callback) {
  const origin = req.headers.origin;
  if (!origin) return callback(null, true);
  try {
    const { host, origin: normalized } = new URL(origin);
    const allowed = host === req.headers.host || (config.siteUrl && normalized === config.siteUrl);
    return callback(null, Boolean(allowed));
  } catch {
    return callback(null, false);
  }
}

async function start() {
  await connectDB();

  const { app, sessionMiddleware } = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    allowRequest: sameOrigin,
  });
  io.engine.use(sessionMiddleware);
  registerChatHandlers(io);
  app.set('io', io);

  server.listen(config.port, () => {
    console.log(`Campus Lost & Found Hub listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down.`);
    io.close();
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

'use strict';

/**
 * Minimal session flash messages.
 * req.flash(type, message) queues a message. Messages are only taken out of
 * the session when a page actually renders them (via takeFlash() in the
 * layout), so redirects and API calls never lose them.
 */
module.exports = function flash(req, res, next) {
  req.flash = (type, message) => {
    if (!req.session) return;
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message });
  };

  res.locals.takeFlash = () => {
    if (!req.session || !req.session.flash) return [];
    const messages = req.session.flash;
    delete req.session.flash;
    return messages;
  };
  next();
};

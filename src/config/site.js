'use strict';

/**
 * Site identity and helpers for building absolute URLs.
 * The public origin comes from SITE_URL (your custom domain). In development,
 * when SITE_URL is not set, the request host is used instead.
 */
const config = require('./env');

const SITE_NAME = 'Campus Lost & Found Hub';
const SITE_SHORT_NAME = 'Lost & Found Hub';
const SITE_DESCRIPTION =
  'Report lost or found items on campus, search listings by place, date and category, ' +
  'and arrange the hand-off with the finder in a private chat.';

function originFor(req) {
  return config.siteUrl || `${req.protocol}://${req.get('host')}`;
}

function absoluteUrl(req, path = '/') {
  return originFor(req) + path;
}

module.exports = { SITE_NAME, SITE_SHORT_NAME, SITE_DESCRIPTION, originFor, absoluteUrl };

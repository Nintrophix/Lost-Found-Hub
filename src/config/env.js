'use strict';

/**
 * Loads .env and exposes a single, validated configuration object.
 * Development gets safe local defaults so `npm run dev` works with a local
 * MongoDB; production refuses to start without the required values.
 */
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

function readSiteUrl() {
  const raw = (process.env.SITE_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readMaxUploadMb() {
  const value = Number(process.env.MAX_UPLOAD_MB);
  return Number.isFinite(value) && value > 0 && value <= 50 ? value : 5;
}

const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  mongoUri:
    process.env.MONGODB_URI || (isProd ? '' : 'mongodb://127.0.0.1:27017/campus-lost-found'),
  sessionSecret:
    process.env.SESSION_SECRET || (isProd ? '' : 'dev-only-secret-change-me-before-deploying'),
  maxUploadMb: readMaxUploadMb(),
  siteUrl: readSiteUrl(),
  contactEmail: (process.env.SITE_CONTACT_EMAIL || '').trim(),
};

if (isProd) {
  const missing = [];
  if (!config.mongoUri) missing.push('MONGODB_URI');
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    missing.push('SESSION_SECRET (at least 32 characters)');
  }
  if (!config.siteUrl) missing.push('SITE_URL');
  if (missing.length) {
    throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  }
}

module.exports = config;

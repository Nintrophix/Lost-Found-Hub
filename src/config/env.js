'use strict';

/**
 * Loads .env and exposes a single, validated configuration object.
 * Development gets safe local defaults so `npm run dev` works with a local
 * Postgres; production refuses to start without the required values.
 */
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

function readSiteUrl() {
  // Render sets RENDER_EXTERNAL_URL (https://<service>.onrender.com); SITE_URL wins once a custom domain is set.
  const raw = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readOrigin(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

function readNumber(raw, fallback, min, max) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  // Supabase: Project Settings > Database > Connection string ("Session pooler" for long-running servers).
  databaseUrl:
    process.env.DATABASE_URL || (isProd ? '' : 'postgres://postgres:postgres@127.0.0.1:5432/lostfound'),
  // Small pool: Supabase's free tier allows a limited number of pooled connections.
  dbPoolMax: readNumber(process.env.DATABASE_POOL_MAX, 5, 1, 50),
  sessionSecret:
    process.env.SESSION_SECRET || (isProd ? '' : 'dev-only-secret-change-me-before-deploying'),
  maxUploadMb: readNumber(process.env.MAX_UPLOAD_MB, 5, 0.1, 50),
  siteUrl: readSiteUrl(),
  contactEmail: (process.env.SITE_CONTACT_EMAIL || '').trim(),
  // Supabase Storage for uploaded photos. Without these, photos are saved to the local uploads/ folder.
  supabaseUrl: readOrigin(process.env.SUPABASE_URL),
  supabaseServiceKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  storageBucket: (process.env.SUPABASE_STORAGE_BUCKET || 'item-images').trim(),
};

config.useSupabaseStorage = Boolean(config.supabaseUrl && config.supabaseServiceKey);

if (isProd) {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    missing.push('SESSION_SECRET (at least 32 characters)');
  }
  if (missing.length) {
    throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  }
  // Without SITE_URL the site still runs, using the address it is visited on for
  // canonical links and the sitemap. Set it once the final domain is known.
  if (!config.siteUrl) {
    console.warn('SITE_URL is not set: canonical links will use the request host. Set SITE_URL to your public address.');
  }
  if (!config.useSupabaseStorage) {
    console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: uploaded photos are stored on local disk and are lost when the host restarts.');
  }
}

module.exports = config;

'use strict';

/**
 * Where item photos live.
 *
 * - With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set, photos go to a public
 *   Supabase Storage bucket (created on first start) and are served from
 *   Supabase's CDN, so they survive host restarts and redeploys.
 * - Otherwise they are written to the local uploads/ folder (development).
 *
 * Items store each photo's public URL. Seed images (/img/seed/...) are part of
 * the code and are never deleted here.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');
const { UPLOAD_DIR, ALLOWED_TYPES, MAX_FILE_BYTES } = require('../config/multer');

let client = null;

function supabase() {
  if (!client) {
    // Required lazily so local development does not need the package configured.
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

const publicPrefix = () => `${config.supabaseUrl}/storage/v1/object/public/${config.storageBucket}/`;

/** Creates the public photo bucket if it does not exist yet. */
async function ensureBucket() {
  if (!config.useSupabaseStorage) return;
  const storage = supabase().storage;
  const { data, error } = await storage.getBucket(config.storageBucket);
  if (data && !error) return;
  const { error: createError } = await storage.createBucket(config.storageBucket, {
    public: true,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: Object.keys(ALLOWED_TYPES),
  });
  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(`Could not create the Supabase Storage bucket "${config.storageBucket}": ${createError.message}`);
  }
  console.log(`Created public Supabase Storage bucket "${config.storageBucket}".`);
}

async function saveOne(file) {
  const name = `${crypto.randomUUID()}${ALLOWED_TYPES[file.mimetype].ext}`;
  if (config.useSupabaseStorage) {
    const key = `items/${name}`;
    const { error } = await supabase()
      .storage.from(config.storageBucket)
      // Names are random and never reused, so the CDN can cache them for a year.
      .upload(key, file.buffer, { contentType: file.mimetype, cacheControl: '31536000', upsert: false });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    return publicPrefix() + key;
  }
  await fs.writeFile(path.join(UPLOAD_DIR, name), file.buffer, { flag: 'wx' });
  return `/uploads/${name}`;
}

/**
 * Saves validated uploads (Multer memory files) and returns their public URLs.
 * If any upload fails, the ones already saved are removed before the error is thrown.
 */
async function saveImages(files = []) {
  const saved = [];
  try {
    for (const file of files) saved.push(await saveOne(file));
    return saved;
  } catch (err) {
    await removeImages(saved);
    throw err;
  }
}

/** Deletes stored photos by URL. Unknown URLs (including seed images) are ignored. */
async function removeImages(urls = []) {
  const keys = [];
  const localFiles = [];
  urls.forEach((url) => {
    if (typeof url !== 'string') return;
    if (config.useSupabaseStorage && url.startsWith(publicPrefix())) {
      keys.push(url.slice(publicPrefix().length));
    } else if (url.startsWith('/uploads/')) {
      const name = path.basename(url);
      if (name && name !== '.gitkeep') localFiles.push(path.join(UPLOAD_DIR, name));
    }
  });

  if (keys.length) {
    const { error } = await supabase().storage.from(config.storageBucket).remove(keys);
    if (error) console.error('Could not delete photos from Supabase Storage:', error.message);
  }
  await Promise.all(
    localFiles.map((file) =>
      fs.unlink(file).catch((err) => {
        if (err.code !== 'ENOENT') console.error(`Could not delete upload ${file}:`, err.message);
      })
    )
  );
}

/** Origin to allow in the Content Security Policy for photos, if Supabase Storage is used. */
function imageOrigin() {
  return config.useSupabaseStorage ? config.supabaseUrl : null;
}

module.exports = { ensureBucket, saveImages, removeImages, imageOrigin, supabase };

'use strict';

const fs = require('fs/promises');
const path = require('path');
const { UPLOAD_DIR } = require('../config/multer');

/** Maps a stored "/uploads/<name>" path to its file on disk, refusing anything outside UPLOAD_DIR. */
function diskPathFor(publicPath) {
  const name = path.basename(String(publicPath || ''));
  if (!name || name === '.' || name === '..' || name === '.gitkeep') return null;
  return path.join(UPLOAD_DIR, name);
}

async function unlinkQuietly(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not delete upload ${filePath}:`, err.message);
  }
}

/** Deletes images referenced by an item ("/uploads/<name>" paths). */
async function removeImages(publicPaths = []) {
  await Promise.all(publicPaths.map((p) => unlinkQuietly(diskPathFor(p))));
}

/** Deletes files Multer wrote for the current request. */
async function removeUploadedFiles(files = []) {
  if (!Array.isArray(files)) return;
  await Promise.all(files.map((f) => unlinkQuietly(f.path)));
}

function publicPathFor(file) {
  return `/uploads/${file.filename}`;
}

module.exports = { removeImages, removeUploadedFiles, publicPathFor };

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./env');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const MAX_IMAGES = 4;
const MAX_FILE_BYTES = Math.round(config.maxUploadMb * 1024 * 1024);

// Allowed MIME types and the file extensions each one may use.
const ALLOWED_TYPES = {
  'image/jpeg': { ext: '.jpg', extensions: ['.jpg', '.jpeg'] },
  'image/png': { ext: '.png', extensions: ['.png'] },
  'image/webp': { ext: '.webp', extensions: ['.webp'] },
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED_TYPES[file.mimetype].ext),
});

// Both the declared MIME type and the original extension must be allowed and agree.
function fileFilter(req, file, cb) {
  const type = ALLOWED_TYPES[file.mimetype];
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!type || !type.extensions.includes(ext)) {
    return cb(new UploadError(`"${file.originalname}" is not allowed. Upload JPEG, PNG or WebP images only.`));
  }
  return cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_IMAGES,
    fields: 30,
    fieldSize: 100 * 1024,
  },
});

/** Reads the first bytes of a file to confirm it really is a JPEG, PNG or WebP. */
function hasImageSignature(filePath, mimetype) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    const read = fs.readSync(fd, buf, 0, 12, 0);
    if (read < 12) return false;
    if (mimetype === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (mimetype === 'image/png') {
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimetype === 'image/webp') {
      return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/** Converts a Multer error into a message a person can act on. */
function describeUploadError(err) {
  if (err instanceof UploadError) return err;
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return new UploadError(`Each image must be ${config.maxUploadMb} MB or smaller.`, 413);
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return new UploadError(`You can attach up to ${MAX_IMAGES} images, using the images field.`);
      default:
        return new UploadError('The upload could not be processed. Please try again.');
    }
  }
  return null;
}

module.exports = {
  upload,
  UPLOAD_DIR,
  MAX_IMAGES,
  MAX_FILE_BYTES,
  ALLOWED_TYPES,
  UploadError,
  hasImageSignature,
  describeUploadError,
};

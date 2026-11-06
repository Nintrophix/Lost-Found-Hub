'use strict';

const { upload, describeUploadError, hasImageSignature, UploadError } = require('../config/multer');
const { HttpError, isApiRequest } = require('../utils/http');

const receiveImages = upload.array('images', 4);

/**
 * Accepts up to 4 images in the "images" field, held in memory.
 * On any problem (size, type, count, or a file whose bytes are not really an
 * image) the files are dropped. API calls then fail with a JSON error; form
 * posts continue with req.uploadError set so the form can be shown again with
 * the message and the person's input. Nothing is stored until the controller
 * has validated the whole request (see services/storage.js).
 */
module.exports = function uploadImages(req, res, next) {
  receiveImages(req, res, (err) => {
    let problem = err ? describeUploadError(err) : null;
    if (err && !problem) return next(err);

    if (!problem) {
      const fake = (req.files || []).find((f) => !hasImageSignature(f.buffer, f.mimetype));
      if (fake) {
        problem = new UploadError(`"${fake.originalname}" is not a valid JPEG, PNG or WebP image.`);
      }
    }

    if (!problem) return next();

    req.files = [];
    if (!req.body) req.body = {};

    if (isApiRequest(req)) return next(new HttpError(problem.status, problem.message));
    req.uploadError = problem.message;
    req.uploadErrorStatus = problem.status;
    return next();
  });
};

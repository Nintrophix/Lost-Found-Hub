'use strict';

const { upload, describeUploadError, hasImageSignature, UploadError } = require('../config/multer');
const { removeUploadedFiles } = require('../services/files');
const { HttpError, isApiRequest } = require('../utils/http');

const receiveImages = upload.array('images', 4);

/**
 * Accepts up to 4 images in the "images" field.
 * On any problem (size, type, count, or a file whose bytes are not really an
 * image) every file already written for this request is deleted. API calls
 * then fail with a JSON error; form posts continue with req.uploadError set so
 * the form can be shown again with the message and the person's input.
 */
module.exports = function uploadImages(req, res, next) {
  receiveImages(req, res, async (err) => {
    let problem = err ? describeUploadError(err) : null;
    if (err && !problem) {
      await removeUploadedFiles(req.files);
      return next(err);
    }

    if (!problem) {
      const fake = (req.files || []).find((f) => !hasImageSignature(f.path, f.mimetype));
      if (fake) {
        problem = new UploadError(`"${fake.originalname}" is not a valid JPEG, PNG or WebP image.`);
      }
    }

    if (!problem) return next();

    await removeUploadedFiles(req.files);
    req.files = [];
    if (!req.body) req.body = {};

    if (isApiRequest(req)) return next(new HttpError(problem.status, problem.message));
    req.uploadError = problem.message;
    req.uploadErrorStatus = problem.status;
    return next();
  });
};

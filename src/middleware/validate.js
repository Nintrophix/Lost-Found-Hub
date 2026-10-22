'use strict';

const { validationResult } = require('express-validator');
const { HttpError, isApiRequest } = require('../utils/http');
const { removeUploadedFiles } = require('../services/files');

/**
 * Runs express-validator rules, then:
 * - API requests with errors get a 422 JSON error with field details.
 * - Page requests keep going with req.formErrors set, so the controller can
 *   re-render the form with the person's input and the messages.
 */
function validate(rules) {
  return [
    ...rules,
    async function handleValidation(req, res, next) {
      const result = validationResult(req);
      if (result.isEmpty()) return next();

      const details = result.array({ onlyFirstError: true }).map((e) => ({
        field: e.path,
        message: e.msg,
      }));

      if (isApiRequest(req)) {
        // The request is rejected here, so delete any images Multer already saved for it.
        await removeUploadedFiles(req.files);
        // Bad query parameters are a malformed request; bad body fields are unprocessable.
        const status = req.method === 'GET' ? 400 : 422;
        const message = status === 400 ? 'Some query parameters are invalid.' : 'Some fields are invalid.';
        return next(new HttpError(status, message, details));
      }
      req.formErrors = details;
      return next();
    },
  ];
}

/** Turns [{field, message}] into { field: message } for templates. */
function errorMap(details = []) {
  return details.reduce((acc, d) => {
    if (!acc[d.field]) acc[d.field] = d.message;
    return acc;
  }, {});
}

module.exports = { validate, errorMap };

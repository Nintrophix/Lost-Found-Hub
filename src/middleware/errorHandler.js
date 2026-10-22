'use strict';

const config = require('../config/env');
const { HttpError, isApiRequest } = require('../utils/http');

const DEFAULT_MESSAGES = {
  400: 'The request could not be understood.',
  401: 'You need to log in to do that.',
  403: 'You do not have permission to do that.',
  404: 'We could not find that page.',
  413: 'That upload is too large.',
  422: 'Some fields are invalid.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Something went wrong on our side.',
};

/** Catch-all for routes that did not match. */
function notFound(req, res, next) {
  next(new HttpError(404, DEFAULT_MESSAGES[404]));
}

/** Normalizes known library errors into HttpErrors. */
function normalize(err) {
  if (err instanceof HttpError) return err;
  if (err && err.type === 'entity.too.large') return new HttpError(413, 'The request body is too large.');
  if (err && err.type === 'entity.parse.failed') return new HttpError(400, 'The request body is not valid JSON.');
  if (err && err.name === 'CastError') return new HttpError(404, DEFAULT_MESSAGES[404]);
  if (err && err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return new HttpError(422, DEFAULT_MESSAGES[422], details);
  }
  const status = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const wrapped = new HttpError(status, status < 500 && err.message ? err.message : DEFAULT_MESSAGES[500]);
  wrapped.original = err;
  return wrapped;
}

/**
 * Central error handler.
 * API requests get { error: { message, details? } }; pages get the 404 or 500 view.
 * Stack traces are logged on the server and never sent to the client.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const httpErr = normalize(err);
  const status = httpErr.status;

  if (status >= 500) {
    console.error(err && err.stack ? err.stack : err);
  }

  if (res.headersSent) return next(err);

  if (isApiRequest(req)) {
    const body = { error: { message: httpErr.message } };
    if (httpErr.details) body.error.details = httpErr.details;
    return res.status(status).json(body);
  }

  const view = status === 404 ? 'pages/404' : 'pages/500';
  const message = status >= 500 ? DEFAULT_MESSAGES[500] : httpErr.message || DEFAULT_MESSAGES[status];
  return res.status(status).render(view, {
    title: status === 404 ? 'Page not found' : statusTitle(status),
    description: message,
    noindex: true,
    isErrorPage: true,
    status,
    message,
    showDetails: !config.isProd && status >= 500 && err && err.message,
    detail: !config.isProd && err ? err.message : '',
  }, (renderErr, html) => {
    if (renderErr) {
      console.error(renderErr);
      return res.status(status).type('text').send(message);
    }
    return res.send(html);
  });
}

function statusTitle(status) {
  switch (status) {
    case 400: return 'Bad request';
    case 401: return 'Login required';
    case 403: return 'Access denied';
    case 413: return 'Upload too large';
    case 422: return 'Check your input';
    case 429: return 'Slow down';
    default: return status >= 500 ? 'Something went wrong' : 'Request failed';
  }
}

module.exports = { notFound, errorHandler };

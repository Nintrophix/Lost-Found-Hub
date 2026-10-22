'use strict';

const express = require('express');
const { body } = require('express-validator');
const items = require('../controllers/itemController');
const chat = require('../controllers/chatController');
const requireAuth = require('../middleware/requireAuth');
const requireOwner = require('../middleware/requireOwner');
const uploadImages = require('../middleware/uploadImages');
const { verifyCsrfAfterUpload } = require('../middleware/csrf');
const { validate } = require('../middleware/validate');
const { apiLimiter, writeLimiter } = require('../middleware/rateLimits');
const rules = require('../validators');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

router.use(apiLimiter);

// Items
router.get('/items', validate(rules.searchQuery), asyncHandler(items.apiList));
router.get('/items/:id', asyncHandler(items.apiShow));
router.post(
  '/items',
  requireAuth,
  writeLimiter,
  uploadImages,
  asyncHandler(verifyCsrfAfterUpload),
  validate(rules.item()),
  asyncHandler(items.apiCreate)
);
router.patch(
  '/items/:id',
  requireAuth,
  requireOwner,
  uploadImages,
  asyncHandler(verifyCsrfAfterUpload),
  validate([
    ...rules.item({ partial: true }),
    body('status').optional().isIn(['open', 'resolved']).withMessage('status can be set to open or resolved.'),
  ]),
  asyncHandler(items.apiUpdate)
);
router.delete('/items/:id', requireAuth, requireOwner, asyncHandler(items.apiDestroy));

// Chat history pages ("Load older messages")
router.get(
  '/conversations/:id/messages',
  requireAuth,
  validate(rules.messagePage),
  asyncHandler(chat.apiMessages)
);

// Unknown API routes get a JSON 404 rather than the HTML page.
router.use((req, res, next) => next(new HttpError(404, 'API route not found.')));

module.exports = router;

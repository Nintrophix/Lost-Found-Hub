'use strict';

const express = require('express');
const items = require('../controllers/itemController');
const chat = require('../controllers/chatController');
const requireAuth = require('../middleware/requireAuth');
const requireOwner = require('../middleware/requireOwner');
const uploadImages = require('../middleware/uploadImages');
const { verifyCsrfAfterUpload } = require('../middleware/csrf');
const { validate } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimits');
const rules = require('../validators');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/', asyncHandler(items.index));

router.get('/new', requireAuth, items.showNew);
router.post(
  '/',
  requireAuth,
  writeLimiter,
  uploadImages,
  asyncHandler(verifyCsrfAfterUpload),
  validate(rules.item()),
  asyncHandler(items.create)
);

router.get('/:id', asyncHandler(items.show));

router.get('/:id/edit', requireAuth, requireOwner, items.showEdit);
router.post(
  '/:id/edit',
  requireAuth,
  requireOwner,
  uploadImages,
  asyncHandler(verifyCsrfAfterUpload),
  validate(rules.item()),
  asyncHandler(items.update)
);
router.post('/:id/delete', requireAuth, requireOwner, asyncHandler(items.destroy));
router.post('/:id/resolve', requireAuth, requireOwner, asyncHandler(items.resolve));
router.post('/:id/reopen', requireAuth, requireOwner, asyncHandler(items.reopen));

// "I found this" on a lost item starts a conversation with the owner.
router.get('/:id/found', requireAuth, asyncHandler(chat.showFound));
router.post('/:id/found', requireAuth, writeLimiter, validate(rules.foundReport), asyncHandler(chat.found));

module.exports = router;

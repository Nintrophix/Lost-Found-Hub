'use strict';

const express = require('express');
const chat = require('../controllers/chatController');
const requireAuth = require('../middleware/requireAuth');
const { validate } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimits');
const rules = require('../validators');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(chat.index));
router.post('/start', asyncHandler(chat.start));
router.get('/:id', asyncHandler(chat.room));
router.post('/:id/messages', writeLimiter, validate(rules.chatMessage), asyncHandler(chat.send));

module.exports = router;

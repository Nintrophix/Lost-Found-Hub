'use strict';

const express = require('express');
const claims = require('../controllers/claimController');
const requireAuth = require('../middleware/requireAuth');
const { validate } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimits');
const rules = require('../validators');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/items/:id/claim', requireAuth, asyncHandler(claims.showNew));
router.post('/items/:id/claim', requireAuth, writeLimiter, validate(rules.claim), asyncHandler(claims.create));

router.get('/claims', requireAuth, asyncHandler(claims.index));
router.post('/claims/:id/approve', requireAuth, asyncHandler(claims.approve));
router.post('/claims/:id/reject', requireAuth, asyncHandler(claims.reject));

module.exports = router;

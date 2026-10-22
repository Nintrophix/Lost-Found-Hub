'use strict';

const express = require('express');
const auth = require('../controllers/authController');
const requireAuth = require('../middleware/requireAuth');
const { validate } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimits');
const rules = require('../validators');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/register', auth.showRegister);
router.post('/register', authLimiter, validate(rules.register), asyncHandler(auth.register));

router.get('/login', auth.showLogin);
router.post('/login', authLimiter, validate(rules.login), asyncHandler(auth.login));

router.post('/logout', requireAuth, asyncHandler(auth.logout));

module.exports = router;

'use strict';

const express = require('express');
const pages = require('../controllers/pageController');
const requireAuth = require('../middleware/requireAuth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/', asyncHandler(pages.home));
router.get('/privacy', pages.privacy);
router.get('/dashboard', requireAuth, asyncHandler(pages.dashboard));

router.get('/sitemap.xml', asyncHandler(pages.sitemap));
router.get('/robots.txt', pages.robots);
router.get('/llms.txt', pages.llms);
router.get('/healthz', (req, res) => res.type('text').send('ok'));

module.exports = router;

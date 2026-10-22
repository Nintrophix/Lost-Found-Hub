'use strict';

/**
 * express-validator rule sets shared by page routes and the JSON API.
 * Values are trimmed here; HTML escaping happens at render time (EJS <%= %>),
 * so nothing is escaped twice.
 */
const { body, query } = require('express-validator');
const Item = require('./models/Item');
const Message = require('./models/Message');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real YYYY-MM-DD calendar date (rejects 2026-13-01, 2026-02-30). */
function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isRealPastDate(value) {
  if (!DATE_RE.test(value)) throw new Error('Use the format YYYY-MM-DD.');
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error('Enter a real calendar date.');
  }
  // Allow "today" in any timezone by giving one day of slack.
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new Error('The date cannot be in the future.');
  if (d.getUTCFullYear() < 2000) throw new Error('The date is too far in the past.');
  return true;
}

const register = [
  body('name').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Enter your name (2 to 80 characters).'),
  body('email').isString().trim().toLowerCase().isEmail().withMessage('Enter a valid email address.')
    .isLength({ max: 254 }).withMessage('That email address is too long.'),
  body('password').isString().isLength({ min: 8, max: 72 }).withMessage('Use a password of 8 to 72 characters.'),
  body('confirmPassword').isString().custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('The passwords do not match.');
    return true;
  }),
  body('role').optional({ values: 'falsy' }).isIn(['student', 'staff']).withMessage('Choose student or staff.'),
  body('campusId').optional({ values: 'falsy' }).isString().trim().isLength({ max: 40 })
    .matches(/^[A-Za-z0-9-]+$/).withMessage('Campus ID can only contain letters, numbers and hyphens.'),
];

const login = [
  body('email').isString().trim().toLowerCase().isEmail().withMessage('Enter a valid email address.'),
  body('password').isString().notEmpty().withMessage('Enter your password.'),
];

/** Item fields. With partial=true every field becomes optional (PATCH). */
function item({ partial = false } = {}) {
  const field = (name) => (partial ? body(name).optional() : body(name));
  return [
    field('type').isIn(Item.TYPES).withMessage('Choose whether the item was lost or found.'),
    field('title').isString().trim().isLength({ min: 3, max: 100 }).withMessage('Give the item a title of 3 to 100 characters.'),
    field('description').isString().trim().isLength({ min: 10, max: 2000 })
      .withMessage('Describe the item in 10 to 2000 characters.'),
    field('category').isIn(Item.CATEGORIES).withMessage('Choose a category.'),
    body('color').optional().isString().trim().isLength({ max: 30 }).withMessage('Keep the color under 30 characters.'),
    field('location').isString().trim().isLength({ min: 2, max: 100 })
      .withMessage('Say where it was lost or found (2 to 100 characters).'),
    field('dateLostOrFound').isString().trim().custom(isRealPastDate),
  ];
}

const claim = [
  body('message').isString().trim().isLength({ min: 20, max: 1000 })
    .withMessage('Describe identifying details in 20 to 1000 characters.'),
];

const foundReport = [
  body('message').isString().trim().isLength({ min: 10, max: Message.MAX_BODY })
    .withMessage(`Write a message of 10 to ${Message.MAX_BODY} characters.`),
];

const chatMessage = [
  body('body').isString().trim().isLength({ min: 1 }).withMessage('Message cannot be empty.'),
];

const searchQuery = [
  query('q').optional().isString().isLength({ max: 200 }).withMessage('Search text must be 200 characters or fewer.'),
  query('type').optional({ values: 'falsy' }).isIn(Item.TYPES).withMessage(`type must be one of: ${Item.TYPES.join(', ')}.`),
  query('category').optional({ values: 'falsy' }).isIn(Item.CATEGORIES)
    .withMessage(`category must be one of: ${Item.CATEGORIES.join(', ')}.`),
  query('status').optional({ values: 'falsy' }).isIn(Item.STATUSES)
    .withMessage(`status must be one of: ${Item.STATUSES.join(', ')}.`),
  query('from').optional({ values: 'falsy' }).custom(isCalendarDate).withMessage('from must be a date like 2026-01-31.'),
  query('to').optional({ values: 'falsy' }).custom(isCalendarDate).withMessage('to must be a date like 2026-01-31.')
    .bail()
    .custom((to, { req }) => {
      if (isCalendarDate(req.query.from) && req.query.from > to) {
        throw new Error('to must be on or after from.');
      }
      return true;
    }),
  query('page').optional().isInt({ min: 1, max: 10000 }).withMessage('page must be a positive whole number.'),
  query('limit').optional().isInt({ min: 1, max: 48 }).withMessage('limit must be between 1 and 48.'),
];

const messagePage = [
  query('before').optional().isMongoId().withMessage('before must be a message id.'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100.'),
];

module.exports = { register, login, item, claim, foundReport, chatMessage, searchQuery, messagePage };

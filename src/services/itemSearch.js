'use strict';

const Item = require('../models/Item');
const User = require('../models/User');
const { formatDate, toDateInput } = require('../utils/format');

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function parseDate(value) {
  if (!DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || toDateInput(d) !== value ? null : d;
}

function parsePositiveInt(value, fallback, max) {
  const n = Number.parseInt(str(value), 10);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Reads search filters from a query string object. Unknown or malformed values
 * are dropped (the API validates them strictly before calling this).
 */
function parseFilters(query = {}) {
  const type = str(query.type);
  const category = str(query.category);
  const status = str(query.status);
  const from = str(query.from);
  const to = str(query.to);
  return {
    q: str(query.q).slice(0, 200),
    type: Item.TYPES.includes(type) ? type : '',
    category: Item.CATEGORIES.includes(category) ? category : '',
    status: Item.STATUSES.includes(status) ? status : '',
    from: parseDate(from) ? from : '',
    to: parseDate(to) ? to : '',
    page: parsePositiveInt(query.page, 1, 10000),
    limit: parsePositiveInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
  };
}

function buildFilter(f) {
  const filter = {};
  if (f.type) filter.type = f.type;
  if (f.category) filter.category = f.category;
  if (f.status) filter.status = f.status;
  if (f.from || f.to) {
    filter.dateLostOrFound = {};
    if (f.from) filter.dateLostOrFound.$gte = parseDate(f.from);
    if (f.to) {
      const end = parseDate(f.to);
      end.setUTCHours(23, 59, 59, 999);
      filter.dateLostOrFound.$lte = end;
    }
  }
  if (f.q) filter.$text = { $search: f.q };
  return filter;
}

/**
 * Runs a paginated search. With a text query, results are ranked by MongoDB
 * text score and then by newest; without one, newest first.
 */
async function searchItems(f) {
  const filter = buildFilter(f);
  const projection = f.q ? { score: { $meta: 'textScore' } } : {};
  const sort = f.q ? { score: { $meta: 'textScore' }, createdAt: -1 } : { createdAt: -1 };

  const total = await Item.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / f.limit));
  const items = await Item.find(filter, projection)
    .sort(sort)
    .skip((f.page - 1) * f.limit)
    .limit(f.limit)
    .populate('reporter', 'name')
    .lean();

  return { items, page: f.page, totalPages, total, limit: f.limit };
}

/** Builds a query string for the given filters, leaving out empty values. */
function filtersToQuery(f, overrides = {}) {
  const merged = { ...f, ...overrides };
  const params = new URLSearchParams();
  ['q', 'type', 'category', 'status', 'from', 'to'].forEach((key) => {
    if (merged[key]) params.set(key, merged[key]);
  });
  if (merged.page && merged.page > 1) params.set('page', String(merged.page));
  return params.toString();
}

/** The public JSON shape of an item. Never includes the reporter's email or full name. */
function toPublicItem(item) {
  const reporter = item.reporter && typeof item.reporter === 'object' && item.reporter.name !== undefined
    ? { id: String(item.reporter._id), firstName: User.firstNameOf(item.reporter.name) }
    : { id: String(item.reporter), firstName: null };
  return {
    id: String(item._id),
    url: `/items/${item._id}`,
    type: item.type,
    title: item.title,
    description: item.description,
    category: item.category,
    categoryLabel: Item.CATEGORY_LABELS[item.category],
    color: item.color || '',
    location: item.location,
    dateLostOrFound: toDateInput(item.dateLostOrFound),
    dateLabel: formatDate(item.dateLostOrFound),
    images: item.images || [],
    status: item.status,
    statusLabel: Item.STATUS_LABELS[item.status],
    reporter,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

module.exports = { parseFilters, searchItems, filtersToQuery, toPublicItem, DEFAULT_LIMIT, MAX_LIMIT };

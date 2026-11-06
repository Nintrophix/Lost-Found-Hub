'use strict';

const Item = require('../models/Item');
const User = require('../models/User');
const { query, one } = require('../config/db');
const { formatDate, toDateInput } = require('../utils/format');

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && toDateInput(d) === value;
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
function parseFilters(source = {}) {
  const type = str(source.type);
  const category = str(source.category);
  const status = str(source.status);
  const from = str(source.from);
  const to = str(source.to);
  return {
    q: str(source.q).slice(0, 200),
    type: Item.TYPES.includes(type) ? type : '',
    category: Item.CATEGORIES.includes(category) ? category : '',
    status: Item.STATUSES.includes(status) ? status : '',
    from: isRealDate(from) ? from : '',
    to: isRealDate(to) ? to : '',
    page: parsePositiveInt(source.page, 1, 10000),
    limit: parsePositiveInt(source.limit, DEFAULT_LIMIT, MAX_LIMIT),
  };
}

/** Builds the WHERE clause and parameters for the filters (all values are bound, never interpolated). */
function buildWhere(f, params) {
  const where = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (f.type) where.push(`i.type = ${bind(f.type)}`);
  if (f.category) where.push(`i.category = ${bind(f.category)}`);
  if (f.status) where.push(`i.status = ${bind(f.status)}`);
  if (f.from) where.push(`i.date_lost_or_found >= ${bind(f.from)}::date`);
  if (f.to) where.push(`i.date_lost_or_found <= ${bind(f.to)}::date`);
  if (f.q) where.push('i.search @@ s.tsq');
  return where.length ? `where ${where.join(' and ')}` : '';
}

/*
 * Any search term may match (OR), so a search never comes back empty just because one word is missing, and
 * ts_rank puts items matching more terms (and matching in the title) first.
 */
const SEARCH_CTE = "with s as (select replace(plainto_tsquery('english', $1)::text, '&', '|')::tsquery as tsq)";

/**
 * Runs a paginated search. With a text query, results are ranked by relevance
 * and then by newest; without one, newest first. One round trip in the common case.
 */
async function searchItems(f) {
  const params = [];
  let prefix = '';
  let from = 'from items i join users u on u.id = i.reporter_id';
  let order = 'order by i.created_at desc';
  let rank = '';
  if (f.q) {
    params.push(f.q);
    prefix = SEARCH_CTE;
    from += ' cross join s';
    rank = ', ts_rank(i.search, s.tsq) as rank';
    order = 'order by rank desc, i.created_at desc';
  }
  const where = buildWhere(f, params);
  params.push(f.limit, (f.page - 1) * f.limit);
  const limitSql = `limit $${params.length - 1} offset $${params.length}`;

  const rows = await query(
    `${prefix} select ${Item.WITH_REPORTER}${rank}, count(*) over () as total_count ${from} ${where} ${order} ${limitSql}`,
    params
  );

  let total = rows.length ? Number(rows[0].total_count) : 0;
  if (!rows.length && f.page > 1) {
    // Past the last page: count separately so the pager still shows the right total.
    const countParams = params.slice(0, params.length - 2);
    const row = await one(`${prefix} select count(*)::int as n ${from} ${where}`, countParams);
    total = row.n;
  }

  return {
    items: rows.map(Item.map),
    page: f.page,
    totalPages: Math.max(1, Math.ceil(total / f.limit)),
    total,
    limit: f.limit,
  };
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
  const reporter = item.reporter && typeof item.reporter === 'object'
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

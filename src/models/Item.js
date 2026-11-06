'use strict';

const { query, one } = require('../config/db');
const { dateOnly, toDateParam } = require('./shared');

const TYPES = ['lost', 'found'];
const STATUSES = ['open', 'claimed', 'resolved'];
const CATEGORIES = ['electronics', 'ids-cards', 'keys', 'bags', 'clothing', 'books', 'jewelry', 'other'];
const MAX_IMAGES = 4;

const CATEGORY_LABELS = {
  electronics: 'Electronics',
  'ids-cards': 'IDs and cards',
  keys: 'Keys',
  bags: 'Bags',
  clothing: 'Clothing',
  books: 'Books and notes',
  jewelry: 'Jewelry',
  other: 'Other',
};

const STATUS_LABELS = { open: 'Open', claimed: 'Claimed', resolved: 'Returned' };

// Columns for an item row (alias i), plus the reporter's name when joined (alias u).
const COLUMNS =
  'i.id, i.type, i.title, i.description, i.category, i.color, i.location, i.date_lost_or_found, ' +
  'i.images, i.status, i.reporter_id, i.created_at, i.updated_at';
const WITH_REPORTER = `${COLUMNS}, u.name as reporter_name`;

// Maps camelCase field names to their columns for inserts and updates.
const FIELD_COLUMNS = {
  type: 'type',
  title: 'title',
  description: 'description',
  category: 'category',
  color: 'color',
  location: 'location',
  dateLostOrFound: 'date_lost_or_found',
  images: 'images',
  status: 'status',
};

/**
 * Row -> item. `reporter` is { _id, name } when the reporter was joined,
 * otherwise the reporter's id (as the views compare it with the viewer's id).
 */
function map(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    color: row.color || '',
    location: row.location,
    dateLostOrFound: dateOnly(row.date_lost_or_found),
    images: row.images || [],
    status: row.status,
    reporter: row.reporter_name !== undefined ? { _id: row.reporter_id, name: row.reporter_name } : row.reporter_id,
    reporterId: row.reporter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toParam(field, value) {
  return field === 'dateLostOrFound' ? toDateParam(value) : value;
}

async function findById(id, { withReporter = false } = {}) {
  const sql = withReporter
    ? `select ${WITH_REPORTER} from items i join users u on u.id = i.reporter_id where i.id = $1`
    : `select ${COLUMNS} from items i where i.id = $1`;
  return map(await one(sql, [id]));
}

async function create(fields, reporterId) {
  const columns = [];
  const params = [];
  Object.keys(FIELD_COLUMNS).forEach((field) => {
    if (fields[field] !== undefined) {
      columns.push(FIELD_COLUMNS[field]);
      params.push(toParam(field, fields[field]));
    }
  });
  columns.push('reporter_id');
  params.push(reporterId);
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
  const row = await one(
    `insert into items as i (${columns.join(', ')}) values (${placeholders}) returning ${COLUMNS}`,
    params
  );
  return map(row);
}

/** Updates the given fields and bumps updated_at. Returns the updated item. */
async function update(id, fields) {
  const sets = [];
  const params = [id];
  Object.keys(FIELD_COLUMNS).forEach((field) => {
    if (fields[field] !== undefined) {
      params.push(toParam(field, fields[field]));
      sets.push(`${FIELD_COLUMNS[field]} = $${params.length}`);
    }
  });
  sets.push('updated_at = now()');
  return map(await one(`update items as i set ${sets.join(', ')} where i.id = $1 returning ${COLUMNS}`, params));
}

/** Changes status only if the item currently has `from` (when given). Returns the item or null. */
async function setStatus(id, status, { from } = {}) {
  const params = [id, status];
  let guard = '';
  if (from) {
    params.push(from);
    guard = ' and i.status = $3';
  }
  return map(
    await one(`update items as i set status = $2, updated_at = now() where i.id = $1${guard} returning ${COLUMNS}`, params)
  );
}

/** Deletes the item; claims, conversations and messages go with it (ON DELETE CASCADE). */
async function remove(id) {
  return map(await one(`delete from items as i where i.id = $1 returning ${COLUMNS}`, [id]));
}

async function recentOpen(limit) {
  const rows = await query(
    `select ${WITH_REPORTER} from items i join users u on u.id = i.reporter_id
     where i.status = 'open' order by i.created_at desc limit $1`,
    [limit]
  );
  return rows.map(map);
}

/** Live counts for the home page, in one query. */
async function homeCounts() {
  const row = await one(
    `select count(*) filter (where type = 'lost' and status = 'open')::int as lost_open,
            count(*) filter (where type = 'found' and status = 'open')::int as found_open,
            count(*) filter (where status = 'resolved')::int as returned
     from items`
  );
  return { lostOpen: row.lost_open, foundOpen: row.found_open, returned: row.returned };
}

async function listByReporter(userId) {
  const rows = await query(`select ${COLUMNS} from items i where i.reporter_id = $1 order by i.created_at desc`, [userId]);
  return rows.map(map);
}

/** Ids and update times for the sitemap. */
async function sitemapEntries(limit) {
  return query('select id, updated_at from items order by updated_at desc limit $1', [limit]);
}

module.exports = {
  TYPES,
  STATUSES,
  CATEGORIES,
  CATEGORY_LABELS,
  STATUS_LABELS,
  MAX_IMAGES,
  COLUMNS,
  WITH_REPORTER,
  map,
  findById,
  create,
  update,
  setStatus,
  remove,
  recentOpen,
  homeCounts,
  listByReporter,
  sitemapEntries,
};

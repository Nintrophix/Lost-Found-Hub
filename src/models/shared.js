'use strict';

/**
 * Helpers shared by the SQL models.
 * Models return plain objects shaped like the views expect: `_id` and `id` for
 * the primary key and camelCase field names.
 */

/** 'YYYY-MM-DD' (DATE column) -> Date at UTC midnight. */
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date -> 'YYYY-MM-DD' for DATE parameters. */
function toDateParam(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

/** Postgres unique_violation. */
function isUniqueViolation(err) {
  return Boolean(err && err.code === '23505');
}

module.exports = { dateOnly, toDateParam, isUniqueViolation };

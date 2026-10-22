'use strict';

/**
 * Formatting helpers shared by views and JSON serializers.
 * Dates are stored at UTC midnight for "date lost or found", so they are
 * always formatted in UTC to avoid shifting by a day.
 */
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatDate(value) {
  if (!value) return '';
  return dateFormatter.format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return '';
  return dateTimeFormatter.format(new Date(value));
}

/** YYYY-MM-DD for <input type="date"> values. */
function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Shortens text on a word boundary without cutting a surrogate pair. */
function truncate(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '');
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}

module.exports = { formatDate, formatDateTime, toDateInput, truncate };

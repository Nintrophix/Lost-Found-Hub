'use strict';

const { query, one } = require('../config/db');
const { isUniqueViolation } = require('./shared');

const STATUSES = ['pending', 'approved', 'rejected'];

// Claim (c) with its item (i) and the claimant's name (u).
const SELECT_JOINED = `
  select c.id, c.item_id, c.claimant_id, c.message, c.status, c.created_at,
         i.title as item_title, i.type as item_type, i.status as item_status, i.reporter_id as item_reporter_id,
         u.name as claimant_name
  from claims c
  join items i on i.id = c.item_id
  join users u on u.id = c.claimant_id`;

function map(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item:
      row.item_title !== undefined
        ? { _id: row.item_id, title: row.item_title, type: row.item_type, status: row.item_status, reporter: row.item_reporter_id }
        : row.item_id,
    claimant: row.claimant_name !== undefined ? { _id: row.claimant_id, name: row.claimant_name } : row.claimant_id,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Creates a pending claim. Returns null if this person already has a pending claim on the item. */
async function create({ itemId, claimantId, message }) {
  try {
    return map(
      await one(
        `insert into claims (item_id, claimant_id, message) values ($1, $2, $3)
         returning id, item_id, claimant_id, message, status, created_at`,
        [itemId, claimantId, message]
      )
    );
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

async function hasPending(itemId, claimantId) {
  return Boolean(
    await one("select 1 from claims where item_id = $1 and claimant_id = $2 and status = 'pending'", [itemId, claimantId])
  );
}

async function countPending(itemId) {
  const row = await one("select count(*)::int as n from claims where item_id = $1 and status = 'pending'", [itemId]);
  return row.n;
}

async function findWithItem(id) {
  return map(await one(`${SELECT_JOINED} where c.id = $1`, [id]));
}

/** Claims this person made, newest first. */
async function listByClaimant(userId, limit = 100) {
  const rows = await query(`${SELECT_JOINED} where c.claimant_id = $1 order by c.created_at desc limit $2`, [userId, limit]);
  return rows.map(map);
}

/** Claims on items this person reported. */
async function listOnItemsOf(userId, { pendingOnly = false, oldestFirst = false } = {}) {
  const rows = await query(
    `${SELECT_JOINED} where i.reporter_id = $1 ${pendingOnly ? "and c.status = 'pending'" : ''}
     order by c.created_at ${oldestFirst ? 'asc' : 'desc'}`,
    [userId]
  );
  return rows.map(map);
}

module.exports = { STATUSES, map, create, hasPending, countPending, findWithItem, listByClaimant, listOnItemsOf };

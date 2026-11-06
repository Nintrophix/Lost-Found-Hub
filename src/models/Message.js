'use strict';

const { query, one } = require('../config/db');
const { firstNameOf } = require('./User');

const MAX_BODY = 2000;

/**
 * The JSON shape sent to browsers. With two participants, "read" means the
 * recipient has read it, so readBy is the sender alone or both participants.
 */
function serialize(row, participants) {
  return {
    id: String(row.id),
    conversationId: row.conversation_id,
    sender: { id: row.sender_id, firstName: firstNameOf(row.sender_name) },
    body: row.body,
    readBy: row.read_at ? participants.slice() : [row.sender_id],
    createdAt: row.created_at,
  };
}

async function create({ conversationId, senderId, body }) {
  return one(
    `insert into messages (conversation_id, sender_id, body) values ($1, $2, $3)
     returning id, conversation_id, sender_id, body, read_at, created_at,
               (select name from users where id = $2) as sender_name`,
    [conversationId, senderId, body]
  );
}

/** One page of history: the newest `limit` messages before `before` (a message id), oldest first. */
async function page(conversationId, { before = null, limit = 50 } = {}) {
  const rows = await query(
    `select m.id, m.conversation_id, m.sender_id, m.body, m.read_at, m.created_at, u.name as sender_name
     from messages m
     left join users u on u.id = m.sender_id
     where m.conversation_id = $1 and ($2::bigint is null or m.id < $2::bigint)
     order by m.id desc
     limit $3`,
    [conversationId, before, limit + 1]
  );
  return { rows: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
}

/** Marks the other person's unread messages as read. Returns how many changed. */
async function markRead(conversationId, userId) {
  const rows = await query(
    `update messages set read_at = now()
     where conversation_id = $1 and sender_id <> $2 and read_at is null
     returning id`,
    [conversationId, userId]
  );
  return rows.length;
}

/** Unread messages across all of a user's conversations. */
async function countUnread(userId) {
  const row = await one(
    `select count(*)::int as n
     from messages m
     join conversations c on c.id = m.conversation_id
     where (c.user_a = $1 or c.user_b = $1) and m.sender_id <> $1 and m.read_at is null`,
    [userId]
  );
  return row.n;
}

module.exports = { MAX_BODY, serialize, create, page, markRead, countUnread };

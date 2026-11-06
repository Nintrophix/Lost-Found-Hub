'use strict';

const { query, one } = require('../config/db');
const { firstNameOf } = require('./User');

function map(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    itemId: row.item_id,
    participants: [row.user_a, row.user_b],
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

function hasParticipant(conversation, userId) {
  return conversation.participants.includes(String(userId));
}

function otherParticipant(conversation, userId) {
  return conversation.participants.find((p) => p !== String(userId)) || null;
}

/** Returns the single conversation for this item and pair of users, creating it if needed (one round trip). */
async function findOrCreate(itemId, userA, userB) {
  const [a, b] = [String(userA), String(userB)].sort();
  return map(
    await one(
      `insert into conversations (item_id, user_a, user_b) values ($1, $2, $3)
       on conflict on constraint conversations_one_per_pair
       do update set last_message_at = conversations.last_message_at
       returning *`,
      [itemId, a, b]
    )
  );
}

/** The conversation, only if this user takes part in it. */
async function findForUser(id, userId) {
  return map(await one('select * from conversations where id = $1 and (user_a = $2 or user_b = $2)', [id, userId]));
}

async function touch(id, at) {
  await query('update conversations set last_message_at = $2 where id = $1', [id, at]);
}

/**
 * A user's conversations, newest activity first, each with its item, the other
 * person's first name, the last message and this user's unread count.
 */
async function listForUser(userId, limit = null) {
  const rows = await query(
    `select c.id, c.last_message_at,
            i.id as item_id, i.title as item_title, i.type as item_type, i.status as item_status, i.images as item_images,
            ou.name as other_name,
            lm.body as last_body, lm.sender_id as last_sender, lm.created_at as last_created_at,
            (select count(*)::int from messages m
              where m.conversation_id = c.id and m.sender_id <> $1 and m.read_at is null) as unread
     from conversations c
     left join items i on i.id = c.item_id
     left join users ou on ou.id = case when c.user_a = $1 then c.user_b else c.user_a end
     left join lateral (
       select body, sender_id, created_at from messages m where m.conversation_id = c.id order by m.id desc limit 1
     ) lm on true
     where c.user_a = $1 or c.user_b = $1
     order by c.last_message_at desc
     limit $2`,
    [userId, limit]
  );
  return rows.map((row) => ({
    id: row.id,
    item: row.item_id
      ? { _id: row.item_id, title: row.item_title, type: row.item_type, status: row.item_status, images: row.item_images }
      : null,
    otherFirstName: row.other_name ? firstNameOf(row.other_name) : 'Former member',
    unread: row.unread,
    last: row.last_body ? { body: row.last_body, sender: row.last_sender, createdAt: row.last_created_at } : null,
    lastIsMine: Boolean(row.last_sender && row.last_sender === String(userId)),
    lastMessageAt: row.last_message_at,
  }));
}

/** Item and both participants' names for the chat room page. */
async function roomDetail(id) {
  return one(
    `select i.id as item_id, i.title, i.type, i.status, i.images, i.reporter_id,
            ua.id as a_id, ua.name as a_name, ub.id as b_id, ub.name as b_name
     from conversations c
     left join items i on i.id = c.item_id
     left join users ua on ua.id = c.user_a
     left join users ub on ub.id = c.user_b
     where c.id = $1`,
    [id]
  );
}

module.exports = { map, hasParticipant, otherParticipant, findOrCreate, findForUser, touch, listForUser, roomDetail };

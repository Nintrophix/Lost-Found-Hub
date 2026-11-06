'use strict';

const bcrypt = require('bcrypt');
const { one } = require('../config/db');

const ROLES = ['student', 'staff', 'admin'];
const BCRYPT_ROUNDS = 12;
const PUBLIC_COLUMNS = 'id, name, email, role, campus_id, created_at';

/** Only the first name is ever shown publicly. */
function firstNameOf(name) {
  return (name || '').trim().split(/\s+/)[0] || 'Member';
}

function map(row) {
  if (!row) return null;
  const user = {
    _id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    campusId: row.campus_id || null,
    createdAt: row.created_at,
  };
  if (row.password_hash !== undefined) user.passwordHash = row.password_hash;
  return user;
}

async function findById(id) {
  return map(await one(`select ${PUBLIC_COLUMNS} from users where id = $1`, [id]));
}

/** Includes the password hash, for login only. */
async function findByEmailWithHash(email) {
  return map(await one(`select ${PUBLIC_COLUMNS}, password_hash from users where email = $1`, [email]));
}

async function emailExists(email) {
  return Boolean(await one('select 1 from users where email = $1', [email]));
}

async function exists(id) {
  return Boolean(await one('select 1 from users where id = $1', [id]));
}

async function create({ name, email, role = 'student', campusId = null, passwordHash }) {
  return map(
    await one(
      `insert into users (name, email, role, campus_id, password_hash)
       values ($1, $2, $3, $4, $5)
       returning ${PUBLIC_COLUMNS}`,
      [name, email, role, campusId || null, passwordHash]
    )
  );
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

module.exports = {
  ROLES,
  firstNameOf,
  findById,
  findByEmailWithHash,
  emailExists,
  exists,
  create,
  hashPassword,
  verifyPassword,
};

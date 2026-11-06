'use strict';

/**
 * Postgres connection pool (Supabase or any Postgres 14+).
 *
 * - SSL is used for every non-local host, as Supabase requires.
 * - The pool is small on purpose: Supabase's free tier caps pooled connections.
 *   Use the "Session pooler" connection string for a long-running server like this one
 *   (it works over IPv4, which hosts such as Render need).
 * - DATE columns come back as 'YYYY-MM-DD' strings so dates never shift with the
 *   server's timezone; models turn them into UTC-midnight Dates.
 */
const { Pool, types } = require('pg');
const config = require('./env');

types.setTypeParser(types.builtins.DATE, (value) => value);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function poolConfig(connectionString) {
  const url = new URL(connectionString);
  const local = LOCAL_HOSTS.has(url.hostname);
  // sslmode in the URL would override the ssl option below, so it is handled here instead.
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    max: config.dbPoolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    keepAlive: true,
    application_name: 'lost-found-hub',
  };
}

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    pool = new Pool(poolConfig(config.databaseUrl));
    // An idle client can drop (for example when the pooler restarts); log it instead of crashing.
    pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  }
  return pool;
}

/** Runs one parameterized query and returns its rows. */
async function query(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows;
}

/** Runs one query and returns its first row, or null. */
async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/** Runs `fn(client)` inside a transaction; commits on success, rolls back on error. */
async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn({
      query: async (text, params = []) => (await client.query(text, params)).rows,
      one: async (text, params = []) => (await client.query(text, params)).rows[0] || null,
    });
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Checks the connection and that the schema has been created. */
async function connectDB() {
  const row = await one("select to_regclass('public.items') as items");
  if (!row || !row.items) {
    throw new Error('The database has no tables yet. Run `npm run db:migrate` first.');
  }
}

async function disconnectDB() {
  if (pool) {
    const closing = pool;
    pool = null;
    await closing.end();
  }
}

module.exports = { getPool, poolConfig, query, one, transaction, connectDB, disconnectDB };

'use strict';

/**
 * Applies the SQL files in supabase/migrations/ that have not run yet, in name
 * order, each in its own transaction. Applied versions are recorded in
 * public.schema_migrations. Safe to run on every deploy.
 *
 *   npm run db:migrate          (uses DATABASE_URL)
 *
 * The same files work with the Supabase CLI (`supabase db push`), which keeps
 * its own record; use one tool or the other for a given database.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config/env');
const { poolConfig } = require('../src/config/db');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');
// Any fixed number: stops two deploys from migrating at the same time.
const LOCK_ID = 74210931;

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const client = new Client(poolConfig(config.databaseUrl));
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      `create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());
       alter table schema_migrations enable row level security;`
    );
    const done = new Set((await client.query('select version from schema_migrations')).rows.map((r) => r.version));

    let applied = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (done.has(version)) continue;
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [version]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      console.log(`Applied ${file}`);
      applied += 1;
    }
    console.log(applied ? `Done: ${applied} migration(s) applied.` : 'Database is up to date.');
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

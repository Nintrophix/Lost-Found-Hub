-- Campus Lost & Found Hub: initial schema for Supabase Postgres (works on any Postgres 14+).
--
-- Apply with `npm run db:migrate` (uses DATABASE_URL) or the Supabase CLI (`supabase db push`).
--
-- Security note: Supabase exposes every table in the public schema through its REST
-- API to anyone holding the project's anon key. This app talks to Postgres directly
-- from the server, so every table enables row level security with NO policies: the
-- REST API sees nothing, and only the server's own connection can read or write.

-- ---------------------------------------------------------------- users
create table users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 80),
  email         text not null unique check (email = lower(email) and char_length(email) <= 254),
  password_hash text not null,
  role          text not null default 'student' check (role in ('student', 'staff', 'admin')),
  campus_id     text check (char_length(campus_id) <= 40),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- items
create table items (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null check (type in ('lost', 'found')),
  title              text not null check (char_length(title) between 3 and 100),
  description        text not null check (char_length(description) between 10 and 2000),
  category           text not null check (category in ('electronics', 'ids-cards', 'keys', 'bags', 'clothing', 'books', 'jewelry', 'other')),
  color              text not null default '' check (char_length(color) <= 30),
  location           text not null check (char_length(location) between 2 and 100),
  date_lost_or_found date not null,
  images             text[] not null default '{}' check (cardinality(images) <= 4),
  status             text not null default 'open' check (status in ('open', 'claimed', 'resolved')),
  reporter_id        uuid not null references users (id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Full-text search document, weighted like the old Mongo text index:
  -- title (A) above location (B) above description (C).
  search             tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', location), 'B') ||
    setweight(to_tsvector('english', description), 'C')
  ) stored
);

create index items_search_idx on items using gin (search);
create index items_filters_idx on items (type, category, status, created_at desc);
create index items_status_created_idx on items (status, created_at desc);
create index items_created_idx on items (created_at desc);
create index items_reporter_idx on items (reporter_id, created_at desc);
create index items_date_idx on items (date_lost_or_found);

-- ---------------------------------------------------------------- claims
create table claims (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items (id) on delete cascade,
  claimant_id uuid not null references users (id) on delete cascade,
  message     text not null check (char_length(message) between 20 and 1000),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now()
);

create index claims_item_status_idx on claims (item_id, status);
create index claims_claimant_idx on claims (claimant_id, created_at desc);
-- A person can only have one pending claim per item at a time.
create unique index claims_one_pending_idx on claims (item_id, claimant_id) where status = 'pending';

-- ---------------------------------------------------------------- conversations
-- Exactly two participants, stored in a fixed order so each pair has one thread per item.
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references items (id) on delete cascade,
  user_a          uuid not null references users (id) on delete cascade,
  user_b          uuid not null references users (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint conversations_ordered_pair check (user_a < user_b),
  constraint conversations_one_per_pair unique (item_id, user_a, user_b)
);

create index conversations_user_a_idx on conversations (user_a, last_message_at desc);
create index conversations_user_b_idx on conversations (user_b, last_message_at desc);

-- ---------------------------------------------------------------- messages
-- Sequential ids give "load older" pagination a stable order. With two participants,
-- read_at (when the recipient read it) is all the read-receipt state needed.
create table messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references conversations (id) on delete cascade,
  sender_id       uuid not null references users (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, id desc);
create index messages_unread_idx on messages (conversation_id, sender_id) where read_at is null;

-- ---------------------------------------------------------------- login sessions (connect-pg-simple)
create table user_sessions (
  sid    varchar not null primary key,
  sess   json not null,
  expire timestamp(6) not null
);

create index user_sessions_expire_idx on user_sessions (expire);

-- ---------------------------------------------------------------- lock tables away from the Supabase REST API
alter table users enable row level security;
alter table items enable row level security;
alter table claims enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table user_sessions enable row level security;

do $$
begin
  -- These roles exist on Supabase only; skip quietly on plain Postgres.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on users, items, claims, conversations, messages, user_sessions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on users, items, claims, conversations, messages, user_sessions from authenticated;
  end if;
end
$$;

-- Madar server tables: the counters of State, and the tables that hold no State collection (plan 4.2, "Server-only tables").
-- server/data/tables.ts lists them (COUNTERS_TABLE, SERVER_TABLES). No table name carries a schema (TM 5).

-- nextId and the event seq need gap-free numbers, and a Postgres sequence leaves gaps after a rollback (plan, change 4).
-- Read and written inside the office lock.
create table counters (
  prefix text primary key,
  n      integer not null check (n >= 0)
);

-- One row. version: the newest office change number (the office cache, plan 4.7). office_seq: the counter of the "office"
-- change channel (plan 4.8, change 13).
create table office_meta (
  id         smallint primary key default 1 check (id = 1),
  version    bigint not null default 0,
  office_seq bigint not null default 0
);
insert into office_meta (id) values (1);

-- The office rows that a save deleted, so the office cache can drop them (plan 4.7). The job keeps 7 days.
create table office_deletes (
  tbl        text not null,
  id         text not null,
  chg        bigint not null,
  created_at timestamptz not null default now(),
  primary key (tbl, id, chg)
);
create index office_deletes_chg on office_deletes (chg);
create index office_deletes_created on office_deletes (created_at);

-- The counter of each "person:<userId>" change channel (plan 4.8, change 13).
create table person_seq (
  user_id text primary key,
  seq     bigint not null default 0
);

-- Values for each project that no migration may hold, for example mcp_url for the token hook (plan, change 6).
-- scripts/deploy/secrets.ts writes them.
create table platform_config (
  key   text primary key,
  value text not null
);

-- Story IDs from the server (plan 4.9). The job deletes stories older than 7 days.
create table stories (
  id         text primary key,
  actor_id   text not null,
  created_at timestamptz not null default now()
);
create index stories_created on stories (created_at);

-- Batch write answers for 24 hours (plan 4.10). digest: sha256 of the call name and the canonical input.
create table idempotency (
  actor_id   text not null,
  key        text not null,
  name       text not null,
  digest     text not null,
  result     jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, key)
);
create index idempotency_created on idempotency (created_at);

-- Effects after the commit (plan 4.12). A worker claims a row before it works on it.
create table outbox (
  id            bigint generated always as identity primary key,
  kind          text not null,
  payload       jsonb not null,
  attempts      integer not null default 0,
  claimed_until timestamptz,
  done_at       timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);
create index outbox_open on outbox (created_at) where done_at is null;

-- One signed upload (plan 5.2). A feedback screenshot has no project.
create table upload_intents (
  id          text primary key,
  actor_id    text not null,
  project_id  text,
  staging_key text not null,
  key         text not null,
  thumb_key   text,
  size        bigint not null check (size >= 0),
  mime_type   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index upload_intents_open on upload_intents (expires_at) where used_at is null;

-- One approved AI app of one person (plan 5.6). The agent user is a users row with kind "agent".
create table agent_links (
  client_id     uuid primary key,
  owner_user_id text not null,
  agent_user_id text not null,
  client_name   text not null,
  redirect_host text not null,
  approved_at   timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index agent_links_owner on agent_links (owner_user_id);
create index agent_links_agent on agent_links (agent_user_id);

-- The email quota by UTC day, as Resend counts it (plan 5.4, change 9).
create table mail_log (
  id         bigint generated always as identity primary key,
  utc_day    date not null,
  kind       text not null,
  user_id    text,
  ref        text not null,
  resend_id  text,
  created_at timestamptz not null default now(),
  unique (utc_day, ref)
);

-- The test deployment only (MAIL_DRIVER=outbox): the mail that would go out (plan 5.4). "mail" holds the whole Mail.
create table mail_outbox (
  id              bigint generated always as identity primary key,
  to_email        text not null,
  tag             text not null,
  idempotency_key text not null unique,
  mail            jsonb not null,
  created_at      timestamptz not null default now()
);

-- The usage meters of one month, "YYYY-MM" (plan 5.8). backup_bytes: the size of the file copy on B2 (plan 5.7).
create table usage_month (
  month        text primary key,
  calls        bigint not null default 0,
  bytes_read   bigint not null default 0,
  backup_bytes bigint
);

-- One 80% warning for each meter and month (plan 5.8).
create table usage_warnings (
  month   text not null,
  metric  text not null,
  sent_at timestamptz not null default now(),
  primary key (month, metric)
);

-- Fixed-window rate limits: forgot password, invitations, MCP tool calls (plan 5.1, 5.6).
create table rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);

-- Runs of the 15-minute job: "heartbeat", and one row for each summary day, for example "summary:2026-10-04" (plan 5.5).
create table job_runs (
  key     text primary key,
  done_at timestamptz not null default now()
);

-- Google Calendar connect (fbk_022, owner 2026-10-19): two server-only tables, as agent_links and mail_log. They hold no State collection, so
-- no handler, loader, event, signal, search or export of the office reads them (server/google/). Only four server calls and two effects
-- touch them (google.status, google.connectStart, google.connect, google.disconnect; gcal.sync, gcal.revoke).
-- The nightly backup holds them too: sealed_token is AES-256-GCM cipher text, and the key (MADAR_GOOGLE_KEY) lives in the function secrets only.
-- The tables start empty, so this file writes no office row and needs no version step.

-- One row for each connection of a person. A person has one live row (state ok, not_synced or broken). A new connect makes the old
-- row "revoking" in the same transaction; the effect gcal.revoke then deletes it, and the cleanup step deletes every revoking row
-- older than one day, so a sealed token never stays in the database for long.
create table google_connections (
  id            text primary key,
  user_id       text not null,
  sealed_token  text,
  calendar_id   text,
  state         text not null check (state in ('ok', 'not_synced', 'broken', 'revoking')),
  connected_at  timestamptz not null,
  last_error    text,
  last_error_at timestamptz,
  changed_at    timestamptz not null
);
create unique index google_connections_person on google_connections (user_id) where state <> 'revoking';

-- The Google event of one meeting in the calendar of one person. synced_rev is the rev of the meeting at the last write to Google.
create table google_events (
  user_id    text not null,
  meeting_id text not null,
  event_id   text not null,
  synced_rev integer not null,
  synced_at  timestamptz not null,
  primary key (user_id, meeting_id)
);
create index google_events_meeting on google_events (meeting_id);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before these tables existed, so this file gives them the same rules:
-- Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table google_connections enable row level security;
revoke all on table google_connections from public, anon, authenticated;
grant select, insert, update, delete on table google_connections to madar_server;
create policy server_all on google_connections for all to madar_server using (true) with check (true);

alter table google_events enable row level security;
revoke all on table google_events from public, anon, authenticated;
grant select, insert, update, delete on table google_events to madar_server;
create policy server_all on google_events for all to madar_server using (true) with check (true);

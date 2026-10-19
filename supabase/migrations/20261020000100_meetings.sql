-- Meetings (fbk_022, 2026-10-19): one row for each Meeting record of src/api/contract/entities.ts (server/data/tables.ts). A meeting
-- is a meeting, a client meeting, a team meeting or a site visit, with its project (or none), its time and its people.
-- It is not an office list, so it has no "chg" column. A loader reads the window of one call (meetings.list), and a meeting with no
-- project is read by its organizer and its attendees only (server/data/loaders/meetings.ts).
-- The table starts empty, so this file writes no office row and needs no version step (server/data/CLAUDE.md, "Tables").
-- Stamps are in office time (+03:00), so the text order of starts_at is the time order.

create table meetings (
  id           text primary key,
  ord          bigserial not null,
  doc          jsonb not null,
  project_id   text generated always as (doc->>'projectId') stored,
  organizer_id text generated always as (doc->>'organizerId') stored,
  starts_at    text generated always as (doc->>'startsAt') stored,
  ends_at      text generated always as (doc->>'endsAt') stored,
  status       text generated always as (doc->>'status') stored,
  settled_at   text generated always as (doc->>'settledAt') stored,
  constraint meetings_id check (doc->>'id' = id)
);
-- A window by start (meetings.list) and the job that settles ended meetings. The text index serves the time bound of sqlSource.ts.
create index meetings_starts on meetings (starts_at collate "C");
create index meetings_project_starts on meetings (project_id, starts_at collate "C");
-- The meetings of one attendee: doc->'attendeeIds' ? 'usr_003' (the "has" condition), as tasks_helpers does for helpers.
create index meetings_attendees on meetings using gin ((doc->'attendeeIds'));

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same rules:
-- Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table meetings enable row level security;
revoke all on table meetings from public, anon, authenticated;
revoke all on sequence meetings_ord_seq from public, anon, authenticated;
grant select, insert, update, delete on table meetings to madar_server;
grant usage, select on sequence meetings_ord_seq to madar_server;
create policy server_all on meetings for all to madar_server using (true) with check (true);

-- Google Calendar, one calendar for each person (fbk_022, owner test 2026-10-20): a server-only table, as google_connections. A person who
-- connects, disconnects and connects again must get the same calendar "Madar" in Google, not a second one. The scope calendar.app.created
-- reaches every calendar that Madar made, but it cannot list calendars, so Madar remembers the id. The row holds the id only: no key,
-- no token, no event. A disconnect keeps it on purpose. users.remove deletes it.
-- The table starts empty, so this file writes no office row and needs no version step.

create table google_calendars (
  user_id     text primary key,
  calendar_id text not null,
  changed_at  timestamptz not null
);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same rules as
-- google_connections: Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table google_calendars enable row level security;
revoke all on table google_calendars from public, anon, authenticated;
grant select, insert, update, delete on table google_calendars to madar_server;
create policy server_all on google_calendars for all to madar_server using (true) with check (true);

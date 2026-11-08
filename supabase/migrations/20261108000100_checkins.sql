-- The weekly question (fbk_088, owner 2026-11-08). One row for each Checkin record of src/api/contract/entities.ts
-- (server/data/tables.ts): the answer of one person to the plan question (Sunday) or the review question (Thursday) of one week.
-- The week is the Sunday that starts it, in office time. Everyone who holds "Read the weekly answers" reads every answer, so the
-- loaders read the rows of one week (checkins.week) or the rows of one person in one week (checkins.mine, checkins.save).
-- It is not an office list, so it has no "chg" column and the whole-office read of each request does not grow (about 30 rows a week).
-- The table starts empty, so this file writes no office row and needs no version step (server/data/CLAUDE.md, "Tables").
-- The number starts a new day: "supabase db push" adds only files that come after the last migration of a hosted project.

create table checkins (
  id      text primary key,
  ord     bigserial not null,
  doc     jsonb not null,
  user_id text generated always as (doc->>'userId') stored,
  week    text generated always as (doc->>'week') stored,
  kind    text generated always as (doc->>'kind') stored,
  constraint checkins_id check (doc->>'id' = id)
);
-- One answer for each person, week and kind. The same index finds the rows of one week and the rows of one person in one week.
create unique index checkins_one on checkins (week, user_id, kind);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same rules:
-- Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table checkins enable row level security;
revoke all on table checkins from public, anon, authenticated;
revoke all on sequence checkins_ord_seq from public, anon, authenticated;
grant select, insert, update, delete on table checkins to madar_server;
grant usage, select on sequence checkins_ord_seq to madar_server;
create policy server_all on checkins for all to madar_server using (true) with check (true);

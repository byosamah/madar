-- The compressed office copy (to-do tsk_496, owner approved 2026-11-01): one row that holds the office lists as gzip and base64 text,
-- with the office_meta.version it was made at. A cold office read (server/data/officeCache.ts) reads this row, and then only the
-- office rows with "chg" above that version, so it reads a few KB where it read the whole office. The copy is derived data: the tables
-- stay the truth. A missing, broken or old copy makes the cache read every row, as before. The number starts a new day.
--
-- It is no State collection and no office list, so it has no "chg". The server writes it after an answer, outside the office lock
-- (the writer keeps only the newest version), so the backup check lists it in OUTSIDE_OFFICE_LOCK.

create table office_copy (
  id        smallint primary key default 1 check (id = 1),
  -- The office_meta.version of the copy.
  version   bigint not null,
  -- The database time at which the copy was known to be current: the rows of office_deletes above "version" are newer than this.
  at        timestamptz not null,
  row_count integer not null check (row_count >= 0),
  body      text not null
);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same rules:
-- Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table office_copy enable row level security;
revoke all on table office_copy from public, anon, authenticated;
grant select, insert, update, delete on table office_copy to madar_server;
create policy server_all on office_copy for all to madar_server using (true) with check (true);

-- Madar guards (plan 4.1, 4.3, change 14). server/it/guards.it.test.ts checks each one.
-- The loops below act on the tables of the schema that this file runs in (current_schema()), so the test harness can apply it
-- into one schema for each test worker.

-- New functions in public get no execute right for the browser roles (Supabase grants it by default, and the Data API would
-- serve them). Each function below also revokes it by name, because a default privilege only covers later functions.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- The History only grows (plan 4.3). Even the table owner cannot change or delete an event; only TRUNCATE (owner only,
-- for the test harness) empties the table, and row triggers do not see it.
create or replace function events_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'events only grow: % is not allowed', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke execute on function events_append_only() from public, anon, authenticated;

create trigger events_append_only
  before update or delete on events
  for each row execute function events_append_only();

-- Row Level Security on every table, and no right at all for the browser roles. The screens use only Auth, Realtime and
-- the api function; the server role gets its one policy in 20261004000103_roles.sql.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind = 'r'
  loop
    execute format('alter table %I enable row level security', t.relname);
    execute format('revoke all on table %I from public, anon, authenticated', t.relname);
  end loop;
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind = 'S'
  loop
    execute format('revoke all on sequence %I from public, anon, authenticated', t.relname);
  end loop;
end
$$;

-- No role but the owner may change or empty the History. service_role skips RLS, so it loses these rights by name.
revoke update, delete, truncate on events from public, anon, authenticated, service_role;

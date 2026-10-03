-- The server role (plan 4.1, change 24). The server connects as madar_server, which owns nothing: it cannot alter a table,
-- turn off a trigger, empty a table or set session_replication_role, so a server bug cannot change the History.
-- Migrations, the test harness and the backup keep postgres.
--
-- The role starts without login. scripts/deploy/secrets.ts sets login and the password from secrets/<env>.env, so no password
-- goes into git; the local stack and CI use a fixed test password that the harness sets.
-- Roles belong to the whole database, so the role is made only once, also when the harness applies this file again into a
-- schema for each test worker.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'madar_server') then
    create role madar_server nologin noinherit;
  end if;
end
$$;

-- Rights and the one policy on every table of this schema: full rights on the Madar tables and their sequences.
do $$
declare
  t record;
begin
  execute format('grant usage on schema %I to madar_server', current_schema());
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind = 'r'
  loop
    execute format('grant select, insert, update, delete on table %I to madar_server', t.relname);
    execute format('create policy server_all on %I for all to madar_server using (true) with check (true)', t.relname);
  end loop;
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind = 'S'
  loop
    execute format('grant usage, select on sequence %I to madar_server', t.relname);
  end loop;
end
$$;

-- The History: read and add only (plan 4.3).
revoke update, delete, truncate on events from madar_server;

-- platform_config: read only. The token hook copies mcp_url into the aud claim of every agent token, and only
-- scripts/deploy/secrets.ts (as postgres) writes it (plan 4.2), so a server bug cannot change the audience of the tokens.
revoke insert, update, delete, truncate on platform_config from madar_server;

-- The token hook runs as supabase_auth_admin and reads mcp_url (plan, change 6). This is the one policy for a role other
-- than madar_server, and it only reads.
grant select on platform_config to supabase_auth_admin;
create policy auth_hook_read on platform_config for select to supabase_auth_admin using (true);

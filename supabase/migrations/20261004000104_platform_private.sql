-- The platform part of the roles (plan 4.1). The test harness skips *_platform_*.sql files: this one needs the Supabase
-- schemas auth and realtime, and it names the public tables by schema.
--
-- madar_private holds the server-only SQL functions. The Data API does not expose this schema.

create schema if not exists madar_private;
revoke all on schema madar_private from public, anon, authenticated;
grant usage on schema madar_private to madar_server, authenticated;

-- The Madar user of the signed-in person, or null for a person who is gone or turned off. The Realtime policies of the
-- "office" and "person:<id>" topics use it (plan 5.3). security definer: the browser roles have no right on users.
create or replace function madar_private.current_madar_user_id() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.users u where u.auth_user_id = auth.uid() and u.active
$$;
revoke execute on function madar_private.current_madar_user_id() from public, anon;
grant execute on function madar_private.current_madar_user_id() to authenticated, madar_server;

-- The MCP token check (plan 5.6): the Auth session of the token still exists and belongs to the person who approved the
-- agent link, the link is not revoked, and the agent and its person are both active. One query joins the session to the link
-- owner, so a token of another person that carries the same client_id fails. plpgsql, so the body is checked when it runs,
-- after Auth made auth.sessions.
create or replace function madar_private.agent_session_ok(session_id uuid, client_id uuid) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from auth.sessions s
    join public.agent_links l on l.client_id = agent_session_ok.client_id
    join public.users owner on owner.id = l.owner_user_id and owner.auth_user_id = s.user_id
    join public.users agent on agent.id = l.agent_user_id
    where s.id = agent_session_ok.session_id
      and l.revoked_at is null
      and owner.active
      and agent.active
  );
end;
$$;
revoke execute on function madar_private.agent_session_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function madar_private.agent_session_ok(uuid, uuid) to madar_server;

-- The change signals: the server sends them with realtime.send inside the save transaction (plan 5.3). The Realtime service
-- makes the function; when it does not exist yet, track N1 grants it in its platform migration.
do $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    grant usage on schema realtime to madar_server;
    grant execute on function realtime.send(jsonb, text, text, boolean) to madar_server;
  end if;
end
$$;

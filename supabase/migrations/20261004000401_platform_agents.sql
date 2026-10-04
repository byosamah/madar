-- The MCP agent readers of Auth's own tables (plan 5.6; task G3). Track G owns this platform migration. The test harness skips
-- *_platform_*.sql files: this one needs the auth schema, and it names the public tables by schema.
--
-- madar_server has no right on the auth schema. These two functions read one row each, as their owner, and only madar_server
-- may run them. plpgsql, so the body is checked when it runs, after Auth made its tables.

-- When the Auth session of an agent token started, or null when the session is gone, ended, or belongs to another OAuth client.
-- The MCP token check (server/mcp/auth.ts) refuses a token whose session gives null, with a message to sign in again.
create or replace function madar_private.agent_session_at(session_id uuid, client_id uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select s.created_at
    from auth.sessions s
    where s.id = agent_session_at.session_id
      and s.oauth_client_id = agent_session_at.client_id
      and (s.not_after is null or s.not_after > now())
  );
end;
$$;
revoke execute on function madar_private.agent_session_at(uuid, uuid) from public, anon, authenticated;
grant execute on function madar_private.agent_session_at(uuid, uuid) to madar_server;

-- The name and the redirect addresses of one OAuth client (an AI app), for the agent user that its first call makes, and of the
-- earlier clients of the same app, which must have the same set of addresses (server/mcp/agentUser.ts). Auth keeps
-- redirect_uris as one text, the addresses separated by commas.
create or replace function madar_private.agent_client(client_id uuid) returns table (client_name text, redirect_uris text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select c.client_name, c.redirect_uris
    from auth.oauth_clients c
    where c.id = agent_client.client_id
      and c.deleted_at is null;
end;
$$;
revoke execute on function madar_private.agent_client(uuid) from public, anon, authenticated;
grant execute on function madar_private.agent_client(uuid) to madar_server;

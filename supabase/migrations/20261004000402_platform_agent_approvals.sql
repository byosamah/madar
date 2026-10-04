-- The approval that a person records in Madar for an AI app (plan 5.6; task G4; proof.md Z0a item 2, "Z7 and G (consent)",
-- and section G4). Track G owns this platform migration. The test harness skips *_platform_*.sql files: this one needs the auth
-- schema, and it names the public tables by schema.
--
-- Supabase Auth lets an agent token approve an OAuth client that the agent registered itself (proof.md G4): Auth treats an agent
-- token as a full session of the person. So the approval at Auth proves nothing about the person. The Madar consent screen
-- records the approval here through the api function, with the person's browser token, before it asks Auth to approve. The api
-- function refuses every agent token (403 agent_token), so an agent cannot record one. ensureAgentUser (server/mcp/agentUser.ts)
-- makes an agent link only for a client with a row here for the same person.

create table if not exists public.agent_approvals (
  client_id     uuid not null,
  owner_user_id text not null,
  approved_at   timestamptz not null default now(),
  primary key (client_id, owner_user_id)
);

-- The browser roles get nothing, as on every Madar table (plan, change 14). The server reads and adds rows; it never changes or
-- removes one: a removed agent keeps its links removed (agent_links.revoked_at), so an old approval links nothing again.
alter table public.agent_approvals enable row level security;
revoke all on table public.agent_approvals from public, anon, authenticated;
grant select, insert on table public.agent_approvals to madar_server;
create policy server_all on public.agent_approvals for all to madar_server using (true) with check (true);

-- The OAuth client of one pending authorization of this Auth user, or null: an unknown id, another person's authorization, an
-- authorization that Auth approved, denied or let expire. The consent screen calls getAuthorizationDetails first, which writes
-- the person into user_id. Only madar_server may run it.
create or replace function madar_private.agent_authorization(authorization_id text, auth_user_id uuid) returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select a.client_id
    from auth.oauth_authorizations a
    where a.authorization_id = agent_authorization.authorization_id
      and a.user_id = agent_authorization.auth_user_id
      and a.status::text = 'pending'
      and a.expires_at > now()
  );
end;
$$;
revoke execute on function madar_private.agent_authorization(text, uuid) from public, anon, authenticated;
grant execute on function madar_private.agent_authorization(text, uuid) to madar_server;

-- The address that the person saw on the consent screen (security finding CWE-863, 2026-10-28). Track: sec-approval. The test harness
-- skips *_platform_*.sql files: this one needs the auth schema, and it names the public tables by schema.
--
-- The consent screen shows ONE redirect address of an AI app, but Madar stored its approval for the whole client, and Supabase Auth
-- gives a code at once for a known (person, client) pair on ANY address that the client registered. An AI app that registered
-- [a known address, an address of its own] could win the approval through the known address, then take the code on its own address.
-- Now the approval route (server/mcp/approval.ts) reads the address that the screen showed and every registered address of the client,
-- refuses an address that the person did not see (reason agent_redirect_hidden), and stores the seen address here. ensureAgentUser and
-- the per-call check of the mcp function run the same rule. An approval from before this file has null here (the strict form).

alter table public.agent_approvals add column if not exists redirect_uri text;

-- A second approval of the same client by the same person writes the new seen address over the old one (on conflict, do update). The
-- table grants stay as they were (select, insert, delete); only this column may change.
grant update (redirect_uri) on table public.agent_approvals to madar_server;

-- The pending authorization of this Auth user, with what the person saw and what the client registered: the client, the redirect address
-- of the authorization (the one that the screen shows), and every registered address of the client (one text, commas, as Auth keeps it).
-- No row: an unknown id, another person's authorization, or one that Auth approved, denied or let expire. The guards are the same as
-- madar_private.agent_authorization (same id, same Auth user, status pending, not expired). That older function stays for the deploy
-- window: the running mcp and api functions call it until they are deployed again. Only madar_server may run this one.
create or replace function madar_private.agent_pending(authorization_id text, auth_user_id uuid) returns table (client_id uuid, redirect_uri text, redirect_uris text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select a.client_id, a.redirect_uri, c.redirect_uris
    from auth.oauth_authorizations a
    left join auth.oauth_clients c on c.id = a.client_id and c.deleted_at is null
    where a.authorization_id = agent_pending.authorization_id
      and a.user_id = agent_pending.auth_user_id
      and a.status::text = 'pending'
      and a.expires_at > now();
end;
$$;
revoke execute on function madar_private.agent_pending(text, uuid) from public, anon, authenticated;
grant execute on function madar_private.agent_pending(text, uuid) to madar_server;

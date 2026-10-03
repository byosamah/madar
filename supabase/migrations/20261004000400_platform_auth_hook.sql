-- The Custom Access Token Hook of Madar (plan, change 6; platform facts 6.8). Track G owns this platform migration.
--
-- A Supabase token for an AI agent carries aud "authenticated", the same value as the token of a person in the Madar screens.
-- This hook sets aud to the MCP URL of the project for every token that has a client_id (an OAuth client: an agent).
-- The mcp function then requires that aud and a client_id, and the api function refuses any token with a client_id.
-- A browser token has no client_id, so the hook gives its claims back unchanged.
--
-- The URL is not in this file: scripts/deploy/secrets.ts writes it into platform_config for each project, so each project
-- gets its own value. When the row is missing, the hook refuses the agent token with a clear error and never issues an agent
-- token with aud "authenticated". A person's sign-in never depends on the row.
--
-- The proof of G1 (docs/superpowers/real-build/proof.md, section G1) records where the hook finds client_id on the local stack.

-- Track B owns the app tables and also lists platform_config (plan 4.2). B's migration runs first (0100 before 0400), so this
-- statement does nothing after the merge. It is here so the hook works on a stack with no B migration (the G1 proof).
create table if not exists public.platform_config (
  key   text primary key,
  value text not null
);
alter table public.platform_config enable row level security;
revoke all on table public.platform_config from public, anon, authenticated;
grant select on table public.platform_config to supabase_auth_admin;

create or replace function public.madar_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
-- The function runs as its owner, so a row level policy on platform_config can never hide the URL from Auth.
security definer
set search_path = ''
as $$
declare
  claims  jsonb := event->'claims';
  mcp_url text;
begin
  -- Supabase puts client_id in the claims of an OAuth token. The top level of the event is checked too (platform facts 6.8).
  if coalesce(claims->>'client_id', event->>'client_id') is null then
    return jsonb_build_object('claims', claims);
  end if;

  select c.value into mcp_url from public.platform_config c where c.key = 'mcp_url';
  if mcp_url is null or btrim(mcp_url) = '' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 500,
      'message', 'Madar has no MCP URL in platform_config, so it cannot issue a token for an agent.'
    ));
  end if;

  -- aud is a required claim: the hook may change it but not remove it.
  return jsonb_build_object('claims', jsonb_set(claims, '{aud}', to_jsonb(mcp_url)));
end
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.madar_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.madar_access_token_hook(jsonb) from public, anon, authenticated;

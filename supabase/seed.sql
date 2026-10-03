-- The seed of the local stack. "supabase db reset" (and the first "supabase start") runs it after the migrations;
-- "supabase db push" never runs it, so it never reaches a cloud project.
--
-- config.toml turns on the token hook public.madar_access_token_hook (plan, change 6). Track G creates the real function in its
-- platform migration 20261004000400. Until G merges, Auth would run a hook that does not exist, and every sign-in and token refresh
-- fails with "500: Error running hook URI". So this block makes a hook that changes nothing, and only when the function is missing.
-- After G merges, the migration makes the real function first, and this block does nothing.
do $$
begin
  if to_regprocedure('public.madar_access_token_hook(jsonb)') is null then
    create function public.madar_access_token_hook(event jsonb)
    returns jsonb
    language sql
    stable
    as $hook$ select jsonb_build_object('claims', event->'claims') $hook$;
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.madar_access_token_hook(jsonb) to supabase_auth_admin;
    revoke execute on function public.madar_access_token_hook(jsonb) from public, anon, authenticated;
  end if;
end
$$;

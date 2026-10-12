-- The agents that exist already get the name that a new agent gets (owner, 2026-10-12; src/lib/agentName.ts): "<first name of the
-- person> <AI app> Agent", for example "Osama Claude Agent", and in Arabic "وكيل <first name> <AI app>". An agent was named after its AI
-- app, so each one read "Claude". Change this file and agentNamesOf together.
--
-- Only an agent whose name is still the name of its AI app changes: a name that a person set by hand stays. The AI app is the
-- client_name of the newest link of the agent. "AI agent" is what agentNameOf gives when the app sends no name, so it is no app.
-- The Arabic name is set only when the person has one and the agent has none.
do $$
declare
  v bigint;
begin
  create temporary table agent_rename on commit drop as
  with newest as (
    select distinct on (l.agent_user_id) l.agent_user_id, l.client_name
    from agent_links l
    order by l.agent_user_id, l.approved_at desc
  ), parts as (
    select a.id,
      split_part(btrim(o.doc->>'name'), ' ', 1) as first_en,
      split_part(btrim(coalesce(o.doc->>'nameAr', '')), ' ', 1) as first_ar,
      case when n.client_name = 'AI agent' then '' else btrim(regexp_replace(n.client_name, '\s+', ' ', 'g')) end as app,
      coalesce(a.doc->>'nameAr', '') as old_ar
    from users a
      join users o on o.id = a.doc->>'ownerId'
      join newest n on n.agent_user_id = a.id
    where a.doc->>'kind' = 'agent' and a.doc->>'name' = n.client_name
  ), tails as (
    select p.*, case when p.app ~* '\yagent$' then '' else 'Agent' end as tail from parts p
  )
  select t.id,
    concat_ws(' ', nullif(t.first_en, ''),
      nullif(btrim(left(t.app, greatest(0, 80 - length(t.first_en) - length(t.tail) - 2))), ''),
      nullif(t.tail, '')) as new_name,
    case when t.first_ar <> '' and t.old_ar = ''
      then left('وكيل ' || t.first_ar || case when t.app <> '' then ' ' || t.app else '' end, 80)
    end as new_name_ar
  from tails t
  where t.first_en <> '';

  if exists (select 1 from agent_rename) then
    -- The rule of every write of an office table (server/data/officeCache.ts): raise office_meta.version and give the changed rows
    -- that version as "chg", so a warm office cache loads them.
    update office_meta set version = version + 1 returning version into v;
    update users u
      set doc = u.doc || jsonb_strip_nulls(jsonb_build_object('name', r.new_name, 'nameAr', r.new_name_ar)),
          chg = v
      from agent_rename r
      where u.id = r.id;
  end if;
end
$$;

-- Project templates (owner, 2026-10-05, item 6a): stages, tasks, roles and dates in working days. One row for each
-- ProjectTemplate record of src/api/contract/entities.ts (server/data/tables.ts). It is an office list, so it has "chg".
-- The number starts a new day: "supabase db push" adds only files that come after the last migration of a hosted project.

create table project_templates (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  chg bigint not null default 0,
  constraint project_templates_id check (doc->>'id' = id)
);
create index project_templates_chg on project_templates (chg);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same rules:
-- Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table project_templates enable row level security;
revoke all on table project_templates from public, anon, authenticated;
revoke all on sequence project_templates_ord_seq from public, anon, authenticated;
grant select, insert, update, delete on table project_templates to madar_server;
grant usage, select on sequence project_templates_ord_seq to madar_server;
create policy server_all on project_templates for all to madar_server using (true) with check (true);

-- Stage templates merge into project templates. Each stage template becomes a project template with its stages in order, no
-- dates, no roles and no tasks: the same record as projectTemplateFromStages (src/api/projectTemplates.ts) and the prototype
-- step of version 9. The ids continue the "ptp" counter, in the order of the stage templates. The old rows stay, so the stage
-- template calls still answer. A stage template whose name (in any case) a project template has already is left out.
with old as (
  select s.doc, row_number() over (order by s.ord) as n
  from stage_templates s
  where not exists (select 1 from project_templates p where lower(p.doc->>'name') = lower(s.doc->>'name'))
),
made as (
  select old.doc, old.n, (coalesce((select c.n from counters c where c.prefix = 'ptp'), 0) + old.n)::text as num
  from old
),
named as (
  select made.doc, made.n, 'ptp_' || lpad(made.num, greatest(3, length(made.num)), '0') as id
  from made
)
insert into project_templates (id, doc)
select named.id, jsonb_build_object(
  'id', named.id,
  'name', named.doc->'name',
  'roles', '[]'::jsonb,
  'stages', coalesce((
    select jsonb_agg(jsonb_build_object('id', 's' || stage.i, 'name', stage.name, 'startOffset', null, 'durationDays', null) order by stage.i)
    from jsonb_array_elements_text(named.doc->'stages') with ordinality as stage(name, i)
  ), '[]'::jsonb),
  'tasks', '[]'::jsonb,
  'createdBy', named.doc->'createdBy',
  'createdAt', named.doc->'createdAt',
  'updatedAt', named.doc->'createdAt'
)
from named
order by named.n;

-- nextId continues after the highest number. The counters are gap-free, so the counter is never set lower.
insert into counters (prefix, n)
select 'ptp', max(substring(id from 5)::integer) from project_templates having count(*) > 0
on conflict (prefix) do update set n = greatest(counters.n, excluded.n);

-- The rule of every write of an office table (server/data/officeCache.ts): raise office_meta.version and give the new rows that
-- version as "chg", so a warm office cache loads them.
do $$
declare
  v bigint;
begin
  if exists (select 1 from project_templates where chg = 0) then
    update office_meta set version = version + 1 returning version into v;
    update project_templates set chg = v where chg = 0;
  end if;
end
$$;

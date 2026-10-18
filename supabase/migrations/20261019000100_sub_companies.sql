-- Sub-companies (fbk_007, 2026-10-18): the companies of the office group, such as Vado and Bunah. One row for each
-- SubCompany record of src/api/contract/entities.ts (server/data/tables.ts). It is an office list, so it has "chg".
-- The table starts empty, so this file writes no office row and needs no version step (server/data/CLAUDE.md, "Tables").

create table sub_companies (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  chg bigint not null default 0,
  constraint sub_companies_id check (doc->>'id' = id)
);
create index sub_companies_chg on sub_companies (chg);

-- The loops of 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same
-- rules: Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table sub_companies enable row level security;
revoke all on table sub_companies from public, anon, authenticated;
revoke all on sequence sub_companies_ord_seq from public, anon, authenticated;
grant select, insert, update, delete on table sub_companies to madar_server;
grant usage, select on sequence sub_companies_ord_seq to madar_server;
create policy server_all on sub_companies for all to madar_server using (true) with check (true);

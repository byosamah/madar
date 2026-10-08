-- Browser push devices (owner, 2026-10-08). One row for each PushDevice record of src/api/contract/entities.ts
-- (server/data/tables.ts). A device is the push address (endpoint) of one browser of one person. The rows are private: the
-- loaders read only the rows of the person of the call, and no signal, event or History row names a device.
-- It is not an office list, so it has no "chg" column. The number starts a new day: "supabase db push" adds only files that come
-- after the last migration of a hosted project.

create table push_devices (
  id       text primary key,
  ord      bigserial not null,
  doc      jsonb not null,
  user_id  text generated always as (doc->>'userId') stored,
  endpoint text generated always as (doc->>'endpoint') stored,
  constraint push_devices_id check (doc->>'id' = id)
);
-- One row for each endpoint: a second person who registers the same browser moves the row (push.register). The index also
-- finds the row of an endpoint. The longest endpoint is 2,048 characters, under the limit of a b-tree entry.
create unique index push_devices_endpoint on push_devices (endpoint);
-- The devices of one person (push.mine, push.register) and the check of the push producer (server/push/notify.ts).
create index push_devices_user on push_devices (user_id);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same rules:
-- Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table push_devices enable row level security;
revoke all on table push_devices from public, anon, authenticated;
revoke all on sequence push_devices_ord_seq from public, anon, authenticated;
grant select, insert, update, delete on table push_devices to madar_server;
grant usage, select on sequence push_devices_ord_seq to madar_server;
create policy server_all on push_devices for all to madar_server using (true) with check (true);

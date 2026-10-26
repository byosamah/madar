-- The email code guard for agents (owner decision, 2026-10-26, after a security review): a server-only table. An agent that was tricked
-- (prompt injection) must not invite an outsider, make an Admin, change a role or the rights of a role by itself. For these acts Madar
-- emails the PERSON of the agent a 6-digit code, and the act runs only when the agent sends that code in a second call with the same
-- arguments (server/mcp/guard.ts, server/mcp/confirms.ts).
-- A row holds the person, the agent, the call name, a hash of the exact input (without the code), a hash of the code (never the code),
-- the end time (10 minutes), the count of wrong tries (the row dies at 5) and the time of use (a used code never works again).
-- The row writes no office row and needs no version step. The nightly job deletes rows older than one day.

create table agent_confirms (
  id          text primary key,
  person_id   text not null,
  agent_id    text not null,
  call_name   text not null,
  input_hash  text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  tries       integer not null default 0 check (tries >= 0),
  used_at     timestamptz,
  created_at  timestamptz not null
);

-- The lookup of a second call: the agent, the call and the hash of its input.
create index agent_confirms_lookup on agent_confirms (agent_id, call_name, input_hash);
-- The cap of new codes for one person in one hour, and the cleanup by age.
create index agent_confirms_person on agent_confirms (person_id, created_at);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before this table existed, so this file gives it the same rules as the
-- other server-only tables: Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table agent_confirms enable row level security;
revoke all on table agent_confirms from public, anon, authenticated;
grant select, insert, update, delete on table agent_confirms to madar_server;
create policy server_all on agent_confirms for all to madar_server using (true) with check (true);

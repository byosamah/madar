-- The Daftra link (owner, 2026-10-26): two server-only tables, as google_connections. No State collection reads them, so no handler, loader,
-- event, signal or export of the office sees them. Madar only reads Daftra and never writes to it. No key, no site and no token live here.
-- The numbers start a new day: "supabase db push" adds only files that come after the last migration of a hosted project.
--
-- One Daftra account for each sub-company (owner, 2026-10-26): "account" is the account name (the English name of the sub-company in capitals,
-- A to Z and 0 to 9, for example MAZJ). The names are not secret. The keys live in the secrets of the server, never here.
-- daftra_clients: the match of a Madar client to a client of Daftra, in one account. The match must not sit on the Client record, because a
-- Client is in every person's answer (clients.list, ProjectDetail.client). One row for each Madar client and account (a client can have
-- projects under two sub-companies); a second match in the same account replaces the first.
-- daftra_invoices: the cache of the recent invoices of the matched clients. The 15-minute job and daftra.matchClient fill it outside the
-- office lock, because no lock may be held during a Daftra call. Invoice ids repeat across accounts, so the key holds the account.
-- Money is whole halalas.

create table daftra_clients (
  account     text not null,
  client_id   text not null,
  daftra_id   text not null,
  daftra_name text not null,
  matched_by  text not null,
  matched_at  timestamptz not null,
  primary key (account, client_id)
);

create table daftra_invoices (
  account          text not null,
  id               text not null,
  daftra_client_id text not null,
  no               text not null,
  total_halalas    bigint not null check (total_halalas >= 0),
  issued_on        date not null,
  created_at       timestamptz not null,
  payment_status   integer not null,
  paid_on          date,
  draft            boolean not null,
  seen_at          timestamptz not null,
  primary key (account, id)
);
-- The invoices of one matched client in one account (the sheet, the cache fill).
create index daftra_invoices_client on daftra_invoices (account, daftra_client_id);

-- 20261004000102_guards.sql and 20261004000103_roles.sql ran before these tables existed, so this file gives them the same rules as
-- the other private tables: Row Level Security, no right for the browser roles, and full rights with one policy for madar_server.
alter table daftra_clients enable row level security;
revoke all on table daftra_clients from public, anon, authenticated;
grant select, insert, update, delete on table daftra_clients to madar_server;
create policy server_all on daftra_clients for all to madar_server using (true) with check (true);

alter table daftra_invoices enable row level security;
revoke all on table daftra_invoices from public, anon, authenticated;
grant select, insert, update, delete on table daftra_invoices to madar_server;
create policy server_all on daftra_invoices for all to madar_server using (true) with check (true);

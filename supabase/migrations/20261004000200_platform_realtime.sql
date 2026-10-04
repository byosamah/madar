-- The change signals on Realtime (plan 5.3, change 14; task N1.1). The test harness skips *_platform_*.sql files: this one
-- needs the Supabase schema realtime.
--
-- Sending. The server sends each signal with realtime.send inside the save transaction (server/signal/realtime.ts).
-- realtime.send is security invoker, so madar_server needs all four rights below; without any one of them, realtime.send
-- gives only a WARNING and sends nothing (proof.md, Z0a item 5). The insert policy lets madar_server add only private
-- broadcast rows on the two Madar topics.
grant usage on schema realtime to madar_server;
grant execute on function realtime.send(jsonb, text, text, boolean) to madar_server;
grant insert on realtime.messages to madar_server;

create policy madar_server_send on realtime.messages
  for insert to madar_server
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.messages.private
    and (realtime.messages.topic = 'office' or realtime.messages.topic like 'person:%')
  );

-- Listening. A screen joins the private topics "office" and "person:<its Madar user id>". Realtime checks these select
-- policies when a client joins. madar_private.current_madar_user_id() is null for a person who is gone or turned off, so that
-- person joins neither topic, and nobody joins the topic of another person. A token with client_id belongs to an agent (plan,
-- change 6): agents use MCP, not Realtime, so they join neither topic. anon gets no policy, so a client with no session
-- joins nothing. There is no insert policy for the browser roles, so a screen cannot send on these topics.
create policy madar_office_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'office'
    and (select madar_private.current_madar_user_id()) is not null
    and (select auth.jwt() ->> 'client_id') is null
  );

create policy madar_person_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'person:' || (select madar_private.current_madar_user_id())
    and (select auth.jwt() ->> 'client_id') is null
  );

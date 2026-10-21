-- The status of a person on Realtime Presence (chat presence design, 2026-10-21; task P1). The test harness skips *_platform_*.sql
-- files: this one needs the Supabase schema realtime.
--
-- One private Presence topic for each person: "status:<Madar user id>". Presence does not touch the Madar tables.
--
-- Tracking. Only the person may track on the topic of the own id. The insert policy compares the topic with the Madar id of the
-- caller, so no screen can track for another person. madar_private.current_madar_user_id() is null for a person who is gone or
-- turned off, so that person tracks nowhere. A token with client_id belongs to an agent (proof.md, Z0a item 5): agents use MCP,
-- not Realtime, so they never track.
create policy madar_status_track on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) = 'status:' || (select madar_private.current_madar_user_id())
    and (select auth.jwt() ->> 'client_id') is null
  );

-- Reading. Every active person may join every status topic to read it. The same two limits as above: a gone or turned-off
-- person (no Madar id) and an agent token (client_id) read nothing.
create policy madar_status_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) like 'status:%'
    and (select madar_private.current_madar_user_id()) is not null
    and (select auth.jwt() ->> 'client_id') is null
  );

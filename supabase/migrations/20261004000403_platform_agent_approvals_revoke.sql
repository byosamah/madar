-- agents.revokeAll also removes the approvals of the person (wave 5 track H, the G item of the wave 4 follow-ups; proof.md,
-- section H). It follows 20261004000402_platform_agent_approvals.sql of track G, in G's range, and changes nothing there.
--
-- Supabase Auth keeps each OAuth grant after Madar turns a person off, and Auth v2.197.0 has no admin call that removes one
-- person's grant for one client. So an approval that the person recorded in Madar before the turn-off, for an AI app that never
-- called Madar (no agent link yet), would still link that app after the person is on again. The statement of agents.revokeAll
-- (server/mcp/revokeAll.ts) now deletes every approval of the person in the same step that removes the links: the person
-- approves again on the Madar consent screen. The server still never changes an approval; it adds one, or deletes them all.
grant delete on table public.agent_approvals to madar_server;

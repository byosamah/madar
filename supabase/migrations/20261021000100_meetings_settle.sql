-- Meetings, wave 2 (fbk_022, 2026-10-19): the 15-minute job settles the meetings that ended (server/jobs/steps/meetings.ts). It asks
-- for the scheduled meetings that have no settled_at and whose ends_at passed, so this partial index holds only those rows. A settled
-- or cancelled meeting leaves the index. The text order of ends_at is the time order, because every stamp is in office time (+03:00).
-- The minutes (doc->'minutes') and the new fields of a Tracker line and of a file (meetingId) live in the jsonb docs of their rows, and
-- no read selects by them, so they need no column and no backfill. The table meetings is not an office list: this file writes no row.

create index meetings_to_settle on meetings (ends_at collate "C") where status = 'scheduled' and settled_at is null;

/**
 * The rows pins of test:office (Supabase exit, wave 1, wave 0 change 3). Each ceiling started at the wave 0 number of the same
 * read (proof.md, "Wave 0, the rest"), then Task 18 set it to the measured rows of the year office, plus 10%. A read above its
 * ceiling fails the suite: look at its statements first, then change the read or (with a reason in proof.md) the ceiling.
 * usr_001 is the Admin, usr_002 leads projects, usr_005 is a member of the sample office.
 * The badge pins (chats.unreadCount, chats.list) keep the number of the ported read until Track R merges its stored unread
 * number; then they drop to the measured value of that read.
 */
export type ReadPin = { name: string; input: Record<string, unknown>; actorId: string; rowsRead: number; sinceHours?: number };

export const READ_PINS: readonly ReadPin[] = [
  { name: 'chats.unreadCount', input: {}, actorId: 'usr_005', rowsRead: 16_994 },
  { name: 'chats.unreadCount', input: {}, actorId: 'usr_001', rowsRead: 16_968 },
  { name: 'chats.list', input: {}, actorId: 'usr_001', rowsRead: 16_990 },
  // chats.waiting (fbk_011): the ceiling is the measured rows of the year office plus 10% (2026-10-18). The chat batch of 2026-10-19
  // (item 22: a group waits only when named, a 👍 or ✅ answers) reads the reactions and reply links too: 22,579 measured, so 24,837.
  { name: 'chats.waiting', input: {}, actorId: 'usr_005', rowsRead: 24_837 },
  { name: 'chats.waiting', input: {}, actorId: 'usr_001', rowsRead: 48_725 },
  { name: 'notifications.count', input: {}, actorId: 'usr_005', rowsRead: 2 },
  { name: 'notifications.list', input: {}, actorId: 'usr_005', rowsRead: 118 },
  // tasks.list gives each row the unread number of its chat icon (tsk_481, fbk_071). The count reads the unread comments of each listed to-do
  // once more, on top of the total that commentCount reads, so the year office reads about one more scan of its comments (126 comments in each of
  // 12 threads). Before: 2,222 and 2,305 rows read (ceilings 2,444 and 2,536). After the cuts of tsk_481 (a to-do with no comment reads nothing, and one
  // read of the own comments of a row where there were two): 3,745 and 3,817, plus 10%. The reason and the numbers are in proof.md, "tasks.list unread number".
  { name: 'tasks.list', input: { filter: 'mine' }, actorId: 'usr_005', rowsRead: 4_120 },
  { name: 'tasks.list', input: { filter: 'review_for_me' }, actorId: 'usr_002', rowsRead: 4_199 },
  { name: 'projects.list', input: { status: 'all' }, actorId: 'usr_001', rowsRead: 2_028 },
  { name: 'dashboard.get', input: {}, actorId: 'usr_001', rowsRead: 4_510 },
  // search.query reads the chat messages and the task comments too (chat design 2026-10-19, item 16): the office path scans both with instr. The ceilings
  // are the measured rows plus 10%; the reason and the numbers before are in proof.md, "Chat search".
  { name: 'search.query', input: { text: 'plan' }, actorId: 'usr_005', rowsRead: 17_820 },
  { name: 'search.query', input: { text: 'zqxv' }, actorId: 'usr_005', rowsRead: 34_736 },
  { name: 'events.list', input: { limit: 50 }, actorId: 'usr_001', rowsRead: 87 },
  { name: 'events.list', input: { limit: 500 }, actorId: 'usr_001', rowsRead: 19, sinceHours: 1 },
  // reports.office (fbk_016, Task 28): 240,966 rows read for the year, measured on the year office (week 5,138, month 23,194, quarter
  // 86,150), plus 10%. The read holds the tasks of the projects (no date column), the Tracker entries, the payments and the review
  // events. Four event reads (stage moves, completions, pauses, reviews) each scan the events of the period on created_at.
  // The events have no index on the verb. The reason and the test copy time are in proof.md, Wave 4 report data.
  { name: 'reports.office', input: { period: 'year', start: '2026-01-01' }, actorId: 'usr_001', rowsRead: 265_063 },
  // The read that keeps events_project (Task 18 Step 5: 62 rows with it, 12,815 without it). Wave 0 had no pin for it.
  { name: 'events.list', input: { projectId: 'prj_001', limit: 50 }, actorId: 'usr_001', rowsRead: 69 },
  // The update plan of 50 listed projects (fbk_008 item 4, Task 23). It reads the tasks of the listed projects, which cannot be more
  // rows than projects.list reads for all projects (2,028 above, tasks and feed). The ceiling is that bound, not a measured value:
  // the merge lead measures it on the year office and lowers it. The year office links no project, so it gives an empty plan.
  {
    name: 'projectTemplates.syncPlan',
    input: { templateId: 'ptp_003', projectIds: Array.from({ length: 50 }, (_, i) => `prj_${String(i + 1).padStart(3, '0')}`) },
    actorId: 'usr_001',
    rowsRead: 2_028,
  },
];

export type WritePin = { name: string; rowsWritten: number };

/**
 * The rows that one write of everyCall writes on the year office (wave 0: 39, 36, 44, 22). tasks.complete is over its wave 0
 * value: the call of everyCall writes 4 events, a comment, a Tracker entry, 2 tasks and the project, and each event writes 10
 * rows (the row, its key and 8 indexes, each of which a read needs). The reason is in proof.md, "Wave 1: the rows pins".
 */
export const WRITE_PINS: readonly WritePin[] = [
  { name: 'tasks.complete', rowsWritten: 65 },
  { name: 'tasks.update', rowsWritten: 18 },
  { name: 'comments.create', rowsWritten: 24 },
  { name: 'chats.send', rowsWritten: 13 },
];

/** The rows that a cold wake may add to a call: the schema version row, and the snapshot parts (wave 0: 1 row; wave 1: 2). */
export const COLD_EXTRA_ROWS = 4;
/** The rows that the import writes for each record, at most (wave 0: 980,549 for 138,053 records, 7.1; wave 1: 6.90). */
export const IMPORT_ROWS_PER_RECORD = 7.5;

/**
 * The usage step went (owner, 2026-10-23), so a run at minute 0 reads no more than a run at minute 15 now; the hourly ceiling is just a roomy
 * ceiling. The rows that one Cron run reads on the year office, after a first run wrote its reminders (exit wave 3). quarter: a run at
 * minute 15, with no usage step. hourly: the first run of an hour, which also reads the size of every file version. The first
 * ceilings were 3,012 (wave 0 measured 2,738 rows for the trigger loader, the dedupe lookup, the outbox and the cleanup, plus 10%)
 * and 10,000 (one row for each of the 6,000 files and the rest). Task 17 measured 1,486 and 14,695 and set each ceiling to the
 * measured value plus 10%. The hourly value is above its first ceiling: FILES_BYTES_LITE (server/usage/meters.ts) reads 13,200
 * rows, one for each file and one more for each of the 7,200 versions that json_each gives. The reason is in proof.md.
 */
export const CRON_PINS = { quarter: 1_635, hourly: 16_165 } as const;

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
  { name: 'notifications.count', input: {}, actorId: 'usr_005', rowsRead: 2 },
  { name: 'notifications.list', input: {}, actorId: 'usr_005', rowsRead: 118 },
  { name: 'tasks.list', input: { filter: 'mine' }, actorId: 'usr_005', rowsRead: 2_444 },
  { name: 'tasks.list', input: { filter: 'review_for_me' }, actorId: 'usr_002', rowsRead: 2_536 },
  { name: 'projects.list', input: { status: 'all' }, actorId: 'usr_001', rowsRead: 2_028 },
  { name: 'dashboard.get', input: {}, actorId: 'usr_001', rowsRead: 4_510 },
  { name: 'search.query', input: { text: 'plan' }, actorId: 'usr_005', rowsRead: 1_142 },
  { name: 'search.query', input: { text: 'zqxv' }, actorId: 'usr_005', rowsRead: 7_738 },
  { name: 'events.list', input: { limit: 50 }, actorId: 'usr_001', rowsRead: 87 },
  { name: 'events.list', input: { limit: 500 }, actorId: 'usr_001', rowsRead: 19, sinceHours: 1 },
  // The read that keeps events_project (Task 18 Step 5: 62 rows with it, 12,815 without it). Wave 0 had no pin for it.
  { name: 'events.list', input: { projectId: 'prj_001', limit: 50 }, actorId: 'usr_001', rowsRead: 69 },
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

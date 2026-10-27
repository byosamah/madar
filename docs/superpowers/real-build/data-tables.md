# Data tables: notes for each feature

The per-feature notes of the tables in `server/data/`. The rules that a change can break silently are in
`server/data/CLAUDE.md`. This file keeps the detail of each table, taken from the guide. The migrations and `tables.ts`
state the columns; read them first.

## Project fields in the jsonb doc
- `Project.nameAr` (fbk_062) lives in the `projects.doc` jsonb: no column and no migration. The `projects.search_text` server
  column holds it (`tables.ts`), so a save of a project writes it and the search loader finds a project by the Arabic name. A
  project saved before the field has no Arabic name in its `search_text` and needs none.
- `Project.continuous` (fbk_069) lives in the `projects.doc` jsonb: no column, no migration, no change in `tables.ts`.
- Folders of the Files & Links tab (fbk_066) live in the `doc` of their project (`Project.folders`): no table and no migration.
  The project is an office list, so a loader finds the project of a folder id in `L.office.projects`. `folders.create` and
  `folders.rename` need only the office; `folders.delete` also loads the files of the project (`foldersDelete`,
  `loaders/project.ts`); `files.move` loads the file by id (`fileCall`). The story loader reads the files of a project whose
  folder event is in the story. `FileRec.folderId` lives in the `files` doc, as `conversationId` does: no column, no index. A
  folder change is a change of the `projects` kind, so a hidden project sends it only as person signals
  (`server/data/folderSignals.test.ts`).

## Server-only tables
- `push_devices` (`20261008000100_push_devices.sql`): the private rows of the browsers that get push. Not an office list.
  `loaders/push.ts` reads the own rows of the person of the call and nothing more (`push.register` also reads the row of its
  endpoint). `diffState` adds no kind for it, so a save of a device sends no signal. `endpoint` has a unique index.
  `SaveResult.messageIds` and `SaveResult.commentIds` list the messages and comments a save inserted, for the push producer.
- `google_connections` and `google_events` (`20261021000200_google_calendar.sql`, fbk_022): server-only tables, in
  `SERVER_TABLES`, with no State collection and no loader. `google_connections` has one live row for each person (a partial
  unique index on `user_id` where `state <> 'revoking'`); its `sealed_token` is AES-256-GCM cipher text
  (`server/google/keys.ts`). `google_events` holds the Google event of a meeting for a person. Only `server/google/store.ts`
  reads and writes them. The nightly backup holds them (cipher text only), and the backup check lists them in
  `OUTSIDE_OFFICE_LOCK`, because the Google effects write them outside the office lock.
- `google_calendars` (`20261021000300_google_calendars.sql`): the third Google table, server-only. One row for each person:
  `user_id` (primary key), `calendar_id`, `changed_at`. It holds the id of the calendar that Madar made, and no key and no event.
  `google.connect` reads it before it makes a calendar and writes it (`rememberCalendar`, an upsert that changes the row only
  when the id changes) in the transaction that inserts the connection, so a new connect uses the same calendar. A disconnect
  keeps the row; `users.remove` deletes it in its transaction (`revokeRowsOf`). It is not in `OUTSIDE_OFFICE_LOCK`: both writers
  hold the office lock.
- `daftra_clients` and `daftra_invoices` (`20261026000100_daftra.sql`): two server-only tables, both keyed by the Daftra account
  (one account for each sub-company): `(account, client_id)` and `(account, id)`. The match of a Madar client to a Daftra client,
  and the cache of recent invoices. Only `server/daftra/store.ts` reads and writes them. They are in `OUTSIDE_OFFICE_LOCK`,
  because the cache fill writes outside the office lock. See `server/daftra/CLAUDE.md`. `INTERNAL_LOADER_OF`
  (`loaders/index.ts`) holds the loader of `payments.daftraPaid`, the one call that only the job runs; `loadFor` reads it after
  `LOADER_OF`.
- `agent_confirms` (`20261026000200_agent_confirms.sql`): the codes of the email code guard of agents. One row for each request
  of an agent for a risky Admin act: person, agent, call name, hash of the exact input, hash of the code (never the code), end
  time, count of tries (wrong ones and the right one), time of use. `server/mcp/confirms.ts` is the store (`sqlConfirms` on
  both databases, `memoryConfirms` in `memoryData`); `CallTx.confirms` is optional. The claim of a code runs in the transaction
  of the act, so it rolls back with it. The job deletes rows older than one day. The flow: `server/mcp/CLAUDE.md`.

## Files with a private owner
- A file of a direct chat or a group keeps `conversationId` in its `files` doc: no column and no migration, because no read
  selects by it. Its row has `project_id` and `task_id` null, so the search loader and `files.list` never load it. `diffState`
  counts `files` as a kind of the chat part (`Diff.chatKinds`): its save sends a person signal to each member of the chat and no
  office signal (`save.ts`).
- A file of a meeting with no project keeps `meetingId` in its `files` doc: no column and no migration. Its row has `project_id`
  and `task_id` null, so the search loader and `files.list` never load it. `diffState` counts `files` with a `meetingId` as a
  private change of that meeting (`officeMeetings`). `files.upload` with a `meetingId` loads the meeting by id; `attachedFiles`
  and the loaders of `files.delete`, `files.markDelivered` and `files.share` load the meeting of a meeting file, because the
  view rule reads it.

## Meetings and minutes
- `meetings` (`20261020000100_meetings.sql`, fbk_022): not an office list. Generated columns `project_id`, `organizer_id`,
  `starts_at`, `ends_at`, `status`, `settled_at`; text indexes on `starts_at collate "C"` and `(project_id, starts_at)`, and a
  GIN index on `doc->'attendeeIds'`. `loaders/meetings.ts`: `meetings.list` reads one window (`atOrAfter` and `atBefore` on
  `starts_at`), `meetingConds` is the view rule in SQL (`project_id` in the office projects, or the person is the organizer or
  an attendee), and `meetingCall` reads one meeting by id with the minutes task and the Tracker line it names. The handler
  checks the view rule again on the rows. `meetings.create` reads the office only.
- `events.list` adds the test "no `officeMeetingId`, or one of the private meetings of the person" for every person
  (`privateMeetingsOf`), the Admin too, and the migration adds the statistics `events_office_meeting` for it. The partial index
  `meetings_to_settle` on `ends_at collate "C"` where `status = 'scheduled'` and `settled_at is null`
  (`20261021000100_meetings_settle.sql`) serves the job that settles ended meetings. The minutes (`doc->'minutes'`), the
  `meetingId` of a Tracker line and the `meetingId` of a file live in the jsonb docs and need no column. `meetings.settle` loads
  the meeting by id (`meetingCall`) and nothing else. `notifications.count` reads the meeting of a notice with
  `INBOX_MEETING_FIELDS`. `projectDelete` reads the meetings of the project and their notices.
- The minutes: `meetings.get`, `settle` and `saveMinutes` load the meeting (`meetingCall`), its Tracker line, and the files of
  the minutes (on the meeting and on the line); `saveMinutes` also loads the files that the new minutes carry (`attachedFiles`,
  with the meeting of a meeting file). The rows of `meetings.list` hold no minutes. `tracker.list`, `trackerScope` (close,
  update, delete, assignReply) and the event targets (`eventTargets`: the feed and the Undo) load the meeting of a line that
  names one and the files of its minutes (`lineMinutes`), because the row gives `meeting`, `minutes` and `canEditMinutes` and
  the Undo reads the right to write the minutes.
- A series needs no column and no index: `seriesId` and `repeat` live in the doc. `meetings.update` and `meetings.cancel` with
  the scope `later` use `meetingChange`, which adds one read of the series (`field seriesId` in the person's visible meetings,
  `starts_at` at or after the start of the meeting, so the `meetings_starts` index bounds it). `meetings.extend` uses
  `meetingExtend`: the same read from the start of today. The job reads the last meeting of each short series with
  `EXTEND_SQL`, a window statement over the meetings that start today or later (the index `meetings_starts` serves it).

## Chat search
- `20261020000200_message_search.sql`: `messages.search_text` and `comments.search_text` hold `bodySearchText(body)`
  (`src/lib/searchMatch.ts`), written by the save from `tables.ts`. A deleted message keeps null; the Undo writes it again. The
  GIN trigram indexes `messages_search` and `comments_search` use `extensions.gin_trgm_ops`, and the loader `contains` sends an
  escaped LIKE, so a key press never reads every message. `search_fold(text)` is the fold in SQL (backfill and the parity test);
  it must stay in step with `bodySearchText`. One known difference: `İ` (U+0130) folds to `i` in SQL and to `i` plus a dot in
  JavaScript; no other tested letter differs. The index needs a table of some size: with 6,000 comments Postgres read every row.

## Table versions of the SQLite path
- Version 3: the sign-in rows of wave 2 and the table `usage_day` of wave 3 (`USAGE_DAY_SQL`). `applyLiteSchema` runs the steps
  above the office version in one transaction. `LiteDb.isOpen()` tells the network port of the office object that a transaction
  is open. `SaveResult.noticeIds` names the notices of a save: the producers on SQLite read them in place of the `xmin` test.
  `DAY_ROW_LITE` (the day row of the meters) lives in `server/office/meter.ts`.
- Version 4 (fbk_007): the office list `sub_companies`, with only `id` and `doc`. Version 5 (fbk_022): the table `meetings` and
  its two read indexes. Version 6 (chat search): `search_text` on `messages` and `comments`; the office path keeps no index on
  it (`contains` is `instr`, a scan; `exit-handoff.md`, section 7, names the FTS5 index for the restart). Version 7: the partial
  index `meetings_to_settle`, with no `collate`. Version 8: `google_connections` and `google_events`. Version 9:
  `google_calendars`. Version 10: the index `chat_reads_conversation`. Version 11: the Daftra tables. Version 12: `agent_confirms`.
  The order of versions 6 to 8 comes from the join of 2026-10-20: the chat batch reached main first with version 6, so the
  meetings settle step became 7 and the Google step became 8. The Daftra step (11) changed in place, because it was not released.
- Each event index costs 1 row written for each event, and a read needs each of the 8. Task 18 dropped four of them, one at a
  time: a read then took 12,815 to 183,416 rows in place of 4 to 4,189 (proof.md "Wave 1: the rows pins").

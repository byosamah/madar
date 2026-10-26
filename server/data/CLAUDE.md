# Data layer

The server keeps each record of the zod contract as one JSON row in Postgres. `runCall` loads the rows, runs the handler,
and saves the difference. Migration rules are in `supabase/CLAUDE.md`.

## Files
- `tables.ts`: the table of each zod collection. `rows.ts`, `whole.ts`: read rows and whole collections.
- `save.ts`: the diff save. `officeCache.ts`: the office cache. `sql.ts`: the SQL helper. `loaders/`: the loader of each call.

## Tables
- Each entity table: `id text pk`, `ord bigserial`, `doc jsonb` (the whole zod record), generated key columns,
  `search_text`, `chg` (`supabase/migrations/20261004000100_core.sql`).
- A new zod collection needs a table in a new migration and an entry in `tables.ts`.
- `Project.nameAr` (fbk_062) lives in the `projects.doc` jsonb: no column and no migration. The `projects.search_text` server column holds it (`tables.ts`), so a save of a project writes it and the search loader finds a project by the Arabic name. A project saved before the field has no Arabic name in its `search_text` and needs none.
- The loops of `20261004000102_guards.sql` and `20261004000103_roles.sql` ran once, so a table of a later migration gives
  itself RLS, the revoke from public, anon and authenticated, the madar_server grants and the `server_all` policy
  (`20261005000100_project_templates.sql` is the pattern).
- A migration that writes office rows follows the office cache rule: it raises `office_meta.version` and sets `chg` of the
  rows to it. A migration that makes records with a counter prefix sets that counter to the highest number.
- `project_templates` is an office list (`OFFICE_COLLECTIONS`), so `projects.create` reads its template from the office.
- Server-only tables (`20261004000101_server_tables.sql`): office_meta, office_deletes, person_seq, platform_config, stories,
  idempotency, outbox, upload_intents, agent_links, mail_log, mail_outbox, usage_month, usage_warnings (both unused since 2026-10-23, kept), rate_limits, job_runs.
- `push_devices` (`20261008000100_push_devices.sql`, owner 2026-10-08): the private rows of the browsers that get push. Not an office
  list. `loaders/push.ts` reads the own rows of the person of the call and nothing more (`push.register` also reads the row of
  its endpoint). `diffState` adds no kind for it, so a save of a device sends no signal. `endpoint` has a unique index.
  `SaveResult.messageIds` and `SaveResult.commentIds` list the messages and comments a save inserted, for the push producer.
- A file of a direct chat or a group (owner, 2026-10-19) keeps `conversationId` in its `files` doc: no column and no migration, because
  no read selects by it. Its row has `project_id` and `task_id` null, so the search loader and `files.list` never load it. `diffState`
  counts `files` as a kind of the chat part (`Diff.chatKinds`): its save sends a person signal to each member of the chat and no office signal
  (`save.ts`, owner 2026-10-21).
- A file of a meeting with no project (wave 2) keeps `meetingId` in its `files` doc: no column and no migration. Its row has `project_id` and `task_id`
  null, so the search loader and `files.list` never load it. `diffState` counts `files` with a `meetingId` as a private change of that meeting
  (`officeMeetings`). `files.upload` with a `meetingId` loads the meeting by id; `attachedFiles` and the loaders of `files.delete`, `files.markDelivered`
  and `files.share` load the meeting of a meeting file, because the view rule reads it.
- The minutes (wave 2): `meetings.get`, `settle` and `saveMinutes` load the meeting (`meetingCall`), its Tracker line, and the files of the minutes (on the
  meeting and on the line); `saveMinutes` also loads the files that the new minutes carry (`attachedFiles`, with the meeting of a meeting file). The rows of
  `meetings.list` hold no minutes, so the list reads the meeting rows only. `tracker.list`, `trackerScope` (close, update, delete, assignReply) and the event
  targets (`eventTargets`: the feed and the Undo) load the meeting of a line that names one and the files of its minutes (`lineMinutes`), because the row
  gives `meeting`, `minutes` and `canEditMinutes` and the Undo reads the right to write the minutes.
- Chat search (`20261020000200_message_search.sql`, chat design 2026-10-19, item 16): `messages.search_text` and `comments.search_text`
  hold `bodySearchText(body)` (`src/lib/searchMatch.ts`), written by the save from `tables.ts`. A deleted message keeps null; the
  Undo writes it again. The GIN trigram indexes `messages_search` and `comments_search` use `extensions.gin_trgm_ops`, and the loader
  `contains` sends an escaped LIKE, so a key press never reads every message. `search_fold(text)` is the fold in SQL (backfill and the
  parity test); it must stay in step with `bodySearchText`. One known difference: `İ` (U+0130) folds to `i` in SQL and to `i` plus a dot
  in JavaScript; no other tested letter differs. The index needs a table of some size: with 6,000 comments Postgres read every row.
- `meetings` (`20261020000100_meetings.sql`, fbk_022): not an office list. Generated columns `project_id`, `organizer_id`, `starts_at`, `ends_at`,
  `status`, `settled_at`; text indexes on `starts_at collate "C"` and `(project_id, starts_at)`, and a GIN index on `doc->'attendeeIds'`.
  `loaders/meetings.ts`: `meetings.list` reads one window (`atOrAfter` and `atBefore` on `starts_at`), `meetingConds` is the view rule in SQL
  (`project_id` in the office projects, or the person is the organizer or an attendee), and `meetingCall` reads one meeting by id with the
  minutes task and the Tracker line it names. The handler checks the view rule again on the rows. `meetings.create` reads the office only.
- A handler that checks a right on a row the caller may not see (`meetings.extend`: the true last meeting of a series) needs a
  loader without `meetingConds`; with it, the shadow run finds `forbidden` on the scoped load and `not_found` on the whole office.
  `events.list` adds the test "no `officeMeetingId`, or one of the private meetings of the person" for every person (`privateMeetingsOf`), the
  Admin too (owner, 2026-10-19, Q4), and the migration adds the statistics `events_office_meeting` for it. Wave 2 adds the partial index
  `meetings_to_settle` on `ends_at collate "C"` where `status = 'scheduled'` and `settled_at is null` (`20261021000100_meetings_settle.sql`), for the job
  that settles ended meetings. The minutes (`doc->'minutes'`), the `meetingId` of a Tracker line and the `meetingId` of a file live in the jsonb docs
  and need no column. `meetings.settle` loads the meeting by id (`meetingCall`) and nothing else: the line it makes needs no other row. `notifications.count` reads the
  meeting of a notice with `INBOX_MEETING_FIELDS`. `projectDelete` reads the meetings of the project and their notices.
  A series (wave 3, owner 2026-10-19) needs no column and no index: `seriesId` and `repeat` live in the doc. `meetings.update` and `meetings.cancel` with the scope
  `later` use `meetingChange`, which adds one read of the series (`field seriesId` in the person's visible meetings, `starts_at` at or after the start of the
  meeting, so the meetings_starts index bounds it). `meetings.extend` uses `meetingExtend`: the same read from the start of today. The job reads the last meeting of
  each short series with `EXTEND_SQL`, a window statement over the meetings that start today or later (the index `meetings_starts` serves it).
- `google_connections` and `google_events` (`20261021000200_google_calendar.sql`, fbk_022): server-only tables, in `SERVER_TABLES`, with no State
  collection and no loader. `google_connections` has one live row for each person (a partial unique index on `user_id` where `state <> 'revoking'`);
  its `sealed_token` is AES-256-GCM cipher text (`server/google/keys.ts`). `google_events` holds the Google event of a meeting for a person.
  Only `server/google/store.ts` reads and writes them. The nightly backup holds them (cipher text only), and the backup check lists them in
  `OUTSIDE_OFFICE_LOCK`, because the Google effects write them outside the office lock.
- `google_calendars` (`20261021000300_google_calendars.sql`, owner test 2026-10-20): the third Google table, server-only, in `SERVER_TABLES`. One row for each
  person: `user_id` (primary key), `calendar_id`, `changed_at`. It holds the id of the calendar that Madar made, and no key and no event. `google.connect`
  reads it before it makes a calendar and writes it (`rememberCalendar`, an upsert that changes the row only when the id changes) in the transaction that
  inserts the connection, so a new connect uses the same calendar. A disconnect keeps the row; `users.remove` deletes it in its transaction
  (`revokeRowsOf`). It is not in `OUTSIDE_OFFICE_LOCK`: both writers hold the office lock. The migration follows the pattern of `google_connections`.
- `events` only grows: a trigger refuses update and delete, and madar_server has only select and insert. Undo is a new
  event (`undoes`). The save never writes `undoneBy`.

- Folders of the Files & Links tab (fbk_066, owner 2026-10-26) live in the `doc` of their project (`Project.folders`): no table and no migration. The
  project is an office list, so a loader finds the project of a folder id in `L.office.projects`. `folders.create` and `folders.rename` need only the office;
  `folders.delete` also loads the files of the project (`foldersDelete`, `loaders/project.ts`); `files.move` loads the file by id (`fileCall`). The story loader
  reads the files of a project whose folder event is in the story. `FileRec.folderId` lives in the `files` doc, as `conversationId` does: no column, no index.
  A folder change is a change of the `projects` kind, so a hidden project sends it only as person signals (`server/data/folderSignals.test.ts`).

## Counters, stories, idempotency
- Counters are a table under the office lock, so they have no gaps.
- Story IDs: `sty_` + 22 base32 characters, under 24 hours old, the same actor.
- Idempotency keys belong to the actor. The digest is sha256 of the call name and the input. The same key with another
  input gives `conflict` `key_reused`.

## Office cache
- `officeCache.ts` keeps committed rows only, frozen, versioned by `office_meta.version`.
- Any change to an office table raises the version, sets `chg` and records deletes in `office_deletes` (kept 7 days).
- A write asks for the counters with the version (DB-12, 2026-10-21): `runWrite` calls `t.office({ counters: true })`, which sends
  `META_COUNTERS_SQL` (office_meta and a json object of the counters) as the first statement after the lock, and the loader's
  `sqlSource(q, { counters })` gives them with no statement of its own. A read keeps `META_SQL`. Never read the counters of a write
  before the lock, and never cache them with the snapshot: a save can change a counter and leave the version as it is.

## Loaders
- Every call needs a loader entry in `loaders/`, or a test fails.
- Office tasks (no project, owner 2026-10-06): `officeTaskConds` (`steps.ts`) is the view rule in SQL. A read with a limit
  loads each kind with its own limit (search), or filters in SQL first (`events.list`: `officeTaskId` of the tasks the
  person sees), so the cut of the handler gives the same rows. `trapOffice` (`sweep.ts`) holds office tasks and ties at the
  cut of the newest rows (`newestTies`, in prj_004) for the sweep. `badgeTraps` holds the badge and bell cases: a tie with the
  own last comment, a helper, a task that an agent made, a hidden notice, a gone task and a report. `hiddenProjectTraps` (`sweep.ts`, in `trapOffice`) adds
  a hidden project (leader usr_005, team usr_006, chosen usr_007) with a to-do, a comment, a post and a chat line, and `hiddenProjectWrites` its writes, so
  the signal invariants (`test/invariants.ts`) see a hidden part. The Inbox loader (`inbox.ts`, `deletedProjects`) also brings the `project.deleted` event of
  every project that a notice names through its item and the office no longer holds, because `noticeProjectHidden` fails closed without it.
- Hidden projects (owner 2026-10-22, wave D2): the view rule of a project in SQL is `visibleProjects`, `visibleIds` and `projectConds`
  (`steps.ts`), built from `L.office.projects`, `L.office.members` and `L.authority` with `projectViewer` (`src/api/projectView.ts`).
  Every read across projects takes its ids from them: `projects.list`, the Dashboard, `tasks.list` (through `peopleFilter`), the
  search (tasks, files, comments; each kind keeps its own limit of 5), `reports.office`, `meetingConds`. `eventProjectConds`
  (`steps.ts`) is the condition of `events.list` and of the office stage-move count: `project_id notIn` the projects the person does
  not see and the projects deleted while hidden. A holder of `project.hidden` needs no pre-read. Any other person costs one read of
  the `project.deleted` events (a few rows) before the main read. The task threads of the Inbox take `ThreadsArgs.seen` (the
  visible ids): `threadsSql`, `memorySource` and `lite/source.ts` keep a thread of a project task only when its project is in `seen`,
  so the cut by `limit` never counts a thread that the handler drops. `hiddenTraps` and `hiddenSweep` (`sweep.ts`) fill each SQL
  limit with rows of a hidden project (search 5, newest messages 5, `events.list` 20, threads 100), and the tests of `loaders.test.ts`
  check that the visible rows stay.
- The shadow run (`server/test/shadow.ts`) runs each API test in memory and on the database, and fails on any difference.
- Read indexes (performance audit 2026-10-07): `20261007000100_read_indexes.sql` adds the statistics `events_office_task` on
  `doc->'officeTaskId'` and the indexes `events_created_c`, `events_project_created`, `messages_conversation_newest`,
  `comments_target_id` and `events_target_id`, then runs analyze. `server/it/readIndexes.it.test.ts` checks that the loader
  statements use them on growth data. Keep that test green when you change the SQL of a loader read.
- A Select with `per`, a limit and a top-level in-list on the `per` column reads each key with a LATERAL subquery on the index
  of that key (`fetch first n rows with ties` for ties, else `limit n`). Every other Select with a limit keeps the `rank()` or
  `row_number()` window form. Both forms give the same rows in the same order (`sqlSource.ts`, `selectSql`).
- A Select with a limit, no `per`, no ties and an order that ends with the id (`order.id`) takes the plain LIMIT form: one key of an
  in-list reads as an equality, the order is the order columns and the id (no `t.ord`), and the outer `order by x.ord` keeps the row
  order. An index in that order then gives the first rows with no sort (the Inbox list, `notifications_inbox_c`; perf2 DB-9).
- The perf2 indexes (`20261022000300_read_indexes_perf2.sql`): `comments_author_task` (the threads statement), `notifications_inbox_c`
  (it replaces `notifications_inbox`: the unread read and the newest read ones, in text order), and the partial index
  `events_report_verbs` (the five report verbs, for `reports.office`). `readIndexes.it.test.ts` pins each plan.
- A field pick (`Select.pick`) returns one jsonb array for each row: a mask first (bit i is 1 when the doc has no key i), then
  the value of each key in the order of the pick. `sqlSource.select` builds the object back (`unpick`), in the key order of
  jsonb, so an absent field stays absent and a JSON null stays null. The key names never repeat in a row (about 40% fewer bytes,
  perf2 DB-4) and go in one array parameter, never in the SQL text. A pick of more than 50 keys keeps the object form with
  `jsonb_each` (Postgres takes at most 100 arguments in a function call, and the array holds the mask and one value for each key).
- `atOrAfter` (`events.list` since) adds a text lower bound on `created_at collate "C"`: the UTC text of the time minus 36
  hours. The timestamptz test still decides, so the bound never removes a row. A count with a bounds condition on its `per`
  column counts each key in a LATERAL subquery on that column (a plain join let Postgres scan every message at 15,000 messages;
  `readIndexes.it.test.ts` pins the plan, perf2 DB-5).
- `after` is the mirror of `before`, and `order.asc` reads oldest first (no ties); `chats.messages` with `around` uses both.
  `contains` sends an escaped LIKE on Postgres (`likeOf`, `sqlSource.ts`), so a trigram index serves it; memory and SQLite keep
  the substring test.
- `search.query` reads the message hits after its other reads (`messageHits`, `loaders/overview.ts`): the newest 5 live messages of the
  visible chats, the newest 5 comments of project tasks (the read goes again without a task that the load does not hold, because
  Postgres keeps the project of the comment of a deleted task), and the newest 5 comments of the office tasks that the person sees.
  `OFFICE_TASK_HIT` adds the title to the pick of those tasks. `source.sweep.test.ts` lets these three statements sort in a temporary
  b-tree: they scan `search_text` on the office path until the restart.
- `referencing` (the Undo check of a create) sends one equality on the text column when the reference path is one plain field
  with a text column in `query.ts` (`columnOfField`). A list or nested path keeps `jsonb_path_exists`.
- Leak rule for picks: `chats.unreadCount` has its own loader (`chatsUnread`), with `THREAD_TASK_FIELDS` and
  `THREAD_COMMENT_FIELDS` (`chat.ts`). `notifications.count` reads its targets with `INBOX_TASK_FIELDS` (`inbox.ts`), and posts
  with `INBOX_UPDATE_FIELDS` (id and project: `noticeProjectHidden` reads the project of a post, hidden projects wave D3) and reports with the id only, and its own unread notices with `INBOX_COUNT_NOTICE_FIELDS` (count mode only: the list and the writes keep whole rows;
  perf2 DB-8). Each task pick must hold every field that a view rule reads (`mayViewTask`, `taskResource`,
  `hiddenTask`: projectId, ownerId, helperIds, createdBy). `chats.list`, `chats.markRead` and the notification writes keep
  whole rows. `pickedByKey` (`steps.ts`) is only for a read that never saves and loads nothing else of that table, because a
  later `byKey` keeps the picked copy.
- Picks of perf2 (all reads that never save a row): the jobs loader reads each open task with `JOB_TASK_FIELDS` and only the tasks past due or due
  within `JOB_DUE_AHEAD_DAYS` (4) days of the run (`atBefore` on `due_date`; with no run time it reads every open task); `reports.office` reads
  the Tracker lines with `REPORT_TRACKER_FIELDS`; `tasks.list` reads the tasks of a waiting project a second time only when its first read had a
  narrowing condition. `perf2.test.ts` pins each one against the whole office.
- The unread count and the reply that waits of a task thread read the messages only (fbk_027): the chat loader adds `MESSAGES_ONLY`
  (`dates` and `kind` null) to the count, to the newest message and to the own newest message, and keeps the reads of the newest item of any
  kind (the preview, the order, who is in the thread). Change `taskUnread` and `waitingThread` (`src/api/handlers/chats.ts`) with it.
- The unread count of a chat is one grouped count, or two (chat design item 23): the project chats that `countsNamedOnly` marks (the Admin's
  chats of projects that the Admin neither leads nor works on, with no stored `notify: 'all'`) get a second grouped count with the extra
  condition `{ has: 'mentions', value: userId }`; every other chat keeps the first. Change `unreadIn` (`src/api/chatState.ts`) with it.
- The choice of the Admin (`adminReachOf`, owner 2026-10-23) feeds the same rule in the loader: `chatsOf` passes it to `countsNamedOnly` (`all`
  counts every message), and `chatsAll`, `chatsUnread` and `chatsMarkRead` read the chats through `listed(L)` (`mine` leaves out the project chats
  with the role `other`, `hiddenByReach`). `chats.markRead` of such a hidden chat loads that chat by itself (`chatsOf`), because the list no longer
  does. `loaders.test.ts` keeps the whole office and the scoped load equal for each choice. A copy of a notice has `forUserIds` and no column.
- `atBefore` (a Cond on a stamp column) is the upper bound of a period: a timestamp test in SQL, in memorySource and in the
  SQLite compile, never text. `reports.office` (`loaders/report.ts`) reads the clock from `LoadCtx.now` (the call's time), and
  its counts come from `countWhere` with one key for each value (`REPORT_KEYS`). A loader without the clock never resolves a period.
- A Source gives rows that the caller owns (`sqlSource` gets new objects from pg, `memorySource` gives copies), so
  `Load.state()` keeps them with no second copy. The office lists of the State stay copies of the snapshot.
- `Load.batch(steps)` sends reads that do not depend on each other as ONE statement (perf2 SV-10): `sqlSource.batch` joins them with
  `union all` (`batchSql`) and gives one row for each read, with that read's rows as one jsonb array (`jsonb_agg`). The chat loaders
  (`chat.ts`: `everyChat`, `chatsWaiting`) run in rounds: 3 statements for `chats.unreadCount` and `chats.list` (were 9 to 11), and 3
  for `chats.waiting` (was 12). A step must not need the rows of another step of the same batch (the keys that a `byKey` step misses are
  chosen before the batch runs). `memorySource` and `liteSource` have no `batch`; `Load.batch` then asks them one read at a time and
  gives the same State. One read left in a batch keeps its own statement. `loaders.it.test.ts` pins at most 3 statements for the
  badge and the list.
- Save: `runWrite` takes `before` from `beforeOf` (`loaders/build.ts`). Its office lists are the frozen snapshot lists, and
  every other collection is a deep copy. Only the save step reads `before`; a write into its office part throws. `diffState`
  makes the JSON of a deep-frozen record once (a WeakMap in `save.ts`).

## Roles and access
- madar_server owns nothing. RLS is on for every table, with one policy for madar_server only.
- anon and authenticated have no grant. The Data API (PostgREST, GraphQL) is off.
- New functions get no default EXECUTE. Grant each one by name.
- `madar_private` security definer functions: `current_madar_user_id`, `agent_session_ok`, `agent_session_at`,
  `agent_client`, `agent_authorization`, `storage_bytes`. Public: `madar_access_token_hook`.

## SQL rules
- Only `set local` on the pooler: `sql.ts` refuses a plain SET.
- A transaction starts with one simple query: BEGIN and the `set local` lines go joined (`sql.ts` START), with no values,
  so pg uses the simple protocol. The pooler keeps the settings inside the transaction only (proof.md, pooler probes,
  2026-10-08). The D1 harness path keeps `savepoint madar_tx` and the `set local` lines as separate queries.
- The pooler pools (`writeUrl`, `readUrl`) close an idle connection after 1 s (`IDLE_TIMEOUT_MS`), with `keepAlive: true`.
  It was 120 s until 2026-10-16: Supabase gives each request a new worker that seldom takes a second one, so a kept connection
  only held a pooler client, and the client limit of 200 filled under the deploy suite (EMAXCONN, `server/CLAUDE.md`). The
  Workers `connectionString` form keeps the pg defaults: that Db lives for one request.
- The Workers `connectionString` form (the Hyperdrive binding) also sets `query_timeout` 12 s (`QUERY_TIMEOUT_MS`).
  Hyperdrive can hold a BEGIN until it has a free origin connection, and neither `lock_timeout` nor `statement_timeout`
  covers that wait (proof.md, Hyperdrive probe, 2026-10-16). A query that hits the limit throws its client away with no
  rollback (the query still runs on that connection).
- `Db.warm(mode)` (optional on the port) opens the connection of one pool and sends no statement. It does nothing with the
  harness `callerClient`, or when the pool already holds a client.
- Never write `public.` in a table name.
- Database TLS fails closed (see `server/CLAUDE.md`).

## The SQLite path (Supabase exit, wave 1)
- `lite/` holds the SQLite form of this layer, beside the Postgres form: `host.ts` (node:sqlite and the refusal guard),
  `db.ts` (the Db port: one transaction at a time, no write in a read, `onCommit`), `schema.ts` (one schema with
  `LITE_SCHEMA_VERSION`), `office.ts` (the snapshot rows and the office lists in the object memory), `save.ts`, `whole.ts`,
  `compile.ts`, `source.ts`, `callData.ts` (`liteData`). The office object host is `server/office/doHost.ts`.
- A module that sends its own SQL keeps its Postgres constant and adds a `_LITE` twin beside it, picked with `sqlFor`
  (`dialect.ts`). The fakes match the Postgres text by exact string, so never change it for the SQLite path.
- SQLite texts: `?` or `?1`, never `$1` (SQLite reads `$1` as a named value); no `::` cast; no outer `order by` (the source sorts
  by rowid in JavaScript); `=` for one value; at most 100 bound values (the host refuses more); a long id list key by key; no
  `ANALYZE`; no `insert or replace`; time columns hold `toISOString()` text.
- Key columns are plain columns that the save writes, from the column rules of `loaders/query.ts`. An office list has only `id`
  and `doc`. An update sets `doc` and only the key columns that changed.
- Every write of an office table raises `office_meta.version` and calls `writeOfficeSnapshot` in the same transaction.
- A schema change bumps `LITE_SCHEMA_VERSION` and `PINNED_SHA256` in `lite/schema.test.ts`, and each version above 3 has a step
  in `LITE_STEPS` (the first real office comes in wave 5).
- Schema version 3 (exit waves 2 and 3): the sign-in rows of wave 2 and the table `usage_day` of wave 3. Its step is
  `USAGE_DAY_SQL` in `LITE_STEPS`. The sign-in tables have no step, because no office object below version 3 exists outside the tests.
  `applyLiteSchema` runs the steps above the office version in one transaction. `LiteDb.isOpen()` tells the network port of the office object that
  a transaction is open. `SaveResult.noticeIds` names the notices of a save: the producers on SQLite read them in place of the
  `xmin` test. `DAY_ROW_LITE` (the day row of the meters) lives in `server/office/meter.ts`.
- Schema version 4 (fbk_007) adds the office list `sub_companies`, with only `id` and `doc`. `LITE_STEPS` is
  `{ 3: [USAGE_DAY_SQL], 4: [the create table of sub_companies] }`; the SQL text is in `lite/schema.ts`.
- Schema version 5 (fbk_022) adds the table `meetings` with its key columns and two read indexes (`meetings_starts`, `meetings_project_starts`).
  Its step is in `LITE_STEPS` and makes the same objects as a new office (`schema.test.ts` checks it).
- Schema version 6 (chat search) adds `search_text text` to `messages` and `comments`, the last column of each. `LITE_STEPS[6]` is two
  `alter table ... add column`. The office path keeps no index on it: `contains` is `instr`, a scan (`exit-handoff.md`, section 7,
  names the FTS5 index for the restart). No step writes a value: no real office exists below version 6.
- Schema version 7 (fbk_022, wave 2) adds the partial index `meetings_to_settle` (`ends_at`, where `status = 'scheduled' and settled_at is null`), with no
  `collate`. Its step makes the same object as a new office.
- Schema version 8 (fbk_022) adds the two server tables `google_connections` and `google_events` with their indexes (`google_connections_person`,
  `google_events_meeting`). Their step is in `LITE_STEPS`, and `schema.test.ts` checks that it makes the same objects as a new office. The office object
  has no Google yet, so these tables stay empty there.
- Schema version 9 (fbk_022, one calendar for each person) adds the server table `google_calendars` (`user_id` primary key, `calendar_id`, `changed_at`). It has
  no extra index. Its step is `GOOGLE_CALENDARS_SQL` in `LITE_STEPS`, and `schema.test.ts` checks that it makes the same objects as a new office. The office
  object has no Google yet, so the table stays empty there.
- The order of versions 6 to 8 comes from the join of 2026-10-20: the chat batch reached main first with version 6, so the meetings settle step
  (version 6 on its branch) became 7 and the Google step (version 7 on its branch) became 8.
- Each event index costs 1 row written for each event, and a read needs each of the 8. Task 18 dropped four of them, one at a
  time: a read then took 12,815 to 183,416 rows in place of 4 to 4,189 (proof.md "Wave 1: the rows pins"). Drop one only with
  a rows pin that shows that no read needs it.
- `test:lite` runs the rule tests and the shadow run on node:sqlite; `test:office` runs the host checks, the `everyCall`
  parity and the rows pins on local workerd. Keep both green when you change a loader read or the save.
- The sign-in rows of wave 2 (`auth_users`, `auth_links`, `auth_sessions`, `oauth_clients`, `oauth_requests`, in version 3 since
  the merge) and the partial index `outbox_signin`. An invitation text must repeat its exact term
  `kind in ('auth.invite', 'auth.email')`: `kind = 'auth.invite'` alone scans the outbox.
- The snapshot body is `{ lists, links }`: the sign-in links ride with the office lists, so a cold wake still reads 2 rows.
  `writeOfficeSnapshot` reads the links from `auth_users` (one statement, only on an office write).
- `statementQuery(db, mode)` (`dialect.ts`) keeps the dialect on a query of single statements (the forgot and renew routes).
- An export reads each table in rowid order with its rowid (`EXPORT_TABLES`, `ROWID_ALIAS` in `server/office/ops.ts`); a restore
  writes the rowid back, so the History keeps its order. The import writes records with `insertRow` and the server rows in one
  finish (`server/office/import.ts`); `office_meta.office_seq` is the number of the last office signal (the event numbers live
  in `counters`). The deploy suite reads the office through the peek route with the SQLite form of each walk text
  (`tests/e2e-deploy/office.ts`): a list goes as JSON text into `json_each(?n)`, and `json_group_array` gives one back.
- `LATER_CALLS` and `LATER_KINDS` (`server/test/liteHarness.ts`) are empty since the merge of waves 2 and 3: a new server call or
  effect kind with no SQLite form fails `test:lite`.

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
- The loops of `20261004000102_guards.sql` and `20261004000103_roles.sql` ran once, so a table of a later migration gives
  itself RLS, the revoke from public, anon and authenticated, the madar_server grants and the `server_all` policy
  (`20261005000100_project_templates.sql` is the pattern).
- A migration that writes office rows follows the office cache rule: it raises `office_meta.version` and sets `chg` of the
  rows to it. A migration that makes records with a counter prefix sets that counter to the highest number.
- `project_templates` is an office list (`OFFICE_COLLECTIONS`), so `projects.create` reads its template from the office.
- Server-only tables (`20261004000101_server_tables.sql`): office_meta, office_deletes, person_seq, platform_config, stories,
  idempotency, outbox, upload_intents, agent_links, mail_log, mail_outbox, usage_month, usage_warnings, rate_limits, job_runs.
- `push_devices` (`20261008000100_push_devices.sql`, owner 2026-10-08): the private rows of the browsers that get push. Not an office
  list. `loaders/push.ts` reads the own rows of the person of the call and nothing more (`push.register` also reads the row of
  its endpoint). `diffState` adds no kind for it, so a save of a device sends no signal. `endpoint` has a unique index.
  `SaveResult.messageIds` lists the messages a save inserted, for the push producer.
- A file of a direct chat or a group (owner, 2026-10-19) keeps `conversationId` in its `files` doc: no column and no migration, because
  no read selects by it. Its row has `project_id` and `task_id` null, so the search loader and `files.list` never load it. `diffState`
  counts `files` as a kind of `PRIVATE_CHAT_KINDS`: its save sends the anonymous office signal of a private chat (`save.ts`).
- Chat search (`20261020000100_message_search.sql`, chat design 2026-10-19, item 16): `messages.search_text` and `comments.search_text`
  hold `bodySearchText(body)` (`src/lib/searchMatch.ts`), written by the save from `tables.ts`. A deleted message keeps null; the
  Undo writes it again. The GIN trigram indexes `messages_search` and `comments_search` use `extensions.gin_trgm_ops`, and the loader
  `contains` sends an escaped LIKE, so a key press never reads every message. `search_fold(text)` is the fold in SQL (backfill and the
  parity test); it must stay in step with `bodySearchText`. One known difference: `İ` (U+0130) folds to `i` in SQL and to `i` plus a dot
  in JavaScript; no other tested letter differs. The index needs a table of some size: with 6,000 comments Postgres read every row.
- `events` only grows: a trigger refuses update and delete, and madar_server has only select and insert. Undo is a new
  event (`undoes`). The save never writes `undoneBy`.

## Counters, stories, idempotency
- Counters are a table under the office lock, so they have no gaps.
- Story IDs: `sty_` + 22 base32 characters, under 24 hours old, the same actor.
- Idempotency keys belong to the actor. The digest is sha256 of the call name and the input. The same key with another
  input gives `conflict` `key_reused`.

## Office cache
- `officeCache.ts` keeps committed rows only, frozen, versioned by `office_meta.version`.
- Any change to an office table raises the version, sets `chg` and records deletes in `office_deletes` (kept 7 days).

## Loaders
- Every call needs a loader entry in `loaders/`, or a test fails.
- Office tasks (no project, owner 2026-10-06): `officeTaskConds` (`steps.ts`) is the view rule in SQL. A read with a limit
  loads each kind with its own limit (search), or filters in SQL first (`events.list`: `officeTaskId` of the tasks the
  person sees), so the cut of the handler gives the same rows. `trapOffice` (`sweep.ts`) holds office tasks and ties at the
  cut of the newest rows (`newestTies`, in prj_004) for the sweep. `badgeTraps` holds the badge and bell cases: a tie with the
  own last comment, a helper, a task that an agent made, a hidden notice, a gone task and a report.
- The shadow run (`server/test/shadow.ts`) runs each API test in memory and on the database, and fails on any difference.
- Read indexes (performance audit 2026-10-07): `20261007000100_read_indexes.sql` adds the statistics `events_office_task` on
  `doc->'officeTaskId'` and the indexes `events_created_c`, `events_project_created`, `messages_conversation_newest`,
  `comments_target_id` and `events_target_id`, then runs analyze. `server/it/readIndexes.it.test.ts` checks that the loader
  statements use them on growth data. Keep that test green when you change the SQL of a loader read.
- A Select with `per`, a limit and a top-level in-list on the `per` column reads each key with a LATERAL subquery on the index
  of that key (`fetch first n rows with ties` for ties, else `limit n`). Every other Select with a limit keeps the `rank()` or
  `row_number()` window form. Both forms give the same rows in the same order (`sqlSource.ts`, `selectSql`).
- A field pick (`Select.pick`) builds the doc with `jsonb_build_object` of the picked keys minus the keys that the doc does not
  hold, so an absent field stays absent. The key names go in one array parameter, never in the SQL text. A pick of more than
  50 keys keeps `jsonb_each` (Postgres takes at most 100 arguments in a function call).
- `atOrAfter` (`events.list` since) adds a text lower bound on `created_at collate "C"`: the UTC text of the time minus 36
  hours. The timestamptz test still decides, so the bound never removes a row. A count with a bounds condition on its `per`
  column joins the bound rows to the table on that column.
- `after` is the mirror of `before`, and `order.asc` reads oldest first (no ties); `chats.messages` with `around` uses both.
  `contains` sends an escaped LIKE on Postgres (`likeOf`, `sqlSource.ts`), so a trigram index serves it; memory and SQLite keep
  the substring test.
- `referencing` (the Undo check of a create) sends one equality on the text column when the reference path is one plain field
  with a text column in `query.ts` (`columnOfField`). A list or nested path keeps `jsonb_path_exists`.
- Leak rule for picks: `chats.unreadCount` has its own loader (`chatsUnread`), with `THREAD_TASK_FIELDS` and
  `THREAD_COMMENT_FIELDS` (`chat.ts`). `notifications.count` reads its targets with `INBOX_TASK_FIELDS` (`inbox.ts`), and posts
  and reports with the id only. Each task pick must hold every field that a view rule reads (`mayViewTask`, `taskResource`,
  `hiddenTask`: projectId, ownerId, helperIds, createdBy). `chats.list`, `chats.markRead` and the notification writes keep
  whole rows. `pickedByKey` (`steps.ts`) is only for a read that never saves and loads nothing else of that table, because a
  later `byKey` keeps the picked copy.
- The unread count and the reply that waits of a task thread read the messages only (fbk_027): the chat loader adds `MESSAGES_ONLY`
  (`dates` and `kind` null) to the count, to the newest message and to the own newest message, and keeps the reads of the newest item of any
  kind (the preview, the order, who is in the thread). Change `taskUnread` and `waitingThread` (`src/api/handlers/chats.ts`) with it.
- `atBefore` (a Cond on a stamp column) is the upper bound of a period: a timestamp test in SQL, in memorySource and in the
  SQLite compile, never text. `reports.office` (`loaders/report.ts`) reads the clock from `LoadCtx.now` (the call's time), and
  its counts come from `countWhere` with one key for each value (`REPORT_KEYS`). A loader without the clock never resolves a period.
- A Source gives rows that the caller owns (`sqlSource` gets new objects from pg, `memorySource` gives copies), so
  `Load.state()` keeps them with no second copy. The office lists of the State stay copies of the snapshot.
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
  It was 120 s until 2026-10-16: Supabase gives each request a new worker that never takes a second one, so a kept connection
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
  `xmin` test. `DAY_ROW_LITE` (the day row of the meters) lives in `server/usage/meters.ts`, because the Supabase bundles load
  `usage/warn.ts` and may import no value from `server/office/` (`workerGraph.test.ts`); `server/office/meter.ts` exports it again.
- Schema version 4 (fbk_007) adds the office list `sub_companies`, with only `id` and `doc`. `LITE_STEPS` is
  `{ 3: [USAGE_DAY_SQL], 4: [the create table of sub_companies] }`; the SQL text is in `lite/schema.ts`.
- Schema version 5 (chat search) adds `search_text text` to `messages` and `comments`, the last column of each. `LITE_STEPS[5]` is two
  `alter table ... add column`. The office path keeps no index on it: `contains` is `instr`, a scan (`exit-handoff.md`, section 7,
  names the FTS5 index for the restart). No step writes a value: no real office exists below version 5.
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

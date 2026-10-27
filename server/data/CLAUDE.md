# Data layer

The server keeps each record of the zod contract as one JSON row in Postgres. `runCall` loads the rows, runs the handler,
and saves the difference. Migration rules are in `supabase/CLAUDE.md`. Per-table and per-loader detail:
`docs/superpowers/real-build/data-tables.md` and `docs/superpowers/real-build/loader-notes.md`.

Commands: `npx vitest run server/data` is the fast path. `npm run test:db` (Postgres), `test:lite` (SQLite) and `test:office`
(workerd) run the loader and save tests on each database. Keep all three green when you change a loader read or the save.

## Files
- `tables.ts`: the table of each zod collection, and `SERVER_TABLES`. `rows.ts`, `whole.ts`: read rows and whole collections.
- `save.ts`: the diff save. `officeCache.ts`: the office cache. `sql.ts`: the SQL helper. `loaders/`: the loader of each call.
- `dialect.ts`: `sqlFor` and `statementQuery`. `projectAudience.ts`: `audienceFinder`, who hears a hidden project.
- `lite/`: the SQLite form of this layer (see "The SQLite path").

## Tables
- Each entity table: `id text pk`, `ord bigserial`, `doc jsonb` (the whole zod record), generated key columns,
  `search_text`, `chg` (`supabase/migrations/20261004000100_core.sql`).
- A new zod collection needs a table in a new migration and an entry in `tables.ts`.
- A field that no read selects by lives in the `doc` jsonb: no column and no migration. Only a field that the search needs goes
  into `search_text` (`tables.ts`). Examples: `Project.nameAr`, `Project.continuous`, `Project.folders`, `FileRec.folderId`,
  `FileRec.conversationId`, `FileRec.meetingId`.
- A file of a chat or a meeting with no project keeps its owner in the `files` doc and has `project_id` and `task_id` null, so the
  search loader and `files.list` never load it. Its save is a private change: `diffState` sends person signals to the people of
  the chat or meeting and no office signal (`Diff.chatKinds`, `officeMeetings`; `save.ts`).
- The loops of `20261004000102_guards.sql` and `20261004000103_roles.sql` ran once, so a table of a later migration gives
  itself RLS, the revoke from public, anon and authenticated, the madar_server grants and the `server_all` policy
  (`20261005000100_project_templates.sql` is the pattern).
- A migration that writes office rows follows the office cache rule: it raises `office_meta.version` and sets `chg` of the
  rows to it. A migration that makes records with a counter prefix sets that counter to the highest number. A table that is
  no office list and starts empty raises no office version.
- `project_templates` is an office list (`OFFICE_COLLECTIONS`), so `projects.create` reads its template from the office.
- Server-only tables (no State collection) are the list `SERVER_TABLES` in `tables.ts`. A server table that is written outside
  the office lock must also go into `OUTSIDE_OFFICE_LOCK` (`scripts/backup/check.ts`) and `DRIFT_TABLES`
  (`server/office/ops.ts`), and needs a SQLite twin (a `LITE_STEPS` entry). `google_calendars` is in neither list because both of
  its writers hold the lock.
- `push_devices` rows are private: `loaders/push.ts` reads the own rows of the person of the call and nothing more.
  `diffState` adds no kind for it, so a save of a device sends no signal.
- `agent_confirms` (the email code guard of agents, flow in `server/mcp/CLAUDE.md`): one row for each request of an agent for a
  risky Admin act. It holds person, agent, call name, the hash of the exact input, the hash of the code (never the code), end
  time, count of tries (wrong ones and the right one) and time of use. `server/mcp/confirms.ts` is the store (`sqlConfirms` on
  both databases, `memoryConfirms` in `memoryData`; `CallTx.confirms` is optional). The claim of a code runs in the transaction of
  the act, so it rolls back with it. The job deletes rows older than one day.
- `INTERNAL_LOADER_OF` (`loaders/index.ts`) holds the loader of `payments.daftraPaid`, the one call that only the job runs;
  `loadFor` reads it after `LOADER_OF`. The Daftra tables: `server/daftra/CLAUDE.md`.
- `meetings` is no office list. A handler that checks a right on a row the caller may not see (`meetings.extend`: the true last
  meeting of a series) needs a loader without `meetingConds`; with it, the shadow run finds `forbidden` on the scoped load and
  `not_found` on the whole office. `events.list` adds the test "no `officeMeetingId`, or one of the private meetings of the
  person" for every person, the Admin too (`privateMeetingsOf`).
- Chat search: `messages.search_text` and `comments.search_text` hold `bodySearchText(body)` (`src/lib/searchMatch.ts`). The SQL
  function `search_fold` must stay in step with it (`server/it/messageSearch.it.test.ts` checks that they agree).
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
- A write asks for the counters with the version: `runWrite` calls `t.office({ counters: true })`, which sends
  `META_COUNTERS_SQL` (office_meta and a json object of the counters) as the first statement after the lock, and the loader's
  `sqlSource(q, { counters })` gives them with no statement of its own. A read keeps `META_SQL`. Never read the counters of a
  write before the lock, and never cache them with the snapshot: a save can change a counter and leave the version as it is.

## Loaders
- Every call needs a loader entry in `loaders/`, or a test fails.
- A read with a limit must give the same rows as the handler cut. Load each kind with its own limit, or filter in SQL first. Add
  a trap row for each new limit to `sweep.ts` (`trapOffice`, `badgeTraps`, `hiddenTraps`, `hiddenSweep`); the tests of
  `loaders.test.ts` fill every SQL limit with rows of a hidden project and check that the visible rows stay.
- Hidden projects: the business rule is in `src/api/CLAUDE.md`, "Hidden projects". In SQL the rule is `visibleProjects`,
  `visibleIds`, `projectConds` and `eventProjectConds` (`steps.ts`), built with `projectViewer` (`src/api/projectView.ts`). Every
  read across projects takes its ids from them. The people who hear a hidden project come from `audienceFinder`
  (`projectAudience.ts`, `mayViewProject`). The leak tests are `hiddenProjectSignals.test.ts` and `hiddenTraps` in
  `loaders.test.ts`.
- The shadow run (`server/test/shadow.ts`) runs each API test in memory and on the database, and fails on any difference.
- `server/it/readIndexes.it.test.ts` pins the plan of each loader read on growth data. Keep it green when you change the SQL of a
  loader read. Add an index in a migration (and the SQLite plan stays its own).
- A Select with `per` and a limit, and a Select with a limit that ends in `order.id`, each take their own SQL form (`selectSql`
  in `sqlSource.ts`). Both forms give the same rows in the same order.
- A field pick (`Select.pick`) returns one jsonb array for each row, and `sqlSource.select` builds the object back (`unpick`):
  an absent field stays absent and a JSON null stays null. A pick of more than 50 keys keeps the object form with `jsonb_each`
  (Postgres takes at most 100 arguments in a function call).
- Leak rule for picks: each task pick must hold every field that a view rule reads (`mayViewTask`, `taskResource`, `hiddenTask`:
  projectId, ownerId, helperIds, createdBy). `chats.list`, `chats.markRead` and the notification writes keep whole rows.
  `pickedByKey` (`steps.ts`) is only for a read that never saves and loads nothing else of that table, because a later `byKey`
  keeps the picked copy.
- A change to the unread count of a task thread changes `taskUnread` and `waitingThread` (`src/api/handlers/chats.ts`) too (the
  loader reads messages only: `MESSAGES_ONLY`). A change to `unreadIn` (`src/api/chatState.ts`) changes `countsNamedOnly` in the
  loader. The choice of the Admin (`adminReachOf`) reaches the loader through `chatsOf` and `listed(L)`: `loaders.test.ts` keeps
  the whole office and the scoped load equal for each choice.
- `atBefore` (a Cond on a stamp column) is the upper bound of a period: a timestamp test in SQL, in memorySource and in the
  SQLite compile, never text. `reports.office` (`loaders/report.ts`) reads the clock from `LoadCtx.now` (the call's time). A
  loader without the clock never resolves a period.
- A Source gives rows that the caller owns (`sqlSource` gets new objects from pg, `memorySource` gives copies), so
  `Load.state()` keeps them with no second copy. The office lists of the State stay copies of the snapshot.
- `Load.batch(steps)` sends reads that do not depend on each other as ONE statement. A step must not need the rows of another
  step of the same batch (the keys that a `byKey` step misses are chosen before the batch runs). `memorySource` and `liteSource`
  have no `batch`; `Load.batch` then asks them one read at a time and gives the same State. `loaders.it.test.ts` pins the
  statement count.
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
  so pg uses the simple protocol. The pooler keeps the settings inside the transaction only. The D1 harness path keeps
  `savepoint madar_tx` and the `set local` lines as separate queries.
- The pooler pools (`writeUrl`, `readUrl`) close an idle connection after `IDLE_TIMEOUT_MS`, with `keepAlive: true`: Supabase gives
  each request a new worker that seldom takes a second one, so a kept connection only holds a pooler client, and the client
  limit fills under load (EMAXCONN, `server/CLAUDE.md`). The Workers `connectionString` form keeps the pg defaults: that Db lives
  for one request.
- The Workers `connectionString` form (the Hyperdrive binding) also sets `query_timeout` (`QUERY_TIMEOUT_MS`). Hyperdrive can
  hold a BEGIN until it has a free origin connection, and neither `lock_timeout` nor `statement_timeout` covers that wait. A
  query that hits the limit throws its client away with no rollback (the query still runs on that connection).
- `Db.warm(mode)` (optional on the port) opens the connection of one pool and sends no statement. It does nothing with the
  harness `callerClient`, or when the pool already holds a client.
- Never write `public.` in a table name.
- Database TLS fails closed (see `server/CLAUDE.md`).

## The SQLite path
- `lite/` holds the SQLite form of this layer, beside the Postgres form: `host.ts` (node:sqlite and the refusal guard),
  `db.ts` (the Db port: one transaction at a time, no write in a read, `onCommit`), `schema.ts` (one schema with
  `LITE_SCHEMA_VERSION`), `office.ts` (the snapshot rows and the office lists in the object memory), `save.ts`, `whole.ts`,
  `compile.ts`, `source.ts`, `callData.ts` (`liteData`). The office object host is `server/office/doHost.ts`.
- `LITE_STEPS` in `lite/schema.ts` is the list of schema versions. A schema change adds the next step, bumps
  `LITE_SCHEMA_VERSION` and `PINNED_SHA256` (`lite/schema.test.ts`), and makes the same objects as a new office
  (`schema.test.ts` checks it). A migration with a SQLite twin adds its step in the same commit. A step that a released office
  already ran never changes in place.
- The sign-in tables (`auth_users`, `auth_links`, `auth_sessions`, `oauth_clients`, `oauth_requests`) have no step, because no
  office object below version 3 exists outside the tests. An invitation text must repeat its exact term
  `kind in ('auth.invite', 'auth.email')`: `kind = 'auth.invite'` alone scans the outbox (the partial index `outbox_signin`).
- A module that sends its own SQL keeps its Postgres constant and adds a `_LITE` twin beside it, picked with `sqlFor`
  (`dialect.ts`). The fakes match the Postgres text by exact string, so never change it for the SQLite path.
- SQLite texts: `?` or `?1`, never `$1` (SQLite reads `$1` as a named value); no `::` cast; no outer `order by` (the source sorts
  by rowid in JavaScript); `=` for one value; at most 100 bound values (the host refuses more); a long id list key by key; no
  `ANALYZE`; no `insert or replace`; time columns hold `toISOString()` text.
- Key columns are plain columns that the save writes, from the column rules of `loaders/query.ts`. An office list has only `id`
  and `doc`. An update sets `doc` and only the key columns that changed.
- Every write of an office table raises `office_meta.version` and calls `writeOfficeSnapshot` in the same transaction. The snapshot
  body is `{ lists, links }`: the sign-in links ride with the office lists, so a cold wake still reads 2 rows.
  `writeOfficeSnapshot` reads the links from `auth_users` (one statement, only on an office write).
- `statementQuery(db, mode)` (`dialect.ts`) keeps the dialect on a query of single statements (the forgot and renew routes).
- An export reads each table in rowid order with its rowid (`EXPORT_TABLES`, `ROWID_ALIAS` in `server/office/ops.ts`); a restore
  writes the rowid back, so the History keeps its order. The import writes records with `insertRow` and the server rows in one
  finish (`server/office/import.ts`); `office_meta.office_seq` is the number of the last office signal (the event numbers live
  in `counters`). The deploy suite reads the office through the peek route with the SQLite form of each walk text
  (`tests/e2e-deploy/office.ts`): a list goes as JSON text into `json_each(?n)`, and `json_group_array` gives one back.
- Each event index costs 1 row written for each event, and a read needs each of them. Drop an event index only with a rows pin
  that shows that no read needs it (`test:office` rows pins; proof.md, "Wave 1: the rows pins").
- `LATER_CALLS` and `LATER_KINDS` (`server/test/liteHarness.ts`) are empty: a new server call or effect kind with no SQLite form
  fails `test:lite`.

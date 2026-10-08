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
  person sees), so the cut of the handler gives the same rows. `trapOffice` (`sweep.ts`) holds office tasks for the sweep.
- The shadow run (`server/test/shadow.ts`) runs each API test in memory and on the database, and fails on any difference.
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
- The pooler pools (`writeUrl`, `readUrl`) keep an idle connection 120 s (`IDLE_TIMEOUT_MS`, under the 150 s worker life),
  with `keepAlive: true`. The Workers `connectionString` form keeps the pg defaults: that Db lives for one request.
- `Db.warm(mode)` (optional on the port) opens the connection of one pool and sends no statement. It does nothing with the
  harness `callerClient`, or when the pool already holds a client.
- Never write `public.` in a table name.
- Database TLS fails closed (see `server/CLAUDE.md`).

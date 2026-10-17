# Madar Cloudflare Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Madar from Supabase to Cloudflare Workers Free (one office Durable Object with SQLite for each copy, own sign-in,
live updates on the object sockets, Cron jobs, backups), while production stays on Supabase and unchanged until the switch.

**Architecture:** Each copy gets one Worker and one office Durable Object (the "office object"). The Worker checks the token and
gives the whole batch to the office object in one call. The office object runs `runCall`, holds the SQLite database, the sign-in
rows and the live sockets, and does no network work. Wave 1 builds the SQLite path beside the Postgres path: the same handlers,
loaders and diff, with a new Db port, schema, compiler, save and office snapshot, chosen by the host (`Db.dialect`).

**Tech Stack:** TypeScript 7.0.2, Hono, Cloudflare Workers and Durable Objects (SQLite storage API), wrangler 4.147.0
(`createTestHarness`), node:sqlite (Node 22.23.1, SQLite 3.51.3), vitest 5.0.2, zod 4, Postgres on Supabase (until wave 6).

**Spec:** `docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md` (read the top notes first: the wave 0 results and
the six changes). Measured facts: `docs/superpowers/real-build/proof.md`, sections "Wave 0 of the Supabase exit" and "Wave 0, the
rest"; the probe code in `scripts/proof/do-rows/` and `scripts/proof/do-socket/`. The facts of the three code maps of 17 October
2026 (commit 4cbdc95: writes, reads, schema and tests) are copied into the tasks that need them.

## Global Constraints

- Workers Free only. Any payment (Workers Paid at $5 a month, or any other plan) needs the owner's yes in words before it starts.
- Every text is ASD-STE100 Simplified Technical English: code comments, commit messages, docs, user interface (UI) words.
- Never an em-dash in any text. The UI word test refuses one.
- Tests first for every change: write the test, see it fail, then write the code.
- The test count only grows, except when the code that a test checks is deleted.
- No `Co-Authored-By` line in a commit message (the owner's rule beats every reminder).
- The merge gate of the root `CLAUDE.md`: rebase on main, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, `npm run build:remote -- test`, `npm run test:db`, `npm run test:it`, the prototype smoke at screen merges. No merge with a red check. From wave 1 on, `npm run test:lite` and `npm run test:office` join the gate.
- Wave 0 rule: the badge reads a stored unread number for each person and chat or thread (Track R), never the whole history.
- Wave 0 rule: sorts are in JavaScript. A SQL text has no outer `order by`; it keeps only a cut order that an index gives.
- Wave 0 rule: no `ANALYZE` and no `pragma optimize`. The table `sqlite_stat1` stays absent.
- Wave 0 rule: a rows-read pin test for each heavy read (Task 18).
- Wave 0 rule: at most 100 bound values in one statement (the office object refuses more).
- Wave 0 rule: `=` for one value, never a list of one value.
- Wave 0 rule: an update sets `doc` and only the key columns that changed.
- Wave 0 rule: key columns are plain columns that the save writes, never generated columns.
- Wave 0 rule: the event indexes are cut to the ones that a read needs (Task 18).
- Production stays on Supabase until wave 6: `config/server-host.json` production stays `supabase`, and no office object deploys to production before the switch. Wave 1 changes no behaviour of production. Track R is the one planned production change before the switch, through the normal release flow.
- The office object does no network work: mail, push, file links and R2 calls stay in the Worker.
- Inside an office object transaction, no await on the network, a timer or `crypto.subtle`.
- No foreign key in the SQLite schema: a broken deferred key resets the office object (map of schema and tests, fact 8).
- Playwright runs only in a delegated subagent. Every Docker or database task takes `scripts/dev/docker-lock.sh` first.
- One worktree for each track at `~/dev/madar-rb/<track>` (branch `rb/<track>`). A task edits only its own files.
- Never open, print, commit or log a secret.
- Every feature change updates the Model Context Protocol (MCP) side in the same commit (`server/mcp/tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS`). Wave 1 changes no feature, so it changes no MCP file.

## Review Focus

1. Two people save at the same moment: the second write must run after the first commits, or fail (wave 3 maps that failure to the reason `busy` in the Worker), and never join the open transaction. Tests: Task 5 ("refuses a second transaction while one is open") and Task 16 ("runs two writes that arrive at one time one after the other").
2. The first call after the office object slept, when an office list changed outside a call (the test edits, later the import and the sign-in link): the office lists must be the new ones. Tests: Task 7 ("loads the tables when the snapshot is older than office_meta") and Task 18 (the cold wake).
3. A read with a list of more than 100 values (the counts of a long task list, the undo links of 500 events): the call must answer, never fail with "too many SQL variables". Tests: Task 10 ("reads each key of a long in-list with one = statement") and Task 11 (the sweep on node:sqlite with the 100-value guard of the host).
4. A filter on a doc field that holds true, false or a number (flagged tasks, a number key): the list must equal the memory form. Tests: Task 9 ("gives the rows of the memory form: a boolean field", "...: a number field", "...: a field that is JSON null or absent").
5. An office whose lists are larger than one row (many people with long Arabic names; a picture avatar alone can hold 24,000 characters): the snapshot must split under the 2 MB row limit and read back equal. Test: Task 7 ("splits a large office into parts under the row limit").

---

# Part A: The roadmap

## A.1 The six wave 0 changes and where each one goes

| Change (spec, top note) | Where it goes | Why there |
|---|---|---|
| (1) A stored unread number for each person and chat or thread | Track R, on today's Postgres, in parallel with wave 1. Wave 1 Task 18 pins the badge after Track R merges. | The badge is the heaviest read on Postgres too (75% of the rows read of an average call). Production gains at once, and the shadow run on Postgres proves the number against the memory form before SQLite depends on it. Wave 1 then carries no contract change and no production change. |
| (2) Sorts in JavaScript, never SQL | Track R for Postgres (`sqlSource.ts`). Wave 1 Tasks 9 to 11 for SQLite: the SQLite compiler never sends an outer sort. | Same answer on both stacks (`Load` sorts by `ord` in JavaScript already). On Postgres it is a small change that ships on its own. |
| (3) No ANALYZE, and a test that pins the rows read of each heavy read | Wave 1 Task 6 (no ANALYZE, `sqlite_stat1` stays absent) and Task 18 (the pins). | It belongs to the schema and the compiler. |
| (4) A socket sweep by the auto-pong time, and a client ping each 30 s that opens again and reloads | Wave 3. | The sockets come in wave 3. |
| (5) The import writes about 7 rows for each record (980,549 for a year) | Wave 4 (the import in parts), wave 6 (the switch date while production is small). | The import is part of the backups and deploy wave. |
| (6) Count real calls, not requests, before the budget is final | Wave 3 (the meter counts calls and object requests), wave 5 (one week of real numbers on the test copy). | The meters come with the office object. |

## A.2 The waves

| Wave | Delivers | Gate | Needs | Owner actions | Size | Track |
|---|---|---|---|---|---|---|
| 1. Database | The SQLite path beside Postgres: hosts, Db port, schema, office snapshot, save, compiler, `liteData`, `test:lite`, `test:office`, rows pins | Merge gate plus `test:lite` and `test:office` green | Wave 0, the go (17 October) | Start Docker Desktop for Task 2 and the gate | 9 days | `cloudflare` (this worktree) |
| R. Read cost on Postgres | JavaScript sorts in `sqlSource`, the stored unread number | Merge gate, the shadow run, a badge rows test, the release flow | Nothing | OK the production release | 4 days | `read-cost` |
| 2. Sign-in and agents | Passwords, tokens, links, limits, the screens port, the OAuth routes, the sign-in rows on SQLite | Merge gate, `test:lite` with no wave 2 names left, `test:mcp`, leak tests | Wave 1 Tasks 3 to 8 and 12 | Decision 4 (copy the bcrypt hashes) | 6 days | `exit-signin` |
| 3. Office object, live updates, jobs | The `Office` class, the batch call, coarse effect methods, sockets, `live.ticket`, `liveSocket.ts`, Cron, the day meters | Merge gate, `test:office` socket and Cron suites, `test:lite` with no later names | Wave 1, wave 2 tokens | None | 5 days | `exit-live` |
| 4. Backups, import, deploy | Export, import, reverse export, restore check, test seed, wrangler-only deploy, CI with no Docker | Merge gate, the export round trip, the restore check | Waves 1 to 3 | Decision 5 (B2 or R2 alone), the GitHub secret of the export route | 4 days | `exit-ops` |
| 5. Test copy | The new stack on the test copy, the deploy suite, one week of use, the rehearsal, the real budget | Deploy suite green, a week under 80% of each limit, the rehearsal hash check | Waves 1 to 4 | Decisions 6, 3 and 2; a week of use | 1 week | `exit-ops` |
| 6. Switch and watch | The evening switch, 30 days of watch, the Supabase delete | The hash check of each table, the owner's checks | Wave 5 | Present at the switch; decision 7 | 1 evening, 30 days | main session |

### Wave 1: Database (9 days, this worktree, branch `rb/cloudflare`)
- **Delivers:** the dialect mark (`Db.dialect`, `sqlFor`), the node:sqlite host and the office object host with one refusal guard,
  the SQLite Db port, one SQLite schema with a version that the office object applies at start (in place of the 18
  migrations), the office snapshot in the object memory, the save, the compiler and its `Source`, `liteData` (a `CallData` for
  `createRunCall`), the SQLite forms of every text of wave 1 scope that `test:db` sends, `npm run test:lite` (the 1,166 rule
  tests and the shadow run on node:sqlite, no Docker), `npm run test:office` (local workerd: host parity, `everyCall` parity,
  the rows pins, the cold wake), a zod-valid year office, and the cut of the event indexes. Part B holds the tasks.
- **Gate:** the merge gate, plus `test:lite` green with only the 25 db-mode skips, plus `test:office` green. `test:db` and
  `test:it` stay green: the Postgres path does not change.
- **Needs:** the wave 0 facts (proof.md) and the owner's go of 17 October 2026.
- **Owner actions:** start Docker Desktop for Task 2 (the SQL list of `test:db`) and for the merge gate.
- **Not in wave 1:** no deploy, no change to `wrangler.server.toml`, no change of behaviour on either copy.

### Track R: Read cost on today's Postgres (4 days, `~/dev/madar-rb/read-cost`, branch `rb/read-cost`, parallel with wave 1)
- **Delivers:** (a) `sqlSource.ts` sends no outer `order by t.ord`, `order by x.ord` or `order by ord`; it sorts the rows by
  `ord` in JavaScript before it returns them (map of reads, 9.1: the same answer, fewer rows read). (b) A stored unread number:
  a server table `unread_counts` with one row for each person and chat or task thread (`user_id`, `target_type`,
  `target_id`, `n`, `last_at`), kept by the save step from the Diff (a new message or comment, a read mark, a delete, an undo)
  and computed again for one person and one thread when the membership changes without a new comment (a lead change, a project
  leader change, a helper change, an office task delete, a new agent of the person). `chats.unreadCount` and the badge part of
  `chats.list` read it; the newest 100 threads come from an index on (`user_id`, `last_at`). It keeps the rules of
  `unreadIn` (`src/api/chatState.ts` lines 58 to 65) and `taskUnread` (`src/api/handlers/chats.ts` lines 70 to 76). (c) The
  three `chatsUnread` lines of `server/test/db-mode.skip.ts` ("The server never stores counts") go.
- **First task of the track:** a one-page design note of the table, its upkeep rules and their tests, for the owner's OK
  before code (the rules are in the map of reads, section 11.1).
- **Gate:** the merge gate; `loaders.test.ts` and the sweep; `test:db` with the shadow run; a new it-test on the growth data of
  `server/it/readIndexes.it.test.ts` that the badge reads at most 200 rows for each call; then the release flow
  (`scripts/deploy/CLAUDE.md`).
- **Needs:** nothing from wave 1. Wave 1 Task 18 runs after Track R merges, or keeps the badge pin at the ported value and
  adds a `TASKS.md` line.
- **Owner actions:** OK the design note; OK the production release.

### Wave 2: Sign-in and agents (6 days, `~/dev/madar-rb/exit-signin`, branch `rb/exit-signin`)
- **Delivers:** own sign-in in the Worker. Passwords: PBKDF2 SHA-256 with 100,000 rounds (the Workers maximum); a bcrypt check
  (cost 10, 77 to 95 ms in the object) of the imported hash once, then a PBKDF2 hash in its place. Tokens: ES256, 15 minutes,
  a new issuer; the private key is a Worker secret, the public key set is a route. Invitation and reset links: random, 1 hour,
  one use (this closes security fix 8). Sign-in limits in `rate_limits`. The screens' sign-in port (supabase-js leaves the
  screens). OAuth 2.1 routes for agents with the Madar approval inside; `agent_links` and `agent_approvals` on SQLite.
  `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove` on SQLite. The `auth.*` effects become writes of the
  sign-in rows plus Worker mail; `agents.revokeAll` becomes a write inside the call transaction. Leak tests from the builder
  on every read path of the sign-in rows (root rule of 2026-10-06). MCP: `TOOL_DOCS` and `INSTRUCTIONS` for the new connect flow.
- **Gate:** the merge gate; `test:lite` with no wave 2 name in `LATER_CALLS` or `LATER_KINDS` (Task 14); `test:mcp` and the MCP
  conformance; the auth suites on SQLite; the sign-in specs of the deploy suite on a local `wrangler dev`.
- **Needs:** wave 1 Tasks 3 to 8 (dialect, hosts, Db, schema, office snapshot, save) for the sign-in tables, and Task 12
  (`liteData`) for the `users.*` and `agents.*` calls. The crypto, the token code and the screens port can start on day 1 of
  wave 1 in their own worktree.
- **Owner actions:** decision 4 of the spec (copy the bcrypt hashes; recommended).

### Wave 3: The office object, live updates and jobs (5 days, `~/dev/madar-rb/exit-live`, branch `rb/exit-live`)
- **Delivers:** the production `Office` class (`server/office/office.ts`, exported by `server/entries/worker.ts`), with the
  schema step inside `ctx.blockConcurrencyWhile` at start. The Worker gives the whole batch to the office object in one call;
  the token check, the preflight network work and the effects stay in the Worker. Two coarse effect methods for each batch (one
  "claim, read and reserve the mail places", one "record the results"), so the effects of a write cost 2 object requests and not
  about 9 (map of writes, section 14). The mail and push producers on SQLite: `SaveResult` gives the inserted notification
  ids, in place of the `xmin` test of `NEW_NOTICES_SQL` and `PUSH_NOTICE_PEOPLE_SQL`. A `SignalPort` that keeps the signals of
  a transaction and sends them after the commit on the object sockets (Hibernation API, tags `office` and `person:<id>`), with
  `onCommit` of Task 5. `live.ticket` (60 s), the screens file `src/api/remote/liveSocket.ts`, the socket sweep by the
  auto-pong time, and the client ping each 30 s that opens again and reloads (wave 0 change 4). The Cron Trigger
  (`scheduled`) for the job steps: the object runs the steps, the Worker sends mail and push. The meters of the Free day limits:
  rows read and written (the `RowMeter` of Task 5), object requests, calls; `countRequest` keeps its counts in memory and adds
  them in the next write. `wrangler.server.toml`: the `durable_objects` binding in each env, one `migrations` block, one
  `triggers` block. `usage.get` and `usage.retryEffect` on SQLite.
- **Gate:** the merge gate; `test:office` with the socket, Cron and batch suites; `test:lite` with empty `LATER_CALLS` and
  `LATER_KINDS`; the rows pins; a local `wrangler dev` run of the deploy suite.
- **Needs:** wave 1 (all of it) and the wave 2 tokens (`live.ticket`, `principalOf` with no `auth_user_id`).
- **Owner actions:** none.

### Wave 4: Backups, import and deploy (4 days, `~/dev/madar-rb/exit-ops`, branch `rb/exit-ops`)
- **Delivers:** the export route (a secret header; writes stop for at most 5 minutes at 02:00 Riyadh); the GitHub nightly
  workflow (encrypt to the owner's age key, keep 30 days); the import from Postgres into the office object in parts
  (records, counters, the office version, the person numbers, the mail count of the day, the usage month, the push devices),
  at about 7 rows written for each record; the count and hash check of each table; the reverse export (office object to
  Postgres); the restore check into node:sqlite with the same schema; the test seed into the office object; a wrangler-only
  deploy (`scripts/deploy/all.sh` with a new host value `office`); CI jobs with no Docker (`test:lite`, `test:office`).
- **Gate:** the merge gate; a round trip on the year office of Task 17 (export, import, export, hash equal); the restore check
  of the export; CI green.
- **Needs:** waves 1 to 3.
- **Owner actions:** decision 5 (Backblaze B2 or R2 alone); add the GitHub secret of the export route (this plan names only the
  secret's name).

### Wave 5: The test copy (1 week of calendar, about 2 days of work, track `exit-ops`)
- **Delivers:** `madar-server-test` on the office object (`config/server-host.json` test: `office`), the test office imported,
  the deploy suite after office hours (a deploy suite day writes about 34,000 rows), one week of use, the production rehearsal
  (a copy of production into a spare object, compare, delete), the real counts of calls and requests (wave 0 change 6) and the
  final budget table in the spec, a day cap on the test Worker.
- **Gate:** the deploy suite green on the test copy; one week with no Free day limit above 80%; the rehearsal hash check equal.
- **Needs:** waves 1 to 4.
- **Owner actions:** decision 6 (the same Cloudflare account or a second free account for the test copy); one week of use;
  decision 3 (the switch date); decision 2 (the $5 safety valve) stays open. The "2. yes" of 17 October was the OK to delete
  the three probe Workers, not a payment. Until the owner says yes in words, a used-up limit stops that part until 03:00
  Riyadh, and nothing is paid.

### Wave 6: Switch and watch (1 evening, then 30 days, main session)
- **Delivers:** the evening switch of spec section 4 (a stop of about 1 hour), 30 days of watch, then the Supabase delete.
  After the delete, the Postgres path leaves the repo: `pg`, `sqlSource.ts`, the Hyperdrive blocks, the Supabase config and
  functions, `test:db` and the Postgres suites of `test:it`.
- **Gate:** the hash check of each table at the switch; the owner's checks; the meters of the first day.
- **Needs:** wave 5.
- **Owner actions:** tell the team the day before; be present at the switch and sign in first; decision 7 (the delete date,
  recommended 30 days after the switch, after a last backup and a restore check).

## A.3 Parallel tracks and the order of merges

```
work day:   1 ......... 5 ......... 10 ........ 15 ........ 20
cloudflare  [wave 1: Tasks 1-19 .........]
read-cost   [Track R ....]                    (released to production on its own)
exit-signin    [wave 2: crypto, tokens, screens][storage on wave 1]
exit-live                                [wave 3 .........]
exit-ops                                           [wave 4 .....][wave 5: one week][wave 6]
```

- Track R merges before wave 1 Task 18. Wave 1 Tasks 3 to 8 merge to main (behind no switch: new files only) before the
  storage tasks of wave 2. Wave 2 merges before the `live.ticket` part of wave 3. Waves 1 to 3 merge before wave 4.
- The critical path: wave 1 (9 days), wave 3 (5), wave 4 (4), wave 5 (1 week), the switch. That is about 18 work days, then one
  week on the test copy, then one evening. Wave 2 and Track R run beside it.
- Each track builds in its own worktree. Brief each builder to run `git merge --ff-only <base branch>` first, to run its test
  files with `--no-file-parallelism --testTimeout=60000`, and to write its report to a file in its worktree before it returns.

## A.4 Why the read-cost changes go into Track R
- Both changes help today's stack: the badge is 75% of the rows read of an average call, and the outer sort reads each row a
  second time when no index gives the order (wave 0). Production on Postgres gets the gain now, months before the switch.
- The stored unread number is the one wave 0 change with a data rule of its own. On Postgres, `test:db` and the shadow run check
  it against the memory form on every API test, before the SQLite path depends on it.
- Wave 1 stays new code beside the old code, with no contract change and no production change. When Track R merges, the
  SQLite schema gets the `unread_counts` table in a schema version step, and Task 18 pins the badge.

---
# Part B: Wave 1 in detail (the database)

## B.1 Facts the builder needs (checked on 17 October 2026)
- node:sqlite works on Node 22.23.1 with no flag (an ExperimentalWarning only), inside vitest 5.0.2. Its rows have a null
  prototype; it refuses a boolean value ("Provided value cannot be bound"); `?2` and `?1` bind in number order; `$1` fails
  with "column index out of range"; it takes 150 bound values (the office object refuses more than 100). It has no rows
  counter. `indexed by` works.
- The office object refuses `BEGIN`, `SAVEPOINT`, `ATTACH`, `VACUUM` and `sqlite_version()`. node:sqlite allows all of them, so
  the node host must refuse them too (Task 4).
- In SQLite `->>` gives the integer 1 for JSON true. Postgres gives `'true'` and the memory form gives `String()`. Every doc
  field compare uses the `json_type` case form of Task 9.
- `INSERT ... SELECT ... ON CONFLICT` needs `where true` to parse. `RETURNING` gives rows in no fixed order. One bound value is
  at most 2 MB. `json_patch` drops null keys. Never `insert or replace`: it gives a new rowid and moves the row to the end.
- `Load` (`server/data/loaders/build.ts` lines 68 and 143) sorts every collection by `ord` in JavaScript, so no SQL text needs
  an outer sort.
- The db-mode harness (`server/test/db.ts`) runs `createRunCall({ calls })` with the default `sqlData` and `processOutbox`, on
  `fakeDeps`. In db mode the producers and effects of `server/auth/effects.ts`, `server/files/effects.ts` and
  `server/mcp/revokeAll.ts` register (through `server/calls/*.ts`); the mail and push ones do not (only `server/core/deps.ts`
  imports them).
- `memoryData` (`server/core/memoryData.ts`) and the other fakes match Postgres texts by exact string. So the Postgres
  constants stay as they are, and each SQLite text is a new constant beside it, chosen by `sqlFor` (Task 3).
- Only `src/api/handlers/pushLeaks.test.ts` calls server reads of later waves (`agents.list`, `users.invites`), and it accepts
  an error answer. So `test:lite` needs no skip list of its own: `LATER_CALLS` and `LATER_KINDS` (Task 14) name what may still
  fail with "no SQLite form" in wave 1.
- The records of the wave 0 generator (`scripts/proof/do-rows/src/gen.js`) fail zod in 12 of 20 tables (for example users
  `preferences.glass`, teams `tm_` ids, events `undoes: null`, comments `reactions` as a list). Task 17 builds a year office
  from the sample office instead.
- The sample office (`src/data/seed.ts`): usr_001 is the Admin (Hala Nasser), usr_002 to usr_008 are members, usr_009 is the
  agent, usr_010 is management, usr_011 is accounting.

## B.2 File map of wave 1

| File | Create or modify | Responsibility |
|---|---|---|
| `scripts/proof/do-tx/{wrangler.toml,index.js,run.mjs}` | create | Task 1 probe of the transaction facts of the office object |
| `server/core/ports.ts` | modify | `Db.dialect?: 'sqlite'` |
| `server/data/dialect.ts` | create | `markLite`, `isLite`, `sqlFor` |
| `server/data/lite/host.ts` | create | `SqlHost`, the refusal guard, `nodeHost` |
| `server/data/lite/hostChecks.ts` | create | the checks that both hosts must pass the same way |
| `server/data/lite/db.ts` | create | `liteDb`: the Db port on a host, `onCommit`, `wroteIn`, `liteDbOf`, the `RowMeter` |
| `server/data/lite/testDb.ts` | create | `freshLite()` for the tests: a new in-memory office with the schema |
| `server/data/loaders/query.ts` | modify | `columnNames(c)` |
| `server/data/lite/columns.ts` | create | the key columns of each table and their values |
| `server/data/lite/schema.ts` | create | `LITE_SCHEMA_VERSION`, `LITE_INDEXES`, `liteSchemaSql`, `applyLiteSchema` |
| `server/data/lite/office.ts` | create | the office snapshot rows and the office lists in the object memory |
| `server/data/lite/save.ts` | create | `liteWriteDiff`, `liteSave`, `insertRow` |
| `server/data/lite/whole.ts` | create | `liteWriteState`, `liteLoadWhole` |
| `server/data/lite/compile.ts` | create | the conditions in SQLite form |
| `server/data/lite/source.ts` | create | `liteSource`: the `Source` on SQLite |
| `server/data/lite/callData.ts` | create | `liteData`: the `CallData` of `createRunCall` on SQLite |
| `server/core/{lock,story,idempotency,effects}.ts` | modify | the SQLite forms of the call stores and the outbox |
| `server/calls/story.ts` | modify | `story.start` on SQLite |
| `server/files/{intents,records,effects}.ts`, `server/auth/effects.ts` | modify | the SQLite forms of the file texts and the email producer |
| `server/test/{down,gate,speed}.ts` | create (moved code) | harness parts that `db.ts` and `lite.ts` share |
| `server/test/{db,global-setup}.ts` | modify | import and export the moved parts again |
| `server/test/liteHarness.ts`, `server/test/lite.ts`, `server/test/lite-setup.ts` | create | the SQLite mirror backend, its setup file and its global setup |
| `vite.config.ts`, `package.json` | modify | projects `lite` and `office`, scripts `test:lite` and `test:office` |
| `server/office/workers.d.ts`, `server/office/doHost.ts` | create | the few Workers types, the office object host |
| `server/office/test/{wrangler.toml,entry.ts,pinOffice.ts,harness.ts,yearOffice.ts,pins.ts}` | create | the test Worker of `test:office`, the year office, the pins |
| `docs/superpowers/real-build/proof.md`, `TASKS.md`, the guides | modify | the records of wave 1 |

Tests: `server/data/dialect.test.ts`; `server/data/lite/{host,db,schema,office,save,compile,source,source.sweep,callData,outbox,serverTexts}.test.ts`;
`server/test/liteHarness.test.ts`; `server/office/test/yearOffice.test.ts`; `server/office/{doHost,pins}.wd.test.ts`.

Commands used in every task:
- One test file: `npx vitest run --project server <file> --no-file-parallelism --testTimeout=60000`.
- Types: `npm run typecheck`.

---

### Task 1: Probe the transaction facts of the office object

The plan uses `ctx.storage.transaction(async () => work(q))` with a synchronous `sql.exec` behind an async query (map of writes,
section 22, option B). The Cloudflare documents say that `sql.exec` inside the closure is part of the transaction, but nobody
probed the rollback, the isolation, or a timer inside it. This task measures them on local workerd. It changes no product code.

**Files:**
- Create: `scripts/proof/do-tx/wrangler.toml`, `scripts/proof/do-tx/index.js`, `scripts/proof/do-tx/run.mjs`
- Modify: `docs/superpowers/real-build/proof.md` (append the section "Wave 1: the transaction facts of the office object")

**Interfaces:**
- Consumes: `createTestHarness` from `wrangler` 4.147.0 (`listen`, `fetch`, `close`).
- Produces: the decision for Tasks 5 and 16: option B holds, or the plan stops for the owner.

- [ ] **Step 1: Write the probe Worker config**

```toml
# Probe of the exit plan, wave 1 Task 1: the transaction facts of a SQLite Durable Object. Local workerd only (wrangler
# createTestHarness); it never deploys.
name = "madar-do-tx-probe"
main = "index.js"
compatibility_date = "2026-09-01"
workers_dev = false

[[durable_objects.bindings]]
name = "OFFICE"
class_name = "Office"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Office"]
```

- [ ] **Step 2: Write the probe object**

```js
// The probe object of scripts/proof/do-tx (exit plan, wave 1 Task 1). Each route answers one open question of the plan.
import { DurableObject } from 'cloudflare:workers';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Office extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('create table if not exists log (n integer primary key, who text not null)');
    ctx.storage.sql.exec('create table if not exists r (id text primary key)');
  }

  /** (a) A transaction closure that writes, awaits, writes again and then throws: are its rows gone? */
  async rollback() {
    const sql = this.ctx.storage.sql;
    let error = 'none';
    try {
      await this.ctx.storage.transaction(async () => {
        sql.exec("insert into r values ('a')");
        await Promise.resolve();
        sql.exec("insert into r values ('b')");
        throw new Error('stop');
      });
    } catch (e) {
      error = e.message;
    }
    return { error, rows: sql.exec('select id from r order by id').toArray().map((row) => row.id) };
  }

  /** (b) and (c): a transaction that awaits microtasks or a timer. poke() comes in from a second request meanwhile. */
  async hold(who, kind, fail) {
    const sql = this.ctx.storage.sql;
    try {
      await this.ctx.storage.transaction(async () => {
        sql.exec('insert into log (who) values (?)', `${who}:start`);
        for (let i = 0; i < 20; i++) await (kind === 'timer' ? wait(2) : Promise.resolve());
        sql.exec('insert into log (who) values (?)', `${who}:end`);
        if (fail) throw new Error('stop');
      });
    } catch {
      // The log shows what the rollback kept.
    }
    return sql.exec('select who from log order by n').toArray().map((row) => row.who);
  }

  poke(who) {
    this.ctx.storage.sql.exec('insert into log (who) values (?)', who);
    return true;
  }

  /** (d) to (h): the counters of a rolled-back write, and the SQL forms that the plan uses. */
  features() {
    const sql = this.ctx.storage.sql;
    const one = (text, ...values) => {
      try {
        const cursor = sql.exec(text, ...values);
        const rows = cursor.toArray();
        return { ok: true, rows, read: cursor.rowsRead, written: cursor.rowsWritten };
      } catch (e) {
        return { ok: false, error: String(e.message).slice(0, 120) };
      }
    };
    let rolledBackWritten = -1;
    try {
      this.ctx.storage.transactionSync(() => {
        const cursor = sql.exec("insert into r values ('z')");
        cursor.toArray();
        rolledBackWritten = cursor.rowsWritten;
        throw new Error('stop');
      });
    } catch {
      // Expected.
    }
    sql.exec('create table if not exists ev (id text primary key, seq integer)');
    sql.exec("create trigger if not exists ev_guard before update on ev begin select raise(abort, 'events only grow'); end");
    sql.exec('create index if not exists ev_seq on ev (seq)');
    return {
      rolledBackWritten,
      foreignKeys: one('pragma foreign_keys'),
      subsec: one("select unixepoch('2026-10-16T12:00:00.500+03:00', 'subsec') as s"),
      julian: one("select julianday('2026-10-16T12:00:00.500+03:00') > julianday('2026-10-16T09:00:00.499Z') as later"),
      numbered: one('select ?2 as a, ?1 as b', 'one', 'two'),
      dollar: one('select $1 as a', 'one'),
      boolean: one('select ? as b', true),
      indexedBy: one('select id from ev indexed by ev_seq where seq > ?', 0),
      insertWithTrigger: one("insert into ev values ('e1', 1)"),
      triggerRefuses: one("update ev set seq = 2 where id = 'e1'"),
      values100: one(`select ${Array.from({ length: 100 }, () => '?').join(', ')}`, ...Array(100).fill(1)),
      values101: one(`select ${Array.from({ length: 101 }, () => '?').join(', ')}`, ...Array(101).fill(1)),
      returning: one("insert into r values ('m'), ('k') returning id"),
      tableValuedPragma: one("select count(*) as n from pragma_table_info('r')"),
      sqliteMaster: one("select count(*) as n from sqlite_master where name = 'sqlite_stat1'"),
      missingTable: one('select version from schema_version where id = 1'),
      fullkey: one(`select l.fullkey from json_each('{"a":[{"b":1},"x"]}', '$.a') l`),
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stub = env.OFFICE.get(env.OFFICE.idFromName(url.searchParams.get('o') ?? 'probe'));
    if (url.pathname === '/rollback') return Response.json(await stub.rollback());
    if (url.pathname === '/features') return Response.json(await stub.features());
    if (url.pathname === '/race') {
      const kind = url.searchParams.get('kind');
      const fail = url.searchParams.get('fail') === '1';
      const holding = stub.hold('A', kind, fail);
      await wait(3);
      await stub.poke('B');
      return Response.json({ kind, fail, log: await holding });
    }
    return new Response('not found', { status: 404 });
  },
};
```

- [ ] **Step 3: Write the driver**

```js
// Runs the probe of scripts/proof/do-tx on local workerd and prints every answer (exit plan, wave 1 Task 1).
import { createTestHarness } from 'wrangler';

const server = createTestHarness({ workers: [{ configPath: new URL('./wrangler.toml', import.meta.url).pathname }] });
await server.listen();
try {
  const get = async (path) => (await server.fetch(path)).json();
  console.log(JSON.stringify({
    rollback: await get('/rollback?o=r1'),
    microtask: await get('/race?o=m1&kind=micro'),
    timer: await get('/race?o=t1&kind=timer'),
    timerFail: await get('/race?o=t2&kind=timer&fail=1'),
    features: await get('/features?o=f1'),
  }, null, 1));
} finally {
  await server.close();
}
```

- [ ] **Step 4: Run the probe**

Run: `node scripts/proof/do-tx/run.mjs` (from the worktree root; with the sandbox off if `listen()` fails with `EPERM`).
Expected: one JSON object. The plan expects `rollback.rows` `[]`, `microtask.log` `["A:start", "A:end", "B"]`,
`features.values101.ok` `false`, `features.dollar.ok` `false` or a wrong value, `features.foreignKeys.rows` `[{"foreign_keys":1}]`.

- [ ] **Step 5: Decide, and stop when the facts break the plan**

- `rollback.rows` is not `[]`: the async transaction does not roll back. Stop the wave. Report the numbers to the owner: the
  plan then needs option A (a synchronous `transactionSync` path for the loaders, the save and the stores, about 5 to 8 more
  days). Do not start Task 3.
- `microtask.log` has `B` between `A:start` and `A:end`: another request runs inside an open transaction with only microtask
  awaits. Stop the wave and report it, as above.
- `timer.log` has `B` between `A:start` and `A:end`: write it in proof.md. The plan continues: Task 5 refuses a second
  transaction while one is open, and the rule "no await on the network, a timer or crypto.subtle inside a transaction" holds.
  Note in proof.md whether `timerFail.log` kept `B` (B committed on its own) or lost it (B joined the transaction of A).
- `features.julian.rows[0].later` is not 1: Task 9 cannot use `julianday` for `atOrAfter`. Use `unixepoch(x, 'subsec')` when
  `features.subsec.ok` is true; else stop and report.
- `features.missingTable.error` does not hold "no such table": change `versionOf` of Task 6 to the text that the office object
  gives, and write it in proof.md.
- `features.fullkey.rows` is not `[{"fullkey":"$.a[0]"},{"fullkey":"$.a[1]"}]`: `pathMatch` of Task 9 needs another form of the
  full path; write the form that the office object gives.

- [ ] **Step 6: Write the section in proof.md**

Append under the last section: `### Wave 1: the transaction facts of the office object (2026-10-17)`, one bullet for each key of
the JSON (the measured value and what it means for the plan), and the decision of Step 5.

- [ ] **Step 7: Commit**

```bash
git add scripts/proof/do-tx docs/superpowers/real-build/proof.md
git commit -m "Proof: the transaction facts of the office object on local workerd (exit wave 1, Task 1)"
```

---

### Task 2: List the SQL texts that test:db sends

The SQLite run must send a SQLite form of every text that the db-mode run sends today. The maps list about 70 call sites. This
task measures the real list on the Postgres run, with a logger that is not committed.

**Files:**
- Modify for the run only (revert in Step 6): `server/test/db.ts`
- Modify: `docs/superpowers/real-build/proof.md` (append "Wave 1: the SQL texts of test:db")

**Interfaces:**
- Consumes: the local stack (Docker Desktop on, `scripts/dev/docker-lock.sh`).
- Produces: the list that Tasks 12, 13 and 15 port, with the source file of each text.

- [ ] **Step 1: Take the Docker lock and start the stack**

Run: `scripts/dev/docker-lock.sh acquire exit-db && npx supabase start -x edge-runtime`
Expected: the stack runs (API 54321, Postgres 54322). If Docker Desktop is off, ask the owner to start it.

- [ ] **Step 2: Add the logger (temporary)**

In `server/test/db.ts`, change the vitest import to `import { afterAll, afterEach, beforeEach, expect, inject, vi, type TestContext } from 'vitest';`,
add `import { appendFileSync, writeFileSync } from 'node:fs';` in place of the `writeFileSync` import, and add these lines in
`openSession` right after `client = await pool.connect();` returns (after the `catch` block):

```ts
  const sqlLog = process.env.MADAR_SQL_LOG;
  if (sqlLog) {
    const query = client.query.bind(client) as (text: unknown, values?: unknown) => Promise<unknown>;
    (client as unknown as { query: unknown }).query = (text: unknown, values?: unknown) => {
      const body = typeof text === 'string' ? text : String((text as { text?: string }).text ?? '');
      appendFileSync(sqlLog, `${JSON.stringify({ text: body.replace(/\s+/g, ' ').trim(), file: expect.getState().testPath ?? '' })}\n`);
      return query(text, values);
    };
  }
```

- [ ] **Step 3: Run test:db with the logger**

Run: `MADAR_SQL_LOG=$TMPDIR/madar-sql.jsonl npm run test:db`
Expected: the same result as CI at 4cbdc95 (81 files, 1,141 passed, 25 skipped) and a log file of some 100,000 lines.

- [ ] **Step 4: Group the texts**

Write `$TMPDIR/madar-sql-group.mjs`:

```js
import { readFileSync } from 'node:fs';
const groups = new Map();
for (const line of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const { text, file } = JSON.parse(line);
  const key = text.replace(/\$\d+/g, '$n').slice(0, 140);
  const group = groups.get(key) ?? { key, calls: 0, files: new Set() };
  group.calls += 1;
  group.files.add(file.replace(/^.*\/(src|server)\//, '$1/'));
  groups.set(key, group);
}
for (const g of [...groups.values()].sort((a, b) => b.calls - a.calls)) console.log(`${g.calls}\t${g.files.size}\t${g.key}`);
```

Run: `node $TMPDIR/madar-sql-group.mjs $TMPDIR/madar-sql.jsonl > $TMPDIR/madar-sql-groups.tsv && wc -l $TMPDIR/madar-sql-groups.tsv`
Expected: a list of distinct texts. The loader selects are many distinct texts of `sqlSource.ts`; the rest are hand texts.

- [ ] **Step 5: Name the source of each hand text**

For each line whose text does not start with `select t.ord`, `select x.ord`, `select ord, doc`, `select t.<col> as v` or
`select b.k as v`, find its constant with `grep -rn "<first 40 characters>" server --include='*.ts' | grep -v test`, and give it
one of three marks: "wave 1" (Tasks 12, 13), "wave 2" (sign-in, agents), "wave 3" (usage, jobs, mail, push).

- [ ] **Step 6: Remove the logger**

Run: `git checkout server/test/db.ts && git status --short`
Expected: `server/test/db.ts` is not in the list.

- [ ] **Step 7: Write the section in proof.md and release the lock**

Append `### Wave 1: the SQL texts of test:db (2026-10-17)`: the run result, the count of distinct texts, and a table "Text (first
80 characters) | Calls | Source file | Wave". Then run `scripts/dev/docker-lock.sh release exit-db`.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/real-build/proof.md
git commit -m "Proof: the SQL texts that test:db sends, with the wave of each SQLite form (exit wave 1, Task 2)"
```

---

### Task 3: The dialect of a query and a Db

**Files:**
- Modify: `server/core/ports.ts:11-25` (the `Db` interface)
- Create: `server/data/dialect.ts`
- Test: `server/data/dialect.test.ts`

**Interfaces:**
- Consumes: `Db`, `Query` (`server/core/ports.ts`).
- Produces: `Db.dialect?: 'sqlite'`; `markLite(q: Query): Query`; `isLite(target: Query | Pick<Db, 'dialect'>): boolean`;
  `sqlFor(target: Query | Pick<Db, 'dialect'>, pg: string, lite: string): string`.

- [ ] **Step 1: Write the test that fails**

```ts
import { describe, expect, it } from 'vitest';
import type { Db, Query } from '../core/ports';
import { isLite, markLite, sqlFor } from './dialect';

const pgQuery: Query = async () => [];
const liteQuery: Query = markLite(async () => []);

describe('the dialect of a query or a Db (server/data/dialect.ts)', () => {
  it('names the Postgres text for a query that no SQLite Db made', () => {
    expect(isLite(pgQuery)).toBe(false);
    expect(sqlFor(pgQuery, 'select $1', 'select ?1')).toBe('select $1');
  });

  it('names the SQLite text for a query that a SQLite Db marked', () => {
    expect(isLite(liteQuery)).toBe(true);
    expect(sqlFor(liteQuery, 'select $1', 'select ?1')).toBe('select ?1');
  });

  it('reads the dialect of a Db from its field, and takes a Db with no field as Postgres', () => {
    const pg: Pick<Db, 'dialect'> = {};
    const lite: Pick<Db, 'dialect'> = { dialect: 'sqlite' };
    expect(sqlFor(pg, 'a', 'b')).toBe('a');
    expect(sqlFor(lite, 'a', 'b')).toBe('b');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/dialect.test.ts`
Expected: FAIL with "Failed to resolve import "./dialect"".

- [ ] **Step 3: Add the field to the Db port**

In `server/core/ports.ts`, inside `export interface Db {`, after the `warm?` member, add:

```ts
  /**
   * 'sqlite' for the SQLite Db of the office object and of test:lite (server/data/lite/db.ts). Absent means Postgres. Code that
   * sends its own SQL picks its text with sqlFor (server/data/dialect.ts).
   */
  readonly dialect?: 'sqlite';
```

- [ ] **Step 4: Write the dialect module**

```ts
import type { Db, Query } from '../core/ports';

/**
 * The dialect of the database behind a query or a Db (Supabase exit, wave 1). The Postgres path and the SQLite path run the same
 * code. A module that sends its own SQL keeps its Postgres constant as it is (the fakes match it by exact text) and adds its
 * SQLite twin beside it; sqlFor gives the text for the database of the call.
 */

/** The queries that a SQLite Db made. Every other query is Postgres. */
const LITE = new WeakSet<Query>();

export function markLite(q: Query): Query {
  LITE.add(q);
  return q;
}

export function isLite(target: Query | Pick<Db, 'dialect'>): boolean {
  return typeof target === 'function' ? LITE.has(target) : target.dialect === 'sqlite';
}

/** The text of one statement for the database of target: the Postgres text, or its SQLite twin. */
export function sqlFor(target: Query | Pick<Db, 'dialect'>, pg: string, lite: string): string {
  return isLite(target) ? lite : pg;
}
```

- [ ] **Step 5: Run the test and the types**

Run: `npx vitest run --project server server/data/dialect.test.ts && npm run typecheck`
Expected: PASS (3 tests), and no type error.

- [ ] **Step 6: Commit**

```bash
git add server/core/ports.ts server/data/dialect.ts server/data/dialect.test.ts
git commit -m "Exit wave 1: the dialect of a query and a Db, and sqlFor for the SQLite twin of a text"
```

---

### Task 4: The SQL host for node:sqlite, and the checks that both hosts share

**Files:**
- Create: `server/data/lite/host.ts`, `server/data/lite/hostChecks.ts`
- Test: `server/data/lite/host.test.ts`

**Interfaces:**
- Consumes: `DatabaseSync` (`node:sqlite`).
- Produces: `type SqlValue = string | number | null | Uint8Array`; `type SqlRow = Record<string, SqlValue>`;
  `type ExecResult = { rows: SqlRow[]; rowsRead: number; rowsWritten: number }`;
  `interface SqlHost { exec(text: string, values: readonly SqlValue[]): ExecResult; transaction<T>(work: () => Promise<T>): Promise<T>; size(): number; readonly counts: boolean }`;
  `const MAX_VALUES = 100`; `refuseLiteStatement(text: string, values: readonly SqlValue[]): void`;
  `nodeHost(db: DatabaseSync, o?: { log?: string[] }): SqlHost`; `hostChecks(host: SqlHost): Promise<Record<string, string>>`;
  `const EXPECTED_CHECKS: Readonly<Record<string, string>>`.

- [ ] **Step 1: Write the test that fails**

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { nodeHost } from './host';
import { EXPECTED_CHECKS, hostChecks } from './hostChecks';

describe('the node:sqlite host (server/data/lite/host.ts)', () => {
  it('refuses what the office object refuses, and keeps its transactions as the office object does', async () => {
    expect(await hostChecks(nodeHost(new DatabaseSync(':memory:')))).toEqual(EXPECTED_CHECKS);
  });

  it('runs a statement with values and gives plain rows back', () => {
    const host = nodeHost(new DatabaseSync(':memory:'));
    host.exec('create table t (id text primary key, n integer)', []);
    host.exec('insert into t values (?, ?)', ['a', 1]);
    const { rows } = host.exec('select id, n from t', []);
    expect(rows).toEqual([{ id: 'a', n: 1 }]);
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
  });

  it('gives the rows of a write with returning, and counts no rows', () => {
    const host = nodeHost(new DatabaseSync(':memory:'));
    host.exec('create table t (id integer primary key, kind text)', []);
    expect(host.exec('insert into t (kind) values (?) returning id', ['x'])).toEqual({ rows: [{ id: 1 }], rowsRead: 0, rowsWritten: 0 });
    expect(host.counts).toBe(false);
  });

  it('writes each statement that it runs to the log, when the caller gives one', () => {
    const log: string[] = [];
    const host = nodeHost(new DatabaseSync(':memory:'), { log });
    host.exec('select 1 as one', []);
    expect(log).toEqual(['select 1 as one']);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/host.test.ts`
Expected: FAIL with "Failed to resolve import "./host"".

- [ ] **Step 3: Write the host**

```ts
import type { DatabaseSync } from 'node:sqlite';

/**
 * The SQL host of the SQLite path (Supabase exit, wave 1): one database that runs one statement at a time, synchronously. Two
 * hosts exist: nodeHost (node:sqlite: test:lite, the restore check) and doHost (the office object: server/office/doHost.ts).
 * Both refuse what the office object refuses, so a test on node never passes code that fails in the office object.
 */

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;
export type ExecResult = { rows: SqlRow[]; rowsRead: number; rowsWritten: number };

export interface SqlHost {
  /** One statement. The values go to ? and ?NNN in order. */
  exec(text: string, values: readonly SqlValue[]): ExecResult;
  /**
   * One transaction around work. Every await inside work must be on exec: no network, no timer, no crypto.subtle (the rule of
   * the office object). A throw rolls back. A second transaction while one is open is refused.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  /** The size of the database in bytes. */
  size(): number;
  /** True when rowsRead and rowsWritten are real (the office object). node:sqlite gives 0 for both. */
  readonly counts: boolean;
}

/** The most bound values that the office object takes in one statement (proof.md, wave 0). */
export const MAX_VALUES = 100;

const REFUSED_START = /^\s*(begin|commit|rollback|end|savepoint|release|attach|detach|vacuum|analyze|reindex|pragma)\b/i;

/** Throws for a statement that the office object refuses, or that breaks a rule of the SQLite path. */
export function refuseLiteStatement(text: string, values: readonly SqlValue[]): void {
  const start = REFUSED_START.exec(text);
  if (start) {
    throw new Error(`The SQLite host refuses "${start[1].toLowerCase()}": the office object allows only its own transactions, and no ANALYZE or PRAGMA.`);
  }
  if (/\bsqlite_version\s*\(/i.test(text)) throw new Error('The SQLite host refuses sqlite_version(): the office object does not allow it.');
  if (/\$\d/.test(text)) {
    throw new Error(`The SQLite host refuses a Postgres placeholder ($1). Give the caller a SQLite form with sqlFor (server/data/dialect.ts): ${text.slice(0, 80)}`);
  }
  if (/::[a-z]/i.test(text)) {
    throw new Error(`The SQLite host refuses a Postgres cast (::). Give the caller a SQLite form with sqlFor (server/data/dialect.ts): ${text.slice(0, 80)}`);
  }
  if (values.length > MAX_VALUES) {
    throw new Error(`The SQLite host refuses ${values.length} bound values in one statement: the office object takes at most ${MAX_VALUES}.`);
  }
}

/** The message of a second transaction, the same on both hosts. */
export const NESTED_TRANSACTION = 'The SQLite host has a transaction open already: one transaction at a time.';

/** The host on node:sqlite. The log gets the text of each statement that runs (tests read it). */
export function nodeHost(db: DatabaseSync, o: { log?: string[] } = {}): SqlHost {
  let open = false;
  return {
    counts: false,
    exec(text, values) {
      refuseLiteStatement(text, values);
      o.log?.push(text);
      const statement = db.prepare(text);
      if (statement.columns().length === 0) {
        statement.run(...values);
        return { rows: [], rowsRead: 0, rowsWritten: 0 };
      }
      return { rows: statement.all(...values).map((row) => ({ ...row }) as SqlRow), rowsRead: 0, rowsWritten: 0 };
    },
    async transaction(work) {
      if (open) throw new Error(NESTED_TRANSACTION);
      open = true;
      db.exec('begin');
      try {
        const out = await work();
        db.exec('commit');
        return out;
      } catch (error) {
        db.exec('rollback');
        throw error;
      } finally {
        open = false;
      }
    },
    size() {
      const row = db.prepare('select page_count * page_size as n from pragma_page_count(), pragma_page_size()').get() as { n: number };
      return Number(row.n);
    },
  };
}
```

- [ ] **Step 4: Write the shared checks**

```ts
import { MAX_VALUES, NESTED_TRANSACTION, type SqlHost } from './host';

/**
 * The behaviour that both hosts must share. server/data/lite/host.test.ts runs it on node:sqlite, and
 * server/office/doHost.wd.test.ts runs it inside the office object on workerd. Both must give EXPECTED_CHECKS.
 */
export async function hostChecks(host: SqlHost): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const check = async (name: string, work: () => unknown): Promise<void> => {
    try {
      await work();
      out[name] = 'ok';
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      out[name] = text === NESTED_TRANSACTION ? 'nested' : text.startsWith('The SQLite host refuses') ? 'refused' : 'error';
    }
  };
  const list = (n: number) => Array.from({ length: n }, () => '?').join(', ');
  host.exec('create table if not exists checks (id text primary key, n integer)', []);
  await check('begin', () => host.exec('begin', []));
  await check('savepoint', () => host.exec('savepoint a', []));
  await check('attach', () => host.exec("attach database ':memory:' as x", []));
  await check('vacuum', () => host.exec('vacuum', []));
  await check('analyze', () => host.exec('analyze', []));
  await check('pragma', () => host.exec('pragma optimize', []));
  await check('version', () => host.exec('select sqlite_version() as v', []));
  await check('dollar', () => host.exec('select $1 as v', ['a']));
  await check('cast', () => host.exec("select '1'::integer as v", []));
  await check('values100', () => host.exec(`select ${list(MAX_VALUES)}`, Array(MAX_VALUES).fill(1)));
  await check('values101', () => host.exec(`select ${list(MAX_VALUES + 1)}`, Array(MAX_VALUES + 1).fill(1)));
  await check('rollback', async () => {
    await host
      .transaction(async () => {
        host.exec("insert into checks values ('a', 1)", []);
        await Promise.resolve();
        throw new Error('stop');
      })
      .catch(() => undefined);
    if (host.exec("select id from checks where id = 'a'", []).rows.length !== 0) throw new Error('The rollback kept a row.');
  });
  await check('commit', async () => {
    await host.transaction(async () => {
      host.exec("insert into checks values ('b', 2)", []);
      await Promise.resolve();
    });
    if (host.exec("select id from checks where id = 'b'", []).rows.length !== 1) throw new Error('The commit lost a row.');
  });
  await check('nested', () => host.transaction(() => host.transaction(async () => 1)));
  await check('numbered', () => {
    const [row] = host.exec('select ?2 as a, ?1 as b', ['one', 'two']).rows;
    if (row.a !== 'two' || row.b !== 'one') throw new Error('The numbered values went to the wrong places.');
  });
  await check('arrow', () => {
    const [row] = host.exec(`select '{"f":true}' ->> '$.f' as f`, []).rows;
    if (row.f !== 1) throw new Error(`->> gave ${String(row.f)} for JSON true.`);
  });
  return out;
}

export const EXPECTED_CHECKS: Readonly<Record<string, string>> = {
  begin: 'refused', savepoint: 'refused', attach: 'refused', vacuum: 'refused', analyze: 'refused', pragma: 'refused',
  version: 'refused', dollar: 'refused', cast: 'refused', values100: 'ok', values101: 'refused', rollback: 'ok', commit: 'ok',
  nested: 'nested', numbered: 'ok', arrow: 'ok',
};
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run --project server server/data/lite/host.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add server/data/lite/host.ts server/data/lite/hostChecks.ts server/data/lite/host.test.ts
git commit -m "Exit wave 1: the node:sqlite host, which refuses what the office object refuses"
```

---

### Task 5: The SQLite Db port

**Files:**
- Create: `server/data/lite/db.ts`
- Test: `server/data/lite/db.test.ts`

**Interfaces:**
- Consumes: `SqlHost`, `SqlRow`, `SqlValue` (Task 4); `markLite` (Task 3); `Db`, `Query` (`server/core/ports.ts`).
- Produces: `type RowMeter = { rowsRead: number; rowsWritten: number; statements: number }`;
  `type LiteDb = Db & { readonly dialect: 'sqlite'; readonly host: SqlHost; readonly meter: RowMeter }`;
  `const JSON_COLUMNS: ReadonlySet<string>`; `bindOf(value: unknown): SqlValue`; `rowOut(row: SqlRow): Record<string, unknown>`;
  `onCommit(q: Query, fn: () => void): void`; `wroteIn(q: Query): boolean`; `liteDbOf(q: Query): LiteDb`; `liteDb(host: SqlHost): LiteDb`.

- [ ] **Step 1: Write the test that fails**

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Query } from '../../core/ports';
import { isLite } from '../dialect';
import { bindOf, liteDb, liteDbOf, onCommit, wroteIn } from './db';
import { nodeHost } from './host';

function fresh() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('create table t (id text primary key, doc text not null, n integer)');
  return liteDb(nodeHost(raw));
}

describe('the SQLite Db (server/data/lite/db.ts)', () => {
  it('commits a write transaction and gives a JSON column back as a value', async () => {
    const db = fresh();
    await db.tx('write', (q) => q('insert into t (id, doc, n) values (?, ?, ?)', ['a', { x: 1 }, 2]));
    expect(await db.statement('read', 'select id, doc, n from t')).toEqual([{ id: 'a', doc: { x: 1 }, n: 2 }]);
  });

  it('rolls back every statement of a transaction that throws, and runs no work of onCommit', async () => {
    const db = fresh();
    let ran = false;
    await expect(db.tx('write', async (q) => {
      await q('insert into t (id, doc) values (?, ?)', ['a', '{}']);
      onCommit(q, () => {
        ran = true;
      });
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(await db.statement('read', 'select id from t')).toEqual([]);
    expect(ran).toBe(false);
  });

  it('runs the work of onCommit after the commit, in order', async () => {
    const db = fresh();
    const order: string[] = [];
    await db.tx('write', async (q) => {
      onCommit(q, () => order.push('first'));
      onCommit(q, () => order.push('second'));
      order.push('work');
    });
    expect(order).toEqual(['work', 'first', 'second']);
  });

  it('refuses a second transaction while one is open (two saves at one time)', async () => {
    const db = fresh();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = db.tx('write', async (q) => {
      await q('insert into t (id, doc) values (?, ?)', ['a', '{}']);
      await gate;
    });
    await expect(db.tx('write', async () => undefined)).rejects.toThrow('a SQLite transaction is open already');
    release();
    await first;
    expect(await db.statement('read', 'select id from t')).toEqual([{ id: 'a' }]);
  });

  it('refuses a write inside a read transaction', async () => {
    const db = fresh();
    await expect(db.tx('read', (q) => q('insert into t (id, doc) values (?, ?)', ['a', '{}']))).rejects.toThrow('A read transaction refuses a write');
  });

  it('refuses a statement inside a transaction, and a query after its transaction ended', async () => {
    const db = fresh();
    let kept: Query | undefined;
    await db.tx('read', async (q) => {
      kept = q;
      await expect(db.statement('read', 'select 1 as one')).rejects.toThrow('db.statement runs with no open transaction');
    });
    await expect(kept!('select 1 as one')).rejects.toThrow('a transaction that ended');
  });

  it('refuses a schema statement: the schema step owns the tables', async () => {
    const db = fresh();
    await expect(db.statement('write', 'create table x (id text)')).rejects.toThrow('refuses a schema statement');
  });

  it('binds true, false, undefined, a Date, a list and an object as SQLite values', () => {
    expect([true, false, undefined, null, new Date('2026-10-17T00:00:00Z'), ['a'], { b: 1 }, 3, 'x'].map(bindOf)).toEqual(
      [1, 0, null, null, '2026-10-17T00:00:00.000Z', '["a"]', '{"b":1}', 3, 'x'],
    );
  });

  it('marks its queries as SQLite, names its Db by the query, and knows when a transaction wrote', async () => {
    const db = fresh();
    expect(isLite(db)).toBe(true);
    await db.tx('write', async (q) => {
      expect(isLite(q)).toBe(true);
      expect(liteDbOf(q)).toBe(db);
      expect(wroteIn(q)).toBe(false);
      await q('insert into t (id, doc) values (?, ?)', ['a', '{}']);
      expect(wroteIn(q)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/db.test.ts`
Expected: FAIL with "Failed to resolve import "./db"".

- [ ] **Step 3: Write the Db port**

```ts
import type { Db, Query } from '../../core/ports';
import { markLite } from '../dialect';
import type { SqlHost, SqlRow, SqlValue } from './host';

/**
 * The Db port on a SQLite host (Supabase exit, wave 1). runCall and its stores keep the async Query, and each statement runs
 * at once on the host, so an await inside a transaction lets no other request in (Task 1 of the exit plan). It keeps two guards
 * of pgDb: no nested transaction, and a read transaction writes nothing. It has no pool: no warm, no close, no savepoint.
 */

/** The rows that the Db counted: the rows pins and the day meters (wave 0). node:sqlite counts 0. */
export type RowMeter = { rowsRead: number; rowsWritten: number; statements: number };

export type LiteDb = Db & { readonly dialect: 'sqlite'; readonly host: SqlHost; readonly meter: RowMeter };

/** The columns that hold JSON text. A read gives them back as values, as pg gives a jsonb column. */
export const JSON_COLUMNS: ReadonlySet<string> = new Set(['doc', 'payload', 'result', 'mail', 'versions']);

const WRITE = /^\s*(insert|update|delete|replace)\b/i;
const SCHEMA = /^\s*(create|drop|alter)\b/i;

type Tx = { mode: 'read' | 'write'; wrote: boolean; after: (() => void)[] };
const TX_OF = new WeakMap<Query, Tx>();
const DB_OF = new WeakMap<Query, LiteDb>();

/** A value as SQLite takes it: a boolean as 1 or 0, a Date as ISO text, a list or an object as JSON text. */
export function bindOf(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

/** One row as the callers get it: a plain object, with each JSON column parsed. */
export function rowOut(row: SqlRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = JSON_COLUMNS.has(key) && typeof value === 'string' ? JSON.parse(value) : value;
  return out;
}

/** Runs fn after the commit of the transaction of q. A rollback drops it (the office snapshot; in wave 3 the socket signals). */
export function onCommit(q: Query, fn: () => void): void {
  const tx = TX_OF.get(q);
  if (!tx) throw new Error('onCommit needs the query of an open SQLite transaction.');
  tx.after.push(fn);
}

/** True when the transaction of q wrote a row already: the office read then keeps nothing in memory. */
export function wroteIn(q: Query): boolean {
  return TX_OF.get(q)?.wrote === true;
}

/** The Db that made a query. */
export function liteDbOf(q: Query): LiteDb {
  const db = DB_OF.get(q);
  if (!db) throw new Error('This query does not belong to a SQLite Db.');
  return db;
}

export function liteDb(host: SqlHost): LiteDb {
  const meter: RowMeter = { rowsRead: 0, rowsWritten: 0, statements: 0 };
  let open: Tx | undefined;

  function run<R>(tx: Tx, text: string, values: readonly unknown[]): R[] {
    if (SCHEMA.test(text)) throw new Error('The SQLite Db refuses a schema statement: the schema step (server/data/lite/schema.ts) owns the tables.');
    const write = WRITE.test(text);
    if (write && tx.mode === 'read') throw new Error(`A read transaction refuses a write: ${text.slice(0, 60)}`);
    const result = host.exec(text, values.map(bindOf));
    meter.rowsRead += result.rowsRead;
    meter.rowsWritten += result.rowsWritten;
    meter.statements += 1;
    if (tx.mode === 'read' && result.rowsWritten > 0) throw new Error(`A read transaction wrote ${result.rowsWritten} rows: ${text.slice(0, 60)}`);
    if (write) tx.wrote = true;
    return result.rows.map(rowOut) as R[];
  }

  const db: LiteDb = {
    dialect: 'sqlite',
    host,
    meter,
    async tx<T>(mode: 'read' | 'write', work: (q: Query) => Promise<T>): Promise<T> {
      if (open) throw new Error('db.tx: a SQLite transaction is open already. One call holds one transaction.');
      const tx: Tx = { mode, wrote: false, after: [] };
      const q = markLite((async <R,>(text: string, values: unknown[] = []): Promise<R[]> => {
        if (open !== tx) throw new Error('This query belongs to a transaction that ended.');
        return run<R>(tx, text, values);
      }) as Query);
      TX_OF.set(q, tx);
      DB_OF.set(q, db);
      open = tx;
      try {
        const out = await host.transaction(() => work(q));
        open = undefined;
        for (const fn of tx.after) fn();
        return out;
      } finally {
        open = undefined;
      }
    },
    savepoint: () => Promise.reject(new Error('The SQLite Db has no savepoint: no production code asks for one.')),
    statement<R = Record<string, unknown>>(mode: 'read' | 'write', text: string, values?: unknown[]): Promise<R[]> {
      if (open) return Promise.reject(new Error('db.statement runs with no open transaction. Use the query of the transaction.'));
      return db.tx(mode, (q) => q<R>(text, values));
    },
  };
  return db;
}
```

- [ ] **Step 4: Run the test and the types**

Run: `npx vitest run --project server server/data/lite/db.test.ts && npm run typecheck`
Expected: PASS (9 tests), and no type error.

- [ ] **Step 5: Commit**

```bash
git add server/data/lite/db.ts server/data/lite/db.test.ts
git commit -m "Exit wave 1: the SQLite Db port, with one transaction at a time and no write in a read"
```

---
### Task 6: The SQLite schema and its version

**Files:**
- Modify: `server/data/loaders/query.ts` (add `columnNames` after `columnOfField`, about line 69)
- Create: `server/data/lite/columns.ts`, `server/data/lite/schema.ts`, `server/data/lite/testDb.ts`
- Test: `server/data/lite/schema.test.ts`

**Interfaces:**
- Consumes: `TABLES`, `TableSpec`, `SERVER_TABLES`, `COUNTERS_TABLE` (`server/data/tables.ts`); `columnOf` (`query.ts`); `Row`
  (`server/data/rows.ts`); `SqlHost`, `SqlValue`, `nodeHost` (Task 4); `liteDb`, `LiteDb` (Task 5).
- Produces: `columnNames(c: TableCollection): string[]`; `keyColumnsOf(spec: TableSpec): readonly string[]`;
  `sqlTypeOf(spec: TableSpec, name: string): 'integer' | 'text'`;
  `keyValuesOf(spec: TableSpec, row: Row, state: State): Record<string, SqlValue>`; `LITE_SCHEMA_VERSION`; `type LiteIndex`;
  `LITE_INDEXES`; `SERVER_INDEXES`; `TIME_INDEX: Readonly<Record<string, string>>`; `EVENT_GUARDS`; `eventGuardsSql(): string[]`;
  `DEFAULT_SETTINGS`; `indexedColumnsOf(table: string): ReadonlySet<string>`; `liteSchemaSql(): string[]`;
  `applyLiteSchema(host: SqlHost): Promise<{ applied: boolean }>`;
  `freshLite(): Promise<{ raw: DatabaseSync; db: LiteDb; log: string[] }>`.

- [ ] **Step 1: Write the test that fails**

```ts
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { columnNames } from '../loaders/query';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES } from '../tables';
import { nodeHost } from './host';
import { DEFAULT_SETTINGS, LITE_SCHEMA_VERSION, applyLiteSchema, liteSchemaSql } from './schema';
import { freshLite } from './testDb';

/** The sha256 of the schema text of LITE_SCHEMA_VERSION. A change of the schema needs a new version and a new value here. */
const PINNED_SHA256 = '';

const tablesOf = (raw: DatabaseSync) =>
  (raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((r) => r.name);
const columnsOf = (raw: DatabaseSync, table: string) =>
  (raw.prepare('select name from pragma_table_info(?)').all(table) as { name: string }[]).map((r) => r.name);

describe('the SQLite schema (server/data/lite/schema.ts)', () => {
  it('makes one table for each State collection, with the loader columns of query.ts, and only id and doc for an office list', async () => {
    const { raw } = await freshLite();
    for (const spec of TABLES) {
      expect(columnsOf(raw, spec.table), spec.table).toEqual(['id', 'doc', ...(spec.office ? [] : columnNames(spec.collection))]);
    }
  });

  it('keeps the server tables of Postgres, apart from office_deletes and platform_config, and adds three of its own', async () => {
    const { raw } = await freshLite();
    const kept = SERVER_TABLES.filter((table) => table !== 'office_deletes' && table !== 'platform_config');
    const expected = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...kept, 'agent_approvals', 'office_snapshot', 'schema_version'];
    expect(tablesOf(raw)).toEqual(expected.sort());
  });

  it('has no foreign key: a broken deferred key resets the office object', async () => {
    const { raw } = await freshLite();
    for (const table of tablesOf(raw)) expect(raw.prepare('select count(*) as n from pragma_foreign_key_list(?)').get(table), table).toEqual({ n: 0 });
  });

  it('seeds the settings row and office_meta as a fresh Postgres schema does', async () => {
    const { db } = await freshLite();
    expect(await db.statement('read', "select doc from settings where id = 'office'")).toEqual([{ doc: DEFAULT_SETTINGS }]);
    expect(await db.statement('read', 'select id, version, office_seq from office_meta')).toEqual([{ id: 1, version: 0, office_seq: 0 }]);
  });

  it('applies once: a second start reads the version and runs no schema statement', async () => {
    const raw = new DatabaseSync(':memory:');
    const log: string[] = [];
    const host = nodeHost(raw, { log });
    expect(await applyLiteSchema(host)).toEqual({ applied: true });
    log.length = 0;
    expect(await applyLiteSchema(host)).toEqual({ applied: false });
    expect(log).toEqual(['select version from schema_version where id = 1']);
  });

  it('refuses an office of another schema version', async () => {
    const { raw } = await freshLite();
    raw.exec('update schema_version set version = 99');
    await expect(applyLiteSchema(nodeHost(raw))).rejects.toThrow('is version 99');
  });

  it('never makes the statistics table of ANALYZE', async () => {
    const { raw } = await freshLite();
    expect(raw.prepare("select count(*) as n from sqlite_master where name like 'sqlite_stat%'").get()).toEqual({ n: 0 });
  });

  it('refuses an update and a delete of an event', async () => {
    const { db } = await freshLite();
    await db.tx('write', (q) => q('insert into events (id, doc, seq) values (?, ?, ?)', ['evt_001', '{}', 1]));
    await expect(db.statement('write', 'update events set seq = 2')).rejects.toThrow('events only grow');
    await expect(db.statement('write', 'delete from events')).rejects.toThrow('events only grow');
  });

  it('pins the schema text to its version', () => {
    const sha256 = createHash('sha256').update(liteSchemaSql().join('\n')).digest('hex');
    expect({ version: LITE_SCHEMA_VERSION, sha256 }).toEqual({ version: 1, sha256: PINNED_SHA256 });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/schema.test.ts`
Expected: FAIL with "Failed to resolve import "./schema"".

- [ ] **Step 3: Add the column names of a table to query.ts**

After `columnOfField` in `server/data/loaders/query.ts`:

```ts
/** The names of the loader columns of one table, in the order of COLUMNS. The SQLite schema makes one plain column for each. */
export function columnNames(c: TableCollection): string[] {
  return Object.keys(COLUMNS[c] ?? {});
}
```

- [ ] **Step 4: Write the key columns**

```ts
import type { State } from '../../../src/api/store';
import { columnNames, columnOf } from '../loaders/query';
import type { Row } from '../rows';
import type { TableSpec } from '../tables';
import type { SqlValue } from './host';

/**
 * The key columns of the SQLite tables (Supabase exit, wave 1). They are plain columns that the save writes (wave 0: an update
 * of a table with generated columns rewrote every index). Their values come from the same column rules that the memory form
 * filters with (COLUMNS of query.ts), so SQL and memory agree. An office list has none: it loads whole, from the snapshot.
 */

export function keyColumnsOf(spec: TableSpec): readonly string[] {
  return spec.office ? [] : columnNames(spec.collection);
}

/** integer for a bool or int column (a bool is 1 or 0), text for the others. */
export function sqlTypeOf(spec: TableSpec, name: string): 'integer' | 'text' {
  return columnOf(spec.collection, name).type === 'text' ? 'text' : 'integer';
}

/** The values of the key columns of one row. A server column comes from the row, because the save fills it (comments.project_id). */
export function keyValuesOf(spec: TableSpec, row: Row, state: State): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const name of keyColumnsOf(spec)) {
    if (spec.serverColumns && name in spec.serverColumns) {
      const value = row.columns[name];
      out[name] = value === undefined || value === null ? null : String(value);
      continue;
    }
    const value = columnOf(spec.collection, name).value(row.doc, state, spec);
    out[name] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }
  return out;
}
```

- [ ] **Step 5: Write the schema**

```ts
import { TABLES, type TableSpec } from '../tables';
import { keyColumnsOf, sqlTypeOf } from './columns';
import type { SqlHost } from './host';

/**
 * The one SQLite schema of the office object (Supabase exit, wave 1), in place of the 18 Postgres migrations. The entity tables
 * come from tables.ts and the loader columns of query.ts. The office object applies it at start, after it reads schema_version:
 * a schema statement writes rows, so the start of a current office runs none. Until the first office object deploys (wave 3), a
 * change bumps LITE_SCHEMA_VERSION with no step; after that, each new version needs a step of its own in applyLiteSchema.
 *
 * Rules (wave 0): plain key columns that the save writes; no foreign key; no ANALYZE; ascending indexes, so a backward scan gives
 * created_at desc, id desc and rowid desc with no sort step. Every time column holds ISO text in UTC (Date.toISOString).
 */
export const LITE_SCHEMA_VERSION = 1;

export type LiteIndex = { table: string; name: string; columns: string; unique?: true; where?: string };

/** The read indexes of the loaders. Task 18 of the exit plan cuts the event indexes to the ones that a read needs. */
export const LITE_INDEXES: readonly LiteIndex[] = [
  { table: 'push_devices', name: 'push_devices_endpoint', columns: 'endpoint', unique: true },
  { table: 'push_devices', name: 'push_devices_user', columns: 'user_id' },
  { table: 'tasks', name: 'tasks_project', columns: 'project_id' },
  { table: 'tasks', name: 'tasks_owner', columns: 'owner_id' },
  { table: 'updates', name: 'updates_project_created', columns: 'project_id, created_at' },
  { table: 'comments', name: 'comments_target', columns: 'target_type, target_id, created_at, id' },
  { table: 'comments', name: 'comments_project', columns: 'project_id' },
  { table: 'comments', name: 'comments_target_id', columns: 'target_id' },
  { table: 'files', name: 'files_project', columns: 'project_id' },
  { table: 'files', name: 'files_task', columns: 'task_id' },
  { table: 'tracker', name: 'tracker_project', columns: 'project_id' },
  { table: 'tracker', name: 'tracker_open', columns: 'project_id', where: 'open = 1' },
  { table: 'payments', name: 'payments_project', columns: 'project_id' },
  { table: 'notifications', name: 'notifications_inbox', columns: 'user_id, read, created_at, id' },
  { table: 'notifications', name: 'notifications_story', columns: 'correlation_id' },
  { table: 'notifications', name: 'notifications_target', columns: 'target_type, target_id' },
  { table: 'notifications', name: 'notifications_dedupe', columns: 'dedupe_key', unique: true, where: 'dedupe_key is not null' },
  { table: 'messages', name: 'messages_conversation', columns: 'conversation_id, created_at, id' },
  { table: 'chat_reads', name: 'chat_reads_user', columns: 'user_id' },
  { table: 'events', name: 'events_seq', columns: 'seq', unique: true },
  { table: 'events', name: 'events_target', columns: 'target_type, target_id, seq' },
  { table: 'events', name: 'events_story', columns: 'correlation_id' },
  { table: 'events', name: 'events_project', columns: 'project_id, seq' },
  { table: 'events', name: 'events_undoes', columns: 'undoes' },
  { table: 'events', name: 'events_created_at', columns: 'created_at' },
  { table: 'events', name: 'events_project_created', columns: 'project_id, created_at' },
  { table: 'events', name: 'events_target_id', columns: 'target_id' },
];

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** The server tables of 20261004000101_server_tables.sql, 20261004000600_usage_signals.sql and the agent approvals. */
const SERVER_SQL: readonly string[] = [
  'create table counters (prefix text primary key, n integer not null check (n >= 0))',
  'create table office_meta (id integer primary key check (id = 1), version integer not null default 0, office_seq integer not null default 0)',
  'create table office_snapshot (part integer primary key, version integer not null, body text not null)',
  'create table person_seq (user_id text primary key, seq integer not null default 0)',
  `create table stories (id text primary key, actor_id text not null, created_at text not null default (${NOW}))`,
  `create table idempotency (actor_id text not null, key text not null, name text not null, digest text not null, result text not null, created_at text not null default (${NOW}), primary key (actor_id, key))`,
  `create table outbox (id integer primary key, kind text not null, payload text not null, attempts integer not null default 0, claimed_until text, done_at text, error text, created_at text not null default (${NOW}))`,
  `create table upload_intents (id text primary key, actor_id text not null, project_id text, staging_key text not null, key text not null, thumb_key text, size integer not null check (size >= 0), mime_type text not null, expires_at text not null, used_at text, created_at text not null default (${NOW}))`,
  `create table agent_links (client_id text primary key, owner_user_id text not null, agent_user_id text not null, client_name text not null, redirect_host text not null, approved_at text not null default (${NOW}), last_used_at text, revoked_at text)`,
  `create table agent_approvals (client_id text not null, owner_user_id text not null, approved_at text not null default (${NOW}), primary key (client_id, owner_user_id))`,
  `create table mail_log (id integer primary key, utc_day text not null, kind text not null, user_id text, ref text not null, resend_id text, created_at text not null default (${NOW}), unique (utc_day, ref))`,
  `create table mail_outbox (id integer primary key, to_email text not null, tag text not null, idempotency_key text not null unique, mail text not null, created_at text not null default (${NOW}))`,
  'create table usage_month (month text primary key, calls integer not null default 0, bytes_read integer not null default 0, backup_bytes integer, signals_failed integer not null default 0, signals_failed_at text)',
  `create table usage_warnings (month text not null, metric text not null, sent_at text not null default (${NOW}), primary key (month, metric))`,
  'create table rate_limits (key text not null, window_start text not null, count integer not null default 0, primary key (key, window_start))',
  `create table job_runs (key text primary key, done_at text not null default (${NOW}))`,
  'create table schema_version (id integer primary key check (id = 1), version integer not null)',
];

export const SERVER_INDEXES: readonly LiteIndex[] = [
  { table: 'stories', name: 'stories_created', columns: 'created_at' },
  { table: 'idempotency', name: 'idempotency_created', columns: 'created_at' },
  { table: 'outbox', name: 'outbox_open', columns: 'created_at', where: 'done_at is null' },
  { table: 'upload_intents', name: 'upload_intents_open', columns: 'expires_at', where: 'used_at is null' },
  { table: 'agent_links', name: 'agent_links_owner', columns: 'owner_user_id' },
  { table: 'agent_links', name: 'agent_links_agent', columns: 'agent_user_id' },
];

/** The index that a read with atOrAfter names (indexed by), so no other index decides its plan (wave 0: 124,339 rows). */
export const TIME_INDEX: Readonly<Record<string, string>> = { events: 'events_created_at' };

/** The triggers that keep the History append-only. The harness drops them for the test's own edits, then makes them again. */
export const EVENT_GUARDS = ['events_no_update', 'events_no_delete'] as const;

export function eventGuardsSql(): string[] {
  return [
    "create trigger events_no_update before update on events begin select raise(abort, 'events only grow'); end",
    "create trigger events_no_delete before delete on events begin select raise(abort, 'events only grow'); end",
  ];
}

/** The settings of a new office, as the first Postgres migration seeds them (20261004000100_core.sql, line 290). */
export const DEFAULT_SETTINGS = {
  defaultStages: ['Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits', 'Tender', 'Supervision'],
  codePrefix: 'KH',
  workloadLimit: 10,
  staleAfterDays: 30,
} as const;

function entitySql(spec: TableSpec): string {
  const columns = ['id text primary key', 'doc text not null', ...keyColumnsOf(spec).map((name) => `${name} ${sqlTypeOf(spec, name)}`)];
  return `create table ${spec.table} (${columns.join(', ')})`;
}

function indexSql(index: LiteIndex): string {
  return `create ${index.unique ? 'unique ' : ''}index ${index.name} on ${index.table} (${index.columns})${index.where ? ` where ${index.where}` : ''}`;
}

/** The columns of a table that one of its read indexes holds: a long in-list on one of them reads key by key (Task 10). */
export function indexedColumnsOf(table: string): ReadonlySet<string> {
  return new Set(LITE_INDEXES.filter((index) => index.table === table).flatMap((index) => index.columns.split(',').map((name) => name.trim())));
}

export function liteSchemaSql(): string[] {
  return [
    ...TABLES.map(entitySql),
    ...SERVER_SQL,
    ...LITE_INDEXES.map(indexSql),
    ...SERVER_INDEXES.map(indexSql),
    ...eventGuardsSql(),
    'insert into office_meta (id, version, office_seq) values (1, 0, 0)',
    `insert into settings (id, doc) values ('office', '${JSON.stringify(DEFAULT_SETTINGS)}')`,
    `insert into schema_version (id, version) values (1, ${LITE_SCHEMA_VERSION})`,
  ];
}

/** The version row of an office, or undefined for a new office with no tables. One row read: sqlite_master has no index. */
function versionOf(host: SqlHost): number | undefined {
  try {
    const [row] = host.exec('select version from schema_version where id = 1', []).rows;
    return row === undefined ? undefined : Number(row.version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table')) return undefined;
    throw error;
  }
}

/** Makes the schema of a new office, or checks the version of an office that has one (each wake of the office object). */
export async function applyLiteSchema(host: SqlHost): Promise<{ applied: boolean }> {
  const version = versionOf(host);
  if (version === LITE_SCHEMA_VERSION) return { applied: false };
  if (version !== undefined) {
    throw new Error(`The SQLite schema of this office is version ${version}, and this build knows version ${LITE_SCHEMA_VERSION}. Add a schema step first (server/data/lite/schema.ts).`);
  }
  await host.transaction(async () => {
    for (const text of liteSchemaSql()) host.exec(text, []);
  });
  return { applied: true };
}
```

- [ ] **Step 6: Write the test office helper**

```ts
import { DatabaseSync } from 'node:sqlite';
import { liteDb, type LiteDb } from './db';
import { nodeHost } from './host';
import { applyLiteSchema } from './schema';

/** A new in-memory office with the SQLite schema, for the tests of the SQLite path. log gets the text of each later statement. */
export async function freshLite(): Promise<{ raw: DatabaseSync; db: LiteDb; log: string[] }> {
  const raw = new DatabaseSync(':memory:');
  const log: string[] = [];
  const host = nodeHost(raw, { log });
  await applyLiteSchema(host);
  log.length = 0;
  return { raw, db: liteDb(host), log };
}
```

- [ ] **Step 7: Run the test, then pin the schema text**

Run: `npx vitest run --project server server/data/lite/schema.test.ts`
Expected: 8 tests PASS and "pins the schema text to its version" FAILS with the real `sha256` in the diff. Copy that hex value
into `PINNED_SHA256`, then run the file again.
Expected: PASS (9 tests).

- [ ] **Step 8: Commit**

```bash
git add server/data/loaders/query.ts server/data/lite/columns.ts server/data/lite/schema.ts server/data/lite/testDb.ts server/data/lite/schema.test.ts
git commit -m "Exit wave 1: one SQLite schema with a version, from tables.ts and the loader columns"
```

---

### Task 7: The office snapshot and the office lists in the object memory

**Files:**
- Create: `server/data/lite/office.ts`
- Test: `server/data/lite/office.test.ts`

**Interfaces:**
- Consumes: `onCommit`, `wroteIn`, `liteDbOf`, `LiteDb` (Task 5); `freshLite` (Task 6); `snapshotOf` (`server/data/officeCache.ts`);
  `OFFICE_COLLECTIONS`, `OfficeCollection`, `OfficeSnapshot` (`server/core/types.ts`); `tableOf`, `collectionOf` (`tables.ts`).
- Produces: `type OfficeLists = Pick<State, OfficeCollection>`; `SNAPSHOT_PART = 600_000`; `partsOf(body: string, size?: number): string[]`;
  `writeOfficeSnapshot(q: Query, lists: OfficeLists, version: number): Promise<void>`;
  `readLiteOffice(db: LiteDb, q: Query): Promise<OfficeSnapshot>`.

- [ ] **Step 1: Write the test that fails**

```ts
import { describe, expect, it } from 'vitest';
import { emptyState } from '../../../src/api/store';
import { liteDb } from './db';
import { nodeHost } from './host';
import { partsOf, readLiteOffice, writeOfficeSnapshot, type OfficeLists } from './office';
import { DEFAULT_SETTINGS } from './schema';
import { freshLite } from './testDb';

const user = (id: string, nameAr = 'هالة') => ({ id, name: `Person ${id}`, nameAr, kind: 'human', active: true });

function listsWith(users: Record<string, unknown>): OfficeLists {
  return { ...emptyState(''), settings: DEFAULT_SETTINGS, users } as unknown as OfficeLists;
}

/** Writes one user row and the snapshot of that office at a new version, as a save does. */
async function writeOffice(db: Awaited<ReturnType<typeof freshLite>>['db'], users: Record<string, ReturnType<typeof user>>) {
  await db.tx('write', async (q) => {
    for (const rec of Object.values(users)) await q('insert into users (id, doc) values (?, ?) on conflict (id) do update set doc = excluded.doc', [rec.id, rec]);
    const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
    await writeOfficeSnapshot(q, listsWith(users), meta.version);
  });
}

describe('the office lists of a SQLite office (server/data/lite/office.ts)', () => {
  it('reads the office from the tables on a cold start with no snapshot', async () => {
    const { db } = await freshLite();
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.version).toBe(0);
    expect(office.lists.settings).toEqual(DEFAULT_SETTINGS);
    expect(office.lists.users).toEqual({});
  });

  it('keeps the office in memory: the next read sends only the version statement', async () => {
    const { db, log } = await freshLite();
    const first = await db.tx('read', (q) => readLiteOffice(db, q));
    log.length = 0;
    const second = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(second).toBe(first);
    expect(log).toEqual(['select version from office_meta where id = 1']);
  });

  it('reads the snapshot rows after a wake, and no office table', async () => {
    const { raw, db } = await freshLite();
    await writeOffice(db, { usr_001: user('usr_001') });
    const log: string[] = [];
    const woken = liteDb(nodeHost(raw, { log }));
    const office = await woken.tx('read', (q) => readLiteOffice(woken, q));
    expect(office.lists.users).toEqual({ usr_001: user('usr_001') });
    expect(log).toEqual(['select version from office_meta where id = 1', 'select version, body from office_snapshot order by part']);
  });

  it('loads the tables when the snapshot is older than office_meta (an office write outside the save)', async () => {
    const { raw, db } = await freshLite();
    await writeOffice(db, { usr_001: user('usr_001') });
    raw.exec(`insert into users (id, doc) values ('usr_002', '${JSON.stringify(user('usr_002'))}')`);
    raw.exec('update office_meta set version = version + 1');
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(Object.keys(office.lists.users)).toEqual(['usr_001', 'usr_002']);
  });

  it('splits a large office into parts under the row limit and reads it back equal', async () => {
    const { raw, db } = await freshLite();
    const users = Object.fromEntries(Array.from({ length: 900 }, (_, i) => {
      const id = `usr_${String(i + 1).padStart(3, '0')}`;
      return [id, user(id, `${'ش'.repeat(1_200)}😀`)];
    }));
    await writeOffice(db, users);
    const parts = raw.prepare('select count(*) as n, max(length(cast(body as blob))) as bytes from office_snapshot').get() as { n: number; bytes: number };
    expect(parts.n).toBeGreaterThan(1);
    expect(parts.bytes).toBeLessThan(2_000_000);
    const woken = liteDb(nodeHost(raw));
    expect((await woken.tx('read', (q) => readLiteOffice(woken, q))).lists.users).toEqual(users);
  });

  it('never cuts a surrogate pair between two parts', () => {
    expect(partsOf('ab😀cd', 3)).toEqual(['ab', '😀c', 'd']);
  });

  it('puts a snapshot into memory only after the commit: a rollback keeps the office of the database', async () => {
    const { db } = await freshLite();
    await expect(db.tx('write', async (q) => {
      await writeOfficeSnapshot(q, listsWith({ usr_009: user('usr_009') }), 5);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.version).toBe(0);
    expect(office.lists.users).toEqual({});
  });

  it('keeps nothing in memory from a read inside a transaction that wrote', async () => {
    const { db, log } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into users (id, doc) values (?, ?)', ['usr_001', user('usr_001')]);
      await readLiteOffice(db, q);
      throw new Error('stop');
    }).catch(() => undefined);
    log.length = 0;
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.lists.users).toEqual({});
    expect(log).toContain('select version, body from office_snapshot order by part');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/office.test.ts`
Expected: FAIL with "Failed to resolve import "./office"".

- [ ] **Step 3: Write the office module**

```ts
import type { State } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { OFFICE_COLLECTIONS, type OfficeCollection, type OfficeSnapshot } from '../../core/types';
import { snapshotOf } from '../officeCache';
import { collectionOf, tableOf } from '../tables';
import { liteDbOf, onCommit, wroteIn, type LiteDb } from './db';

/**
 * The office lists of a SQLite office (Supabase exit, wave 1). The office object is the one writer, so the lists live in its
 * memory and follow each commit: no chg column, no office_deletes, no xmin test. A wake reads the snapshot rows (one row for an
 * office of today's size) in place of every office table (1,459 rows on one year of data, wave 0).
 *
 * The rule for every write of an office table (the save, the harness write-down, later the import and the sign-in link): in the
 * same transaction it raises office_meta.version and calls writeOfficeSnapshot with the whole office lists after the write.
 */

export type OfficeLists = Pick<State, OfficeCollection>;

/**
 * At most this many UTF-16 units in one snapshot row. A unit is at most 3 bytes of UTF-8, so a row stays under the 2 MB limit of
 * the office object.
 */
export const SNAPSHOT_PART = 600_000;

const MEMORY = new WeakMap<LiteDb, OfficeSnapshot>();

/** The parts of a text, each at most size units long, and no part ends inside a surrogate pair. */
export function partsOf(body: string, size = SNAPSHOT_PART): string[] {
  const parts: string[] = [];
  let at = 0;
  while (at < body.length) {
    let end = Math.min(at + size, body.length);
    const last = body.charCodeAt(end - 1);
    if (end < body.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(body.slice(at, end));
    at = end;
  }
  return parts;
}

function listsOf(lists: OfficeLists): OfficeLists {
  return Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, lists[c]])) as unknown as OfficeLists;
}

/** Writes the snapshot of the office lists at a version, inside the transaction of q, and puts it into memory after the commit. */
export async function writeOfficeSnapshot(q: Query, lists: OfficeLists, version: number): Promise<void> {
  const office = listsOf(lists);
  const parts = partsOf(JSON.stringify(office));
  await q('delete from office_snapshot where part >= ?', [parts.length]);
  for (const [part, body] of parts.entries()) {
    await q('insert into office_snapshot (part, version, body) values (?, ?, ?) on conflict (part) do update set version = excluded.version, body = excluded.body', [part, version, body]);
  }
  const db = liteDbOf(q);
  onCommit(q, () => MEMORY.set(db, snapshotOf(office, version)));
}

async function listsFromTables(q: Query): Promise<OfficeLists> {
  const lists: Record<string, unknown> = {};
  for (const c of OFFICE_COLLECTIONS) {
    const spec = tableOf(c);
    const rows = await q<{ ord: number; doc: Record<string, unknown> }>(`select rowid as ord, doc from ${spec.table}`);
    rows.sort((a, b) => a.ord - b.ord);
    lists[c] = collectionOf(spec, rows.map((row) => row.doc));
  }
  return lists as unknown as OfficeLists;
}

/**
 * The office lists at the office_meta version: from memory, else from the snapshot rows, else from every office table (no
 * snapshot yet, or an old one). A read inside a transaction that wrote keeps nothing in memory: it may still roll back.
 */
export async function readLiteOffice(db: LiteDb, q: Query): Promise<OfficeSnapshot> {
  const [meta] = await q<{ version: number }>('select version from office_meta where id = 1');
  const version = Number(meta.version);
  const held = MEMORY.get(db);
  if (held && held.version === version) return held;
  const parts = await q<{ version: number; body: string }>('select version, body from office_snapshot order by part');
  const current = parts.length > 0 && parts.every((part) => Number(part.version) === version);
  const lists = current ? (JSON.parse(parts.map((part) => part.body).join('')) as OfficeLists) : await listsFromTables(q);
  const snapshot = snapshotOf(lists, version);
  if (!wroteIn(q)) MEMORY.set(db, snapshot);
  return snapshot;
}
```

Note: `order by part` on the integer primary key is the table order of `office_snapshot` (its rowid), so it adds no sort step.

- [ ] **Step 4: Run the test**

Run: `npx vitest run --project server server/data/lite/office.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/data/lite/office.ts server/data/lite/office.test.ts
git commit -m "Exit wave 1: the office snapshot rows, and the office lists in the object memory after each commit"
```

---

### Task 8: The save step and the whole office on SQLite

**Files:**
- Create: `server/data/lite/save.ts`, `server/data/lite/whole.ts`
- Test: `server/data/lite/save.test.ts`

**Interfaces:**
- Consumes: `diffState`, `writeDiff`, `Diff`, `TableChange`, `SaveOptions`, `SaveResult` (`server/data/save.ts`); `rowOf`, `Row`,
  `pairEventFields` (`server/data/rows.ts`); `TABLES`, `TableSpec`, `rowsOf`, `collectionOf` (`tables.ts`); `keyColumnsOf`,
  `keyValuesOf` (Task 6); `writeOfficeSnapshot` (Task 7); `freshLite` (Task 6).
- Produces: `insertRow(q: Query, spec: TableSpec, row: Row, state: State, onConflict: 'fail' | 'update'): Promise<void>`;
  `liteWriteDiff(q: Query, diff: Diff, before: State, after: State, o?: SaveOptions): Promise<SaveResult>`;
  `liteSave(q: Query, before: State, after: State, o?: SaveOptions): Promise<SaveResult>`;
  `liteWriteState(q: Query, state: State): Promise<SaveResult>`;
  `liteLoadWhole(q: Query, o?: { withEvents?: boolean; today?: string }): Promise<State>`.

- [ ] **Step 1: Write the test that fails**

```ts
import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { TABLES } from '../tables';
import { liteSave } from './save';
import { freshLite } from './testDb';
import { liteLoadWhole, liteWriteState } from './whole';

const TODAY = '2026-10-04';
const seedOf = () => buildSeed(TODAY, async () => undefined);

async function officeWithSeed() {
  const lite = await freshLite();
  const seed = await seedOf();
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  lite.log.length = 0;
  return { ...lite, seed };
}

describe('the save step on SQLite (server/data/lite/save.ts)', () => {
  it('writes the sample office and reads it back the same, in the same order', async () => {
    const { db, seed } = await officeWithSeed();
    const back = await db.tx('read', (q) => liteLoadWhole(q, { today: seed.seededOn }));
    for (const spec of TABLES) {
      const want = spec.collection === 'settings' ? seed.settings : (seed[spec.collection] ?? {});
      expect(back[spec.collection], spec.table).toEqual(want);
      if (spec.collection !== 'settings') expect(Object.keys(back[spec.collection] ?? {}), spec.table).toEqual(Object.keys(want as object));
    }
    expect(back.counters).toEqual(seed.counters);
  });

  it('sets doc and only the key columns that changed', async () => {
    const { db, seed, log } = await officeWithSeed();
    const task = Object.values(seed.tasks).find((t) => t.projectId !== null && t.status !== 'done')!;
    const write = async (change: Partial<typeof task>) => {
      const before = await db.tx('read', (q) => liteLoadWhole(q));
      const after = structuredClone(before) as State;
      after.tasks[task.id] = { ...after.tasks[task.id], ...change };
      log.length = 0;
      await db.tx('write', (q) => liteSave(q, before, after, { signals: false }));
      return log.filter((text) => text.startsWith('update tasks'));
    };
    expect(await write({ rank: 7 })).toEqual(['update tasks set doc = ? where id = ?']);
    expect(await write({ title: `${task.title} (B)` })).toEqual(['update tasks set doc = ?, search_text = ? where id = ?']);
    expect(await write({ status: task.status === 'todo' ? 'in_progress' : 'todo' })).toEqual(['update tasks set doc = ?, status = ? where id = ?']);
  });

  it('inserts new rows in State order, so they come last in insertion order', async () => {
    const { db, seed } = await officeWithSeed();
    const base = Object.values(seed.tasks)[0];
    const after = structuredClone(seed);
    after.tasks.tsk_901 = { ...base, id: 'tsk_901' };
    after.tasks.tsk_900 = { ...base, id: 'tsk_900' };
    await db.tx('write', (q) => liteSave(q, seed, after, { signals: false }));
    const back = await db.tx('read', (q) => liteLoadWhole(q));
    expect(Object.keys(back.tasks).slice(-2)).toEqual(['tsk_901', 'tsk_900']);
  });

  it('writes the office snapshot in the save of an office change, and none in the save of a task', async () => {
    const { db, seed, log } = await officeWithSeed();
    const project = Object.values(seed.projects)[0];
    const renamed = structuredClone(seed);
    renamed.projects[project.id] = { ...project, name: `${project.name} (B)` };
    const saved = await db.tx('write', (q) => liteSave(q, seed, renamed, { signals: false }));
    expect(saved.officeVersion).toBeGreaterThan(0);
    expect(log.some((text) => text.startsWith('insert into office_snapshot'))).toBe(true);
    log.length = 0;
    const task = Object.values(renamed.tasks)[0];
    const moved = structuredClone(renamed);
    moved.tasks[task.id] = { ...task, rank: 3 };
    await db.tx('write', (q) => liteSave(q, renamed, moved, { signals: false }));
    expect(log.some((text) => text.includes('office_snapshot'))).toBe(false);
  });

  it('fills the project of a comment whose target the call did not load', async () => {
    const { db, seed } = await officeWithSeed();
    const task = Object.values(seed.tasks).find((t) => t.projectId !== null)!;
    const base = Object.values(seed.comments).find((c) => c.targetType === 'task')!;
    const before = structuredClone(seed);
    delete before.tasks[task.id];
    const after = structuredClone(before);
    after.comments.cmt_900 = { ...base, id: 'cmt_900', targetId: task.id };
    await db.tx('write', (q) => liteSave(q, before, after, { signals: false }));
    expect(await db.statement('read', "select project_id from comments where id = 'cmt_900'")).toEqual([{ project_id: task.projectId }]);
  });

  it('gives the numbers and signals of writeDiff: a new office version, office_seq and a person number', async () => {
    const { db, seed } = await officeWithSeed();
    const project = Object.values(seed.projects)[0];
    const after = structuredClone(seed);
    after.projects[project.id] = { ...project, name: `${project.name} (C)` };
    const saved = await db.tx('write', (q) => liteSave(q, seed, after, { story: { storyId: 'sty_test', actorId: 'usr_001' } }));
    expect(saved.changed).toBe(true);
    expect(saved.signals.find((signal) => signal.channel === 'office')?.seq).toBe(1);
    const [meta] = await db.statement<{ version: number; office_seq: number }>('read', 'select version, office_seq from office_meta');
    expect(meta).toEqual({ version: saved.officeVersion, office_seq: 1 });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/save.test.ts`
Expected: FAIL with "Failed to resolve import "./save"".

- [ ] **Step 3: Write the save step**

```ts
import type { State } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { rowOf, type Row } from '../rows';
import { diffState, writeDiff, type Diff, type SaveOptions, type SaveResult, type TableChange } from '../save';
import { rowsOf, type TableSpec } from '../tables';
import { keyColumnsOf, keyValuesOf } from './columns';
import { writeOfficeSnapshot } from './office';

/**
 * The save step on SQLite (Supabase exit, wave 1). writeDiff of save.ts stays the one source of the numbers and the signals: it
 * runs on numbersQuery, which answers its three number statements in SQLite and leaves its Postgres table writes to this file
 * (as memoryData does). Then this file writes the rows of the Diff: deletes, inserts, and updates that set doc and only the key
 * columns that changed (wave 0: an indexed column in SET costs one row written, also with the same value).
 */

/** The statements of writeDiff that this file writes itself in SQLite form, so numbersQuery answers them with no row. */
const TABLE_WRITES = [/^delete from [a-z_]+ where id = any/, /^insert into office_deletes /, /^insert into counters /, /^insert into [a-z_]+ \(id, doc/, /^set constraints all immediate$/];

function numbersQuery(q: Query): Query {
  return (async <R,>(text: string, values: unknown[] = []): Promise<R[]> => {
    if (text.startsWith('update office_meta')) {
      return q<R>('update office_meta set version = version + ?, office_seq = office_seq + ? where id = 1 returning version, office_seq', [values[0], values[1]]);
    }
    if (text.startsWith('insert into person_seq')) {
      const out: R[] = [];
      for (const userId of values[0] as string[]) {
        out.push(...(await q<R>('insert into person_seq (user_id, seq) values (?, 1) on conflict (user_id) do update set seq = person_seq.seq + 1 returning user_id, seq', [userId])));
      }
      return out;
    }
    if (text.startsWith("select 'task' as type")) {
      const [taskIds, updateIds] = values as [string[], string[]];
      const out: R[] = [];
      for (const id of taskIds) out.push(...(await q<R>("select 'task' as type, id, project_id from tasks where id = ?", [id])));
      for (const id of updateIds) out.push(...(await q<R>("select 'update' as type, id, project_id from updates where id = ?", [id])));
      return out;
    }
    if (TABLE_WRITES.some((form) => form.test(text))) return [];
    throw new Error(`The SQLite save has no form for this statement of writeDiff: ${text.slice(0, 60)}`);
  }) as Query;
}

/** One row with its key columns. onConflict 'update' replaces the doc and every key column of a row that is there already. */
export async function insertRow(q: Query, spec: TableSpec, row: Row, state: State, onConflict: 'fail' | 'update'): Promise<void> {
  const columns = keyColumnsOf(spec);
  const values = keyValuesOf(spec, row, state);
  const names = ['id', 'doc', ...columns];
  const set = ['doc = excluded.doc', ...columns.map((name) => `${name} = excluded.${name}`)].join(', ');
  const tail = onConflict === 'update' ? ` on conflict (id) do update set ${set}` : '';
  await q(`insert into ${spec.table} (${names.join(', ')}) values (${names.map(() => '?').join(', ')})${tail}`, [row.id, JSON.stringify(row.doc), ...columns.map((name) => values[name])]);
}

async function writeTable(q: Query, change: TableChange, before: State, after: State): Promise<void> {
  const { spec } = change;
  for (const id of change.deleted) await q(`delete from ${spec.table} where id = ?`, [id]);
  const old = new Map(rowsOf(before, spec).filter((row) => row.doc !== undefined).map((row) => [row.id, row.doc]));
  const inserted = new Set(change.inserted);
  for (const row of change.upserts) {
    const was = old.get(row.id);
    if (inserted.has(row.id) || was === undefined) {
      // A row the call did not load may still be in the table: an upsert keeps its rowid. An event only grows: a second insert fails.
      await insertRow(q, spec, row, after, spec.collection === 'events' ? 'fail' : 'update');
      continue;
    }
    const now = keyValuesOf(spec, row, after);
    const then = keyValuesOf(spec, rowOf(spec, was, before), before);
    const changed = keyColumnsOf(spec).filter((name) => then[name] !== now[name]);
    const set = ['doc = ?', ...changed.map((name) => `${name} = ?`)].join(', ');
    await q(`update ${spec.table} set ${set} where id = ?`, [JSON.stringify(row.doc), ...changed.map((name) => now[name]), row.id]);
  }
}

export async function liteWriteDiff(q: Query, diff: Diff, before: State, after: State, o: SaveOptions = {}): Promise<SaveResult> {
  const result = await writeDiff(numbersQuery(q), diff, o);
  if (!result.changed) return result;
  for (const change of diff.tables) await writeTable(q, change, before, after);
  for (const [prefix, n] of Object.entries(diff.counters)) {
    await q('insert into counters (prefix, n) values (?, ?) on conflict (prefix) do update set n = excluded.n', [prefix, n]);
  }
  if (diff.officeRows) await writeOfficeSnapshot(q, after, result.officeVersion as number);
  return result;
}

export async function liteSave(q: Query, before: State, after: State, o: SaveOptions = {}): Promise<SaveResult> {
  return liteWriteDiff(q, diffState(before, after), before, after, o);
}
```

- [ ] **Step 4: Write the whole office module**

```ts
import { emptyState, type State } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { pairEventFields } from '../rows';
import { diffState, type SaveResult } from '../save';
import { TABLES, collectionOf } from '../tables';
import { liteWriteDiff } from './save';

/**
 * The whole office in and out of a SQLite office (Supabase exit, wave 1): the test:lite harness, the year office of
 * test:office, and later the import and the restore check. A call never uses these: runCall loads only what its loader names.
 */

/** A State with no record at all, not even the settings, so every record of the State to write is new. */
function blank(): State {
  return { ...emptyState(''), settings: undefined as unknown as State['settings'] };
}

/** Writes every record of a State, as new rows in insertion order. The settings row of the schema is updated. No signal. */
export async function liteWriteState(q: Query, state: State): Promise<SaveResult> {
  const empty = blank();
  return liteWriteDiff(q, diffState(empty, state), empty, state, { signals: false });
}

/** Reads every table into one State, in insertion order, with undoneBy filled from the undo events. */
export async function liteLoadWhole(q: Query, o: { withEvents?: boolean; today?: string } = {}): Promise<State> {
  const withEvents = o.withEvents ?? true;
  const state = { ...emptyState(o.today ?? ''), feedback: {} } as State;
  const lists = state as unknown as Record<string, unknown>;
  for (const spec of TABLES) {
    if (spec.collection === 'events' && !withEvents) continue;
    const rows = await q<{ ord: number; doc: Record<string, unknown> }>(`select rowid as ord, doc from ${spec.table}`);
    rows.sort((a, b) => a.ord - b.ord);
    lists[spec.collection] = collectionOf(spec, rows.map((row) => row.doc));
  }
  for (const event of Object.values(state.events)) {
    pairEventFields(event as unknown as Record<string, unknown>);
    if (event.undoes && state.events[event.undoes]) state.events[event.undoes].undoneBy = event.id;
  }
  const counters = await q<{ prefix: string; n: number }>('select prefix, n from counters');
  state.counters = Object.fromEntries(counters.map((row) => [row.prefix, Number(row.n)]));
  return state;
}
```

- [ ] **Step 5: Run the test and the types**

Run: `npx vitest run --project server server/data/lite/save.test.ts && npm run typecheck`
Expected: PASS (6 tests), and no type error. If "writes the sample office and reads it back the same" fails on `feedback`, compare
with `seed.feedback ?? {}`: `loadWhole` of Postgres gives `feedback: {}` the same way.

- [ ] **Step 6: Commit**

```bash
git add server/data/lite/save.ts server/data/lite/whole.ts server/data/lite/save.test.ts
git commit -m "Exit wave 1: the save step on SQLite, which sets only the key columns that changed"
```

---
### Task 9: The conditions of a read in SQLite form

**Files:**
- Create: `server/data/lite/compile.ts`
- Test: `server/data/lite/compile.test.ts`

**Interfaces:**
- Consumes: `Cond`, `Select`, `CountSelect`, `Bound`, `columnOf`, `fieldName` (`query.ts`); `memorySource` (the reference form);
  `freshLite` (Task 6); `liteWriteState` (Task 8).
- Produces: `LIST_BOUND_MAX = 20`; `fieldText(path: string): string`;
  `listSql(expr: string, list: readonly unknown[], values: unknown[], negate?: boolean): string`;
  `boundTerms(bound: Bound, values: unknown[]): string`;
  `whereOf(s: Select | CountSelect, values: unknown[], skip?: readonly Cond[]): string`;
  `type InList = { col: string; in: readonly string[] }`;
  `drivingListOf(s: Select | CountSelect, indexed: ReadonlySet<string>): InList | undefined`;
  `pathMatch(path: string, id: string, values: unknown[]): string`.

- [ ] **Step 1: Write the test that fails**

```ts
import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../../src/api/store';
import { memorySource } from '../loaders/memorySource';
import type { Select } from '../loaders/query';
import { tableOf } from '../tables';
import { LIST_BOUND_MAX, whereOf } from './compile';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

function world(): State {
  const s = emptyState('2026-10-17');
  const tasks = [
    { id: 'tsk_001', projectId: 'prj_001', ownerId: 'usr_001', status: 'todo', title: 'تصميم الواجهة', helperIds: ['usr_002'], flagged: true, points: 3, after: { status: 'in_review' } },
    { id: 'tsk_002', projectId: null, ownerId: 'usr_002', status: 'done', title: 'Office errand', helperIds: [], flagged: false, points: 1.5, after: ['x'] },
    { id: 'tsk_003', projectId: 'prj_002', ownerId: null, status: 'in_review', title: 'Roof plan', helperIds: 'usr_002' },
  ];
  for (const t of tasks) (s.tasks as Record<string, unknown>)[t.id] = t;
  const events = [
    { id: 'evt_001', seq: 1, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.created', createdAt: '2026-10-16T05:59:59.999Z' },
    { id: 'evt_002', seq: 2, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.updated', createdAt: '2026-10-16T09:00:00.000+03:00' },
    { id: 'evt_003', seq: 3, targetType: 'task', targetId: 'tsk_003', projectId: 'prj_002', verb: 'undo', undoes: 'evt_002', createdAt: '2026-10-16T06:00:00.001Z' },
  ];
  for (const e of events) (s.events as Record<string, unknown>)[e.id] = e;
  return s;
}

async function idsBoth(s: Select): Promise<{ lite: string[]; memory: string[] }> {
  const state = world();
  const { db } = await freshLite();
  await db.tx('write', (q) => liteWriteState(q, state));
  const values: unknown[] = [];
  const where = whereOf(s, values);
  const spec = tableOf(s.c);
  const lite = (await db.statement<{ id: string }>('read', `select t.id from ${spec.table} t where ${where} order by t.rowid`, values)).map((row) => row.id);
  const memory = (await memorySource(state).select(s)).map((row) => spec.key(row.doc));
  return { lite, memory };
}

const CASES: [string, Select][] = [
  ['a boolean field', { c: 'tasks', where: [{ field: 'flagged', in: ['true'] }] }],
  ['a false boolean field', { c: 'tasks', where: [{ field: 'flagged', in: ['false'] }] }],
  ['a number field', { c: 'tasks', where: [{ field: 'points', in: ['3', '1.5'] }] }],
  ['a key of an object field, not of a list', { c: 'tasks', where: [{ field: 'after', key: 'status', in: ['in_review'] }] }],
  ['a field that is JSON null or absent', { c: 'tasks', where: [{ field: 'flagged', null: true }] }],
  ['a field not in a list', { c: 'tasks', where: [{ field: 'flagged', notIn: ['true'] }] }],
  ['a column not in a list, with null', { c: 'tasks', where: [{ col: 'owner_id', notIn: ['usr_001'] }] }],
  ['a list field that holds a value, and a text field that does not count', { c: 'tasks', where: [{ has: 'helperIds', value: 'usr_002' }] }],
  ['a column that is null', { c: 'tasks', where: [{ col: 'project_id', eq: null }] }],
  ['search text', { c: 'tasks', where: [{ col: 'search_text', contains: 'roof' }] }],
  ['an or of two conditions', { c: 'tasks', where: [{ or: [{ col: 'status', in: ['done'] }, { has: 'helperIds', value: 'usr_002' }] }] }],
  ['a time at or after, with offsets and milliseconds', { c: 'events', where: [{ col: 'created_at', atOrAfter: '2026-10-16T09:00:00.000+03:00' }] }],
  ['a stamp and id before a pair', { c: 'events', where: [{ before: { at: '2026-10-16T09:00:00.000+03:00', id: 'evt_003' } }] }],
  ['an int column in a list of texts', { c: 'events', where: [{ col: 'seq', in: ['2', '3'] }] }],
  ['events that no undo names', { c: 'events', where: [{ notUndone: true }] }],
];

describe('the conditions of a read on SQLite (server/data/lite/compile.ts)', () => {
  for (const [name, s] of CASES) {
    it(`gives the rows of the memory form: ${name}`, async () => {
      const { lite, memory } = await idsBoth(s);
      expect(lite).toEqual(memory);
    });
  }

  it('sends = for one value, bound values for a short list, and one JSON value for a long list', () => {
    const one: unknown[] = [];
    expect(whereOf({ c: 'tasks', where: [{ col: 'status', in: ['todo'] }] }, one)).toBe('t.status = ?');
    expect(one).toEqual(['todo']);
    const short: unknown[] = [];
    expect(whereOf({ c: 'tasks', where: [{ col: 'status', in: ['todo', 'done'] }] }, short)).toBe('t.status in (?, ?)');
    const long: unknown[] = [];
    const list = Array.from({ length: LIST_BOUND_MAX + 5 }, (_, i) => `tsk_${i}`);
    expect(whereOf({ c: 'tasks', where: [{ col: 'id', in: list }] }, long)).toBe('t.id in (select value from json_each(?))');
    expect(long).toEqual([JSON.stringify(list)]);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/compile.test.ts`
Expected: FAIL with "Failed to resolve import "./compile"".

- [ ] **Step 3: Write the compiler of conditions**

```ts
import { columnOf, fieldName, type Bound, type Cond, type CountSelect, type Select } from '../loaders/query';

/**
 * The conditions of a loader read in SQLite form (Supabase exit, wave 1). Each kind keeps the rule of the memory form
 * (memorySource.ts, holds), which the loader tests use. Values go as ? values in text order; names come only from COLUMNS and
 * fieldName. Text order is byte order (BINARY), the code point order of collate "C" and of the memory form.
 */

/** Up to this many values go as bound values in one list; a longer list goes as one JSON value, so a statement stays under 100. */
export const LIST_BOUND_MAX = 20;
const HOUR = 3_600_000;

/** A doc field as text, as the memory form gives it (fieldText): 'true', 'false', '3', '1.5', JSON text for an object or a list. */
export function fieldText(path: string): string {
  const value = `json_extract(t.doc, '${path}')`;
  return `(case json_type(t.doc, '${path}') when 'true' then 'true' when 'false' then 'false' when 'integer' then cast(${value} as text) when 'real' then cast(${value} as text) else ${value} end)`;
}

/** expr in the list: = for one value, bound values for a short list, json_each for a long one. An empty list matches nothing. */
export function listSql(expr: string, list: readonly unknown[], values: unknown[], negate = false): string {
  if (list.length === 0) return negate ? '1' : '0';
  if (list.length === 1) {
    values.push(list[0]);
    return `${expr} ${negate ? '<>' : '='} ?`;
  }
  const op = negate ? 'not in' : 'in';
  if (list.length <= LIST_BOUND_MAX) {
    values.push(...list);
    return `${expr} ${op} (${list.map(() => '?').join(', ')})`;
  }
  values.push(JSON.stringify(list));
  return `${expr} ${op} (select value from json_each(?))`;
}

/** The terms of one bound on a row t: created_at after gt, at or after ge, and (created_at, id) after the pair of after. */
export function boundTerms(bound: Bound, values: unknown[]): string {
  values.push(bound.gt);
  let sql = 't.created_at > ?';
  if (bound.ge !== undefined) {
    values.push(bound.ge);
    sql += ' and t.created_at >= ?';
  }
  if (bound.after) {
    values.push(bound.after.at, bound.after.at, bound.after.id);
    sql += ' and (t.created_at > ? or (t.created_at = ? and t.id > ?))';
  }
  return sql;
}

export function whereOf(s: Select | CountSelect, values: unknown[], skip: readonly Cond[] = []): string {
  const col = (name: string) => {
    columnOf(s.c, name);
    return `t.${name}`;
  };
  function cond(one: Cond): string {
    if ('or' in one) return `(${one.or.map(cond).join(' or ')})`;
    if ('notUndone' in one) {
      if (s.c !== 'events') throw new Error('notUndone is for events only.');
      return 'not exists (select 1 from events u where u.undoes = t.id)';
    }
    if ('has' in one) {
      const path = `$.${fieldName(one.has)}`;
      values.push(one.value);
      return `(json_type(t.doc, '${path}') = 'array' and exists (select 1 from json_each(t.doc, '${path}') h where h.value = ?))`;
    }
    if ('before' in one) {
      values.push(one.before.at, one.before.at, one.before.id);
      return '(t.created_at < ? or (t.created_at = ? and t.id < ?))';
    }
    if ('bounds' in one) {
      const column = col(one.bounds.col);
      const terms = Object.entries(one.bounds.by).map(([key, bound]) => {
        values.push(key);
        return `(${column} = ? and ${boundTerms(bound, values)})`;
      });
      return terms.length === 0 ? '0' : `(${terms.join(' or ')})`;
    }
    if ('key' in one) return listSql(fieldText(`$.${fieldName(one.field)}.${fieldName(one.key)}`), one.in, values);
    if ('field' in one) {
      const path = `$.${fieldName(one.field)}`;
      if ('null' in one) return `(json_type(t.doc, '${path}') is null or json_type(t.doc, '${path}') = 'null')`;
      const text = fieldText(path);
      if ('notIn' in one) return `(${text} is null or ${listSql(text, one.notIn, values, true)})`;
      return listSql(text, one.in, values);
    }
    const column = col(one.col);
    const type = columnOf(s.c, one.col).type;
    const typed = (list: readonly string[]) => (type === 'int' ? list.map(Number) : list);
    if ('in' in one) return listSql(column, typed(one.in), values);
    if ('notIn' in one) return `(${column} is null or ${listSql(column, typed(one.notIn), values, true)})`;
    if ('eq' in one) {
      if (one.eq === null) return `${column} is null`;
      values.push(typeof one.eq === 'boolean' ? (one.eq ? 1 : 0) : type === 'int' ? Number(one.eq) : one.eq);
      return `${column} = ?`;
    }
    if ('contains' in one) {
      values.push(one.contains);
      return `instr(${column}, ?) > 0`;
    }
    // atOrAfter: the time test (julianday keeps the milliseconds and reads every offset, Task 1), plus the text bound of
    // sqlSource.ts (the UTC text of the time minus 36 hours), so the created_at index serves the read and no row is lost.
    values.push(one.atOrAfter);
    const time = `julianday(${column}) >= julianday(?)`;
    const back = new Date(Date.parse(one.atOrAfter) - 36 * HOUR);
    if (Number.isNaN(back.getTime())) return time;
    values.push(back.toISOString().slice(0, 19));
    return `(${time} and ${column} >= ?)`;
  }
  const conds = s.where.filter((one) => !skip.includes(one)).map(cond);
  return conds.length > 0 ? conds.join(' and ') : '1';
}

export type InList = { col: string; in: readonly string[] };

/**
 * The list that a read takes key by key: the first top-level in-list with more than one value on id or on a column of a read
 * index. One = statement for each key reads about one row a key; a list of bound values reads two, json_each three (wave 0).
 */
export function drivingListOf(s: Select | CountSelect, indexed: ReadonlySet<string>): InList | undefined {
  return s.where.find((one): one is InList => 'col' in one && 'in' in one && one.in.length > 1 && (one.col === 'id' || indexed.has(one.col)));
}

/**
 * The test that a doc holds id at a reference path (REFERENCE_FIELDS, src/api/references.ts), with the rules of valuesAt: a list
 * step reads only a JSON list, a * step reads the values of an object or a list, and a missing or null step gives no value.
 * Every JSON function reads t.doc with a full path (the fullkey of json_each): a json_each value can be plain text that is not
 * JSON (a string in a list), and json_extract of that text fails with "malformed JSON".
 */
export function pathMatch(path: string, id: string, values: unknown[]): string {
  const joins: string[] = [];
  const guards: string[] = [];
  let base = '';
  let tail = '';
  const where = () => (base === '' ? `'$${tail}'` : tail === '' ? base : `${base} || '${tail}'`);
  path.split('.').forEach((part, i) => {
    const list = part.endsWith('[]');
    const name = list ? part.slice(0, -2) : part;
    if (name === '*') {
      guards.push(`json_type(t.doc, ${where()}) in ('object', 'array')`);
      joins.push(`json_each(t.doc, ${where()}) s${i}`);
      base = `s${i}.fullkey`;
      tail = '';
    } else {
      tail += `.${fieldName(name)}`;
    }
    if (list) {
      guards.push(`json_type(t.doc, ${where()}) = 'array'`);
      joins.push(`json_each(t.doc, ${where()}) l${i}`);
      base = `l${i}.fullkey`;
      tail = '';
    }
  });
  values.push(id);
  const test = `json_extract(t.doc, ${where()}) = ?`;
  return joins.length === 0 ? test : `exists (select 1 from ${joins.join(', ')} where ${[...guards, test].join(' and ')})`;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --project server server/data/lite/compile.test.ts`
Expected: PASS (16 tests). A case that fails names its condition; fix the SQL form of that kind, never the memory form.

- [ ] **Step 5: Commit**

```bash
git add server/data/lite/compile.ts server/data/lite/compile.test.ts
git commit -m "Exit wave 1: the conditions of a loader read in SQLite form, with the rules of the memory form"
```

---

### Task 10: The Source on SQLite

**Files:**
- Create: `server/data/lite/source.ts`
- Test: `server/data/lite/source.test.ts`

**Interfaces:**
- Consumes: `Source` (`server/data/loaders/source.ts`); `Select`, `CountSelect`, `Row`, `Cond`, `columnOf`, `columnOfField`,
  `matchesNothing` (`query.ts`); `whereOf`, `boundTerms`, `drivingListOf`, `pathMatch`, `InList` (Task 9); `indexedColumnsOf`,
  `TIME_INDEX` (Task 6); `keyColumnsOf` (Task 6); `tableOf` (`tables.ts`).
- Produces: `liteSource(q: Query): Source`; `THREADS_LITE: string`.

- [ ] **Step 1: Write the test that fails**

```ts
import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../../src/api/store';
import { memorySource } from '../loaders/memorySource';
import type { Select } from '../loaders/query';
import { liteSource } from './source';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const at = (minute: number) => `2026-10-16T09:${String(minute).padStart(2, '0')}:00.000+03:00`;

function office(): State {
  const s = emptyState('2026-10-17');
  const put = (c: keyof State, rec: Record<string, unknown>) => {
    ((s[c] ??= {} as never) as Record<string, unknown>)[rec.id as string] = rec;
  };
  for (let i = 1; i <= 150; i++) put('tasks', { id: `tsk_${String(i).padStart(3, '0')}`, projectId: `prj_${String((i % 3) + 1).padStart(3, '0')}`, ownerId: 'usr_001', status: 'todo', title: `Task ${i}`, helperIds: [] });
  // prj_001 has two newest posts of one stamp (a tie at the cut of limit 1); prj_002 has one newest post.
  const postMinutes = [1, 2, 4, 4, 5, 6];
  for (let i = 1; i <= 6; i++) put('updates', { id: `upd_00${i}`, projectId: i <= 4 ? 'prj_001' : 'prj_002', authorId: 'usr_001', body: 'Notes', fileIds: [], createdAt: at(postMinutes[i - 1]) });
  for (let i = 1; i <= 4; i++) put('comments', { id: `cmt_00${i}`, targetType: 'task', targetId: 'tsk_001', authorId: i === 2 ? 'usr_002' : 'usr_003', body: 'Hi', createdAt: at(i), reactions: { ok: ['usr_009'] } });
  for (let i = 1; i <= 5; i++) put('events', { id: `evt_00${i}`, seq: i, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.updated', createdAt: at(i * 10) });
  put('files', { id: 'fil_001', projectId: 'prj_001', taskId: null, name: 'Plan', versions: [{ openedBy: 'usr_004' }, 'loose'] });
  return s;
}

async function both() {
  const state = office();
  const { db, log } = await freshLite();
  await db.tx('write', (q) => liteWriteState(q, state));
  log.length = 0;
  const read = <T,>(work: (s: ReturnType<typeof liteSource>) => Promise<T>) => db.tx('read', (q) => work(liteSource(q)));
  return { state, db, log, read, memory: memorySource(state) };
}

describe('the Source on SQLite (server/data/lite/source.ts)', () => {
  it('reads a list with no limit and gives its rows in insertion order, with no sort in SQL', async () => {
    const { read, memory, log } = await both();
    const s: Select = { c: 'tasks', where: [{ col: 'project_id', in: ['prj_002'] }] };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    expect(log.some((text) => /order by/.test(text))).toBe(false);
  });

  it('reads each key of a long in-list with one = statement, never more than 100 values', async () => {
    const { read, memory, log } = await both();
    const ids = Array.from({ length: 150 }, (_, i) => `tsk_${String(i + 1).padStart(3, '0')}`);
    const s: Select = { c: 'tasks', where: [{ col: 'id', in: ids }] };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    expect(log.filter((text) => text.includes('where t.id = ?'))).toHaveLength(150);
  });

  it('keeps the cut order of a per read in SQL, with order by and limit for each key', async () => {
    const { read, memory, log } = await both();
    const s: Select = { c: 'events', where: [{ col: 'project_id', in: ['prj_001'] }], order: { col: 'seq', desc: true }, per: 'project_id', limit: 2 };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    expect(log.some((text) => text.endsWith('order by t.seq desc, t.rowid desc limit ?'))).toBe(true);
  });

  it('keeps every row that ties at the cut', async () => {
    const { read, memory } = await both();
    const s: Select = { c: 'updates', where: [{ col: 'project_id', in: ['prj_001', 'prj_002'] }], order: { col: 'created_at', desc: true }, per: 'project_id', limit: 1, ties: true };
    const rows = await read((src) => src.select(s));
    expect(rows).toEqual(await memory.select(s));
    expect(rows.map((row) => row.doc.id)).toEqual(['upd_003', 'upd_004', 'upd_006']);
  });

  it('reads events since a time on the created_at index, and cuts them in JavaScript', async () => {
    const { read, memory, log } = await both();
    const s: Select = { c: 'events', where: [{ col: 'created_at', atOrAfter: at(20) }], order: { col: 'seq', desc: true }, limit: 2 };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    const sent = log.find((text) => text.includes('from events t'))!;
    expect(sent).toContain('indexed by events_created_at');
    expect(sent).not.toContain('limit');
  });

  it('takes only the picked fields, and leaves an absent field absent', async () => {
    const { read, memory } = await both();
    const s: Select = { c: 'tasks', where: [{ col: 'id', in: ['tsk_001'] }], pick: ['id', 'title', 'nothingHere'] };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
  });

  it('counts each value with one statement and leaves out the values with no row', async () => {
    const { read, memory } = await both();
    expect(await read((src) => src.count('comments', 'target_id', ['tsk_001', 'tsk_404']))).toEqual(await memory.count('comments', 'target_id', ['tsk_001', 'tsk_404']));
  });

  it('counts the rows after each bound of a bounds condition, the authors left out', async () => {
    const { read, memory } = await both();
    const s = { c: 'comments' as const, per: 'target_id', where: [{ col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by: { tsk_001: { gt: at(1), after: { at: at(2), id: 'cmt_002' } }, tsk_404: { gt: '' } } } }, { field: 'authorId', notIn: ['usr_002'] }] };
    expect(await read((src) => src.countWhere(s))).toEqual(await memory.countWhere(s));
  });

  it('finds the first row that holds an id at each kind of reference path', async () => {
    const { read, memory } = await both();
    const cases: [Parameters<ReturnType<typeof liteSource>['referencing']>[0], string, string][] = [
      ['tasks', 'ownerId', 'usr_001'], ['comments', 'reactions.*[]', 'usr_009'], ['files', 'versions[].openedBy', 'usr_004'], ['tasks', 'helperIds[]', 'usr_404'],
    ];
    for (const [c, path, id] of cases) expect(await read((src) => src.referencing(c, path, id, null)), path).toEqual(await memory.referencing(c, path, id, null));
  });

  it('gives the newest threads, newest first, with the ties at the cut', async () => {
    const { read, memory } = await both();
    const o = { owner: 'usr_001', led: ['prj_001'], me: ['usr_001'], limit: 100, admin: false };
    expect(await read((src) => src.threads(o))).toEqual(await memory.threads(o));
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/source.test.ts`
Expected: FAIL with "Failed to resolve import "./source"".

- [ ] **Step 3: Write the Source**

```ts
import { emptyState } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { columnOf, columnOfField, matchesNothing, type Cond, type CountSelect, type Row, type Select } from '../loaders/query';
import type { Source } from '../loaders/source';
import { tableOf } from '../tables';
import { keyColumnsOf } from './columns';
import { boundTerms, drivingListOf, pathMatch, whereOf, type InList } from './compile';
import { indexedColumnsOf, TIME_INDEX } from './schema';

/**
 * The Source on SQLite (Supabase exit, wave 1). It gives the rows of sqlSource and memorySource with the wave 0 rules:
 * - no outer sort in SQL: the rows come back sorted by ord (the rowid) in JavaScript, as Load sorts them anyway;
 * - a cut order (the rows that pass a limit) stays in SQL with order by and limit, on an index that gives that order;
 * - a read with atOrAfter names its time index (indexed by) and cuts in JavaScript, so no other index decides its plan;
 * - a long in-list on an indexed column reads key by key with one = statement each, so no statement takes over 100 values;
 * - a pick takes its fields in JavaScript after the parse.
 */

type Rec = Record<string, unknown>;
type DocRow = { ord: number; doc: Rec };
type Bounds = Extract<Cond, { bounds: unknown }>;

const EMPTY = emptyState('');
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rowsOf = (rows: Rec[]): DocRow[] => rows.map((row) => ({ ord: Number(row.ord), doc: row.doc as Rec }));

/** The task threads of a person (Source.threads): every candidate thread, cut and sorted in JavaScript as memorySource does. */
export const THREADS_LITE = `with mine as (select distinct target_id from comments where target_type = 'task' and json_extract(doc, '$.authorId') in (select value from json_each(?3))),
cand as (select k.id from tasks k
  where (k.owner_id = ?1 or k.project_id in (select value from json_each(?2)) or k.id in (select target_id from mine)
      or (k.project_id is null and json_extract(k.doc, '$.createdBy') in (select value from json_each(?3))))
    and (k.project_id is not null or ?4 or k.owner_id = ?1
      or (json_type(k.doc, '$.helperIds') = 'array' and exists (select 1 from json_each(k.doc, '$.helperIds') h where h.value = ?1))
      or json_extract(k.doc, '$.createdBy') in (select value from json_each(?3)))),
threads as (
  select c.target_id as id, max(c.created_at) as last,
         max(case when json_extract(c.doc, '$.authorId') in (select value from json_each(?3)) then c.created_at end) as mine
  from comments c where c.target_type = 'task' and c.target_id in (select id from cand)
  group by c.target_id)
select id, last, mine from threads`;

function orderOf(s: Select): string {
  if (!s.order) return 't.rowid';
  const terms = [`t.${s.order.col} desc`];
  if (s.order.id) terms.push('t.id desc');
  else if (!s.ties) terms.push('t.rowid desc');
  return terms.join(', ');
}

/** The cut of memorySource.select (lines 93 to 125) over the candidate rows of one group: the rank of equal runs with ties. */
function cut(rows: DocRow[], s: Select): DocRow[] {
  const spec = tableOf(s.c);
  const order = s.order;
  const valueOf = (row: DocRow) => (order ? columnOf(s.c, order.col).value(row.doc, EMPTY, spec) : null);
  const compare = (a: DocRow, b: DocRow): number => {
    if (!order) return a.ord - b.ord;
    const x = valueOf(a);
    const y = valueOf(b);
    const byCol = typeof x === 'number' && typeof y === 'number' ? y - x : textOrder(String(y ?? ''), String(x ?? ''));
    if (byCol !== 0) return byCol;
    if (order.id) return textOrder(spec.key(b.doc), spec.key(a.doc));
    return s.ties ? 0 : b.ord - a.ord;
  };
  const sorted = [...rows].sort(compare);
  const kept: DocRow[] = [];
  let rank = 0;
  for (const [index, row] of sorted.entries()) {
    if (index === 0 || !s.ties || compare(sorted[index - 1], row) !== 0) rank = index;
    if (rank >= (s.limit as number)) break;
    kept.push(row);
  }
  return kept;
}

function finish(rows: DocRow[], s: Select): Row[] {
  rows.sort((a, b) => a.ord - b.ord);
  if (!s.pick) return rows;
  const pick = s.pick;
  return rows.map((row) => ({ ord: row.ord, doc: Object.fromEntries(pick.filter((key) => key in row.doc).map((key) => [key, row.doc[key]])) }));
}

export function liteSource(q: Query): Source {
  async function rowsWhere(s: Select, where: readonly Cond[], tail = ''): Promise<DocRow[]> {
    const table = tableOf(s.c).table;
    const index = s.where.some((one) => 'atOrAfter' in one) ? TIME_INDEX[table] : undefined;
    const values: unknown[] = [];
    const sql = whereOf({ ...s, where }, values);
    return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${table} t${index ? ` indexed by ${index}` : ''} where ${sql}${tail}`, values));
  }

  /** Every candidate row, key by key on the driving list when there is one. */
  async function every(s: Select): Promise<DocRow[]> {
    const drive = drivingListOf(s, indexedColumnsOf(tableOf(s.c).table));
    if (!drive) return rowsWhere(s, s.where);
    const out: DocRow[] = [];
    for (const key of new Set(drive.in)) out.push(...(await rowsWhere(s, [{ col: drive.col, in: [key] }, ...s.where.filter((one) => one !== drive)])));
    return out;
  }

  /** The first rows in the cut order, in SQL. With ties: every row at or after the order value of the last row of the limit. */
  async function limited(s: Select, where: readonly Cond[]): Promise<DocRow[]> {
    const order = orderOf(s);
    if (!s.ties || !s.order) {
      const table = tableOf(s.c).table;
      const values: unknown[] = [];
      const sql = whereOf({ ...s, where }, values);
      values.push(s.limit);
      return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${table} t where ${sql} order by ${order} limit ?`, values));
    }
    if (s.order.id || columnOf(s.c, s.order.col).type !== 'text') throw new Error('A read with ties needs a text order column and no id term.');
    const table = tableOf(s.c).table;
    const outer: unknown[] = [];
    const sql = whereOf({ ...s, where }, outer);
    const inner: unknown[] = [];
    whereOf({ ...s, where }, inner);
    const col = `t.${s.order.col}`;
    const edge = `coalesce((select ${col} from ${table} t where ${sql} order by ${order} limit 1 offset ?), '')`;
    return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${table} t where ${sql} and ${col} >= ${edge}`, [...outer, ...inner, (s.limit as number) - 1]));
  }

  return {
    async select(s) {
      if (matchesNothing(s)) return [];
      if (s.limit === undefined) return finish(await every(s), s);
      const timed = s.where.some((one) => 'atOrAfter' in one);
      if (s.per) {
        const perList = s.where.find((one): one is InList => 'col' in one && one.col === s.per && 'in' in one);
        if (!perList) throw new Error(`A read with per needs an in-list on ${s.per}: every loader read has one.`);
        const rest = s.where.filter((one) => one !== perList);
        const out: DocRow[] = [];
        for (const key of new Set(perList.in)) {
          const where = [{ col: s.per, in: [key] }, ...rest];
          out.push(...(timed ? cut(await rowsWhere(s, where), s) : await limited(s, where)));
        }
        return finish(out, s);
      }
      return finish(timed ? cut(await every(s), s) : await limited(s, s.where), s);
    },

    async count(c, column, values) {
      const spec = tableOf(c);
      if (!keyColumnsOf(spec).includes(column)) throw new Error(`The SQLite table ${spec.table} has no key column ${column}.`);
      const out = new Map<string, number>();
      for (const value of new Set(values)) {
        const [row] = await q<{ n: number }>(`select count(*) as n from ${spec.table} where ${column} = ?`, [value]);
        if (Number(row.n) > 0) out.set(value, Number(row.n));
      }
      return out;
    },

    async countWhere(s: CountSelect) {
      if (matchesNothing(s)) return new Map();
      const table = tableOf(s.c).table;
      columnOf(s.c, s.per);
      const out = new Map<string, number>();
      const bounds = s.where.find((one): one is Bounds => 'bounds' in one && one.bounds.col === s.per);
      if (bounds) {
        for (const [key, bound] of Object.entries(bounds.bounds.by)) {
          const values: unknown[] = [key];
          const terms = boundTerms(bound, values);
          const rest = whereOf({ ...s, where: s.where.filter((one) => one !== bounds) }, values);
          const [row] = await q<{ n: number }>(`select count(*) as n from ${table} t where t.${s.per} = ? and ${terms} and ${rest}`, values);
          if (Number(row.n) > 0) out.set(key, Number(row.n));
        }
        return out;
      }
      const values: unknown[] = [];
      const rows = await q<{ v: string | null; n: number }>(`select t.${s.per} as v, count(*) as n from ${table} t where ${whereOf(s, values)} group by t.${s.per}`, values);
      for (const row of rows) if (row.v !== null) out.set(String(row.v), Number(row.n));
      return out;
    },

    async undoLinks(eventIds) {
      const out = new Map<string, string>();
      for (const id of new Set(eventIds)) {
        for (const row of await q<{ id: string; undoes: string }>('select id, undoes from events where undoes = ?', [id])) out.set(row.undoes, row.id);
      }
      return out;
    },

    async referencing(c, path, id, except) {
      const spec = tableOf(c);
      const column = /^[a-zA-Z]+$/.test(path) ? columnOfField(c, path) : undefined;
      const values: unknown[] = [];
      let match: string;
      if (column && keyColumnsOf(spec).includes(column)) {
        values.push(id);
        match = `t.${column} = ?`;
      } else {
        match = pathMatch(path, id, values);
      }
      values.push(except);
      // order by rowid limit 1: the first match in insertion order. The rowid order is the table order, so it adds no sort.
      return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${spec.table} t where ${match} and t.id is not ? order by t.rowid limit 1`, values));
    },

    async threads(o) {
      const found = await q<{ id: string; last: string; mine: string | null }>(THREADS_LITE, [o.owner, JSON.stringify(o.led), JSON.stringify(o.me), o.admin ? 1 : 0]);
      found.sort((a, b) => textOrder(b.last, a.last) || textOrder(b.id, a.id));
      const edge = found[o.limit - 1]?.last;
      return edge === undefined ? found : found.filter((thread) => thread.last >= edge);
    },

    async counters() {
      const rows = await q<{ prefix: string; n: number }>('select prefix, n from counters');
      return Object.fromEntries(rows.map((row) => [row.prefix, Number(row.n)]));
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --project server server/data/lite/source.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add server/data/lite/source.ts server/data/lite/source.test.ts
git commit -m "Exit wave 1: the Source on SQLite, with sorts in JavaScript and key by key reads of long lists"
```

---

### Task 11: Every loader read on SQLite gives the rows of the memory form, with no sort step in a cut

This is `server/it/loaders.it.test.ts` on node:sqlite, so it runs in `npm test` with no Docker. It also pins the plan of each cut:
a statement with `order by` and `limit` never sorts in a temporary b-tree.

**Files:**
- Test: `server/data/lite/source.sweep.test.ts`

**Interfaces:**
- Consumes: `readSweep`, `writeSweep`, `trapOffice` (`server/data/loaders/sweep.ts`); `runBoth` (`compare.ts`); `memorySource`;
  `liteSource` (Task 10); `freshLite` (Task 6); `liteWriteState` (Task 8); `buildSeed`.
- Produces: nothing for later tasks. It is the parity gate of the compiler.

- [ ] **Step 1: Write the test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { runBoth } from '../loaders/compare';
import { memorySource } from '../loaders/memorySource';
import type { Source } from '../loaders/source';
import { readSweep, trapOffice, writeSweep } from '../loaders/sweep';
import type { LiteDb } from './db';
import { liteSource } from './source';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');

type Request = { method: keyof Source; args: unknown[] };

/** A source that writes down every read it answers (as in server/it/loaders.it.test.ts). */
function recording(inner: Source, log: Request[]): Source {
  const wrap = <K extends keyof Source>(method: K) => (async (...args: unknown[]) => {
    log.push({ method, args: structuredClone(args) });
    return (inner[method] as (...a: unknown[]) => Promise<unknown>)(...args);
  }) as Source[K];
  return { select: wrap('select'), count: wrap('count'), countWhere: wrap('countWhere'), undoLinks: wrap('undoLinks'), referencing: wrap('referencing'), threads: wrap('threads'), counters: wrap('counters') };
}

/** One answer in a form that both sources share: docs in order, with undoneBy null; a Map as a sorted object. */
function comparable(method: keyof Source, answer: unknown): unknown {
  if (method === 'select' || method === 'referencing') {
    return (answer as { doc: Record<string, unknown> }[]).map((row) => ('undoneBy' in row.doc ? { ...row.doc, undoneBy: null } : row.doc));
  }
  if (answer instanceof Map) return Object.fromEntries([...answer.entries()].sort());
  return answer;
}

describe('every loader read on SQLite (the sweep of server/it/loaders.it.test.ts on node:sqlite)', () => {
  let office: State;
  let db: LiteDb;
  let log: string[];

  beforeAll(async () => {
    office = trapOffice(await buildSeed(TODAY, async () => undefined));
    const lite = await freshLite();
    db = lite.db;
    log = lite.log;
    await db.tx('write', (q) => liteWriteState(q, office));
  }, 60_000);

  it('answers every read of the loaders with the rows of the memory form', async () => {
    const requests: Request[] = [];
    const source = recording(memorySource(office), requests);
    for (const [name, input, actor, prepared] of [...readSweep(office), ...writeSweep(office)]) {
      await runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_lite', prepared, source });
    }
    const unique = [...new Map(requests.map((request) => [JSON.stringify(request), request])).values()];
    expect(unique.length).toBeGreaterThan(300);
    const memory = memorySource(office);
    for (const request of unique) {
      const call = (s: Source) => (s[request.method] as (...a: unknown[]) => Promise<unknown>)(...structuredClone(request.args));
      const lite = await db.tx('read', (q) => call(liteSource(q)));
      expect(comparable(request.method, lite), JSON.stringify(request)).toEqual(comparable(request.method, await call(memory)));
    }
  }, 120_000);

  it('gives every call of the sweep the same answer from SQLite as from the whole office', async () => {
    for (const [name, input, actor, prepared] of [...readSweep(office), ...writeSweep(office)]) {
      const { whole, scoped } = await db.tx('read', (q) => runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_lite', prepared, source: liteSource(q) }));
      expect(scoped, `${name} ${JSON.stringify(input)} as ${actor}`).toEqual(whole);
    }
  }, 120_000);

  it('never sorts in a temporary b-tree for a cut order', async () => {
    log.length = 0;
    for (const [name, input, actor, prepared] of readSweep(office)) {
      await db.tx('read', (q) => runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_lite', prepared, source: liteSource(q) }));
    }
    const cuts = [...new Set(log.filter((text) => /order by .* limit \?$/.test(text) && !text.includes('order by t.rowid')))];
    expect(cuts.length).toBeGreaterThan(5);
    const sorts = cuts.filter((text) => {
      const plan = db.host.exec(`explain query plan ${text}`, Array.from({ length: (text.match(/\?/g) ?? []).length }, () => null)).rows;
      return plan.some((row) => String(row.detail).includes('TEMP B-TREE'));
    });
    expect(sorts).toEqual([]);
  }, 120_000);
});
```

Note: `explain query plan` with null values gives the plan of the statement; the plan does not depend on the values.

- [ ] **Step 2: Run the test**

Run: `npx vitest run --project server server/data/lite/source.sweep.test.ts --testTimeout=120000`
Expected: PASS (3 tests). A difference names the request; reproduce it as a new case in `source.test.ts` or `compile.test.ts`
first, then fix `compile.ts` or `source.ts`. A cut that sorts names its text: change the index in `LITE_INDEXES` (Task 6) or the
order terms in `orderOf`, never the loader.

- [ ] **Step 3: Commit**

```bash
git add server/data/lite/source.sweep.test.ts
git commit -m "Exit wave 1: every loader read on node:sqlite gives the rows of the memory form, with no sort in a cut"
```

---
### Task 12: The call stores on SQLite, and `liteData` for `createRunCall`

**Files:**
- Modify: `server/core/lock.ts:26-32` (`takeOfficeLock`), `server/core/story.ts:19-49` (texts, `statementStories`, `sqlStories`),
  `server/core/idempotency.ts:15-38` (texts, `sqlKeys`), `server/core/effects.ts:73-129` (texts, `writeOutbox`, `processOutbox`),
  `server/calls/story.ts:11` (`story.start`)
- Create: `server/data/lite/callData.ts`
- Test: `server/data/lite/callData.test.ts`, `server/data/lite/outbox.test.ts`

**Interfaces:**
- Consumes: `sqlFor`, `isLite` (Task 3); `readLiteOffice` (Task 7); `liteSave` (Task 8); `liteSource` (Task 10); `LiteDb` (Task 5);
  `CallData`, `createRunCall` (`server/core/runCall.ts:57-111`); `fakeDeps` (`server/test/fakes/deps.ts`); `everyCall`.
- Produces: `STORY_INSERT_LITE`, `STORY_SELECT_LITE`, `KEY_SELECT_LITE`, `KEY_INSERT_LITE`, `OUTBOX_ROW_LITE`, `CLAIM_LITE`,
  `DONE_LITE`, `FAIL_LITE`, `WAIT_LITE` (exported strings); `statementStories(db: Pick<Db, 'statement' | 'dialect'>)`;
  `liteData(deps: Deps): CallData`.

- [ ] **Step 1: Write the tests that fail**

`server/data/lite/callData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { everyCall } from '../../core/everyCall';
import { createRunCall } from '../../core/runCall';
import type { BatchScope, RunRequest } from '../../core/types';
import { fakeDeps } from '../../test/fakes/deps';
import { liteData } from './callData';
import { freshLite } from './testDb';
import { liteLoadWhole, liteWriteState } from './whole';

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
const batchOf = (): BatchScope => ({ storyRefs: new Map(), overviewCalls: 0 });

async function office() {
  const lite = await freshLite();
  const seed = await buildSeed(TODAY, async () => undefined);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: liteData });
  const call = (name: string, input: unknown, actorId: string, extra: Partial<RunRequest> = {}) =>
    run(deps, { principal: { userId: actorId }, name, input, batch: batchOf(), ...extra });
  const count = async (table: string) => Number((await lite.db.statement<{ n: number }>('read', `select count(*) as n from ${table}`))[0].n);
  return { ...lite, seed, deps, call, count };
}

const entryOf = (seed: State, name: string) => everyCall(seed).find((c) => c.name === name)!;

describe('runCall on SQLite (server/data/lite/callData.ts)', () => {
  it('runs a write and saves its change, its story and its events', async () => {
    const { call, seed, db, count } = await office();
    const c = entryOf(seed, 'tasks.update');
    expect((await call(c.name, c.input, c.actorId)).ok).toBe(true);
    const back = await db.tx('read', (q) => liteLoadWhole(q));
    expect(Object.keys(back.events).length).toBeGreaterThan(Object.keys(seed.events).length);
    expect(await count('stories')).toBe(1);
  });

  it('gives the stored answer to a retry with the same key, and writes nothing more', async () => {
    const { call, seed, count } = await office();
    const c = entryOf(seed, 'tasks.update');
    const first = await call(c.name, c.input, c.actorId, { key: 'key_001' });
    const events = await count('events');
    const second = await call(c.name, c.input, c.actorId, { key: 'key_001' });
    expect(second.ok && second.output).toEqual(first.ok && first.output);
    expect(await count('events')).toBe(events);
    expect(await count('idempotency')).toBe(1);
  });

  it('rolls back a write that the handler refuses: no story, no event', async () => {
    const { call, seed, count } = await office();
    const c = entryOf(seed, 'tasks.take');
    const events = await count('events');
    const result = await call(c.name, c.input, c.actorId);
    expect(result.ok ? 'ok' : result.error.code).toBe('invalid_input');
    expect(await count('stories')).toBe(0);
    expect(await count('events')).toBe(events);
  });

  it('keeps the office of the batch after a read, and drops it after a write that changed an office list', async () => {
    const { call, seed } = await office();
    const batch = batchOf();
    const read = entryOf(seed, 'projects.list');
    await call(read.name, read.input, read.actorId, { batch });
    expect(batch.office).toBeDefined();
    const write = entryOf(seed, 'projects.update');
    expect((await call(write.name, write.input, write.actorId, { batch })).ok).toBe(true);
    expect(batch.office).toBeUndefined();
  });

  it('runs story.start, a server call, on the SQLite stories table', async () => {
    const { call, count } = await office();
    const result = await call('story.start', {}, 'usr_001');
    expect(result.ok && (result.output as { storyId: string }).storyId).toMatch(/^sty_[a-z2-7]{22}$/);
    expect(await count('stories')).toBe(1);
  });
});
```

`server/data/lite/outbox.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { processOutbox, registerEffect, writeOutbox } from '../../core/effects';
import { fakeDeps } from '../../test/fakes/deps';
import { freshLite } from './testDb';

const NOW = new Date('2026-10-04T06:00:00Z');
const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length > 0) removers.pop()!();
});

describe('the outbox on SQLite (server/core/effects.ts)', () => {
  it('writes the rows of a call in order, then claims and marks each one done, failed or waiting', async () => {
    const { db } = await freshLite();
    const deps = fakeDeps({ db });
    deps.clock.set(NOW);
    const retryAt = new Date('2026-10-05T00:00:00Z');
    removers.push(registerEffect('lite.ok', async () => undefined));
    removers.push(registerEffect('lite.fail', async () => {
      throw new Error('no');
    }));
    removers.push(registerEffect('lite.wait', async () => {
      throw Object.assign(new Error('full'), { retryAt });
    }));
    const ids = await db.tx('write', (q) => writeOutbox(q, [{ kind: 'lite.ok', payload: { a: 1 } }, { kind: 'lite.fail', payload: {} }, { kind: 'lite.wait', payload: {} }]));
    expect(ids).toEqual(['1', '2', '3']);
    expect(await processOutbox(deps, ids)).toEqual({ done: ['1'], failed: ['2', '3'] });
    expect(await db.statement('read', 'select id, done_at, error, attempts, claimed_until from outbox order by id')).toEqual([
      { id: 1, done_at: NOW.toISOString(), error: null, attempts: 1, claimed_until: new Date(NOW.getTime() + 120_000).toISOString() },
      { id: 2, done_at: null, error: 'no', attempts: 1, claimed_until: new Date(NOW.getTime() + 120_000).toISOString() },
      { id: 3, done_at: null, error: 'full', attempts: 0, claimed_until: retryAt.toISOString() },
    ]);
    expect(await processOutbox(deps, ['1'])).toEqual({ done: [], failed: [] });
  });
});
```

The `order by id` in the test statement is a test read, not a product read.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/data/lite/callData.test.ts server/data/lite/outbox.test.ts`
Expected: FAIL: "Failed to resolve import "./callData"", and the outbox test fails with "The SQLite host refuses a Postgres
placeholder ($1)".

- [ ] **Step 3: Make the lock, the stories, the keys and the outbox pick their SQLite form**

In `server/core/lock.ts`, add `import { isLite } from '../data/dialect';` and make the first line of `takeOfficeLock`:

```ts
  // The office object runs one transaction at a time, and its Db refuses a second one (server/data/lite/db.ts): no lock there.
  if (isLite(q)) return;
```

In `server/core/story.ts`, add `import { sqlFor } from '../data/dialect';`, add after `STORY_SELECT_SQL`:

```ts
export const STORY_INSERT_LITE = 'insert into stories (id, actor_id, created_at) values (?1, ?2, ?3)';
export const STORY_SELECT_LITE = 'select actor_id, created_at from stories where id = ?1';
```

and change `statementStories` and `sqlStories` to:

```ts
export function statementStories(db: Pick<Db, 'statement' | 'dialect'>): Pick<StoryStore, 'get'> {
  return {
    async get(id) {
      const [row] = await db.statement<{ actor_id: string; created_at: Date | string }>('read', sqlFor(db, STORY_SELECT_SQL, STORY_SELECT_LITE), [id]);
      return row ? { actorId: row.actor_id, createdAt: new Date(row.created_at) } : undefined;
    },
  };
}

export function sqlStories(q: Query): StoryStore {
  return {
    async insert(id, actorId, at) {
      await q(sqlFor(q, STORY_INSERT_SQL, STORY_INSERT_LITE), [id, actorId, at.toISOString()]);
    },
    async get(id) {
      const [row] = await q<{ actor_id: string; created_at: Date | string }>(sqlFor(q, STORY_SELECT_SQL, STORY_SELECT_LITE), [id]);
      return row ? { actorId: row.actor_id, createdAt: new Date(row.created_at) } : undefined;
    },
  };
}
```

In `server/calls/story.ts`, import `STORY_INSERT_LITE` and `sqlFor`, and send
`sqlFor(ctx.deps.db, STORY_INSERT_SQL, STORY_INSERT_LITE)` in place of `STORY_INSERT_SQL`.

In `server/core/idempotency.ts`, add `import { sqlFor } from '../data/dialect';`, add after `KEY_INSERT_SQL`:

```ts
export const KEY_SELECT_LITE = 'select name, digest, result from idempotency where actor_id = ?1 and key = ?2';
export const KEY_INSERT_LITE = 'insert into idempotency (actor_id, key, name, digest, result, created_at) values (?1, ?2, ?3, ?4, ?5, ?6)';
```

and send `sqlFor(q, KEY_SELECT_SQL, KEY_SELECT_LITE)` and `sqlFor(q, KEY_INSERT_SQL, KEY_INSERT_LITE)` in `sqlKeys`. The SQLite Db
gives `result` back as a value (it is in `JSON_COLUMNS`), as pg does.

In `server/core/effects.ts`, add `import { isLite } from '../data/dialect';`, add after `WAIT_SQL`:

```ts
/** The SQLite forms (Supabase exit, wave 1). The time comes from deps.clock, as every SQLite time column holds ISO text in UTC. */
export const OUTBOX_ROW_LITE = 'insert into outbox (kind, payload) values (?1, ?2) returning id';
export const CLAIM_LITE =
  'update outbox set claimed_until = ?2, attempts = attempts + 1 where id = ?1 and done_at is null and (claimed_until is null or claimed_until < ?3) returning *';
export const DONE_LITE = 'update outbox set done_at = ?2, error = null where id = ?1';
export const FAIL_LITE = 'update outbox set error = ?2 where id = ?1';
export const WAIT_LITE = 'update outbox set error = ?2, claimed_until = ?3, attempts = max(attempts - 1, 0) where id = ?1';
const CLAIM_MS = 2 * 60_000;
```

Change `writeOutbox` to:

```ts
export async function writeOutbox(q: Query, rows: OutboxRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  if (isLite(q)) {
    const ids: string[] = [];
    for (const row of rows) {
      const [found] = await q<{ id: number }>(OUTBOX_ROW_LITE, [row.kind, JSON.stringify(row.payload)]);
      ids.push(String(found.id));
    }
    return ids;
  }
  const found = await q<{ id: string | number }>(OUTBOX_INSERT_SQL, [JSON.stringify(rows)]);
  return found.map((row) => String(row.id)).sort((a, b) => Number(a) - Number(b));
}
```

In `processOutbox`, give each of the four statements its SQLite form:

```ts
  for (const id of ids) {
    const lite = isLite(deps.db);
    const now = deps.clock.now();
    const [row] = await deps.db.statement<{ id: string | number; kind: string; payload: Record<string, unknown> }>(
      'write', lite ? CLAIM_LITE : CLAIM_SQL, lite ? [Number(id), new Date(now.getTime() + CLAIM_MS).toISOString(), now.toISOString()] : [id],
    );
    if (!row) continue;
    const handler = HANDLERS.get(row.kind);
    try {
      if (!handler) throw new Error(`No effect handler is registered for ${row.kind}.`);
      await handler(row.payload ?? {}, deps);
      await deps.db.statement('write', lite ? DONE_LITE : DONE_SQL, lite ? [Number(id), deps.clock.now().toISOString()] : [id]);
      done.push(id);
    } catch (error) {
      const message = messageOf(error);
      const retryAt = retryAtOf(error);
      if (retryAt) {
        await deps.db.statement('write', lite ? WAIT_LITE : WAIT_SQL, [lite ? Number(id) : id, message, retryAt.toISOString()]);
        deps.log.warn('An effect after the commit waits. The job tries it again after the time it named.', { id, kind: row.kind, error: message, retryAt: retryAt.toISOString() });
      } else {
        await deps.db.statement('write', lite ? FAIL_LITE : FAIL_SQL, [lite ? Number(id) : id, message]);
        deps.log.warn('An effect after the commit failed. The job tries it again.', { id, kind: row.kind, error: message });
      }
      failed.push(id);
    }
  }
```

The Postgres branch sends the same texts and values as before, so `server/core/effects.test.ts` stays green.

- [ ] **Step 4: Write `liteData`**

```ts
import { takeOfficeLock } from '../../core/lock';
import { writeOutbox } from '../../core/effects';
import { sqlKeys } from '../../core/idempotency';
import type { Deps } from '../../core/ports';
import type { CallData } from '../../core/runCall';
import { sqlStories } from '../../core/story';
import { isLite } from '../dialect';
import type { LiteDb } from './db';
import { readLiteOffice } from './office';
import { liteSave } from './save';
import { liteSource } from './source';

/**
 * The data of a call on the SQLite Db of deps (Supabase exit, wave 1): the CallData of createRunCall, as sqlData is for
 * Postgres (server/core/runCall.ts). runCall.ts does not change: the office object and test:lite pass createRunCall({ data:
 * liteData }). The stores (stories, keys, outbox) pick their SQLite text by the dialect of the query.
 */
export function liteData(deps: Deps): CallData {
  if (!isLite(deps.db)) throw new Error('liteData needs the SQLite Db of the office (server/data/lite/db.ts).');
  const db = deps.db as LiteDb;
  return {
    tx: (mode, work) =>
      db.tx(mode, (q) =>
        work({
          q,
          lock: (key) => takeOfficeLock(q, key),
          office: () => readLiteOffice(db, q),
          source: () => liteSource(q),
          save: (before, after, o) => liteSave(q, before, after, o),
          stories: sqlStories(q),
          keys: sqlKeys(q),
          outbox: (rows) => writeOutbox(q, rows),
        }),
      ),
    office: () => db.tx('read', (q) => readLiteOffice(db, q)),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project server server/data/lite/callData.test.ts server/data/lite/outbox.test.ts server/core`
Expected: PASS: the 6 new tests, and every test of `server/core` as before (the Postgres texts did not change).

- [ ] **Step 6: Commit**

```bash
git add server/core/lock.ts server/core/story.ts server/core/idempotency.ts server/core/effects.ts server/calls/story.ts server/data/lite/callData.ts server/data/lite/callData.test.ts server/data/lite/outbox.test.ts
git commit -m "Exit wave 1: runCall on SQLite through liteData, and the SQLite forms of the stories, keys and outbox"
```

---

### Task 13: The SQLite forms of the file texts and the email producer

These are the texts of wave 1 scope that `test:db` sends outside `runCall`'s stores (Task 2 confirms the list): the upload
intents, the record reads of `files.link` and `feedback.screenshot`, the keys of `projects.delete` and `r2.delete`, and the
`users.update` producer.

**Files:**
- Modify: `server/files/intents.ts:29-36` (texts) and `insertIntents`, `readIntents`, `useIntents` (lines 75 to 125)
- Modify: `server/files/records.ts:9-40` (texts and the five readers)
- Modify: `server/files/effects.ts:18-28` (texts), `blobKeysInUse`, `projectBlobKeys`, `removeNowOrLater`
- Modify: `server/auth/effects.ts:51-52` (text) and `emailProducer` (lines 110 to 120)
- Test: `server/data/lite/serverTexts.test.ts`

**Interfaces:**
- Consumes: `sqlFor` (Task 3); `OUTBOX_ROW_LITE` (Task 12); `freshLite` (Task 6).
- Produces: `INTENT_INSERT_LITE`, `INTENTS_SELECT_LITE`, `INTENTS_USE_LITE`, `USERS_LITE`, `FILE_DOC_LITE`, `TASK_PROJECT_LITE`,
  `TASK_DOC_LITE`, `FEEDBACK_DOC_LITE`, `KEYS_IN_USE_LITE`, `PROJECT_KEYS_LITE`, `USER_EMAIL_CHANGED_LITE` (exported strings).

- [ ] **Step 1: Write the test that fails**

```ts
import { describe, expect, it } from 'vitest';
import { USER_EMAIL_CHANGED_LITE } from '../../auth/effects';
import { blobKeysInUse, projectBlobKeys } from '../../files/effects';
import { insertIntents, readIntents, useIntents } from '../../files/intents';
import { readFeedback, readFile, readUsers } from '../../files/records';
import { freshLite } from './testDb';

const NOW = new Date('2026-10-04T06:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('the file texts and the email producer on SQLite', () => {
  it('writes, reads and uses upload intents once, and refuses an ended one', async () => {
    const { db } = await freshLite();
    const intent = (id: string, expiresAt: Date) => ({ id, actorId: 'usr_001', projectId: 'prj_001', stagingKey: `staging/${id}`, key: `files/${id}`, thumbKey: null, size: 10, mimeType: 'application/pdf', expiresAt, usedAt: null });
    await insertIntents(db, [intent('upl_a', later(60_000)), intent('upl_b', later(-1))]);
    const read = await readIntents(db, ['upl_a', 'upl_b']);
    expect(read.get('upl_a')).toEqual(intent('upl_a', later(60_000)));
    await db.tx('write', (q) => useIntents(q, ['upl_a'], 'usr_001', NOW));
    await expect(db.tx('write', (q) => useIntents(q, ['upl_a'], 'usr_001', NOW))).rejects.toMatchObject({ code: 'conflict' });
    await expect(db.tx('write', (q) => useIntents(q, ['upl_b'], 'usr_001', NOW))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reads the records of the file hooks', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into users (id, doc) values (?, ?)', ['usr_001', { id: 'usr_001', name: 'Hala' }]);
      await q('insert into files (id, doc, project_id) values (?, ?, ?)', ['fil_001', { id: 'fil_001', name: 'Plan' }, 'prj_001']);
      await q('insert into feedback (id, doc) values (?, ?)', ['fbk_001', { id: 'fbk_001', message: 'Hi' }]);
    });
    expect([...(await readUsers(db, ['usr_001', 'usr_404'])).keys()]).toEqual(['usr_001']);
    expect(await readFile(db, 'fil_001')).toMatchObject({ id: 'fil_001' });
    expect(await readFeedback(db, 'fbk_001')).toMatchObject({ id: 'fbk_001' });
  });

  it('finds the stored keys that a file version or a screenshot still uses, and the keys of a project', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into files (id, doc, project_id) values (?, ?, ?)', ['fil_001', { id: 'fil_001', versions: [{ blobKey: 'k/a', thumbKey: 'k/a.t' }, 'loose'] }, 'prj_001']);
      await q('insert into feedback (id, doc) values (?, ?)', ['fbk_001', { id: 'fbk_001', screenshots: [{ blobKey: 'k/s' }] }]);
      await q('insert into events (id, doc, seq, project_id, target_type) values (?, ?, ?, ?, ?)', ['evt_001', { id: 'evt_001', before: { versions: [{ blobKey: 'k/old' }] }, after: null }, 1, 'prj_001', 'file']);
    });
    expect(await blobKeysInUse(db, ['k/a', 'k/a.t', 'k/s', 'k/gone'])).toEqual(new Set(['k/a', 'k/a.t', 'k/s']));
    expect((await db.tx('read', (q) => projectBlobKeys(q, 'prj_001'))).sort()).toEqual(['k/a', 'k/a.t', 'k/old']);
  });

  it('tells whether the last user.updated event of a person changed the email', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into events (id, doc, seq, target_type, target_id, verb) values (?, ?, ?, ?, ?, ?)', ['evt_001', { after: { email: 'a@b.c' }, actingForId: 'usr_001' }, 1, 'user', 'usr_002', 'user.updated']);
      await q('insert into events (id, doc, seq, target_type, target_id, verb) values (?, ?, ?, ?, ?, ?)', ['evt_002', { after: { name: 'B' }, actingForId: 'usr_001' }, 2, 'user', 'usr_003', 'user.updated']);
    });
    expect(await db.statement('read', USER_EMAIL_CHANGED_LITE, ['usr_002'])).toEqual([{ changed: 1, actor: 'usr_001' }]);
    expect(await db.statement('read', USER_EMAIL_CHANGED_LITE, ['usr_003'])).toEqual([{ changed: 0, actor: 'usr_001' }]);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/data/lite/serverTexts.test.ts`
Expected: FAIL with "USER_EMAIL_CHANGED_LITE" not exported, and the others with "The SQLite host refuses a Postgres placeholder".

- [ ] **Step 3: Add the SQLite texts and pick them by the dialect**

`server/files/intents.ts`, after `INTENTS_USE_SQL` (and `import { sqlFor } from '../data/dialect';`):

```ts
export const INTENT_INSERT_LITE =
  'insert into upload_intents (id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at) '
  + "select json_extract(value, '$.id'), json_extract(value, '$.actor_id'), json_extract(value, '$.project_id'), json_extract(value, '$.staging_key'), "
  + "json_extract(value, '$.key'), json_extract(value, '$.thumb_key'), json_extract(value, '$.size'), json_extract(value, '$.mime_type'), "
  + "json_extract(value, '$.expires_at') from json_each(?1)";
export const INTENTS_SELECT_LITE =
  'select id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at from upload_intents where id in (select value from json_each(?1))';
export const INTENTS_USE_LITE =
  'update upload_intents set used_at = ?3 where id in (select value from json_each(?1)) and actor_id = ?2 and used_at is null and expires_at > ?3 returning id';
```

and send `sqlFor(db, INTENT_INSERT_SQL, INTENT_INSERT_LITE)` in `insertIntents`, `sqlFor(db, INTENTS_SELECT_SQL, INTENTS_SELECT_LITE)`
in `readIntents`, `sqlFor(q, INTENTS_USE_SQL, INTENTS_USE_LITE)` in `useIntents`. The values stay the same: the SQLite Db binds
the id list as JSON text. `expires_at > ?3` compares ISO text in UTC, which is time order (both sides come from `toISOString`).

`server/files/records.ts`, after the five texts (and the `sqlFor` import):

```ts
// An office table of fewer than 100 rows: json_each is cheap here, and wave 3 reads the users from the office snapshot.
export const USERS_LITE = 'select doc from users where id in (select value from json_each(?1))';
export const FILE_DOC_LITE = 'select doc from files where id = ?1';
export const TASK_PROJECT_LITE = 'select project_id from tasks where id = ?1';
export const TASK_DOC_LITE = 'select doc from tasks where id = ?1';
export const FEEDBACK_DOC_LITE = 'select doc from feedback where id = ?1';
```

In each of the five readers, pass `sqlFor(db, <X>_SQL, <X>_LITE)` in place of `<X>_SQL`; for example in `readUsers`:
`await db.statement<{ doc: User }>('read', sqlFor(db, USERS_SQL, USERS_LITE), [ids])`.

`server/files/effects.ts`, after `PROJECT_KEYS_SQL` (and the `sqlFor` and `OUTBOX_ROW_LITE` imports):

```ts
// A scan of the files and the reports: r2.delete runs only after a project delete or a refused upload.
export const KEYS_IN_USE_LITE =
  'select k.value as key from json_each(?1) k where exists ('
  + "select 1 from files f, json_each(f.doc, '$.versions') v where json_type(f.doc, '$.versions') = 'array' and v.type = 'object' "
  + "and (json_extract(f.doc, v.fullkey || '.blobKey') = k.value or json_extract(f.doc, v.fullkey || '.thumbKey') = k.value)"
  + ") or exists (select 1 from feedback b, json_each(b.doc, '$.screenshots') s where json_type(b.doc, '$.screenshots') = 'array' "
  + "and s.type = 'object' and json_extract(b.doc, s.fullkey || '.blobKey') = k.value)";
export const PROJECT_KEYS_LITE =
  "select json_extract(doc, '$.versions') as versions from files where project_id = ?1 "
  + "union all select json_extract(doc, '$.before.versions') from events where project_id = ?1 and target_type = 'file' "
  + "union all select json_extract(doc, '$.after.versions') from events where project_id = ?1 and target_type = 'file'";
```

Send `sqlFor(db, KEYS_IN_USE_SQL, KEYS_IN_USE_LITE)` in `blobKeysInUse` and `sqlFor(q, PROJECT_KEYS_SQL, PROJECT_KEYS_LITE)` in
`projectBlobKeys` (the SQLite Db parses `versions`: it is in `JSON_COLUMNS`). In `removeNowOrLater`, write the row with its
SQLite form when the Db is SQLite:

```ts
      if (isLite(deps.db)) await deps.db.statement('write', OUTBOX_ROW_LITE, ['r2.delete', JSON.stringify({ keys })]);
      else await deps.db.statement('write', OUTBOX_INSERT_SQL, [JSON.stringify([{ kind: 'r2.delete', payload: { keys } }])]);
```

`server/auth/effects.ts`, after `USER_EMAIL_CHANGED_SQL` (and the `sqlFor` import):

```ts
export const USER_EMAIL_CHANGED_LITE =
  "select case when json_type(doc, '$.after.email') is not null then 1 else 0 end as changed, json_extract(doc, '$.actingForId') as actor "
  + "from events where target_type = 'user' and target_id = ?1 and verb = 'user.updated' order by seq desc limit 1";
```

In `emailProducer`, send `sqlFor(q, USER_EMAIL_CHANGED_SQL, USER_EMAIL_CHANGED_LITE)`, type the row as
`{ changed: boolean | number | null; actor?: string | null }`, and read it with `Boolean(last?.changed)` in place of
`last?.changed === true` (Postgres gives true, false or null; SQLite gives 1 or 0; both read the same).
`order by seq desc limit 1` is a cut on `events_target` (`target_type, target_id, seq`); the seq order is the insertion order of
events, so it gives the row of `order by ord desc limit 1`.

- [ ] **Step 4: Run the test and the server tests**

Run: `npx vitest run --project server server/data/lite/serverTexts.test.ts server/files server/auth`
Expected: PASS: 4 new tests, and every test of `server/files` and `server/auth` as before.

- [ ] **Step 5: Commit**

```bash
git add server/files/intents.ts server/files/records.ts server/files/effects.ts server/auth/effects.ts server/data/lite/serverTexts.test.ts
git commit -m "Exit wave 1: the SQLite forms of the upload intents, the file records, the stored keys and the email producer"
```

---

### Task 14: The SQLite harness of the rule tests, and `npm run test:lite`

**Files:**
- Create (moved code): `server/test/down.ts` (`downChanges`, `DownChange`, `canonical` of `server/test/db.ts:54-85`),
  `server/test/gate.ts` (`Gate`, `createGate`, `fullName` of `server/test/db.ts:128-168, 380-385`),
  `server/test/speed.ts` (`WorkerStats`, `GATE_RUN_MS`, `GATE_CALL_MS`, `readWorkerStats`, `speedGate` of
  `server/test/global-setup.ts:118-156`)
- Modify: `server/test/db.ts` and `server/test/global-setup.ts` (import the moved code and export it again under the same names)
- Create: `server/test/liteHarness.ts`, `server/test/lite.ts`, `server/test/lite-setup.ts`
- Modify: `vite.config.ts:132-149` (the project `lite`), `package.json` (the script `test:lite`)
- Test: `server/test/liteHarness.test.ts`

**Interfaces:**
- Consumes: `MirrorBackend`, `createDbApi` (`server/test/dbApi.ts`); `fakeDeps`, `FakeDeps`, `LogLine`; `createRunCall`,
  `RunCall`; `liteData` (Task 12); `liteDb`, `LiteDb` (Task 5); `nodeHost` (Task 4); `applyLiteSchema`, `EVENT_GUARDS`,
  `eventGuardsSql` (Task 6); `writeOfficeSnapshot` (Task 7); `insertRow` (Task 8); `liteLoadWhole` (Task 8); `skipReason`
  (`server/test/db-mode.skip.ts`).
- Produces: `LATER_CALLS: ReadonlySet<string>`; `LATER_KINDS: ReadonlySet<string>`; `liteChecksum(raw: DatabaseSync): string`;
  `liteWriteDown(db: LiteDb, before: State, after: State): Promise<boolean>`;
  `class LiteWorker { constructor(o?: { stats?: string }); readonly backend: MirrorBackend; backendFor(gate: Gate): MirrorBackend; end(): void; close(): void }`.

- [ ] **Step 1: Move the shared harness parts (no change of behaviour)**

Move the three blocks named above, with their comments, into the three new files, and export each name. In `server/test/db.ts`
add `import { canonical, downChanges, type DownChange } from './down';` and `import { createGate, fullName, type Gate } from './gate';`
and `export { downChanges, createGate, type Gate } from ...` lines in place of the moved code. In `server/test/global-setup.ts`
add `import { readWorkerStats, speedGate, type WorkerStats } from './speed';` and `export { readWorkerStats, speedGate, type WorkerStats } from './speed';`.

Run: `npx vitest run --project server server/test`
Expected: PASS, the same 76 tests as before (the moved code has its old tests).

- [ ] **Step 2: Write the test that fails**

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { liteDb } from '../data/lite/db';
import { nodeHost } from '../data/lite/host';
import { applyLiteSchema } from '../data/lite/schema';
import { liteLoadWhole } from '../data/lite/whole';
import { createGate } from './gate';
import { liteChecksum, liteWriteDown, LiteWorker } from './liteHarness';

async function office() {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyLiteSchema(host);
  return { raw, db: liteDb(host) };
}

describe('the SQLite mirror backend (server/test/liteHarness.ts)', () => {
  it('writes the test edits with no rule check, also a change of an old event, and makes the event guards again', async () => {
    const { db } = await office();
    const seed = await buildSeed('2026-10-04', async () => undefined);
    const blank = { ...emptyState(''), settings: undefined as unknown as State['settings'] };
    expect(await liteWriteDown(db, blank, seed)).toBe(true);
    const event = Object.values(seed.events)[0];
    const edited = structuredClone(seed);
    edited.events[event.id] = { ...event, createdAt: '2026-01-01T00:00:00.000+03:00' };
    expect(await liteWriteDown(db, seed, edited)).toBe(true);
    const back = await db.tx('read', (q) => liteLoadWhole(q));
    expect(back.events[event.id].createdAt).toBe('2026-01-01T00:00:00.000+03:00');
    await expect(db.statement('write', 'delete from events')).rejects.toThrow('events only grow');
  });

  it('gives the same checksum for the same rows, and another after a write', async () => {
    const { raw, db } = await office();
    const first = liteChecksum(raw);
    expect(liteChecksum(raw)).toBe(first);
    await db.tx('write', (q) => q('insert into counters (prefix, n) values (?, ?)', ['tsk', 1]));
    expect(liteChecksum(raw)).not.toBe(first);
  });

  it('gives each test a new office: no row of one test is in the next one', async () => {
    const worker = new LiteWorker();
    const gate = createGate();
    gate.start('one');
    const backend = worker.backendFor(gate);
    await backend.begin();
    const seed = await buildSeed('2026-10-04', async () => undefined);
    await backend.writeDown(await backend.readBack(), seed);
    expect(Object.keys((await backend.readBack()).tasks).length).toBeGreaterThan(0);
    await gate.end();
    worker.end();
    gate.start('two');
    const next = worker.backendFor(gate);
    await next.begin();
    expect((await next.readBack()).tasks).toEqual({});
    await gate.end();
    worker.end();
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run --project server server/test/liteHarness.test.ts`
Expected: FAIL with "Failed to resolve import "./liteHarness"".

- [ ] **Step 4: Write the SQLite mirror backend**

```ts
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { State } from '../../src/api/store';
import type { RunCall } from '../core/runCall';
import type { CallEntry } from '../core/serverCallMap';
import { liteData } from '../data/lite/callData';
import { liteDb, type LiteDb } from '../data/lite/db';
import { nodeHost } from '../data/lite/host';
import { writeOfficeSnapshot } from '../data/lite/office';
import { insertRow } from '../data/lite/save';
import { applyLiteSchema, EVENT_GUARDS, eventGuardsSql } from '../data/lite/schema';
import { liteLoadWhole } from '../data/lite/whole';
import type { MirrorBackend } from './dbApi';
import { downChanges } from './down';
import { fakeDeps, type FakeDeps } from './fakes/deps';
import type { Gate } from './gate';
import type { WorkerStats } from './speed';

/**
 * The SQLite mirror backend of test:lite (Supabase exit, wave 1): the rule tests of src/api and the shadow run on node:sqlite,
 * with no Docker. Each test gets a new in-memory office with the schema; the end of the test throws it away, so there is no test
 * transaction, no worker schema and no leak guard. dbApi.ts, shadow.ts and invariants.ts stay as they are.
 */

/** The server calls that wave 1 has no SQLite form for yet: they may fail in test:lite, and waves 2 and 3 empty this list. */
export const LATER_CALLS: ReadonlySet<string> = new Set(['users.invites', 'users.resendInvite', 'agents.list', 'agents.remove', 'usage.get', 'usage.retryEffect']);
/** The effect kinds that wave 1 has no SQLite form for yet (the sign-in of wave 2). Their outbox rows fail and stay for the job. */
export const LATER_KINDS: ReadonlySet<string> = new Set(['auth.invite', 'auth.ban', 'auth.unban', 'auth.email', 'auth.emailNotice', 'agents.revokeAll']);

const NO_FORM = 'Give the caller a SQLite form';

/** One checksum over the rows of every table, in table name and rowid order. */
export function liteChecksum(raw: DatabaseSync): string {
  const hash = createHash('sha256');
  const tables = raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[];
  for (const { name } of tables) {
    hash.update(`${name}:`);
    for (const row of raw.prepare(`select * from "${name}" order by rowid`).all()) hash.update(JSON.stringify(row));
  }
  return hash.digest('hex');
}

/**
 * Writes the test's own edits with no rule check: the event guards go for the write and come back, and an office change raises
 * office_meta.version and writes the snapshot (the rule of server/data/lite/office.ts).
 */
export async function liteWriteDown(db: LiteDb, before: State, after: State): Promise<boolean> {
  const { tables, counters, removedCounters } = downChanges(before, after);
  if (tables.length === 0 && Object.keys(counters).length === 0 && removedCounters.length === 0) return false;
  try {
    await db.tx('write', async (q) => {
      const old = tables.some((change) => change.touchesOld);
      if (old) for (const name of EVENT_GUARDS) db.host.exec(`drop trigger ${name}`, []);
      for (const change of tables) {
        for (const id of change.deleted) await q(`delete from ${change.spec.table} where id = ?`, [id]);
        for (const row of change.upserts) await insertRow(q, change.spec, row, after, 'update');
      }
      for (const prefix of removedCounters) await q('delete from counters where prefix = ?', [prefix]);
      for (const [prefix, n] of Object.entries(counters)) await q('insert into counters (prefix, n) values (?, ?) on conflict (prefix) do update set n = excluded.n', [prefix, n]);
      if (tables.some((change) => change.spec.office)) {
        const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
        await writeOfficeSnapshot(q, after, Number(meta.version));
      }
      if (old) for (const text of eventGuardsSql()) db.host.exec(text, []);
    });
  } catch (error) {
    throw new Error(`lite mode: the test's own edits break a database rule, so they cannot go to the database: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

export class LiteWorker {
  readonly #stats: string | undefined;
  #raw?: DatabaseSync;
  #db?: LiteDb;
  #deps?: FakeDeps;
  #runs = new WeakMap<ReadonlyMap<string, CallEntry>, RunCall>();
  #calls: WorkerStats = { n: 0, ms: 0 };
  readonly backend: MirrorBackend;

  constructor(o: { stats?: string } = {}) {
    this.#stats = o.stats;
    const worker = this;
    this.backend = {
      owner: undefined,
      begin: () => worker.begin(),
      writeDown: (before, after) => liteWriteDown(worker.db, before, after),
      run: (req, calls) => worker.run(req, calls),
      readBack: () => worker.db.tx('read', (q) => liteLoadWhole(q, { withEvents: true })),
      checksum: async () => liteChecksum(worker.raw),
      get signals() {
        return worker.deps.signal.sent;
      },
      get clock() {
        return worker.deps.clock;
      },
      get files() {
        return worker.deps.files;
      },
    };
  }

  get raw(): DatabaseSync {
    if (!this.#raw) throw new Error('lite mode: the backend is used before its test office opened.');
    return this.#raw;
  }

  get db(): LiteDb {
    if (!this.#db) throw new Error('lite mode: the backend is used before its test office opened.');
    return this.#db;
  }

  get deps(): FakeDeps {
    if (!this.#deps) throw new Error('lite mode: the backend is used before its test office opened.');
    return this.#deps;
  }

  /** A backend for one mirror, behind the test gate (as Worker.backendFor of server/test/db.ts). */
  backendFor(gate: Gate): MirrorBackend {
    const bind = gate.binding();
    const base = this.backend;
    return {
      get owner() {
        return base.owner;
      },
      set owner(value) {
        base.owner = value;
      },
      begin: () => bind(() => base.begin()),
      writeDown: (before, after) => bind(() => base.writeDown(before, after)),
      run: (req, calls) => bind(() => base.run(req, calls)),
      readBack: () => bind(() => base.readBack()),
      checksum: () => bind(() => base.checksum()),
      get signals() {
        return base.signals;
      },
      get clock() {
        return base.clock;
      },
      get files() {
        return base.files;
      },
    };
  }

  /** Opens the office of a test, once: a new in-memory database with the schema, and new fakes. */
  async begin(): Promise<void> {
    if (this.#db) return;
    const raw = new DatabaseSync(':memory:');
    const host = nodeHost(raw);
    await applyLiteSchema(host);
    this.#raw = raw;
    this.#db = liteDb(host);
    this.#deps = fakeDeps({ db: this.#db, config: { lockKey: 0, supabaseUrl: 'http://lite-mode' } });
  }

  async run(req: Parameters<MirrorBackend['run']>[0], calls: ReadonlyMap<string, CallEntry>) {
    let run = this.#runs.get(calls);
    if (!run) {
      const { createRunCall } = await import('../core/runCall');
      run = createRunCall({ calls, data: liteData });
      this.#runs.set(calls, run);
    }
    const from = this.deps.logs.length;
    const started = performance.now();
    try {
      const result = await run(this.deps, req);
      const missing = this.deps.logs.slice(from).filter((line) => {
        const text = `${line.message} ${String(line.fields?.error ?? '')}`;
        if (!text.includes(NO_FORM)) return false;
        return !LATER_KINDS.has(String(line.fields?.kind)) && !LATER_CALLS.has(req.name);
      });
      if (missing.length > 0) throw new Error(`lite mode: ${req.name} sent a text with no SQLite form: ${String(missing[0].fields?.error ?? missing[0].message)}`);
      return result;
    } finally {
      this.#calls.n += 1;
      this.#calls.ms += performance.now() - started;
    }
  }

  /** The end of a test: the office goes, with every row of the test. */
  end(): void {
    this.backend.owner = undefined;
    this.#raw?.close();
    this.#raw = undefined;
    this.#db = undefined;
    this.#deps = undefined;
  }

  /** The end of the file: the call count and time go into the run folder for the speed gate. */
  close(): void {
    this.end();
    if (this.#stats) writeFileSync(join(this.#stats, `lite-${randomUUID()}.json`), JSON.stringify(this.#calls));
  }
}
```

Note: a call that fails inside `runCall` because a text has no SQLite form answers `failed`, and `runCall` logs the error with
the call name (`server/core/runCall.ts:239-256`); the check above reads that log line too.

- [ ] **Step 5: Write the setup file and the global setup**

`server/test/lite.ts`:

```ts
import { afterAll, afterEach, beforeEach, inject, vi } from 'vitest';
import { setNow } from '../../src/lib/dates';
import { useDbTestApi } from '../../src/test/factories';
import { skipReason } from './db-mode.skip';
import { createDbApi } from './dbApi';
import { createGate, fullName } from './gate';
import { LiteWorker } from './liteHarness';

/**
 * The setup file of the lite project (Supabase exit, wave 1): the same mirror store as db mode (server/test/dbApi.ts), on the
 * SQLite backend of liteHarness.ts. The project sets MADAR_DB=1 for src/test/factories.ts and MADAR_LITE=1 for this file. The
 * skip list of db mode holds here too.
 */
if (process.env.MADAR_LITE === '1') {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
  const worker = new LiteWorker({ stats: inject('madarLite')?.stats });
  const gate = createGate();
  useDbTestApi((calls, state) => createDbApi(calls, state, worker.backendFor(gate)));

  beforeEach((ctx) => {
    const reason = skipReason(ctx.task.file.filepath, fullName(ctx.task));
    if (reason) ctx.skip(`lite mode: ${reason}`);
    gate.start(ctx.task.id);
  });

  afterEach(async () => {
    await gate.end();
    worker.end();
  });

  afterAll(() => {
    worker.close();
  });
}

afterEach(() => {
  // Many API tests call setNow without their own reset.
  setNow(null);
});
```

`server/test/lite-setup.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { readWorkerStats, speedGate } from './speed';

declare module 'vitest' {
  export interface ProvidedContext {
    madarLite: { stats: string };
  }
}

/** The global setup of the lite project: the run folder of the call stats, and the speed gate of db mode at the end. */
export default function setup(project: TestProject): () => void {
  const started = performance.now();
  const stats = mkdtempSync(join(tmpdir(), 'madar-lite-stats-'));
  project.provide('madarLite', { stats });
  return () => {
    try {
      const gate = speedGate(readWorkerStats(stats), performance.now() - started, { ci: Boolean(process.env.CI) });
      console.info(gate.line.replace('db mode', 'lite mode'));
      if (gate.failure) throw new Error(gate.failure.replace('db mode', 'lite mode'));
    } finally {
      rmSync(stats, { recursive: true, force: true });
    }
  };
}
```

- [ ] **Step 6: Add the project and the script**

In `vite.config.ts`, after the block of the `db` project (line 149), add:

```ts
      ...(process.env.MADAR_LITE === '1'
        ? [
            {
              // The API tests again, on node:sqlite (Supabase exit, wave 1): the SQLite path of the office object, with no Docker.
              extends: true,
              test: {
                name: 'lite',
                environment: 'node',
                include: ['src/api/**/*.test.ts'],
                exclude: ['src/api/persist.test.ts'],
                env: { MADAR_DB: '1', MADAR_LITE: '1' },
                globalSetup: ['./server/test/lite-setup.ts'],
                setupFiles: ['./server/test/lite.ts'],
              },
            },
          ]
        : []),
```

In `package.json` scripts, after `"test:db"`, add `"test:lite": "MADAR_LITE=1 vitest run --project lite",`.

- [ ] **Step 7: Run the harness test and one API file on SQLite**

Run: `npx vitest run --project server server/test/liteHarness.test.ts`
Expected: PASS (3 tests).
Run: `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/tasks.test.ts`
Expected: the file runs on SQLite. Failures here are the work of Task 15; write down their first lines.

- [ ] **Step 8: Commit**

```bash
git add server/test/down.ts server/test/gate.ts server/test/speed.ts server/test/db.ts server/test/global-setup.ts server/test/liteHarness.ts server/test/liteHarness.test.ts server/test/lite.ts server/test/lite-setup.ts vite.config.ts package.json
git commit -m "Exit wave 1: test:lite, the rule tests and the shadow run on node:sqlite with no Docker"
```

---

### Task 15: `npm run test:lite` green

**Files:**
- Modify: only the SQLite modules of Tasks 6 to 13 and their tests, and `LATER_CALLS` or `LATER_KINDS` (only with a reason in
  proof.md). No handler, loader or contract file changes in this task.
- Modify: `docs/superpowers/real-build/proof.md` (append "Wave 1: test:lite")

**Interfaces:**
- Consumes: everything of Tasks 3 to 14, and the list of Task 2.
- Produces: the green `test:lite` that Tasks 16 to 19 and waves 2 and 3 build on.

- [ ] **Step 1: Run the whole suite**

Run: `npm run test:lite 2>&1 | tee $TMPDIR/lite-run-1.log | tail -40`
Expected: a list of failures in three kinds. The speed line: `lite mode: N calls, X ms a call in runCall, the run took S s.`

- [ ] **Step 2: Fix each failure by its kind, test first**

1. "sent a text with no SQLite form" or "refuses a Postgres placeholder": the message names the first 80 characters. Find the
   constant (`grep -rn "<first 40 characters>" server --include='*.ts' | grep -v test`), add its `_LITE` twin beside it, pick it
   with `sqlFor`, and add a case to `server/data/lite/serverTexts.test.ts` that runs the twin on `freshLite()` first. When the
   text belongs to a wave 2 or wave 3 call or kind (Task 2 list), add the name to `LATER_CALLS` or `LATER_KINDS` in place of a
   twin, and name the reason in proof.md.
2. "db mode: ... shadow" (a difference of the shadow run): the message names the call and the first difference. Make the
   smallest `Select` or save that shows it, add it as a case that fails to `source.test.ts`, `compile.test.ts` or `save.test.ts`,
   then fix `compile.ts`, `source.ts` or `save.ts`. Never change the memory form or a handler.
3. Any other error (a row that is not there, a wrong count): read the test, find the SQLite step that differs from Postgres, and add a
   unit test that fails for that step first.

After each fix, run the file that failed alone:
`MADAR_LITE=1 npx vitest run --project lite <file> --no-file-parallelism --testTimeout=60000`.

- [ ] **Step 3: Run the whole suite again**

Run: `npm run test:lite 2>&1 | tee $TMPDIR/lite-run-2.log | tail -20`
Expected: `Test Files  81 passed`; tests `1141 passed | 25 skipped` (the db-mode skip list; the count of `test:db` at 4cbdc95,
or more if main grew); the speed line under the gate (25 ms a call, 180 s a run).

- [ ] **Step 4: Run test:db once, to see that Postgres did not change**

Run: `scripts/dev/docker-lock.sh run exit-db -- npm run test:db`
Expected: the same passed and skipped counts as Step 3.

- [ ] **Step 5: Write the section in proof.md**

Append `### Wave 1: test:lite (<the date of the run>)`: the counts of Steps 3 and 4, the speed line of each, the names in `LATER_CALLS` and
`LATER_KINDS` with their wave, and each fix of Step 2 in one line.

- [ ] **Step 6: Commit**

```bash
git add server docs/superpowers/real-build/proof.md
git commit -m "Exit wave 1: test:lite green: every rule test and the shadow run pass on node:sqlite"
```

---
### Task 16: The office object host, and `npm run test:office` on local workerd

**Files:**
- Create: `server/office/workers.d.ts`, `server/office/doHost.ts`
- Create: `server/office/test/wrangler.toml`, `server/office/test/entry.ts`, `server/office/test/pinOffice.ts`, `server/office/test/harness.ts`
- Modify: `vite.config.ts` (exclude `*.wd.test.ts` from the `server` project; add the `office` project), `package.json` (`test:office`)
- Test: `server/office/doHost.wd.test.ts`

**Interfaces:**
- Consumes: `refuseLiteStatement`, `NESTED_TRANSACTION`, `SqlHost`, `SqlRow` (Task 4); `hostChecks`, `EXPECTED_CHECKS` (Task 4);
  `liteDb` (Task 5); `applyLiteSchema` (Task 6); `writeOfficeSnapshot`, `OfficeLists` (Task 7); `insertRow` (Task 8);
  `liteWriteState`, `liteLoadWhole` (Task 8); `liteData` (Task 12); `createRunCall`; `fakeDeps`; `everyCall`;
  `createTestHarness` (`wrangler`).
- Produces: `type TraceLine = { text: string; rowsRead: number; rowsWritten: number }`;
  `type DoHost = SqlHost & { readonly totals: { rowsRead: number; rowsWritten: number }; trace: TraceLine[] | undefined }`;
  `doHost(storage: DurableObjectStorage): DoHost`;
  `type PinCall = { name: string; input: unknown; actorId: string; now: string; key?: string; trace?: boolean }`;
  `type Rows = { rowsRead: number; rowsWritten: number }`; `type PinAnswer = { result: RunResult; rows: Rows; trace?: TraceLine[] }`;
  `interface PinOfficeApi` (methods `hostChecks`, `writeState`, `load`, `finish`, `call`, `readBack`, `statTables`, `dropIndex`);
  `class PinOffice`; `startOffice(): Promise<{ server; office(name: string): PinOfficeApi; callByFetch(name: string, c: PinCall): Promise<PinAnswer>; evict(name: string): Promise<void> }>`.

- [ ] **Step 1: Write the test that fails**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { everyCall } from '../core/everyCall';
import { createRunCall } from '../core/runCall';
import { liteData } from '../data/lite/callData';
import { EXPECTED_CHECKS } from '../data/lite/hostChecks';
import { freshLite } from '../data/lite/testDb';
import { liteLoadWhole, liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';
import { startOffice } from './test/harness';

const TODAY = '2026-10-04';
const NOW = '2026-10-04T06:00:00.000Z';
/** An answer with the parts that differ on each run made the same: story ids, upload ids, uuids. */
const steady = (value: unknown) =>
  JSON.stringify(value).replace(/sty_[a-z2-7]{22}/g, 'sty_x').replace(/upl_[a-z2-7]{22}/g, 'upl_x').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'uuid');

describe('the office object host on local workerd (server/office/doHost.ts)', () => {
  let started: Awaited<ReturnType<typeof startOffice>>;
  beforeAll(async () => {
    started = await startOffice();
  }, 120_000);
  afterAll(async () => {
    await started?.server.close();
  });

  it('refuses what node:sqlite refuses in test:lite, and keeps the same transactions', async () => {
    expect(await started.office('checks').hostChecks()).toEqual(EXPECTED_CHECKS);
  });

  it('runs every call of everyCall on the sample office with the answers of node:sqlite', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const office = started.office('every');
    await office.writeState(seed);
    const lite = await freshLite();
    await lite.db.tx('write', (q) => liteWriteState(q, seed));
    const deps = fakeDeps({ db: lite.db });
    deps.clock.set(new Date(NOW));
    const run = createRunCall({ data: liteData });
    for (const c of everyCall(seed)) {
      const inObject = (await office.call({ name: c.name, input: c.input, actorId: c.actorId, now: NOW })).result;
      const onNode = await run(deps, { principal: { userId: c.actorId }, name: c.name, input: c.input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
      expect(steady(inObject), c.name).toBe(steady(onNode));
    }
    expect(steady(await office.readBack())).toBe(steady(await lite.db.tx('read', (q) => liteLoadWhole(q))));
  }, 300_000);

  it('runs two writes that arrive at one time one after the other', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const office = started.office('two');
    await office.writeState(seed);
    const oldMax = Math.max(...Object.values(seed.events).map((event) => event.seq));
    const c = everyCall(seed).find((one) => one.name === 'tasks.update')!;
    const [a, b] = await Promise.all([office.call({ ...c, now: NOW }), office.call({ ...c, now: NOW })]);
    expect([a.result.ok, b.result.ok]).toEqual([true, true]);
    const fresh = Object.values((await office.readBack()).events).map((event) => event.seq).filter((seq) => seq > oldMax).sort((x, y) => x - y);
    expect(fresh).toEqual(fresh.map((_, i) => oldMax + 1 + i));
  });
});
```

- [ ] **Step 2: Write the Workers types and the host**

`server/office/workers.d.ts`:

```ts
// The few Workers types that the office object uses (Supabase exit, wave 1). The repo has no @cloudflare/workers-types; these
// follow the Durable Object storage API on developers.cloudflare.com (read 2026-10-17). test:office checks them on workerd.
declare module 'cloudflare:workers' {
  export interface SqlStorageCursor<T = Record<string, string | number | null | ArrayBuffer>> {
    toArray(): T[];
    readonly rowsRead: number;
    readonly rowsWritten: number;
  }
  export interface SqlStorage {
    exec<T = Record<string, string | number | null | ArrayBuffer>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>;
    readonly databaseSize: number;
  }
  export interface DurableObjectStorage {
    readonly sql: SqlStorage;
    transaction<T>(closure: () => Promise<T>): Promise<T>;
    transactionSync<T>(closure: () => T): T;
  }
  export interface DurableObjectState {
    readonly storage: DurableObjectStorage;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  }
  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
```

`server/office/doHost.ts`:

```ts
import type { DurableObjectStorage } from 'cloudflare:workers';
import { NESTED_TRANSACTION, refuseLiteStatement, type SqlHost, type SqlRow } from '../data/lite/host';

/**
 * The SQL host of the office object (Supabase exit, wave 1): ctx.storage.sql with the refusal guard of node:sqlite, and the
 * transaction of Task 1 of the exit plan (an async closure whose awaits are all on exec). totals counts every row that the
 * host read or wrote, for the rows pins and, in wave 3, the day meters. When trace is a list, each statement adds its text and
 * its rows to it (the rows pins of Task 18 read it to find the statement that reads most).
 */
export type TraceLine = { text: string; rowsRead: number; rowsWritten: number };
export type DoHost = SqlHost & { readonly totals: { rowsRead: number; rowsWritten: number }; trace: TraceLine[] | undefined };

export function doHost(storage: DurableObjectStorage): DoHost {
  let open = false;
  const totals = { rowsRead: 0, rowsWritten: 0 };
  const host: DoHost = {
    counts: true,
    totals,
    trace: undefined,
    exec(text, values) {
      refuseLiteStatement(text, values);
      const cursor = storage.sql.exec(text, ...values);
      const rows = cursor.toArray() as SqlRow[];
      totals.rowsRead += cursor.rowsRead;
      totals.rowsWritten += cursor.rowsWritten;
      host.trace?.push({ text: text.slice(0, 200), rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten });
      return { rows, rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten };
    },
    async transaction(work) {
      if (open) throw new Error(NESTED_TRANSACTION);
      open = true;
      try {
        return await storage.transaction(() => work());
      } finally {
        open = false;
      }
    },
    size: () => storage.sql.databaseSize,
  };
  return host;
}
```

- [ ] **Step 3: Write the test Worker**

`server/office/test/wrangler.toml`:

```toml
# The test Worker of test:office (Supabase exit, wave 1): the office object on local workerd through wrangler createTestHarness.
# It never deploys: no route, no workers.dev address. wrangler bundles entry.ts with the server code.
name = "madar-office-test"
main = "entry.ts"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

[[durable_objects.bindings]]
name = "OFFICE"
class_name = "PinOffice"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["PinOffice"]
```

`server/office/test/pinOffice.ts`:

```ts
import { DurableObject } from 'cloudflare:workers';
import { emptyState, type State } from '../../../src/api/store';
import { createRunCall } from '../../core/runCall';
import type { RunResult } from '../../core/types';
import { liteData } from '../../data/lite/callData';
import { liteDb, type LiteDb } from '../../data/lite/db';
import { hostChecks } from '../../data/lite/hostChecks';
import { writeOfficeSnapshot, type OfficeLists } from '../../data/lite/office';
import { insertRow } from '../../data/lite/save';
import { applyLiteSchema } from '../../data/lite/schema';
import { liteLoadWhole, liteWriteState } from '../../data/lite/whole';
import type { Row } from '../../data/rows';
import { TABLES } from '../../data/tables';
import { fakeDeps, type FakeDeps } from '../../test/fakes/deps';
import { doHost, type DoHost, type TraceLine } from '../doHost';

/**
 * The office object of test:office (Supabase exit, wave 1). It runs the real runCall on the SQLite path with the fakes of the
 * server tests, and gives back the rows that each request read and wrote, schema check included (the cold wake pin). With
 * trace, it also gives each statement of the call with its rows.
 */
export type PinCall = { name: string; input: unknown; actorId: string; now: string; key?: string; trace?: boolean };
export type Rows = { rowsRead: number; rowsWritten: number };
export type PinAnswer = { result: RunResult; rows: Rows; trace?: TraceLine[] };

export interface PinOfficeApi {
  hostChecks(): Promise<Record<string, string>>;
  writeState(state: State): Promise<Rows>;
  load(table: string, rows: Row[]): Promise<Rows>;
  finish(lists: OfficeLists, counters: Record<string, number>): Promise<Rows>;
  call(c: PinCall): Promise<PinAnswer>;
  readBack(): Promise<State>;
  statTables(): Promise<number>;
  dropIndex(name: string): Promise<void>;
}

type Parts = { host: DoHost; db: LiteDb; deps: FakeDeps };
const EMPTY = emptyState('');
const run = createRunCall({ data: liteData });

export class PinOffice extends DurableObject implements PinOfficeApi {
  #parts?: Parts;

  async #ready(): Promise<Parts> {
    if (!this.#parts) {
      const host = doHost(this.ctx.storage);
      await applyLiteSchema(host);
      const db = liteDb(host);
      this.#parts = { host, db, deps: fakeDeps({ db }) };
    }
    return this.#parts;
  }

  /** The work of one request, with the rows it read and wrote; a new host counts its schema check too. */
  async #measured<T>(work: (parts: Parts) => Promise<T>): Promise<[T, Rows]> {
    const before = this.#parts ? { ...this.#parts.host.totals } : { rowsRead: 0, rowsWritten: 0 };
    const parts = await this.#ready();
    const out = await work(parts);
    return [out, { rowsRead: parts.host.totals.rowsRead - before.rowsRead, rowsWritten: parts.host.totals.rowsWritten - before.rowsWritten }];
  }

  async hostChecks(): Promise<Record<string, string>> {
    return hostChecks(doHost(this.ctx.storage));
  }

  async writeState(state: State): Promise<Rows> {
    return (await this.#measured(({ db }) => db.tx('write', (q) => liteWriteState(q, state))))[1];
  }

  /** Rows of one table as Task 17 makes them (doc and server columns), with no diff: the import of the year office. */
  async load(table: string, rows: Row[]): Promise<Rows> {
    const spec = TABLES.find((one) => one.table === table);
    if (!spec) throw new Error(`No table ${table}.`);
    return (await this.#measured(({ db }) => db.tx('write', async (q) => {
      for (const row of rows) await insertRow(q, spec, row, EMPTY, 'fail');
    })))[1];
  }

  /** The end of an import: the counters, a new office version, and the snapshot of the office lists. */
  async finish(lists: OfficeLists, counters: Record<string, number>): Promise<Rows> {
    return (await this.#measured(({ db }) => db.tx('write', async (q) => {
      for (const [prefix, n] of Object.entries(counters)) await q('insert into counters (prefix, n) values (?, ?) on conflict (prefix) do update set n = excluded.n', [prefix, n]);
      const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
      await writeOfficeSnapshot(q, lists, Number(meta.version));
    })))[1];
  }

  async call(c: PinCall): Promise<PinAnswer> {
    let trace: TraceLine[] | undefined;
    const [result, rows] = await this.#measured(async ({ host, deps }) => {
      host.trace = c.trace ? [] : undefined;
      deps.clock.set(new Date(c.now));
      try {
        return await run(deps, { principal: { userId: c.actorId }, name: c.name, input: c.input, batch: { storyRefs: new Map(), overviewCalls: 0 }, ...(c.key ? { key: c.key } : {}) });
      } finally {
        trace = host.trace;
        host.trace = undefined;
      }
    });
    return { result, rows, ...(trace ? { trace } : {}) };
  }

  async readBack(): Promise<State> {
    const { db } = await this.#ready();
    return db.tx('read', (q) => liteLoadWhole(q));
  }

  async statTables(): Promise<number> {
    const { host } = await this.#ready();
    return Number(host.exec("select count(*) as n from sqlite_master where name like 'sqlite_stat%'", []).rows[0].n);
  }

  async dropIndex(name: string): Promise<void> {
    if (!/^[a-z_]+$/.test(name)) throw new Error(`Not an index name: ${name}`);
    this.ctx.storage.sql.exec(`drop index if exists ${name}`);
  }

  /** The cold wake test calls through fetch: an RPC stub that Node holds keeps the object awake (map of schema and tests). */
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/call' && request.method === 'POST') return Response.json(await this.call((await request.json()) as PinCall));
    return new Response('not found', { status: 404 });
  }
}
```

`server/office/test/entry.ts`:

```ts
import { PinOffice } from './pinOffice';

export { PinOffice };

type Namespace = { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };

/** The test Worker of test:office: it hands each request to the office object that the query names (o). */
export default {
  async fetch(request: Request, env: { OFFICE: Namespace }): Promise<Response> {
    const name = new URL(request.url).searchParams.get('o') ?? 'office';
    return env.OFFICE.get(env.OFFICE.idFromName(name)).fetch(request);
  },
};
```

`server/office/test/harness.ts`:

```ts
import { createTestHarness } from 'wrangler';
import type { PinAnswer, PinCall, PinOfficeApi } from './pinOffice';

/** Starts the test Worker of test:office on local workerd (wrangler createTestHarness, about 240 ms in the probe). */
export async function startOffice() {
  const server = createTestHarness({ workers: [{ configPath: new URL('./wrangler.toml', import.meta.url) }] });
  await server.listen();
  const worker = server.getWorker();
  const env = (await worker.getEnv()) as { OFFICE: { idFromName(name: string): unknown; get(id: unknown): unknown } };
  return {
    server,
    office: (name: string) => env.OFFICE.get(env.OFFICE.idFromName(name)) as PinOfficeApi,
    callByFetch: async (name: string, c: PinCall): Promise<PinAnswer> =>
      (await (await worker.fetch(`http://office.test/call?o=${name}`, { method: 'POST', body: JSON.stringify(c) })).json()) as PinAnswer,
    evict: (name: string) => worker.evictDurableObject('OFFICE', { name }),
  };
}
```

- [ ] **Step 4: Add the project and the script**

In `vite.config.ts`, in the `server` project, change `exclude` to `['server/it/**', 'server/**/*.wd.test.ts', ...DOCKER_SCRIPT_TESTS]`.
After the `lite` project block, add:

```ts
      ...(process.env.MADAR_OFFICE === '1'
        ? [
            {
              // The office object on local workerd (Supabase exit, wave 1): host parity, everyCall parity, the rows pins.
              extends: true,
              test: {
                name: 'office',
                environment: 'node',
                include: ['server/office/**/*.wd.test.ts'],
                fileParallelism: false,
                testTimeout: 300_000,
                hookTimeout: 900_000,
              },
            },
          ]
        : []),
```

In `package.json` scripts, after `"test:lite"`, add `"test:office": "MADAR_OFFICE=1 vitest run --project office",`.

- [ ] **Step 5: Run the suite**

Run: `npm run test:office -- server/office/doHost.wd.test.ts` (with the sandbox off if `listen()` fails with `EPERM`)
Expected: PASS (3 tests). If "runs every call of everyCall" fails on a value that differs on each run (not a story id, upload id
or uuid), add its pattern to `steady` with a comment that names it; any other difference is a fault of the SQLite path on the
office object: reproduce it in a node test first.

- [ ] **Step 6: Run the types and npm test**

Run: `npm run typecheck && npm test`
Expected: no type error; `npm test` passes and does not run the `.wd.test.ts` files.

- [ ] **Step 7: Commit**

```bash
git add server/office vite.config.ts package.json
git commit -m "Exit wave 1: the office object host and test:office on local workerd, with host and everyCall parity"
```

---

### Task 17: A year office that the zod schemas accept

**Files:**
- Create: `server/office/test/yearOffice.ts`
- Test: `server/office/test/yearOffice.test.ts` (in `npm test`: it needs no workerd)

**Interfaces:**
- Consumes: `buildSeed` (`src/data/seed.ts`); `TABLES`, `rowsOf` (`tables.ts`).
- Produces: `YEAR` (the sizes); `shifted(text: string, ms: number): string`; `yearOffice(today: string): Promise<State>`.

- [ ] **Step 1: Write the test that fails**

```ts
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../../src/data/seed';
import { TABLES, rowsOf } from '../../data/tables';
import { YEAR, shifted, yearOffice } from './yearOffice';

const TODAY = '2026-10-04';

describe('the year office of test:office (server/office/test/yearOffice.ts)', () => {
  it('moves a stamp and a date, and keeps their text form', () => {
    expect(shifted('2026-09-30T09:00:00.000+03:00', -86_400_000)).toBe('2026-09-29T09:00:00.000+03:00');
    expect(shifted('2026-09-30T06:00:00Z', 3_600_000)).toBe('2026-09-30T07:00:00Z');
    expect(shifted('2026-09-30', -2 * 86_400_000)).toBe('2026-09-28');
    expect(shifted('not a date', 1)).toBe('not a date');
  });

  it('builds records that parse with the zod schema of their table, with one key for each record and one seq for each event', async () => {
    const office = await yearOffice(TODAY);
    for (const spec of TABLES) {
      const rows = rowsOf(office, spec);
      expect(new Set(rows.map((row) => row.id)).size, spec.table).toBe(rows.length);
      rows.forEach((row, i) => {
        if (spec.office || i % 25 === 0) expect(spec.schema.safeParse(row.doc).success, `${spec.table} ${row.id}`).toBe(true);
      });
    }
    const seqs = Object.values(office.events).map((event) => event.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(office.counters.evt).toBeGreaterThanOrEqual(seqs.length);
  }, 120_000);

  it('reaches the sizes of the wave 0 year profile', async () => {
    const [office, seed] = await Promise.all([yearOffice(TODAY), buildSeed(TODAY, async () => undefined)]);
    for (const c of ['events', 'comments', 'notifications', 'messages', 'files', 'updates', 'tracker'] as const) {
      expect(Object.keys(office[c] ?? {}).length, c).toBe(YEAR[c]);
    }
    expect(Object.keys(office.projects).length).toBe(Object.keys(seed.projects).length * YEAR.copies);
  }, 120_000);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/office/test/yearOffice.test.ts`
Expected: FAIL with "Failed to resolve import "./yearOffice"".

- [ ] **Step 3: Write the year office**

```ts
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { TABLES, rowsOf } from '../../data/tables';

/**
 * One year of growth for the rows pins of test:office (Supabase exit, wave 1). It grows the sample office (src/data/seed.ts),
 * so each record keeps the shape that its zod schema checks (the records of the wave 0 generator fail zod in 12 of 20 tables).
 * The sizes follow the profile "year" of scripts/proof/do-rows/src/gen.js. The sample office has 10 people, not 15, so the
 * rows of one person are more than in wave 0.
 *  1. Copies of the project work, each 45 days older, with new ids. Direct chats, people, clients and templates stay once.
 *  2. More rounds of the activity (events, comments, notices, messages, files, posts, Tracker entries), each one day older.
 *  3. One seq for each event in time order, and each counter at the highest number of its prefix.
 */
export const YEAR = { copies: 6, events: 62_000, comments: 12_000, notifications: 26_000, messages: 20_000, files: 6_000, updates: 2_600, tracker: 1_500 } as const;

const DAY = 86_400_000;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^([a-z]+)_(\d+)$/;

type Rec = Record<string, unknown>;
type Lists = Record<string, Record<string, Rec>>;

const COPIED = ['projects', 'members', 'stages', 'deadlines', 'conversations', 'tasks', 'updates', 'comments', 'files', 'tracker', 'payments', 'events', 'notifications', 'messages', 'chatReads'] as const;
const GROWN = ['events', 'comments', 'notifications', 'messages', 'files', 'updates', 'tracker'] as const;

/** A stamp or a date moved by ms, in the same text form: the same offset and the same digits. Other text stays. */
export function shifted(text: string, ms: number): string {
  if (DATE.test(text)) return new Date(Date.parse(`${text}T00:00:00Z`) + Math.round(ms / DAY) * DAY).toISOString().slice(0, 10);
  const m = STAMP.exec(text);
  if (!m) return text;
  const sign = m[4].startsWith('-') ? -1 : 1;
  const offset = m[4] === 'Z' ? 0 : sign * (Number(m[4].slice(1, 3)) * 60 + Number(m[4].slice(4, 6))) * 60_000;
  const local = new Date(Date.parse(text) + ms + offset).toISOString();
  return `${local.slice(0, 19)}${m[3] ?? ''}${m[4]}`;
}

const bump = (id: string, offset: number) => id.replace(ID, (_whole, prefix: string, n: string) => `${prefix}_${String(Number(n) + offset).padStart(3, '0')}`);

/** A deep copy with each id of names renamed (also as an object key) and each stamp and date moved by ms. */
function moved(value: Rec, names: ReadonlyMap<string, string>, ms: number): Rec {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return names.get(v) ?? shifted(v, ms);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v as Rec).map(([key, inner]) => [names.get(key) ?? key, walk(inner)]));
    return v;
  };
  return walk(value) as Rec;
}

export async function yearOffice(today: string): Promise<State> {
  const base = await buildSeed(today, async () => undefined);
  const state = structuredClone(base);
  const lists = state as unknown as Lists;
  const from = base as unknown as Lists;
  const keyOf = (c: string, rec: Rec) => TABLES.find((spec) => spec.collection === c)!.key(rec);
  const add = (c: string, rec: Rec) => {
    (lists[c] ??= {})[keyOf(c, rec)] = rec;
  };
  // A notice key is unique in the table (notifications_dedupe): each copy and round gets its own.
  const unique = (c: string, rec: Rec, tag: string): Rec => (c === 'notifications' && typeof rec.dedupeKey === 'string' ? { ...rec, dedupeKey: `${rec.dedupeKey}:${tag}` } : rec);

  for (let copy = 1; copy < YEAR.copies; copy++) {
    const names = new Map<string, string>();
    const copied = (c: string, rec: Rec) => !(c === 'conversations' && rec.kind !== 'project');
    for (const c of COPIED) for (const rec of Object.values(from[c] ?? {})) if (copied(c, rec) && typeof rec.id === 'string' && ID.test(rec.id)) names.set(rec.id, bump(rec.id, copy * 100_000));
    for (const c of COPIED) {
      for (const rec of Object.values(from[c] ?? {})) {
        if (!copied(c, rec)) continue;
        if (c === 'chatReads' && !names.has(String(rec.conversationId))) continue;
        add(c, unique(c, moved(rec, names, -copy * 45 * DAY), `c${copy}`));
      }
    }
  }

  for (const c of GROWN) {
    const pool = Object.values(lists[c] ?? {}).filter((rec) => !(c === 'events' && typeof rec.undoes === 'string'));
    for (let round = 1; Object.keys(lists[c] ?? {}).length < YEAR[c]; round++) {
      const names = new Map(pool.map((rec) => [String(rec.id), bump(String(rec.id), (YEAR.copies + round) * 100_000)]));
      for (const rec of pool) {
        if (Object.keys(lists[c]).length >= YEAR[c]) break;
        const clone = unique(c, moved(rec, names, -round * DAY), `r${round}`);
        add(c, c === 'events' ? { ...clone, undoneBy: null } : clone);
      }
    }
  }

  const events = Object.values(lists.events);
  events.sort((a, b) => Date.parse(String(a.createdAt)) - Date.parse(String(b.createdAt)) || (String(a.id) < String(b.id) ? -1 : 1));
  events.forEach((event, i) => {
    event.seq = i + 1;
  });
  lists.events = Object.fromEntries(events.map((event) => [String(event.id), event]));

  const counters: Record<string, number> = { ...state.counters };
  for (const spec of TABLES) {
    for (const row of rowsOf(state, spec)) {
      const m = typeof row.doc?.id === 'string' ? ID.exec(row.doc.id) : null;
      if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, Number(m[2]));
    }
  }
  counters.evt = Math.max(counters.evt ?? 0, events.length);
  state.counters = counters;
  return state;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --project server server/office/test/yearOffice.test.ts --testTimeout=120000`
Expected: PASS (3 tests). A zod failure names the table and the record: change only the copy rule of that field in
`yearOffice.ts` (for example a key that must stay unique), never the schema.

- [ ] **Step 5: Commit**

```bash
git add server/office/test/yearOffice.ts server/office/test/yearOffice.test.ts
git commit -m "Exit wave 1: a year office grown from the sample office, which the zod schemas accept"
```

---

### Task 18: The rows pins, the cold wake, and the cut of the event indexes

**Files:**
- Create: `server/office/test/pins.ts`
- Test: `server/office/pins.wd.test.ts`
- Modify (Step 6): `server/data/lite/schema.ts` (`LITE_INDEXES`, `LITE_SCHEMA_VERSION`), `server/data/lite/schema.test.ts` (`PINNED_SHA256`)
- Modify: `docs/superpowers/real-build/proof.md` (append "Wave 1: the rows pins")

**Interfaces:**
- Consumes: `startOffice`, `PinOfficeApi`, `PinCall` (Task 16); `yearOffice`, `YEAR` (Task 17); `rowOf` (`rows.ts`), `TABLES`,
  `rowsOf` (`tables.ts`); `everyCall`; `OFFICE_COLLECTIONS`.
- Produces: `type ReadPin = { name: string; input: Record<string, unknown>; actorId: string; rowsRead: number; sinceHours?: number }`;
  `READ_PINS`; `type WritePin = { name: string; rowsWritten: number }`; `WRITE_PINS`; `COLD_EXTRA_ROWS`; `IMPORT_ROWS_PER_RECORD`.

- [ ] **Step 1: Write the pins with the wave 0 numbers as the first ceilings**

```ts
/**
 * The rows pins of test:office (Supabase exit, wave 1, wave 0 change 3). Each ceiling started at the wave 0 number of the same
 * read (proof.md, "Wave 0, the rest"), then Task 18 set it to the measured rows of the year office, plus 10%. A read above its
 * ceiling fails the suite: look at its statements first, then change the read or (with a reason in proof.md) the ceiling.
 * usr_001 is the Admin, usr_002 leads projects, usr_005 is a member of the sample office.
 */
export type ReadPin = { name: string; input: Record<string, unknown>; actorId: string; rowsRead: number; sinceHours?: number };

export const READ_PINS: readonly ReadPin[] = [
  { name: 'chats.unreadCount', input: {}, actorId: 'usr_005', rowsRead: 21_064 },
  { name: 'chats.unreadCount', input: {}, actorId: 'usr_001', rowsRead: 56_258 },
  { name: 'chats.list', input: {}, actorId: 'usr_001', rowsRead: 56_516 },
  { name: 'notifications.count', input: {}, actorId: 'usr_005', rowsRead: 2_585 },
  { name: 'notifications.list', input: {}, actorId: 'usr_005', rowsRead: 4_934 },
  { name: 'tasks.list', input: { filter: 'mine' }, actorId: 'usr_005', rowsRead: 5_432 },
  { name: 'tasks.list', input: { filter: 'review_for_me' }, actorId: 'usr_002', rowsRead: 3_200 },
  { name: 'projects.list', input: { status: 'all' }, actorId: 'usr_001', rowsRead: 5_094 },
  { name: 'dashboard.get', input: {}, actorId: 'usr_001', rowsRead: 6_015 },
  { name: 'search.query', input: { text: 'plan' }, actorId: 'usr_005', rowsRead: 3_059 },
  { name: 'search.query', input: { text: 'zqxv' }, actorId: 'usr_005', rowsRead: 8_074 },
  { name: 'events.list', input: { limit: 50 }, actorId: 'usr_001', rowsRead: 680 },
  { name: 'events.list', input: { limit: 500 }, actorId: 'usr_001', rowsRead: 653, sinceHours: 1 },
];

export type WritePin = { name: string; rowsWritten: number };

/** The rows that one write of everyCall writes on the year office (wave 0: 39, 36, 44, 22). */
export const WRITE_PINS: readonly WritePin[] = [
  { name: 'tasks.complete', rowsWritten: 39 },
  { name: 'tasks.update', rowsWritten: 36 },
  { name: 'comments.create', rowsWritten: 44 },
  { name: 'chats.send', rowsWritten: 22 },
];

/** The rows that a cold wake may add to a call: the schema version row, and the snapshot parts (wave 0: 1 row). */
export const COLD_EXTRA_ROWS = 4;
/** The rows that the import writes for each record, at most (wave 0: 980,549 for 138,053 records, 7.1). */
export const IMPORT_ROWS_PER_RECORD = 7.5;
```

- [ ] **Step 2: Write the pins test**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyCall } from '../core/everyCall';
import { OFFICE_COLLECTIONS } from '../core/types';
import type { OfficeLists } from '../data/lite/office';
import { rowOf } from '../data/rows';
import { TABLES, rowsOf } from '../data/tables';
import type { State } from '../../src/api/store';
import { startOffice } from './test/harness';
import { COLD_EXTRA_ROWS, IMPORT_ROWS_PER_RECORD, READ_PINS, WRITE_PINS } from './test/pins';
import { yearOffice } from './test/yearOffice';

const TODAY = '2026-10-04';
const NOW = '2026-10-04T12:00:00.000Z';
const MEASURE = process.env.MADAR_PINS_MEASURE === '1';
const PART = 2_000;

describe('the rows pins on one year of data (server/office/test/pins.ts)', () => {
  let started: Awaited<ReturnType<typeof startOffice>>;
  let year: State;
  let records = 0;
  let written = 0;

  beforeAll(async () => {
    started = await startOffice();
    year = await yearOffice(TODAY);
    const office = started.office('year');
    for (const spec of TABLES) {
      const rows = rowsOf(year, spec).map((row) => rowOf(spec, row.doc, year));
      records += rows.length;
      for (let at = 0; at < rows.length; at += PART) written += (await office.load(spec.table, rows.slice(at, at + PART))).rowsWritten;
    }
    const lists = Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, year[c]])) as unknown as OfficeLists;
    written += (await office.finish(lists, year.counters)).rowsWritten;
  }, 900_000);

  afterAll(async () => {
    await started?.server.close();
  });

  it('imports the year office at no more rows written for each record than wave 0', () => {
    if (MEASURE) console.info(`import: ${records} records, ${written} rows written, ${(written / records).toFixed(2)} for each record`);
    expect(written / records).toBeLessThanOrEqual(IMPORT_ROWS_PER_RECORD);
  });

  it('keeps each heavy read under its ceiling of rows read', async () => {
    const office = started.office('year');
    const over: string[] = [];
    for (const pin of READ_PINS) {
      const input = pin.sinceHours ? { ...pin.input, since: new Date(Date.parse(NOW) - pin.sinceHours * 3_600_000).toISOString() } : pin.input;
      const { result, rows } = await office.call({ name: pin.name, input, actorId: pin.actorId, now: NOW });
      expect(result.ok, `${pin.name} ${JSON.stringify(input)}`).toBe(true);
      if (MEASURE) console.info(`read pin: ${pin.name} ${JSON.stringify(input)} as ${pin.actorId}: ${rows.rowsRead} rows read (ceiling ${pin.rowsRead})`);
      if (rows.rowsRead > pin.rowsRead) over.push(`${pin.name} ${JSON.stringify(input)} as ${pin.actorId}: ${rows.rowsRead} > ${pin.rowsRead}`);
    }
    expect(over).toEqual([]);
  });

  it('keeps each write under its ceiling of rows written', async () => {
    const office = started.office('year');
    const over: string[] = [];
    for (const pin of WRITE_PINS) {
      const c = everyCall(year).find((one) => one.name === pin.name)!;
      const { result, rows } = await office.call({ name: c.name, input: c.input, actorId: c.actorId, now: NOW });
      expect(result.ok, pin.name).toBe(true);
      if (MEASURE) console.info(`write pin: ${pin.name}: ${rows.rowsWritten} rows written (ceiling ${pin.rowsWritten})`);
      if (rows.rowsWritten > pin.rowsWritten) over.push(`${pin.name}: ${rows.rowsWritten} > ${pin.rowsWritten}`);
    }
    expect(over).toEqual([]);
  });

  it('reads at most a few more rows on the first call after the office object slept', async () => {
    const c = { name: 'notifications.count', input: {}, actorId: 'usr_005', now: NOW };
    const warm = (await started.callByFetch('year', c)).rows.rowsRead;
    await started.evict('year');
    const cold = (await started.callByFetch('year', c)).rows.rowsRead;
    if (MEASURE) console.info(`cold wake: ${cold - warm} more rows read`);
    expect(cold - warm).toBeLessThanOrEqual(COLD_EXTRA_ROWS);
  });

  it('never makes the statistics table of ANALYZE', async () => {
    expect(await started.office('year').statTables()).toBe(0);
  });
});
```

Note: the write pins run after the read pins, and the cold wake after both; each test leaves the year office in a state that the
next test accepts (writes only add rows).

- [ ] **Step 3: Measure**

Run: `MADAR_PINS_MEASURE=1 npm run test:office -- server/office/pins.wd.test.ts 2>&1 | tee $TMPDIR/pins-1.log | grep -E 'pin:|import:|cold wake:'`
Expected: one line for each pin, the import line and the cold wake line. Some read pins may fail at their wave 0 ceiling (the
sample office has 10 people, so each person holds more rows than in wave 0).

- [ ] **Step 4: Set each ceiling to the measured value plus 10%**

For each read and write pin: when the measured value is at or below the wave 0 ceiling, write `Math.ceil(measured * 1.1)` as the
new ceiling. When it is above: call it again with `trace: true` in a one-off run (for example
`console.table((await office.call({ ...c, trace: true })).trace?.sort((a, b) => b.rowsRead - a.rowsRead).slice(0, 10))`), find the
statement that reads most, and fix the read first (an index that is not there, a list that is not key by key, an outer sort) with a node
test that pins its SQL text. Raise a ceiling over its wave 0 value only with a reason in proof.md. The badge pins (`chats.unreadCount`,
`chats.list`) keep their measured value until Track R merges, then drop to the measured value of the stored unread number.

- [ ] **Step 5: Cut the event indexes**

The event reads and the index that each one needs (map of reads 8 and 9.3): `events.list` (`events_seq`, `events_project` with a
project, `events_target` with a target, `events_story` with a story, `events_created_at` with since), the feed of
`projects.list` (`events_project_created`), `dashboard.get` reviews (`events_target`), the gone targets of
`notifications.list` (`events_target_id`), `undoLinks` and `notUndone` (`events_undoes`), the email producer (`events_target`).
For each of `events_project`, `events_target_id`, `events_project_created` and `events_story`, in this order:
1. Call `office.dropIndex(<name>)` on the year office in a one-off test run (`MADAR_PINS_MEASURE=1`), then run the read pins again.
2. Keep the index out when every read pin stays under its ceiling; else put it back in your notes and go to the next one.
Then measure `tasks.update` rows written with the kept set (each event index costs one row written for each event).

- [ ] **Step 6: Write the kept set into the schema**

Remove the cut indexes from `LITE_INDEXES` in `server/data/lite/schema.ts`, set `LITE_SCHEMA_VERSION = 2` (no office object is
deployed yet, so no schema step is needed), run `npx vitest run --project server server/data/lite/schema.test.ts`, copy the new
`sha256` into `PINNED_SHA256` and change the pinned version to 2. Then run:
`npx vitest run --project server server/data/lite && npm run test:lite && npm run test:office`
Expected: all PASS; the plan pin test of Task 11 shows no sort in a cut.

- [ ] **Step 7: Write the section in proof.md**

Append `### Wave 1: the rows pins on one year of data (<the date of the run>)`: a table "Read | Person | Wave 0 rows | Wave 1 rows | Ceiling",
the write pins, the import rows for each record, the cold wake rows, the kept and cut event indexes with the numbers of Step 5, and
the day estimate of `scripts/proof/do-rows/day.mjs` with the new numbers (rows read of a day as a share of the Free 5 million).

- [ ] **Step 8: Commit**

```bash
git add server/office/test/pins.ts server/office/pins.wd.test.ts server/data/lite/schema.ts server/data/lite/schema.test.ts docs/superpowers/real-build/proof.md
git commit -m "Exit wave 1: the rows pins of the heavy reads on one year of data, and the event indexes cut to the reads"
```

---

### Task 19: The guides, the records and the merge gate of wave 1

**Files:**
- Modify: `server/data/CLAUDE.md` (a new section "The SQLite path"), `server/CLAUDE.md` (section Tests), `CLAUDE.md` (section
  Commands), `supabase/CLAUDE.md` (section Migrations), `TASKS.md`, `docs/superpowers/real-build/proof.md`

**Interfaces:**
- Consumes: the results of Tasks 1 to 18.
- Produces: the merged wave 1 that waves 2 and 3 start from.

- [ ] **Step 1: Add the section to `server/data/CLAUDE.md`**

```markdown
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
- A schema change bumps `LITE_SCHEMA_VERSION` and `PINNED_SHA256` in `lite/schema.test.ts`. After the first office object
  deploys (wave 3), each version also needs a step in `applyLiteSchema`.
- `test:lite` runs the rule tests and the shadow run on node:sqlite; `test:office` runs the host checks, the `everyCall`
  parity and the rows pins on local workerd. Keep both green when you change a loader read or the save.
```

- [ ] **Step 2: Add the lines to the other guides**

`server/CLAUDE.md`, section Tests, after the `test:db` line:
`- npm run test:lite runs the rule tests again on node:sqlite (the SQLite path of the office object, no Docker). npm run test:office runs the office object on local workerd: the host checks, everyCall on the sample office, and the rows pins on one year of data (server/office/test/pins.ts).`

`CLAUDE.md` (root), section Commands, after the `test:db` lines:
`- npm run test:lite - the src/api rule tests and the shadow run on node:sqlite, no Docker (Supabase exit, wave 1).`
`- npm run test:office - the office object on local workerd (wrangler createTestHarness): host parity, everyCall parity, the rows pins. Sandbox off when listen() fails with EPERM.`
and update the line "Last counts" with the counts of Step 4.

`supabase/CLAUDE.md`, section Migrations, at the end:
`- The office object has one SQLite schema (server/data/lite/schema.ts), not these migrations. Until the switch (wave 6), a new table or column needs both: a migration here and the SQLite schema with a new version.`

- [ ] **Step 3: Update `TASKS.md`**

Tick wave 1 of the Supabase exit. Add each item that Tasks 1 to 18 found and did not fix, one line each, with its wave: for
example "Wave 2: users.invites, users.resendInvite, agents.list, agents.remove on SQLite (LATER_CALLS)" and "Wave 3: usage.get,
usage.retryEffect on SQLite; the mail and push producers with the notice ids of the Diff".

- [ ] **Step 4: Run the merge gate**

Run, one after the other (Docker on, under the lock for the last two):
`git fetch && git rebase origin/main`,
`npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, `npm run build:remote -- test` (sandbox off),
`npm run test:lite`, `npm run test:office`,
`scripts/dev/docker-lock.sh run exit-db -- npm run test:db`, `scripts/dev/docker-lock.sh run exit-db -- npm run test:it`.
Expected: every one green. `npm test` has more tests than before (about 60 new); `test:db` and `test:it` have the same counts as
at the start of the wave; `build:server` and `check-bundles` show no `cloudflare:workers` import in the four bundles (wave 1 adds
no entry).

- [ ] **Step 5: Write the last section in proof.md**

Append `### Wave 1 of the Supabase exit: done (<the date of the merge>)`: the commit, the counts of each check of Step 4, and the open items of
`TASKS.md` for waves 2 and 3.

- [ ] **Step 6: Commit**

```bash
git add server/data/CLAUDE.md server/CLAUDE.md CLAUDE.md supabase/CLAUDE.md TASKS.md docs/superpowers/real-build/proof.md
git commit -m "Exit wave 1: the guides and records of the SQLite path, and the merge gate"
```

---

## B.3 Spec coverage of wave 1

| Spec wave 1 item (section 5, and the top notes) | Task |
|---|---|
| The DO adapter | 4 (node host), 5 (Db port), 16 (office object host) |
| One SQLite schema in place of 18 migrations, with a version the object applies at start | 6, 18 (version 2 after the index cut) |
| The query compiler | 9, 10, 11 |
| The save | 8 |
| The office snapshot | 7, 18 (cold wake pin) |
| `test:db` and the shadow run green on SQLite | 14, 15 |
| Change (2): sorts in JavaScript | 10, 11 (and Track R for Postgres) |
| Change (3): no ANALYZE, a rows-read pin for each heavy read | 6, 18 |
| Wave 0 rules: 100 values, `=` for one value, changed key columns only, plain columns, event index cut | 4, 9, 10, 8, 6, 18 |
| The object does no network work; no await on network, timer or crypto in a transaction | 1, 5, 16 |
| Production unchanged | every task: new files, or Postgres texts kept as they are |

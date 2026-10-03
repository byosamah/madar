# Madar real build: test map

**Date:** 2026-10-03
**For:** the people who build spec 2 (`docs/superpowers/specs/2026-10-03-madar-real-build-design.md`), section 16 "Tests".
**Status:** proposal. Nothing under `src/` changed. The numbers in sections 2 and 4 come from real runs on 2026-10-03 (method in section 11).

## 1. Summary

- The prototype has 1,640 tests in 167 files. All pass in 78 seconds on this Mac (10 cores).
- 476 of them are API rule tests in 36 files. They all start from one helper, `testApi()` in `src/test/factories.ts`. So one switch in that helper can send all of them to a real database.
- Db mode (the API tests on a local Supabase Postgres) is feasible with no change to the test files. A "mirror store" writes the test's in-memory office to the database before each call, runs the real load, run and save steps, then reads the office back into the same objects.
- Db mode is cheap: the API tests make 1,537 calls on small offices (median 14 records). The estimate is 10 to 40 seconds of database time, about 2 to 3 minutes for the whole continuous integration (CI) job.
- Screen tests do not run in db mode. They make 12,945 calls on the 942-record sample office and test what shows on screen, not the database. The browser tests against the test deployment cover the screens with the real server.
- Isolation: one database schema for each test worker, and one transaction for each test that the harness rolls back. The office lock key must come from the schema, or the workers block each other.
- The real build needs 15 new suites (section 7). Most run on the local Supabase stack in CI at no cost. Two need the test deployment: browser checks and the R2 smoke.
- Cost to watch: GitHub gives a private repository 2,000 CI minutes a month. The plan in section 6 uses about 1,500. Section 6 also lists what to cut if the count grows.

## 2. The tests today

### 2.1 Count by kind

| Kind | Files | Tests | Time in tests | Where |
|---|---|---|---|---|
| Pure logic: dates, grammar, board, seed, i18n, tokens | 41 | 242 | 1.7 s | `src/lib`, `src/data`, `src/i18n`, `src/design`, `src/app/*.ts`, `src/components/*.ts` |
| Pure API library: `can()`, events, health, notify, store, client, persist, errors, contract | 9 | 137 | 0.2 s | `src/api/*.test.ts` (no `testApi`) |
| API rules through `testApi()` | 36 | 476 | 2.7 s | `src/api/handlers/*.test.ts`, `src/api/calls.test.ts`, `src/api/notifyAudit.test.ts` |
| Screens, whole app (`renderApp`, `renderWithRuntime`) | 71 | 681 | 363 s | `src/features/**`, `src/app/*.tsx` |
| Screens, one component | 10 | 104 | 12.5 s | `src/components/*.tsx`, a few others |
| **Total (Vitest)** | **167** | **1,640** | 78 s wall time | |
| Browser checks (Playwright) | 11 | 51 | not measured | `tests/e2e/*.spec.ts` |

"Time in tests" is the sum of test times. The screen tests use 98% of it. The API tests spend 66% of their own run time on the start of jsdom (the test browser), which they do not need.

### 2.2 What the API tests do, measured

A probe wrapped `createApi` and logged each call of the 613 tests under `src/api` (section 11).

| Measure | Value |
|---|---|
| Calls | 1,537 in 478 tests |
| Calls for each test | median 3, 90th percentile 6, highest 46 |
| Change calls / read calls | 1,162 / 375 |
| Calls that end in an error (permission refusal, conflict, bad input) | 384 (25%). Each one tests the rollback. |
| Office size at each call | median 14 records (5.3 KB). 21 calls run on the 942-record sample office (`insights`, `tasksAudit`, `system`). |
| Call names that no API test calls | 8: `updates.delete`, `projects.clearHealthOverride`, `members.update`, `deadlines.update`, `deadlines.delete`, `users.list`, `users.get`, `clients.list` |

### 2.3 How the API tests set up data

These habits decide the db-mode design. The counts come from `grep` over the test files.

| Habit | Count | Example |
|---|---|---|
| Build the office with `makeWorld()` and the `make*` factories | all 36 files | `t.store.state.tasks.tsk_001 = makeTask({...})` |
| Write to `t.store.state` directly, before or between calls | 164 lines that start with `t.store.state` | `t.store.state.counters.tsk = 1` |
| Keep a handle on the whole office, then read it after calls | 37 places in 12 files | `const s = t.store.state; ... expect(s.tasks.tsk_002.status)` |
| Keep a handle on one record, then read it after calls | 5 places | `const b = t.store.state.tasks.tsk_002` |
| Pass a prepared office into `testApi(calls, state)` | 22 places | `testApi(insightCalls, world())` |
| Move the clock with `setNow()` | 39 test files. In the API tests, 13 lines move it inside a test. | `tasksAudit.test.ts` moves day by day |
| Change the current person with `t.as(userId)` | most tests | writes `session.currentUserId` |
| Pass a story ID that the test makes up | 127 calls with `{ correlationId: 'cor_...' }`, 60 `events.undoStory` inputs | `'cor_late'` |
| Check an exact new ID | 56 checks | `expect(id).toBe('tsk_002')` |
| Send or check file data (a `Blob`, or the persister) | 5 files, 50 tests | `files`, `feedback`, `contentAudit`, `tracker`, `projectsAudit` |

The screen tests start from the full sample office (`buildSeed`), with an optional `prepare(state)` step. Their probe: 12,945 calls in 675 tests, median 15 calls for each test, 96% reads.

## 3. Db mode: the design

### 3.1 Goal

Spec 2, section 16: "The same test must pass on both." Db mode runs the current API test files, with no edit to them, against the real load, run and save steps (spec 2, section 5.3) on a local Supabase Postgres.

### 3.2 Options

| Option | How | Verdict |
|---|---|---|
| A. Mirror store (recommended) | `testApi()` returns a store whose `state` is an in-memory mirror. Each `api.call` writes the mirror's changes to the database, runs the real server core, and reads the office back into the mirror. | No test file changes. One switch in `factories.ts`. Uses only functions the server needs anyway. |
| B. Sync inside `Store.run` | Teach the prototype `Store` to talk to Postgres. | Mixes test code into the product store. Rejected. |
| C. SQL fixtures | Rewrite each test to seed with SQL. | 476 tests to rewrite, and the "same test" promise breaks. Rejected. |
| D. HTTP mode | Send each test call to `supabase functions serve`. | About 10 times slower, and `setNow()` cannot reach another process. Keep it for a small smoke suite only (section 7, suite 6). |

### 3.3 How the mirror store works

When the environment variable `MADAR_DB=1` is set, `testApi()` returns the db version. It stays synchronous, so `t.store.state` is ready at once, as today. All database work waits for the first call.

For each `t.api.call(name, input, meta)`:

1. **Check the name** against the call map that the test passed in, as `createApi` does today.
2. **Write down.** Compare the mirror with the last known database image. Write each difference (the test's direct edits) as the setup role, with no rule checks. The first call writes the whole test office, about 14 records.
3. **Map story IDs.** A story ID that the test made up (`'cor_late'`) gets a real one from `story.start`, as the current person. The adapter keeps a map in both directions and changes `correlationId` in `meta` and in inputs.
4. **Run the real core:** `runCall(deps, { actorId, name, input, meta })`. The actor ID comes from `mirror.session.currentUserId`. This is the only place where a test chooses the person without a sign-in token. The HTTP handler never has this path.
5. **Read back** the whole office, events too, and merge it into the mirror **in place**. Records keep their object identity, so `const s = t.store.state` and `const b = s.tasks.tsk_002` still see the new values. Removed records go, and new records come in. Story IDs map back to the test's names.
6. **Run the free checks** of section 3.5.
7. **Return** the output, or throw the same `ApiError` with the same `code`.

`t.store.persister` gives the file methods (`putBlob`, `getBlob`, `deleteBlob`) of a fake R2 store. So `projectsAudit.test.ts` can still check that file data is gone after a project delete.

### 3.4 What the server must give the harness

These are requirements on the server design. Without them, db mode needs edits in the test files.

| # | Requirement | Why |
|---|---|---|
| R1 | One core function, `runCall(deps, request)`, used by the `api` function, the `mcp` function and the tests. Sign-in happens before it, not inside it. | The tests and both functions run the same rules. |
| R2 | `deps.sql` accepts a transaction that the caller opened. The server's own transaction then becomes a savepoint. | Rollback isolation (section 5). |
| R3 | `deps.now()` for the clock. The tests pass the `now()` of `src/lib/dates`. | `setNow()` keeps working (39 files). |
| R4 | `deps.files`, `deps.mail` and `deps.signal` as interfaces, with fakes for tests. | No R2, Resend or Realtime traffic in db mode. |
| R5 | `loadOffice(sql, { withEvents: true })` and `saveDiff(sql, before, after)` as public functions. | Steps 2 and 5 reuse the server's own load and save code. |
| R6 | The key of `pg_advisory_xact_lock` comes from config. In tests it comes from the worker's schema. | Advisory locks are for each database, not each schema. One fixed key makes all workers wait for each other. |
| R7 | A `counters` table and the same ID form (`tsk_002`), under the same lock. | 56 checks of exact IDs. Event `seq` and Undo order use the counters too. |
| R8 | The load step returns records in the order of insertion: an `ord bigserial` column, `ORDER BY ord`. | Rules use `Object.values()` order. `ORDER BY id` fails after 999 records (`tsk_1000` sorts before `tsk_999`). |
| R9 | Absent optional fields come back absent, not `null`. Stamps stay text with the `+03:00` offset. Numbers come back as numbers. | `toEqual` treats `null` and absent as different. A `timestamptz` column would come back in another form. |
| R10 | The load step makes `undoneBy` from the `undo` events (spec 2, section 5.6). | The tests read `undoneBy`. |
| R11 | Foreign keys are `DEFERRABLE INITIALLY DEFERRED`, and the save step ends with `SET CONSTRAINTS ALL IMMEDIATE`. | The save step can write in any order. Under rollback isolation no commit happens, so without the last statement no foreign key is ever checked. |

### 3.5 Free checks on every call

The adapter checks these after each call. A failure names the call and the record.

1. **Shadow run.** The adapter also runs the call in memory on a copy of the mirror (under 1 ms) and compares the output and the full office with the database result. It ignores only story IDs and random blob keys. A difference shows a load step that left out a record, or a save step that dropped a change. Example: `isUsedElsewhere()` in `events.ts` scans every collection before an Undo deletes a record. A load step that loads one project only gives a wrong answer there.
2. **A failed call writes nothing.** The row checksums before and after are the same.
3. **A read call writes nothing** and sends no change signal.
4. **The events table only grows.** No event row changes or goes away.
5. **One change signal** for each saved change call, with the right project.

### 3.6 Known gaps between memory and database

| Gap | Effect in db mode | Fix |
|---|---|---|
| Server-made story IDs (spec 2, 5.5) | 187 places with a made-up ID would fail | Adapter map (3.3, step 3) |
| Test edits that break a database rule (unknown project, `null` in a required column) | The write-down step fails | Expect a few. The error names the record and the rule. Fix the test data. |
| File data in the call input (`files.upload` takes a `Blob`) | Works through the fake R2 | When the upload moves to signed links (spec 2, section 8), rewrite the file parts of these 5 files. Do not keep the old form. |
| `ctx.persistent` | Always `true` on the server | Only `session.get` shows it. Ignore it in the shadow run. |
| Pure helper tests in handler files that call a function on a state, with no API call | They run in memory, also in db mode | No action. They cost nothing. |

## 4. Speed, and what runs in db mode

### 4.1 Estimate

There is no Postgres on this Mac yet, so these are estimates. Step 2 of the build must measure them.

| Part | Assumption | Cost |
|---|---|---|
| One call, server side: savepoint, lock, load, save, release | 5 to 30 statements at 0.2 to 0.5 ms (Linux runner, local Docker) | 3 to 15 ms |
| One call, adapter: write-down plus read-back | 1 to 25 statements | 1 to 10 ms |
| One test: begin plus rollback | 2 statements | about 1 ms |
| **API tests, 1,537 calls** | 5 to 25 ms for each call | **10 to 40 s of database time, one worker** |
| Same, 2 workers (a private GitHub runner has 2 virtual CPUs) | | 5 to 20 s |
| `supabase start` with Postgres only, image download included | | 30 to 60 s |
| **Whole db job** with `npm ci` and Vitest start | | **about 2 to 3 minutes** |

Gate: the db job fails when the db-mode tests take more than 120 seconds, or when a call takes more than 25 ms on average. This catches a slow load step early.

The same mirror for the screen tests would write the 942-record office before each of 675 tests and add 12,945 calls. That is 2 to 9 more minutes, for tests that check the screen, not the store. They stay in memory.

### 4.2 The db-mode set

| Group | Files | Tests | Db mode |
|---|---|---|---|
| API rule tests through `testApi()` | 35 | 474 | Yes, all. The 5 file data files use the fake R2 until the upload contract changes. |
| `system.test.ts` (`session.resetSampleData`) | 1 | 1 | No. The call goes away. |
| The "Preview as" test in `people.test.ts` | (in the 35) | 1 | No. The call goes away. |
| Pure API library: `can()`, events, health, notify, store, client, persist | 9 | 137 | No. They test the in-memory parts. Suite 2 covers the server versions. The `runScheduledTriggers` cases of `notify.test.ts` and `notifyAudit.test.ts` also run through a small `runJob(sql, at)` wrapper (suite 10). |
| Pure logic and screens | 122 | 1,027 | No |

The exclusions live in one list, `server/test/db-mode.skip.ts`, with a reason for each line. CI fails when the list grows without a change to that file.

## 5. Isolation between tests

1. **One schema for each worker:** `madar_w1`, `madar_w2`, from `VITEST_POOL_ID`. The global setup step drops and makes these schemas, then applies `supabase/migrations/*.sql` with `search_path` set to the schema. For a schema of about 25 tables this takes 1 to 2 seconds.
   - So the migrations must not write `public.` in table names.
   - The platform parts (the `pg_cron` schedule, the Realtime publication) go in a separate migration that the harness leaves out.
   - Not one database for each worker: Supabase services and the `pg_cron` worker keep connections open to the main database, and then `CREATE DATABASE ... TEMPLATE` fails.
2. **One transaction for each test.** The first call opens `BEGIN` on the worker's connection. An `afterEach` in the db setup file sends `ROLLBACK`. This costs about 1 ms and leaves no data behind.
3. **The lock key comes from the schema** (R6). Without this, a test that holds the lock until its rollback stops every other worker.
4. **Leak guard.** An `afterAll` checks that every table in the schema is empty. A row there means that some code committed outside the test transaction.
5. **Fallback.** If R2 (the caller's transaction) is not possible, use one `TRUNCATE` of all tables before each test: 10 to 30 ms, so 5 to 15 s more in total.
   - The events guard (no `UPDATE`, no `DELETE`) uses row triggers, which `TRUNCATE` does not fire.
   - Give `TRUNCATE` only to the owner role.
6. **Suites that need real commits** (the lock suite, Realtime, backup restore) use their own schema, commit for real, `TRUNCATE` between tests, and run one file at a time.

## 6. Continuous integration (CI)

### 6.1 Jobs

| Job | When | Steps | Needs | Time |
|---|---|---|---|---|
| `unit` | every push | `npm ci`, type check, `vitest --project unit` (jsdom), build | nothing | about 5 min (1,640 tests use 9.4 CPU minutes, so about 5 minutes on 2 virtual CPUs) |
| `db` | pull requests and `main` | `supabase/setup-cli`, `supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`, `MADAR_DB=1 vitest --project db` (Node environment) | `DATABASE_URL` from `supabase status -o env` | 2 to 3 min |
| `integration` | pull requests and `main` | full `supabase start`, a MinIO service container (S3-compatible, stands in for R2), `supabase functions serve`, `vitest --project it` | the fixed local keys from `supabase status` | 5 to 7 min |
| `e2e-deploy` | nightly on working days, before each production deploy, by hand | seed the test office, Playwright on the Cloudflare Pages preview | secrets: test project URL and service key, test database URL, test passwords | 10 to 20 min |
| `backup` | nightly, 02:00 Riyadh (spec 2, 13) | `pg_dump`, encrypt, upload | production database URL, encryption key, second-place keys | 2 to 3 min |
| `restore-check` | monthly | download, decrypt, restore into a Postgres container in the job, run the checks of suite 14 | the same keys, read only | about 5 min |

Vitest 5 "projects" in `vite.config.ts` define `unit`, `server`, `db` and `it`. The `unit` project keeps today's config.

The `unit`, `db` and `integration` jobs need no secrets. The local stack has fixed keys.

### 6.2 Minutes budget

GitHub gives a private repository 2,000 CI minutes a month on the free plan.

| Use | Count a month | Minutes |
|---|---|---|
| Pull request pushes: `unit` + `db` + `integration` | 40 x 15 | 600 |
| Merges to `main`: the same three jobs | 20 x 15 | 300 |
| Other branch pushes: `unit` only | 30 x 5 | 150 |
| `e2e-deploy` on working days | 22 x 15 | 330 |
| `backup` and `restore-check` | 30 x 3 + 5 | 95 |
| **Total** | | **about 1,475** |

Rules that keep it under the limit:

- Cancel the older run when a new push comes (a `concurrency` group).
- Run `db` and `integration` only for pull requests and `main`.
- If the count passes 1,600, move `e2e-deploy` to 3 nights a week, or add a self-hosted runner on an office Mac (no minute cost).

## 7. New test suites for the real build

| # | Suite | Main cases | Where | Runs on | When |
|---|---|---|---|---|---|
| 1 | Db mode | Section 3 | harness in `server/test/`, tests stay in `src/api/` | Postgres only | `db` job |
| 2 | Server core | `runCall`: agent acts with its person's rights; inactive person refused; output shape rolls back; story IDs only from the server, same person, under 24 hours (spec 2, 5.5); `ApiError` to HTTP status | `server/core/*.test.ts` | Node, no database | `unit` |
| 3 | Sign-in | email and password; wrong password; open sign-up off; no token gives 401; expired token gives 401; a turned-off person's valid token gives 403 (the server checks `users.active` on each call); role comes from Madar's `users` table, not from the token; rate limit; first-Admin script run twice makes one Admin | `server/it/auth.it.test.ts` | Supabase Auth + Mailpit (local mail catcher) | `integration` |
| 4 | Invitations and password reset | Admin invites, mail arrives in Mailpit, link sets a password, person signs in; a non-Admin cannot invite; second invite to the same email refused; old link expires; reset mail in the person's language | `server/it/invites.it.test.ts` | Supabase Auth + Mailpit | `integration` |
| 5 | Advisory lock under parallel writes | 20 parallel `tasks.create`: all succeed, IDs unique with no gap, event `seq` strictly up; `tasks.complete` and `tasks.delete` on one task at once: one wins, the other sees the new state; a read during a held write lock does not wait and never sees half a story; lock wait has a limit (`lock_timeout`), and the call then returns "busy" | `server/it/lock.it.test.ts` | Postgres, real commits, one file at a time | `integration` |
| 6 | Batch request | order kept; a read after a write in one batch sees the write; one failed call does not change the others (if the batch is not atomic, see section 9); size limit; one sign-in check, one `can()` check for each call; a batch counts as one server call on the usage meter; the same smoke on Deno (`supabase functions serve`) and on the Node build (spec 2, 5.1) | `server/http/*.test.ts` (in-process `app.fetch`), `server/it/batch.it.test.ts` | Postgres + edge runtime | `unit` + `integration` |
| 7 | Realtime change signals | one message on the private office channel after a commit, with the project and record kinds; none after a rollback or a read; a signed-out client and a turned-off person cannot listen; the screen loads again only the lists of that project | `server/it/realtime.it.test.ts`, `src/app/signals.test.ts` (fake channel, jsdom) | Supabase Realtime | `integration` + `unit` |
| 8 | R2 signed links | upload link valid 10 minutes, then refused; download link the same; the server checks size and type with a `HEAD` after the upload; a file over 250 MB refused; a PUT with another size than the signed one refused; project delete removes file data only after the commit | `server/files/*.test.ts`, `server/it/files.it.test.ts` | MinIO in CI; one smoke on a real R2 test bucket in `e2e-deploy` | `unit` + `integration` + `e2e-deploy` |
| 9 | Email and its limits | each template in English and Arabic (right-to-left), with snapshots; the default switches (assigned, review, mention on; the rest off); notice 91 of the day stays in the app; the Admin gets one warning a day; the day starts at midnight Riyadh, not UTC; Supabase sign-in mail goes through the Resend SMTP | `server/mail/*.test.ts`, `server/it/email.it.test.ts` | outbox fake; Mailpit | `unit` + `integration` |
| 10 | Timed work | the current `notify.test.ts` cases through the database; a second run in the same 15 minutes sends nothing new; the morning summary goes once at 07:30 Riyadh on working days (Sunday to Thursday) only; the `pg_cron` schedule exists | `server/jobs/*.test.ts` | Postgres | `db` |
| 11 | Database guards | every migration applies to an empty database; every table has Row Level Security (RLS) on and no policy for the browser roles; the public key reads nothing through the REST endpoint; `UPDATE` and `DELETE` on `events` fail for every role; table columns match the zod fields (a drift check) | `server/it/guards.it.test.ts` | full local stack | `integration` |
| 12 | MCP conformance | `server/discover`; `tools/list` in a fixed order with `ttlMs` and `cacheScope: "private"`; each tool's JSON Schema 2020-12 compiles (Ajv 2020) and accepts the zod samples; `input_required` for a stage move back and a date change; no session needed between requests; OAuth 2.1 with PKCE (Proof Key for Code Exchange); Protected Resource Metadata (RFC 9728); 401 carries a `WWW-Authenticate` header (the test must check that the header is there, not only that nothing failed); a token for another resource is refused; Settings, Agents removes access at once; the History shows the agent and its person | `server/mcp/*.test.ts`, `server/it/mcp.it.test.ts`, plus the official runner `@modelcontextprotocol/conformance` (version 0.1.16 today; check at build step 6 that it covers 2026-07-28) | full local stack | `unit` + `integration` |
| 13 | Usage meter and limit warnings | server calls, database size, R2 storage, emails; one email to the Admin when a limit passes 80%, not one for each request | `server/usage/*.test.ts` | Node | `unit` |
| 14 | Backup and restore | the dump decrypts; the restore applies to an empty Postgres; row counts match the dump's manifest; the events guard still works after the restore; a read call (`dashboard.get`) runs on the restored data; a sample of R2 files is in the weekly copy; a backup older than 26 hours raises an alert | `scripts/restore-check.ts`, `.github/workflows/backup.yml` and `restore-check.yml` | the backup job | nightly + monthly |
| 15 | Browser checks on the test deployment | today's 11 Playwright files, moved to the test deployment; sign-in for 4 roles once, saved as `storageState`; English and Arabic, light and dark, phone (390) and computer (1440) (spec 2, 16); one invite flow from the Admin screen to the first sign-in | `tests/e2e-deploy/*.spec.ts`, `playwright.deploy.config.ts` | the second Supabase project + a Cloudflare Pages preview | `e2e-deploy` |

Notes on suite 15:

- The current browser tests use the sample office (`/projects/prj_001`, "Gulf Crest").
- The real build starts empty, so a seed script writes the sample office into the test project with the same writer as db mode: `writeState(sql, buildSeed(today))`. The routes of the current tests then still work.
- The seed script also makes the 4 test accounts through the Supabase Auth admin interface.
- The test deployment sends no real email. Its mail driver writes to an `outbox` table. Real mail would use the production Resend quota of 100 a day.
- The monthly restore check (suite 14) does not restore into the test project, so it never wipes the test office. Spec 2, section 13 also asks for one restore into the second Supabase project at build step 7. Do that one by hand, then run the seed script again.

A client parity test also goes in `unit`: `src/api/httpClient.test.ts` checks that the new `createHttpApi` has the same `Api<M>` type as `createApi`. It also checks that it groups the calls of one moment into one batch, and that it gives back the same `ApiError` codes (fake `fetch`).

## 8. Changes to the current tests

1. **Removed controls.** 10 tests depend on "Preview as", "Reset sample data" or "Simulate errors".
   - 4 of them (the V-22 "next person sees no draft of the person before" tests) keep their purpose. Their trigger changes to sign-out and sign-in of another person on the same device.
   - 1 test (`AppShell`, the person menu) keeps its place. Its list of menu items changes.
   - 5 go with the controls: the Preview as list in `people.test.ts`, `system.test.ts`, two Settings tests (SHL-8, V-27) and one Admin preview test.
   - The 8 tests in `seed.test.ts` stay, because the sample office stays as test data.
   - The `failFirst` option of `renderApp` stays. It stands for a network failure, not for the switch.
2. **Eight calls with no API test** (section 2.2). Add one API test for each before db mode starts. Otherwise db mode never checks their load and save steps.
3. **File size.** `files.test.ts` "refuses a file over 25 MB" makes a 25 MB blob. The real limit is 250 MB (spec 2, section 8). The new test must check the declared size, not make a 250 MB blob.
4. **Call count.** The call map has 112 names today (`calls.test.ts` checks the list). Without the 3 controls that spec 2, section 3 removes, 109 stay. Spec 2 says 108. Find the one name and fix the spec or the map.
5. **Test environment.** The API tests probably do not need jsdom (Node 22 has `Blob`). The `db` and `server` projects use the Node environment. That removes most of their start time.

## 9. Decisions this map needs

| Question | Why it matters | Proposal |
|---|---|---|
| Is a batch one transaction, or one transaction for each call? | Suite 6 checks one or the other | One transaction for each call, results in order, an error for each item |
| Does the morning summary count in the 90 emails a day? | Suite 9 | Yes, it counts |
| Sign-in mail (invitations, resets) also uses the Resend quota of 100 a day, outside Madar's counter of 90 | 90 notices plus a busy invite day can pass 100 | Count sign-in mail in the same daily counter, or keep the notice limit at 80 |
| Can a test or local copy create users in Supabase Auth with the service key? | Suites 3, 4 and 15 | Yes, local stack and test project only |
| Where does the monthly restore check restore to? | Suite 14 | A Postgres container inside the job. The second Supabase project stays the test office. |

## 10. Proposed layout

If the server report picks other folder names, the names change, but the split stays.

```
server/
  core/        runCall, load, save, lock          *.test.ts (unit, Node)
  http/        Hono app, /api/batch               *.test.ts (in-process app.fetch)
  mcp/         MCP function                       *.test.ts
  files/ mail/ jobs/ usage/                       *.test.ts
  test/        db-mode harness: dbApi.ts (mirror store), db.ts (schema for each worker,
               begin and rollback), fakes/ (R2, mail outbox, signals), invariants.ts,
               db-mode.skip.ts, global-setup.ts (migrations into each schema)
  it/          *.it.test.ts (integration, needs the local Supabase stack)
supabase/
  migrations/  numbered SQL; platform parts (cron, publication) in their own file
  functions/   api/, mcp/, jobs/: thin wrappers that import server/
tests/
  e2e/         today's Playwright files (prototype)
  e2e-deploy/  the same checks against the test deployment
scripts/       seed-test-office.ts, restore-check.ts, first-admin.ts
.github/workflows/  ci.yml (unit, db, integration), e2e-deploy.yml, backup.yml, restore-check.yml
```

## 11. Method

- Full run: `npx vitest run --reporter=json` on 2026-10-03. Result: 1,640 of 1,640 passed, 78 s wall time, 497 s user CPU plus 65 s system CPU on 10 cores.
- Call probe: a scratch Vitest config, outside the repository, that wrapped `createApi` with `vi.mock` and logged each call's name, read or change, office size and result. It ran on `src/api/**/*.test.ts` (613 tests) and on `src/**/*.test.tsx` (785 tests).
- Static counts: `grep` over `src/**/*.test.ts(x)`.
- The scratch files are in the session scratchpad, under `realbuild/probe/`. Nothing in the repository changed except this file.
- Not measured: Postgres timings. Build step 2 must replace the estimates in section 4.1 with real numbers.

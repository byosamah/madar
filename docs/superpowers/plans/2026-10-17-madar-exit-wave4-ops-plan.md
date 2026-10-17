# Madar Exit Wave 4 (Backups, Import, Deploy) and Wave 5 (the Test Copy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the office object of a copy its backups (a nightly export, a restore check), its data (an import from Postgres in
parts, a test seed, a reverse export back to Postgres) and a wrangler-only deploy with the new host word `office`; then move the
test copy to its office object for one week of use and a production rehearsal, while production stays on Supabase.

**Architecture:** Every operation runs in the office object, because only the object holds the database. The Worker checks a
secret header and hands each step to the object (`/api/office/export`, `import`, `peek`, `drop`), and it sends every other
`/api` route and every `/mcp` request into the object too (the sign-in, OAuth and MCP routes of wave 2 need the database). An
export and an import hold the office in memory (an export refuses writes for at most 5 minutes, an import refuses every call),
so each one reads or writes a consistent office in many small requests. Node scripts on the Mac and in GitHub drive the steps:
the export client writes one NDJSON file for each table with a sha256 manifest, the import client sends parts of at most 2,000
rows and refuses an office that does not fit one Free day, and the compare script checks the count and the hash of each table.

**Tech Stack:** TypeScript 7.0.2, Hono 4.13.12, Cloudflare Workers and Durable Objects (SQLite storage API, Workers RPC),
wrangler 4.147.0 (`createTestHarness`, `wrangler dev`, `deploy --var`), node:sqlite (Node 22.23.1), pg (the Postgres side),
age (encryption to the owner's key), GitHub Actions, vitest 5.0.2, Playwright (delegated helper only), zod 4.6.5.

**Spec:** `docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md` (top notes; section 2 rows "Backups" and "Deploy and
tests"; section 3; section 4, the move of the live data; section 7, decisions 5 and 6). The roadmap:
`docs/superpowers/plans/2026-10-17-madar-cloudflare-exit-plan.md`, Part A.2 rows "Wave 4" and "Wave 5", and A.3. The plans of
waves 2 and 3: `docs/superpowers/plans/2026-10-17-madar-exit-wave2-signin-plan.md` (Merge notes 13 and 14),
`docs/superpowers/plans/2026-10-17-madar-exit-wave3-live-plan.md` (Merge notes 8 and 14, Tasks 8, 13, 18, 19). Measured facts:
`docs/superpowers/real-build/proof.md`, every "Wave 0" and "Wave 1" section and the wave 2 and wave 3 sections. The code and
the proof.md facts beat this plan where they differ.

## Global Constraints

The list of the exit plan, as it is:

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
- Wave 0 rule: a rows-read pin test for each heavy read (Task 18 of wave 1).
- Wave 0 rule: at most 100 bound values in one statement (the office object refuses more).
- Wave 0 rule: `=` for one value, never a list of one value.
- Wave 0 rule: an update sets `doc` and only the key columns that changed.
- Wave 0 rule: key columns are plain columns that the save writes, never generated columns.
- Wave 0 rule: the event indexes are cut to the ones that a read needs (Task 18 of wave 1).
- Production stays on Supabase until wave 6: `config/server-host.json` production stays `supabase`, and no office object deploys to production before the switch. Wave 1 changes no behaviour of production. Track R is the one planned production change before the switch, through the normal release flow.
- The office object does no network work: mail, push, file links and R2 calls stay in the Worker.
- Inside an office object transaction, no await on the network, a timer or `crypto.subtle`.
- No foreign key in the SQLite schema: a broken deferred key resets the office object (map of schema and tests, fact 8).
- Playwright runs only in a delegated subagent. Every Docker or database task takes `scripts/dev/docker-lock.sh` first.
- One worktree for each track at `~/dev/madar-rb/<track>` (branch `rb/<track>`). A task edits only its own files.
- Never open, print, commit or log a secret.
- Every feature change updates the Model Context Protocol (MCP) side in the same commit (`server/mcp/tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS`). Wave 1 changes no feature, so it changes no MCP file.

The lines of wave 4:

- Worktree `~/dev/madar-rb/exit-ops`, branch `rb/exit-ops`, from main after the merge of wave 3 (its tip holds `rb/exit-live`).
  Each builder runs `git merge --ff-only main` first, runs only the test files of its own tasks with
  `--no-file-parallelism --testTimeout=60000`, and writes its report to `docs/superpowers/real-build/wave4-report-<block>.md` in
  the worktree before it returns (the main session deletes the reports at the merge).
- Nothing deploys in wave 4, and no copy changes. `config/server-host.json` stays `{"test":"supabase","production":"supabase"}`.
  No Worker gets a new secret, no GitHub secret or variable changes, and no workflow is turned on by hand. The code runs only in
  `npm test`, `test:lite`, `test:office`, `test:it` (merge lead) and on a local `wrangler dev`.
- The word `office` is open for the test copy only: `parseServerHostSetting` refuses `production: office` until wave 6 (Task 2).
- The new workflow `office-backup.yml` ends at its first step with success while `vars.OFFICE_BACKUP_URL` is not set, so it mails
  nobody before wave 5 (Task 9).
- The test tools (the `replace` mode of the import, the `peek` route) run only with the var `MADAR_TEST_TOOLS = "on"` and never
  on a copy whose `SUPABASE_URL` or `APP_URL` is production (Task 4). Production gets neither var (Task 18 pins it).
- Every new Worker route under `/api/office/` needs a secret header and compares it with `sameSecret`: `x-madar-export-secret`
  (the value of `MADAR_EXPORT_SECRET`, the GitHub export) or `x-madar-ops-secret` (the value of `MADAR_OPS_SECRET`, the Mac only).
  The secret values never go into a file of the repo, a log line or an argument: scripts read them from the environment or from
  `secrets/<env>.env` and send them on stdin or in a header.
- The import writes at most 2,000 rows in one request and refuses to start when the office needs more than the Free day allows
  (planned rows: records times 7.5, plus 2,000; the default limit is 90,000 rows written, minus the rows of the day so far).
- The schema stays `LITE_SCHEMA_VERSION = 3`: wave 4 adds no table and no column.
- MCP: no call, tool, `TOOL_DOCS` line or `INSTRUCTIONS` rule changes. The MCP side of this wave is the place where `/mcp` runs on
  the office path (inside the object, Task 1) and the `server/mcp/CLAUDE.md` line of Task 23.
- No screen that a person sees changes, so no screenshots are due for a screen change. The first local end-to-end run of the own
  sign-in (Task 22) takes the screenshots of the Madar sign-in screens that the wave 2 plan named (a delegated helper).

## Review Focus

1. **A person saves at 02:07 Riyadh while the nightly export holds the office.** Expected: the write gets the busy words (reason
   `busy`), a read still answers, a token refresh still works, and the hold ends by itself after 5 minutes even when the export
   client died. Tests: Task 4 ("refuses a write batch and serves a read batch while an export holds the office", "ends the hold by
   itself after 5 minutes", "lets the sign-in routes run while an export holds the office").
2. **The answer of an import part gets lost after the commit, and the client sends the same part again.** Expected: no row twice,
   no failure, and the import goes on. Test: Task 10 ("skips a part whose first row is there already").
3. **The office is larger than one Free day of writes (the year office needs 9.1 days).** Expected: the import refuses to start,
   says how many days it needs, and writes no row. Test: Task 12 ("refuses an office over the day budget and writes nothing").
4. **The word `office` and the new routes must leave production as it is.** Expected: production keeps `supabase`, the production
   Worker has no office binding and no test tools, `/api/office/*` on production answers 404, and `production: office` is refused.
   Tests: Task 2 ("refuses production: office until wave 6", "answers 404 for /api/office/* with no binding"), Task 18 ("gives the
   test Worker the day cap and the test tools, and production and local runs neither").
5. **A backup with a cut table, a changed byte, or a newer schema.** Expected: the restore check fails and names the table or the
   version, never a pass. Tests: Task 8 ("fails when a table file lost a row", "fails when a backup is of a newer schema").

## Facts checked for this plan (17 October 2026)

1. wrangler 4.147.0 `deploy --var KEY:VALUE` adds a `plain_text` binding to the deploy (`node_modules/wrangler/wrangler-dist/cli.js`:
   `collectKeyValues(args.var)` gives `cliVars`, and each one becomes `{ type: "plain_text", value }`). So `worker.sh` can set
   `MADAR_DATA = office` from the host word, and `wrangler.server.toml` keeps "no env sets MADAR_DATA" (wave 3 test).
2. `rb/exit-live` at 4580e70 merged main e8992a3 (wave 2) into the wave 3 branch. `LITE_SCHEMA_VERSION = 3` holds the sign-in
   tables and `usage_day`; `LITE_STEPS = { 3: [USAGE_DAY_SQL] }`. `server/office/parts.ts` still has `SIGN_IN_LATER`: item 8 of the
   wave 3 Merge notes (the sign-in parts on the office object) is not done there yet.
3. `officeRoutes` (`server/entries/officeWorker.ts`) serves `GET /api/health`, `POST /api/batch` and `/api/live` only. Every other
   path is `not_found`, so `/mcp`, `/api/auth/*`, `/api/oauth/*` and `/api/agents/approve` do not exist on the office path.
4. `forgotRoute` and `renewRoute` read and write the database (`statementQuery(deps.db, 'write')`) and pad their answer to 1,500 ms
   (`FORGOT_MIN_MS`, `RENEW_MIN_MS`); their after-work runs with `requestHost().after`. On the office path the Worker Db refuses
   every statement (`refusingDb`), so these routes must run in the object (Task 1).
5. `mcpApp` (`server/mcp/app.ts`) takes `issuer`, `checkToken`, `agentOf`, `runCall`, `readOffice`, `secretKey` and `oauth`. Its
   region hop runs only when `config.region` matches an AWS region name (`needsHop`); the label `workers-eu-central-1` never
   matches, so the MCP app makes no network call in the object. `oauthApp` (`server/mcp/oauth/testApp.ts`) builds the same app on
   node:sqlite.
6. The own routes: `/api/auth/token`, `/api/auth/verify`, `/api/auth/password`, `/api/auth/logout`, `/api/auth/jwks`,
   `/api/oauth/authorizations/:id`, `/api/oauth/authorizations/:id/consent`, `/api/agents/approve`, `/api/oauth/grants`,
   `/api/oauth/grants/revoke`, `/api/auth/forgot`, `/api/auth/renew-invite` (`ownApiRoutes`), and `/mcp/oauth/jwks`,
   `/mcp/oauth/register`, `/mcp/oauth/authorize`, `/mcp/oauth/token`, `/mcp/.well-known/oauth-authorization-server`,
   `/mcp/.well-known/openid-configuration` (`mountOAuth`, `WELL_KNOWN`).
7. The morning summary is due from 07:30 Riyadh on a working day while `job_runs` has no `summary:<day>` row
   (`server/jobs/steps/summary.ts`). So the import must copy `job_runs`, or the office object mails the summary a second time.
8. The year office import: 132,221 records, 912,969 rows written, 6.90 rows for each record; the ceiling is 7.5
   (`IMPORT_ROWS_PER_RECORD`, `server/office/test/pins.ts`; proof.md "Wave 1: the rows pins"). At 100,000 rows written a day that is
   9.1 Free days; at the 90% budget of one import it is 10.1 days.
9. The sample office of the test copy (`testOffice(settleFuture(buildSeed(day)))`) holds 908 records (counted on 17 October 2026):
   340 events, 144 tasks, 84 stages, 60 files, 36 members, 36 deadlines, and smaller tables. So one seed writes about 908 x 7.5 =
   6,810 rows, plus one row for each deleted row of the office before it.
10. `SIGNIN_EXPORT_SQL` reads `auth.users` with `BACKUP_DB_URL` rights (it needs `postgres`); `importSigninRows(q, rows, now)` writes
    the rows in id order, raises the office version once and writes the snapshot with the lists of the tables; `SIGNIN_TABLES` names
    the five sign-in tables (`server/auth/own/import.ts`, `server/data/lite/schema.ts`).
11. `insertRow(q, spec, row, emptyState(''), 'fail')` writes one record with its key columns from `row.columns` (the pins import of
    `server/office/test/pinOffice.ts` uses it with no State); `settings` needs `'update'` because the schema makes its row.
12. `db-backup.yml` runs at 02:07 Riyadh, keeps 30 days of `madar-db-*` releases in `byosamah/madar-backups`, and fails when the
    newest backup is older than 26 hours. `scripts/backup/workflows.test.ts` checks every backup workflow file in `FILES`.
13. `scripts/ci/ci-workflow.test.ts` maps each job to its file (`JOB_FILE`: unit, server, db, integration) and wants one checkout
    for each job. The `office` vitest project takes `server/office/**/*.wd.test.ts` only (`vite.config.ts`).
14. The deploy suite reads `mail_outbox` and the walk's checks through `pg` (`tests/e2e-deploy/mail.ts`, `withClient`), calls the
    Supabase OAuth endpoints (`agents.spec.ts`), and `batchAs` waits for a URL with `/functions/v1/api/batch` (`steps.ts`). None of
    them works on the office path as it is.
15. The Pages forwarders send `/api` and `/mcp` to the Worker binding only when the word is `workers`
    (`server/http/pagesApiProxy.ts`, `pagesMcpProxy.ts`); `CALL_LIMITS` is a `Record<ServerHost, number>` (`server/core/ports.ts`).
16. The GraphQL datasets of wave 0 (`scripts/proof/do-socket/q/*.graphql`): `durableObjectsPeriodicGroups` gives `rowsRead`,
    `rowsWritten` and `cpuTime`; `durableObjectsInvocationsAdaptiveGroups` gives `requests`; `workersInvocationsAdaptive` gives
    `requests` and CPU quantiles. `scripts/proof/do-socket/gql.mjs` sends a query with the wrangler token and never prints it.
17. The builders of waves 2 and 3 made one commit about every 2 to 3 minutes (wave 2: 22 commits from 13:58 to 14:43; wave 3: 20
    commits from 13:58 to 14:56, on 17 October). The full gate takes about 1 hour.

## The two owner decisions of this plan

**Decision 5: a second copy of the files (spec section 7).** The default of this plan is **R2 alone** (the owner asked for one
vendor). The nightly data backup goes to GitHub (outside Cloudflare) and names every file key; the file bytes live only in R2, as
they lived only in Supabase Storage before. The restore check then looks up 5 file keys in R2 itself (`--files-lag-days 0`).
Work: one flag in Task 8; the owner makes one R2 token with Object Read on the bucket for the rclone remote of the Mac. The
answer **B2** adds runbook step R-B2 (the paused `files-backup.yml` copies R2 to a Backblaze B2 crypt remote each Friday; free to
10 GB; the owner's B2 account and five GitHub values; no code). Tasks marked **DECISION 5**: Task 8 (the file step), R9, R-B2.

**Decision 6: the account of the test copy (spec section 7).** The Free day limits count for the whole Cloudflare account.

| | Form A: the same account (recommended) | Form B: a second free account |
|---|---|---|
| Work | None in code beyond the day cap (Task 18). Heavy test runs stay after office hours. | About 1 builder hour: a Pages project `madar-test` on the new account (a service binding cannot reach a Worker of another account), a new test address in `PAGE_HOSTS`, `COPY_HOSTS`, the CSP, `config/remote.test.env`, `secrets/test.env` (`APP_URL`, `ALLOWED_ORIGINS`, `MCP_URL`) and the deploy suite guards; the account id of each copy in `scripts/deploy`. Owner: about 30 minutes (a new account with a new email, 2FA, an API token). |
| Rows written (100,000 a day) | Shared. A deploy suite day of the test copy: about 34,000 (wave 0) plus 2 seeds of about 7,000 each = 48,000. Production after the switch: 20,333 to 45,700 (proof.md, wave 1). Sum on a deploy suite day: 68,000 to 94,000. | The test copy has its own 100,000; production keeps the whole main account. |
| Rows read (5 million a day) | Shared. Test copy: about 172,000; production: 1.98 to 4.29 million. Sum up to 89%. | Separate. |
| Requests (100,000 a day each, Worker and object) | Shared, both under 10%. | Separate. |
| Cron Triggers (5 for the account) | Shared: the test Worker takes 1. | Separate. |
| Before wave 6 | Production uses no limit of the objects, only Worker requests for its Pages Functions (about 3,000 a day). So form A costs nothing in wave 5. | The same, with more work now. |

The recommendation is **form A with the day cap** (Task 18: the test Worker stops at 50% of each day limit: 50,000 rows written,
2,500,000 rows read, 50,000 object requests), and a check at the end of the week (R13): if the busiest test day plus the production
estimate of R12 goes above 80% of any day limit, form B comes before wave 6. Tasks marked **DECISION 6**: Task 18 (the values), R1,
R7 (the hours), R11 (where the spare object lives), R13, R-6B.

## Blocks and size

Five builders run one after the other; each block ends with its own test files green and its commits. The builders of waves 2 and
3 made about one task every 2 to 3 minutes, so the hours below are mostly test runs (a year office run of `test:office` takes some
minutes) and the gate.

| Block | Tasks | Builder hours | Ends with |
|---|---|---|---|
| A. The office path, whole | 1 to 3 | 0.75 | The sign-in, OAuth and MCP routes in the object; the host word `office`; the discovery files |
| B. Hold, export, backup, restore | 4 to 9 | 1 | The hold, the export route and client, the digests, the restore check on node:sqlite, the nightly workflow |
| C. Import, compare, reverse | 10 to 15 | 1.25 | The import steps and client, the sources, the compare, the reverse export, the year office round trip |
| D. Seed, test tools, cap, deploy, CI | 16 to 21 | 1 | The seed, the deploy suite on the office path, the day cap, the wrangler-only deploy, CI with no Docker, the probes of wave 5 |
| E. The local run and the gate | 22 to 23 | 0.5, then the gate (1 hour) and the delegated Playwright run (0.5 hour) | The first local end-to-end run of the own sign-in, the guides and records |

Wave 4 in all: about 4.5 builder hours plus 1.5 hours of gate and helper. Wave 5: about 2 days of work for the main session and the
owner inside one week of calendar (Part 2).

## File map

| File | Create or modify | Responsibility |
|---|---|---|
| `server/office/http.ts`, `http.test.ts` | create | `officeHttpApp`, `answerHttp`: the `/api` routes of wave 2 and `/mcp` inside the object |
| `server/office/parts.ts`, `office.ts` | modify | `route`, `ops`, the hold, the day cap, `liteAuthAdmin`, `cleanupSignin` in the first run after 00:00 UTC, `drop` |
| `server/entries/officeWorker.ts`, `officeWorker.test.ts` | modify | the forward of every other `/api` route and `/mcp`; the ops routes with their secrets; `servesOffice` |
| `server/entries/officeEntry.ts`, `workerMain.ts` | modify | the stub by name; `/api/office/*` on the office entry whenever the binding exists |
| `server/core/serverHost.ts`, `serverHost.test.ts` | modify | the word `office`, `onWorker`, the production guard until wave 6 |
| `server/http/pagesApiProxy.ts`, `pagesMcpProxy.ts`, `pagesWellKnown.ts` and their tests | modify | the binding for `office`; `/api/office/*` to the binding only; discovery only for an office copy |
| `functions/.well-known/oauth-authorization-server/[[path]].ts`, `functions/.well-known/openid-configuration/[[path]].ts` | create | the Pages Functions of the OAuth discovery |
| `server/core/ports.ts`, `server/usage/meters.ts` | modify | `CALL_LIMITS.office`; no month calls warning on the office host |
| `scripts/build-remote.ts`, `build-remote.test.ts` | modify | the word `office` gives `VITE_MADAR_AUTH=madar` and `VITE_MADAR_LIVE=socket` |
| `server/office/ops.ts`, `ops.test.ts` | create | `EXPORT_TABLES`, `ROWID_ALIAS`, `DRIFT_TABLES`, `OfficeHold`, `exportPage`, `peek`, `testToolsOn` |
| `server/office/import.ts`, `import.test.ts` | create | `importBegin`, `importPart`, `importFinish` (the server rows and the sign-in rows) |
| `server/office/cap.ts`, `cap.test.ts` | create | `dayCapOf`, `capRefusal` |
| `server/office/test/nodeOffice.ts` | create | `nodeOffice()`: the office parts on node:sqlite with the own sign-in key, for the node tests |
| `server/office/test/live/{entry.ts,harness.ts,wrangler.toml}` | modify | the ops secrets and the stub by name in the live test Worker |
| `server/office/ops.wd.test.ts`, `roundtrip.wd.test.ts` | create | the ops routes and the year office round trip on local workerd |
| `scripts/office/digest.ts`, `source.ts`, `import.ts`, `compare.ts`, `reverse.ts`, `seed.ts`, `drop.ts`, `new-secret.ts`, `auth-key.ts`, `ops.ts` and tests | create | the clients of the Mac: digests, sources, import, compare, reverse export, seed, drop, the two secret makers, the ops port |
| `scripts/backup/officeExport.ts`, `officeRestore.ts` and tests | create | the export client and the office restore check |
| `scripts/restore-check.ts`, `scripts/backup/check.ts` | modify | the office kind by file name; `--files-lag-days`; `checkFileCopy` and `readOnlyDeps` exported |
| `.github/workflows/office-backup.yml`, `ci.yml`, `ci-stack.yml` | create, modify | the nightly office export; the `lite` and `office` jobs |
| `scripts/backup/workflows.test.ts`, `scripts/ci/ci-workflow.test.ts` | modify | the rules of the new workflow and jobs |
| `server/it/officeImport.it.test.ts` | create | the Postgres source and the reverse export on the local stack (Docker, merge lead) |
| `tests/e2e-deploy/{targets.ts,office.ts,mail.ts,walk.spec.ts,agents.spec.ts,steps.ts}`, `scripts/e2e-deploy-helpers.test.ts` | create, modify | the deploy suite on the office path |
| `wrangler.server.toml`, `scripts/deploy/wranglerServer.test.ts` | modify | `MADAR_TEST_TOOLS` and `MADAR_DAY_CAP` for the test Worker only |
| `scripts/deploy/{all.sh,worker.sh,checks.sh,secrets.ts}` and tests | modify | the wrangler-only deploy of an office copy |
| `scripts/proof/do-tx/{guard.js,guard.test.ts,index.js,wrangler.deployed.toml,deployed.mjs}`, `scripts/proof/office-day/*` | create, modify | the probes of wave 5 |
| `scripts/dev/office-local.ts`, `office-local.test.ts`, `server/office/test/live/wrangler.local.toml`, `package.json` | create, modify | `npm run dev:office`: the local office stack with the own sign-in |
| The guides, `TASKS.md`, `docs/superpowers/real-build/proof.md` | modify | the records of wave 4 |

Commands used in every task:
- One server or script test file: `npx vitest run --project server <file> --no-file-parallelism --testTimeout=60000`.
- One workerd file: `MADAR_OFFICE=1 npx vitest run --project office <file> --no-file-parallelism --testTimeout=60000` with the
  sandbox off (`listen()` fails with `EPERM` in the sandbox).
- One unit file: `npx vitest run --project unit <file> --no-file-parallelism --testTimeout=60000`.
- Types: `npm run typecheck`.

---

# Part 1: Wave 4

# Block A: The office path, whole (Tasks 1 to 3, about 0.75 builder hours)

Before Task 1, the builder reads the merge state of wave 3 on main (read only):

```bash
git grep -n "SIGN_IN_LATER" -- server/office/parts.ts || echo "item 8 (a) done"
git grep -n "route(" -- server/office/office.ts || echo "no route method yet"
git grep -n "'/mcp" -- server/entries/officeWorker.ts || echo "no /mcp on the office path yet"
```

When the merge of wave 3 did a part of its item 8 already, the builder keeps that code, runs the tests of Task 1 Step 1 against
it, and changes only what makes a test fail. Item 8 (b) and (c) of the wave 3 plan put `ownApiRoutes` into the Worker; that form
cannot serve `/api/auth/forgot` or `/api/auth/renew-invite`, because both read the database and the Worker Db refuses every
statement (fact 4). This plan runs every such route in the object.

### Task 1: The sign-in, OAuth and MCP routes inside the office object

> **Ruling of the main session (17 October 2026), which wins over this task and Merge note 1.** The merge of waves 2 and 3 is on
> main (12f8823). It built the sign-in on the office object in another form: `officeParts` takes `liteAuthAdmin`; `Office.signin`
> runs each own sign-in step; the Worker serves `ownApiRoutes` through `server/entries/officeSignin.ts`, with forgot and renew in
> the object (`Office.mailRoute` before the answer, `Office.mailWork` after it); `/mcp` runs in the object (`Office.mcp`), with the
> agent kind of `OfficeWho`; the Cron runs `cleanupSignin` after 00:00 UTC. Keep that form, with its tests. Do not build a second
> path for the same routes. Build from this task the test helper (`nodeOffice`, `NODE_OFFICE_ENV`, `httpOf`, `NODE_NOW`,
> `NODE_TODAY`), because Tasks 4, 7, 10, 12, 16 and 18 use it. Where a later task calls `parts.route` or `Office.route`, call the
> merged method in its place (`signin`, `mailRoute`, `mcp`), or give the helper a small `route` that sends a request to them; the
> hold of Task 4 then applies to those methods. Record each change as a deviation.

**Files:**
- Create: `server/office/http.ts`, `server/office/http.test.ts`, `server/office/test/nodeOffice.ts`
- Modify: `server/office/parts.ts` (the `authAdmin` line, `cron`, a new `route`), `server/office/office.ts` (a new `route`),
  `server/entries/officeWorker.ts` (`OfficeStub.route`, the forward), `server/entries/officeWorker.test.ts`
- Test: `server/office/http.test.ts`, `server/entries/officeWorker.test.ts`

**Interfaces:**
- Consumes: `ownApiRoutes(office, { jwks, checkToken })` (`server/auth/own/routes.ts`), `localSigninOffice(deps)`
  (`server/auth/own/office.ts`), `signingKeysOf(jwk, mcpUrl)` (`server/auth/own/keys.ts`), `ownIssuer`, `ownKeySet`,
  `ownPublicJwks`, `OWN_AUTH_SECRET` (`server/auth/ownKeys.ts`), `browserTokenChecker` (`server/auth/verify.ts`), `mcpApp`
  (`server/mcp/app.ts`), `agentTokenChecker` (`server/mcp/auth.ts`), `liteAgentOf` (`server/mcp/oauth/agent.ts`), `mountOAuth`
  (`server/mcp/oauth/routes.ts`), `liteAuthAdmin({ db, clock })` (`server/auth/own/liteAdmin.ts`), `cleanupSignin(q, now)`
  (`server/auth/own/cleanup.ts`), `runInHost`, `After` (`server/core/after.ts`), `officeParts`, `EffectLedger`, `processOutbox`.
- Produces: `type OfficeHttpRequest = { method: string; url: string; headers: [string, string][]; body: string; worker: number }`;
  `type OfficeHttpAnswer = { status: number; headers: [string, string][]; body: string; later: string[] }`;
  `officeHttpApp(deps: Deps, o: HttpParts): Promise<Hono>`; `answerHttp(app, input): Promise<Omit<OfficeHttpAnswer, 'later'>>`;
  `OfficeParts.route(input, net)`; `Office.route(input, net)`; `OfficeStub.route`; `nodeOffice(o?)` and `NODE_OFFICE_ENV` (test
  helper, used by Tasks 4, 7, 10, 12, 16, 18).

- [ ] **Step 1: Write the test helper and the failing tests**

Create `server/office/test/nodeOffice.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { testPrivateJwk } from '../../auth/own/testKeys';
import { nodeHost } from '../../data/lite/host';
import { applyLiteSchema } from '../../data/lite/schema';
import { liteWriteState } from '../../data/lite/whole';
import { fixedClock } from '../../test/fakes/clock';
import { officeParts } from '../parts';
import { principalOfWho } from '../who';
import { fakeSockets, recordingNet } from './fakes';

/** The values of a Worker on the office path for the node tests: none of them is a secret, and mail goes into mail_outbox. */
export const NODE_OFFICE_ENV: Readonly<Record<string, string>> = {
  APP_URL: 'https://madar.test', ALLOWED_ORIGINS: 'https://madar.test', MCP_URL: 'https://madar.test/mcp', API_URL: 'https://madar.test/api',
  MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'outbox', SUPABASE_URL: 'http://127.0.0.1:54321',
  MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: '0'.repeat(32), R2_ACCESS_KEY_ID: 'test-not-a-key',
  R2_SECRET_ACCESS_KEY: 'test-not-a-key', R2_BUCKET: 'madar-files-test', WORKER_REGION: 'workers-test',
};
export const NODE_TODAY = '2026-10-04';
export const NODE_NOW = '2026-10-04T06:00:00.000Z';
const SILENT = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * The office parts on node:sqlite with a new own sign-in key, and the sample office unless seed is false. totals stays 0 on
 * node:sqlite (the host counts no rows), so the tests of the rows run on workerd.
 */
export async function nodeOffice(o: { at?: string; env?: Record<string, string>; seed?: State | false } = {}) {
  const raw = new DatabaseSync(':memory:');
  const host = Object.assign(nodeHost(raw), { totals: { rowsRead: 0, rowsWritten: 0 } });
  await applyLiteSchema(host);
  const jwk = await testPrivateJwk();
  const env: Record<string, string> = { ...NODE_OFFICE_ENV, MADAR_AUTH_PRIVATE_JWK: jwk, ...o.env };
  const clock = fixedClock(o.at ?? NODE_NOW);
  const sockets = fakeSockets();
  const parts = officeParts({ host, read: (name) => env[name], sockets, clock, log: SILENT, principal: principalOfWho });
  if (o.seed !== false) {
    const seed = o.seed ?? (await buildSeed(NODE_TODAY, async () => undefined));
    await parts.db.tx('write', (q) => liteWriteState(q, seed));
  }
  return { raw, host, parts, sockets, clock, env, jwk, net: recordingNet() };
}

/** One request to the routes of the object, as the Worker forward makes it. */
export function httpOf(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return {
    method,
    url: `https://madar.test${path}`,
    headers: Object.entries({ 'content-type': 'application/json', 'x-madar-client-address': '203.0.113.7', ...headers }),
    body: body === undefined ? '' : JSON.stringify(body),
    worker: 1,
  };
}
```

Create `server/office/http.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { importSigninRows } from '../auth/own/import';
import { hashPassword } from '../auth/own/password';
import { ownIssuer } from '../auth/ownKeys';
import { httpOf, nodeOffice } from './test/nodeOffice';

const AUTH_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'hala@madar.test';
const PASSWORD = 'Office-pass-1';

/** The sample office with one sign-in row for usr_001. The hash is made before the transaction (no crypto.subtle inside one). */
async function signedOffice(at?: string) {
  const t = await nodeOffice(at ? { at } : {});
  const hash = await hashPassword(PASSWORD);
  await t.parts.db.tx('write', (q) => importSigninRows(q, [{ id: AUTH_ID, email: EMAIL, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' }], t.clock.now()));
  return t;
}

describe('the routes of wave 2 inside the office object (server/office/http.ts)', () => {
  it('signs in with POST /api/auth/token and gives a token of 15 minutes', async () => {
    const t = await signedOffice();
    const answer = await t.parts.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: EMAIL, password: PASSWORD }), t.net);
    expect(answer.status).toBe(200);
    const body = JSON.parse(answer.body) as { access_token?: string; expires_in?: number; refresh_token?: string };
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(body.expires_in).toBe(900);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const t = await signedOffice();
    const wrong = await t.parts.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: EMAIL, password: 'not-the-password' }), t.net);
    const unknown = await t.parts.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'nobody@madar.test', password: PASSWORD }), t.net);
    expect([wrong.status, wrong.body]).toEqual([unknown.status, unknown.body]);
  });

  it('runs the forgot route in the object: it waits 1,500 ms and puts the reset mail into mail_outbox', async () => {
    const t = await signedOffice();
    const started = Date.now();
    const answer = await t.parts.route(httpOf('POST', '/api/auth/forgot', { email: EMAIL }), t.net);
    expect(answer.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    const mails = await t.parts.db.statement<{ tag: string; to_email: string }>('read', 'select tag, to_email from mail_outbox');
    expect(mails).toEqual([{ tag: 'reset', to_email: EMAIL }]);
  });

  it('answers POST /mcp with no token with 401 and the challenge of the own server', async () => {
    const t = await signedOffice();
    const answer = await t.parts.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }), t.net);
    expect(answer.status).toBe(401);
    expect(new Headers(answer.headers).get('www-authenticate')).toMatch(/^Bearer /);
  });

  it('gives the discovery document of the own issuer under /mcp', async () => {
    const t = await signedOffice();
    const answer = await t.parts.route(httpOf('GET', '/mcp/.well-known/oauth-authorization-server'), t.net);
    expect(answer.status).toBe(200);
    expect((JSON.parse(answer.body) as { issuer: string }).issuer).toBe(ownIssuer('https://madar.test/mcp'));
  });

  it('answers 503 with a clear message when the copy has no sign-in key', async () => {
    const t = await nodeOffice({ env: { MADAR_AUTH_PRIVATE_JWK: '' } });
    const answer = await t.parts.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: EMAIL, password: PASSWORD }), t.net);
    expect(answer.status).toBe(503);
    expect(answer.body).toContain('MADAR_AUTH_PRIVATE_JWK');
  });

  it('removes in the first Cron run after 00:00 UTC the sign-in links that ended more than a day ago, and keeps a new one', async () => {
    const t = await signedOffice('2026-10-05T00:05:00.000Z');
    t.raw.exec(`insert into auth_links (token_hash, auth_id, type, expires_at) values ('old', '${AUTH_ID}', 'recovery', '2026-10-03T00:00:00.000Z'), ('new', '${AUTH_ID}', 'recovery', '2026-10-05T01:00:00.000Z')`);
    await t.parts.cron({ at: '2026-10-05T00:05:00.000Z', worker: 0 }, t.net);
    expect(t.raw.prepare('select token_hash from auth_links order by token_hash').all()).toEqual([{ token_hash: 'new' }]);
    t.raw.exec(`insert into auth_links (token_hash, auth_id, type, expires_at) values ('old2', '${AUTH_ID}', 'recovery', '2026-10-03T00:00:00.000Z')`);
    await t.parts.cron({ at: '2026-10-05T06:00:00.000Z', worker: 0 }, t.net);
    expect(t.raw.prepare("select count(*) as n from auth_links where token_hash = 'old2'").get()).toEqual({ n: 1 });
  });
});
```

In `server/entries/officeWorker.test.ts`, add at the end (it reuses the imports of the file: `officeRoutes`, `testConfig`; add
the type import `import type { OfficeHttpRequest } from '../office/http';` at the top):

```ts
describe('the forward of the other /api routes and /mcp into the object (exit wave 4)', () => {
  function forwardRoutes() {
    const seen = { routes: [] as OfficeHttpRequest[], effects: [] as string[][] };
    const stub = {
      batch: async () => ({ ok: true as const, body: '{"v":1,"results":[]}', later: [] }),
      runEffects: async (input: { ids: string[] }) => {
        seen.effects.push(input.ids);
        return { done: input.ids.length, failed: 0 };
      },
      cron: async () => ({ ok: true, at: '', steps: [], closed: 0, day: null }),
      health: async () => ({ schema: 3, lastJob: null }),
      fetch: async () => new Response(null, { status: 404 }),
      route: async (input: OfficeHttpRequest) => {
        seen.routes.push(input);
        return { status: 201, headers: [['content-type', 'application/json']] as [string, string][], body: '{"ok":true}', later: ['41'] };
      },
    };
    const routes = officeRoutes({
      deps: { config: testConfig(), clock: { now: () => new Date() }, log: { info: () => undefined, warn: () => undefined, error: () => undefined } },
      verifyToken: async () => ({ authUserId: 'x' }),
      stub: () => stub,
      net: () => ({}) as never,
      jobsSecret: () => 'jobs',
    });
    return { routes, seen };
  }

  it('sends POST /api/auth/token into the object with its body and headers, and runs the later effects after the answer', async () => {
    const { routes, seen } = forwardRoutes();
    const response = await routes.fetch(new Request('https://w.test/api/auth/token', { method: 'POST', headers: { 'content-type': 'application/json', 'x-madar-client-address': '203.0.113.7' }, body: '{"grant_type":"password"}' }), {});
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('{"ok":true}');
    expect(seen.routes[0]).toMatchObject({ method: 'POST', url: 'https://w.test/api/auth/token', body: '{"grant_type":"password"}' });
    expect(new Headers(seen.routes[0].headers).get('x-madar-client-address')).toBe('203.0.113.7');
    expect(seen.effects).toEqual([['41']]);
  });

  it('sends /mcp and every path under /mcp into the object, and keeps /api/batch and /api/health on their own routes', async () => {
    const { routes, seen } = forwardRoutes();
    await routes.fetch(new Request('https://w.test/mcp', { method: 'POST', body: '{}' }), {});
    await routes.fetch(new Request('https://w.test/mcp/oauth/register', { method: 'POST', body: '{}' }), {});
    await routes.fetch(new Request('https://w.test/api/health'), {});
    expect(seen.routes.map((r) => new URL(r.url).pathname)).toEqual(['/mcp', '/mcp/oauth/register']);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/office/http.test.ts server/entries/officeWorker.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `parts.route` is not a function; `/api/auth/token` and `/mcp` answer `not_found` on the Worker.

- [ ] **Step 3: Write the routes of the object**

Create `server/office/http.ts`:

```ts
import { Hono } from 'hono';
import { signingKeysOf } from '../auth/own/keys';
import { localSigninOffice } from '../auth/own/office';
import { ownApiRoutes } from '../auth/own/routes';
import { ownIssuer, ownKeySet, ownPublicJwks } from '../auth/ownKeys';
import { browserTokenChecker } from '../auth/verify';
import { runInHost, type After } from '../core/after';
import type { Deps } from '../core/ports';
import type { RunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { mcpApp } from '../mcp/app';
import { agentTokenChecker } from '../mcp/auth';
import { liteAgentOf } from '../mcp/oauth/agent';
import { mountOAuth } from '../mcp/oauth/routes';

/**
 * The routes of the own sign-in, OAuth and MCP inside the office object (Supabase exit, wave 4; item 8 of the wave 3 Merge notes).
 * They need the database, and only the object holds it: the Worker sends each request here as plain data (OfficeHttpRequest)
 * with its network port, and sends the answer on as it is. The hash work of a sign-in runs here, outside any transaction (wave 2).
 * The forgot and renew routes do their work with the after of the host: here the object waits for that work before it answers.
 * Their answer comes after 1,500 ms in every case (FORGOT_MIN_MS, RENEW_MIN_MS), and the work takes less, so the time of the answer
 * stays the same for a known and an unknown email.
 */

export type OfficeHttpRequest = { method: string; url: string; headers: [string, string][]; body: string; worker: number };
export type OfficeHttpAnswer = { status: number; headers: [string, string][]; body: string; later: string[] };
export type HttpParts = { run: RunCall; office: () => Promise<OfficeSnapshot>; privateJwk: string; secretKey?: string };

export async function officeHttpApp(deps: Deps, o: HttpParts): Promise<Hono> {
  const mcpUrl = deps.config.mcpUrl;
  const issuer = ownIssuer(mcpUrl);
  // The key import is crypto.subtle work: it runs here, before any transaction of the request.
  const keys = await signingKeysOf(o.privateJwk, mcpUrl);
  const signin = localSigninOffice({ db: deps.db, clock: deps.clock, log: deps.log, config: deps.config, keys });
  const jwks = ownPublicJwks(o.privateJwk);
  const api = new Hono();
  const checkToken = browserTokenChecker({ issuer, jwks: ownKeySet(o.privateJwk) });
  for (const route of ownApiRoutes(signin, { jwks, checkToken })) api.on(route.method, route.path, (c) => route.handler(c.req.raw, deps));
  const app = new Hono();
  app.route('/api', api);
  app.route('/mcp', mcpApp(deps, {
    issuer,
    checkToken: agentTokenChecker({ issuer, audience: mcpUrl, jwks: ownKeySet(o.privateJwk) }),
    agentOf: liteAgentOf,
    runCall: o.run,
    readOffice: () => o.office(),
    ...(o.secretKey ? { secretKey: o.secretKey } : {}),
    oauth: (mcp) => mountOAuth(mcp, signin, { mcpUrl, jwks }),
  }));
  app.notFound(() => Response.json({ error: { code: 'not_found', message: 'This address does not exist.' } }, { status: 404 }));
  return app;
}

/** One request through the app, with the host "workers" (the client address header of the Pages Function) and a kept after. */
export async function answerHttp(app: Hono, input: OfficeHttpRequest): Promise<Omit<OfficeHttpAnswer, 'later'>> {
  const kept: Promise<unknown>[] = [];
  const after: After = (work) => void kept.push(work.catch(() => undefined));
  const bodyless = input.method === 'GET' || input.method === 'HEAD';
  const request = new Request(input.url, { method: input.method, headers: input.headers, ...(bodyless ? {} : { body: input.body }) });
  const response = await runInHost({ host: 'workers', after }, () => app.fetch(request));
  const body = await response.text();
  await Promise.all(kept);
  return { status: response.status, headers: [...response.headers], body };
}
```

In `server/office/parts.ts`:

1. Add the imports:

```ts
import { cleanupSignin } from '../auth/own/cleanup';
import { liteAuthAdmin } from '../auth/own/liteAdmin';
import { OWN_AUTH_SECRET } from '../auth/ownKeys';
import { answerHttp, officeHttpApp, type OfficeHttpAnswer, type OfficeHttpRequest } from './http';
```

2. Delete `NO_AUTH` and `SIGN_IN_LATER` with their comment, and in `depsFor` replace `authAdmin: SIGN_IN_LATER,` with:

```ts
      // The sign-in rows of wave 2 live in this object: the Auth effects write them, and only the mail goes through the port.
      authAdmin: liteAuthAdmin({ db, clock }),
```

3. Add to the type `OfficeParts`: `route(input: OfficeHttpRequest, net: NetApi): Promise<OfficeHttpAnswer>;`

4. Add the method in the returned object, after `runEffects`:

```ts
    async route(input, net) {
      meter.request({ worker: input.worker });
      const privateJwk = o.read(OWN_AUTH_SECRET);
      if (!privateJwk) {
        return { status: 503, headers: [['content-type', 'text/plain; charset=utf-8']], body: `The sign-in key of this copy is missing (${OWN_AUTH_SECRET}).`, later: [] };
      }
      const deps = depsFor(net);
      const app = await officeHttpApp(deps, { run, office, privateJwk, ...(values.secretKey ? { secretKey: values.secretKey } : {}) });
      const answer = await answerHttp(app, input);
      // The effects that runCall committed (an MCP write): the other kinds now, the mails and pushes after the answer.
      const { now, later } = ledgers.get(deps)!.split();
      if (now.length > 0) await processOutbox(deps, now);
      return { ...answer, later };
    },
```

5. In `cron`, after `const report = await runOfficeJobs(deps, at);`, add:

```ts
      // The sign-in rows that ended more than a day ago (wave 2), once a day: in the first run after 00:00 UTC.
      if (at.getUTCHours() === 0 && at.getUTCMinutes() < 15) await db.tx('write', (q) => cleanupSignin(q, at));
```

In `server/office/office.ts`, import `type OfficeHttpAnswer, type OfficeHttpRequest` from `./http` and add after `runEffects`:

```ts
  /** One /api route of the own sign-in or one /mcp request (exit wave 4): the Worker sends it as plain data. */
  route(input: OfficeHttpRequest, net: NetApi): Promise<OfficeHttpAnswer> {
    return this.parts.route(input, net);
  }
```

In `server/entries/officeWorker.ts`:

1. Import `type OfficeHttpAnswer, type OfficeHttpRequest` from `../office/http`, and add to `OfficeStub`:
   `route(input: OfficeHttpRequest, net: NetApi): Promise<OfficeHttpAnswer>;`

2. Add the forward inside `officeRoutes`, after the function `health`:

```ts
  /** Every other /api route and every /mcp request: the object runs it, because only the object holds the database. */
  async function forward(request: Request, env: Env, after: After | undefined): Promise<Response> {
    let body = '';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await readBody(request);
      } catch (error) {
        return errorResponse(runErrorOf(error));
      }
    }
    const net = o.net();
    let out: OfficeHttpAnswer;
    try {
      out = await o.stub(env).route({ method: request.method, url: request.url, headers: [...request.headers], body, worker: reported() }, net);
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
    if (out.later.length > 0) {
      const work = o.stub(env).runEffects({ ids: out.later, worker: 0 }, net).catch((error: unknown) => {
        log.warn('The effects after the answer did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
      });
      if (after) after(work);
      else await work;
    }
    return new Response(out.body, { status: out.status, headers: out.headers });
  }
```

3. Register the forward after `app.post('/api/batch', ...)`:

```ts
  app.all('/api/*', (c) => forward(c.req.raw, c.env, afterOf(c)));
  app.all('/mcp', (c) => forward(c.req.raw, c.env, afterOf(c)));
  app.all('/mcp/*', (c) => forward(c.req.raw, c.env, afterOf(c)));
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/office/http.test.ts server/entries/officeWorker.test.ts server/office/parts.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS (the parts suite of wave 3 still passes with `liteAuthAdmin` in place of `SIGN_IN_LATER`).
Then: `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/office/http.ts server/office/http.test.ts server/office/test/nodeOffice.ts server/office/parts.ts server/office/office.ts \
  server/entries/officeWorker.ts server/entries/officeWorker.test.ts
git commit -m "Exit wave 4: the sign-in, OAuth and MCP routes run inside the office object, and the Worker sends them there"
```

### Task 2: The host word office

**Files:**
- Modify: `server/core/serverHost.ts`, `server/core/serverHost.test.ts`, `server/http/pagesApiProxy.ts`,
  `server/http/pagesApiProxy.test.ts`, `server/http/pagesMcpProxy.ts`, `server/http/pagesMcpProxy.test.ts`, `server/core/ports.ts`,
  `server/usage/meters.ts`, `server/usage/lite.test.ts`, `scripts/build-remote.ts`, `scripts/build-remote.test.ts`,
  `server/entries/officeWorker.ts`, `server/entries/officeWorker.test.ts`, `server/entries/workerMain.ts`
- Test: the test files above

**Interfaces:**
- Consumes: `SERVER_HOSTS`, `parseServerHostSetting`, `screensApiUrl`, `serverHostOf` (`server/core/serverHost.ts`), `onOffice`
  (`server/entries/officeEntry.ts`).
- Produces: `SERVER_HOSTS = ['supabase', 'workers', 'office']`; `onWorker(host: ServerHost): boolean`;
  `OFFICE_COPIES_OPEN: readonly Copy[] = ['test']`; `OFFICE_OPS_PREFIX = '/api/office/'`;
  `hasOfficeBinding(env): boolean`; `servesOffice(env, pathname): boolean` (`server/entries/officeWorker.ts`);
  `CALL_LIMITS.office = 3_000_000`; `remotePublicEnv` sets `VITE_MADAR_AUTH` and `VITE_MADAR_LIVE` for `office`.

- [ ] **Step 1: Write the failing tests**

In `server/core/serverHost.test.ts`, add:

```ts
describe('the host word office (exit wave 4)', () => {
  it('reads office for the test copy, and the screens of an office copy call the page api', () => {
    expect(parseServerHostSetting({ test: 'office', production: 'supabase' })).toEqual({ test: 'office', production: 'supabase' });
    expect(screensApiUrl('test', 'office')).toBe('/api');
    expect([onWorker('supabase'), onWorker('workers'), onWorker('office')]).toEqual([false, true, true]);
  });

  it('refuses production: office until wave 6, with a message that names the wave', () => {
    expect(() => parseServerHostSetting({ test: 'office', production: 'office' })).toThrow(/production.*wave 6/);
  });

  it('names the three words in the message of a wrong word', () => {
    expect(() => parseServerHostSetting({ test: 'pages', production: 'supabase' })).toThrow('test must be supabase, workers or office.');
  });
});
```

In `server/http/pagesApiProxy.test.ts`, add (the file has a fake binding helper; this test makes its own):

```ts
describe('the office ops and the word office (exit wave 4)', () => {
  const binding = () => {
    const seen: string[] = [];
    return { seen, env: { MADAR_SERVER_TEST: { fetch: async (request: Request) => (seen.push(new URL(request.url).pathname), new Response('ok')) } } };
  };

  it('sends /api to the Worker binding when the word is office', async () => {
    const b = binding();
    await proxyApi(new Request('https://preview.madar-46r.pages.dev/api/batch', { method: 'POST', body: '{}' }), b.env, { setting: { test: 'office', production: 'supabase' }, log: () => undefined });
    expect(b.seen).toEqual(['/api/batch']);
  });

  it('sends /api/office/* to the Worker binding also when the word is supabase', async () => {
    const b = binding();
    await proxyApi(new Request('https://preview.madar-46r.pages.dev/api/office/export', { method: 'POST', body: '{}' }), b.env, { setting: { test: 'supabase', production: 'supabase' }, log: () => undefined });
    expect(b.seen).toEqual(['/api/office/export']);
  });

  it('answers 404 for /api/office/* with no binding, and never sends it to the Supabase function', async () => {
    const calls: string[] = [];
    const response = await proxyApi(new Request('https://madar.vado.sa/api/office/export', { method: 'POST', body: '{}' }), {}, {
      setting: { test: 'supabase', production: 'supabase' }, log: () => undefined, fetch: (async (url: string) => (calls.push(url), new Response('x'))) as typeof fetch,
    });
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });
});
```

In `server/http/pagesMcpProxy.test.ts`, add:

```ts
it('sends /mcp to the Worker binding when the word is office (exit wave 4)', async () => {
  const seen: string[] = [];
  const env = { MADAR_SERVER_TEST: { fetch: async (request: Request) => (seen.push(new URL(request.url).pathname), new Response('ok')) } };
  await proxyMcp(new Request('https://preview.madar-46r.pages.dev/mcp', { method: 'POST', body: '{}' }), fetch, env, { setting: { test: 'office', production: 'supabase' }, log: () => undefined });
  expect(seen).toEqual(['/mcp']);
});
```

In `server/usage/lite.test.ts` (wave 3), add (import `warningMeters` and `type Meters` from `./meters`; the object below holds the
meters that `warningMeters` reads, and the cast covers the other fields of `Usage`):

```ts
it('sends no month calls warning on the office host: the four Free day meters cover it (exit wave 4)', () => {
  const meters = { month: '2026-10', calls: { used: 9_000_000, limit: 3_000_000 }, database: { used: 0, limit: 1 }, files: { used: 0, limit: 1 },
    backupCopy: { used: 0, limit: 1 }, emails: { used: 0, limit: 1 }, emailsMonth: { used: 0, limit: 1 }, egress: { used: 0, limit: 1 } } as unknown as Meters;
  expect(warningMeters(meters, 'r2', 'office').map((m) => m.meter)).not.toContain('calls');
  expect(warningMeters(meters, 'r2', 'workers').map((m) => m.meter)).toContain('callsWorkers');
});
```

In `scripts/build-remote.test.ts`, add:

```ts
describe('the word office in the screens build (exit wave 4)', () => {
  const text = 'VITE_SUPABASE_URL=https://qdgwpnesxppnqsaabqzd.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n';

  it('builds the Madar sign-in and the live socket for an office copy, and the page api', () => {
    const env = remotePublicEnv('test', text, { setting: { test: 'office', production: 'supabase' } });
    expect([env.VITE_API_URL, env.VITE_MADAR_AUTH, env.VITE_MADAR_LIVE]).toEqual(['/api', 'madar', 'socket']);
  });

  it('keeps the Supabase sign-in and Realtime for a workers or supabase copy', () => {
    const env = remotePublicEnv('test', text, { setting: { test: 'workers', production: 'supabase' } });
    expect([env.VITE_MADAR_AUTH, env.VITE_MADAR_LIVE]).toEqual([undefined, undefined]);
  });

  it('refuses a public file that sets VITE_MADAR_AUTH or VITE_MADAR_LIVE: the host word decides them', () => {
    expect(() => remotePublicEnv('test', `${text}VITE_MADAR_AUTH=madar\n`)).toThrow('must not set VITE_MADAR_AUTH');
    expect(() => remotePublicEnv('test', `${text}VITE_MADAR_LIVE=socket\n`)).toThrow('must not set VITE_MADAR_LIVE');
  });
});
```

In `server/entries/officeWorker.test.ts`, add:

```ts
describe('which path of the Worker serves a request (exit wave 4)', () => {
  const OFFICE = { idFromName: () => 'id', get: () => ({}) };
  it('serves every path from the office object with MADAR_DATA = office and the binding', () => {
    expect(servesOffice({ MADAR_DATA: 'office', OFFICE }, '/api/batch')).toBe(true);
  });
  it('serves /api/office/* from the office object whenever the binding exists, and nothing else', () => {
    expect(servesOffice({ OFFICE }, '/api/office/export')).toBe(true);
    expect(servesOffice({ OFFICE }, '/api/batch')).toBe(false);
  });
  it('serves nothing from the office object with no binding (production before wave 6)', () => {
    expect(servesOffice({ MADAR_DATA: 'office' }, '/api/office/export')).toBe(false);
    expect(hasOfficeBinding({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/core/serverHost.test.ts server/http/pagesApiProxy.test.ts server/http/pagesMcpProxy.test.ts server/usage/lite.test.ts scripts/build-remote.test.ts server/entries/officeWorker.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `office` is not a host word; `onWorker`, `servesOffice` and `hasOfficeBinding` do not exist.

- [ ] **Step 3: Write the word and its readers**

In `server/core/serverHost.ts`:

```ts
export const SERVER_HOSTS = ['supabase', 'workers', 'office'] as const;

/**
 * The copies that may take the word office now. Production takes it at the switch (wave 6 of the exit plan), in the same commit
 * that adds its office binding and its Cron; until then the setting refuses it.
 */
export const OFFICE_COPIES_OPEN: readonly Copy[] = ['test'];

/** True when the Worker of the copy serves its /api and /mcp: the Postgres path (workers) or the office object (office). */
export function onWorker(host: ServerHost): boolean {
  return host !== 'supabase';
}
```

In `parseServerHostSetting`, change the message to ``${copy} must be supabase, workers or office.`` and add, after `out[copy] = word as ServerHost;`:

```ts
    if (word === 'office' && !OFFICE_COPIES_OPEN.includes(copy)) {
      throw new Error(`config/server-host.json: ${copy} takes office only at the switch (wave 6 of the exit plan). Keep supabase or workers until then.`);
    }
```

In `screensApiUrl`: `return onWorker(host) ? '/api' : COPY_HOSTS[copy].supabase.api;`. Update the file comment: "one word for each copy,
supabase, workers or office (the office object of the copy, Supabase exit)".

In `server/http/pagesApiProxy.ts`, import `onWorker`, and replace the two lines that compute `onWorkers` and `binding` with:

```ts
  // The ops of the office object (exit wave 4) go to the Worker whatever the word says, and nowhere else: no Supabase function has them.
  const ops = suffix === '/office' || suffix.startsWith('/office/');
  const onWorkers = ops || onWorker(serverHostOf(copy, o.setting));
  const binding = onWorkers ? bindingOf(env, hosts.workers.binding) : undefined;
```

and, before the fallback log line, add `if (ops) return new Response(NOT_FOUND, { status: 404 });`.

In `server/http/pagesMcpProxy.ts`, import `onWorker` and set `const onWorkers = onWorker(serverHostOf(copy, o.setting));`.

In `server/core/ports.ts`:

```ts
/**
 * The calls of a month by host (owner, 2026-10-16). office: Workers Free allows 100,000 requests a day for the account, about
 * 3 million a month; the four day meters of the office object (exit wave 3) watch the real limits, so no month warning goes out.
 */
export const CALL_LIMITS: Record<ServerHost, number> = { supabase: 500_000, workers: 10_000_000, office: 3_000_000 };
```

In `server/usage/meters.ts`, `warningMeters`, replace the calls line with:

```ts
    ...(host === 'office' ? [] : [{ meter: host === 'workers' ? 'callsWorkers' : 'calls', value: meters.calls }]),
```

In `scripts/build-remote.ts`, `remotePublicEnv`, replace its body after `const env = parsePublicEnv(text);` with:

```ts
  for (const name of ['VITE_API_URL', 'VITE_MADAR_AUTH', 'VITE_MADAR_LIVE'] as const) {
    if (env[name] !== undefined) throw new Error(`config/remote.${target}.env must not set ${name}: config/server-host.json decides it (scripts/build-remote.ts).`);
  }
  const host = o.dev ? 'supabase' : (o.setting ?? SERVER_HOST_SETTING)[target];
  env.VITE_API_URL = screensApiUrl(target, host);
  // An office copy signs in with Madar and gets its live updates from the office object (exit waves 2 and 3).
  if (host === 'office') {
    env.VITE_MADAR_AUTH = 'madar';
    env.VITE_MADAR_LIVE = 'socket';
  }
  return env;
```

In `server/entries/officeWorker.ts`, add:

```ts
/** The routes of the office ops (exit wave 4): export, import, peek and drop, each behind its secret header. */
export const OFFICE_OPS_PREFIX = '/api/office/';

/** True when the env has the office binding OFFICE (the test Worker from wave 3; production from wave 6). */
export function hasOfficeBinding(env: Record<string, unknown>): boolean {
  const namespace = env.OFFICE as { idFromName?: unknown; get?: unknown } | undefined;
  return typeof namespace?.idFromName === 'function' && typeof namespace.get === 'function';
}

/**
 * True when the office path serves this request: every path with MADAR_DATA = "office", and the office ops whenever the binding
 * exists, so the import of wave 5 reaches the object before the word of the copy changes.
 */
export function servesOffice(env: Record<string, unknown>, pathname: string): boolean {
  if (!hasOfficeBinding(env)) return false;
  return env.MADAR_DATA === 'office' || pathname.startsWith(OFFICE_OPS_PREFIX);
}
```

In `server/entries/workerMain.ts`, import `servesOffice` from `./officeWorker` and change `fetch` to:

```ts
  fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    return servesOffice(env, new URL(request.url).pathname) ? office.fetch(request, env, ctx) : postgres.fetch(request, env, ctx);
  },
```

(`onOffice` stays for `scheduled`, which must not run the office jobs before the switch.)

- [ ] **Step 4: Run the tests to see them pass**

Run: the command of Step 2. Expected: PASS. Then `npm run typecheck`. Expected: PASS (every `Record<ServerHost, ...>` has `office`).

- [ ] **Step 5: Commit**

```bash
git add server/core/serverHost.ts server/core/serverHost.test.ts server/http/pagesApiProxy.ts server/http/pagesApiProxy.test.ts \
  server/http/pagesMcpProxy.ts server/http/pagesMcpProxy.test.ts server/core/ports.ts server/usage/meters.ts server/usage/lite.test.ts \
  scripts/build-remote.ts scripts/build-remote.test.ts server/entries/officeWorker.ts server/entries/officeWorker.test.ts server/entries/workerMain.ts
git commit -m "Exit wave 4: the host word office for the test copy, with the Madar sign-in and the live socket in its screens build"
```

### Task 3: The discovery files of the own OAuth server on Pages

**Files:**
- Create: `functions/.well-known/oauth-authorization-server/[[path]].ts`, `functions/.well-known/openid-configuration/[[path]].ts`
- Modify: `server/http/pagesWellKnown.ts`, `server/http/pagesWellKnown.test.ts`, `functions/CLAUDE.md`
- Test: `server/http/pagesWellKnown.test.ts`

**Interfaces:**
- Consumes: `WELL_KNOWN_FORWARDS`, `proxyWellKnown` (wave 2), `copyOfPageHost`, `serverHostOf` (`server/core/serverHost.ts`).
- Produces: `proxyWellKnown` answers 404 unless the copy of the page host has the word `office`; the two Pages Functions.

The wave 2 plan put this file in wave 5. This plan adds it now, because the host rule keeps it inert: a Pages Function file goes
to production with the next production release, and there it answers 404 (production says `supabase`). Wave 2 checked that
`wrangler pages functions build` routes `functions/.well-known/oauth-authorization-server/[[path]].ts` to
`/.well-known/oauth-authorization-server/*`. Two narrow files, not one `functions/.well-known/[[path]].ts`, so no other
`/.well-known/` path of the site changes.

- [ ] **Step 1: Write the failing tests**

In `server/http/pagesWellKnown.test.ts`, add:

```ts
describe('the discovery files only for an office copy (exit wave 4)', () => {
  const env = (seen: string[]) => ({ MADAR_SERVER_TEST: { fetch: async (request: Request) => (seen.push(new URL(request.url).pathname), Response.json({ issuer: 'x' })) } });

  it('forwards the discovery path of an office copy to /mcp/.well-known of its Worker', async () => {
    const seen: string[] = [];
    const response = await proxyWellKnown(new Request('https://preview.madar-46r.pages.dev/.well-known/oauth-authorization-server/mcp'), fetch, env(seen), { setting: { test: 'office', production: 'supabase' }, log: () => undefined });
    expect(response.status).toBe(200);
    expect(seen).toEqual(['/mcp/.well-known/oauth-authorization-server']);
  });

  it('answers 404 on a copy that is not office, and on production before wave 6', async () => {
    const seen: string[] = [];
    for (const url of ['https://preview.madar-46r.pages.dev/.well-known/openid-configuration/mcp', 'https://madar.vado.sa/.well-known/oauth-authorization-server/mcp']) {
      const response = await proxyWellKnown(new Request(url), fetch, env(seen), { setting: { test: 'workers', production: 'supabase' }, log: () => undefined });
      expect(response.status).toBe(404);
    }
    expect(seen).toEqual([]);
  });
});

it('the two Pages Functions call proxyWellKnown', async () => {
  const { readFileSync } = await import('node:fs');
  for (const name of ['oauth-authorization-server', 'openid-configuration']) {
    const text = readFileSync(new URL(`../../functions/.well-known/${name}/[[path]].ts`, import.meta.url), 'utf8');
    expect(text).toContain('proxyWellKnown(request, fetch, env)');
  }
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/http/pagesWellKnown.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. The forward passes for a `workers` copy, and the two files do not exist.

- [ ] **Step 3: Write the rule and the files**

In `server/http/pagesWellKnown.ts`, import `copyOfPageHost` and `serverHostOf` from `../core/serverHost`, and add after the
`target === undefined` check:

```ts
  // Only an office copy runs the own OAuth server (exit wave 4). Every other copy answers 404, as the Pages site did before.
  const copy = copyOfPageHost(url.hostname);
  if (!copy || serverHostOf(copy, o.setting) !== 'office') return new Response('Not found.', { status: 404 });
```

Change the file comment: "Wave 4 adds the two Pages Functions; they answer only for an office copy, so production gets 404 until
the switch."

Create `functions/.well-known/oauth-authorization-server/[[path]].ts`:

```ts
// Cloudflare Pages Function for /.well-known/oauth-authorization-server/*: the discovery document of the own OAuth server of an
// office copy (server/http/pagesWellKnown.ts). Every other copy answers 404.
import { proxyWellKnown } from '../../../server/http/pagesWellKnown';

export const onRequest = ({ request, env }: { request: Request; env: Record<string, unknown> }): Promise<Response> => proxyWellKnown(request, fetch, env);
```

Create `functions/.well-known/openid-configuration/[[path]].ts` with the same two code lines and the comment
"/.well-known/openid-configuration/*: the OIDC form of the same document".

In `functions/CLAUDE.md`, add one line: "`.well-known/oauth-authorization-server/[[path]].ts` and
`.well-known/openid-configuration/[[path]].ts` (exit wave 4): the discovery of the own OAuth server, only for a copy with the word
office (`server/http/pagesWellKnown.ts`); every other copy answers 404."

- [ ] **Step 4: Run the test to see it pass**

Run: the command of Step 2. Expected: PASS. Then check the Pages build of the folder in a scratch copy (sandbox off):
`npx wrangler pages functions build --outdir "$TMPDIR/wk-build"` from the worktree root. Expected: the build ends with no error.

- [ ] **Step 5: Commit**

```bash
git add 'functions/.well-known/oauth-authorization-server/[[path]].ts' 'functions/.well-known/openid-configuration/[[path]].ts' \
  server/http/pagesWellKnown.ts server/http/pagesWellKnown.test.ts functions/CLAUDE.md
git commit -m "Exit wave 4: the Pages Functions of the OAuth discovery, which answer only for an office copy"
```

---

# Block B: Hold, export, backup, restore (Tasks 4 to 9, about 1 builder hour)

### Task 4: The office hold, the export pages and the test reads in the object

**Files:**
- Create: `server/office/ops.ts`, `server/office/ops.test.ts`
- Modify: `server/office/parts.ts` (`hold`, `ops`, the refusals in `batch`, `route`, `cron`, `runEffects`), `server/office/office.ts`
  (`fetch` sends `/office/*` to `ops`; `drop`)
- Test: `server/office/ops.test.ts`

**Interfaces:**
- Consumes: `liteSchemaSql`, `LITE_SCHEMA_VERSION` (`server/data/lite/schema.ts`), `serverCallMap` (`server/core/serverCallMap.ts`),
  `copyOfPageHost`, `copyOfSupabaseUrl` (`server/core/serverHost.ts`), `errorResponse`, `runErrorOf` (`server/http/errors.ts`),
  `nodeOffice`, `httpOf` (Task 1).
- Produces: `EXPORT_TABLES: readonly string[]`; `EXPORT_SKIP`; `ROWID_ALIAS: ReadonlyMap<string, string>`;
  `DRIFT_TABLES: readonly string[]`; `HOLD_MS = { export: 300_000, import: 1_800_000 }`; `class OfficeHold` with
  `begin(kind, now): string`, `active(now)`, `check(id, now)`, `end(id)`, `refusal({ now, writes })`; `BACKUP_BUSY`, `IMPORT_BUSY`;
  `writesIn(calls): boolean`; `EXPORT_PAGE_ROWS = 1_000`, `EXPORT_PAGE_CHARS = 4_000_000`;
  `type ExportStep`, `type ExportBegin = { id; schema; version; officeSeq; tables; until }`,
  `type ExportPage = { rows: Record<string, SqlValue>[]; next: number | null }`, `type ExportEnd = { version; officeSeq }`;
  `exportPage(db, table, after)`; `PEEK_ROWS = 200`; `peek(db, text, values)`; `testToolsOn(read): boolean`;
  `OFFICE_NAME_HEADER = 'x-madar-office-name'`; `REHEARSAL_NAME = /^rehearsal-\d{8}$/`; `OfficeParts.hold`;
  `OfficeParts.ops(request: Request): Promise<Response>` (it answers `/office/export` and `/office/peek` here; Task 10 adds
  `/office/import`).

- [ ] **Step 1: Write the failing tests**

Create `server/office/ops.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { liteSchemaSql } from '../data/lite/schema';
import { DRIFT_TABLES, EXPORT_PAGE_ROWS, EXPORT_TABLES, HOLD_MS, ROWID_ALIAS, testToolsOn } from './ops';
import { httpOf, NODE_NOW, nodeOffice } from './test/nodeOffice';

const post = (path: string, body: unknown) => new Request(`https://office.internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const json = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
};
const write = { i: 0, name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Held' } } };
const read = { i: 0, name: 'tasks.list', input: { scope: 'mine' } };

describe('the tables of an export (server/office/ops.ts)', () => {
  it('takes every table of the schema but the snapshot and the version row', () => {
    const all = liteSchemaSql().flatMap((text) => /^create table (\w+) /.exec(text)?.[1] ?? []);
    expect([...EXPORT_TABLES].sort()).toEqual(all.filter((t) => t !== 'office_snapshot' && t !== 'schema_version').sort());
  });

  it('knows the tables whose integer primary key is the rowid', () => {
    expect(Object.fromEntries(ROWID_ALIAS)).toEqual({ office_meta: 'id', office_snapshot: 'part', outbox: 'id', mail_log: 'id', mail_outbox: 'id', schema_version: 'id' });
  });

  it('names only tables of the export as drift tables', () => {
    for (const table of DRIFT_TABLES) expect(EXPORT_TABLES).toContain(table);
  });

  it('reads one page with the primary key order of the table, so SQLite needs no sort step', () => {
    const raw = new DatabaseSync(':memory:');
    for (const text of liteSchemaSql()) raw.exec(text);
    const plan = raw.prepare('explain query plan select rowid as _rowid, * from events where rowid > ?1 order by rowid limit ?2').all(0, EXPORT_PAGE_ROWS) as { detail: string }[];
    const details = plan.map((row) => row.detail).join(' | ');
    expect(details).toMatch(/SEARCH events USING INTEGER PRIMARY KEY/);
    expect(details).not.toMatch(/TEMP B-TREE/);
  });
});

describe('the hold of an export (server/office/parts.ts)', () => {
  it('refuses a write batch and serves a read batch while an export holds the office, and both after the end', async () => {
    const t = await nodeOffice();
    const begin = await json<{ id: string }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const refused = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [write], overviewCalls: 0, worker: 0 }, t.net);
    expect(refused).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'busy' } } });
    expect(refused.ok === false && refused.error.message).toContain('nightly backup');
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: false })).toBeUndefined();
    await json(await t.parts.ops(post('/office/export', { step: 'end', id: begin.id })));
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: true })).toBeUndefined();
  });

  it('ends the hold by itself after 5 minutes', async () => {
    const t = await nodeOffice();
    await json(await t.parts.ops(post('/office/export', { step: 'begin' })));
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: true })).toBeDefined();
    t.clock.set(new Date(Date.parse(NODE_NOW) + HOLD_MS.export));
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: true })).toBeUndefined();
  });

  it('refuses a page of an export that ended, so a late page never mixes two offices', async () => {
    const t = await nodeOffice();
    const begin = await json<{ id: string }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    await json(await t.parts.ops(post('/office/export', { step: 'end', id: begin.id })));
    const late = await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'tasks', after: 0 }));
    expect(late.status).toBe(409);
    expect(await late.text()).toContain('hold_ended');
  });

  it('lets the sign-in routes run while an export holds the office, and refuses an MCP request', async () => {
    const t = await nodeOffice();
    await json(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const signin = await t.parts.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'a@madar.test', password: 'x' }), t.net);
    expect(signin.status).not.toBe(503);
    const mcp = await t.parts.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }), t.net);
    expect(mcp.status).toBe(503);
    expect(mcp.body).toContain('busy');
  });

  it('runs no job step while an export holds the office, and closes the stale sockets still', async () => {
    const t = await nodeOffice();
    await json(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const report = await t.parts.cron({ at: NODE_NOW, worker: 0 }, t.net);
    expect(report.steps).toEqual([]);
    expect(t.raw.prepare("select count(*) as n from job_runs where key = 'heartbeat'").get()).toEqual({ n: 0 });
  });

  it('gives every row of each table in pages, with the rowid, and the same version at the begin and the end', async () => {
    const t = await nodeOffice();
    const begin = await json<{ id: string; tables: string[]; version: number; officeSeq: number }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    let events = 0;
    for (let after = 0; ; ) {
      const page = await json<{ rows: { _rowid: number; doc: string }[]; next: number | null }>(await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'events', after })));
      events += page.rows.length;
      expect(typeof page.rows[0]?.doc).toBe('string');
      if (page.next === null) break;
      after = page.next;
    }
    expect(events).toBe(Number((t.raw.prepare('select count(*) as n from events').get() as { n: number }).n));
    const end = await json<{ version: number; officeSeq: number }>(await t.parts.ops(post('/office/export', { step: 'end', id: begin.id })));
    expect(end).toEqual({ version: begin.version, officeSeq: begin.officeSeq });
  });
});

describe('the test reads (server/office/ops.ts)', () => {
  it('turns the test tools on only with MADAR_TEST_TOOLS on, and never on a production copy', () => {
    const read = (env: Record<string, string>) => (name: string) => env[name];
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co', APP_URL: 'https://preview.madar-46r.pages.dev' }))).toBe(true);
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'http://127.0.0.1:54321', APP_URL: 'http://127.0.0.1:4174' }))).toBe(true);
    expect(testToolsOn(read({ SUPABASE_URL: 'http://127.0.0.1:54321', APP_URL: 'http://127.0.0.1:4174' }))).toBe(false);
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'https://oprkvdjudjxxhvodkzgs.supabase.co', APP_URL: 'http://127.0.0.1:4174' }))).toBe(false);
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'http://127.0.0.1:54321', APP_URL: 'https://madar.vado.sa' }))).toBe(false);
  });

  it('answers a select with at most 200 rows, and refuses a write and a copy with the tools off', async () => {
    const on = await nodeOffice({ env: { MADAR_TEST_TOOLS: 'on' } });
    const rows = await json<{ id: string }[]>(await on.parts.ops(post('/office/peek', { text: 'select id from events', values: [] })));
    expect(rows.length).toBe(200);
    expect((await on.parts.ops(post('/office/peek', { text: 'delete from events', values: [] }))).status).toBe(400);
    const off = await nodeOffice();
    expect((await off.parts.ops(post('/office/peek', { text: 'select 1 as n', values: [] }))).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run --project server server/office/ops.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './ops'".

- [ ] **Step 3: Write the hold, the pages and the reads**

Create `server/office/ops.ts`:

```ts
import { ApiError } from '../../src/api/errors';
import type { WireCall } from '../../src/api/remote/wire';
import type { ReadEnv } from '../core/deps';
import { serverCallMap } from '../core/serverCallMap';
import { copyOfPageHost, copyOfSupabaseUrl } from '../core/serverHost';
import type { RunError } from '../core/types';
import type { LiteDb } from '../data/lite/db';
import type { SqlValue } from '../data/lite/host';
import { liteSchemaSql } from '../data/lite/schema';
import { runErrorOf } from '../http/errors';

/**
 * The office ops of the object (Supabase exit, wave 4): the hold of an export or an import, the pages of an export, and the test
 * reads. The Worker checks the secret header and hands each step here (server/entries/officeWorker.ts). The hold lives in memory:
 * an object that restarts loses it, and the next step of that export or import gets hold_ended, so the client starts again.
 */

function tablesOf(): { name: string; alias?: string }[] {
  return liteSchemaSql().flatMap((text) => {
    const match = /^create table (\w+) \((\w+) (integer primary key)?/.exec(text);
    return match ? [{ name: match[1], ...(match[3] ? { alias: match[2] } : {}) }] : [];
  });
}

/** The tables that an export leaves out: the snapshot comes back from the tables, and the schema step makes the version row. */
export const EXPORT_SKIP: readonly string[] = ['office_snapshot', 'schema_version'];

/** Every table of the schema, in schema order, but the ones of EXPORT_SKIP. */
export const EXPORT_TABLES: readonly string[] = tablesOf().map((t) => t.name).filter((name) => !EXPORT_SKIP.includes(name));

/** The tables whose integer primary key is the rowid: a restore writes that column, and no rowid beside it. */
export const ROWID_ALIAS: ReadonlyMap<string, string> = new Map(tablesOf().flatMap((t) => (t.alias ? [[t.name, t.alias] as const] : [])));

/**
 * The tables that may change while an export holds the office: the sign-in rows (a refresh, a consent), the mail and the outbox
 * (the effects of a write that came before the hold), the limits and the meters. Their rows are what the export read; a count
 * that differs from the live office is a note, never a failure (the rule of OUTSIDE_OFFICE_LOCK of the Postgres backup).
 */
export const DRIFT_TABLES: readonly string[] = [
  'auth_users', 'auth_links', 'auth_sessions', 'oauth_clients', 'oauth_requests', 'agent_approvals', 'rate_limits', 'outbox', 'mail_log',
  'mail_outbox', 'usage_day', 'usage_month', 'usage_warnings',
];

/** An export holds the office for at most 5 minutes (spec section 2); an import for at most 30 minutes. */
export const HOLD_MS = { export: 5 * 60_000, import: 30 * 60_000 } as const;
export type HoldKind = keyof typeof HOLD_MS;

export const BACKUP_BUSY = new ApiError('failed', 'Madar saves its nightly backup. Try again in a few minutes.', { reason: 'busy' });
export const IMPORT_BUSY = new ApiError('failed', 'Madar loads the office data. Try again in a few minutes.', { reason: 'busy' });
const HOLD_ENDED = new ApiError('conflict', 'This export or import ended. Start it again.', { reason: 'hold_ended' });
const HELD = new ApiError('conflict', 'An export or an import holds the office already. Try again when it ends.', { reason: 'busy' });

function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class OfficeHold {
  #held: { id: string; kind: HoldKind; until: number } | undefined;

  begin(kind: HoldKind, now: Date): string {
    if (this.active(now)) throw HELD;
    const id = newId();
    this.#held = { id, kind, until: now.getTime() + HOLD_MS[kind] };
    return id;
  }

  active(now: Date): { id: string; kind: HoldKind; until: number } | undefined {
    const held = this.#held;
    return held && now.getTime() < held.until ? held : undefined;
  }

  /** Throws hold_ended unless this id holds the office now. */
  check(id: string, now: Date): void {
    if (this.active(now)?.id !== id) throw HOLD_ENDED;
  }

  end(id: string): void {
    if (this.#held?.id === id) this.#held = undefined;
  }

  /** The refusal of a batch, a route or a Cron run: an export refuses writes only, an import refuses every call. */
  refusal(o: { now: Date; writes: boolean }): RunError | undefined {
    const held = this.active(o.now);
    if (!held || (held.kind === 'export' && !o.writes)) return undefined;
    return runErrorOf(held.kind === 'export' ? BACKUP_BUSY : IMPORT_BUSY);
  }
}

/** True when a call of the batch writes: a call that the map does not know counts as a write (it fails anyway). */
export function writesIn(calls: readonly Pick<WireCall, 'name'>[]): boolean {
  return calls.some((call) => serverCallMap.get(call.name)?.readOnly !== true);
}

export const EXPORT_PAGE_ROWS = 1_000;
/** About 4 MB of text in one answer: the Worker passes the body on as a stream, so its 128 MB and 10 ms of CPU stay free. */
export const EXPORT_PAGE_CHARS = 4_000_000;

export type ExportStep = { step: 'begin' } | { step: 'page'; id: string; table: string; after: number } | { step: 'end'; id: string };
export type ExportBegin = { id: string; schema: number; version: number; officeSeq: number; tables: string[]; until: string };
export type ExportPage = { rows: Record<string, SqlValue>[]; next: number | null };
export type ExportEnd = { version: number; officeSeq: number };

/**
 * One page of a table: the rows after a rowid, in rowid order, with the rowid as _rowid. The rowid order is the order of the table
 * itself (no sort step, the test reads the plan), and the limit cuts it: the one form of order by that the wave 0 rule allows. The
 * host reads the raw values, so a JSON column comes back as its text, byte for byte.
 */
export function exportPage(db: LiteDb, table: string, after: number): ExportPage {
  if (!EXPORT_TABLES.includes(table)) throw new ApiError('invalid_input', `The export has no table ${table}.`);
  const { rows } = db.host.exec(`select rowid as _rowid, * from ${table} where rowid > ?1 order by rowid limit ?2`, [after, EXPORT_PAGE_ROWS]);
  const kept: Record<string, SqlValue>[] = [];
  let chars = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (kept.length > 0 && chars + size > EXPORT_PAGE_CHARS) return { rows: kept, next: Number(kept[kept.length - 1]._rowid) };
    kept.push(row);
    chars += size;
  }
  return { rows: kept, next: rows.length === EXPORT_PAGE_ROWS ? Number(kept[kept.length - 1]._rowid) : null };
}

export const META_ROW_LITE = 'select version, office_seq from office_meta where id = 1';

export const PEEK_ROWS = 200;

/** One select of a test, at most 200 rows: the deploy suite on the office path reads its checks this way. */
export async function peek(db: LiteDb, text: string, values: readonly unknown[]): Promise<Record<string, unknown>[]> {
  if (!/^\s*select\b/i.test(text) || text.includes(';')) throw new ApiError('invalid_input', 'peek runs one select only.');
  const rows = await db.statement<Record<string, unknown>>('read', text, [...values]);
  return rows.slice(0, PEEK_ROWS);
}

/**
 * The test tools (the replace mode of the import, peek): only with MADAR_TEST_TOOLS = "on", and never on a copy whose Supabase
 * project or app address is production. wrangler.server.toml sets the var for the test Worker only (Task 18 of wave 4 pins it).
 */
export function testToolsOn(read: ReadEnv): boolean {
  if (read('MADAR_TEST_TOOLS') !== 'on') return false;
  let appHost = '';
  try {
    appHost = new URL(read('APP_URL') ?? '').hostname;
  } catch {
    appHost = '';
  }
  return copyOfSupabaseUrl(read('SUPABASE_URL') ?? '') !== 'production' && copyOfPageHost(appHost) !== 'production';
}

/** The header of the Worker that names the object of an op (the drop step checks it). */
export const OFFICE_NAME_HEADER = 'x-madar-office-name';
/** The name of a spare object of the production rehearsal (wave 5): rehearsal-YYYYMMDD. */
export const REHEARSAL_NAME = /^rehearsal-\d{8}$/;
```

In `server/office/parts.ts`:

1. Import from `./ops`: `exportPage, META_ROW_LITE, OfficeHold, peek, testToolsOn, writesIn, type ExportStep` and
   `import { LITE_SCHEMA_VERSION } from '../data/lite/schema';` (already there) and `errorResponse, runErrorOf` from `../http/errors`.

2. Add to `OfficeParts`: `readonly hold: OfficeHold;` and `ops(request: Request): Promise<Response>;`

3. After `const tickets = new LiveTickets();` add `const hold = new OfficeHold();` and
   `const tools = testToolsOn(o.read);`

4. At the start of `batch`, after `meter.request(...)`:

```ts
      const held = hold.refusal({ now: clock.now(), writes: writesIn(input.calls) });
      if (held) return { ok: false, error: held };
```

5. At the start of `route`, after `meter.request(...)`:

```ts
      // An export lets the sign-in and OAuth routes run (their rows are drift tables); an MCP request may write, so it waits.
      const path = new URL(input.url).pathname;
      const held = hold.refusal({ now: clock.now(), writes: path === '/mcp' || path === '/mcp/' });
      if (held) return { status: 503, headers: [['content-type', 'application/json']], body: JSON.stringify({ error: { ...held, details: { ...held.details } } }), later: [] };
```

6. At the start of `runEffects`, after `meter.request(...)`: `if (hold.active(clock.now())?.kind === 'import') return { done: 0, failed: 0 };`
   (the rows wait for the Cron).

7. In `cron`, after `const at = new Date(input.at);`:

```ts
      if (hold.active(at)) {
        log.info('The office jobs wait: an export or an import holds the office.', { at: input.at });
        const closed = sweep(o.sockets, clock.now(), staleMs);
        return { ok: true, at: input.at, steps: [], closed, day: null };
      }
```

8. Add the method `ops` to the returned object, and `hold` beside `tickets`:

```ts
    async ops(request) {
      const now = clock.now();
      try {
        const path = new URL(request.url).pathname;
        const body = (await request.json()) as Record<string, unknown>;
        if (path === '/office/export') return Response.json(await exportStep(body as ExportStep, now));
        if (path === '/office/peek') {
          if (!tools) throw new ApiError('forbidden', 'The test reads are off on this copy.');
          return Response.json(await peek(db, String(body.text ?? ''), Array.isArray(body.values) ? body.values : []));
        }
        throw new ApiError('not_found', 'This office op does not exist.');
      } catch (error) {
        return errorResponse(runErrorOf(error));
      }
    },
```

   with this helper inside `officeParts`, before the `return`:

```ts
  async function exportStep(step: ExportStep, now: Date) {
    const meta = async () => {
      const [row] = await db.statement<{ version: number; office_seq: number }>('read', META_ROW_LITE);
      return { version: Number(row.version), officeSeq: Number(row.office_seq) };
    };
    if (step.step === 'begin') {
      const id = hold.begin('export', now);
      return { id, schema: LITE_SCHEMA_VERSION, ...(await meta()), tables: [...EXPORT_TABLES], until: new Date(hold.active(now)!.until).toISOString() };
    }
    hold.check(step.id, now);
    if (step.step === 'page') return exportPage(db, step.table, Number(step.after));
    const out = await meta();
    hold.end(step.id);
    return out;
  }
```

   (import `ApiError` from `../../src/api/errors` and `EXPORT_TABLES` from `./ops`).

In `server/office/office.ts`, import `OFFICE_NAME_HEADER`, `REHEARSAL_NAME` from `./ops`, and replace `fetch` with:

```ts
  fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/office/drop') return this.drop(request);
    if (pathname.startsWith('/office/')) return this.parts.ops(request);
    return this.parts.socket(request);
  }

  /**
   * Drops the storage of a spare object (the production rehearsal of wave 5). The Worker names the object in a header; the office
   * of a copy ("office") is never dropped here. The object must not take a request after it.
   */
  private async drop(request: Request): Promise<Response> {
    if (!REHEARSAL_NAME.test(request.headers.get(OFFICE_NAME_HEADER) ?? '')) {
      return Response.json({ error: { code: 'forbidden', message: 'Only a spare object of the rehearsal can be dropped.' } }, { status: 403 });
    }
    await this.ctx.storage.deleteAll();
    return Response.json({ ok: true });
  }
```

(In `server/office/workers.d.ts`, add `deleteAll(): Promise<void>;` to `DurableObjectStorage` when it is not there.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/office/ops.test.ts server/office/parts.test.ts server/office/http.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. Then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/office/ops.ts server/office/ops.test.ts server/office/parts.ts server/office/office.ts server/office/workers.d.ts
git commit -m "Exit wave 4: the hold of an export, the export pages in rowid order and the test reads of the office object"
```

### Task 5: The ops routes of the Worker, behind their secrets

**Files:**
- Modify: `server/entries/officeWorker.ts`, `server/entries/officeWorker.test.ts`, `server/entries/officeEntry.ts`,
  `server/office/test/live/entry.ts`, `server/office/test/live/harness.ts`, `server/office/test/live/wrangler.toml`
- Create: `server/office/ops.wd.test.ts`
- Test: `server/entries/officeWorker.test.ts`, `server/office/ops.wd.test.ts`

**Interfaces:**
- Consumes: `OFFICE_OPS_PREFIX` (Task 2), `OFFICE_NAME_HEADER`, `REHEARSAL_NAME` (Task 4), `sameSecret` (`server/jobs/app.ts`).
- Produces: `EXPORT_SECRET_HEADER = 'x-madar-export-secret'`, `OPS_SECRET_HEADER = 'x-madar-ops-secret'`;
  `OfficeRoutesOptions.exportSecret`, `.opsSecret`, `.stubOf(env, name)`; the routes `POST /api/office/export|import|peek|drop`
  (`?office=<name>`; `export` and `import` take `office` or a rehearsal name, `peek` only `office`, `drop` only a rehearsal name);
  `startLive()` gives `ops(op, body, o?)`; the secrets `MADAR_EXPORT_SECRET` and `MADAR_OPS_SECRET` of the env.

- [ ] **Step 1: Write the failing tests**

In `server/entries/officeWorker.test.ts`, add:

```ts
describe('the office ops behind their secrets (exit wave 4)', () => {
  function opsRoutes() {
    const seen: { name: string; path: string; header: string | null }[] = [];
    const stubFor = (name: string) => ({
      fetch: async (request: Request) => {
        seen.push({ name, path: new URL(request.url).pathname, header: request.headers.get('x-madar-office-name') });
        return Response.json({ ok: true });
      },
    });
    const routes = officeRoutes({
      deps: { config: testConfig(), clock: { now: () => new Date() }, log: { info: () => undefined, warn: () => undefined, error: () => undefined } },
      verifyToken: async () => ({ authUserId: 'x' }),
      stub: () => stubFor('office') as never,
      stubOf: (_env, name) => stubFor(name) as never,
      net: () => ({}) as never,
      jobsSecret: () => 'jobs',
      exportSecret: () => 'export-secret-of-the-test',
      opsSecret: () => 'ops-secret-of-the-test',
    });
    return { routes, seen };
  }
  const post = (path: string, headers: Record<string, string>) => new Request(`https://w.test${path}`, { method: 'POST', headers, body: '{"step":"begin"}' });

  it('refuses an op with no secret, a wrong secret, or the secret of the other op', async () => {
    const { routes, seen } = opsRoutes();
    for (const headers of [{}, { 'x-madar-export-secret': 'no' }, { 'x-madar-ops-secret': 'export-secret-of-the-test' }]) {
      expect((await routes.fetch(post('/api/office/export', headers), {})).status).toBe(401);
    }
    expect((await routes.fetch(post('/api/office/import', { 'x-madar-export-secret': 'export-secret-of-the-test' }), {})).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('hands export to the named object with the export secret, and import with the ops secret', async () => {
    const { routes, seen } = opsRoutes();
    expect((await routes.fetch(post('/api/office/export', { 'x-madar-export-secret': 'export-secret-of-the-test' }), {})).status).toBe(200);
    expect((await routes.fetch(post('/api/office/import?office=rehearsal-20261020', { 'x-madar-ops-secret': 'ops-secret-of-the-test' }), {})).status).toBe(200);
    expect(seen).toEqual([
      { name: 'office', path: '/office/export', header: 'office' },
      { name: 'rehearsal-20261020', path: '/office/import', header: 'rehearsal-20261020' },
    ]);
  });

  it('drops only a rehearsal object, and peeks only into the office of the copy', async () => {
    const { routes, seen } = opsRoutes();
    const ops = { 'x-madar-ops-secret': 'ops-secret-of-the-test' };
    expect((await routes.fetch(post('/api/office/drop', ops), {})).status).toBe(403);
    expect((await routes.fetch(post('/api/office/peek?office=rehearsal-20261020', ops), {})).status).toBe(403);
    expect((await routes.fetch(post('/api/office/drop?office=rehearsal-20261020', ops), {})).status).toBe(200);
    expect(seen.map((s) => s.path)).toEqual(['/office/drop']);
  });

  it('answers 401 when the copy has no secret for the op at all', async () => {
    const routes = officeRoutes({
      deps: { config: testConfig(), clock: { now: () => new Date() }, log: { info: () => undefined, warn: () => undefined, error: () => undefined } },
      verifyToken: async () => ({ authUserId: 'x' }), stub: () => ({}) as never, net: () => ({}) as never, jobsSecret: () => undefined,
      exportSecret: () => undefined, opsSecret: () => undefined,
    });
    expect((await routes.fetch(post('/api/office/export', { 'x-madar-export-secret': '' }), {})).status).toBe(401);
  });
});
```

Create `server/office/ops.wd.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { startLive } from './test/live/harness';

const TODAY = '2026-10-04';

describe('the office ops on local workerd (server/office/ops.wd.test.ts)', () => {
  let live: Awaited<ReturnType<typeof startLive>>;

  beforeAll(async () => {
    live = await startLive();
    await live.fresh(await buildSeed(TODAY, async () => undefined));
  }, 120_000);

  afterAll(async () => {
    await live?.server.close();
  });

  it('exports every task of the office through the Worker, and holds the writes of a batch meanwhile', async () => {
    const begin = (await live.ops('export', { step: 'begin' })) as { id: string; tables: string[] };
    expect(begin.tables).toContain('tasks');
    const held = await live.batch('usr_001', [{ name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Held' } } }]);
    expect(held.body.error?.details?.reason).toBe('busy');
    const page = (await live.ops('export', { step: 'page', id: begin.id, table: 'tasks', after: 0 })) as { rows: unknown[]; next: number | null };
    expect(page.rows.length).toBe((await live.rows('select id from tasks')).length);
    await live.ops('export', { step: 'end', id: begin.id });
    const after = await live.batch('usr_001', [{ name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Free' } } }]);
    expect(after.status).toBe(200);
  });

  it('reads another object by its rehearsal name, and drops it, and never drops the office of the copy', async () => {
    const other = (await live.ops('export', { step: 'begin' }, { office: 'rehearsal-20261004' })) as { id: string; officeSeq: number };
    expect(other.officeSeq).toBe(0);
    await live.ops('export', { step: 'end', id: other.id }, { office: 'rehearsal-20261004' });
    expect(await live.ops('drop', {}, { office: 'rehearsal-20261004' })).toEqual({ ok: true });
    await expect(live.ops('drop', {})).rejects.toThrow(/403/);
  });

  it('answers a peek with the test tools on, and refuses the export with no secret', async () => {
    expect(await live.ops('peek', { text: "select id from users where id = 'usr_001'", values: [] })).toEqual([{ id: 'usr_001' }]);
    const response = await live.worker().fetch('/api/office/export', { method: 'POST', body: '{"step":"begin"}' });
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server server/entries/officeWorker.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. Then (sandbox off) `MADAR_OFFICE=1 npx vitest run --project office server/office/ops.wd.test.ts --no-file-parallelism --testTimeout=60000`.
Expected: FAIL. `/api/office/export` falls into the forward of Task 1 and the object answers `not_found`; `live.ops` does not exist.

- [ ] **Step 3: Write the routes, the options and the test Worker**

In `server/entries/officeWorker.ts`:

```ts
export const EXPORT_SECRET_HEADER = 'x-madar-export-secret';
export const OPS_SECRET_HEADER = 'x-madar-ops-secret';

/** Each op, its secret and the object names it takes. export is the nightly GitHub job; the others run from the Mac. */
const OPS: Readonly<Record<string, { secret: 'export' | 'ops'; names: 'any' | 'office' | 'rehearsal' }>> = {
  export: { secret: 'export', names: 'any' },
  import: { secret: 'ops', names: 'any' },
  peek: { secret: 'ops', names: 'office' },
  drop: { secret: 'ops', names: 'rehearsal' },
};

function nameAllowed(rule: 'any' | 'office' | 'rehearsal', name: string): boolean {
  if (rule === 'office') return name === OFFICE_NAME;
  if (rule === 'rehearsal') return REHEARSAL_NAME.test(name);
  return name === OFFICE_NAME || REHEARSAL_NAME.test(name);
}
```

Import `OFFICE_NAME_HEADER`, `REHEARSAL_NAME` from `../office/ops`, and define `export const OFFICE_NAME = 'office';` here (move it
from `officeEntry.ts`, which then imports it from here, so a node test can read it). Add to `OfficeRoutesOptions`:

```ts
  /** The object of an op by its name (the office of the copy, or a spare object of the rehearsal). Default: stub, for "office". */
  stubOf?: (env: Env, name: string) => Pick<OfficeStub, 'fetch'>;
  /** MADAR_EXPORT_SECRET: the nightly export of GitHub. */
  exportSecret?: () => string | undefined;
  /** MADAR_OPS_SECRET: the import, the peek and the drop from the Mac. */
  opsSecret?: () => string | undefined;
```

Add the function inside `officeRoutes`, before `forward`:

```ts
  /** One office op: the secret first, then the object name, then the body goes on to the object as a stream (no parse here). */
  async function ops(request: Request, env: Env, op: string): Promise<Response> {
    const rule = OPS[op];
    if (!rule || request.method !== 'POST') return errorResponse({ code: 'not_found', message: 'This address does not exist.' });
    const secret = rule.secret === 'export' ? o.exportSecret?.() : o.opsSecret?.();
    const given = request.headers.get(rule.secret === 'export' ? EXPORT_SECRET_HEADER : OPS_SECRET_HEADER);
    if (!secret || given === null || !(await sameSecret(given, secret))) {
      return errorResponse({ code: 'unauthenticated', message: 'The secret of this address is not right.' });
    }
    const name = new URL(request.url).searchParams.get('office') ?? OFFICE_NAME;
    if (!nameAllowed(rule.names, name)) return errorResponse({ code: 'forbidden', message: 'This office name is not allowed for this op.' });
    const stub = o.stubOf ? o.stubOf(env, name) : o.stub(env);
    try {
      return await stub.fetch(new Request(`https://office.internal/office/${op}`, {
        method: 'POST', headers: { 'content-type': 'application/json', [OFFICE_NAME_HEADER]: name }, body: request.body, duplex: 'half',
      } as RequestInit));
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
  }
```

In the returned `fetch`, after the `LIVE_PATH` line, add:

```ts
      const path = new URL(request.url).pathname;
      if (path.startsWith(OFFICE_OPS_PREFIX)) return ops(request, env, path.slice(OFFICE_OPS_PREFIX.length));
```

In `server/entries/officeEntry.ts`, pass the new options to `officeRoutes`:

```ts
      stubOf: (env, name) => {
        const namespace = env.OFFICE as Namespace;
        return namespace.get(namespace.idFromName(name)) as OfficeStub;
      },
      exportSecret: () => readEnv('MADAR_EXPORT_SECRET'),
      opsSecret: () => readEnv('MADAR_OPS_SECRET'),
```

In `server/office/test/live/wrangler.toml`, add to `[vars]`: `MADAR_TEST_TOOLS = "on"`.

In `server/office/test/live/entry.ts`, pass to `officeRoutes`:

```ts
  stubOf: (env, name) => (env as Env).OFFICE.get((env as Env).OFFICE.idFromName(name)) as Test,
  exportSecret: () => 'test-export-secret',
  opsSecret: () => 'test-ops-secret',
```

In `server/office/test/live/harness.ts`, add to the object that `startLive` returns:

```ts
    /** One office op through the Worker, with the secret of the test Worker (entry.ts); a status above 299 throws with it. */
    ops: async (op: string, body: unknown, o: { office?: string } = {}) => {
      const header = op === 'export' ? 'x-madar-export-secret' : 'x-madar-ops-secret';
      const secret = op === 'export' ? 'test-export-secret' : 'test-ops-secret';
      const query = o.office ? `?office=${o.office}` : '';
      const response = await worker().fetch(`/api/office/${op}${query}`, { method: 'POST', headers: { 'content-type': 'application/json', [header]: secret }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${op} answered ${response.status}: ${await response.text()}`);
      return response.json();
    },
```

- [ ] **Step 4: Run them to see them pass**

Run: the two commands of Step 2. Expected: PASS. Then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/entries/officeWorker.ts server/entries/officeWorker.test.ts server/entries/officeEntry.ts server/office/ops.wd.test.ts \
  server/office/test/live/entry.ts server/office/test/live/harness.ts server/office/test/live/wrangler.toml
git commit -m "Exit wave 4: the office ops of the Worker behind the export and ops secrets, with the object picked by name"
```

### Task 6: The digests of a table

**Files:**
- Create: `scripts/office/digest.ts`, `scripts/office/digest.test.ts`
- Test: `scripts/office/digest.test.ts`

**Interfaces:**
- Produces: `type TableDigest = { rows: number; sha256: string }`; `canonical(value: unknown): string`;
  `digestOf(lines: readonly string[]): TableDigest`; `rowDigest(rows): TableDigest` (full rows, in the given order);
  `recordDigest(rows: readonly { id: string; doc: unknown }[]): TableDigest` (id and parsed doc, sorted by id);
  `compareDigests(want, got, o?: { notes?: readonly string[]; skip?: readonly string[] }): { problems: string[]; notes: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/office/digest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canonical, compareDigests, recordDigest, rowDigest } from './digest';

describe('the digests of a table (scripts/office/digest.ts)', () => {
  it('writes an object with sorted keys at every depth, and leaves out an undefined value', () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"z":1}]},"b":1}');
  });

  it('gives one record digest for a doc as text and as an object, with keys in any order', () => {
    const a = recordDigest([{ id: 'tsk_2', doc: '{"title":"B","n":1}' }, { id: 'tsk_1', doc: { n: 2, title: 'A' } }]);
    const b = recordDigest([{ id: 'tsk_1', doc: '{"title":"A","n":2}' }, { id: 'tsk_2', doc: { n: 1, title: 'B' } }]);
    expect(a).toEqual(b);
    expect(a.rows).toBe(2);
  });

  it('gives another digest when one value of one record differs', () => {
    expect(recordDigest([{ id: 'x', doc: { n: 1 } }]).sha256).not.toBe(recordDigest([{ id: 'x', doc: { n: 2 } }]).sha256);
  });

  it('keeps the order of the rows in a row digest (the rowid order of an export)', () => {
    expect(rowDigest([{ _rowid: 1 }, { _rowid: 2 }]).sha256).not.toBe(rowDigest([{ _rowid: 2 }, { _rowid: 1 }]).sha256);
  });

  it('names a missing table, another count and another hash; a drift table is a note; a skipped table is left out', () => {
    const want = { tasks: { rows: 2, sha256: 'a' }, events: { rows: 5, sha256: 'b' }, outbox: { rows: 1, sha256: 'c' }, office_meta: { rows: 1, sha256: 'd' } };
    const got = { tasks: { rows: 3, sha256: 'x' }, outbox: { rows: 2, sha256: 'y' }, office_meta: { rows: 1, sha256: 'z' } };
    expect(compareDigests(want, got, { notes: ['outbox'], skip: ['office_meta'] })).toEqual({
      problems: ['events: the source has it, the copy does not.', 'tasks: the source holds 2 rows, the copy holds 3.'],
      notes: ['outbox: the source holds 1 rows, the copy holds 2 (this table may change during an export).'],
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/office/digest.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './digest'".

- [ ] **Step 3: Write the digests**

Create `scripts/office/digest.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * The count and hash check of each table (Supabase exit, wave 4; spec section 4, step 6). A row digest hashes the full rows of an
 * export in rowid order: a restore must give the same bytes. A record digest hashes the id and the parsed doc of each record,
 * sorted by id: Postgres and the office object then give the same digest, although their key columns and JSON text differ.
 */

export type TableDigest = { rows: number; sha256: string };

/** JSON with the keys of each object sorted, at every depth. An undefined value leaves its key out, as JSON.stringify does. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

export function digestOf(lines: readonly string[]): TableDigest {
  const hash = createHash('sha256');
  for (const line of lines) hash.update(`${line}\n`);
  return { rows: lines.length, sha256: hash.digest('hex') };
}

export function rowDigest(rows: readonly Record<string, unknown>[]): TableDigest {
  return digestOf(rows.map(canonical));
}

export function recordDigest(rows: readonly { id: string; doc: unknown }[]): TableDigest {
  const lines = rows.map((row) => `${row.id}\t${canonical(typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc)}`);
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return digestOf(lines);
}

export function compareDigests(
  want: Readonly<Record<string, TableDigest>>,
  got: Readonly<Record<string, TableDigest>>,
  o: { notes?: readonly string[]; skip?: readonly string[] } = {},
): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const names = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter((name) => !o.skip?.includes(name)).sort();
  for (const name of names) {
    const a = want[name];
    const b = got[name];
    if (!b) {
      problems.push(`${name}: the source has it, the copy does not.`);
      continue;
    }
    if (!a) {
      problems.push(`${name}: the copy has it, the source does not.`);
      continue;
    }
    if (a.rows === b.rows && a.sha256 === b.sha256) continue;
    const text = a.rows !== b.rows ? `${name}: the source holds ${a.rows} rows, the copy holds ${b.rows}` : `${name}: the same ${a.rows} rows, another hash`;
    if (o.notes?.includes(name)) notes.push(`${text} (this table may change during an export).`);
    else problems.push(`${text}.`);
  }
  return { problems, notes };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/office/digest.ts scripts/office/digest.test.ts
git commit -m "Exit wave 4: the row and record digests of a table, and their compare"
```

### Task 7: The export client and the backup file

**Files:**
- Create: `scripts/office/ops.ts`, `scripts/backup/officeExport.ts`, `scripts/backup/officeExport.test.ts`
- Test: `scripts/backup/officeExport.test.ts`

**Interfaces:**
- Consumes: `ExportBegin`, `ExportPage`, `ExportEnd`, `DRIFT_TABLES` (Task 4), `rowDigest`, `TableDigest` (Task 6), `stampOf`
  (`scripts/backup/check.ts`), `run` (`scripts/backup/run.ts`), `nodeOffice` (Task 1, in the test).
- Produces: `type OfficeOps = { post<T>(op: string, body: unknown): Promise<T> }`;
  `opsOf(o: { base: string; secret: string; header: string; office?: string; fetch?: typeof fetch }): OfficeOps`
  (`scripts/office/ops.ts`); `partsOps(parts): OfficeOps` (the node test port, same file); `type OfficeCopy = 'test' | 'production' | 'local'`;
  `type ExportManifest = { format: 2; kind: 'office'; copy; madeAt; schema; version; officeSeq; drift: string[]; tables: Record<string, TableDigest> }`;
  `exportOffice(ops, o: { copy; folder; now? }): Promise<ExportManifest>`; `makeOfficeBackup(o): Promise<{ file; name; tables; rows }>`;
  `OFFICE_BACKUP_NAME = /^madar-office-(test|production|local)-[0-9]{8}-[0-9]{6}Z$/`.

- [ ] **Step 1: Write the failing test**

Create `scripts/backup/officeExport.test.ts`:

```ts
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeOffice } from '../../server/office/test/nodeOffice';
import { rowDigest } from '../office/digest';
import { partsOps } from '../office/ops';
import { exportOffice, makeOfficeBackup, type ExportManifest } from './officeExport';

const folder = () => mkdtempSync(join(tmpdir(), 'madar-office-export-test-'));

describe('the export client (scripts/backup/officeExport.ts)', () => {
  it('writes one NDJSON file for each table and a manifest whose digests match the lines', async () => {
    const t = await nodeOffice();
    const dir = folder();
    const manifest = await exportOffice(partsOps(t.parts), { copy: 'local', folder: dir, now: new Date('2026-10-04T23:07:00Z') });
    expect(manifest).toMatchObject({ format: 2, kind: 'office', copy: 'local', schema: 3 });
    const events = readFileSync(join(dir, 'tables', 'events.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(manifest.tables.events).toEqual(rowDigest(events));
    expect(events.length).toBe(Number((t.raw.prepare('select count(*) as n from events').get() as { n: number }).n));
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ExportManifest).toEqual(manifest);
    expect(manifest.drift).toContain('auth_sessions');
  });

  it('fails when a write lands between the begin and the end, and ends the hold', async () => {
    const t = await nodeOffice();
    const ops = partsOps(t.parts);
    let pages = 0;
    const sneaky = {
      post: async <T,>(op: string, body: unknown): Promise<T> => {
        if ((body as { step: string }).step === 'page' && ++pages === 3) t.raw.exec('update office_meta set office_seq = office_seq + 1');
        return ops.post<T>(op, body);
      },
    };
    await expect(exportOffice(sneaky, { copy: 'local', folder: folder() })).rejects.toThrow('A write landed during the export');
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('ends the hold when a page fails, so the office does not wait 5 minutes', async () => {
    const t = await nodeOffice();
    const ops = partsOps(t.parts);
    const broken = {
      post: async <T,>(op: string, body: unknown): Promise<T> => {
        if ((body as { step: string }).step === 'page') throw new Error('the network dropped');
        return ops.post<T>(op, body);
      },
    };
    await expect(exportOffice(broken, { copy: 'local', folder: folder() })).rejects.toThrow('the network dropped');
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('makes one encrypted file named madar-office-<copy>-<stamp> and leaves no plain folder behind', async () => {
    const t = await nodeOffice();
    const out = folder();
    // A stand-in for age: it copies the archive to the -o file, so the test needs no real key.
    const age = join(out, 'fake-age');
    writeFileSync(age, '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nshift; out="$1"; shift; cp "$1" "$out"\n');
    chmodSync(age, 0o755);
    const result = await makeOfficeBackup({ ops: partsOps(t.parts), copy: 'local', recipient: `age1${'q'.repeat(58)}`, outDir: out, age, now: new Date('2026-10-04T23:07:00Z') });
    expect(result.name).toBe('madar-office-local-20261004-230700Z');
    expect(existsSync(result.file)).toBe(true);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('madar-office-work-') && name.includes(String(process.pid)))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/backup/officeExport.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module '../office/ops'".

- [ ] **Step 3: Write the port and the client**

Create `scripts/office/ops.ts`:

```ts
import type { OfficeParts } from '../../server/office/parts';

/**
 * The office ops as the scripts call them (Supabase exit, wave 4): POST <base>/api/office/<op>?office=<name> with the secret
 * header. The secret goes only into the header, never into a log line or an error text.
 */
export type OfficeOps = { post<T>(op: string, body: unknown): Promise<T> };

export function opsOf(o: { base: string; secret: string; header: string; office?: string; fetch?: typeof fetch }): OfficeOps {
  const send = o.fetch ?? fetch;
  return {
    async post<T>(op: string, body: unknown): Promise<T> {
      const url = new URL(`/api/office/${op}`, o.base);
      if (o.office) url.searchParams.set('office', o.office);
      const response = await send(url.toString(), { method: 'POST', headers: { 'content-type': 'application/json', [o.header]: o.secret }, body: JSON.stringify(body) });
      const text = await response.text();
      if (!response.ok) throw new Error(`The office op ${op} answered ${response.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text) as T;
    },
  };
}

/** For tests: the same ops straight on the office parts of node:sqlite, with no Worker and no secret. */
export function partsOps(parts: Pick<OfficeParts, 'ops'>): OfficeOps {
  return {
    async post<T>(op: string, body: unknown): Promise<T> {
      const response = await parts.ops(new Request(`https://office.internal/office/${op}`, { method: 'POST', body: JSON.stringify(body) }));
      const text = await response.text();
      if (!response.ok) throw new Error(`The office op ${op} answered ${response.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text) as T;
    },
  };
}
```

Create `scripts/backup/officeExport.ts`:

```ts
// The nightly backup of an office object (Supabase exit, wave 4; spec section 2, "Backups" (2)). .github/workflows/office-backup.yml
// runs it; scripts/backup/officeRestore.ts checks its file.
//
//   OFFICE_EXPORT_SECRET=<value> BACKUP_AGE_RECIPIENT=<age1...> npx tsx scripts/backup/officeExport.ts --url <page address> --copy <test|production> --out <dir>
//
// It asks the export route of the copy for a begin (the office object then holds writes for at most 5 minutes), every page of
// every table, and the end. It writes madar-office-<copy>-<stamp>/tables/<table>.ndjson (one row for each line, in rowid order)
// and manifest.json (the rows and the sha256 of each table), then tar and age to the owner's public key. The plain folder lives
// only in a private temporary folder, which it removes. It prints one JSON line with the file, the name, the tables and the rows.
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIFT_TABLES, type ExportBegin, type ExportEnd, type ExportPage } from '../../server/office/ops';
import { EXPORT_SECRET_HEADER } from '../../server/entries/officeWorker';
import { rowDigest, type TableDigest } from '../office/digest';
import { opsOf, type OfficeOps } from '../office/ops';
import { stampOf } from './check';
import { run } from './run';

export type OfficeCopy = 'test' | 'production' | 'local';
export type ExportManifest = {
  format: 2; kind: 'office'; copy: OfficeCopy; madeAt: string; schema: number; version: number; officeSeq: number; drift: string[];
  tables: Record<string, TableDigest>;
};
export const OFFICE_BACKUP_NAME = /^madar-office-(test|production|local)-[0-9]{8}-[0-9]{6}Z$/;
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;

export async function exportOffice(ops: OfficeOps, o: { copy: OfficeCopy; folder: string; now?: Date }): Promise<ExportManifest> {
  const begin = await ops.post<ExportBegin>('export', { step: 'begin' });
  let ended = false;
  try {
    mkdirSync(join(o.folder, 'tables'), { recursive: true, mode: 0o700 });
    const tables: Record<string, TableDigest> = {};
    for (const table of begin.tables) {
      const file = join(o.folder, 'tables', `${table}.ndjson`);
      writeFileSync(file, '', { mode: 0o600 });
      const rows: Record<string, unknown>[] = [];
      for (let after = 0; ; ) {
        const page = await ops.post<ExportPage>('export', { step: 'page', id: begin.id, table, after });
        if (page.rows.length > 0) appendFileSync(file, `${page.rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
        rows.push(...page.rows);
        if (page.next === null) break;
        after = page.next;
      }
      tables[table] = rowDigest(rows);
    }
    const end = await ops.post<ExportEnd>('export', { step: 'end', id: begin.id });
    ended = true;
    if (end.version !== begin.version || end.officeSeq !== begin.officeSeq) {
      throw new Error('A write landed during the export (the office version moved). Run the export again.');
    }
    const manifest: ExportManifest = {
      format: 2, kind: 'office', copy: o.copy, madeAt: (o.now ?? new Date()).toISOString(), schema: begin.schema, version: begin.version,
      officeSeq: begin.officeSeq, drift: [...DRIFT_TABLES], tables,
    };
    writeFileSync(join(o.folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return manifest;
  } finally {
    // Free the office at once when a page failed: the hold would end by itself only after 5 minutes.
    if (!ended) await ops.post('export', { step: 'end', id: begin.id }).catch(() => undefined);
  }
}

export async function makeOfficeBackup(o: { ops: OfficeOps; copy: OfficeCopy; recipient: string; outDir: string; age?: string; now?: Date }) {
  if (!AGE_RECIPIENT.test(o.recipient)) throw new Error('The age recipient must be a public key that starts with age1.');
  const now = o.now ?? new Date();
  const name = `madar-office-${o.copy}-${stampOf(now)}`;
  const work = mkdtempSync(join(tmpdir(), `madar-office-work-${process.pid}-`));
  try {
    const manifest = await exportOffice(o.ops, { copy: o.copy, folder: join(work, name), now });
    const archive = join(work, `${name}.tar.gz`);
    await run('tar', 'tar', ['-C', work, '-czf', archive, name]);
    const file = resolve(o.outDir, `${name}.tar.gz.age`);
    await run('age', o.age ?? process.env.MADAR_AGE ?? 'age', ['-r', o.recipient, '-o', file, archive]);
    const rows = Object.values(manifest.tables).reduce((sum, t) => sum + t.rows, 0);
    return { file, name, tables: Object.keys(manifest.tables).length, rows };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(argv: string[]): Promise<void> {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? '' : (argv[at + 1] ?? '');
  };
  const copy = value('--copy');
  const problems = [
    ...(value('--url') === '' ? ['--url <page address of the copy> is missing.'] : []),
    ...(copy !== 'test' && copy !== 'production' ? ['--copy must be test or production.'] : []),
    ...(value('--out') === '' ? ['--out <folder> is missing.'] : []),
    ...(!process.env.OFFICE_EXPORT_SECRET ? ['OFFICE_EXPORT_SECRET is missing.'] : []),
    ...(!process.env.BACKUP_AGE_RECIPIENT ? ['BACKUP_AGE_RECIPIENT is missing.'] : []),
  ];
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const ops = opsOf({ base: value('--url'), secret: process.env.OFFICE_EXPORT_SECRET!, header: EXPORT_SECRET_HEADER });
  const result = await makeOfficeBackup({ ops, copy: copy as OfficeCopy, recipient: process.env.BACKUP_AGE_RECIPIENT!.trim(), outDir: value('--out') });
  console.log(JSON.stringify(result));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/office/ops.ts scripts/backup/officeExport.ts scripts/backup/officeExport.test.ts
git commit -m "Exit wave 4: the export client writes one NDJSON file for each table with a sha256 manifest, encrypted to the owner's key"
```

### Task 8: The restore check of an office backup on node:sqlite (DECISION 5 for the file step)

**Files:**
- Create: `scripts/backup/officeRestore.ts`, `scripts/backup/officeRestore.test.ts`
- Modify: `scripts/restore-check.ts` (export `readOnlyDeps`; move the rclone part into an exported `checkFileCopy`; the office
  kind by file name), `scripts/backup/check.ts` (`parseCheckArgs` takes `--files-lag-days`), `scripts/backup/check.test.ts`
- Test: `scripts/backup/officeRestore.test.ts`, `scripts/backup/check.test.ts`

**Interfaces:**
- Consumes: `ExportManifest`, `exportOffice` (Task 7), `ROWID_ALIAS` (Task 4), `rowDigest` (Task 6), `applyLiteSchema`, `EVENT_GUARDS`,
  `eventGuardsSql`, `LITE_SCHEMA_VERSION` (`server/data/lite/schema.ts`), `nodeHost`, `liteDb`, `liteData`, `createRunCall`.
- Produces: `officeArchiveProblems(entries: string[]): string[]`; `restoreOffice(folder: string): Promise<{ raw; db; manifest;
  problems: string[] }>`; `officeRestoreCheck(o: CheckOptions): Promise<CheckReport>`; `CheckArgs.filesLagDays: number` (default 8;
  0 for R2 alone); `checkFileCopy(o: { versions: { key: string; size: number; at: string | null }[]; madeAt: Date; lagDays: number;
  remote: string; rclone: string; sample: number; random })`.

The file step depends on DECISION 5. With **R2 alone**, `--files-remote` is an rclone remote on the R2 bucket with a read-only
token (for example `madar-r2:madar-files-test`) and `--files-lag-days 0`: the live bucket holds every file. With **B2**, it is the
crypt remote of the weekly copy (for example `madar-copy:current`) and the default 8 days.

- [ ] **Step 1: Write the failing tests**

Create `scripts/backup/officeRestore.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeOffice } from '../../server/office/test/nodeOffice';
import { partsOps } from '../office/ops';
import { exportOffice } from './officeExport';
import { officeArchiveProblems, restoreOffice } from './officeRestore';

async function exported() {
  const t = await nodeOffice();
  const folder = mkdtempSync(join(tmpdir(), 'madar-office-restore-test-'));
  const manifest = await exportOffice(partsOps(t.parts), { copy: 'local', folder });
  return { t, folder, manifest };
}

describe('the restore of an office backup (scripts/backup/officeRestore.ts)', () => {
  it('restores every table into a new node:sqlite office with the same rows, byte for byte', async () => {
    const { t, folder } = await exported();
    const restored = await restoreOffice(folder);
    expect(restored.problems).toEqual([]);
    expect(restored.raw.prepare('select count(*) as n from events').get()).toEqual(t.raw.prepare('select count(*) as n from events').get());
    expect(restored.raw.prepare("select doc from tasks where id = 'tsk_001'").get()).toEqual(t.raw.prepare("select doc from tasks where id = 'tsk_001'").get());
  });

  it('keeps the events guard: an update of an event fails in the restored office', async () => {
    const { folder } = await exported();
    const { raw } = await restoreOffice(folder);
    expect(() => raw.exec('update events set doc = doc where rowid = (select min(rowid) from events)')).toThrow('events only grow');
  });

  it('fails when a table file lost a row, and names the table', async () => {
    const { folder } = await exported();
    const file = join(folder, 'tables', 'tasks.ndjson');
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').slice(1).join('\n'));
    expect((await restoreOffice(folder)).problems.join(' ')).toMatch(/^tasks: /);
  });

  it('fails when a byte of a doc changed', async () => {
    const { folder } = await exported();
    const file = join(folder, 'tables', 'users.ndjson');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"name"', '"Name"'));
    expect((await restoreOffice(folder)).problems.join(' ')).toContain('users:');
  });

  it('fails when a backup is of a newer schema than this build', async () => {
    const { folder } = await exported();
    const path = join(folder, 'manifest.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), schema: 99 }));
    expect((await restoreOffice(folder)).problems).toEqual(['The backup is of schema version 99, and this build knows version 3. Check it with a newer build.']);
  });

  it('accepts the entries of one office backup and refuses any other entry', () => {
    const ok = ['madar-office-test-20261004-230700Z/', 'madar-office-test-20261004-230700Z/manifest.json', 'madar-office-test-20261004-230700Z/tables/', 'madar-office-test-20261004-230700Z/tables/events.ndjson'];
    expect(officeArchiveProblems(ok)).toEqual([]);
    expect(officeArchiveProblems([...ok, 'madar-office-test-20261004-230700Z/../evil'])).toHaveLength(1);
    expect(officeArchiveProblems(ok.slice(0, 1))).toEqual(['The archive has no manifest.json.']);
  });
});
```

In `scripts/backup/check.test.ts`, add:

```ts
it('takes --files-lag-days, with 8 days for the weekly copy by default and 0 for R2 alone (exit wave 4, decision 5)', () => {
  expect(parseCheckArgs(['--file', 'f', '--key', 'k', '--files-remote', 'madar-copy:current']).filesLagDays).toBe(8);
  expect(parseCheckArgs(['--file', 'f', '--key', 'k', '--files-remote', 'madar-r2:madar-files-test', '--files-lag-days', '0']).filesLagDays).toBe(0);
  expect(() => parseCheckArgs(['--file', 'f', '--key', 'k', '--skip-files', '--files-lag-days', 'x'])).toThrow('--files-lag-days must be a whole number from 0.');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server scripts/backup/officeRestore.test.ts scripts/backup/check.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './officeRestore'" and `filesLagDays` undefined.

- [ ] **Step 3: Write the restore and the check**

In `scripts/backup/check.ts`, `CheckArgs` gets `filesLagDays: number`, and `parseCheckArgs` reads it:

```ts
  const lagText = values['files-lag-days'];
  const filesLagDays = lagText === undefined ? 8 : Number(lagText);
  if (!Number.isInteger(filesLagDays) || filesLagDays < 0) problems.push('--files-lag-days must be a whole number from 0.');
```

and returns `{ ..., filesLagDays }`.

In `scripts/restore-check.ts`: change `function readOnlyDeps` to `export function readOnlyDeps`; replace `COPY_LAG_MS` with
`o.filesLagDays * 24 * 3600_000` (add `filesLagDays: number` to `CheckOptions`, default 8 in `restoreCheck`); move the rclone part of
step 7 into:

```ts
/**
 * Up to sample file keys of a restored office are in the file copy with the same size. Only versions older than the backup minus
 * lagDays: the weekly copy (B2) cannot hold newer uploads yet; the live R2 bucket (R2 alone, lag 0) holds every one.
 */
export async function checkFileCopy(o: {
  versions: { key: string; size: number; at: string | null }[]; madeAt: Date; lagDays: number; remote: string; rclone: string; sample: number;
  random: (below: number) => number;
}): Promise<string> {
  const remote = o.remote.replace(/\/$/, '');
  const remoteRoot = remote.includes(':') ? remote.slice(0, remote.indexOf(':') + 1) : remote;
  try {
    await run('rclone lsf', o.rclone, ['lsf', '--max-depth', '1', remoteRoot]);
  } catch (error) {
    throw new Error(`The file copy cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const cutoff = o.madeAt.getTime() - o.lagDays * 24 * 3600_000;
  const old = o.versions.filter((v) => v.at === null || Date.parse(v.at) < cutoff);
  const skipped = o.versions.length - old.length;
  const note = skipped === 0 ? '' : ` ${skipped} newer file versions were skipped: the copy cannot hold them yet.`;
  if (o.versions.length === 0) return 'The restored office has no file yet.';
  const sizes = new Map(old.map((v) => [v.key, v.size]));
  if (sizes.size === 0) return `No file version is old enough for the copy yet.${note}`;
  const picked = pickKeys([...sizes.keys()], o.sample, o.random);
  const problems: string[] = [];
  for (const key of picked) {
    try {
      const found = JSON.parse((await run('rclone lsjson', o.rclone, ['lsjson', '--stat', `${remote}/${key}`])).stdout) as { Size?: number };
      if (found.Size !== sizes.get(key)) problems.push(`${key}: ${found.Size ?? 'no'} bytes in the copy, ${sizes.get(key)} in the office.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(/not found|doesn't exist|no such file/i.test(message) ? `${key}: not in the copy.` : `${key}: rclone could not read it (${message}).`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join(' '));
  return `${picked.length} of ${sizes.size} file keys are in the copy with their sizes.${note}`;
}
```

and step 7 of `restoreCheck` calls it with the versions of its Postgres query
(`versions.map((v) => ({ key: v.key, size: Number(v.size), at: v.uploaded_at }))`, with `v->>'uploadedAt' as uploaded_at` in the
select in place of the `newer` column). In `main`, before `restoreCheck(args)`:

```ts
  // An office backup (exit wave 4) needs no Docker: it restores into node:sqlite with the schema of this build.
  if (basename(args.file).startsWith('madar-office-')) {
    const { officeRestoreCheck } = await import('./backup/officeRestore');
    const report = await officeRestoreCheck(args);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
    return;
  }
```

(import `basename` from `node:path`).

Create `scripts/backup/officeRestore.ts`:

```ts
// The restore check of an office backup (Supabase exit, wave 4; spec section 2, "Backups" (3)). scripts/restore-check.ts calls it
// for a file named madar-office-<copy>-<stamp>.tar.gz.age. It runs on the owner's Mac (only the Mac has the offline key) and needs
// no Docker: decrypt, check the archive, restore every table into node:sqlite with the schema of this build, compare the rows and
// the sha256 of each table with the manifest, check that the History only grows, run dashboard.get as an active Admin through
// runCall on SQLite, and look up 5 file keys in the file copy. The plain folder lives in a private temporary folder, which it removes.
import { randomInt } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createRunCall } from '../../server/core/runCall';
import { liteData } from '../../server/data/lite/callData';
import { liteDb, type LiteDb } from '../../server/data/lite/db';
import { nodeHost } from '../../server/data/lite/host';
import { applyLiteSchema, EVENT_GUARDS, eventGuardsSql, LITE_SCHEMA_VERSION } from '../../server/data/lite/schema';
import { ROWID_ALIAS } from '../../server/office/ops';
import { rowDigest } from '../office/digest';
import { checkFileCopy, readOnlyDeps, type CheckOptions, type CheckReport, type Step } from '../restore-check';
import type { ExportManifest } from './officeExport';
import { run } from './run';

const ENTRY = /^(madar-office-(?:test|production|local)-[0-9]{8}-[0-9]{6}Z)\/(manifest\.json|tables\/|tables\/[a-z_]+\.ndjson)?$/;

const Manifest = z.object({
  format: z.literal(2), kind: z.literal('office'), copy: z.enum(['test', 'production', 'local']), madeAt: z.string(), schema: z.number().int(),
  version: z.number().int(), officeSeq: z.number().int(), drift: z.array(z.string()),
  tables: z.record(z.string().regex(/^[a-z_]+$/), z.object({ rows: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
});

export function officeArchiveProblems(entries: string[]): string[] {
  const problems: string[] = [];
  const folders = new Set<string>();
  let manifest = false;
  for (const entry of entries.filter((line) => line !== '')) {
    const match = ENTRY.exec(entry);
    if (!match) {
      problems.push(`The archive holds an entry that an office backup does not have: ${entry}`);
      continue;
    }
    folders.add(match[1]);
    if (match[2] === 'manifest.json') manifest = true;
  }
  if (folders.size > 1) problems.push('The archive holds more than one backup folder.');
  if (!manifest) problems.push('The archive has no manifest.json.');
  return problems;
}

const quoteName = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Not a column name: ${name}`);
  return name;
};

export async function restoreOffice(folder: string): Promise<{ raw: DatabaseSync; db: LiteDb; manifest: ExportManifest; problems: string[] }> {
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))) as ExportManifest;
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyLiteSchema(host);
  const db = liteDb(host);
  if (manifest.schema > LITE_SCHEMA_VERSION) {
    return { raw, db, manifest, problems: [`The backup is of schema version ${manifest.schema}, and this build knows version ${LITE_SCHEMA_VERSION}. Check it with a newer build.`] };
  }
  const problems: string[] = [];
  // One transaction, as the restore of the Postgres check. The schema made a settings row and an office_meta row: the backup has both.
  await host.transaction(async () => {
    for (const name of EVENT_GUARDS) host.exec(`drop trigger ${name}`, []);
    host.exec('delete from settings', []);
    host.exec('delete from office_meta', []);
    for (const table of Object.keys(manifest.tables)) {
      const file = join(folder, 'tables', `${table}.ndjson`);
      if (!existsSync(file)) {
        problems.push(`${table}: the backup has no file for it.`);
        continue;
      }
      const alias = ROWID_ALIAS.get(table);
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line === '') continue;
        const row = JSON.parse(line) as Record<string, string | number | null>;
        const columns = Object.keys(row).filter((name) => name !== '_rowid');
        const names = alias ? columns : ['rowid', ...columns];
        const values = alias ? columns.map((name) => row[name]) : [row._rowid, ...columns.map((name) => row[name])];
        try {
          host.exec(`insert into ${quoteName(table)} (${names.map(quoteName).join(', ')}) values (${names.map((_, i) => `?${i + 1}`).join(', ')})`, values);
        } catch (error) {
          problems.push(`${table}: a row does not fit this schema (${error instanceof Error ? error.message : String(error)}).`);
          break;
        }
      }
    }
    for (const text of eventGuardsSql()) host.exec(text, []);
  });
  for (const [table, want] of Object.entries(manifest.tables)) {
    const got = rowDigest(host.exec(`select rowid as _rowid, * from ${quoteName(table)} order by rowid`, []).rows);
    if (got.rows !== want.rows) problems.push(`${table}: the manifest says ${want.rows} rows, the restore holds ${got.rows}.`);
    else if (got.sha256 !== want.sha256) problems.push(`${table}: the same ${got.rows} rows, another hash.`);
  }
  return { raw, db, manifest, problems: [...new Set(problems)] };
}

export async function officeRestoreCheck(o: CheckOptions): Promise<CheckReport> {
  const steps: Step[] = [];
  const work = mkdtempSync(join(tmpdir(), `madar-restore-${process.pid}-`));
  const attempt = async (step: string, job: () => Promise<string>, stop = false): Promise<boolean> => {
    try {
      steps.push({ step, ok: true, detail: await job() });
      return true;
    } catch (error) {
      steps.push({ step, ok: false, detail: error instanceof Error ? error.message : String(error) });
      return !stop;
    }
  };
  try {
    const archive = join(work, 'backup.tar.gz');
    if (!(await attempt('decrypt', async () => (await run('age --decrypt', o.age ?? process.env.MADAR_AGE ?? 'age', ['--decrypt', '-i', o.key, '-o', archive, o.file]), 'The key opened the backup.'), true))) return { ok: false, steps };
    let folder = '';
    if (!(await attempt('archive', async () => {
      const entries = (await run('tar -t', 'tar', ['-tzf', archive])).stdout.split('\n').map((line) => line.trim());
      const problems = officeArchiveProblems(entries);
      if (problems.length > 0) throw new Error(problems.join(' '));
      await run('tar -x', 'tar', ['-xzf', archive, '-C', work]);
      folder = join(work, entries.find((entry) => entry !== '')!.split('/')[0]);
      return `One office backup: ${folder.split('/').pop()}.`;
    }, true))) return { ok: false, steps };
    const restored = await restoreOffice(folder);
    await attempt('counts', async () => {
      if (restored.problems.length > 0) throw new Error(restored.problems.join(' '));
      const rows = Object.values(restored.manifest.tables).reduce((sum, t) => sum + t.rows, 0);
      return `${Object.keys(restored.manifest.tables).length} tables and ${rows} rows match the manifest, with the same sha256.`;
    });
    await attempt('events guard', async () => {
      const events = Number((restored.raw.prepare('select count(*) as n from events').get() as { n: number }).n);
      if (events === 0) return 'The office has no event, so the guard had no row to refuse.';
      try {
        restored.raw.exec('update events set doc = doc where rowid = (select min(rowid) from events)');
      } catch (error) {
        if (error instanceof Error && error.message.includes('events only grow')) return 'An update of an event fails: the History only grows.';
        throw error;
      }
      throw new Error('An update of an event worked in the restored office.');
    });
    await attempt('dashboard.get', async () => {
      const people = restored.raw.prepare('select id, doc from users order by rowid').all() as { id: string; doc: string }[];
      if (people.length === 0) return 'Skipped: the restored office has no person yet.';
      const admin = people.find((p) => {
        const doc = JSON.parse(p.doc) as { active?: boolean; kind?: string; systemRole?: string };
        return doc.active === true && doc.kind === 'human' && doc.systemRole === 'admin';
      });
      if (!admin) throw new Error('The restored office has people but no active Admin.');
      const result = await createRunCall({ data: liteData })(readOnlyDeps(restored.db), {
        principal: { userId: admin.id }, name: 'dashboard.get', input: {}, batch: { storyRefs: new Map(), overviewCalls: 0 },
      });
      if (!result.ok) throw new Error(`dashboard.get failed: ${result.error.code}.`);
      return 'dashboard.get ran on the restored office for an active Admin.';
    });
    await attempt('files', async () => {
      if (o.filesRemote === null) return 'Skipped on purpose (--skip-files).';
      const files = restored.raw.prepare('select doc from files').all() as { doc: string }[];
      const versions = files.flatMap((f) => ((JSON.parse(f.doc) as { versions?: { blobKey?: string; size?: number; uploadedAt?: string }[] }).versions ?? [])
        .filter((v) => typeof v.blobKey === 'string').map((v) => ({ key: v.blobKey!, size: Number(v.size), at: v.uploadedAt ?? null })));
      return checkFileCopy({
        versions, madeAt: new Date(restored.manifest.madeAt), lagDays: o.filesLagDays, remote: o.filesRemote, rclone: o.rclone ?? 'rclone',
        sample: o.fileSample ?? 5, random: o.random ?? ((below: number) => randomInt(below)),
      });
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { ok: steps.length > 0 && steps.every((s) => s.ok), steps };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: the command of Step 2. Expected: PASS. Then `npm run typecheck`. Expected: PASS. The Postgres restore check keeps its test in
the Docker list (`scripts/restore-check.test.ts`, merge lead): run it in the gate.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup/officeRestore.ts scripts/backup/officeRestore.test.ts scripts/restore-check.ts scripts/backup/check.ts scripts/backup/check.test.ts
git commit -m "Exit wave 4: the restore check of an office backup on node:sqlite, with the rows and sha256 of each table"
```

### Task 9: The nightly office backup workflow, off until wave 5

**Files:**
- Create: `.github/workflows/office-backup.yml`
- Modify: `scripts/backup/workflows.test.ts`, `.github/CLAUDE.md`
- Test: `scripts/backup/workflows.test.ts`

**Interfaces:**
- Consumes: `scripts/backup/officeExport.ts` (Task 7), the secret `BACKUP_REPO_TOKEN` and the var `BACKUP_AGE_RECIPIENT` of today.
- Produces: the workflow "Office backup": `secrets.OFFICE_EXPORT_SECRET`, `vars.OFFICE_BACKUP_URL`, `vars.OFFICE_BACKUP_COPY`; the
  releases `madar-office-<copy>-<stamp>` in `byosamah/madar-backups`, kept 30 days.

- [ ] **Step 1: Write the failing test**

In `scripts/backup/workflows.test.ts`, add `office: read('office-backup.yml')` to `FILES`, add
`expect(FILES.office).toMatch(/- cron: '7 2 \* \* \*'\n\s+timezone: 'Asia\/Riyadh'/);` to the schedule test, add
`expect(head(FILES.office)).toMatch(/permissions:\n {2}contents: read\n/);` to the rights test, and add:

```ts
describe('the office backup (exit wave 4)', () => {
  const text = FILES.office;

  it('ends at its first step with success while vars.OFFICE_BACKUP_URL is not set, and every later step waits for it', () => {
    const first = step(text, 'Is the office backup on');
    expect(first).toContain('URL: ${{ vars.OFFICE_BACKUP_URL }}');
    expect(first).toContain('on=false');
    const steps = text.split('\n').filter((line) => /^ {6}- (name|uses|run):/.test(line)).length;
    const gated = (text.match(/^ {8}if: steps\.on\.outputs\.on == 'true'/gm) ?? []).length;
    expect(gated).toBe(steps - 1);
  });

  it('runs the export script with the export secret in the step env only, and tries once more after 2 minutes', () => {
    const exportStep = step(text, 'Export, count and encrypt');
    expect(exportStep).toContain('OFFICE_EXPORT_SECRET: ${{ secrets.OFFICE_EXPORT_SECRET }}');
    expect(exportStep).toContain('npx tsx scripts/backup/officeExport.ts --url "$URL" --copy "$COPY" --out "$RUNNER_TEMP/backup"');
    expect(exportStep).toContain('sleep 120');
    expect(existsSync(new URL('scripts/backup/officeExport.ts', root))).toBe(true);
  });

  it('removes only office releases of its own copy that are older than 30 days', () => {
    const remove = step(text, 'Remove office backups older than 30 days');
    expect(remove).toContain('startswith(\\"madar-office-${copy}-\\")');
    expect(remove).not.toContain('madar-db-');
  });
});
```

(`step`, `head`, `root`, `existsSync` are the helpers and imports of the file.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/backup/workflows.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `office-backup.yml` does not exist (the "exist" test fails for `office`).

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/office-backup.yml` (the action SHAs are the ones of `db-backup.yml`):

```yaml
# The nightly backup of an office object (Supabase exit, wave 4; spec section 2, "Backups" (2)). It runs at 02:07 Riyadh, off the
# busy start of the hour and between two runs of the 15-minute Cron of the office object (02:00 and 02:15).
#
# scripts/backup/officeExport.ts asks the export route of the copy (vars.OFFICE_BACKUP_URL) for every row, with the secret header.
# The office object refuses writes for at most 5 minutes meanwhile; reads and sign-ins go on. The script encrypts the folder with
# age to the owner's public key, and the file goes to a release of the private repository madar-backups. Releases of the same copy
# older than 30 days go. The run fails, so GitHub mails the owner, when the export fails twice or when the newest office backup
# before this run was older than 26 hours. Until vars.OFFICE_BACKUP_URL is set (wave 5), every run ends at its first step.
#
# Values, by name only:
#   secrets.OFFICE_EXPORT_SECRET  the MADAR_EXPORT_SECRET of the Worker of that copy (scripts/office/new-secret.ts --github)
#   secrets.BACKUP_REPO_TOKEN     a fine-grained token with "contents: write" on madar-backups only (the DB backup uses it too)
#   vars.OFFICE_BACKUP_URL        the page address of the copy, for example https://preview.madar-46r.pages.dev
#   vars.OFFICE_BACKUP_COPY       test or production
#   vars.BACKUP_AGE_RECIPIENT     the owner's age public key (age1...); not a secret
name: Office backup

on:
  schedule:
    - cron: '7 2 * * *'
      timezone: 'Asia/Riyadh'
  workflow_dispatch:

concurrency:
  group: office-backup
  cancel-in-progress: false

permissions:
  contents: read

env:
  NODE_VERSION: '22.23.1'
  BACKUP_REPO: byosamah/madar-backups
  KEEP_DAYS: '30'
  STALE_HOURS: '26'

jobs:
  backup:
    name: backup
    # A fork or a copy of the repository has no backup to make.
    if: github.repository == 'byosamah/madar'
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - name: Is the office backup on
        id: on
        env:
          URL: ${{ vars.OFFICE_BACKUP_URL }}
        run: |
          if [ -z "$URL" ]; then
            echo "The office backup is off: vars.OFFICE_BACKUP_URL is not set (wave 5 of the exit plan sets it)."
            echo "on=false" >> "$GITHUB_OUTPUT"
          else
            echo "on=true" >> "$GITHUB_OUTPUT"
          fi

      # No step uses git after the checkout, so the job token does not stay in .git/config for install scripts to read.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        if: steps.on.outputs.on == 'true'
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        if: steps.on.outputs.on == 'true'
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      # npm ci runs before any step gets a secret, so no install script can read one.
      - run: npm ci
        if: steps.on.outputs.on == 'true'
      - name: Install age
        if: steps.on.outputs.on == 'true'
        run: |
          sudo apt-get update -q
          sudo apt-get install -y -q age

      - name: Age of the newest office backup
        id: fresh
        if: steps.on.outputs.on == 'true'
        env:
          GH_TOKEN: ${{ secrets.BACKUP_REPO_TOKEN }}
          COPY: ${{ vars.OFFICE_BACKUP_COPY }}
        run: |
          newest="$(gh release list --repo "$BACKUP_REPO" --limit 1000 --json tagName,createdAt \
            --jq "[.[] | select(.tagName | startswith(\"madar-office-$COPY-\"))] | sort_by(.createdAt) | last | .createdAt // empty")"
          if [ -z "$newest" ]; then
            echo "No office backup yet."
            echo "hours=0" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          hours=$(( ($(date -u +%s) - $(date -u -d "$newest" +%s)) / 3600 ))
          echo "The newest office backup is $hours hours old."
          echo "hours=$hours" >> "$GITHUB_OUTPUT"

      - name: Export, count and encrypt
        id: dump
        if: steps.on.outputs.on == 'true'
        env:
          OFFICE_EXPORT_SECRET: ${{ secrets.OFFICE_EXPORT_SECRET }}
          BACKUP_AGE_RECIPIENT: ${{ vars.BACKUP_AGE_RECIPIENT }}
          URL: ${{ vars.OFFICE_BACKUP_URL }}
          COPY: ${{ vars.OFFICE_BACKUP_COPY }}
        run: |
          mkdir -p "$RUNNER_TEMP/backup"
          # A write during the export (rare at 02:07) or a dropped connection fails one run: try once more after 2 minutes.
          if ! npx tsx scripts/backup/officeExport.ts --url "$URL" --copy "$COPY" --out "$RUNNER_TEMP/backup" > "$RUNNER_TEMP/backup.json"; then
            sleep 120
            npx tsx scripts/backup/officeExport.ts --url "$URL" --copy "$COPY" --out "$RUNNER_TEMP/backup" > "$RUNNER_TEMP/backup.json"
          fi
          cat "$RUNNER_TEMP/backup.json"
          echo "file=$(jq -r .file "$RUNNER_TEMP/backup.json")" >> "$GITHUB_OUTPUT"
          echo "name=$(jq -r .name "$RUNNER_TEMP/backup.json")" >> "$GITHUB_OUTPUT"

      - name: Upload to madar-backups
        if: steps.on.outputs.on == 'true'
        env:
          GH_TOKEN: ${{ secrets.BACKUP_REPO_TOKEN }}
          FILE: ${{ steps.dump.outputs.file }}
          NAME: ${{ steps.dump.outputs.name }}
        run: |
          gh release create "$NAME" "$FILE" --repo "$BACKUP_REPO" --title "$NAME" \
            --notes "Nightly backup of an office object of Madar, encrypted with age to the owner's key. Check it with scripts/restore-check.ts."

      # Only after a good upload, so a run of failures never removes the last good backups. The shell puts the copy into the
      # jq text (startswith("madar-office-test-")), so a run of the test copy never removes a production backup.
      - name: Remove office backups older than 30 days
        if: steps.on.outputs.on == 'true'
        env:
          GH_TOKEN: ${{ secrets.BACKUP_REPO_TOKEN }}
          COPY: ${{ vars.OFFICE_BACKUP_COPY }}
        run: |
          cutoff="$(date -u -d "$KEEP_DAYS days ago" +%Y-%m-%dT%H:%M:%SZ)"
          copy="$COPY"
          gh release list --repo "$BACKUP_REPO" --limit 1000 --json tagName,createdAt \
            --jq ".[] | select(.createdAt < \"$cutoff\") | select(.tagName | startswith(\"madar-office-${copy}-\")) | .tagName" |
            while read -r tag; do
              echo "Remove $tag"
              gh release delete "$tag" --repo "$BACKUP_REPO" --yes --cleanup-tag
            done

      - name: Fail when the office backup before this one was older than 26 hours
        if: steps.on.outputs.on == 'true' && fromJSON(steps.fresh.outputs.hours) > fromJSON(env.STALE_HOURS)
        env:
          HOURS: ${{ steps.fresh.outputs.hours }}
        run: |
          echo "::error::The newest office backup before this run was $HOURS hours old (the limit is $STALE_HOURS). A night had no backup."
          exit 1
```

In `.github/CLAUDE.md`, "Workflows", add: "`office-backup.yml` (exit wave 4), nightly at 02:07 Riyadh: the export route of an office
object to an age-encrypted release `madar-office-<copy>-<stamp>` of `byosamah/madar-backups` (kept 30 days). Off until
`vars.OFFICE_BACKUP_URL` is set (wave 5: the test copy). Needs `secrets.OFFICE_EXPORT_SECRET` (the `MADAR_EXPORT_SECRET` of that
Worker), `vars.OFFICE_BACKUP_COPY`, `secrets.BACKUP_REPO_TOKEN` and `vars.BACKUP_AGE_RECIPIENT`. The restore check of its file needs
no Docker (`scripts/restore-check.ts` sees the name)."

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS. Then, when `command -v actionlint` finds actionlint on the Mac, run
`actionlint .github/workflows/office-backup.yml` (expected: no output); else write in the block report that the syntax check did not run.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/office-backup.yml scripts/backup/workflows.test.ts .github/CLAUDE.md
git commit -m "Exit wave 4: the nightly office backup workflow, which stays off until the copy names its address"
```

---

# Block C: Import, compare, reverse (Tasks 10 to 15, about 1.25 builder hours)

### Task 10: The import steps in the office object

**Files:**
- Create: `server/office/import.ts`, `server/office/import.test.ts`
- Modify: `server/office/parts.ts` (`/office/import` in `ops`; `dayCounts`)
- Test: `server/office/import.test.ts`

**Interfaces:**
- Consumes: `insertRow` (`server/data/lite/save.ts`), `TABLES` (`server/data/tables.ts`), `Row` (`server/data/rows.ts`),
  `importSigninRows`, `SigninExportRow` (`server/auth/own/import.ts`), `EVENT_GUARDS`, `eventGuardsSql` (`server/data/lite/schema.ts`),
  `EXPORT_TABLES`, `META_ROW_LITE`, `OfficeHold` (Task 4), `DAY_ROW_LITE` (`server/office/meter.ts`), `utcDay` (`server/mail/quota.ts`).
- Produces: `type ImportRow = Row`; `type ImportMode = 'empty' | 'resume' | 'replace'`;
  `type ServerRows = { counters; officeSeq; version; personSeq; mailLog; usageMonth; usageWarnings; jobRuns }` (the fields below);
  `type ImportStep = { step: 'begin'; mode } | { step: 'part'; id; table; rows } | { step: 'finish'; id; server; signin } | { step: 'abort'; id }`;
  `type ImportBegin = { id: string; schema: number; day: DayRow }`; `type ImportPartAnswer = { written: number; skipped: boolean }`;
  `type ImportFinish = { version: number; officeSeq: number }`; `IMPORT_PART_ROWS = 2_000`; `KEEP_ON_REPLACE`;
  `importBegin(db, mode)`, `importPart(db, table, rows)`, `importFinish(db, server, signin, now, flush?)`;
  `OfficeParts.dayCounts(now): Promise<DayRow>` (Task 18 uses it).

- [ ] **Step 1: Write the failing test**

Create `server/office/import.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { readLiteOffice } from '../data/lite/office';
import { liteLoadWhole } from '../data/lite/whole';
import { rowOf } from '../data/rows';
import { TABLES, rowsOf } from '../data/tables';
import type { ImportStep, ServerRows } from './import';
import { NODE_TODAY, nodeOffice } from './test/nodeOffice';

const post = async <T,>(t: Awaited<ReturnType<typeof nodeOffice>>, body: ImportStep | { step: 'begin'; mode: string }): Promise<T> => {
  const response = await t.parts.ops(new Request('https://office.internal/office/import', { method: 'POST', body: JSON.stringify(body) }));
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return JSON.parse(text) as T;
};

function serverOf(state: State, more: Partial<ServerRows> = {}): ServerRows {
  return {
    counters: Object.entries(state.counters).map(([prefix, n]) => ({ prefix, n })),
    officeSeq: 3,
    version: 7,
    personSeq: [], mailLog: [], usageMonth: [], usageWarnings: [], jobRuns: [],
    ...more,
  };
}

async function importState(t: Awaited<ReturnType<typeof nodeOffice>>, state: State, server: ServerRows = serverOf(state)) {
  const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'empty' });
  for (const spec of TABLES) {
    const rows = rowsOf(state, spec).map((row) => rowOf(spec, row.doc, state));
    for (let at = 0; at < rows.length; at += 50) await post(t, { step: 'part', id, table: spec.table, rows: rows.slice(at, at + 50) });
  }
  return post<{ version: number; officeSeq: number }>(t, { step: 'finish', id, server, signin: [] });
}

describe('the import steps of the office object (server/office/import.ts)', () => {
  it('imports the sample office in parts into an empty object: the records come back equal, and the lists come from the tables', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const out = await importState(t, seed);
    const back = await t.parts.db.tx('read', (q) => liteLoadWhole(q));
    for (const spec of TABLES) expect(rowsOf(back, spec).length, spec.table).toBe(rowsOf(seed, spec).length);
    expect(back.tasks.tsk_001).toEqual(seed.tasks.tsk_001);
    expect(out.officeSeq).toBe(serverOf(seed).officeSeq);
    const office = await t.parts.db.tx('read', (q) => readLiteOffice(t.parts.db, q));
    expect(Object.keys(office.lists.users).sort()).toEqual(Object.keys(seed.users).sort());
  });

  it('refuses mode empty on an office that holds records', async () => {
    const t = await nodeOffice();
    await expect(post(t, { step: 'begin', mode: 'empty' })).rejects.toThrow(/409.*holds records already/);
  });

  it('skips a part whose first row is there already (the answer of the part got lost, and the client sent it again)', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'empty' });
    const spec = TABLES.find((s) => s.table === 'tasks')!;
    const rows = rowsOf(seed, spec).map((row) => rowOf(spec, row.doc, seed)).slice(0, 10);
    expect(await post(t, { step: 'part', id, table: 'tasks', rows })).toEqual({ written: 10, skipped: false });
    expect(await post(t, { step: 'part', id, table: 'tasks', rows })).toEqual({ written: 0, skipped: true });
    expect(t.raw.prepare('select count(*) as n from tasks').get()).toEqual({ n: 10 });
  });

  it('refuses every batch while an import holds the office, also a read, and serves them after the finish', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'empty' });
    const read = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [{ i: 0, name: 'tasks.list', input: { scope: 'mine' } }], overviewCalls: 0, worker: 0 }, t.net);
    expect(read.ok === false && read.error.message).toContain('loads the office data');
    await post(t, { step: 'abort', id });
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
    await importState(t, seed);
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('copies the server rows: counters, office_seq, person numbers, the mail log of the day, the usage month and the job runs', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    await importState(t, seed, serverOf(seed, {
      personSeq: [{ user_id: 'usr_001', seq: 41 }],
      mailLog: [{ utc_day: NODE_TODAY, kind: 'notice', user_id: 'usr_002', ref: 'notice:ntf_001', resend_id: null, created_at: '2026-10-04T05:00:00.000Z' }],
      usageMonth: [{ month: '2026-10', calls: 1200, bytes_read: 5000, backup_bytes: null, signals_failed: 0, signals_failed_at: null }],
      usageWarnings: [{ month: '2026-10', metric: 'emailsToday', sent_at: '2026-10-04T05:00:00.000Z' }],
      jobRuns: [{ key: `summary:${NODE_TODAY}`, done_at: '2026-10-04T04:31:00.000Z' }],
    }));
    expect(t.raw.prepare('select seq from person_seq where user_id = ?').get('usr_001')).toEqual({ seq: 41 });
    expect(t.raw.prepare('select count(*) as n from mail_log').get()).toEqual({ n: 1 });
    expect(t.raw.prepare("select calls from usage_month where month = '2026-10'").get()).toEqual({ calls: 1200 });
    expect(t.raw.prepare('select key from job_runs').all()).toEqual([{ key: `summary:${NODE_TODAY}` }]);
    const [prefix, n] = Object.entries(seed.counters)[0];
    expect(t.raw.prepare('select n from counters where prefix = ?').get(prefix)).toEqual({ n });
  });

  it('sends no second morning summary after an import that holds the summary row of the day', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const withRow = await nodeOffice({ seed: false, at: '2026-10-04T05:00:00.000Z' });
    await importState(withRow, seed, serverOf(seed, { jobRuns: [{ key: `summary:${NODE_TODAY}`, done_at: '2026-10-04T04:31:00.000Z' }] }));
    await withRow.parts.cron({ at: '2026-10-04T05:00:00.000Z', worker: 0 }, withRow.net);
    expect(withRow.raw.prepare("select count(*) as n from mail_outbox where tag = 'summary'").get()).toEqual({ n: 0 });
    // The control: with no summary row, the same run mails the summary.
    const without = await nodeOffice({ seed: false, at: '2026-10-04T05:00:00.000Z' });
    await importState(without, seed);
    await without.parts.cron({ at: '2026-10-04T05:00:00.000Z', worker: 0 }, without.net);
    expect(Number((without.raw.prepare("select count(*) as n from mail_outbox where tag = 'summary'").get() as { n: number }).n)).toBeGreaterThan(0);
  });

  it('replaces the office only with the test tools on, wipes every record and sign-in row, and keeps the day meters', async () => {
    const off = await nodeOffice();
    await expect(post(off, { step: 'begin', mode: 'replace' })).rejects.toThrow(/403/);
    const t = await nodeOffice({ env: { MADAR_TEST_TOOLS: 'on' } });
    t.raw.exec("insert into usage_day (day, rows_written) values ('2026-10-04', 500)");
    t.raw.exec("insert into auth_users (id, email) values ('a1', 'x@madar.test')");
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'replace' });
    expect(t.raw.prepare('select count(*) as n from events').get()).toEqual({ n: 0 });
    expect(t.raw.prepare('select count(*) as n from auth_users').get()).toEqual({ n: 0 });
    expect(t.raw.prepare('select rows_written from usage_day').get()).toEqual({ rows_written: 500 });
    await post(t, { step: 'abort', id });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server server/office/import.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `/office/import` answers `not_found` (404).

- [ ] **Step 3: Write the steps**

Create `server/office/import.ts`:

```ts
import { ApiError } from '../../src/api/errors';
import { emptyState } from '../../src/api/store';
import { importSigninRows, type SigninExportRow } from '../auth/own/import';
import type { Query } from '../core/ports';
import type { LiteDb } from '../data/lite/db';
import { insertRow } from '../data/lite/save';
import { EVENT_GUARDS, eventGuardsSql } from '../data/lite/schema';
import type { Row } from '../data/rows';
import { TABLES } from '../data/tables';
import { EXPORT_TABLES, META_ROW_LITE } from './ops';
import type { DayRow } from './parts';

/**
 * The import of an office into the office object, in parts (Supabase exit, wave 4; spec section 4, steps 3 to 5). The client
 * (scripts/office/import.ts) sends the records in parts of at most 2,000 rows, then the server rows and the sign-in rows in one
 * finish. Each part is one transaction; a part whose first row is there already committed before, and the step skips it, so a
 * client may send a part again after a lost answer. The office object holds every call from the begin to the finish.
 */

export type ImportRow = Row;
export type ImportMode = 'empty' | 'resume' | 'replace';

/** The server rows that move with the records (spec section 4, step 3). Times are ISO text in UTC, days are YYYY-MM-DD. */
export type ServerRows = {
  counters: { prefix: string; n: number }[];
  officeSeq: number;
  version: number;
  personSeq: { user_id: string; seq: number }[];
  mailLog: { utc_day: string; kind: string; user_id: string | null; ref: string; resend_id: string | null; created_at: string }[];
  usageMonth: { month: string; calls: number; bytes_read: number; backup_bytes: number | null; signals_failed: number; signals_failed_at: string | null }[];
  usageWarnings: { month: string; metric: string; sent_at: string }[];
  jobRuns: { key: string; done_at: string }[];
};

export type ImportStep =
  | { step: 'begin'; mode: ImportMode }
  | { step: 'part'; id: string; table: string; rows: ImportRow[] }
  | { step: 'finish'; id: string; server: ServerRows; signin: SigninExportRow[] }
  | { step: 'abort'; id: string };
export type ImportBegin = { id: string; schema: number; day: DayRow };
export type ImportPartAnswer = { written: number; skipped: boolean };
export type ImportFinish = { version: number; officeSeq: number };

export const IMPORT_PART_ROWS = 2_000;
/** The tables that a replace keeps: the version only grows, and the meters count the real use of the day and the month. */
export const KEEP_ON_REPLACE: readonly string[] = ['office_meta', 'usage_day', 'usage_month', 'usage_warnings'];

const EMPTY = emptyState('');

export async function importBegin(db: LiteDb, mode: ImportMode): Promise<void> {
  if (mode === 'resume') return;
  if (mode === 'empty') {
    for (const spec of TABLES) {
      if (spec.collection === 'settings') continue;
      const [row] = await db.statement('read', `select 1 as n from ${spec.table} limit 1`);
      if (row) {
        throw new ApiError('conflict', `The office object holds records already (${spec.table}). Import into a new name, or use replace on the test copy.`, { reason: 'not_empty' });
      }
    }
    return;
  }
  // replace (the test tools only): every record, every sign-in row and every server row but KEEP_ON_REPLACE, in one transaction.
  // The History guard comes off for the deletes and on again before the commit.
  const host = db.host;
  await host.transaction(async () => {
    for (const name of EVENT_GUARDS) host.exec(`drop trigger ${name}`, []);
    for (const table of EXPORT_TABLES) if (!KEEP_ON_REPLACE.includes(table)) host.exec(`delete from ${table}`, []);
    for (const text of eventGuardsSql()) host.exec(text, []);
  });
}

export async function importPart(db: LiteDb, table: string, rows: readonly ImportRow[]): Promise<ImportPartAnswer> {
  const spec = TABLES.find((one) => one.table === table);
  if (!spec) throw new ApiError('invalid_input', `The import has no records table ${table}.`);
  if (rows.length === 0) return { written: 0, skipped: false };
  if (rows.length > IMPORT_PART_ROWS) throw new ApiError('invalid_input', `A part holds at most ${IMPORT_PART_ROWS} rows.`);
  if (spec.collection !== 'settings') {
    const [there] = await db.statement('read', `select 1 as n from ${spec.table} where id = ?1`, [rows[0].id]);
    if (there) return { written: 0, skipped: true };
  }
  // The schema makes the settings row of a new office, so the import replaces that one row; every other row is new.
  await db.tx('write', async (q) => {
    for (const row of rows) await insertRow(q, spec, row, EMPTY, spec.collection === 'settings' ? 'update' : 'fail');
  });
  return { written: rows.length, skipped: false };
}

export async function importFinish(
  db: LiteDb, server: ServerRows, signin: readonly SigninExportRow[], now: Date, flush?: (q: Query) => Promise<void>,
): Promise<ImportFinish> {
  return db.tx('write', async (q) => {
    for (const c of server.counters) await q('insert into counters (prefix, n) values (?1, ?2) on conflict (prefix) do update set n = excluded.n', [c.prefix, c.n]);
    // The number of the last office signal goes on from the source (the event numbers live in counters); the version only grows,
    // so a held snapshot of an older office never looks current.
    await q('update office_meta set office_seq = ?1, version = max(version, ?2) where id = 1', [server.officeSeq, server.version]);
    for (const p of server.personSeq) await q('insert into person_seq (user_id, seq) values (?1, ?2) on conflict (user_id) do update set seq = excluded.seq', [p.user_id, p.seq]);
    for (const m of server.mailLog) {
      await q('insert into mail_log (utc_day, kind, user_id, ref, resend_id, created_at) values (?1, ?2, ?3, ?4, ?5, ?6) on conflict (utc_day, ref) do nothing',
        [m.utc_day, m.kind, m.user_id, m.ref, m.resend_id, m.created_at]);
    }
    for (const u of server.usageMonth) {
      await q('insert into usage_month (month, calls, bytes_read, backup_bytes, signals_failed, signals_failed_at) values (?1, ?2, ?3, ?4, ?5, ?6) '
        + 'on conflict (month) do update set calls = excluded.calls, bytes_read = excluded.bytes_read, backup_bytes = excluded.backup_bytes, '
        + 'signals_failed = excluded.signals_failed, signals_failed_at = excluded.signals_failed_at',
        [u.month, u.calls, u.bytes_read, u.backup_bytes, u.signals_failed, u.signals_failed_at]);
    }
    for (const w of server.usageWarnings) await q('insert into usage_warnings (month, metric, sent_at) values (?1, ?2, ?3) on conflict (month, metric) do nothing', [w.month, w.metric, w.sent_at]);
    for (const j of server.jobRuns) {
      await q('insert into job_runs (key, done_at) values (?1, ?2) on conflict (key) do update set done_at = max(job_runs.done_at, excluded.done_at)', [j.key, j.done_at]);
    }
    // The sign-in rows last (wave 2): importSigninRows raises the version once more and writes the snapshot with the lists of the
    // tables, so the first call after the import reads the new office.
    await importSigninRows(q, signin, now);
    if (flush) await flush(q);
    const [meta] = await q<{ version: number; office_seq: number }>(META_ROW_LITE);
    return { version: Number(meta.version), officeSeq: Number(meta.office_seq) };
  });
}
```

In `server/office/parts.ts`:

1. Import `importBegin, importFinish, importPart, type ImportStep` from `./import`.

2. Add to `OfficeParts`: `dayCounts(now: Date): Promise<DayRow>;` and the helper inside `officeParts`:

```ts
  /** The counts of the UTC day of now: the day row and what the meter holds in memory still (it moves the rows of the host in). */
  async function dayCounts(now: Date): Promise<DayRow> {
    const [row] = await db.statement<DayRow>('read', DAY_ROW_LITE, [utcDay(now)]);
    const pending = meter.pending();
    return {
      rows_read: Number(row?.rows_read ?? 0) + pending.rowsRead,
      rows_written: Number(row?.rows_written ?? 0) + pending.rowsWritten,
      requests: Number(row?.requests ?? 0) + pending.requests,
      calls: Number(row?.calls ?? 0) + pending.calls,
      worker_requests: Number(row?.worker_requests ?? 0) + pending.workerRequests,
    };
  }

  async function importStep(step: ImportStep, now: Date) {
    if (step.step === 'begin') {
      if (step.mode === 'replace' && !tools) throw new ApiError('forbidden', 'The replace mode is a test tool, and it is off on this copy.');
      const id = hold.begin('import', now);
      try {
        await importBegin(db, step.mode);
      } catch (error) {
        hold.end(id);
        throw error;
      }
      return { id, schema: LITE_SCHEMA_VERSION, day: await dayCounts(now) };
    }
    hold.check(step.id, now);
    if (step.step === 'abort') {
      hold.end(step.id);
      return { ok: true };
    }
    if (step.step === 'part') return importPart(db, step.table, step.rows);
    const out = await importFinish(db, step.server, step.signin, now, (q) => meter.flush(q, now));
    hold.end(step.id);
    // Every open screen showed the office before the import: its socket closes, so it opens again and reloads every list.
    for (const socket of o.sockets.list('office')) {
      try {
        socket.close(1012, 'The office data changed.');
      } catch {
        // The socket is closed already.
      }
    }
    return out;
  }
```

3. In `ops`, before the `not_found` line: `if (path === '/office/import') return Response.json(await importStep(body as ImportStep, now));`

4. Return `dayCounts` in the object of `officeParts`.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run --project server server/office/import.test.ts server/office/ops.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. Then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/office/import.ts server/office/import.test.ts server/office/parts.ts
git commit -m "Exit wave 4: the import steps of the office object: parts that a client may send again, the server rows and the sign-in rows"
```

### Task 11: The sources of an import: a State, an export folder and Postgres

**Files:**
- Create: `scripts/office/source.ts`, `scripts/office/source.test.ts`, `server/it/officeImport.it.test.ts` (Task 14 adds its second case)
- Test: `scripts/office/source.test.ts`, `server/it/officeImport.it.test.ts`

**Interfaces:**
- Consumes: `ImportRow`, `ServerRows` (Task 10), `rowOf`, `docOf` (`server/data/rows.ts`), `TABLES`, `rowsOf` (`server/data/tables.ts`),
  `loadWhole` (`server/data/whole.ts`), `SIGNIN_EXPORT_SQL`, `SigninExportRow` (wave 2), `ExportManifest` (Task 7).
- Produces: `type ImportTable = { table: string; rows: ImportRow[] }`;
  `type OfficeSource = { tables: ImportTable[]; server: ServerRows; signin: SigninExportRow[]; records: number; users: ReadonlySet<string> }`;
  `stateSource(state, o?: { signin?; server? }): OfficeSource`; `exportSource(folder, o: { today: string }): OfficeSource`;
  `PG_SERVER_SQL`; `pgSource(query: PgQuery): Promise<OfficeSource>`; `type PgQuery = (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/office/source.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { nodeOffice, NODE_TODAY } from '../../server/office/test/nodeOffice';
import { exportOffice } from '../backup/officeExport';
import { recordDigest } from './digest';
import { partsOps } from './ops';
import { exportSource, PG_SERVER_SQL, pgSource, stateSource } from './source';

const digests = (source: ReturnType<typeof stateSource>) => Object.fromEntries(source.tables.map((t) => [t.table, recordDigest(t.rows)]));

describe('the sources of an import (scripts/office/source.ts)', () => {
  it('gives every record of a State with its server columns, and the counters that hold the event numbers', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const source = stateSource(seed);
    const comments = source.tables.find((t) => t.table === 'comments')!;
    expect(comments.rows[0].columns).toHaveProperty('project_id');
    expect(source.records).toBe(source.tables.reduce((sum, t) => sum + t.rows.length, 0));
    expect(source.server.officeSeq).toBe(0);
    expect(source.server.counters.length).toBe(Object.keys(seed.counters).length);
  });

  it('reads an export folder back into the same records as the office it came from', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed });
    const folder = mkdtempSync(join(tmpdir(), 'madar-source-test-'));
    await exportOffice(partsOps(t.parts), { copy: 'local', folder });
    const back = exportSource(folder, { today: NODE_TODAY });
    expect(digests(back)).toEqual(digests(stateSource(seed)));
    expect(back.server.officeSeq).toBe(Number((t.raw.prepare('select office_seq from office_meta').get() as { office_seq: number }).office_seq));
  });

  it('reads Postgres inside one read-only snapshot, with numbers for bigint texts and ISO text for times', async () => {
    const texts: string[] = [];
    const rows: Record<string, Record<string, unknown>[]> = {
      [PG_SERVER_SQL.meta]: [{ version: '12', office_seq: '340' }],
      [PG_SERVER_SQL.personSeq]: [{ user_id: 'usr_001', seq: '41' }],
      [PG_SERVER_SQL.jobRuns]: [{ key: 'summary:2026-10-04', done_at: new Date('2026-10-04T04:31:00Z') }],
    };
    const source = await pgSource(async (text) => {
      texts.push(text);
      return rows[text] ?? [];
    });
    expect(texts[0]).toBe('begin isolation level repeatable read read only');
    expect(texts.at(-1)).toBe('commit');
    expect(source.server).toMatchObject({ version: 12, officeSeq: 340, personSeq: [{ user_id: 'usr_001', seq: 41 }], jobRuns: [{ key: 'summary:2026-10-04', done_at: '2026-10-04T04:31:00.000Z' }] });
  });
});
```

Create `server/it/officeImport.it.test.ts` (the merge lead runs it under the Docker lock):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildSeed } from '../../src/data/seed';
import { recordDigest } from '../../scripts/office/digest';
import { pgSource, stateSource } from '../../scripts/office/source';
import { writeState } from '../data/whole';
import { applyMigrations, dropSchema, localClient } from './migrate';

const TODAY = '2026-10-04';
const SCHEMA = `office_import_${process.pid}`;

describe('the Postgres source of an import on the local stack', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await localClient();
    await applyMigrations(client, SCHEMA);
    await client.query(`set search_path to ${SCHEMA}, public`);
    const seed = await buildSeed(TODAY, async () => undefined);
    await client.query('begin');
    await writeState(async (text, values) => (await client.query(text, values)).rows, seed);
    await client.query('commit');
  }, 120_000);

  afterAll(async () => {
    await dropSchema(client, SCHEMA);
    await client.end();
  });

  it('reads the same records that the State wrote, with the counters', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const source = await pgSource(async (text, values) => (await client.query(text, values)).rows);
    const want = stateSource(seed);
    for (const table of want.tables) {
      const got = source.tables.find((t) => t.table === table.table)!;
      expect(recordDigest(got.rows), table.table).toEqual(recordDigest(table.rows));
    }
    const byPrefix = (rows: { prefix: string; n: number }[]) => [...rows].sort((a, b) => a.prefix.localeCompare(b.prefix));
    expect(byPrefix(source.server.counters)).toEqual(byPrefix(want.server.counters));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server scripts/office/source.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './source'". (The it-test runs in the gate: `MADAR_IT=1 npx vitest run --project it server/it/officeImport.it.test.ts`.)

- [ ] **Step 3: Write the sources**

Create `scripts/office/source.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { State } from '../../src/api/store';
import { SIGNIN_EXPORT_SQL, type SigninExportRow } from '../../server/auth/own/import';
import type { Query } from '../../server/core/ports';
import { rowOf } from '../../server/data/rows';
import { TABLES, rowsOf } from '../../server/data/tables';
import { loadWhole } from '../../server/data/whole';
import type { ImportRow, ServerRows } from '../../server/office/import';
import type { ExportManifest } from '../backup/officeExport';

/**
 * Where an import takes its office from (Supabase exit, wave 4): a State (the test seed, the year office of the tests), an export
 * folder of an office object (a restore into a new object, the round trip), or a Postgres copy (the test copy in wave 5, a copy of
 * production for the rehearsal, the switch of wave 6). Each gives the records with their server columns, the server rows of spec
 * section 4 step 3, and the sign-in rows of wave 2.
 */

export type ImportTable = { table: string; rows: ImportRow[] };
export type OfficeSource = { tables: ImportTable[]; server: ServerRows; signin: SigninExportRow[]; records: number; users: ReadonlySet<string> };
export type PgQuery = (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;

const NO_SERVER_ROWS: Omit<ServerRows, 'counters' | 'officeSeq' | 'version'> = { personSeq: [], mailLog: [], usageMonth: [], usageWarnings: [], jobRuns: [] };

function sourceOf(state: State, server: ServerRows, signin: SigninExportRow[]): OfficeSource {
  const tables = TABLES.map((spec) => ({ table: spec.table, rows: rowsOf(state, spec).map((row) => rowOf(spec, row.doc, state)) }));
  return { tables, server, signin, records: tables.reduce((sum, t) => sum + t.rows.length, 0), users: new Set(Object.keys(state.users)) };
}

export function stateSource(state: State, o: { signin?: SigninExportRow[]; server?: Partial<ServerRows> } = {}): OfficeSource {
  const server: ServerRows = {
    counters: Object.entries(state.counters).map(([prefix, n]) => ({ prefix, n })),
    // A State has no office signal of its own; the copy starts at 0. The event numbers are in counters.
    officeSeq: 0,
    version: 0,
    ...NO_SERVER_ROWS,
    ...o.server,
  };
  return sourceOf(state, server, o.signin ?? []);
}

const num = (value: unknown): number => Number(value ?? 0);
const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));

/** The server rows of Postgres. Each bigint comes as text (pg), each day as text (a pg date would become a Date of the Mac's zone). */
export const PG_SERVER_SQL = {
  counters: 'select prefix, n from counters',
  meta: 'select version::text as version, office_seq::text as office_seq from office_meta where id = 1',
  personSeq: 'select user_id, seq::text as seq from person_seq',
  mailLog: "select utc_day::text as utc_day, kind, user_id, ref, resend_id, created_at from mail_log where utc_day >= ((now() at time zone 'utc')::date - 1)",
  usageMonth: 'select month, calls::text as calls, bytes_read::text as bytes_read, backup_bytes::text as backup_bytes, signals_failed, signals_failed_at from usage_month',
  usageWarnings: 'select month, metric, sent_at from usage_warnings',
  jobRuns: 'select key, done_at from job_runs',
} as const;

/**
 * One copy of Postgres, read inside one read-only snapshot (repeatable read), so the records, the server rows and the sign-in rows
 * belong to one moment, and no write of the copy waits for the read. SIGNIN_EXPORT_SQL reads auth.users: the role must be postgres.
 */
export async function pgSource(query: PgQuery): Promise<OfficeSource> {
  await query('begin isolation level repeatable read read only');
  let done = false;
  try {
    const q: Query = (async (text: string, values: unknown[] = []) => query(text, values)) as Query;
    const state = await loadWhole(q);
    const [meta] = await query(PG_SERVER_SQL.meta);
    const server: ServerRows = {
      counters: (await query(PG_SERVER_SQL.counters)).map((r) => ({ prefix: String(r.prefix), n: num(r.n) })),
      officeSeq: num(meta?.office_seq),
      version: num(meta?.version),
      personSeq: (await query(PG_SERVER_SQL.personSeq)).map((r) => ({ user_id: String(r.user_id), seq: num(r.seq) })),
      mailLog: (await query(PG_SERVER_SQL.mailLog)).map((r) => ({
        utc_day: String(r.utc_day), kind: String(r.kind), user_id: (r.user_id as string | null) ?? null, ref: String(r.ref),
        resend_id: (r.resend_id as string | null) ?? null, created_at: iso(r.created_at),
      })),
      usageMonth: (await query(PG_SERVER_SQL.usageMonth)).map((r) => ({
        month: String(r.month), calls: num(r.calls), bytes_read: num(r.bytes_read), backup_bytes: r.backup_bytes === null ? null : num(r.backup_bytes),
        signals_failed: num(r.signals_failed), signals_failed_at: isoOrNull(r.signals_failed_at),
      })),
      usageWarnings: (await query(PG_SERVER_SQL.usageWarnings)).map((r) => ({ month: String(r.month), metric: String(r.metric), sent_at: iso(r.sent_at) })),
      jobRuns: (await query(PG_SERVER_SQL.jobRuns)).map((r) => ({ key: String(r.key), done_at: iso(r.done_at) })),
    };
    const signin = (await query(SIGNIN_EXPORT_SQL)) as unknown as SigninExportRow[];
    await query('commit');
    done = true;
    return sourceOf(state, server, signin);
  } finally {
    if (!done) await query('rollback').catch(() => undefined);
  }
}

type ExportRowOf = Record<string, string | number | null>;

function readTable(folder: string, table: string): ExportRowOf[] {
  const text = readFileSync(join(folder, 'tables', `${table}.ndjson`), 'utf8');
  return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as ExportRowOf);
}

/** An export folder of an office object (scripts/backup/officeExport.ts), as a source: a restore into a new object, the round trip. */
export function exportSource(folder: string, o: { today: string }): OfficeSource {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as ExportManifest;
  const tables = TABLES.map((spec) => ({
    table: spec.table,
    rows: readTable(folder, spec.table).map((row) => ({
      id: String(row.id),
      doc: JSON.parse(String(row.doc)) as Record<string, unknown>,
      columns: Object.fromEntries(Object.keys(spec.serverColumns ?? {}).map((name) => [name, row[name] ?? null])),
    })),
  }));
  const yesterday = new Date(Date.parse(`${o.today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const server: ServerRows = {
    counters: readTable(folder, 'counters').map((r) => ({ prefix: String(r.prefix), n: num(r.n) })),
    officeSeq: manifest.officeSeq,
    version: manifest.version,
    personSeq: readTable(folder, 'person_seq').map((r) => ({ user_id: String(r.user_id), seq: num(r.seq) })),
    mailLog: readTable(folder, 'mail_log').filter((r) => String(r.utc_day) >= yesterday).map((r) => ({
      utc_day: String(r.utc_day), kind: String(r.kind), user_id: (r.user_id as string | null) ?? null, ref: String(r.ref),
      resend_id: (r.resend_id as string | null) ?? null, created_at: String(r.created_at),
    })),
    usageMonth: readTable(folder, 'usage_month').map((r) => ({
      month: String(r.month), calls: num(r.calls), bytes_read: num(r.bytes_read), backup_bytes: r.backup_bytes === null ? null : num(r.backup_bytes),
      signals_failed: num(r.signals_failed), signals_failed_at: (r.signals_failed_at as string | null) ?? null,
    })),
    usageWarnings: readTable(folder, 'usage_warnings').map((r) => ({ month: String(r.month), metric: String(r.metric), sent_at: String(r.sent_at) })),
    jobRuns: readTable(folder, 'job_runs').map((r) => ({ key: String(r.key), done_at: String(r.done_at) })),
  };
  // A restore brings the people and their passwords; the sessions, links and OAuth rows stay out: each person signs in again.
  const signin: SigninExportRow[] = readTable(folder, 'auth_users').map((r) => ({
    id: String(r.id), email: String(r.email), password_hash: (r.password_hash as string | null) ?? null, email_confirmed: num(r.email_confirmed) === 1,
    banned: num(r.banned) === 1, password_set: num(r.password_set) === 1, user_id: (r.user_id as string | null) ?? null,
  }));
  const users = new Set(tables.find((t) => t.table === 'users')!.rows.map((row) => row.id));
  return { tables, server, signin, records: tables.reduce((sum, t) => sum + t.rows.length, 0), users };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS. Then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/office/source.ts scripts/office/source.test.ts server/it/officeImport.it.test.ts
git commit -m "Exit wave 4: the sources of an import: a State, an export folder, and one read-only snapshot of Postgres"
```

### Task 12: The import client, with the day budget and the parts

**Files:**
- Create: `scripts/office/import.ts`, `scripts/office/import.test.ts`, `scripts/office/drop.ts`
- Test: `scripts/office/import.test.ts`

**Interfaces:**
- Consumes: `OfficeOps`, `opsOf`, `partsOps` (Task 7), `OfficeSource`, `stateSource`, `pgSource`, `exportSource` (Task 11),
  `ImportBegin`, `ImportMode`, `IMPORT_PART_ROWS` (Task 10), `exportOffice` (Task 7), `compareImport` (Task 13, in the command line
  only), `IMPORT_ROWS_PER_RECORD` (`server/office/test/pins.ts`, in the test only), `parseSecretsFile` (`scripts/deploy/secrets.ts`).
- Produces: `IMPORT_ROWS_PER_RECORD = 7.5`, `IMPORT_FIXED_ROWS = 2_000`, `FREE_ROWS_WRITTEN_A_DAY = 100_000`, `IMPORT_DAY_LIMIT = 90_000`,
  `IMPORT_PART_CHARS = 2_000_000`; `rowsToWrite(records)`; `planParts(source)`; `budgetProblem(o)`;
  `type ImportReport = { records; parts; skipped; planned; version }`; `importOffice(ops, source, o)`; `targetOf(to)`;
  `scripts/office/drop.ts` (the drop of a spare object).

- [ ] **Step 1: Write the failing test**

Create `scripts/office/import.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { IMPORT_ROWS_PER_RECORD as PIN } from '../../server/office/test/pins';
import { NODE_TODAY, nodeOffice } from '../../server/office/test/nodeOffice';
import { recordDigest } from './digest';
import { budgetProblem, IMPORT_ROWS_PER_RECORD, importOffice, planParts, rowsToWrite, targetOf } from './import';
import { partsOps, type OfficeOps } from './ops';
import { stateSource } from './source';

describe('the import client (scripts/office/import.ts)', () => {
  it('plans 7.5 rows written for each record, the ceiling of the rows pins of wave 1', () => {
    expect(IMPORT_ROWS_PER_RECORD).toBe(PIN);
    expect(rowsToWrite(908)).toBe(8_810);
  });

  it('splits a table into parts of at most 2,000 rows and about 2 MB', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const source = stateSource(seed);
    const big = { ...source, tables: [{ table: 'events', rows: Array.from({ length: 4_500 }, (_, i) => ({ id: `evt_${i}`, doc: { n: i }, columns: {} })) }] };
    expect(planParts(big).map((p) => p.rows.length)).toEqual([2_000, 2_000, 500]);
    const heavy = { ...source, tables: [{ table: 'users', rows: Array.from({ length: 3 }, (_, i) => ({ id: `usr_${i}`, doc: { avatar: 'x'.repeat(900_000) }, columns: {} })) }] };
    expect(planParts(heavy).map((p) => p.rows.length)).toEqual([2, 1]);
  });

  it('says how many Free days the year office needs, and refuses it as one import', () => {
    expect(budgetProblem({ records: 132_221, usedToday: 0, limit: 90_000 })).toContain('about 993,658 rows written');
    expect(budgetProblem({ records: 132_221, usedToday: 0, limit: 90_000 })).toContain('10 days');
    expect(budgetProblem({ records: 908, usedToday: 0, limit: 90_000 })).toBeUndefined();
    expect(budgetProblem({ records: 908, usedToday: 85_000, limit: 90_000 })).toContain('left of the limit');
  });

  it('refuses an office over the day budget and writes nothing: only the begin and the abort reach the object', async () => {
    const t = await nodeOffice({ seed: false });
    const seen: string[] = [];
    const inner = partsOps(t.parts);
    const ops: OfficeOps = { post: async <T,>(op: string, body: unknown) => (seen.push((body as { step: string }).step), inner.post<T>(op, body)) };
    const source = stateSource(await buildSeed(NODE_TODAY, async () => undefined));
    await expect(importOffice(ops, source, { mode: 'empty', limit: 5_000 })).rejects.toThrow('One import must fit one UTC day');
    expect(seen).toEqual(['begin', 'abort']);
    expect(t.raw.prepare('select count(*) as n from tasks').get()).toEqual({ n: 0 });
  });

  it('sends a part again after a failed answer, and the office ends with each record once', async () => {
    const t = await nodeOffice({ seed: false });
    const inner = partsOps(t.parts);
    let failed = false;
    const ops: OfficeOps = {
      post: async <T,>(op: string, body: unknown): Promise<T> => {
        const out = await inner.post<T>(op, body);
        // The first part of tasks commits, and then its answer gets lost.
        if (!failed && (body as { table?: string }).table === 'tasks') {
          failed = true;
          throw new Error('The office op import answered 502: lost');
        }
        return out;
      },
    };
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const report = await importOffice(ops, stateSource(seed), { mode: 'empty', wait: async () => undefined });
    expect(report.skipped).toBe(1);
    expect(t.raw.prepare('select count(*) as n from tasks').get()).toEqual({ n: Object.keys(seed.tasks).length });
    const tasks = (t.raw.prepare('select id, doc from tasks').all() as { id: string; doc: string }[]);
    expect(recordDigest(tasks)).toEqual(recordDigest(stateSource(seed).tables.find((x) => x.table === 'tasks')!.rows));
  });

  it('takes the test copy and the local office as targets, and refuses production before wave 6', () => {
    expect(targetOf('https://preview.madar-46r.pages.dev').copy).toBe('test');
    expect(targetOf('http://127.0.0.1:8792').copy).toBe('local');
    expect(() => targetOf('https://madar.vado.sa')).toThrow('wave 6');
    expect(() => targetOf('https://example.com')).toThrow('not a Madar copy');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/office/import.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './import'".

- [ ] **Step 3: Write the client**

Create `scripts/office/import.ts`:

```ts
// The import of an office into an office object (Supabase exit, wave 4; spec section 4, steps 3 to 6).
//
//   npx tsx scripts/office/import.ts --from <test|production|local|export:<folder>> --to <page address> [--office rehearsal-YYYYMMDD]
//       [--mode empty|resume|replace] [--used-today <rows written of the account today>] [--limit 90000] [--dry-run]
//
// It reads the source (Postgres inside one read-only snapshot, or an export folder), plans the parts, checks the Free day budget,
// sends the parts, then exports the object and compares the count and the hash of each table with the source. A difference exits 1.
// --from production reads production (only with the typed word production, and only into a rehearsal name). --to never takes
// production before wave 6. The secrets come from secrets/test.env (the test copy) or from the environment (the local office); the
// script never prints them.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { copyOfPageHost, type Copy } from '../../server/core/serverHost';
import { EXPORT_SECRET_HEADER, OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { IMPORT_PART_ROWS, type ImportBegin, type ImportFinish, type ImportMode, type ImportPartAnswer } from '../../server/office/import';
import { REHEARSAL_NAME } from '../../server/office/ops';
import { exportOffice } from '../backup/officeExport';
import { parseSecretsFile, POOLER_HOST, REFS } from '../deploy/secrets';
import { opsOf, type OfficeOps } from './ops';
import { exportSource, pgSource, type ImportTable, type OfficeSource } from './source';

/** The ceiling of the rows pins of wave 1 (server/office/test/pins.ts, IMPORT_ROWS_PER_RECORD): 6.90 measured, 7.5 planned. */
export const IMPORT_ROWS_PER_RECORD = 7.5;
/** The schema of a new office, the finish, the snapshot and the sign-in rows: a margin above the rows of the records. */
export const IMPORT_FIXED_ROWS = 2_000;
export const FREE_ROWS_WRITTEN_A_DAY = 100_000;
/** One import may take 90% of the Free day: the copy keeps the rest for its own calls of the day. */
export const IMPORT_DAY_LIMIT = 90_000;
export const IMPORT_PART_CHARS = 2_000_000;

export function rowsToWrite(records: number): number {
  return Math.ceil(records * IMPORT_ROWS_PER_RECORD) + IMPORT_FIXED_ROWS;
}

const n = (value: number) => value.toLocaleString('en-US');

/** Why the import cannot run today, or undefined. The day ends at 00:00 UTC (03:00 Riyadh) for the whole account. */
export function budgetProblem(o: { records: number; usedToday: number; limit: number }): string | undefined {
  const planned = rowsToWrite(o.records);
  const room = Math.max(0, o.limit - o.usedToday);
  if (planned <= room) return undefined;
  const days = Math.ceil(planned / FREE_ROWS_WRITTEN_A_DAY);
  return `This office needs about ${n(planned)} rows written (${n(o.records)} records x ${IMPORT_ROWS_PER_RECORD}, plus ${n(IMPORT_FIXED_ROWS)}), `
    + `and the day has ${n(room)} left of the limit ${n(o.limit)}. One import must fit one UTC day: at the whole Free day of `
    + `${n(FREE_ROWS_WRITTEN_A_DAY)} rows it needs ${days} days. Wait for 03:00 Riyadh, or import a smaller office.`;
}

export function planParts(source: OfficeSource): ImportTable[] {
  const parts: ImportTable[] = [];
  for (const table of source.tables) {
    let rows: ImportTable['rows'] = [];
    let chars = 0;
    for (const row of table.rows) {
      const size = JSON.stringify(row).length;
      if (rows.length > 0 && (rows.length === IMPORT_PART_ROWS || chars + size > IMPORT_PART_CHARS)) {
        parts.push({ table: table.table, rows });
        rows = [];
        chars = 0;
      }
      rows.push(row);
      chars += size;
    }
    if (rows.length > 0) parts.push({ table: table.table, rows });
  }
  return parts;
}

export type ImportReport = { records: number; parts: number; skipped: number; planned: number; version: number };

export async function importOffice(
  ops: OfficeOps, source: OfficeSource,
  o: { mode: ImportMode; limit?: number; usedToday?: number; log?: (line: string) => void; tries?: number; wait?: (ms: number) => Promise<void> },
): Promise<ImportReport> {
  const log = o.log ?? (() => undefined);
  const wait = o.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const tries = o.tries ?? 3;
  const begin = await ops.post<ImportBegin>('import', { step: 'begin', mode: o.mode });
  let finished = false;
  try {
    const problem = budgetProblem({ records: source.records, usedToday: Math.max(o.usedToday ?? 0, begin.day.rows_written), limit: o.limit ?? IMPORT_DAY_LIMIT });
    if (problem) throw new Error(problem);
    const parts = planParts(source);
    let skipped = 0;
    for (const [i, part] of parts.entries()) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const answer = await ops.post<ImportPartAnswer>('import', { step: 'part', id: begin.id, table: part.table, rows: part.rows });
          if (answer.skipped) skipped += 1;
          break;
        } catch (error) {
          // A lost answer or a short fault: the part goes again, and the object skips it when it committed already.
          if (attempt >= tries || /answered 4\d\d/.test(String(error))) throw error;
          await wait(2_000 * attempt);
        }
      }
      if ((i + 1) % 20 === 0) log(`${i + 1} of ${parts.length} parts.`);
    }
    const finish = await ops.post<ImportFinish>('import', { step: 'finish', id: begin.id, server: source.server, signin: source.signin });
    finished = true;
    return { records: source.records, parts: parts.length, skipped, planned: rowsToWrite(source.records), version: finish.version };
  } finally {
    if (!finished) await ops.post('import', { step: 'abort', id: begin.id }).catch(() => undefined);
  }
}

/** The copy of a target address. The production page host is refused until the switch of wave 6. */
export function targetOf(to: string): { copy: Copy | 'local'; base: string } {
  const url = new URL(to);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return { copy: 'local', base: url.origin };
  const copy = copyOfPageHost(url.hostname);
  if (!copy) throw new Error(`${url.host} is not a Madar copy.`);
  if (copy === 'production') throw new Error('An import into production comes only with the switch (wave 6 of the exit plan).');
  return { copy, base: url.origin };
}

function secretsOf(copy: Copy | 'local'): { ops: string; exportSecret: string } {
  const values = copy === 'local' ? process.env : parseSecretsFile(readFileSync(new URL(`../../secrets/${copy}.env`, import.meta.url), 'utf8'));
  const ops = values.MADAR_OPS_SECRET;
  const exportSecret = values.MADAR_EXPORT_SECRET;
  if (!ops || !exportSecret) throw new Error(`MADAR_OPS_SECRET and MADAR_EXPORT_SECRET must be set for ${copy} (scripts/office/new-secret.ts).`);
  return { ops, exportSecret };
}

async function typedWord(): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await reader.question('This reads production. Type production to go on: ')).trim();
  } finally {
    reader.close();
  }
}

/** Postgres of a copy as postgres, through the session pooler, with the Supabase root certificate (the rights of the backup). */
async function postgresOf(from: 'test' | 'production' | 'local'): Promise<pg.Client> {
  if (from === 'local') {
    const client = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
    await client.connect();
    return client;
  }
  const password = process.env[from === 'test' ? 'MADAR_TEST_DB_PASSWORD' : 'MADAR_DB_PASSWORD'];
  if (!password) throw new Error(`${from === 'test' ? 'MADAR_TEST_DB_PASSWORD' : 'MADAR_DB_PASSWORD'} is not set: load ~/dev/madar/.env.local first.`);
  const ca = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
  const client = new pg.Client({ host: POOLER_HOST, port: 5432, user: `postgres.${REFS[from]}`, password, database: 'postgres', ssl: { ca, rejectUnauthorized: true, servername: POOLER_HOST } });
  await client.connect();
  return client;
}

export async function sourceFrom(from: string, today: string): Promise<OfficeSource> {
  if (from.startsWith('export:')) return exportSource(from.slice('export:'.length), { today });
  if (from !== 'test' && from !== 'production' && from !== 'local') throw new Error('--from must be test, production, local or export:<folder>.');
  const client = await postgresOf(from);
  try {
    return await pgSource(async (text, values) => (await client.query(text, values)).rows);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(argv: string[]): Promise<void> {
  const value = (flag: string, fallback = '') => {
    const at = argv.indexOf(flag);
    return at === -1 ? fallback : (argv[at + 1] ?? fallback);
  };
  const from = value('--from');
  const target = targetOf(value('--to'));
  const office = value('--office') || undefined;
  if (from === 'production' && (!office || !REHEARSAL_NAME.test(office))) throw new Error('A copy of production goes only into a rehearsal name (--office rehearsal-YYYYMMDD).');
  if (from === 'production' && (await typedWord()) !== 'production') throw new Error('The typed word was not production. Nothing changed.');
  const today = new Date().toISOString().slice(0, 10);
  const source = await sourceFrom(from, today);
  const limit = Number(value('--limit', String(IMPORT_DAY_LIMIT)));
  const usedToday = Number(value('--used-today', '0'));
  console.log(`Source: ${n(source.records)} records, ${source.signin.length} sign-in rows. Planned: about ${n(rowsToWrite(source.records))} rows written.`);
  const problem = budgetProblem({ records: source.records, usedToday, limit });
  if (problem) throw new Error(problem);
  if (argv.includes('--dry-run')) return;
  const secrets = secretsOf(target.copy);
  const ops = opsOf({ base: target.base, secret: secrets.ops, header: OPS_SECRET_HEADER, ...(office ? { office } : {}) });
  const report = await importOffice(ops, source, { mode: (value('--mode', 'empty') as ImportMode), limit, usedToday, log: (line) => console.log(line) });
  console.log(JSON.stringify(report));
  const folder = mkdtempSync(join(tmpdir(), `madar-office-check-${process.pid}-`));
  try {
    await exportOffice(opsOf({ base: target.base, secret: secrets.exportSecret, header: EXPORT_SECRET_HEADER, ...(office ? { office } : {}) }), { copy: target.copy, folder });
    const { compareImport } = await import('./compare');
    const { problems, notes } = compareImport(source, folder);
    for (const note of notes) console.log(`Note: ${note}`);
    if (problems.length > 0) throw new Error(`The office object differs from the source:\n${problems.join('\n')}`);
    console.log('The count and the hash of each table match the source.');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

(`POOLER_HOST` and `REFS` are exported from `scripts/deploy/secrets.ts` already; `parseSecretsFile` too.)

Create `scripts/office/drop.ts`:

```ts
// Drops a spare object of the production rehearsal (wave 5): npx tsx scripts/office/drop.ts --to <test page address> --office rehearsal-YYYYMMDD
// The Worker drops only a rehearsal name, and the object deletes all of its storage. The ops secret comes from secrets/test.env.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { REHEARSAL_NAME } from '../../server/office/ops';
import { parseSecretsFile } from '../deploy/secrets';
import { targetOf } from './import';
import { opsOf } from './ops';

async function main(argv: string[]): Promise<void> {
  const value = (flag: string) => argv[argv.indexOf(flag) + 1] ?? '';
  const target = targetOf(value('--to'));
  const office = value('--office');
  if (!REHEARSAL_NAME.test(office)) throw new Error('--office must be a rehearsal name (rehearsal-YYYYMMDD).');
  const secret = target.copy === 'local' ? process.env.MADAR_OPS_SECRET : parseSecretsFile(readFileSync(new URL(`../../secrets/${target.copy}.env`, import.meta.url), 'utf8')).MADAR_OPS_SECRET;
  if (!secret) throw new Error('MADAR_OPS_SECRET is not set for this copy.');
  console.log(JSON.stringify(await opsOf({ base: target.base, secret, header: OPS_SECRET_HEADER, office }).post('drop', {})));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS. Then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/office/import.ts scripts/office/import.test.ts scripts/office/drop.ts
git commit -m "Exit wave 4: the import client sends parts that fit one Free day, sends a part again after a lost answer, and checks the result"
```

### Task 13: The count and hash check of an import

**Files:**
- Create: `scripts/office/compare.ts`, `scripts/office/compare.test.ts`
- Test: `scripts/office/compare.test.ts`

**Interfaces:**
- Consumes: `OfficeSource` (Task 11), `recordDigest`, `rowDigest`, `compareDigests`, `canonical` (Task 6), `DRIFT_TABLES` (Task 4).
- Produces: `sourceDigests(source): Record<string, TableDigest>`; `exportDigests(folder, o: { days: readonly string[] }): Record<string, TableDigest>`;
  `compareImport(source, folder): { problems: string[]; notes: string[] }`. The keys: each records table by its name, and
  `counters`, `person_seq`, `office_seq`, `auth_users`, `job_runs`, `usage_month`, `mail_log`.

- [ ] **Step 1: Write the failing test**

Create `scripts/office/compare.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { NODE_TODAY, nodeOffice } from '../../server/office/test/nodeOffice';
import { exportOffice } from '../backup/officeExport';
import { compareImport, sourceDigests } from './compare';
import { importOffice } from './import';
import { partsOps } from './ops';
import { stateSource } from './source';

async function imported() {
  const seed = await buildSeed(NODE_TODAY, async () => undefined);
  const source = stateSource(seed, {
    signin: [{ id: 'a1', email: 'hala@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: false, user_id: 'usr_001' },
      { id: 'a2', email: 'gone@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: false, user_id: 'usr_999' }],
    server: { personSeq: [{ user_id: 'usr_001', seq: 3 }], jobRuns: [{ key: 'heartbeat', done_at: '2026-10-04T05:45:00.000Z' }] },
  });
  const t = await nodeOffice({ seed: false });
  await importOffice(partsOps(t.parts), source, { mode: 'empty' });
  const folder = mkdtempSync(join(tmpdir(), 'madar-compare-test-'));
  await exportOffice(partsOps(t.parts), { copy: 'local', folder });
  return { source, folder };
}

describe('the check of an import (scripts/office/compare.ts)', () => {
  it('finds no difference after a good import, with the sign-in link of a person who is not in the office left out', async () => {
    const { source, folder } = await imported();
    expect(compareImport(source, folder).problems).toEqual([]);
    expect(Object.keys(sourceDigests(source))).toEqual(expect.arrayContaining(['tasks', 'events', 'counters', 'person_seq', 'office_seq', 'auth_users', 'job_runs']));
  });

  it('names the table when the office lost a record', async () => {
    const { source, folder } = await imported();
    const file = join(folder, 'tables', 'comments.ndjson');
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').slice(1).join('\n'));
    expect(compareImport(source, folder).problems.join(' ')).toMatch(/^comments: /);
  });

  it('names office_seq when the number of the last office signal would not go on from the source', async () => {
    const { source, folder } = await imported();
    const shifted = { ...source, server: { ...source.server, officeSeq: source.server.officeSeq + 1 } };
    expect(compareImport(shifted, folder).problems.join(' ')).toContain('office_seq');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/office/compare.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './compare'".

- [ ] **Step 3: Write the check**

Create `scripts/office/compare.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLES } from '../../server/data/tables';
import type { ExportManifest } from '../backup/officeExport';
import { compareDigests, digestOf, canonical, recordDigest, type TableDigest } from './digest';
import type { OfficeSource } from './source';

/**
 * The count and hash check of each table after an import (spec section 4, step 6): the source against an export of the office
 * object. Records compare by id and doc; the server rows compare by their values, in the forms that both sides give. A
 * difference stops the switch.
 */

type Line = Record<string, unknown>;
const sorted = (lines: Line[]): TableDigest => digestOf(lines.map(canonical).sort());
const bool = (value: unknown): number => (value === true || value === 1 || value === '1' ? 1 : 0);

function readTable(folder: string, table: string): Record<string, unknown>[] {
  return readFileSync(join(folder, 'tables', `${table}.ndjson`), 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function sourceDigests(source: OfficeSource): Record<string, TableDigest> {
  const out: Record<string, TableDigest> = {};
  for (const table of source.tables) out[table.table] = recordDigest(table.rows);
  out.counters = sorted(source.server.counters.map((c) => ({ prefix: c.prefix, n: c.n })));
  out.person_seq = sorted(source.server.personSeq.map((p) => ({ user_id: p.user_id, seq: p.seq })));
  out.office_seq = digestOf([String(source.server.officeSeq)]);
  out.job_runs = sorted(source.server.jobRuns.map((j) => ({ key: j.key, done_at: j.done_at })));
  out.usage_month = sorted(source.server.usageMonth.map((u) => ({ month: u.month, calls: u.calls, bytes_read: u.bytes_read })));
  out.mail_log = sorted(source.server.mailLog.map((m) => ({ utc_day: m.utc_day, ref: m.ref })));
  // The rule of importSigninRows: a link to a person who is not in the office stays out.
  out.auth_users = sorted(source.signin.map((s) => ({
    id: s.id, email: s.email.trim().toLowerCase(), password_hash: s.password_hash, user_id: s.user_id !== null && source.users.has(s.user_id) ? s.user_id : null,
    banned: bool(s.banned), password_set: bool(s.password_set), email_confirmed: bool(s.email_confirmed),
  })));
  return out;
}

export function exportDigests(folder: string, o: { days: readonly string[] }): Record<string, TableDigest> {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as ExportManifest;
  const out: Record<string, TableDigest> = {};
  for (const spec of TABLES) out[spec.table] = recordDigest(readTable(folder, spec.table).map((r) => ({ id: String(r.id), doc: r.doc })));
  out.counters = sorted(readTable(folder, 'counters').map((r) => ({ prefix: r.prefix, n: Number(r.n) })));
  out.person_seq = sorted(readTable(folder, 'person_seq').map((r) => ({ user_id: r.user_id, seq: Number(r.seq) })));
  out.office_seq = digestOf([String(manifest.officeSeq)]);
  out.job_runs = sorted(readTable(folder, 'job_runs').map((r) => ({ key: r.key, done_at: r.done_at })));
  out.usage_month = sorted(readTable(folder, 'usage_month').map((r) => ({ month: r.month, calls: Number(r.calls), bytes_read: Number(r.bytes_read) })));
  out.mail_log = sorted(readTable(folder, 'mail_log').filter((r) => o.days.includes(String(r.utc_day))).map((r) => ({ utc_day: r.utc_day, ref: r.ref })));
  out.auth_users = sorted(readTable(folder, 'auth_users').map((r) => ({
    id: r.id, email: r.email, password_hash: r.password_hash ?? null, user_id: r.user_id ?? null, banned: bool(r.banned), password_set: bool(r.password_set),
    email_confirmed: bool(r.email_confirmed),
  })));
  return out;
}

export function compareImport(source: OfficeSource, folder: string): { problems: string[]; notes: string[] } {
  const days = [...new Set(source.server.mailLog.map((m) => m.utc_day))];
  // usage_month holds the meter of the import itself too (the finish adds its requests): a difference there is a note.
  return compareDigests(sourceDigests(source), exportDigests(folder, { days }), { notes: ['usage_month'] });
}
```

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/office/compare.ts scripts/office/compare.test.ts
git commit -m "Exit wave 4: the count and hash check of each table, the source against an export of the office object"
```

### Task 14: The reverse export, from an office object back to Postgres

**Files:**
- Create: `scripts/office/reverse.ts`, `scripts/office/reverse.test.ts`
- Modify: `server/it/officeImport.it.test.ts` (a second case)
- Test: `scripts/office/reverse.test.ts`, `server/it/officeImport.it.test.ts`

**Interfaces:**
- Consumes: `OfficeSource`, `exportSource`, `pgSource` (Task 11), `sourceDigests` (Task 13), `writeState` (`server/data/whole.ts`),
  `RECORD_DELETES_SQL`, `TRUNCATE_SQL` (`scripts/seed-test-office.ts`), `takeOfficeLock` (`server/core/lock.ts`), `setAuthUserId`
  (`server/data/officeCache.ts`), `collectionOf`, `TABLES` (`server/data/tables.ts`), `emptyState` (`src/api/store.ts`),
  `exportOffice`, `opsOf` (Task 7), `targetOf` (Task 12).
- Produces: `stateOfSource(source, today): State`; `type ReverseReport = { records; linked; needInvite: { userId; email }[] }`;
  `reverseExport(query, source, o: { lockKey: number; today: string }): Promise<ReverseReport>`.

The way back of spec section 4: "after writes, a reverse export takes the records back to Postgres". The people keep their Supabase
password of the day of the switch; a person who joined on the office object has no Supabase sign-in, and the report names each one,
so the Admin sends them an invitation again.

- [ ] **Step 1: Write the failing tests**

Create `scripts/office/reverse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { NODE_TODAY } from '../../server/office/test/nodeOffice';
import { RECORD_DELETES_SQL, TRUNCATE_SQL } from '../seed-test-office';
import { reverseExport, stateOfSource } from './reverse';
import { stateSource } from './source';

describe('the reverse export (scripts/office/reverse.ts)', () => {
  it('makes the State of a source back, with every record and the counters', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const state = stateOfSource(stateSource(seed), NODE_TODAY);
    expect(state.tasks).toEqual(seed.tasks);
    expect(state.settings).toEqual(seed.settings);
    expect(state.counters).toEqual(seed.counters);
  });

  it('writes in one transaction under the office lock: the deletes record, the tables empty, then the office, then the links', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const texts: string[] = [];
    const source = stateSource(seed, { signin: [
      { id: '11111111-1111-4111-8111-111111111111', email: 'a@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' },
      { id: '22222222-2222-4222-8222-222222222222', email: 'new@madar.test', password_hash: 'pbkdf2-sha256$100000$x$y', email_confirmed: true, banned: false, password_set: true, user_id: 'usr_002' },
    ] });
    const report = await reverseExport(async (text, values) => {
      texts.push(text);
      if (text.startsWith('select id::text as id from auth.users')) return [{ id: '11111111-1111-4111-8111-111111111111' }];
      if (text.includes('returning')) return [{ version: 1, office_seq: 1, user_id: 'usr_001', seq: 1 }];
      void values;
      return [];
    }, source, { lockKey: 7_310_001, today: NODE_TODAY });
    expect(texts[0]).toBe('begin');
    expect(texts).toContain(RECORD_DELETES_SQL);
    expect(texts).toContain(TRUNCATE_SQL);
    expect(texts.indexOf(RECORD_DELETES_SQL)).toBeLessThan(texts.indexOf(TRUNCATE_SQL));
    expect(texts.at(-1)).toBe('commit');
    expect(report.needInvite).toEqual([{ userId: 'usr_002', email: 'new@madar.test' }]);
    expect(report.linked).toBe(1);
  });
});
```

In `server/it/officeImport.it.test.ts`, add a second case inside the `describe` (with the imports `exportOffice`, `exportSource`,
`importOffice`, `partsOps`, `reverseExport`, `sourceDigests`, `nodeOffice`, `mkdtempSync`, `tmpdir`, `join`):

```ts
  it('takes an office back from an office object to Postgres with the same records, counters and signal number', async () => {
    const first = await pgSource(async (text, values) => (await client.query(text, values)).rows);
    const t = await nodeOffice({ seed: false });
    await importOffice(partsOps(t.parts), first, { mode: 'empty' });
    const folder = mkdtempSync(join(tmpdir(), 'madar-reverse-it-'));
    await exportOffice(partsOps(t.parts), { copy: 'local', folder });
    const back = `${SCHEMA}_back`;
    await applyMigrations(client, back);
    await client.query(`set search_path to ${back}, public`);
    try {
      await reverseExport(async (text, values) => (await client.query(text, values)).rows, exportSource(folder, { today: TODAY }), { lockKey: 7_310_001, today: TODAY });
      const second = await pgSource(async (text, values) => (await client.query(text, values)).rows);
      const a = sourceDigests(first);
      const b = sourceDigests(second);
      for (const key of [...first.tables.map((x) => x.table), 'counters', 'person_seq', 'office_seq']) expect(b[key], key).toEqual(a[key]);
    } finally {
      await client.query(`set search_path to ${SCHEMA}, public`);
      await dropSchema(client, back);
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server scripts/office/reverse.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './reverse'".

- [ ] **Step 3: Write the reverse export**

Create `scripts/office/reverse.ts`:

```ts
// The reverse export (Supabase exit, wave 4; spec section 4, "The way back"): an export folder of an office object back into the
// Postgres of a copy.
//
//   npx tsx scripts/office/reverse.ts --from-export <folder> --to local
//   npx tsx scripts/office/reverse.ts --from-office <page address> --office rehearsal-YYYYMMDD --to local      (the rehearsal of wave 5)
//   npx tsx scripts/office/reverse.ts --from-office <page address> --to test --yes-replace      (the way back of the test copy; owner OK)
//
// In one transaction under the office lock: it records every office row as deleted (a warm office cache drops it), empties the
// Madar tables (the TRUNCATE of the test seed), writes the records with writeState, sets the office signal number and the person numbers, and
// links each person to the Supabase sign-in of the same id. A person with no Supabase sign-in is in the report: the Admin sends that
// person an invitation again. Then it reads Postgres back and compares each table with the export; a difference exits 1. With
// --from-office it exports the object into a private folder first and removes that folder at the end. Production is refused before wave 6.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { emptyState, type State } from '../../src/api/store';
import { EXPORT_SECRET_HEADER } from '../../server/entries/officeWorker';
import { takeOfficeLock } from '../../server/core/lock';
import type { Query } from '../../server/core/ports';
import { setAuthUserId } from '../../server/data/officeCache';
import { TABLES, collectionOf } from '../../server/data/tables';
import { writeState } from '../../server/data/whole';
import { exportOffice } from '../backup/officeExport';
import { parseSecretsFile, POOLER_HOST, REFS } from '../deploy/secrets';
import { RECORD_DELETES_SQL, TRUNCATE_SQL } from '../seed-test-office';
import { sourceDigests } from './compare';
import { targetOf } from './import';
import { opsOf } from './ops';
import { exportSource, pgSource, type OfficeSource, type PgQuery } from './source';

export type ReverseReport = { records: number; linked: number; needInvite: { userId: string; email: string }[] };

export function stateOfSource(source: OfficeSource, today: string): State {
  const state = { ...emptyState(today), feedback: {} } as State;
  const lists = state as unknown as Record<string, unknown>;
  for (const spec of TABLES) {
    const table = source.tables.find((t) => t.table === spec.table);
    lists[spec.collection] = collectionOf(spec, (table?.rows ?? []).map((row) => row.doc));
  }
  state.counters = Object.fromEntries(source.server.counters.map((c) => [c.prefix, c.n]));
  return state;
}

export const AUTH_IDS_SQL = 'select id::text as id from auth.users where id = any($1::uuid[])';

/** The export secret of a copy: secrets/test.env for the test copy, the environment for the local office. */
function exportSecretOf(copy: string): string {
  const value = copy === 'local' ? process.env.MADAR_EXPORT_SECRET : parseSecretsFile(readFileSync(new URL(`../../secrets/${copy}.env`, import.meta.url), 'utf8')).MADAR_EXPORT_SECRET;
  if (!value) throw new Error(`MADAR_EXPORT_SECRET is not set for ${copy}.`);
  return value;
}

/** madar-test as postgres, through the session pooler, with the Supabase root certificate. */
function testClient(): pg.Client {
  const password = process.env.MADAR_TEST_DB_PASSWORD;
  if (!password) throw new Error('MADAR_TEST_DB_PASSWORD is not set: load ~/dev/madar/.env.local first.');
  const ca = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
  return new pg.Client({ host: POOLER_HOST, port: 5432, user: `postgres.${REFS.test}`, password, database: 'postgres', ssl: { ca, rejectUnauthorized: true, servername: POOLER_HOST } });
}

export async function reverseExport(query: PgQuery, source: OfficeSource, o: { lockKey: number; today: string }): Promise<ReverseReport> {
  const q: Query = (async (text: string, values: unknown[] = []) => query(text, values)) as Query;
  await query('begin');
  let done = false;
  try {
    await query("set local lock_timeout = '5s'");
    await takeOfficeLock(q, o.lockKey);
    await query(RECORD_DELETES_SQL);
    await query(TRUNCATE_SQL);
    await writeState(q, stateOfSource(source, o.today));
    await query('update office_meta set office_seq = $1 where id = 1', [source.server.officeSeq]);
    for (const p of source.server.personSeq) {
      await query('insert into person_seq (user_id, seq) values ($1, $2) on conflict (user_id) do update set seq = excluded.seq', [p.user_id, p.seq]);
    }
    const linked = source.signin.filter((s) => s.user_id !== null);
    const known = new Set((await query(AUTH_IDS_SQL, [linked.map((s) => s.id)])).map((row) => String(row.id)));
    const needInvite: ReverseReport['needInvite'] = [];
    let count = 0;
    for (const s of linked) {
      if (known.has(s.id) && (await setAuthUserId(q, s.user_id!, s.id))) count += 1;
      else needInvite.push({ userId: s.user_id!, email: s.email });
    }
    await query('commit');
    done = true;
    return { records: source.records, linked: count, needInvite };
  } finally {
    if (!done) await query('rollback').catch(() => undefined);
  }
}

async function main(argv: string[]): Promise<void> {
  const value = (flag: string) => (argv.indexOf(flag) === -1 ? '' : (argv[argv.indexOf(flag) + 1] ?? ''));
  const to = value('--to');
  if (to === 'production') throw new Error('A reverse export into production comes only with the switch and its way back (wave 6).');
  if (to !== 'local' && to !== 'test') throw new Error('--to must be local or test.');
  if (to === 'test' && !argv.includes('--yes-replace')) throw new Error('This replaces every record of madar-test. Add --yes-replace after the owner said yes.');
  const today = new Date().toISOString().slice(0, 10);
  // The source: an export folder, or an office object that this run exports into a private folder and removes after (the rehearsal).
  let folder = value('--from-export');
  let made: string | undefined;
  if (!folder) {
    const from = value('--from-office');
    if (!from) throw new Error('--from-export <folder> or --from-office <page address> --office <name> is missing.');
    const target = targetOf(from);
    const office = value('--office') || undefined;
    made = mkdtempSync(join(tmpdir(), `madar-reverse-${process.pid}-`));
    folder = made;
    await exportOffice(opsOf({ base: target.base, secret: exportSecretOf(target.copy), header: EXPORT_SECRET_HEADER, ...(office ? { office } : {}) }), { copy: target.copy, folder });
  }
  const client = to === 'local' ? new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }) : testClient();
  await client.connect();
  try {
    const source = exportSource(folder, { today });
    const report = await reverseExport(async (text, values) => (await client.query(text, values)).rows, source, { lockKey: 7_310_001, today });
    console.log(JSON.stringify(report));
    // The check of the way back: Postgres after the reverse against the export, record by record.
    const back = await pgSource(async (text, values) => (await client.query(text, values)).rows);
    const want = sourceDigests(source);
    const got = sourceDigests(back);
    const keys = [...source.tables.map((t) => t.table), 'counters', 'person_seq', 'office_seq'];
    const problems = keys.filter((key) => want[key]?.sha256 !== got[key]?.sha256 || want[key]?.rows !== got[key]?.rows);
    if (problems.length > 0) throw new Error(`Postgres differs from the office object after the reverse export: ${problems.join(', ')}.`);
    console.log('Postgres holds the same records, counters, signal number and person numbers as the office object.');
  } finally {
    await client.end().catch(() => undefined);
    if (made) rmSync(made, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run them to see them pass**

Run: the command of Step 2. Expected: PASS. Then `npm run typecheck`. Expected: PASS. The it-test runs in the gate (merge lead):
`scripts/dev/docker-lock.sh run exit-ops -- env MADAR_IT=1 npx vitest run --project it server/it/officeImport.it.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add scripts/office/reverse.ts scripts/office/reverse.test.ts server/it/officeImport.it.test.ts
git commit -m "Exit wave 4: the reverse export takes an office object back to Postgres and names the people who need a new invitation"
```

### Task 15: The round trip of the year office on local workerd

**Files:**
- Create: `server/office/roundtrip.wd.test.ts`
- Test: `server/office/roundtrip.wd.test.ts`

**Interfaces:**
- Consumes: `startLive` (with `ops`, Task 5), `yearOffice` (`server/office/test/yearOffice.ts`), `stateSource`, `exportSource`
  (Task 11), `importOffice` (Task 12), `exportOffice` (Task 7), `compareImport` (Task 13), `IMPORT_ROWS_PER_RECORD`
  (`server/office/test/pins.ts`), `opsOf` (Task 7).
- Produces: the gate of A.2 "a round trip on the year office (export, import, export, hash equal)", and the rows pin of the import
  through the real routes.

- [ ] **Step 1: Write the test**

Create `server/office/roundtrip.wd.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportOffice } from '../../scripts/backup/officeExport';
import { compareDigests } from '../../scripts/office/digest';
import { compareImport } from '../../scripts/office/compare';
import { importOffice } from '../../scripts/office/import';
import { opsOf, type OfficeOps } from '../../scripts/office/ops';
import { exportSource, stateSource } from '../../scripts/office/source';
import { startLive } from './test/live/harness';
import { IMPORT_ROWS_PER_RECORD } from './test/pins';
import { yearOffice } from './test/yearOffice';

const TODAY = '2026-10-04';
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

describe('the round trip of the year office through the office ops (A.2 gate of wave 4)', () => {
  let live: Awaited<ReturnType<typeof startLive>>;

  beforeAll(async () => {
    live = await startLive();
  }, 120_000);

  afterAll(async () => {
    await live?.server.close();
  });

  /** The ops of one object of the test Worker, through its routes and secrets (entry.ts). */
  const opsFor = (office: string, kind: 'ops' | 'export'): OfficeOps => opsOf({
    base: 'http://office.test', office,
    header: kind === 'export' ? 'x-madar-export-secret' : 'x-madar-ops-secret', secret: kind === 'export' ? 'test-export-secret' : 'test-ops-secret',
    fetch: ((url: string, init?: RequestInit) => {
      const target = new URL(url);
      return live.worker().fetch(`${target.pathname}${target.search}`, init);
    }) as unknown as typeof fetch,
  });

  it('imports the year office, exports it, imports the export into a second object, exports again: every table is equal', async () => {
    const source = stateSource(await yearOffice(TODAY));
    await importOffice(opsFor('rehearsal-20261001', 'ops'), source, { mode: 'empty', limit: NO_LIMIT });
    const first = mkdtempSync(join(tmpdir(), 'madar-roundtrip-a-'));
    const a = await exportOffice(opsFor('rehearsal-20261001', 'export'), { copy: 'local', folder: first });
    expect(compareImport(source, first).problems).toEqual([]);

    await importOffice(opsFor('rehearsal-20261002', 'ops'), exportSource(first, { today: TODAY }), { mode: 'empty', limit: NO_LIMIT });
    const second = mkdtempSync(join(tmpdir(), 'madar-roundtrip-b-'));
    const b = await exportOffice(opsFor('rehearsal-20261002', 'export'), { copy: 'local', folder: second });
    // The version, the meters and the sign-in rows of the import step differ by design; every record and server row is the same.
    expect(compareDigests(a.tables, b.tables, { skip: ['office_meta', 'usage_day', 'usage_month'] }).problems).toEqual([]);

    // The rows pin of the import through the real routes: at most 7.5 rows written for each record (wave 1 measured 6.90).
    const day = readFileSync(join(first, 'tables', 'usage_day.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { rows_written: number });
    const written = day.reduce((sum, row) => sum + Number(row.rows_written), 0);
    console.info(`round trip: ${source.records} records, ${written} rows written, ${(written / source.records).toFixed(2)} for each record`);
    expect(written / source.records).toBeLessThanOrEqual(IMPORT_ROWS_PER_RECORD);
  }, 1_800_000);
});
```

- [ ] **Step 2: Run it**

Run (sandbox off): `MADAR_OFFICE=1 npx vitest run --project office server/office/roundtrip.wd.test.ts --no-file-parallelism --testTimeout=60000 --silent=false`
Expected: PASS, with the line "round trip: 132221 records, N rows written, X for each record" (X near 6.9). When the test fails, the
message names the table that differs: fix the code of Tasks 10 to 13, never the test. Write the line it printed in the block report.

- [ ] **Step 3: Commit**

```bash
git add server/office/roundtrip.wd.test.ts
git commit -m "Exit wave 4: the round trip of the year office through the office ops on local workerd, with the rows pin of the import"
```

---

# Block D: Seed, test tools, cap, deploy, CI (Tasks 16 to 21, about 1 builder hour)

### Task 16: The test seed into the office object

**Files:**
- Create: `scripts/office/seed.ts`, `scripts/office/seed.test.ts`
- Modify: `server/office/ops.wd.test.ts` (the rows of two seeds)
- Test: `scripts/office/seed.test.ts`, `server/office/ops.wd.test.ts`

**Interfaces:**
- Consumes: `buildSeed`, `PutBlob` (`src/data/seed.ts`), `settleFuture` (`src/data/shift.ts`), `todayISO` (`src/lib/dates.ts`),
  `testOffice`, `withObjectKeys`, `seedAccounts`, `seedR2Port` (`scripts/seed-test-office.ts`), `PNG_PICTURES`
  (`scripts/seed-pictures.ts`), `r2Values` (`scripts/deploy/secrets.ts`), `hashPassword`, `PASSWORD_MIN` (wave 2),
  `DEPLOY_ACCOUNTS` (`tests/e2e-deploy/accounts.ts`), `localPasswords` (`tests/e2e-deploy/local.ts`), `stateSource` (Task 11),
  `importOffice`, `targetOf` (Task 12), `opsOf` (Task 7).
- Produces: `SEED_AUTH_IDS: Record<DeployRole, string>`; `withDueToday(state, n, today): State`;
  `seedSource(o: { now; passwords; dueToday? }): Promise<{ source: OfficeSource; uploads: { key: string; blob: Blob }[] }>`;
  `npx tsx scripts/office/seed.ts --to <page address> [--no-files] [--due-today <n>]`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/office/seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { verifyPassword } from '../../server/auth/own/password';
import { nodeOffice } from '../../server/office/test/nodeOffice';
import { DEPLOY_ACCOUNTS } from '../../tests/e2e-deploy/accounts';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { importOffice } from './import';
import { partsOps } from './ops';
import { SEED_AUTH_IDS, seedSource, withDueToday } from './seed';

const NOW = new Date('2026-10-04T06:00:00Z');

describe('the test seed into the office object (scripts/office/seed.ts)', () => {
  it('gives the test office with the role emails, and one sign-in row for each of the 4 accounts with a PBKDF2 hash', async () => {
    const { source } = await seedSource({ now: NOW, passwords: localPasswords() });
    const users = source.tables.find((t) => t.table === 'users')!;
    expect(users.rows.find((r) => r.id === 'usr_001')!.doc.email).toBe(DEPLOY_ACCOUNTS.admin.email);
    expect(source.signin.map((s) => [s.id, s.email, s.user_id])).toEqual(
      Object.values(DEPLOY_ACCOUNTS).map((a) => [SEED_AUTH_IDS[a.role], a.email, a.userId]),
    );
    const admin = source.signin.find((s) => s.user_id === 'usr_001')!;
    expect(admin.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect((await verifyPassword(localPasswords()[DEPLOY_ACCOUNTS.admin.passwordSecret], admin.password_hash)).ok).toBe(true);
  });

  it('gives each sample file a real object key and its upload', async () => {
    const { source, uploads } = await seedSource({ now: NOW, passwords: localPasswords() });
    const files = source.tables.find((t) => t.table === 'files')!;
    const keys = files.rows.flatMap((r) => ((r.doc.versions as { blobKey?: string }[]) ?? []).map((v) => v.blobKey));
    expect(uploads.length).toBeGreaterThan(0);
    for (const upload of uploads) expect(keys).toContain(upload.key);
  });

  it('refuses a password of less than 8 characters, and names the secret, not the value', async () => {
    const passwords = { ...localPasswords(), [DEPLOY_ACCOUNTS.member.passwordSecret]: 'short' };
    await expect(seedSource({ now: NOW, passwords })).rejects.toThrow(`${DEPLOY_ACCOUNTS.member.passwordSecret} must hold at least 8 characters`);
  });

  it('moves the due day of the first n open tasks with a lead to today, for the push measure of wave 5', async () => {
    type T = { dueDate: string | null; status: string; ownerId: string | null };
    const due = (source: Awaited<ReturnType<typeof seedSource>>['source']) => source.tables.find((t) => t.table === 'tasks')!.rows
      .map((r) => r.doc as T).filter((t) => t.dueDate === '2026-10-04' && t.status !== 'done' && t.ownerId !== null).length;
    const plain = await seedSource({ now: NOW, passwords: localPasswords() });
    const moved = await seedSource({ now: NOW, passwords: localPasswords(), dueToday: 5 });
    expect(due(moved.source)).toBeGreaterThan(due(plain.source));
    expect(due(moved.source)).toBeGreaterThanOrEqual(5);
    const tiny = { tasks: { a: { status: 'in_review', ownerId: 'usr_001', dueDate: null }, b: { status: 'done', ownerId: 'usr_001', dueDate: null } } } as unknown as State;
    expect(Object.values(withDueToday(tiny, 5, '2026-10-04').tasks).map((t) => t.dueDate)).toEqual(['2026-10-04', null]);
  });

  it('replaces the office of a copy with the test tools on, so a person can sign in with the seed password', async () => {
    const t = await nodeOffice({ env: { MADAR_TEST_TOOLS: 'on' } });
    const { source } = await seedSource({ now: NOW, passwords: localPasswords() });
    await importOffice(partsOps(t.parts), source, { mode: 'replace' });
    const answer = await t.parts.route({
      method: 'POST', url: 'https://madar.test/api/auth/token', headers: [['content-type', 'application/json'], ['x-madar-client-address', '203.0.113.7']],
      body: JSON.stringify({ grant_type: 'password', email: DEPLOY_ACCOUNTS.member.email, password: localPasswords()[DEPLOY_ACCOUNTS.member.passwordSecret] }), worker: 1,
    }, t.net);
    expect(answer.status).toBe(200);
  });
});
```

In `server/office/ops.wd.test.ts`, add (import `seedSource` from `../../scripts/office/seed`, `importOffice` from
`../../scripts/office/import`, `opsOf` from `../../scripts/office/ops`, `localPasswords` from `../../tests/e2e-deploy/local`):

```ts
  it('writes about 7.5 rows for each record in a seed, plus one row for each row that the replace deletes', async () => {
    const ops = opsOf({ base: 'http://office.test', header: 'x-madar-ops-secret', secret: 'test-ops-secret', fetch: ((url: string, init?: RequestInit) => {
      const target = new URL(url);
      return live.worker().fetch(`${target.pathname}${target.search}`, init);
    }) as unknown as typeof fetch });
    const { source } = await seedSource({ now: new Date('2026-10-04T06:00:00Z'), passwords: localPasswords() });
    await importOffice(ops, source, { mode: 'replace' });
    const [before] = await live.rows<{ rows_written: number }>('select rows_written from usage_day');
    await importOffice(ops, source, { mode: 'replace' });
    const [after] = await live.rows<{ rows_written: number }>('select rows_written from usage_day');
    const seed = Number(after.rows_written) - Number(before.rows_written);
    console.info(`one seed: ${source.records} records, ${seed} rows written`);
    expect(seed).toBeLessThanOrEqual(Math.ceil(source.records * 7.5) * 2 + 2_000);
  }, 300_000);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server scripts/office/seed.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './seed'".

- [ ] **Step 3: Write the seed**

Create `scripts/office/seed.ts`:

```ts
// The test seed of an office object (Supabase exit, wave 4): the sample office of today and the 4 accounts, as
// scripts/seed-test-office.ts makes them for Postgres, but through the import route in the replace mode.
//
//   npx tsx scripts/office/seed.ts --to <page address> [--no-files] [--due-today <n>]
//
// --to is the local office (http://127.0.0.1:8792, npm run dev:office) or the test copy (https://preview.madar-46r.pages.dev); the
// Worker takes replace only with the test tools on, and never on production. The passwords: the local ones of
// tests/e2e-deploy/local.ts, or MADAR_TEST_PASSWORD_<ROLE> of secrets/test-accounts.env for the test copy. On the test copy the
// sample files go to madar-files-test first (the R2 lines of secrets/test.env), unless --no-files. It never prints a password.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { settleFuture } from '../../src/data/shift';
import { todayISO } from '../../src/lib/dates';
import { hashPassword, PASSWORD_MIN } from '../../server/auth/own/password';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { DEPLOY_ACCOUNTS, type DeployRole } from '../../tests/e2e-deploy/accounts';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { parseSecretsFile, r2Values } from '../deploy/secrets';
import { PNG_PICTURES } from '../seed-pictures';
import { seedAccounts, seedR2Port, testOffice, withObjectKeys } from '../seed-test-office';
import { importOffice, targetOf } from './import';
import { opsOf } from './ops';
import { stateSource, type OfficeSource } from './source';

/** One fixed sign-in id for each account, so the seed of the office object gives the same ids each time. */
export const SEED_AUTH_IDS: Record<DeployRole, string> = {
  admin: '7d0c0000-0000-4000-8000-000000000001',
  management: '7d0c0000-0000-4000-8000-000000000002',
  accounting: '7d0c0000-0000-4000-8000-000000000003',
  member: '7d0c0000-0000-4000-8000-000000000004',
};

/** The first n open tasks with a lead get today as their due day (the reminders of the next Cron run: the push measure of wave 5). */
export function withDueToday(state: State, n: number, today: string): State {
  const office = structuredClone(state);
  const open = Object.values(office.tasks).filter((task) => task.status !== 'done' && task.ownerId !== null).slice(0, n);
  for (const task of open) task.dueDate = today;
  return office;
}

export async function seedSource(o: { now: Date; passwords: Record<string, string | undefined>; dueToday?: number }): Promise<{ source: OfficeSource; uploads: { key: string; blob: Blob }[] }> {
  const blobs = new Map<string, Blob>();
  const base = settleFuture(await buildSeed(todayISO(o.now), async (key, blob) => void blobs.set(key, blob), PNG_PICTURES), o.now);
  const keyed = withObjectKeys(testOffice(base), blobs);
  const office = o.dueToday ? withDueToday(keyed.office, o.dueToday, todayISO(o.now)) : keyed.office;
  const accounts = seedAccounts(office);
  for (const account of accounts) {
    const password = o.passwords[account.passwordSecret];
    if (!password || password.length < PASSWORD_MIN) throw new Error(`${account.passwordSecret} must hold at least ${PASSWORD_MIN} characters. Nothing changed.`);
  }
  // The hashes come before any request: PBKDF2 with 100,000 rounds, the form that the own sign-in checks (wave 2).
  const signin = await Promise.all(accounts.map(async (account) => ({
    id: SEED_AUTH_IDS[account.role], email: account.email, password_hash: await hashPassword(o.passwords[account.passwordSecret]!),
    email_confirmed: true, banned: false, password_set: true, user_id: account.userId,
  })));
  return { source: stateSource(office, { signin }), uploads: keyed.uploads };
}

function fileValues(name: string): Record<string, string> {
  const path = fileURLToPath(new URL(`../../secrets/${name}`, import.meta.url));
  return existsSync(path) ? parseSecretsFile(readFileSync(path, 'utf8')) : {};
}

async function main(argv: string[]): Promise<void> {
  const at = argv.indexOf('--to');
  const target = targetOf(at === -1 ? 'http://127.0.0.1:8792' : (argv[at + 1] ?? ''));
  const due = argv.indexOf('--due-today');
  const dueToday = due === -1 ? undefined : Number(argv[due + 1]);
  const test = target.copy === 'test';
  const passwords = test ? { ...fileValues('test-accounts.env'), ...process.env } : localPasswords();
  const secret = test ? fileValues('test.env').MADAR_OPS_SECRET : process.env.MADAR_OPS_SECRET;
  if (!secret) throw new Error('MADAR_OPS_SECRET is not set for this copy (scripts/office/new-secret.ts, or npm run dev:office).');
  const { source, uploads } = await seedSource({ now: new Date(), passwords, ...(dueToday ? { dueToday } : {}) });
  if (test && !argv.includes('--no-files')) {
    const r2 = r2Values(fileValues('test.env'), 'test');
    if (!r2) throw new Error('secrets/test.env has no R2 lines, so the sample files have no store. Add them, or pass --no-files.');
    const store = seedR2Port(r2);
    for (const upload of uploads) await store.put(upload.key, upload.blob);
    console.log(`Uploaded ${uploads.length} sample files to ${store.where}.`);
  }
  const report = await importOffice(opsOf({ base: target.base, secret, header: OPS_SECRET_HEADER }), source, { mode: 'replace', log: (line) => console.log(line) });
  console.log(`Seeded the office object of ${target.copy}: ${report.records} records in ${report.parts} parts, the 4 accounts of tests/e2e-deploy/accounts.ts.`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run them to see them pass**

Run: the command of Step 2. Expected: PASS. Then (sandbox off)
`MADAR_OFFICE=1 npx vitest run --project office server/office/ops.wd.test.ts --no-file-parallelism --testTimeout=60000 --silent=false`.
Expected: PASS, with the line "one seed: 908 records, N rows written". Write N in the block report: it replaces the estimate of
"about 7,000 for each seed" in decision 6.

- [ ] **Step 5: Commit**

```bash
git add scripts/office/seed.ts scripts/office/seed.test.ts server/office/ops.wd.test.ts
git commit -m "Exit wave 4: the test seed of an office object, with the 4 accounts and their PBKDF2 hashes, through the replace mode"
```

### Task 17: The deploy suite on the office path

**Files:**
- Create: `tests/e2e-deploy/office.ts`
- Modify: `tests/e2e-deploy/targets.ts`, `tests/e2e-deploy/mail.ts`, `tests/e2e-deploy/walk.spec.ts`, `tests/e2e-deploy/agents.spec.ts`,
  `tests/e2e-deploy/steps.ts`, `scripts/e2e-deploy-helpers.test.ts`, `tests/CLAUDE.md`
- Test: `scripts/e2e-deploy-helpers.test.ts` (node; the specs themselves run only in the delegated helper of Task 22 and wave 5)

**Interfaces:**
- Consumes: the `peek` op (Task 4, Task 5), `OPS_SECRET_HEADER` (Task 5).
- Produces: `officeTarget(env): OfficeTarget | null` with `type OfficeTarget = { apiUrl: string; mcpUrl: string; opsSecret: string }`;
  `officePeek<T>(target, text, values): Promise<T[]>`; `OFFICE_SQL: Readonly<Record<string, string>>` (each Postgres text of the walk
  with its SQLite form); `OFFICE_SQL_NOT_NEEDED`; the env names `MADAR_E2E_OFFICE_URL`, `MADAR_E2E_OPS_SECRET`.

- [ ] **Step 1: Write the failing test**

In `scripts/e2e-deploy-helpers.test.ts`, add:

```ts
import { readFileSync } from 'node:fs';
import { OFFICE_SQL, OFFICE_SQL_NOT_NEEDED } from '../tests/e2e-deploy/office';
import { officeTarget } from '../tests/e2e-deploy/targets';

describe('the deploy suite on the office path (exit wave 4)', () => {
  it('takes the local office and the test copy, and refuses production and any other host', () => {
    expect(officeTarget({})).toBeNull();
    expect(officeTarget({ MADAR_E2E_OFFICE_URL: 'http://127.0.0.1:8792', MADAR_E2E_OPS_SECRET: 's' })).toEqual({ apiUrl: 'http://127.0.0.1:8792/api', mcpUrl: 'http://127.0.0.1:8792/mcp', opsSecret: 's' });
    expect(officeTarget({ MADAR_E2E_OFFICE_URL: 'https://preview.madar-46r.pages.dev', MADAR_E2E_OPS_SECRET: 's' })?.apiUrl).toBe('https://preview.madar-46r.pages.dev/api');
    expect(() => officeTarget({ MADAR_E2E_OFFICE_URL: 'https://madar.vado.sa', MADAR_E2E_OPS_SECRET: 's' })).toThrow('local office or the test copy');
    expect(() => officeTarget({ MADAR_E2E_OFFICE_URL: 'http://127.0.0.1:8792' })).toThrow('MADAR_E2E_OPS_SECRET is missing');
  });

  it('has an office form of every SQL text that the walk sends, with no Postgres form in it', () => {
    const walk = readFileSync(new URL('../tests/e2e-deploy/walk.spec.ts', import.meta.url), 'utf8');
    // Every string of the walk that starts with "select ": double-quoted ones may hold single quotes, single-quoted ones hold none.
    const texts = [...walk.matchAll(/"(select [^"]*)"/g), ...walk.matchAll(/'(select [^']*)'/g)].map((m) => m[1]);
    expect(texts.length).toBeGreaterThan(10);
    for (const text of new Set(texts)) {
      if (OFFICE_SQL_NOT_NEEDED.includes(text)) continue;
      expect(OFFICE_SQL[text], text).toBeDefined();
      expect(OFFICE_SQL[text], text).not.toMatch(/::|\$\d|->>|doc->/);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/e2e-deploy-helpers.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module '../tests/e2e-deploy/office'".

- [ ] **Step 3: Write the office forms**

In `tests/e2e-deploy/targets.ts`, add:

```ts
export type OfficeTarget = { apiUrl: string; mcpUrl: string; opsSecret: string };

/**
 * The office path of a run (exit wave 4): MADAR_E2E_OFFICE_URL names the host of the office routes, the local office
 * (npm run dev:office) or the test copy. The specs then read mail_outbox and their checks through the peek route of that host
 * (MADAR_E2E_OPS_SECRET), and the agent flow uses the own OAuth routes under /mcp. Production is refused.
 */
export function officeTarget(env: Env): OfficeTarget | null {
  const url = env.MADAR_E2E_OFFICE_URL;
  if (!url) return null;
  const { hostname, origin } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname) && hostname !== TEST_MCP_HOST) {
    throw new Error(`MADAR_E2E_OFFICE_URL must name the local office or the test copy (${TEST_MCP_HOST}), not ${hostname}.`);
  }
  const opsSecret = env.MADAR_E2E_OPS_SECRET;
  if (!opsSecret) throw new Error('MADAR_E2E_OPS_SECRET is missing: the office path reads its checks through the peek route.');
  const mcpUrl = env.MADAR_E2E_MCP_URL ?? `${origin}/mcp`;
  if (new URL(mcpUrl).origin !== origin) throw new Error('MADAR_E2E_MCP_URL must be on the host of MADAR_E2E_OFFICE_URL.');
  return { apiUrl: `${origin}/api`, mcpUrl, opsSecret };
}
```

Create `tests/e2e-deploy/office.ts`:

```ts
import type { OfficeTarget } from './targets';

/**
 * The checks of the deploy suite on the office path (exit wave 4). The office object holds the data, so a spec reads it through
 * the peek route of the copy: one select, at most 200 rows, with the ops secret (never in a log line). OFFICE_SQL holds the SQLite
 * form of each Postgres text of walk.spec.ts; the helper test fails when the walk gets a text with no form here.
 */

export async function officePeek<T = Record<string, unknown>>(target: OfficeTarget, text: string, values: readonly unknown[]): Promise<T[]> {
  const response = await fetch(`${target.apiUrl}/office/peek`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-madar-ops-secret': target.opsSecret },
    body: JSON.stringify({ text, values: values.map((v) => (v instanceof Date ? v.toISOString() : v)) }),
  });
  if (!response.ok) throw new Error(`The peek route answered ${response.status}.`);
  return (await response.json()) as T[];
}

/** The mail texts of mail.ts on the office path. */
export const OFFICE_MAIL_SQL = {
  last: 'select max(id) as id from mail_outbox',
  next: 'select id, to_email, tag, mail, created_at from mail_outbox where id > ?1 and lower(to_email) = lower(?2) and tag = ?3 order by id limit 1',
} as const;

/** The Postgres texts of the walk that have no office form: Supabase Storage only (the office copies keep their files on R2). */
export const OFFICE_SQL_NOT_NEEDED: readonly string[] = [
  "select count(*)::text as n from storage.objects where bucket_id = 'madar-files' and created_at > now() - interval '3 minutes'",
];

export const OFFICE_SQL: Readonly<Record<string, string>> = {
  "select id, project_id from tasks where doc->>'title' = $1":
    "select id, json_extract(doc, '$.projectId') as project_id from tasks where json_extract(doc, '$.title') = ?1",
  'select last_sign_in_at as at from auth.users where lower(email) = lower($1) and last_sign_in_at >= $2':
    'select max(s.created_at) as at from auth_sessions s join auth_users a on a.id = s.auth_id where a.email = lower(?1) and s.created_at >= ?2 having max(s.created_at) is not null',
  "select doc->'preferences'->>'language' as lang from users where id = $1":
    "select json_extract(doc, '$.preferences.language') as lang from users where id = ?1",
  "select id, leader_id, doc->>'code' as code from projects where doc->>'name' = $1":
    "select id, json_extract(doc, '$.leaderId') as leader_id, json_extract(doc, '$.code') as code from projects where json_extract(doc, '$.name') = ?1",
  "select 1 from tasks where id = $1 and owner_id = $2 and (doc->>'needsReview')::boolean":
    "select 1 as n from tasks where id = ?1 and json_extract(doc, '$.ownerId') = ?2 and json_extract(doc, '$.needsReview') = 1",
  "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'task_assigned'":
    "select id from notifications where user_id = ?1 and target_id = ?2 and json_extract(doc, '$.trigger') = 'task_assigned'",
  "select 1 from tasks where id = $1 and status = 'in_review'":
    "select 1 as n from tasks where id = ?1 and json_extract(doc, '$.status') = 'in_review'",
  "select 1 from tasks where id = $1 and status = 'done'":
    "select 1 as n from tasks where id = ?1 and json_extract(doc, '$.status') = 'done'",
  "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'task_approved'":
    "select id from notifications where user_id = ?1 and target_id = ?2 and json_extract(doc, '$.trigger') = 'task_approved'",
  "select status from tasks where id = $1 and status <> 'in_review'":
    "select json_extract(doc, '$.status') as status from tasks where id = ?1 and json_extract(doc, '$.status') <> 'in_review'",
  'select id from comments where target_id = $1 and doc::text like $2':
    'select id from comments where target_id = ?1 and doc like ?2',
  "select doc->>'trigger' as trig from notifications where user_id = $1 and target_id = $2 order by ord desc limit 1":
    "select json_extract(doc, '$.trigger') as trig from notifications where user_id = ?1 and target_id = ?2 order by rowid desc limit 1",
  "select count(*)::text as n from notifications where user_id = $1 and doc->>'trigger' = 'mention'":
    "select count(*) as n from notifications where user_id = ?1 and json_extract(doc, '$.trigger') = 'mention'",
  "select id, doc->>'body' as body from updates where project_id = $1 and doc::text like $2":
    "select id, json_extract(doc, '$.body') as body from updates where project_id = ?1 and doc like ?2",
  "select count(*)::text as n from notifications where user_id = $1 and doc->>'trigger' = 'mention' having count(*) > $2":
    "select count(*) as n from notifications where user_id = ?1 and json_extract(doc, '$.trigger') = 'mention' having count(*) > ?2",
  'select id, conversation_id from messages where doc::text like $1':
    'select id, conversation_id from messages where doc like ?1',
  "select id, doc->'versions'->0->>'blobKey' as key from files where project_id = $1 and doc::text like $2":
    "select id, json_extract(doc, '$.versions[0].blobKey') as key from files where project_id = ?1 and doc like ?2",
};
```

In `tests/e2e-deploy/mail.ts`, import `officeTarget` from `./targets` and `officePeek, OFFICE_MAIL_SQL` from `./office`, and put an
office branch at the top of `lastMailId` and inside the loop of `waitForMail`:

```ts
export async function lastMailId(): Promise<number> {
  const office = officeTarget(process.env);
  if (office) return Number((await officePeek<{ id: number | null }>(office, OFFICE_MAIL_SQL.last, []))[0]?.id ?? 0);
  return withClient(async (client) => Number((await client.query<{ id: string | null }>('select max(id)::text as id from mail_outbox')).rows[0].id ?? 0));
}
```

```ts
type MailRow = { id: string | number; to_email: string; tag: string; mail: { subject: string; text: string; html: string }; created_at: Date | string };

/** The next mail after o.after: through the peek route on the office path, else from Postgres as before. */
async function nextMail(o: { to: string; tag: string; after: number }): Promise<MailRow | undefined> {
  const office = officeTarget(process.env);
  if (office) return (await officePeek<MailRow>(office, OFFICE_MAIL_SQL.next, [o.after, o.to, o.tag]))[0];
  return withClient(async (client) => (await client.query<MailRow>(
    'select id::text, to_email, tag, mail, created_at from mail_outbox where id > $1 and lower(to_email) = lower($2) and tag = $3 order by id limit 1',
    [o.after, o.to, o.tag],
  )).rows[0]);
}
```

and the loop of `waitForMail` becomes:

```ts
  while (Date.now() < until) {
    const row = await nextMail(o);
    if (row) return { id: Number(row.id), to: row.to_email, tag: row.tag, subject: row.mail.subject, text: row.mail.text, html: row.mail.html, createdAt: new Date(row.created_at).toISOString() };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
```

In `tests/e2e-deploy/walk.spec.ts`, replace the body of `q` with:

```ts
async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const office = officeTarget(process.env);
  if (office) {
    const lite = OFFICE_SQL[sql];
    if (!lite) throw new Error(`This walk text has no office form in tests/e2e-deploy/office.ts: ${sql.slice(0, 80)}`);
    return officePeek<T>(office, lite, params);
  }
  return withClient(async (client) => (await client.query(sql, params)).rows as T[]);
}
```

In `tests/e2e-deploy/agents.spec.ts`, add the endpoints of both forms and use them in `registerClient`, `startFlow`, `exchange`
and the two MCP calls:

```ts
const office = officeTarget(process.env);
/** The OAuth and MCP endpoints of the run: Supabase Auth today, the own routes under /mcp on the office path (exit wave 4). */
const endpoints = () => (office
  ? { register: `${office.mcpUrl}/oauth/register`, authorize: `${office.mcpUrl}/oauth/authorize`, token: `${office.mcpUrl}/oauth/token`, mcp: office.mcpUrl }
  : { register: `${target().supabaseUrl}/auth/v1/oauth/clients/register`, authorize: `${target().supabaseUrl}/auth/v1/oauth/authorize`, token: `${target().supabaseUrl}/auth/v1/oauth/token`, mcp: target().mcpUrl });
```

(`fetch(\`${target().supabaseUrl}/auth/v1/oauth/clients/register\`, ...)` becomes `fetch(endpoints().register, ...)`; the same for
`authorize`, `token`, and `target().mcpUrl` becomes `endpoints().mcp`, also in the `resource` values.) Case 3 gets its office form
before the Supabase form:

```ts
  if (office) {
    // The own server (wave 2): an agent token on the password route gets 403 agent_token, and the seed of the office clears grants.
    const answer = await fetch(`${office.apiUrl}/auth/password`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: `Agent-set-${runId()}-pass`, current: 'not the password' }),
    });
    const body = (await answer.json().catch(() => ({}))) as { error?: { details?: { reason?: string } } };
    expect(answer.status).toBe(403);
    expect(body.error?.details?.reason).toBe('agent_token');
    return;
  }
```

and the skip line of case 3 becomes `test.skip(!DEPLOYED && !office, ...)`.

In `tests/e2e-deploy/steps.ts`, `batchAs`, change the wait to `/\/api\/batch$/.test(new URL(response.url()).pathname)`, so it takes
the api function (`/functions/v1/api/batch`) and the page api (`/api/batch`).

In `tests/CLAUDE.md`, "The deploy suite", add: "On the office path (exit wave 4): set `MADAR_E2E_OFFICE_URL` (the local office
`http://127.0.0.1:8792`, or `https://preview.madar-46r.pages.dev`) and `MADAR_E2E_OPS_SECRET` (the `MADAR_OPS_SECRET` of that copy).
The specs then read `mail_outbox` and the walk's checks through the peek route (`tests/e2e-deploy/office.ts`), and `agents.spec.ts`
uses the own OAuth routes. Seed with `npx tsx scripts/office/seed.ts --to <address>` before and after the run."

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS. Then `npm run typecheck`. Expected: PASS. (The specs run in Task 22 and in wave 5 R7,
in a delegated helper.)

- [ ] **Step 5: Commit**

```bash
git add tests/e2e-deploy/office.ts tests/e2e-deploy/targets.ts tests/e2e-deploy/mail.ts tests/e2e-deploy/walk.spec.ts tests/e2e-deploy/agents.spec.ts \
  tests/e2e-deploy/steps.ts scripts/e2e-deploy-helpers.test.ts tests/CLAUDE.md
git commit -m "Exit wave 4: the deploy suite on the office path: the peek route for its checks, the own OAuth routes for the agents"
```

### Task 18: The day cap of the test Worker (DECISION 6 for the values)

**Files:**
- Create: `server/office/cap.ts`, `server/office/cap.test.ts`
- Modify: `server/office/parts.ts` (the cap in `batch` and `route`), `wrangler.server.toml` (`[env.test.vars]`),
  `scripts/deploy/wranglerServer.test.ts`
- Test: `server/office/cap.test.ts`, `scripts/deploy/wranglerServer.test.ts`

**Interfaces:**
- Consumes: `OfficeParts.dayCounts` (Task 10), `writesIn` (Task 4), `DayRow` (`server/office/parts.ts`).
- Produces: `type DayCap = { rowsRead?: number; rowsWritten?: number; requests?: number }`; `dayCapOf(text): DayCap | null`;
  `capRefusal(day: DayRow, cap: DayCap, writes: boolean): RunError | undefined`; `DAY_CAP_BUSY`; `DAY_CAP_TTL_MS = 60_000`;
  the vars `MADAR_DAY_CAP` and `MADAR_TEST_TOOLS` of `[env.test.vars]`.

DECISION 6: with form A (the same account, recommended) the value is
`rows_written=50000,rows_read=2500000,requests=50000` (50% of each Free day limit, so production keeps half after the switch). With
form B (a second account) the cap only keeps the test copy inside its own day: `rows_written=90000,rows_read=4500000,requests=90000`.

- [ ] **Step 1: Write the failing tests**

Create `server/office/cap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { capRefusal, dayCapOf } from './cap';
import { nodeOffice } from './test/nodeOffice';

const day = (o: Partial<{ rows_read: number; rows_written: number; requests: number }> = {}) => ({ rows_read: 0, rows_written: 0, requests: 0, calls: 0, worker_requests: 0, ...o });

describe('the day cap of the test Worker (server/office/cap.ts)', () => {
  it('reads the cap of the var, and no cap when the var is not set', () => {
    expect(dayCapOf('rows_written=50000,rows_read=2500000,requests=50000')).toEqual({ rowsWritten: 50_000, rowsRead: 2_500_000, requests: 50_000 });
    expect(dayCapOf(undefined)).toBeNull();
    expect(() => dayCapOf('rows_written=many')).toThrow('MADAR_DAY_CAP');
  });

  it('refuses a write over the rows written, and lets a read through', () => {
    const cap = { rowsWritten: 100 };
    expect(capRefusal(day({ rows_written: 100 }), cap, true)?.details).toEqual({ reason: 'busy' });
    expect(capRefusal(day({ rows_written: 100 }), cap, false)).toBeUndefined();
    expect(capRefusal(day({ rows_written: 99 }), cap, true)).toBeUndefined();
  });

  it('refuses every call over the rows read or the requests', () => {
    expect(capRefusal(day({ rows_read: 10 }), { rowsRead: 10 }, false)?.message).toContain('03:00 Riyadh');
    expect(capRefusal(day({ requests: 5 }), { requests: 5 }, false)).toBeDefined();
  });

  it('stops a write batch of the copy at the cap, with the busy words', async () => {
    const t = await nodeOffice({ env: { MADAR_DAY_CAP: 'rows_written=10' } });
    t.raw.exec(`insert into usage_day (day, rows_written) values ('2026-10-04', 10)`);
    const out = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [{ i: 0, name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Capped' } } }], overviewCalls: 0, worker: 0 }, t.net);
    expect(out.ok === false && out.error.details).toEqual({ reason: 'busy' });
  });
});
```

In `scripts/deploy/wranglerServer.test.ts`, add inside the `describe` of wave 3 (it has `read(env)`):

```ts
  it('gives the test Worker the day cap and the test tools, and production and local runs neither (exit wave 4)', () => {
    expect(read('test').vars.MADAR_TEST_TOOLS).toBe('on');
    expect(read('test').vars.MADAR_DAY_CAP).toMatch(/^rows_written=\d+,rows_read=\d+,requests=\d+$/);
    for (const env of [undefined, 'production'] as const) {
      expect(read(env).vars.MADAR_TEST_TOOLS).toBeUndefined();
      expect(read(env).vars.MADAR_DAY_CAP).toBeUndefined();
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server server/office/cap.test.ts scripts/deploy/wranglerServer.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './cap'", and the test vars miss the two names.

- [ ] **Step 3: Write the cap and the vars**

Create `server/office/cap.ts`:

```ts
import { ApiError } from '../../src/api/errors';
import type { RunError } from '../core/types';
import { runErrorOf } from '../http/errors';
import type { DayRow } from './parts';

/**
 * The day cap of the test Worker (Supabase exit, wave 4; spec section 6: "a day cap on the test Worker"). The Free day limits count
 * for the whole Cloudflare account, so the test copy stops at its share and production keeps the rest (owner decision 6). The cap
 * reads the day meters of the office object (wave 3); the count may be up to one minute old (DAY_CAP_TTL_MS).
 */

export type DayCap = { rowsRead?: number; rowsWritten?: number; requests?: number };
export const DAY_CAP_TTL_MS = 60_000;
export const DAY_CAP_BUSY = new ApiError('failed', 'The test copy used its share of the free limits of today. It works again at 03:00 Riyadh.', { reason: 'busy' });

const KEYS: Readonly<Record<string, keyof DayCap>> = { rows_read: 'rowsRead', rows_written: 'rowsWritten', requests: 'requests' };

export function dayCapOf(text: string | undefined): DayCap | null {
  if (!text) return null;
  const cap: DayCap = {};
  for (const part of text.split(',')) {
    const [name, value] = part.split('=').map((s) => s.trim());
    const key = KEYS[name];
    const n = Number(value);
    if (!key || !Number.isSafeInteger(n) || n <= 0) throw new Error('MADAR_DAY_CAP holds name=number pairs: rows_written, rows_read and requests.');
    cap[key] = n;
  }
  return cap;
}

/** Over the rows read or the requests, every call waits; over the rows written, only a write waits. */
export function capRefusal(day: DayRow, cap: DayCap, writes: boolean): RunError | undefined {
  const over = (used: number, limit: number | undefined) => limit !== undefined && used >= limit;
  if (over(day.rows_read, cap.rowsRead) || over(day.requests, cap.requests)) return runErrorOf(DAY_CAP_BUSY);
  if (writes && over(day.rows_written, cap.rowsWritten)) return runErrorOf(DAY_CAP_BUSY);
  return undefined;
}
```

In `server/office/parts.ts`: import `capRefusal, dayCapOf, DAY_CAP_TTL_MS` from `./cap`; after `const tools = ...` add:

```ts
  const cap = dayCapOf(o.read('MADAR_DAY_CAP'));
  let dayHeld: { at: number; day: DayRow } | undefined;
  /** The day counts for the cap, read again at most once a minute and at each new UTC day. */
  async function capDay(now: Date): Promise<DayRow> {
    if (!dayHeld || now.getTime() - dayHeld.at > DAY_CAP_TTL_MS || utcDay(new Date(dayHeld.at)) !== utcDay(now)) dayHeld = { at: now.getTime(), day: await dayCounts(now) };
    return dayHeld.day;
  }
```

In `batch`, after the hold check:

```ts
      if (cap) {
        const capped = capRefusal(await capDay(clock.now()), cap, writesIn(input.calls));
        if (capped) return { ok: false, error: capped };
      }
```

In `route`, after the hold check (an MCP POST is a write, a sign-in step is not):

```ts
      if (cap) {
        const capped = capRefusal(await capDay(clock.now()), cap, path === '/mcp' || path === '/mcp/');
        if (capped) return { status: 503, headers: [['content-type', 'application/json']], body: JSON.stringify({ error: capped }), later: [] };
      }
```

In `wrangler.server.toml`, `[env.test.vars]`, add (DECISION 6, form A):

```toml
# The test tools of the office object (exit wave 4): the replace mode of the import (the seed) and the peek route of the deploy
# suite, both behind MADAR_OPS_SECRET. Never on production: server/office/ops.ts refuses them on a production copy anyway.
MADAR_TEST_TOOLS = "on"
# The day cap of the test copy (owner decision 6, form A: the same account as production): 50% of each Free day limit, so a heavy
# test day cannot stop production. It acts only on the office path (config/server-host.json test: office).
MADAR_DAY_CAP = "rows_written=50000,rows_read=2500000,requests=50000"
```

- [ ] **Step 4: Run them to see them pass**

Run: the command of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/office/cap.ts server/office/cap.test.ts server/office/parts.ts wrangler.server.toml scripts/deploy/wranglerServer.test.ts
git commit -m "Exit wave 4: the day cap of the test Worker at half of each Free day limit, and the test tools on the test Worker only"
```

### Task 19: The wrangler-only deploy of an office copy

**Files:**
- Create: `scripts/office/new-secret.ts`, `scripts/office/new-secret.test.ts`, `scripts/office/auth-key.ts`, `scripts/office/auth-key.test.ts`,
  `scripts/deploy/office-deploy.test.ts`
- Modify: `scripts/deploy/all.sh`, `scripts/deploy/worker.sh`, `scripts/deploy/checks.sh`, `scripts/deploy/secrets.ts`,
  `scripts/deploy/secrets.test.ts`, `scripts/deploy/CLAUDE.md`
- Test: the three new test files, `scripts/deploy/secrets.test.ts`

**Interfaces:**
- Consumes: `serverHost.ts host <copy>` (`scripts/deploy/serverHost.ts`, prints `office` from Task 2), `parseSecretsFile`,
  `WORKER_SECRETS`, `WorkerPort` (`scripts/deploy/secrets.ts`), `runWithStdin`, `ACCOUNT_ID` (`scripts/deploy/cloudflare.ts`),
  `OWN_AUTH_SECRET`, `ownPublicJwks` (wave 2).
- Produces: `OFFICE_WORKER_SECRETS = ['MADAR_EXPORT_SECRET', 'MADAR_OPS_SECRET']` (in `WORKER_SECRETS` too);
  `KEPT_ON_WORKER = ['MADAR_AUTH_PRIVATE_JWK']`; `officeSecretsOf(values): Record<string, string | null>`;
  `runOfficeSecrets(run: OfficeSecretsRun)`; `secrets.ts <env> --office`; `withSecretLine(text, name, value)`; `NEW_SECRET_NAMES`;
  `newAuthKey(): Promise<string>`; the office branches of `all.sh`, `worker.sh` and `checks.sh`.

What follows the word `office` in a deploy: no `db.sh`, no `config.sh`, no `functions.sh` (the Supabase project of the copy stays
as it is: it is the way back); `secrets.ts --office` sends only the Worker secrets (no Supabase token, no database password, no
Hyperdrive); `worker.sh` builds the bundle itself and deploys with `--var MADAR_DATA:office`; `pages.sh` builds the Madar screens
(Task 2); `checks.sh` wants `office;colo=...` and the office health.

- [ ] **Step 1: Write the failing tests**

Create `scripts/deploy/office-deploy.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('the deploy of an office copy (exit wave 4)', () => {
  it('all.sh leaves out the Supabase steps for an office copy, and keeps every step for the other words', () => {
    const all = text('all.sh');
    expect(all).toMatch(/host="\$\(node scripts\/deploy\/serverHost\.ts host "\$TARGET"\)"/);
    const office = all.slice(all.indexOf('if [ "$host" = office ]; then'), all.indexOf('else'));
    expect(office).toContain('"$BIN/tsx" "$DIR/secrets.ts" "$TARGET" --office');
    expect(office).toContain('"$DIR/worker.sh" "$TARGET"');
    for (const step of ['db.sh', 'config.sh', 'functions.sh']) expect(office).not.toContain(step);
    const rest = all.slice(all.indexOf('else'));
    for (const step of ['"$DIR/db.sh" "$TARGET"', '"$DIR/config.sh" "$TARGET"', '"$DIR/functions.sh" "$TARGET"', '"$DIR/worker.sh" "$TARGET" --prebuilt']) expect(rest).toContain(step);
  });

  it('worker.sh deploys an office copy with MADAR_DATA = office, and no other copy with it', () => {
    const worker = text('worker.sh');
    expect(worker).toContain('vars=(--var MADAR_DATA:office)');
    expect(worker).toContain('${vars[@]+"${vars[@]}"}');
  });

  it('checks.sh knows the office header and the office health', () => {
    const checks = text('checks.sh');
    expect(checks).toContain('office:office\\;colo=*) return 0 ;;');
    expect(checks).toContain('*\'"office":{"schema":\'*');
  });
});
```

In `scripts/deploy/secrets.test.ts`, add:

```ts
describe('the Worker secrets of an office copy (exit wave 4)', () => {
  const file = 'APP_URL=https://preview.madar-46r.pages.dev\nMCP_URL=https://preview.madar-46r.pages.dev/mcp\nMAIL_FROM=Madar <madar@vado.sa>\nMAIL_DRIVER=outbox\nJOBS_SECRET=j\nMADAR_OPS_SECRET=o\nMADAR_EXPORT_SECRET=e\n';

  it('sends every Worker secret of the file, the office secrets too, and never MADAR_SECRET_KEY or the sign-in key', () => {
    const out = officeSecretsOf(parseSecretsFile(file));
    expect(out).toMatchObject({ MADAR_OPS_SECRET: 'o', MADAR_EXPORT_SECRET: 'e', JOBS_SECRET: 'j', RESEND_API_KEY: null });
    expect(out).not.toHaveProperty('MADAR_SECRET_KEY');
    expect(out).not.toHaveProperty('MADAR_AUTH_PRIVATE_JWK');
    expect(OFFICE_WORKER_SECRETS.every((name) => WORKER_SECRETS.includes(name))).toBe(true);
  });

  it('refuses a file that holds the sign-in key: scripts/office/auth-key.ts writes it to the Worker', async () => {
    const run = { target: 'test' as const, text: `${file}MADAR_AUTH_PRIVATE_JWK={}\n`, dryRun: true, log: () => undefined, worker: { exists: async () => true, secretBulk: async () => undefined } };
    await expect(runOfficeSecrets(run)).rejects.toThrow('MADAR_AUTH_PRIVATE_JWK must not be in secrets/test.env');
  });

  it('sends the JSON to wrangler secret bulk once, and needs no Supabase token', async () => {
    const sent: string[] = [];
    await runOfficeSecrets({ target: 'test', text: file, dryRun: false, log: () => undefined, worker: { exists: async () => true, secretBulk: async (_t, json) => void sent.push(json) } });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({ MADAR_OPS_SECRET: 'o' });
  });
});
```

Create `scripts/office/new-secret.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NEW_SECRET_NAMES, withSecretLine } from './new-secret';

describe('a new secret line (scripts/office/new-secret.ts)', () => {
  it('adds the line at the end, and refuses a name that is there already', () => {
    expect(withSecretLine('A=1', 'MADAR_OPS_SECRET', 'x')).toBe('A=1\nMADAR_OPS_SECRET=x\n');
    expect(() => withSecretLine('MADAR_OPS_SECRET=y\n', 'MADAR_OPS_SECRET', 'x')).toThrow('is in the file already');
    expect(NEW_SECRET_NAMES).toEqual(['MADAR_OPS_SECRET', 'MADAR_EXPORT_SECRET']);
  });
});
```

Create `scripts/office/auth-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ownPublicJwks } from '../../server/auth/ownKeys';
import { newAuthKey } from './auth-key';

describe('a new sign-in key (scripts/office/auth-key.ts)', () => {
  it('makes a P-256 private JWK with a kid, whose public set has one key with no private part', async () => {
    const jwk = JSON.parse(await newAuthKey()) as { kty: string; crv: string; d?: string; kid?: string };
    expect([jwk.kty, jwk.crv, typeof jwk.d, typeof jwk.kid]).toEqual(['EC', 'P-256', 'string', 'string']);
    const set = ownPublicJwks(JSON.stringify(jwk));
    expect(set.keys).toHaveLength(1);
    expect(set.keys[0]).not.toHaveProperty('d');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server scripts/deploy/office-deploy.test.ts scripts/deploy/secrets.test.ts scripts/office/new-secret.test.ts scripts/office/auth-key.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. The office branches and the new functions do not exist.

- [ ] **Step 3: Write the deploy**

In `scripts/deploy/all.sh`, replace the five step lines from `"$DIR/db.sh" "$TARGET"` to `"$DIR/worker.sh" "$TARGET" --prebuilt` with:

```bash
host="$(node scripts/deploy/serverHost.ts host "$TARGET")"
if [ "$host" = office ]; then
  # An office copy (exit wave 4): wrangler only. The Supabase project of the copy keeps its last state: it is the way back.
  echo "The $TARGET copy runs on its office object: db.sh, config.sh and functions.sh stay out."
  "$BIN/tsx" "$DIR/secrets.ts" "$TARGET" --office
  "$DIR/worker.sh" "$TARGET"
else
  "$DIR/db.sh" "$TARGET"
  "$DIR/config.sh" "$TARGET"
  "$BIN/tsx" "$DIR/secrets.ts" "$TARGET"
  "$DIR/functions.sh" "$TARGET"
  # The Worker of the copy (owner, 2026-10-16) gets the same code as the functions in every run, so the way back always holds it.
  "$DIR/worker.sh" "$TARGET" --prebuilt
fi
```

(`cd "$ROOT"` first when `all.sh` does not run from the root: `node scripts/deploy/serverHost.ts` takes a path from the root.)

In `scripts/deploy/worker.sh`, before the deploy line:

```bash
# An office copy (config/server-host.json, exit wave 4): MADAR_DATA = office turns its office path on. wrangler.server.toml sets
# the var for no env, so the word stays the one switch. Bash 3.2 with set -u needs the guarded form of an empty array.
vars=()
if [ "$(node scripts/deploy/serverHost.ts host "$TARGET")" = office ]; then
  vars=(--var MADAR_DATA:office)
fi
```

and the deploy line becomes `"$BIN/wrangler" deploy -c wrangler.server.toml --env "$TARGET" ${vars[@]+"${vars[@]}"}`.

In `scripts/deploy/checks.sh`, `names_host`, add the line `office:office\;colo=*) return 0 ;;`, and replace the database check
`case` with:

```bash
  case "$host:$checked" in
    office:*'"office":{"schema":'*) echo "Office check: the office object answers with its schema and its last job." ;;
    *'"database":"ok"'*'"lock":"ok"'*'"asyncContext":"ok"'*) echo "Database check: database, lock and asyncContext ok." ;;
    *)
      echo "Stopped: the health check with the jobs secret did not give the checks of the host $host on $page." >&2
      exit 1
      ;;
  esac
```

In `scripts/deploy/secrets.ts`, add after `WORKER_SECRETS` (and append `...OFFICE_WORKER_SECRETS` to the `WORKER_SECRETS` list):

```ts
/** The secrets of an office copy (exit wave 4): the export route (GitHub) and the ops routes (the Mac). */
export const OFFICE_WORKER_SECRETS = ['MADAR_EXPORT_SECRET', 'MADAR_OPS_SECRET'] as const;
/** Never sent by this script: scripts/office/auth-key.ts writes the sign-in key straight to the Worker (wave 2, Merge notes 14). */
export const KEPT_ON_WORKER = ['MADAR_AUTH_PRIVATE_JWK'] as const;

/**
 * The bulk JSON of an office copy: every Worker secret of the file, or null to remove it. MADAR_SECRET_KEY stays out: the Worker
 * keeps the key that the earlier runs gave it, so an office deploy needs no Supabase token.
 */
export function officeSecretsOf(values: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of WORKER_SECRETS) if (name !== 'MADAR_SECRET_KEY') out[name] = values[name] ?? null;
  return out;
}

export type OfficeSecretsRun = {
  target: Target; text: string; dryRun: boolean; log: (line: string) => void;
  worker: Pick<WorkerPort, 'exists' | 'secretBulk'>;
};

export async function runOfficeSecrets(run: OfficeSecretsRun): Promise<void> {
  const values = parseSecretsFile(run.text);
  for (const name of KEPT_ON_WORKER) {
    if (values[name] !== undefined) throw new Error(`${name} must not be in secrets/${run.target}.env: scripts/office/auth-key.ts writes it to the Worker.`);
  }
  if (!values.MCP_URL) throw new Error(`MCP_URL is missing in secrets/${run.target}.env: the own OAuth issuer comes from it.`);
  const secrets = officeSecretsOf(values);
  const set = Object.keys(secrets).filter((name) => secrets[name] !== null);
  const removed = Object.keys(secrets).filter((name) => secrets[name] === null);
  if (run.dryRun) {
    run.log(`Dry run of the office copy ${run.target}. Worker secrets: ${set.join(', ')}. Removed: ${removed.join(', ') || 'none'}. Kept: MADAR_SECRET_KEY, ${KEPT_ON_WORKER.join(', ')}.`);
    return;
  }
  const name = `madar-server-${run.target}`;
  if (!(await run.worker.exists(name))) {
    run.log(`Skip: ${name} does not exist yet. Run scripts/deploy/worker.sh ${run.target} first.`);
    return;
  }
  await run.worker.secretBulk(run.target, JSON.stringify(secrets));
  run.log(`Worker secrets of ${name}: ${set.join(', ')}. Kept as they are: MADAR_SECRET_KEY, ${KEPT_ON_WORKER.join(', ')}.`);
  if (removed.length > 0) run.log(`Removed from the Worker (not in the file): ${removed.join(', ')}.`);
}
```

and in the command line of `secrets.ts`, before `runSecrets({...})`: when `args.includes('--office')`, call `runOfficeSecrets` with
the same `worker.exists` and `worker.secretBulk` and return (no `pg`, no Supabase token, no database password).

Create `scripts/office/new-secret.ts`:

```ts
// A new secret of an office copy (exit wave 4), typed by nobody and printed nowhere:
//
//   npx tsx scripts/office/new-secret.ts test MADAR_OPS_SECRET
//   npx tsx scripts/office/new-secret.ts test MADAR_EXPORT_SECRET --github OFFICE_EXPORT_SECRET
//
// It makes 32 random bytes (base64url), adds the line NAME=<value> to secrets/<env>.env (mode 600), and with --github sends the same
// value to that GitHub secret of byosamah/madar on the stdin of gh. Then scripts/deploy/secrets.ts <env> gives it to the Worker.
// The owner runs it in his Terminal (a GitHub write needs his OK). Production comes with the switch (wave 6).
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NEW_SECRET_NAMES = ['MADAR_OPS_SECRET', 'MADAR_EXPORT_SECRET'] as const;
const GITHUB_NAMES: Readonly<Record<string, string>> = { MADAR_EXPORT_SECRET: 'OFFICE_EXPORT_SECRET' };

export function withSecretLine(text: string, name: string, value: string): string {
  if (new RegExp(`^${name}=`, 'm').test(text)) throw new Error(`${name} is in the file already: remove its line first to make a new one.`);
  return `${text.replace(/\n*$/, text === '' ? '' : '\n')}${name}=${value}\n`;
}

function main(argv: string[]): void {
  const [target, name] = argv;
  if (target !== 'test') throw new Error('Only the test copy takes a new office secret now; production comes with the switch (wave 6).');
  if (!(NEW_SECRET_NAMES as readonly string[]).includes(name)) throw new Error(`The name must be one of ${NEW_SECRET_NAMES.join(', ')}.`);
  const at = argv.indexOf('--github');
  const github = at === -1 ? undefined : argv[at + 1];
  if (github !== undefined && GITHUB_NAMES[name] !== github) throw new Error(`${name} goes only to the GitHub secret ${GITHUB_NAMES[name] ?? '(none)'}.`);
  const file = fileURLToPath(new URL(`../../secrets/${target}.env`, import.meta.url));
  if (!existsSync(file)) throw new Error(`secrets/${target}.env is missing.`);
  const value = randomBytes(32).toString('base64url');
  writeFileSync(file, withSecretLine(readFileSync(file, 'utf8'), name, value), { mode: 0o600 });
  console.log(`Wrote ${name} to secrets/${target}.env.`);
  if (github) {
    const set = spawnSync('gh', ['secret', 'set', github, '-R', 'byosamah/madar'], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
    if (set.status !== 0) throw new Error(`gh secret set ${github} failed. ${name} is in secrets/${target}.env already: remove that line, then run this script again.`);
    console.log(`Set the GitHub secret ${github}.`);
  }
  console.log(`Next: npx tsx scripts/deploy/secrets.ts ${target} (it gives ${name} to the Worker).`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
```

Create `scripts/office/auth-key.ts`:

```ts
// A new sign-in key of an office copy (exit wave 4; wave 2, Merge notes 14), straight to the Worker secret MADAR_AUTH_PRIVATE_JWK
// on the stdin of wrangler: no file, no log line. A new key signs every person and agent of that copy out once.
//
//   npx tsx scripts/office/auth-key.ts test        (sandbox off: wrangler talks to Cloudflare)
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import { OWN_AUTH_SECRET } from '../../server/auth/ownKeys';
import { ACCOUNT_ID, runWithStdin } from '../deploy/cloudflare';

export async function newAuthKey(): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  return JSON.stringify({ ...jwk, kid: await calculateJwkThumbprint(jwk) });
}

async function main(argv: string[]): Promise<void> {
  const target = argv[0];
  if (target !== 'test') throw new Error('Only the test copy takes a new sign-in key now; production comes with the switch (wave 6).');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const jwk = await newAuthKey();
  const { code, output } = await runWithStdin(`${root}node_modules/.bin/wrangler`, ['secret', 'put', OWN_AUTH_SECRET, '-c', 'wrangler.server.toml', '--env', target], jwk, {
    cwd: root, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? ACCOUNT_ID },
  });
  if (code !== 0) throw new Error(`wrangler secret put ${OWN_AUTH_SECRET} failed (exit ${code}): ${output.split(jwk).join('***').trim().split('\n').slice(-4).join(' | ')}`);
  console.log(`The Worker madar-server-${target} has a new ${OWN_AUTH_SECRET} (kid ${(JSON.parse(jwk) as { kid: string }).kid}).`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

In `scripts/deploy/CLAUDE.md`, "The server host", add after the first paragraph:

```markdown
- The word `office` (exit wave 4; the test copy only until wave 6): the copy runs on its office object. `all.sh` then runs
  `secrets.ts --office` (the Worker secrets only: no Supabase token, no database password, no Hyperdrive; `MADAR_SECRET_KEY` and
  `MADAR_AUTH_PRIVATE_JWK` stay as the Worker has them), `worker.sh` (it builds the bundle and deploys with `--var MADAR_DATA:office`),
  `pages.sh` (the screens with `VITE_MADAR_AUTH=madar` and `VITE_MADAR_LIVE=socket`) and `checks.sh` (`office;colo=...` and the office
  health). `db.sh`, `config.sh` and `functions.sh` stay out: the Supabase project keeps its last state as the way back.
- The office ops (`/api/office/export|import|peek|drop`) reach the Worker of a copy through the Pages binding whatever the word says,
  and need `MADAR_EXPORT_SECRET` or `MADAR_OPS_SECRET`. `npx tsx scripts/office/new-secret.ts test <NAME>` makes each one (the owner
  runs it), `npx tsx scripts/office/auth-key.ts test` makes the sign-in key. The first switch of the test copy: wave 5, Part 2 of
  `docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md`.
```

- [ ] **Step 4: Run them to see them pass**

Run: the command of Step 2. Expected: PASS. Then `bash -n scripts/deploy/all.sh scripts/deploy/worker.sh scripts/deploy/checks.sh`
(expected: no output) and `npm run typecheck` (expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/all.sh scripts/deploy/worker.sh scripts/deploy/checks.sh scripts/deploy/secrets.ts scripts/deploy/secrets.test.ts \
  scripts/deploy/office-deploy.test.ts scripts/deploy/CLAUDE.md scripts/office/new-secret.ts scripts/office/new-secret.test.ts \
  scripts/office/auth-key.ts scripts/office/auth-key.test.ts
git commit -m "Exit wave 4: the wrangler-only deploy of an office copy, and the scripts that make its secrets with no person who sees them"
```

### Task 20: CI jobs with no Docker

**Files:**
- Modify: `.github/workflows/ci.yml` (the job `lite`), `.github/workflows/ci-stack.yml` (the job `office`), `scripts/ci/ci-workflow.test.ts`,
  `.github/CLAUDE.md`
- Test: `scripts/ci/ci-workflow.test.ts`

**Interfaces:**
- Consumes: `npm run test:lite`, `npm run test:office`, `npm run smoke:office`, `npm run build:server` (package.json).
- Produces: the jobs `lite` (every push, about 3 minutes) and `office` (pull requests, main and by hand: the year office runs make it
  the heaviest job, so it stays off the push of each branch).

- [ ] **Step 1: Write the failing test**

In `scripts/ci/ci-workflow.test.ts`, change `JOB_FILE` to
`{ unit: 'ci.yml', server: 'ci.yml', lite: 'ci.yml', db: 'ci-stack.yml', integration: 'ci-stack.yml', office: 'ci-stack.yml' }`, and add:

```ts
  it('runs test:lite in the lite job and test:office with the bundle smoke in the office job, with no Docker (exit wave 4)', () => {
    const lite = job('lite');
    expect(lite).toContain('npm run test:lite');
    const office = job('office');
    expect(at(office, 'run: npm run build:server')).toBeLessThan(at(office, 'run: npm run test:office'));
    expect(office).toContain('run: npm run smoke:office');
    for (const body of [lite, office]) {
      expect(body).not.toMatch(/supabase start|docker/i);
      expect(body).toMatch(/^ {4}timeout-minutes: \d+$/m);
    }
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/ci/ci-workflow.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. The jobs `lite` and `office` do not exist (the four-job test fails on them too).

- [ ] **Step 3: Write the jobs**

In `.github/workflows/ci.yml`, add after the job `server`:

```yaml
  # The rule tests and the shadow run on node:sqlite (Supabase exit, wave 1): the SQLite path of the office object, with no Docker.
  lite:
    name: lite
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - name: Rule tests and the shadow run on node:sqlite
        run: npm run test:lite
```

In `.github/workflows/ci-stack.yml`, add after the job `integration` (its `env` has `NODE_VERSION` too):

```yaml
  # The office object on local workerd (Supabase exit, waves 1 to 4): host parity, the rows pins, the live and Cron suites, the
  # office ops and the year office round trip, then the real bundle on wrangler dev. No Docker; wrangler starts workerd itself.
  office:
    name: office
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - name: Server bundles
        run: npm run build:server
      - name: The office object on local workerd
        run: npm run test:office
      - name: The real Workers bundle on local wrangler dev
        run: npm run smoke:office
```

Change the top comments of both files ("db and integration, which need the local Supabase stack" becomes "db and integration, which
need the local Supabase stack, and office, which needs none but takes long"). In `.github/CLAUDE.md`, change the two lines of
`ci.yml` and `ci-stack.yml`: `ci.yml` adds `lite` (`test:lite` on node:sqlite), `ci-stack.yml` adds `office` (`test:office` and
`smoke:office`, no Docker).

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/ci-stack.yml scripts/ci/ci-workflow.test.ts .github/CLAUDE.md
git commit -m "Exit wave 4: CI runs test:lite on each push and test:office with the bundle smoke on pull requests and main, with no Docker"
```

### Task 21: The probes of wave 5

**Files:**
- Create: `scripts/proof/do-tx/guard.js`, `scripts/proof/do-tx/guard.test.ts`, `scripts/proof/do-tx/wrangler.deployed.toml`,
  `scripts/proof/do-tx/deployed.mjs`, `scripts/proof/office-day/day.graphql`, `scripts/proof/office-day/bill.mjs`,
  `scripts/proof/office-day/socket.mjs`
- Modify: `scripts/proof/do-tx/index.js` (the guard at the top of `fetch`)
- Test: `scripts/proof/do-tx/guard.test.ts`

**Interfaces:**
- Produces: `allowed(request, env): boolean` (`guard.js`); the throwaway Worker `madar-do-tx-probe` (wave 5 R8 (e) deploys it with
  `workers_dev = true` and a `PROBE_SECRET`, then deletes it with the owner's OK); the GraphQL query of the account day; the bill and
  socket probes of wave 5 R8 (a) and (d). No build runs them (root `CLAUDE.md`, "Where the truth lives").

- [ ] **Step 1: Write the failing test**

Create `scripts/proof/do-tx/guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allowed } from './guard.js';

describe('the secret guard of the deployed do-tx probe', () => {
  it('lets a request through only with the probe secret, and never with no secret on the Worker', () => {
    const request = (secret?: string) => new Request('https://p.test/race?o=m1', secret ? { headers: { 'x-probe-secret': secret } } : {});
    expect(allowed(request('s3cret'), { PROBE_SECRET: 's3cret' })).toBe(true);
    expect(allowed(request('no'), { PROBE_SECRET: 's3cret' })).toBe(false);
    expect(allowed(request(), { PROBE_SECRET: 's3cret' })).toBe(false);
    expect(allowed(request(''), {})).toBe(false);
  });

  it('lets the local harness through, which sets no secret and calls no deployed address', () => {
    expect(allowed(new Request('http://localhost/race?o=m1'), {})).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/proof/do-tx/guard.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './guard.js'".

- [ ] **Step 3: Write the probes**

Create `scripts/proof/do-tx/guard.js`:

```js
// The guard of the do-tx probe (exit wave 5, R8 (e)): a deployed probe answers only with the header x-probe-secret = PROBE_SECRET.
// The local harness (run.mjs) calls http://localhost and sets no secret, so it passes as before.
export function allowed(request, env) {
  const url = new URL(request.url);
  if (!env.PROBE_SECRET) return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return request.headers.get('x-probe-secret') === env.PROBE_SECRET;
}
```

In `scripts/proof/do-tx/index.js`, import it (`import { allowed } from './guard.js';`) and add as the first line of the Worker's
`fetch`: `if (!allowed(request, env)) return new Response('not found', { status: 404 });`.

Create `scripts/proof/do-tx/wrangler.deployed.toml`:

```toml
# The do-tx probe on the deployed Workers Free (exit wave 5, R8 (e)): the race of wave 1 Task 1 on a real Durable Object. It has a
# workers.dev address only for the minutes of the run, behind PROBE_SECRET; the main session deletes it after the run with the
# owner's OK (npx wrangler delete -c scripts/proof/do-tx/wrangler.deployed.toml).
name = "madar-do-tx-probe"
main = "index.js"
compatibility_date = "2026-09-01"
workers_dev = true
preview_urls = false

[[durable_objects.bindings]]
name = "OFFICE"
class_name = "Office"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Office"]
```

Create `scripts/proof/do-tx/deployed.mjs`:

```js
// The race of wave 1 Task 1 on the deployed probe (exit wave 5, R8 (e)): PROBE_URL=https://madar-do-tx-probe.vado-sa.workers.dev
// PROBE_SECRET=<the value of the run> node scripts/proof/do-tx/deployed.mjs. It prints every answer, as run.mjs does locally.
const base = process.env.PROBE_URL;
const secret = process.env.PROBE_SECRET;
if (!base || !secret) {
  console.error('PROBE_URL and PROBE_SECRET are missing.');
  process.exit(2);
}
const get = async (path) => (await fetch(`${base}${path}`, { headers: { 'x-probe-secret': secret } })).json();
console.log(JSON.stringify({
  rollback: await get('/rollback?o=r1'),
  microtask: await get('/race?o=m1&kind=micro'),
  timer: await get('/race?o=t1&kind=timer'),
  timerFail: await get('/race?o=t2&kind=timer&fail=1'),
  features: await get('/features?o=f1'),
}, null, 1));
```

Create `scripts/proof/office-day/day.graphql` (the account-wide sums of one UTC day for one Worker and its objects; send it with
`node scripts/proof/do-socket/gql.mjs scripts/proof/office-day/day.graphql '{"acc":"d76d34779c63849f5acdf3d6af3751cd","from":"<day>T00:00:00Z","to":"<day>T23:59:59Z","script":"madar-server-test"}'`):

```graphql
query ($acc: String!, $from: Time!, $to: Time!, $script: String!) { viewer { accounts(filter: { accountTag: $acc }) {
  per: durableObjectsPeriodicGroups(limit: 100, filter: { datetime_geq: $from, datetime_leq: $to }) {
    dimensions { namespaceId } sum { rowsRead rowsWritten cpuTime duration activeTime } }
  inv: durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: { datetime_geq: $from, datetime_leq: $to }) {
    dimensions { namespaceId scriptName type status } sum { requests errors } quantiles { cpuTimeP50 cpuTimeP99 } }
  w: workersInvocationsAdaptive(limit: 100, filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }) {
    dimensions { status } sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP90 cpuTimeP99 } }
  all: workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $from, datetime_leq: $to }) {
    dimensions { scriptName } sum { requests } }
} } }
```

Create `scripts/proof/office-day/bill.mjs`:

```js
// The bill of a batch with mail on the office path (exit wave 5, R8 (a); wave 3 design choice 1). It signs in as the member with
// the own sign-in, sends N batches of comments.create (each one a notice and its mail), and prints the minute window for the
// GraphQL query of day.graphql. Run: set -a; . secrets/test-accounts.env; set +a; node scripts/proof/office-day/bill.mjs
// https://preview.madar-46r.pages.dev 20 tsk_001. It never prints the password or a token.
const [base, count = '20', task = 'tsk_001'] = process.argv.slice(2);
const password = process.env.MADAR_TEST_PASSWORD_MEMBER;
if (!base || !password) {
  console.error('Use: node bill.mjs <page address> [count] [task id], with MADAR_TEST_PASSWORD_MEMBER in the environment.');
  process.exit(2);
}
const signin = await fetch(`${base}/api/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'password', email: 'member@madar.test', password }) });
if (!signin.ok) throw new Error(`The sign-in answered ${signin.status}.`);
const { access_token: token } = await signin.json();
const from = new Date();
for (let i = 0; i < Number(count); i += 1) {
  const answer = await fetch(`${base}/api/batch`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-madar-build': '9999.1.1' },
    body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'comments.create', input: { targetType: 'task', targetId: task, body: `Bill probe ${i + 1} of ${count}` } }] }),
  });
  if (!answer.ok) throw new Error(`Batch ${i + 1} answered ${answer.status}.`);
}
const to = new Date(Date.now() + 60_000);
console.log(JSON.stringify({ batches: Number(count), from: from.toISOString(), to: to.toISOString() }));
```

Create `scripts/proof/office-day/socket.mjs`:

```js
// A live socket through the Pages forwarder and the service binding (exit wave 5, R8 (d)): sign in, ask live.ticket, open
// wss://<page host>/api/live?ticket=..., send ping, wait for pong. Node 22 has WebSocket. It prints the steps, never a token.
const [base] = process.argv.slice(2);
const password = process.env.MADAR_TEST_PASSWORD_MEMBER;
if (!base || !password) {
  console.error('Use: node socket.mjs <page address>, with MADAR_TEST_PASSWORD_MEMBER in the environment.');
  process.exit(2);
}
const signin = await fetch(`${base}/api/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'password', email: 'member@madar.test', password }) });
const { access_token: token } = await signin.json();
const batch = await fetch(`${base}/api/batch`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-madar-build': '9999.1.1' }, body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'live.ticket', input: {} }] }) });
const ticket = (await batch.json()).results?.[0]?.value?.ticket;
if (!ticket) throw new Error(`No live ticket: the batch answered ${batch.status}.`);
const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/live?ticket=${ticket}`);
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('no pong in 10 s'), 10_000);
  ws.addEventListener('open', () => ws.send('ping'));
  ws.addEventListener('message', (event) => {
    if (event.data === 'pong') {
      clearTimeout(timer);
      resolve('pong');
    }
  });
  ws.addEventListener('error', () => resolve('the socket failed to open'));
});
ws.close();
console.log(JSON.stringify({ socket: result }));
process.exit(result === 'pong' ? 0 : 1);
```

(`x-madar-build: 9999.1.1` passes any `MIN_CLIENT_BUILD`; the batch answer shape is `results[i].value`, as `steps.ts` reads it.)

- [ ] **Step 4: Run it to see it pass**

Run: the command of Step 2. Expected: PASS. Then the local race still runs (sandbox off): `node scripts/proof/do-tx/run.mjs`.
Expected: the same answers as proof.md "Wave 1: the transaction facts" (rollback rows `[]`, the race logs `["A:start","A:end","B"]`).

- [ ] **Step 5: Commit**

```bash
git add scripts/proof/do-tx/guard.js scripts/proof/do-tx/guard.test.ts scripts/proof/do-tx/index.js scripts/proof/do-tx/wrangler.deployed.toml \
  scripts/proof/do-tx/deployed.mjs scripts/proof/office-day/day.graphql scripts/proof/office-day/bill.mjs scripts/proof/office-day/socket.mjs
git commit -m "Exit wave 4: the probes of wave 5: the deployed race with a secret guard, the day query, the bill and the socket checks"
```

---

# Block E: The local run and the gate (Tasks 22 and 23, about 0.5 builder hours, then the gate)

### Task 22: The local office stack, and the first end-to-end run of the own sign-in

**Files:**
- Create: `scripts/dev/office-local.ts`, `scripts/dev/office-local.test.ts`, `server/office/test/live/wrangler.local.toml`
- Modify: `package.json` (`"dev:office": "node --import tsx scripts/dev/office-local.ts"`), root `CLAUDE.md` (Commands)
- Test: `scripts/dev/office-local.test.ts`

**Interfaces:**
- Consumes: the real bundle `dist-server/worker.js` (`npm run build:server`), `newAuthKey` (Task 19), `seedSource` (Task 16),
  `importOffice` (Task 12), `opsOf` (Task 7), `OPS_SECRET_HEADER` (Task 5), `buildId` (`scripts/build-remote.ts`), `localPasswords`
  (`tests/e2e-deploy/local.ts`).
- Produces: `npm run dev:office`; `LOCAL_OFFICE = 'http://127.0.0.1:8792'`, `LOCAL_SCREENS = 'http://127.0.0.1:4174'`,
  `LOCAL_OUT = 'test-results/office-local'`; `workerEnvLines(o)`, `screensEnv(build)`, `playwrightLines(o)`; the file
  `test-results/office-local/run.env` (mode 600) that the delegated helper loads.

This is the run that item 13 of the wave 2 Merge notes and item 14 of the wave 3 Merge notes asked for: the sign-in specs of the
deploy suite on a local `wrangler dev` with a remote build of `VITE_MADAR_AUTH=madar`, after the seed. The builder writes and checks
the stack; **the builder does not run Playwright**. Step 6 is the step of the main session's delegated helper.

- [ ] **Step 1: Write the failing test**

Create `scripts/dev/office-local.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { LOCAL_OFFICE, LOCAL_SCREENS, playwrightLines, screensEnv, workerEnvLines } from './office-local';

describe('the local office stack (scripts/dev/office-local.ts)', () => {
  const secrets = { opsSecret: 'local-ops', exportSecret: 'local-export', jobsSecret: 'local-jobs', authKey: '{"kty":"EC","kid":"k1"}' };

  it('gives wrangler dev the made-up secrets of one run, the sign-in key among them, and no real key', () => {
    const lines = workerEnvLines(secrets);
    expect(lines).toContain('MADAR_OPS_SECRET=local-ops');
    expect(lines).toContain('MADAR_AUTH_PRIVATE_JWK={"kty":"EC","kid":"k1"}');
    expect(lines.join('\n')).not.toMatch(/madar\.vado\.sa|oprkvdjudjxxhvodkzgs|qdgwpnesxppnqsaabqzd/);
  });

  it('builds the Madar screens with the live socket against the local office', () => {
    expect(screensEnv('2026.10.17')).toMatchObject({ VITE_MADAR_API: 'remote', VITE_MADAR_AUTH: 'madar', VITE_MADAR_LIVE: 'socket', VITE_API_URL: `${LOCAL_OFFICE}/api`, VITE_MADAR_BUILD: '2026.10.17' });
  });

  it('writes the run lines of the helper: the screens, the office, the agents flag and the 4 local passwords', () => {
    const lines = playwrightLines({ opsSecret: 'local-ops' });
    for (const line of [`MADAR_DEPLOY_URL=${LOCAL_SCREENS}`, `MADAR_E2E_APP_URL=${LOCAL_SCREENS}`, `MADAR_E2E_OFFICE_URL=${LOCAL_OFFICE}`, `MADAR_E2E_MCP_URL=${LOCAL_OFFICE}/mcp`, 'MADAR_E2E_OPS_SECRET=local-ops', 'MADAR_E2E_AFTER_G=1']) {
      expect(lines).toContain(line);
    }
    for (const [name, value] of Object.entries(localPasswords())) expect(lines).toContain(`${name}=${value}`);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server scripts/dev/office-local.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Cannot find module './office-local'".

- [ ] **Step 3: Write the config and the stack**

Create `server/office/test/live/wrangler.local.toml`:

```toml
# The real Workers bundle on the office path with the own sign-in, for npm run dev:office (Supabase exit, wave 4): the first
# end-to-end run of the own sign-in and the deploy suite on the office path, on the Mac. Local wrangler dev only: it never deploys.
# scripts/dev/office-local.ts passes the values that look like keys in an env file that it makes for each run and removes after it.
name = "madar-office-local"
main = "../../../../dist-server/worker.js"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

[vars]
MADAR_DATA = "office"
APP_URL = "http://127.0.0.1:4174"
ALLOWED_ORIGINS = "http://127.0.0.1:4174"
API_URL = "http://127.0.0.1:8792/api"
MCP_URL = "http://127.0.0.1:8792/mcp"
MAIL_FROM = "Madar <notices@madar.test>"
MAIL_DRIVER = "outbox"
SUPABASE_URL = "http://127.0.0.1:54321"
MADAR_FILE_STORE = "r2"
R2_BUCKET = "madar-files-test"
WORKER_REGION = "workers-local"
MADAR_TEST_TOOLS = "on"

[[durable_objects.bindings]]
name = "OFFICE"
class_name = "Office"

[[migrations]]
tag = "office-v1"
new_sqlite_classes = ["Office"]

[triggers]
crons = ["*/15 * * * *"]
```

Create `scripts/dev/office-local.ts`:

```ts
/**
 * npm run dev:office (Supabase exit, wave 4): the local office stack. The real Workers bundle on wrangler dev with the office path
 * and the own sign-in (a new sign-in key for each run), the sample office and the 4 accounts through the seed of the office object,
 * and the Madar build of the screens on vite preview. It needs no Docker. Run it after npm run build:server, with the sandbox off
 * (wrangler dev and vite preview bind ports). It writes test-results/office-local/run.env (mode 600) with the lines of the deploy
 * suite on the office path, then waits; Ctrl-C stops both servers and removes the state of the run. The values that look like
 * keys are made for this run only: none of them is a real key.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { buildId } from '../build-remote';
import { newAuthKey } from '../office/auth-key';
import { importOffice } from '../office/import';
import { opsOf } from '../office/ops';
import { seedSource } from '../office/seed';

export const LOCAL_OFFICE = 'http://127.0.0.1:8792';
export const LOCAL_SCREENS = 'http://127.0.0.1:4174';
export const LOCAL_OUT = 'test-results/office-local';

type RunSecrets = { opsSecret: string; exportSecret: string; jobsSecret: string; authKey: string };

export function workerEnvLines(o: RunSecrets): string[] {
  return [
    'MADAR_SECRET_KEY=sb_secret_local_not_a_key', `JOBS_SECRET=${o.jobsSecret}`, `MADAR_OPS_SECRET=${o.opsSecret}`, `MADAR_EXPORT_SECRET=${o.exportSecret}`,
    `MADAR_AUTH_PRIVATE_JWK=${o.authKey}`, `R2_ACCOUNT_ID=${'0'.repeat(32)}`, 'R2_ACCESS_KEY_ID=local-not-a-key', 'R2_SECRET_ACCESS_KEY=local-not-a-key',
  ];
}

export function screensEnv(build: string): Record<string, string> {
  return {
    VITE_MADAR_API: 'remote', VITE_MADAR_AUTH: 'madar', VITE_MADAR_LIVE: 'socket', VITE_API_URL: `${LOCAL_OFFICE}/api`, VITE_MADAR_BUILD: build,
    // The Madar build reads no Supabase value; the build of the screens still wants the two names.
    VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_not_used',
  };
}

export function playwrightLines(o: { opsSecret: string }): string[] {
  return [
    `MADAR_DEPLOY_URL=${LOCAL_SCREENS}`, `MADAR_E2E_APP_URL=${LOCAL_SCREENS}`, `MADAR_E2E_OFFICE_URL=${LOCAL_OFFICE}`, `MADAR_E2E_MCP_URL=${LOCAL_OFFICE}/mcp`,
    `MADAR_E2E_OPS_SECRET=${o.opsSecret}`, 'MADAR_E2E_AFTER_G=1',
    ...Object.entries(localPasswords()).map(([name, value]) => `${name}=${value}`),
  ];
}

async function until(url: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'madar-office-local-'));
  const secrets: RunSecrets = {
    opsSecret: randomBytes(24).toString('base64url'), exportSecret: randomBytes(24).toString('base64url'), jobsSecret: randomBytes(24).toString('base64url'),
    authKey: await newAuthKey(),
  };
  const envFile = join(dir, 'worker.env');
  writeFileSync(envFile, `${workerEnvLines(secrets).join('\n')}\n`, { mode: 0o600 });
  const children: ChildProcess[] = [];
  const stop = () => {
    for (const child of children) child.kill('SIGINT');
    rmSync(dir, { recursive: true, force: true });
  };
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });
  children.push(spawn('npx', ['wrangler', 'dev', '-c', 'server/office/test/live/wrangler.local.toml', '--env-file', envFile, '--port', '8792', '--ip', '127.0.0.1',
    '--persist-to', join(dir, 'state'), '--show-interactive-dev-session=false'], { stdio: ['ignore', 'inherit', 'inherit'] }));
  if (!(await until(`${LOCAL_OFFICE}/api/health`, 60_000))) {
    stop();
    throw new Error('wrangler dev did not answer /api/health in 60 s. Run npm run build:server first.');
  }
  const { source } = await seedSource({ now: new Date(), passwords: localPasswords() });
  const report = await importOffice(opsOf({ base: LOCAL_OFFICE, secret: secrets.opsSecret, header: OPS_SECRET_HEADER }), source, { mode: 'replace' });
  console.log(`Seeded the local office: ${report.records} records and the 4 accounts.`);
  const env = { ...process.env, ...screensEnv(buildId(new Date())) };
  const built = spawnSync('npx', ['vite', 'build', '--mode', 'remote-local', '--outDir', `${LOCAL_OUT}/dist`], { stdio: 'inherit', env });
  if (built.status !== 0) {
    stop();
    throw new Error('The build of the screens failed.');
  }
  children.push(spawn('npx', ['vite', 'preview', '--mode', 'remote-local', '--outDir', `${LOCAL_OUT}/dist`, '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: ['ignore', 'inherit', 'inherit'], env }));
  if (!(await until(LOCAL_SCREENS, 60_000))) {
    stop();
    throw new Error('vite preview did not answer on port 4174 in 60 s.');
  }
  mkdirSync(LOCAL_OUT, { recursive: true });
  writeFileSync(`${LOCAL_OUT}/run.env`, `${playwrightLines({ opsSecret: secrets.opsSecret }).join('\n')}\n`, { mode: 0o600 });
  console.log(`Ready: the screens on ${LOCAL_SCREENS}, the office on ${LOCAL_OFFICE}. The deploy suite lines are in ${LOCAL_OUT}/run.env. Ctrl-C stops both.`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

In `package.json`, add `"dev:office": "node --import tsx scripts/dev/office-local.ts"`. In the root `CLAUDE.md`, "Commands", add:
"`npm run dev:office` - the local office stack (exit wave 4): the real bundle on wrangler dev with the own sign-in, the seeded sample
office and the Madar screens on 127.0.0.1:4174, with no Docker; it writes `test-results/office-local/run.env` for the deploy suite
(after `build:server`, sandbox off)."

- [ ] **Step 4: Run the test, then the stack once (no Playwright)**

Run: the command of Step 2. Expected: PASS.

Then (sandbox off): `npm run build:server && npm run dev:office` in one terminal. Expected: "Seeded the local office: 908 records"
(about; the sample office of today) and "Ready". In a second terminal, the sign-in through the own route, with no password in an
argument (node writes the body, curl reads it on stdin, and only the status prints):

```bash
node --import tsx -e 'import("./tests/e2e-deploy/local.ts").then((m)=>process.stdout.write(JSON.stringify({grant_type:"password",email:"admin@madar.test",password:m.localPasswords().MADAR_TEST_PASSWORD_ADMIN})))' \
  | curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data @- http://127.0.0.1:8792/api/auth/token
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8792/mcp
```

Expected: `200`, then `401`. Stop the stack with Ctrl-C. Write both codes in the block report.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev/office-local.ts scripts/dev/office-local.test.ts server/office/test/live/wrangler.local.toml package.json CLAUDE.md
git commit -m "Exit wave 4: npm run dev:office, the local office stack with the own sign-in, the seed and the Madar screens"
```

- [ ] **Step 6: The first end-to-end run of the own sign-in (the main session's delegated Playwright helper, not the builder)**

The main session starts one helper agent with no `name` (root `CLAUDE.md`, "Build process"), sandbox off, in the worktree
`~/dev/madar-rb/exit-ops`, with this brief:

1. `npm run build:server`, then `npm run dev:office` in the background; wait for "Ready".
2. `set -a; . test-results/office-local/run.env; set +a`, then
   `npx playwright test -c playwright.deploy.config.ts tests/e2e-deploy/signin.spec.ts tests/e2e-deploy/account.spec.ts tests/e2e-deploy/agents.spec.ts`.
   Expected: every test passes ("1 skipped" in `agents.spec.ts` is no pass: `MADAR_E2E_AFTER_G=1` is in `run.env`).
3. The screenshots of the Madar sign-in screens on the local stack: sign-in, forgot, welcome (open the invitation link of the
   newest `invite` mail, read through the peek route), reset (the newest `reset` mail) and consent (an OAuth flow of
   `agents.spec.ts`), each in English and Arabic, light and dark, at 390 px: 20 shots. Move every shot and the `.playwright-mcp/`
   folder out of the repo into the scratchpad of the main session, and check `git status` (no new file).
4. Ctrl-C the stack. Report: the pass and fail counts of each spec, the shot paths, and the first error line of each failure, in the
   final message and in `docs/superpowers/real-build/wave4-report-e2e.md` of the worktree.

A failure gets a fix task in the worktree (test first), then only the failed spec runs again. The result goes into the proof.md
section of Task 23.

### Task 23: The guides, the records and the merge gate

**Files:**
- Modify: `server/CLAUDE.md`, `server/data/CLAUDE.md`, `server/auth/CLAUDE.md`, `server/mcp/CLAUDE.md`, `functions/CLAUDE.md` (Task 3
  did its line), `.github/CLAUDE.md` (Tasks 9 and 20 did theirs), `scripts/deploy/CLAUDE.md` (Task 19 did its lines),
  `tests/CLAUDE.md` (Task 17), root `CLAUDE.md` (Task 22), `TASKS.md`, `docs/superpowers/real-build/proof.md`

- [ ] **Step 1: Write the guide lines**

`server/CLAUDE.md`, section "The office object (Supabase exit, wave 3)", add:

```markdown
- Wave 4: every `/api` route but batch, health and live, and every `/mcp` request, run inside the object (`office/http.ts`): the
  Worker sends each one as plain data with its network port (`OfficeStub.route`), because the routes of wave 2 need the database.
  The forgot and renew routes wait for their after-work in the object; their answer comes after 1,500 ms in every case.
- The office ops (`office/ops.ts`, `office/import.ts`): `POST /api/office/export|import|peek|drop`, each behind
  `x-madar-export-secret` (`MADAR_EXPORT_SECRET`, the nightly GitHub export) or `x-madar-ops-secret` (`MADAR_OPS_SECRET`, the Mac).
  `?office=rehearsal-YYYYMMDD` names a spare object (export, import, drop). The ops reach the Worker whenever the binding exists,
  also before the word of the copy is `office` (`servesOffice`).
- An export holds the office for at most 5 minutes (writes get `busy`, reads and sign-ins go on); an import holds every call for at
  most 30 minutes. The hold lives in memory: a restart ends it, and the next step gets `hold_ended`.
- The test tools (`replace`, `peek`) need `MADAR_TEST_TOOLS = "on"` and refuse a production copy (`testToolsOn`). The day cap of the
  test Worker (`office/cap.ts`, `MADAR_DAY_CAP`) refuses at its share of each Free day limit (owner decision 6).
```

`server/data/CLAUDE.md`, the SQLite part, add: "An export reads each table in rowid order with its rowid (`EXPORT_TABLES`,
`ROWID_ALIAS` in `server/office/ops.ts`); a restore writes the rowid back, so the History keeps its order. The import writes records
with `insertRow` and the server rows in one finish (`server/office/import.ts`); `office_meta.office_seq` is the number of the last
office signal (the event numbers live in `counters`)."

`server/auth/CLAUDE.md`, add: "On the office path (exit wave 4) the own sign-in routes run inside the office object
(`server/office/http.ts`), with `liteAuthAdmin` as the Auth admin port; the Cron removes the ended sign-in rows in its first run
after 00:00 UTC. The sign-in key is the Worker secret `MADAR_AUTH_PRIVATE_JWK`, made by `scripts/office/auth-key.ts` (never in a file)."

`server/mcp/CLAUDE.md`, add: "On the office path (exit wave 4) `/mcp` runs inside the office object (`server/office/http.ts`): the
own issuer, the own agent check, `liteAgentOf`, runCall on SQLite and `mountOAuth`. The Pages Functions of
`/.well-known/oauth-authorization-server/*` and `/.well-known/openid-configuration/*` answer only for an office copy. No tool, no
`TOOL_DOCS` line and no `INSTRUCTIONS` rule changed."

- [ ] **Step 2: Write the TASKS.md lines**

Tick the wave 3 lines "Exit wave 4: config/server-host.json value office ..." and "Exit wave 2 or 4: MCP on the office path ...",
and add under the exit section:

```markdown
- [x] Exit wave 4 (`rb/exit-ops`): the office path whole (sign-in, OAuth, MCP in the object), the word office, the export, the
      nightly workflow (off), the restore check on node:sqlite, the import and its check, the reverse export, the test seed, the
      deploy suite on the office path, the day cap, the wrangler-only deploy, CI with no Docker (proof.md "Wave 4 of the Supabase exit")
- [ ] Exit wave 5: the runbook of Part 2 of `docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md` (R1 to R14)
- [ ] Exit wave 5: show the four Free day meters on Admin, Usage (open since wave 3; a screen change with its screenshots)
- [ ] Exit wave 6: production takes the word office (lift `OFFICE_COPIES_OPEN`), its binding, migration and Cron, `new-secret.ts`
      and `auth-key.ts` for production, `office-backup.yml` on production, the restore reminder text for office backups
```

- [ ] **Step 3: Run the merge gate, once**

The owner starts Docker Desktop first (`test:db`, `test:it`). Rebase on main, then each command once, in this order (sandbox off
where noted):

```bash
git fetch . main && git rebase main
npm run typecheck
npm test
npm run build
npm run build:server
npm run build:remote -- test          # sandbox off
npm run test:lite
npm run test:office                   # sandbox off; it holds the year office round trip (Task 15)
npm run smoke:office                  # sandbox off
scripts/dev/docker-lock.sh run exit-ops -- npx supabase db reset
scripts/dev/docker-lock.sh run exit-ops -- npm run test:db
scripts/dev/docker-lock.sh run exit-ops -- env MADAR_AGE="$(command -v age)" npm run test:it
npm run test:mcp
```

Expected: every command passes. `test:it` runs one more file (`server/it/officeImport.it.test.ts`). No screen that a person sees
changed, so the prototype smoke is not due; Task 22 Step 6 is the browser run of this wave. Only a red check gets a fix step, and
then only that check runs again.

- [ ] **Step 4: Write the proof.md section**

Append, with the UTC day of the gate in the heading:

```markdown
### Wave 4 of the Supabase exit: backups, import and deploy (<the day of the gate run>)
Exit wave 4 plan (`docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md`), on `rb/exit-ops`. Nothing deployed: both copies
say `supabase`, no Worker got a secret, `office-backup.yml` is off (no `vars.OFFICE_BACKUP_URL`).
- Facts checked while planning (17 October): wrangler 4.147.0 `deploy --var KEY:VALUE` gives a plain-text binding; the forgot and
  renew routes need the database; the summary job sends again without its `job_runs` row; the sample office holds 908 records.
- The round trip of the year office (Task 15): <records> records, <rows> rows written, <x> for each record; every table equal.
- One seed of the sample office (Task 16): <records> records, <rows> rows written.
- The first local run of the own sign-in (Task 22): signin.spec <n> passed, account.spec <n>, agents.spec <n>; 20 screenshots.
- The merge gate (one line each, with the counts and times that each command printed).
```

- [ ] **Step 5: Commit**

```bash
git add server/CLAUDE.md server/data/CLAUDE.md server/auth/CLAUDE.md server/mcp/CLAUDE.md TASKS.md docs/superpowers/real-build/proof.md
git commit -m "Exit wave 4: the guides and records of backups, import and deploy, and the merge gate"
```

---

# Part 2: Wave 5, the test copy (runbook)

Wave 5 is a runbook, not a build: each step below is a step of the main session (the "lead") or of the owner, with its exact
commands and its check. It changes only the test copy. Production keeps `supabase`, its Worker has no office binding, and nothing
here writes to production; R11 reads a copy of production inside one read-only snapshot, with the owner present.

**The gate of wave 5 (exit plan A.2):** the deploy suite green on the test copy (R7); one week with no Free day limit above 80% (R10);
the rehearsal hash check equal (R11). R12 gives the final budget table, R13 the check of decision 6.

**Rules of every step:** load the keys first (`set -a; . ./.env.local; set +a`) in `~/dev/madar/.claude/worktrees/deploy-test` (main);
every network step runs with the sandbox off; no command prints a secret (the commands read them from `secrets/test.env` inside a
process, or send them on stdin); every result goes into the proof.md section of R14 and its line into `TASKS.md`.

### R1. Before the first deploy: the decisions, the Cron Triggers and the day so far (lead, read only)

1. The owner answered decision 5 (R2 alone, or B2) and decision 6 (form A or form B). With form B, run R-6B first and come back.
2. Count the Cron Triggers of the account (Workers Free allows 5; the test Worker takes 1 since the wave 3 merge):

```bash
TOKEN=$(sed -n 's/^oauth_token = "\(.*\)"$/\1/p' ~/Library/Preferences/.wrangler/config/default.toml)
ACCOUNT=d76d34779c63849f5acdf3d6af3751cd
for s in $(curl -s -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).result.map(x=>x.id).join(" ")))'); do
  printf '%s ' "$s"; curl -s -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/$s/schedules" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).result?.schedules?.length ?? 0))'
done
unset TOKEN
```

   Check: the sum is 5 or less, and `madar-server-test` has 1. With more than 5, the owner picks which one goes before R3.
3. The rows of the UTC day so far (the import budget of R5 needs it):

```bash
node scripts/proof/do-socket/gql.mjs scripts/proof/office-day/day.graphql \
  "{\"acc\":\"d76d34779c63849f5acdf3d6af3751cd\",\"from\":\"$(date -u +%F)T00:00:00Z\",\"to\":\"$(date -u +%FT%TZ)\",\"script\":\"madar-server-test\"}"
```

   Check: the answer is 200; write the sum of `per[].sum.rowsWritten` as USED.

### R2. The secrets of the test copy (the owner, then the lead)

1. The owner, in the prompt (each line makes a value that nobody sees; the second one also writes a GitHub secret, which needs his OK):

```
! npx tsx scripts/office/new-secret.ts test MADAR_OPS_SECRET
! npx tsx scripts/office/new-secret.ts test MADAR_EXPORT_SECRET --github OFFICE_EXPORT_SECRET
```

2. The lead (sandbox off): `npx tsx scripts/office/auth-key.ts test`. Check: it prints "The Worker madar-server-test has a new
   MADAR_AUTH_PRIVATE_JWK (kid ...)".
3. Check (names only): `npx tsx scripts/deploy/secrets.ts test --dry-run` lists `MADAR_OPS_SECRET` and `MADAR_EXPORT_SECRET`, and
   `gh secret list -R byosamah/madar` shows `OFFICE_EXPORT_SECRET`.

### R3. Deploy the wave 4 code with the word still supabase (the owner runs it; it asks one question)

The test copy keeps Postgres for its screens in this step; the office ops of the Worker answer through the Pages binding.

```
! cd ~/dev/madar/.claude/worktrees/deploy-test && set -a && . ./.env.local && set +a && scripts/deploy/all.sh test
```

Checks (lead):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://preview.madar-46r.pages.dev/api/office/export
node -e 'const t=require("fs").readFileSync("secrets/test.env","utf8");const v=/^MADAR_EXPORT_SECRET=(.*)$/m.exec(t)[1].trim();process.stdout.write(`header = "x-madar-export-secret: ${v}"\n`)' \
  | curl -s -K - -X POST -H 'content-type: application/json' --data '{"step":"begin"}' https://preview.madar-46r.pages.dev/api/office/export
```

Expected: `401`, then one JSON line with `"schema":3` and `"officeSeq":0` (the office object of the test copy is empty). End that
hold with the same command and `--data '{"step":"end","id":"<id of the answer>"}'`, or let it end by itself in 5 minutes.

### R4. Import the test office from madar-test (lead, sandbox off, after office hours)

```bash
npx tsx scripts/office/import.ts --from test --to https://preview.madar-46r.pages.dev --mode empty --used-today <USED of R1>
```

Expected: "Source: N records, 4 or more sign-in rows. Planned: about M rows written.", the report line, then "The count and the
hash of each table match the source." N is the sample office of the last seed plus the trial data (about 908 to 1,500), M under
15,000. A budget refusal names the rows and the days: wait for 03:00 Riyadh. Record N, M and the minutes.

### R5. The switch of the test copy to its office object (lead)

1. In `deploy-test`: set `config/server-host.json` to `{"test":"office","production":"supabase"}` and commit:
   `git commit -am "Exit wave 5: the test copy runs on its office object"`.
2. `scripts/deploy/all.sh test` (office mode: no Supabase step, so no question; sandbox off). Expected lines: "The test copy runs on
   its office object: db.sh, config.sh and functions.sh stay out.", "Health: ... answers from office;colo=...", "Office check: the
   office object answers with its schema and its last job.", "MCP: POST .../mcp with no token gives 401 from office;colo=...".
3. `scripts/proof/server-time.sh 20` (sandbox off). Check against the table of proof.md "The test copy on the Worker": the owner rule
   is that the new host stays only if it measures faster.
4. The owner signs in on https://preview.madar-46r.pages.dev as admin@madar.test with the password of `secrets/test-accounts.env`.
   That is the copied bcrypt hash (owner decision 4); the row then holds a PBKDF2 hash. Check (lead):

```bash
node -e 'const t=require("fs").readFileSync("secrets/test.env","utf8");const v=/^MADAR_OPS_SECRET=(.*)$/m.exec(t)[1].trim();process.stdout.write(`header = "x-madar-ops-secret: ${v}"\n`)' \
  | curl -s -K - -X POST -H 'content-type: application/json' \
    --data "{\"text\":\"select count(*) as n from auth_users where password_hash like 'pbkdf2-sha256\$%'\",\"values\":[]}" \
    https://preview.madar-46r.pages.dev/api/office/peek
```

   Expected: `[{"n":1}]` or more.
5. **The way back of this step:** the word back to `supabase`, commit, `all.sh test`. Before any write on the office object it costs
   nothing; after writes, R6 below.

### R6. The way back after writes (only on a failure that the office path cannot fix in a day; the owner says yes first)

```bash
npx tsx scripts/office/reverse.ts --from-office https://preview.madar-46r.pages.dev --to test --yes-replace
```

Then the word back to `supabase`, commit, `all.sh test`. Expected: the report names `needInvite` (people who joined on the office
object) and "Postgres holds the same records, counters, signal number and person numbers as the office object." The Admin sends
each named person an invitation again.

### R7. The deploy suite on the office path (the owner is told first; about 45 minutes; DECISION 6)

With form A, after 17:00 Riyadh and never on the day of R11 (a deploy suite day writes about 48,000 rows with its two seeds; the cap of
Task 18 stops the test copy at 50,000). With form B, any time.

1. Seed (lead): `npx tsx scripts/office/seed.ts --to https://preview.madar-46r.pages.dev`. Expected: "Uploaded N sample files to
   madar-files-test" and "Seeded the office object of test: ... the 4 accounts".
2. The delegated helper (no `name`, sandbox off, in `deploy-test`), with this brief:

```bash
set -a; . ./.env.local; . secrets/test-accounts.env; . <(grep '^R2_' secrets/test.env); set +a
export MADAR_DEPLOY_URL=https://preview.madar-46r.pages.dev MADAR_E2E_APP_URL=https://preview.madar-46r.pages.dev \
  MADAR_E2E_OFFICE_URL=https://preview.madar-46r.pages.dev MADAR_E2E_MCP_URL=https://preview.madar-46r.pages.dev/mcp \
  MADAR_E2E_AFTER_G=1 MADAR_E2E_AFTER_M=1 MADAR_E2E_WALK=1
export MADAR_E2E_OPS_SECRET="$(sed -n 's/^MADAR_OPS_SECRET=//p' secrets/test.env)"
npx playwright test -c playwright.deploy.config.ts
```

   The helper moves every shot and `.playwright-mcp/` out of the repo, reports the counts of each spec and the first error line of
   each failure in its final message and in a scratchpad file.
3. Seed again (lead), as in step 1.
4. The rows of that day (R1 step 3 with the whole UTC day, the morning after). Record: the deploy suite day of the office path
   (rows read, rows written, object requests, Worker requests).

Expected: every spec passes (the walk names the store R2). A failure gets a fix task (test first, a commit in a worktree, all.sh
test), then only the failed spec runs again.

### R8. The measurements of the wave 3 plan (lead; the owner helps with the browsers)

**(a) The bill of a batch with mail and push (wave 3 design choice 1).** Before: the owner signs in on his Mac browser as the lead
of a task (find one: the peek of R5 step 4 with `select id from tasks where json_extract(doc, '$.ownerId') = 'usr_001' and
json_extract(doc, '$.status') <> 'done' limit 1`) and taps Allow on the push card, so a comment on that task makes a notice, a mail
and a push (the push POST is the network callback). Then:

```bash
set -a; . secrets/test-accounts.env; set +a
node scripts/proof/office-day/bill.mjs https://preview.madar-46r.pages.dev 20 <task id>
```

Wait 5 minutes, then the GraphQL query of R1 step 3 with `from` and `to` of the printed window. Check: the object requests of
`madar-server-test` are at most 2 for each batch (the batch and `runEffects`) plus 2 for the sign-in; the push callbacks add none.

**(b) The CPU of a batch with effects and of a Cron run.** During (a) and across one Cron run (:00, :15, :30 or :45):
`npx wrangler tail madar-server-test --format json > "$TMPDIR/tail.json"`, then `node scripts/proof/do-socket/cpu-stats.mjs "$TMPDIR/tail.json"`.
Check: every Worker event has a CPU time under 10 ms and the outcome `ok` (the object events may be higher: wave 0).

**(c) The office meter against the Cloudflare day numbers.** The morning after a day of use: the peek of R5 step 4 with
`select * from usage_day where day = '<the UTC day>'`, and the GraphQL query of R1 step 3 for that whole day. Check: rows read, rows
written and object requests of the meter are within 10% of `per[].sum` and `inv[].sum.requests` of the namespace (the meter counts
rolled-back rows too, wave 3).

**(d) A socket through the Pages forwarder and the service binding.**
`set -a; . secrets/test-accounts.env; set +a; node scripts/proof/office-day/socket.mjs https://preview.madar-46r.pages.dev`.
Expected: `{"socket":"pong"}`. Then the owner opens Home in two browsers as two people; a task change in one shows in the other within
2 seconds. This also checks that `connect-src 'self'` of the CSP takes the same-host socket.

**(e) The race of wave 1 Task 1 on a deployed object (the owner says yes to a throwaway Worker and to its delete).**

```bash
npx wrangler deploy -c scripts/proof/do-tx/wrangler.deployed.toml
PROBE_SECRET="$(openssl rand -hex 24)"
printf '%s' "$PROBE_SECRET" | npx wrangler secret put PROBE_SECRET -c scripts/proof/do-tx/wrangler.deployed.toml
PROBE_URL=https://madar-do-tx-probe.vado-sa.workers.dev PROBE_SECRET="$PROBE_SECRET" node scripts/proof/do-tx/deployed.mjs
unset PROBE_SECRET
npx wrangler delete -c scripts/proof/do-tx/wrangler.deployed.toml
```

Expected: the answers of proof.md "Wave 1: the transaction facts" (rollback rows `[]`; the race logs `["A:start","A:end","B"]`;
`timerFail` keeps the row of B only). Until the secret is set, the probe answers 404 to every request (`guard.js`).

**(f) A Cron run with many pushes against 10 ms of CPU.** The owner turns "Notify me on this device" on for the 4 accounts (4 browser
profiles, or 2 devices). The evening before a working day: `npx tsx scripts/office/seed.ts --to https://preview.madar-46r.pages.dev --due-today 40`.
At the 08:00 Riyadh run (05:00 UTC), `wrangler tail` as in (b). Check: the scheduled event of the Worker stays under 10 ms of CPU, the
log line "The office jobs ran." names no failed step, and a run with more than 45 network calls leaves the rest to the next run
(`NetBudgetSpent`, wave 3) with no attempt lost.

### R9. The nightly office backup on, and its restore check (the owner for the GitHub writes and the key; DECISION 5)

1. The owner: `! gh variable set OFFICE_BACKUP_URL --body https://preview.madar-46r.pages.dev -R byosamah/madar` and
   `! gh variable set OFFICE_BACKUP_COPY --body test -R byosamah/madar`.
2. The lead: `gh workflow run "Office backup" -R byosamah/madar`, then `gh run list -R byosamah/madar --workflow "Office backup" --limit 1`
   (success), and `gh release list -R byosamah/madar-backups --limit 5` (a release `madar-office-test-<stamp>`).
3. The restore check on the Mac (the owner gives the key for the check, then deletes the opened copy and the key file):

```bash
gh release download --repo byosamah/madar-backups --pattern 'madar-office-test-*.age' --dir ~/Downloads/madar-office-backup
npx tsx scripts/restore-check.ts --file ~/Downloads/madar-office-backup/<file> --key <owner key file> --files-remote madar-r2:madar-files-test --files-lag-days 0
```

   `madar-r2` is an rclone remote of type s3 (provider Cloudflare, endpoint `https://d76d34779c63849f5acdf3d6af3751cd.eu.r2.cloudflarestorage.com`)
   with an R2 token of Object Read on `madar-files-test` only, which the owner makes in the dashboard. The test copy has no copy on
   B2 in either form of decision 5, so this step is the same for both. Expected: the report says `"ok": true` with the steps
   decrypt, archive, counts, events guard, dashboard.get and files.
4. The morning after: the scheduled run of 02:07 Riyadh is a success, and no write of that night got stuck (the meter shows the
   calls of the night as usual).

### R10. One week of use (the owner and the people he asks; the lead each morning, read only)

Each morning, the GraphQL query of R1 step 3 for the day before (the whole UTC day, all scripts in `all`), and one line in the
proof.md table of R14: the day, Worker requests (all scripts), object requests, rows read, rows written, each as a share of its Free
limit, and "deploy suite: yes or no". Check: no limit above 80%; the 80% mail of wave 3 went out only on a day that the meter showed
above 80%. A limit above 80% on any day: stop the heavy runs and decide with the owner before R11.

### R11. The production rehearsal (the owner is present; after office hours; a day with no deploy suite; DECISION 6)

With form A, the spare object lives on the test Worker of the same account; with form B, on the test Worker of the second account
(the copy of production then sits for some minutes in that account: the owner's OK covers it).

1. The size of production, from the log of the last nightly backup (it prints `"tables"` and `"rows"`; no database access):

```bash
gh run view "$(gh run list -R byosamah/madar --workflow "DB backup" --limit 1 --json databaseId --jq '.[0].databaseId')" -R byosamah/madar --log | grep -o '"rows":[0-9]*'
```

   Check: rows x 7.5 + 2,000 is at most 90,000 minus USED (R1 step 3 of that day). Else stop: the switch needs another plan (one
   import must fit one UTC day; a split import of a live office is not consistent), and the owner hears the number of days.
2. The copy (the owner types `production` at the prompt):

```bash
npx tsx scripts/office/import.ts --from production --to https://preview.madar-46r.pages.dev --office rehearsal-$(date -u +%Y%m%d) --mode empty --used-today <USED>
```

   Expected: "The count and the hash of each table match the source." Record the records, the rows written (the report) and the
   minutes (`time` before the command). The read of production is one read-only snapshot through the session pooler: no lock, no write.
3. The reverse into the local stack (the owner starts Docker Desktop):

```bash
scripts/dev/docker-lock.sh acquire rehearsal
npx supabase start -x edge-runtime && npx supabase db reset
npx tsx scripts/office/reverse.ts --from-office https://preview.madar-46r.pages.dev --office rehearsal-$(date -u +%Y%m%d) --to local
npx supabase stop
scripts/dev/docker-lock.sh release rehearsal
```

   Expected: the report, then "Postgres holds the same records, counters, signal number and person numbers as the office object."
   The local stack holds a copy of production only until `supabase stop` (the next `db reset` empties it); its plain export folder
   is gone already (the script removes it).
4. Drop the spare object: `npx tsx scripts/office/drop.ts --to https://preview.madar-46r.pages.dev --office rehearsal-$(date -u +%Y%m%d)`.
   Expected: `{"ok":true}`. The GraphQL query of R1 step 3 for the minutes around the drop gives the rows written of a drop (not
   known before: write it down).

### R12. The real counts and the final budget table (lead)

From the week of R10 and the rehearsal of R11: the calls in one request (`usage_day.calls / usage_day.requests`), the rows read and
written for each call, and production's calls of a day (its `usage_month.calls` on Supabase for the month so far, divided by the
days). Write the table of spec section 3 again with the measured numbers (Worker requests, object requests, duration, rows read, rows
written, storage, R2) for production alone and for production plus the test copy, in proof.md and in section 3 of
`docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md` (one commit). This closes wave 0 change 6 ("count real calls, not
requests, before the budget is final").

### R13. The check of decision 6 (lead, with the owner)

For each Free day limit: the busiest test day of the week (R7 and R10) plus production's estimate of R12. Form A stays when every sum
is at most 80%; the cap of Task 18 stays at 50%. When a sum is above 80%: form B (R-6B) before wave 6, or the owner's decision 2 (the
$5 safety valve) in words. Write the sums and the answer in proof.md.

### R-6B. DECISION 6 = form B: the test copy on a second free account (only with that answer)

1. The owner makes a free Cloudflare account with another email, turns 2FA on, and makes an API token for Workers, Pages, R2 and
   the account settings of that account; it goes into `.env.local` as `CLOUDFLARE_TEST_API_TOKEN` and `CLOUDFLARE_TEST_ACCOUNT_ID`
   (`! open -a TextEdit .env.local`).
2. A builder task, test first, in a new worktree: `scripts/deploy` takes the account of each copy (`CLOUDFLARE_ACCOUNT_ID` from
   `CLOUDFLARE_TEST_ACCOUNT_ID` for test); a Pages project `madar-test` on the new account (`pages.sh test` deploys there, branch
   `main`); the test page host in `PAGE_HOSTS` and `COPY_HOSTS.test.page` of `server/core/serverHost.ts`, in `TEST_MCP_HOST` of
   `tests/e2e-deploy/targets.ts`, in `config/remote.test.env` and the CSP of `scripts/deploy/headers.ts`; `APP_URL`, `ALLOWED_ORIGINS`
   and `MCP_URL` of `secrets/test.env` (the owner edits them); the Pages binding `MADAR_SERVER_TEST` on the new project. R2 stays on
   the main account (the Worker reaches it with its S3 keys).
3. `scripts/deploy/all.sh test`, then R3 to R5 again on the new address; the old `madar-server-test` on the main account is deleted
   with the owner's OK; the Cron count of R1 is checked on both accounts.

### R-B2. DECISION 5 = B2: the weekly file copy of production (only with that answer)

The steps of `.github/CLAUDE.md` ("After the production switch to R2"), each GitHub write with the owner's OK: the owner's Backblaze
B2 account and the values `B2_KEY_ID`, `B2_APPLICATION_KEY`, the crypt password and salt; the read-only R2 token
`madar-production-backup` (Object Read, bucket `madar-files`); `gh variable set MADAR_FILE_STORE --body r2 -R byosamah/madar`;
`gh secret set FILES_S3_ENDPOINT --body https://d76d34779c63849f5acdf3d6af3751cd.eu.r2.cloudflarestorage.com -R byosamah/madar`;
`gh secret set FILES_S3_ACCESS_KEY_ID -R byosamah/madar` and `gh secret set FILES_S3_SECRET_ACCESS_KEY -R byosamah/madar` (the owner
types each value at the prompt); `gh workflow enable "Files backup" -R byosamah/madar`; one run by hand
(`gh workflow run "Files backup" -R byosamah/madar`). The restore check of production then takes
`--files-remote madar-copy:current` with the default 8 days. With **R2 alone**, `files-backup.yml` stays off, and `.github/CLAUDE.md`
and `TASKS.md` say "R2 alone (owner decision 5)" in place of "waits for the owner's B2".

### R14. Close wave 5 (lead)

1. Append to proof.md, with the UTC day in the heading:

```markdown
### Wave 5 of the Supabase exit: the test copy on its office object (<first day> to <last day>)
- The switch (R5): the commit, the checks, server-time (both hosts), the first PBKDF2 row.
- The import of the test office (R4): N records, M rows written, the minutes; the hash check equal.
- The deploy suite (R7): the counts of each spec; the rows of that day.
- The measurements (R8): (a) object requests for each batch with effects; (b) Worker CPU of a batch and of a Cron run; (c) the meter
  against GraphQL; (d) the socket; (e) the deployed race; (f) the Cron run with pushes.
- The office backup (R9): the release, the restore check report.
- One week (R10): one row for each day (Worker requests, object requests, rows read, rows written, % of Free).
- The rehearsal (R11): production records, rows written, minutes, the hash check, the reverse check, the rows of the drop.
- The budget (R12) and decision 6 (R13).
```

2. Tick the wave 5 lines of `TASKS.md` (the deploy suite on the office path; the measurements (a) to (e) of wave 3; the transaction
   race; the Cron count; the bill of the callback; the Cron run with many pushes), and add the open items for wave 6.
3. The gate of wave 5 is green when R7, R10 and R11 passed. Tell the owner, with decision 3 (the switch date) due next.

---

## Spec coverage

| Requirement (exit plan A.2 rows "Wave 4" and "Wave 5", the spec, this brief) | Task or step |
|---|---|
| The export route: a secret header; writes stop for at most 5 minutes at 02:00 Riyadh | 4 (the hold, 5 minutes), 5 (`x-madar-export-secret`), 9 (02:07 Riyadh, between two Cron runs) |
| The GitHub nightly workflow: encrypt to the owner's age key, keep 30 days | 7 (age), 9 (`office-backup.yml`, 30 days, 26-hour stale check), R9 |
| The import from Postgres in parts: records, counters, the office version, the person numbers, the mail count of the day, the usage month, the push devices, the sign-in rows of wave 2 | 10 (the steps; `push_devices` is a records table), 11 (`pgSource`, `SIGNIN_EXPORT_SQL` as postgres), 12 (the parts) |
| About 7 rows written for each record, within the Free limits; one import fits one day; the days of the year office | 12 (`budgetProblem`: records x 7.5 + 2,000 within 90,000 minus the day so far), 15 (the pin, 7.5), fact 8 (9.1 Free days, 10.1 at the 90% budget) |
| The count and hash check of each table | 6 (digests), 13 (`compareImport`), 12 (the command line checks after each import), 15 |
| The reverse export (office object to Postgres, the way back) | 14, R6, R11 step 3 |
| The restore check into node:sqlite with the same schema | 8 (`restoreOffice`, `officeRestoreCheck`; every table of `EXPORT_TABLES`, the `SIGNIN_TABLES` among them) |
| The test seed into the office object (local and the test copy) | 16, 22, R7 |
| A wrangler-only deploy: `all.sh` with the host value `office` | 2 (the word), 19 (`all.sh`, `worker.sh --var`, `secrets.ts --office`, `checks.sh`) |
| CI jobs with no Docker: `test:lite`, `test:office` | 20 |
| The first local end-to-end run of the own sign-in (wave 2 Merge notes 13, wave 3 Merge notes 14) | 1 (the routes in the object), 17 (the suite on the office path), 22 (the stack and the delegated run with 20 screenshots) |
| Wave 2 Merge notes 14: `SIGNIN_EXPORT_SQL` with the rights of `BACKUP_DB_URL`, `importSigninRows` after the records, `SIGNIN_TABLES` in the restore check, `MADAR_AUTH_PRIVATE_JWK` named in `secrets.ts`, the `.well-known` Pages Function, `VITE_MADAR_AUTH=madar` for the test copy | 11, 10, 8, 19 (`KEPT_ON_WORKER`), 3, 2 (from the word, not from the public file) |
| Wave 3 Merge notes 8 (a) to (e): `liteAuthAdmin`, the sign-in steps on the object, the own routes, `cleanupSignin` once a day, `/mcp` on the office path | 1 |
| Wave 5: `madar-server-test` on the office object; the test office imported | R5, R4 |
| Wave 5: the deploy suite after office hours (about 34,000 rows written a day, plus the seeds) | R7, 16 (the seed pin) |
| Wave 5: one week of use; no Free day limit above 80% | R10 |
| Wave 5: the production rehearsal (a copy into a spare object, compare, delete) | R11, 4 and 5 (`rehearsal-YYYYMMDD`, `drop`) |
| Wave 5: the real counts of calls and requests; the final budget table | R12 |
| Wave 5: a day cap on the test Worker | 18, R13 |
| Wave 5: the Cron Triggers of the account before the first deploy | R1 |
| Wave 5: the measurements of the wave 3 plan (the bill of the callback, a Cron run with many pushes against 10 ms, the race of `scripts/proof/do-tx` on the deployed object, the meter against GraphQL, the socket through Pages) | 21 (the probes), R8 (a) to (f) |
| Owner decision 5 (R2 alone by default, B2 as one marked task) | the decision section, 8, R9, R-B2 |
| Owner decision 6 (both forms with their cost, one recommendation, the marked tasks) | the decision section, 18, R1, R7, R11, R13, R-6B |
| The GitHub secret of the export route: only its name | 9 (`OFFICE_EXPORT_SECRET`), R2 (the owner's command makes the value) |
| Spec section 2, backups (1): point-in-time recovery | On by default for every SQLite Durable Object (30 days); no code here. Wave 6 writes its use into the switch runbook. |
| Spec section 4: the move stops when a table differs | 12 (the command line exits 1), 13 |
| Every feature change updates the MCP side | No tool, `TOOL_DOCS` line or `INSTRUCTIONS` rule changes; `/mcp` runs in the object (1); `server/mcp/CLAUDE.md` (23) |
| Production stays on Supabase; wave 5 changes only the test copy | Global Constraints; 2 (`OFFICE_COPIES_OPEN`), 5 (no binding on production), 18 (no test tools on production), 12 and 14 (production refused as a target) |

## Merge notes

This plan starts from main after the merge of `rb/exit-live` (wave 3; its tip held 4580e70, the merge of main e8992a3 with wave 2).
The builder of Block A reads the merge state first (the three `git grep` lines before Task 1).

1. **Item 8 of the wave 3 Merge notes (the sign-in parts on the office object).** Settled: the merge built all five parts, and the ruling at the top of Task 1 wins over the rest of this item. The first text of this item follows. Task 1 does all five parts. If the merge did some:
   (a) `liteAuthAdmin` in `depsFor` and (d) `cleanupSignin` in the first run after 00:00 UTC stay as the merge wrote them, and their
   tests of Task 1 must pass; (b) a `signin` method on `Office` may stay, but (c) `ownApiRoutes` in the Worker must go: on the office
   path `forgotRoute` and `renewRoute` read the database (fact 4), and the Worker Db refuses every statement. Task 1 serves every
   such route in the object (`route`). (e) `/mcp` runs in the object too, with the app of `oauthApp` (fact 5), so no agent kind of
   `OfficeWho` is needed; the `TASKS.md` line "MCP on the office path" closes with Task 23.
2. **The schema.** This plan keeps `LITE_SCHEMA_VERSION = 3` and adds no table. `EXPORT_TABLES` and `ROWID_ALIAS` come from
   `liteSchemaSql()`, so a later table joins the export by itself; a later table with an integer primary key changes the expected map
   of the `ROWID_ALIAS` test of Task 4 (add its name there).
3. **Track R.** When its table `unread_counts` is on main, it is in `EXPORT_TABLES` by itself (export, restore and round trip take it),
   but the import must carry it too: `ServerRows` gets `unreadCounts` (copied from Postgres in `pgSource` and from the export in
   `exportSource`, written in `importFinish`), or `importFinish` calls the rebuild of Track R for each person. That is a task of the
   later of the two merges, with a test that the badge of a person after an import equals the badge before it.
4. **The names of wave 3 that this plan uses, with their files:**
   - `Office` (its `fetch`, `batch`, `runEffects`, `cron`, `health`, `principal`, `parts`): `server/office/office.ts`
   - `officeParts`, `OfficeParts`, `PartsInput`, `OfficeHost`, `DayRow`, `OfficeCronInput`, `OfficeCronReport`, `OfficeEffectsInput`:
     `server/office/parts.ts`
   - `officeRoutes`, `OfficeStub`, `OfficeRoutesOptions`, `officeErrorOf`, `LIVE_PATH`: `server/entries/officeWorker.ts`
   - `officeEntry`, `onOffice`, `OFFICE_NAME` (moved to `officeWorker.ts` by Task 5): `server/entries/officeEntry.ts`
   - the default export of the bundle: `server/entries/workerMain.ts`
   - `runOfficeBatch`, `OfficeBatchInput`, `OfficeBatchOutput`, `EffectLedger`, `officeData`: `server/office/batch.ts`
   - `NetApi`, `netPorts`, `NET_BUDGET`, `NetBudgetSpent`: `server/office/net.ts`; `WorkerNet`: `server/office/workerNet.ts`
   - `OfficeMeter`, `DAY_ROW_LITE`: `server/office/meter.ts`; `utcDay`: `server/mail/quota.ts`
   - `LiveTickets`, `sweep`, `closeOff`, `Sockets`, `LiveSocket`, `TICKET_SHAPE`: `server/office/live.ts`
   - `runOfficeJobs`, `officeSteps`: `server/office/jobs.ts`; `OfficeWho`, `principalOfWho`: `server/office/who.ts`
   - `refusingDb`: `server/office/refusingDb.ts`; `DurableObjectStorage` (gets `deleteAll`): `server/office/workers.d.ts`
   - `LITE_SCHEMA_VERSION = 3`, `LITE_STEPS`, `USAGE_DAY_SQL`, `EVENT_GUARDS`, `eventGuardsSql`: `server/data/lite/schema.ts`
   - `startLive`, `TestOffice`, `wrangler.toml`, `wrangler.bundle.toml`, `entry.ts`: `server/office/test/live/`
   - `fakeSockets`, `recordingNet`: `server/office/test/fakes.ts`; the values of `OFFICE_ENV` (`server/office/parts.test.ts`, copied
     into `NODE_OFFICE_ENV`, because a test file is not imported)
   - `warningMeters`, `checkDayLimits`: `server/usage/meters.ts`, `server/usage/warn.ts`
   - `npm run smoke:office`: `scripts/dev/office-smoke.ts`; the office blocks and `[triggers]`: `wrangler.server.toml`
5. **`wrangler.server.toml`.** Task 18 adds `MADAR_TEST_TOOLS` and `MADAR_DAY_CAP` to `[env.test.vars]` only. The wave 3 test "sets
   MADAR_DATA in no env" stays true: `worker.sh` passes `--var MADAR_DATA:office` from the word (fact 1).
6. **Wave 2 Merge notes 14** is done by this plan (see Spec coverage); its `functions/.well-known/[[path]].ts` became two narrow files
   (Task 3), and `VITE_MADAR_AUTH=madar` comes from the word `office`, so `config/remote.test.env` must not set it (Task 2 refuses it).
7. **Gates.** `test:it` runs one more file (`server/it/officeImport.it.test.ts`): the merge lead runs it under the Docker lock.
   `test:office` runs three more files (`ops.wd.test.ts`, `roundtrip.wd.test.ts`, and the year office import of the round trip takes
   minutes). The push of the new workflow files needs the `workflow` scope (owner action 3).
8. **`TASKS.md`, `proof.md`, the guides.** Each wave appends its own lines and sections; keep both sides in a rebase.

## Owner actions

1. **Nothing blocks the build of wave 4.** Decision 5 builds as R2 alone and decision 6 as form A; both stay open until R1.
2. **Start Docker Desktop** for the merge gate (`test:db`, `test:it` with the new it-test) and for R11 step 3.
3. **The push of main with `office-backup.yml`, `ci.yml` and `ci-stack.yml`** needs `gh auth refresh -h github.com -s workflow` in
   your own terminal; type the code at once (`.github/CLAUDE.md`).
4. **Decision 5 before wave 5 (recommended: R2 alone):** with R2 alone, make one R2 token with Object Read on `madar-files-test` for
   the rclone remote `madar-r2` of the restore check (R9). With B2: your B2 account and the values of R-B2.
5. **Decision 6 before wave 5 (recommended: form A, the same account, with the day cap at 50%):** with form B, a second free
   Cloudflare account and its token (R-6B).
6. **Wave 5, in order:** the two `new-secret.ts` lines (R2; the second one writes the GitHub secret `OFFICE_EXPORT_SECRET`); the
   `all.sh test` of R3 in your Terminal (it asks one question); the first sign-in on the test copy (R5); a heads-up before the deploy
   suite (R7); your browsers with push allowed for R8 (a), (d) and (f); a yes for the throwaway Worker `madar-do-tx-probe` and its
   delete (R8 (e)); the two `gh variable set` lines and your key for the restore check (R9); one week of use (R10); your presence, the
   typed word `production` and Docker for the rehearsal (R11); the check of decision 6 with the measured numbers (R13).
7. **Still open, no action now:** decision 2 (the $5 safety valve: no payment without your yes in words), decision 3 (the switch date,
   after the gate of wave 5), decision 7 (the Supabase delete date).

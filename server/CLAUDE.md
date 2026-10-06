# Server

One Hono app in TypeScript. The same source runs on Supabase Edge Functions (Deno, pinned to eu-central-1) and on a
Cloudflare Workers fallback (paid plan, local only today). Each area below has its own guide: `mcp/`, `auth/`, `data/`,
`mail/`, `files/`.

## Folders
- `http/`: the batch route, CORS, the batch limits, the extra routes, health, the Pages forwarder of /mcp.
- `core/`: `runCall`, the ports, `buildDeps`, the office lock, idempotency, stories, effects, the call map.
- `calls/`: the server-only calls and the server hooks of 4 shared calls.
- `entries/`: one mount for each function (`api`, `mcp`, `jobs`, `apps`), the Deno wrappers `deno-*.ts`, Workers `worker.ts`.
- `jobs/` (the 15-minute job), `signal/` (change signals), `usage/` (meters and the Admin warning).
- `test/`: the fakes of the ports, the db-mode harness, the shadow run. `it/`: helpers of the integration suites.

## Request path
- `POST /api/batch?forceFunctionRegion=eu-central-1` (`http/batch.ts`): at most 12 entries, 256 KB, 1 overview call
  (`http/limits.ts`). An old `X-Madar-Build` gives 409 `client_outdated`. CORS allows only listed origins, never `*`.
- Extra routes (`http/routes.ts`) sit under the api app: `POST /auth/forgot` answers at `/api/auth/forgot`.
- The token check (`auth/verify.ts`): jose, ES256 only, issuer `${SUPABASE_URL}/auth/v1` (or `AUTH_ISSUER`). Never compare
  `aud` by hand. A token with `client_id` is an agent token: the api function refuses it with 403.
- `principalOf` (`auth/principal.ts`) finds the person by `auth_user_id`. The role comes from the users row, never from the
  token. A turned-off person gets 403 `account_off`.
- `runCall` (`core/runCall.ts`) for each entry: a read runs in a repeatable-read, read-only transaction with no lock. A write
  runs preflight outside the lock, then `set local lock_timeout 5s` and `statement_timeout 10s`, the office lock, the
  idempotency check, the story, the loader, `executeParsed`, the diff save, the outbox rows, the signals, the commit.
- After the commit, `processOutbox` runs the effects once. The 15-minute job retries the rest. `core/after.ts` keeps work
  alive after the answer on both hosts.

## Calls
- `core/serverCallMap.ts` holds every call the server runs: the shared calls of `src/api/sharedCalls.ts` plus the server calls.
- 10 server-only calls (`calls/index.ts`): `story.start`, `files.uploadStart`, `files.link`, `feedback.uploadStart`,
  `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove`, `usage.get`, `usage.retryEffect`.
- Server hooks replace the prototype `prepare` of `files.upload`, `feedback.send`, `feedback.screenshot`, `projects.delete`.
- `SERVER_EXCLUDED` (prototype only): `session.previewAs`, `session.setSimulateErrors`, `session.resetSampleData`, `files.get`.
  runCall answers `not_found` for them.
- `core/everyCall.ts` gives one input for every call. A test runs each call once on the sample office.

## Entries and bundles
- Each Supabase function imports only its own mount. Deno needs the bundle (no extensionless imports), so
  `npm run build:server` writes `supabase/functions/_build/{api,mcp,jobs}.js` and `dist-server/worker.js`.
  Edit `server/`, never the bundles.
- Workers (`entries/worker.ts`): one Db for each request, the database through the Hyperdrive binding `DB`.
- `wrangler dev` uses esbuild with no `import.meta.glob`, so server code reads word files with plain JSON imports
  (`workerGraph.test.ts` checks it).
- The bundles run on the real office, so they hold no sample office and no `settleFuture` (it moves every later stamp to
  before now). `workerGraph.test.ts` checks that no entry loads `src/data/`, and `build:server` ends with
  `check-bundles.ts server`. The prototype runtime gives the sample office to `session.resetSampleData`.

## Ports
- `core/ports.ts`: Db, Clock, FilesPort, MailPort, SignalPort, AuthAdminPort, MeterPort. Fakes in `test/fakes`.
- `buildDeps` (`core/deps.ts`) reads the env. A missing variable gives an error that names the variable, never a value.

## Rules a change must keep
- Never write to the database outside `runCall` (or a server write call that copies its steps).
- Handlers stay synchronous and pure. Outside work goes through the outbox, written in the call's transaction.
- A new effect kind needs `registerEffect`. Effects read the person again when they run.
- Lock order: the office lock, then the mail lock. The mail reserve takes only the mail lock, in its own transaction.
- A preflight hook does network work before the transaction and never holds the lock.
- Every network call has a 3 s timeout.
- Only `set local` on the pooler: `data/sql.ts` refuses a plain SET.
- Database TLS fails closed: TLS with the Supabase root CA (`DATABASE_CA`) for every host except loopback and the local
  Docker hosts. No `sslmode` in a URL.
- The client address is `cf-connecting-ip` only. Never read `x-forwarded-for` or `true-client-ip`.

## Realtime, jobs, usage
- Change signals go out inside the save transaction (`signal/realtime.ts`: `realtime.send`, topics `office` and
  `person:<id>`). A rollback sends nothing. A failed send only warns, and the sender counts it.
- pg_cron calls `jobs/run` every 15 minutes, with the secret header `x-madar-jobs-secret`. Steps (`jobs/steps/`):
  heartbeat, triggers, summary, outbox, cleanup, uploads, usage. Each step is idempotent.
- Usage meters and the 80% Admin warning (`usage/`). The free-plan limits are in `FREE_PLAN_LIMITS`.

## Tests
- `npm test` runs the `server` project with the fakes. `npm run test:db` runs the rule tests again on the local Postgres.
- The shadow run (`test/shadow.ts`) runs each API test in memory and on the database, and fails on any difference.
- Integration: `MADAR_IT=1 npx vitest run --project it <files>`, one file at a time, on the full local stack.

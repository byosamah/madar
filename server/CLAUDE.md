# Server

One Hono app in TypeScript. The same source runs on Supabase Edge Functions (Deno, pinned to eu-central-1) and on one
Cloudflare Worker for each copy (`wrangler.server.toml`, placed in aws:eu-central-1). `config/server-host.json` says which host
serves each copy (`core/serverHost.ts`): `supabase`, `workers`, or `office` (the office object, `OFFICE_COPIES_OPEN`).
The other host stays deployed as the way back. Each area has its own guide: `mcp/`, `auth/`, `data/`, `mail/`, `files/`, `push/`,
`daftra/`, `google/`, `office/`, `jobs/`, `signal/`.

## Folders
- `http/`: the batch route, CORS, the batch limits, the extra routes, health, the Pages forwarders.
- `core/`: `runCall`, the ports, `buildDeps`, the office lock, idempotency, stories, effects, the call map.
- `calls/`: the server-only calls and the server hooks of shared calls.
- `entries/`: one mount for each function (`api`, `mcp`, `jobs`), the shared host builder `apps.ts`, the Deno wrappers `deno-*.ts`, Workers
  `worker.ts` (the Postgres path) and `workerMain.ts` (the bundle entry, which also has the office path).
- `office/` (the office object), `jobs/` (the 15-minute job), `signal/` (change signals), `push/` (browser push), `google/` (calendar sync).
- `test/`: the fakes of the ports, the db-mode harness, the shadow run. `it/`: helpers of the integration suites.

## Request path
- `POST /api/batch` (`http/batch.ts`; on a Supabase function URL with `?forceFunctionRegion=eu-central-1`, on the Worker through the page
  own `/api`). The limits are `MAX_BATCH`, `MAX_BODY_BYTES` and `BATCH_BUDGET` (`src/api/remote/wire.ts`). `http/limits.ts` refuses a request
  over the budget with 413 `too_many_overviews`. A call that scans a list of the office has a cost (`callCost`, 1 unit = 10 ms of CPU on
  the year office). The client sends up to the budget only for the follow reads of a write. Change a cost only with a new CPU table of the
  year office (`node --import tsx scripts/proof/overview-cost.ts`). An old `X-Madar-Build` gives 409 `client_outdated`. CORS allows only
  listed origins, never `*`.
- Extra routes (`http/routes.ts`) sit under the api app: `POST /auth/forgot` answers at `/api/auth/forgot`. `GET /google/callback` is
  described in `google/CLAUDE.md`.
- The token check (`auth/verify.ts`): jose, ES256 only, issuer `${SUPABASE_URL}/auth/v1` (or `AUTH_ISSUER`). Never compare `aud` by hand.
  A token with `client_id` is an agent token: the api function refuses it with 403.
- `principalOf` (`auth/principal.ts`) finds the person by `auth_user_id`. The role comes from the users row, never from the token. A
  turned-off person gets 403 `account_off`.
- `runCall` (`core/runCall.ts`) for each entry: a read runs in a repeatable-read, read-only transaction with no lock. A write runs
  preflight outside the lock, then `set local lock_timeout 5s` and `statement_timeout 10s` (joined with BEGIN in one query, see
  `data/CLAUDE.md`), the office lock, the idempotency check, the story, the loader, `executeParsed`, the diff save, the outbox rows, the
  signals, the commit.
- The email code guard of agents (`mcp/guard.ts`) sits in the write step of `runCall`, so every route passes it. Flow: `mcp/CLAUDE.md`.
- After the commit, `processOutbox` runs the effects once. The 15-minute job retries the rest. `core/after.ts` keeps work alive after the
  answer on both hosts: on Supabase within the 150 s of the function, on the Worker through `waitUntil` for about 30 s. A long mail or
  push chain can stop part way there; the job retries the outbox.
- The kinds in `AFTER_ANSWER_KINDS` (`core/effects.ts`) run after the answer when the host has `after`, on one chain per batch
  (`BatchScope.mail`), so the mails keep the order of the entries. Every other kind runs before the answer. With no `after` (tests,
  scripts), every kind runs before the answer. A new mail or push kind goes into `AFTER_ANSWER_KINDS`; `effects.test.ts` pins the names.
  The kinds in `WAITED_KINDS` (`push.chat`, `mail.chatNotice`) wait `CHAT_WAIT_MS` after the answer on a chain of their own, so the server
  can skip a person who read the chat. The office object runs them with no wait.
- The screens depend on two facts of this path. `http/batch.ts` runs the calls of a request one after the other, and a write clears
  `batch.office` (`core/runCall.ts`), so a read after a write in the same request sees the write. A change that runs the reads of a request in
  parallel, or keeps the office copy across a write, lets a screen show an old list after its own save. Adjacent `files.link` entries are the
  one exception: reads only, side by side, each with its own error and in the order of the answers. Before such a run, `prefetchLinkRun`
  (`calls/files.ts`) reads the files of the whole run with one statement (`FILES_DOCS_SQL`) into `batch.files`. `filesLink` still checks the
  view right per link, and `handleBatch` drops `batch.files` after the run.
- A batch with a write calls `db.warm('write')` after the token check.
- The first read joins the sign-in. When the first call of a batch is a plain read (`joinsFirstRead` in `core/runCall.ts`: a shared read with
  no preflight hook), `handleBatch` opens one read transaction, reads the office in it, and runs that call in it (`RunRequest.open`,
  `CallData.on`). Only the first call joins, and a failed first call rolls the transaction back. A server call never joins: it opens its own
  transactions, and a nested one is refused. `apiApp` turns the join on only with the real `runCall` and the real office read; a test that
  replaces either passes `joinFirst` itself. The office object has its own batch and no join.

## Errors to PostHog
- `core/insight.ts`: `insightLogger` wraps the console logger when `POSTHOG_KEY` is set. Each `error` line posts one `$exception` record
  through `requestHost().after`, so the answer never waits. A failed send is dropped. At most `SERVER_SENDS_PER_MINUTE` records go out in a
  minute. Only `name`, `error`, `personId` and `agentId` go out, never an input. The error text is cut, scrubbed and redacted. It sends no
  database write, so the outbox rule does not apply. The office object logger is not wired.

## Calls
- `core/serverCallMap.ts` holds every call the server runs: the shared calls of `src/api/sharedCalls.ts` plus the server calls.
- `calls/index.ts` lists the server-only calls (`SERVER_CALLS`) and the server hooks of shared calls (`SERVER_HOOKS`). A hook replaces the
  prototype `prepare` of the call.
- Daftra: the Daftra calls, the internal call `payments.daftraPaid` and the job step `daftra` are in `daftra/CLAUDE.md`.
- `chats.typing` saves nothing and takes no lock (`signal/CLAUDE.md`).
- `SERVER_EXCLUDED` (prototype only): `session.previewAs`, `session.setSimulateErrors`, `session.resetSampleData`, `files.get`. `runCall`
  answers `not_found` for them.
- `core/everyCall.ts` gives one input for every call, and a test runs each call once on the sample office. `EXPECTED_REFUSALS` lists the calls
  that must refuse: a change to `can()` can make one pass, so update the list. A test that needs a change uses `tasks.update` (a new title);
  `tasks.move` often changes nothing and sends no signal.

## Entries and bundles
- Each Supabase function imports only its own mount. Deno needs the bundle (no extensionless imports), so `npm run build:server` writes
  `supabase/functions/_build/{api,mcp,jobs}.js` and `dist-server/worker.js`. Edit `server/`, never the bundles.
- Workers (`entries/worker.ts`): one Db for each request, the database through the Hyperdrive binding `DB`. The region label is the public var
  `WORKER_REGION`: it is no AWS region name, so the MCP region hop never starts there. The first request after a build starts the key set
  load (`warmKeySet`) and hands it to `waitUntil`. Never `db.warm` there: the database belongs to one request.
- `wrangler.server.toml`: the top block is for local runs only (its Hyperdrive id is a placeholder). Only `[env.test]` and `[env.production]`
  deploy, as `madar-server-test` and `madar-server-production`. Bindings and vars do not inherit: repeat them in each env.
- Every answer carries `x-madar-server` (`entries/serverHeader.ts`): `supabase` on the three Deno entries, `workers;colo=<request.cf.colo>` on
  the Worker, also on a 404 and on the 503 of a failed start. The run place shows in the `cf-placement` answer header.
- `GET /api/health` names the region, the host, the file store and the call count. With the jobs secret it also runs the database check
  (`http/health.ts`).
- `wrangler dev` uses esbuild with no `import.meta.glob`, so server code reads word files with plain JSON imports (`workerGraph.test.ts`).
- The bundles run on the real office, so they hold no sample office and no `settleFuture` (it moves every later stamp to before now).
  `workerGraph.test.ts` checks that no entry loads `src/data/`, and `build:server` ends with `check-bundles.ts server`.
- `vite.server.config.ts` minifies the bundles with `output.keepNames: true`. The names matter: the jose and SDK error classes name
  themselves from their constructor, and check-bundles finds a leaked `settleFuture` by its name. `entries/bundles.test.ts` checks this.
- `entries/bundles.test.ts` bounds the size of the minified api bundle. A long text constant in `src/api` counts (the report guide is one).
  Raise the bound in the test with one history line.
- Supabase starts a new worker for almost each request and stops it after about 75 s. The platform does this, not our code (a probe with
  a plain `Deno.serve` shows the same rate; proof.md). Do not look for a code fix. So pools close an idle connection after 1 s
  (`IDLE_TIMEOUT_MS`, `data/sql.ts`), and each entry closes its pools on `beforeunload` (`closeOnUnload`, `entries/start.ts`). With the old
  120 s, the pooler client limit filled under the deploy suite and requests failed at once with `EMAXCONN` (a whole-batch 500).
- On Supabase only, `deno-api.ts` calls `lazyStart(...).warm()` at module start: it builds the app, starts the jose key set load and
  `db.warm('read')`, and waits for neither. It reads no office before the token check. A build that fails there stays silent; the first
  request logs it and answers 503.

## Ports
- `core/ports.ts`: Db, Clock, FilesPort, MailPort, SignalPort, AuthAdminPort, LivePort, TypingPort. Fakes in `test/fakes`.
- `Config.google`: all three variables or none; the server refuses to start with some (`google/CLAUDE.md`). `Deps.googleFetch` and
  `Deps.daftraFetch` are the fetches of test stubs; no test reaches Google or Daftra.
- `Config.daftra`: one account for each sub-company, read by name pattern (`daftra/CLAUDE.md`). `env.names()` lists the names of the host.
- `buildDeps` (`core/deps.ts`) reads the env. A missing variable gives an error that names the variable, never a value.

## Rules a change must keep
- Never write to the database outside `runCall` (or a server write call that copies its steps).
- Handlers stay synchronous and pure. Outside work goes through the outbox, written in the transaction of the call.
- A new effect kind needs `registerEffect`. Effects read the person again when they run. `push.notify` is the one effect that writes a
  State table (`push_devices`) outside `runCall` (`push/CLAUDE.md`).
- Lock order: the office lock, then the mail lock. The mail reserve takes only the mail lock, in its own transaction.
- A preflight hook does network work before the transaction and never holds the lock.
- Every network call has a 3 s timeout. Two documented exceptions: the Google calls of `google.connect` (a shared budget, `google/CLAUDE.md`)
  and each Daftra call, which has 10 s (`DAFTRA_TIMEOUT_MS`; `daftra/CLAUDE.md`). A Daftra call never runs under the office lock or inside a transaction.
- An effect or a job step that needs what a person may see runs a read call as that person: `(deps.runCall ?? runCall)(deps,
  { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } })`. It works on both databases
  (`push/line.ts`, `jobs/steps/meetings.ts`).
- Only `set local` on the pooler: `data/sql.ts` refuses a plain SET.
- Database TLS fails closed: TLS with the Supabase root CA (`DATABASE_CA`) for every host except loopback and the local Docker hosts. No
  `sslmode` in a URL.
- The client address is `cf-connecting-ip` on Supabase, and `x-madar-client-address` on the Worker (`clientAddress`, `auth/forgot.ts`):
  the Worker has no public address, and the Pages Function always writes that header. Never read `x-forwarded-for` or `true-client-ip`.

## Signals, jobs, office
- Signals go out inside the save transaction, and a private or hidden record tells only its people: `signal/CLAUDE.md`. The audience rule
  is `data/projectAudience.ts` (`mayViewProject`). Leak tests: `data/hiddenProjectSignalsRun.test.ts`, `core/chatSignalLeaks.test.ts`.
- The 15-minute job and its steps: `jobs/CLAUDE.md`. The office object, its Cron, hold, import and day cap: `office/CLAUDE.md`.
- There is no usage meter on Postgres. Kept: the Resend quota guard (`mail.quotaWarning`, `mail/quota.ts`), the job step `heartbeat`, the
  outbox retries, the tables `usage_month` and `usage_warnings` (nothing writes them; a drop needs the owner OK), and `usage_day` with the
  office day cap.

## Tests
- `npm test` runs the `server` project with the fakes. `npm run test:db` runs the rule tests again on the local Postgres. `npm run test:lite`
  runs them on node:sqlite (the SQLite path of the office object, no Docker). `npm run test:office` runs the office object on local workerd.
  `npm run smoke:office` checks the real office bundle. The integration suites: `MADAR_IT=1 npx vitest run --project it <files>`, one file at
  a time, on the full local stack (`npm run test:it`).
- The shadow run (`test/shadow.ts`) runs each API test in memory and on the database, and fails on any difference.
- `core/writeKinds.test.ts` pins a screen file, `src/app/writeKinds.ts`: it runs every write of `everyCall` on the sample office and the
  write sweep on the trap office (`data/loaders/sweep.ts`), in memory with `createRunCall`.

# Server

One Hono app in TypeScript. The same source runs on Supabase Edge Functions (Deno, pinned to eu-central-1) and on one
Cloudflare Worker for each copy (`wrangler.server.toml`: `madar-server-test`, `madar-server-production`, placed in
aws:eu-central-1). `config/server-host.json` says which host serves each copy (owner, 2026-10-16; `core/serverHost.ts`).
The other host stays deployed as the way back. Each area below has its own guide: `mcp/`, `auth/`, `data/`, `mail/`,
`files/`, `push/`.

## Folders
- `http/`: the batch route, CORS, the batch limits, the extra routes, health, the Pages forwarder of /mcp.
- `core/`: `runCall`, the ports, `buildDeps`, the office lock, idempotency, stories, effects, the call map.
- `calls/`: the server-only calls and the server hooks of 4 shared calls.
- `entries/`: one mount for each function (`api`, `mcp`, `jobs`), the shared host builder `apps.ts`, the Deno wrappers
  `deno-*.ts`, Workers `worker.ts` (the Postgres path) and `workerMain.ts` (the bundle entry, which also has the office path).
- `office/`: the office object of the Supabase exit (wave 3), off on every deployed Worker. See "The office object" below.
- `jobs/` (the 15-minute job), `signal/` (change signals), `usage/` (meters and the Admin warning), `push/` (browser push).
- `test/`: the fakes of the ports, the db-mode harness, the shadow run. `it/`: helpers of the integration suites.

## Request path
- `POST /api/batch` (`http/batch.ts`; on a Supabase function URL with `?forceFunctionRegion=eu-central-1`, on the Worker
  through the page's own `/api`): at most 12 entries, 256 KB, 1 overview call
  (`http/limits.ts`). An old `X-Madar-Build` gives 409 `client_outdated`. CORS allows only listed origins, never `*`.
- Extra routes (`http/routes.ts`) sit under the api app: `POST /auth/forgot` answers at `/api/auth/forgot`.
- The token check (`auth/verify.ts`): jose, ES256 only, issuer `${SUPABASE_URL}/auth/v1` (or `AUTH_ISSUER`). Never compare
  `aud` by hand. A token with `client_id` is an agent token: the api function refuses it with 403.
- `principalOf` (`auth/principal.ts`) finds the person by `auth_user_id`. The role comes from the users row, never from the
  token. A turned-off person gets 403 `account_off`.
- `runCall` (`core/runCall.ts`) for each entry: a read runs in a repeatable-read, read-only transaction with no lock. A write
  runs preflight outside the lock, then `set local lock_timeout 5s` and `statement_timeout 10s` (joined with BEGIN in one
  query, see `data/CLAUDE.md`), the office lock, the idempotency check, the story, the loader, `executeParsed`, the diff
  save, the outbox rows, the signals, the commit.
- After the commit, `processOutbox` runs the effects once. The 15-minute job retries the rest. `core/after.ts` keeps work
  alive after the answer on both hosts: on Supabase within the 150 s of the function, on the Worker through waitUntil for
  about 30 s after the answer. A long mail or push chain can stop part way there; the 15-minute job retries the outbox.
- The kinds in `AFTER_ANSWER_KINDS` (`core/effects.ts`: `mail.notice`, `mail.quotaWarning`, `usage.limitWarning`, `push.notify`) run after
  the answer when the host has `after`, on one chain per batch (`BatchScope.mail`), so the mails keep the order of the
  entries. Every other kind runs before the answer. With no `after` (tests, scripts), every kind runs before the answer. A
  new mail or push kind goes into `AFTER_ANSWER_KINDS`; `effects.test.ts` pins the names (performance audit 2026-10-07).
- The screens depend on two facts of this path (performance audit FET-3). `http/batch.ts` runs the calls of a request one
  after the other, and a write clears `batch.office` (`core/runCall.ts`), so a read after a write in the same request sees
  the write. A change that runs the reads of a request in parallel, or keeps the office copy across a write, lets a screen
  show an old list after its own save. Adjacent `files.link` entries are the one exception: reads only, side by side.
- With `after`, the usage meter of `POST /api/batch` also runs after the answer, with the same warning text. A batch with a
  write calls `db.warm('write')` after the token check. Adjacent `files.link` entries run side by side, each with its own
  error, and the answers keep their order. Every other entry runs alone, in order.

## Calls
- `core/serverCallMap.ts` holds every call the server runs: the shared calls of `src/api/sharedCalls.ts` plus the server calls.
- 11 server-only calls (`calls/index.ts`): `story.start`, `files.uploadStart`, `files.link`, `feedback.uploadStart`,
  `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove`, `usage.get`, `usage.retryEffect`, `live.ticket`.
- Server hooks replace the prototype `prepare` of `files.upload`, `feedback.send`, `feedback.screenshot`, `projects.delete`.
- `SERVER_EXCLUDED` (prototype only): `session.previewAs`, `session.setSimulateErrors`, `session.resetSampleData`, `files.get`.
  runCall answers `not_found` for them.
- `core/everyCall.ts` gives one input for every call. A test runs each call once on the sample office. On a fresh sample
  office some entries change nothing: `tasks.move` moves `tsk_007` to `in_progress`, which is its status already, so it sends
  no signal. A test that needs a change uses the `tasks.update` entry (a new title).
- `EXPECTED_REFUSALS` there lists the calls that must refuse in that run. A change to `can()` can make one
  pass: update the list.

## Entries and bundles
- Each Supabase function imports only its own mount. Deno needs the bundle (no extensionless imports), so
  `npm run build:server` writes `supabase/functions/_build/{api,mcp,jobs}.js` and `dist-server/worker.js`.
  Edit `server/`, never the bundles.
- Workers (`entries/worker.ts`): one Db for each request, the database through the Hyperdrive binding `DB`. The region
  label is the public var `WORKER_REGION` (`workers-eu-central-1`): it is no AWS region name, so the MCP region hop never
  starts there. The first request after a build starts the key set load (`warmKeySet`) and hands it to waitUntil. Never
  `db.warm` there: the database belongs to one request.
- Every answer carries `x-madar-server` (`entries/serverHeader.ts`): `supabase` on the three Deno entries,
  `workers;colo=<request.cf.colo>` on the Worker, also on a 404 and on the 503 of a failed start. The colo is the data center
  where the request came in; the run place shows in the `cf-placement` answer header.
- `GET /api/health` names the region, the host (`workers` or `supabase`), the file store and the call count. With the jobs
  secret it also runs the database check (`http/health.ts`).
- `wrangler dev` uses esbuild with no `import.meta.glob`, so server code reads word files with plain JSON imports
  (`workerGraph.test.ts` checks it).
- The bundles run on the real office, so they hold no sample office and no `settleFuture` (it moves every later stamp to
  before now). `workerGraph.test.ts` checks that no entry loads `src/data/`, and `build:server` ends with
  `check-bundles.ts server`. The prototype runtime gives the sample office to `session.resetSampleData`.
- `vite.server.config.ts` minifies the four bundles with `output.keepNames: true`. The names matter: the jose and SDK
  error classes name themselves from their constructor, and check-bundles finds a leaked `settleFuture` by its name.
  `entries/bundles.test.ts` checks this on fixtures.
- Supabase serves each request with a new worker: about one cold start for each request, each worker lives 75 s and then
  stops (`EarlyDrop`), and none takes a second request (function logs of madar-test, 2026-10-16). So the pools close an idle
  connection after 1 s (`IDLE_TIMEOUT_MS`, `data/sql.ts`), and each entry also closes its pools on `beforeunload`
  (`closeOnUnload`, `entries/start.ts`). With the old 120 s, about 85 workers under the deploy suite held up to 2 pooler
  clients each, the client limit of the pooler (200) filled, and requests failed at once with `EMAXCONN` (a whole-batch 500).
- On Supabase only, `deno-api.ts` calls `lazyStart(...).warm()` at module start: it builds the app, starts the jose key set
  load (`warmKeySet`, `auth/verify.ts`) and `db.warm('read')`, and waits for neither. It reads no office before the token
  check. A build that fails there stays silent; the first request logs it and answers 503.

## Ports
- `core/ports.ts`: Db, Clock, FilesPort, MailPort, SignalPort, AuthAdminPort, MeterPort. Fakes in `test/fakes`.
- `buildDeps` (`core/deps.ts`) reads the env. A missing variable gives an error that names the variable, never a value.

## Rules a change must keep
- Never write to the database outside `runCall` (or a server write call that copies its steps).
- Handlers stay synchronous and pure. Outside work goes through the outbox, written in the call's transaction.
- A new effect kind needs `registerEffect`. Effects read the person again when they run. `push.notify` is the one effect that
  writes a State table (`push_devices`) outside `runCall` (`push/CLAUDE.md`).
- Lock order: the office lock, then the mail lock. The mail reserve takes only the mail lock, in its own transaction.
- A preflight hook does network work before the transaction and never holds the lock.
- Every network call has a 3 s timeout.
- Only `set local` on the pooler: `data/sql.ts` refuses a plain SET.
- Database TLS fails closed: TLS with the Supabase root CA (`DATABASE_CA`) for every host except loopback and the local
  Docker hosts. No `sslmode` in a URL.
- The client address is `cf-connecting-ip` on Supabase, and `x-madar-client-address` on the Worker (`clientAddress`,
  `auth/forgot.ts`): the Worker has no public address, and the Pages Function always writes that header. Never read
  `x-forwarded-for` or `true-client-ip`.

## Realtime, jobs, usage
- Change signals go out inside the save transaction (`signal/realtime.ts`: `realtime.send`, topics `office` and
  `person:<id>`). A rollback sends nothing. A failed send only warns, and the sender counts it.
- A save that changes an office task, its comments or its files (`Diff.privateChange`, `data/save.ts`) sends that part
  only as a person signal, with its own id and no `actorId` or `storyId`, to each person of the task (maker, lead,
  helpers, before and after) and each active Admin. The office signal tells only the project part (`Diff.publicKinds`),
  with its names, and a save of office tasks alone sends none (review 2026-10-06). The Realtime rules need no change: the
  server sends on any `person:` topic, and each person reads only their own.
- pg_cron calls `jobs/run` of the Supabase jobs function every 15 minutes, in both host settings (owner, 2026-10-16), with the
  secret header `x-madar-jobs-secret`. The Worker keeps `/jobs` mounted, but nothing calls it: pg_cron and the Vault
  `project_url` do not change. Steps (`jobs/steps/`):
  heartbeat, triggers, summary, outbox, cleanup, uploads, usage. Each step is idempotent.
- Usage meters and the 80% Admin warning (`usage/`). The free-plan limits are in `FREE_PLAN_LIMITS`. The calls limit follows
  the host that serves the copy (`config.servingHost`, from `config/server-host.json`): 500,000 on Supabase, 10 million on
  Workers Paid (`CALL_LIMITS`, `core/ports.ts`). On the Worker the calls meter is `callsWorkers` in the warning mail, and the
  screen picks its words by the limit, as it picks `filesR2`. The job on Supabase and `usage.get` on the Worker give the same
  limit, because both read the setting, not the running host.
- On the office object only, the 80% warning also covers the four Free day meters: rows read, rows written, object requests
  and Worker requests (`DAY_LIMITS` and `checkDayLimits`, `usage/warn.ts`), one warning a UTC day for each meter.

## The office object (Supabase exit, wave 3)
- Off on every deployed Worker: the office path runs only with the binding `OFFICE` and the var `MADAR_DATA = "office"`
  (`entries/officeEntry.ts`, `onOffice`). The bundle entry is `entries/workerMain.ts`; `entries/worker.ts` stays the Postgres path.
- The Worker checks the build, the body and the token, then gives the whole batch to the object in one RPC call
  (`entries/officeWorker.ts`). The object runs `runCall` on SQLite for each entry, one after the other, and answers JSON text. The
  mails and pushes run after the answer in one more call (`runEffects`). An overloaded or reset object answers the reason `busy`.
- The object does no network work. Each call gets a `WorkerNet` (`office/workerNet.ts`, an `RpcTarget`) and the object calls it
  back for file links, R2, Resend and the push POST (`office/net.ts`). The port refuses a call inside a transaction and stops at 45
  network calls for each object call (`NetBudgetSpent`: the outbox row waits a minute and keeps its attempt).
- Signals go out on the object sockets after the commit (`office/live.ts`, tags `office` and `person:<id>`). The socket opens with
  `live.ticket` (60 s, one use, in memory). Each delivery and each Cron run close a socket with no pong for 150 s; the commit that
  turns a person off closes that person's sockets.
- The Cron Trigger (`[triggers]`, every 15 minutes, UTC) gives the job steps to the object in one call (`office/jobs.ts`); the
  usage step runs in the first run of each hour. A Worker without `MADAR_DATA` returns at once. After the steps, the same call adds
  the meter counts, checks the day meters, sweeps the sockets and gives back the day row.
- The office meter (`office/meter.ts`) keeps the day counts in memory and adds them in the next write (`usage_day`); the 80% mail
  covers the four Free day meters (`usage/warn.ts`, `checkDayLimits`).
- On the year office one Cron run reads about 1,500 rows, and the first run of an hour about 14,700: the file size sum
  (`FILES_BYTES_LITE`, `usage/meters.ts`) reads one row for each file and one for each version. That is about 460,000 rows a
  day of the 5 million of Free (`CRON_PINS`, `office/test/pins.ts`).
- Tests: `office/{net,meter,live,parts}.test.ts` on node:sqlite; `office/{batch,socket,cron}.wd.test.ts` on local workerd with the
  test Worker of `office/test/live/`; `npm run smoke:office` for the real bundle.

## Tests
- `npm test` runs the `server` project with the fakes. `npm run test:db` runs the rule tests again on the local Postgres.
- `npm run test:lite` runs the rule tests again on node:sqlite (the SQLite path of the office object, no Docker). `npm run
  test:office` runs the office object on local workerd: the host checks, `everyCall` on the sample office, and the rows pins
  on one year of data (`server/office/test/pins.ts`). workerd refuses to evict an object while Node holds a stub to it, and
  the miniflare proxy frees a stub only after Node collects it: a test that evicts calls that object only through fetch
  (`officeByFetch` in `server/office/test/harness.ts`).
- The shadow run (`test/shadow.ts`) runs each API test in memory and on the database, and fails on any difference.
- `core/writeKinds.test.ts` pins a screen file, `src/app/writeKinds.ts`: it runs every write of `everyCall` on the sample
  office and the write sweep on the trap office (`data/loaders/sweep.ts`), in memory with `createRunCall`.
- Integration: `MADAR_IT=1 npx vitest run --project it <files>`, one file at a time, on the full local stack.

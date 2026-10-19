# Server

One Hono app in TypeScript. The same source runs on Supabase Edge Functions (Deno, pinned to eu-central-1) and on one
Cloudflare Worker for each copy (`wrangler.server.toml`: `madar-server-test`, `madar-server-production`, placed in
aws:eu-central-1). `config/server-host.json` says which host serves each copy (owner, 2026-10-16; `core/serverHost.ts`):
`supabase`, `workers`, or `office` (the office object; exit wave 4, the test copy only until wave 6, `OFFICE_COPIES_OPEN`).
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
- Extra routes (`http/routes.ts`) sit under the api app: `POST /auth/forgot` answers at `/api/auth/forgot`. `GET /google/callback` (fbk_022,
  `google/callback.ts`) has no sign-in, reads no database and writes nothing: it checks the signed state and answers 302 to
  `<APP_URL>/settings#google=<word>` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. On the office path it answers `#google=not_ready`
  and calls no object (`entries/officeSignin.ts`). The Pages forwarder passes it with its query and its 302 as they are.
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
- The kinds in `AFTER_ANSWER_KINDS` (`core/effects.ts`: `mail.notice`, `mail.quotaWarning`, `usage.limitWarning`, `push.notify`, `gcal.sync`, `gcal.revoke`) run after
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
- 15 server-only calls (`calls/index.ts`): `story.start`, `files.uploadStart`, `files.link`, `feedback.uploadStart`,
  `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove`, `usage.get`, `usage.retryEffect`, `live.ticket`, and the four Google
  Calendar calls `google.status`, `google.connectStart`, `google.connect`, `google.disconnect` (fbk_022, `calls/google.ts`, `server/google/`).
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
- `Config.google` (fbk_022): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MADAR_GOOGLE_KEY`, all three or none (`google/keys.ts`; the server refuses to
  start with some and names the absent ones). `Deps.googleFetch` is the fetch of a test stub; no test reaches Google (`google/fakeGoogle.ts`).
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

## Google Calendar (fbk_022, owner 2026-10-19)
- One way: Madar writes each meeting to the calendar "Madar" of each connected person who is its organizer or an attendee. A change in Google never comes
  back. Each person connects once in Settings (`google.connectStart`, the Google screen, the callback, `google.connect`; see `src/api/CLAUDE.md`). The
  scope is only `calendar.app.created`: Madar makes its own calendar and writes only there. Code: `server/google/` (`api.ts` the Google calls with a 3 s
  limit, `keys.ts` the seal, `state.ts` the signed state with the PKCE verifier, `store.ts` the two tables, `sync.ts`, `rows.ts`, `register.ts`).
- The producers (`rows.ts`): after the save of `meetings.create`, `meetings.update`, `meetings.cancel`, `events.undo`, `events.undoStory` and
  `projects.delete` (`GCAL_CALLS`), `gcalRows` writes one `gcal.sync { userId, meetingId }` for each connected organizer or attendee (state ok or
  not_synced) and each person who has a Google event for a touched meeting (`SaveResult.meetingIds`, set by `data/save.ts`). `users.remove` writes
  one `gcal.revoke { connectionId }` for the live connection. They run in the transaction of the call, and only when the save touched a meeting.
- The effects (`sync.ts`) run after the answer (`AFTER_ANSWER_KINDS`) and write only `google_connections` and `google_events`, server-only rows (as the
  mail effects write `mail_log`): no event, no signal, no State table. `gcal.sync` reads again when it runs: the live connection, the person, the meeting
  and the event row. The event id is the hex of `madar:<meeting id>` (`eventIdOf`); the body has exactly the title, the place, the start, the end and the
  status (`eventBodyOf`, owner Q2). The access token lives in memory only, for the life of the isolate, until 60 seconds before it ends; a 401 drops it
  and tries once more.
- Errors: `grant_gone`, a seal that does not open, or a deleted calendar (404 on an insert) ends the connection (state `broken`, the token is deleted at
  once, the event rows go) and the row is done. A timeout, a network error, a 5xx or a rate limit sets `not_synced` and throws, so the outbox tries again
  (5 times, then the Admin sees the row in Usage). Any other refusal sets `not_synced` with `last_error` `refused` and does not retry. An error text, a
  log line and an outbox error hold the code and the ids, never a token, a code, a title or a Google answer (`leaks.test.ts` proves it).
- `gcal.revoke` takes the refresh token back at Google (a 400 counts as done) and deletes the row. A row that a new connect replaced (`replaced: true`)
  makes no call to Google: its grant is the grant of the new row, and a revoke could take that grant back. The cleanup step deletes every `revoking` row
  older than one day, so a sealed token never stays long in the database. The connect backfills the meetings of the next 60 days, at most 200; a long
  chain can stop part way on the Worker (about 30 s after the answer), and the 15-minute job retries the rest.
- Tests use `google/fakeGoogle.ts` (a stand-in for the token address, the revoke address and the Calendar API) behind `Deps.googleFetch`, and
  `google/testOffice.ts` (the sample office on node:sqlite). `server/it/google.it.test.ts` runs the SQL on Postgres.

## Realtime, jobs, usage
- Change signals go out inside the save transaction (`signal/realtime.ts`: `realtime.send`, topics `office` and
  `person:<id>`). A rollback sends nothing. A failed send only warns, and the sender counts it.
- A save that changes an office task, its comments or its files (`Diff.privateChange`, `data/save.ts`) sends that part
  only as a person signal, with its own id and no `actorId` or `storyId`, to each person of the task (maker, lead,
  helpers, before and after) and each active Admin. The office signal tells only the project part (`Diff.publicKinds`),
  with its names, and a save of office tasks alone sends none (review 2026-10-06). The Realtime rules need no change: the
  server sends on any `person:` topic, and each person reads only their own.
- A save that changes a meeting with no project, its notices or its events (fbk_022, owner 2026-10-19; `officeMeetings` in `data/save.ts`) is
  private in the same way: its signals are person signals with no names, to the organizer (the person behind an agent) and the attendees,
  before and after the change. The Admin gets one only as one of those people. A save that touches office tasks and a private meeting
  sends the union of the two groups (the signal tells only kinds). `server/core/meetingsSignal.test.ts` proves it.
- A save that touches only chats with no project (a direct chat or a group: kinds `messages`, `conversations`, `chatReads`,
  `notifications`; `Diff.anonymous`) sends its office signal with no `actorId` and no `storyId`, so another browser learns that
  somebody wrote, and not who (UX audit 2026-10-19, INT-16). A save that also touches a project keeps the names.
- pg_cron calls `jobs/run` of the Supabase jobs function every 15 minutes, in both host settings (owner, 2026-10-16), with the
  secret header `x-madar-jobs-secret`. The Worker keeps `/jobs` mounted, but nothing calls it: pg_cron and the Vault
  `project_url` do not change. Steps (`jobs/steps/`):
  heartbeat, triggers, summary, outbox, cleanup, uploads, usage. Each step is idempotent. The triggers step also sends `resume_due`
  (the planned restart day of a paused project) to the leader and to the person who paused it (`src/api/CLAUDE.md`).
- Usage meters and the 80% Admin warning (`usage/`). The free-plan limits are in `FREE_PLAN_LIMITS`. The calls limit follows
  the host that serves the copy (`config.servingHost`, from `config/server-host.json`): 500,000 on Supabase, 10 million on
  Workers Paid, 3 million on the office host (`CALL_LIMITS`, `core/ports.ts`). The office host sends no month calls warning: the
  day meters below cover its Free limit (`warningMeters`). On the Worker the calls meter is `callsWorkers` in the warning mail, and the
  screen picks its words by the limit, as it picks `filesR2`. The job on Supabase and `usage.get` on the Worker give the same
  limit, because both read the setting, not the running host.
- On the office object only, the 80% warning also covers the four Free day meters: rows read, rows written, object requests
  and Worker requests (`DAY_LIMITS` and `checkDayLimits`, `usage/warn.ts`), one warning a UTC day for each meter.

## The office object (Supabase exit, wave 3)
- Off on every deployed Worker: the office path runs only with the binding `OFFICE` and the var `MADAR_DATA = "office"`
  (`entries/officeEntry.ts`, `onOffice`). The bundle entry is `entries/workerMain.ts`; `entries/worker.ts` stays the Postgres path.
  Exit wave 4: the office ops under `/api/office/` go to the office path whenever the binding exists (`servesOffice`,
  `entries/officeWorker.ts`), so the import of wave 5 reaches the object before the word changes. The Cron still needs `onOffice`.
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
- The sign-in on the office object (the merge of exit waves 2 and 3): the object deps take `liteAuthAdmin`, so the invite and
  auth effects run in the object and only their mail goes through the Worker. With `MADAR_AUTH_PRIVATE_JWK`, `officeEntry` mounts
  the routes of `ownApiRoutes` under `/api` (`entries/officeSignin.ts`): each step is one call of `Office.signin`. The forgot and
  renew routes run their limits in `Office.mailRoute` and their mail after the answer in `Office.mailWork`; the Worker pads the
  answer to 1.5 s. A copy with the key also needs `MCP_URL`: it is the issuer of the own tokens. The Cron runs `cleanupSignin`
  in its first run after 00:00 UTC (the step `signin`, `office/jobs.ts`).
- `/mcp` on the office path: the Worker hands each request to `Office.mcp` in one call, and the object runs the MCP app there (the
  own agent token check, `liteAgentOf`, `mountOAuth`). Each tool call runs on the batch path (`runOfficeEntries`, the who kind
  `agent` of `office/who.ts`); its mails and pushes run after the answer (`runEffects`). With no key, `/mcp` answers 503.
- A batch reports an office change when any entry cleared `batch.office` (`runOfficeEntries`), so a turn-off with a read after it
  still closes the sockets of that person.
- The hold (exit wave 4, `office/ops.ts`, `OfficeHold`, in memory): an export holds the office for at most 5 minutes, an import
  for at most 30. An export refuses a batch with a write (reason `busy`, "Madar saves its nightly backup"), a request of `/mcp`
  itself (503) and the Cron steps; reads, the sign-in steps, forgot, renew and the OAuth routes under `/mcp/` run, because their
  rows are the drift tables (`DRIFT_TABLES`). An import refuses every call, step and mail route, and the effects wait for the
  Cron. `Office.fetch` sends `/office/*` to `parts.ops`: `export` (begin, pages of at most 1,000 rows in rowid order, end with
  the version and `office_seq` of the begin) and `peek` (one select, at most 200 rows, only with `testToolsOn`). `/office/drop`
  deletes the storage of a spare object named `rehearsal-YYYYMMDD` only; that object takes no request after it.
- The import (exit wave 4, `office/import.ts`, `/office/import`): begin (mode `empty`, `resume`, or `replace` with `testToolsOn`
  only) takes the hold of an import; each part (at most 2,000 rows of one records table) is one transaction, and a part whose
  first row is there already is skipped, so a client may send it again. The finish writes the server rows and the sign-in rows,
  adds the meters (the day row keeps the rows of the import), and raises the version above the object and the source, so no held
  office list looks current; then every socket closes. A replace also deletes the snapshot and raises the version.
- The ops routes of the Worker (exit wave 4, `entries/officeWorker.ts`): `POST /api/office/export|import|peek|drop?office=<name>`,
  before CORS and Hono. Each one checks its secret header with `sameSecret` first: `x-madar-export-secret` (`MADAR_EXPORT_SECRET`,
  the nightly GitHub export) for `export`, `x-madar-ops-secret` (`MADAR_OPS_SECRET`, the Mac) for the others; a copy with no
  secret answers 401. Then the name: `export` and `import` take `office` or a rehearsal name, `peek` only `office`, `drop` only a
  rehearsal name (403 else). The body goes on to the object as a stream, with the name in `x-madar-office-name`.
- The test tools (`replace`, `peek`) need `MADAR_TEST_TOOLS = "on"` and refuse a production copy (`testToolsOn`); only
  `[env.test.vars]` of `wrangler.server.toml` sets it. The test seed (`scripts/office/seed.ts`) replaces the office through them:
  the sample office of today and the 4 accounts with PBKDF2 hashes, about 6,200 rows written for each seed (908 records).
- The day cap of the test Worker (exit wave 4, `office/cap.ts`, `MADAR_DAY_CAP`, owner decision 6 form A: half of each Free day
  limit, `[env.test.vars]` only): over the rows written a write batch and a request of `/mcp` itself get `busy`; over the rows
  read or the requests every batch, sign-in step, forgot, renew and MCP request gets `busy` ("It works again at 03:00 Riyadh").
  The object reads the day counts again at most once a minute (`DAY_CAP_TTL_MS`) and at each new UTC day. The Cron, the effects
  and the ops are never capped.
- Tests: `office/{net,meter,live,parts,who,routes,ops,import,cap}.test.ts` on node:sqlite (`office/test/nodeOffice.ts`: the parts with a new own
  key, and `route`, which sends one request through the real Worker routes into the object); `office/{batch,socket,cron,mcp,ops}.wd.test.ts` on local workerd
  with the test Worker of `office/test/live/`; `entries/{officeWorker,officeSignin}.test.ts`; `npm run smoke:office` for the real
  bundle (10 checks, with a key made for the run).

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

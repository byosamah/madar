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
- `jobs/` (the 15-minute job), `signal/` (change signals), `push/` (browser push). The usage meter, the 80% warning and the Usage screen were removed (owner, 2026-10-23: an internal tool, not paid).
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
- The kinds in `AFTER_ANSWER_KINDS` (`core/effects.ts`: `mail.notice`, `mail.quotaWarning`, `push.notify`,
  `push.chat`, `mail.chatNotice`, `gcal.sync`, `gcal.revoke`, `gcal.tidy`) run after the answer when the host has `after`, on one chain per batch
  (`BatchScope.mail`), so the mails keep the order of the entries. Every other kind runs before the answer. With no `after` (tests,
  scripts), every kind runs before the answer. A new mail or push kind goes into `AFTER_ANSWER_KINDS`; `effects.test.ts` pins the
  names (performance audit 2026-10-07). The kinds in `WAITED_KINDS` (`push.chat`, `mail.chatNotice`) wait `CHAT_WAIT_MS` (10 s)
  after the answer on a chain of their own, so the server can skip a person who read the chat (design item 20). The office object
  runs them with no wait (exit-handoff section 10).
- The screens depend on two facts of this path (performance audit FET-3). `http/batch.ts` runs the calls of a request one
  after the other, and a write clears `batch.office` (`core/runCall.ts`), so a read after a write in the same request sees
  the write. A change that runs the reads of a request in parallel, or keeps the office copy across a write, lets a screen
  show an old list after its own save. Adjacent `files.link` entries are the one exception: reads only, side by side.
- A batch with a
  write calls `db.warm('write')` after the token check. Adjacent `files.link` entries run side by side, each with its own
  error, and the answers keep their order. Every other entry runs alone, in order.

## Calls
- `core/serverCallMap.ts` holds every call the server runs: the shared calls of `src/api/sharedCalls.ts` plus the server calls.
- 14 server-only calls (`calls/index.ts`): `story.start`, `files.uploadStart`, `files.link`, `feedback.uploadStart`,
  `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove`, `live.ticket`, and the four Google
  Calendar calls `google.status`, `google.connectStart`, `google.connect`, `google.disconnect` (fbk_022, `calls/google.ts`, `server/google/`), and `chats.typing` (chat presence design B, `calls/typing.ts`): it saves nothing,
  takes no lock, and sends a typing signal (`TypingPort`, `server/signal/typing.ts`, event `typing` on `person:<id>`) to the other members of the chat.
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
- `entries/bundles.test.ts` bounds the minified api bundle (850,000 characters since 2026-10-21). A long text constant in `src/api`
  counts (the report guide: about 17,000). Raise the bound with one history line in the test.
- Supabase serves each request with a new worker: about one cold start for each request, each worker lives 75 s and then
  stops (`EarlyDrop`), and about 5 calls in 100 reach a worker that already served one (function logs of madar-test,
  2026-10-16). The platform does this, not our code: a probe function with a plain `Deno.serve` and no code of ours gets the
  same rate as the real api bundle (probe on madar-test, 2026-10-21, proof.md). Do not look for a code fix for the cold start.
  So the pools close an idle
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
- An effect or a job step that needs what a person may see runs a read call as that person: `(deps.runCall ?? runCall)(deps,
  { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } })`. It works on both databases
  (`server/push/line.ts`, `jobs/steps/meetings.ts`). The one exception: the Google calls of `google.connect` share a budget of 15 s, at most 10 s
  for one call (`GOOGLE_CONNECT_BUDGET_MS`, `GOOGLE_CONNECT_CALL_MS`; fbk_033), because the person waits on the screen and the first call
  took about 3 s on production. The budget and the 3 s revoke of a failure stay under the 20 s of the screen.
- Only `set local` on the pooler: `data/sql.ts` refuses a plain SET.
- Database TLS fails closed: TLS with the Supabase root CA (`DATABASE_CA`) for every host except loopback and the local
  Docker hosts. No `sslmode` in a URL.
- The client address is `cf-connecting-ip` on Supabase, and `x-madar-client-address` on the Worker (`clientAddress`,
  `auth/forgot.ts`): the Worker has no public address, and the Pages Function always writes that header. Never read
  `x-forwarded-for` or `true-client-ip`.

## Google Calendar (fbk_022, owner 2026-10-19)
- One way: Madar writes each meeting to the calendar "Madar" of each connected person who is its organizer or an attendee. A change in Google never comes
  back. Each person connects once in Settings (`google.connectStart`, the Google screen, the callback, `google.connect`; see `src/api/CLAUDE.md`). The
  scope is only `calendar.app.created`: Madar makes its own calendar and writes only there. Code: `server/google/` (`api.ts` the Google calls with a 3 s (a 15 s budget in a connect)
  limit, `keys.ts` the seal, `state.ts` the signed state with the PKCE verifier, `store.ts` the three tables, `sync.ts`, `rows.ts`, `register.ts`).
- One calendar for each person (owner test 2026-10-20: Disconnect, then Connect made a second calendar "Madar" with the same meetings at two times). The scope
  reaches every calendar that Madar made, also with the token of a newer link, but it cannot list calendars (`users/me/calendarList` gives 403). So Madar
  remembers the calendar id in `google_calendars` (one row for each person). Each connect that gets a calendar id upserts the row in the transaction that inserts
  the connection (`rememberCalendar`; the row changes only when the id changes). Before it makes a calendar, `google.connect` reads the row and asks Google for
  that calendar with the new access token (`getCalendar`, GET `calendars/<id>`): 200 uses it and writes one `gcal.tidy { userId }` row after the sync rows;
  404 or 410 (the person deleted it in Google) makes a new calendar and updates the row; any other answer (timeout, network error, 5xx, 429, 401, 403) ends the
  connect with `google_unreachable`, takes the new grant back, and makes no calendar, so the person presses Connect again. A disconnect keeps the row on purpose;
  `users.remove` deletes it in its transaction (`revokeRowsOf`). A person who connects with another Google account gets 404 for the old id and a new
  calendar: Google answers 404 for a calendar that the account cannot see (probe with the owner's link on the test copy, 2026-10-20).
- The producers (`rows.ts`): after the save of `meetings.create`, `meetings.update`, `meetings.cancel`, `meetings.extend`, `events.undo`, `events.undoStory` and
  `projects.delete` (`GCAL_CALLS`), `gcalRows` writes one `gcal.sync { userId, meetingId }` for each connected organizer or attendee (state ok or
  not_synced) and each person who has a Google event for a touched meeting (`SaveResult.meetingIds`, set by `data/save.ts`); it asks the database only
  when the save touched a meeting. The producer of `users.remove` (`revokeRowsOf`) sets the live connection of the person to `revoking` (`startRevoking`,
  at the time of the call), deletes the `google_events` rows of the person, and writes one `gcal.revoke { connectionId }` (security fix, 2026-10-19): so a
  revoke that fails leaves no live token of a removed person, and the cleanup step deletes the row after one day. A person who is only turned off keeps
  the connection (plan decision 11). The producers run in the transaction of the call; `runCall` gives each producer the time of the call (`at`).
- The effects (`sync.ts`) run after the answer (`AFTER_ANSWER_KINDS`) and write only `google_connections` and `google_events`, server-only rows (as the
  mail effects write `mail_log`): no event, no signal, no State table. `gcal.sync` reads again when it runs: the live connection, the person, the meeting
  and the event row. The event id is the hex of `madar:<meeting id>` (`eventIdOf`); the body has exactly the title, the place, the start, the end and the
  status (`eventBodyOf`, owner Q2). The access token lives in memory only, for the life of the isolate, until 60 seconds before it ends; a 401 drops it
  and tries once more.
- Errors: `grant_gone`, a seal that does not open, or a deleted calendar (404 on an insert) ends the connection (state `broken`, the token is deleted at
  once, the event rows go) and the row is done. A timeout, a network error, a 5xx or a rate limit sets `not_synced` and throws, so the outbox tries again
  (5 times, then the row stays failed in the outbox; no screen lists it since the Usage section went, 2026-10-23). Any other refusal sets `not_synced` with `last_error` `refused` and does not retry. An error text, a
  log line and an outbox error hold the code and the ids, never a token, a code, a title or a Google answer (`leaks.test.ts` proves it).
- A connect that a Google step ends writes one warn line, "A Google Calendar connect failed.", with `userId`, `step` (`token`, `calendar_read`,
  `calendar_make`), `code` (the GoogleError code, or `no_refresh_token`, `scope_missing`) and `status` (the HTTP status, absent for a timeout or a
  network error) (fbk_033, 2026-10-20: production answered `google_unreachable`, and no line said which call failed). The answer to the person does not change.
- `gcal.revoke` takes the refresh token back at Google (a 400 counts as done) and deletes the row. A row that a new connect replaced (`replaced: true`)
  makes no call to Google: its grant is the grant of the new row, and a revoke could take that grant back. The cleanup step deletes every `revoking` row
  older than one day, so a sealed token never stays long in the database. The connect backfills the meetings of the next 60 days, at most 200; a long
  chain can stop part way on the Worker (about 30 s after the answer), and the 15-minute job retries the rest.
- `gcal.tidy` (`tidyOne`, `sync.ts`) runs after the backfill rows of a connect that reused a calendar. The old events of Madar are still in it: the disconnect
  deleted the `google_events` rows, so the backfill writes each meeting again (an insert that finds its id becomes an update, `putEvent`), which sets the
  right time. The tidy lists the events of the calendar from now on (`listEvents`: `singleEvents`, 250 in a page, at most 4 pages), then reads its keep set
  (after the list, so an event that sync writes meanwhile is never taken for a stale one): the event ids of the meetings in the backfill set of the person
  (`backfillMeetingIds`: the next 60 days, at most 200) and the event ids in the `google_events` rows of the person. It deletes every other event whose id
  starts with `MADAR_EVENT_PREFIX` (the hex of `madar:mtg_`). It never deletes an event without that prefix. It writes no row: the `google_events` rows come
  only from `gcal.sync`. A revoked grant, a 401 after a new access token, a seal that does not open, a calendar that is gone or a refusal ends it quietly (the next
  sync finds the same fault and ends the connection as today); a timeout, a network error, a 5xx or a 429 throws, and the outbox tries again.
- Tests use `google/fakeGoogle.ts` (a stand-in for the token address, the revoke address and the Calendar API) behind `Deps.googleFetch`, and
  `google/testOffice.ts` (the sample office on node:sqlite). `server/it/google.it.test.ts` runs the SQL on Postgres.

## Realtime, jobs
- Change signals go out inside the save transaction (`signal/realtime.ts`: `realtime.send`, topics `office` and
  `person:<id>`). A rollback sends nothing. A failed send only warns, and the sender counts it.
- A save that changes an office task, its comments or its files (`Diff.privateChange`, `data/save.ts`) sends that part
  only as a person signal, with its own id and no `actorId` or `storyId`, to each person of the task (maker, lead,
  helpers, before and after) and each active holder of `task.officeAll` (the Admin holds it; `rightsOf` reads the roles of the saved state). The office signal tells only the project part (`Diff.publicKinds`),
  with its names, and a save of office tasks alone sends none (review 2026-10-06). The Realtime rules need no change: the
  server sends on any `person:` topic, and each person reads only their own.
- Typing (`chats.typing`, a server-only read with no lock, `calls/typing.ts`) checks the chat with `typingRecipients` and sends through
  `Deps.typing`: `signal/typing.ts` (`realtime.send` with the event `typing` on `person:<id>` of each other member; it never throws) on
  Supabase and Workers, and `officeTyping` on the office object. The screens' change listener takes only the event `changed`.
- Status needs no server code on Supabase: each person's screens track on the Presence topic `status:<id>`
  (`20261022000200_platform_presence.sql`). A dead socket leaves after 49 to 66 s, a closed one after about 3 s (`proof.md`).
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
  heartbeat, triggers, meetings, summary, outbox, cleanup, uploads. Each step is idempotent. The triggers step also sends `resume_due`
  (the planned restart day of a paused project) to the leader and to the person who paused it (`src/api/CLAUDE.md`).
- The meetings step (fbk_022, wave 2; `jobs/steps/meetings.ts`) settles the meetings that ended. One read (`SETTLE_SQL`, `SETTLE_LITE`, served by the
  partial index `meetings_to_settle`) gives at most 20 due meetings, the oldest end first: scheduled, not settled, ended in the last 14 days. For each
  one the step runs the normal call `meetings.settle` as the organizer (`settleActorOf`: else the first active Admin for a project meeting, else the
  first active attendee), so the mark and the Tracker line come from the one settle rule and carry the events of a normal call. It writes no row of
  its own. A failure logs the id and the code only and the loop goes on. It reports `{ settled, skipped, failed, extended }`. The second half keeps the repeating
  series full (wave 3): one read (`EXTEND_SQL`, `EXTEND_LITE`; no new index: the base is the meetings that start today or later, served by `meetings_starts`)
  gives the last meeting of each series that is scheduled and has fewer than 8 scheduled meetings ahead (`ends_at` after the run), the fewest ahead first, at most
  20 series. The step skips a series whose rule has no day left (`occurrencesOf`) and a series of a completed or archived project, then runs the normal call `meetings.extend { seriesId }` for each, as the same
  person who may change the series (`extendActorOf` of the last meeting: the organizer, else the first active Admin of a project series; a private series of an
  organizer who left is skipped, review 2026-10-20), and counts the meetings added in `extended`. A failure logs the series id and the code only. `Deps.runCall` (`core/ports.ts`) is the run of a normal call for a step: only the office object sets it (its own SQLite run, `office/parts.ts`);
  every other host uses the Postgres `runCall`.
- The usage feature is gone (owner, 2026-10-23: "no need for it, remove it"; the meter only counted and warned, it blocked nothing). Removed: the Admin
  Usage section, the calls `usage.get` and `usage.retryEffect`, `server/usage/` (the request, byte and failed-signal meter, `countRequest` after each
  batch and MCP request and job run, the 80% warning and its effect `usage.limitWarning`), the job step `usage`, the mail template `limitWarning`
  and its words. Kept: the Resend quota guard (`mail.quotaWarning`, `mail/quota.ts`), the job step `heartbeat` (the row `job_runs` "heartbeat"; the
  health check of the office object reads it as `lastJob`, `JOBS_LAST_RUN_SQL` in `jobs/steps/heartbeat.ts`), the outbox retries, and the database tables
  `usage_month` and `usage_warnings` (unused now: no migration, no drop; a drop needs the owner's OK). `usage_day` and the office cap stay (below).

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
- Status on the office path (`office/presence.ts`): a socket sends `{"t":"state","state":"online"|"away"}`; the state lives in the socket
  note (`serializeAttachment`), so it outlives a hibernation. A change of a person's joined state goes to every `office` socket as the
  event `presence`; a new socket gets one snapshot of all. `sweep` and `closeOff` close through `retire()`. A test that reads raw socket
  messages filters the `changed` events, because the snapshot comes first.
- The Cron Trigger (`[triggers]`, every 15 minutes, UTC) gives the job steps to the object in one call (`office/jobs.ts`); the
  usage step runs in the first run of each hour. A Worker without `MADAR_DATA` returns at once. After the steps, the same call adds
  the meter counts, sweeps the sockets and gives back the day row.
- The office meter (`office/meter.ts`) keeps the day counts in memory and adds them in the next write (`usage_day`). It stays because the
  CAP of the office object reads it and blocks requests at the Free day limits (`capDay`, `parts.ts`). It sends no warning mail and writes no
  month row (the tables `usage_month` and `usage_warnings` stay and nothing writes them).
- On the year office one Cron run reads about 1,500 rows (the file size sum of the usage step went, 2026-10-23; `CRON_PINS`, `office/test/pins.ts`).
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

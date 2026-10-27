# The office object

The office object runs the Madar office on SQLite in a Cloudflare Durable Object (the Supabase exit). Code: `server/office/`,
`entries/office*.ts`. Read this guide before you change either. The Postgres path of the server is in `server/CLAUDE.md`.

## When it runs
- It is off on every deployed Worker. The office path runs only with the binding `OFFICE` and the var `MADAR_DATA = "office"`
  (`entries/officeEntry.ts`, `onOffice`). The bundle entry is `entries/workerMain.ts`. `entries/worker.ts` stays the Postgres path.
- The office ops under `/api/office/` go to the office path whenever the binding exists (`servesOffice`, `entries/officeWorker.ts`).
  The Cron still needs `onOffice`.
- `config/server-host.json` picks `office` for a copy (`OFFICE_COPIES_OPEN` lists the copies that may use it).

## The batch path
- The Worker checks the build, the body and the token, then gives the whole batch to the object in one RPC call (`entries/officeWorker.ts`).
  The object runs `runCall` on SQLite for each entry, one after the other, and answers JSON text. It runs the waited effect kinds with
  no wait. Mails and pushes run after the answer in one more call (`runEffects`). An overloaded or reset object answers the reason `busy`.
- The object does no network work. Each call gets a `WorkerNet` (`workerNet.ts`, an `RpcTarget`) and calls it back for file links, R2,
  Resend and the push POST (`net.ts`). The port refuses a call inside a transaction and stops at `NET_BUDGET` calls for each object call
  (`NetBudgetSpent`: the outbox row waits a minute and keeps its attempt). Every network call keeps the 3 s rule (`net.ts`).
- A batch reports an office change when any entry cleared `batch.office` (`runOfficeEntries`), so a turn-off with a read after it still
  closes the sockets of that person. The object has its own batch (`batch.ts`) and no first-read join.
- `Deps.runCall` (`core/ports.ts`) is the run of a normal call for a job step. Only the object sets it (its own SQLite run, `parts.ts`).

## Sockets and status
- Signals go out on the object sockets after the commit (`live.ts`, tags `office` and `person:<id>`). The socket opens with `live.ticket`
  (`TICKET_MS`, one use, in memory). A delivery and each Cron run close a socket with no pong for `LIVE_STALE_MS`. The commit that turns a
  person off closes the sockets of that person.
- Status (`presence.ts`): a socket sends `{"t":"state","state":"online"|"away"}`. The state lives in the socket note (`serializeAttachment`),
  so it outlives a hibernation. A change of the joined state of a person goes to every `office` socket as the event `presence`, and a new
  socket gets one snapshot of all. `sweep` and `closeOff` close through `retire()`. A test that reads raw socket messages filters the
  `changed` events, because the snapshot comes first.

## Cron and the meter
- The Cron Trigger (`[triggers]` in `wrangler.server.toml`, every 15 minutes, UTC) gives the job steps to the object in one call
  (`jobs.ts`). The first run after 00:00 UTC also runs `signin` (`SIGNIN_STEP`, `cleanupSignin`). A Worker without `MADAR_DATA` returns at
  once. After the steps, the same call adds the meter counts, sweeps the sockets and gives back the day row.
- `meter.ts` keeps the day counts in memory and adds them in the next write (`usage_day`). The day cap reads them (`capDay`, `parts.ts`).
  It sends no warning mail and writes no month row. The rows that one Cron run reads are pinned by `CRON_PINS` (`test/pins.ts`).

## Sign-in and /mcp
- The object deps take `liteAuthAdmin`, so the invite and auth effects run in the object and only their mail goes through the Worker. With
  `MADAR_AUTH_PRIVATE_JWK`, `officeEntry` mounts the routes of `ownApiRoutes` under `/api` (`entries/officeSignin.ts`): each step is one
  call of `Office.signin`. The forgot and renew routes run their limits in `Office.mailRoute` and their mail after the answer in
  `Office.mailWork`. The Worker pads the answer to a minimum time. A copy with the key also needs `MCP_URL`: it is the issuer of the own tokens.
- `/mcp`: the Worker hands each request to `Office.mcp` in one call. The object runs the MCP app there (`server/mcp/oauth/CLAUDE.md`). Each
  tool call runs on the batch path (`runOfficeEntries`, the who kind `agent` of `who.ts`). With no key, `/mcp` answers 503.

## Hold, import, ops routes
- The hold (`ops.ts`, `OfficeHold`, in memory, `HOLD_MS`): an export holds the office for a short time, an import for longer. An export
  refuses a batch with a write (reason `busy`), a request of `/mcp` itself (503) and the Cron steps. Reads, the sign-in steps, forgot, renew
  and the OAuth routes under `/mcp/` run, because their rows are the drift tables (`DRIFT_TABLES`). An import refuses every call, step and
  mail route, and the effects wait for the Cron.
- `Office.fetch` sends `/office/*` to `parts.ops`: `export` (begin, pages of `EXPORT_PAGE_ROWS` rows in rowid order, end with the version and
  `office_seq` of the begin) and `peek` (one select of `PEEK_ROWS` rows at most, only with `testToolsOn`). `/office/drop` deletes the storage
  of a spare object named `rehearsal-YYYYMMDD` only. That object takes no request after it.
- The import (`import.ts`): begin (mode `empty`, `resume`, or `replace` with `testToolsOn` only) takes the hold of an import. Each part
  (`IMPORT_PART_ROWS` rows at most, one records table) is one transaction. A part whose first row is there is skipped, so a client may send it
  again. The finish writes the server rows and the sign-in rows, adds the meters, and raises the version above the object and the source, so
  no held office list looks current. Then every socket closes. A replace also deletes the snapshot and raises the version.
- The ops routes of the Worker (`POST /api/office/export|import|peek|drop?office=<name>`) sit before CORS and Hono. Each one checks its secret
  header with `sameSecret` first: `x-madar-export-secret` (`MADAR_EXPORT_SECRET`, the nightly GitHub export) for `export`,
  `x-madar-ops-secret` (`MADAR_OPS_SECRET`, the Mac) for the others. A copy with no secret answers 401. Then the name: `export` and `import`
  take `office` or a rehearsal name, `peek` only `office`, `drop` only a rehearsal name (403 else). The body goes on to the object as a
  stream, with the name in `x-madar-office-name`.
- The test tools (`replace`, `peek`) need `MADAR_TEST_TOOLS = "on"` and refuse a production copy (`testToolsOn`). Only `[env.test.vars]` of
  `wrangler.server.toml` sets it. The test seed (`scripts/office/seed.ts`) replaces the office through them.
- The day cap of the test Worker (`cap.ts`, `MADAR_DAY_CAP`, `[env.test.vars]` only) is half of each Free day limit. Over the rows written, a
  write batch and a request of `/mcp` itself get `busy`. Over the rows read or the requests, every batch, sign-in step, forgot, renew and MCP
  request gets `busy`. The object reads the day counts again at most once in `DAY_CAP_TTL_MS` and at each new UTC day. The Cron, the effects
  and the ops are never capped.

## Tests
- `office/{net,meter,live,parts,who,routes,ops,import,cap}.test.ts` run on node:sqlite (`test/nodeOffice.ts`: the parts with a new own key, and
  `route`, which sends one request through the real Worker routes into the object).
- `office/*.wd.test.ts` run on local workerd with the test Worker of `test/live/`. `entries/{officeWorker,officeSignin}.test.ts` cover the entries.
- `npm run test:office` runs the object on local workerd: the host checks, `everyCall` on the sample office, and the rows pins on one year of
  data (`test/pins.ts`). `npm run smoke:office` checks the real bundle with a key made for the run. `npm run test:lite` runs the rule tests on node:sqlite.
- workerd refuses to evict an object while Node holds a stub to it, and the miniflare proxy frees a stub only after Node collects it. A test
  that evicts calls that object only through fetch (`officeByFetch` in `test/harness.ts`).

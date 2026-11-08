# Madar enterprises, plan A: office path parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Calendar and the Daftra link work on the office object path, and the satellite route takes the own-key token, with no change on the Postgres path.

**Architecture:** The office object does no network work. So two new methods of the network port (`NetApi.googleFetch`, `NetApi.daftraGet`) carry every Google and Daftra request to the Worker. The object sets `Deps.googleFetch` and `Deps.daftraFetch` from them, and the current clients, calls, effects and job step run unchanged on SQLite. The Google callback runs in the Worker with the real route. The satellite Pages Function checks own tokens with the key set of the Worker.

**Tech Stack:** TypeScript, Cloudflare Workers and Durable Objects (SQLite), jose, vitest (node:sqlite and local workerd).

**Spec:** `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md` (section 6 "Before the move" item 1, and 5.17 "Satellite map"). Shared names: `docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md`. This plan needs no other plan. The enterprise parts (per-enterprise seal and state, the binding of Daftra keys to `ent_001`) belong to plan D.

## Global Constraints

- Write every text in ASD-STE100 Simplified Technical English. No em-dash. Every Arabic word follows the Thmanyah rules. This plan adds no visible word.
- The object makes no network call itself and none inside a transaction (`NET_IN_TRANSACTION`, `server/office/net.ts`). One object call allows `NET_BUDGET` = 45 network calls. A call over the budget throws `NetBudgetSpent`, and the outbox row waits 60 seconds and keeps its attempt.
- Every network call keeps the 3 s rule (`GOOGLE_TIMEOUT_MS`). The exceptions stay as they are: the calls of `google.connect` share `GOOGLE_CONNECT_BUDGET_MS` = 15 s with at most `GOOGLE_CONNECT_CALL_MS` = 10 s for one call; each Daftra call has `DAFTRA_TIMEOUT_MS` = 10 s.
- Madar only reads Daftra: GET, no body. The step keeps `DAFTRA_MAX_CALLS` = 20 and `DAFTRA_MAX_MS` = 60 s. No Daftra call runs under the office lock or inside a transaction.
- The Postgres path does not change. The current Google, Daftra and job suites stay green on node:sqlite. `server/it/google.it.test.ts` and `server/it/daftra.it.test.ts` (Postgres) stay as they are: the lead runs them.
- A contract change is additive. This plan adds no migration, no table and no `LITE_STEPS` step (`LITE_SCHEMA_VERSION` stays 13: version 8 to 11 hold the Google and Daftra tables, with their SQLite twins).
- No Supabase entry (`deno-api`, `deno-mcp`, `deno-jobs`) may reach `server/office/` (`server/workerGraph.test.ts`).
- No token, code, client secret, Daftra key or Google answer text goes into an answer, an error text, a log line or an outbox error.
- No What's new line and no screen change: no person sees a change on a live copy (the office path is live on no copy today). The MCP side does not change: the four `google.*` calls and the six Daftra calls stay on `MCP_DENY`, so `MCP_ALLOW`, `TOOL_DOCS` and `INSTRUCTIONS` stay as they are. The track adds no new words, so `src/i18n/real/ent-a.*.json` stay empty.
- Commits: one for each task, a plain STE message, no `Co-Authored-By` line, no `Claude-Session` line. Inside a task run only `npm run typecheck` and the tests of the touched files (`npx vitest run <files> --testTimeout=60000`). A task that changes the office object also runs `npm run test:lite` and `npm run test:office` (sandbox off). Do not run the full suites.

## Review Focus

Input classes and failure modes that the spec implies and no step names. Each line has its test in the task named.

1. The budget of 45 network calls ends in the middle of a backfill of 60 meetings. Expect: the connection stays `ok`, no row loses an attempt, and the next run sends the rest (Tasks 2 and 3).
2. A Google or Daftra call starts while a transaction is open. Expect: the port refuses it, and no request leaves (Tasks 1, 3 and 5).
3. Google answers 204 with an empty body (an event delete). Expect: a `Response` with a null body, no throw (Task 1).
4. The object asks the Worker for an address that is not a Google address, or a Daftra site that the Worker does not hold. Expect: a failure, no fetch, and the Daftra key never crosses to the object (Task 1).
5. The Google callback gets a forged, old or foreign state, or an error from Google. Expect: one word in the fragment, no object call, nothing of the query in the log (Task 4).
6. The satellite route gets an agent token, a token of the other copy, an expired token, or the key set does not load. Expect: 401 for the first three with no Esri call, and 503 for the outage (Task 8).

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `server/office/net.ts` | modify | `NetApi.googleFetch`, `NetApi.daftraGet`, the Worker-side `googleRequest` and `daftraRequest`, the object-side `googleFetch` and `daftraFetch` in `netPorts` |
| `server/office/workerNet.ts` | modify | The two new RPC methods, with the Daftra accounts of the Worker |
| `server/entries/officeEntry.ts` | modify | Gives the Daftra accounts to `WorkerNet` |
| `server/core/retryAt.ts` | create | `retryAtOf`: the one rule that an error with a `retryAt` date waits and does not fail |
| `server/core/effects.ts`, `server/google/api.ts`, `server/google/sync.ts`, `server/daftra/client.ts` | modify | Let a budget error pass through the two clients |
| `server/core/ports.ts` | modify | `Deps.later`, `Deps.daftraRun` |
| `server/calls/google.ts` | modify | `runAfterCommit` hands the rows to `Deps.later` on the office path |
| `server/office/parts.ts` | modify | `depsFor` sets `googleFetch`, `daftraFetch`, `later`, `daftraRun` |
| `server/entries/officeSignin.ts` | modify | The real Google callback in place of `googleNotReady` |
| `server/jobs/steps/daftra.ts` | modify | The step runs on SQLite; it stops at a spent budget |
| `server/office/ops.ts` | modify | Four more drift tables |
| `server/office/test/outsideOffice.ts` | create | Test helper: the object parts with Google and Daftra fakes behind the port |
| `server/office/test/live/outside.ts`, `entry.ts`, `harness.ts` | create, modify | The same fakes in the test Worker of `test:office` |
| `server/http/pagesOwnKeys.ts`, `server/http/pagesSatellite.ts` | create, modify | The own key set through the service binding; the satellite check of own tokens |
| Tests | create, modify | `server/office/{net,google,daftra,ops}.test.ts`, `server/office/outside.wd.test.ts`, `server/entries/officeSignin.test.ts`, `server/google/{api,sync}.test.ts`, `server/daftra/client.test.ts`, `server/jobs/steps/daftra.test.ts`, `server/core/retryAt.test.ts`, `server/http/{pagesOwnKeys,pagesSatellite}.test.ts` |
| Guides | modify | `server/google/CLAUDE.md`, `server/daftra/CLAUDE.md`, `server/jobs/CLAUDE.md`, `server/office/CLAUDE.md`, `functions/CLAUDE.md`, `TASKS.md`, `docs/superpowers/real-build/exit-handoff.md` |

---

### Task 1: The network port carries Google and Daftra

**Files:**
- Modify: `server/office/net.ts` (interface at lines 21-29, helpers after `postPush` at line 65, `NetPorts` and `netPorts` at lines 98-134), `server/office/workerNet.ts`, `server/entries/officeEntry.ts` (the `net:` line), `server/office/test/fakes.ts` (`recordingNet`)
- Test: `server/office/net.test.ts`

**Interfaces:**
- Produces, in `net.ts`:
```ts
export type NetHttpRequest = { url: string; method: string; headers: Record<string, string>; body: string | null };
export type NetHttpReply = { status: number; body: string };
// NetApi gains:
googleFetch(req: NetHttpRequest): Promise<NetAnswer<NetHttpReply>>;
daftraGet(req: { url: string }): Promise<NetAnswer<NetHttpReply>>;   // the object sends the address only
export const NET_HTTP_MAX_CHARS = 1_000_000;                          // the longest answer body
export function isGoogleApiUrl(url: string): boolean;
export function googleRequest(run: typeof fetch): (req: NetHttpRequest) => Promise<NetAnswer<NetHttpReply>>;
export function daftraRequest(accounts: NonNullable<Config['daftra']>, run: typeof fetch): (req: { url: string }) => Promise<NetAnswer<NetHttpReply>>;
// NetPorts gains: googleFetch: typeof fetch; daftraFetch: typeof fetch
```
- `WorkerNet` constructor option: `daftra?: NonNullable<Config['daftra']>` (the accounts of the Worker). `Config` comes from `server/core/ports.ts`.
- `recordingNet` gains `googleFetch` (records `google <METHOD> <url>`, answers `{ status: 404, body: '{}' }`) and `daftraGet` (records `daftra GET <url>`, same answer). A test can replace each one.

- [ ] **Step 1: Write the failing tests in `server/office/net.test.ts`**
  - `googleRequest refuses an address that is not a Google address, with no fetch`: for `https://evil.example/token`, `http://oauth2.googleapis.com/token`, `https://oauth2.googleapis.com/token?x=1`, `https://oauth2.googleapis.com/other`, `https://www.googleapis.com/drive/v3/files`, `https://u:p@www.googleapis.com/calendar/v3/calendars`, and the method `TRACE` on a good address: each answer is `{ ok: false }` and the fake fetch saw no call. `isGoogleApiUrl` is true for `https://oauth2.googleapis.com/token`, `/revoke` and `https://www.googleapis.com/calendar/v3/calendars/x/events?timeMin=1`.
  - `googleRequest sends only authorization, content-type and accept, never follows a redirect, and gives back the status and the text`: the fake fetch saw `redirect: 'manual'` and only those header names; the value is `{ ok: true, value: { status: 200, body: '{"id":"cal-1"}' } }`; a 404 is a value too, not a failure.
  - `googleRequest and daftraRequest turn a thrown error into a failure with a fixed message`: the fake fetch throws `new Error('connect failed Bearer at-SECRET')`; the failure is `{ name: 'NetworkError', message: 'The outside request did not finish.' }` and `JSON.stringify` of it holds no `at-SECRET`. A `DOMException` of name `TimeoutError` gives the name `TimeoutError`. An answer body over `NET_HTTP_MAX_CHARS` is a failure named `NetworkError`.
  - `daftraRequest adds the key of the account itself and sends a GET`: accounts `{ MAZJ: { key: 'K'.repeat(30), site: 'mazj.daftra.com' } }`; the request `https://mazj.daftra.com/api2/invoices/1.json` reaches the fake fetch with `method: 'GET'`, `redirect: 'manual'` and the header `apikey` = that key. The addresses `https://other.daftra.com/api2/x.json`, `http://mazj.daftra.com/api2/x.json`, `https://mazj.daftra.com/admin/x`, `https://u:p@mazj.daftra.com/api2/x.json` give `{ ok: false }` with no fetch. The host compare ignores case.
  - `netPorts googleFetch gives a Response with a null body for an empty answer`: `recordingNet({ googleFetch })` answers `{ status: 204, body: '' }`; `await ports.googleFetch('https://www.googleapis.com/calendar/v3/calendars/c/events/e', { method: 'DELETE' })` has status 204 and `text()` is `''`, with no throw.
  - `netPorts daftraFetch sends only the address, refuses a method that is not GET, and shares the budget`: the object-side `daftraGet` argument has the keys `['url']` only (no header, so no key). `{ method: 'POST' }` throws. After `NET_BUDGET` calls (Google and Daftra together) the next one throws `NetBudgetSpent`. With `guard.open() === true` both throw `NET_IN_TRANSACTION` and `net.calls` stays empty.
  - `a failure of the Worker comes back as an error with its class`: `{ name: 'TimeoutError' }` becomes a `DOMException` named `TimeoutError` through `daftraFetch`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/office/net.test.ts --testTimeout=60000`
Expected: FAIL (`googleRequest is not a function`, the type errors on `NetApi`).

- [ ] **Step 3: Implement in `server/office/net.ts`**
  - Worker side: `isGoogleApiUrl(url)` is true for `https:` with no user, no password and no port, and either host `oauth2.googleapis.com` with path `/token` or `/revoke` and no query, or host `www.googleapis.com` with a path that starts with `/calendar/v3/calendars`. `googleRequest(run)` refuses a bad address or a method outside GET, POST, PUT, PATCH, DELETE or a body over 64,000 characters; keeps only the headers `authorization`, `content-type`, `accept`; calls `run(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(GOOGLE_CONNECT_CALL_MS) })` (import the constant from `server/google/api.ts`); reads the text.
  - `daftraRequest(accounts, run)` finds the account whose `site` equals the lowercase host; needs `https:`, no user, and a path that starts with `/api2/`; calls `run(url, { method: 'GET', headers: { apikey: account.key, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(DAFTRA_TIMEOUT_MS) })` (constant from `server/daftra/client.ts`).
  - Both: a thrown error becomes `{ ok: false, failure: { name, message } }` with `name` `TimeoutError` for an abort by time and `NetworkError` for all else, and the fixed message `The outside request did not finish.` Never copy the text of the error. An answer text over `NET_HTTP_MAX_CHARS` is the same failure.
  - Object side, in `netPorts`: both fetches use the existing `call(true, ...)`, so the guard and the budget apply. `googleFetch` reads the address (`String(input)`), the method (default GET), the headers (`new Headers(init?.headers)`) and a body that is a string, and returns `new Response(reply.body === '' ? null : reply.body, { status: reply.status })`. `daftraFetch` throws `Error('Madar only reads Daftra.')` for a method other than GET, and sends `{ url }`.
  - `WorkerNet`: add the two methods. `googleFetch` runs `googleRequest(fetchImpl)`; `daftraGet` runs `daftraRequest(accounts, fetchImpl)` and refuses when the Worker holds no accounts.
  - `officeEntry.ts`: `new WorkerNet({ files: deps.files, mail: deps.mail, ...(deps.config.daftra ? { daftra: deps.config.daftra } : {}) })`.
  - `recordingNet`: as in Interfaces. Fix every other literal of `NetApi` that the type check names.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck`, then `npx vitest run server/office/net.test.ts server/entries/officeWorker.test.ts --testTimeout=60000`, then `npm run test:lite` and `npm run test:office` (sandbox off).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/office/net.ts server/office/workerNet.ts server/entries/officeEntry.ts server/office/test/fakes.ts server/office/net.test.ts
git commit -m "Office port: carry Google and Daftra requests through the Worker"
```

---

### Task 2: A spent budget passes through the Google and Daftra clients

**Files:**
- Create: `server/core/retryAt.ts`, `server/core/retryAt.test.ts`
- Modify: `server/core/effects.ts` (lines 123-126), `server/google/api.ts` (lines 76-78), `server/google/sync.ts` (`revokeOne`, the catch of `revokeToken`), `server/daftra/client.ts` (lines 100-102)
- Test: `server/google/api.test.ts`, `server/google/sync.test.ts`, `server/daftra/client.test.ts`

**Interfaces:**
- Produces: `export function retryAtOf(error: unknown): Date | null` in `server/core/retryAt.ts` (the body of the private function in `effects.ts`, which now imports it).

Why: `NetBudgetSpent` has a `retryAt`. Today both clients turn every unknown error into `unreachable`, so a spent budget would mark the connection `not_synced`, burn the attempts of the row, and show a false Daftra problem.

- [ ] **Step 1: Write the failing tests**
  - `retryAt.test.ts`: `retryAtOf(new NetBudgetSpent(now))` is `now + 60 s`; a plain `Error`, `null` and an error with a text `retryAt` give `null`.
  - `api.test.ts`: a fetch that throws `new NetBudgetSpent(now)` makes `exchangeCode`, `refreshAccess` and `listEvents` reject with that same object (not a `GoogleError`). A plain network `TypeError` still gives `GoogleError('unreachable')`.
  - `sync.test.ts` (use `googleOffice`): `syncOne` with a fetch that throws `NetBudgetSpent` rejects with it, leaves the connection `state = 'ok'` and `last_error` null; `processOutbox` then keeps the row with the same attempts count and `claimed_until` = the `retryAt`. `revokeOne` rejects with it and the `google_connections` row stays (today it swallows the error and deletes the row).
  - `client.test.ts` (Daftra): a fetch that throws `NetBudgetSpent` makes `invoice('1')` reject with that object, not a `DaftraError`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/core/retryAt.test.ts server/google/api.test.ts server/google/sync.test.ts server/daftra/client.test.ts --testTimeout=60000`
Expected: FAIL (module missing; `GoogleError` and `DaftraError` thrown in place of the budget error).

- [ ] **Step 3: Implement**
  - `retryAt.ts` holds `retryAtOf`; `effects.ts` imports it.
  - `google/api.ts` `send`: `if (retryAtOf(error) !== null) throw error;` before the `GoogleError('unreachable')` line. `daftra/client.ts` `get`: the same line before `DaftraError('unreachable')`.
  - `google/sync.ts` `revokeOne`: change the catch to `if (!(error instanceof GoogleError) || error.retry) throw error;`. On Postgres a non-`GoogleError` cannot come from `revokeToken`, so that path is unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck`, then `npx vitest run server/core server/google server/daftra --testTimeout=60000`.
Expected: PASS (the old Google and Daftra tests stay green).

- [ ] **Step 5: Commit**

```bash
git add server/core/retryAt.ts server/core/retryAt.test.ts server/core/effects.ts server/google/api.ts server/google/sync.ts server/daftra/client.ts server/google/api.test.ts server/google/sync.test.ts server/daftra/client.test.ts
git commit -m "Clients: let a spent network budget pass through"
```

---

### Task 3: Google Calendar runs in the office object

**Files:**
- Modify: `server/core/ports.ts` (the `Deps` type, lines 186-196 and their comments), `server/calls/google.ts` (`runAfterCommit` at lines 108-120; its two callers at lines 221 and 235), `server/office/parts.ts` (`depsFor` at lines 182-205; the `run` at lines 153-158)
- Create: `server/office/test/outsideOffice.ts`
- Test: `server/office/google.test.ts`

**Interfaces:**
- Consumes: `NetApi.googleFetch`, `NetPorts.googleFetch/daftraFetch` (Task 1); `retryAtOf` (Task 2).
- Produces, in `Deps`:
```ts
/** The office object only: effect rows that a server call wrote with writeOutbox. They run after the answer, as the rows of a shared call. */
later?: (ids: string[], kinds: string[]) => void;
/** The office object only: the run of the internal call payments.daftraPaid (server/daftra/paidCall.ts) on the SQLite data. */
daftraRun?: RunCall;
```
- Produces, in `outsideOffice.ts`:
```ts
export async function outsideOffice(o?: { google?: boolean; daftra?: FakeDaftra[]; edit?: (seed: State) => void; at?: string }): Promise<{
  parts: OfficeParts; net: ReturnType<typeof recordingNet>; clock: FixedClock; lines: string[];
  google: FakeGoogle; daftra: FakeDaftra[];
  openAtCall: boolean[];                       // db.isOpen() at each outside request, in order
  batch(userId: string, calls: { name: string; input: unknown }[]): Promise<{ results: any[]; later: string[] }>;
  effects(ids: string[]): Promise<OfficeEffectsReport>;
  cron(at: Date): Promise<OfficeCronReport>;
  rows(text: string, values?: unknown[]): Promise<Record<string, unknown>[]>;
}>;
```
The helper builds `officeParts` on node:sqlite as `office()` in `server/office/parts.test.ts` does (copy its `principal` function: the token is the user id). The env is `NODE_OFFICE_ENV` (`server/office/test/nodeOffice.ts`) plus `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MADAR_GOOGLE_KEY` from `GOOGLE_CONFIG` and `GOOGLE_KEY` (`server/google/testOffice.ts`) when `google` is not false, plus the pair `DAFTRA_<ACCOUNT>_KEY` and `_SITE` of each fake. The `read` function gets a `names()` method (`Object.keys` of the env), because `serverEnvFrom` reads the Daftra accounts by name. `net` is `recordingNet({ googleFetch: googleRequest(routed), daftraGet: daftraRequest(config, routed) })`, where `routed` is a fetch that pushes `parts.db.isOpen()` into `openAtCall` and then calls `google.fetch` or the fake whose site is the host (`daftraDeps` in `server/daftra/fakeDaftra.ts` does this routing).

- [ ] **Step 1: Write the helper and the failing tests in `server/office/google.test.ts`**

Stub the network in `beforeEach`: `vi.stubGlobal('fetch', () => { throw new Error('A test reached the network.'); })`. Use the meeting input `{ kind: 'meeting', title: 'Kickoff', where: 'Meeting room', startsAt: '2026-10-23T10:00:00.000+03:00' }` as `planMeeting` does (`server/google/testOffice.ts`). Usr_003 and usr_004 are people of the sample office.
  - `google.status says ready with the three values and ready false without them`: `outsideOffice()` gives `ready: true, state: 'none'`; `outsideOffice({ google: false })` gives `ready: false`.
  - `a connect swaps the code and makes the calendar through the port, and the sync rows run after the answer`: `google.connectStart` then `google.connect` (as `GoogleOffice.connect` does). The answer is `{ state: 'ok', meetings: n }`. In the same call the fake saw the token request and the calendar request, and no event request yet. `later` holds the `gcal.sync` ids (the call used `Deps.later`, not `processOutbox`). After `effects(later)` the fake holds the events, `google_events` has the rows, and `openAtCall` has only `false`.
  - `a meeting made after the connect reaches Google through runEffects`: `meetings.create` as the connected person gives `later` with one `gcal.sync`; `effects` makes one `POST` of an event.
  - `disconnect hands the revoke row to later, and the revoke reaches Google`: after `effects(later)` the fake saw `/revoke` and `google_connections` has no row of the person.
  - `a spent network budget leaves the connection ok and loses no attempt` (Review Focus 1): `edit` adds 60 meetings of usr_003 in the next 30 days (clone the first sample meeting with new ids `mtg_900` and up). Connect, then `effects(later)`. The first run makes at most 45 outside requests (count `net.calls`); the connection `state` is `ok` with `last_error` null; the rows that did not run have `done_at` null and `attempts` as before. After `clock.advance(61_000)` a second `effects` of the same ids finishes them, and the fake holds 60 events.
  - `the log, the outbox errors and the answers hold no Google secret` (leak test): with a rule `google.failAll(() => true, 500)` after the connect, run `effects(later)`; search `lines`, the `outbox.error` column and `JSON.stringify` of every answer for each of `KNOWN_SECRETS` (`server/google/fakeGoogle.ts`). None appears.
  - `a person who cannot view a hidden project gets no Google event for its meeting` (leak test): use the setup of `server/google/hiddenProject.test.ts` lines 40-70 on the parts helper; after `effects`, `net.calls` holds no `POST` for that person.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/office/google.test.ts --testTimeout=60000`
Expected: FAIL (`deps.googleFetch` is not set in the object, so the connect fails, and `Deps.later` does not exist).

- [ ] **Step 3: Implement**
  - `ports.ts`: add the two fields above, and replace the comments of `googleFetch` and `daftraFetch` ("the office path has no Google yet" is no longer true): the office object sets both from its network port.
  - `calls/google.ts`: `runAfterCommit(deps, ids, kinds, name)`. When `deps.later` is set it calls `deps.later(ids, kinds)` and returns. Else the body stays as it is. `googleConnect` returns `kinds` from its transaction (the `kind` of each row it wrote); `googleDisconnect` passes `ids.map(() => 'gcal.revoke')`.
  - `parts.ts`: in `depsFor`, set `googleFetch: ports.googleFetch`, `daftraFetch: ports.daftraFetch`, `later: (ids, kinds) => { const ledger = ledgers.get(deps); ledger?.wrote(ids, kinds); ledger?.committed(ids); }` and `daftraRun`. Make `daftraRun` with `createRunCall({ calls: DAFTRA_INTERNAL_CALLS, data, afterCommit })` where `data` and `afterCommit` are the ones of `run`. Import `DAFTRA_INTERNAL_CALLS` from `../daftra/paidCall`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck`, then `npx vitest run server/office server/google server/calls --testTimeout=60000`, then `npm run test:lite` and `npm run test:office` (sandbox off).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/core/ports.ts server/calls/google.ts server/office/parts.ts server/office/test/outsideOffice.ts server/office/google.test.ts
git commit -m "Office object: run Google Calendar through the network port"
```

---

### Task 4: The Google callback on the office path

**Files:**
- Modify: `server/entries/officeSignin.ts` (the import at line 5; `googleNotReady` and its use at lines 78-93; the header comment)
- Test: `server/entries/officeSignin.test.ts` (replace the test at lines 58-69)

**Interfaces:** The route list of `ownApiRoutes` already holds `GOOGLE_CALLBACK_ROUTE` (`server/google/callback.ts`). Delete the special case, and the generic mapping calls `googleCallback(request, o.deps)` in the Worker. The route reads no database and calls no object. `OfficeStub` gets no new method.

- [ ] **Step 1: Write the failing tests** (the `setup` of the file takes `google?: boolean`; with it, `fakeDeps({ config: { google: GOOGLE_CONFIG } })`)
  - `answers the Google callback with finish, the code and the state, and calls no object`: sign a state with `signState(await googleKeysOf(GOOGLE_KEY), 'usr_001', deps.clock.now())`. The answer is 302 to `http://127.0.0.1:5173/settings#google=finish&code=<encoded>&state=<encoded>` with `no-store` and `no-referrer`. `seen.signins`, `seen.mailRoutes` and `net.calls` are empty. `JSON.stringify(deps.logs)` holds the word `finish` and neither the code nor the state (Review Focus 5).
  - `answers old for a true state past 10 minutes (deps.clock.advance(STATE_LIFE_MS + 1000)), failed for a foreign or plain state, denied for an error in the query, and not_ready when the Worker has no Google values`: five requests, five fragments.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/entries/officeSignin.test.ts --testTimeout=60000`
Expected: FAIL (every answer is `google=not_ready`).

- [ ] **Step 3: Implement** the removal of `googleNotReady`, its branch, and the unused imports. Update the comment above `officeSigninRoutes`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck`, then `npx vitest run server/entries server/google/callback.test.ts --testTimeout=60000`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/entries/officeSignin.ts server/entries/officeSignin.test.ts
git commit -m "Office path: serve the real Google callback"
```

---

### Task 5: The Daftra step and calls run in the office object

**Files:**
- Modify: `server/jobs/steps/daftra.ts` (header comment lines 25-36; `DaftraStepOptions` at 44-52; `DaftraReport` at 54-56; line 134; the loop at 154-206), `server/daftra/testOffice.ts` (line 18; the `step` at line 66-67; extract `addSubCompanies`)
- Create: `server/office/daftra.test.ts`
- Test: `server/jobs/steps/daftra.test.ts` (the test at lines 55-60)

**Interfaces:**
- Consumes: `Deps.daftraRun`, `Deps.daftraFetch` (Task 3); `retryAtOf` (Task 2).
- Produces: `export function addSubCompanies(seed: State): { mazj: string; vado: string; studio: string }` in `server/daftra/testOffice.ts` (the code that `daftraOffice` runs at lines 41-50, moved with the same behavior).
- `DaftraStepOptions` loses `onOffice`. `DaftraReport` is `{ skipped: 'no_config' } | {...}` (the value `'office'` goes). The step uses `o.run ?? deps.daftraRun ?? createRunCall({ calls: DAFTRA_INTERNAL_CALLS })`.

- [ ] **Step 1: Write the failing tests**
  - `daftra.test.ts`: replace `on the office object path ... skipped: 'office'` with `runs on the SQLite data without an option`: set `t.deps.daftraRun = t.internal`; `daftra(t.deps, at)` (no options) sets `pay_003` to Received through the fake.
  - `daftra.test.ts`, new: `stops at a spent network budget, keeps the item, and still saves the state`: two linked payments (the `linkedBoth` edit); the `daftraFetch` of the deps answers the first request from the fake and then throws `new NetBudgetSpent(new Date())`. The step does not throw. The report has `calls: 1`, `left: 1`, `problems: []`; `daftra:read:MAZJ` is in `job_runs`; no `daftra:problem:*` row exists.
  - `server/office/daftra.test.ts` with `outsideOffice({ daftra: [mazj, vado], edit })` (the fakes and the `edit` as in `build` of the step test, with `addSubCompanies` and `linkedBoth`):
    - `the Cron daftra step reads the paid invoice through the port and sets Received`: `cron(at)`; the `daftra` step result is `{ accounts: 2, calls: 2, paid: 1, ... }`; `pay_003.receivedOn` is `2026-10-22`; `net.calls` holds `daftra GET https://mazj.daftra.com/api2/invoices/1830.json`; `mazj.requests[0].apikey` is the key of the fake (the Worker added it); `JSON.stringify([net.calls, lines])` holds no key text; `openAtCall` has only `false`.
    - `a copy with no Daftra account skips`: `outsideOffice()`; the step result is `{ skipped: 'no_config' }` and `net.calls` is empty.
    - `daftra.findClients reads one live page through the port`: usr_011 calls `daftra.findClients` with `{ paymentId: 'pay_003', query: 'gulf' }`; `mazj.paths()` is `['clients.json?keywords=gulf&limit=10']`; the answer lists the fake client.
    - `payments.linkInvoice reads the invoice before the lock and links it`: usr_011 calls `daftra.matchClient` with `{ paymentId: 'pay_003', daftraClientId: '842' }`, then `payments.linkInvoice` with `{ id: 'pay_003', invoiceId: '1830' }`; `openAtCall` has only `false`; the payment holds `daftra.invoiceId` `1830`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/jobs/steps/daftra.test.ts server/office/daftra.test.ts --testTimeout=60000`
Expected: FAIL (the step returns `skipped: 'office'`).

- [ ] **Step 3: Implement**
  - Delete the line `if (isLite(deps.db) && !o.onOffice) return { skipped: 'office' };`, the option, the `'office'` value and the unused `isLite` import. Update the header comment and the `step` helper of `testOffice.ts`.
  - In the loop: in the `catch`, before `if (!(error instanceof DaftraError)) throw error;` add: when `retryAtOf(error) !== null`, call `queue.unshift(item)`, do `report.calls -= 1`, set `spent = true` and `break`. The `while` and the `for` stop when `spent` is true. The state saves after the loop run as before.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck`, then `npx vitest run server/jobs server/daftra server/calls/daftra.test.ts server/office --testTimeout=60000`, then `npm run test:lite` and `npm run test:office` (sandbox off).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/jobs/steps/daftra.ts server/jobs/steps/daftra.test.ts server/daftra/testOffice.ts server/office/daftra.test.ts
git commit -m "Daftra step: run on the office object through the network port"
```

---

### Task 6: Drift tables of the export

**Files:**
- Modify: `server/office/ops.ts` (`DRIFT_TABLES`, lines 40-43)
- Test: `server/office/ops.test.ts`, `scripts/backup/officeExport.test.ts`

Why: the Google effects run during an export hold (`runEffects` lets them) and write `google_connections` and `google_events`. The export manifest must list them as drift, or a restore check reports a false problem. `daftra_clients` and `daftra_invoices` are on `OUTSIDE_OFFICE_LOCK` in `scripts/backup/check.ts`, so they join the list (`server/data/CLAUDE.md`).

- [ ] **Step 1: Write the failing tests**: `ops.test.ts`: `DRIFT_TABLES` contains `google_connections`, `google_events`, `daftra_clients`, `daftra_invoices` and does not contain `google_calendars` (both writers hold the lock). `officeExport.test.ts`: `manifest.drift` contains `google_events`.
- [ ] **Step 2: Run to verify it fails**: `npx vitest run server/office/ops.test.ts scripts/backup/officeExport.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the four names in `DRIFT_TABLES`.
- [ ] **Step 4: Run to verify it passes**: `npm run typecheck`, the same command, then `npm run test:lite` and `npm run test:office` (sandbox off). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/office/ops.ts server/office/ops.test.ts scripts/backup/officeExport.test.ts
git commit -m "Export: list the Google and Daftra server tables as drift tables"
```

---

### Task 7: The same flows on local workerd

**Files:**
- Create: `server/office/test/live/outside.ts`, `server/office/outside.wd.test.ts`
- Modify: `server/office/test/live/entry.ts` (the `net:` line 44, a new route), `server/office/test/live/harness.ts` (`startLive`, secrets at lines 36-44, a new reader)

**Interfaces:**
- `outside.ts` exports `OUTSIDE_SECRETS` (the three Google values from `GOOGLE_CONFIG`/`GOOGLE_KEY`, and `DAFTRA_MAZJ_KEY`, `DAFTRA_MAZJ_SITE` from a fixed `fakeDaftra({ account: 'MAZJ', clients: [{ id: '842', name: 'Gulf Crest Holding' }], invoices: [paid invoice '1830' of client 842] })`), the module fakes `fakeGoogle()` and that `fakeDaftra`, `outsideFetch: typeof fetch` (Google hosts go to `fakeGoogle.fetch`, the Daftra site to the fake, anything else throws), and `outsideSeen()` returning `{ google: { method; path }[]; daftra: { method; url }[] }` (no header, no body).
- `startLive(o: { outside?: boolean } = {})`: with `outside` it adds `OUTSIDE_SECRETS` to `secrets`. Other suites keep their env, so their rows pins do not change. `live.outside()` reads `GET /test/outside`.
- `entry.ts`: `new WorkerNet({ files, mail, fetch: <push, Google and Daftra routed>, daftra: { MAZJ: { key, site } } })`. A push endpoint keeps its current fake; a Google or Daftra address goes to `outsideFetch`.

- [ ] **Step 1: Write the failing tests in `outside.wd.test.ts`** (`startLive({ outside: true })`, `live.fresh(seed)` before each)
  - `connects Google and syncs a meeting through the network port of the Worker`: usr_001 calls `google.connectStart`, reads `state` from the returned url, calls `google.connect` with `{ code: 'code-SECRET', state }` (answer `state: 'ok'`), then `meetings.create`. `vi.waitFor` (10 s): `live.outside().google` holds a `POST` to `/token`, a `POST` that makes the calendar and a `POST` that makes the event.
  - `the Cron reads Daftra through the Worker and sets Received`: the seed has sub-company `MAZJ` (`addSubCompanies`) and `pay_003.daftra` linked to account `MAZJ`, invoice `1830` (the link object as `link()` in `server/jobs/steps/daftra.test.ts`). `cron(new Date('2026-10-26T06:00:00Z'))`; `vi.waitFor`: `live.readBack()` shows `payments.pay_003.receivedOn` set; `live.outside().daftra` holds `GET https://mazj.daftra.com/api2/invoices/1830.json`.

- [ ] **Step 2: Run to verify it fails**: `npx vitest run server/office/outside.wd.test.ts --testTimeout=120000` (sandbox off). Expected: FAIL (the live Worker has no Google values, so `google.connectStart` answers `google_not_ready`).
- [ ] **Step 3: Implement** the files above. If workerd refuses `node:crypto` in `fakeGoogle.ts`, keep the import and report it as a risk; do not change the production file.
- [ ] **Step 4: Run to verify it passes**: `npm run typecheck`, `npx vitest run server/office/outside.wd.test.ts server/office/cron.wd.test.ts --testTimeout=120000`, then `npm run test:lite` and `npm run test:office` (sandbox off). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/office/test/live/outside.ts server/office/test/live/entry.ts server/office/test/live/harness.ts server/office/outside.wd.test.ts
git commit -m "Office tests: Google and Daftra flows on local workerd"
```

---

### Task 8: The satellite route takes the own-key token

**Files:**
- Create: `server/http/pagesOwnKeys.ts`, `server/http/pagesOwnKeys.test.ts`
- Modify: `server/http/pagesSatellite.ts` (comment lines 3-14, `SatelliteDeps` at line 41, `isPerson` at lines 56-70, `satelliteTile` at lines 94-122), `functions/CLAUDE.md` (the satellite lines)
- Test: `server/http/pagesSatellite.test.ts`

**Interfaces:**
- Produces, in `pagesOwnKeys.ts`:
```ts
export const OWN_KEYS_PATH = '/api/auth/jwks';
export function ownKeySetOfBinding(binding: ServiceBinding, o?: { now?: () => number }): JWTVerifyGetKey;
/** The key set of the own tokens of a copy, or undefined: only for a copy whose setting is office, and only with its binding. */
export function ownKeySetFor(copy: Copy, env: PagesEnv, setting?: ServerHostSetting): JWTVerifyGetKey | undefined;
```
  `ownKeySetOfBinding` loads `GET https://madar-server.internal/api/auth/jwks` (`INTERNAL_ORIGIN` in `pagesForward.ts`) through the binding, keeps the set for 10 minutes, and loads again at most once in 30 seconds when a `kid` is unknown. A non-200 answer or a body that is not a key set throws a plain `Error` (not a jose error), so the route answers 503. `ownKeySetFor` keeps one set for each copy and binding.
- `SatelliteDeps` gains `ownKeySet?: (copy: Copy, env: PagesEnv) => JWTVerifyGetKey | undefined`; the default deps use `ownKeySetFor`. `export function ownIssuerOf(copy: Copy): string` is `ownIssuer(\`${COPY_HOSTS[copy].page}/mcp\`)` (`ownIssuer` from `server/auth/ownKeys.ts`).
- The route reads the `iss` claim (`decodeJwt`, no trust yet) to pick the key set: the Supabase issuer of the copy keeps today's check; `ownIssuerOf(copy)` uses the own set and the same rules (ES256, audience `authenticated`, role `authenticated`, a `sub`, no `client_id`, 5 s clock tolerance). Any other issuer is a refusal. The route ignores the `ent` claim: a tile holds no data of an enterprise.

- [ ] **Step 1: Write the failing tests**
  - `pagesOwnKeys.test.ts` (a fake binding that counts its calls and returns a JWKS built with `exportJWK`): one load serves many checks; an unknown `kid` loads again once and a second miss inside 30 s does not; a 500 answer and a body `{}` throw a plain `Error`; `ownKeySetFor` gives `undefined` for the setting `supabase`, for the setting `office` with no binding, and a set for `office` with the binding `MADAR_SERVER_PRODUCTION`.
  - `pagesSatellite.test.ts` (new `describe`; own tokens signed with a second key pair, issuer `ownIssuerOf(copy)`, audience `authenticated`, `deps.ownKeySet` returns the local set):
    - `gives a signed-in person of an office copy one tile`: 200, Esri asked once.
    - `refuses an own token when the copy does not run on its office object`: `ownKeySet` returns `undefined`, so 401 and no Esri call.
    - `refuses an agent token, a token of the other copy, an expired token, a token with a wrong audience, a token with no role, and a token signed by another key`: six cases, each 401, no Esri call (Review Focus 6).
    - `answers 503 when the own key set does not load`: `ownKeySet` returns a function that throws a plain `Error`; 503 `sign_in_check_failed`; no Esri call.
    - The current Supabase tests stay as they are.

- [ ] **Step 2: Run to verify it fails**: `npx vitest run server/http/pagesOwnKeys.test.ts server/http/pagesSatellite.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Update the top comment of `pagesSatellite.ts` ("a person signed in to the copy" now holds both key kinds) and the satellite lines of `functions/CLAUDE.md`. `functions/satellite/[[path]].ts` stays: it already passes `env`.
- [ ] **Step 4: Run to verify it passes**: `npm run typecheck`, `npx vitest run server/http --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/http/pagesOwnKeys.ts server/http/pagesOwnKeys.test.ts server/http/pagesSatellite.ts server/http/pagesSatellite.test.ts functions/CLAUDE.md
git commit -m "Satellite route: accept the own-key token"
```

---

### Task 9: Guides and the open item

**Files:**
- Modify: `server/google/CLAUDE.md` (line 15 and the "Timeouts" part), `server/daftra/CLAUDE.md` (line 95 and the "client" part), `server/jobs/CLAUDE.md` (the `daftra` line), `server/office/CLAUDE.md` ("The batch path": the port carries Google and Daftra; the budget; "Hold" part: the four drift tables), `TASKS.md` (line 236, tick it), `docs/superpowers/real-build/exit-handoff.md` (section 7b), the comments of `server/entries/officeSignin.ts`, `server/jobs/steps/daftra.ts`, `server/core/ports.ts` (check no line says "no Google yet" or "skipped office")

- [ ] **Step 1: Write the lines.** Each guide says: the office path now runs this feature; the request goes through `NetApi.googleFetch` or `NetApi.daftraGet`; the Daftra key stays in the Worker (the object sends the address only); a spent budget waits and loses no attempt; the callback runs in the Worker. Add one line to `server/office/CLAUDE.md` that the Worker needs the Google values and the `DAFTRA_<NAME>_*` pairs as secrets (`scripts/deploy/secrets.ts <env> --office` already sends them).
- [ ] **Step 2: Check.** Run `grep -rn "no Google yet\|not_ready\|skipped: 'office'\|onOffice" server docs/superpowers/real-build/exit-handoff.md TASKS.md`; every hit must be a true line. Run `git diff main | grep -P '^\+[^+].*\x{2014}'`: it must print nothing (the pattern is the em-dash code point).
- [ ] **Step 3: Commit**

```bash
git add server TASKS.md docs/superpowers/real-build/exit-handoff.md
git commit -m "Guides: Google and Daftra run on the office path"
```

---

## Lead steps (not for the builder)

- Lead step: run the full gate once (root CLAUDE.md): `npm test`, `npm run build:server`, `npm run test:lite`, `npm run test:office`, `npm run smoke:office` (the real bundle: it proves the `officeEntry` wiring of the Daftra accounts), `npm run test:it` for `google.it.test.ts` and `daftra.it.test.ts`, and the `test:db` suite of `src/api`.
- Lead step: with the owner's OK, run `npx tsx scripts/deploy/secrets.ts test --office` so the test Worker holds the Google values and the `DAFTRA_MAZJ_*` pair, then one connect and one sync by hand on the test copy with `config/server-host.json` set to `office` for the test copy. The two redirect URIs in Google Cloud stay as they are (the address does not change).
- Lead step: deploy the Pages Functions (`scripts/deploy/pages.sh`) so the satellite change reaches the copies. Production keeps `supabase` in `config/server-host.json` until plan E.
- No screenshots: no screen changes.

## Self-review

- **Spec coverage:** Section 6 item 1 has Google (Tasks 1 to 4, 6), Daftra (Tasks 1, 2, 5, 6) and the callback (Task 4). Section 5.17 "Satellite map" is Task 8. The enterprise parts are left to plan D.
- **Names:** `googleFetch`, `daftraGet`, `googleRequest`, `daftraRequest`, `NetHttpRequest`, `NetHttpReply`, `Deps.later`, `Deps.daftraRun`, `retryAtOf`, `addSubCompanies`, `outsideOffice`, `ownKeySetFor` are the same in every task that names them.
- **Proportion:** the plan holds signatures, test names and values; the bodies stay with the builder.

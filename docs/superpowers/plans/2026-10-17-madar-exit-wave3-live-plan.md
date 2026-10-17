# Madar Exit Wave 3: The Office Object, Live Updates and Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production office object (`Office`), the batch call into it, live updates on its sockets, the 15-minute Cron
job and the meters of the Free day limits, on the SQLite path of wave 1, while production and the test copy stay on Supabase.

**Architecture:** The Worker checks the build, the body and the token, then gives the whole batch to the office object in one
RPC call. The object runs `runCall` (wave 1 `createRunCall` with `liteData`) for each entry, one after the other, and answers
with the finished JSON text. The Worker passes a network port (`WorkerNet`, an `RpcTarget`) into each object call: the object
calls it back for file links, R2 head, copy and remove, Resend mail and the push POST, so every network call runs in the Worker
and the effect code stays the same on both stacks. Change signals go out on the object sockets after the commit
(`onCommit` of wave 1); a Cron Trigger gives the 15-minute job steps to the object in one call.

**Tech Stack:** TypeScript 7.0.2, Hono, Cloudflare Workers and Durable Objects (SQLite storage API, WebSocket Hibernation
API, Workers RPC with `RpcTarget`), wrangler 4.147.0 (`createTestHarness`, `unstable_readConfig`, `wrangler dev
--test-scheduled`), node:sqlite (Node 22.23.1), vitest 5.0.2, zod 4.

**Spec:** `docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md` (top notes: the wave 0 results and the six
changes; section 2 rows "Live updates" and "15-minute jobs"; section 3). The exit plan: `docs/superpowers/plans/2026-10-17-madar-cloudflare-exit-plan.md`
(Part A.2 "Wave 3", A.3, Part B for the wave 1 names). Measured facts: `docs/superpowers/real-build/proof.md`, sections "Wave 0
of the Supabase exit", "Wave 0, the rest" and every "Wave 1" section. Their facts beat the plan and the spec.

## Four design choices of this plan, with the evidence

The exit plan gives the target. This plan meets it in four places with another form, because a fact of 17 October 2026 allows a
smaller or safer build. The main session checks each one before the build starts. It accepted all four on 17 October 2026.

1. **The effects cost 1 object request with no rewrite, in place of 2 coarse methods with a rewrite.** The exit plan asks for
   one "claim, read and reserve" method and one "record" method, which means a split of every effect handler (mail.notice,
   mail.quotaWarning, usage.limitWarning, push.notify, r2.delete, the summary) into three parts. Workers RPC lets the Worker pass
   an `RpcTarget` into an object method, and the object calls it back until the method returns (RPC lifecycle page; probe of
   this plan on local workerd: two callbacks, one of them with a 5 ms timer, both answered). The object runs `processOutbox` as it
   is, and only the network calls go back into the Worker. A write with mail and push costs 2 object requests in all (the batch,
   then `runEffects` after the answer), not about 9. The rule "the office object does no network work" holds: every `fetch`
   runs in the Worker isolate, and the port refuses a call while a transaction is open.
2. **`live.ticket` is minted in the office object, inside the batch that the Worker hands over after its token check.** The
   ticket is 32 random bytes in the object memory, 60 s, one use, bound to the person. It needs no secret and no row (a stored
   ticket would cost 2 to 4 rows written for each socket open). An object that hibernates between the mint and the open (under 1 s
   apart) loses the ticket; the client then asks for a new one. The interface of the orchestrator ("the Worker mints the ticket
   after its normal token check, and the office object checks it when the socket opens") keeps its meaning: no ticket without the
   Worker's token check, and only the object reads it.
3. **The local run of the deploy suite moves to wave 5.** The deploy suite signs in with real tokens. On SQLite no users row
   holds an `auth_user_id` (wave 1 `server/data/lite/office.ts` makes the snapshot with no auth map), and the sign-in rows are wave 2.
   Task 18 runs the real bundle `dist-server/worker.js` on `wrangler dev` instead: the health route, the token refusal, the socket
   refusal and one Cron run through `/__scheduled`.
4. **`[env.production]` gets no office block.** The exit plan asks for the binding "in each env". The Global Constraint "no office
   object deploys to production before the switch" wins: production gets `migrations = []` and `crons = []` and no binding, and
   wave 6 adds them. wrangler 4.147.0 reads this as no binding, no migration and no Cron for production (fact check of this plan
   with `unstable_readConfig`), and prints one warning on each production deploy.

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

In the list above, "Task 18" is Task 18 of wave 1 (the rows pins); the tasks of this plan have their own numbers.

The lines of wave 3:

- Worktree `~/dev/madar-rb/exit-live`, branch `rb/exit-live`. Each builder runs `git merge --ff-only main` first and writes its
  report to `docs/superpowers/real-build/wave3-report-<block>.md` in the worktree before it returns (the main session deletes the
  reports at the merge).
- Nothing deploys in wave 3. `config/server-host.json` stays `{"test":"supabase","production":"supabase"}`. The code runs only in
  `npm test`, `test:lite`, `test:office` and a local `wrangler dev`.
- The office path of the Worker runs only when the env has the binding `OFFICE` and the var `MADAR_DATA = "office"`
  (`onOffice`, Task 8). No deployed env sets `MADAR_DATA` before wave 5. The Postgres path of the Worker does not change.
- The network goes through the port `NetApi` only (Task 3). The port refuses a call while a transaction of the object is open,
  and stops at `NET_BUDGET` (45) network calls for each object method call: a Worker on Free has 50 subrequests for each
  invocation, and the token check may use one for the key set.
- A Cron run, a batch and its effects are one Worker invocation each, with 10 ms of CPU on Free. The Worker parses, checks the
  token and passes JSON text through; the object does the rest (wave 0: the object passed 135 ms calls on Free, the plain Worker
  did not).
- `live.ticket` lives 60 s, is for one use, and names the person. The socket tags come from the ticket (`office`,
  `person:<id>`), never from the address. A turned-off person loses the socket on the commit that turned the person off.
- The schema of wave 3 is `LITE_SCHEMA_VERSION = 3`, with a step in `LITE_STEPS` (Task 1). Wave 2 takes version 2. The branch that
  merges second rebases its step onto the other one (Merge notes).
- No new secret, no new paid service. The tests generate every key they need at run time (VAPID keys with `makeVapidKeys`).
- Wave 3 changes no screen that a person sees: `liveSocket.ts` sits behind `VITE_MADAR_LIVE=socket`, which no build of wave 3
  sets. So no screenshots are due. The prototype smoke runs at the gate, because the contract and `bootstrap.ts` change.
- MCP: `live.ticket` goes on `MCP_DENY` (an agent opens no socket). No `TOOL_DOCS` and no `INSTRUCTIONS` change: no rule of an
  agent changes.
- Every new SQLite text sits beside its Postgres text with the `_LITE` suffix, and the call site picks it with `sqlFor` or
  `isLite`. The Postgres texts stay byte for byte (the fakes match them by exact text).

## Review Focus

1. **A person who must not see a change gets a live signal of it.** An outsider socket gets a signal of an office task, a person
   signal reaches another person, or a turned-off person keeps a socket open. Expected: an office task change reaches only its
   maker, lead, helpers and the active Admins; a person signal reaches only that person; the commit that turns a person off closes
   that person's sockets. Tests: Task 5 ("an office task change reaches its people and the Admins, never an outsider socket", "a
   person signal never reaches the socket of another person", "closes the sockets of a person who is off"), Task 16 (the same on
   local workerd, with real sockets).
2. **A socket that died with no close frame (a phone that slept, code 1006) leaves a screen with old lists.** Expected: the client
   pings each 30 s, opens a new socket when no pong comes in 10 s, and reloads every list; the object closes a socket with no pong
   for 150 s. Tests: Task 10 ("opens again and reloads when no pong comes in 10 s"), Task 5 ("closes a socket with no pong for 150
   s, and keeps one that pinged"), Task 17 (the Cron sweep on local workerd).
3. **A write that rolls back sends a signal or a mail.** Expected: no signal on any socket and no outbox row. Tests: Task 5 ("sends
   nothing when the transaction rolls back"), Task 15 ("a refused write sends no signal and writes no outbox row").
4. **Two people save at the same moment, or the office object is overloaded.** Expected: the second write runs after the first
   commits; an overloaded or reset object answers the reason `busy`, never a bare 500. Tests: Task 7 ("maps an overloaded or reset
   office object to busy"), Task 15 ("runs two batches that arrive at one time one after the other").
5. **A Cron run with many due reminders or old outbox rows passes the 50 subrequests of Free.** Expected: the run sends 45
   network calls at most; the other rows wait for the next run and keep their attempts. Tests: Task 3 ("stops at the budget with an
   error that names a time to try again"), Task 17 ("sends at most 45 network calls in one run, and the next run sends the rest
   with no attempt lost").

---

## File map

| File | Create or modify | Responsibility |
|---|---|---|
| `server/data/lite/schema.ts` | modify | `LITE_SCHEMA_VERSION = 3`, the table `usage_day`, `LITE_STEPS`, the step path of `applyLiteSchema` |
| `server/data/lite/db.ts` | modify | `LiteDb.isOpen()` for the network guard |
| `server/data/save.ts` | modify | `Diff.noticeIds`, `SaveResult.noticeIds` |
| `server/mail/notices.ts` | modify | the notice producer on SQLite (`noticeIds`), the person reads and the Admin list on SQLite |
| `server/push/notify.ts` | modify | the push producer on SQLite (`noticeIds`, the chat audience in JavaScript), the device texts, `deps.pushFetch` |
| `server/core/ports.ts` | modify | `Deps.live?: LivePort`, `Deps.pushFetch?` |
| `server/office/net.ts` | create | `NetApi`, `NetAnswer`, the object side ports, the guard, `NET_BUDGET`, `NetBudgetSpent`, `postPush` |
| `server/office/workerNet.ts` | create | `WorkerNet`: the `RpcTarget` of the Worker (workerd only) |
| `server/office/meter.ts` | create | `OfficeMeter`: the day and month counts in memory, added in the next write |
| `server/office/live.ts` | create | `LiveTickets`, `liveSignals`, `deliver`, `sweep`, `closeOff`, `acceptLive` |
| `server/office/who.ts` | create | `OfficeWho` and `principalOfWho` |
| `server/office/batch.ts` | create | `runOfficeBatch`, `EffectLedger`, `officeData` |
| `server/office/parts.ts` | create | `officeParts`: the object work, testable on node:sqlite |
| `server/office/refusingDb.ts` | create | the Db of the Worker on the office path: it refuses every statement |
| `server/office/office.ts` | create | the production `Office` class (workerd only) |
| `server/office/jobs.ts` | create | `officeSteps`, `runOfficeJobs` |
| `server/office/workers.d.ts` | modify | the Hibernation and RPC types the object uses |
| `server/office/test/fakes.ts` | create | fake sockets and a fake network port for the node tests |
| `server/office/test/live/{wrangler.toml,wrangler.bundle.toml,entry.ts,testOffice.ts,harness.ts}` | create | the test Worker of the new test:office suites, and the config of the bundle smoke |
| `server/entries/officeWorker.ts` | create | `officeRoutes`: the batch route, the socket route, health, the Cron call, `officeErrorOf` |
| `server/entries/officeEntry.ts` | create | `officeEntry`, `onOffice`: the wiring of the office path (workerd only) |
| `server/entries/workerMain.ts` | create | the bundle entry: picks the office path or today's Postgres path; exports `Office` |
| `vite.server.config.ts` | modify | the worker bundle starts at `workerMain.ts`; `cloudflare:workers` stays external |
| `wrangler.server.toml` | modify | the binding, the migration and the Cron, none of them for production |
| `server/http/batch.ts` | modify | export `entryOf` |
| `server/jobs/app.ts` | modify | export `sameSecret` |
| `server/calls/live.ts` | create | the server call `live.ticket` |
| `src/api/contract/server.ts`, `src/api/handlers/serverFakes.ts`, `server/calls/index.ts`, `server/mcp/tools.ts`, `src/app/readMap.ts` | modify | `live.ticket` in every list of the new-call checklist |
| `src/api/remote/liveSocket.ts` | create | the screens' live socket: ticket, open, ping each 30 s, open again and reload |
| `src/app/remote/bootstrap.ts`, `src/env.d.ts` | modify | `liveSourceOf`: the socket with `VITE_MADAR_LIVE=socket`, else Supabase Realtime |
| `server/http/pagesApiProxy.ts` | modify | a 101 answer of the Worker goes back as it is |
| `server/mail/quota.ts`, `server/mail/outboxDriver.ts`, `server/mail/summary.ts` | modify | the mail quota, the outbox mail and the morning summary on SQLite |
| `server/jobs/steps/{heartbeat,triggers,summary,outbox,cleanup,uploads}.ts` | modify | the SQLite forms of the job steps |
| `server/usage/{meters,warn}.ts`, `server/calls/usage.ts`, `server/mail/templates/index.ts` | modify | `usage.get`, `usage.retryEffect` and the 80% warning on SQLite; the four day meters |
| `src/i18n/real/mail.en.json`, `src/i18n/real/mail.ar.json` | modify | the mail words of the four day meters |
| `server/test/liteHarness.ts` | modify | `LATER_CALLS` loses `usage.get` and `usage.retryEffect` |
| `server/office/test/{pinOffice.ts,pins.ts}`, `server/office/pins.wd.test.ts` | modify | the rows pins of one Cron run |
| `scripts/dev/office-smoke.ts`, `package.json` | create, modify | `npm run smoke:office`: the real bundle on `wrangler dev` |
| `docs/superpowers/real-build/proof.md`, `TASKS.md`, the guides | modify | the records of wave 3 |

Tests: `server/data/lite/{schema,producers,effects}.test.ts`; `server/data/save.test.ts`; `server/office/{net,meter,live,parts}.test.ts`;
`server/entries/officeWorker.test.ts`; `server/workerGraph.test.ts`; `scripts/deploy/wranglerServer.test.ts`;
`server/http/pagesApiProxy.test.ts`; `src/api/remote/liveSocket.test.ts`; `src/app/remote/bootstrap.test.ts`;
`server/jobs/steps/lite.test.ts`; `server/usage/lite.test.ts`; `src/api/calls.test.ts`; `server/core/serverCallMap.test.ts`;
`server/office/{batch,socket,cron}.wd.test.ts`; `server/office/pins.wd.test.ts`; `server/calls/live.test.ts`; `server/mcp/tools.test.ts`.

Commands used in every task:
- One server test file: `npx vitest run --project server <file> --no-file-parallelism --testTimeout=60000`.
- One screen test file: `npx vitest run --project unit <file> --no-file-parallelism --testTimeout=60000`.
- One workerd file: `npm run test:office -- <file>` with the sandbox off (`listen()` fails with `EPERM` in the sandbox).
- Types: `npm run typecheck`.

## Blocks, builders and size

The wave is about 7 days of builder work, one builder for each block, one block after the other. The exit plan said 5 days; the
SQLite forms of the job steps, the mail quota and the usage meters (about 40 texts, Block C) were not in that number.

| Block | Tasks | Builder days | Ends with |
|---|---|---|---|
| A. The office object core | 1 to 8 | 2.5 | the object answers a batch on local workerd |
| B. The live ticket and the screens | 9 to 11 | 1 | `live.ticket` on every list, `liveSocket.ts`, the Pages pass-through |
| C. Effects and jobs on SQLite | 12 to 14 | 2 | mail, push, quota, jobs and usage on SQLite; the Cron path |
| D. The workerd suites and the gate | 15 to 19 | 1.5 | the batch, socket and Cron suites, the bundle smoke, the gate |

Each builder runs the test files of its own tasks only. The whole `npm test` runs once, in Task 19.

---
# Block A: The office object core (Tasks 1 to 8, about 2.5 days)

### Task 1: Schema version 3, the table usage_day, and the schema steps

Wave 1 made one schema at version 1 and refused any other version. The office object of this wave is the first one that can
meet an office with an older schema (the test copy in wave 5), so the start needs steps. The day meters need one new table.

**Files:**
- Modify: `server/data/lite/schema.ts:5-14` (comment, version), `:52-70` (`SERVER_SQL`), `:129-151` (`applyLiteSchema`)
- Test: `server/data/lite/schema.test.ts`

**Interfaces:**
- Consumes: `SqlHost` (`server/data/lite/host.ts`), `freshLite` (`server/data/lite/testDb.ts`).
- Produces: `LITE_SCHEMA_VERSION = 3`; `LITE_STEPS: Readonly<Record<number, readonly string[]>>`; the table
  `usage_day (day, rows_read, rows_written, requests, calls, worker_requests)`; `applyLiteSchema(host): Promise<{ applied: boolean; steps?: number[] }>`.

- [ ] **Step 1: Write the failing tests**

In `server/data/lite/schema.test.ts`, change the table test and add three tests inside the `describe`:

```ts
  it('keeps the server tables of Postgres, apart from office_deletes and platform_config, and adds four of its own', async () => {
    const { raw } = await freshLite();
    const kept = SERVER_TABLES.filter((table) => table !== 'office_deletes' && table !== 'platform_config');
    const expected = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...kept, 'agent_approvals', 'office_snapshot', 'schema_version', 'usage_day'];
    expect(tablesOf(raw)).toEqual(expected.sort());
  });

  it('applies the steps above the version of an older office, in one transaction', async () => {
    const { raw } = await freshLite();
    raw.exec('drop table usage_day');
    raw.exec('update schema_version set version = 2');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [3] });
    expect(columnsOf(raw, 'usage_day')).toEqual(['day', 'rows_read', 'rows_written', 'requests', 'calls', 'worker_requests']);
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: LITE_SCHEMA_VERSION });
  });

  it('refuses an office whose version has no step to the next one, and changes nothing', async () => {
    const { raw } = await freshLite();
    raw.exec('update schema_version set version = 0');
    await expect(applyLiteSchema(nodeHost(raw))).rejects.toThrow('This build has no schema step to version 1');
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: 0 });
  });

  it('refuses an office that is newer than this build', async () => {
    const { raw } = await freshLite();
    raw.exec(`update schema_version set version = ${LITE_SCHEMA_VERSION + 1}`);
    await expect(applyLiteSchema(nodeHost(raw))).rejects.toThrow('Deploy the newer build');
  });
```

and change the pin test to version 3:

```ts
  it('pins the schema text to its version', () => {
    const sha256 = createHash('sha256').update(liteSchemaSql().join('\n')).digest('hex');
    expect({ version: LITE_SCHEMA_VERSION, sha256 }).toEqual({ version: 3, sha256: PINNED_SHA256 });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/data/lite/schema.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. The table test misses `usage_day`, the step test gets `{ applied: false }` or an error, the pin test sees version 1.

- [ ] **Step 3: Write the code**

In `server/data/lite/schema.ts`, replace the head comment and the version:

```ts
/**
 * The one SQLite schema of the office object (Supabase exit, wave 1), in place of the 18 Postgres migrations. The entity tables
 * come from tables.ts and the loader columns of query.ts. The office object applies it at start, after it reads schema_version:
 * a schema statement writes rows, so the start of a current office runs none. A new office gets the whole schema at once. An
 * older office runs the steps of LITE_STEPS above its version, in one transaction (exit wave 3): each new version needs a step.
 *
 * Rules (wave 0): plain key columns that the save writes; no foreign key; no ANALYZE; ascending indexes, so a backward scan gives
 * created_at desc, id desc and rowid desc with no sort step. Every time column holds ISO text in UTC (Date.toISOString).
 */
export const LITE_SCHEMA_VERSION = 3;
```

Above `SERVER_SQL`, add the new table, and add it to `SERVER_SQL` right before the `schema_version` line:

```ts
/**
 * The day meters of the Free day limits (exit wave 3, server/office/meter.ts): one row for each UTC day, because each Free limit of
 * Durable Objects ends at 00:00 UTC (03:00 Riyadh). requests: office object requests; worker_requests: Worker requests.
 */
const USAGE_DAY_SQL =
  'create table usage_day (day text primary key, rows_read integer not null default 0, rows_written integer not null default 0, '
  + 'requests integer not null default 0, calls integer not null default 0, worker_requests integer not null default 0)';
```

```ts
  `create table job_runs (key text primary key, done_at text not null default (${NOW}))`,
  USAGE_DAY_SQL,
  'create table schema_version (id integer primary key check (id = 1), version integer not null)',
```

Below `SERVER_INDEXES`, add the steps:

```ts
/**
 * The steps of an office with an older schema. The key is the version that the step makes, from the version before it. The texts
 * of a step must leave the same schema as liteSchemaSql of that version, so a stepped office and a new office are equal.
 * Version 2 is the step of wave 2 (the sign-in rows). Version 3 adds the day meters.
 */
export const LITE_STEPS: Readonly<Record<number, readonly string[]>> = {
  3: [USAGE_DAY_SQL],
};
```

Replace `applyLiteSchema`:

```ts
/** Makes the schema of a new office, steps an older one up, or checks the version of a current one (each wake of the office object). */
export async function applyLiteSchema(host: SqlHost): Promise<{ applied: boolean; steps?: number[] }> {
  const version = versionOf(host);
  if (version === LITE_SCHEMA_VERSION) return { applied: false };
  if (version !== undefined && version > LITE_SCHEMA_VERSION) {
    throw new Error(`The SQLite schema of this office is version ${version}, and this build knows version ${LITE_SCHEMA_VERSION}. Deploy the newer build.`);
  }
  if (version !== undefined) {
    const steps: number[] = [];
    for (let next = version + 1; next <= LITE_SCHEMA_VERSION; next += 1) {
      if (!LITE_STEPS[next]) throw new Error(`This build has no schema step to version ${next} (server/data/lite/schema.ts, LITE_STEPS).`);
      steps.push(next);
    }
    await host.transaction(async () => {
      for (const next of steps) for (const text of LITE_STEPS[next]) host.exec(text, []);
      host.exec('update schema_version set version = ? where id = 1', [LITE_SCHEMA_VERSION]);
    });
    return { applied: true, steps };
  }
  await host.transaction(async () => {
    for (const text of liteSchemaSql()) host.exec(text, []);
  });
  return { applied: true };
}
```

- [ ] **Step 4: Run the tests, then pin the new schema text**

Run: `npx vitest run --project server server/data/lite/schema.test.ts --no-file-parallelism --testTimeout=60000`
Expected: every test passes except "pins the schema text to its version", whose diff shows the new `sha256`. Copy that value into
`PINNED_SHA256` at the top of the test file, and run the same command again.
Expected: PASS.

- [ ] **Step 5: Run the SQLite suites that read the schema**

Run: `npx vitest run --project server server/data/lite --no-file-parallelism --testTimeout=60000`
Expected: PASS (the host checks, the save, the source and the office snapshot do not read `usage_day`).

- [ ] **Step 6: Commit**

```bash
git add server/data/lite/schema.ts server/data/lite/schema.test.ts
git commit -m "Exit wave 3: SQLite schema version 3 with the day meter table, and the schema steps of an older office"
```

---

### Task 2: The new notices of a save, and the mail and push producers on SQLite

The producers find the notices that a write inserted with the `xmin` test of Postgres (`NEW_NOTICES_SQL`,
`PUSH_NOTICE_PEOPLE_SQL`). SQLite has no `xmin`. The Diff knows the inserted notices already, as it knows `messageIds`.

**Files:**
- Modify: `server/data/save.ts:36-71` (`Diff`), `:73-85` (`SaveResult`), `:367-370` (`diffState` return), `:402-405` (`writeDiff` result)
- Modify: `server/mail/notices.ts` (imports, `noticeRows`)
- Modify: `server/push/notify.ts` (imports, `pushRows`)
- Test: `server/data/save.test.ts`, `server/data/lite/producers.test.ts` (create)

**Interfaces:**
- Consumes: `liteSave(q, before, after, o)`, `liteWriteState`, `freshLite`, `readLiteOffice(db, q)`, `liteDbOf(q)` (wave 1).
- Produces: `Diff.noticeIds: string[]`; `SaveResult.noticeIds?: string[]` (left out when empty); `noticeRows(q, saved:
  Pick<SaveResult, 'kinds' | 'people' | 'noticeIds'>)`; `pushRows(q, saved: Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'noticeIds'>)`;
  `NEW_NOTICE_LITE`, `PUSH_NOTICE_PEOPLE_LITE`, `PUSH_DEVICE_PEOPLE_LITE`, `MESSAGE_LITE`.

- [ ] **Step 1: Write the failing test of the Diff**

Add to `server/data/save.test.ts`, after the `describe` of the new messages:

```ts
describe('the new notices of a save (the mail and push producers on SQLite read them)', () => {
  it('lists the ids of the notices that the save inserted, and leaves the list out when there are none', async () => {
    const after = copy();
    const notice = Object.values(after.notifications)[0];
    after.notifications.ntf_901 = { ...notice, id: 'ntf_901', read: false };
    after.notifications.ntf_902 = { ...notice, id: 'ntf_902', read: false };
    expect((await save(recorder().q, seed, after)).noticeIds).toEqual(['ntf_901', 'ntf_902']);
    const edited = copy();
    Object.values(edited.notifications)[0].read = true;
    expect((await save(recorder().q, seed, edited)).noticeIds).toBeUndefined();
    expect(diffState(seed, edited).noticeIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing tests of the producers**

Create `server/data/lite/producers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { noticeRows } from '../../mail/notices';
import { pushRows } from '../../push/notify';
import { liteSave } from './save';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const TODAY = '2026-10-04';
const STAMP = '2026-10-04T09:00:00.000+03:00';
/** A push address of a real push service, so isPushEndpoint takes it (src/api/contract/push.ts). */
const PUSH = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

/** The sample office on node:sqlite: usr_002 takes the mail of task_assigned, usr_002 and usr_003 have a push device. */
async function office() {
  const lite = await freshLite();
  const seed = await buildSeed(TODAY, async () => undefined);
  const prefs = seed.users.usr_002.preferences;
  seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
  seed.pushDevices = {
    pdv_901: { id: 'pdv_901', userId: 'usr_002', endpoint: PUSH('aa'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
    pdv_902: { id: 'pdv_902', userId: 'usr_003', endpoint: PUSH('bb'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
  };
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  lite.log.length = 0;
  return { ...lite, seed };
}

function withNotices(seed: State, notices: { id: string; userId: string; read?: boolean }[]): State {
  const after = structuredClone(seed);
  for (const n of notices) {
    after.notifications[n.id] = {
      id: n.id, userId: n.userId, trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_001',
      read: n.read ?? false, createdAt: STAMP, dedupeKey: null,
    };
  }
  return after;
}

/** A direct chat of usr_002 and usr_003 with one new message. */
function withDirectMessage(seed: State, message: { authorId: string; actingForId: string | null }): State {
  const after = structuredClone(seed);
  after.conversations.cnv_901 = { id: 'cnv_901', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_003'], createdAt: STAMP };
  const base = Object.values(seed.messages)[0];
  after.messages.msg_901 = { ...base, id: 'msg_901', conversationId: 'cnv_901', authorId: message.authorId, actingForId: message.actingForId } as State['messages'][string];
  return after;
}

describe('the mail and push producers on SQLite (server/mail/notices.ts, server/push/notify.ts)', () => {
  it('writes one mail row for each new unread notice whose person takes its mail, in the order of the save', async () => {
    const { db, seed, log } = await office();
    const after = withNotices(seed, [{ id: 'ntf_901', userId: 'usr_002' }, { id: 'ntf_902', userId: 'usr_009' }, { id: 'ntf_903', userId: 'usr_002', read: true }]);
    const rows = await db.tx('write', async (q) => noticeRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'mail.notice', payload: { notificationId: 'ntf_901' } }]);
    // No Postgres text ran: the host refuses one, so a pass also proves it.
    expect(log.filter((text) => /\$\d|::[a-z]/i.test(text))).toEqual([]);
  });

  it('writes no mail row and reads no notice for a save with no new notice', async () => {
    const { db, seed, log } = await office();
    const after = structuredClone(seed);
    after.users.usr_003 = { ...after.users.usr_003, discipline: 'Design' };
    expect(await db.tx('write', async (q) => noticeRows(q, await liteSave(q, seed, after)))).toEqual([]);
    expect(log.filter((text) => text.includes('from notifications'))).toEqual([]);
  });

  it('writes one push row for each active human with a device and a new notice', async () => {
    const { db, seed } = await office();
    const after = withNotices(seed, [{ id: 'ntf_901', userId: 'usr_002' }, { id: 'ntf_902', userId: 'usr_004' }]);
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.notify', payload: { userId: 'usr_002' } }]);
  });

  it('writes a push row for the other reader of a new chat message, never for its author', async () => {
    const { db, seed } = await office();
    const after = withDirectMessage(seed, { authorId: 'usr_002', actingForId: null });
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.notify', payload: { userId: 'usr_003' } }]);
  });

  it('never pushes a message to the person an agent wrote it for', async () => {
    const { db, seed } = await office();
    const after = withDirectMessage(seed, { authorId: 'usr_009', actingForId: 'usr_002' });
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.notify', payload: { userId: 'usr_003' } }]);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --project server server/data/save.test.ts server/data/lite/producers.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `noticeIds` is undefined; the producers fail with the host refusal "Give the caller a SQLite form" (`$1` of
`NEW_NOTICES_SQL`).

- [ ] **Step 4: Write the Diff part**

In `server/data/save.ts`, add the field to `Diff` after `messageIds`:

```ts
  /** The notices that the save inserted, in State order: the mail and push producers on SQLite (exit wave 3) read them. */
  noticeIds: string[];
```

add it to `SaveResult` after `messageIds?`:

```ts
  /** The notices that the save inserted. Left out when there are none. */
  noticeIds?: string[];
```

in `diffState`, beside `messageIds`:

```ts
  const noticeIds = tables.find((change) => change.spec.collection === 'notifications')?.inserted ?? [];
```

and add `noticeIds` to its returned object, next to `messageIds`. In `writeDiff`, extend `result`:

```ts
  const result = (fields: Partial<SaveResult> = {}): SaveResult => ({
    changed, kinds: new Set(diff.kinds), projects, office, people: new Set(diff.people), bytesWritten: 0, signals: [],
    ...(diff.messageIds.length > 0 ? { messageIds: diff.messageIds } : {}),
    ...(diff.noticeIds.length > 0 ? { noticeIds: diff.noticeIds } : {}),
    ...fields,
  });
```

- [ ] **Step 5: Write the mail producer on SQLite**

In `server/mail/notices.ts`, add the imports:

```ts
import type { Notification } from '../../src/api/contract/entities';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
```

below `NEW_NOTICES_SQL`, the SQLite text:

```ts
/**
 * SQLite (exit wave 3): one notice that the save inserted, if it is still unread. SQLite has no xmin: the save names its new
 * notices (SaveResult.noticeIds). The person comes from the office lists in memory, as the users table holds only id and doc.
 */
export const NEW_NOTICE_LITE = 'select id, user_id, doc from notifications where id = ?1 and read = 0';
```

and change `noticeRows`:

```ts
/** The mail.notice outbox rows of one save. Run inside the call's transaction, after the save. */
export async function noticeRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'noticeIds'>): Promise<OutboxRow[]> {
  if (!saved.kinds.has('notifications') || saved.people.size === 0) return [];
  if (isLite(q)) return liteNoticeRows(q, saved.noticeIds ?? []);
  const found = await q<NewNotice>(NEW_NOTICES_SQL, [[...saved.people].sort()]);
  return found
    .filter((n) => mailable(n) && inAppOn(n.preferences, n.trigger) && emailOn(n.preferences, n.trigger))
    .map((n) => ({ kind: NOTICE_EFFECT, payload: { notificationId: n.id } }));
}

/** The mail rows of the new notices on SQLite, in the order of the save (the order of ord on Postgres). */
async function liteNoticeRows(q: Query, ids: readonly string[]): Promise<OutboxRow[]> {
  if (ids.length === 0) return [];
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const rows: OutboxRow[] = [];
  for (const id of ids) {
    const [notice] = await q<{ id: string; user_id: string; doc: Notification }>(NEW_NOTICE_LITE, [id]);
    const person = notice ? lists.users[notice.user_id] : undefined;
    if (!notice || !person) continue;
    const trigger = notice.doc.trigger;
    if (mailable(person) && inAppOn(person.preferences, trigger) && emailOn(person.preferences, trigger)) {
      rows.push({ kind: NOTICE_EFFECT, payload: { notificationId: notice.id } });
    }
  }
  return rows;
}
```

- [ ] **Step 6: Write the push producer on SQLite**

In `server/push/notify.ts`, add the imports:

```ts
import type { Conversation } from '../../src/api/contract/entities';
import type { OfficeSnapshot } from '../core/types';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
```

below `PUSH_MESSAGE_PEOPLE_SQL`, the SQLite texts:

```ts
// SQLite (exit wave 3). The new notices come from the save (SaveResult.noticeIds), the people of a chat from the office lists in
// memory: the users, conversations, projects and members tables hold only id and doc. One bound list each (json_each).
export const PUSH_NOTICE_PEOPLE_LITE = 'select distinct user_id from notifications where id in (select value from json_each(?1)) and read = 0';
export const PUSH_DEVICE_PEOPLE_LITE = 'select distinct user_id from push_devices where user_id in (select value from json_each(?1))';
export const MESSAGE_LITE = 'select conversation_id, doc from messages where id = ?1';
```

and change `pushRows`:

```ts
/** The push.notify outbox rows of one save. Run inside the call's transaction, after the save. */
export async function pushRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'noticeIds'>): Promise<OutboxRow[]> {
  if (isLite(q)) return litePushRows(q, saved);
  const people = new Set<string>();
  if (saved.kinds.has('notifications') && saved.people.size > 0) {
    for (const row of await q<PersonRow>(PUSH_NOTICE_PEOPLE_SQL, [[...saved.people].sort()])) people.add(row.user_id);
  }
  if ((saved.messageIds?.length ?? 0) > 0) {
    for (const row of await q<PersonRow>(PUSH_MESSAGE_PEOPLE_SQL, [saved.messageIds])) people.add(row.user_id);
  }
  return [...people].sort().map((userId) => ({ kind: PUSH_EFFECT, payload: { userId } }));
}

/** The people who read a chat, as PUSH_MESSAGE_PEOPLE_SQL finds them: a direct chat's two members; a project's leader, team and Admins. */
function chatAudience(lists: OfficeSnapshot['lists'], chat: Conversation): string[] {
  if (chat.kind === 'direct') return [...chat.memberIds];
  if (chat.projectId === null) return [];
  const projectId = chat.projectId;
  const out = Object.values(lists.members).filter((m) => m.projectId === projectId).map((m) => m.userId);
  const leaderId = lists.projects[projectId]?.leaderId;
  if (leaderId) out.push(leaderId);
  for (const user of Object.values(lists.users)) if (user.kind === 'human' && user.active && user.systemRole === 'admin') out.push(user.id);
  return out;
}

async function litePushRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'noticeIds'>): Promise<OutboxRow[]> {
  const noticeIds = saved.kinds.has('notifications') && saved.people.size > 0 ? saved.noticeIds ?? [] : [];
  const messageIds = saved.messageIds ?? [];
  if (noticeIds.length === 0 && messageIds.length === 0) return [];
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const reads = (userId: string) => lists.users[userId]?.kind === 'human' && lists.users[userId]?.active === true;
  const people = new Set<string>();
  if (noticeIds.length > 0) {
    for (const row of await q<PersonRow>(PUSH_NOTICE_PEOPLE_LITE, [noticeIds])) if (reads(row.user_id)) people.add(row.user_id);
  }
  for (const id of messageIds) {
    const [message] = await q<{ conversation_id: string; doc: { authorId?: string; actingForId?: string | null } }>(MESSAGE_LITE, [id]);
    const chat = message ? lists.conversations[message.conversation_id] : undefined;
    if (!message || !chat) continue;
    for (const userId of chatAudience(lists, chat)) {
      if (userId !== message.doc.authorId && userId !== message.doc.actingForId && reads(userId)) people.add(userId);
    }
  }
  if (people.size === 0) return [];
  const withDevice = new Set((await q<PersonRow>(PUSH_DEVICE_PEOPLE_LITE, [[...people].sort()])).map((row) => row.user_id));
  return [...people].filter((userId) => withDevice.has(userId)).sort().map((userId) => ({ kind: PUSH_EFFECT, payload: { userId } }));
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run --project server server/data/save.test.ts server/data/lite/producers.test.ts server/mail/notices.test.ts server/push/notify.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The Postgres tests of `notices.test.ts` and `notify.test.ts` do not change.

- [ ] **Step 8: Commit**

```bash
git add server/data/save.ts server/data/save.test.ts server/mail/notices.ts server/push/notify.ts server/data/lite/producers.test.ts
git commit -m "Exit wave 3: the save names its new notices, and the mail and push producers read them on SQLite"
```

---

### Task 3: The network port of the office object

The object must not reach the network. Each object method gets a `NetApi` from the Worker (an `RpcTarget`, Task 7) and builds the
ports of `Deps` on it. Error classes do not cross RPC, so every answer is a `NetAnswer`, and the object side builds the class again.

**Files:**
- Create: `server/office/net.ts`, `server/office/workerNet.ts`
- Modify: `server/core/ports.ts` (the end of `Deps`; a new `LivePort`), `server/data/lite/db.ts` (`LiteDb.isOpen`),
  `server/office/workers.d.ts`
- Test: `server/office/net.test.ts`

**Interfaces:**
- Consumes: `FilesPort`, `MailPort`, `Mail`, `PresignedPut`, `FileStoreKind` (`server/core/ports.ts`); `MailSendError`
  (`server/mail/resend.ts`); `PushSendError`, `sendPush` (`server/push/send.ts`); `PushConfigError` (`server/push/vapid.ts`);
  `isPushEndpoint` (`src/api/contract/push.ts`).
- Produces: `NetApi`, `NetAnswer<T>`, `NetFailure`, `answerOf`, `failureOf`, `errorOf`, `postPush(fetch)`, `NET_BUDGET = 45`,
  `NetBudgetSpent` (with `retryAt`), `NET_IN_TRANSACTION`, `PUSH_TIMEOUT_MS = 3000`, `netPorts(net, { guard, kind, maxFileBytes })
  => { files, mail, pushFetch, used }`; `WorkerNet` (class); `Deps.pushFetch?: typeof globalThis.fetch`; `Deps.live?: LivePort`;
  `LivePort.mint(userId, now) => { ticket, expiresAt }`; `LiteDb.isOpen(): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `server/office/net.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Mail } from '../core/ports';
import { MailSendError } from '../mail/resend';
import { PushSendError, sendPush } from '../push/send';
import { makeVapidKeys } from '../push/vapid';
import { NET_BUDGET, NET_IN_TRANSACTION, NetBudgetSpent, answerOf, failureOf, netPorts, postPush, type NetAnswer, type NetApi } from './net';

const NOW = new Date('2026-10-04T06:00:00Z');
const PUSH = 'https://fcm.googleapis.com/fcm/send/abc';
const MAIL: Mail = { to: 'a@madar.test', subject: 'S', html: '<p>H</p>', text: 'H', tag: 'notice', idempotencyKey: 'notice-ntf_001' };
const ok = <T,>(value: T): Promise<NetAnswer<T>> => Promise.resolve({ ok: true, value });

/** A network port that records each call and answers well, unless a test gives it another answer. */
function recordingNet(over: Partial<NetApi> = {}): NetApi & { calls: string[] } {
  const calls: string[] = [];
  const net: NetApi & { calls: string[] } = {
    calls,
    presignPut: (key) => (calls.push(`presignPut ${key}`), ok({ url: `https://files.test/put/${key}`, headers: { 'Content-Type': 'image/png' }, expiresAt: '2099-01-01T00:00:00.000Z' })),
    presignGet: (key) => (calls.push(`presignGet ${key}`), ok({ url: `https://files.test/get/${key}`, expiresAt: '2099-01-01T00:00:00.000Z' })),
    head: (key) => (calls.push(`head ${key}`), ok({ size: 10, mimeType: 'image/png' })),
    copy: (from, to) => (calls.push(`copy ${from}>${to}`), ok(null)),
    remove: (keys) => (calls.push(`remove ${keys.join(',')}`), ok(null)),
    sendMail: (mail) => (calls.push(`mail ${mail.idempotencyKey}`), ok({ id: 'mail_1' })),
    pushPost: (endpoint) => (calls.push(`push ${endpoint}`), ok({ status: 201 })),
    ...over,
  };
  return net;
}

const closed = { open: () => false, now: () => NOW };

describe('the network port of the office object (server/office/net.ts)', () => {
  it('answers a file call through the port, and counts only a call that is a real network call', async () => {
    const net = recordingNet();
    const ports = netPorts(net, { guard: closed, kind: 'r2', maxFileBytes: 100 });
    expect(await ports.files.presignGet('files/a', { disposition: 'inline', filename: 'a.png', mimeType: 'image/png' })).toEqual({ url: 'https://files.test/get/files/a', expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(await ports.files.head('files/a')).toEqual({ size: 10, mimeType: 'image/png' });
    expect([ports.files.kind, ports.files.maxFileBytes, ports.used()]).toEqual(['r2', 100, 1]);
    expect(net.calls).toEqual(['presignGet files/a', 'head files/a']);
  });

  it('refuses a network call while a transaction is open, before it reaches the Worker', async () => {
    const net = recordingNet();
    const ports = netPorts(net, { guard: { open: () => true, now: () => NOW }, kind: 'r2', maxFileBytes: 100 });
    await expect(ports.mail.send(MAIL)).rejects.toThrow(NET_IN_TRANSACTION);
    expect(net.calls).toEqual([]);
  });

  it('stops at the budget with an error that names a time to try again', async () => {
    const ports = netPorts(recordingNet(), { guard: closed, kind: 'r2', maxFileBytes: 100 });
    for (let i = 0; i < NET_BUDGET; i += 1) await ports.mail.send(MAIL);
    const error = await ports.mail.send(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetBudgetSpent);
    expect((error as NetBudgetSpent).retryAt.toISOString()).toBe('2026-10-04T06:01:00.000Z');
  });

  it('gives back the error class that the caller reads, with its fields', async () => {
    const refused = new MailSendError('Resend refused the mail.', { status: 403, code: 'validation_error', retryable: false });
    const net = recordingNet({ sendMail: () => Promise.resolve({ ok: false, failure: failureOf(refused) }) });
    const error = await netPorts(net, { guard: closed, kind: 'r2', maxFileBytes: 100 }).mail.send(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailSendError);
    expect({ ...(error as MailSendError).toJSON() }).toEqual(refused.toJSON());
  });

  it('turns a thrown error into a failure, and never throws', async () => {
    expect(await answerOf(async () => { throw new PushSendError('The push service answered 503.', 503); })).toEqual({
      ok: false, failure: { name: 'PushSendError', message: 'The push service answered 503.', status: 503 },
    });
  });

  it('lets sendPush run in the object and post in the Worker, with the same outcomes', async () => {
    const keys = await makeVapidKeys();
    const config = { ...keys, subject: 'mailto:madar@vado.sa' };
    const net = recordingNet();
    const { pushFetch } = netPorts(net, { guard: closed, kind: 'r2', maxFileBytes: 100 });
    expect(await sendPush(config, PUSH, { fetch: pushFetch, now: () => NOW })).toBe('sent');
    const gone = netPorts(recordingNet({ pushPost: () => ok({ status: 410 }) }), { guard: closed, kind: 'r2', maxFileBytes: 100 });
    expect(await sendPush(config, PUSH, { fetch: gone.pushFetch, now: () => NOW })).toBe('gone');
    const late = netPorts(recordingNet({ pushPost: () => Promise.resolve({ ok: false, failure: { name: 'TimeoutError', message: 'timed out' } }) }), { guard: closed, kind: 'r2', maxFileBytes: 100 });
    await expect(sendPush(config, PUSH, { fetch: late.pushFetch, now: () => NOW })).rejects.toThrow('The push to fcm.googleapis.com timed out.');
    expect(net.calls).toEqual([`push ${PUSH}`]);
  });
});

describe('the push POST of the Worker (postPush)', () => {
  it('refuses an address that is not a push service, with no fetch', async () => {
    const seen: string[] = [];
    const post = postPush(async (input) => (seen.push(String(input)), new Response(null, { status: 201 })));
    expect(await post('https://evil.example/collect', {}, 3000)).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });

  it('posts the headers to a push service and gives back the status', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const post = postPush(async (input, init) => (seen.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) }), new Response(null, { status: 201 })));
    expect(await post(PUSH, { authorization: 'vapid t=x, k=y', ttl: '3600' }, 3000)).toEqual({ ok: true, value: { status: 201 } });
    expect(seen).toEqual([{ url: PUSH, headers: { authorization: 'vapid t=x, k=y', ttl: '3600' } }]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/office/net.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to resolve import ./net".

- [ ] **Step 3: Write the port types in ports.ts and the guard in db.ts**

In `server/core/ports.ts`, above `export type Deps`, add:

```ts
/** The live socket tickets of the office object (exit wave 3): live.ticket mints one, the socket open takes it (server/office/live.ts). */
export interface LivePort {
  mint(userId: string, now: Date): { ticket: string; expiresAt: string };
}
```

and at the end of `Deps`:

```ts
  /**
   * The fetch of a push POST. The office object passes the one of its network port (server/office/net.ts), so the POST runs in the
   * Worker. Left out on every other host: sendPush then uses the global fetch.
   */
  pushFetch?: typeof globalThis.fetch;
  /** The live socket tickets. Only the office object has them; live.ticket answers not_found without them. */
  live?: LivePort;
```

In `server/data/lite/db.ts`, add to the `LiteDb` type and to the `db` object:

```ts
export type LiteDb = Db & { readonly dialect: 'sqlite'; readonly host: SqlHost; readonly meter: RowMeter; isOpen(): boolean };
```

```ts
    /** True while a transaction is open: the network port of the office object then refuses every call (server/office/net.ts). */
    isOpen: () => open !== undefined,
```

- [ ] **Step 4: Write the port**

Create `server/office/net.ts`:

```ts
import { isPushEndpoint } from '../../src/api/contract/push';
import type { FileStoreKind, FilesPort, Mail, MailPort, PresignedPut } from '../core/ports';
import { MailSendError } from '../mail/resend';
import { PushSendError } from '../push/send';
import { PushConfigError } from '../push/vapid';

/**
 * The network port of the office object (exit wave 3). The office object does no network work (exit plan, Global Constraints):
 * the Worker passes an RpcTarget with these methods (server/office/workerNet.ts) into each object call, and the object calls it
 * back while the call runs (RPC lifecycle: a stub in the parameters lives until the call returns). So mail, push, file links and
 * R2 run in the Worker, and the effect code of the Postgres path runs in the object as it is.
 *
 * An error class does not cross RPC, so the Worker answers each call as a NetAnswer and the object builds the class again
 * (MailSendError, PushSendError, PushConfigError, a TimeoutError), because the callers test the class.
 */

export type NetFailure = { name: string; message: string; status?: number | null; code?: string; retryable?: boolean };
export type NetAnswer<T> = { ok: true; value: T } | { ok: false; failure: NetFailure };

/** What the office object asks the Worker to do on the network. Every answer is a NetAnswer, never a throw. */
export interface NetApi {
  presignPut(key: string, o: { mimeType: string; size?: number }): Promise<NetAnswer<PresignedPut>>;
  presignGet(key: string, o: { disposition: 'inline' | 'attachment'; filename: string; mimeType: string }): Promise<NetAnswer<{ url: string; expiresAt: string }>>;
  head(key: string, o?: { timeoutMs?: number }): Promise<NetAnswer<{ size: number; mimeType: string } | null>>;
  copy(from: string, to: string): Promise<NetAnswer<null>>;
  remove(keys: string[]): Promise<NetAnswer<null>>;
  sendMail(mail: Mail): Promise<NetAnswer<{ id: string }>>;
  pushPost(endpoint: string, headers: Record<string, string>, timeoutMs: number): Promise<NetAnswer<{ status: number }>>;
}

/** The fields of an error that a caller on the other side reads. */
export function failureOf(error: unknown): NetFailure {
  if (error instanceof MailSendError) return { name: error.name, message: error.message, status: error.status, code: error.code, retryable: error.retryable };
  if (error instanceof PushSendError) return { name: error.name, message: error.message, status: error.status };
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

/** The error of a failure, with its class back. */
export function errorOf(failure: NetFailure): Error {
  if (failure.name === 'MailSendError') {
    return new MailSendError(failure.message, { status: failure.status ?? null, code: failure.code ?? 'unknown', retryable: failure.retryable ?? true });
  }
  if (failure.name === 'PushSendError') return new PushSendError(failure.message, failure.status ?? null);
  if (failure.name === 'PushConfigError') return new PushConfigError(failure.message);
  if (failure.name === 'TimeoutError') return new DOMException(failure.message, 'TimeoutError');
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}

/** The Worker side of each call: the value, or the failure of the error it threw. */
export async function answerOf<T>(work: () => Promise<T>): Promise<NetAnswer<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

/** The 3 s of every network call (server/CLAUDE.md, "Rules a change must keep"). */
export const PUSH_TIMEOUT_MS = 3_000;

/** The push POST in the Worker: only to a push service (the rule of push.register), 3 s at most, the body dropped. */
export function postPush(fetchImpl: typeof globalThis.fetch) {
  return (endpoint: string, headers: Record<string, string>, timeoutMs: number): Promise<NetAnswer<{ status: number }>> =>
    answerOf(async () => {
      if (!isPushEndpoint(endpoint)) throw new Error('The office object asked for a push to an address that is not a push service.');
      const response = await fetchImpl(endpoint, { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(Math.min(timeoutMs, PUSH_TIMEOUT_MS)) });
      void response.body?.cancel().catch(() => undefined);
      return { status: response.status };
    });
}

/**
 * The most network calls of one object method call. A Worker on Free has 50 subrequests for each invocation; the token check
 * can use one for the key set, and the office object call itself counts with the internal services (1,000). A link on R2 is
 * signed in the Worker with no fetch, so it does not count.
 */
export const NET_BUDGET = 45;
/** How long a row waits that the budget stopped: the next run of the job (every 15 minutes) or a later request takes it. */
export const NET_WAIT_MS = 60_000;

/** A network call over the budget. processOutbox keeps the row until retryAt and gives the attempt back (server/core/effects.ts). */
export class NetBudgetSpent extends Error {
  readonly retryAt: Date;

  constructor(now: Date) {
    super(`The office object used its ${NET_BUDGET} network calls of this request. The rest waits for the next run.`);
    this.name = 'NetBudgetSpent';
    this.retryAt = new Date(now.getTime() + NET_WAIT_MS);
  }
}

export const NET_IN_TRANSACTION = 'The office object makes no network call inside a transaction: the transaction holds every other request.';

export type NetGuard = { open(): boolean; now(): Date };
export type NetPorts = { files: FilesPort; mail: MailPort; pushFetch: typeof globalThis.fetch; used(): number };

export function netPorts(net: NetApi, o: { guard: NetGuard; kind: FileStoreKind; maxFileBytes: number }): NetPorts {
  let used = 0;
  async function call<T>(counts: boolean, work: () => Promise<NetAnswer<T>>): Promise<T> {
    if (o.guard.open()) throw new Error(NET_IN_TRANSACTION);
    if (counts) {
      if (used >= NET_BUDGET) throw new NetBudgetSpent(o.guard.now());
      used += 1;
    }
    const answer = await work();
    if (!answer.ok) throw errorOf(answer.failure);
    return answer.value;
  }
  const signs = o.kind !== 'r2';
  const files: FilesPort = {
    kind: o.kind,
    maxFileBytes: o.maxFileBytes,
    presignPut: (key, put) => call(signs, () => net.presignPut(key, put)),
    presignGet: (key, get) => call(signs, () => net.presignGet(key, get)),
    head: (key, head) => call(true, () => net.head(key, head)),
    copy: async (from, to) => {
      await call(true, () => net.copy(from, to));
    },
    remove: async (keys) => {
      if (keys.length > 0) await call(true, () => net.remove(keys));
    },
  };
  const mail: MailPort = { send: (one) => call(true, () => net.sendMail(one)) };
  // sendPush (server/push/send.ts) signs the VAPID token in the object and gives this fetch the POST: the Worker only posts.
  const pushFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const { status } = await call(true, () => net.pushPost(String(input), headers, PUSH_TIMEOUT_MS));
    return new Response(null, { status });
  }) as typeof globalThis.fetch;
  return { files, mail, pushFetch, used: () => used };
}
```

- [ ] **Step 5: Write the Worker side**

In `server/office/workers.d.ts`, add inside `declare module 'cloudflare:workers'`:

```ts
  /** A class whose methods a stub can call over Workers RPC (developers.cloudflare.com, Workers RPC). */
  export abstract class RpcTarget {
    constructor();
  }
```

Create `server/office/workerNet.ts`:

```ts
import { RpcTarget } from 'cloudflare:workers';
import type { FilesPort, Mail, MailPort, PresignedPut } from '../core/ports';
import { answerOf, postPush, type NetAnswer, type NetApi } from './net';

/**
 * The network port of the Worker (exit wave 3, server/office/net.ts): the Worker passes one into each office object call, and the
 * object calls it back. Each method runs one port call of the Worker and answers it as a NetAnswer. workerd only (RpcTarget).
 */
export class WorkerNet extends RpcTarget implements NetApi {
  readonly #files: FilesPort;
  readonly #mail: MailPort;
  readonly #post: ReturnType<typeof postPush>;

  constructor(o: { files: FilesPort; mail: MailPort; fetch?: typeof globalThis.fetch }) {
    super();
    this.#files = o.files;
    this.#mail = o.mail;
    this.#post = postPush(o.fetch ?? ((input, init) => fetch(input, init)));
  }

  presignPut(key: string, o: { mimeType: string; size?: number }): Promise<NetAnswer<PresignedPut>> {
    return answerOf(() => this.#files.presignPut(key, o));
  }

  presignGet(key: string, o: { disposition: 'inline' | 'attachment'; filename: string; mimeType: string }): Promise<NetAnswer<{ url: string; expiresAt: string }>> {
    return answerOf(() => this.#files.presignGet(key, o));
  }

  head(key: string, o?: { timeoutMs?: number }): Promise<NetAnswer<{ size: number; mimeType: string } | null>> {
    return answerOf(() => this.#files.head(key, o));
  }

  copy(from: string, to: string): Promise<NetAnswer<null>> {
    return answerOf(async () => (await this.#files.copy(from, to), null));
  }

  remove(keys: string[]): Promise<NetAnswer<null>> {
    return answerOf(async () => (await this.#files.remove(keys), null));
  }

  sendMail(mail: Mail): Promise<NetAnswer<{ id: string }>> {
    return answerOf(() => this.#mail.send(mail));
  }

  pushPost(endpoint: string, headers: Record<string, string>, timeoutMs: number): Promise<NetAnswer<{ status: number }>> {
    return this.#post(endpoint, headers, timeoutMs);
  }
}
```

- [ ] **Step 6: Run the tests and the types**

Run: `npx vitest run --project server server/office/net.test.ts server/data/lite/db.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS (`workerNet.ts` checks against `workers.d.ts`; no node test imports it).

- [ ] **Step 7: Commit**

```bash
git add server/office/net.ts server/office/workerNet.ts server/office/net.test.ts server/office/workers.d.ts server/core/ports.ts server/data/lite/db.ts
git commit -m "Exit wave 3: the network port of the office object, with the transaction guard and the budget of Workers Free"
```

---

### Task 4: The office meter of the Free day limits

`countRequest` writes 1 `usage_month` row for each request today (map of writes, section 18). The office meter keeps every count
in memory and adds it in the next write transaction: 2 rows written for each write call, no row for a read.

**Files:**
- Create: `server/office/meter.ts`
- Test: `server/office/meter.test.ts`

**Interfaces:**
- Consumes: `onCommit(q, fn)` (`server/data/lite/db.ts`); `utcDay` (`server/mail/quota.ts`); `utcMonth` (`server/usage/meters.ts`);
  the table `usage_day` (Task 1).
- Produces: `DayCounts = { rowsRead; rowsWritten; requests; calls; workerRequests }`; `class OfficeMeter implements MeterPort` with
  `request(o?: { calls?: number; worker?: number }): void`, `pending(): DayCounts`, `flush(q: Query, now: Date): Promise<void>`;
  `DAY_FLUSH_LITE`, `MONTH_FLUSH_LITE`, `DAY_ROW_LITE`.

- [ ] **Step 1: Write the failing tests**

Create `server/office/meter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { freshLite } from '../data/lite/testDb';
import { DAY_ROW_LITE, OfficeMeter } from './meter';

const NOW = new Date('2026-10-04T06:00:00Z');

async function setup() {
  const lite = await freshLite();
  const totals = { rowsRead: 0, rowsWritten: 0 };
  return { ...lite, totals, meter: new OfficeMeter({ totals }) };
}

describe('the office meter (server/office/meter.ts)', () => {
  it('keeps the counts in memory and writes no statement for a request', async () => {
    const { db, log, meter } = await setup();
    meter.request({ calls: 3, worker: 2 });
    await meter.countRequest(db);
    expect(log).toEqual([]);
    expect(meter.pending()).toEqual({ rowsRead: 0, rowsWritten: 0, requests: 1, calls: 3, workerRequests: 2 });
  });

  it('adds the rows of the host, the requests and the calls in the next write, and clears them after the commit', async () => {
    const { db, totals, meter } = await setup();
    meter.request({ calls: 2, worker: 1 });
    meter.addBytes(500);
    totals.rowsRead = 120;
    totals.rowsWritten = 9;
    await db.tx('write', (q) => meter.flush(q, NOW));
    expect(await db.statement('read', DAY_ROW_LITE, ['2026-10-04'])).toEqual([{ rows_read: 120, rows_written: 9, requests: 1, calls: 2, worker_requests: 1 }]);
    expect(await db.statement('read', 'select calls, bytes_read from usage_month where month = ?1', ['2026-10'])).toEqual([{ calls: 1, bytes_read: 500 }]);
    expect(meter.pending()).toEqual({ rowsRead: 0, rowsWritten: 0, requests: 0, calls: 0, workerRequests: 0 });
  });

  it('keeps the counts of a write that rolled back, also the rows that it wrote', async () => {
    const { db, totals, meter } = await setup();
    meter.request({ calls: 1 });
    totals.rowsWritten = 7;
    await expect(db.tx('write', async (q) => {
      await meter.flush(q, NOW);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    totals.rowsWritten = 9;
    expect(meter.pending()).toMatchObject({ rowsWritten: 9, requests: 1, calls: 1 });
  });

  it('adds a flush of another UTC day to its own row', async () => {
    const { db, meter } = await setup();
    meter.request();
    await db.tx('write', (q) => meter.flush(q, NOW));
    meter.request();
    meter.request();
    await db.tx('write', (q) => meter.flush(q, new Date('2026-10-05T00:00:01Z')));
    expect(await db.statement('read', 'select day, requests from usage_day')).toEqual([{ day: '2026-10-04', requests: 1 }, { day: '2026-10-05', requests: 2 }]);
  });

  it('writes nothing when no count changed', async () => {
    const { db, log, meter } = await setup();
    await db.tx('write', (q) => meter.flush(q, NOW));
    expect(log).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/office/meter.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to resolve import ./meter".

- [ ] **Step 3: Write the meter**

Create `server/office/meter.ts`:

```ts
import type { Db, MeterPort, Query } from '../core/ports';
import { onCommit } from '../data/lite/db';
import { utcDay } from '../mail/quota';
import { utcMonth } from '../usage/meters';

/**
 * The meter of the office object (exit wave 3; wave 0 change 6). The Free day limits of Durable Objects are rows read (5 million),
 * rows written (100,000) and requests (100,000), each until 00:00 UTC. The meter counts them, the calls inside them, and the Worker
 * requests that the Worker reports with each object call. It keeps every count in memory and adds it in the next write transaction
 * (one row of usage_day, one of usage_month), never in a statement of its own: today's countRequest writes 1 row for each request.
 *
 * The rows come from the totals of the office object host (server/office/doHost.ts), which count every statement, also the
 * statements of a write that rolled back (proof.md, "Wave 1: the transaction facts": 2 rows written for a rolled-back insert). A
 * flush that rolls back keeps its counts for the next one. An object that sleeps loses the counts since its last write (an estimate,
 * as the bytes meter of today; wave 5 compares it with the Cloudflare numbers).
 */

export type DayCounts = { rowsRead: number; rowsWritten: number; requests: number; calls: number; workerRequests: number };

export const DAY_FLUSH_LITE =
  'insert into usage_day (day, rows_read, rows_written, requests, calls, worker_requests) values (?1, ?2, ?3, ?4, ?5, ?6) '
  + 'on conflict (day) do update set rows_read = usage_day.rows_read + excluded.rows_read, '
  + 'rows_written = usage_day.rows_written + excluded.rows_written, requests = usage_day.requests + excluded.requests, '
  + 'calls = usage_day.calls + excluded.calls, worker_requests = usage_day.worker_requests + excluded.worker_requests';
/** usage_month.calls counts the requests, as COUNT_REQUEST_SQL does on Postgres (server/usage/meter.ts). */
export const MONTH_FLUSH_LITE =
  'insert into usage_month (month, calls, bytes_read, signals_failed, signals_failed_at) values (?1, ?2, ?3, ?4, ?5) '
  + 'on conflict (month) do update set calls = usage_month.calls + excluded.calls, bytes_read = usage_month.bytes_read + excluded.bytes_read, '
  + 'signals_failed = usage_month.signals_failed + excluded.signals_failed, '
  + 'signals_failed_at = coalesce(excluded.signals_failed_at, usage_month.signals_failed_at)';
export const DAY_ROW_LITE = 'select rows_read, rows_written, requests, calls, worker_requests from usage_day where day = ?1';

const zero = (): DayCounts => ({ rowsRead: 0, rowsWritten: 0, requests: 0, calls: 0, workerRequests: 0 });
const countOf = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export class OfficeMeter implements MeterPort {
  readonly #host: { readonly totals: { rowsRead: number; rowsWritten: number } };
  #pending: DayCounts = zero();
  #taken = { rowsRead: 0, rowsWritten: 0 };
  #bytes = 0;
  #signals = 0;

  constructor(host: { readonly totals: { rowsRead: number; rowsWritten: number } }) {
    this.#host = host;
  }

  addBytes(n: number): void {
    this.#bytes += countOf(n);
  }

  signalsFailed(count: number): void {
    this.#signals += countOf(count);
  }

  /** The office object keeps every count in memory (see the file comment): no statement here. */
  async countRequest(_db: Db): Promise<void> {}

  /** One object request (an RPC call, a socket open), with the calls inside it and the Worker requests since the last report. */
  request(o: { calls?: number; worker?: number } = {}): void {
    this.#pending.requests += 1;
    this.#pending.calls += countOf(o.calls ?? 0);
    this.#pending.workerRequests += countOf(o.worker ?? 0);
  }

  /** The counts that no flush wrote yet, with the rows of the host since the last call. */
  pending(): DayCounts {
    const totals = this.#host.totals;
    this.#pending.rowsRead += totals.rowsRead - this.#taken.rowsRead;
    this.#pending.rowsWritten += totals.rowsWritten - this.#taken.rowsWritten;
    this.#taken = { rowsRead: totals.rowsRead, rowsWritten: totals.rowsWritten };
    return { ...this.#pending };
  }

  /** Adds the pending counts inside the write transaction of q. They leave memory only after the commit. */
  async flush(q: Query, now: Date): Promise<void> {
    const day = this.pending();
    const bytes = this.#bytes;
    const signals = this.#signals;
    if (Object.values(day).every((n) => n === 0) && bytes === 0 && signals === 0) return;
    await q(DAY_FLUSH_LITE, [utcDay(now), day.rowsRead, day.rowsWritten, day.requests, day.calls, day.workerRequests]);
    await q(MONTH_FLUSH_LITE, [utcMonth(now), day.requests, bytes, signals, signals > 0 ? now.toISOString() : null]);
    onCommit(q, () => {
      this.#pending.rowsRead -= day.rowsRead;
      this.#pending.rowsWritten -= day.rowsWritten;
      this.#pending.requests -= day.requests;
      this.#pending.calls -= day.calls;
      this.#pending.workerRequests -= day.workerRequests;
      this.#bytes -= bytes;
      this.#signals -= signals;
    });
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/office/meter.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/office/meter.ts server/office/meter.test.ts
git commit -m "Exit wave 3: the office meter keeps the day counts in memory and adds them in the next write"
```

---
### Task 5: Live signals, tickets and the socket sweep

The signals leave inside the save transaction on Postgres (`realtime.send`). In the object they wait for the commit, then go to
the sockets with the tag of their channel. A socket opens only with a ticket; it carries the person in its attachment, so the
sweep and the close of a turned-off person work after a hibernation too (probe of this plan: tags, attachment and the auto-pong
time survive an evict with `webSockets: 'hibernate'`).

**Files:**
- Create: `server/office/live.ts`, `server/office/test/fakes.ts`
- Test: `server/office/live.test.ts`

**Interfaces:**
- Consumes: `onCommit(q, fn)` (`server/data/lite/db.ts`); `SIGNAL_EVENT` (`server/signal/realtime.ts`); `resolveActor`
  (`server/core/actor.ts`); `errorResponse`, `runErrorOf` (`server/http/errors.ts`); `LivePort` (Task 3).
- Produces: `LIVE_PING = 'ping'`, `LIVE_PONG = 'pong'`, `TICKET_MS = 60_000`, `TICKET_CAP = 200`, `TICKET_SHAPE`, `TICKET_REFUSED`,
  `LIVE_STALE_MS = 150_000`, `CLOSE_STALE = 4000`, `CLOSE_OFF = 4003`; types `LiveSocket`, `Sockets`, `SocketNote`; `noteOf`;
  `class LiveTickets implements LivePort` with `mint(userId, now)` and `take(ticket, now): { userId } | undefined`;
  `sweep(sockets, now, staleMs): number`; `closeOff(sockets, office): number`; `LiveOptions`; `deliver(o, signals)`;
  `liveSignals(o): SignalPort`; `acceptLive(o, request): Promise<Response>`. Test helpers: `fakeSocket`, `fakeSockets`, `openFor`,
  `recordingNet`.

- [ ] **Step 1: Write the test helpers**

Create `server/office/test/fakes.ts`:

```ts
import type { LiveSocket, Sockets } from '../live';
import type { NetAnswer, NetApi } from '../net';

/** One server socket of the Hibernation API in memory. */
export type FakeSocket = LiveSocket & { sent: string[]; closed?: { code?: number; reason?: string }; failSend?: boolean };

export function fakeSocket(): FakeSocket {
  let note: unknown = null;
  const socket: FakeSocket = {
    sent: [],
    send(text) {
      if (socket.failSend) throw new Error('The socket is closed.');
      socket.sent.push(text);
    },
    close(code, reason) {
      socket.closed = { code, reason };
    },
    serializeAttachment(value) {
      note = structuredClone(value);
    },
    deserializeAttachment() {
      return note;
    },
  };
  return socket;
}

export type FakeSockets = Sockets & { all: { socket: FakeSocket; tags: string[] }[]; pongs: Map<LiveSocket, Date> };

/** The sockets of the object in memory: accept with tags, list by tag, the time of the last auto pong of each one. */
export function fakeSockets(): FakeSockets {
  const all: { socket: FakeSocket; tags: string[] }[] = [];
  const pongs = new Map<LiveSocket, Date>();
  return {
    all,
    pongs,
    accept(socket, tags) {
      all.push({ socket: socket as FakeSocket, tags });
    },
    list(tag) {
      return all.filter((one) => !one.socket.closed && (tag === undefined || one.tags.includes(tag))).map((one) => one.socket);
    },
    lastPong(socket) {
      return pongs.get(socket) ?? null;
    },
    pair() {
      const server = fakeSocket();
      return { client: { peer: server }, server };
    },
    upgraded(client) {
      return { status: 101, webSocket: client } as unknown as Response;
    },
  };
}

/** A socket of one person, as acceptLive leaves it. */
export function openFor(sockets: FakeSockets, userId: string, openedAt: number): FakeSocket {
  const socket = fakeSocket();
  sockets.accept(socket, ['office', `person:${userId}`]);
  socket.serializeAttachment({ userId, openedAt });
  return socket;
}

const ok = <T,>(value: T): Promise<NetAnswer<T>> => Promise.resolve({ ok: true, value });

/** A network port of the Worker that records each call and answers well, unless a test gives another answer. */
export function recordingNet(over: Partial<NetApi> = {}): NetApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    presignPut: (key) => (calls.push(`presignPut ${key}`), ok({ url: `https://files.test/put/${key}`, headers: { 'Content-Type': 'image/png' }, expiresAt: '2099-01-01T00:00:00.000Z' })),
    presignGet: (key) => (calls.push(`presignGet ${key}`), ok({ url: `https://files.test/get/${key}`, expiresAt: '2099-01-01T00:00:00.000Z' })),
    head: (key) => (calls.push(`head ${key}`), ok({ size: 10, mimeType: 'image/png' })),
    copy: (from, to) => (calls.push(`copy ${from}>${to}`), ok(null)),
    remove: (keys) => (calls.push(`remove ${keys.join(',')}`), ok(null)),
    sendMail: (mail) => (calls.push(`mail ${mail.idempotencyKey}`), ok({ id: `mail_${calls.length}` })),
    pushPost: (endpoint) => (calls.push(`push ${endpoint}`), ok({ status: 201 })),
    ...over,
  };
}
```

Then change the import at the top of `server/office/net.test.ts` to use the shared `recordingNet` (delete its local copy and the
local `ok`):

```ts
import { recordingNet } from './test/fakes';
```

- [ ] **Step 2: Write the failing tests**

Create `server/office/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { ChangeSignal } from '../core/types';
import { readLiteOffice } from '../data/lite/office';
import { liteSave } from '../data/lite/save';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { CLOSE_OFF, CLOSE_STALE, LIVE_STALE_MS, LiveTickets, TICKET_CAP, TICKET_MS, acceptLive, closeOff, liveSignals, sweep } from './live';
import { fakeSockets, openFor } from './test/fakes';

const NOW = new Date('2026-10-04T06:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const signal = (channel: ChangeSignal['channel'], people: string[] = []): ChangeSignal => ({ v: 1, id: 'sig_1', channel, seq: 1, projects: [], office: false, kinds: ['tasks'], people });
const received = (socket: { sent: string[] }) => socket.sent.map((text) => JSON.parse(text) as { event: string; payload: ChangeSignal });
const upgrade = (ticket: string, extra = '') => new Request(`https://office.internal/live?ticket=${ticket}${extra}`, { headers: { upgrade: 'websocket' } });

async function liveOffice() {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const sockets = fakeSockets();
  const failed: number[] = [];
  const port = liveSignals({ sockets, meter: { signalsFailed: (n) => failed.push(n) }, log: silent, now: () => NOW, staleMs: LIVE_STALE_MS });
  const tickets = new LiveTickets();
  const accept = (request: Request, at = NOW) => acceptLive({ sockets, tickets, office: () => lite.db.tx('read', (q) => readLiteOffice(lite.db, q)), now: () => at }, request);
  return { ...lite, seed, sockets, port, failed, tickets, accept };
}

describe('the change signals on the sockets of the office object (server/office/live.ts)', () => {
  it('sends each signal after the commit, on the sockets of its channel only', async () => {
    const { db, sockets, port } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    await db.tx('write', async (q) => {
      await port.send(q, [signal('office'), signal('person:usr_002', ['usr_002'])]);
      expect(a.sent).toEqual([]);
    });
    expect(received(a).map((m) => [m.event, m.payload.channel])).toEqual([['changed', 'office'], ['changed', 'person:usr_002']]);
    expect(received(b).map((m) => m.payload.channel)).toEqual(['office']);
  });

  it('sends nothing when the transaction rolls back', async () => {
    const { db, sockets, port } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    await expect(db.tx('write', async (q) => {
      await port.send(q, [signal('office')]);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(a.sent).toEqual([]);
  });

  it('an office task change reaches its people and the Admins, never an outsider socket', async () => {
    const { db, seed, sockets, port } = await liveOffice();
    const at = NOW.getTime();
    const maker = openFor(sockets, 'usr_002', at);
    const lead = openFor(sockets, 'usr_003', at);
    const admin = openFor(sockets, 'usr_001', at);
    const outsider = openFor(sockets, 'usr_008', at);
    const after = structuredClone(seed);
    const base = Object.values(seed.tasks)[0];
    after.tasks.tsk_901 = { ...base, id: 'tsk_901', projectId: null, stageId: null, createdBy: 'usr_002', ownerId: 'usr_003', helperIds: [], prerequisiteIds: [], title: 'Office errand' };
    await db.tx('write', async (q) => {
      const saved = await liteSave(q, seed, after, { story: { storyId: 'sty_test', actorId: 'usr_002' } });
      await port.send(q, saved.signals);
    });
    expect(outsider.sent).toEqual([]);
    for (const socket of [maker, lead, admin]) expect(received(socket)).toHaveLength(1);
    for (const socket of [maker, lead, admin]) {
      const { payload } = received(socket)[0];
      expect(payload.channel.startsWith('person:')).toBe(true);
      expect(payload).not.toHaveProperty('actorId');
      expect(payload).not.toHaveProperty('storyId');
    }
  });

  it('a person signal never reaches the socket of another person', async () => {
    const { db, sockets, port } = await liveOffice();
    const mine = openFor(sockets, 'usr_002', NOW.getTime());
    const other = openFor(sockets, 'usr_003', NOW.getTime());
    await db.tx('write', (q) => port.send(q, [signal('person:usr_002', ['usr_002'])]));
    expect(received(mine)).toHaveLength(1);
    expect(other.sent).toEqual([]);
  });

  it('counts a send that throws as a failed signal', async () => {
    const { db, sockets, port, failed } = await liveOffice();
    openFor(sockets, 'usr_002', NOW.getTime()).failSend = true;
    await db.tx('write', (q) => port.send(q, [signal('office')]));
    expect(failed).toEqual([1]);
  });
});

describe('the live tickets', () => {
  it('opens one socket for its own person only, once, and only for 60 seconds', async () => {
    const { tickets, accept, sockets } = await liveOffice();
    const { ticket, expiresAt } = tickets.mint('usr_005', NOW);
    expect(expiresAt).toBe('2026-10-04T09:01:00.000+03:00');
    const answer = await accept(upgrade(ticket, '&who=usr_002'));
    expect(answer.status).toBe(101);
    expect(sockets.all.map((one) => one.tags)).toEqual([['office', 'person:usr_005']]);
    expect((await accept(upgrade(ticket))).status).toBe(401);
    const old = tickets.mint('usr_005', NOW).ticket;
    expect((await accept(upgrade(old), later(TICKET_MS + 1))).status).toBe(401);
  });

  it('refuses a forged, a used and an old ticket with the same answer, which names no person', async () => {
    const { tickets, accept } = await liveOffice();
    const used = tickets.mint('usr_005', NOW).ticket;
    await accept(upgrade(used));
    const old = tickets.mint('usr_005', NOW).ticket;
    const bodies = await Promise.all([
      accept(upgrade('f'.repeat(64))).then((r) => r.text()),
      accept(upgrade(used)).then((r) => r.text()),
      accept(upgrade(old), later(TICKET_MS + 1)).then((r) => r.text()),
    ]);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain('usr_');
  });

  it('refuses the ticket of a person who was turned off after the ticket', async () => {
    const { db, seed, tickets, accept } = await liveOffice();
    const { ticket } = tickets.mint('usr_004', NOW);
    const after = structuredClone(seed);
    after.users.usr_004 = { ...after.users.usr_004, active: false };
    await db.tx('write', (q) => liteSave(q, seed, after));
    const answer = await accept(upgrade(ticket));
    expect(answer.status).toBe(403);
    expect(((await answer.json()) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('account_off');
  });

  it('refuses a request with no upgrade, and keeps its ticket', async () => {
    const { tickets, accept } = await liveOffice();
    const { ticket } = tickets.mint('usr_005', NOW);
    expect((await accept(new Request(`https://office.internal/live?ticket=${ticket}`))).status).toBe(426);
    expect((await accept(upgrade(ticket))).status).toBe(101);
  });

  it(`keeps at most ${TICKET_CAP} tickets, and drops the oldest first`, async () => {
    const { tickets, accept } = await liveOffice();
    const first = tickets.mint('usr_005', NOW).ticket;
    for (let i = 0; i < TICKET_CAP; i += 1) tickets.mint('usr_005', NOW);
    expect((await accept(upgrade(first))).status).toBe(401);
  });
});

describe('the sweep and the turned-off people', () => {
  it('closes a socket with no pong for 150 s, and keeps one that pinged', async () => {
    const { sockets } = await liveOffice();
    const quiet = openFor(sockets, 'usr_002', NOW.getTime());
    const pinged = openFor(sockets, 'usr_003', NOW.getTime());
    sockets.pongs.set(pinged, later(LIVE_STALE_MS));
    expect(sweep(sockets, later(LIVE_STALE_MS + 1_000), LIVE_STALE_MS)).toBe(1);
    expect(quiet.closed?.code).toBe(CLOSE_STALE);
    expect(pinged.closed).toBeUndefined();
  });

  it('closes the sockets of a person who is off, and keeps the others', async () => {
    const { db, seed, sockets } = await liveOffice();
    const off = openFor(sockets, 'usr_007', NOW.getTime());
    const on = openFor(sockets, 'usr_002', NOW.getTime());
    const after = structuredClone(seed);
    after.users.usr_007 = { ...after.users.usr_007, active: false };
    await db.tx('write', (q) => liteSave(q, seed, after));
    expect(closeOff(sockets, await db.tx('read', (q) => readLiteOffice(db, q)))).toBe(1);
    expect(off.closed?.code).toBe(CLOSE_OFF);
    expect(on.closed).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --project server server/office/live.test.ts server/office/net.test.ts --no-file-parallelism --testTimeout=60000`
Expected: `live.test.ts` FAILS with "Failed to resolve import ./live"; `net.test.ts` still passes with the shared helper.

- [ ] **Step 4: Write the live part**

Create `server/office/live.ts`:

```ts
import { nowStamp } from '../../src/lib/dates';
import { resolveActor } from '../core/actor';
import type { LivePort, Logger, MeterPort, Query, SignalPort } from '../core/ports';
import type { ChangeSignal, OfficeSnapshot, RunError } from '../core/types';
import { onCommit } from '../data/lite/db';
import { errorResponse, runErrorOf } from '../http/errors';
import { SIGNAL_EVENT } from '../signal/realtime';

/**
 * Live updates on the sockets of the office object (exit wave 3; spec section 2, "Live updates"). The object holds every browser
 * socket with the Hibernation API, with two tags: "office" and "person:<id>". A save gives its signals to liveSignals inside the
 * transaction, and they go out after the commit (onCommit), so a rollback sends nothing, as realtime.send of Postgres does. The
 * rules of server/signal/realtime.ts stay: the save decides which channels get a signal (Diff.privateChange), the port only sends.
 *
 * - A browser socket cannot send a header, so it opens with a ticket from live.ticket: 32 random bytes in memory, 60 s, one use,
 *   for one person. The tags come from the ticket, never from the address.
 * - The runtime answers "ping" with "pong" and does not wake the object (setWebSocketAutoResponse; wave 0: 59 of 60). A socket that
 *   broke with no close frame stays in getWebSockets (wave 0: 17.7 minutes), so each delivery and each Cron run close a socket with
 *   no pong for LIVE_STALE_MS. The client pings each 30 s (src/api/remote/liveSocket.ts), so 150 s is 5 missed pings.
 * - The commit that turns a person off closes that person's sockets (closeOff), so no signal reaches a person who is off.
 */

export const LIVE_PING = 'ping';
export const LIVE_PONG = 'pong';
export const TICKET_MS = 60_000;
/** At most this many tickets wait in memory: a person opens one socket for each tab. */
export const TICKET_CAP = 200;
export const TICKET_SHAPE = /^[0-9a-f]{64}$/;
export const LIVE_STALE_MS = 150_000;
/** The close codes of the object: 4000 a socket with no pong, 4003 a person who is off. */
export const CLOSE_STALE = 4000;
export const CLOSE_OFF = 4003;

/** One answer for every ticket that does not open: it names no person and no reason. */
export const TICKET_REFUSED: RunError = { code: 'unauthenticated', message: 'This live ticket is not valid. Ask for a new one.' };

/** The part of a server socket of workerd that the object uses. */
export type LiveSocket = {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

/** The Hibernation API of the object state (server/office/office.ts), so node tests can use a fake (server/office/test/fakes.ts). */
export type Sockets = {
  accept(socket: LiveSocket, tags: string[]): void;
  list(tag?: string): LiveSocket[];
  lastPong(socket: LiveSocket): Date | null;
  pair(): { client: unknown; server: LiveSocket };
  upgraded(client: unknown): Response;
};

export type SocketNote = { userId: string; openedAt: number };

export function noteOf(socket: LiveSocket): SocketNote | undefined {
  const note = socket.deserializeAttachment() as Partial<SocketNote> | null;
  return note && typeof note.userId === 'string' && typeof note.openedAt === 'number' ? { userId: note.userId, openedAt: note.openedAt } : undefined;
}

export class LiveTickets implements LivePort {
  readonly #held = new Map<string, { userId: string; until: number }>();

  mint(userId: string, now: Date): { ticket: string; expiresAt: string } {
    const at = now.getTime();
    for (const [ticket, held] of this.#held) if (held.until < at) this.#held.delete(ticket);
    while (this.#held.size >= TICKET_CAP) this.#held.delete(this.#held.keys().next().value as string);
    const ticket = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const until = at + TICKET_MS;
    this.#held.set(ticket, { userId, until });
    return { ticket, expiresAt: nowStamp(new Date(until)) };
  }

  /** The person of a ticket, once. A ticket of the wrong shape, an unknown one and an old one give undefined. */
  take(ticket: string, now: Date): { userId: string } | undefined {
    if (!TICKET_SHAPE.test(ticket)) return undefined;
    const held = this.#held.get(ticket);
    this.#held.delete(ticket);
    if (!held || held.until < now.getTime()) return undefined;
    return { userId: held.userId };
  }
}

/** Closes each socket with no auto pong (or, if it never pinged, no open) for staleMs. Gives the count it closed. */
export function sweep(sockets: Sockets, now: Date, staleMs: number): number {
  let closed = 0;
  for (const socket of sockets.list()) {
    const last = sockets.lastPong(socket)?.getTime() ?? noteOf(socket)?.openedAt ?? 0;
    if (now.getTime() - last <= staleMs) continue;
    try {
      socket.close(CLOSE_STALE, 'No pong for a long time.');
    } catch {
      // The socket is closed already.
    }
    closed += 1;
  }
  return closed;
}

/** Closes each socket whose person is not an active user of the office. Gives the count it closed. */
export function closeOff(sockets: Sockets, office: OfficeSnapshot): number {
  let closed = 0;
  for (const socket of sockets.list()) {
    const userId = noteOf(socket)?.userId;
    if (userId !== undefined && office.lists.users[userId]?.active === true) continue;
    try {
      socket.close(CLOSE_OFF, 'The account is off.');
    } catch {
      // The socket is closed already.
    }
    closed += 1;
  }
  return closed;
}

export type LiveOptions = { sockets: Sockets; meter: Pick<MeterPort, 'signalsFailed'>; log: Logger; now: () => Date; staleMs: number };

/** Sends each signal to the sockets of its channel, after a sweep. A send that throws counts as a failed signal. */
export function deliver(o: LiveOptions, signals: readonly ChangeSignal[]): void {
  sweep(o.sockets, o.now(), o.staleMs);
  let failed = 0;
  for (const signal of signals) {
    const text = JSON.stringify({ event: SIGNAL_EVENT, payload: signal });
    for (const socket of o.sockets.list(signal.channel)) {
      try {
        socket.send(text);
      } catch {
        failed += 1;
      }
    }
  }
  if (failed === 0) return;
  o.log.warn('A change signal did not reach an open socket. The screen reloads when its socket opens again.', { failed });
  o.meter.signalsFailed(failed);
}

/** The SignalPort of the office object: the signals of a transaction go out after its commit, and a rollback drops them. */
export function liveSignals(o: LiveOptions): SignalPort {
  return {
    async send(q: Query, signals: ChangeSignal[]): Promise<void> {
      if (signals.length === 0) return;
      const copy = signals.map((signal) => ({ ...signal }));
      onCommit(q, () => deliver(o, copy));
    },
  };
}

/** Opens the socket of a ticket: the person must still act now; the tags come from the ticket. */
export async function acceptLive(
  o: { sockets: Sockets; tickets: LiveTickets; office: () => Promise<OfficeSnapshot>; now: () => Date },
  request: Request,
): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('This address needs a WebSocket.', { status: 426 });
  const held = o.tickets.take(new URL(request.url).searchParams.get('ticket') ?? '', o.now());
  if (!held) return errorResponse(TICKET_REFUSED);
  try {
    resolveActor(await o.office(), { userId: held.userId });
  } catch (error) {
    return errorResponse(runErrorOf(error));
  }
  const { client, server } = o.sockets.pair();
  o.sockets.accept(server, ['office', `person:${held.userId}`]);
  server.serializeAttachment({ userId: held.userId, openedAt: o.now().getTime() } satisfies SocketNote);
  return o.sockets.upgraded(client);
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/office/live.test.ts server/office/net.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/office/live.ts server/office/live.test.ts server/office/test/fakes.ts server/office/net.test.ts
git commit -m "Exit wave 3: change signals on the office object sockets after the commit, live tickets and the socket sweep"
```

---

### Task 6: The office parts: the batch, the effects, the socket open and health on node:sqlite

All work of the object sits in `officeParts`, which takes a host and a `Sockets`, so node tests run it on node:sqlite. The class of
Task 8 only wires it to workerd. The batch keeps the rules of `handleBatch` (`server/http/batch.ts`): one sign-in check for the
batch, the entries in the order sent, one refused entry never refuses the others. The entries run one after the other, also adjacent
`files.link` entries: the SQLite Db holds one transaction at a time.

**Files:**
- Create: `server/office/who.ts`, `server/office/batch.ts`, `server/office/parts.ts`
- Modify: `server/http/batch.ts:36` (export `entryOf`)
- Test: `server/office/parts.test.ts`

**Interfaces:**
- Consumes: `createRunCall`, `CallData`, `CallTx`, `RunCall` (`server/core/runCall.ts`); `liteData` (wave 1); `processOutbox`,
  `AFTER_ANSWER_KINDS` (`server/core/effects.ts`); `serverEnvFrom`, `consoleLogger`, `ReadEnv` (`server/core/deps.ts`);
  `outboxMailPort` (`server/mail/outboxDriver.ts`); `principalOf` (`server/auth/principal.ts`); `JOBS_LAST_RUN_SQL`
  (`server/usage/meters.ts`); Tasks 3 to 5.
- Produces: `OfficeWho = { kind: 'browser'; authUserId: string }`, `principalOfWho(who, office): Principal`;
  `OfficeBatchInput = { who; calls: WireCall[]; overviewCalls: number; worker: number }`,
  `OfficeBatchOutput = { ok: true; body: string; later: string[] } | { ok: false; error: RunError }`; `EffectLedger`;
  `officeData({ meter, ledgerOf })`; `runOfficeBatch(deps, input, o)`; `OfficeHost`, `OfficeEffectsInput = { ids: string[]; worker: number }`,
  `OfficeEffectsReport = { done: number; failed: number }`, `OfficeHealth = { schema: number; lastJob: string | null }`,
  `PartsInput`, `OfficeParts` (`db`, `meter`, `tickets`, `depsFor`, `batch`, `runEffects`, `socket`, `message`, `closed`,
  `health`), `officeParts(o: PartsInput): OfficeParts`.

- [ ] **Step 1: Write the failing tests**

Create `server/office/parts.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { WireResponse } from '../../src/api/remote/wire';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { resolveActor } from '../core/actor';
import { everyCall } from '../core/everyCall';
import { nodeHost } from '../data/lite/host';
import { liteSave } from '../data/lite/save';
import { applyLiteSchema, LITE_SCHEMA_VERSION } from '../data/lite/schema';
import { liteWriteState } from '../data/lite/whole';
import { fixedClock } from '../test/fakes/clock';
import { CLOSE_OFF } from './live';
import { EffectLedger, type OfficeBatchInput } from './batch';
import { officeParts } from './parts';
import { fakeSockets, openFor, recordingNet } from './test/fakes';

const TODAY = '2026-10-04';
const NOW = '2026-10-04T06:00:00.000Z';
/** The values of a Worker on the office path, none of them a secret (the tests reach no network). */
export const OFFICE_ENV: Record<string, string> = {
  APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'resend', RESEND_API_KEY: 're_test_not_a_key',
  SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: '0'.repeat(32),
  R2_ACCESS_KEY_ID: 'test-not-a-key', R2_SECRET_ACCESS_KEY: 'test-not-a-key', R2_BUCKET: 'madar-files-test',
};
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** The office parts on node:sqlite with the sample office. The token of a batch is the user id itself, as in test:office. */
async function office(edit: (seed: State) => void = () => undefined) {
  const raw = new DatabaseSync(':memory:');
  const host = Object.assign(nodeHost(raw), { totals: { rowsRead: 0, rowsWritten: 0 } });
  await applyLiteSchema(host);
  const sockets = fakeSockets();
  const parts = officeParts({
    host, read: (name) => OFFICE_ENV[name], sockets, clock: fixedClock(NOW), log: silent,
    principal: (who, snapshot) => {
      const principal = { userId: who.authUserId };
      resolveActor(snapshot, principal);
      return principal;
    },
  });
  const seed = await buildSeed(TODAY, async () => undefined);
  edit(seed);
  await parts.db.tx('write', (q) => liteWriteState(q, seed));
  const net = recordingNet();
  const batch = async (userId: string, calls: Omit<OfficeBatchInput['calls'][number], 'i'>[]) => {
    const out = await parts.batch({ who: { kind: 'browser', authUserId: userId }, calls: calls.map((c, i) => ({ i, ...c })), overviewCalls: 0, worker: 1 }, net);
    return out.ok ? { ...out, answer: JSON.parse(out.body) as WireResponse } : out;
  };
  return { raw, parts, sockets, seed, net, batch };
}

const ok = <T,>(result: { ok: true; answer: WireResponse; later: string[] } | { ok: false }): { answer: WireResponse; later: string[] } => {
  if (!result.ok) throw new Error('The batch was refused.');
  return result;
};

describe('the office parts (server/office/parts.ts)', () => {
  it('answers a batch in the order sent, so a read after a write sees the write', async () => {
    const { seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const id = (move.input as { id: string }).id;
    const { answer } = ok(await batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'tasks.get', input: { id } }]));
    expect(answer.results.map((r) => [r.i, r.ok])).toEqual([[0, true], [1, true]]);
    expect((answer.results[1] as { output: { task: { status: string } } }).output.task.status).toBe('in_progress');
  });

  it('refuses the whole batch for a person who is off, before any call', async () => {
    const { raw, batch } = await office((seed) => {
      seed.users.usr_004 = { ...seed.users.usr_004, active: false };
    });
    const before = raw.prepare('select count(*) as n from stories').get();
    const out = await batch('usr_004', [{ name: 'story.start', input: {} }]);
    expect(out).toMatchObject({ ok: false, error: { code: 'unauthenticated', details: { reason: 'account_off' } } });
    expect(raw.prepare('select count(*) as n from stories').get()).toEqual(before);
  });

  it('maps a story ref of one entry to the next entry of the batch', async () => {
    const { seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const arrange = everyCall(seed).find((c) => c.name === 'tasks.arrange')!;
    const { answer } = ok(await batch(move.actorId, [
      { name: move.name, input: move.input, story: { ref: 'r1' } },
      { name: arrange.name, input: arrange.input, story: { ref: 'r1' } },
    ]));
    const [a, b] = answer.results as { storyId?: string }[];
    expect(a.storyId).toBeDefined();
    expect(b.storyId).toBe(a.storyId);
  });

  it('replays a write with the same key and writes nothing the second time', async () => {
    const { raw, seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const first = ok(await batch(move.actorId, [{ name: move.name, input: move.input, key: 'k1' }])).answer;
    const events = raw.prepare('select count(*) as n from events').get();
    const second = ok(await batch(move.actorId, [{ name: move.name, input: move.input, key: 'k1' }])).answer;
    expect(second.results).toEqual(first.results);
    expect(raw.prepare('select count(*) as n from events').get()).toEqual(events);
  });

  it('keeps the mail of a new task for after the answer', async () => {
    const { raw, batch } = await office((seed) => {
      const prefs = seed.users.usr_003.preferences;
      seed.users.usr_003 = { ...seed.users.usr_003, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
    });
    const { answer, later } = ok(await batch('usr_001', [{
      name: 'tasks.create', input: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false },
    }]));
    expect(answer.results[0].ok).toBe(true);
    const rows = later.map((id) => raw.prepare('select kind, done_at, payload from outbox where id = ?').get(Number(id)) as { kind: string; done_at: null; payload: string });
    // The mail of usr_003 waits for after the answer, undone; every row of later is a mail or a push.
    expect(rows.some((row) => row.kind === 'mail.notice')).toBe(true);
    for (const row of rows) expect([['mail.notice', 'push.notify'].includes(row.kind), row.done_at]).toEqual([true, null]);
  });

  it('gives the network call of a file link to the Worker port', async () => {
    const { net, batch } = await office();
    const { answer } = ok(await batch('usr_001', [{ name: 'files.link', input: { id: 'fil_001', variant: 'full', disposition: 'inline' } }]));
    expect(answer.results[0]).toMatchObject({ ok: true, output: { url: 'https://files.test/get/blob_seed_001' } });
    expect(net.calls).toEqual(['presignGet blob_seed_001']);
  });

  it('adds the counts of the batch to the day row in its write', async () => {
    const { raw, seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    ok(await batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'session.get', input: {} }]));
    expect(raw.prepare('select requests, calls, worker_requests from usage_day where day = ?').get(TODAY)).toEqual({ requests: 1, calls: 2, worker_requests: 1 });
  });

  it('closes the sockets of a person whom the batch turned off', async () => {
    const { sockets, batch } = await office();
    const socket = openFor(sockets, 'usr_007', Date.parse(NOW));
    ok(await batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_007' } }]));
    expect(socket.closed?.code).toBe(CLOSE_OFF);
  });

  it('opens a socket for a ticket that it made, with the tags of the person', async () => {
    const { parts, sockets } = await office();
    const { ticket } = parts.tickets.mint('usr_005', new Date(NOW));
    const answer = await parts.socket(new Request(`https://office.internal/live?ticket=${ticket}`, { headers: { upgrade: 'websocket' } }));
    expect(answer.status).toBe(101);
    expect(sockets.all.map((one) => one.tags)).toEqual([['office', 'person:usr_005']]);
  });

  it('answers health with the schema version and the last job run', async () => {
    const { parts } = await office();
    expect(await parts.health()).toEqual({ schema: LITE_SCHEMA_VERSION, lastJob: null });
  });
});

describe('the effect ledger of a batch', () => {
  it('runs the other kinds before the answer and the mails and pushes after it, and drops a row that did not commit', () => {
    const ledger = new EffectLedger();
    ledger.wrote(['1', '2', '3', '4'], ['r2.delete', 'mail.notice', 'push.notify', 'mail.notice']);
    ledger.committed(['1', '2', '3']);
    expect(ledger.split()).toEqual({ now: ['1'], later: ['2', '3'] });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/office/parts.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to resolve import ./batch".

- [ ] **Step 3: Export entryOf**

In `server/http/batch.ts`, change `function entryOf(` to `export function entryOf(`. The function body stays.

- [ ] **Step 4: Write who.ts**

Create `server/office/who.ts`:

```ts
import { ApiError } from '../../src/api/errors';
import { principalOf } from '../auth/principal';
import type { OfficeSnapshot, Principal } from '../core/types';

/**
 * Who sends a batch to the office object (exit wave 3). The Worker checks the token and passes what the check gives; the office
 * object finds the person in its office lists, because only the object holds them. "browser" holds what verifyBrowserToken gives
 * today (server/auth/verify.ts). Wave 2 adds its kinds here (an agent of the MCP route, a sign-in route), each with its branch.
 */
export type OfficeWho = { kind: 'browser'; authUserId: string };

export function principalOfWho(who: OfficeWho, office: OfficeSnapshot): Principal {
  switch (who.kind) {
    case 'browser':
      return principalOf(who.authUserId, office);
    default:
      throw new ApiError('unauthenticated', 'This sign-in does not reach the office object.');
  }
}
```

- [ ] **Step 5: Write batch.ts**

Create `server/office/batch.ts`:

```ts
import { ApiError } from '../../src/api/errors';
import type { WireCall, WireEntry, WireResponse } from '../../src/api/remote/wire';
import { nowStamp } from '../../src/lib/dates';
import { AFTER_ANSWER_KINDS, processOutbox } from '../core/effects';
import type { Deps } from '../core/ports';
import type { CallData, CallTx, RunCall } from '../core/runCall';
import type { BatchScope, OfficeSnapshot, Principal, RunError, RunResult } from '../core/types';
import { liteData } from '../data/lite/callData';
import { entryOf } from '../http/batch';
import { runErrorOf } from '../http/errors';
import type { OfficeMeter } from './meter';
import type { OfficeWho } from './who';

/**
 * One batch inside the office object (exit wave 3): the rules of handleBatch (server/http/batch.ts) with runCall on SQLite. The
 * Worker checked the build, the body and the token; the object finds the person, runs the entries one after the other, and gives
 * back the answer as JSON text, so the Worker sends it on with no work (10 ms of CPU on Free). The effects that runCall hands to
 * afterCommit wait in the ledger: the other kinds run before the answer, the mails and pushes after it (AFTER_ANSWER_KINDS), in a
 * second call of the Worker (runEffects).
 */

export type OfficeBatchInput = { who: OfficeWho; calls: WireCall[]; overviewCalls: number; worker: number };
export type OfficeBatchOutput = { ok: true; body: string; later: string[] } | { ok: false; error: RunError };

/** The outbox rows of one batch: the kind of each row that a call wrote, and the rows whose transaction committed. */
export class EffectLedger {
  readonly #kinds = new Map<string, string>();
  readonly #done: string[] = [];

  wrote(ids: readonly string[], kinds: readonly string[]): void {
    ids.forEach((id, i) => this.#kinds.set(id, kinds[i]));
  }

  committed(ids: readonly string[]): void {
    this.#done.push(...ids);
  }

  split(): { now: string[]; later: string[] } {
    const later = this.#done.filter((id) => AFTER_ANSWER_KINDS.has(this.#kinds.get(id) ?? ''));
    return { now: this.#done.filter((id) => !later.includes(id)), later };
  }
}

/** liteData with two additions: the kinds of the outbox rows go into the ledger, and each write adds the pending meter counts. */
export function officeData(o: { meter: OfficeMeter; ledgerOf: (deps: Deps) => EffectLedger | undefined }): (deps: Deps) => CallData {
  return (deps) => {
    const base = liteData(deps);
    return {
      office: base.office,
      tx: (mode, work) =>
        base.tx(mode, async (t) => {
          const wrapped: CallTx = {
            q: t.q,
            lock: t.lock,
            office: t.office,
            source: t.source,
            save: t.save,
            stories: t.stories,
            keys: t.keys,
            outbox: async (rows) => {
              const ids = await t.outbox(rows);
              o.ledgerOf(deps)?.wrote(ids, rows.map((row) => row.kind));
              return ids;
            },
          };
          const out = await work(wrapped);
          if (mode === 'write') await o.meter.flush(t.q, deps.clock.now());
          return out;
        }),
    };
  };
}

function logUnexpected(deps: Deps, message: string, error: unknown, fields: Record<string, unknown> = {}): void {
  if (error instanceof ApiError) return;
  deps.log.error(message, { ...fields, error: error instanceof Error ? error.message : String(error) });
}

export async function runOfficeBatch(
  deps: Deps,
  input: OfficeBatchInput,
  o: { run: RunCall; data: CallData; principal: (who: OfficeWho, office: OfficeSnapshot) => Principal; ledger: EffectLedger },
): Promise<(OfficeBatchOutput & { ok: false }) | { ok: true; body: string; later: string[]; officeChanged: boolean }> {
  let principal: Principal;
  let batch: BatchScope;
  try {
    const office = await o.data.office();
    principal = o.principal(input.who, office);
    batch = { storyRefs: new Map(), office, overviewCalls: input.overviewCalls };
  } catch (error) {
    logUnexpected(deps, 'The batch failed before its calls.', error);
    return { ok: false, error: runErrorOf(error) };
  }
  const results: WireEntry[] = [];
  for (const call of input.calls) {
    let result: RunResult;
    try {
      result = await o.run(deps, { principal, name: call.name, input: call.input, story: call.story, key: call.key, batch });
    } catch (error) {
      logUnexpected(deps, 'A call threw outside runCall.', error, { name: call.name });
      result = { ok: false, error: runErrorOf(error) };
    }
    results.push(entryOf(call.i, result));
  }
  const { now, later } = o.ledger.split();
  if (now.length > 0) {
    try {
      await processOutbox(deps, now);
    } catch (error) {
      deps.log.warn('The effects after the commit did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const body: WireResponse = { v: 1, serverTime: nowStamp(deps.clock.now()), results };
  return { ok: true, body: JSON.stringify(body), later, officeChanged: batch.office === undefined };
}
```

- [ ] **Step 6: Write parts.ts**

Create `server/office/parts.ts`:

```ts
import { consoleLogger, serverEnvFrom, type ReadEnv } from '../core/deps';
import { processOutbox } from '../core/effects';
import type { AuthAdminPort, Clock, Deps, Logger } from '../core/ports';
import { createRunCall } from '../core/runCall';
import type { CallEntry } from '../core/serverCallMap';
import type { OfficeSnapshot, Principal } from '../core/types';
import { liteDb, type LiteDb } from '../data/lite/db';
import type { SqlHost } from '../data/lite/host';
import { readLiteOffice } from '../data/lite/office';
import { LITE_SCHEMA_VERSION } from '../data/lite/schema';
import { outboxMailPort } from '../mail/outboxDriver';
import { JOBS_LAST_RUN_SQL } from '../usage/meters';
import { EffectLedger, officeData, runOfficeBatch, type OfficeBatchInput, type OfficeBatchOutput } from './batch';
import { LIVE_PING, LIVE_PONG, LIVE_STALE_MS, LiveTickets, acceptLive, closeOff, liveSignals, type LiveSocket, type Sockets } from './live';
import { OfficeMeter } from './meter';
import { netPorts, type NetApi } from './net';
import type { OfficeWho } from './who';

/**
 * The work of the office object (exit wave 3), apart from workerd: server/office/office.ts gives it the host of ctx.storage and
 * the sockets of the Hibernation API, and node tests give it node:sqlite and fake sockets. One Deps for each object call, with
 * the network port of that call, so the ports never outlive the RPC call whose stub they hold.
 */

export type OfficeHost = SqlHost & { readonly totals: { rowsRead: number; rowsWritten: number } };
export type OfficeEffectsInput = { ids: string[]; worker: number };
export type OfficeEffectsReport = { done: number; failed: number };
export type OfficeHealth = { schema: number; lastJob: string | null };

export type PartsInput = {
  host: OfficeHost;
  read: ReadEnv;
  sockets: Sockets;
  principal: (who: OfficeWho, office: OfficeSnapshot) => Principal;
  clock?: Clock;
  log?: Logger;
  calls?: ReadonlyMap<string, CallEntry>;
};

export type OfficeParts = {
  readonly db: LiteDb;
  readonly meter: OfficeMeter;
  readonly tickets: LiveTickets;
  depsFor(net: NetApi): Deps;
  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput>;
  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport>;
  socket(request: Request): Promise<Response>;
  message(socket: LiveSocket, message: string | ArrayBuffer): void;
  closed(socket: LiveSocket, code: number): void;
  health(): Promise<OfficeHealth>;
};

/** Supabase Auth is network work, so the office object has no Auth admin port. The sign-in rows come with wave 2. */
const NO_AUTH = (): Promise<never> => Promise.reject(new Error('Sign-in changes on the office object come with wave 2 of the exit (server/auth).'));
const SIGN_IN_LATER: AuthAdminPort = { generateLink: NO_AUTH, createUser: NO_AUTH, setBanned: NO_AUTH, updateEmail: NO_AUTH, listUsers: NO_AUTH, getUser: NO_AUTH };

/** The close codes that a server may not send back (1005, 1006, 1015): the object answers them with a normal close. */
const RESERVED_CLOSE = new Set([1005, 1006, 1015]);

export function officeParts(o: PartsInput): OfficeParts {
  // The office object holds the database, so the values of the Postgres pools are not read (serverEnvFrom, o.database).
  const values = serverEnvFrom(o.read, { database: { writeUrl: '', readUrl: '' } });
  const db = liteDb(o.host);
  const clock = o.clock ?? { now: () => new Date() };
  const log = o.log ?? consoleLogger();
  const meter = new OfficeMeter(o.host);
  const tickets = new LiveTickets();
  const staleMs = Number(o.read('MADAR_LIVE_STALE_MS') ?? LIVE_STALE_MS);
  const signals = liveSignals({ sockets: o.sockets, meter, log, now: () => clock.now(), staleMs });
  const ledgers = new WeakMap<Deps, EffectLedger>();
  const data = officeData({ meter, ledgerOf: (deps) => ledgers.get(deps) });
  const run = createRunCall({
    ...(o.calls ? { calls: o.calls } : {}),
    data,
    // runCall gives each committed effect to afterCommit (the object has no host "after"): the ledger keeps it for the batch.
    afterCommit: async (deps, ids) => ledgers.get(deps)?.committed(ids),
  });
  const office = () => db.tx('read', (q) => readLiteOffice(db, q));

  function depsFor(net: NetApi): Deps {
    const ports = netPorts(net, { guard: { open: () => db.isOpen(), now: () => clock.now() }, kind: values.config.fileStore, maxFileBytes: values.config.limits.maxFileBytes });
    const deps: Deps = {
      db,
      clock,
      files: ports.files,
      // MAIL_DRIVER=outbox (the test copy) writes the mail into mail_outbox of the object: no network, so no port.
      mail: values.mail.driver === 'outbox' ? outboxMailPort(db) : ports.mail,
      signal: signals,
      authAdmin: SIGN_IN_LATER,
      meter,
      config: values.config,
      log,
      pushFetch: ports.pushFetch,
      live: tickets,
    };
    ledgers.set(deps, new EffectLedger());
    return deps;
  }

  return {
    db,
    meter,
    tickets,
    depsFor,
    async batch(input, net) {
      meter.request({ calls: input.calls.length, worker: input.worker });
      const deps = depsFor(net);
      const out = await runOfficeBatch(deps, input, { run, data: data(deps), principal: o.principal, ledger: ledgers.get(deps)! });
      if (!out.ok) return out;
      if (out.officeChanged) closeOff(o.sockets, await office());
      return { ok: true, body: out.body, later: out.later };
    },
    async runEffects(input, net) {
      meter.request({ worker: input.worker });
      const result = await processOutbox(depsFor(net), input.ids);
      return { done: result.done.length, failed: result.failed.length };
    },
    async socket(request) {
      meter.request();
      return acceptLive({ sockets: o.sockets, tickets, office, now: () => clock.now() }, request);
    },
    message(socket, message) {
      // The runtime answers "ping" itself (setWebSocketAutoResponse). This covers a ping that reaches the object while it is awake.
      if (message === LIVE_PING) socket.send(LIVE_PONG);
    },
    closed(socket, code) {
      try {
        socket.close(RESERVED_CLOSE.has(code) ? 1000 : code, 'Closed.');
      } catch {
        // The socket is closed already.
      }
    },
    async health() {
      meter.request();
      const [row] = await db.statement<{ done_at: string }>('read', JOBS_LAST_RUN_SQL);
      return { schema: LITE_SCHEMA_VERSION, lastJob: row?.done_at ?? null };
    },
  };
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run --project server server/office/parts.test.ts server/http/app.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS (`app.test.ts` holds the tests of the batch route, which `entryOf` serves).

- [ ] **Step 8: Commit**

```bash
git add server/office/who.ts server/office/batch.ts server/office/parts.ts server/office/parts.test.ts server/http/batch.ts
git commit -m "Exit wave 3: the office parts run a whole batch on SQLite and keep its mails and pushes for after the answer"
```

---

### Task 7: The Worker routes of the office path

The Worker keeps what it must do itself: the build check, the body limits, the token check, the socket upgrade check and the
health answer. Everything else is one call into the office object. A Durable Object error has `overloaded` or `retryable` set
when the object is overloaded or was reset (Durable Objects error handling page); the route answers both with the reason `busy`.

**Files:**
- Create: `server/entries/officeWorker.ts`
- Modify: `server/jobs/app.ts:28` (export `sameSecret`)
- Test: `server/entries/officeWorker.test.ts`

**Interfaces:**
- Consumes: `checkBuild`, `parseBatch`, `readBody` (`server/http/limits.ts`); `cors` (`server/http/cors.ts`); `errorResponse`,
  `runErrorOf` (`server/http/errors.ts`); `JOBS_SECRET_HEADER`, `sameSecret` (`server/jobs/app.ts`); `TICKET_SHAPE`,
  `TICKET_REFUSED` (Task 5); `OfficeBatchInput`, `OfficeBatchOutput` (Task 6); `OfficeEffectsInput`, `OfficeEffectsReport`,
  `OfficeHealth` (Task 6); `NetApi` (Task 3).
- Produces: `LIVE_PATH = '/api/live'`; `OfficeStub` (`batch`, `runEffects`, `health`, `fetch`); `OfficeRoutesOptions`;
  `officeErrorOf(error, log): RunError`; `officeRoutes(o) => { fetch(request, env, ctx?) }`.

- [ ] **Step 1: Write the failing tests**

Create `server/entries/officeWorker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { OfficeBatchInput } from '../office/batch';
import type { NetApi } from '../office/net';
import { recordingNet } from '../office/test/fakes';
import { fakeDeps } from '../test/fakes/deps';
import { LIVE_PATH, officeRoutes, type OfficeStub } from './officeWorker';

const TICKET = 'a'.repeat(64);
const BODY = JSON.stringify({ v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] });
const ANSWER = '{"v":1,"serverTime":"2026-10-04T09:00:00.000+03:00","results":[]}';

function setup(o: { batch?: OfficeStub['batch'] } = {}) {
  const deps = fakeDeps();
  const seen = { batch: [] as { input: OfficeBatchInput; net: NetApi }[], effects: [] as { ids: string[]; worker: number; net: NetApi }[], fetches: [] as Request[], health: 0 };
  const stub: OfficeStub = {
    batch: o.batch ?? (async (input, net) => (seen.batch.push({ input, net }), { ok: true, body: ANSWER, later: [] })),
    runEffects: async (input, net) => (seen.effects.push({ ...input, net }), { done: input.ids.length, failed: 0 }),
    health: async () => ((seen.health += 1), { schema: 3, lastJob: null }),
    fetch: async (request) => (seen.fetches.push(request), { status: 101, webSocket: {} } as unknown as Response),
  };
  const net = recordingNet();
  const routes = officeRoutes({
    deps,
    verifyToken: async (header) => {
      if (header !== 'Bearer good') throw new ApiError('unauthenticated', 'Sign in again.');
      return { authUserId: 'auth-1' };
    },
    stub: () => stub,
    net: () => net,
    jobsSecret: () => 'jobs-secret',
  });
  const post = (headers: Record<string, string>, body = BODY, ctx?: { waitUntil(work: Promise<unknown>): void }) =>
    routes.fetch(new Request('https://madar-server.internal/api/batch', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), {}, ctx);
  const get = (path: string, headers: Record<string, string> = {}) => routes.fetch(new Request(`https://madar-server.internal${path}`, { headers }), {});
  return { deps, seen, routes, post, get, net };
}

describe('the Worker routes of the office path (server/entries/officeWorker.ts)', () => {
  it('refuses an old build, a body that is no batch and a bad token, before any office object call', async () => {
    const { deps, seen, post } = setup();
    deps.config.minClientBuild = '2026.10.17';
    expect((await post({ 'X-Madar-Build': '2026.10.1', authorization: 'Bearer good' })).status).toBe(409);
    deps.config.minClientBuild = '0';
    expect((await post({ authorization: 'Bearer good' }, '{"v":1}')).status).toBe(400);
    expect((await post({ authorization: 'Bearer bad' })).status).toBe(401);
    expect(seen.batch).toEqual([]);
  });

  it('gives the whole batch to the office object in one call, with what the token check gave, and answers its body as it is', async () => {
    const { seen, post, net } = setup();
    const answer = await post({ authorization: 'Bearer good' });
    expect([answer.status, answer.headers.get('content-type'), await answer.text()]).toEqual([200, 'application/json', ANSWER]);
    expect(seen.batch).toHaveLength(1);
    expect(seen.batch[0].input).toEqual({ who: { kind: 'browser', authUserId: 'auth-1' }, calls: [{ i: 0, name: 'session.get', input: {} }], overviewCalls: 0, worker: 1 });
    expect(seen.batch[0].net).toBe(net);
  });

  it('answers a refusal of the office object with its status', async () => {
    const { post } = setup({ batch: async () => ({ ok: false, error: { code: 'unauthenticated', message: 'Off.', details: { reason: 'account_off' } } }) });
    expect((await post({ authorization: 'Bearer good' })).status).toBe(403);
  });

  it('runs the mails and pushes after the answer, with the same network port', async () => {
    const { seen, post, net } = setup({ batch: async () => ({ ok: true, body: ANSWER, later: ['7', '8'] }) });
    const waits: Promise<unknown>[] = [];
    const answer = await post({ authorization: 'Bearer good' }, BODY, { waitUntil: (work) => waits.push(work) });
    expect(answer.status).toBe(200);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(seen.effects).toEqual([{ ids: ['7', '8'], worker: 0, net }]);
  });

  it('maps an overloaded or reset office object to busy, and any other error to a hidden failure', async () => {
    const overloaded = setup({ batch: async () => { throw Object.assign(new Error('Durable Object is overloaded.'), { overloaded: true }); } });
    const busy = (await (await overloaded.post({ authorization: 'Bearer good' })).json()) as { error: { details?: { reason?: string } } };
    expect(busy.error.details?.reason).toBe('busy');
    const reset = setup({ batch: async () => { throw Object.assign(new Error('Durable Object reset because its code was updated.'), { retryable: true }); } });
    expect(((await (await reset.post({ authorization: 'Bearer good' })).json()) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('busy');
    const broken = setup({ batch: async () => { throw new Error('SQLITE_FULL'); } });
    const hidden = await broken.post({ authorization: 'Bearer good' });
    expect([hidden.status, await hidden.json()]).toEqual([500, { v: 1, error: { code: 'failed', message: 'Something went wrong. Try again.' } }]);
    expect(broken.deps.logs.some((line) => line.level === 'error' && line.message === 'The office object failed.')).toBe(true);
  });

  it('refuses a socket with no upgrade and a ticket of the wrong shape, with no office object call', async () => {
    const { seen, get } = setup();
    expect((await get(`${LIVE_PATH}?ticket=${TICKET}`)).status).toBe(426);
    expect((await get(`${LIVE_PATH}?ticket=abc`, { upgrade: 'websocket' })).status).toBe(401);
    expect(seen.fetches).toEqual([]);
  });

  it('hands a socket upgrade with a ticket of the right shape to the office object, and gives its answer back as it is', async () => {
    const { seen, get } = setup();
    const answer = await get(`${LIVE_PATH}?ticket=${TICKET}`, { upgrade: 'websocket' });
    expect(answer.status).toBe(101);
    expect(seen.fetches).toHaveLength(1);
  });

  it('counts every request it saw in the next office object call', async () => {
    const { seen, get, post } = setup();
    await get('/api/nothing');
    await get(`${LIVE_PATH}?ticket=abc`, { upgrade: 'websocket' });
    await post({ authorization: 'Bearer good' });
    expect(seen.batch[0].input.worker).toBe(3);
  });

  it('answers health with no office object call without the jobs secret, and names the schema and the last job with it', async () => {
    const { seen, get, deps } = setup();
    const open = await get('/api/health');
    expect(await open.json()).toEqual({ ok: true, region: deps.config.region, host: 'office', calls: expect.any(Number) });
    expect(seen.health).toBe(0);
    expect((await get('/api/health', { 'x-madar-jobs-secret': 'wrong' })).status).toBe(401);
    const checked = await get('/api/health', { 'x-madar-jobs-secret': 'jobs-secret' });
    expect(((await checked.json()) as { office: unknown }).office).toEqual({ schema: 3, lastJob: null });
    expect(seen.health).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/entries/officeWorker.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to resolve import ./officeWorker".

- [ ] **Step 3: Export sameSecret**

In `server/jobs/app.ts`, change `async function sameSecret(` to `export async function sameSecret(`. The body stays.

- [ ] **Step 4: Write the routes**

Create `server/entries/officeWorker.ts`:

```ts
import { Hono, type Context } from 'hono';
import { ApiError } from '../../src/api/errors';
import { sharedCalls } from '../../src/api/sharedCalls';
import type { Deps } from '../core/ports';
import type { RunError } from '../core/types';
import { cors } from '../http/cors';
import { errorResponse, runErrorOf } from '../http/errors';
import { checkBuild, parseBatch, readBody } from '../http/limits';
import { JOBS_SECRET_HEADER, sameSecret } from '../jobs/app';
import type { OfficeBatchInput, OfficeBatchOutput } from '../office/batch';
import { TICKET_REFUSED, TICKET_SHAPE } from '../office/live';
import type { NetApi } from '../office/net';
import type { OfficeEffectsInput, OfficeEffectsReport, OfficeHealth } from '../office/parts';

/**
 * The Worker side of the office path (exit wave 3). The Worker checks the build, the body and the token (the CPU-light part, 10 ms
 * on Free), then gives the whole batch to the office object in one RPC call with its network port (server/office/workerNet.ts),
 * and sends the JSON text of the answer on as it is. The mails and pushes of the batch run after the answer, in one more object
 * call with the same port. The socket route checks only the upgrade and the shape of the ticket; the object checks the ticket.
 * Every request counts on the meter: the count goes with the next object call (worker).
 */

export const LIVE_PATH = '/api/live';

type Env = Record<string, unknown>;
type After = (work: Promise<unknown>) => void;
type Ctx = { waitUntil(work: Promise<unknown>): void; passThroughOnException?: () => void };

/** The RPC methods of the office object that the Worker calls (server/office/office.ts). */
export type OfficeStub = {
  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput>;
  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport>;
  health(): Promise<OfficeHealth>;
  fetch(request: Request): Promise<Response>;
};

export type OfficeRoutesOptions = {
  deps: Pick<Deps, 'config' | 'clock' | 'log'>;
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  stub: (env: Env) => OfficeStub;
  net: () => NetApi;
  jobsSecret: () => string | undefined;
};

const BUSY = new ApiError('failed', 'The office is busy. Try again in a moment.', { reason: 'busy' });

/** The refusal of an office object call that threw: busy when Cloudflare marks the error overloaded or retryable. */
export function officeErrorOf(error: unknown, log: Deps['log']): RunError {
  const marks = error as { overloaded?: unknown; retryable?: unknown } | null;
  if (marks !== null && typeof marks === 'object' && (marks.overloaded === true || marks.retryable === true)) return runErrorOf(BUSY);
  log.error('The office object failed.', { error: error instanceof Error ? error.message : String(error) });
  return runErrorOf(error);
}

export function officeRoutes(o: OfficeRoutesOptions) {
  const { log } = o.deps;
  let seen = 0;
  const reported = (): number => {
    const n = seen;
    seen = 0;
    return n;
  };

  async function batch(request: Request, env: Env, after: After | undefined): Promise<Response> {
    let calls: OfficeBatchInput['calls'];
    let overviewCalls: number;
    let authUserId: string;
    try {
      checkBuild(request.headers.get('X-Madar-Build') ?? undefined, o.deps.config.minClientBuild);
      const parsed = parseBatch(await readBody(request));
      calls = parsed.request.calls;
      overviewCalls = parsed.overviewCalls;
      ({ authUserId } = await o.verifyToken(request.headers.get('Authorization')));
    } catch (error) {
      if (!(error instanceof ApiError)) log.error('The batch failed before its calls.', { error: error instanceof Error ? error.message : String(error) });
      return errorResponse(runErrorOf(error));
    }
    const net = o.net();
    let out: OfficeBatchOutput;
    try {
      out = await o.stub(env).batch({ who: { kind: 'browser', authUserId }, calls, overviewCalls, worker: reported() }, net);
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
    if (!out.ok) return errorResponse(out.error);
    if (out.later.length > 0) {
      const work = o.stub(env).runEffects({ ids: out.later, worker: 0 }, net).catch((error: unknown) => {
        log.warn('The effects after the answer did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
      });
      if (after) after(work);
      else await work;
    }
    return new Response(out.body, { headers: { 'content-type': 'application/json' } });
  }

  async function live(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('This address needs a WebSocket.', { status: 426 });
    if (!TICKET_SHAPE.test(new URL(request.url).searchParams.get('ticket') ?? '')) return errorResponse(TICKET_REFUSED);
    try {
      return await o.stub(env).fetch(request);
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
  }

  async function health(request: Request, env: Env): Promise<Response> {
    const base = { ok: true, region: o.deps.config.region, host: 'office', calls: Object.keys(sharedCalls).length };
    const given = request.headers.get(JOBS_SECRET_HEADER);
    if (given === null) return Response.json(base);
    const secret = o.jobsSecret();
    if (!secret || !(await sameSecret(given, secret))) return errorResponse({ code: 'unauthenticated', message: 'The job secret is not right.' });
    try {
      return Response.json({ ...base, office: await o.stub(env).health() });
    } catch (error) {
      log.error('The office object failed its health check.', { error: error instanceof Error ? error.message : String(error) });
      return Response.json({ ...base, ok: false }, { status: 503 });
    }
  }

  const afterOf = (c: Context): After | undefined => {
    try {
      const ctx = c.executionCtx;
      return (work) => ctx.waitUntil(work);
    } catch {
      return undefined;
    }
  };

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', cors(() => o.deps.config.allowedOrigins));
  app.get('/api/health', (c) => health(c.req.raw, c.env));
  app.post('/api/batch', (c) => batch(c.req.raw, c.env, afterOf(c)));
  app.notFound(() => errorResponse({ code: 'not_found', message: 'This address does not exist.' }));
  app.onError((error) => {
    if (!(error instanceof ApiError)) log.error('A route failed.', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(runErrorOf(error));
  });

  return {
    async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
      seen += 1;
      if (new URL(request.url).pathname === LIVE_PATH) return live(request, env);
      return app.fetch(request, env, ctx as Parameters<typeof app.fetch>[2]);
    },
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/entries/officeWorker.test.ts server/jobs/app.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/entries/officeWorker.ts server/entries/officeWorker.test.ts server/jobs/app.ts
git commit -m "Exit wave 3: the Worker routes of the office path: one object call for each batch, the socket check, busy and health"
```

---

### Task 8: The Office class, the bundle entry, the wrangler blocks and the live test Worker

**Files:**
- Create: `server/office/office.ts`, `server/office/refusingDb.ts`, `server/entries/officeEntry.ts`, `server/entries/workerMain.ts`
- Create: `server/office/test/live/wrangler.toml`, `server/office/test/live/entry.ts`, `server/office/test/live/testOffice.ts`,
  `server/office/test/live/harness.ts`
- Modify: `server/office/workers.d.ts`, `vite.server.config.ts:32-52,64`, `wrangler.server.toml`
- Test: `server/workerGraph.test.ts`, `scripts/deploy/wranglerServer.test.ts`, `server/office/batch.wd.test.ts` (create)

**Interfaces:**
- Consumes: `officeParts` (Task 6); `officeRoutes`, `OfficeStub` (Task 7); `WorkerNet` (Task 3); `doHost` (wave 1);
  `applyLiteSchema` (Task 1); `workerEntry` (`server/entries/worker.ts`, unchanged); `depsFrom`, `serverEnvFrom`
  (`server/core/deps.ts`); `verifyBrowserToken` (`server/auth/verify.ts`); `withServerHeader`, `workersServer`
  (`server/entries/serverHeader.ts`).
- Produces: `class Office extends DurableObject` with `batch`, `runEffects`, `health`, `fetch`, `webSocketMessage`,
  `webSocketClose`, `webSocketError` and `protected principal(who, office)`, `protected parts`; `onOffice(env): boolean`;
  `OFFICE_NAME = 'office'`; `officeEntry() => { fetch(request, env, ctx?) }`; the default export of `workerMain.ts`; `TestOffice`
  (`seed`, `readBack`, `rows`, `exec`); `startLive()`.

- [ ] **Step 1: Write the failing source and config tests**

In `server/workerGraph.test.ts`, add `'server/entries/workerMain.ts'` to the `it.each` list of "loads no sample office and no
settleFuture", and add a `describe`:

```ts
describe('the office object in the bundles (exit wave 3)', () => {
  it('only the Workers bundle reaches the office object; no Supabase function does', () => {
    expect(staticGraph('server/entries/workerMain.ts')).toContain('server/office/office.ts');
    for (const entry of ['server/entries/deno-api.ts', 'server/entries/deno-mcp.ts', 'server/entries/deno-jobs.ts', 'server/entries/worker.ts']) {
      expect([...staticGraph(entry)].filter((file) => file.startsWith('server/office/')), entry).toEqual([]);
    }
  });

  it('the Workers bundle holds no test code', () => {
    expect([...staticGraph('server/entries/workerMain.ts')].filter((file) => file.includes('/test/'))).toEqual([]);
  });
});
```

In `scripts/deploy/wranglerServer.test.ts`, add:

```ts
import { fileURLToPath } from 'node:url';
import { unstable_readConfig } from 'wrangler';

describe('the office object in wrangler.server.toml (exit wave 3)', () => {
  const file = fileURLToPath(new URL('../../wrangler.server.toml', import.meta.url));
  const read = (env?: 'test' | 'production') => unstable_readConfig({ config: file, env }, { hideWarnings: true });

  it('gives the office object to local runs and to the test Worker, and none to production', () => {
    const office = [{ name: 'OFFICE', class_name: 'Office' }];
    expect(read().durable_objects.bindings).toEqual(office);
    expect(read('test').durable_objects.bindings).toEqual(office);
    expect(read('production').durable_objects.bindings).toEqual([]);
    expect(read('test').migrations).toEqual([{ tag: 'office-v1', new_sqlite_classes: ['Office'] }]);
    expect(read('production').migrations).toEqual([]);
  });

  it('sets MADAR_DATA in no env, so no deployed Worker takes the office path in wave 3', () => {
    for (const env of [undefined, 'test', 'production'] as const) expect(read(env).vars.MADAR_DATA).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project server server/workerGraph.test.ts scripts/deploy/wranglerServer.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `workerMain.ts` does not exist; the config has no `OFFICE` binding.

- [ ] **Step 3: Add the Hibernation types**

In `server/office/workers.d.ts`, replace the `DurableObjectState` interface inside `declare module 'cloudflare:workers'` with:

```ts
  export interface DurableObjectState {
    readonly storage: DurableObjectStorage;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
    acceptWebSocket(socket: WebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): WebSocket[];
    setWebSocketAutoResponse(pair?: WebSocketRequestResponsePair): void;
    getWebSocketAutoResponseTimestamp(socket: WebSocket): Date | null;
    getTags(socket: WebSocket): string[];
  }
```

and add at the end of the file, outside the module declaration:

```ts
/** The WebSocket globals of workerd that the office object uses (developers.cloudflare.com, Durable Object State, 2026-10-17). */
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}
```

- [ ] **Step 4: Write the class and the entries**

Create `server/office/refusingDb.ts`:

```ts
import type { Db } from '../core/ports';

const REFUSED = 'The Worker has no database on the office path: the office object holds it (server/office/office.ts).';

/** The Db of the Worker on the office path. Only a wiring mistake reaches it, so every statement fails with a clear message. */
export const refusingDb: Db = {
  tx: () => Promise.reject(new Error(REFUSED)),
  savepoint: () => Promise.reject(new Error(REFUSED)),
  statement: () => Promise.reject(new Error(REFUSED)),
};
```

Create `server/office/office.ts`:

```ts
import { DurableObject, type DurableObjectState } from 'cloudflare:workers';
import type { OfficeSnapshot, Principal } from '../core/types';
import { applyLiteSchema } from '../data/lite/schema';
import { env, setEnvSource } from '../env';
import type { OfficeBatchInput, OfficeBatchOutput } from './batch';
import { doHost } from './doHost';
import { LIVE_PING, LIVE_PONG, type LiveSocket, type Sockets } from './live';
import type { NetApi } from './net';
import { officeParts, type OfficeEffectsInput, type OfficeEffectsReport, type OfficeHealth, type OfficeParts } from './parts';
import { principalOfWho, type OfficeWho } from './who';

/**
 * The office object (exit wave 3): one SQLite Durable Object for each copy, named "office". The schema step runs inside
 * blockConcurrencyWhile, so no request meets an office that is not ready; a throw there resets the object. The work sits in
 * officeParts (server/office/parts.ts); this class gives it ctx.storage and the Hibernation API. workerd only.
 */

type Env = Record<string, unknown>;

function socketsOf(ctx: DurableObjectState): Sockets {
  return {
    accept: (socket, tags) => ctx.acceptWebSocket(socket as unknown as WebSocket, tags),
    list: (tag) => ctx.getWebSockets(tag) as unknown as LiveSocket[],
    lastPong: (socket) => ctx.getWebSocketAutoResponseTimestamp(socket as unknown as WebSocket),
    pair: () => {
      const pair = new WebSocketPair();
      return { client: pair[0], server: pair[1] as unknown as LiveSocket };
    },
    upgraded: (client) => new Response(null, { status: 101, webSocket: client } as ResponseInit),
  };
}

export class Office extends DurableObject<Env> {
  protected parts!: OfficeParts;

  constructor(ctx: DurableObjectState, environment: Env) {
    super(ctx, environment);
    setEnvSource(environment);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG));
    void ctx.blockConcurrencyWhile(async () => {
      const host = doHost(ctx.storage);
      await applyLiteSchema(host);
      this.parts = officeParts({ host, read: env, sockets: socketsOf(ctx), principal: (who, office) => this.principal(who, office) });
    });
  }

  /** The person of a batch: the users row of the token check (server/auth/principal.ts). The test object of test:office overrides it. */
  protected principal(who: OfficeWho, office: OfficeSnapshot): Principal {
    return principalOfWho(who, office);
  }

  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput> {
    return this.parts.batch(input, net);
  }

  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport> {
    return this.parts.runEffects(input, net);
  }

  health(): Promise<OfficeHealth> {
    return this.parts.health();
  }

  fetch(request: Request): Promise<Response> {
    return this.parts.socket(request);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    this.parts.message(socket as unknown as LiveSocket, message);
  }

  webSocketClose(socket: WebSocket, code: number): void {
    this.parts.closed(socket as unknown as LiveSocket, code);
  }

  webSocketError(socket: WebSocket): void {
    this.parts.closed(socket as unknown as LiveSocket, 1011);
  }
}
```

Create `server/entries/officeEntry.ts`:

```ts
import { verifyBrowserToken } from '../auth/verify';
import { depsFrom, serverEnvFrom } from '../core/deps';
import { env as readEnv, setEnvSource } from '../env';
import { refusingDb } from '../office/refusingDb';
import { WorkerNet } from '../office/workerNet';
import { officeRoutes, type OfficeStub } from './officeWorker';
import { withServerHeader, workersServer } from './serverHeader';

/**
 * The office path of the Worker (exit wave 3): the routes of server/entries/officeWorker.ts with the real token check, the
 * office object of the binding OFFICE, and a WorkerNet on the file and mail ports of the Worker. workerd only (WorkerNet).
 */

type Env = Record<string, unknown>;
type Ctx = { waitUntil(work: Promise<unknown>): void };
type Namespace = { idFromName(name: string): unknown; get(id: unknown): unknown };

/** The name of the one office object of a copy. */
export const OFFICE_NAME = 'office';

/**
 * True when this Worker serves its copy from the office object: the binding OFFICE and the var MADAR_DATA = "office". No env of
 * wrangler.server.toml sets the var in wave 3, so every deployed Worker keeps today's Postgres path.
 */
export function onOffice(env: Env): boolean {
  const namespace = env.OFFICE as Partial<Namespace> | undefined;
  return env.MADAR_DATA === 'office' && typeof namespace?.idFromName === 'function' && typeof namespace.get === 'function';
}

export function officeEntry() {
  let routes: ReturnType<typeof officeRoutes> | undefined;
  const start = () => {
    if (routes) return routes;
    const values = serverEnvFrom(readEnv, { database: { writeUrl: '', readUrl: '' } });
    const deps = depsFrom(values, { db: refusingDb });
    routes = officeRoutes({
      deps,
      verifyToken: verifyBrowserToken,
      stub: (env) => {
        const namespace = env.OFFICE as Namespace;
        return namespace.get(namespace.idFromName(OFFICE_NAME)) as OfficeStub;
      },
      net: () => new WorkerNet({ files: deps.files, mail: deps.mail }),
      jobsSecret: () => values.jobsSecret,
    });
    return routes;
  };
  return {
    async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
      setEnvSource(env);
      const response = await start().fetch(request, env, ctx);
      // A 101 answer carries the socket: a copy with one more header would lose it.
      return response.status === 101 ? response : withServerHeader(response, workersServer(request).replace(/^workers/, 'office'));
    },
  };
}
```

Create `server/entries/workerMain.ts`:

```ts
import { officeEntry, onOffice } from './officeEntry';
import { workerEntry } from './worker';

/**
 * The bundle entry of the Worker (dist-server/worker.js, wrangler.server.toml): today's Postgres path (server/entries/worker.ts),
 * or the office path when the env asks for it (onOffice; exit wave 3). It exports the class of the office object, which the
 * binding OFFICE and the migration office-v1 name.
 */
export { Office } from '../office/office';

type Env = Record<string, unknown>;
type Ctx = { waitUntil(work: Promise<unknown>): void };

const postgres = workerEntry();
const office = officeEntry();

export default {
  fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    return onOffice(env) ? office.fetch(request, env, ctx) : postgres.fetch(request, env, ctx);
  },
};
```

In `vite.server.config.ts`, give `serverEntry` a list of more externals and start the worker bundle at `workerMain.ts`:

```ts
export function serverEntry(name: string, input: string, outDir: string, conditions: string[], more: string[] = []): EnvironmentOptions {
  return {
    consumer: 'server',
    resolve: { conditions, externalConditions: conditions, noExternal: true, external: ['pg', ...more] },
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      copyPublicDir: false,
      rollupOptions: {
        input: { [name]: input },
        external: [...EXTERNAL, ...more],
        // keepNames: the error classes name themselves from their constructor, and check-bundles finds settleFuture by its name.
        output: { format: 'es', entryFileNames: `${name}.js`, codeSplitting: false, keepNames: true, comments: { legal: true, annotation: true, jsdoc: false } },
      },
    },
  };
}
```

```ts
    // The Workers bundle starts at workerMain.ts, which exports the office object (exit wave 3). workerd provides cloudflare:workers.
    worker: serverEntry('worker', 'server/entries/workerMain.ts', 'dist-server', WORKERD, ['cloudflare:workers']),
```

- [ ] **Step 5: Add the office blocks to wrangler.server.toml**

After the top-level `[dev]` table, add:

```toml
# The office object (Supabase exit, wave 3): one SQLite Durable Object for each copy (server/office/office.ts). The Worker uses it
# only with the var MADAR_DATA = "office" (server/entries/officeEntry.ts), and no env sets that var before wave 5. Bindings do not
# inherit, so [env.test] repeats the binding. The migration inherits: [env.production] turns it off with an empty list until the
# switch (wave 6), so no office object deploys to production before it (exit plan, Global Constraints).
[[durable_objects.bindings]]
name = "OFFICE"
class_name = "Office"

[[migrations]]
tag = "office-v1"
new_sqlite_classes = ["Office"]
```

After `[[env.test.hyperdrive]]` and its two lines, add:

```toml
# The office object of the test copy (wave 3). It holds nothing until wave 5 moves the test copy to it.
[[env.test.durable_objects.bindings]]
name = "OFFICE"
class_name = "Office"
```

Under `[env.production]`, after `preview_urls = false`, add:

```toml
# No office object in production before the switch (wave 6): no binding, and no migration from the top level. Wrangler prints one
# warning on each production deploy ("durable_objects exists at the top level, but not on env.production"); it is expected.
migrations = []
```

- [ ] **Step 6: Write the live test Worker**

Create `server/office/test/live/wrangler.toml`:

```toml
# The test Worker of the live suites of test:office (Supabase exit, wave 3): the office routes and the TestOffice class on local
# workerd (wrangler createTestHarness). It never deploys. The harness (harness.ts) passes the values that look like keys as
# secrets, made for each run: none of them is a real key.
name = "madar-office-live-test"
main = "entry.ts"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

[vars]
MADAR_DATA = "office"
APP_URL = "http://127.0.0.1:5173"
MAIL_FROM = "Madar <notices@madar.test>"
MAIL_DRIVER = "resend"
SUPABASE_URL = "http://127.0.0.1:54321"
MADAR_FILE_STORE = "r2"
R2_BUCKET = "madar-files-test"
MADAR_LIVE_STALE_MS = "1500"

[[durable_objects.bindings]]
name = "OFFICE"
class_name = "TestOffice"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TestOffice"]
```

Create `server/office/test/live/testOffice.ts`:

```ts
import type { State } from '../../../../src/api/store';
import { resolveActor } from '../../../core/actor';
import type { OfficeSnapshot, Principal } from '../../../core/types';
import { liteLoadWhole, liteWriteState } from '../../../data/lite/whole';
import { Office } from '../../office';
import type { OfficeWho } from '../../who';

/** The office object of the live suites: the production class, with no sign-in (the token is the user id) and a few test reads. */
export class TestOffice extends Office {
  protected override principal(who: OfficeWho, office: OfficeSnapshot): Principal {
    const principal = { userId: who.authUserId };
    resolveActor(office, principal);
    return principal;
  }

  async seed(state: State): Promise<void> {
    await this.parts.db.tx('write', (q) => liteWriteState(q, state));
  }

  readBack(): Promise<State> {
    return this.parts.db.tx('read', (q) => liteLoadWhole(q));
  }

  rows(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    return this.parts.db.statement('read', text, values);
  }

  async exec(text: string, values: unknown[] = []): Promise<void> {
    await this.parts.db.statement('write', text, values);
  }
}
```

Create `server/office/test/live/entry.ts`:

```ts
import { ApiError } from '../../../../src/api/errors';
import { consoleLogger } from '../../../core/deps';
import { officeRoutes, type OfficeStub } from '../../../entries/officeWorker';
import { setEnvSource } from '../../../env';
import { testConfig } from '../../../test/fakes/deps';
import { fakeFiles } from '../../../test/fakes/files';
import { fakeMail } from '../../../test/fakes/mail';
import { WorkerNet } from '../../workerNet';
import { TestOffice } from './testOffice';

export { TestOffice };

type Env = Record<string, unknown> & { OFFICE: { idFromName(name: string): unknown; get(id: unknown): unknown } };
type Ctx = { waitUntil(work: Promise<unknown>): void };
type Test = OfficeStub & Pick<TestOffice, 'seed' | 'readBack' | 'rows' | 'exec'>;

// The network of the test Worker: files and mail in memory, and a push service that takes every push. /test/net shows them.
const files = fakeFiles({ kind: 'r2' });
const mail = fakeMail();
const pushes: { endpoint: string; headers: Record<string, string> }[] = [];
const pushFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  pushes.push({ endpoint: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
  return new Response(null, { status: 201 });
}) as typeof fetch;

const stubOf = (env: Env) => env.OFFICE.get(env.OFFICE.idFromName('office')) as Test;
const routes = officeRoutes({
  deps: { config: testConfig({ fileStore: 'r2' }), clock: { now: () => new Date() }, log: consoleLogger() },
  // No sign-in here: the token is the Madar user id (TestOffice.principal checks that the person acts now).
  verifyToken: async (header) => {
    const token = (header ?? '').replace(/^Bearer /, '');
    if (!/^usr_\d{3}$/.test(token)) throw new ApiError('unauthenticated', 'Sign in to Madar again.');
    return { authUserId: token };
  },
  stub: (env) => stubOf(env as Env),
  net: () => new WorkerNet({ files, mail, fetch: pushFetch }),
  jobsSecret: () => 'test-jobs-secret',
});

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    setEnvSource(env);
    const { pathname } = new URL(request.url);
    if (pathname === '/test/net') return Response.json({ files: files.calls, mails: mail.sent, pushes });
    if (pathname === '/test/seed') {
      await stubOf(env).seed(await request.json());
      return Response.json({ ok: true });
    }
    if (pathname === '/test/readBack') return Response.json(await stubOf(env).readBack());
    if (pathname === '/test/rows') {
      const { text, values } = (await request.json()) as { text: string; values?: unknown[] };
      return Response.json(await stubOf(env).rows(text, values));
    }
    if (pathname === '/test/exec') {
      const { text, values } = (await request.json()) as { text: string; values?: unknown[] };
      await stubOf(env).exec(text, values);
      return Response.json({ ok: true });
    }
    return routes.fetch(request, env, ctx);
  },
};
```

Create `server/office/test/live/harness.ts`:

```ts
import { createTestHarness } from 'wrangler';
import type { RunError } from '../../../core/types';
import type { WireResponse } from '../../../../src/api/remote/wire';
import type { State } from '../../../../src/api/store';
import { makeVapidKeys } from '../../../push/vapid';

export type SocketClient = { ws: WebSocket; got: string[]; opened: Promise<void>; closed: Promise<{ code: number; reason: string }> };
export type NetSeen = { files: { op: string; key: string }[]; mails: { to: string; tag: string; idempotencyKey: string }[]; pushes: { endpoint: string; headers: Record<string, string> }[] };
export type BatchCall = { name: string; input: unknown; story?: { ref: string } | { id: string }; key?: string };

/** A browser socket from Node 22 (global WebSocket), with every message it got. */
export function openSocket(address: string): SocketClient {
  const ws = new WebSocket(address);
  const got: string[] = [];
  ws.onmessage = (event) => got.push(String(event.data));
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('The socket did not open.'));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.onclose = (event) => resolve({ code: event.code, reason: event.reason });
  });
  return { ws, got, opened, closed };
}

/**
 * Starts the live test Worker on local workerd. Every call goes through fetch, so Node holds no stub of the office object and an
 * evict works (proof.md, "Wave 1: the rows pins"). fresh() gives each test a new office: reset() makes the storage again.
 */
export async function startLive() {
  const vapid = await makeVapidKeys();
  const server = createTestHarness({
    workers: [{
      configPath: new URL('./wrangler.toml', import.meta.url),
      secrets: {
        RESEND_API_KEY: 're_test_not_a_key', MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', R2_ACCOUNT_ID: '0'.repeat(32),
        R2_ACCESS_KEY_ID: 'test-not-a-key', R2_SECRET_ACCESS_KEY: 'test-not-a-key',
        VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:madar@vado.sa',
      },
    }],
  });
  let { url } = await server.listen();
  const worker = () => server.getWorker();
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker().fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const read = async <T,>(response: Response): Promise<T> => {
    if (!response.ok) throw new Error(`${response.url} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  };
  return {
    server,
    worker,
    url: () => url,
    fresh: async (state: State) => {
      await server.reset();
      ({ url } = await server.listen());
      await read(await post('/test/seed', state));
    },
    rows: async <R,>(text: string, values: unknown[] = []) => read<R[]>(await post('/test/rows', { text, values })),
    exec: async (text: string, values: unknown[] = []) => read<{ ok: true }>(await post('/test/exec', { text, values })),
    readBack: async () => read<State>(await worker().fetch('/test/readBack')),
    net: async () => read<NetSeen>(await worker().fetch('/test/net')),
    batch: async (userId: string, calls: BatchCall[]) => {
      const response = await post('/api/batch', { v: 1, calls: calls.map((c, i) => ({ i, ...c })) }, { authorization: `Bearer ${userId}` });
      return { status: response.status, body: (await response.json()) as WireResponse & { error?: RunError } };
    },
    open: (ticket: string) => openSocket(`${url.href.replace(/^http/, 'ws')}api/live?ticket=${ticket}`),
    evict: () => worker().evictDurableObject('OFFICE', { name: 'office', webSockets: 'hibernate' }),
  };
}
```

- [ ] **Step 7: Write the first workerd test**

Create `server/office/batch.wd.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { startLive } from './test/live/harness';

const TODAY = new Date().toISOString().slice(0, 10);

describe('the batch call into the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('answers a batch from the office object, with the session of the person', async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    const { status, body } = await live.batch('usr_005', [{ name: 'session.get', input: {} }]);
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ i: 0, ok: true, output: { user: { id: 'usr_005' } } });
  });

  it('refuses a batch with no token before the office object', async () => {
    const response = await live.worker().fetch('/api/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, calls: [] }) });
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 8: Run every test of the task**

Run: `npx vitest run --project server server/workerGraph.test.ts scripts/deploy/wranglerServer.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.
Run (sandbox off): `npm run test:office -- server/office/batch.wd.test.ts`
Expected: PASS, 2 tests.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Check the bundles**

Run (sandbox off): `npm run build:server && grep -c "cloudflare:workers" dist-server/worker.js; grep -c "cloudflare:workers" supabase/functions/_build/api.js supabase/functions/_build/mcp.js supabase/functions/_build/jobs.js`
Expected: the build passes with `check-bundles.ts server`; the first count is 1 or more; each Supabase bundle counts 0. A count of 0
for `worker.js` means the bundle lost the class: stop and look at `vite.server.config.ts`.

- [ ] **Step 10: Commit**

```bash
git add server/office/office.ts server/office/refusingDb.ts server/office/workers.d.ts server/entries/officeEntry.ts server/entries/workerMain.ts \
  server/office/test/live server/office/batch.wd.test.ts vite.server.config.ts wrangler.server.toml server/workerGraph.test.ts scripts/deploy/wranglerServer.test.ts
git commit -m "Exit wave 3: the Office class, the Workers bundle entry, the office binding for local runs and the test Worker, none for production"
```

---
# Block B: The live ticket and the screens (Tasks 9 to 11, about 1 day)

### Task 9: The server call live.ticket

A new server-only call, on every list of the new-call checklist (`src/api/CLAUDE.md`, "A new call: the checklist"). It is a read:
it writes no record. An agent never opens a socket, so the call is on `MCP_DENY` and refuses an agent principal too.

**Files:**
- Create: `server/calls/live.ts`
- Modify: `src/api/contract/server.ts:9-17` (names, comment), `:166-171` (`serverContracts`); `src/api/handlers/serverFakes.ts`
  (a fake, `serverFakes`); `server/calls/index.ts` (`SERVER_CALLS`); `server/mcp/tools.ts:66-71` (`MCP_DENY`); `src/app/readMap.ts:83`
- Test: `server/calls/live.test.ts` (create), `src/api/calls.test.ts:60-72`, `server/core/serverCallMap.test.ts:16`, `server/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `LivePort`, `Deps.live` (Task 3); `LiveTickets` (Task 5); `resolveActor`; `forbidden`, `ApiError`.
- Produces: the call `live.ticket` with input `{}` and output `{ ticket: string (64 hex); expiresAt: string }`, `readOnly: true`;
  `liveTicket: ServerCall<'live.ticket'>`.

- [ ] **Step 1: Write the failing tests**

Create `server/calls/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { LiveTickets } from '../office/live';
import { fakeDeps } from '../test/fakes/deps';
import { liveTicket } from './live';

const NOW = new Date('2026-10-04T06:00:00Z');

async function ctxOf(userId: string, o: { live?: boolean; agent?: boolean; off?: boolean } = {}): Promise<{ tickets: LiveTickets; ctx: ServerCallCtx }> {
  const seed = await buildSeed('2026-10-04', async () => undefined);
  if (o.off) seed.users[userId] = { ...seed.users[userId], active: false };
  const deps = fakeDeps();
  const tickets = new LiveTickets();
  if (o.live !== false) deps.live = tickets;
  const principal = o.agent ? { userId, agent: { clientId: 'cli_test' } } : { userId };
  return { tickets, ctx: { deps, principal, office: snapshotOf(seed, 1), batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW } };
}

describe('live.ticket (server/calls/live.ts)', () => {
  it('gives a person a ticket of 60 seconds that the office object takes once', async () => {
    const { tickets, ctx } = await ctxOf('usr_005');
    const { output, changed } = await liveTicket({}, ctx);
    expect([output.ticket, output.expiresAt, changed]).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), '2026-10-04T09:01:00.000+03:00', false]);
    expect(tickets.take(output.ticket, NOW)).toEqual({ userId: 'usr_005' });
    expect(tickets.take(output.ticket, NOW)).toBeUndefined();
  });

  it('refuses an agent: an agent opens no socket', async () => {
    const { ctx } = await ctxOf('usr_009', { agent: true });
    await expect(liveTicket({}, ctx)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a person who is off', async () => {
    const { ctx } = await ctxOf('usr_004', { off: true });
    await expect(liveTicket({}, ctx)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('answers not_found outside the office object', async () => {
    const { ctx } = await ctxOf('usr_005', { live: false });
    await expect(liveTicket({}, ctx)).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

In `src/api/calls.test.ts`, add `'live.ticket'` to `SERVER_CALLS` and to `SERVER_READS`, change the test name to "the 11 server
calls", and change `toHaveLength(131)` to `toHaveLength(132)`. In `server/core/serverCallMap.test.ts`, change `toBe(127)` to
`toBe(128)`. In `server/mcp/tools.test.ts`, add inside its first `describe`:

```ts
  it('keeps live.ticket from every agent (exit wave 3): an agent opens no socket', () => {
    expect(MCP_DENY).toContain('live.ticket');
    for (const admin of [false, true]) expect(mcpTools({ admin }).map((tool) => tool.name)).not.toContain('live.ticket');
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/calls/live.test.ts server/core/serverCallMap.test.ts server/mcp/tools.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL ("Failed to resolve import ./live"; the map size is 127; `MCP_DENY` lacks the name).
Run: `npx vitest run --project unit src/api/calls.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL (131 calls, no `live.ticket`).

- [ ] **Step 3: Write the contract and the prototype fake**

In `src/api/contract/server.ts`, change the comment above `SERVER_CALL_NAMES` to name 11 calls and the live socket, and add the
name:

```ts
/**
 * The 11 calls that only the real build has (plan 4.11; usage.retryEffect from task M1, plan 4.12; live.ticket from the exit,
 * wave 3). They carry the work that State cannot hold: story IDs, file links, invitations, agents, usage and the ticket of the live
 * socket. The server runs its own versions; src/api/handlers/serverFakes.ts gives the prototype fake ones. The MCP tool list
 * (track G) reads these contracts, not the server code.
 */
export const SERVER_CALL_NAMES = [
  'story.start', 'files.uploadStart', 'files.link', 'feedback.uploadStart', 'users.invites', 'users.resendInvite', 'agents.list', 'agents.remove', 'usage.get',
  'usage.retryEffect', 'live.ticket',
] as const;
```

Above `export const serverContracts`, add:

```ts
/**
 * live.ticket (exit wave 3): a ticket of 60 seconds and one use for the live socket of the person (GET /api/live?ticket=). A browser
 * socket cannot send the Authorization header, so it opens with this ticket. The office object makes it and keeps it in memory.
 */
const liveTicket = {
  input: Empty,
  output: z.object({ ticket: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: z.string().min(1) }),
  readOnly: true,
};
```

and add `'live.ticket': liveTicket,` as the last entry of `serverContracts`.

In `src/api/handlers/serverFakes.ts`, above `export const serverFakes`, add:

```ts
/** The prototype has no server and no socket: its changes come from the store (src/app/signals.ts). This ticket opens nothing. */
const liveTicket = defineCall({
  ...c['live.ticket'],
  run: (_input, ctx) => ({ ticket: '0'.repeat(64), expiresAt: later(ctx.now, 60_000) }),
});
```

and add `'live.ticket': liveTicket,` as the last entry of `serverFakes`.

- [ ] **Step 4: Write the server call and its lists**

Create `server/calls/live.ts`:

```ts
import { ApiError, forbidden } from '../../src/api/errors';
import { resolveActor } from '../core/actor';
import type { ServerCall } from '../core/types';

/**
 * live.ticket (exit wave 3): the ticket of the live socket of the person. The office object makes it (server/office/live.ts,
 * LiveTickets) inside the batch that the Worker handed over after its token check, and the socket open takes it. Only a person
 * opens a socket: an agent gets forbidden. Outside the office object (the Supabase functions, the Postgres path of the Worker)
 * there is no ticket, so the call answers not_found.
 */
export const liveTicket: ServerCall<'live.ticket'> = async (_input, ctx) => {
  const actor = resolveActor(ctx.office, ctx.principal);
  if (actor.kind === 'agent') throw forbidden('An agent does not open live updates.', { action: 'live.open' });
  if (!ctx.deps.live) throw new ApiError('not_found', 'Live updates on a socket are not on this server yet.');
  return { output: ctx.deps.live.mint(ctx.principal.userId, ctx.now), changed: false };
};
```

In `server/calls/index.ts`, import it and add `'live.ticket': liveTicket,` to `SERVER_CALLS`; change "The registry of the 10 server
calls" to "11". In `server/mcp/tools.ts`, add to `MCP_DENY` after the push devices line:

```ts
  // Live updates (exit wave 3): the ticket opens a browser socket. An agent has no socket.
  'live.ticket',
```

In `src/app/readMap.ts`, after the `usage.get` line:

```ts
  // The ticket of the live socket (exit wave 3): src/api/remote/liveSocket.ts asks for it with api.call, never with useCall.
  'live.ticket': rule('none', []),
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/calls/live.test.ts server/core/serverCallMap.test.ts server/mcp/tools.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.
Run: `npx vitest run --project unit src/api/calls.test.ts src/app/readMap.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/calls/live.ts server/calls/live.test.ts server/calls/index.ts src/api/contract/server.ts src/api/handlers/serverFakes.ts \
  server/mcp/tools.ts server/mcp/tools.test.ts src/app/readMap.ts src/api/calls.test.ts server/core/serverCallMap.test.ts
git commit -m "Exit wave 3: the server call live.ticket, on the MCP deny list, with its prototype fake and read rule"
```

---

### Task 10: The live socket of the screens

Today's live updates come from Supabase Realtime (`src/app/remote/channel.ts`, `supabaseChangeSource`), and the Supabase build
keeps it. The office build gets one socket for the two channels of a person, with the ping of wave 0 change 4. The file lives in
`src/api/remote` (the task of the orchestrator), so it imports nothing from `src/app` (root rule) and has its own listener type.

**Files:**
- Create: `src/api/remote/liveSocket.ts`
- Modify: `src/app/remote/bootstrap.ts` (`liveSourceOf`, the `open` of `personChangeSource`), `src/env.d.ts`
- Test: `src/api/remote/liveSocket.test.ts` (create), `src/app/remote/bootstrap.test.ts`

**Interfaces:**
- Consumes: `ChangeSignal` (`src/api/remote/wire.ts`); `api.call('live.ticket', {})` (Task 9); `ChangeSource` (`src/app/signals.ts`).
- Produces: `LIVE_PING_MS = 30_000`, `LIVE_PONG_WAIT_MS = 10_000`, `LIVE_RETRY_MS`, `LiveListener`, `LiveSource`, `LiveWebSocket`,
  `LiveSocketOptions`, `isChangeSignal(value, topics)`, `liveUrl(apiUrl, page)`, `liveSocketSource(o): LiveSource`;
  `liveSourceOf(kind, o): (me: string) => ChangeSource`; `ImportMetaEnv.VITE_MADAR_LIVE?: 'socket' | 'realtime'`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/remote/liveSocket.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_PING_MS, LIVE_PONG_WAIT_MS, LIVE_RETRY_MS, liveSocketSource, liveUrl, type LiveWebSocket } from './liveSocket';
import type { ChangeSignal } from './wire';

class FakeSocket implements LiveWebSocket {
  readyState = 0;
  sent: string[] = [];
  closedWith?: number;
  onopen: LiveWebSocket['onopen'] = null;
  onmessage: LiveWebSocket['onmessage'] = null;
  onclose: LiveWebSocket['onclose'] = null;
  onerror: LiveWebSocket['onerror'] = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  /** The office object accepts the socket. */
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(data: string) {
    this.onmessage?.({ data });
  }
  /** The connection breaks with no close frame. */
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const signal = (channel: string): ChangeSignal => ({ v: 1, id: 'sig_1', channel: channel as ChangeSignal['channel'], seq: 1, projects: [], office: true, kinds: ['tasks'], people: [] });

function setup(o: { failFirstTicket?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  let n = 0;
  const ticket = vi.fn(async () => {
    n += 1;
    if (o.failFirstTicket && n === 1) throw new Error('The network is down.');
    return { ticket: `t${n}`, expiresAt: '2026-10-04T09:01:00.000+03:00' };
  });
  const heard: { signals: ChangeSignal[]; origin?: string }[] = [];
  let showTab: () => void = () => undefined;
  const source = liveSocketSource({
    me: 'usr_005',
    ticket,
    url: (t) => `wss://madar.test/api/live?ticket=${t}`,
    open: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    page: { visible: () => true, onVisible: (listener) => ((showTab = listener), () => undefined) },
  });
  const stop = source.subscribe((signals, origin) => heard.push({ signals, origin }));
  return { sockets, ticket, heard, source, stop, showTab: () => showTab() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the live socket of the screens (src/api/remote/liveSocket.ts)', () => {
  it('asks a ticket, opens the socket with it, and reloads every list once it is open', async () => {
    const { sockets, ticket, heard, source } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(sockets.map((s) => s.url)).toEqual(['wss://madar.test/api/live?ticket=t1']);
    expect(source.status()).toBe('closed');
    sockets[0].accept();
    expect(heard).toEqual([{ signals: [], origin: 'join' }]);
    expect(source.status()).toBe('open');
  });

  it('passes on a change signal of its own channels and drops every other message', async () => {
    const { sockets, heard } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    sockets[0].message(JSON.stringify({ event: 'changed', payload: signal('office') }));
    sockets[0].message(JSON.stringify({ event: 'changed', payload: signal('person:usr_005') }));
    sockets[0].message(JSON.stringify({ event: 'changed', payload: signal('person:usr_002') }));
    sockets[0].message('not json');
    sockets[0].message(JSON.stringify({ event: 'other', payload: signal('office') }));
    expect(heard.slice(1).map((h) => [h.origin, h.signals[0].channel])).toEqual([['channel', 'office'], ['channel', 'person:usr_005']]);
  });

  it('pings each 30 s, and opens again and reloads when no pong comes in 10 s', async () => {
    const { sockets, heard, ticket } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    await vi.advanceTimersByTimeAsync(LIVE_PING_MS);
    expect(sockets[0].sent).toEqual(['ping']);
    sockets[0].message('pong');
    await vi.advanceTimersByTimeAsync(LIVE_PING_MS);
    expect(sockets[0].sent).toEqual(['ping', 'ping']);
    await vi.advanceTimersByTimeAsync(LIVE_PONG_WAIT_MS);
    expect(sockets[0].closedWith).toBe(4000);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    expect(ticket).toHaveBeenCalledTimes(2);
    sockets[1].accept();
    expect(heard.filter((h) => h.origin === 'join')).toHaveLength(2);
  });

  it('opens again after a drop with a new ticket, and waits longer after each try', async () => {
    const { sockets, ticket } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].drop();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0] - 1);
    expect(ticket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticket).toHaveBeenCalledTimes(2);
    sockets[1].drop();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[1]);
    expect(ticket).toHaveBeenCalledTimes(3);
    sockets[2].accept();
    sockets[2].drop();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    expect(ticket).toHaveBeenCalledTimes(4);
  });

  it('tries the ticket again when it fails', async () => {
    const { sockets, ticket } = setup({ failFirstTicket: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toEqual([]);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    expect(ticket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
  });

  it('pings at once when the tab shows again', async () => {
    const { sockets, showTab } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    showTab();
    expect(sockets[0].sent).toEqual(['ping']);
  });

  it('closes the socket and stops every timer at the last unsubscribe', async () => {
    const { sockets, ticket, stop } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    stop();
    expect(sockets[0].closedWith).toBe(1000);
    await vi.advanceTimersByTimeAsync(10 * LIVE_PING_MS);
    expect(sockets[0].sent).toEqual([]);
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the address of the live socket', () => {
  it('is the page host with ws or wss, the api path and the ticket', () => {
    expect(liveUrl('/api', 'https://madar.vado.sa/projects')('t1')).toBe('wss://madar.vado.sa/api/live?ticket=t1');
    expect(liveUrl('/api/', 'http://127.0.0.1:4174/')('t2')).toBe('ws://127.0.0.1:4174/api/live?ticket=t2');
  });
});
```

In `src/app/remote/bootstrap.test.ts`, add:

```ts
describe('the live updates of the remote build (exit wave 3)', () => {
  const quiet = () => ({ subscribe: () => () => undefined, status: () => 'closed' as const });

  it('uses Supabase Realtime unless the build says socket', () => {
    const realtime = vi.fn(quiet);
    const ticket = vi.fn();
    liveSourceOf(undefined, { realtime, ticket, apiUrl: '/api', page: 'https://madar.vado.sa/' })('usr_005');
    liveSourceOf('realtime', { realtime, ticket, apiUrl: '/api', page: 'https://madar.vado.sa/' })('usr_005');
    expect(realtime).toHaveBeenCalledTimes(2);
    expect(ticket).not.toHaveBeenCalled();
  });

  it('opens the socket of the office object with a ticket when the build says socket', async () => {
    const realtime = vi.fn(quiet);
    const ticket = vi.fn(() => new Promise<never>(() => undefined));
    const source = liveSourceOf('socket', { realtime, ticket, apiUrl: '/api', page: 'https://madar.vado.sa/' })('usr_005');
    const stop = source.subscribe(() => undefined);
    await Promise.resolve();
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(realtime).not.toHaveBeenCalled();
    stop();
  });
});
```

and add `liveSourceOf` to the import from `./bootstrap` (line 8 of the file).

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project unit src/api/remote/liveSocket.test.ts src/app/remote/bootstrap.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL ("Failed to resolve import ./liveSocket"; `liveSourceOf` is not exported).

- [ ] **Step 3: Write the live socket**

Create `src/api/remote/liveSocket.ts`:

```ts
import type { ChangeSignal } from './wire';

/**
 * The live updates of the real build on the office object (exit wave 3; spec section 2, "Live updates"). One socket carries the
 * two channels of a person, "office" and "person:<id>". The Supabase build keeps Realtime (src/app/remote/channel.ts).
 *
 * - Open: ask live.ticket, then open <api>/live?ticket=<ticket> (a browser socket cannot send a header). Once it is open, the
 *   listeners get an empty list with the origin 'join', which reloads every list: a socket keeps no message for a later open.
 * - Each 30 s the socket sends "ping"; the office object answers "pong" with no wake. No pong in 10 s means the socket died with no
 *   close frame (a phone that slept): this source closes it and opens a new one, which reloads (wave 0 change 4).
 * - A drop opens again after 1, 2, 5, 10, then 30 s, each time with a new ticket. A tab that shows again pings at once.
 * - Only a signal of its own two channels passes. This file imports nothing from src/app (root rule): its listener matches the
 *   ChangeListener of src/app/signals.ts.
 */

export type LiveOrigin = 'channel' | 'join';
export type LiveListener = (signals: ChangeSignal[], origin?: LiveOrigin) => void;
export type LiveSource = { subscribe(listener: LiveListener): () => void; status(): 'open' | 'closed' };

/** The part of a browser WebSocket that the source uses, so a test can pass a fake. */
export type LiveWebSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type LiveSocketOptions = {
  me: string;
  ticket: () => Promise<{ ticket: string; expiresAt: string }>;
  url: (ticket: string) => string;
  open?: (url: string) => LiveWebSocket;
  page?: { visible(): boolean; onVisible(listener: () => void): () => void };
};

export const LIVE_PING_MS = 30_000;
export const LIVE_PONG_WAIT_MS = 10_000;
export const LIVE_RETRY_MS = [1000, 2000, 5000, 10_000, 30_000] as const;
const OPEN = 1;

/** True for a change signal of the wire form on one of the topics. */
export function isChangeSignal(value: unknown, topics: readonly string[]): value is ChangeSignal {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string');
  return s.v === 1 && typeof s.id === 'string' && typeof s.channel === 'string' && topics.includes(s.channel)
    && typeof s.seq === 'number' && Number.isFinite(s.seq) && strings(s.projects) && typeof s.office === 'boolean'
    && strings(s.kinds) && strings(s.people);
}

/** The socket address for a ticket: the api address of the build (the page's own /api) on the page host, with ws or wss. */
export function liveUrl(apiUrl: string, page: string): (ticket: string) => string {
  const base = new URL(`${apiUrl.replace(/\/+$/, '')}/live`, page);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return (ticket) => {
    const url = new URL(base);
    url.searchParams.set('ticket', ticket);
    return url.toString();
  };
}

function browserPage(): LiveSocketOptions['page'] {
  if (typeof document === 'undefined') return undefined;
  return {
    visible: () => document.visibilityState === 'visible',
    onVisible: (listener) => {
      const shown = () => {
        if (document.visibilityState === 'visible') listener();
      };
      document.addEventListener('visibilitychange', shown);
      return () => document.removeEventListener('visibilitychange', shown);
    },
  };
}

export function liveSocketSource(o: LiveSocketOptions): LiveSource {
  const listeners = new Set<LiveListener>();
  const open = o.open ?? ((url: string) => new WebSocket(url) as unknown as LiveWebSocket);
  const page = o.page ?? browserPage();
  const topics = ['office', `person:${o.me}`];
  let running = false;
  let generation = 0;
  let socket: LiveWebSocket | undefined;
  let tries = 0;
  let pinger: ReturnType<typeof setInterval> | undefined;
  let pongWait: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopPage: (() => void) | undefined;

  const tell = (signals: ChangeSignal[], origin: LiveOrigin = 'channel') => {
    for (const listener of [...listeners]) listener(signals, origin);
  };

  function clearTimers(): void {
    if (pinger !== undefined) clearInterval(pinger);
    if (pongWait !== undefined) clearTimeout(pongWait);
    pinger = undefined;
    pongWait = undefined;
  }

  /** The socket is gone: a drop, an error, or no pong. Only the current socket counts, once. */
  function dropped(ws: LiveWebSocket): void {
    if (socket !== ws) return;
    socket = undefined;
    clearTimers();
    if (running) schedule();
  }

  function ping(): void {
    const ws = socket;
    if (!ws || ws.readyState !== OPEN || pongWait !== undefined) return;
    ws.send('ping');
    pongWait = setTimeout(() => {
      pongWait = undefined;
      ws.close(4000, 'No pong.');
      dropped(ws);
    }, LIVE_PONG_WAIT_MS);
  }

  function schedule(): void {
    if (retry !== undefined) return;
    const wait = LIVE_RETRY_MS[Math.min(tries, LIVE_RETRY_MS.length - 1)];
    tries += 1;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, wait);
  }

  function connect(): void {
    const mine = ++generation;
    o.ticket().then(
      ({ ticket }) => {
        if (!running || mine !== generation) return;
        const ws = open(o.url(ticket));
        socket = ws;
        ws.onopen = () => {
          if (socket !== ws) return;
          tries = 0;
          clearTimers();
          pinger = setInterval(ping, LIVE_PING_MS);
          tell([], 'join');
        };
        ws.onmessage = (event) => {
          if (socket !== ws) return;
          const text = String(event.data);
          if (text === 'pong') {
            if (pongWait !== undefined) clearTimeout(pongWait);
            pongWait = undefined;
            return;
          }
          let message: { event?: unknown; payload?: unknown } | null;
          try {
            message = JSON.parse(text) as { event?: unknown; payload?: unknown } | null;
          } catch {
            return;
          }
          if (message?.event === 'changed' && isChangeSignal(message.payload, topics)) tell([message.payload]);
        };
        ws.onclose = () => dropped(ws);
        ws.onerror = () => dropped(ws);
      },
      () => {
        if (running && mine === generation) schedule();
      },
    );
  }

  function start(): void {
    running = true;
    tries = 0;
    stopPage = page?.onVisible(() => ping());
    connect();
  }

  function stop(): void {
    running = false;
    generation += 1;
    clearTimers();
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    stopPage?.();
    stopPage = undefined;
    const ws = socket;
    socket = undefined;
    ws?.close(1000, 'Done.');
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!running) start();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    status: () => (running && socket?.readyState === OPEN ? 'open' : 'closed'),
  };
}
```

- [ ] **Step 4: Pick the live source in the bootstrap**

In `src/env.d.ts`, add to `ImportMetaEnv`:

```ts
  /** The live updates (exit wave 3): 'socket' for the office object, else Supabase Realtime. No build of wave 3 sets it. */
  readonly VITE_MADAR_LIVE?: 'socket' | 'realtime';
```

In `src/app/remote/bootstrap.ts`, add the import:

```ts
import { liveSocketSource, liveUrl } from '../../api/remote/liveSocket';
```

above `export type RemoteRuntime`, add:

```ts
/**
 * The live updates of one person (exit wave 3): the socket of the office object when the build says VITE_MADAR_LIVE=socket, else
 * Supabase Realtime (every build until a copy moves to its office object in wave 5). realtime is a function, so a build with no
 * Supabase client can leave it out later.
 */
export function liveSourceOf(
  kind: string | undefined,
  o: { realtime: (me: string) => ChangeSource; ticket: () => Promise<{ ticket: string; expiresAt: string }>; apiUrl: string; page: string },
): (me: string) => ChangeSource {
  if (kind !== 'socket') return o.realtime;
  const url = liveUrl(o.apiUrl, o.page);
  return (me) => liveSocketSource({ me, ticket: o.ticket, url });
}
```

and change the `personChangeSource` call at the end of `bootstrapRemote`:

```ts
  changes = personChangeSource({
    auth,
    person: async () => (await api.call('session.get', {})).user.id,
    open: liveSourceOf(import.meta.env.VITE_MADAR_LIVE, {
      realtime: (me) => supabaseChangeSource(supabase, me),
      ticket: () => api.call('live.ticket', {}),
      apiUrl: config.apiUrl,
      page: window.location.href,
    }),
  });
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project unit src/api/remote/liveSocket.test.ts src/app/remote/bootstrap.test.ts src/app/remote/channel.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. `channel.test.ts` does not change: the Realtime source stays as it is.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/remote/liveSocket.ts src/api/remote/liveSocket.test.ts src/app/remote/bootstrap.ts src/app/remote/bootstrap.test.ts src/env.d.ts
git commit -m "Exit wave 3: the live socket of the screens with a ping each 30 s, behind VITE_MADAR_LIVE, which no build sets yet"
```

---

### Task 11: The Pages forwarder passes a socket upgrade through

`answerOf` of `server/http/pagesForward.ts` makes a new `Response` from the answer of the Worker, and that copy loses the
`webSocket` of a 101 answer. The forward of the request keeps the `upgrade` header already (it is not in `REQUEST_SKIP`; node 22
keeps it on a `Request`, fact check of this plan). Both copies forward to Supabase today (`config/server-host.json`), so this path
runs only after a copy moves to the Worker; no request of today gets a 101.

**Files:**
- Modify: `server/http/pagesApiProxy.ts` (the binding branch of `proxyApi`)
- Test: `server/http/pagesApiProxy.test.ts`

**Interfaces:**
- Consumes: `bindingOf`, `forwardInit`, `answerOf` (`server/http/pagesForward.ts`).
- Produces: `proxyApi` returns a 101 answer of the binding as it is.

- [ ] **Step 1: Write the failing test**

Add to `server/http/pagesApiProxy.test.ts`:

```ts
  it('gives the socket answer of the Worker back as it is, with the upgrade header passed on (exit wave 3)', async () => {
    const seen: Request[] = [];
    const upgraded = { status: 101, webSocket: {}, headers: new Headers() } as unknown as Response;
    const binding = { fetch: async (request: Request) => (seen.push(request), upgraded) };
    const request = new Request(`https://preview.madar-46r.pages.dev/api/live?ticket=${'a'.repeat(64)}`, { headers: { upgrade: 'websocket' } });
    const answer = await proxyApi(request, { MADAR_SERVER_TEST: binding }, { setting: { test: 'workers', production: 'supabase' } });
    expect(answer).toBe(upgraded);
    expect(seen[0].headers.get('upgrade')).toBe('websocket');
    expect(new URL(seen[0].url).pathname).toBe('/api/live');
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project server server/http/pagesApiProxy.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL: `answerOf` builds a new Response and node refuses the status 101 ("RangeError"), or the answer is not the same object.

- [ ] **Step 3: Write the pass-through**

In `server/http/pagesApiProxy.ts`, in the `if (binding)` branch, replace the `return answerOf(...)` line with:

```ts
    const answer = await binding.fetch(new Request(`${INTERNAL_ORIGIN}${PREFIX}${suffix}${url.search}`, forwardInit(request, headers)));
    // A socket upgrade (GET /api/live, exit wave 3): the 101 answer carries the socket, and a copy of it would lose the socket.
    return answer.status === 101 ? answer : answerOf(answer);
```

and add one line to the file comment: "- A 101 answer of the Worker (the live socket, exit wave 3) goes back as it is."

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/http/pagesApiProxy.test.ts server/http/pagesMcpProxy.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/http/pagesApiProxy.ts server/http/pagesApiProxy.test.ts
git commit -m "Exit wave 3: the Pages forwarder of /api gives a socket upgrade answer of the Worker back as it is"
```

---
# Block C: Effects and jobs on SQLite (Tasks 12 to 14, about 2 days)

Every text in this block keeps its Postgres constant byte for byte and gets a `_LITE` twin beside it. The call site picks one
with `isLite` or `sqlFor` (`server/data/dialect.ts`). The SQLite rules of wave 1 hold: `?N` placeholders, no outer `order by`
except a cut that an index gives, one `=` for one value, a JSON list in one bound value (`json_each`), time as ISO text in UTC,
`json_type(doc, '$.x') = 'true'` for a boolean field. The users, projects, members and conversations tables are office lists on
SQLite: they hold only `id` and `doc`, so a text reads their fields from `doc`, or the code reads the office lists in memory.

### Task 12: The mail quota, the mail and push effects, and the outbox mail on SQLite

**Files:**
- Modify: `server/mail/quota.ts` (`reserve`, `markFirstRefusal`, `sentToday`, `release`, `sendCounted`)
- Modify: `server/mail/notices.ts` (`sendNoticeMail`, `sendQuotaWarning`, `sendWarned`; new `personOfDoc`, `litePerson`, `adminsOf`)
- Modify: `server/mail/outboxDriver.ts`, `server/push/notify.ts` (`sendPushNotify`), `server/usage/warn.ts` (`sendLimitWarning`)
- Test: `server/data/lite/effects.test.ts` (create)

**Interfaces:**
- Consumes: `isLite`, `sqlFor`; `freshLite`, `liteWriteState`; `Deps.pushFetch` (Task 3).
- Produces: `RESERVE_COUNT_LITE`, `RESERVE_ADD_LITE`, `REFUSAL_MARK_LITE`, `SENT_TODAY_LITE`, `RELEASE_LITE`, `RECORD_SENT_LITE`;
  `NOTICE_MAIL_LITE`, `USER_DOC_LITE`, `ADMINS_LITE`, `personOfDoc(doc)`, `litePerson(db, userId)`, `adminsOf(q)`;
  `OUTBOX_INSERT_LITE` (mail); `PUSH_DEVICES_LITE`, `PUSH_SENT_LITE`, `PUSH_GONE_LITE`.

- [ ] **Step 1: Write the failing tests**

Create `server/data/lite/effects.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { sendNoticeMail, sendQuotaWarning } from '../../mail/notices';
import { outboxMailPort } from '../../mail/outboxDriver';
import { QUOTA_LIMITS, markFirstRefusal, release, reserve, sendCounted, sentToday } from '../../mail/quota';
import { MailSendError } from '../../mail/resend';
import { sendPushNotify } from '../../push/notify';
import { makeVapidKeys } from '../../push/vapid';
import type { Config } from '../../core/ports';
import { fakeDeps } from '../../test/fakes/deps';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const NOW = new Date('2026-10-04T06:00:00Z');
const STAMP = '2026-10-04T09:00:00.000+03:00';
const MAIL = (key: string, text = 'H') => ({ to: 'a@madar.test', subject: 'S', html: `<p>${text}</p>`, text, tag: 'notice', idempotencyKey: key });
const PUSH = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

async function office(edit: (seed: State) => void = () => undefined, config: Partial<Config> = {}) {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db, config });
  deps.clock.set(NOW);
  return { ...lite, seed, deps };
}

describe('the mail quota on SQLite (server/mail/quota.ts)', () => {
  it('reserves the places of the day with no lock, keeps the place of a key, and refuses a notice after the limit', async () => {
    const { db } = await freshLite();
    for (let i = 0; i < QUOTA_LIMITS.notice; i += 1) expect(await db.tx('write', (q) => reserve(q, 'notice', `notice-${i}`, { now: NOW }))).toBe('ok');
    expect(await db.tx('write', (q) => reserve(q, 'notice', 'notice-0', { now: NOW }))).toBe('ok');
    expect(await db.tx('write', (q) => reserve(q, 'notice', 'notice-x', { now: NOW }))).toBe('over');
    expect(await db.tx('write', (q) => reserve(q, 'signin', 'invite-1', { now: NOW }))).toBe('ok');
    expect(await db.tx('read', (q) => sentToday(q, { now: NOW }))).toBe(QUOTA_LIMITS.notice + 1);
  });

  it('marks the first refusal of a day once', async () => {
    const { db } = await freshLite();
    expect(await db.tx('write', (q) => markFirstRefusal(q, { now: NOW }))).toBe(true);
    expect(await db.tx('write', (q) => markFirstRefusal(q, { now: NOW }))).toBe(false);
  });

  it('gives back the place of a mail that never went out', async () => {
    const { db } = await freshLite();
    await db.tx('write', (q) => reserve(q, 'notice', 'notice-1', { now: NOW }));
    await db.tx('write', (q) => release(q, 'notice-1'));
    expect(await db.tx('read', (q) => sentToday(q, { now: NOW }))).toBe(0);
  });

  it('records the Resend id of a sent mail, and keeps the place of a mail that failed', async () => {
    const { db, deps } = await office();
    expect(await sendCounted(deps, 'notice', MAIL('notice-1'))).toEqual({ status: 'sent', id: 'mail_1' });
    expect(await db.statement('read', 'select ref, resend_id from mail_log')).toEqual([{ ref: 'notice-1', resend_id: 'mail_1' }]);
    deps.mail.failNext(new Error('Resend is down.'));
    await expect(sendCounted(deps, 'notice', MAIL('notice-2'))).rejects.toThrow('Resend is down.');
    expect(await db.statement('read', "select ref, resend_id from mail_log where ref = 'notice-2'")).toEqual([{ ref: 'notice-2', resend_id: null }]);
  });
});

describe('the mail effects on SQLite (server/mail/notices.ts)', () => {
  const withNotice = (seed: State) => {
    seed.notifications.ntf_901 = { id: 'ntf_901', userId: 'usr_002', trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_001', read: false, createdAt: STAMP, dedupeKey: null };
  };

  it('sends a notice mail to the person of the notice, read from the users doc, and keeps one place for a second run', async () => {
    const { db, seed, deps } = await office(withNotice);
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent.map((m) => [m.to, m.tag, m.idempotencyKey])).toEqual([
      [seed.users.usr_002.email, 'notice', 'notice-ntf_901'], [seed.users.usr_002.email, 'notice', 'notice-ntf_901'],
    ]);
    expect(await db.tx('read', (q) => sentToday(q, { now: NOW }))).toBe(1);
  });

  it('sends no notice mail to a person who is off by now', async () => {
    const { deps } = await office((seed) => {
      withNotice(seed);
      seed.users.usr_002 = { ...seed.users.usr_002, active: false };
    });
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent).toEqual([]);
  });

  it('sends the quota warning only to a person who is still an Admin', async () => {
    const { deps } = await office();
    await sendQuotaWarning({ userId: 'usr_002', day: '2026-10-04' }, deps);
    expect(deps.mail.sent).toEqual([]);
    await sendQuotaWarning({ userId: 'usr_001', day: '2026-10-04' }, deps);
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['quota-warning-2026-10-04-usr_001']);
  });

  it('writes an outbox mail once for a key, and refuses the same key with another mail', async () => {
    const { db } = await freshLite();
    const port = outboxMailPort(db);
    const first = await port.send(MAIL('k1'));
    expect(await port.send(MAIL('k1'))).toEqual(first);
    await expect(port.send(MAIL('k1', 'Other'))).rejects.toBeInstanceOf(MailSendError);
    expect(await db.statement('read', 'select count(*) as n from mail_outbox')).toEqual([{ n: 1 }]);
  });
});

describe('the push effect on SQLite (server/push/notify.ts)', () => {
  it('pushes to each device of an active person with the fetch of deps, marks the sent one and removes the gone one', async () => {
    const keys = await makeVapidKeys();
    const { db, deps } = await office((seed) => {
      seed.pushDevices = {
        pdv_901: { id: 'pdv_901', userId: 'usr_002', endpoint: PUSH('aa'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
        pdv_902: { id: 'pdv_902', userId: 'usr_002', endpoint: PUSH('bb'), label: 'Laptop', createdAt: STAMP, lastPushAt: null },
      };
    }, { push: { ...keys, subject: 'mailto:madar@vado.sa' } });
    const posted: string[] = [];
    deps.pushFetch = (async (input: RequestInfo | URL) => {
      posted.push(String(input));
      return new Response(null, { status: String(input).endsWith('aa') ? 201 : 410 });
    }) as typeof fetch;
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(posted.sort()).toEqual([PUSH('aa'), PUSH('bb')]);
    const rows = await db.statement<{ endpoint: string; doc: { lastPushAt: string | null } }>('read', 'select endpoint, doc from push_devices');
    expect(rows.map((row) => [row.endpoint, typeof row.doc.lastPushAt])).toEqual([[PUSH('aa'), 'string']]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/data/lite/effects.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with the host refusal "Give the caller a SQLite form" (`MAIL_LOCK_SQL`, `NOTICE_MAIL_SQL`, `OUTBOX_INSERT_SQL`,
`PUSH_DEVICES_SQL`).

- [ ] **Step 3: Write the quota on SQLite**

In `server/mail/quota.ts`, add `import { isLite, sqlFor } from '../data/dialect';`, then below `RECORD_SENT_SQL`:

```ts
// SQLite forms (exit wave 3). The office object runs one request at a time, so the mail lock goes: one count, then one insert.
// The day always comes from the caller's clock (UTC text): SQLite has no "now" of the database here.
export const RESERVE_COUNT_LITE = `select count(*) filter (where ${SENDING}) as n, coalesce(max(ref = ?2), 0) as mine from mail_log where utc_day = ?1`;
export const RESERVE_ADD_LITE = 'insert into mail_log (utc_day, kind, user_id, ref) values (?1, ?2, ?3, ?4)';
export const REFUSAL_MARK_LITE = "insert into mail_log (utc_day, kind, ref) values (?1, 'refused', 'quota-refused') on conflict (utc_day, ref) do nothing returning id";
export const SENT_TODAY_LITE = `select count(*) as n from mail_log where utc_day = ?1 and ${SENDING}`;
export const RELEASE_LITE = `delete from mail_log where ref = ?1 and resend_id is null and ${SENDING}`;
export const RECORD_SENT_LITE = 'update mail_log set resend_id = ?3 where utc_day = ?1 and ref = ?2';

/** The UTC day of a SQLite statement: the one given, or the day of now. */
const liteDay = (o: DayOption): string => utcDay(o.now ?? new Date());
```

Change the four functions and the record of `sendCounted`:

```ts
export async function reserve(q: Query, kind: QuotaKind, ref: string, o: DayOption & { userId?: string } = {}): Promise<'ok' | 'over'> {
  if (isLite(q)) {
    const day = liteDay(o);
    const [row] = await q<{ n: number; mine: number }>(RESERVE_COUNT_LITE, [day, ref]);
    if (Number(row?.mine ?? 0) === 1) return 'ok';
    if (Number(row?.n ?? 0) >= QUOTA_LIMITS[kind]) return 'over';
    await q(RESERVE_ADD_LITE, [day, kind, o.userId ?? null, ref]);
    return 'ok';
  }
  await q(MAIL_LOCK_SQL, [...MAIL_LOCK_KEY]);
  const [row] = await q<{ ok: boolean }>(RESERVE_SQL, [dayOf(o), kind, o.userId ?? null, ref, QUOTA_LIMITS[kind]]);
  return row?.ok ? 'ok' : 'over';
}

export async function release(q: Query, ref: string): Promise<void> {
  await q(sqlFor(q, RELEASE_SQL, RELEASE_LITE), [ref]);
}

export async function markFirstRefusal(q: Query, o: DayOption = {}): Promise<boolean> {
  return (await q(sqlFor(q, REFUSAL_MARK_SQL, REFUSAL_MARK_LITE), [isLite(q) ? liteDay(o) : dayOf(o)])).length > 0;
}

export async function sentToday(q: Query, o: DayOption = {}): Promise<number> {
  const [row] = await q<{ n: number }>(sqlFor(q, SENT_TODAY_SQL, SENT_TODAY_LITE), [isLite(q) ? liteDay(o) : dayOf(o)]);
  return Number(row?.n ?? 0);
}
```

and in `sendCounted`:

```ts
  await deps.db.statement('write', sqlFor(deps.db, RECORD_SENT_SQL, RECORD_SENT_LITE), [utcDay(now), ref, id]);
```

- [ ] **Step 4: Write the person reads and the mail effects on SQLite**

In `server/mail/notices.ts`, add `import { isLite } from '../data/dialect';` (Task 2 added it) and `import type { Db } from '../core/ports';`
(beside `Deps`), then below `ADMIN_MAIL_SQL`:

```ts
// SQLite forms (exit wave 3): the users table holds id and doc only, so the person fields come from doc.
export const NOTICE_MAIL_LITE = "select n.id as id, json_extract(n.doc, '$.trigger') as trigger, u.doc as doc from notifications n join users u on u.id = n.user_id where n.id = ?1";
export const USER_DOC_LITE = 'select doc from users where id = ?1';
export const ADMINS_LITE = "select rowid as ord, id from users where json_extract(doc, '$.kind') = 'human' and json_type(doc, '$.active') = 'true' and json_extract(doc, '$.systemRole') = 'admin'";

type UserDoc = { id: string; kind: string; active?: boolean; email: string; preferences: Preferences; gender?: Gender | null; systemRole?: string };

/** The row of USER_MAIL_SQL and ADMIN_MAIL_SQL, made from a users doc. */
export function personOfDoc(doc: UserDoc): PersonRow & { system_role: string | null } {
  return { user_id: doc.id, kind: doc.kind, active: doc.active === true, email: doc.email, preferences: doc.preferences, gender: doc.gender ?? null, system_role: doc.systemRole ?? null };
}

/** The person of one user id on SQLite, as at most one row: the shape of a statement answer. */
export async function litePerson(db: Db, userId: string): Promise<(PersonRow & { system_role: string | null })[]> {
  return (await db.statement<{ doc: UserDoc }>('read', USER_DOC_LITE, [userId])).map((row) => personOfDoc(row.doc));
}

/** Every active Admin, oldest first (ADMINS_SQL), on both databases. */
export async function adminsOf(q: Query): Promise<{ id: string }[]> {
  if (!isLite(q)) return q<{ id: string }>(ADMINS_SQL);
  return (await q<{ ord: number; id: string }>(ADMINS_LITE)).sort((a, b) => a.ord - b.ord).map((row) => ({ id: row.id }));
}

async function liteNotice(db: Db, id: string): Promise<NoticeRow[]> {
  const rows = await db.statement<{ id: string; trigger: Trigger; doc: UserDoc }>('read', NOTICE_MAIL_LITE, [id]);
  return rows.map((row) => ({ ...personOfDoc(row.doc), id: row.id, trigger: row.trigger }));
}
```

Then change three lines:

```ts
// in sendWarned, onFirstRefusal:
      const admins = await adminsOf(q);
// in sendNoticeMail:
  const [notice] = isLite(deps.db) ? await liteNotice(deps.db, id) : await deps.db.statement<NoticeRow>('write', NOTICE_MAIL_SQL, [id]);
// in sendQuotaWarning:
  const [person] = isLite(deps.db) ? await litePerson(deps.db, userId) : await deps.db.statement<PersonRow & { system_role: string | null }>('write', ADMIN_MAIL_SQL, [userId]);
```

In `server/usage/warn.ts`, import `litePerson` from `../mail/notices` and `isLite` from `../data/dialect`, and change the read in
`sendLimitWarning`:

```ts
  const [person] = isLite(deps.db) ? await litePerson(deps.db, userId) : await deps.db.statement<PersonRow & { system_role: string | null }>('write', ADMIN_MAIL_SQL, [userId]);
```

- [ ] **Step 5: Write the outbox mail and the push effect on SQLite**

In `server/mail/outboxDriver.ts`, add `import { sqlFor } from '../data/dialect';`, the SQLite text, and pick it:

```ts
/** SQLite (exit wave 3): the same rules; "same" compares the stored JSON text with the new one (1 or 0). */
export const OUTBOX_INSERT_LITE = `insert into mail_outbox (to_email, tag, idempotency_key, mail) values (?1, ?2, ?3, ?4)
on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
returning id, mail = ?4 as same`;
```

```ts
      const [row] = await db.statement<{ id: string | number; same: boolean | number }>('write', sqlFor(db, OUTBOX_INSERT_SQL, OUTBOX_INSERT_LITE), [mail.to, mail.tag, mail.idempotencyKey, JSON.stringify(mail)]);
```

In `server/push/notify.ts`, below `PUSH_GONE_SQL`:

```ts
// SQLite forms (exit wave 3). The person of a device is read from the users doc; a list of endpoints goes one statement each.
export const PUSH_DEVICES_LITE = 'select d.rowid as ord, d.endpoint as endpoint, u.doc as doc from push_devices d join users u on u.id = d.user_id where d.user_id = ?1';
export const PUSH_SENT_LITE = "update push_devices set doc = json_set(doc, '$.lastPushAt', ?2) where endpoint = ?1";
export const PUSH_GONE_LITE = 'delete from push_devices where endpoint = ?1';

/** The push addresses of an active human, oldest device first, on both databases. */
async function devicesOf(deps: Deps, userId: string): Promise<{ endpoint: string }[]> {
  if (!isLite(deps.db)) return deps.db.statement<{ endpoint: string }>('write', PUSH_DEVICES_SQL, [userId]);
  const rows = await deps.db.statement<{ ord: number; endpoint: string; doc: { kind?: string; active?: boolean } }>('read', PUSH_DEVICES_LITE, [userId]);
  return rows.filter((row) => row.doc.kind === 'human' && row.doc.active === true).sort((a, b) => a.ord - b.ord).map((row) => ({ endpoint: row.endpoint }));
}
```

and change `sendPushNotify`: the device read, the fetch of each push, and the two writes:

```ts
  const devices = await devicesOf(deps, userId);
```

```ts
      const outcome = await sendPush(config, endpoint, { now: () => deps.clock.now(), ...(deps.pushFetch ? { fetch: deps.pushFetch } : {}) });
```

```ts
  if (sent.length > 0) {
    if (isLite(deps.db)) for (const endpoint of sent.sort()) await deps.db.statement('write', PUSH_SENT_LITE, [endpoint, nowStamp(deps.clock.now())]);
    else await deps.db.statement('write', PUSH_SENT_SQL, [sent.sort(), nowStamp(deps.clock.now())]);
  }
  if (gone.length > 0) {
    if (isLite(deps.db)) for (const endpoint of gone.sort()) await deps.db.statement('write', PUSH_GONE_LITE, [endpoint]);
    else await deps.db.statement('write', PUSH_GONE_SQL, [gone.sort()]);
  }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run --project server server/data/lite/effects.test.ts server/mail server/push server/usage/warn.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The Postgres tests of `server/mail`, `server/push` and `warn.test.ts` do not change (`memoryMailDb` still gets the
same Postgres texts).

- [ ] **Step 7: Commit**

```bash
git add server/mail/quota.ts server/mail/notices.ts server/mail/outboxDriver.ts server/push/notify.ts server/usage/warn.ts server/data/lite/effects.test.ts
git commit -m "Exit wave 3: the mail quota, the mail and push effects and the outbox mail on SQLite"
```

---

### Task 13: The job steps on SQLite, and the Cron path of the office object

The 15-minute job runs on pg_cron and the Supabase jobs function today, on both copies (server/CLAUDE.md, "Realtime, jobs,
usage"). This task gives every step a SQLite form and adds the Cron path: a Cron Trigger on the Worker, one office object call,
the steps inside it, the network through the port. The Cron does nothing on a Worker without `MADAR_DATA = "office"`, so a deploy
of this code adds a Cron run of the test Worker that returns at once (Workers Free: 5 Cron Triggers for each account, 10 ms of CPU
for each Cron run; Cron Triggers run in UTC; Workers limits and Cron Triggers pages, read 2026-10-17).

**Files:**
- Modify: `server/jobs/steps/heartbeat.ts`, `server/jobs/steps/triggers.ts`, `server/jobs/steps/summary.ts`, `server/jobs/steps/outbox.ts`,
  `server/jobs/steps/cleanup.ts`, `server/jobs/steps/uploads.ts`, `server/mail/summary.ts`
- Create: `server/office/jobs.ts`
- Modify: `server/office/parts.ts` (`cron`), `server/office/office.ts` (`cron`), `server/entries/officeWorker.ts` (`OfficeStub.cron`,
  `scheduled`), `server/entries/officeEntry.ts` (`scheduled`), `server/entries/workerMain.ts` (`scheduled`)
- Modify: `wrangler.server.toml` (`[triggers]`, `[env.production.triggers]`), `server/office/test/live/wrangler.toml` (`[triggers]`),
  `server/office/test/live/entry.ts` (`scheduled`)
- Test: `server/jobs/steps/lite.test.ts` (create), `server/office/parts.test.ts`, `server/entries/officeWorker.test.ts`,
  `scripts/deploy/wranglerServer.test.ts`

**Interfaces:**
- Consumes: `runJob`, `JOB_STEPS` (`server/jobs/run.ts`); `liteSource`, `liteSave`, `readLiteOffice`, `liteDbOf` (wave 1);
  `reviewersOfTask` (`src/api/notify.ts`); `litePerson` (Task 12); `DAY_ROW_LITE` (Task 4); `sweep` (Task 5).
- Produces: `HEARTBEAT_LITE`, `USED_DEDUPE_LITE`, `SUMMARY_DONE_LITE`, `SUMMARY_MARK_LITE`, `SUMMARY_SENT_LITE`, `SUMMARY_PEOPLE_LITE`,
  `SUMMARY_DUE_LITE`, `SUMMARY_REVIEW_LITE`, `OUTBOX_DUE_LITE`, the three `*_CLEANUP_LITE` (stories, idempotency, rate_limits), `OLD_INTENTS_LITE`, `INTENTS_DELETE_LITE`;
  `HOURLY_STEPS`, `officeSteps(at)`, `runOfficeJobs(deps, at)`; `OfficeCronInput = { at: string; worker: number }`,
  `OfficeCronReport = JobReport & { closed: number; day: DayRow | null }`, `OfficeParts.cron`, `Office.cron`,
  `OfficeStub.cron`, `officeRoutes(o).scheduled(at, env)`, `officeEntry().scheduled(at, env)`.

- [ ] **Step 1: Write the failing tests of the steps**

Create `server/jobs/steps/lite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// The mail and push handlers of the outbox: the entries register them through server/core/deps.ts, this test on its own.
import '../../mail/effects';
import '../../push/effects';
import { reviewersOfTask } from '../../../src/api/notify';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { freshLite } from '../../data/lite/testDb';
import { liteWriteState } from '../../data/lite/whole';
import { stagingKey, uploadKey } from '../../files/keys';
import { officeSteps } from '../../office/jobs';
import { fakeDeps } from '../../test/fakes/deps';
import { cleanup } from './cleanup';
import { heartbeat } from './heartbeat';
import { outboxRetry } from './outbox';
import { summary } from './summary';
import { triggers } from './triggers';
import { uploads } from './uploads';

const DAY = '2026-10-04';
/** 08:00 Riyadh on a Sunday: after the 07:30 summary, and the reminders of the sample office are due (5 notices). */
const AT = new Date('2026-10-04T05:00:00Z');

async function office(edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed(DAY, async () => undefined);
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(AT);
  return { ...lite, seed, deps };
}

const mailOn = (seed: State) => {
  const prefs = seed.users.usr_002.preferences;
  seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...prefs, email: { ...prefs.email, due_tomorrow: true, overdue: true } } };
};

describe('the 15-minute job on SQLite (server/jobs/steps)', () => {
  it('writes the heartbeat, and a run that overlaps never moves it back', async () => {
    const { db, deps } = await office();
    await heartbeat(deps, AT);
    await heartbeat(deps, new Date(AT.getTime() - 60_000));
    expect(await db.statement('read', "select done_at from job_runs where key = 'heartbeat'")).toEqual([{ done_at: AT.toISOString() }]);
  });

  it('writes the reminders once, mails the person who takes them, and writes nothing in a second run', async () => {
    const { db, deps } = await office(mailOn);
    const first = await triggers(deps, AT);
    expect(first.notices).toBe(5);
    expect(deps.mail.sent.length).toBeGreaterThan(0);
    expect(deps.mail.sent.every((m) => m.tag === 'notice')).toBe(true);
    const notices = await db.statement('read', 'select count(*) as n from notifications');
    expect(await triggers(deps, AT)).toEqual({ notices: 0, mails: 0 });
    expect(await db.statement('read', 'select count(*) as n from notifications')).toEqual(notices);
  });

  it('sends the morning summary to each person with something to say, marks the day, and sends nothing in a second run', async () => {
    const { seed, deps } = await office();
    // The rule of SUMMARY_COUNTS_SQL on the State: a task due today that the person leads or helps with, or a review that waits.
    const active = (projectId: string | null) => projectId === null || seed.projects[projectId]?.status === 'active';
    const says = (id: string) => Object.values(seed.tasks).some((t) =>
      (t.dueDate === DAY && (t.status === 'todo' || t.status === 'in_progress') && active(t.projectId) && (t.ownerId === id || (t.helperIds ?? []).includes(id)))
      || (t.status === 'in_review' && active(t.projectId) && reviewersOfTask(seed, t).includes(id)));
    const expected = Object.values(seed.users)
      .filter((u) => u.kind === 'human' && u.active && (u.preferences.morningSummary ?? true) && says(u.id))
      .map((u) => `summary-${DAY}-${u.id}`).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(await summary(deps, AT)).toMatchObject({ due: true, day: DAY, sent: expected.length });
    expect(deps.mail.sent.map((m) => m.idempotencyKey).sort()).toEqual(expected);
    expect(await summary(deps, AT)).toEqual({ due: true, day: DAY, done: true });
  });

  it('takes only the outbox rows that are old, open and not claimed', async () => {
    const { db, deps } = await office();
    const old = new Date(AT.getTime() - 10 * 60_000).toISOString();
    await db.statement('write', "insert into outbox (kind, payload, created_at) values ('test.none', '{}', ?1), ('test.none', '{}', ?2)", [old, AT.toISOString()]);
    expect(await outboxRetry(deps)).toEqual({ due: 1, done: 0, failed: 1 });
  });

  it('removes old stories, keys and rate limit windows, and keeps new ones', async () => {
    const { db, deps } = await office();
    const old = new Date(AT.getTime() - 8 * 86_400_000).toISOString();
    await db.statement('write', "insert into stories (id, actor_id, created_at) values ('sty_old', 'usr_001', ?1), ('sty_new', 'usr_001', ?2)", [old, AT.toISOString()]);
    await db.statement('write', "insert into idempotency (actor_id, key, name, digest, result, created_at) values ('usr_001', 'k', 'n', 'd', '{}', ?1)", [old]);
    await db.statement('write', "insert into rate_limits (key, window_start, count) values ('forgot:x', ?1, 1)", [old]);
    expect(await cleanup(deps, AT)).toEqual({ stories: 1, idempotency: 1, officeDeletes: 0, rateLimits: 1 });
    expect(await db.statement('read', 'select id from stories')).toEqual([{ id: 'sty_new' }]);
  });

  it('removes the staging objects of old intents through the files port, and deletes the rows after a day', async () => {
    const { db, deps } = await office();
    const old = new Date(AT.getTime() - 25 * 3_600_000).toISOString();
    const staging = stagingKey('upl_old');
    const final = uploadKey('prj_001', 'upl_old');
    await db.statement('write', 'insert into upload_intents (id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at, created_at) values (?1, ?2, ?3, ?4, ?5, null, 10, ?6, ?7, null, ?8)',
      ['upl_old', 'usr_001', 'prj_001', staging, final, 'image/png', old, old]);
    expect(await uploads(deps, AT)).toEqual({ intents: 1, removed: 3, deleted: 1 });
    // fakeFiles records one remove with its keys joined: the staging file, its picture, then the copy that no record uses.
    expect(deps.files.calls.filter((c) => c.op === 'remove').map((c) => c.key)).toEqual([[staging, staging.replace(/\/file$/, '/thumb'), final].join(',')]);
  });

  it('runs the usage step in the first run of each hour only', () => {
    expect(officeSteps(new Date('2026-10-04T05:00:00Z')).map((s) => s.name)).toContain('usage');
    expect(officeSteps(new Date('2026-10-04T05:15:00Z')).map((s) => s.name)).not.toContain('usage');
  });
});
```

- [ ] **Step 2: Write the failing tests of the Cron path**

Add to `server/office/parts.test.ts` (inside the first `describe`, with `CLOSE_STALE` added to the import from `./live`):

```ts
  it('runs the job steps on a Cron call, adds the meter counts, and closes a stale socket', async () => {
    const { parts, sockets, raw, net } = await office();
    const stale = openFor(sockets, 'usr_002', Date.parse(NOW) - 10 * 60_000);
    const report = await parts.cron({ at: NOW, worker: 2 }, net);
    expect(report.steps.map((s) => s.name)).toEqual(['heartbeat', 'triggers', 'summary', 'outbox', 'cleanup', 'uploads', 'usage']);
    // The reminders of the run send signals, and each delivery sweeps first: that sweep or the one of the Cron closes the socket.
    expect(stale.closed?.code).toBe(CLOSE_STALE);
    expect(raw.prepare("select done_at from job_runs where key = 'heartbeat'").get()).toEqual({ done_at: NOW });
    expect(report.day).toMatchObject({ requests: 1, worker_requests: 2 });
  });
```

Add to `server/entries/officeWorker.test.ts` (the stub of `setup` gets `cron: async (input, net) => (seen.cron.push({ ...input, net }),
{ ok: true, at: input.at, steps: [], closed: 0, day: null })`, and `seen` gets `cron: [] as unknown[]`):

```ts
  it('gives a Cron run to the office object with the requests it saw, and the network port', async () => {
    const { seen, routes, get, net } = setup();
    await get('/api/nothing');
    const at = new Date('2026-10-04T05:00:00Z');
    expect(await routes.scheduled(at, {})).toMatchObject({ ok: true });
    expect(seen.cron).toEqual([{ at: at.toISOString(), worker: 2, net }]);
  });
```

Add to `scripts/deploy/wranglerServer.test.ts`, inside its office `describe`:

```ts
  it('runs the 15-minute Cron on local runs and on the test Worker, and none on production', () => {
    expect(read().triggers.crons).toEqual(['*/15 * * * *']);
    expect(read('test').triggers.crons).toEqual(['*/15 * * * *']);
    expect(read('production').triggers.crons).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --project server server/jobs/steps/lite.test.ts server/office/parts.test.ts server/entries/officeWorker.test.ts scripts/deploy/wranglerServer.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL: the steps meet the host refusal of their Postgres texts; `parts.cron`, `routes.scheduled` and `office/jobs.ts`
do not exist; the config has no triggers.

- [ ] **Step 4: Write the SQLite forms of the steps**

`server/jobs/steps/heartbeat.ts`:

```ts
/** SQLite (exit wave 3): max() of two ISO texts in UTC is the later time. */
export const HEARTBEAT_LITE =
  "insert into job_runs (key, done_at) values ('heartbeat', ?1) on conflict (key) do update set done_at = max(job_runs.done_at, excluded.done_at)";

export async function heartbeat(deps: Pick<Deps, 'db'>, at: Date): Promise<{ at: string }> {
  await deps.db.statement('write', sqlFor(deps.db, HEARTBEAT_SQL, HEARTBEAT_LITE), [at]);
  return { at: at.toISOString() };
}
```

(with `import { sqlFor } from '../../data/dialect';`).

`server/jobs/steps/triggers.ts`: add the imports

```ts
import { isLite, sqlFor } from '../../data/dialect';
import { liteDbOf } from '../../data/lite/db';
import { readLiteOffice } from '../../data/lite/office';
import { liteSave } from '../../data/lite/save';
import { liteSource } from '../../data/lite/source';
```

the text and the dedupe read:

```ts
/** SQLite (exit wave 3): one bound list; "is not null" lets the partial index notifications_dedupe serve the read. */
export const USED_DEDUPE_LITE = 'select dedupe_key from notifications where dedupe_key in (select value from json_each(?1)) and dedupe_key is not null';
```

```ts
  const rows = await q<{ dedupe_key: string }>(sqlFor(q, USED_DEDUPE_SQL, USED_DEDUPE_LITE), [[...asked].sort()]);
```

and inside `triggers`, three lines pick the SQLite parts:

```ts
      const office = isLite(q) ? await readLiteOffice(liteDbOf(q), q) : await readOffice(deps, q);
      const state = await loadJobs({ src: isLite(q) ? liteSource(q) : sqlSource(q, { bytes: (n) => deps.meter.addBytes(n) }), office });
```

```ts
      const saved = isLite(q) ? await liteSave(q, before, state) : await save(q, before, state);
```

`server/jobs/steps/summary.ts`: add `import { isLite, sqlFor } from '../../data/dialect';`, the texts below their Postgres twins,
and pick them at the three statements:

```ts
// SQLite forms (exit wave 3).
export const SUMMARY_DONE_LITE = 'select done_at from job_runs where key = ?1';
export const SUMMARY_MARK_LITE = 'insert into job_runs (key, done_at) values (?1, ?2) on conflict (key) do nothing';
export const SUMMARY_SENT_LITE = 'select ref from mail_log where ref in (select value from json_each(?1)) and resend_id is not null';
```

```ts
  if ((await deps.db.statement('write', sqlFor(deps.db, SUMMARY_DONE_SQL, SUMMARY_DONE_LITE), [key])).length > 0) return { due: true, day, done: true };
```

```ts
    (await deps.db.statement<{ ref: string }>('write', sqlFor(deps.db, SUMMARY_SENT_SQL, SUMMARY_SENT_LITE), [people.map((id) => refOf(day, id))])).map((row) => row.ref),
```

```ts
  await deps.db.statement('write', sqlFor(deps.db, SUMMARY_MARK_SQL, SUMMARY_MARK_LITE), [key, at]);
```

`server/mail/summary.ts`: add the imports

```ts
import type { Task } from '../../src/api/contract/entities';
import { reviewersOfTask } from '../../src/api/notify';
import type { State } from '../../src/api/store';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import { litePerson } from './notices';
```

the texts, and the SQLite branches of the three functions:

```ts
// SQLite forms (exit wave 3). The users and projects tables hold only id and doc: the people come from doc, and the counts are
// worked out in JavaScript on the office lists in memory with the rules of the screens (reviewersOfTask), as SUMMARY_COUNTS_SQL does.
export const SUMMARY_PEOPLE_LITE =
  "select rowid as ord, id from users where json_extract(doc, '$.kind') = 'human' and json_type(doc, '$.active') = 'true' "
  + "and coalesce(json_type(doc, '$.preferences.morningSummary'), 'null') in ('true', 'null')";
export const SUMMARY_DUE_LITE = "select doc, project_id from tasks where due_date = ?1 and status in ('todo', 'in_progress')";
export const SUMMARY_REVIEW_LITE = "select doc from tasks where status = 'in_review'";

async function liteSummary(q: Query, userId: string, today: string): Promise<Summary> {
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const active = (projectId: string | null) => projectId === null || lists.projects[projectId]?.status === 'active';
  const state = lists as unknown as State;
  const due = await q<{ doc: Task; project_id: string | null }>(SUMMARY_DUE_LITE, [today]);
  const review = await q<{ doc: Task }>(SUMMARY_REVIEW_LITE);
  return {
    dueToday: due.filter((row) => active(row.project_id) && (row.doc.ownerId === userId || (row.doc.helperIds ?? []).includes(userId))).length,
    reviewsWaiting: review.filter((row) => active(row.doc.projectId) && reviewersOfTask(state, row.doc).includes(userId)).length,
  };
}
```

```ts
export async function buildSummary(q: Query, user: { id: string }, today: string): Promise<Summary | null> {
  if (isLite(q)) {
    const summary = await liteSummary(q, user.id, today);
    return summary.dueToday > 0 || summary.reviewsWaiting > 0 ? summary : null;
  }
  const [row] = await q<{ due_today: number; reviews_waiting: number }>(SUMMARY_COUNTS_SQL, [user.id, today]);
  const summary = { dueToday: Number(row?.due_today ?? 0), reviewsWaiting: Number(row?.reviews_waiting ?? 0) };
  return summary.dueToday > 0 || summary.reviewsWaiting > 0 ? summary : null;
}

export async function summaryPeople(q: Query): Promise<string[]> {
  if (isLite(q)) return (await q<{ ord: number; id: string }>(SUMMARY_PEOPLE_LITE)).sort((a, b) => a.ord - b.ord).map((row) => row.id);
  return (await q<{ id: string }>(SUMMARY_PEOPLE_SQL)).map((row) => row.id);
}
```

and in `sendSummary`:

```ts
  const [person] = isLite(deps.db) ? await litePerson(deps.db, userId) : await deps.db.statement<PersonRow>('read', USER_MAIL_SQL, [userId]);
```

`server/jobs/steps/outbox.ts`:

```ts
/** SQLite (exit wave 3): the times come from the clock. id is the rowid, so "order by id" is the table order with no sort step. */
export const OUTBOX_DUE_LITE =
  'select id from outbox where done_at is null and attempts < ?1 and created_at < ?3 and (claimed_until is null or claimed_until < ?4) order by id limit ?2';

export async function outboxRetry(deps: Deps): Promise<{ due: number; done: number; failed: number }> {
  const now = deps.clock.now();
  const rows = isLite(deps.db)
    ? await deps.db.statement<{ id: string | number }>('write', OUTBOX_DUE_LITE, [OUTBOX_MAX_ATTEMPTS, OUTBOX_BATCH, new Date(now.getTime() - 2 * 60_000).toISOString(), now.toISOString()])
    : await deps.db.statement<{ id: string | number }>('write', OUTBOX_DUE_SQL, [OUTBOX_MAX_ATTEMPTS, OUTBOX_BATCH]);
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return { due: 0, done: 0, failed: 0 };
  const result = await processOutbox(deps, ids);
  return { due: ids.length, done: result.done.length, failed: result.failed.length };
}
```

(with `import { isLite } from '../../data/dialect';`).

`server/jobs/steps/cleanup.ts`:

```ts
/** SQLite (exit wave 3): no data change inside a with clause, so the delete gives back its rows and the code counts them. */
const deletingLite = (from: string, column: string) => `delete from ${from} where ${column} < ?1 returning 1 as n`;
export const STORIES_CLEANUP_LITE = deletingLite('stories', 'created_at');
export const IDEMPOTENCY_CLEANUP_LITE = deletingLite('idempotency', 'created_at');
export const RATE_LIMITS_CLEANUP_LITE = deletingLite('rate_limits', 'window_start');

export async function cleanup(deps: Pick<Deps, 'db'>, at: Date): Promise<CleanupResult> {
  const before = (ms: number) => new Date(at.getTime() - ms);
  if (isLite(deps.db)) {
    // The office object keeps no office_deletes: its office lists follow each commit in memory (wave 1).
    return deps.db.tx('write', async (q) => ({
      stories: (await q(STORIES_CLEANUP_LITE, [before(STORY_KEEP_MS)])).length,
      idempotency: (await q(IDEMPOTENCY_CLEANUP_LITE, [before(IDEMPOTENCY_KEEP_MS)])).length,
      officeDeletes: 0,
      rateLimits: (await q(RATE_LIMITS_CLEANUP_LITE, [before(RATE_LIMIT_KEEP_MS)])).length,
    }));
  }
  return deps.db.tx('write', async (q) => ({
    stories: await count(q, STORIES_CLEANUP_SQL, before(STORY_KEEP_MS)),
    idempotency: await count(q, IDEMPOTENCY_CLEANUP_SQL, before(IDEMPOTENCY_KEEP_MS)),
    officeDeletes: await count(q, OFFICE_DELETES_CLEANUP_SQL, before(OFFICE_DELETES_KEEP_DAYS * DAY)),
    rateLimits: await count(q, RATE_LIMITS_CLEANUP_SQL, before(RATE_LIMIT_KEEP_MS)),
  }));
}
```

(with `import { isLite } from '../../data/dialect';`).

`server/jobs/steps/uploads.ts`: add `import { sqlFor } from '../../data/dialect';`, the texts, and pick them at the two statements:

```ts
// SQLite forms (exit wave 3). "order by id limit" pages on the key index of the text primary key: a cut order, no sort step.
export const OLD_INTENTS_LITE =
  'select id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at, created_at from upload_intents '
  + 'where created_at <= ?1 and id > ?2 order by id limit ?3';
export const INTENTS_DELETE_LITE =
  'delete from upload_intents where id in (select value from json_each(?1)) and coalesce(used_at, created_at) < ?2 returning id';
```

```ts
    const rows = await deps.db.statement('write', sqlFor(deps.db, OLD_INTENTS_SQL, OLD_INTENTS_LITE), [stagingCutoff, after, UPLOADS_BATCH]);
```

```ts
  const deleted = old.length > 0 ? (await deps.db.statement('write', sqlFor(deps.db, INTENTS_DELETE_SQL, INTENTS_DELETE_LITE), [old, keepCutoff])).length : 0;
```

- [ ] **Step 5: Write the Cron path**

Create `server/office/jobs.ts`:

```ts
import type { Deps } from '../core/ports';
import { JOB_STEPS, runJob, type JobReport, type JobStep } from '../jobs/run';

/**
 * The 15-minute job of the office object (exit wave 3): the steps of server/jobs/run.ts, in the same order, on the SQLite Db.
 * The usage step reads the size of every file version (no index helps; map of writes, section 18), so it runs only in the first
 * run of each hour: 24 runs a day in place of 96.
 */
export const HOURLY_STEPS: ReadonlySet<string> = new Set(['usage']);

export function officeSteps(at: Date): readonly JobStep[] {
  return JOB_STEPS.filter((step) => !HOURLY_STEPS.has(step.name) || at.getUTCMinutes() < 15);
}

export function runOfficeJobs(deps: Deps, at: Date): Promise<JobReport> {
  return runJob(deps, at, officeSteps(at));
}
```

In `server/office/parts.ts`, add the imports and types:

```ts
import type { JobReport } from '../jobs/run';
import { utcDay } from '../mail/quota';
import { runOfficeJobs } from './jobs';
import { DAY_ROW_LITE } from './meter';
```

and add `sweep` to the import from `./live`:

```ts
import { LIVE_PING, LIVE_PONG, LIVE_STALE_MS, LiveTickets, acceptLive, closeOff, liveSignals, sweep, type LiveSocket, type Sockets } from './live';
```

and the types:

```ts
export type OfficeCronInput = { at: string; worker: number };
export type DayRow = { rows_read: number; rows_written: number; requests: number; calls: number; worker_requests: number };
export type OfficeCronReport = JobReport & { closed: number; day: DayRow | null };
```

add `cron(input: OfficeCronInput, net: NetApi): Promise<OfficeCronReport>;` to `OfficeParts`, and to the returned object:

```ts
    async cron(input, net) {
      meter.request({ worker: input.worker });
      const at = new Date(input.at);
      // One Deps, so the whole run shares one network budget: one Cron run is one Worker invocation (50 subrequests on Free).
      const deps = depsFor(net);
      const report = await runOfficeJobs(deps, at);
      await db.tx('write', (q) => meter.flush(q, at));
      const closed = sweep(o.sockets, clock.now(), staleMs);
      const [day] = await db.statement<DayRow>('read', DAY_ROW_LITE, [utcDay(at)]);
      return { ...report, closed, day: day ?? null };
    },
```

In `server/office/office.ts`, import `OfficeCronInput` and `OfficeCronReport` from `./parts` and add:

```ts
  cron(input: OfficeCronInput, net: NetApi): Promise<OfficeCronReport> {
    return this.parts.cron(input, net);
  }
```

In `server/entries/officeWorker.ts`, import `OfficeCronInput` and `OfficeCronReport` from `../office/parts`, add
`cron(input: OfficeCronInput, net: NetApi): Promise<OfficeCronReport>;` to `OfficeStub`, and add to the returned object of
`officeRoutes`:

```ts
    /** One Cron run: the whole job in one office object call. The report goes to the log, where wave 5 reads the day meters. */
    async scheduled(at: Date, env: Env): Promise<OfficeCronReport | undefined> {
      seen += 1;
      try {
        const report = await o.stub(env).cron({ at: at.toISOString(), worker: reported() }, o.net());
        log.info('The office jobs ran.', { ok: report.ok, failed: report.steps.filter((step) => !step.ok).map((step) => step.name), closed: report.closed, day: report.day });
        return report;
      } catch (error) {
        log.error('The office jobs did not run. The next run tries again.', { error: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
    },
```

In `server/entries/officeEntry.ts`, add to the returned object:

```ts
    async scheduled(at: Date, env: Env): Promise<void> {
      setEnvSource(env);
      await start().scheduled(at, env);
    },
```

In `server/entries/workerMain.ts`, add to the default export:

```ts
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: Ctx): Promise<void> {
    // Until a copy moves to its office object (wave 5), the Supabase jobs function runs the 15-minute job of every copy: here a
    // Cron run of a Worker without MADAR_DATA = "office" returns at once, with no object call and no network call.
    if (!onOffice(env)) return;
    ctx.waitUntil(office.scheduled(new Date(controller.scheduledTime), env));
  },
```

In `wrangler.server.toml`, after the top-level `[[migrations]]` block:

```toml
# The 15-minute job of the office object (wave 3), in UTC. scheduled() returns at once while MADAR_DATA is not "office", so on the
# test Worker it does nothing before wave 5. It takes 1 of the 5 Cron Triggers of the account (Workers Free).
[triggers]
crons = ["*/15 * * * *"]
```

and after the `[env.production]` table (before `[env.production.placement]`):

```toml
[env.production.triggers]
crons = []
```

In `server/office/test/live/wrangler.toml`, add the same top-level `[triggers]` block, and in `server/office/test/live/entry.ts`
add to the default export:

```ts
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: Ctx): Promise<void> {
    setEnvSource(env);
    ctx.waitUntil(routes.scheduled(new Date(controller.scheduledTime), env));
  },
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run --project server server/jobs server/mail/summary.test.ts server/office/parts.test.ts server/entries/officeWorker.test.ts scripts/deploy/wranglerServer.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The Postgres step tests (`server/jobs/steps/steps.test.ts`, `server/jobs/run.test.ts`) do not change.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/jobs/steps server/mail/summary.ts server/office/jobs.ts server/office/parts.ts server/office/parts.test.ts server/office/office.ts \
  server/entries/officeWorker.ts server/entries/officeWorker.test.ts server/entries/officeEntry.ts server/entries/workerMain.ts \
  wrangler.server.toml scripts/deploy/wranglerServer.test.ts server/office/test/live/wrangler.toml server/office/test/live/entry.ts
git commit -m "Exit wave 3: the job steps on SQLite, and the 15-minute Cron of the office object, off on every deployed Worker"
```

---

### Task 14: usage.get, usage.retryEffect and the 80% warning on SQLite, with the four day meters

**Files:**
- Modify: `server/usage/meters.ts` (`readMeters`, `readUsage`), `server/usage/warn.ts` (`warnAdmins`, `checkLimits`, `checkDayLimits`),
  `server/calls/usage.ts` (`RETRY_EFFECT_LITE`), `server/mail/templates/index.ts` (`USAGE_METERS`), `src/i18n/real/mail.en.json`,
  `src/i18n/real/mail.ar.json`, `server/office/parts.ts` (`cron`), `server/test/liteHarness.ts` (`LATER_CALLS`)
- Test: `server/usage/lite.test.ts` (create), `server/mail/templates/render.test.ts` (snapshots), `server/office/parts.test.ts`

**Interfaces:**
- Consumes: `liteDbOf(q).host.size()` (wave 1); `adminsOf` (Task 12); `DAY_ROW_LITE`, `DayRow` (Tasks 4, 13).
- Produces: `USAGE_MONTH_LITE`, `BACKUP_BYTES_LITE`, `FILES_BYTES_LITE`, `EMAILS_MONTH_LITE`, `FAILED_EFFECTS_LITE`, `SIGNALS_LITE`,
  `WARNING_MARK_LITE`, `RETRY_EFFECT_LITE`; `DAY_LIMITS`; `checkDayLimits(deps, at): Promise<{ warned: UsageMeter[] }>`; the meters
  `rowsReadDay`, `rowsWrittenDay`, `objectRequestsDay`, `workerRequestsDay` in `USAGE_METERS`.

- [ ] **Step 1: Write the failing tests**

Create `server/usage/lite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// The usage.limitWarning handler: the entries register it through server/usage/meter.ts, this test on its own.
import './effects';
import { buildSeed } from '../../src/data/seed';
import { usageGet, usageRetryEffect } from '../calls/usage';
import { snapshotOf } from '../data/officeCache';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';
import { DAY_LIMITS, checkDayLimits, checkLimits } from './warn';

const NOW = new Date('2026-10-04T06:00:00Z');

async function office() {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db, config: { fileStore: 'r2' } });
  deps.clock.set(NOW);
  const ctx = (userId: string) => ({ deps, principal: { userId }, office: snapshotOf(seed, 1), batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW });
  return { ...lite, seed, deps, ctx };
}

describe('the usage meters on SQLite (server/usage)', () => {
  it('gives the Admin every meter: the month counts, the size of the database and the bytes of every file version', async () => {
    const { db, seed, ctx } = await office();
    await db.statement('write', "insert into usage_month (month, calls, bytes_read) values ('2026-10', 12, 3400)");
    const bytes = Object.values(seed.files).flatMap((f) => f.versions).reduce((sum, v) => sum + v.size, 0);
    const { output } = await usageGet({}, ctx('usr_001'));
    expect(output).toMatchObject({ month: '2026-10', calls: { used: 12 }, egress: { used: 3400 }, files: { used: bytes }, failedEffects: [], jobsLastRun: null });
    expect(output.database.used).toBeGreaterThan(0);
  });

  it('refuses a person who is not the Admin', async () => {
    const { ctx } = await office();
    await expect(usageGet({}, ctx('usr_002'))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists a failed effect, and a Retry gives it a new start', async () => {
    const { db, deps, ctx } = await office();
    await db.statement('write', "insert into outbox (kind, payload, attempts, error, created_at) values ('test.none', '{}', 5, 'It failed.', ?1)", [NOW.toISOString()]);
    const { output } = await usageGet({}, ctx('usr_001'));
    expect(output.failedEffects).toEqual([{ id: '1', kind: 'test.none', error: 'It failed.', attempts: 5, createdAt: '2026-10-04T09:00:00.000+03:00' }]);
    expect((await usageRetryEffect({ id: '1' }, ctx('usr_001'))).output).toEqual({ retried: true });
    expect(await db.statement('read', 'select attempts from outbox where id = 1')).toEqual([{ attempts: 1 }]);
    expect(deps.logs.some((line) => line.message.startsWith('An effect after the commit failed'))).toBe(true);
  });

  it('warns each active Admin once a day when a day meter reaches 80%', async () => {
    const { db, deps } = await office();
    await db.statement('write', "insert into usage_day (day, rows_written) values ('2026-10-04', ?1)", [DAY_LIMITS.rowsWrittenDay * 0.8]);
    expect(await checkDayLimits(deps, NOW)).toEqual({ warned: ['rowsWrittenDay'] });
    expect(await checkDayLimits(deps, NOW)).toEqual({ warned: [] });
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['limit-warning-2026-10-04-rowsWrittenDay-usr_001']);
  });

  it('warns about a month meter on SQLite as on Postgres', async () => {
    const { db, deps } = await office();
    await db.statement('write', "insert into usage_month (month, calls) values ('2026-10', ?1)", [500_000]);
    expect((await checkLimits(deps)).warned).toEqual(['calls']);
  });
});
```

Add to `server/office/parts.test.ts` (inside the first `describe`):

```ts
  it('warns the Admins in a Cron run when a day meter reaches 80%', async () => {
    const { parts, raw, net } = await office();
    raw.prepare("insert into usage_day (day, rows_read) values ('2026-10-04', 4500000)").run();
    await parts.cron({ at: NOW, worker: 0 }, net);
    expect(net.calls).toContain('mail limit-warning-2026-10-04-rowsReadDay-usr_001');
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/usage/lite.test.ts server/office/parts.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL: `METERS_SQL` meets the host refusal; `DAY_LIMITS` and `checkDayLimits` do not exist.

- [ ] **Step 3: Write the meters on SQLite**

In `server/usage/meters.ts`, add `import { isLite } from '../data/dialect';` and `import { liteDbOf } from '../data/lite/db';`, then:

```ts
// SQLite forms (exit wave 3). The size of the database is the size of the office object (sql.databaseSize). The files are on R2 on
// the office path, so the meter counts the sizes of the versions in the file records, as on R2 today.
export const USAGE_MONTH_LITE = 'select calls, bytes_read from usage_month where month = ?1';
export const BACKUP_BYTES_LITE = 'select backup_bytes from usage_month where backup_bytes is not null order by month desc limit 1';
export const FILES_BYTES_LITE =
  "select coalesce(sum(json_extract(f.doc, v.fullkey || '.size')), 0) as n from files f, json_each(f.doc, '$.versions') v "
  + "where json_type(f.doc, '$.versions') = 'array' and v.type = 'object'";
export const EMAILS_MONTH_LITE = "select count(*) as n from mail_log where utc_day >= ?1 and utc_day < ?2 and kind in ('notice', 'summary', 'signin', 'warning')";
/** ?1 now + 2 minutes. created_at desc, id desc: the backward scan of the partial index outbox_open, no sort step. */
export const FAILED_EFFECTS_LITE =
  'select cast(id as text) as id, kind, error, attempts, created_at from outbox where done_at is null and error is not null '
  + 'and not coalesce(claimed_until > ?1, 0) order by created_at desc, id desc limit 20';
export const SIGNALS_LITE = 'select signals_failed, signals_failed_at from usage_month where month = ?1 and signals_failed > 0 and signals_failed_at >= ?2';

/** The first day of the month after "YYYY-MM". */
function nextMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
}

async function readMetersLite(q: Query, config: Pick<Config, 'limits'> & Partial<Pick<Config, 'servingHost'>>, now: Date): Promise<Meters> {
  const month = utcMonth(now);
  const [usage] = await q<{ calls: unknown; bytes_read: unknown }>(USAGE_MONTH_LITE, [month]);
  const [backup] = await q<{ backup_bytes: unknown }>(BACKUP_BYTES_LITE);
  const [files] = await q<{ n: unknown }>(FILES_BYTES_LITE);
  const [emails] = await q<{ n: unknown }>(EMAILS_MONTH_LITE, [`${month}-01`, nextMonth(month)]);
  return {
    month,
    calls: { used: num(usage?.calls), limit: CALL_LIMITS[config.servingHost ?? 'supabase'] },
    database: { used: liteDbOf(q).host.size(), limit: FREE_PLAN_LIMITS.databaseBytes },
    files: { used: num(files?.n), limit: config.limits.filesTotalBytes },
    backupCopy: { used: num(backup?.backup_bytes), limit: FREE_PLAN_LIMITS.backupCopyBytes },
    emails: { used: await sentToday(q, { now }), limit: FREE_PLAN_LIMITS.emailsPerDay },
    emailsMonth: { used: num(emails?.n), limit: FREE_PLAN_LIMITS.emailsPerMonth },
    egress: { used: num(usage?.bytes_read), limit: FREE_PLAN_LIMITS.egressBytes },
  };
}
```

At the top of `readMeters`: `if (isLite(q)) return readMetersLite(q, config, now);`. In `readUsage`, pick the two texts:

```ts
  const failed = isLite(q)
    ? await q<{ id: string; kind: string; error: string | null; attempts: unknown; created_at: unknown }>(FAILED_EFFECTS_LITE, [new Date(now.getTime() + 2 * 60_000).toISOString()])
    : await q<{ id: string; kind: string; error: string | null; attempts: unknown; created_at: unknown }>(FAILED_EFFECTS_SQL);
```

```ts
  const [signals] = await q<{ signals_failed: unknown; signals_failed_at: unknown }>(isLite(q) ? SIGNALS_LITE : SIGNALS_SQL, [meters.month, new Date(now.getTime() - DAY_MS).toISOString()]);
```

In `server/calls/usage.ts`, add `import { isLite } from '../data/dialect';` and:

```ts
/** SQLite (exit wave 3): the id is the integer rowid. */
export const RETRY_EFFECT_LITE =
  'update outbox set attempts = 0, error = null, claimed_until = null where id = ?1 and done_at is null and error is not null returning id';
```

```ts
  const rows = await deps.db.tx('write', (q) => (isLite(q)
    ? q<{ id: string | number }>(RETRY_EFFECT_LITE, [Number(input.id)])
    : q<{ id: string | number }>(RETRY_EFFECT_SQL, [input.id])));
```

- [ ] **Step 4: Write the 80% warning with the day meters**

In `server/usage/warn.ts`, add the imports `sqlFor` (from `../data/dialect`), `adminsOf` (from `../mail/notices`), `utcDay` (from
`../mail/quota`), `DAY_ROW_LITE` (from `../office/meter`), `type DayRow` (from `../office/parts`), `type Meter` (from `./meters`),
then replace `checkLimits` with:

```ts
/** SQLite (exit wave 3). A day meter marks its UTC day in the month column, so it warns once a day. */
export const WARNING_MARK_LITE = 'insert into usage_warnings (month, metric) values (?1, ?2) on conflict (month, metric) do nothing returning metric';

/**
 * The Free day limits of the office path (developers.cloudflare.com, the Durable Objects and Workers pricing pages, read
 * 2026-10-17): rows read and written and requests of Durable Objects, and requests of Workers. Each ends at 00:00 UTC (03:00
 * Riyadh). They are limits of the account: the office object counts its own share, and wave 5 compares it with Cloudflare.
 */
export const DAY_LIMITS = { rowsReadDay: 5_000_000, rowsWrittenDay: 100_000, objectRequestsDay: 100_000, workerRequestsDay: 100_000 } as const;

/** One mark for each meter over 80% in its period, and the warning rows for each active Admin of the meters that this run marked. */
async function warnAdmins(deps: Deps, period: string, over: { meter: UsageMeter; value: Meter }[]): Promise<{ warned: UsageMeter[] }> {
  if (over.length === 0) return { warned: [] };
  const { warned, ids } = await deps.db.tx('write', async (q) => {
    const marked: UsageMeter[] = [];
    for (const m of over) if ((await q(sqlFor(q, WARNING_MARK_SQL, WARNING_MARK_LITE), [period, m.meter])).length > 0) marked.push(m.meter);
    if (marked.length === 0) return { warned: marked, ids: [] };
    const admins = await adminsOf(q);
    const rows: OutboxRow[] = [];
    for (const meter of marked) {
      const value = over.find((m) => m.meter === meter)!.value;
      const percent = Math.floor((value.used / value.limit) * 100);
      for (const admin of admins) rows.push({ kind: LIMIT_WARNING_EFFECT, payload: { userId: admin.id, meter, percent, month: period } });
    }
    return { warned: marked, ids: await writeOutbox(q, rows) };
  });
  if (ids.length > 0) await processOutbox(deps, ids);
  return { warned };
}

export async function checkLimits(deps: Deps): Promise<{ warned: UsageMeter[] }> {
  const now = deps.clock.now();
  const meters = await deps.db.tx('read', (q) => readMeters(q, deps.config, now));
  const over = warningMeters(meters, deps.config.fileStore, deps.config.servingHost).filter((m) => overLimit(m.value));
  return warnAdmins(deps, meters.month, over);
}

/** The 80% warning of the Free day limits, on the office object only (each Cron run; one row read). */
export async function checkDayLimits(deps: Deps, at: Date): Promise<{ warned: UsageMeter[] }> {
  if (!isLite(deps.db)) return { warned: [] };
  const day = utcDay(at);
  const [row] = await deps.db.statement<DayRow>('read', DAY_ROW_LITE, [day]);
  if (!row) return { warned: [] };
  const meters: { meter: UsageMeter; value: Meter }[] = [
    { meter: 'rowsReadDay', value: { used: Number(row.rows_read), limit: DAY_LIMITS.rowsReadDay } },
    { meter: 'rowsWrittenDay', value: { used: Number(row.rows_written), limit: DAY_LIMITS.rowsWrittenDay } },
    { meter: 'objectRequestsDay', value: { used: Number(row.requests), limit: DAY_LIMITS.objectRequestsDay } },
    { meter: 'workerRequestsDay', value: { used: Number(row.worker_requests), limit: DAY_LIMITS.workerRequestsDay } },
  ];
  return warnAdmins(deps, day, meters.filter((m) => overLimit(m.value)));
}
```

In `server/office/parts.ts`, import `checkDayLimits` from `../usage/warn` and run it in `cron` right after the flush:

```ts
      await db.tx('write', (q) => meter.flush(q, at));
      await checkDayLimits(deps, at).catch((error: unknown) => {
        log.warn('The day meters were not checked. The next run checks them.', { error: error instanceof Error ? error.message : String(error) });
      });
```

In `server/mail/templates/index.ts`:

```ts
/**
 * The usage meters of the 80% warning (plan 5.8). filesR2: file storage after the move to R2 (section 10, decision 2).
 * callsWorkers: the calls of a copy that the Worker serves (owner, 2026-10-16). The four *Day meters: the Free day limits of the
 * office path (exit wave 3), each until 03:00 Riyadh.
 */
export const USAGE_METERS = [
  'calls', 'callsWorkers', 'database', 'files', 'filesR2', 'backup', 'emailsToday', 'emailsMonth', 'egress',
  'rowsReadDay', 'rowsWrittenDay', 'objectRequestsDay', 'workerRequestsDay',
] as const;
```

In `src/i18n/real/mail.en.json`, add to `mail.limit.meter`:

```json
        "rowsReadDay": "Database rows read today",
        "rowsWrittenDay": "Database rows written today",
        "objectRequestsDay": "Requests to the office database today",
        "workerRequestsDay": "Server requests today"
```

and to `mail.limit.next`:

```json
        "rowsReadDay": "This limit starts again at 03:00 Riyadh time. If Madar reaches it, the screens stop until then. Next step: run heavy work, such as test runs, after office hours.",
        "rowsWrittenDay": "This limit starts again at 03:00 Riyadh time. If Madar reaches it, changes stop until then. Next step: run heavy work, such as test runs, after office hours.",
        "objectRequestsDay": "This limit starts again at 03:00 Riyadh time. If Madar reaches it, Madar stops until then. Next step: run heavy work, such as test runs, after office hours.",
        "workerRequestsDay": "This limit starts again at 03:00 Riyadh time. If Madar reaches it, Madar stops until then. Next step: run heavy work, such as test runs, after office hours."
```

In `src/i18n/real/mail.ar.json`, add to `mail.limit.meter`:

```json
        "rowsReadDay": "صفوف قاعدة البيانات المقروءة اليوم",
        "rowsWrittenDay": "صفوف قاعدة البيانات المكتوبة اليوم",
        "objectRequestsDay": "طلبات قاعدة بيانات المكتب اليوم",
        "workerRequestsDay": "طلبات الخادم اليوم"
```

and to `mail.limit.next`:

```json
        "rowsReadDay": "يبدأ هذا الحد من جديد الساعة 03:00 بتوقيت الرياض. إذا بلغه مدار، تتوقف الشاشات حتى ذلك الوقت. الخطوة التالية: تشغيل الأعمال الثقيلة، مثل الاختبارات، بعد ساعات العمل.",
        "rowsWrittenDay": "يبدأ هذا الحد من جديد الساعة 03:00 بتوقيت الرياض. إذا بلغه مدار، تتوقف التغييرات حتى ذلك الوقت. الخطوة التالية: تشغيل الأعمال الثقيلة، مثل الاختبارات، بعد ساعات العمل.",
        "objectRequestsDay": "يبدأ هذا الحد من جديد الساعة 03:00 بتوقيت الرياض. إذا بلغه مدار، يتوقف مدار حتى ذلك الوقت. الخطوة التالية: تشغيل الأعمال الثقيلة، مثل الاختبارات، بعد ساعات العمل.",
        "workerRequestsDay": "يبدأ هذا الحد من جديد الساعة 03:00 بتوقيت الرياض. إذا بلغه مدار، يتوقف مدار حتى ذلك الوقت. الخطوة التالية: تشغيل الأعمال الثقيلة، مثل الاختبارات، بعد ساعات العمل."
```

The Usage screen (`src/features/settings/admin/UsageSection.tsx`) does not change in this wave: `usage.get` keeps its contract, and
the day meters reach the Admin by the 80% mail. TASKS.md gets the screen line for wave 5 (Task 18).

In `server/test/liteHarness.ts`, change `LATER_CALLS` and its comment:

```ts
/** The server calls that have no SQLite form yet: they may fail in test:lite. Wave 2 empties this list (its sign-in calls). */
export const LATER_CALLS: ReadonlySet<string> = new Set(['users.invites', 'users.resendInvite', 'agents.list', 'agents.remove']);
```

- [ ] **Step 5: Run the tests, then update the mail snapshots on purpose**

Run: `npx vitest run --project server server/usage server/calls/usage.test.ts server/office/parts.test.ts server/mail/templates/render.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS, apart from snapshot lines that list the meters. Read each changed snapshot: only the four new meters may differ.
Then run the same command with `-u`, and once more without it.
Expected: PASS.
Run: `npx vitest run --project unit src/i18n --no-file-parallelism --testTimeout=60000`
Expected: PASS (the keys, the placeholders, the Arabic script, no em-dash).

- [ ] **Step 6: Commit**

```bash
git add server/usage server/calls/usage.ts server/mail/templates src/i18n/real/mail.en.json src/i18n/real/mail.ar.json server/office/parts.ts server/office/parts.test.ts server/test/liteHarness.ts
git commit -m "Exit wave 3: usage.get, usage.retryEffect and the 80% warning on SQLite, with the four Free day meters of the office path"
```

---
# Block D: The workerd suites and the gate (Tasks 15 to 19, about 1.5 days)

All three suites run the production `Office` class (as `TestOffice`) behind the real office routes on local workerd. Node holds
no stub of the office object: every call goes through `fetch`, so an evict works (wave 1 fact). Each test starts from a new office
(`fresh`, which calls `server.reset()`). Run each file with the sandbox off.

### Task 15: The batch suite on local workerd

**Files:**
- Modify: `server/office/batch.wd.test.ts` (Task 8 made it with 2 tests; this task gives the whole file)

**Interfaces:**
- Consumes: `startLive` (Task 8); `everyCall`; `buildSeed`.
- Produces: the batch suite of `test:office`.

- [ ] **Step 1: Write the tests**

Replace `server/office/batch.wd.test.ts` with:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { everyCall } from '../core/everyCall';
import { startLive } from './test/live/harness';

const TODAY = new Date().toISOString().slice(0, 10);
const seedOf = () => buildSeed(TODAY, async () => undefined);
const withMail = (seed: State): State => {
  const prefs = seed.users.usr_003.preferences;
  seed.users.usr_003 = { ...seed.users.usr_003, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
  return seed;
};

describe('the batch call into the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('answers a batch from the office object, with the session of the person', async () => {
    await live.fresh(await seedOf());
    const { status, body } = await live.batch('usr_005', [{ name: 'session.get', input: {} }]);
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ i: 0, ok: true, output: { user: { id: 'usr_005' } } });
  });

  it('refuses a batch with no token before the office object', async () => {
    const response = await live.worker().fetch('/api/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, calls: [] }) });
    expect(response.status).toBe(401);
  });

  it('runs the entries in the order sent, so a read after a write sees the write', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const id = (move.input as { id: string }).id;
    const { body } = await live.batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'tasks.get', input: { id } }]);
    expect((body.results[1] as { output: { task: { status: string } } }).output.task.status).toBe('in_progress');
  });

  it('sends the mail of a new task after the answer, through the network port of the Worker', async () => {
    await live.fresh(withMail(await seedOf()));
    const { status } = await live.batch('usr_001', [{ name: 'tasks.create', input: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false } }]);
    expect(status).toBe(200);
    await vi.waitFor(async () => expect((await live.net()).mails.map((m) => m.tag)).toContain('notice'), { timeout: 5_000 });
  });

  it('gives a file link to the network port of the Worker', async () => {
    await live.fresh(await seedOf());
    const { body } = await live.batch('usr_001', [{ name: 'files.link', input: { id: 'fil_001', variant: 'full', disposition: 'inline' } }]);
    expect(body.results[0]).toMatchObject({ ok: true, output: { url: expect.stringContaining('blob_seed_001') } });
    expect((await live.net()).files).toContainEqual({ op: 'presignGet', key: 'blob_seed_001' });
  });

  it('runs two batches that arrive at one time one after the other', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const oldMax = Math.max(...Object.values(seed.events).map((event) => event.seq));
    const c = everyCall(seed).find((one) => one.name === 'tasks.update')!;
    const [a, b] = await Promise.all([live.batch(c.actorId, [{ name: c.name, input: c.input }]), live.batch(c.actorId, [{ name: c.name, input: c.input }])]);
    expect([a.body.results[0].ok, b.body.results[0].ok]).toEqual([true, true]);
    const fresh = Object.values((await live.readBack()).events).map((event) => event.seq).filter((seq) => seq > oldMax).sort((x, y) => x - y);
    expect(fresh).toEqual(fresh.map((_, i) => oldMax + 1 + i));
  });

  it('a refused write sends no signal and writes no outbox row', async () => {
    await live.fresh(await seedOf());
    const { body: ticketBody } = await live.batch('usr_002', [{ name: 'live.ticket', input: {} }]);
    const socket = live.open((ticketBody.results[0] as { output: { ticket: string } }).output.ticket);
    await socket.opened;
    const outbox = await live.rows('select count(*) as n from outbox');
    const { body } = await live.batch('usr_005', [{ name: 'projects.delete', input: { id: 'prj_001' } }]);
    expect(body.results[0]).toMatchObject({ ok: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(socket.got).toEqual([]);
    expect(await live.rows('select count(*) as n from outbox')).toEqual(outbox);
    socket.ws.close();
  });

  it('counts the rows, the requests and the calls of a write on the day row', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    await live.batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'session.get', input: {} }]);
    const [day] = await live.rows<{ rows_read: number; rows_written: number; requests: number; calls: number }>('select rows_read, rows_written, requests, calls from usage_day');
    expect(day.requests).toBeGreaterThanOrEqual(1);
    expect(day.calls).toBe(2);
    expect(day.rows_written).toBeGreaterThan(0);
    expect(day.rows_read).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the suite**

Run (sandbox off): `npm run test:office -- server/office/batch.wd.test.ts`
Expected: PASS, 8 tests. A test that fails shows a fault of Tasks 3 to 14 on workerd that node:sqlite hid: fix the code of that
task, not the test, then run the file again.

- [ ] **Step 3: Commit**

```bash
git add server/office/batch.wd.test.ts
git commit -m "Exit wave 3: the batch suite of test:office: order, mail after the answer, file links, two writes at once, the day meter"
```

---

### Task 16: The socket suite on local workerd

**Files:**
- Create: `server/office/socket.wd.test.ts`

**Interfaces:**
- Consumes: `startLive`, `SocketClient` (Task 8); `live.ticket` (Task 9).
- Produces: the socket suite of `test:office`, with the leak tests of every signal path.

- [ ] **Step 1: Write the tests**

Create `server/office/socket.wd.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { ChangeSignal } from '../core/types';
import { everyCall } from '../core/everyCall';
import { startLive, type SocketClient } from './test/live/harness';

const TODAY = new Date().toISOString().slice(0, 10);
const seedOf = () => buildSeed(TODAY, async () => undefined);
const signalsOf = (socket: SocketClient): ChangeSignal[] =>
  socket.got.filter((text) => text !== 'pong').map((text) => (JSON.parse(text) as { payload: ChangeSignal }).payload);

describe('the live sockets of the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  const ticketOf = async (userId: string) => ((await live.batch(userId, [{ name: 'live.ticket', input: {} }])).body.results[0] as { output: { ticket: string } }).output.ticket;
  const socketOf = async (userId: string) => {
    const socket = live.open(await ticketOf(userId));
    await socket.opened;
    return socket;
  };
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('sends the change of a write to an open socket after the commit', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const socket = await socketOf('usr_002');
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    await live.batch(move.actorId, [{ name: move.name, input: move.input }]);
    await vi.waitFor(() => expect(signalsOf(socket).map((s) => s.channel)).toContain('office'));
    socket.ws.close();
  });

  it('never sends an office task change to an outsider socket', async () => {
    await live.fresh(await seedOf());
    const [maker, lead, admin, outsider] = await Promise.all(['usr_002', 'usr_003', 'usr_001', 'usr_008'].map((id) => socketOf(id)));
    const { body } = await live.batch('usr_002', [{ name: 'tasks.create', input: { title: 'Office errand', ownerId: 'usr_003', description: '', flagged: false } }]);
    expect(body.results[0].ok).toBe(true);
    await vi.waitFor(() => {
      for (const socket of [maker, lead, admin]) expect(signalsOf(socket).some((s) => s.channel.startsWith('person:'))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(signalsOf(outsider)).toEqual([]);
    for (const socket of [maker, lead, admin]) for (const s of signalsOf(socket)) expect(s).not.toHaveProperty('actorId');
    for (const socket of [maker, lead, admin, outsider]) socket.ws.close();
  });

  it('a person signal never reaches the socket of another person', async () => {
    await live.fresh(await seedOf());
    const [mine, other] = await Promise.all([socketOf('usr_003'), socketOf('usr_002')]);
    await live.batch('usr_001', [{ name: 'tasks.create', input: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false } }]);
    await vi.waitFor(() => expect(signalsOf(mine).map((s) => s.channel)).toContain('person:usr_003'));
    expect(signalsOf(other).map((s) => s.channel).filter((channel) => channel !== 'office' && channel !== 'person:usr_002')).toEqual([]);
    mine.ws.close();
    other.ws.close();
  });

  it('opens one socket for a ticket, and none for a used or a forged ticket', async () => {
    await live.fresh(await seedOf());
    const ticket = await ticketOf('usr_005');
    const first = live.open(ticket);
    await first.opened;
    await expect(live.open(ticket).opened).rejects.toThrow('did not open');
    await expect(live.open('f'.repeat(64)).opened).rejects.toThrow('did not open');
    first.ws.close();
  });

  it('answers a ping with a pong, and keeps the socket open across a hibernation', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const socket = await socketOf('usr_002');
    socket.ws.send('ping');
    await vi.waitFor(() => expect(socket.got).toContain('pong'));
    await live.evict();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    await live.batch(move.actorId, [{ name: move.name, input: move.input }]);
    await vi.waitFor(() => expect(signalsOf(socket).length).toBeGreaterThan(0));
    socket.ws.close();
  });

  it('closes the socket of a person whom the Admin turns off', async () => {
    await live.fresh(await seedOf());
    const socket = await socketOf('usr_007');
    await live.batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_007' } }]);
    expect((await socket.closed).code).toBe(4003);
  });
});
```

- [ ] **Step 2: Run the suite**

Run (sandbox off): `npm run test:office -- server/office/socket.wd.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add server/office/socket.wd.test.ts
git commit -m "Exit wave 3: the socket suite of test:office: signals after the commit, the leak tests, tickets, hibernation, turned-off people"
```

---

### Task 17: The Cron suite on local workerd, and the rows pins of one Cron run

**Files:**
- Create: `server/office/cron.wd.test.ts`
- Modify: `server/office/test/pinOffice.ts` (`cron`, `FETCH_METHODS`), `server/office/test/harness.ts` (`officeByFetch.cron`),
  `server/office/test/pins.ts` (`CRON_PINS`), `server/office/pins.wd.test.ts`

**Interfaces:**
- Consumes: `startLive`; `runOfficeJobs` (Task 13); the year office of wave 1 (`yearOffice`, `startOffice`).
- Produces: the Cron suite; `PinOfficeApi.cron(at: string): Promise<Rows>`; `CRON_PINS = { quarter: number; hourly: number }`.

- [ ] **Step 1: Write the Cron suite**

Create `server/office/cron.wd.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { startLive, type SocketClient } from './test/live/harness';

const DAY = '2026-10-04';
/** 08:00 Riyadh on a Sunday: the reminders of the sample office are due, and so is the morning summary. */
const AT = new Date('2026-10-04T05:00:00Z');
const seedOf = () => buildSeed(DAY, async () => undefined);
const mailOn = (seed: State): State => {
  const prefs = seed.users.usr_002.preferences;
  seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...prefs, email: { ...prefs.email, due_tomorrow: true, overdue: true } } };
  return seed;
};

describe('the Cron of the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  const cron = (at: Date) => live.worker().scheduled({ cron: '*/15 * * * *', scheduledTime: at });
  const socketOf = async (userId: string): Promise<SocketClient> => {
    const ticket = ((await live.batch(userId, [{ name: 'live.ticket', input: {} }])).body.results[0] as { output: { ticket: string } }).output.ticket;
    const socket = live.open(ticket);
    await socket.opened;
    return socket;
  };
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('runs the job steps, mails through the network port of the Worker, and writes the heartbeat', async () => {
    await live.fresh(mailOn(await seedOf()));
    expect((await cron(AT)).outcome).toBe('ok');
    await vi.waitFor(async () => expect(await live.rows("select done_at from job_runs where key = 'heartbeat'")).toEqual([{ done_at: AT.toISOString() }]), { timeout: 10_000 });
    await vi.waitFor(async () => {
      const keys = (await live.net()).mails.map((m) => m.idempotencyKey);
      expect(keys.some((key) => key.startsWith('notice-'))).toBe(true);
      expect(keys).toContain(`summary-${DAY}-usr_002`);
    }, { timeout: 10_000 });
  });

  it('sends at most 45 network calls in one run, and the next run sends the rest with no attempt lost', async () => {
    const seed = await seedOf();
    seed.notifications.ntf_901 = { id: 'ntf_901', userId: 'usr_002', trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_001', read: false, createdAt: '2026-10-04T04:00:00.000+03:00', dedupeKey: null };
    await live.fresh(seed);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    for (let i = 0; i < 50; i += 1) await live.exec("insert into outbox (kind, payload, created_at) values ('mail.notice', ?1, ?2)", [JSON.stringify({ notificationId: 'ntf_901' }), old]);
    // 02:00 UTC is 05:00 Riyadh: before the morning summary, so only the outbox step mails.
    await cron(new Date('2026-10-04T02:00:00Z'));
    await vi.waitFor(async () => expect((await live.rows<{ n: number }>("select count(*) as n from outbox where done_at is null and error is not null"))[0].n).toBe(5), { timeout: 10_000 });
    expect((await live.net()).mails).toHaveLength(45);
    // The rows that the budget stopped wait one minute; the test moves that minute past.
    await live.exec('update outbox set claimed_until = null where done_at is null');
    await cron(new Date('2026-10-04T02:15:00Z'));
    await vi.waitFor(async () => expect(await live.rows("select count(*) as n from outbox where kind = 'mail.notice' and done_at is null")).toEqual([{ n: 0 }]), { timeout: 10_000 });
    expect((await live.net()).mails).toHaveLength(50);
    expect(await live.rows('select max(attempts) as n from outbox')).toEqual([{ n: 1 }]);
  });

  it('closes a socket with no pong in a Cron run, and keeps one that pinged', async () => {
    await live.fresh(await seedOf());
    const quiet = await socketOf('usr_002');
    const pinged = await socketOf('usr_003');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    pinged.ws.send('ping');
    await vi.waitFor(() => expect(pinged.got).toContain('pong'));
    // MADAR_LIVE_STALE_MS is 1,500 in the test Worker: quiet is about 1.8 s old, pinged answered about 0.8 s ago.
    await new Promise((resolve) => setTimeout(resolve, 800));
    await cron(new Date('2026-10-04T02:30:00Z'));
    expect((await quiet.closed).code).toBe(4000);
    expect(pinged.ws.readyState).toBe(WebSocket.OPEN);
    pinged.ws.close();
  });

  it('warns the Admins when a day meter of the run day reaches 80%', async () => {
    await live.fresh(await seedOf());
    await live.exec("insert into usage_day (day, rows_written) values ('2026-10-04', 90000)");
    await cron(new Date('2026-10-04T02:45:00Z'));
    await vi.waitFor(async () => expect((await live.net()).mails.map((m) => m.idempotencyKey)).toContain('limit-warning-2026-10-04-rowsWrittenDay-usr_001'), { timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run the suite**

Run (sandbox off): `npm run test:office -- server/office/cron.wd.test.ts`
Expected: PASS, 4 tests. If the socket test fails under a high load average (`uptime` far above the core count), run it alone at a
low load before you call it broken: its margins are 0.3 s and 0.7 s.

- [ ] **Step 3: Write the failing pin of one Cron run**

In `server/office/test/pinOffice.ts`, import `runOfficeJobs` from `../jobs`, add `cron(at: string): Promise<Rows>;` to
`PinOfficeApi`, add `'cron'` to `FETCH_METHODS`, and add the method:

```ts
  /** One Cron run of the office jobs (exit wave 3), with the rows that it read and wrote. */
  async cron(at: string): Promise<Rows> {
    return (await this.#measured(async ({ deps }) => {
      deps.clock.set(new Date(at));
      await runOfficeJobs(deps, new Date(at));
    }))[1];
  }
```

In `server/office/test/harness.ts`, add `cron: send('cron'),` to `officeByFetch`. In `server/office/test/pins.ts`, add:

```ts
/**
 * The rows that one Cron run reads on the year office, after a first run wrote its reminders (exit wave 3). quarter: a run at
 * minute 15, with no usage step. hourly: the first run of an hour, which also reads the size of every file version. The first
 * ceilings: wave 0 measured 2,738 rows for the trigger loader, the dedupe lookup, the outbox and the cleanup (scripts/proof/do-rows,
 * results.json, year-rowid), plus 10%; the hourly one adds one row for each of the 6,000 files of the year office and the rest.
 */
export const CRON_PINS = { quarter: 3_012, hourly: 10_000 } as const;
```

In `server/office/pins.wd.test.ts`, import `CRON_PINS` and add, after the write pins test:

```ts
  it('keeps one Cron run under its ceiling of rows read', async () => {
    const office = started.officeByFetch('year');
    await office.cron('2026-10-04T12:15:00.000Z');
    const quarter = (await office.cron('2026-10-04T12:30:00.000Z')).rowsRead;
    const hourly = (await office.cron('2026-10-04T13:00:00.000Z')).rowsRead;
    if (MEASURE) console.info(`cron pin: quarter ${quarter} rows read (ceiling ${CRON_PINS.quarter}), hourly ${hourly} (ceiling ${CRON_PINS.hourly})`);
    expect([quarter <= CRON_PINS.quarter, hourly <= CRON_PINS.hourly]).toEqual([true, true]);
  });
```

- [ ] **Step 4: Measure, then set the ceilings**

Run (sandbox off): `MADAR_PINS_MEASURE=1 npm run test:office -- server/office/pins.wd.test.ts --silent=false`
Expected: the line `cron pin: quarter N rows read ..., hourly M ...`. Set `CRON_PINS.quarter` to `Math.ceil(N * 1.1)` and
`CRON_PINS.hourly` to `Math.ceil(M * 1.1)`. A value above its first ceiling needs its reason in proof.md (Task 19): look at the
statements of the run first (`trace`, as Task 18 of wave 1 did).
Run again without `MADAR_PINS_MEASURE`.
Expected: PASS, with every wave 1 pin unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/office/cron.wd.test.ts server/office/test/pinOffice.ts server/office/test/harness.ts server/office/test/pins.ts server/office/pins.wd.test.ts
git commit -m "Exit wave 3: the Cron suite of test:office, the network budget of one run, and the rows pins of one Cron run"
```

---

### Task 18: The real bundle on local wrangler dev

`createTestHarness` runs the test entry. This task runs the bundle that a deploy uploads (`dist-server/worker.js`) on
`wrangler dev`, with the office path on, and checks what needs no sign-in. A local run of the deploy suite waits for wave 5: it
needs the sign-in rows of wave 2 and the seed of wave 4 (design choice 3).

**Files:**
- Create: `server/office/test/live/wrangler.bundle.toml`, `scripts/dev/office-smoke.ts`
- Modify: `package.json` (script `smoke:office`)

**Interfaces:**
- Consumes: `dist-server/worker.js` (Task 8 and `npm run build:server`); the routes of Task 7; the Cron path of Task 13.
- Produces: `npm run smoke:office`, exit 0 when its six checks pass.

- [ ] **Step 1: Write the config**

Create `server/office/test/live/wrangler.bundle.toml`:

```toml
# The real Workers bundle (dist-server/worker.js) on the office path, for npm run smoke:office (Supabase exit, wave 3). Local
# wrangler dev only: it never deploys. scripts/dev/office-smoke.ts passes the values that look like keys in an env file that it
# makes for each run and removes after it: none of them is a real key.
name = "madar-office-smoke"
main = "../../../../dist-server/worker.js"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

[vars]
MADAR_DATA = "office"
APP_URL = "http://127.0.0.1:5173"
MAIL_FROM = "Madar <notices@madar.test>"
MAIL_DRIVER = "outbox"
SUPABASE_URL = "http://127.0.0.1:54321"
MADAR_FILE_STORE = "r2"
R2_BUCKET = "madar-files-test"
WORKER_REGION = "workers-local"

[[durable_objects.bindings]]
name = "OFFICE"
class_name = "Office"

[[migrations]]
tag = "office-v1"
new_sqlite_classes = ["Office"]

[triggers]
crons = ["*/15 * * * *"]
```

- [ ] **Step 2: Write the smoke**

Create `scripts/dev/office-smoke.ts`:

```ts
/**
 * npm run smoke:office (Supabase exit, wave 3): the real Workers bundle on local wrangler dev with the office path on. It needs no
 * Docker and no sign-in, so it checks what comes before a person: the health route with and without the jobs secret, the token
 * refusal of the batch route, the socket refusal, and one Cron run through /__scheduled (wrangler 4.147.0, --test-scheduled).
 * Run it after npm run build:server, with the sandbox off (wrangler dev binds a port). It changes nothing outside $TMPDIR.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'smoke-jobs-secret';

const dir = mkdtempSync(join(tmpdir(), 'madar-office-smoke-'));
const envFile = join(dir, 'smoke.env');
writeFileSync(envFile, [
  'MADAR_SECRET_KEY=sb_secret_test_not_a_key', `JOBS_SECRET=${SECRET}`, `R2_ACCOUNT_ID=${'0'.repeat(32)}`,
  'R2_ACCESS_KEY_ID=test-not-a-key', 'R2_SECRET_ACCESS_KEY=test-not-a-key',
].join('\n'), { mode: 0o600 });

const dev = spawn('npx', [
  'wrangler', 'dev', '-c', 'server/office/test/live/wrangler.bundle.toml', '--env-file', envFile, '--port', String(PORT),
  '--ip', '127.0.0.1', '--test-scheduled', '--show-interactive-dev-session=false',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
dev.stdout.on('data', (chunk) => (output += String(chunk)));
dev.stderr.on('data', (chunk) => (output += String(chunk)));

async function until<T>(work: () => Promise<T | undefined>, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await work();
      if (value !== undefined) return value;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

type Health = { host?: string; office?: { schema?: number; lastJob?: string | null } };
const health = async (secret?: string) => (await fetch(`${BASE}/api/health`, { headers: secret ? { 'x-madar-jobs-secret': secret } : {} })).json() as Promise<Health>;

const checks: [string, boolean][] = [];
try {
  const open = await until(() => health(), 60_000);
  checks.push(['the health route names the office host', open?.host === 'office']);
  const before = await health(SECRET);
  checks.push(['the office object answers with schema 3 and no job run yet', before.office?.schema === 3 && before.office?.lastJob === null]);
  const batch = await fetch(`${BASE}/api/batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, calls: [] }) });
  checks.push(['a batch with no token gets 401 from the office route', batch.status === 401 && (batch.headers.get('x-madar-server') ?? '').startsWith('office;')]);
  const live = await fetch(`${BASE}/api/live?ticket=${'a'.repeat(64)}`);
  checks.push(['a socket address with no upgrade gets 426', live.status === 426]);
  const ran = await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('*/15 * * * *')}`);
  checks.push(['the Cron route of wrangler dev answers', ran.ok]);
  const after = await until(async () => {
    const answer = await health(SECRET);
    return answer.office?.lastJob ? answer : undefined;
  }, 15_000);
  checks.push(['the Cron run wrote the heartbeat in the office object', typeof after?.office?.lastJob === 'string']);
} finally {
  dev.kill('SIGINT');
  rmSync(dir, { recursive: true, force: true });
}
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
const passed = checks.length === 6 && checks.every(([, ok]) => ok);
if (!passed) console.log(output.split('\n').slice(-40).join('\n'));
process.exit(passed ? 0 : 1);
```

In `package.json`, add to `scripts`, after `test:office`:

```json
    "smoke:office": "node --import tsx scripts/dev/office-smoke.ts",
```

- [ ] **Step 3: Run it**

Run (sandbox off): `npm run build:server && npm run smoke:office`
Expected: six `ok` lines and exit 0. A `FAIL` line prints the last 40 lines of wrangler dev: read them first (a missing export
`Office` points at the bundle entry; a 500 on health points at a missing value of `serverEnvFrom`).

- [ ] **Step 4: Commit**

```bash
git add server/office/test/live/wrangler.bundle.toml scripts/dev/office-smoke.ts package.json
git commit -m "Exit wave 3: npm run smoke:office runs the real Workers bundle on local wrangler dev with the office path on"
```

---

### Task 19: The guides, the records, and the merge gate

**Files:**
- Modify: `server/CLAUDE.md`, `server/data/CLAUDE.md`, `server/mail/CLAUDE.md`, `server/push/CLAUDE.md`, `server/mcp/CLAUDE.md`,
  `src/CLAUDE.md`, `src/api/CLAUDE.md`, `scripts/deploy/CLAUDE.md`, `tests/CLAUDE.md`, `CLAUDE.md` (root, Commands),
  `docs/superpowers/real-build/proof.md`, `TASKS.md`

- [ ] **Step 1: Write the guide lines**

`server/CLAUDE.md`: in "Calls", change "10 server-only calls" to 11 and add `live.ticket` to the list. Add a section after
"Realtime, jobs, usage":

```markdown
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
  usage step runs in the first run of each hour. A Worker without `MADAR_DATA` returns at once.
- The office meter (`office/meter.ts`) keeps the day counts in memory and adds them in the next write (`usage_day`); the 80% mail
  covers the four Free day meters (`usage/warn.ts`, `checkDayLimits`).
- Tests: `office/{net,meter,live,parts}.test.ts` on node:sqlite; `office/{batch,socket,cron}.wd.test.ts` on local workerd with the
  test Worker of `office/test/live/`; `npm run smoke:office` for the real bundle.
```

`server/data/CLAUDE.md`: add to the SQLite part: "Schema version 3 (exit wave 3): the table `usage_day`; each version above 1 has a
step in `LITE_STEPS`, and `applyLiteSchema` runs the steps above the office version in one transaction. `LiteDb.isOpen()` tells the
network port of the office object that a transaction is open. `SaveResult.noticeIds` names the notices of a save: the producers on
SQLite read them in place of the `xmin` test."

`server/mail/CLAUDE.md`: add: "On SQLite (the office object, exit wave 3) the quota has no mail lock: one count and one insert in the
caller's transaction (`RESERVE_COUNT_LITE`, `RESERVE_ADD_LITE`). A mail of the office object goes through the network port of the
Worker; with `MAIL_DRIVER=outbox` it goes into `mail_outbox` of the object."

`server/push/CLAUDE.md`: add: "On the office object (exit wave 3), `sendPush` signs the VAPID token in the object and posts through
`deps.pushFetch`, the network port of the Worker. The Worker posts only to a push service (`postPush`)."

`server/mcp/CLAUDE.md`: add to the deny list part: "`live.ticket` (exit wave 3): an agent opens no socket."

`src/CLAUDE.md`, "Data on screens": add: "The office build (exit wave 3, `VITE_MADAR_LIVE=socket`, set by no build before wave 5)
gets its signals from one socket of the office object (`api/remote/liveSocket.ts`, picked by `liveSourceOf` in
`app/remote/bootstrap.ts`): a ticket, a ping each 30 s, a new socket and a reload of every list when no pong comes in 10 s.
Every other build keeps Supabase Realtime (`app/remote/channel.ts`)."

`src/api/CLAUDE.md`: in the checklist part, name `live.ticket` as the 11th server call.

`scripts/deploy/CLAUDE.md`, "Cloudflare": add: "The next `all.sh test` after wave 3 deploys `madar-server-test` with a Durable Object
namespace `Office` (no object, no storage), the migration `office-v1`, and a Cron every 15 minutes whose `scheduled()` returns at
once (no `MADAR_DATA`): 96 short runs a day and 1 of the 5 Cron Triggers of the account. The test copy serves the same, because
the Pages forwarder sends `/api` to Supabase while `config/server-host.json` says supabase. `madar-server-production` gets no
binding, no migration and no Cron (`migrations = []`, `crons = []`); wrangler prints one warning about `durable_objects` on each
production deploy, which is expected until wave 6."

`tests/CLAUDE.md`: add to the top: "`npm run test:office` also runs the live suites (`server/office/{batch,socket,cron}.wd.test.ts`)
on the test Worker of `server/office/test/live/`. `npm run smoke:office` runs the real bundle on `wrangler dev` (sandbox off)."

Root `CLAUDE.md`, "Commands": add "`npm run smoke:office` - the real Workers bundle on local wrangler dev with the office path on
(after `build:server`, sandbox off)."

- [ ] **Step 2: Write TASKS.md lines**

Add under the exit section of `TASKS.md`:

```markdown
- [ ] Exit wave 4: `config/server-host.json` value `office` sets `MADAR_DATA = "office"` in the env of the copy and
      `VITE_MADAR_LIVE=socket` in its screens build (`scripts/build-remote.ts`, `remotePublicEnv`).
- [ ] Exit wave 2 or 4: MCP on the office path: a kind of `OfficeWho` for an agent, its branch in `principalOfWho`, and `/mcp` on
      `officeRoutes` (wave 3 serves `/api` only).
- [ ] Exit wave 5: show the four Free day meters on Admin, Usage (contract field of `usage.get`, words, screenshots EN and AR,
      light and dark, 390 px). Wave 3 sends them only in the 80% mail.
- [ ] Exit wave 5, on the deployed test copy: (a) the bill of a batch with mail (Worker requests and object requests; the network
      callbacks should add none); (b) the CPU of a Cron run and of a batch with effects (`wrangler tail`, 10 ms on Free);
      (c) the office meter against the Cloudflare day numbers (GraphQL, `scripts/proof/do-socket/gql.mjs`); (d) a socket through the
      Pages forwarder and the service binding (a 101 answer); (e) the transaction race of wave 1 on the deployed object.
- [ ] Exit wave 5: the deploy suite on the office path (needs the sign-in rows of wave 2 and the seed of wave 4).
- [ ] Exit wave 5: if a socket often fails to open after a hibernation (the ticket lives in memory), move the ticket to a short
      signed form with a Worker secret.
```

- [ ] **Step 3: Count the Cron Triggers of the account (the lead, read only)**

The next test deploy adds 1 Cron Trigger, and Workers Free allows 5 for the account. The lead counts the ones in use with the API
(read only; the token of the wrangler login, `scripts/deploy/CLAUDE.md`, "Cloudflare"; sandbox off):

```bash
TOKEN=$(sed -n 's/^oauth_token = "\(.*\)"$/\1/p' ~/Library/Preferences/.wrangler/config/default.toml)
ACCOUNT=d76d34779c63849f5acdf3d6af3751cd
for s in $(curl -s -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).result.map(x=>x.id).join(" ")))'); do
  printf '%s ' "$s"; curl -s -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/$s/schedules" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).result?.schedules?.length ?? 0))'
done
```

Expected: the sum is 4 or less. With 5 in use, set `crons = []` in `[env.test]` too (one line, with a comment that wave 5 removes it)
before the merge, and add the case to TASKS.md. Write the count in proof.md.

- [ ] **Step 4: Run the merge gate, once**

The owner starts Docker Desktop first (`test:db`, `test:it`). Rebase on main, then, in this order, each once (sandbox off where
noted):

```bash
git fetch . main && git rebase main
npm run typecheck
npm test
npm run build
npm run build:server
npm run build:remote -- test          # sandbox off
npm run test:lite
npm run test:office                   # sandbox off
npm run smoke:office                  # sandbox off
scripts/dev/docker-lock.sh run exit-live -- npx supabase db reset
scripts/dev/docker-lock.sh run exit-live -- npm run test:db
scripts/dev/docker-lock.sh run exit-live -- npm run test:it
npm run test:mcp
npx playwright test                   # in a delegated helper agent (prototype smoke): the contract and bootstrap.ts changed
```

Expected: every command passes. `test:lite` and `test:db` run one more file (`src/api/remote/liveSocket.test.ts`, 82 files); their
skips stay 25. `test:it` does not change (33 files). `test:office` runs 5 files (the 2 of wave 1 and the 3 of this wave). The
prototype smoke passes 87 of 87. Only a red check gets a fix step, and then only that check runs again.

- [ ] **Step 5: Write the proof.md section**

Append this section to `docs/superpowers/real-build/proof.md`, with the UTC day that `date -u +%F` prints in its heading:

```markdown
### Wave 3 of the Supabase exit: the office object, live updates and jobs (<the day of the gate run>)
Exit wave 3 plan (`docs/superpowers/plans/2026-10-17-madar-exit-wave3-live-plan.md`). Nothing deployed.
- Facts checked while planning (17 October): a Worker RpcTarget passed into an object method is callable from the object until the
  method returns, also with a timer on the Worker side (local workerd probe); tags, attachments and the auto-pong time survive an
  evict with `webSockets: 'hibernate'`, and a message wakes a new boot that still finds every socket; `worker.scheduled()` of the
  harness runs `scheduled` and its `waitUntil`; wrangler 4.147.0 gives `[env.production]` no binding, no migration and no Cron with
  `migrations = []` and `crons = []`, and inherits the top-level migration and Cron in `[env.test]`; calls on a stub inside one
  RPC session are not billed as more Durable Object requests (pricing page); a DO error carries `overloaded` or `retryable`.
- The merge gate (one line each, with the counts and times that each command printed).
- The Cron rows pins: quarter N rows read, hourly M (ceilings), and the reason when a value is above its first ceiling.
- The Cron Triggers of the account before the merge: K of 5.
```

Each line of the section holds the numbers that the commands of Steps 3 and 4 printed, as the wave 1 records do.

- [ ] **Step 6: Commit**

```bash
git add server/CLAUDE.md server/data/CLAUDE.md server/mail/CLAUDE.md server/push/CLAUDE.md server/mcp/CLAUDE.md src/CLAUDE.md src/api/CLAUDE.md \
  scripts/deploy/CLAUDE.md tests/CLAUDE.md CLAUDE.md TASKS.md docs/superpowers/real-build/proof.md
git commit -m "Exit wave 3: the guides and records of the office object, live updates and jobs, and the merge gate"
```

---

## Spec coverage

| Requirement (orchestrator task, exit plan A.2 "Wave 3", spec) | Task |
|---|---|
| The production `Office` class (`server/office/office.ts`), exported by the Worker entry, schema step inside `blockConcurrencyWhile` | 8 (class, export through `workerMain.ts`), 1 (the step path) |
| The Worker gives the whole batch to the object in one call; token check, preflight network work and effects in the Worker | 7 (routes), 6 (`runOfficeBatch`), 3 (the network port: preflight R2 head and copy, links, mail, push run in the Worker) |
| How `runCall`, `createRunCall` and `liteData` run inside the object, and how the answer comes back | 6 (`officeData` on `liteData`, `createRunCall({ data, afterCommit })`, the JSON text answer) |
| Two coarse effect methods for each batch, so a write costs 2 object requests and not about 9 | 3, 6, 7: 2 requests (the batch, then `runEffects`) with no split of the handlers (design choice 1) |
| The mail and push producers on SQLite: `SaveResult` gives the inserted notification ids | 2 |
| The mail quota of `server/mail/quota.ts` on SQLite | 12 |
| A `SignalPort` that sends after the commit on the object sockets (Hibernation API, tags, auto-response), with `onCommit` | 5 (port), 8 (Hibernation wiring), 16 (workerd) |
| The office task rules of `realtime.ts` and `Diff.privateChange` stay; leak tests as an outsider on every signal | 5, 16 (outsider socket, other person, turned-off person, forged and used tickets, refusal texts name no person) |
| `live.ticket` (60 s) | 9 (call), 5 (tickets) |
| `src/api/remote/liveSocket.ts`, keeping today's Realtime client for the Supabase build | 10 (`liveSocketSource`, `liveSourceOf`; `src/app/remote/channel.ts` unchanged) |
| The socket sweep by `getWebSocketAutoResponseTimestamp` | 5 (`sweep`), 13 (in each Cron run), 17 (workerd) |
| The client ping each 30 s that opens again and reloads (wave 0 change 4) | 10 |
| The Cron Trigger (`scheduled`) for the job steps; the object runs the steps, the Worker sends mail and push; Free Cron limits | 13 (steps on SQLite, Cron path), 17 (suite), 19 Step 3 (the 5 Cron Triggers of the account) |
| The meters of the Free day limits: rows read and written (with rolled-back rows), object requests, calls | 4, 14 (the 80% mail of the four day meters) |
| `countRequest` keeps its counts in memory and adds them in the next write | 4, 6 (`officeData` flushes in each write) |
| `usage.get` and `usage.retryEffect` on SQLite; `LATER_CALLS` and `LATER_KINDS` hold no wave 3 name | 14 |
| `wrangler.server.toml`: the binding, one migrations block, one triggers block; what a test deploy changes | 8, 13 (blocks and their tests), 19 Step 1 (`scripts/deploy/CLAUDE.md` names the change) |
| The `test:office` suites: socket, Cron and batch, on local workerd | 15, 16, 17 |
| The rows pins (gate of A.2) | 17 (Cron pins); the wave 1 pins run unchanged |
| A local `wrangler dev` run (gate of A.2: the deploy suite) | 18 (the real bundle; the deploy suite moves to wave 5, design choice 3) |
| Spec section 2: the 07:30 summary under 50 fetch calls | 3 (`NET_BUDGET`), 13 (summary on SQLite), 17 (budget test) |
| Spec section 3: the meter counts the rows of each day and warns the Admin at 80% | 4, 14 |
| MCP side of every feature change | 9 (`MCP_DENY`); no `TOOL_DOCS` and no `INSTRUCTIONS` change |
| Screenshots of a screen change | none due: no screen that a person sees changes (Global Constraints) |

## Merge notes

Wave 2 (`rb/exit-signin`, plan `docs/superpowers/plans/2026-10-17-madar-exit-wave2-signin-plan.md`) and Track R
(`rb/read-cost`) build beside this wave. The branch that merges second does each item below in its rebase, keeps both sides, and
runs the tests that the item names. Items 1, 2 and 8 answer the merge notes of the wave 2 plan (its items 1, 3, 6, 7 and 8).

1. **The schema (`server/data/lite/schema.ts`, `schema.test.ts`): settled by the main session on 17 October 2026. The rule below wins over item 1 of the wave 2 plan.**
   The orchestrator fixed wave 2 = version 2 and wave 3 = version 3. The wave 2 plan (its item 1) says the later branch "takes the
   next free number" and "adds no step". This plan adds the step map `LITE_STEPS` with one step, `3: [USAGE_DAY_SQL]`, because the
   office object of this wave applies the schema at start. The rule: after both merges, `LITE_SCHEMA_VERSION = 3`, `SERVER_SQL` and
   `SERVER_INDEXES` hold the tables and indexes of both waves, `LITE_STEPS` stays `{ 3: [USAGE_DAY_SQL] }`, and `PINNED_SHA256` is the
   hash of the merged text (run the pin test, copy the value). The sign-in tables need no step 2: no office object below version 3
   exists outside tests (the first one comes in wave 5), so version 3 may take them before any office does. If this wave merges first, wave 2 adds its tables to version 3 and keeps the number 3. The step test of Task 1
   (it drops only `usage_day` and starts from version 2) stays right. Track R takes version 4 with a step `4` of its own. Each
   later version needs its step: the first real office exists from wave 5 on.
2. **The mail quota (`server/mail/quota.ts`).** Both plans write SQLite forms of `reserve`, `release` and the last statement of
   `sendCounted`; this plan also writes `markFirstRefusal` and `sentToday` (which the wave 2 plan leaves to wave 3). Keep the forms
   of `reserve`, `release` and `sendCounted` of the branch that merged first (the rule of the wave 2 plan, item 3), keep the
   `markFirstRefusal` and `sentToday` forms of this plan, and point every caller at the kept names. Run
   `server/data/lite/effects.test.ts` of this plan and the quota tests of wave 2 (`server/auth/own/liteTexts.test.ts`,
   `server/auth/own/effects.lite.test.ts`).
3. **`server/core/ports.ts`, `server/core/types.ts`, `server/core/runCall.ts`.** This plan adds `Deps.pushFetch?` and `Deps.live?`;
   wave 2 adds `ServerCallCtx.data` and its line in `runServerCall`. Keep every field and line.
4. **The call lists** (`src/api/contract/server.ts`, `src/api/handlers/serverFakes.ts`, `server/calls/index.ts`, `server/mcp/tools.ts`,
   `src/app/readMap.ts`, `src/api/calls.test.ts`, `server/core/serverCallMap.test.ts`): wave 2 adds no call (its Global
   Constraints). This plan adds `live.ticket`: 132 calls, 128 in the server map, 11 server calls. Run the two count tests and
   `server/mcp/tools.test.ts`.
5. **`server/test/liteHarness.ts`, `liteHarness.test.ts`.** Wave 2 leaves `LATER_CALLS = ['usage.get', 'usage.retryEffect']` and
   empties `LATER_KINDS`; this plan takes the two `usage.*` names out. After both, both sets are empty and the harness test says
   `expect([...LATER_CALLS]).toEqual([])`. The harness deps keep `liteAuthAdmin` of wave 2. Run `npm run test:lite`.
6. **`server/auth/principal.ts`, `server/office/who.ts`.** The wave 2 plan keeps `principalOf(authUserId, office)` unchanged on
   SQLite (the snapshot carries the sign-in links), so `principalOfWho` of this plan works after both with no change, and
   `OfficeWho['browser'].authUserId` is what the token check gives on both ports.
7. **`src/app/remote/bootstrap.ts`, `src/env.d.ts`.** Wave 2 adds the auth mode `VITE_MADAR_AUTH` and `quietChangeSource()` for the
   Madar build; this plan adds `liveSourceOf` and `VITE_MADAR_LIVE`. After both, the Madar build (`VITE_MADAR_AUTH=madar`) opens the
   live socket (`liveSourceOf('socket', ...)`) in place of `quietChangeSource()`, and the Supabase build keeps
   `supabaseChangeSource` (the wave 2 plan, item 7). `live.ticket` goes through `api.call`, so it carries the token of either port.
   Keep the cases of both waves in the test file; run `src/app/remote/bootstrap.test.ts`.
8. **The sign-in parts on the office object (the wave 2 plan, items 6 and 8): a task of the second merge, not of either build.**
   With both waves on main: (a) `officeParts` takes `authAdmin: liteAuthAdmin({ db, clock })` in place of `SIGN_IN_LATER`; the effects
   of `invite.ts` and `auth/effects.ts` then run in the object with only the mail through the network port, as this plan runs the
   other effects. (b) `Office` gets one more RPC method beside `batch`, `signin(body: { signin: string; input: unknown })`, which runs
   `runSigninOp({ db, clock, log, config, keys }, body.signin, body.input)` with the keys of `signingKeysOf(env.MADAR_AUTH_PRIVATE_JWK,
   config.mcpUrl)` (the import of the key runs before any transaction). (c) `officeRoutes` gets the option `routes` and mounts
   `ownApiRoutes(objectSigninOffice, { jwks: ownPublicJwks(env.MADAR_AUTH_PRIVATE_JWK) })` under `/api` before `notFound`, as
   `apiApp` does with `AppOptions.routes`. (d) `officeSteps` runs `cleanupSignin` in the first run after 00:00 UTC
   (`at.getUTCHours() === 0 && at.getUTCMinutes() < 15`). (e) `/mcp` on the office path: an `OfficeWho` kind for an agent with its
   branch in `principalOfWho`, the MCP host with the options of the wave 2 plan (item 6), and each tool call through `Office.batch`.
   If (e) is too large for the merge, it goes to wave 4 (the TASKS.md line of Task 19). Run `test:lite`, `test:office`, `test:mcp`.
9. **`server/office/test/pinOffice.ts`, `server/office/test/harness.ts`, `server/office/test/pins.ts`, `server/office/pins.wd.test.ts`.**
   Wave 2 adds `signin`, `importSignins` and `peek`; this plan adds `cron` and `CRON_PINS`; Track R lowers the badge pins. Keep
   every method in `PinOfficeApi`, `FETCH_METHODS` and `officeByFetch`. Run `npm run test:office -- server/office/pins.wd.test.ts`.
10. **`src/i18n/real/mail.en.json`, `mail.ar.json`.** This plan adds four keys under `mail.limit.meter` and `mail.limit.next`; wave 2
    may change the invite and reset words. Keep both; run `npx vitest run --project unit src/i18n` and the mail snapshots.
11. **`server/workerGraph.test.ts`.** Wave 2 adds a `describe` for the three Deno entries; this plan adds `workerMain.ts` and the
    office `describe`. The Workers bundle may load `server/auth/own/` (bcryptjs, `nodejs_compat`) after both: the rule of no office
    object stays for the Deno entries only.
12. **`server/data/save.ts`.** Track R adds the upkeep of `unread_counts` from the Diff; this plan adds `noticeIds`. Keep both.
13. **`package.json`, `package-lock.json`, `vite.server.config.ts`, `wrangler.server.toml`.** Wave 2 adds `bcryptjs` and a
    devDependency; this plan adds `smoke:office`, the worker input `workerMain.ts` with the external `cloudflare:workers`, and the
    office blocks. After a rebase over new packages, run `npm install` (sandbox off) in a worktree with its own `node_modules`.
14. **The first end-to-end run of the own sign-in (the wave 2 plan, item 13).** It needs the office path of this plan and the seed
    of wave 4; `server/office/test/live/wrangler.bundle.toml` and `scripts/dev/office-smoke.ts` are the base of that local run.
15. **`server/CLAUDE.md`, the other guides, `TASKS.md`, `proof.md`.** Each wave adds its own sections and lines; keep both.

## Owner actions

- Start Docker Desktop for the merge gate (`test:db`, `test:it`): the sandbox blocks `open -a Docker`.
- No decision is due in this wave: no payment, no secret, no deploy, no mail to a person.
- At the next `all.sh test` after the merge (any release, for example Track R), the test Worker gets the office namespace and one
  Cron Trigger that does nothing yet (Task 19, Step 1, the `scripts/deploy/CLAUDE.md` line). If the lead's count of Task 19 Step 3
  shows 5 Cron Triggers in use already, the owner chooses which one to remove, or keeps the test Cron off until wave 5.

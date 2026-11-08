# Madar enterprises, plan B: the enterprise core. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give each enterprise its own office object, find the right object for every request, and prove that no path reaches the object of another enterprise.

**Architecture:** The office object keeps its class `Office` and gets an identity row plus a gate that checks `ent` on every call. A new `Platform` object holds the list of enterprises, the email directory and the meters. The Worker finds the enterprise from the token claim, a tag, an email or an MCP address, and never makes an object for a name that the platform does not list. One Cron invocation lists the enterprises and sends one Worker self-call for each.

**Tech Stack:** TypeScript, Hono, Cloudflare Durable Objects (SQLite), `jose`, vitest (`server` project, `lite` project, `office` project on local workerd), wrangler.

**Spec:** `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md` (sections 5.1 to 5.5, 5.13, 7 and 8). Shared names: `docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md`. Track `ent-b`, branch `rb/ent-b`.

## Global Constraints

- Use the names, types and values of the contract exactly. Where this plan needs a new shared name, "Contract additions" at the end of this file lists it. Do not edit the contract file.
- One builder runs the whole plan in `~/dev/madar-rb/ent-b` (branch `rb/ent-b`). `node_modules` links to `/Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test/node_modules`. Edit only the files that a task names.
- Tests first. In a task, run only `npm run typecheck` and the tests of the touched files: `npx vitest run <files> --testTimeout=60000`. A `*.wd.test.ts` file runs with `MADAR_OFFICE=1 npx vitest run --project office <file> --testTimeout=60000`. A `src/api` rule test on SQLite runs with `MADAR_LITE=1 npx vitest run --project lite <file>`. Sandbox off for workerd.
- A task that changes the office object or the SQLite path also runs `npm run test:lite` and `npm run test:office` (sandbox off). Tasks 5 to 9 and 11 to 15 do this. The full suites run once at the end, by the lead. Add no review task.
- One commit for each task, a plain message in STE, no `Co-Authored-By` line, no `Claude-Session` line.
- Write all text in ASD-STE100. No em-dash anywhere. Run `git diff main | grep -P '^\+[^+].*\x{2014}'` before the last commit. It must print nothing.
- Plan B adds no visible word, so it adds no word key and no What's new line. Plan D writes both.
- A contract change is additive. An old row, token form or call still works on the Postgres path.
- The Postgres path serves only `ENT_VADO`. It loads no file of `server/enterprise/` that imports `cloudflare:workers` (`server/entries/bundles.test.ts` and `npm run build:server` check this).
- Every limit that comes from a Cloudflare plan is a named constant or a setting, never a bare number in a branch.
- Error texts name no enterprise, no email and no secret. A refusal of a wrong `ent` has the same text as a bad token ("Sign in to continue."). The contract word `unauthorized` means `ApiError` code `unauthenticated`: the code list has no other word.
- A Lead step is not a task of the builder. The builder never deploys and never touches the test copy or production.

## Review Focus

Failure modes that the spec implies and that a person can meet. Each line has its test in the task that is named.

1. Email with capitals or spaces ("  Admin@Madar.TEST ") finds the same enterprise as the clean email. Task 9.
2. A link, key or ticket that was issued before the switch has no tag. The person sees the normal "link ended" or "sign in again" answer, never a 500. Tasks 9, 10 and 11.
3. A tag with a good shape but an unlisted id, upper-case letters, two dots, or 5,000 characters gives the same refusal and makes no object. Tasks 3, 9 and 16.
4. An enterprise made less than 60 seconds ago works at once: a miss in the listed cache reads the list again when the cache is older than 5 seconds. Task 8.
5. One enterprise that fails in a Cron run does not stop the others, and a paused enterprise still reports its status. Task 14.
6. The address name `oauth` is a path word of the OAuth routes, so `/mcp/oauth/token` is never read as an enterprise address. Task 12.

## File structure

| File | Job |
| --- | --- |
| `server/enterprise/ids.ts` (new) | The id, address, tag and email rules of the contract. |
| `server/enterprise/types.ts` (new) | `EnterpriseRow`, `EnterpriseStatus`, `DayCounts`, limits, state. |
| `server/enterprise/gate.ts` (new) | `EnterpriseGate`: the identity row of one object, and the check of `ent`. |
| `server/enterprise/router.ts` (new) | `entRouter`: the only place where the Worker turns an untrusted id into an object stub. The listed cache. `mcpAddressOf`. |
| `server/enterprise/pad.ts` (new) | `padTo`: waits until a minimum answer time. |
| `server/enterprise/fanout.ts` (new) | `runFanout`, the two Worker self-call transports, `CRON_PATH`. |
| `server/enterprise/platform/{schema,parts,stub,object}.ts` (new) | The platform object: tables, methods, `PlatformStub`, the class `Platform`. |
| `server/enterprise/CLAUDE.md` (new) | The guide of this folder. |
| `server/entries/officeWorker.ts`, `officeEntry.ts`, `officeSignin.ts`, `workerMain.ts` | Routing by enterprise, ops names, Cron fan-out. |
| `server/office/{parts,office,live,ops,import}.ts`, `batch.ts` | The gate in every object method, `status()`, the tagged ticket, the row at import. |
| `server/auth/{verify,mail,invite,forgot}.ts`, `server/auth/own/{keys,sessions,types,office,routes}.ts`, `server/mcp/auth.ts` | The `ent` claim and the tags. |
| `server/data/lite/schema.ts` | `LITE_STEPS` step 14: the `enterprise` table. |
| `wrangler.server.toml` and the three test `wrangler*.toml` | `PLATFORM` binding, migration `platform-v1`, binding `SELF` on the test env. |
| `scripts/office/{enterprise,ops,import,seed}.ts`, `scripts/dev/office-{local,smoke}.ts` | Two enterprises on the local stack. |
| `scripts/proof/{ent-core,cron-fanout}/` (new) | The probes of the spikes S1 to S3. |

## Tasks

### Task 1: Spikes S2 and S3 on local workerd

**Files:**
- Create: `scripts/proof/ent-core/entry.ts`, `scripts/proof/ent-core/wrangler.toml`, `scripts/proof/ent-core/run.mjs`
- Modify: `docs/superpowers/real-build/proof.md` (append one section, "Madar enterprises: core spikes S2 and S3")

**Interfaces:**
- Produces: two numbers and one yes or no in proof.md. They decide Tasks 5 and 7: whether the gate may compare the object name (S3), and what a sign-in through the platform object costs (S2).

The probe follows `scripts/proof/do-tx/run.mjs` (read it first: it uses `createTestHarness` of wrangler and never deploys).

- [ ] **Step 1: Write the checks of the script.** `run.mjs` must exit 1 unless these hold. S3: a `ProbeName` object made with `idFromName('ent_001')` reports `ctx.id.name` equal to `'ent_001'` in its constructor, in a method, and after `evictDurableObject`; an object made with `newUniqueId()` reports `undefined`. S2: `ProbeDirectory.resolve` (one primary-key read of a `directory` table) reads at most 2 rows and writes 0, for a hit and for a miss, warm and after an evict. S2 also checks that an unknown email through `runSigninOp` on empty sign-in tables inside `ProbeDirectory`, and a wrong password through `PinOffice.signin('auth.password', ...)`, both answer the reason `invalid_credentials`.
- [ ] **Step 2: Run it and see it fail.** Run: `node scripts/proof/ent-core/run.mjs`. Expected: exit 1, the entry file does not exist.
- [ ] **Step 3: Write `entry.ts` and `wrangler.toml`.** `entry.ts` exports `PinOffice` (import from `server/office/test/pinOffice.ts`), `ProbeDirectory` (SQLite object, one table, methods `put`, `resolve`, `refuse`) and `ProbeName`. The worker routes `?o=<class>&name=<name>` to the object. `run.mjs` prints a JSON line with: S3 result, rows read and written for each `resolve` case, and the median and p95 of 20 runs in ms for the object path and the platform `refuse` path.
- [ ] **Step 4: Run it and see it pass.** Run: `node scripts/proof/ent-core/run.mjs` (sandbox off). Expected: exit 0.
- [ ] **Step 5: Write the section in proof.md.** It holds the JSON numbers, the decision for S3 ("the gate compares the object name" or "the gate uses the row only"), and the S2 sentence: how many rows and Durable Object requests one sign-in adds. Commit.

```bash
git add scripts/proof/ent-core docs/superpowers/real-build/proof.md
git commit -m "Add the probes S2 and S3 of Madar enterprises and their numbers"
```

### Task 2: Spike S1, the Cron fan-out code and its probe

**Files:**
- Create: `server/enterprise/fanout.ts`, `server/enterprise/fanout.test.ts`, `scripts/proof/cron-fanout/probe.ts`
- Modify: `server/entries/officeWorker.ts` (probe routes only; Task 14 changes the Cron), `wrangler.server.toml` (`[[env.test.services]] binding = "SELF" service = "madar-server-test"`), `docs/superpowers/real-build/proof.md`

**Interfaces:**
- Produces (`server/enterprise/fanout.ts`):
```ts
export const CRON_PATH = '/api/internal/cron';
export const FANOUT_PARALLEL = 1;
export type FanoutLeg = { ent: EnterpriseId; ok: boolean; ms: number; status: number | null };
export type FanoutTransport = (leg: { ent: EnterpriseId; at: string }) => Promise<Response>;
export function runFanout(o: { ids: readonly EnterpriseId[]; at: Date; transport: FanoutTransport; log: Logger; now?: () => number }): Promise<{ legs: FanoutLeg[] }>;
export function selfTransport(env: Record<string, unknown>, o: { kind: 'self' | 'api'; secret: string; apiUrl: string }): FanoutTransport;
```
- Consumes: `Logger` (`server/core/ports.ts`), `JOBS_SECRET_HEADER` (`server/jobs/app.ts`), `EnterpriseId` (Task 3 creates it; in this task import it from `server/enterprise/ids.ts` after Task 3, or declare the type locally and replace it in Task 3).

- [ ] **Step 1: Write the tests (they fail first)** in `fanout.test.ts`.
  - `runs every id once, in order, and one leg that fails does not stop the next` (the first transport call throws; the result has `ok:false` for it and `ok:true` for the second).
  - `counts an answer with status 500 as a failed leg and logs no secret` (the log fields hold the id and the status only).
  - `self transport posts {ent, at} to env.SELF with the jobs secret header` and `api transport posts to <apiUrl>/internal/cron`.
  - `self transport throws a clear error that names the binding SELF when env.SELF is absent`.
- [ ] **Step 2: Run:** `npx vitest run server/enterprise/fanout.test.ts`. Expected: FAIL (file absent).
- [ ] **Step 3: Implement** the four exports. `runFanout` runs `FANOUT_PARALLEL` legs at a time, times each leg with `now`, and never throws.
- [ ] **Step 4: Add the probe routes** to `officeWorker.ts`: `POST /api/internal/probe/fanout` (body `{ kind, count, outside }`) and `POST /api/internal/probe/leg` (body `{ outside }`). Both need the jobs secret header and `MADAR_TEST_TOOLS` on (`testToolsOn`, `server/office/ops.ts`). The leg makes `outside` plain `fetch` calls to `https://madar.vado.sa/api/health` and answers how many succeeded. The fan-out route calls `runFanout` over `count` fake ids with `selfTransport`. Test in `officeWorker.test.ts`: `probe routes answer 404 with no test tools and 401 with a wrong secret`.
- [ ] **Step 5: Write `probe.ts`.** Usage: `npx tsx scripts/proof/cron-fanout/probe.ts --to <page address> --kind self|api --count 15 --outside 40`. It reads the jobs secret from `secrets/test.env` with `parseSecretsFile` (`scripts/deploy/secrets.ts`), prints the JSON of the legs, and never prints the secret.
- [ ] **Step 6: Run** `npm run typecheck` and the two test files. Commit.

```bash
git add server/enterprise/fanout.ts server/enterprise/fanout.test.ts server/entries/officeWorker.ts server/entries/officeWorker.test.ts scripts/proof/cron-fanout wrangler.server.toml
git commit -m "Add the Cron fan-out code and the probe route of spike S1"
```

- [ ] **Lead step: run S1 on the deployed test Worker.** The lead deploys the test Worker and runs the probe for `--kind self` and `--kind api` with `--count` 3, 5 and 15 and `--outside` 0, 20 and 40. The lead then reads one real Cron run in `wrangler tail`. The lead writes the numbers into proof.md, section "S1: Cron fan-out". Rule: choose `self` when every leg stays ok at 15 legs with 40 outside calls each. Else choose `api`. If neither works, the lead stops and asks the owner: the Cron then runs one enterprise in each 15-minute run. The lead sets the default of `MADAR_CRON_TRANSPORT` (Task 14) from this result.

### Task 3: Ids, types and the first guide

**Files:**
- Create: `server/enterprise/ids.ts`, `server/enterprise/ids.test.ts`, `server/enterprise/types.ts`, `server/enterprise/CLAUDE.md`
- Modify: `CLAUDE.md` (root guide table: one line for `server/enterprise/CLAUDE.md`)

**Interfaces:**
- Produces: every export of the contract section "Ids and names" and "Enterprise records", with the same names. Also:
```ts
export const RESERVED_ADDRESSES: readonly string[];            // 'oauth','mcp','api','platform','admin','www'
export function isAddressName(value: unknown): value is string; // ADDRESS_NAME and not reserved
export function normalizeEmail(email: string): string;          // email.trim().toLowerCase()
```
The tag secret shape is `^[A-Za-z0-9_-]{1,300}$` (the sign-in tokens are base64url).

- [ ] **Step 1: Write the tests (they fail first)** (`ids.test.ts`).
  - `isEnterpriseId` accepts `ent_001` and `ent_1234`. It refuses `ent_01`, `ENT_001`, ` ent_001`, `ent_001x`, `42`, `null`.
  - `untag(tagged('ent_002', 'abc_DEF-123'))` equals `{ ent: 'ent_002', secret: 'abc_DEF-123' }`.
  - `untag` gives null for: `abc`, `ent_001.` , `ENT_001.abc`, `ent_001.a.b`, `ent_01.abc`, and a text of 5,000 characters.
  - `isAddressName('vados')` is true. It is false for `oauth`, `Vados`, `a`, `a-`, `-ab`.
  - `normalizeEmail('  Admin@Madar.TEST ')` equals `admin@madar.test`.
  - `ENT_VADO` equals `ent_001`, `VADO_ADDRESS` equals `vados`, `PLATFORM_OBJECT` equals `platform`.
- [ ] **Step 2: Run:** `npx vitest run server/enterprise/ids.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `ids.ts` and `types.ts` as the contract and the interfaces above say.
- [ ] **Step 4: Write `server/enterprise/CLAUDE.md`, first version.** Sections: what the folder holds, the rules "the enterprise never comes from a header, query or body", "an untrusted id passes `entRouter` only", "no fallback for an untagged text". Add the root table line: `| Enterprises | server/enterprise/CLAUDE.md | ids, gate, router, platform object, Cron fan-out |`. If Task 2 declared `EnterpriseId` locally, replace it with the import.
- [ ] **Step 5: Run** the test and `npm run typecheck`. Expected: PASS. Commit.

```bash
git add server/enterprise CLAUDE.md
git commit -m "Add the enterprise ids, tags and types, and the first guide"
```

### Task 4: The `ent` claim in the own tokens and in the checkers

**Files:**
- Modify: `server/auth/own/keys.ts:32-38`, `server/auth/verify.ts:22-23,55-75,88-112`, `server/mcp/auth.ts` (`AgentToken`, `agentTokenChecker`), `server/auth/own/types.ts` (`SigninDeps`), `server/auth/own/sessions.ts:51-54`, `server/mcp/oauth/ops.ts` (`agentAnswer`), `server/auth/own/testOffice.ts`, `server/mcp/oauth/testApp.ts`
- Test: `server/auth/own/keys.test.ts`, `server/auth/verify.test.ts`, `server/mcp/auth.test.ts`, `server/auth/own/ops.signin.test.ts`

**Interfaces:**
- Produces:
```ts
signBrowserToken(keys: SigningKeys, o: { authId: string; sessionId: string; now: Date; ent: EnterpriseId }): Promise<string>;
signAgentToken(keys: SigningKeys, o: { authId: string; sessionId: string; clientId: string; now: Date; ent: EnterpriseId }): Promise<string>;
type TokenChecker = (header: string | null) => Promise<{ authUserId: string; sessionId?: string; ent?: EnterpriseId }>;
type TokenCheckOptions = { issuer: string; jwks: JWTVerifyGetKey; requireEnt?: boolean };
type AgentToken = { ...; ent?: EnterpriseId };
type SigninDeps = Pick<Deps, 'db' | 'clock' | 'log' | 'config'> & { keys: SigningKeys; ent: EnterpriseId };
```
- A browser answer carries a refresh token `tagged(deps.ent, secret)`. The table keeps the sha256 of the bare secret. An agent refresh token stays bare (the MCP address names the enterprise).

- [ ] **Step 1: Write the tests (they fail first).**
  - `keys.test.ts`: `signs the ent claim into a browser token and into an agent token`.
  - `verify.test.ts`: `returns ent from a token of the own key`; `refuses an own-key token with no ent as unauthenticated`; `refuses an ent that is not an enterprise id`; `accepts a token with no ent on the Supabase key and returns no ent` (the Postgres way back).
  - `mcp/auth.test.ts`: `returns ent of an agent token`.
  - `ops.signin.test.ts`: `a password sign-in gives a token with the claim ent and a refresh token that untag reads as {ent, secret}`; `a refresh with the bare secret rotates the session`.
- [ ] **Step 2: Run:** `npx vitest run server/auth server/mcp/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `browserTokenChecker` reads `payload.ent`; with `requireEnt` a missing or bad value throws `signIn()`. `checkerFromEnv` sets `requireEnt: true` in the own-key branch only. `browserAnswer` tags the refresh token. `agentAnswer` passes `ent`. Fix every `SigninDeps` maker that `tsc` names with `ent: ENT_VADO`.
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS. Commit.

```bash
git add server/auth server/mcp
git commit -m "Put the ent claim in the own tokens and read it in the token checkers"
```

### Task 5: The `enterprise` table and the gate

**Files:**
- Modify: `server/data/lite/schema.ts:45,138-170,208-221` (version 14, table in `SERVER_SQL`, step 14), `server/data/lite/schema.test.ts:11,329` (version and `PINNED_SHA256`), `server/office/ops.ts` (`EXPORT_SKIP` gets `'enterprise'`)
- Create: `server/enterprise/gate.ts`, `server/enterprise/gate.test.ts`
- Test: also `server/office/ops.test.ts`

**Interfaces:**
- Table (also the text of step 14): `create table enterprise (id text primary key, state text not null, limits text not null, created_at text not null)`. One row at most.
- Produces:
```ts
export type EnterpriseObjectRow = { id: EnterpriseId; state: EnterpriseState; limits: EnterpriseLimits; createdAt: string };
export class EnterpriseGate {
  constructor(db: Pick<LiteDb, 'statement' | 'tx'>, o?: { name?: () => string | undefined });
  load(): Promise<EnterpriseObjectRow | undefined>;       // one read, kept in memory
  id(): EnterpriseId;                                     // sync; throws before load found a row
  refusal(ent: unknown, o?: { allow?: 'paused' }): Promise<RunError | undefined>;
  create(row: { id: EnterpriseId; state: EnterpriseState; limits: EnterpriseLimits; now: Date }): Promise<void>;
}
```
- Refusals: no row gives `not_found` ("This address does not exist."). A malformed `ent`, another `ent`, or a row id that differs from `name()` gives `unauthenticated` ("Sign in to continue.") with no reason. A paused row gives `forbidden` with `reason: 'enterprise_paused'`, unless `allow: 'paused'`.
- Lead decision: `signin`, `mailRoute`, `mailWork`, `status`, `health` and the later `setState` call the gate with
  `allow: 'paused'`. Plan C adds the paused rule of each sign-in step (only `auth.password` runs, and it answers
  `enterprise_paused` after a correct password). Until plan C, no code can pause an object.
- `EXPORT_SKIP` holds `enterprise`: a backup of `ent_002` must never write its identity into another object. The platform object holds the master copy of state and limits.

- [ ] **Step 1: Write the tests (they fail first)** (`gate.test.ts`, on `nodeHost` and `applyLiteSchema`).
  - `gives not_found when the object has no row`.
  - `creates the row once; a second create with another id throws conflict and changes nothing`.
  - `refuses another id, a malformed id and a value that is no text with one answer` (the three answers are equal).
  - `refuses a paused object with enterprise_paused, except when the call allows paused`.
  - `refuses every call when name() differs from the row id`; `accepts when name() is undefined`.
  - `loads the row once for many checks` (count the reads with a spy on `statement`).
  - In `schema.test.ts`: update the pin and add `a new office has an empty enterprise table`. In `ops.test.ts`: `an export lists no enterprise table`.
- [ ] **Step 2: Run:** `npx vitest run server/enterprise/gate.test.ts server/data/lite/schema.test.ts server/office/ops.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema change (version 14, step 14, the comment block of the version history) and the gate. Take the new `PINNED_SHA256` from the first run that fails. If S3 (proof.md, Task 1) says the name is not stable, `name` stays unused and the gate uses the row only.
- [ ] **Step 4: Run** the same command, `npm run test:lite` and `npm run typecheck`. Expected: PASS. Commit.

```bash
git add server/data/lite server/enterprise/gate.ts server/enterprise/gate.test.ts server/office/ops.ts server/office/ops.test.ts
git commit -m "Add the enterprise table at schema version 14 and the gate that checks ent"
```

### Task 6: The gate in every object method, `status()`, the row at import

**Files:**
- Modify: `server/office/parts.ts` (`PartsInput`, every method, `OfficeCronReport`), `server/office/batch.ts:30` (`OfficeBatchInput`), `server/office/office.ts`, `server/office/import.ts` and the `ops` method of `parts.ts` (import begin), `server/entries/officeWorker.ts:78-88` (`OfficeStub` gets `status`), `server/core/ports.ts` (`Config.ent?: EnterpriseId`)
- Create: `server/enterprise/status.ts`
- Test: `server/office/enterprise.test.ts` (new, node), `server/office/enterprise.wd.test.ts` (new, workerd), plus the callers that `tsc` names: `server/office/{routes,parts,import,cap,ops}.test.ts`, `server/office/test/{nodeOffice,pinOffice}.ts`, `server/office/test/live/{entry,harness,testOffice}.ts`

**Interfaces:**
- Consumes: `EnterpriseGate` (Task 5).
- Produces: `ent: EnterpriseId` on `OfficeBatchInput`, `OfficeCronInput`, `OfficeSigninInput`, `OfficeMailInput`, `OfficeMailWork`, `OfficeMcpInput`, `OfficeEffectsInput` (all required). `PartsInput.name?: () => string | undefined`. `OfficeParts.status(input: { ent: EnterpriseId }): Promise<EnterpriseStatus>`. `OfficeCronReport` gets `status: EnterpriseStatus`. `deps.config.ent` is set by `depsFor` from `gate.id()`.
- Order of work in each method: the gate first, then the hold and the cap. A refusal has the shape of that method: `{ ok:false, error }` for `batch` and `signin`, `mailRefusal` for `mailRoute`, `mcpRefusal(401, ...)` for `mcp`, and a thrown `ApiError` for `runEffects`, `cron`, `mailWork` and `status`. `health` and `ops` skip the gate (the secret guards `ops`). `status` allows a paused object.
- `statusOf(db, office, day)` in `status.ts`: `people` is the active human users in the office snapshot; `invited` is `select count(*) from auth_users where password_set = 0 and banned = 0 and user_id is not null`; `lastWriteAt` is the newest `created_at` of `events` (one row through its index); `day` is the day row (`DayRow`) plus `mails` from `mail_log` for the UTC day; `storageBytes` is `0` (plan C adds the stored total); `name` and `nameAr` come from the keys `enterpriseName` and `enterpriseNameAr` of the settings doc when they exist, else `''`.
- The `ops` import `begin` step makes the row when the object has none and the header `x-madar-office-name` (`OFFICE_NAME_HEADER`) holds an enterprise id: `gate.create({ id, state: 'active', limits: { people: null, storageBytes: null }, now })`. A rehearsal name or `office` makes no row.

- [ ] **Step 1: Write the tests (they fail first).** In `enterprise.test.ts` (use `nodeOffice`, Task 8 widens it):
  - `a batch with the right ent runs`; `a batch with ent_002 on the object of ent_001 gives unauthenticated and writes no row`.
  - `every method refuses a wrong ent` (a loop over `batch`, `runEffects`, `cron`, `signin`, `mailRoute`, `mailWork`, `mcp`, `status`; check each refusal shape).
  - `an object with no row gives not_found on every method`.
  - `a paused object refuses all methods except status and health`.
  - `status gives people, invited, lastWriteAt and a day with four counts` on the sample office.
  - `an import begin on a new object named ent_002 makes the row; a second begin keeps it; the name office and a rehearsal name make none`.
  - In `enterprise.wd.test.ts`: `status reads at most 6 rows on the sample office`, and `the object reports its own name when S3 allows it` (skip this test if proof.md says no).
- [ ] **Step 2: Run:** `npx vitest run server/office/enterprise.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Create the gate in `officeParts` with `name: o.name`; `Office` passes `() => ctx.id.name`. Add `status` to `Office` as an RPC method. Add `ent: ENT_VADO` to every test caller that `npm run typecheck` names. `nodeOffice` and `TestOffice.seed` call `gate.create` for `ENT_VADO`.
- [ ] **Step 4: Run** `npm run typecheck`, the node tests above, `npm run test:lite`, `npm run test:office`. Expected: PASS. If the cold wake pin (`COLD_EXTRA_ROWS`, `server/office/test/pins.ts`) fails, the reason goes into proof.md in the section of Task 1. Commit.

```bash
git add server/office server/enterprise/status.ts server/entries/officeWorker.ts server/core/ports.ts
git commit -m "Check ent in every method of the office object and add status"
```

### Task 7: The platform object

**Files:**
- Create: `server/enterprise/platform/{schema,stub,parts,object}.ts`, `server/enterprise/platform/parts.test.ts`, `server/office/platform.wd.test.ts`
- Modify: `server/data/lite/schema.ts` (export `serverTableSql(names: readonly string[]): string[]`, which gives the create statements and the index statements of the named server tables), `server/entries/workerMain.ts` (export `Platform`), `wrangler.server.toml`, `server/office/test/live/wrangler.{toml,bundle.toml,local.toml}`, `scripts/deploy/wranglerServer.test.ts:104-109`

**Interfaces:**
- Produces: `PlatformStub` as the contract says (`resolveEmail`, `resolveAddress`, `listed`, `reserveEmail`, `releaseEmail`, `isOwner`, `setOwners`, `report`, `meter`, `mailReserve`), in `stub.ts` with `CapAnswer`. Also these methods:
```ts
register(input: { row: EnterpriseRow; emails: string[] }): Promise<void>;                       // ops secret only; upsert, any state
refuseSignin(input: { signin: 'auth.password' | 'auth.verify' | 'auth.refresh'; input: unknown }): Promise<OpResult<unknown>>;
refuseMail(input: Omit<OfficeMailInput, 'ent'>): Promise<OfficeMailAnswer>;                      // route 'forgot' | 'renew'
sweep(input: { at: string }): Promise<void>;
health(): Promise<{ schema: number }>;
```
- `platformParts({ host, clock, log, read })` holds the work, so node tests use `nodeHost`. `Platform` (class, `object.ts`) wraps it as `Office` does. `PLATFORM_SCHEMA_VERSION = 1` and `PLATFORM_STEPS` follow the pattern of `applyLiteSchema`.
- Tables: `enterprises (id pk, address unique, state, name, name_ar, limits, created_at, first_admin)`, `emails (email pk, ent)`, `owners (ent, user_id, pk both)`, `status (ent pk, doc, at)`, `account_day (day, ent, requests, rows_read, rows_written, mails, pk day+ent)`, and the tables `rate_limits`, `auth_users`, `auth_links`, `auth_sessions` from `serverTableSql` (empty, only for `refuse*`).
- Rules. `listed()` gives ids with state `active` or `paused`, never `creating`. `resolveAddress` follows the same rule. `reserveEmail` answers `ok` again for the same enterprise and `taken` for another one. `releaseEmail` of another enterprise changes nothing. `register` throws `conflict` when an email belongs to another enterprise. `meter` stores the cumulative day counts for `(ent, day)` and replaces the old values, so a repeat of the same report adds nothing; it answers `{ allowed: true }`. `report` keeps the old name when the new name is `''`. `mailReserve` answers `'ok'` (plan D replaces it). `refuseSignin` runs the real step (`runSigninOp` with `passwordSignIn`, `verifySignInLink` or `refreshSignIn`) on the empty tables, with a `keys` value that throws when read, so the limits count and one PBKDF2 runs. `refuseMail` runs `createForgotRoute` or `createRenewRoute` with `minMs: 0` and a work function that does nothing. `sweep` runs `RATE_LIMITS_CLEANUP_LITE` (`server/jobs/steps/cleanup.ts`) with the time `at` minus `RATE_LIMIT_KEEP_MS`.

- [ ] **Step 1: Write the tests (they fail first)** (`parts.test.ts`).
  - `resolves a known email, and gives null for an unknown one`.
  - `reserveEmail: ok, ok again for the same enterprise, taken for another; releaseEmail frees it and a release by another enterprise does nothing`.
  - `listed and resolveAddress leave out a creating enterprise`.
  - `register upserts a row, reserves its emails, and throws conflict for an email of another enterprise`.
  - `setOwners replaces the list and isOwner follows it`.
  - `meter replaces the counts of (ent, day) and the account total sums two enterprises`; `report keeps the name when the new name is empty`.
  - `refuseSignin password answers invalid_credentials and counts the limits like the object: the 11th try for one email answers too_many`; `refuseSignin verify answers link_ended`; `refuseSignin refresh answers session_ended`.
  - `refuseMail forgot answers 200 {"v":1,"ok":true} for a good email, 400 for a bad email, and the too-many answer after the limit, like the object`; `refuseMail renew` the same.
  - `sweep deletes old rate limit rows only`; `applyPlatformSchema twice is a no-op`.
  - In `platform.wd.test.ts`: `resolveEmail reads 1 row for a hit and 1 for a miss` and `the class answers the methods over RPC after an evict`.
- [ ] **Step 2: Run:** `npx vitest run server/enterprise/platform` . Expected: FAIL.
- [ ] **Step 3: Implement** the files. Add to `wrangler.server.toml` the binding `PLATFORM` (class `Platform`) at the top level and in `[env.test]`, and a second `[[migrations]]` with `tag = "platform-v1"` and `new_sqlite_classes = ["Platform"]`. `[env.production]` keeps `migrations = []` (plan E adds both at the switch). Add the same binding and migration to the three test configs. Update `wranglerServer.test.ts` for the new binding and tag.
- [ ] **Step 4: Run** the tests above, `npm run build:server` (no `cloudflare:workers` in the Supabase bundles), `npm run typecheck`, `npm run test:office`. Expected: PASS. Commit.

```bash
git add server/enterprise/platform server/data/lite/schema.ts server/entries/workerMain.ts wrangler.server.toml server/office/test/live scripts/deploy/wranglerServer.test.ts server/office/platform.wd.test.ts
git commit -m "Add the platform object with the directory, the owners and the meters"
```

### Task 8: Routing core, the listed cache and the node world

**Files:**
- Create: `server/enterprise/router.ts`, `server/enterprise/router.test.ts`, `server/enterprise/pad.ts`, `server/office/test/nodeWorld.ts`
- Modify: `server/entries/officeWorker.ts:94-108,137-167,236-248` (options, `OfficeCall`, `batch`, `health`), `server/entries/officeEntry.ts:48-65`, `server/office/test/nodeOffice.ts`, `server/office/test/live/entry.ts`, `server/entries/officeWorker.test.ts`, `server/entries/officeSignin.test.ts`

**Interfaces:**
- Produces:
```ts
// router.ts
export type EntStub = { ent: EnterpriseId; stub: OfficeStub };
export type EntRouter = {
  stub(ent: EnterpriseId): OfficeStub;                         // for an ent from a verified token only
  listedStub(ent: unknown): Promise<EntStub | null>;           // shape check, then the listed cache
  addressStub(address: unknown): Promise<EntStub | null>;      // isAddressName, then platform.resolveAddress
};
export function entRouter(o: { stubFor: (ent: EnterpriseId) => OfficeStub; platform: Pick<PlatformStub, 'listed' | 'resolveAddress'>; now?: () => number; ttlMs?: number; missMs?: number }): EntRouter;
export const LISTED_TTL_MS = 60_000;
export const LISTED_MISS_MS = 5_000;
// pad.ts
export function padTo(startedAt: number, minMs: number, sleep: (ms: number) => Promise<void>, now?: () => number): Promise<void>;
// officeWorker.ts
OfficeRoutesOptions = { ...; verifyToken: (h: string | null) => Promise<{ authUserId: string; ent?: EnterpriseId }>; stubFor: (env: Env, ent: EnterpriseId) => OfficeStub; platform: (env: Env) => PlatformStub; ... }  // `stub` is removed
OfficeCall = { router: EntRouter; platform: PlatformStub; net: () => NetApi; after?: After }          // `stub` is removed
// officeEntry.ts
stubFor(env, ent) = namespace.get(namespace.idFromName(ent)); platformStub(env) = env.PLATFORM.get(env.PLATFORM.idFromName(PLATFORM_OBJECT))
```
- A token with no `ent` (the Supabase key on an office copy) routes to `ENT_VADO`. A token of the own key always has `ent` (Task 4).
- `health` gives only the base. With the jobs secret it adds `office: <health of ENT_VADO>` when `ENT_VADO` is listed. It reads no other enterprise.
- `nodeWorld({ ents?: EnterpriseId[] , seeds?: ... })` builds one platform and one object for each id on node:sqlite, with `route()` through the real Worker routes and a `stubFor` spy (`t.created` lists the names that `stubFor` got). `nodeOffice()` becomes `nodeWorld` with one enterprise `ENT_VADO` and keeps its old return fields. It adds `signins(rows)`: imports sign-in rows into the object and reserves their emails in the platform. Tests that imported sign-in rows by hand use `signins`.

- [ ] **Step 1: Write the tests (they fail first)** (`router.test.ts`).
  - `stubFor is never called for an id that the platform does not list`; `a malformed id never reaches the platform`.
  - `keeps the list for 60 s and reads it once`.
  - `a miss reads the list again when the list is 5 s old, and does not when it is 1 s old`.
  - `an address resolves through the platform and is kept for 60 s; a reserved or malformed address never reaches the platform`.
  - In `officeWorker.test.ts`: `a batch goes to the stub of the ent in the token`; `a header x-madar-ent, a query ent and a body ent change nothing`; `health names no enterprise and, with the secret, shows only ENT_VADO`.
- [ ] **Step 2: Run:** `npx vitest run server/enterprise/router.test.ts server/entries/officeWorker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the router, the pad, the option change, `officeEntry`, `nodeWorld`, and the live test Worker (`entry.ts`: `verifyToken` reads `Bearer <ent>:<usr>` or `Bearer <usr>` for `ENT_VADO`; the platform binding comes from Task 7). Fix every caller that `tsc` names.
- [ ] **Step 4: Run** `npm run typecheck`, `npx vitest run server/entries server/office server/enterprise`, `npm run test:lite`, `npm run test:office`. Expected: PASS. Commit.

```bash
git add server/enterprise server/entries server/office
git commit -m "Route each batch by the ent claim and add the router and the listed cache"
```

### Task 9: Password sign-in by email, and the tags of links and refresh tokens

**Files:**
- Modify: `server/entries/officeSignin.ts:23-45,91-97`, `server/auth/own/office.ts:49-56` (`SigninOffice.run` gets an optional third parameter `ent`), `server/auth/own/routes.ts:39-49,51-106` (`signedIn` gives `ent`; each signed-in step passes it), `server/auth/mail.ts:65`, `server/auth/invite.ts:282`, `server/auth/forgot.ts:105`, `server/office/parts.ts` (`signin` passes `ent` into `SigninDeps`)
- Test: `server/entries/officeSignin.test.ts`, `server/auth/mail.test.ts`, `server/auth/invite.test.ts`, `server/auth/own/routes.test.ts`, `server/office/routes.test.ts`

**Interfaces:**
- Produces: `signinLink(appUrl, screen, tokenHash, type, renew?, ent?)`. With `ent` it writes `token_hash=<ent>.<token>` and `renew=<ent>.<key>`. Without `ent` the text is as today. `invite.ts` and `forgot.ts` pass `deps.config.ent`.
- `enterpriseSigninOffice(call)` in `officeSignin.ts` implements `SigninOffice` on the Worker:
  - `auth.password`: `ent` from `platform.resolveEmail({ email: normalizeEmail(email) })`. Found: `stubFor(ent).signin({ ent, signin, input })`. Not found: `platform.refuseSignin({ signin, input })`.
  - `auth.refresh` and `auth.verify`: `untag` the refresh token or the link token. A tag that `router.listedStub` accepts goes to that object with the bare secret. Every other text (untagged, unlisted, malformed) goes to `platform.refuseSignin` with the text as it came.
  - Every other step: the third parameter `ent` of `run` (from the token claim), through `router.stub(ent)`.
  - `localSigninOffice` (inside the object) ignores the third parameter.
- The `SigninOffice` of a route is made for each request from `OfficeCall` (the `NO_OFFICE` stub trick of the old file goes away: the route list needs only the paths).

- [ ] **Step 1: Write the tests (they fail first).**
  - `officeSignin.test.ts`: `sends a password sign-in to the object of the enterprise of the email` (email of `ent_002` gives a `stubFor` call with `ent_002`); `normalizes "  Admin@Madar.TEST " before the directory read`; `an unknown email goes to refuseSignin, calls no object, and gives the same status and body as a wrong password`; `a refresh token tagged ent_002 reaches ent_002 with the bare secret`; `an untagged refresh token, an unlisted tag, ENT_001.abc, ent_001.a.b and a tag of 5,000 characters all go to refuseSignin and make no stub`; `auth.verify does the same`; `a signed-in step gets the ent of the token`.
  - `mail.test.ts`: `signinLink tags the token and the renew key when ent is given, and is unchanged without ent`.
  - `invite.test.ts` (lite): `the invitation mail of an office object holds a tagged link, and the Postgres path holds an untagged link`.
  - `office/routes.test.ts`: `a sign-in, a refresh and a link open run end to end through the Worker with tagged tokens`. Tests that read a link from `mail_outbox` and call a step directly strip the tag with `untag`.
- [ ] **Step 2: Run:** `npx vitest run server/entries/officeSignin.test.ts server/auth server/office/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as the interfaces say. `depsFor` in `parts.ts` already sets `deps.config.ent` (Task 6).
- [ ] **Step 4: Run** the same command, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. Expected: PASS. Commit.

```bash
git add server/entries server/auth server/office
git commit -m "Find the enterprise of a sign-in by email, and tag links and refresh tokens"
```

### Task 10: Forgot and renew routes by email and by key tag

**Files:**
- Modify: `server/entries/officeSignin.ts:47-78` (`mailRoute`), `server/auth/forgot.ts:72` (export the body schema as `ForgotBody`), `server/auth/renew.ts:75` (export `RenewBody`)
- Test: `server/entries/officeSignin.test.ts`, `server/office/routes.test.ts`

**Interfaces:**
- The Worker route reads the body text once. `forgot`: parse with `ForgotBody`, `normalizeEmail`, `platform.resolveEmail`. `renew`: parse with `RenewBody`, `untag(key)`, `router.listedStub`. A good id calls `stub.mailRoute({ ent, route, body, address })` with the bare key in the body for `renew`, then `mailWork` as today. Any other case calls `platform.refuseMail({ route, body, address })` and runs no work. A body that does not parse also goes to `refuseMail`, which answers the same 400 as the object.
- The minimum answer time (`FORGOT_MIN_MS`, `RENEW_MIN_MS`) applies to every branch through `padTo`.

- [ ] **Step 1: Write the tests (they fail first).**
  - `forgot of a known email goes to its object: mailRoute, then mailWork`.
  - `forgot of an unknown email calls refuseMail and no mailWork, and gives the same body, and waits the same minimum time as a known email` (inject `sleep`, compare the recorded waits).
  - `forgot over the limit gives the same too-many answer for a known and an unknown email` (use `nodeWorld`).
  - `renew with a key tagged ent_002 gives the object the bare key`; `an untagged key and an unlisted tag go to refuseMail and give the answer of a key that no row holds`.
- [ ] **Step 2: Run:** `npx vitest run server/entries/officeSignin.test.ts server/office/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS. Commit.

```bash
git add server/entries/officeSignin.ts server/auth/forgot.ts server/auth/renew.ts server/entries/officeSignin.test.ts server/office/routes.test.ts
git commit -m "Route forgot and renew by email and by key tag with one answer for every case"
```

### Task 11: The tag in the socket ticket

**Files:**
- Modify: `server/office/live.ts:35-90,168-190` (`LiveTickets`, `TICKET_SHAPE`, `acceptLive`), `server/office/parts.ts` (`socket`), `server/entries/officeWorker.ts:226-234` (`live`), `src/api/contract/server.ts:128-132` (the `liveTicket` output)
- Test: `server/office/live.test.ts`, `server/office/socket.wd.test.ts`, `server/entries/officeWorker.test.ts`, `src/api/contract/*.test.ts` that name `live.ticket`

**Interfaces:**
- `new LiveTickets(ent: () => EnterpriseId)`. `mint` answers `{ ticket: tagged(ent(), hex64), expiresAt }`. The map keeps the bare hex. `TICKET_SECRET_SHAPE = /^[0-9a-f]{64}$/`. `TICKET_SHAPE = /^ent_\d{3,}\.[0-9a-f]{64}$/` (the tagged form).
- The contract output of `live.ticket` accepts both forms: `/^(ent_\d{3,}\.)?[0-9a-f]{64}$/` (additive).
- `acceptLive` gets `ent: () => EnterpriseId`. It untags the ticket, compares the tag with `ent()` before it takes the ticket, and then takes the bare secret. An untagged ticket, a wrong tag and an unknown ticket give the same `TICKET_REFUSED`.
- The Worker `live` route checks `TICKET_SHAPE`, then `router.listedStub(untag(...).ent)`. A failure answers `TICKET_REFUSED` after `padTo` and makes no object. A good tag forwards the request unchanged to that stub.

- [ ] **Step 1: Write the tests (they fail first).**
  - `live.test.ts`: `mint gives ent_001.<64 hex>`; `take of the bare secret works once`; `a ticket with the tag of another enterprise is refused and the ticket still works for its own enterprise`; `an untagged 64-hex ticket is refused`.
  - `officeWorker.test.ts`: `a ticket with a bad shape or an unlisted tag gets TICKET_REFUSED, waits the minimum time and makes no stub`; `a listed tag reaches that object`.
  - `socket.wd.test.ts`: `a socket opens with the tagged ticket of its own enterprise`.
  - `src/api`: `the live.ticket output accepts the tagged and the bare form`.
- [ ] **Step 2: Run** the node tests and then the wd test. Expected: FAIL.
- [ ] **Step 3: Implement.** Check `src/api/handlers/serverFakes.ts` (the fake of `live.ticket`) still parses with `npx vitest run src/api`.
- [ ] **Step 4: Run** all the tests above, `npm run typecheck`, `npm run test:office`. Expected: PASS. Commit.

```bash
git add server/office server/entries/officeWorker.ts server/entries/officeWorker.test.ts src/api/contract
git commit -m "Tag the live socket ticket with the enterprise and check the tag in the object"
```

### Task 12: The MCP address of each enterprise

**Files:**
- Modify: `server/enterprise/router.ts` (add `mcpAddressOf`), `server/entries/officeWorker.ts:174-200` (`mcp`), `server/office/parts.ts:377-430` (`mcp`), `server/mcp/auth.ts` (the check of `ent`), `server/mcp/docs.ts` (`INSTRUCTIONS`, one sentence), `server/http/pagesWellKnown.ts:12-17`
- Test: `server/enterprise/router.test.ts`, `server/entries/officeWorker.test.ts`, `server/office/mcp.wd.test.ts`, `server/office/routes.test.ts`, `server/mcp/oauth/sdk.test.ts`, `server/http/pagesWellKnown.test.ts`, `server/mcp/enterpriseDocs.test.ts` (new)

**Interfaces:**
- Produces:
```ts
export type McpAddress = { address: string | null; rest: string } | 'bad';
export function mcpAddressOf(pathname: string): McpAddress;
```
`/mcp` and `/mcp/` give `{ address: null, rest: '/mcp' }`. A first segment that starts with `.` or equals `oauth` is a path word of the VADO address: `/mcp/oauth/token` gives `{ address: null, rest: '/mcp/oauth/token' }`. A first segment that `isAddressName` accepts gives `{ address, rest: '/mcp' + remainder }`. Any other first segment gives `'bad'`.
- `OfficeMcpInput` gets `ent` and `mcpUrl`. The Worker builds `mcpUrl` from `deps.config.mcpUrl` (never from the request host): `config.mcpUrl` for `ENT_VADO` without an address, else `config.mcpUrl + '/' + address`. It rewrites the URL path to `rest` and keeps the query. The object refuses an `mcpUrl` that does not start with its own `config.mcpUrl`.
- In the object, for one request: the config copy, the `SigningKeys` (`issuer` and `mcpUrl` set to the address), the metadata, the challenge, the audience and the OAuth routes all use `input.mcpUrl`. The agent token check refuses a token whose `ent` differs from the row (`signInAgain`, 401). `AgentToken.ent` comes from Task 4.
- A `'bad'` address, or an address that the platform does not list, gets the JSON-RPC 401 of a missing token ("Sign in to continue.", the `WWW-Authenticate` challenge for that URL) and makes no object. `ENT_VADO` with no address needs no platform read.
- `proxyWellKnown` also maps `/.well-known/<oauth-authorization-server|openid-configuration>/mcp/<address>` to `/mcp/<address>/.well-known/<name>` when `<address>` passes `isAddressName`. Nothing else passes.
- `INSTRUCTIONS` gets one sentence: "You act for one person of one enterprise." Plan D rewrites the examples. The tool list and `TOOL_DOCS` do not change.

- [ ] **Step 1: Write the tests (they fail first).**
  - `router.test.ts`: `mcpAddressOf` table: `/mcp`, `/mcp/`, `/mcp/oauth/token`, `/mcp/.well-known/oauth-authorization-server` give a null address; `/mcp/globex` gives `rest: '/mcp'`; `/mcp/globex/oauth/token` gives `rest: '/mcp/oauth/token'`; `/mcp/Globex`, `/mcp/a` and `/mcp/g%6Cobex` give `'bad'`.
  - `officeWorker.test.ts`: `an unknown address gets the 401 of a missing token and makes no stub`; `the object gets the rewritten path and mcpUrl = <config.mcpUrl>/globex`; `/mcp/oauth/token goes to ENT_VADO`.
  - `mcp.wd.test.ts` (two objects): `an agent token of ent_001 sent to /mcp/globex gets 401`; `a token issued under /mcp/globex has issuer and audience with the address, and works only there`; `the metadata under /mcp/globex/.well-known/... names the issuer with the address`; `oauth/register under the address writes the client in that object only`.
  - `pagesWellKnown.test.ts`: the new map, and a refusal of `Globex`, a second segment and a path word.
  - `enterpriseDocs.test.ts`: `INSTRUCTIONS holds "one person of one enterprise"`.
- [ ] **Step 2: Run** the node tests, then `mcp.wd.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check `server/mcp/CLAUDE.md` parity rules: no tool changes, so `npx vitest run server/mcp` stays green.
- [ ] **Step 4: Run** `npm run typecheck`, `npx vitest run server/mcp server/http server/enterprise server/entries`, `npm run test:office`. Expected: PASS. Commit.

```bash
git add server/enterprise/router.ts server/enterprise/router.test.ts server/entries server/office server/mcp server/http
git commit -m "Serve each enterprise on its own MCP address and check ent in the agent token"
```

### Task 13: Ops routes by enterprise id, and the platform ops

**Files:**
- Modify: `server/entries/officeWorker.ts:42-56,206-224` (`OPS`, `nameAllowed`, `ops`), `scripts/office/ops.ts`, `scripts/office/import.ts:57,170-182` (accept `--office ent_NNN`), `tests/e2e-deploy/office.ts` (the default name)
- Test: `server/entries/officeWorker.test.ts`, `server/office/ops.wd.test.ts`, `scripts/office/import.test.ts`

**Interfaces:**
- Name rules: `export` and `import` take `OFFICE_NAME`, a rehearsal name, or an id that `router.listedStub` accepts. `peek` takes `OFFICE_NAME` or such an id. `drop` takes a rehearsal name only. Without `?office=` the name is `ENT_VADO`. An id that the platform does not list gives 403 and makes no object.
- Two new ops, both with the ops secret: `POST /api/office/platform-register` (body `{ row, emails }`, validated with zod against `EnterpriseRow`) calls `platform.register`; `POST /api/office/platform-owners` (body `{ owners }`) calls `platform.setOwners`. They take no `?office=`.
- The import tool accepts `--office ent_NNN` (an `ENTERPRISE_ID` or a rehearsal name). The rule "a copy of production goes only into a rehearsal name" stays.

- [ ] **Step 1: Write the tests (they fail first).**
  - `export of ent_002 reaches the ent_002 stub; export of an unlisted ent_009 gives 403 and makes no stub`.
  - `peek without ?office= reaches ENT_VADO`; `drop of an enterprise id gives 403`.
  - `platform-register needs the ops secret (401 otherwise), refuses a bad row with 400, and calls platform.register`; `platform-owners` the same.
  - `ops.wd.test.ts`: `an import into ent_002 never writes to the object of ent_001`.
  - `import.test.ts`: `--office accepts ent_002 and a rehearsal name, and refuses office and ent_2`.
- [ ] **Step 2: Run:** `npx vitest run server/entries/officeWorker.test.ts scripts/office/import.test.ts` then `ops.wd.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, `npm run typecheck`, `npm run test:office`. Expected: PASS. Commit.

```bash
git add server/entries scripts/office tests/e2e-deploy/office.ts server/office/ops.wd.test.ts
git commit -m "Take enterprise ids in the ops routes and add the platform register and owners ops"
```

### Task 14: The Cron fan-out and the status report

**Files:**
- Modify: `server/entries/officeWorker.ts:278-302` (`scheduled`, new route `CRON_PATH`), `server/entries/officeEntry.ts:68-80`, `server/entries/workerMain.ts`, `wrangler.server.toml` (var `MADAR_CRON_TRANSPORT`, default from the Lead step of Task 2)
- Test: `server/entries/officeWorker.test.ts`, `server/office/cron.wd.test.ts`, `server/enterprise/fanout.test.ts`

**Interfaces:**
- `scheduled(at, env)`: read `platform.listed()` (log and return when it throws), then `runFanout({ ids, at, transport, log })`. `transport` comes from the new option `fanout?: (env) => FanoutTransport` (default `selfTransport(env, { kind: MADAR_CRON_TRANSPORT, secret: jobsSecret, apiUrl })`). It returns `{ legs }`.
- The route `POST CRON_PATH` needs the jobs secret (`sameSecret`). Body `{ ent, at }`. It runs `cronLeg(ent, at)`:
  1. `router.listedStub(ent)`; unlisted gives 404.
  2. `stub.cron({ ent, at, worker: reported() }, net)`. On success `platform.report(report.status)` and `platform.meter({ ent, day: utcDay(at), counts: report.status.day })`.
  3. On any error: log it, then `stub.status({ ent })` and `platform.report(status)` (a paused object still answers `status`).
  4. The first run after 00:00 UTC also calls `platform.sweep({ at })` once.
- The sign-in cleanup step stays in each object (`SIGNIN_STEP`, `server/office/jobs.ts`).

- [ ] **Step 1: Write the tests (they fail first).**
  - `scheduled lists the enterprises and sends one leg for each id`.
  - `a first leg that fails does not stop the second`.
  - `a leg reports the status and the meter of its enterprise to the platform`.
  - `a paused enterprise (cron throws) still reports its status`.
  - `the cron route gives 401 without the jobs secret and 404 for an unlisted id`.
  - `the first run after 00:00 UTC calls sweep once; the run at 06:15 does not`.
  - `cron.wd.test.ts`: `two enterprises run the 15-minute job each in its own object, and the day rows stay apart`.
- [ ] **Step 2: Run** the node file and then `cron.wd.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The report line in the log names ids and counts only.
- [ ] **Step 4: Run** the tests, `npm run typecheck`, `npm run test:office`. Expected: PASS. Commit.

```bash
git add server/entries server/enterprise/fanout.test.ts server/office/cron.wd.test.ts wrangler.server.toml
git commit -m "Run the Cron as one leg for each listed enterprise and report status to the platform"
```

### Task 15: Two enterprises on the local stack

**Files:**
- Create: `scripts/office/enterprise.ts`, `scripts/office/enterprise.test.ts`
- Modify: `scripts/office/seed.ts:67-95` (`seedSource` stays; the main function seeds `ent_001`), `scripts/dev/office-local.ts:117-124`, `scripts/dev/office-smoke.ts`, `server/office/test/live/wrangler.local.toml`, `server/office/test/live/wrangler.bundle.toml`, `tests/CLAUDE.md` (one line)

**Interfaces:**
- `scripts/office/enterprise.ts`:
```ts
export const SAMPLE_ENTERPRISE: EnterpriseRow;                  // ent_001, address 'vados', name "VADOs' Companies", nameAr 'شركات فادو'
export const FAKE_ENTERPRISE: EnterpriseRow;                    // ent_002, address 'globex', name 'Globex Test Company'
export function fakeEnterpriseSource(o: { now: Date; passwords: Readonly<Record<string, string | undefined>> }): Promise<OfficeSource>;
export async function registerEnterprise(base: string, secret: string, input: { row: EnterpriseRow; emails: string[] }): Promise<void>;  // POST /api/office/platform-register
```
- `fakeEnterpriseSource` builds a small `State` with `emptyState` and the factories of `src/test/factories.ts`: two people `usr_001` (Admin) and `usr_002`, one project `prj_001` and one task `tsk_001`, with names that differ from the sample office. Their emails use `@globex.test`. The sign-in rows come from the same password rules as `seedSource`.
- `office-local.ts` registers both enterprises (emails from `source.signin`), then seeds each with `importOffice(opsOf({ ..., office: id }), source, { mode: 'replace' })`. `run.env` adds `MADAR_E2E_SECOND_ENTERPRISE=ent_002`. The smoke registers `ENT_VADO`, then makes its row through an import `begin` with mode `empty` and an `abort`, and its checks use `LITE_SCHEMA_VERSION` in place of the literal 3.

- [ ] **Step 1: Write the tests (they fail first)** (`enterprise.test.ts`).
  - `FAKE_ENTERPRISE and SAMPLE_ENTERPRISE pass the EnterpriseRow rules (id, address, reserved words)`.
  - `fakeEnterpriseSource has usr_001, usr_002, prj_001 and tsk_001, and no email of the sample office`.
  - `fakeEnterpriseSource has the same record ids as the sample office with other names` (compare `prj_001` titles).
  - `registerEnterprise posts the ops secret in the header only` (fake fetch).
- [ ] **Step 2: Run:** `npx vitest run scripts/office`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the three local configs with the `PLATFORM` binding and the migration if Task 7 did not.
- [ ] **Step 4: Run** `npx vitest run scripts/office`, `npm run typecheck`, `npm run build:server`, then `npm run smoke:office` (sandbox off). Expected: PASS. Commit.
- [ ] **Step 5: Lead step: screenshots.** Plan B changes no screen, so the lead takes none. The lead starts `npm run dev:office` once and checks by hand that `admin@madar.test` and the Globex admin both sign in and see their own projects.

```bash
git add scripts server/office/test/live tests/CLAUDE.md
git commit -m "Run two enterprises on the local stack with a small fake enterprise"
```

### Task 16: The leak tests of two enterprises

**Files:**
- Create: `server/office/enterpriseLeaks.test.ts` (node), `server/office/enterpriseLeaks.wd.test.ts` (workerd)

Both enterprises hold the same record ids (`usr_001`, `prj_001`, `tsk_001`) with different content. The node file uses `nodeWorld({ ents: ['ent_001', 'ent_002'] })` with a fake enterprise made as in Task 15.

- [ ] **Step 1: Write the tests** (all must PASS once Tasks 3 to 14 are done; a failure here is a defect in those tasks, so fix it there).
  - `reads: projects.get prj_001, tasks.get tsk_001, search.query, events.list and dashboard.get give each enterprise only its own data` (a word that only ent_001 holds finds nothing in ent_002).
  - `a good token of ent_001 never selects ent_002`: a header, a query value and a body field with the value `ent_002` change nothing.
  - `a call to the object of ent_002 with ent_001 gives unauthenticated, no data, and the same text as a bad token`.
  - `a link, a renew key and a refresh token of ent_001 with the tag changed to ent_002 give the answer of an unknown link, key or token`.
  - `a ticket of ent_001 with the tag changed to ent_002 is refused with the same answer as a random ticket`.
  - `an agent token of ent_001 on /mcp/globex gives 401; a token of ent_002 on /mcp gives 401`; `tools/list on each address shows only the tools of its own agent`.
  - `an unknown email, an untagged link, ent_999.abc, ENT_001.abc, /mcp/nope and /mcp/OAUTH give the answer of wrong credentials, wait the minimum time, and t.created holds no new name`.
  - `a platform object with no listed id never gets a stub: stubFor spy holds only listed names after 30 bad requests`.
  - `the daily cleanup of one enterprise deletes no sign-in row of the other`.
  - In the wd file: `a socket of ent_001 gets no signal of a write in ent_002`; `the tagged ticket of ent_001 does not open a socket on ent_002`; `an object that was never made answers not_found on a batch and makes no row`.
- [ ] **Step 2: Run:** `npx vitest run server/office/enterpriseLeaks.test.ts`, then `MADAR_OFFICE=1 npx vitest run --project office server/office/enterpriseLeaks.wd.test.ts --testTimeout=60000`. Expected: PASS (for each failure, fix the task that owns the code).
- [ ] **Step 3: Commit.**

```bash
git add server/office/enterpriseLeaks.test.ts server/office/enterpriseLeaks.wd.test.ts
git commit -m "Add the leak tests of two enterprises with the same record ids"
```

### Task 17: Guides and records

**Files:**
- Modify: `server/enterprise/CLAUDE.md`, `server/CLAUDE.md` (folders list: one line), `server/office/CLAUDE.md` (gate, status, ops names, Cron fan-out, the tagged ticket), `server/auth/CLAUDE.md` (claim, tags, `refuseSignin`), `server/mcp/oauth/CLAUDE.md` (the address), `server/data/CLAUDE.md` ("The SQLite path": step 14, `EXPORT_SKIP`), `functions/CLAUDE.md` (the well-known map), `TASKS.md`, `docs/superpowers/real-build/proof.md`

- [ ] **Step 1: Write each guide line in the guide of its part.** The enterprise guide gets: the rule list of Task 3, the platform tables, the `refuse*` idea (unknown input runs the real step on empty tables, so answer and time match), the Cron legs and their transport, the contract additions of this plan, and the ops names.
- [ ] **Step 2: Add the open items to `TASKS.md`:** the Lead step of S1 with its result; plan C owns `storageBytes`; the Google callback and the Daftra step stay with plan A; the test copy keeps the old object `office` until it is seeded into `ent_001`.
- [ ] **Step 3: Add the result section "Madar enterprises, plan B" to proof.md:** the test counts, the rows of `status()`, and the cold wake rows.
- [ ] **Step 4: Check.** Run `git diff main | grep -P '^\+[^+].*\x{2014}'` (must print nothing; assert that the command printed no line), `npm run typecheck`, and `npx vitest run server/enterprise server/entries server/office server/auth server/mcp server/http scripts/office`. Commit.

```bash
git add server/enterprise/CLAUDE.md server/CLAUDE.md server/office/CLAUDE.md server/auth/CLAUDE.md server/mcp/oauth/CLAUDE.md server/data/CLAUDE.md functions/CLAUDE.md TASKS.md docs/superpowers/real-build/proof.md
git commit -m "Write the guides and records of the enterprise core"
```

## Contract additions

New shared names that this plan needs. The lead copies them into the contract file.

- `server/enterprise/ids.ts`: `RESERVED_ADDRESSES`, `isAddressName(value)`, `normalizeEmail(email)`. The address `oauth` is reserved because `/mcp/oauth/...` is a path of the OAuth routes.
- `PlatformStub` also has: `register({ row, emails })`, `refuseSignin({ signin, input })`, `refuseMail({ route, body, address })`, `sweep({ at })`, `health()`. `meter()` stores the cumulative counts for `(ent, day)` and replaces them. The Cron sends the whole day so far.
- `OfficeStub` also has `status({ ent })`. `OfficeCronReport` has `status: EnterpriseStatus`. `OfficeMcpInput` has `mcpUrl: string`. `OfficeSigninInput` has `ent`.
- `Config.ent?: EnterpriseId` (the office object sets it; the Postgres path leaves it out). `SigninDeps.ent`. `SigninOffice.run(name, input, ent?)`. `AgentToken.ent?`.
- `EnterpriseGate` (`server/enterprise/gate.ts`) and `entRouter` (`server/enterprise/router.ts`).
- Refresh tokens of a browser session are tagged `<ent>.<secret>` like links and keys. Agent refresh tokens stay bare.
- `live.ticket` output accepts `^(ent_\d{3,}\.)?[0-9a-f]{64}$`.
- Ops routes: `POST /api/office/platform-register` and `POST /api/office/platform-owners` (ops secret). Without `?office=` the ops name is `ENT_VADO`.
- The internal route `POST /api/internal/cron` (jobs secret) and the env var `MADAR_CRON_TRANSPORT` (`self` or `api`). The test env binding `SELF`.
- The `enterprise` table is not in an export (`EXPORT_SKIP`). The platform object holds the master copy of state and limits.

## Coverage of the design

| Design item | Task |
| --- | --- |
| 5.1 object, platform object, ids | 3, 5, 6, 7 |
| 5.2 routing, same answer and time, no new object | 8, 9, 10, 11, 12, 16 |
| 5.3 tokens | 4 |
| 5.4 directory (the reserve calls; plan C calls them) | 7 |
| 5.5 MCP address | 12 |
| 5.13 Cron | 2, 14 |
| 7 spikes S1 to S3 | 1, 2 |
| 8 leak tests (core paths) | 16 |
| Section 6 prerequisites on the local stack | 15 |
| Postgres path keeps one office | 4, 9 (the untagged forms) |

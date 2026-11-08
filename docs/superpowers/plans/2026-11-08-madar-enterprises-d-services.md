# Madar enterprises, plan D: the shared services, the prototype, the words and the guides

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mail, files, Google Calendar, Daftra, logs, PostHog and backups safe for many enterprises, give the prototype two fake enterprises, and finish the words, the MCP texts and the guides.

**Architecture:** Each shared store, key, topic and log line gets the enterprise id, because record ids such as `usr_001` repeat in every enterprise. One mail pool in the platform object limits the account. One guard in the Worker file port keeps a key inside the prefix of its enterprise. VADOs' Companies (`ENT_VADO`) keeps its old keys and its old Google key derivation, so no stored record breaks.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers and Durable Objects (SQLite), node:sqlite for tests, vitest, React, IndexedDB (idb-keyval), GitHub Actions, age.

**Spec:** `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md` (sections 5.5, 5.11, 5.12, 5.15, 5.16, 5.17, 5.18, 5.19, D1, D6). Names: `docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md`. Plans B and C are built first. This plan uses their names exactly. Read the folder `server/enterprise/` before Task 1 (guide: `server/enterprise/CLAUDE.md`).

## Global Constraints

- One builder runs this whole plan in `~/dev/madar-rb/ent-d` on branch `rb/ent-d`, with `node_modules` linked to `/Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test/node_modules`. The builder edits only the files of this plan.
- New words go only into `src/i18n/real/ent-d.en.json` and `src/i18n/real/ent-d.ar.json`. This includes the words of the What's new entries (the track rule beats the `whatsnew.*.json` rule).
- Tests first. Inside a task, run only `npm run typecheck` and `npx vitest run <touched test files> --testTimeout=60000`. A task that changes the office object also runs `npm run test:lite` and `npm run test:office` (sandbox off). The lead runs the full suites once at the end. Add no review task.
- One commit per task. Plain message in STE. No `Co-Authored-By` line. No `Claude-Session` line. Before each commit, `git diff --cached | perl -CSD -ne 'print if /^\+[^+].*\x{2014}/'` must print nothing.
- Write STE in code comments, docs and words. No em-dash. Every visible word has an English key and an Arabic key. Arabic follows the Thmanyah rules (`src/i18n/CLAUDE.md`, "Arabic style").
- A contract change is additive. A new SQLite table is a new schema step (`server/data/CLAUDE.md`, "The SQLite path"); the platform object has its own schema step (plan B).
- Shared keys (contract): file keys of every enterprise except `ENT_VADO` start with `e/<ent>/`. Mail idempotency keys and `mail_log` refs start with `<ent>:`. PostHog `distinct_id` is `<ent>:<personId>`. Every log line and error record has the field `ent`.
- The mail sender stays `Madar <madar@vado.sa>`. The Resend free plan sends 100 mails a UTC day. Notice and summary mail stops at 90, sign-in and warning mail at 98 (`QUOTA_LIMITS`).
- Never show a name of another enterprise in an error text. A refusal for a key, a state or a mail of another enterprise says only that it is not valid.
- Steps that deploy, touch the test copy or production, or send mail to a real person are lead steps. They are at the end of this plan and in no task.

## Review Focus

Five failure modes that the spec implies and that bite first. Each has its test in the task named.

1. Two enterprises, the same person id, the same day: the second notice must not use the Resend key of the first (Resend would drop it). Test in Task 1.
2. A key without the prefix sent by `ent_002`, and a key of `ent_002` sent by `ENT_VADO`: both refused for sign, head, copy and delete, also in a `copy` whose second key is wrong. Test in Task 3.
3. A Google state or a sealed token of `ent_002` presented to `ent_001`, a state with no `ent`, and an unlisted `ent` in the callback: all fail with the same word, and the callback derives no key for the unlisted `ent`. Test in Task 4.
4. A full mail pool or a pool that does not answer: no mail goes out, the row waits, and a retry of the same mail takes the same place once. Test in Task 2.
5. One enterprise fails its nightly export: the other enterprises still get their backup, and the run still fails so GitHub mails the owner. Test in Task 7.

## File structure

| File | Job |
| --- | --- |
| `server/enterprise/scope.ts` (new) | `entOfConfig`: the enterprise of a `Config` |
| `server/enterprise/context.ts` (new) | the request scope of the Worker and `entLogger` |
| `server/enterprise/platform/mailPool.ts` (new) | the mail pool: SQL and the reserve rule |
| `server/mail/limits.ts` (new) | `quotaLimitsOf(total)` |
| `server/mail/quota.ts` | scoped refs, pool place, limits from a setting |
| `server/files/keys.ts`, `server/files/guard.ts` (new) | `keysOf(ent)`, `guardFilesPort` |
| `server/google/{keys,state,callback,client}.ts` | keys and state per enterprise |
| `server/daftra/client.ts` | accounts only for `ENT_VADO` |
| `server/core/insight.ts`, `server/core/deps.ts` | `ent` on logs and PostHog records |
| `src/lib/enterprise.ts` (new), `src/app/insight/*` | usage data only for `ENT_VADO` |
| `scripts/backup/*`, `.github/workflows/office-backup.yml` | one backup for each enterprise |
| `src/api/{persist,fakeDirectory,platformFake}.ts`, `src/data/sampleSecondEnterprise.ts`, `src/app/{bootstrap,PreviewAs,fakeEnterprise}.ts(x)` | the prototype |
| `server/mcp/{docs,run}.ts`, `docsParity.ts` | MCP words |
| `src/i18n/neutralWords.test.ts` (new) and the word files | the D1 sweep |
| `src/whatsNew/entries.ts`, `src/i18n/real/ent-d.*.json` | What's new |
| the guides | Task 13 |

---

### Task 1: Mail keys and refs start with the enterprise id

**Files:**
- Create: `server/enterprise/scope.ts`
- Modify: `server/core/ports.ts` (the type `Config`, after `officeCopy?`), `server/mail/quota.ts` (`sendCounted`, lines 125-146), `server/auth/forgot.ts:95`, `server/auth/invite.ts:232,259`, `server/auth/renew.ts:121`
- Test: `server/mail/scopedRefs.test.ts` (new); update every existing test that pins a key (`grep -rn "idempotencyKey\|notice-\|quota-warning-\|summary-\|invite:\|mcp-confirm-" server --include='*.test.ts'`)

**Interfaces:**
- Consumes: `ENT_VADO`, `EnterpriseId` (`server/enterprise/ids.ts`, plan B).
- Produces: `Config.ent?: EnterpriseId` (absent means `ENT_VADO`; the object sets it from its row; the Postgres path leaves it out). `entOfConfig(config: Pick<Config, 'ent'>): EnterpriseId`. `scopedRef(ent: EnterpriseId, key: string): string` returns `` `${ent}:${key}` ``.

The rule: callers keep passing the plain key (`notice-ntf_001`). `sendCounted` and the direct `reserve` callers scope it. The scoped text is the `mail_log.ref` and the Resend `Idempotency-Key`.

- [ ] **Step 1: Write the failing test** `server/mail/scopedRefs.test.ts`. Two in-memory offices (`freshLite()` twice), one shared `fakeMail()` (one Resend account), two `fakeDeps({ db, config: { ent } })` for `ent_001` and `ent_002`. Test name: `gives two enterprises with the same person id and the same day two different Resend keys`. Assertions: both `sendCounted(deps, 'notice', mail with key 'notice-ntf_001', { userId: 'usr_001' })` return `status: 'sent'`; `mail.sent.map(m => m.idempotencyKey)` equals `['ent_001:notice-ntf_001', 'ent_002:notice-ntf_001']`; each office `mail_log` holds one row with `ref` of its own prefix; `sentToday(db)` is 1 in each office. Second test, `keeps one place when the same enterprise sends the same key twice`. Third test, `scopes the direct reserves of the reset and the invitation`: `renderless` check that `sendReset` and `sendInvitation` with `config.ent = 'ent_002'` write refs that start with `ent_002:` (use the stores the existing `forgot` and `invite` tests use).
- [ ] **Step 2: Run it.** `npx vitest run server/mail/scopedRefs.test.ts --testTimeout=60000`. Expect FAIL (`scopedRef` is not defined).
- [ ] **Step 3: Implement** `entOfConfig` and `scopedRef`, the `Config.ent` field, and the change in `sendCounted`: `const ref = scopedRef(entOfConfig(deps.config), mail.idempotencyKey)`; reserve with `ref`; send `{ ...mail, idempotencyKey: ref }`; record the Resend id with `ref`. In `forgot.ts`, `invite.ts` and `renew.ts`, scope the key at the direct `reserve` and `release` calls with the same helper. `renew.ts` reserves inside a transaction, so it only scopes there (the pool call of Task 2 goes before the transaction).
- [ ] **Step 4: Update the old tests** that pin an unscoped key. They now expect the `ent_001:` form (the default enterprise). Run `npx vitest run server/mail server/auth server/mcp/guard.lite.test.ts server/push --testTimeout=60000`. Expect PASS.
- [ ] **Step 5: Commit.** `git add server && git commit -m "Mail keys and refs start with the enterprise id"`

---

### Task 2: The mail pool in the platform object

**Files:**
- Create: `server/mail/limits.ts`, `server/enterprise/platform/mailPool.ts`
- Modify: `server/mail/quota.ts` (limits, `poolPlace`, `reservePlace`, `sendCounted`), `server/core/ports.ts` (`Deps.mailPool?`, `Config.mailDayLimit?`), the platform object file of plan B (`server/enterprise/platform/object.ts` and its schema step), `server/office/net.ts` (`NetApi.mailReserve`, `netPorts`), `server/office/workerNet.ts`, `server/office/parts.ts` (`depsFor`), `server/entries/officeEntry.ts:60`, `server/office/test/live/entry.ts:38`, `server/auth/forgot.ts`, `server/auth/invite.ts`, `server/auth/renew.ts`
- Test: `server/enterprise/platform/mailPool.test.ts` (new), `server/mail/pool.test.ts` (new), `server/office/net.test.ts`

**Interfaces:**
- Consumes: `PlatformStub.mailReserve` (contract), `PLAN_LIMITS` and the share (`MADAR_ENTERPRISE_SHARE`) from `server/enterprise/plan.ts` (plan C; read the file for the exact export names), `scopedRef` and `entOfConfig` (Task 1).
- Produces:
  - `quotaLimitsOf(total: number): Record<QuotaKind, number>`: notice and summary `Math.floor(total * 0.9)`, sign-in and warning `total - 2`. `QUOTA_LIMITS = quotaLimitsOf(100)` (the same 90 and 98).
  - `type PoolKind = 'signin' | 'notice'`; `type MailPoolPort = { reserve(kind: PoolKind, day: string, ref: string): Promise<'ok' | 'full'> }`; `Deps.mailPool?: MailPoolPort`.
  - `poolPlace(deps: Pick<Deps, 'mailPool' | 'config' | 'clock'>, kind: QuotaKind, key: string): Promise<'ok' | 'over'>`: with no `mailPool` it answers `'ok'`.
  - `reservePlace(deps: Pick<Deps, 'db' | 'mailPool' | 'config' | 'clock'>, kind: QuotaKind, key: string, o?: { userId?: string }): Promise<'ok' | 'over'>`: the pool first, then `deps.db.tx('write', q => reserve(q, kind, scopedRef(...), ...))`.
  - `mailReserve(q: Query, input: { ent: EnterpriseId; kind: PoolKind; day: string; ref: string }, o: { limit: number; share: number }): Promise<'ok' | 'full'>` in `mailPool.ts`, plus `MAIL_POOL_SCHEMA` (table `mail_pool (day text, ref text, kind text, ent text, primary key (day, ref))`).
  - `NetApi.mailReserve(kind: PoolKind, day: string, ref: string): Promise<NetAnswer<'ok' | 'full'>>`. `WorkerNet` gets the options `ent: EnterpriseId` and `platform: Pick<PlatformStub, 'mailReserve'>`; its method sends the `ent` of the Worker, never one from the object.

Rules of `mailReserve`: a `ref` that is in the table for the day answers `'ok'` and adds nothing. A `signin` place is full at `limit - 2`. A `notice` place is full at `Math.floor(limit * 0.9)`. For an enterprise other than `ENT_VADO`, a `notice` place is also full when that enterprise already holds `Math.max(1, Math.floor(share * noticeLimit))` notice places today (the day cap rule of design 5.14; `ENT_VADO` is never held back by the share). The call deletes rows older than 2 days. It only writes when it adds a place.

- [ ] **Step 1: Write the failing tests.**
  - `mailPool.test.ts` (node:sqlite, `raw.exec(MAIL_POOL_SCHEMA)`), limit 100, share 0.1: `answers full for notice 91 and keeps sign-in places to 98`; `counts one ref once`; `holds a non-VADO enterprise to its share of notice places and never holds ENT_VADO` (ent_002 gets 9 then `'full'`, ent_001 goes on to 90); `deletes rows older than 2 days`; `refuses a day that is not YYYY-MM-DD`.
  - `pool.test.ts` (`freshLite`, `fakeDeps`, a fake `mailPool` that records `(kind, day, ref)`): `a full pool sends nothing, writes no local row and marks the first refusal` (`sendCounted` returns `{ status: 'over', firstRefusal: true }`, `mail.sent` empty); `a pool that throws makes sendCounted throw and sends nothing` (the row stays for the outbox); `a retry of the same key asks the pool with the same scoped ref`; `maps notice and summary to notice, sign-in and warning to signin`; `no mailPool means no pool call` (Postgres path); `reservePlace takes the pool before the local row`.
  - `net.test.ts`: `netPorts gives mailPool and does not count it in NET_BUDGET`; `WorkerNet.mailReserve sends the ent of the Worker and not an ent from the call`.
- [ ] **Step 2: Run them.** `npx vitest run server/enterprise/platform/mailPool.test.ts server/mail/pool.test.ts server/office/net.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement** `limits.ts`, `mailPool.ts`, and the changes in `quota.ts`: `sendCounted` calls `poolPlace` before its transaction and treats `'over'` like a full local day (the same refusal mark and Admin warning path). `reserve` takes `o.limits` (default `QUOTA_LIMITS`); `sendCounted` and `reservePlace` pass `quotaLimitsOf(deps.config.mailDayLimit ?? 100)`. In `forgot.ts` and `invite.ts` replace the direct `deps.db.tx(... reserve ...)` with `reservePlace`. In `renew.ts` call `poolPlace(deps, 'signin', key)` before the transaction and return `'none'` on `'over'`; keep `reserve` inside with the scoped ref. A skipped invitation keeps its pool place until midnight (accepted, see Risks).
- [ ] **Step 4: Wire the platform object and the Worker.** In the platform object of plan B: add the table to its schema step (`MAIL_POOL_SCHEMA`) and the RPC `mailReserve(input)`, which runs `mailReserve` in a write transaction with the `mails` limit and the share from `server/enterprise/plan.ts`. Add `ref: string` to the `PlatformStub.mailReserve` input type. In `net.ts` add the method and let `netPorts` return `mailPool` with `counts = false` (a Durable Object call is no outside call). In `parts.ts` `depsFor`: set `config: { ...values.config, ent, mailDayLimit: <mails limit> }` (use the source of `ent` that plan B put there) and `mailPool: values.mail.driver === 'outbox' ? undefined : ports.mailPool`. Pass `ent` and `platform` to `new WorkerNet(...)` at both call sites.
- [ ] **Step 5: Fill `day.mails`.** Read `status()` of plan B. If it leaves `day.mails` at 0, set it from `sentToday(q, { now })`. Add one assertion to its test.
- [ ] **Step 6: Run** the three test files again, then `npm run typecheck`, `npm run test:lite` and `npm run test:office` (sandbox off). Expect PASS.
- [ ] **Step 7: Commit.** `git add server && git commit -m "One mail pool in the platform object, with places for sign-in mail first"`

---

### Task 3: File keys with the enterprise prefix, and the file port guard

**Files:**
- Create: `server/files/guard.ts`
- Modify: `server/files/keys.ts`, `server/files/intents.ts:112-132`, `server/calls/files.ts:13,45-90,182-190`, `server/calls/feedback.ts:12,40-42,60`, `server/jobs/steps/uploads.ts:5,55,77-81`, `server/office/workerNet.ts`, `server/office/net.ts` (`netPorts` option `ent`)
- Test: `server/files/enterpriseKeys.test.ts` (new), `server/files/keys.test.ts`, `server/files/intents.test.ts`, `server/jobs/steps/uploads` tests that exist

**Interfaces:**
- Consumes: `entOfConfig` (Task 1), `ENT_VADO`.
- Produces in `keys.ts`:
  - `enterpriseKeyPrefix(ent: EnterpriseId): string`: `''` for `ENT_VADO`, else `` `e/${part(ent)}/` `` (so `ent_002` gives `e/ent-002/`; the key form allows only `[a-z0-9/-]`).
  - `keyBelongsTo(ent: EnterpriseId, key: string): boolean`: for `ENT_VADO` the key must not start with `e/`; for any other enterprise it must start with its prefix.
  - `keysOf(ent: EnterpriseId): KeyBook`, a record with the same function names as the module (`objectKey`, `thumbKey`, `uploadKey`, `uploadThumbKey`, `stagingKey`, `stagingThumbKey`, `officeUploadPrefix`, `officeUploadKey`, `officeUploadThumbKey`, `chatUploadPrefix`, `chatUploadKey`, `chatUploadThumbKey`, `meetingUploadPrefix`, `meetingUploadKey`, `meetingUploadThumbKey`, `resourcesUploadPrefix`, `resourcesUploadKey`, `resourcesUploadThumbKey`, `screenshotKey`, `isStagingKey`). Each adds the prefix. The module-level functions stay as they are (they equal `keysOf(ENT_VADO)`), so the old tests stay green.
- Produces in `guard.ts`: `guardFilesPort(port: FilesPort, ent: EnterpriseId): FilesPort`. Each method calls `assertKeyOf(ent, key)` first; `copy` checks both keys; `remove` checks every key. The error text is `The file key is not valid.` (no key, no enterprise).
- `checkIntent` takes `o.ent?: EnterpriseId` (default `ENT_VADO`) and uses `keysOf(o.ent)` for its prefix tests and for the screenshot test (`feedback/`).

- [ ] **Step 1: Write the failing tests** in `enterpriseKeys.test.ts`:
  - `makes the same key folders under e/ent-002/ for another enterprise` (`keysOf('ent_002').uploadKey('prj_001', 'upl_1')` is `e/ent-002/prj-001/upl-1/file`; `keysOf(ENT_VADO).uploadKey` equals the module function); every key of `keysOf` passes `isObjectKey`; `isStagingKey` of `e/ent-002/up/x/file` is true for `ent_002` and false for `ENT_VADO`.
  - `guardFilesPort refuses a key of another enterprise on presignPut, presignGet, head, copy and remove` with a fake port that records calls: `ent_002` with key `prj-001/fil-001/1/file` (no prefix) refused; `ent_002` with `e/ent-003/...` refused; `ENT_VADO` with `e/ent-002/...` refused; a `copy` whose `to` is wrong is refused and the port is not called; a `remove` with one wrong key in three removes none.
  - `the refusal text names no key and no enterprise`.
  - `checkIntent accepts the intent of the same enterprise and refuses an intent whose key has another prefix` (error code `invalid_input`, text without the key).
  - A call test with `fakeDeps({ config: { ent: 'ent_002' } })`: `files.uploadStart` returns a staging key and an intent key that both start with `e/ent-002/`. Use the pattern of the existing call tests of `files.uploadStart`.
- [ ] **Step 2: Run.** `npx vitest run server/files/enterpriseKeys.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement** the three exports in `keys.ts` and `guard.ts`. In `calls/files.ts`, `calls/feedback.ts` and `jobs/steps/uploads.ts` replace the imported key functions with `const k = keysOf(entOfConfig(deps.config))`. `uploads(deps)` now needs `config`: change its `Pick` to `Pick<Deps, 'db' | 'files' | 'config'>` and fix its callers and tests. Pass `ent` to `checkIntent` at both call sites.
- [ ] **Step 4: Put the guard in the Worker.** `WorkerNet` option `ent` wraps its `files` with `guardFilesPort(files, ent)`. `netPorts(net, { ..., ent })` wraps the object side the same way (a second wall). Both call sites of `new WorkerNet` already pass `ent` from Task 2.
- [ ] **Step 5: Run** `npx vitest run server/files server/calls server/jobs server/office/net.test.ts --testTimeout=60000` and `npm run typecheck`. Expect PASS.
- [ ] **Step 6: Commit.** `git add server && git commit -m "File keys of new enterprises start with e/<ent>/, and the file port refuses other keys"`

---

### Task 4: Google Calendar keys and state for each enterprise

**Files:**
- Modify: `server/google/keys.ts`, `server/google/state.ts`, `server/google/callback.ts`, `server/google/client.ts:29`, `server/calls/google.ts:103,162`, `server/google/testOffice.ts:54`, `server/entries/officeSignin.ts` (the callback mount, where plan A made the callback work)
- Test: `server/google/enterprise.test.ts` (new), `server/google/{keys,state,callback}.test.ts`

**Interfaces:**
- Produces: `googleKeysOf(key: string, ent?: EnterpriseId): Promise<GoogleKeys>`. `ENT_VADO` (the default) keeps the HKDF info strings `madar-google-seal` and `madar-google-state`, so the sealed tokens that the move imports still open. Any other enterprise uses `` `madar-google-seal:${ent}` `` and `` `madar-google-state:${ent}` ``. The key cache is keyed by `ent` and `key`, holds at most 64 entries, and drops all when it is full.
- `signState(keys, userId, now, ent)` puts the claim `ent` in the payload. `readState(keys, state, now)` returns `{ ok: true, userId, ent, verifier }` and answers `bad` for a payload with no valid `ent`. New `entOfState(state: string): EnterpriseId | null`: reads the claim `ent` of an unverified payload; null for any wrong shape.
- `googleCallback` finds `ent` with `entOfState`, accepts it only when `isEnterpriseId` is true and, when the route has a `listed` function from the Worker (plan B, the 60 second list), only when the id is in the list. Then it derives the keys for that `ent` and verifies the signature. Any failure is the word `failed`.

- [ ] **Step 1: Write the failing tests** in `enterprise.test.ts`: `a sealed token of ent_002 does not open with the keys of ent_001 or of ENT_VADO` (`SealBroken`); `ENT_VADO keeps the old derivation` (a token sealed with a fixture made by the current code of `main` opens; store the fixture string in the test); `a state signed for ent_002 reads as bad under the keys of ent_001`; `a state with no ent claim reads as bad`; `signState then readState give back the ent`; `the callback finishes a state of a listed enterprise`; `the callback answers failed for an unlisted ent and derives no key` (spy on `googleKeysOf` or count the cache); `the callback answers failed for ent text that is not an enterprise id`; `the key cache never holds more than 64 entries`; `google.connect refuses a state whose ent differs from the ent of the deps` (the same word as an old state, `google_link_old`).
- [ ] **Step 2: Run.** `npx vitest run server/google/enterprise.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement** as in Interfaces. `client.ts` calls `googleKeysOf(google.key, entOfConfig(deps.config))`. `calls/google.ts` passes `entOfConfig(deps.config)` to `signState` and compares `read.ent` after `readState`.
- [ ] **Step 4: Fix the old tests** (`keys.test.ts`, `state.test.ts`, `callback.test.ts`, `testOffice.ts`): they sign with an `ent`. Run `npx vitest run server/google server/calls/google* --testTimeout=60000` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit.** `git add server && git commit -m "Google Calendar keys and the connect state belong to one enterprise"`

---

### Task 5: Daftra keys belong to ENT_VADO only

**Files:**
- Modify: `server/daftra/client.ts:141-150` (`daftraOf`, `daftraAccountsOf`), `server/daftra/testOffice.ts` (option `ent`)
- Test: `server/daftra/enterprise.test.ts` (new)

**Interfaces:** `daftraOf(deps, account)` returns `undefined`, and `daftraAccountsOf(deps)` returns `[]`, when `entOfConfig(deps.config) !== ENT_VADO`. `Pick<Deps, 'config' | 'daftraFetch'>` stays the parameter type. Every read of `config.daftra` goes through these two functions (checked by grep in Step 1), so `daftra.status` answers `{ ready: false, accounts: [] }` and the job step returns `{ skipped: 'no_config' }` for the others.

- [ ] **Step 1: Write the failing test.** First assert by source test that no file in `server/` except `client.ts` and `config.ts` reads `config.daftra` (`readdirSync` scan; fails when a new reader appears). `daftraOffice({ ent: 'ent_002', fakes: [mazj, vado] })` builds the sample office (sub-company `Vado` is `sub_002` with `prj_002`) with the Daftra pairs in the config, as the Worker has them. Tests: `daftra.status answers no accounts for ent_002` (`ready: false`); `daftra.paymentLink for a project of the sub-company Vado answers no_daftra_account`; `payments.linkInvoice and daftra.matchClient refuse with daftra_not_ready`; `the job step returns skipped no_config and the fake Daftra got no request` (`vado.requests.length === 0`, same for mazj); `ent_001 still reads its accounts` (regression, same fakes).
- [ ] **Step 2: Run.** `npx vitest run server/daftra/enterprise.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement** the gate and the `ent` option of `daftraOffice` (it sets `config.ent`).
- [ ] **Step 4: Run** `npx vitest run server/daftra server/calls/daftra.test.ts server/jobs/steps/daftra.test.ts --testTimeout=60000`. Expect PASS.
- [ ] **Step 5: Commit.** `git add server && git commit -m "Daftra accounts belong to VADOs' Companies only"`

---

### Task 6: The enterprise on every log line, and PostHog usage for ENT_VADO only

**Files:**
- Create: `server/enterprise/context.ts`, `src/lib/enterprise.ts`
- Modify: `server/core/insight.ts`, `server/core/deps.ts:235-245` (`loggerOf`), `server/office/parts.ts:140` (the object `log`), the Worker routes of plan B where `stubFor(env, ent)` is called (`server/entries/officeWorker.ts`), `src/app/insight/{notes,index,client}.ts`, `src/app/insight/CLAUDE.md` (Task 13)
- Test: `server/enterprise/context.test.ts` (new), `server/core/insight.test.ts`, `src/app/insight/{client,index,eventFields}.test.ts`, `src/lib/enterprise.test.ts` (new)

**Interfaces:**
- `runInEnterprise<T>(ent: EnterpriseId, work: () => T): T` and `currentEnterprise(): EnterpriseId | undefined` (AsyncLocalStorage, as `server/core/after.ts`). `entLogger(log: Logger, ent: () => EnterpriseId | undefined): Logger` adds `{ ent }` to the fields of every line, unless the line already has `ent`.
- `insightLogger`: when `fields.ent` is set, `distinct_id` is `` `${ent}:${personId ?? 'madar-server'}` `` and `properties.ent` is set. A line with no `ent` keeps today's form.
- `src/lib/enterprise.ts`: `VADO_ENTERPRISE = 'ent_001'` and `usageAllowed(ent: string | null | undefined): boolean` (true only for `VADO_ENTERPRISE`; unknown means false). A server test checks that the constant equals `ENT_VADO`.
- `InsightPerson = { id: string; name: string; ent: string | null }`. `posthogOptions` takes `usage: () => boolean`. With usage false, `before_send` drops every record whose `event` is not `$exception`, and an `$exception` gets `ent` and no `personName`. With usage true, nothing changes except the added `ent`.

- [ ] **Step 1: Write the failing tests.**
  - `context.test.ts`: `adds ent from the request scope`; `adds no field outside a scope`; `keeps the ent of two overlapping requests apart` (two `runInEnterprise` runs with `await` between lines); `does not replace an ent that the line sets`; `the object log of ent_002 carries ent` (extend the node:sqlite test that builds `officeParts` with a recording `log`; find it with `grep -ln "log:" server/office/*.test.ts`).
  - `insight.test.ts`: `sends distinct_id ent_002:usr_001 and the property ent`; `a line with no ent keeps the old form`.
  - `client.test.ts`: `usage false drops a page view, a click, a madar_ event and a $snapshot`; `usage false keeps an $exception and adds ent but no personName`; `usage true keeps the old records`.
  - `index.test.ts`: `starts the client with usage false for a session of ent_002` and `waits for the session when the cache has none`; `stops the recorder for usage false` (spy `stopSessionRecording`). Update the session fixtures of the old tests to hold `enterprise: { id: 'ent_001' }`.
  - `eventFields.test.ts`: add the property `ent` to the pinned fields of `$exception`.
- [ ] **Step 2: Run.** `npx vitest run server/enterprise/context.test.ts server/core/insight.test.ts src/app/insight src/lib/enterprise.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement.** `loggerOf(config)` returns `entLogger(base, () => currentEnterprise() ?? config.ent)`. The object log is `entLogger(log, <the getter of the object id from plan B>)`. In the Worker routes, run the rest of each request inside `runInEnterprise(ent, ...)` right after the enterprise is known. In `startInsight`, `personOf` reads `session.enterprise?.id`; `begin` waits until `personOf` is not null (subscribe to the query cache for it, and return at once when a client exists or loads). `createInsightClient` takes `usage`: with false it starts no watcher and calls `stopSessionRecording()`.
- [ ] **Step 4: Run** the same files, then `npx vitest run src/app server/core --testTimeout=60000` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit.** `git add server src && git commit -m "Log lines carry the enterprise id, and PostHog usage data is for VADOs' Companies only"`

---

### Task 7: A nightly backup for each enterprise

**Files:**
- Modify: `scripts/backup/officeExport.ts`, `scripts/backup/officeRestore.ts`, `scripts/restore-check.ts` (`readOnlyDeps`), `scripts/office/ops.ts` (only if the `office` query needs a change), `.github/workflows/office-backup.yml`, `scripts/backup/workflows.test.ts`, `server/entries/officeWorker.ts` (the op `enterprises`), `docs/superpowers/real-build/proof.md` (new section at the end)
- Create: `scripts/backup/officeEnterprises.ts`
- Test: `scripts/backup/officeExport.test.ts`, `scripts/backup/officeRestore.test.ts`, `scripts/backup/workflows.test.ts`, `server/entries/officeWorker.test.ts`

**Interfaces:**
- File name: `madar-office-<copy>-<ent>-<stamp>.tar.gz.age`, for example `madar-office-production-ent_001-20261108-023000Z`. `OFFICE_BACKUP_NAME = /^madar-office-(test|production|local)(-ent_[0-9]{3,})?-[0-9]{8}-[0-9]{6}Z$/` (the old form stays valid). `ExportManifest` gets `ent?: EnterpriseId`.
- `makeOfficeBackup({ ops, copy, ent?, recipient, outDir })`; the script flag `--enterprise ent_NNN` (sent as `?office=<ent>`).
- Worker op `POST /api/office/enterprises` with the export secret header: answers `{ enterprises: EnterpriseId[] }` from `platformStub(env).listed()`. `export` accepts `?office=<ent id>` only for a listed id; an unlisted id answers `forbidden` and makes no object (plan B owns the name rule; read `nameAllowed` as it stands and extend it only if it does not take a listed id).
- `officeRestoreCheck` reads the `enterprise` row of the restored office and fails the step `enterprise` when its `id` differs from the id in the file name. `readOnlyDeps(db, o?: { ent?: EnterpriseId })` sets `config.ent`.

- [ ] **Step 1: Write the failing tests.**
  - `officeExport.test.ts`: `names the file with the enterprise id` and `the manifest holds ent`; `exportArgProblems accepts --enterprise ent_002 and refuses --enterprise ent_2`.
  - `officeRestore.test.ts`: `restores one enterprise alone from its file` (make a backup of a node:sqlite office whose `enterprise` row is `ent_002`, restore it, steps all `ok`); `fails the enterprise step when the file name says ent_001 and the row says ent_002`; `an old name without an enterprise still restores`.
  - `workflows.test.ts` (text tests, keep the step names `Age of the newest office backup` and `Remove office backups older than 30 days`): `lists the enterprises before the export`; `checks the age of each enterprise with startswith("madar-office-$COPY-$ENT-")`; `exports each enterprise in a loop that goes on after one failure and fails at the end`; `still never reads createdAt`; `the remove step still matches only the copy prefix`.
  - `officeWorker.test.ts`: `the enterprises op needs the export secret`; `answers the listed ids`; `export of an unlisted id is refused and creates no object`.
- [ ] **Step 2: Run.** `npx vitest run scripts/backup server/entries/officeWorker.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement** the code. `officeEnterprises.ts` prints one JSON line `{"enterprises":[...]}`. In the workflow: one step lists the ids; the age step reads the releases once and writes one hour value per id; the export step loops over the ids (two tries each, 2 minutes apart), uploads each file as its own release, collects the failed ids, and exits 1 at the end when any failed. The stale check fails when any enterprise was older than `STALE_HOURS` (a new enterprise with no backup counts as 0 hours).
- [ ] **Step 4: Write the proof section** `## Madar enterprises: backups (2026-11-08)` in `proof.md`: the formulas, with the numbers the builder can compute. Releases: each night adds `N + 1` releases (N enterprises and the database backup), kept 30 days, and `gh release list --limit 1000` reads 1,000 at most, so `30 * (N + 1) <= 1000` allows `N <= 32`. Minutes: a table with the columns "enterprises", "setup minutes", "export minutes", "total a night", "total a month" and the empty cell "measured by the lead". The lead fills the measured values (Lead step 2). State the 2,000 minutes a month limit from `.github/CLAUDE.md`.
- [ ] **Step 5: Run** the test files again and `npm run typecheck`. Expect PASS.
- [ ] **Step 6: Commit.** `git add scripts .github server docs && git commit -m "One encrypted backup for each enterprise, with a restore check for one"`

---

### Task 8: The prototype: the fake directory, the store for each enterprise, the platform fakes

**Files:**
- Create: `src/api/fakeDirectory.ts`, `src/api/platformFake.ts`, `src/data/sampleSecondEnterprise.ts`, `src/app/fakeEnterprise.ts`
- Modify: `src/api/persist.ts`, `src/app/bootstrap.ts`, `src/api/CLAUDE.md` (Task 13)
- Test: `src/api/persist.test.ts`, `src/api/fakeDirectory.test.ts`, `src/api/platformFake.test.ts`, `src/app/bootstrap.test.ts`, `src/data/sampleSecondEnterprise.test.ts`

**Interfaces:**
- `persist.ts`: `Persister` gets `readonly ent: string`. `idbPersister(dbName?, ent?)`, `memoryPersister(ent?)` and `openPersister(ent?)` default to `VADO_ENTERPRISE` (`src/lib/enterprise.ts`, Task 6). The state key is `` `state:${ent}` ``. A blob key is stored as `` `${ent}:${key}` ``. For `ent_001` only, `load()` falls back to the old key `state` and `getBlob` to the old unprefixed key; the next `save` writes the new key and deletes the old one. `State` and `STATE_VERSION` do not change.
- `fakeDirectory.ts` (pure): `FakeDirectory = { enterprises: FakeEnterprise[]; owners: { ent: string; userId: string }[] }`. `FakeEnterprise` has the fields of a row of `platform.enterprises.list` (plan C, `src/api/contract/platform.ts`) plus `emails: string[]`. `defaultDirectory(today: string): FakeDirectory`: `ent_001` "VADOs' Companies" («شركات فادو», address `vados`, state `active`, owner `usr_001`) and `ent_002` "Oasis Builders" («واحة للإنشاءات», address `oasis`, state `active`, no logo). `openDirectory(): Promise<{ read(): FakeDirectory; write(d: FakeDirectory): Promise<void> }>` keeps it in IndexedDB under the key `directory` (memory when IndexedDB fails).
- `platformFake.ts`: `createPlatformFake(dir: { read(): FakeDirectory; write(d: FakeDirectory): Promise<void> }, now: () => Date): (name: PlatformCallName, input: unknown) => Promise<unknown>`. It parses the input and the output with the zod types of `src/api/contract/platform.ts`, and it touches only the directory. Rules, as on the server: create reserves the address name and the first Admin email (a taken email gives the calm `email_taken` refusal with no other enterprise named); pause is refused for an enterprise that holds a platform owner; pause and resume change `state`; update changes name, Arabic name, logo and limits; `resendInvite` answers ok for an enterprise in state `creating` or `active` with an Admin who has not signed in; `meter.get` answers fixed Free-plan numbers; `me` answers `{ owner: true }` only in the mode "Platform owner" (Task 9). A `platform.*` name that is not in `PLATFORM_CALL_NAMES` answers `not_found`.
- `sampleSecondEnterprise.ts`: `buildSecondEnterprise(today: string): State`: `emptyState(today)` plus one Admin, two members, one client and one project with three to-dos, all with neutral names and no VADO content; its `settings` holds `enterpriseName: 'Oasis Builders'`, `enterpriseNameAr`, and `codePrefix: 'OB'`.
- `fakeEnterprise.ts`: `activeFakeEnterprise(): string` reads `localStorage['madar.fakeEnterprise']` (inside try/catch; default `VADO_ENTERPRISE`; an id not in the directory gives the default). `chooseFakeEnterprise(id)` writes it and reloads the page. `platformOwnerMode(): boolean` and `setPlatformOwnerMode(on)` use the key `madar.fakePlatform`.

- [ ] **Step 1: Write the failing tests.** `persist.test.ts`: `keeps two enterprises apart` (save two different states under `ent_001` and `ent_002`, load each); `keeps the blobs of two enterprises apart`; `moves the old key state to state:ent_001 on the first save`; `an old blob key still loads for ent_001 and not for ent_002`. `fakeDirectory.test.ts`: the default directory has the two enterprises and one owner. `platformFake.test.ts`: one test for each of the eight names in `PLATFORM_CALL_NAMES` (shape parsed by the contract), `create refuses a taken email without naming the other enterprise`, `pause is refused for the enterprise of the owner`, `resume reverses pause`, `an unknown name answers not_found`, and `no call reads or writes a State` (the fake takes no store). `bootstrap.test.ts`: `starts the second enterprise with the small seed and not the VADO sample` and `starts ent_001 with the sample office and the old saved state`. `sampleSecondEnterprise.test.ts`: the state passes the same checks as `buildSeed` (use the invariants the seed tests use) and holds none of the words `Vado`, `Bunah`, `Khobar`.
- [ ] **Step 2: Run.** `npx vitest run src/api/persist.test.ts src/api/fakeDirectory.test.ts src/api/platformFake.test.ts src/app/bootstrap.test.ts src/data/sampleSecondEnterprise.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement.** `bootstrap()` reads `activeFakeEnterprise()`, opens the persister for it, and builds the small seed for any enterprise other than `ent_001`. Plan C decides how `session.get` fills `enterprise` and `platformOwner` and how the platform page calls `platform.*` (read `src/app/` and `src/features/platform/` first). Fill the same two fields in the prototype from the directory and the owner mode, and set the platform port of the prototype runtime to `createPlatformFake(...)`. If plan C filled the fields outside the handler, add the prototype wrapper in `createApi` options. Write what you chose in `src/api/CLAUDE.md` (Task 13).
- [ ] **Step 4: Run** the files of Step 2 plus `npx vitest run src/api src/app --testTimeout=60000` and `npm run typecheck`. Expect PASS. The old handler tests must pass with no change.
- [ ] **Step 5: Commit.** `git add src && git commit -m "The prototype keeps a store for each fake enterprise and fakes the platform calls"`

---

### Task 9: Preview as picks an enterprise first

**Files:**
- Modify: `src/app/PreviewAs.tsx`, `src/app/PersonMenuPanel.tsx` (only if the layout needs a row), `src/i18n/real/ent-d.en.json`, `src/i18n/real/ent-d.ar.json` (new)
- Test: `src/app/PreviewAs.test.tsx` (new)

**Interfaces:** Words (English, then Arabic in the Thmanyah style): `preview.enterprise` "Company" / «الشركة»; `preview.platformOwner` "Platform owner" / «مالك المنصة»; `preview.platformOwnerHint` "Manages every company" / «يدير كل الشركات». The control shows a select of the enterprises of the fake directory (the name in the language of the screen) and then the select of people. The people select gets one extra option "Platform owner" only for `ent_001`. A change of enterprise calls `chooseFakeEnterprise(id)` (it reloads the page). "Platform owner" calls `setPlatformOwnerMode(true)` and previews as the owner `usr_001`; any person choice sets the mode off. The control draws nothing in the real build (`PROTOTYPE` check stays).

- [ ] **Step 1: Write the failing test** `PreviewAs.test.tsx`: `lists the two fake enterprises`; `changing the enterprise stores the id and reloads` (spy on `location.reload`); `shows Platform owner only for ent_001`; `choosing Platform owner turns the mode on and choosing a person turns it off`; `draws nothing in the real build`; an Arabic render shows the Arabic names.
- [ ] **Step 2: Run.** `npx vitest run src/app/PreviewAs.test.tsx --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement** the control and the six word keys. Run `npx vitest run src/i18n src/app --testTimeout=60000` (the word tests check the pairs, the Arabic style and the em-dash rule). Expect PASS.
- [ ] **Step 4: Commit.** `git add src && git commit -m "Preview as picks the fake enterprise first, and can open the platform owner view"`
- [ ] **Step 5: Screenshots.** The lead takes them (Lead step 1). The builder writes no screenshot step.

---

### Task 10: The MCP words

**Files:**
- Modify: `server/mcp/docs.ts:16,21,87,146-149` (`INSTRUCTIONS`, `readFirstAnswer`), `server/mcp/docsParity.ts:356-363` (`settings.get`, `settings.update`), `server/mcp/run.ts:46`
- Test: `server/mcp/enterpriseDocs.test.ts` (new); fix the tests that pin the old phrases (`grep -rln "architecture office\|Vado and Bunah" server`)

**Interfaces:**
- `INSTRUCTIONS` line 1 becomes "Madar is the project tool of one enterprise: projects, stages, tasks, updates, comments, the client tracker, payments and deadlines." Rule 1 becomes "You act for one person of one enterprise, with that person's rights and never more. You see nothing of any other enterprise. You have no role of your own. A call that the person may not make fails for you too." The sub-companies line uses "for example the brands or the branches of one group" in place of the two names.
- `readFirstAnswer(person, roles?, held?, enterprise?: { name: string })`: the line becomes `You act for ${name} of ${enterprise.name}, whose role in Madar is ${role}.` when `enterprise` is given; otherwise the old line. `run.ts` passes `{ name: ctx.office.lists.settings.enterpriseName }` when that name is set (plan C field).
- `settings.get` and `settings.update` descriptions list `enterpriseName`, `enterpriseNameAr` and `enterpriseLogo` and say that the limits of people and storage are not settings and an agent cannot change them. Keep each description between 40 and 600 characters (`tools.test.ts`) and keep `toolSize.test.ts` green.
- `session.get` and every `platform.*` call are on `MCP_DENY` already or by plan C. There is no `TOOL_DOCS` entry for them. The new `session.get` fields reach an agent only through `readFirstAnswer`.

- [ ] **Step 1: Write the failing tests** in `enterpriseDocs.test.ts`: `INSTRUCTIONS names no architecture office, no Vado and no Bunah`; `INSTRUCTIONS says one person of one enterprise`; `readFirstAnswer names the enterprise and keeps the old line without it`; `settings docs name the three enterprise fields and the owner-only limits`; `the tool list of an Admin agent holds no name that starts with platform.` (use the function that `tools.test.ts` uses for the Admin list); `every platform.* name of PLATFORM_CALL_NAMES is refused by tools/call with the same answer as an unknown tool` (the MCP app test harness of `app.test.ts`).
- [ ] **Step 2: Run.** `npx vitest run server/mcp/enterpriseDocs.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Implement.** Then `npx vitest run server/mcp --testTimeout=60000` and `npm run typecheck`. Fix pinned phrases in old tests only where they quote the changed lines. Expect PASS.
- [ ] **Step 4: Commit.** `git add server && git commit -m "MCP words: one person of one enterprise, no real sub-company names"`

---

### Task 11: The sweep of VADO text (D1)

**Files:**
- Create: `src/i18n/neutralWords.test.ts`
- Modify: `src/i18n/en.json:770,1070`, `src/i18n/ar.json:870,1214` (or the track file if a key moves; a changed base value stays in its base file)
- Test: `src/i18n/neutralWords.test.ts`; the tests that pin the old hint texts (`grep -rn "KH-26-001\|for example KH" src --include='*.test.*'`)

**Interfaces:** Changes: `search.emptyHint` (en 770, ar 870) uses "a project code such as 260902AZT" / «رمز مشروع مثل 260902AZT» in place of `KH-26-001`. `admin.prefixHint` (en 1070, ar 1214) uses "for example AB" / «مثل AB». The test scans the merged word trees (`en`, `ar` from `src/i18n/trees`), `INSTRUCTIONS`, `TOOL_DOCS` and `PARITY_DOCS` for `/vado|bunah|khobar|\bKH\b|الخبر|فادو|بناه/i` and fails with the key path. It has an empty allow list, and a comment that says every new entry needs the owner's reason.

- [ ] **Step 1: Write the failing test** `neutralWords.test.ts` as above. Expected failures: the four hint keys.
- [ ] **Step 2: Run.** `npx vitest run src/i18n/neutralWords.test.ts --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Change the four words.** Run `npx vitest run src/i18n src/features/search src/features/settings --testTimeout=60000`. Expect PASS.
- [ ] **Step 4: Write the list** in `server/enterprise/CLAUDE.md` (section "The VADO sweep"; Task 13 finishes the file). Changed: the four hints, the MCP texts (Task 10). Stays, with its reason:
  - `public/privacy.html`: the privacy page and terms for a sold service are an owner task before the first sale (design section 2).
  - `src/data/seed.ts`, `src/data/sampleSubCompanies.ts`, the codes `KH-26-...` in tests: the sample office of VADOs' Companies in the prototype and the test copy.
  - `DEFAULT_SETTINGS.codePrefix` (`server/data/lite/schema.ts:248`) and `emptyState` (`src/api/store.ts:104`): VADO's value, and the default of a plain test office. Every new enterprise gets its prefix from `EnterpriseInit.codePrefix` (plan C).
  - `src/features/map/mapStyle.ts` `START_POINT` (Al Khobar): the first view of a map with no pin. It names no word on screen. The owner may decide a Saudi-wide view later.
  - `src/lib/placeSearch.ts` `LEAVE_OUT`: it cuts city names from a map search name. It shows nothing.
  - `src/lib/insightEnv.ts`, `server/core/serverHost.ts`, `src/app/canonicalHost.ts`: host names of the product, not words.
  - The sender `madar@vado.sa` (design call 7).
  - The word "office" in the screens: it names a workplace in general, not VADO.
- [ ] **Step 5: Commit.** `git add src server && git commit -m "Words and examples name no VADO content, and a test keeps it so"`

---

### Task 12: What's new

**Files:**
- Modify: `src/whatsNew/entries.ts`, `src/whatsNew/entries.test.ts`, `src/i18n/real/ent-d.en.json`, `src/i18n/real/ent-d.ar.json`
- Test: `src/whatsNew/entries.test.ts`

**Interfaces:** Two entries, ids `2026-11-08-N` and `2026-11-08-N+1`. N is the next number above the highest id on `main` and on every open `rb/*` branch (`git branch --list 'rb/*'`, then `git show rb/<x>:src/whatsNew/entries.ts`, sort as numbers). On 2026-11-08 the highest is 153. Both go second and third in the list (under the usage entry, rule of `src/i18n/CLAUDE.md`), with `day: '2026-11-08'` (the lead sets the real release day).
- Entry N, for every person, no `right`, no `to`: title "Your company name and logo" / «اسم شركتك وشعارها»; body "Madar now shows the name and the logo of your company at the top of the app." / «يعرض مدار الآن اسم شركتك وشعارها أعلى التطبيق.»
- Entry N+1, `right: 'office.settings'`, `to: '/admin/office'` (check the section id in `src/features/settings/admin/sections.ts`): title "Change the name and logo of your company" / «غيّر اسم شركتك وشعارها»; body "In Office settings you can now write the name of your company and add its logo." / «في إعدادات المكتب يمكنك الآن كتابة اسم شركتك وإضافة شعارها.»
- No platform word goes into What's new.

- [ ] **Step 1: Write the failing test.** In `entries.test.ts` add `office.settings` to the list of rights an entry may name, and `has the two enterprise entries under the usage entry, the first for everyone and the second for office.settings, with both languages`.
- [ ] **Step 2: Run.** `npx vitest run src/whatsNew --testTimeout=60000`. Expect FAIL.
- [ ] **Step 3: Add the entries and the four word blocks** (`whatsNew.items.<id>.title` and `.body` in `ent-d.*.json`). Run `npx vitest run src/whatsNew src/i18n --testTimeout=60000`. Expect PASS. Check that no en-dash or em-dash is in the text.
- [ ] **Step 4: Commit.** `git add src && git commit -m "What's new: the name and the logo of the company"`

---

### Task 13: The guides

**Files:**
- Modify: `server/enterprise/CLAUDE.md` (plan B made it; finish it), `CLAUDE.md` (root table and the rule list), `server/CLAUDE.md`, `server/mail/CLAUDE.md`, `server/files/CLAUDE.md`, `server/google/CLAUDE.md`, `server/daftra/CLAUDE.md`, `server/mcp/CLAUDE.md`, `server/office/CLAUDE.md`, `src/app/insight/CLAUDE.md`, `src/api/CLAUDE.md`, `tests/CLAUDE.md`, `.github/CLAUDE.md`, `TASKS.md`
- Test: none (a doc task). The check is the grep in Step 3.

**Interfaces:** Each guide line that Tasks 1 to 12 made wrong is fixed in this commit (root rule "Keep the guides true"). Write STE, no em-dash.

- [ ] **Step 1: Write these changes.**
  - `server/enterprise/CLAUDE.md`: add the sections "Mail" (keys, refs, the pool, its limits and the share), "Files" (prefix `e/ent-NNN/`, the guard), "Google" (keys, state, the callback), "Daftra" (ENT_VADO only), "Logs and PostHog" (`ent` on lines, the request scope, usage for ENT_VADO only), "Backups" (the file name, the list op, the restore check) and "The VADO sweep" (Task 11 list). Each section names its files and its tests.
  - Root `CLAUDE.md`: one table row `| Enterprises | server/enterprise/CLAUDE.md | the enterprise id, routing, the platform object, the mail pool, the file prefix, the backups for each enterprise |`. One rule in "Rules that cross parts": "A shared store, key, topic, log line or cache never uses a bare record id. It carries the enterprise id."
  - `server/CLAUDE.md` line 6: add `enterprise/` to the list of area guides.
  - `server/mail/CLAUDE.md`: the section "Quota" (pool, `quotaLimitsOf`, `<ent>:` keys, a skipped invitation keeps its pool place until midnight). `server/files/CLAUDE.md`: the rule "Object keys" gets the prefix and the guard; the line "No meter counts the storage" stays. `server/google/CLAUDE.md`: keys per enterprise, the `ent` claim, the callback and the key cache. `server/daftra/CLAUDE.md`: the section "One account for each sub-company" gets "for ENT_VADO only; every other enterprise has no account". `server/mcp/CLAUDE.md`: INSTRUCTIONS rule 1 and the enterprise name in `readFirstAnswer`. `server/office/CLAUDE.md`: the op `enterprises` and the export of one enterprise.
  - `src/app/insight/CLAUDE.md`: the "Names" rule (usage events and replays only for ENT_VADO; other enterprises send `$exception` with `ent` and no name). `src/api/CLAUDE.md`, "Prototype data": the store key `state:<ent>`, the fake directory, the platform fakes, the choice of Task 8. `tests/CLAUDE.md`: the IndexedDB key for screenshot data is `state:ent_001`.
  - `.github/CLAUDE.md`: the `office-backup.yml` line (a loop over the enterprises, the file name, the age check for each).
  - `TASKS.md`: tick what is done and add the lead steps below as open items.
- [ ] **Step 2: Check the facts** that each guide line states against the code (names, file paths, the numbers 90, 98, 64 and 32).
- [ ] **Step 3: Run** `git diff --cached | perl -CSD -ne 'print if /^\+[^+].*\x{2014}/'` (must print nothing) and `npx vitest run scripts/vite-config.test.ts src/i18n --testTimeout=60000` (a guide change breaks no test; this proves it).
- [ ] **Step 4: Commit.** `git add -A && git commit -m "Guides: enterprises, the shared services and the changed lines of each area"`

---

## Lead steps (outside the tasks)

1. **Screenshots.** The lead takes the screenshots of the prototype Preview as control (both enterprises, and the Platform owner option) and of the two changed hints (Search empty state, Office settings code prefix): English and Arabic, light and dark, 390 px, on `npm run dev` (prototype) and `npm run dev:office`. A Playwright run goes to a subagent. Never on the test copy.
2. **Backup minutes.** After plans B and C are on the test copy, the lead starts `office-backup.yml` by hand with two enterprises, reads the minutes of the run and the release count, and fills the table in `proof.md`. This is a GitHub write and needs the owner's OK.
3. **Release day.** The lead sets the real release day of the two What's new entries before the test deploy.
4. **Merge gate.** The lead runs the gate of the root `CLAUDE.md` once: rebase on main, typecheck, `npm test`, the builds, `test:lite`, `test:office`, `test:db`, `test:it`, `test:mcp`, and `npm run smoke`.
5. **Move of the prototype data.** None. A person with old prototype data keeps it: Task 8 moves the key by itself on the first save.

## Self-review

- **Spec coverage.** 5.11 Task 3. 5.12 Tasks 1 and 2. 5.15 Task 7. 5.16 Task 6. 5.17 Google Task 4, Daftra Task 5 (D6). 5.19 Tasks 8 and 9. 5.18 What's new Task 12. 5.5 MCP words Task 10. D1 Task 11. Guides Task 13. Not in this plan, by the split of work: the name and logo display in mail, push and report headers, the consent screen, the limit checks and the satellite route (plans A and C).
- **Type consistency.** `Config.ent`, `entOfConfig`, `scopedRef` (Task 1) are used in Tasks 2, 3, 4, 5 and 6. `keysOf` (Task 3) is the only key source in Task 3 call sites. `VADO_ENTERPRISE` (Task 6) is used in Task 8.
- **Proportion.** Each task has its signatures, its values and its tests. The bodies are left to the builder.

## Risks

- Plans B and C change `officeEntry.ts`, `parts.ts`, `officeWorker.ts` and the platform object. Their final names may differ from this plan. The builder reads those files first and keeps the contract names.
- The pool adds one Durable Object call for each new mail. It does not count in `NET_BUDGET`, but spike S1 (plan B) should confirm it on the deployed test Worker.
- A skipped invitation keeps its pool place until midnight UTC. The count is one place for each skipped row.
- The share rule holds a non-VADO enterprise to 9 notice places a day on the Free plan. A 15-person trial cannot send all morning summaries. This follows design D2; the owner raises the share by a setting.
- The key `e/ent-002/` uses a hyphen, because a key allows no underscore (`keys.ts`). The contract text `e/<ent>/` means this form.

# Madar enterprises, plan E: the move of VADOs' Companies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the builder tasks (Tasks 1 to 3). The rest are
> lead steps. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the production office of VADO from Supabase into the enterprise object `ent_001` ("VADOs' Companies"), with the
directory and the platform owner in place, in one switch, with no lost record and a way back for 14 days.

**Architecture:** The exit runbook of October (R7 to R13 of Part 2 of
`docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md`) stays the base. This plan adds the enterprise steps: the import
goes into `ent_001`, the platform object gets the directory rows and the owner row, and the old untagged items end (design D5).

**Tech Stack:** Cloudflare Workers and Durable Objects (SQLite), wrangler, the import tools of `scripts/office/`, Supabase (read
only during the move).

**Spec:** `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md` (section 6, decisions D5). Shared names:
`docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md`.

## Global Constraints
- Plans A, B, C and D are on main, with the full merge gate green, before Task 1 starts.
- Every production step needs the owner's OK in chat, step by step (root `CLAUDE.md`). The owner runs the production deploy
  with a `!` command (memory "Production deploy by owner").
- Before the lead moves main or runs `all.sh`, the lead tells the peer sessions (`ListAgents`, `SendMessage`), and sends
  "released" after.
- Browser test runs use the local stack (`npm run dev:office`), never the test copy (Supabase egress rule; it also protects the
  Cloudflare free day).
- The import of production must fit one UTC day of free writes: rows x 7.5 + 2,000 is at most 90,000 minus the rows already
  written that day (R11 step 1).
- The way back: Supabase production stays deployed and unchanged for 14 days. A way back after new writes uses the reverse export
  (R6) and needs the owner's yes.
- `MADAR_ENTERPRISE_CREATE` stays closed in production during the 14 days.
- Messages to the team: in Arabic only for Abdelrahman (`usr_008`); the team notice goes in Arabic and English.
- Commits: no `Co-Authored-By` line and no `Claude-Session` line.

## Review Focus
1. A person who opens an old invitation or reset link after the switch: the link fails calmly and the screen offers "Send me a
   new link"; it never opens another enterprise. (Task 3 test.)
2. A person in state Invited before the switch: gets a new invitation after the switch (lead step 9), and the old link fails.
3. An AI agent with an old `/mcp` token: refused with 401 and a reconnect prompt, never a 500. (Task 2 test.)
4. A push device and a Google Calendar connection of a VADO person keep working after the import (lead step 11 check).
5. The Cron of the first night after the switch sends the morning summary once, not twice (the Supabase job is off). (Lead step 8.)

---

### Task 1: Open the office word for production

**Files:**
- Modify: `server/core/serverHost.ts` (`OFFICE_COPIES_OPEN`), `server/core/serverHost.test.ts`
- Modify: `wrangler.server.toml` (`[env.production]`: the bindings `OFFICE` and `PLATFORM`, the migrations `office-v1` and
  `platform-v1`, the Cron `*/15 * * * *`, the vars of the office path; never `MADAR_TEST_TOOLS`)
- Test: `server/core/serverHost.test.ts`, `server/entries/workerGraph.test.ts` (if it reads the toml)

**Interfaces:**
- Consumes: `PLATFORM` binding and class `Platform` (plan B).
- Produces: `parseServerHostSetting({ test: 'office', production: 'office' })` is valid.

- [ ] **Step 1: Write the failing test**

```ts
it('takes production: office after the enterprise move', () => {
  expect(parseServerHostSetting({ test: 'office', production: 'office' })).toEqual({ test: 'office', production: 'office' });
});
it('keeps MADAR_TEST_TOOLS out of the production env of the toml', () => {
  expect(productionVarsOf(readToml())).not.toHaveProperty('MADAR_TEST_TOOLS');
});
```
Replace the old test "refuses production: office until wave 6".

- [ ] **Step 2: Run** `npx vitest run server/core/serverHost.test.ts --testTimeout=60000`. Expected: FAIL on the first test.
- [ ] **Step 3: Implement**: add `production` to `OFFICE_COPIES_OPEN`; add the production blocks to `wrangler.server.toml`
  (copy the shape of `[env.test]`; bindings and vars do not inherit, `server/CLAUDE.md`). `config/server-host.json` stays
  `"production": "supabase"` in this task.
- [ ] **Step 4: Run** the same tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Production may take the office word; the production Worker gets the office and platform objects"`

### Task 2: The import into an enterprise of production, and the old agent tokens

**Files:**
- Modify: `scripts/office/import.ts` (with `--to` production only together with `--office ent_001`, the typed word
  `production`, and `--mode empty`), `scripts/office/import.test.ts` (or the current test of the script)
- Modify: `server/mcp/auth.ts` only if the test below fails today
- Test: `server/mcp/oauthAgent.test.ts` or the current agent-token test file

**Interfaces:**
- Consumes: `ENT_VADO` (plan B), the import of plan B step 8 (an import into an enterprise id).

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses --to production with any name other than ent_001', () => { /* exit code 2, message names --office */ });
it('refuses --to production with a mode other than empty', () => { /* exit code 2 */ });
it('answers 401 with WWW-Authenticate for an agent token with no ent claim', async () => {
  const res = await mcpRequest({ token: oldAgentTokenWithoutEnt });
  expect(res.status).toBe(401);
  expect(res.headers.get('www-authenticate')).toMatch(/resource_metadata=/);
});
```
- [ ] **Step 2: Run** the two files. Expected: FAIL on the import tests.
- [ ] **Step 3: Implement** the three refusals in the argument check of `scripts/office/import.ts`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "The import takes production only into ent_001, empty, with the typed word"`

### Task 2b: The import carries every server table that the object holds

Plan A found that `ServerRows` in `server/office/import.ts` does not carry the Google and Daftra tables. Without them the team
connects Google again and the accountant matches the Daftra clients again.

**Files:**
- Modify: `server/office/import.ts` (`ServerRows`, the finish step), `scripts/office/import.ts` (the read of Postgres)
- Test: `server/office/import.test.ts`, and the round trip of `server/office/ops.wd.test.ts`

- [ ] **Step 1: Write the failing test** `carries every server table of Postgres that the SQLite schema has`: list the server
  tables of `server/data/tables.ts` (`SERVER_TABLES`) that also exist in `server/data/lite/schema.ts`, minus a named skip list
  with one reason for each (for example `office_copy`: Postgres only). Assert that `ServerRows` names each one. Then one round
  trip each for `google_connections`, `google_events`, `google_calendars`, `daftra_clients`, `daftra_invoices` and
  `push_devices`: the rows after the import equal the rows before.
- [ ] **Step 2: Run** `npx vitest run server/office/import.test.ts --testTimeout=60000`. Expected: FAIL, the list misses the
  Google and Daftra tables.
- [ ] **Step 3: Implement** the read of each table in `scripts/office/import.ts` and its write in the finish step.
- [ ] **Step 4: Run** the test, `npm run test:lite` and `npm run test:office` (sandbox off). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "The import carries the Google, Daftra and push rows into the object"`

### Task 3: The list of open invitations, and the old links

**Files:**
- Create: `scripts/office/invited.ts` (prints the ids and emails of the people in state Invited of one copy, read only, through
  `users.invites` as the Admin; the lead keeps the output in the scratchpad, never in the repo)
- Test: `scripts/office/invited.test.ts`, and a test in the sign-in route tests of plan B for an untagged link

- [ ] **Step 1: Write the failing tests**

```ts
it('lists only the people in state Invited', async () => { /* a fake users.invites answer with 3 people, 1 Invited */ });
it('answers the calm link error for an untagged invitation link', async () => {
  const res = await openLink({ token_hash: 'a'.repeat(64), type: 'invite' });   // no "<ent>." tag
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: 'bad_input' } });
});
```
Use the error code of the current invalid-link answer of `server/auth/own/routes.ts`; read it there first.
- [ ] **Step 2: Run** the two files. Expected: FAIL on the script test.
- [ ] **Step 3: Implement** `scripts/office/invited.ts`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "A script lists the open invitations before the move"`

---

## Lead steps (each production step with the owner's OK)

- [ ] **L1. The week on the test copy** (R7, R10 with two enterprises). After plans A to D and Tasks 1 to 3 are on main:
  `all.sh test`; switch the test copy to `office`; seed `ent_001` (the sample office) and `ent_002`. The deploy suite runs on the
  local stack only. One week of use by the people the owner names. Record each day in proof.md: Worker requests, object
  requests, rows read, rows written, mails, each as a share of the free day limit, for each enterprise.
- [ ] **L2. The budget check** (R12, R13). Production's estimate plus the busiest test day, for each free day limit. At most
  80%: go on. Above 80%: stop and give the owner the numbers (form B of R-6B, or a paid plan from the first sale).
- [x] **L3. The production rehearsal** (R11, owner present, after office hours): copy production into a rehearsal object, reverse
  it into the local stack, compare, drop the spare object. Record the minutes and the rows written.
- [ ] **L4. The team notice, one day before** (owner OK on the text and on the send): one message in the general chat of Madar, in
  Arabic and English: the hour of the switch, no saves for about 40 minutes, a new sign-in once with the same password, AI agents connect again once, the old
  invitation and reset links stop. Draft (Arabic):
  «غداً بعد الدوام ننقل مدار إلى خوادم جديدة. يتوقف الحفظ نحو 40 دقيقة، وتبقى القراءة متاحة. بعد النقل، سجّل دخولك مرة واحدة بالبريد وكلمة المرور نفسها.
  واربط وكيل الذكاء الاصطناعي من جديد مرة واحدة. تتوقف روابط الدعوة وإعادة كلمة المرور القديمة، فاطلب رابطًا جديدًا إن احتجته.»
- [ ] **L5 to L9. The switch** (each step with the owner's OK). The steps and the exact commands are in `scripts/deploy/CLAUDE.md`, "The move of VADO (plan E)". That list replaces
  the first text of these steps, for four reasons found on 2026-11-09: the company row comes BEFORE the import (the import needs the platform list to hold `ent_001`); plan F removed the owner row, so the
  owner makes a platform account instead; saves stop first (`MADAR_WRITES_OFF`, owner: "Stop changes") and the 15-minute job sends the mails and pushes that wait before the import; and the
  nightly backup moves to production. The check by hand opens the platform site at `platform.madar.vado.sa`, not a page in the app. Target: Wednesday 2026-11-11, after office hours (owner, 2026-11-09: moved up from 19 November, so the test time on the test copy is two days, not a week). Add a What's new entry for the move.
- [ ] **L10. The way back window**: 14 days. Each morning the lead reads the meters and the error records. A failure that the office
  path cannot fix in a day: the owner decides on R6 (the reverse export). After 14 days with no way back: the owner's OK to open
  `MADAR_ENTERPRISE_CREATE` in production, and a later owner decision on the Supabase projects.
- [ ] **L11. The checks of the Review Focus**: a push to one person, a Google Calendar event of a meeting, the Daftra paid check
  of the next 15-minute run, an old link, an old agent token. Record each in proof.md.
- [ ] **L12. Records**: proof.md section "Madar enterprises: the move", the release record, `TASKS.md`, `docs/decision-log.md`
  (the move, the date, the window), and the exit handoff (`docs/superpowers/real-build/exit-handoff.md`: the exit is done).

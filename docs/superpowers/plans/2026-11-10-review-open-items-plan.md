# Review Open Items 2026-11-10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your track task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three open code items that the review fixes of 2026-11-10 left in `TASKS.md` ("Code review fixes (2026-11-10)"): a new person who shows as missing, a displaced refresh token that does not end its session, and a lockout that 10 addresses can still cause.

**Architecture:** Two tracks with disjoint files. Track `keys` (Opus 5.5) adds two small sign-in tables to the office object and their twins to the platform object: a memory of displaced refresh hashes, and a memory of the addresses where a person signed in. Track `joined` (Sonnet 5.5) adds an optional stamp to the person record and uses it in `checkins.week`. Fable 5.2 leads and writes no product code.

**Tech Stack:** TypeScript, zod, vitest, node:sqlite (the office object and the platform object; the own sign-in has no Postgres path).

**Spec:** `docs/superpowers/plans/2026-11-10-review-fixes-plan.md` (the first plan; its "Global Constraints" apply here word for word) and the section "Code review fixes (2026-11-10)" of `TASKS.md`.

## Global Constraints

- Every line of "Global Constraints" of the first plan applies: tests first (see the new test FAIL for the stated reason before any fix; a test that passes first means "stop and report"), ASD-STE100 English, Thmanyah Arabic, no em-dash, no attribution lines in a commit, one commit for each task on your own branch, no push, no merge, no deploy, no `git stash`, `checkout`, `restore`, `reset` or `worktree`, only `npm run typecheck` and the test files you touch, no heavy suite, no new package, no secret read, no helper agent.
- **This batch reaches main only after the VADO switch** (Wednesday 2026-11-11, about 21:30 Riyadh). The lead merges it. Reason: the track `keys` raises the schema version of the office object and of the platform object, and the switch copies production data into an office object on the schema of today.
- A released schema step never changes. A new version gets a new step and the same statements in the base schema, as every earlier version did. Read the header comment of `server/data/lite/schema.ts` and `server/enterprise/platform/schema.ts` and follow their form.
- The contract change of the track `joined` is additive: one optional field.
- Each row write in an office object counts against a free day limit. Each task below states its writes. Do not add a write that the plan does not name.

## Review Focus

1. An office object on schema 16 with live sessions takes the step to 17 and keeps every session (Task K1 pins it).
2. A displaced hash that belongs to a session that is already ended: no error, the answer is `session_ended` (Task K1).
3. The address memory holds only a sha256 key: no email and no address in a row, a log line or an error (Task K2).
4. A known address is no free pass: it still stops at 10 wrong tries of its own (Task K2).
5. A person record with no stamp (everyone today) keeps the behavior of today in `checkins.week` (Task J1).

---

# Track `keys` (Opus 5.5)

Folder `/Users/osamakhalil/dev/madar-rb/keys`, branch `rb/keys`. Guides to read first: `server/CLAUDE.md`, `server/auth/CLAUDE.md`, `server/data/CLAUDE.md` ("The SQLite path"), `server/office/CLAUDE.md`, `server/enterprise/CLAUDE.md`.

### Task K1: A displaced refresh token ends its session

**The fault.** `rotateSession` (`server/auth/own/sessions.ts`) keeps two hashes of a session: the current one and the previous one. A thief who holds a stolen token rotates twice. The token of the person is then neither the current nor the previous hash, so the person gets `session_ended` but the session row is NOT revoked, and the thief keeps a live session.

**Files:**
- Modify: `server/data/lite/schema.ts` (version 17), `server/auth/own/rows.ts`, `server/auth/own/sessions.ts`, `server/auth/own/cleanup.ts`
- Test: `server/auth/own/ops.sessions.test.ts`, `server/auth/own/cleanup.test.ts`, the schema test that pins the version and the tables (find it: `grep -rln "LITE_SCHEMA_VERSION" server --include='*.test.ts'`)
- Guides: `server/auth/CLAUDE.md` (Sessions), `server/data/CLAUDE.md` if it lists the sign-in tables

**Interfaces:**
- Produces: table `auth_old_hashes (hash text primary key, session_id text not null, at text not null)` with the index `auth_old_hashes_session (session_id)`. Schema version 17: the table and the index in the base schema, and the same statements as step 17 of `LITE_STEPS`, with a header comment line in the form of the file.
- Produces in `rows.ts`: `OLD_HASH_INSERT` (`insert or ignore into auth_old_hashes (hash, session_id, at) values (?1, ?2, ?3)`) and `OLD_HASH_BY_HASH` (`select session_id from auth_old_hashes where hash = ?1`).
- Every list in `server/` that names `auth_sessions` (`grep -rn "auth_sessions" server --include='*.ts'`: `SIGNIN_TABLES`, the copied tables of the platform schema, `server/office/ops.ts`, any export or import list) gets the same treatment for `auth_old_hashes` as `auth_sessions` has there. Name each place in your report.

**Behavior of `rotateSession`, inside its one write transaction:**
1. The hash is the current hash, or the previous hash inside the window: as today. Before `SESSION_ROTATE`, when `row.prev_hash` is not null, run `OLD_HASH_INSERT` for it (that hash leaves the row now). One more row write for each refresh that has a previous hash.
2. The hash is the previous hash after the window: as today (the session ends).
3. The hash is neither: read `OLD_HASH_BY_HASH`. A hit runs `SESSION_END` for that session id and returns `ended`, in a transaction that commits. No hit returns `ended` as today.

- [ ] **Step 1: Failing tests** in `ops.sessions.test.ts`:
  - "a displaced token ends the session of a thief": sign in (token T1). Refresh with T1 (T2). Refresh with T1 again inside the window (T3): this is the thief. Refresh with T3 (T4). Now refresh with T2 (the person): the answer is `session_ended` AND the session row has `revoked_at` set AND a refresh with T4 fails with `session_ended`. Today the row stays live and T4 still rotates.
  - "a displaced hash of an ended session gives the plain answer": the same chain, the session revoked by hand first; the refresh with T2 gives `session_ended` and no error.
  - "an unknown token ends nothing": a random token gives `session_ended`, and no session row changes.
  - The same first test for an agent session (through `exchangeToken` with `grant_type: refresh_token`, inside the 10 s window).
  - Schema: an office database on version 16 with one live session takes the steps to 17; the session row is the same, and `auth_old_hashes` exists and is empty.
- [ ] **Step 2: Run; the first and the fourth fail** (`npx vitest run server/auth/own --testTimeout=60000`).
- [ ] **Step 3: Implement** the schema step, the two SQL texts and the three cases.
- [ ] **Step 4: Clean-up.** Add to `SIGNIN_CLEANUP_LITE`, after the delete of the sessions: `delete from auth_old_hashes where session_id not in (select id from auth_sessions)`. Test in `cleanup.test.ts`: the hashes of a deleted session go, the hashes of a live session stay.
- [ ] **Step 5: Run `npx vitest run server/auth server/data/lite server/mcp/oauth --testTimeout=60000`; all pass. Guides, then commit** (`A displaced refresh token ends its session, so a thief who rotated twice loses the session`).

### Task K2: An address where the person signed in before is never locked out by strangers

**The fault.** The total stop (`SIGNIN_PER_EMAIL_TOTAL`, 100 tries in 15 minutes for one email) refuses every address. So 10 addresses with 10 wrong tries each lock the person out for 15 minutes.

**Files:**
- Modify: `server/data/lite/schema.ts` (the same version 17 as K1: one step holds both tables), `server/auth/own/rows.ts`, `server/auth/own/limits.ts`, `server/auth/own/ops.ts` (`passwordSignIn`), `server/auth/own/cleanup.ts`
- Test: `server/auth/own/ops.signin.test.ts`, `server/auth/own/cleanup.test.ts`
- Guides: `server/auth/CLAUDE.md` (Password sign-ins)

**Interfaces:**
- Produces: table `auth_known_addresses (pair_key text primary key, seen_at text not null)`. `pair_key` is `await hashedKey('known', `${email}|${limitAddress(address)}`)`: a sha256, never the email or the address.
- Produces in `limits.ts`: `export const KNOWN_ADDRESS_DAYS = 90` and `export const KNOWN_ADDRESS_TOUCH_MS = 24 * 60 * 60 * 1000`.
- Produces in `rows.ts`: `KNOWN_BY_KEY` (`select seen_at from auth_known_addresses where pair_key = ?1`) and `KNOWN_TOUCH` (`insert into auth_known_addresses (pair_key, seen_at) values (?1, ?2) on conflict (pair_key) do update set seen_at = ?2 where auth_known_addresses.seen_at < ?3`; `?3` is now minus `KNOWN_ADDRESS_TOUCH_MS`, so a person who signs in many times a day writes one row a day).
- The same treatment as `auth_sessions` in every list that names it, as in K1.

**Behavior of `passwordSignIn`:**
1. Before `countLimits`: read `KNOWN_BY_KEY`. The address is known when a row exists and `seen_at` is newer than `KNOWN_ADDRESS_DAYS`.
2. Limits: the address limit as today (not with `addressChecked`); the pair limit (`signin:pair`, 10) ALWAYS; the total (`signin:email`, 100) only when the address is NOT known.
3. After the right password, inside the write transaction that makes the session: `KNOWN_TOUCH`. At most one more row write a day for each person and address.
4. Nothing else changes: an unknown email, a wrong password, a paused enterprise and a banned person answer as today, and none of them writes a known row.

- [ ] **Step 1: Failing tests** in `ops.signin.test.ts`:
  - "a known address signs in while strangers hit the total stop": the person signs in once from address A. Then 100 wrong tries from 10 other addresses. Then the right password from A signs in (today: `too_many`).
  - "an unknown address still meets the total stop": the same, but the right password comes from a new address: `too_many`.
  - "a known address still stops at 10 wrong tries of its own": sign in from A, then 10 wrong tries from A, then the right password from A: `too_many`.
  - "a wrong password makes no known row" and "an address last seen 91 days ago is not known".
  - "the row holds no email and no address": the one row of the table has a `pair_key` that matches `/^known:[0-9a-f]{64}$/`.
  - An IPv6 case: a sign-in from one address of a /64 block makes every address of that block known.
- [ ] **Step 2: Run; the first fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Clean-up.** Add `delete from auth_known_addresses where seen_at < ?2` to the clean-up, with `?2` = now minus `KNOWN_ADDRESS_DAYS` (the clean-up function passes a second value; keep `?1` as it is). Test it.
- [ ] **Step 5: Run `npx vitest run server/auth server/data/lite --testTimeout=60000`; all pass. Guides, then commit** (`An address where the person signed in before is not locked out by the wrong tries of strangers`).

### Task K3: The platform accounts get both rules

**Files:**
- Modify: `server/enterprise/platform/schema.ts` (version 5), `server/enterprise/platform/accounts.ts`, the sweep or clean-up of the platform object that deletes old platform sessions (find it; if none exists, add the two deletes to `sweep` and say so)
- Test: `server/enterprise/platform/accounts.test.ts`, the platform schema test
- Guide: `server/enterprise/CLAUDE.md` (Accounts, the platform object)

**Interfaces:**
- Produces: tables `platform_old_hashes (hash text primary key, session_id text not null, at text not null)` and `platform_known_addresses (pair_key text primary key, seen_at text not null)`, as step 5 of `PLATFORM_STEPS` and in the base schema. Key prefix `pknown`.
- `platformRefresh` gets the three cases of K1. `platformSignIn` gets the four points of K2 with `psignin:pair` always and `psignin:email` only for an address that is not known. Reuse the constants of `limits.ts`. Share a helper with the company code only when it stays one small pure function; do not bend `rotateSession` to serve both.

- [ ] **Step 1: Failing tests** in `accounts.test.ts`: the K1 thief chain for a platform session (the row is ended, the token of the thief fails), and the K2 first three tests for a platform account. Schema: a platform database on version 4 with one account and one session takes the step to 5 and keeps both.
- [ ] **Step 2: Run; the thief test and the "known address signs in" test fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npx vitest run server/enterprise --testTimeout=60000`; all pass. Guide, then commit** (`The platform accounts get the displaced-token rule and the known-address rule of the companies`).

### Task K4: Close the track

- [ ] `npm run typecheck` is clean; the em-dash check of the first plan prints nothing; `git status` shows no untracked file.
- [ ] Report: each task as done or "finding not real"; the commit hashes; the new tests and the last output line of each run; each place where you added a new table beside `auth_sessions`; each file outside the lists above, with the reason; the row writes that each rule adds; each open point.

---

# Track `joined` (Sonnet 5.5)

Folder `/Users/osamakhalil/dev/madar-rb/joined`, branch `rb/joined`. Guides to read first: `src/api/CLAUDE.md`, `src/api/contract/CLAUDE.md`, `src/api/handlers/CLAUDE.md` ("Weekly question"), `server/enterprise/CLAUDE.md` (the create of an enterprise), `src/i18n/CLAUDE.md`.

### Task J1: A person is missing only for a question that came after the person was added

**The fault.** `checkins.week` (`src/api/handlers/checkins.ts`) lists every active person with no answer as missing. A person whom the Admin added on Wednesday is "missing" for the plan of the Sunday before, and for every past week.

**Files:**
- Modify: `src/api/contract/entities.ts` (`User`), the handler of `users.create` (find it: `grep -rn "'users.create'" src/api/handlers`), `server/enterprise/lifecycle.ts` (the first Admin of a new enterprise, near line 64), `src/api/handlers/checkins.ts`
- Test: `src/api/handlers/checkins.test.ts`, the test file of `users.create`, `server/enterprise/lifecycle.init.test.ts`
- Guides: `src/api/handlers/CLAUDE.md` ("Weekly question"), `src/api/contract/CLAUDE.md` if it lists the fields of a person

**Interfaces:**
- Produces: `User.createdAt`, optional, an ISO stamp in the same zod type that the other stamps of `entities.ts` use (for example `Checkin.createdAt`). A comment says: set when the person is added; a person saved before 2026-11-10 has none, and that reads as "always there".
- `users.create` sets `createdAt: ctx.stamp` for the new person. The first Admin of a new enterprise gets the stamp of its create. An agent user gets none. No backfill, no migration, no `STATE_VERSION` step (an optional field of a stored record). If you find that the `users` table keeps a typed column for each field, so that a new field needs a migration, stop and report.
- `checkins.week`: a person with a `createdAt` is left out of `missing.plan` when the day of `createdAt` (office time, with the helper `stampDay` of `src/lib/dates.ts`) is after the Sunday of the week (`week`), and out of `missing.review` when that day is after the Thursday of the week (`reviewDay(week)`). A person with no `createdAt` is treated as today.
- No view, no wire form and no MCP answer needs the field. If an output shape strips unknown keys and a test fails on the new key, keep the field out of that output. Do not add it to a card or a list row.

- [ ] **Step 1: Failing tests** in `checkins.test.ts` (set the stamp on a sample person in the test state):
  - "a person added on Wednesday is not missing for the plan of that week, and is missing for its review from Thursday".
  - "a person added on Friday is missing for neither".
  - "a person added this week is not missing in an earlier week".
  - "a person with no stamp is missing as before".
  - In the test of `users.create`: the new person holds `createdAt` equal to the stamp of the call. In `lifecycle.init.test.ts`: the first Admin holds one.
- [ ] **Step 2: Run; the first three fail.**
- [ ] **Step 3: Implement.** Check every place that builds a whole `User` record by hand (`grep -rn "kind: 'human'" src server --include='*.ts'`): a place that adds a real person sets the stamp; a sample or a test office does not need it.
- [ ] **Step 4: Run `npx vitest run src/api/handlers/checkins.test.ts <the users.create test> server/enterprise/lifecycle.init.test.ts src/api/contract --testTimeout=60000`, then `npx vitest run server/core server/data/loaders --testTimeout=60000` (the sweep and the loaders read people). All pass. Guide lines, then commit** (`A new person is missing in the week of the team only for a question that came after the person was added`).

### Task J2: What's new, for both tracks

**Files:** `src/whatsNew/entries.ts`, the two What's new word files, `src/whatsNew/entries.test.ts` (the rules are in `src/i18n/CLAUDE.md`).

One new entry with the day 2026-11-10 (the lead moves the day at the merge), that everyone sees:
- EN: `The week of the team no longer lists a new person as missing for a question from before they joined.` AR: `صفحة أسبوع الفريق لا تذكر الموظف الجديد في سؤال سبق انضمامه.`
- EN: `Sign-in protects you better: the place where you usually sign in keeps working when a stranger tries wrong passwords.` AR: `الدخول يحميك أكثر: المكان الذي تدخل منه عادةً يبقى يعمل حتى لو جرّب غريب كلمات سر خاطئة.`

- [ ] Add the entry and its pins, run the What's new tests that the guide names; pass. Commit (`What's new: the new person in the week of the team and the known sign-in place`).

### Task J3: Close the track

- [ ] `npm run typecheck` is clean; the em-dash check prints nothing; `git status` shows no untracked file.
- [ ] Report: each task as done or "finding not real"; the commit hashes; the new tests and the last output line of each run; each file outside the lists above, with the reason; each place that makes a real person and whether it sets the stamp; each open point.

---

# The lead (Fable 5.2)

- [ ] Read both branches. Rebase `rb/joined` on `rb/keys`. Run the merge gate once on the joined branch: typecheck, `npm test`, the three builds, `test:lite`, `test:office`, `test:db`, `test:it`, `test:mcp`, and the auth.setup, account and agents specs on the local office stack through one subagent.
- [ ] Wait for the message of the switch session that the VADO switch is done. Then rebase on the new main, run the type check and the touched tests again, set the day of the What's new entry to the production day, tell the peers, fast-forward main, `all.sh test`, and hand the owner the production command.
- [ ] Before the production deploy: check on the test copy that an office object on schema 16 took the step to 17 and that a signed-in person stayed signed in.
- [ ] `TASKS.md`: tick the three open items; the Cloudflare request quota stays as an accepted risk with its reason (the one free rate limit rule counts 10 seconds for each address, so it cannot protect a day quota).

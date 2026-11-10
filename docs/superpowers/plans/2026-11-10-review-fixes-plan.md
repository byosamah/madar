# Review Fixes 2026-11-10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your track task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 9 findings of the code review of 2026-11-10 in production code, each one proven first by a test that fails.

**Architecture:** Two tracks with disjoint files. Track `doors` (Opus 5.5) closes the 5 faults of the sign-in and the Pages forwarders. Track `rules` (Sonnet 5.5) fixes the 4 faults of the weekly question, the storage count and the upload refusal. Fable 5.2 leads: it writes no product code, it rebases, runs the merge gates once and releases.

**Tech Stack:** TypeScript, Hono 4.13.12, zod, vitest, node:sqlite and Postgres (the two database paths), Cloudflare Pages Functions and Workers.

**Spec:** The review result of 2026-11-10 (9 findings; copied into "The findings" below) and two owner answers of 2026-11-10 (in "Owner decisions").

## Global Constraints

- Tests first. For each task: write the test, run it, and see it FAIL for the reason the finding names. **If the test passes before any fix, the finding is not real: stop that task, change no product code for it, and report it.**
- Every text is ASD-STE100 Simplified Technical English: code comments, commit messages, guide lines, words. Never an em-dash. Before each commit, `git diff main | grep -E "^\+[^+].*$(printf '\xe2\x80\x94')"` prints nothing.
- Every Arabic text follows the Thmanyah rules (`src/i18n/CLAUDE.md`, "Arabic style").
- Commits: no `Co-Authored-By` line and no `Claude-Session:` link. Commit only on your own branch. No push, no deploy, no merge, no `git stash`, `checkout`, `restore` or `reset`.
- Edit only the files of your own track. A needed change in another file: stop and report it to the lead.
- Read the guide of a part before you change it (the root `CLAUDE.md` lists them). When a change makes a guide line wrong, fix the line in the same commit.
- The test count only grows. Do not delete or weaken a test; a test that pins the old behavior gets the new value and one comment line with the reason.
- No separate checker. During the build run only `npm run typecheck` and the test files you touch (`npx vitest run <files> --testTimeout=60000`). Do not run `npm test`, `test:db`, `test:it`, `test:mcp`, `test:office`, a build or Playwright: the lead runs them once.
- Never open, print or log a secret (`.env.local`, `secrets/`).
- No new package. No paid service.
- A contract change is additive. No migration is planned; if you find that one is needed, stop and report.

## Owner decisions (2026-11-10)

1. **Lockout (finding 3):** count the wrong tries for each email and network address together (10 in 15 minutes). Keep a total stop of 100 tries in 15 minutes for one email.
2. **Renew window (finding 5):** 60 seconds in place of 10.
3. Lead decisions (noted to the owner, not asked): the authorize step gets 60 requests an hour for each address; a review of the week is refused before its Thursday, as Home already asks for it only from Thursday; the map link route needs the token of a signed-in person.

## The findings

| # | File | Fault | Track |
| --- | --- | --- | --- |
| 1 | `server/mcp/oauth/routes.ts:29`, `server/auth/rateLimit.ts` | The authorize step writes one row for each request with no limit. Also `hitLimit` writes one row for EVERY hit, also over the limit, so each limited route has the same fault. | doors |
| 2 | `server/http/pagesApiProxy.ts:53` | `/api/%70latform/...` passes the forwarder; Hono decodes it to `/api/platform/...`. | doors |
| 3 | `server/auth/own/ops.ts:51` | The email limit counts before the password check, so a stranger locks a person out. | doors |
| 4 | `server/http/pagesMapLink.ts:71` | `/maplink` takes any client that sends no `sec-fetch-site` header. | doors |
| 5 | `server/auth/own/sessions.ts:20` | A retry with the previous refresh token after 10 s ends the session. | doors |
| 6 | `src/api/handlers/checkins.ts:128` | `checkins.week` lists a person without the switch `checkin.answer` as missing. | rules |
| 7 | `server/calls/files.ts:188` | `files.upload` with no place answers 500 (`part('')` throws) in place of `office_needs_task`. | rules |
| 8 | `server/enterprise/storage.ts:39` | The open-upload sum leaves out `feedback/%`, but the keys of another enterprise start with `e/<ent>/feedback/`. | rules |
| 9 | `src/api/handlers/checkins.ts:83` | `checkins.save` takes a review before the Thursday of the week. | rules |

Not planned, with the reason: the forgot limit of 3 an hour for an email (the review named it beside finding 3). It is no lockout: each new reset link ends the older ones and lives 1 hour, so the person already holds a link that works, and the limit keeps a stranger from a mail flood.

## Review Focus

1. Two parallel hits at the last free place of a limit: exactly one passes (Task D1 pins it on SQLite; the lead runs it on Postgres).
2. A double-encoded path (`/api/%2570latform`) and a path with a bad escape (`/api/%zz`): both get 404 at the forwarder (Task D2).
3. The office path passes `addressChecked: true`: the pair limit must still count there, with the address of the person, not of the Pages Function (Task D3).
4. An old Safari that sends no `sec-fetch-site` but holds a good token still gets its map link (Task D4).
5. The sweep `server/core/everyCall.ts` calls `checkins.save`: on a day before Thursday a review input must not break the sweep (Task R4).

---

# Track `doors` (Opus 5.5)

Folder `/Users/osamakhalil/dev/madar-rb/doors`, branch `rb/doors`. Guides to read first: `server/CLAUDE.md`, `server/auth/CLAUDE.md`, `server/mcp/oauth/CLAUDE.md`, `server/enterprise/CLAUDE.md`, `functions/CLAUDE.md`, `src/features/map/CLAUDE.md`.

### Task D1: A limit that stops writing, and a limit on authorize (finding 1)

**Files:**
- Modify: `server/auth/rateLimit.ts`, `server/auth/own/limits.ts`, `server/mcp/oauth/ops.ts` (`startAuthorization`), `server/mcp/oauth/routes.ts:29-32`
- Test: `server/auth/rateLimit.test.ts`, `server/mcp/oauth/register.test.ts` (or a new `server/mcp/oauth/authorize.test.ts` when the harness fits better)
- Guides: `server/auth/CLAUDE.md` (Limits line), `server/mcp/oauth/CLAUDE.md` (Routes)

**Interfaces:**
- Produces: `hitLimit` keeps its signature and `LimitResult`. New meaning: the hit that takes the count to `limit + 1` is the last write of a window; each later hit of that window writes nothing and returns `{ ok: false, count: limit + 1, retryAfterMs }`.
- Produces: `export const AUTHORIZE_PER_ADDRESS = 60` in `limits.ts` (one hour, `HOUR_MS`).
- Produces: `startAuthorization(deps, input: { query: Record<string, string>; address: string })`.

- [ ] **Step 1: Failing tests.**
  - `rateLimit.test.ts`, "a hit over the limit writes no row": limit 3; hit 6 times; read the row; `count` is 4 (today it is 6). Results: hits 1 to 3 `ok: true`, hits 4 to 6 `ok: false` with `count: 4`.
  - Same file, "two hits at the last place": limit 1, two `hitLimit` calls with `Promise.all`; exactly one `ok: true`.
  - OAuth test, "authorize stops at 60 an hour for one address": register one client, send 61 valid authorize steps with the same address; step 61 fails with reason `too_many`, and `select count(*) from oauth_requests` is 60. A step from a second address still passes.
- [ ] **Step 2: Run them; all three fail** (`npx vitest run server/auth/rateLimit.test.ts server/mcp/oauth --testTimeout=60000`).
- [ ] **Step 3: Change `RATE_SQL` and `RATE_LITE`.** Add the condition to the update of the upsert: `... do update set count = rate_limits.count + 1 where rate_limits.count <= $3 returning count` (SQLite `?3`), with the limit as the third value. No returned row means over the limit: return `count: limit + 1`, `ok: false`. Fix the comment of the file. Check each caller of `hitLimit` (`grep -rn "hitLimit(" server`): none may read a count above `limit + 1`.
- [ ] **Step 4: Authorize.** `routes.ts` passes `address: clientAddress(c.req.raw)`. `startAuthorization` calls `countLimits(deps, [{ key: await hashedKey('authorize:ip', input.address), limit: AUTHORIZE_PER_ADDRESS, windowMs: HOUR_MS }])` as its first line, before the client read. Find every other caller of `oauth.authorize` (`grep -rn "oauth.authorize" server`) and pass the address.
- [ ] **Step 5: Run the touched tests; all pass.** Also run `npx vitest run server/auth server/mcp/oauth server/enterprise/platform --testTimeout=60000` and fix a test that pinned a count above `limit + 1`.
- [ ] **Step 6: Guides, then commit** (`A rate limit writes no row over its limit, and the authorize step of an AI app has a limit for each address`).

Report to the lead: whether `server/office` has a test that reads the rows-written meter of workerd (`rowsWritten`). If yes, name it; the lead decides on a pin. Do not run `test:office`.

### Task D2: The forwarder reads the decoded path (finding 2)

**Files:**
- Modify: `server/http/pagesForward.ts` (new helper beside `unsafeSuffix`), `server/http/pagesApiProxy.ts:49-53`
- Test: `server/http/pagesApiProxy.test.ts`
- Guide: `functions/CLAUDE.md`

**Interfaces:**
- Produces: `export function plainSuffix(suffix: string): string | null` in `pagesForward.ts`. It decodes the suffix with `decodeURIComponent` until it no longer changes, at most 3 times; a throw, or a text that still changes after 3 rounds, gives `null`.

- [ ] **Step 1: Failing tests** in `pagesApiProxy.test.ts`, each on a production host with a binding spy: `POST /api/%70latform/auth/token`, `POST /api/%50latform` is NOT refused by this rule (Hono routes are case-sensitive; assert it reaches the binding), `/api/%2570latform/auth/token`, `/api/platfor%6d`, `/api/%zz`. Expected for the four bad ones: status 404 and the binding spy has 0 calls. Keep one positive case: `/api/batch?x=%20` still reaches the binding with the same path and query.
- [ ] **Step 2: Run; the encoded platform cases fail** (they reach the binding today).
- [ ] **Step 3: Implement.** In `proxyApi`: `const plain = plainSuffix(suffix); if (plain === null) return 404;` then test `/platform` and `/office` (the `ops` flag) on `plain`, not on `suffix`. The request to the binding keeps the raw `suffix`.
- [ ] **Step 4: Read `server/http/pagesPlatformProxy.ts` and `pagesMcpProxy.ts`.** If either compares a raw path against a fixed word, apply `plainSuffix` there and add one test for each. If not, write one line in your report.
- [ ] **Step 5: Run `npx vitest run server/http --testTimeout=60000`; all pass. Guide line, then commit** (`The company forwarder refuses an encoded path to the platform routes`).

### Task D3: Wrong tries count for each email and address together (finding 3)

**Files:**
- Modify: `server/auth/own/limits.ts`, `server/auth/own/ops.ts` (`passwordSignIn`), `server/enterprise/platform/accounts.ts` (`platformSignIn`, the same rule with its own keys)
- Test: `server/auth/own/ops.signin.test.ts`, `server/enterprise/platform/accounts.test.ts`
- Guides: `server/auth/CLAUDE.md` (Limits), `server/enterprise/CLAUDE.md` (Accounts)

**Interfaces:**
- Produces in `limits.ts`: `SIGNIN_PER_EMAIL = 10` stays and now counts the pair; new `export const SIGNIN_PER_EMAIL_TOTAL = 100` (same 15-minute window). Fix both comments.
- Keys of `passwordSignIn`: `hashedKey('signin:pair', `${email}|${input.address}`)` with `SIGNIN_PER_EMAIL`, and `hashedKey('signin:email', email)` with `SIGNIN_PER_EMAIL_TOTAL`. The address key (`ADDRESS_LIMITS`) stays as it is, with `addressChecked`.
- Platform twins: `psignin:pair` and `psignin:email`, same numbers.

- [ ] **Step 1: Failing tests** in `ops.signin.test.ts`:
  - "a stranger does not lock the person out": 10 wrong passwords for the email from address A; then the right password from address B gives a token (today: `too_many`).
  - "the same address stops at 10": try 11 from address A fails with `too_many`, also with the right password.
  - "the total stop": 100 wrong tries spread over 10 addresses (10 each); the right password from an 11th address fails with `too_many`.
  - "office path": the same first test with `addressChecked: true` on every call.
  - The same first two tests for `platformSignIn` in `accounts.test.ts`.
- [ ] **Step 2: Run; the first, third and fourth fail.**
- [ ] **Step 3: Implement** the keys above. Check in `server/entries/officeSignin.ts` (and the platform route) that the step input carries the real address of the person (`clientAddress`) on the office path. If it does not, pass it and add it to the test.
- [ ] **Step 4: Run `npx vitest run server/auth server/enterprise/platform --testTimeout=60000`; all pass. Guides, then commit** (`A stranger with wrong passwords no longer locks a person out: the limit counts the email and the address together`).

### Task D4: The map link route needs a signed-in person (finding 4)

**Files:**
- Modify: `server/http/pagesMapLink.ts`, `functions/maplink.ts`, `src/lib/shortLink.ts`, its caller `src/features/map/PinPicker.tsx`; `server/http/pagesSatellite.ts` only to export or move the person check
- Test: `server/http/pagesMapLink.test.ts`, `src/lib/shortLink.test.ts`, `src/features/map/PinPicker.test.tsx`
- Guides: `functions/CLAUDE.md`, `src/features/map/CLAUDE.md`

**Interfaces:**
- Consumes: the person check of the satellite tiles (`isPerson` in `pagesSatellite.ts`: a browser token of a person of this copy, on the Supabase key or the own key). Reuse it; do not write a second token check. Move it to a shared file only if an import of `pagesSatellite.ts` pulls tile code into `functions/maplink.ts`.
- Consumes: the way the screens give the token to a fetch outside `api.call` (`src/app/remote/tileToken.ts`).
- Produces: `resolveMapLink(request, env, deps?)` answers 401 `{ error: 'unauthenticated' }` with no outside fetch when the request has no good token. The `sec-fetch-site` check stays.
- Produces: `resolveShortLink(link, token?)` sends `Authorization: Bearer <token>` when it has one. `src/lib` must not import `src/app`: the caller passes the token.

- [ ] **Step 1: Failing tests.** `pagesMapLink.test.ts`: a POST with no `sec-fetch-site` and no token gives 401 and the fetch spy has 0 calls; a POST with a good token and no `sec-fetch-site` gives 200 (old Safari); a POST with a good token and `sec-fetch-site: cross-site` gives 403. `shortLink.test.ts`: the request carries the header when a token is given.
- [ ] **Step 2: Run; the 401 case fails** (today 200 or 502).
- [ ] **Step 3: Implement.** In the real build the picker passes the token; in the prototype there is no token and no `/maplink` route, so the call fails calm as today (`null`).
- [ ] **Step 4: Run `npx vitest run server/http/pagesMapLink.test.ts server/http/pagesSatellite.test.ts src/lib/shortLink.test.ts src/features/map --testTimeout=60000`; all pass. Guides, then commit** (`The map link route answers only a signed-in person`).

No screen changes its look, so no screenshot. The lead checks one short link by hand on the test copy.

### Task D5: The renew window is 60 seconds (finding 5)

**Files:**
- Modify: `server/auth/own/sessions.ts:19-20` (`REFRESH_REUSE_MS = 60_000` and its comment), the twin window of the platform sessions in `server/enterprise/platform/accounts.ts` if it holds its own number (make it import `REFRESH_REUSE_MS`)
- Test: `server/auth/own/ops.sessions.test.ts`, `server/enterprise/platform/accounts.test.ts`
- Guides: `server/auth/CLAUDE.md` (Sessions), `server/enterprise/CLAUDE.md` ("the 10 s reuse window")

- [ ] **Step 1: Failing test** "a retry 30 seconds after a lost answer keeps the session": sign in, refresh once (drop the answer), move the clock 30 s, refresh again with the FIRST token: it gives a token, and the session row has `revoked_at` null. Keep or add: at 61 s the same retry fails with `session_ended` and the row is revoked.
- [ ] **Step 2: Run; the 30 s test fails.**
- [ ] **Step 3: Change the constant.** `grep -rn "10 s\|10_000\|REFRESH_REUSE" server src docs/superpowers/real-build` and fix each line that states the old time for this window (not other 10 s values).
- [ ] **Step 4: Run `npx vitest run server/auth server/enterprise/platform --testTimeout=60000`; all pass. Commit** (`A lost answer of a session renew keeps the person signed in for 60 seconds, not 10`).

### Task D6: Close the track

- [ ] `npm run typecheck` is clean.
- [ ] `git diff main | grep -E "^\+[^+].*$(printf '\xe2\x80\x94')"` prints nothing; `git status` shows no untracked file.
- [ ] Report to the lead: each task as done or "finding not real", the test files, each file outside the lists above that you had to touch, and each open point.

---

# Track `rules` (Sonnet 5.5)

Folder `/Users/osamakhalil/dev/madar-rb/rules`, branch `rb/rules`. Guides to read first: `src/api/CLAUDE.md`, `src/api/handlers/CLAUDE.md` ("Weekly question"), `server/CLAUDE.md`, `server/files/CLAUDE.md`, `server/enterprise/CLAUDE.md` (Limits), `server/mcp/CLAUDE.md` (the size of the tool list), `src/i18n/CLAUDE.md`.

### Task R1: `checkins.week` names as missing only a person who may answer (finding 6)

**Files:**
- Modify: `src/api/handlers/checkins.ts:126-131`
- Test: `src/api/handlers/checkins.test.ts`
- Guide: `src/api/handlers/CLAUDE.md` ("Weekly question")

- [ ] **Step 1: Failing test** "a person without the switch is not missing": give one active person a role with `checkin.answer` off (the helper that the rights tests use, for example `roleWithout`); `checkins.week` as a reader: that person is in neither `missing.plan` nor `missing.review`; a person with the switch and no answer still is.
- [ ] **Step 2: Run; it fails.**
- [ ] **Step 3: Implement.** `active` also filters `can(withRights(ctx.state, user), 'checkin.answer')`, the same test as `runScheduledTriggers` (`src/api/notify.ts:343`). One rule, two places: say so in a comment.
- [ ] **Step 4: The person who joined later.** Look at the `User` record (`src/api/contract/entities.ts`) for a stamp of the day the person was added. If one exists, also leave out of `missing` a person added after the Saturday of the week (`addDays(week, 6)`), with a test. If none exists, change nothing for it and write it in your report: the lead adds an open item.
- [ ] **Step 5: Run `npx vitest run src/api/handlers/checkins.test.ts --testTimeout=60000`; pass. Guide line, then commit** (`The week of the team names as missing only the people who may answer`).

### Task R2: `files.upload` with no place answers `office_needs_task` (finding 7)

**Files:**
- Modify: `server/calls/files.ts:182-189` (the preflight of `filesUploadHooks`)
- Test: `server/calls/files.test.ts`

- [ ] **Step 1: Failing test** "an upload that names no place is refused calm": run `files.upload { uploadId, name }` (the id of a real chat intent of the actor, no `projectId`, `taskId`, `conversationId`, `meetingId`, `resources`) through the harness of the file: the error is `invalid_input` with reason `office_needs_task` and field `projectId`. Today it is a plain `Error` ("is not a valid id for an object key").
- [ ] **Step 2: Run; it fails.**
- [ ] **Step 3: Implement.** Before `place`: when `resources !== true`, `meetingId`, `conversationId` and `projectId` are undefined and `taskId` is empty or null, throw the same refusal as `server/calls/files.ts:102` (`invalid('projectId', 'Name the project, or the office task of the file.', 'office_needs_task')`). Then `officeTaskId: taskId` needs no `?? ''`.
- [ ] **Step 4: Run `npx vitest run server/calls/files.test.ts --testTimeout=60000`; pass. Commit** (`An upload that names no project and no task gets the clear refusal, not an error 500`).

### Task R3: Report screenshots do not count for any enterprise (finding 8)

**Files:**
- Modify: `server/enterprise/storage.ts:35-56`, the one caller `server/calls/files.ts:83` only if the `Pick` of the deps needs it
- Test: `server/enterprise/storage.test.ts`
- Guide: `server/enterprise/CLAUDE.md` (Limits)

**Interfaces:**
- Produces: `assertStorageRoom(deps: Pick<Deps, 'db' | 'enterprise' | 'config'>, size, o)`. The SQL takes a third value, `${keysOf(entOfConfig(deps.config)).screenshotPrefix}%`, in `key not like ?3`. A key part holds no `_` and no `%` (`part()` in `server/files/keys.ts`), so the pattern needs no escape: say so in the comment.

- [ ] **Step 1: Failing test** "the screenshots of another enterprise do not count": deps of `ent_002` with a storage limit of 100 bytes and 0 used; one open intent of the actor with the key `keysOf('ent_002').screenshotKey('upl_001')` and size 90; `assertStorageRoom(deps, 50, { now, actorId })` passes (today it throws `storage_limit`). Keep a twin for `ENT_VADO` and one where a real file intent of 90 bytes still refuses.
- [ ] **Step 2: Run; the `ent_002` case fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npx vitest run server/enterprise/storage.test.ts server/calls/files.test.ts --testTimeout=60000`; pass. Guide line, then commit** (`The open report screenshots of every company stay out of the storage count`).

### Task R4: A review of the week opens on its Thursday (finding 9)

**Files:**
- Modify: `src/api/handlers/checkins.ts:83-88`, `server/mcp/docs.ts` (`TOOL_DOCS` of `checkins.save`), `server/core/everyCall.ts` if its input is a review
- Create: the two word files of this track for the new reason (follow `src/i18n/CLAUDE.md` for the file names and the key of `errors.reasons.<reason>`)
- Test: `src/api/handlers/checkins.test.ts`, the words test that the guide names
- Guides: `src/api/handlers/CLAUDE.md` ("Weekly question"), `server/mcp/CLAUDE.md` only if a rule line changes

**Interfaces:**
- Produces: reason `review_not_yet`, thrown as `invalid('kind', 'The review of the week opens on Thursday.', 'review_not_yet')` when `input.kind === 'review'` and `reviewDay(week) > ctx.today`. The check sits after `assertCan` and before the to-do check.
- Words: English `The review of the week opens on Thursday.` Arabic `تفتح مراجعة الأسبوع يوم الخميس.`

- [ ] **Step 1: Failing tests:** on the Sunday to Wednesday of a week a review save fails with `review_not_yet` and stores nothing; on Thursday, Friday and Saturday it saves; a plan saves on every day. Use the way of the file to set `ctx.today`.
- [ ] **Step 2: Run; the first fails.**
- [ ] **Step 3: Implement** the check and the words.
- [ ] **Step 4: MCP.** Add to the `TOOL_DOCS` of `checkins.save` that a review opens on Thursday. The tool list sits at its size cap: cut the same number of characters inside the same text. Run `npx vitest run --project server server/mcp --no-file-parallelism` and keep the pinned phrases.
- [ ] **Step 5: The sweep.** `server/core/everyCall.ts`: if the `checkins.save` input is a review, make it a plan (a plan passes on every day). Run `npx vitest run server/core/everyCall.test.ts --testTimeout=60000` if that file exists, else the test that the guide of `server/` names for the sweep.
- [ ] **Step 6: Run the touched tests; pass. Guide line, then commit** (`A review of the week opens on its Thursday, so an early save no longer stops the reminder`).

### Task R5: What's new, for both tracks

**Files:**
- Modify: `src/whatsNew/entries.ts`, `src/i18n/.../whatsnew.en.json`, `whatsnew.ar.json` (the id, day and order rules are in `src/i18n/CLAUDE.md`)

One entry for 2026-11-10 that everyone sees, with these lines (keep them short, in the person's terms; adjust only to fit the style of the file):
- EN: `Sign-in is safer: a stranger with wrong passwords can no longer lock you out.` AR: `الدخول أكثر أماناً: لا يستطيع غريب أن يقفل حسابك بكلمات سر خاطئة.`
- EN: `A short network drop no longer signs you out.` AR: `انقطاع الشبكة القصير لا يخرجك من حسابك.`
- EN: `The week of the team lists as missing only the people who answer the weekly question.` AR: `صفحة أسبوع الفريق تذكر فقط من عليه أن يجيب عن سؤال الأسبوع.`

- [ ] Add the entry, run the What's new tests that the guide names; pass. Commit (`What's new: the sign-in and weekly question fixes of 2026-11-10`).

### Task R6: Close the track

- [ ] `npm run typecheck` is clean.
- [ ] `git diff main | grep -E "^\+[^+].*$(printf '\xe2\x80\x94')"` prints nothing; `git status` shows no untracked file.
- [ ] Report to the lead: each task as done or "finding not real", the test files, the answer of Task R1 step 4, each file outside the lists above that you had to touch, and each open point.

---

# The lead (Fable 5.2): after both reports

- [ ] Read both branches (`git diff main...rb/doors`, `git diff main...rb/rules`). Check that the file sets are disjoint.
- [ ] Tell the peer sessions before main moves (`ListAgents`, `SendMessage`).
- [ ] Rebase `rb/rules` on `rb/doors`. Run the merge gate once, in the background, one heavy run at a time: `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, `npm run build:remote -- test`, `npm run test:lite`, `npm run test:office`, `npm run test:db`, `npm run test:it`, `npm run test:mcp`. `test:db` proves Task D1 on Postgres.
- [ ] A red check goes back to the builder of that track with the output. No merge with a red check.
- [ ] Fast-forward main in `deploy-test`, add the TASKS.md lines (the 9 findings ticked; open items from the reports), then `all.sh test`.
- [ ] By hand on the test copy: one short Google Maps link in the pin picker; one sign-in.
- [ ] Hand the owner the push command and the production deploy command. Send "released" to the peers.

# Madar redesign tasks

Spec: docs/superpowers/specs/2026-10-01-madar-calm-redesign-design.md. Plans 1 to 5 are done.

## Step A

- [x] 1. Tokens and project colors
- [x] 2. Gentle due words
- [x] 3. Calm shared parts
- [x] 4. The tab pill, the person menu and the routes
- [x] 5. The Projects list
- [x] 6. Home
- [x] 7. A calm project header and the About panel
- [x] 8. Calm task rows and one filter button

## Step B

- [x] Solid panels for sheets, popovers, menus, toasts; Glass setting removed
- [x] Dashboard: filter button, three numbers, Projects / People / Schedule
- [x] Calm colors for schedules, board, workload
- [x] Inbox, Search, Settings restyle; one main button per screen
- [x] Focus mode with the 25-minute timer
- [x] The 8 motion moments and the screen entrance
- [ ] Browser sweep (agent running)
- [ ] Independent review and fix pass (agent running)
- [ ] Guide and report (agent running)
- [ ] Review link, merge to main, memory

## Full product audit (2026-10-03)

- [x] Decisions filter in the Activity tab (main 77d087a, v42)
- [x] Language-turn fix: page stayed hidden after leaving Settings mid-turn
- [x] Five code auditors done: api 21, project 25, shell 23, dashboard 17, personal 19 findings
- [x] Browser auditor: 20 findings (BRW), all assigned
- [x] Personal fixes PER-1..19 (branch audit-fixes, 540a094)
- [x] Parallel fixers done: api 27+, project 28, shell 29, dashboard 19 (+ my PER 19, BRW-9, BRW-16)
- [x] All branches merged into audit-fixes with no conflicts; 1424 tests pass; build passes
- [x] Security hardening of the story Undo relief (e97dbeb)
- [x] Verification workflow: 123/132 verified, 6 partial (owner questions), ~38 new issues (1 HIGH Ctrl+Z after Done)
- [x] Fix wave 2: 38/38 fixed; 9 review findings repaired (A, B, C); merged (f97eddd); 1489 tests pass twice; STATE_VERSION 8
- [x] Wave 3: Balady box, turn-off warning, S-1..S-4, group D review (2 repaired); merged 8658de6; 1567 tests pass twice
- [x] Final browser check: 272 screens, 0 console errors, 23 confirmed problems (1 HIGH: Escape loses typed task text)
- [x] Wave 4: 23/23 fixed, 7 review findings repaired; merged (one board conflict resolved by hand); 1630 tests pass twice
- [x] Targeted re-check: 22/23 at once, F-2 (Arabic phone tab bar) fixed after and measured at 320-412 px
- [x] Audit record in docs/reviews/2026-10-03-full-audit; merged into main 773a240; 1630 tests; published v43
- [x] Cleanup: the owner approved on 2026-10-03; removed the 17 merged temporary worktrees
- [ ] Screenshots of changed screens (EN/AR)
- [x] Owner answered (2026-10-03): Balady box back; warn then allow on turn-off; one meeting per tab; Inbox count keeps task threads
- [x] Built in wave 3: Balady tick box (API-14), turn-off warning (API-7); screenshots checked
- [ ] Full suite, merge to main, publish, memory

## 2026-10-03: /simplify and /code-review of the audit merge

- [x] 4 cleanup reviewers (reuse, simpler code, wasted work, fix depth); about 35 cleanups applied in 3 commits (b967a44 server, 35f9b9c shared parts, 475f448 screens)
- [x] Code review: 6 bugs fixed with tests (ae56352): story Undo after a single Undo, Tracker Close ends the wait like Edit, owner pull-back for a reviewer-owner, task panel save only as the same person and for a live task, date field resend after a refusal, save before the file-data delete; plus Ctrl+Z on a tick box (35f9b9c) and the meeting reply picker leaves out inactive people (475f448)
- [x] Prototype v44 published; 1,640 tests pass
- [ ] Skipped on purpose (need a contract change or a browser-checked layout change): holdsAdminRights mirror in PeopleSection, leaders list from projects.list status all, one dashboard.get for the schedule status, one ResizeObserver for the office schedule, session.get per task row, toast.undo/toast.failed API, one focus-return hook for both sheet modes, Escape ownership, DateReason draft effect, TasksTab sendBack reset effect
- [ ] Skipped review items: the direct currentStageId write in watchStage (needs a check of every path that moves the tag), settleFuture on a real office (prototype only)

## 2026-10-03: real build, orchestration follow-ups

- [x] After wave 1: check that track E fixed the TLS fail-open in `server/core/deps.ts` (`hostedSupabase` only requires `DATABASE_CA` for `*.supabase.co/.com` hosts, so any other host, or an unparsable URL, connects without TLS). Fix if not: fail closed, require TLS for every host except loopback and the local Docker hosts, refuse an unparsable URL, with tests.
- [x] After wave 1: check that `WelcomeScreen.tsx` signs out the other devices after the password save (`auth.signOut({ scope: 'others' })`, as `ResetScreen.tsx` does). Commit 919ab5e made Welcome accept `type=recovery` links, so a reset link opened on Welcome sets a new password and keeps a stolen login on another device alive. Fix if not, with a test.
- [x] (done on main 2026-10-04, ahead of track F) Wave 3 brief for track F: add `assertCan(ctx, 'project.view', ...)` to the fake `files.link` in `serverFakes.ts` too (plan 2b.7), so fake and real match.
- [x] (done on main 2026-10-04, ahead of track F) Wave 3 brief for track F: the fake `files.link` makes its `blob:` URL with the type `application/octet-stream` for the download-only types of plan 5.2 (HTML, SVG, XHTML, every XML type, compared in lower case without parameters) and for any request that is not `inline`. Today it keeps the stored type, so an uploaded HTML or SVG file opens and runs on the app's own origin. Tests first.
- [x] Wave 3: run plan task A9 (unread counts from `State.counts`, then one grouped SQL count per chat in the C loader), so a chat with no read mark does not load its whole history. Done by track A9, merged 2026-10-04.
- [ ] Z0a: the Resend test send waits for the owner's Resend account address.
- [ ] After the build: the owner rotates the 4 secrets (Supabase token, both database passwords, Resend key), which were pasted in chat and auto-saved to Supermemory.
- [x] Wave 1 merged into main in the order A, B, E, R1, U, O1, Z, with every merge lead patch; G and N1 stay on their branches. The E TLS check holds (merge lead check); the Welcome sign-out of other devices is fixed on main (bb6044f).
- [x] The prototype Playwright smoke has 2 failures that already fail on main before the real build (32803b6): `acceptance.spec.ts` "Leader review: approve from Notifications with two steps" (Tab never reaches Approve) and `owner.spec.ts` "a leader pauses and resumes a project" (the Pause project menu item never becomes stable). 85 of 87 pass. Fix in a prototype screen pass. Fixed by track Q (34f9802 before the rebase: the tests now wait for Preview as, and match the named Approve button). 87 of 87 pass on main after the Q merge.
- [x] Flaky screen test: `TaskFeatures.test.tsx` "From a template" timed out once in a full run at low load (it passes alone, 16 of 16). Several tracks saw it fail on main too. Fixed by track Q: the template tests wait with a cheap label query, and the Projects tab icon plays once.
- [x] R2 or U: an "Earlier messages" control in `ConversationPane` that calls `chats.messages({ conversationId, before: <id of the oldest shown message>, limit: 200 })`, puts the page above the shown messages, and hides when a page is shorter than 200. jsdom tests in English and in Arabic with `dir="rtl"` (track A repair, findings 4 and 9). Done by track Q, with the repair of its 7 review findings.
- [x] N2: disable the email switch in `NotificationsSection` while the in-app switch of the same trigger is off, with a short note that says why (track A repair, finding 5: with in-app off, no notice and no email). Done in N2.2, merged 2026-10-04.
- [ ] At the G merge, apply G's merge lead patches: `supabase/config.toml` `secure_password_change = true`, and the plan section 9 risk 4 Fallback line about the agent token's rights on Auth's own endpoints. proof.md: keep the current header and append the G1 section unchanged.
- [ ] O1 "done when": the first push of main with `.github/workflows/ci.yml` and `ci-stack.yml` runs the four jobs on GitHub. Check that all four are green.
- [x] Wave 2 merged into main: rb/C (39c57e6), then rb/Q (5ea8c6a), with the merge lead patches (de77eb8): deps.ts refuses every TLS setting in the database URL, the ServerCallCtx note, and plan 4.12 `EFFECTS_OF` keyed by shared calls.
- [x] Merge watch: one unit test failed in the first full `npm test` after the Q merge and was not captured; the next three full runs passed (2,318 of 2,318). Name it if it fails again. No unit failure in 9 full runs on main during the wave 3 merges (2026-10-04); closed.
- [x] N1 before any real use: until N1 replaces the Realtime stub, every write that sends a signal fails on the real entries, because the signal goes out inside the transaction and the write rolls back (C3). Done by N1.1 (merged 2026-10-04): the sender sends inside the transaction, a failed send logs, counts and commits.
- [x] R2: the client must merge the `people` of signals that share one `id`, not drop the later one. If the office signal arrives before the person signal, the person's own reload is lost (C1). Done by R2, merged 2026-10-04.
- [x] P: call `setAuthUserId` in `auth.invite` and in every later change of the sign-in link, so the warm office cache sees it (C2). A server write (P `users.resendInvite`, G `agents.remove`) runs its own story `ref` and idempotency key replay and writes its outbox rows with `writeOutbox` in its own transaction, then `processOutbox` after the commit (C3). Done by P2, merged 2026-10-04.
- [x] D: call `clearOfficeCaches()` after each rollback, and reuse `runBoth` and `memorySource` for the shadow run (C2). Done by D1, merged 2026-10-04.
- [ ] N3: keep `office_deletes` rows for `OFFICE_DELETES_KEEP_DAYS` (7 days), and use C2's `loadJobs` (C2).
- [x] E: an option in `serverEnvFrom` that skips the database check, so `worker.ts` no longer hands it a stand-in URL before it swaps in the Hyperdrive binding (C1). Done on main (42d3781): the `database` option.
- [x] Docs: correct E1 fact 2 in `platform-facts.md`: the local pooler accepts `madar_server.pooler-dev` and runs as `madar_server` (C1). `npm run start:server` now needs `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB`. Done (3fc75b6): the fact lives in proof.md, section E1; platform-facts.md 1.5 has the local facts.
- [ ] Z0b: one run of the parallel Workers case gave 200, 500, 500 and did not repeat in 4 runs and 47 requests; the cause is not proven (C1, proof.md). Measure `chats.unreadCount` too (C2, until A9 lands).
- [x] After the F merge (security reviews of F1 commits 0da0e79 and links.ts, 2026-10-04): the F1 repair already made inline an allowlist (`INLINE_SAFE` in `server/files/links.ts`: pictures, PDF, plain text, video, audio) and stores every other type as `application/octet-stream` (`storedMimeType`). The stored `content_type` still comes from the uploader's PUT header, so check that F2's preflight compares the stored type of the FINAL object with `storedMimeType(intent type)` and deletes on a mismatch, with a test: a PUT of `text/html` under an `application/pdf` intent never gets a link. Then bring the fake `linkType` in `serverFakes.ts` to the same allowlist, tests first. Done by F2: `confirm.ts` checks the final object (test in `confirm.test.ts`), and the fake allowlist matches (`links.test.ts`).
- [ ] Z (proof.md owner): add a C2 section with the C2 results (C2 left it out because Z owns the file).
- [x] Security review of P2 `server/auth/effects.ts` (2026-10-04): the auth.email effect writes a new email to Auth as confirmed at once, so whoever changes a person's email can take over the account with "Forgot password", and Management could do it to any person who is not an Admin. Fixed on main (6500fd2): only an Admin changes an email, never through an agent; the person form shows the email as read-only to Management, with a hint in English and Arabic.
- [ ] Wave 4 task S1 (security follow-ups of wave 3, after the P and N2 merges), tests first:
  - (done by the P2 repair, finding 13) auth.email: when the person already accepted, also send a short notice to the OLD address (from Auth getUser, before the change) in the person's language: the new email, who changed it, and "tell your Admin if you did not expect this". No link in it.
  - forgot rate limit (security review of P2 `server/auth/forgot.ts`): `clientAddress` trusts the first `x-forwarded-for` entry, which the sender writes, so the 10-an-hour limit for each address never stops a sender who changes the header. Trust `cf-connecting-ip` on Workers only; on Supabase, prove in Z0b which header the gateway sets (send a forged `x-forwarded-for` to the madar-test function and log what arrives) and use only that value. Add a limit for the whole office that no header changes (`forgot:all`: done by the P2 repair at 20 an hour), and count the reset mail against N2's daily mail quota (`sendCounted`), so a flood of resets cannot use up the mail of the day.
  - forgot timing (same review): the answer waits only until 1.5 s, but the Auth link plus the mail send can take longer for a real person, so a slow answer shows that the email belongs to a person. Answer first, then do the lookup and the send after the answer (`after`, which is `ctx.waitUntil` on Workers and `EdgeRuntime.waitUntil` on Supabase). Without `after` (tests, local), keep the work inline. Test: the answer time does not depend on whether the email belongs to a person, also when the send takes 3 s.
- [x] Wave 3 merged into main (2026-10-04), in the order A9, D, P, R2, F, N1, N2, with every merge lead patch and the merge fixes below. Each gate passed: typecheck, `npm test` (2,805 passed, 6 skipped at the end), both builds, `build:remote -- test` from R2 on, `test:db` (826 passed, 23 skipped), `test:it` (166 passed), and the prototype smoke at R2, F and N2 (87 of 87 each).
  - D merge fix: the three A9 tests that write `State.counts` by hand skip db mode (the server counts in SQL).
  - P merge fix: `server/auth/mail.ts` imports its two word files, because `trees.ts` uses `import.meta.glob` and `wrangler dev` (esbuild) stopped at start. New guard: `server/workerGraph.test.ts`.
  - F merge fixes: the D harness unit tests keep the upload stand-ins on purpose; the mirror uploads with the signed `Content-Type` and the fake store signs `storedMimeType`; the two prototype-only upload ID tests skip db mode.
  - Accepted edits outside the owner lists: F (`server/stubs.test.ts`, `server/core/everyCall.ts`, `server/core/memoryData.ts`), N1 (`server/data/sql.ts` `onNotice`, `server/stubs.test.ts`), P (`server/stubs.test.ts`, `server/core/runCall.test.ts`), A9 (`server/data/loaders/build.ts`, `server/it/loaders.it.test.ts`), D (`server/data/rows.ts` `pairEventFields`, `whole.ts`, `loaders/build.ts`).
- [ ] After the wave 4 merge, on main, tests first (two security reviews of S1 `server/auth/forgot.ts`, 2026-10-04):
  - Address header, PROVEN on madar-test 2026-10-04 with a probe function (`probe-ip`, now a 404 stub; remove it with the owner's OK): Supabase Edge Functions sit behind Cloudflare. `cf-connecting-ip` holds the real client address, and Cloudflare refuses a request that sends its own `cf-connecting-ip` ("error code: 1000"). `x-forwarded-for` arrives as "client, client, proxy": a forged value is replaced, and the LAST entry is a rotating proxy address (13.248.x.x, 172.69.x.x), not the client. `true-client-ip` passes through forged. So `clientAddress` reads `cf-connecting-ip` on both hosts and never `x-forwarded-for`; 'unknown' only on local runs. S1's "last x-forwarded-for entry" rule puts many clients under one proxy address (one limit for many people) and must go. Add the result to proof.md (Z0b section) and close the Z header item.
  - Denial of service: the office-wide caps `forgot:all` (20 an hour) and `forgot:day` (30 a day) let one outsider who knows about 10 staff emails use up the reset mail of the whole office for the day. Remove both. The limit for each email becomes 3 a day (one window of 24 hours), counted before the lookup as now. The office total is then at most 3 times the number of people, and a flood only sends reset mails to the mailboxes it names, which then hold a working link. Keep the 10-an-hour address limit and `sendCounted`. Test: 31 reset requests for 11 different people in one day all send, and a 4th request for one email in a day gets the 429.
- [ ] D: remove the upload stand-ins of `server/test/uploads.ts` now that F is merged; only the in-memory unit tests of `server/test/dbApi.test.ts` still use them (F merge fix).
- [ ] P (optional): `server/core/memoryData.ts` answers `USER_EMAIL_CHANGED_SQL`, so the in-memory producer of `users.update` writes no row for a name change (P2 repair; not needed by the tests). Also drop the "not in AuthAdminPort yet" sentence in `server/auth/admin.ts`, now that the port has the methods.
- [ ] E: name `AUTH_ISSUER` (optional) in the header comment of `server/core/deps.ts` (P1).
- [ ] N2 (optional): move the side-effect import of `server/mail/effects` from `outboxDriver.ts` into `deps.ts`, as P and F do.
- [ ] M: implement `signalsFailed` in `meterPort` (N1, today a no-op); count "emails today" with N2's `sentToday`, and match N2's `limitWarning` meter names; `failedEffects` must never return an outbox payload (P2 repair, finding 11).
- [ ] N3: delete every `up/` object older than 2 hours 10 minutes, also those of used intents (F2, proof.md Z0a item 6).
- [ ] O: CI uses `cgr.dev/chainguard/minio` (pinned by digest) because Docker Hub no longer serves `minio/minio` (F1); `config/remote.test.env` (O3) carries `VITE_SUPABASE_PUBLISHABLE_KEY` from `accounts.md` (R2).
- [ ] Screens: `PreviewSheet.tsx` puts every `image/*` type in an img tag, so an SVG preview breaks in the remote build; use `isInlinePicture` from `src/app/files.ts` (F3 repair).
- [ ] P or Z: `supabase/config.toml` `otp_expiry = 3600`, so an invitation link stops after 1 hour; decide a longer life (N2.1). G: register `agents.revokeAll` after a turn-off (P2).
- [ ] Z: on madar-test, prove which header carries the client address to a function before the forgot address limit trusts it (P2 repair, finding 5; same as the S1 item).

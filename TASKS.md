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
- [x] Browser sweep, independent review and fix pass, guide and report, review link, merge to main, memory (closed 2026-10-04: the full product audit of 2026-10-03 below took their place: 272 screens checked, every finding fixed, merged into main 773a240, published v43)

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
- [x] Screenshots of changed screens (EN/AR): the final browser check (272 screens) and the targeted re-check above
- [x] Owner answered (2026-10-03): Balady box back; warn then allow on turn-off; one meeting per tab; Inbox count keeps task threads
- [x] Built in wave 3: Balady tick box (API-14), turn-off warning (API-7); screenshots checked
- [x] Full suite, merge to main, publish, memory: merged into main 773a240 with 1630 tests, published v43

## 2026-10-03: /simplify and /code-review of the audit merge

- [x] 4 cleanup reviewers (reuse, simpler code, wasted work, fix depth); about 35 cleanups applied in 3 commits (b967a44 server, 35f9b9c shared parts, 475f448 screens)
- [x] Code review: 6 bugs fixed with tests (ae56352): story Undo after a single Undo, Tracker Close ends the wait like Edit, owner pull-back for a reviewer-owner, task panel save only as the same person and for a live task, date field resend after a refusal, save before the file-data delete; plus Ctrl+Z on a tick box (35f9b9c) and the meeting reply picker leaves out inactive people (475f448)
- [x] Prototype v44 published; 1,640 tests pass
- [x] Skipped on purpose (need a contract change or a browser-checked layout change): holdsAdminRights mirror in PeopleSection, leaders list from projects.list status all, one dashboard.get for the schedule status, one ResizeObserver for the office schedule, session.get per task row, toast.undo/toast.failed API, one focus-return hook for both sheet modes, Escape ownership, DateReason draft effect, TasksTab sendBack reset effect. Done 2026-10-06 (owner: "clean up"): 7 done (dashboard.get gives `leaders`, an additive field in TOOL_DOCS); kept on purpose: one dashboard.get for the schedule status (the top numbers would reload, people see it) and the TasksTab reset effect (the simplest correct form). Two real bugs fixed with tests: the focus went to the page body when the row that opened the task panel was gone, and one Escape in an open list of names closed the whole blocking sheet
- [x] Skipped review items: the direct currentStageId write in watchStage (needs a check of every path that moves the tag), settleFuture on a real office (prototype only). Done 2026-10-06: all 12 paths that move the tag checked; the next applyPatch overwrites the direct write, so it stays. settleFuture and the sample office left the server bundles (src/data/sampleOffice.ts; workerGraph.test.ts and `check-bundles.ts server` keep them out)

## 2026-10-03: real build, orchestration follow-ups

- [x] After wave 1: check that track E fixed the TLS fail-open in `server/core/deps.ts` (`hostedSupabase` only requires `DATABASE_CA` for `*.supabase.co/.com` hosts, so any other host, or an unparsable URL, connects without TLS). Fix if not: fail closed, require TLS for every host except loopback and the local Docker hosts, refuse an unparsable URL, with tests.
- [x] After wave 1: check that `WelcomeScreen.tsx` signs out the other devices after the password save (`auth.signOut({ scope: 'others' })`, as `ResetScreen.tsx` does). Commit 919ab5e made Welcome accept `type=recovery` links, so a reset link opened on Welcome sets a new password and keeps a stolen login on another device alive. Fix if not, with a test.
- [x] (done on main 2026-10-04, ahead of track F) Wave 3 brief for track F: add `assertCan(ctx, 'project.view', ...)` to the fake `files.link` in `serverFakes.ts` too (plan 2b.7), so fake and real match.
- [x] (done on main 2026-10-04, ahead of track F) Wave 3 brief for track F: the fake `files.link` makes its `blob:` URL with the type `application/octet-stream` for the download-only types of plan 5.2 (HTML, SVG, XHTML, every XML type, compared in lower case without parameters) and for any request that is not `inline`. Today it keeps the stored type, so an uploaded HTML or SVG file opens and runs on the app's own origin. Tests first.
- [x] Wave 3: run plan task A9 (unread counts from `State.counts`, then one grouped SQL count per chat in the C loader), so a chat with no read mark does not load its whole history. Done by track A9, merged 2026-10-04.
- [x] Z0a: the Resend test send waits for the owner's Resend account address. Closed 2026-10-04: the owner chose the verified Resend domain vado.sa; production sends from `Madar <madar@vado.sa>`.
- [x] Deploy (2026-10-04, owner: "finish the production on cloudflare"): Pages project madar (https://madar-46r.pages.dev, test at https://preview.madar-46r.pages.dev); `[remotes.test]` and `[remotes.production]` in config.toml; `secrets/test.env`, `secrets/production.env`, `secrets/test-accounts.env`, `secrets/production-admin.env` (git-ignored); `all.sh test` and `all.sh production` (migrations, settings, secrets, functions, screens), both health checks answer from eu-central-1; madar-test seeded; the first Admin of production is usr_001 o.khalil@mazj.org (first password in `secrets/production-admin.env`); SSL enforcement on in both projects; Data API off (503); Realtime private only on madar-test. End-to-end API check on both: sign-in, session.get, projects.list. Record: proof.md section "Deploy".
- [x] Done 2026-10-05 on the owner's "finish what still open": in both Supabase projects the legacy anon and service_role keys are off and the HS256 key is revoked (ES256 in use); sign-in and the server checked after it on both. The app uses only the new publishable and secret keys; Storage signed links use their own key (Supabase docs), and a revoked key can go back to standby.
- [x] Own address (owner, 2026-10-05): https://madar.vado.sa, with www.madar.vado.sa moving to it (`src/app/canonicalHost.ts`). Pages custom domains for both, the owner's CNAME records in the Vercel DNS of vado.sa, production site_url and redirect list, APP_URL and ALLOWED_ORIGINS. The same config push turned the production Data API off: it was still on, and the earlier 503 check did not prove it off. Checked: CORS for the 3 addresses and a refusal for another, a signed-in session.get from the new origin, the sign-in screen (headless Chrome).
- [x] The owner reset his first production password on 2026-10-05 09:32 (Forgot); `secrets/production-admin.env` is deleted.
- [x] Backups (Z5): the owner saved the age private key (password manager and paper) and Claude deleted `secrets/backup-age-key.txt` on 2026-10-05, after a check that it matched BACKUP_AGE_RECIPIENT. File backups wait for a Backblaze B2 account: Claude paused `files-backup.yml` on 2026-10-05 (`gh workflow enable "Files backup"` turns it on again after the B2 secrets). Done by Claude 2026-10-05: the private repo `byosamah/madar-backups` with a README, the age key pair (`brew install age`, private key in `secrets/backup-age-key.txt` for the owner to save in a password manager and on paper, then delete), `BACKUP_AGE_RECIPIENT` and `BACKUP_DB_URL`. Owner: a fine-grained token with Contents read and write on madar-backups only, saved as `BACKUP_REPO_TOKEN`; then Claude runs the workflow once.
- [x] Z1 "require current password": on in madar-test, then account.spec and agents.spec on the test copy passed 18 of 18 (Welcome and Reset set passwords; an agent token gets current_password_required), then on in production (2026-10-05).
- [x] Secrets rotated 2026-10-05: both database passwords (Management API, `.env.local` and `BACKUP_DB_URL` updated, sign-in checked); Madar production now sends with its own Resend key (sending only, vado.sa only). Owner: a new Supabase access token (Account, Access tokens) in `.env.local`, then revoke the old one; and rotate the old full-access Resend key when the other apps of the account (Mazj) get the new one.
- [x] The `probe-ip` stub on madar-test is deleted (2026-10-05).
- [x] Short MCP address (owner, 2026-10-05): https://madar.vado.sa/mcp through a Pages Function (`server/http/pagesMcpProxy.ts`), MCP_URL of both projects moved to the short addresses; agents.spec through https://preview.madar-46r.pages.dev/mcp passed 10 of 10 (register, approve, token, tool call, remove, Z0a case 3); production discovery checked. Security review: the upstream path is pinned (encoded dots and slashes get 404).
- [x] Database backups run (2026-10-05): the owner's fine-grained token (madar-backups only) as BACKUP_REPO_TOKEN; the first run succeeded and its file opens with the owner's key (roles, schema, data, manifest).
- [x] Owner, done 2026-10-05 (dig shows the record): the DMARC record of vado.sa (TXT `_dmarc` = `v=DMARC1; p=none; adkim=r; aspf=r`): the first invitations landed in Gmail spam. Resend DKIM and SPF pass; vado.sa has no DMARC policy.
- [x] Closed 2026-10-05 (see the Z1 line above). Z1 was open (owner, blocked for Claude by the safety system): "require current password" is off in both projects, so an approved AI agent can set a new password for its person (deploy suite Z0a case 3, proof.md section Deploy). Steps: turn it on in madar-test (Authentication settings), tell Claude, who runs account.spec (Welcome and Reset) and agents.spec on the test copy; if Welcome still saves a first password, turn it on in production too. If Welcome breaks, the first password needs a server path first.
- [x] Z6 (2026-10-05): the deploy suite on the test copy passes apart from Z0a case 3 (above): 157 passed, the walk 36 of 36 in each variant; fixes 86d7687 (zod jitless for the CSP, three test fixes) and 0b553fb (settle before contrast checks). Production has the fixed screens and Realtime private only.
- [x] Done 2026-10-05, apart from the account-wide Resend key (it also serves Mazj; rotate it with the Mazj apps). Supermemory: Claude removed the saved token, password and key memories on 2026-10-05; old chat records there still hold the account-wide Resend key, which is still live, so its rotation is URGENT (owner, with the Mazj apps), and the owner deletes those records in the Supermemory app. Update 2026-10-05: `.env.local` holds a new key ("Madar"); the old key still answers HTTP 200 and no local env file uses it; the old key is "VADO" (made 2026-10-03; its last_used_at moved with a test call), and nothing uses it: production sends with `madar-production`, the test copy uses the outbox, the Mazj apps use "MAZJ". Owner decision 2026-10-05: keep VADO for now (risk accepted: its value sits in old Supermemory chat records). To close it later: delete VADO in Resend, API Keys. After the build: the owner rotates the 4 secrets (Supabase token, both database passwords, Resend key), which were pasted in chat and auto-saved to Supermemory.
- [x] Wave 1 merged into main in the order A, B, E, R1, U, O1, Z, with every merge lead patch; G and N1 stay on their branches. The E TLS check holds (merge lead check); the Welcome sign-out of other devices is fixed on main (bb6044f).
- [x] The prototype Playwright smoke has 2 failures that already fail on main before the real build (32803b6): `acceptance.spec.ts` "Leader review: approve from Notifications with two steps" (Tab never reaches Approve) and `owner.spec.ts` "a leader pauses and resumes a project" (the Pause project menu item never becomes stable). 85 of 87 pass. Fix in a prototype screen pass. Fixed by track Q (34f9802 before the rebase: the tests now wait for Preview as, and match the named Approve button). 87 of 87 pass on main after the Q merge.
- [x] Flaky screen test: `TaskFeatures.test.tsx` "From a template" timed out once in a full run at low load (it passes alone, 16 of 16). Several tracks saw it fail on main too. Fixed by track Q: the template tests wait with a cheap label query, and the Projects tab icon plays once.
- [x] R2 or U: an "Earlier messages" control in `ConversationPane` that calls `chats.messages({ conversationId, before: <id of the oldest shown message>, limit: 200 })`, puts the page above the shown messages, and hides when a page is shorter than 200. jsdom tests in English and in Arabic with `dir="rtl"` (track A repair, findings 4 and 9). Done by track Q, with the repair of its 7 review findings.
- [x] N2: disable the email switch in `NotificationsSection` while the in-app switch of the same trigger is off, with a short note that says why (track A repair, finding 5: with in-app off, no notice and no email). Done in N2.2, merged 2026-10-04.
- [x] At the G merge, apply G's merge lead patches: `supabase/config.toml` `secure_password_change = true`, and the plan section 9 risk 4 Fallback line about the agent token's rights on Auth's own endpoints. proof.md: keep the current header and append the G1 section unchanged. Done at the wave 4 merge (0a98b58, 18dd642).
- [x] O1 "done when": the first push of main with `.github/workflows/ci.yml` and `ci-stack.yml` runs the four jobs on GitHub. Check that all four are green. Done 2026-10-04: unit and server green (10a35a3), db and integration green (70ddcbb). The integration job needed three fixes, each checked on the Mac first: no shared `functions serve` step (the conformance runner and the cron and worker suites serve their own), the MCP conformance before the suites, and a `supabase db reset` between them (the runner leaves its agent in the public office).
- [x] Wave 2 merged into main: rb/C (39c57e6), then rb/Q (5ea8c6a), with the merge lead patches (de77eb8): deps.ts refuses every TLS setting in the database URL, the ServerCallCtx note, and plan 4.12 `EFFECTS_OF` keyed by shared calls.
- [x] Merge watch: one unit test failed in the first full `npm test` after the Q merge and was not captured; the next three full runs passed (2,318 of 2,318). Name it if it fails again. No unit failure in 9 full runs on main during the wave 3 merges (2026-10-04); closed.
- [x] N1 before any real use: until N1 replaces the Realtime stub, every write that sends a signal fails on the real entries, because the signal goes out inside the transaction and the write rolls back (C3). Done by N1.1 (merged 2026-10-04): the sender sends inside the transaction, a failed send logs, counts and commits.
- [x] R2: the client must merge the `people` of signals that share one `id`, not drop the later one. If the office signal arrives before the person signal, the person's own reload is lost (C1). Done by R2, merged 2026-10-04.
- [x] P: call `setAuthUserId` in `auth.invite` and in every later change of the sign-in link, so the warm office cache sees it (C2). A server write (P `users.resendInvite`, G `agents.remove`) runs its own story `ref` and idempotency key replay and writes its outbox rows with `writeOutbox` in its own transaction, then `processOutbox` after the commit (C3). Done by P2, merged 2026-10-04.
- [x] D: call `clearOfficeCaches()` after each rollback, and reuse `runBoth` and `memorySource` for the shadow run (C2). Done by D1, merged 2026-10-04.
- [x] N3: keep `office_deletes` rows for `OFFICE_DELETES_KEEP_DAYS` (7 days), and use C2's `loadJobs` (C2). Done by N3.1, merged 2026-10-04.
- [x] E: an option in `serverEnvFrom` that skips the database check, so `worker.ts` no longer hands it a stand-in URL before it swaps in the Hyperdrive binding (C1). Done on main (42d3781): the `database` option.
- [x] Docs: correct E1 fact 2 in `platform-facts.md`: the local pooler accepts `madar_server.pooler-dev` and runs as `madar_server` (C1). `npm run start:server` now needs `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB`. Done (3fc75b6): the fact lives in proof.md, section E1; platform-facts.md 1.5 has the local facts.
- [ ] Z0b: one run of the parallel Workers case gave 200, 500, 500 and did not repeat in 4 runs and 47 requests; the cause is not proven (C1, proof.md). Measure `chats.unreadCount` too (C2, until A9 lands). Also (wave 4): remove the `probe-ip` stub on madar-test with the owner's OK. Done by Y (wave 5): S1's header probe is in proof.md Z0b, and the old P2 note (the x-forwarded-for rule and `forgot:all`) is corrected. The hosted projects (madar-test and madar) keep the Auth default "Email OTP Expiration" of 3600 s; never set 86400, because Auth has one life for every email link, so a reset link would also live a day (security fix 7). The forgot email window stays 1 hour.
- [x] After the F merge (security reviews of F1 commits 0da0e79 and links.ts, 2026-10-04): the F1 repair already made inline an allowlist (`INLINE_SAFE` in `server/files/links.ts`: pictures, PDF, plain text, video, audio) and stores every other type as `application/octet-stream` (`storedMimeType`). The stored `content_type` still comes from the uploader's PUT header, so check that F2's preflight compares the stored type of the FINAL object with `storedMimeType(intent type)` and deletes on a mismatch, with a test: a PUT of `text/html` under an `application/pdf` intent never gets a link. Then bring the fake `linkType` in `serverFakes.ts` to the same allowlist, tests first. Done by F2: `confirm.ts` checks the final object (test in `confirm.test.ts`), and the fake allowlist matches (`links.test.ts`).
- [x] Z (proof.md owner): add a C2 section with the C2 results (C2 left it out because Z owns the file). Done: proof.md section C2 ("Loaders and the office cache").
- [x] Security review of P2 `server/auth/effects.ts` (2026-10-04): the auth.email effect writes a new email to Auth as confirmed at once, so whoever changes a person's email can take over the account with "Forgot password", and Management could do it to any person who is not an Admin. Fixed on main (6500fd2): only an Admin changes an email, never through an agent; the person form shows the email as read-only to Management, with a hint in English and Arabic.
- [x] Wave 4 task S1 (security follow-ups of wave 3, after the P and N2 merges), tests first: Done by S1, merged 2026-10-04 (c5ef304).
  - (done by the P2 repair, finding 13) auth.email: when the person already accepted, also send a short notice to the OLD address (from Auth getUser, before the change) in the person's language: the new email, who changed it, and "tell your Admin if you did not expect this". No link in it.
  - forgot rate limit (security review of P2 `server/auth/forgot.ts`): `clientAddress` trusts the first `x-forwarded-for` entry, which the sender writes, so the 10-an-hour limit for each address never stops a sender who changes the header. Trust `cf-connecting-ip` on Workers only; on Supabase, prove in Z0b which header the gateway sets (send a forged `x-forwarded-for` to the madar-test function and log what arrives) and use only that value. Add a limit for the whole office that no header changes (`forgot:all`: done by the P2 repair at 20 an hour), and count the reset mail against N2's daily mail quota (`sendCounted`), so a flood of resets cannot use up the mail of the day.
  - forgot timing (same review): the answer waits only until 1.5 s, but the Auth link plus the mail send can take longer for a real person, so a slow answer shows that the email belongs to a person. Answer first, then do the lookup and the send after the answer (`after`, which is `ctx.waitUntil` on Workers and `EdgeRuntime.waitUntil` on Supabase). Without `after` (tests, local), keep the work inline. Test: the answer time does not depend on whether the email belongs to a person, also when the send takes 3 s.
- [x] Wave 3 merged into main (2026-10-04), in the order A9, D, P, R2, F, N1, N2, with every merge lead patch and the merge fixes below. Each gate passed: typecheck, `npm test` (2,805 passed, 6 skipped at the end), both builds, `build:remote -- test` from R2 on, `test:db` (826 passed, 23 skipped), `test:it` (166 passed), and the prototype smoke at R2, F and N2 (87 of 87 each).
  - D merge fix: the three A9 tests that write `State.counts` by hand skip db mode (the server counts in SQL).
  - P merge fix: `server/auth/mail.ts` imports its two word files, because `trees.ts` uses `import.meta.glob` and `wrangler dev` (esbuild) stopped at start. New guard: `server/workerGraph.test.ts`.
  - F merge fixes: the D harness unit tests keep the upload stand-ins on purpose; the mirror uploads with the signed `Content-Type` and the fake store signs `storedMimeType`; the two prototype-only upload ID tests skip db mode.
  - Accepted edits outside the owner lists: F (`server/stubs.test.ts`, `server/core/everyCall.ts`, `server/core/memoryData.ts`), N1 (`server/data/sql.ts` `onNotice`, `server/stubs.test.ts`), P (`server/stubs.test.ts`, `server/core/runCall.test.ts`), A9 (`server/data/loaders/build.ts`, `server/it/loaders.it.test.ts`), D (`server/data/rows.ts` `pairEventFields`, `whole.ts`, `loaders/build.ts`).
- [x] After the wave 4 merge, on main, tests first (two security reviews of S1 `server/auth/forgot.ts`, 2026-10-04): Done by S1 on rb/S before the merge: cf-connecting-ip only, the notice throws on a full quota (and S1-outbox-wait holds the row until the next UTC day), no office caps. The email window stays 1 hour: security fix 7 keeps otp_expiry at 3600 s (wave 5). The proof.md Z0b text: done by Y, wave 5.
  - Address header, PROVEN on madar-test 2026-10-04 with a probe function (`probe-ip`, now a 404 stub; remove it with the owner's OK): Supabase Edge Functions sit behind Cloudflare. `cf-connecting-ip` holds the real client address, and Cloudflare refuses a request that sends its own `cf-connecting-ip` ("error code: 1000"). `x-forwarded-for` arrives as "client, client, proxy": a forged value is replaced, and the LAST entry is a rotating proxy address (13.248.x.x, 172.69.x.x), not the client. `true-client-ip` passes through forged. So `clientAddress` reads `cf-connecting-ip` on both hosts and never `x-forwarded-for`; 'unknown' only on local runs. S1's "last x-forwarded-for entry" rule puts many clients under one proxy address (one limit for many people) and must go. Add the result to proof.md (Z0b section) and close the Z header item.
  - Fail-open notice (security review of S1 `server/auth/effects.ts`): `sendEmailNotice` treats a full daily mail quota as done (a log warning only), so the outbox marks the auth.emailNotice row done and the person at the old email never learns of the change. On 'over', throw, so the row stays in the outbox and the job retries it (up to 5 attempts); after that it shows as a failed effect in the Admin's Usage section (track M). Never mark a security notice done unless the mail went out. Test: with the quota full, the notice row stays not done with its error, and it sends on a later run when the quota has room.
  - Denial of service: the office-wide caps `forgot:all` (20 an hour) and `forgot:day` (30 a day) let one outsider who knows about 10 staff emails use up the reset mail of the whole office for the day. Remove both. The limit for each email becomes 3 a day (one window of 24 hours), counted before the lookup as now. The office total is then at most 3 times the number of people, and a flood only sends reset mails to the mailboxes it names, which then hold a working link. Keep the 10-an-hour address limit and `sendCounted`. Test: 31 reset requests for 11 different people in one day all send, and a 4th request for one email in a day gets the 429.
- [x] After the wave 4 merge, on main, tests first (security review of G3, 2026-10-04): Checked on main after the merge: ensureAgentUser requires the recorded approval (agent_not_approved), a removed link never links again, and redirectSetOf compares the whole set; the G3 and G4 tests cover both.
  - Revocation bypass (`server/mcp/auth.ts`, `agentPrincipalResolver`): a removed link counts as a new approval when the Auth session started after the removal, and `ensureAgentUser` links again. A session alone does not prove that the person approved again: Auth can remember an earlier consent, and G4 tests whether an agent token can approve a new client itself. Rule: `ensureAgentUser` links (or links again) only a client with an approval that the owner recorded in Madar with a browser token through api (the G4 per-client approval; make it required, not only "if the self-approval call works"), and that approval must be newer than any removal of a link of the same owner for that client. Settings, Agents "Remove" also revokes the client's grant and sessions in Auth (admin API), so the AI app cannot get a new token without a new consent. Test: after Remove, a new session of the same client with no new recorded approval gets 401 and no link.
  - Identity confusion (`server/mcp/agentUser.ts`, `SAME_APP_SQL` and `redirectHostOf`): an agent user is reused for any new client with the same client name and the same host of the FIRST redirect address. A client registered as "Claude" with redirect_uris "https://claude.ai/cb,https://other.example/cb" reuses the agent user, its name and its History. Store and compare the whole set of redirect addresses (sorted, exact; for a loopback address compare scheme, host and path without the port). Show the app's redirect host on the consent screen. Test: a client with the same name and first host but one more redirect address gets a new agent user.
  - Note: the G3 repair on rb/G (`ensureAgentUser` requires the recorded approval, a removed link never links again, `redirectSetOf` compares the whole set) may already close both items above. Check after the merge, keep the tests, and tick what is done.
- [x] After the wave 4 merge, on main, tests first (security review of G4 `src/features/oauth/oauthPort.tsx`, 2026-10-04): Done by G4 on rb/G: `safeRedirect` in knownHosts.ts with tests, merged 2026-10-04.
  - Script in the return address: `leave` sends the browser to the redirect address from Auth with no check, also with no click when Auth answers "done". An AI app registers its own redirect addresses (dynamic client registration), so `javascript://claude.ai/%0a...` runs script in the Madar page with the person's sign-in. `needsWarning` gives no warning for it, because the host reads as claude.ai. Fix: one `safeRedirect(url)` in `knownHosts.ts`. It accepts `https:`, `http:` on a loopback host only, and an app scheme (for example `cursor:`). It refuses `javascript:`, `data:`, `vbscript:`, `blob:`, `file:`, `filesystem:`, `about:` and an address that does not parse. `leave` refuses a bad address and the screen shows a plain error. `needsWarning` returns true for every refused scheme. The consent screen also checks that the approve and deny redirect starts with the request's redirect address. Tests: `javascript://claude.ai/%0aalert(1)` gets a warning and never reaches `location.assign`; the "done" answer with a `javascript:` address shows the error; https, loopback http and `cursor://` still leave.
- [x] Search fix (2026-10-04, 5252cd5): the search screen wrote "?q=" again on every change of the link, so a result that opened a page could lose its own parameters (a file found by Search opened its project without the file). The flaky test "opens the preview of a file it found" (3 failures) had this cause. New hook `useQueryInLink`, tests first.
- [x] Security fix 7, wave 5 track H, tests first (background security review of 5034416, 2026-10-04, "weakened-auth-token-lifetime"): `otp_expiry = 86400` makes every Auth email link live 24 hours, also a password-reset link, because Auth has one setting for all email links. Set `otp_expiry` back to 3600 in `supabase/config.toml`. An invitation link that is out of date opens a screen with one main button, "Send me a new link", which sends a fresh invitation to the SAME invited address only: never to a typed address, only for a person who is still invited (not accepted, not removed), with a limit for each invitation and for each network address (cf-connecting-ip), and the same answer in every case. The Admin does nothing. Words in English and Arabic; screenshots EN/AR, light/dark, 390 px. Update the comments of `server/auth/forgot.ts` that name 86400 (the reset window stays 1 hour, which a test compares with otp_expiry), and change the Z0b item: the hosted projects keep the Auth default of 3600 s. The owner may still choose 24-hour links with no button; then keep 86400 and record the accepted risk in proof.md. Done by H, merged 2026-10-04 (b0a244b): otp_expiry = 3600 (865a68e), the renew key and `POST /api/auth/renew-invite`, the Welcome screen "Send me a new link", the invite mail words (4422a26), proof.md section H.
- [x] Security fix 8, on main after the wave 5 merge, tests first (background security review of rb/H, 2026-10-04, "weak-secret-derivation"): the renew key came from the invite id and the token hash (`renewKeyOf`), and the token hash is the sha224 of the email and a 6-digit Auth code, so a reader of the outbox could rebuild a live token hash from 1 million guesses. Done: the key is random (`newRenewKey`, 260 bits), the payload keeps it next to the token hash until the send, `SENT_SQL` drops both, and proof.md records it.
- [x] Walk spec (wave 5 track Y): the whole-product walk of wave 4 uploaded a damaged PNG (its header says 64 x 64, its data stream is broken), so its picture preview check proved nothing; the preview showed a blank panel. Commit the walk as tests/e2e-deploy/walk.spec.ts with a real picture made at run time, check that the preview shows the picture (its pixels, not only naturalWidth), and run it once on the local stack. Done by Y, merged 2026-10-04 (27631ef): 36 of 36 steps in all four variants; after the Y repair, en-390 and ar-390 again.
- [x] Logo (owner's choice "3 · Turning doors", 2026-10-04; canvas https://claude.ai/artifact/PPsLwvwBp6uDueSWDM31qz): the "door" form of the project pictures in its four turns, as a pinwheel, in a glow tile. Done: the tab icon in `index.html` (the form alone in ink, light and dark). After the wave 4 merge: (1) one `MadarMark` component: the glow tile (30% corners, the three lights of Next for you, the ink/10 ring, the form at 45% size in ink at 0.86) with the paths `M8 0H0A8 8 0 0 0 8 8Z M18 8V0A8 8 0 0 0 10 8Z M10 18H18A8 8 0 0 0 10 10Z M0 10V18A8 8 0 0 0 8 10Z` (viewBox 0 0 18 18); (2) the mark with the name above the title of the sign-in, forgot and consent screens (`AuthPage`); (3) app icons: apple-touch-icon 180 px and 192/512 px PNGs of the glow tile, with a web manifest; (4) the mark in the header of the N2 mail templates; (5) never inside a project list, so nobody reads it as a project. Screenshots EN/AR, light/dark, 390 px. Done by K, merged 2026-10-04 (266b16e): (1) `src/components/MadarMark.tsx`; (2) the mark and the name in the top row of `AuthPage` (sign-in, forgot, reset, welcome, consent); (3) `public/icons` and `public/manifest.webmanifest` from `scripts/icons/make-icons.tsx`; (4) the 192 px PNG in the N2 mail header, empty alt; (5) a test. What K left is in Wave 5 follow-ups.
- [x] Fonts (owner, 2026-10-05): Thmanyah Sans for English and Arabic. Done: the OTF files
  (400, 500, 700) in `src/design/fonts/`, unchanged, `tokens.css` loads them, the number spots take the digits from
  Inter (Thmanyah Sans has no tabular figures), tests check the stacks and the file hashes. The weight ladder: Bold for
  headings only, Medium for emphasis (`font-semibold` renders Medium), Regular for body. Deployed 2026-10-05 (1b0180a).
- [x] Direction (owner, 2026-10-05): in the Arabic screens, English text also sits on the right. Done: one rule in
  `tokens.css` (`dir="auto"`, `dir="ltr"` and `<bdi>` take the side of the page), the Schedule stage cell and the Inbox
  preview row give the direction only to the text, the sender name and its colon are one `<bdi>`, and
  `scripts/check-rtl.ts` now fails on `dir` on a flex or grid box. Deployed 2026-10-05 (1b0180a).
- [x] Arabic middle dot (found 2026-10-05 with Thmanyah Sans): the wide, round "·" read like an Arabic zero in
  "5 أكتوبر · مراجعة". Done: every stack takes only U+00B7 from Inter ("Madar Dot"), as the Arabic screens did before.
- [x] Older layout issues at 390 px (found 2026-10-05; the old font showed them too). Done: the phone tabs share one
  height and start at the top, so the two-line "لوحة المعلومات" no longer lifts its icon; the avatar stack overlaps by
  4 px, so no initials hide, and "+1" keeps its order in Arabic; the Health tiles start at the top, so the three numbers
  sit on one line when "معرّض للتأخر" wraps; the weekly chart writes no "0" on its axis, so the first week label stands
  clear.
- [x] D: remove the upload stand-ins of `server/test/uploads.ts` now that F is merged; only the in-memory unit tests of `server/test/dbApi.test.ts` still use them (F merge fix). Done by L1, merged 2026-10-04.
- [x] P (optional): `server/core/memoryData.ts` answers `USER_EMAIL_CHANGED_SQL`, so the in-memory producer of `users.update` writes no row for a name change (P2 repair; not needed by the tests). Also drop the "not in AuthAdminPort yet" sentence in `server/auth/admin.ts`, now that the port has the methods. Done by L1, merged 2026-10-04.
- [x] E: name `AUTH_ISSUER` (optional) in the header comment of `server/core/deps.ts` (P1). Done by L1.
- [x] N2 (optional): move the side-effect import of `server/mail/effects` from `outboxDriver.ts` into `deps.ts`, as P and F do. Done by L1.
- [x] M: implement `signalsFailed` in `meterPort` (N1, today a no-op); count "emails today" with N2's `sentToday`, and match N2's `limitWarning` meter names; `failedEffects` must never return an outbox payload (P2 repair, finding 11). Done by M1, merged 2026-10-04.
- [x] N3: delete every `up/` object older than 2 hours 10 minutes, also those of used intents (F2, proof.md Z0a item 6). Done by N3.1 (the uploads step), merged 2026-10-04.
- [x] O: CI uses `cgr.dev/chainguard/minio` (pinned by digest) because Docker Hub no longer serves `minio/minio` (F1); `config/remote.test.env` (O3) carries `VITE_SUPABASE_PUBLISHABLE_KEY` from `accounts.md` (R2). Done by O3 (the Chainguard image test and config/remote.test.env), merged 2026-10-04.
- [x] Screens: `PreviewSheet.tsx` puts every `image/*` type in an img tag, so an SVG preview breaks in the remote build; use `isInlinePicture` from `src/app/files.ts` (F3 repair). Done by L1 (`usePictureTest`), merged 2026-10-04.
- [x] P or Z: `supabase/config.toml` `otp_expiry = 3600`, so an invitation link stops after 1 hour; decide a longer life (N2.1). G: register `agents.revokeAll` after a turn-off (P2). Done: otp_expiry = 86400 in config.toml (L1 patch, 5034416; security fix 7 set it back to 3600 in wave 5); G registers agents.revokeAll in deps.ts (0a98b58). The cloud value is in the Z0b item.
- [x] Z: on madar-test, prove which header carries the client address to a function before the forgot address limit trusts it (P2 repair, finding 5; same as the S1 item). Done: proven 2026-10-04 (cf-connecting-ip); S1 reads only that header.
- [x] Wave 4 merged into main (2026-10-04), in the order M (0d648e9), G (fbb9cde), O (8049f2a), X (838b1bb), S (c5ef304), L (4ab1e2c), with every merge lead patch and the merge fixes below. Each gate passed: typecheck, `npm test` (3,251 passed, 6 skipped at the end), both builds, `build:remote -- test`, `test:db` (826 passed, 24 skipped), `test:it` (227 passed at the end), and the prototype smoke at M, G, X and L (87 of 87 each). The X specs ran on the local stack after the G and M merges: 157 passed, 4 skipped (Z0a case 3 and the three Preview as checks, which need the test deployment).
  - G merge fixes: `usage.retryEffect` joins the MCP deny list (5dcc47c); the guard suite checks the platform table `agent_approvals` (968b416); the script test expects the new `test:mcp` (67483c5).
  - O merge fix: the restore check suite leaves a platform table empty when it refills public from the app-migration schema (ef3166a).
  - X merge fixes: the agents spec finds the client name in the consent title, and the local run sets MCP_URL and `platform_config.mcp_url` (50b2aa8). X2 patch: before sign-in the page takes the device theme and the start direction, with a jsdom test (704f004).
  - Accepted edits outside the owner lists: M (`server/stubs.test.ts`, `server/core/runCall.test.ts`, `src/api/calls.test.ts`, `serverCallMap.test.ts`, `server/it/guards.it.test.ts`, the contract files for `usage.retryEffect`), N3 (`server/stubs.test.ts`), G (`server/stubs.test.ts`, `src/features/settings/stubs.test.tsx`), S (`server/entries/worker.ts` and its test, `server/it/auth.it.test.ts`, `server/it/invites.it.test.ts`, `server/auth/rateLimit.ts` comment).
  - Local stack note: start it with the project's CLI, `npx supabase start -x edge-runtime` (2.119.0, the images of the cloud). The global `supabase` (2.113.0) starts older images, and Realtime v2.124.2 then refuses `madar_server` on `realtime.messages`. A config.toml change needs a stop and start.
- [ ] Wave 4 follow-ups (track reports and the merge):
  - M: a mail `sendQuotaWarning` in `server/mail/notices.ts` (N2) must read the Admin role at send time and skip a person who is no longer an Admin, as M1's `ADMIN_MAIL_SQL` does. Done by Y, wave 5.
  - N3: the comment at the top of `server/it/worker.it.test.ts` still says the jobs part is a stub. Done by Y, wave 5.
  - G: after `agents.revokeAll`, Auth still holds the grant, so the consent screen goes straight back to the AI app and Madar records nothing; that app gets 401 until the person removes it in Settings, Agents (proof.md G4). Decide whether revokeAll also revokes the grants in Auth. Done by H, wave 5: no Auth admin call removes one grant (Auth v2.197.0); revokeAll now also deletes the approvals of the person, so the next connection is refused until the person approves again (proof.md section H).
  - X: `scripts/seed-test-office.ts` does not touch the platform table `agent_approvals`, so approvals survive a reseed of madar-test while the links go. Empty it in the seed (and add it to the seed table test). Done by Y, wave 5.
  - X: Z0a case 3 (agents.spec) and the Preview as checks run only on madar-test, after Z1. Done 2026-10-05 (Z1 line).
  - O / Z1: move madar-test into its own Supabase organization, or make a scoped token for madar-test only; add `TEST_SUPABASE_ACCESS_TOKEN` to GitHub only after that, and deploy the test screens from the Mac until then. Apply O3's `[remotes.test]` and `[remotes.production]` blocks of `supabase/config.toml` when the screen hosts are known (`config.sh` refuses until then).
  - O / Z5: `brew install age` on the Mac (test:it needs it, or set MADAR_AGE); make one commit (a README) in `byosamah/madar-backups` before the first release. Done 2026-10-05.
  - Plan: section 9 gains a residual risk: the Pages project `madar` serves both test (branch preview) and production (branch main); and plan 5.9 should say that deploy.yml deploys the functions only, not the screens (O3 repair). Done by Y, wave 5 (risk 21).
  - S (optional): add `auth.emailNotice` to the kinds comment in `server/core/effects.ts`. Done by Y, wave 5.
- [x] Whole-product check after wave 4 (2026-10-04): Admin, Management and Member on the local stack (remote build, functions, seeded office), in English and Arabic at 1440 and 390 px, from sign-in to sign-out with a database check at each step. Every step passed after three fixes:
  - 70efcda: every upload and download in the real build failed on the local stack, because a local function signs Storage links on `http://kong:8000`. The links now use `FILES_PUBLIC_URL` (default `SUPABASE_URL`, so the hosted projects need nothing); `tests/e2e-deploy/local.ts` writes it.
  - 41a9c18: after a mention pick, letters typed before the next frame came out of order ("@Faisal Al-Harbi ease check. pl", 7 of 10 updates). The pick moves the caret only when nothing was typed since.
  - 4c7a98a: the search test "opens the preview of a file it found" waits 10 s (it failed twice under the full suite at 4.7 s).
- [x] Whole-product check follow-ups (all done by Y, wave 5):
  - X: in a spec, click a "…" menu only after the scroll to its button settles. The menu closes when the page scrolls, and Playwright's click scrolls first, so at 390 px a menu low in a long list (Admin, People) opens and closes at once. Steps: 390 px, Admin, about 20 people, click "Actions for <last person>": aria-expanded stays false. A person is not affected. Done: `openMenu` in tests/e2e-deploy/steps.ts.
  - X1 seed: the prototype agent "Madar Assistant" (owned by the Admin) has no `agent_links` row, so the Admin's Settings, Agents shows it as "Not used yet" with a Remove that revokes no grant. Decide whether the test office keeps it. Done: the seed leaves out the sample agent and its 36 weekly summaries, and empties `agent_approvals`.
  - X (proposal): keep the walk of this check as a spec (tests/e2e-deploy/walk.spec.ts, `MADAR_E2E_WALK=1`), so the next check between waves starts from it. Its source is in the session scratchpad, wave4-shots/e2e-walk/ (cleared after about 3 idle days). Done: tests/e2e-deploy/walk.spec.ts.
- [x] Wave 5 merged into main (2026-10-04), in the order H (b0a244b), K (266b16e), Y (27631ef), with every merge lead patch: H's mail words for an out-of-date link (4422a26, the invite snapshot updated) and otp_expiry = 3600 (865a68e, the local stack stopped and started); K's plan line on `public/` (3fb8a93). Y's rebase kept both sides in `server/mail/notices.ts` (Y's Admin check and K's app address) and both new proof.md sections. Each gate passed: typecheck, `npm test` (3,328 passed, 6 skipped at the end), both builds, `build:remote -- test`, `test:db` (826 passed, 24 skipped), `test:it` (233 passed, with MADAR_AGE set), and the prototype smoke at H and K (87 of 87 each).
- [x] Whole-product check after wave 5 (2026-10-04, local stack after `supabase db reset` from main, remote build, functions, seeded office): the walk spec (`MADAR_E2E_WALK=1`) passed in all 4 variants (en and ar at 1440 and 390 px), 36 of 36 steps each for Admin, Management and Member, with the preview pixel check on the real picture. By hand (Playwright): the Madar mark shows above the title of sign-in, forgot, reset and consent in light and dark, EN and AR; an out-of-date invitation link shows "Send me a new link", the button gives "Check your email", and mail_outbox gets exactly one new `invite` row for that address; a used link and an unknown key show the same words and send nothing; after Remove in Settings, Agents the same app gets the consent screen again and its Approve is refused (`agent_removed`, G4 design), and a new registration of the app works (200); the manifest and the 192, 512 and 180 px icons load from the remote build. The full deploy suite (`MADAR_E2E_AFTER_G=1 MADAR_E2E_AFTER_M=1`): 150 passed, 4 skipped, and one cross-track failure, fixed in 71a3c61: `account.spec.ts` did not expect H's renew key in the invitation link (12 of 12 after the fix).
- [x] Wave 6 merged into main (2026-10-04), in the order V (fa223b0), W (54ed116), with V's merge lead patch: `npm run icons` and its test (aea51cb). Both rebases were clean. Each gate passed: typecheck, `npm test` (3,348 passed, 6 skipped after V; 3,359 passed, 6 skipped after W), `build`, `build:server`, `build:remote -- test`, `test:db` (826 passed, 24 skipped), `test:it` (236 of 236, with MADAR_AGE set), and the prototype smoke at W (87 of 87). One flake at the V gate: see the last Wave 5 follow-up.
- [x] Whole-product check after wave 6 (2026-10-04, local stack after `supabase db reset` from main 912dfc1, remote build, functions, seeded office before each run): the walk spec (`MADAR_E2E_WALK=1`) passed in all 4 variants (en and ar at 1440 and 390 px), 36 of 36 steps each for Admin, Management and Member. The full deploy suite (`MADAR_E2E_AFTER_G=1 MADAR_E2E_AFTER_M=1`): 158 passed, 8 skipped, no failure. By hand (Playwright): an Admin invitation in English and in Arabic adds exactly one `signin` row to mail_log (ref `invite:<id>`), and its mail shows the Madar mark (loaded from the remote build) beside the name, right to left in Arabic; a renewal from an out-of-date invitation link adds one `signin` row and one mail (every test person ended with as many `signin` rows as mails); after Remove in Settings, Agents, Approve of the same app shows the `agent_removed` words and the screen keeps only Deny (EN 1440, AR 390); an out-of-date reset link on Welcome shows one sentence and "Get a new link", which opens Forgot with its one button (EN 1440, AR 390); sign-in, forgot, reset and welcome send no `session.get` and get no 401 (EN 1440, AR 390); the manifest lists `icons/madar-maskable-512.png` (maskable, 512 x 512), and it loads as a 512 x 512 PNG. No fix was needed.
- [ ] Wave 5 follow-ups (track reports and the merge):
  - H: invitations that the Admin sends (`users.create`, `users.resendInvite`) do not count against the daily mail quota; only a renewal does. Done by V, wave 6 (fa223b0): every invitation takes one `signin` place (key `invite:<inviteId>`); on a full day the row waits until the next UTC midnight, and Usage leaves out a row that waits.
  - H: a person who accepted but set no password gets the invitation again as a reset link with no renew key, so an out-of-date link shows the old "Ask the Admin" words. Done by W, wave 6 (54ed116): an out-of-date reset link shows one sentence and "Get a new link", which opens Forgot.
  - G (proposal from H): when the consent screen gets the redirect at once for a client whose link Madar removed, it could revoke that grant with the person's token and show the `agent_removed` words, so the person never needs Settings, Agents for this case.
  - K: the sign-in mails of `server/auth/mail.ts` (invitation and reset link) have their own layout with no header, so no mark. No maskable icon for Android. No `npm run icons` script (package.json, T0). Done by V, wave 6 (fa223b0): the shared `brandHeader` in both mails (the direction now in a div, for Gmail), `icons/madar-maskable-512.png` in the manifest, and `npm run icons` (aea51cb).
  - K: the next prototype republish must add `manifest.webmanifest`, `icons/madar-192.png`, `icons/madar-512.png`, `icons/madar-maskable-512.png` and `icons/apple-touch-icon.png` from dist/ to the files map; then open it once and check there is no 404 for the manifest or the maskable icon.
  - Y: after the Y repair, only the 390 px walk variants ran again; run en-1440 and ar-1440 at the next whole-product check. Done: the whole-product check after wave 5 ran all 4 variants.
  - G (calm screen, from the check after wave 5): after Remove in Settings, Agents, the same client gets the consent screen; Approve then shows the `agent_removed` line, but Approve stays the main button and a second press repeats the refusal. Steps: member, approve a new client, call MCP once, Remove it in Settings, Agents, start the authorize step again with the same client_id, press Approve. Proposal: after `agent_removed`, hide Approve and keep Deny, so the one next step is in the AI app (or follow the H proposal above). Done by W, wave 6 (54ed116): after `agent_removed` the consent screen shows the refusal words and hides Approve; Deny stays and sends the person back to the AI app. The H proposal above stays open.
  - U (optional, from the check after wave 5): every signed-out screen (sign-in, forgot, reset, welcome) sends `session.get` twice with no token and gets 401 each time (`AppearanceSync`, since 2026-09-30). Nothing shows on screen. Steps: open /sign-in with no session on the remote build and watch the `api/batch` requests. Skip the call while there is no session. Done by W, wave 6 (54ed116): `AppearanceSync` sends `session.get` only while someone is signed in.
  - Flaky: `src/features/project/ProjectByCode.test.tsx` ("turns a project code in a post into a link") failed 2 runs in 3 on main 14e2db7 for K; it passed in all three wave 5 gate runs. Unit screen tests also time out (about 5 s) when the suite runs next to a build or Playwright. Done after wave 6: the cause was the 1 s default wait for a whole project page; both project-page waits of the file now allow 10 s, as the Search fix does. The other load timeouts stay a known limit: run the unit suite alone.
  - Flaky (wave 6 merge): `src/features/dashboard/meeting/Agenda.test.tsx` ("starts the meeting of the new day by itself on a screen that stays visible all night", DSH-2) failed once in the full suite at the V gate (no "Decisions" region); it passed 3 of 3 alone and in the full rerun. V also saw 6 timeouts (about 5 s) in Inbox and other screen tests in one full run. Done after wave 6: the Decisions panel waits for `projects.get`, so it can come after the project card; the test now waits for the panel at both places where it reads it.
  - V: a renewal row with its own reserved place that gives way to a later invitation row loses that place for its day (at most 1 place, rare). Done after wave 6: `release` in `server/mail/quota.ts` gives back the place of a row that never made a link and sends nothing (it gave way, or the person was turned off). A row with a stored link keeps its place, because an earlier attempt may have sent its mail. Unit tests in `invite.test.ts`, and a database test as madar_server in `email.it.test.ts`.
  - V: the key `people.sent` in `src/i18n/real/people.en.json` and `people.ar.json` (U) is no longer used (the resend toast uses `people.onItsWay`); remove it. Done after wave 6.
  - Whole-product check after wave 6 (H and W): a person who opened the invitation link but set no password counts as active in `users.invites` (Auth confirmed the email), so Admin, People shows no "Invited" label and its menu has no "Send the invitation again". So the reset-link invitation that W's Welcome fix handles comes only from a `users.resendInvite` call (an agent or the API), not from the screen. Nothing is broken: the person can still use Forgot. Steps: Admin adds a person; the person opens the Welcome link, presses the button and closes the page before a password; reload Admin, People and open the menu of that person. Decide whether the screen shows "Invited" and Resend until the first password, or whether Forgot is the one way. Done (owner chose "Invited" until the first password, 2026-10-04): Auth gives no sign of a password (it stores a password value as soon as the link opens, probe on the local stack), so the screens set the Auth user_metadata mark `madar_password_set` with each password save and after a sign-in with a password; users.invites says active only with a confirmed email and the mark. The seed and the first Admin set the mark. A person can set the mark on their own account only, and it changes only their own label. Review follow-ups (2026-10-04): the renew route and the auth.email effect now use the same rule (accepted = confirmed email and the mark), so a person who opened the link and left gets a working recovery link from "Send me a new link" and from an email change. An account that saved a password before this change has no mark until its next password sign-in: production starts empty and the seed sets the mark, so before any real use there is nothing to backfill; on madar-test, run the seed again.
- [x] Logo in the app (owner, 2026-10-04: "Top-left, every screen"): the Madar mark at the top start of every signed-in screen (desktop: across from the picture; phone: the start of the top row, which a project page gives to its back link). A press opens Home. Name "Madar, Home" / "مدار، الرئيسية". Screenshots: desktop dark (Chrome), phone EN/AR light/dark and a project page (Playwright).

## 2026-10-05: staging

- [x] Staging (owner, 2026-10-05): the test copy is the staging step. No third copy (Supabase gives 2 free projects, Madar uses both) and no staging address for now. `all.sh test` records its commit, and production refuses any other commit, a change that is not committed, or a folder that is not a git checkout, before the typed word. Release steps: `scripts/deploy/CLAUDE.md`, Release flow. Tests: `scripts/deploy/deploy.test.ts`.
- [x] The next production deploy: run `scripts/deploy/all.sh test` from main first. Done 2026-10-05: production took 69e3be7 and then 02cd6a4, each after a full test deploy of the same commit.

## 2026-10-05: owner feedback batch (spec docs/superpowers/specs/2026-10-05-owner-feedback-batch-design.md)

Branch `fb/2026-10-05`. Wave 1 tracks run in parallel worktrees. Wave 2 starts after the wave 1 merge.

- [x] Track fix: tab row scrollbar (7), Arabic sheet corner (5), empty dates "Set date..." and aligned columns (8), hatch switch (9), light theme for new people (11)
- [x] Track lead: tasks with no lead, "Take it", no finish without a lead (2)
- [x] Track clients: client form asterisks and messages (1), Admin Clients section (3), the internal project code (6b)
- [x] Track admin: the Admin side list with one section at a time (4)
- [x] Track profile: profile picture (10), English and Arabic names for each person (12)
- [x] Merge wave 1 (admin, lead, fix, clients, profile), register the Clients section. npm test 3705 passed; typecheck, build, build:server, build:remote test pass
- [x] Small follow-ups: the created toast shows the project key; Team tab names keep their width at 390 px (the discipline field takes its own line); Add client is a plain button, so Create project stays the one main button
- [x] The date fields that save with a form button get the "Set date..." look (DateField; the Tracker quick log keeps its native date on purpose)
- [x] Payments: a fixed field loses its message at once (it stayed until the next Save)
- [x] Follow-ups: prototype smoke 87 of 87, phone screenshots (Team names in full, one main button, payment message goes)
- [x] New project and client forms: a field shows its message on blur only after a change (a blur message moved New client down and lost the first press)
- [x] The New client box has a thin outline and no fill, so its grey fields stand out (8 shots, EN/AR, light/dark)
- [x] The test office seed revokes the AI app grants of the 4 accounts (a leftover grant from a one-off check failed the walk once)
- [x] Follow-ups to production (owner OK, 2026-10-05): test copy at bfb599b and 02cd6a4, main pushed, all.sh production from 02cd6a4, the quick check passes
- [x] Z7, owner decision: the API accepts a browser token until it expires (up to 1 hour) after its Auth session ended, for example after "Password changed. Your other devices sign out." Options: a shorter jwt_expiry, or a session check in the API. Agent tokens already stop at once. Done 2026-10-06 (owner: "do them all"): jwt_expiry = 900 in both projects, so the gap is 15 minutes at most; config-check.ts refuses more, and signin.spec.ts checks the token of the target
- [x] Test copy: test mails count against the mail day quota (outbox driver) and the seed keeps mail_log, so a busy test day blocks invites until 03:00 Riyadh. Fixed 2026-10-06 (owner OK): with MAIL_DRIVER=outbox the seed empties mail_log
- [x] Track templates: project templates with roles, offsets, stretch and shrink; stage templates merge in (6a). Migration 20261005000100_project_templates.sql (checked in PGlite only)
- [x] Merge wave 2 (clean). npm test 3772 passed; typecheck, build, build:server, build:remote test pass
- [x] Prototype smoke on the batch branch: 87 of 87 (one spec took the Arabic name)
- [x] Local stack: db reset applies the new migration; test:db 956 (24 skipped), test:it 240, deploy suite 159 passed (8 skipped), the walk 4 of 4 variants
- [x] Owner OK (2026-10-05): main fast-forwarded to the batch; all.sh test deployed 228c01b (health 112 calls). The config push needed vector buckets off (402 on the free plan)
- [x] Deploy suite on the test copy at 228c01b: walk 144 of 144 steps, agents.spec in full; 2 failures from a sign-out race, fixed (no call without a session, reason no_session). Result in proof.md, section Deploy
- [x] The MCP icon showed vado.sa: the serverInfo now names the Madar logo, and public/favicon.ico holds it
- [x] Test copy again at 69e3be7: account.spec.ts repeated 3 times 28 of 28, agents.spec 10 of 10, the MCP icon and /favicon.ico
- [x] Production (owner OK in chat, 2026-10-05): main pushed, all.sh production from 69e3be7, the quick check passes
- [x] Z7 to production (2026-10-06): test copy at 746d694 (deploy suite 165 passed, 0 failed; a member session of 17 minutes renewed its token and kept the live updates), then all.sh production; jwt_exp 900 on production, the quick check passes
- [ ] File backups (Z5), owner steps: a Backblaze B2 account (region EU Central), a private bucket, and an application key for that bucket only; a Supabase S3 access key of production (Storage settings); the 5 values B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, FILES_S3_ACCESS_KEY_ID, FILES_S3_SECRET_ACCESS_KEY in .env.local; the 2 values of secrets/files-backup-crypt.env in the password manager; an OK in chat for the GitHub secret writes. Done by Claude 2026-10-06: RCLONE_CRYPT_PASSWORD and RCLONE_CRYPT_SALT are GitHub secrets. The safety system refused FILES_S3_ENDPOINT until the owner's OK. Then Claude sets the rest, runs `gh workflow enable "Files backup"` and one run by hand
- [x] The clean-up batch and the test office files to production (owner OK, 2026-10-06): test copy at 9b6bf07 (deploy suite 165 passed, 0 failed), then all.sh production; the quick check passes
- [x] Dashboard accuracy batch (owner, 2026-10-06): Overdue column and review tasks for the reviewer in the People tab, the leader and client filters reach the lists, the area warning; remove the Health mix card, the zero rows and the weekly task chart (now submissions to clients per week); add waiting for our reply, waiting for review, data gaps (Admin) and money (Admin, Management, Accounting); a past-due task marks a project At risk only from 3 days. Merged 2026-10-06 (14 commits): npm test 3,894 passed; the screenshots in EN and AR, light and dark, 390 and 1440; a Member sees no money and no gaps
- [x] Dashboard batch to production (owner OK, 2026-10-06): test copy at 2bb11f5 (164 passed, 1 network drop that passed 3 of 3 on repeat), then all.sh production; the quick check passes
- [x] Tasks with no project (owner, 2026-10-06): "office tasks", built on branch office-tasks/2026-10-06 (design: docs/superpowers/specs/2026-10-06-office-tasks-design.md). Only the maker, the lead, the helpers and the Admin see one; New office task on the Tasks page; the word Office where a project shows; past-due, workload, reviews and gaps of the Dashboard count them, project numbers never. Waits for the merge Privacy review in 3 rounds (2026-10-06): a comment body after an undo of a deleted task, then existence leaks (error texts, the office signal, mixed undo), all fixed with tests; accepted limit: the sequential ids show that hidden records exist. Merged with npm test 3,978 passed, test:db 1,001, the prototype smoke 87 of 87
- [x] Three layout fixes (owner, 2026-10-06): the Stale sign moves under a long project name on a phone; a sheet that opens closes the toasts with no Undo, and on a phone the toasts sit above the sheet; on a desk a sheet starts below the tab pill, so the bell count shows
- [ ] Daftra link (study 2026-10-06, flow chosen 2026-10-26): the accountant keeps the books in Daftra. Owner decisions: Madar only reads Daftra and never writes to it (flow A). At the due date of a payment, Madar tells the accountant on the bell. The accountant makes the invoice in Daftra, as today, and Daftra sends it to the client. Madar finds the new Daftra invoice of the same client with the same amount and shows it on the payment; the accountant presses "Link" once (Accounting role only). The payment then shows "Invoiced", and "Received" ticks itself when Daftra marks the invoice paid. Each Madar client matches one Daftra client. A payment amount includes VAT, and each payment has one Daftra invoice. The accountant groups by client, not by work order or cost center: the link sits on the payment, so no group is necessary. The full Daftra key stays on the server only, never in the browser or for AI agents. The accountant joins the pilot as Accounting. He asked that Madar issue the invoice itself; the owner chose flow A and tells him. The read-only study on the Mazj test key is done (proof.md, "Daftra study on the Mazj account", 2026-10-26). Next: the design; then the real office key with the role "Only Allow" `invoice` and `client`. Nothing built
- [ ] Pilot (Z8), owner steps: the team list (English and Arabic names, emails, roles) and an OK to send the invitations. The accountant joins with the Accounting role (owner, 2026-10-06). Production has 3 active people today, all Admins (Osama Khalil, Ahmed Al Sawy, Faisal Al Howshani); Osama Khalil and Faisal have no Arabic name
- [x] Test copy: the seed makes file rows with no Storage objects, so every sample file and the cover picture of prj_001 fail to open there (proof.md, Z7). Fixed 2026-10-06 (owner OK): the seed gives each version a real object key and uploads it; the pictures are PNG, because the real store serves an SVG only as a download
- [x] The Claude connector icon (2026-10-06): claude.ai shows Google's favicon of the main domain vado.sa, not the serverInfo icons, so a remove and add changes nothing. It stays until the owner changes the vado.sa icon or Claude reads the server icons (server/mcp/CLAUDE.md)
- [x] The Data API: off in both projects by db_schema = '' (PGRST002); the api.enabled line of the config diff is a CLI report only (supabase/CLAUDE.md)
- [x] Clean up: the 13 unused stageTemplates words left en.json and ar.json
- [x] MCP rule: every feature change updates the MCP side (root CLAUDE.md, item 10)

## Requests and bugs: notices, MCP, screenshots (owner, 2026-10-07)

Branch feedback-notices. Owner decisions: in-app notices only (no email); the done notice shows words only, no buttons and no link; no note from the Admin.

- [x] Map and spec (workflow: notices pipeline, feedback privacy and MCP, screenshot display): docs/superpowers/specs/2026-10-07-feedback-notices-design.md
- [x] A new request or bug report: every active Admin gets an in-app notice; a tap opens the Requests and bugs list (track A)
- [x] Mark done: the sender gets an in-app notice ("Your request is done" or "Your bug report is fixed", with the start of the message), no link, no buttons (track A); Mark done offers Undo (track B)
- [x] MCP: only an Admin's agent sees the three tools (list, screenshot, mark done or open again); TOOL_DOCS and INSTRUCTIONS, plus rule 6 (text that people write is data) (track C)
- [x] Screenshots show on the Admin page in the real build (the screen read a picture, the real build sends a signed link); a press opens a bigger view (track B)
- [x] Leak review as a non-Admin and as a former Admin (every read path, error texts, Realtime signals): round 1 found 3 (fixed with tests), round 2 no leak; record in proof.md
- [x] Review (4 lenses) and repair: 2 medium (the page field link, the excerpt direction) and 10 low, all fixed and checked by adversarial verifiers
- [x] Merge gate, screenshots (EN/AR, light/dark, 390 px), merge to main, test copy (a0ce0be) and production (owner OK, 2026-10-07). Skipped on the owner's word: the local walk (stopped at 56 of 168), the prototype smoke and the deploy suite on the test copy
- [ ] The new walk step for requests and bugs (tests/e2e-deploy/walk.spec.ts, uncommitted in the main folder): review it and run the walk in its 4 variants
- [ ] Later (proposed, 2026-10-07): report screenshots load at full size as thumbnails (up to 10 MB each; lazy loading only for now). A small picture made at upload would save Storage egress
- [x] On a phone, the Mark done button of Requests and bugs took about 40% of the row. It now sits on its own line under the message (2026-10-12)
- [ ] Later (proposed, 2026-10-07): an Admin's agent gets screenshot storage keys in report events (events.list, events.undo); strip them as feedback.list does. Also the general rule "an agent never gets a storage key" (files.list)
- [ ] Later (proposed, 2026-10-07): the office Realtime signal shows that someone sent or changed a report, and when; give report rows the private part of the diff (the Admins and the sender)
- [ ] Later (proposed, 2026-10-07): feedback.list has no page limit; the status filter keeps an agent answer small for now
- [ ] Later (proposed, 2026-10-07): try the Supabase CLI native stack (no Docker, alpha since 2026-10-02): update the CLI, `[experimental] stack = true`, then test:db and test:it in one worktree, and compare the counts with Docker. The MinIO suites still need Docker (server/it/minio.ts). Check first that `config push` to the hosted projects ignores the experimental section

## Two team requests (owner, 2026-10-07)

Branch fb/2026-10-07 (worktree `.claude/worktrees/fb-2026-10-07`). Owner choices: the person who adds a task changes it like
the leader, and the review stays with the leader; Home shows the next 3 tasks with a date when nothing is due today.

- [x] The maker of a project task: the lead (team mates only), helpers, prerequisites, dates, title and delete, and the Undo
  of those changes. Approve, send back and the review need stay with the leader. MCP docs and rules updated
- [x] Home: "Coming up" lists the next 3 open tasks with a due date when nothing is due today
- [x] Gates: typecheck; npm test 4,106 passed; test:db 1,063 passed; test:it 241 passed (the 16 agent sign-in tests needed
  `npx supabase db reset` first, as `server/mcp/CLAUDE.md` says); the prototype, server and remote builds; screenshots
  (EN/AR, light/dark, 390 px). Not run: the prototype smoke and the deploy suite
- [x] Test copy and production at 1f06244 (owner OK, 2026-10-07); record in proof.md

## Fixed: Arabic stage name was cut (found 2026-10-07, fixed 2026-10-08)

- [x] The task panel showed «ınstruction Documents» in Arabic: the stage field sat in a narrow column and cut the first letters. The stage field now takes a full row from 640 px up (`TaskSheet.tsx`, test `TaskStageRow.test.tsx`). Checked in Arabic and English, light and dark, at 390 px, and in Arabic at 1280 px.

## Release of the security fix F1 (owner, 2026-10-07)

Branch sec/agent-undo (worktree `.claude/worktrees/deploy-test`): the commits of feedback-notices after 8ca1b7d on main.

- [x] Merge gate: typecheck; npm test 4,107 passed; the three builds; test:db 1,065 passed; test:it 241 passed
- [x] Main, then the test copy (c5c7622, page 200, `/mcp` with no token 401, health 200)
- [x] Production at c5c7622 (the owner ran `all.sh production` himself: the safety check refused it from Claude)

## Drag and drop order on the Tasks screen (owner, 2026-10-07)

Branch fb/work-order (worktree `.claude/worktrees/fb-work-order`). Owner choices: one shared order that belongs to the tasks;
a drag only inside a date group, never a date change; Home follows the order; a grip on each row.

- [x] `Task.rank` and `tasks.arrange` (rights of `task.updateOwn`, one event for each moved task, Undo); the Tasks screen drag
  (pointer, touch and keyboard, screen reader words); Home in the same order; the History line; the MCP tool and its docs
- [x] My own tasks first in each group, then the tasks I only help with (no grip, no drop between them): without that rule a
  helper task jumped to the end after the first drag
- [x] Screenshots (EN/AR, light/dark, 390 px) and a real mouse drag at 390 px (moved, saved, Undo), no console error. A grip
  takes about 45 px, so a long title in a group with grips cuts sooner on a phone
- [x] Gates: typecheck; npm test 4,131 passed; the three builds; test:db 1,073 passed; test:it 241 passed
- [x] Before `all.sh test`: `deploy-test` gets its own `node_modules` (its link points to the main folder, which lacks `@dnd-kit/sortable`)
- [x] Test copy and production at 66586d0 (owner OK, 2026-10-07; the owner ran production with `!`); record in proof.md

## Performance audit and fixes (owner, 2026-10-07)

Branch perf/audit (worktree `.claude/worktrees/perf`). Owner rule: the fixes change only speed and size, never behavior,
visuals, words, data, the contract or the security rules. Audit text: the workflow run wf_1adeac2c-b68 (70 findings).

- [x] Baseline: the remote build sends one 1,786 KB script (519 KB gzip) for every screen; 3 Thmanyah fonts at 241 KB each
- [x] Audit workflow: 7 auditors (first load, screen work, data flow, server path, database, background paths, live numbers
  on the test copy), each with a skeptic: 60 findings kept, 10 dropped
- [x] The prefetch helper `src/app/prefetch.ts` (8753a11), shared by two tracks
- [x] Owner answers (2026-10-08): saves one round trip sooner, no optimistic update (FET-3); the /api/batch forwarder:
  build it, measure on the test copy, keep it only if faster (FET-10); a JPEG small copy for Safari and iPhone uploads
  (BGR-M1); the font preload, with the variant check on the test copy (BND-3)
- [x] Wave 1, seven builders (tracks A first load and fonts, B1 lists, B2 panels and project page, C client data and saves,
  D server path, E database, F pictures). A first try stopped on the weekly usage limit (2026-10-07) and left nothing.
  The second try (2026-10-08): B1, D and F ended; A, B2, C and E stopped on a network error after most of their commits,
  and four finishers end them
  - [x] Merged into perf/audit: B1 (7 commits), D (6), F (3); type check passes; their guide facts and proof written
  - [x] Merged A (7 commits), B2 (6), C (6), E (4) after the finishers; one conflict (an import line of bootstrap.ts);
    guide facts and proof written
  - [x] Fix: the on-demand screens made the prototype file 31 KB gzip larger; the prototype now takes plain imports through
    an alias (574,611 B gzip; base 566,359 B; the rest is the new speed code of both builds)
- [ ] Wave 2 after the merge: the /api/batch forwarder, then its measurement on the test copy
  - [x] The forwarder (`functions/api/batch.ts`, `server/http/pagesApiProxy.ts`, 5 tests) and the client setting
    `VITE_BATCH_URL` (off by default, 3 tests)
  - [x] Measured on the test copy (2 samples, 15 and 20 rounds): forwarder POST 305 to 339 ms, direct POST 285 to 287 ms,
    direct preflight plus POST 537 to 558 ms. It saves one preflight each 2 hours (Chrome) but adds 20 to 50 ms to every
    call, so it is not faster: removed (954093a)
- [ ] Merge, then the gates once: typecheck, npm test, the three builds, test:db, test:it, the prototype smoke; screenshots
  (EN/AR, light/dark, 390 px)
  - [x] typecheck; npm test 4,379 and 4,375 passed in two runs, and each failure (load timeouts, load average 30 to 40 from
    other sessions) passed alone with the long-timeout flags; the three builds and their bundle checks; db reset with the
    read indexes; test:db 1,097 passed (25 skipped); test:it 253 of 253; test:mcp 134 passed (conformance exit 0)
  - [x] Fix: the task panel prefetch put the zod schemas into the first load again (can() took memberKey from store.ts);
    rowKeys.ts and limits.ts, with a test
  - [x] Fix: the restore check took "public" of CREATE STATISTICS ... FROM "public"."events" for a role; a quoted name
    with a dot after it is now skipped, with a test
  - [ ] The prototype smoke and the screenshots (with the live numbers on the test copy)
- [x] Test copy at e488d65 (2026-10-08): the read indexes pushed, health 113 calls, the new first load served
- [x] Live numbers before (test copy at 66586d0, 5 rounds per role, load 3 to 6): first data on a cold load 1.6 to 1.7 s,
  3 CORS preflights, 557 KB of script; Lighthouse sign-in page mobile 0.74, desktop 0.99; 24 screenshots at 390 px
- [ ] Live numbers after, the screenshot compare and the font priority test: stopped by the owner (2026-10-08) before
  they ended; the prototype smoke not run
- [x] Production at 62855bc after the owner's words ("deploy to test copy and production", 2026-10-08): the read indexes
  pushed, health 113 calls, madar.vado.sa serves the new first load
- [x] Removed the 7 track worktrees (wf_83aaede9-652-1 to 7) and their 13 branches, after the owner's OK (2026-10-08)
- Not planned (each needs a visible change or more proof): long lists in steps (RND-6), the frame during the token renewal
  (BND-M1), the change number check on a join or a return (BGR-1 step 2, BGR-6), a warm-up call (LIV-7 step 3), 3 overview
  reads in one request (FET-7), shared read transactions (SRV-2), static icons at rest (RND-7), Home without done tasks (FET-M1)

## Drag and drop order on Home and in the project task list (owner, 2026-10-08)

Owner choices: the drag works on Home, the Tasks page and the project page; one shared order for everyone. A drag stays inside
one list: a date group (Home Today, the Tasks page) or one stage (the project page). It never changes a date. Coming up on Home has
no grips, because its tasks fall on different days.

- [x] One shared list component (`features/project/tasks/SortableTaskRows.tsx`) for the Tasks page, Home Today and the project list
- [x] The project task list takes the shared order (`arranged`), so a new place shows at once
- [x] Tests first: `TodayOrder.test.tsx` and `TaskListOrder.test.tsx`; the Tasks page tests (`WorkOrder.test.tsx`) still pass
- [x] Gates: npm test 4,380 passed; the prototype build with the RTL and bundle checks
- [x] Screenshots (prototype, 390 px): Home Today in EN and AR, light and dark; the project list in four views; a keyboard drag on Home and in a stage
- [ ] Not run: test:db and test:it (need Docker), prototype smoke. build:remote ran inside all.sh production, and its bundle checks passed
- [x] Production at ef24a11 (owner, 2026-10-08, `all.sh production` run by the owner): health 113 calls, page 200, `POST /mcp` with no token 401. Record: proof.md
- [ ] Deploy suite on the test copy (about 45 minutes): not run before production

## Phone tab bar and the Admin's Waiting and Done tabs (owner, 2026-10-08)

- [x] Phone tab bar: icons only, the words stay for screen readers and show from 640 px (`83c6161`)
- [x] Admin's Requests and bugs: Waiting and Done tabs (`ab2bbaf`)
- [x] Production at ab2bbaf (owner, 2026-10-08, `all.sh production` run by the owner): health 113 calls, page 200, `POST /mcp` with no token 401. Record: proof.md
- [ ] Deploy suite on the test copy (about 45 minutes): not run before production

## Browser push notifications (owner, 2026-10-08)

Owner choices: free Web Push (no email, WhatsApp, SMS or vendor account). One fixed line with no data: "You have something new in Madar."
(Arabic: "لديك جديد في مدار."), title Madar / مدار. It goes for every new bell notice (all triggers) and every new chat message, to the
people who read them, never to the sender, only to active people. One switch for each device in Settings. This replaces "No phone push"
of 2026-10-03. Record: `server/push/CLAUDE.md`. Merged into main; on the test copy and on production at bf3fa9f (2026-10-08).

- [x] The record `PushDevice`, the calls `push.register`, `push.remove`, `push.mine` (prototype fake and server), the migration `20261008000100_push_devices.sql`, the loader, the MCP deny list, no event and no signal for a device
- [x] The sender (`server/push/vapid.ts`, `send.ts`): an ES256 token with WebCrypto only, an empty POST, 201 and 202 sent, 404 and 410 delete the device, 429 and 5xx retry
- [x] The producer and the effect (`notify.ts`): one `push.notify` row for each person in the transaction of the call; after the answer on the hosted functions; the 15-minute job writes the same rows
- [x] Keys: `scripts/push/make-vapid.ts` ran for test and for production (a pair of its own for each; the three lines are in `secrets/<env>.env`, `VITE_VAPID_PUBLIC_KEY` is in `config/remote.<env>.env`); `secrets.ts` and `deps.ts` take the three names, all or none
- [x] Headers: `/sw.js` has `Cache-Control: no-cache`, the CSP has `worker-src 'self'`, the push services need no `connect-src`
- [x] The service worker `public/sw.js`, the Settings switch (real build only), the check at the start of the app, the sign-out step
- [x] The prototype never holds the worker: `workerOnlyInRemote` (Vite) and a rule in `check-bundles.ts`
- [x] Leak probes: `pushLeaks.test.ts`, the loader probe in `server/data/loaders/push.test.ts`, the save test, the MCP deny test
- [x] Tests first for each part. Gates: typecheck, `npm test` 4,550 passed and 6 skipped, `npm run build` (RTL and bundle checks), `build:server`, `build:remote -- test`
- [x] The SQL and the migration ran once on an in-memory Postgres 18 (pglite, outside the repo): the producer, the loaders, the save, the effect, the unique endpoint
- [x] Gates of the merge lead (2026-10-08, Docker on): typecheck; `npm test` 4,550 passed (448 files); `test:db` 1,117 passed (25 skipped); `test:it` 261 passed (33 files, `server/it/push.it.test.ts` included); `test:mcp` 135 passed and the conformance runner exits 0; the prototype, server and remote (test) builds
- [ ] Not run: the prototype smoke
- [x] Screenshots of the Settings section on the test copy (member sample account, headless Chromium, EN and AR, light and dark, 390 px): the section shows its note (headless Chromium blocks notifications, so no switch), nothing cut off, the page stays 390 px wide, 0 console errors. The switch state itself shows only in a real browser (owner)
- [x] The blocked note and the iPhone note named "this switch" while no switch showed: now they name "Notify me on this device" and say where to find it (`b716865`; on main, not deployed yet)
- [ ] Owner: `all.sh test` in his Terminal (it pushes the migration and sends the three secrets); then try it on a device: Settings, Notify me on this device, allow; a second person assigns a task or sends a chat message; an iPhone needs Madar on the Home Screen first
- [x] Production at bf3fa9f (owner, 2026-10-08, `all.sh production` run by the owner): health 116 calls, page 200, `POST /mcp` with no token 401, `sw.js` 200 with no-cache. Record: proof.md
- [ ] Not proven: a real push service. The first push on Chrome, Edge, Firefox, Safari and an iPhone (Home Screen) shows only on the test copy
- [x] The hand-set `Content-Length: 0` header is removed from `server/push/send.ts`: a fetch POST with no body sends it by itself (2026-10-08)
- [ ] Question: a plain comment on a task makes no bell notice and no chat message, so it sends no push. The Inbox shows it as a task thread. Add a push for it?
- [x] A sign-out also unsubscribes the browser: kept (merge lead, 2026-10-08). Since 2026-10-09 the next sign-in on that browser turns push on again for that person, because the permission stays (see the default-on items below)
- [x] Push on by default (owner, 2026-10-09), branch `rb/push-default-on`: a card on Home asks once for the Allow tap (`PushAskCard`), then `syncThisDevice` turns push on again by itself at each sign-in; a person who turned the switch off stays off on that browser (`madar.pushOff.<user id>`). Tests first in `push.test.ts`, `PushSync.test.tsx`, `PushSection.test.tsx`, `PushAskCard.test.tsx`
- [x] Push on by default is on production at ef8e392 (owner's OK, 2026-10-09; test copy first, the owner ran `all.sh test` twice because the first run did not finish). Record: proof.md, "Browser push on by default"
- [ ] Owner: try it on a real device on madar.vado.sa: sign in, tap the card on Home, Allow; sign out and in again (push is on without a new question); turn the switch off in Settings, reload (it stays off). An iPhone needs Madar on the Home Screen first, and shows no card before that
- [x] The worktree `~/dev/madar-rb/push-default-on` and the branch `rb/push-default-on` are removed (owner's OK, 2026-10-12)
- [ ] Not proven: the card and the silent turn on in a real browser with a real push service (jsdom tests and headless screenshots only)
- [x] The endpoint must name a known push service (`PUSH_HOSTS`), so the server cannot be aimed at any host. A new browser vendor needs one line there: kept (merge lead, 2026-10-08)
- [ ] Question for the owner: an Admin gets a push for every project chat message in the office, because the Inbox counts every project chat unread for an Admin. Limit it to the chats of the projects the Admin is on?

## 2026-10-12: team reports fbk_004, fbk_005 and fbk_006 (branch `rb/feedback-batch`)
Faisal Al Howshani sent the three reports on 2026-10-11. The owner asked for all three on 2026-10-12. Guides: `src/CLAUDE.md`, `src/api/CLAUDE.md`.

- [x] fbk_004 "No deadline" on every project: not a code error. The column shows named deadlines (the Schedule tab), and Madar held none. A row and the project header now show "Stage ends" and the date (`ProjectSummary.stageEnd`, the date that the Late tag reads) while there is no named deadline. The sort by deadline follows the same date. The line wraps on a narrow row and never truncates
- [x] fbk_005 the "+" of a stage did nothing, and the team did not know to press the words: it opens `NewTaskSheet` (title, a lead from the team, due date). The words stay the quick add
- [x] fbk_006 the avatar of a task row opens a pop-up for the lead (`TaskPeople`), a "+" on hover opens the helper list, and one press on a name changes the task at once with an Undo toast. The right is `TaskRow.canEditPeople` (the rule of `viewerCan.editAll`). The pop-up is `Popover` with `fit` (`popoverPlace`), so a long list scrolls inside a phone screen
- [x] MCP: the `TOOL_DOCS` of `projects.get`, `projects.list` and `tasks.get` name the new fields. No new call
- [x] MCP messages (owner, 2026-10-12, also fbk_002 "send DM to people using MCP"): an agent may now use `chats.openDirect`, `chats.list` and `chats.send` (a direct chat or a project chat, as the person, with the agent named beside it). Task comments and project posts it had already. It never reads a chat: `chats.messages`, `chats.markRead`, `chats.unreadCount` stay denied, and a direct chat in `chats.list` has no preview (`run.ts`). A sent message writes no event, so no Undo takes it back. 44 tools (41 and 3 for an Admin's agent), 18 reads and 26 writes; INSTRUCTIONS has a Messages paragraph; `samples.json` is recorded again. Tests: `messageTools.test.ts`, `tools.test.ts`, `app.test.ts`
- [x] fbk_002 "send DM to people using mcp" is what the MCP messages item delivers. Mark it done with the other three, after production
- [x] Tests first for each part. Gates: typecheck; `npm test` 4,607 passed and 6 skipped (452 files); the RTL check; `npm run build` (prototype), `build:server` and `build:remote -- test` with their bundle checks (first load 1,124,334 B). Phone check (390 px, real touch emulation, headless Chromium, English and Arabic, light and dark): the pop-up fits, the "+" is gone, the Arabic stage line wraps whole
- [ ] Not run: `test:db` and `test:it` (Docker was off), the prototype smoke, the deploy suite
- [ ] Known and old: in Arabic a bottom sheet makes the page 391 px wide for a moment. The older "New office task" sheet does the same, so this change did not cause it
- [x] Test copy and production at cb0f7b9 (owner's "deploy go", 2026-10-12; Claude ran both). No migration. Health 116 calls, page 200, `POST /mcp` with no token 401. fbk_004, fbk_005 and fbk_006 are done in Madar. Record: proof.md, "Team reports fbk_004, fbk_005, fbk_006 and MCP messages"
- [x] fbk_002 done (2026-10-12): the first live message went out through `chats.send` (msg_004, the direct chat with Faisal), sent by the new agent "Osama Claude Code (madar-direct) Agent" for Osama
- [x] The message to Faisal that explains the three changes went out (2026-10-12, story `sty_5l3zglxu35rjyn7ghhr27t`)
- [x] The worktrees and branches of the 2026-10-12 releases are removed (owner's OK)
- [x] The folder `.playwright-mcp` in the main folder is removed (owner's OK)

## 2026-10-12: agent names and Remove for a turned-off person (branch `rb/agent-names`, worktree `~/dev/madar-rb/agent-names`)
The owner asked on 2026-10-12. Decisions: the name format "Osama Claude Agent"; "delete" means remove from every list and keep the history; a separate release after the ready one (`cb0f7b9`). Not merged into main, so the ready release is not disturbed.

- [x] Every agent read "Claude" (the name of its AI app). A new agent user is named "<first name> <app> Agent" (`agentNamesOf`, `src/lib/agentName.ts`, used by `ensureAgentUser`), and in Arabic "وكيل <first name> <app>" when the person has an Arabic name. `agent_links.client_name` keeps the plain app name for the match of a reconnect
- [x] The agents that exist: migration `20261012000100_agent_names.sql` renames them with the same rule (only an agent that still has its app name, and the Arabic name only when it has none), raises `office_meta.version` and sets `chg`. Proved on an in-memory Postgres (pglite, outside the repo): 8 cases and a second run that changes nothing. Production has 3 agents (Osama, Faisal, Tarek): they become "Osama Claude Agent", "Faisal Claude Agent" and "Tarek Claude Agent" when their link app name is "Claude"
- [x] `users.remove` (new call, 117 calls): a turned-off person or agent leaves every list for good (`User.removed`). The record stays for the History. The agents of a person go with them. People screen: "Remove from the list" with a sheet that asks first, no Undo. MCP: deny list. Counts raised: `calls.test.ts`, `serverCallMap.test.ts`, `health.test.ts`, `worker.it.test.ts`
- [x] Tests first for each part. Gates: typecheck; `npm test` 4,626 passed and 6 skipped (455 files); the RTL check; `npm run build` and `build:server` with their bundle checks. Screens: the People menu and the sheet in English dark at desktop width, and at 390 px with real touch emulation in English and Arabic, light and dark: no horizontal scroll, both sheet buttons inside the screen. After a removal the old tasks still show the name
- [x] Test copy and production at fe3ac49 (2026-10-12): the migration applied on both; production by the owner with `!`. The 3 agents read "Osama Claude Agent", "Faisal Claude Agent" and "Tarek Claude Agent". Record: proof.md, "Agent names and Remove for a turned-off person"
- [ ] Not run: `test:db`, `test:it` (Docker was off; the migration ran on pglite only), the prototype smoke, the deploy suite. `users.remove` is not tried on the live site
- [ ] The name of an agent does not follow a later change of the first name of its person: a person who renames themselves renames the agent by hand (Edit)

## 2026-10-12: the MCP server names its release (branch `rb/mcp-version`)
After the message tools went live, the claude.ai connector of the owner kept the old 41 tools, also after a remove and a new add. A direct client of the test copy (`agents.spec.ts` with `MADAR_E2E_AFTER_G=1`) got `chats.openDirect`, `chats.list` and `chats.send`, so the server was right.

- [x] The serverInfo version was a fixed "1.0.0". It is now "1.0.<number of commits>" (`releaseVersion`, `vite.server.config.ts`), so each release names a new server version and a client that keys its tool list on it loads the new one. `check-bundles.ts server` fails a bundle with the placeholder. `server/discover` keeps its answer 5 minutes, not 1 hour
- [x] `agents.spec.ts` checks the three chat tools in the tool list of the test copy, and that `chats.messages` is not in it
- [x] Gates: typecheck; `npm test` 4,629 passed and 6 skipped (456 files); `build:server` with its bundle check (the mcp bundle says `version: "1.0.1157"`). Not run: `test:db`, `test:it` (Docker off), the prototype smoke
- [x] Test copy and production at 6c78a25 (2026-10-12): the live `mcp` function says version `1.0.1158`. Record: proof.md, "The MCP server names its release"
- [x] After the deploy the claude.ai connector listed "Open a direct chat" and "Send a message". A Claude Code session keeps the tool names it saw at its start, so the message went out through a direct connection (`claude mcp add --transport http madar-direct https://madar.vado.sa/mcp`, local scope of the `deploy-test` folder). Remove that entry when it is not needed: `claude mcp remove madar-direct`

## 2026-10-12: team report fbk_003 and the Tracker type Government (branch `rb/code-anyway`, worktree `~/dev/madar-rb/code-anyway`)
Faisal (fbk_003): "allow a user to override project code verifying after a warning message". The owner: "the main thing is allow the user to use their code if not match the main code". The owner also asked to call the Tracker type "Balady" "Government", because the office deals with more government bodies than Balady.

- [x] A code typed by hand (the new-project form, the Admin's correction) that does not match the office pattern, or that has the month and series of another contract, shows a warning and the tick "Use this code anyway". The tick lets the code go; a change of the code clears it. Server: reasons `code_format` and `code_taken` unless `codeAnyway: true` (`projects.create`, `projects.update`). A new or changed code is visible text of 1 to 60 characters (no hidden direction marks, other spaces or invisible characters, after two background security notes); the record also keeps every code of the office pattern saved before
- [x] MCP: `codeAnyway` in the `projects.update` schema, `TOOL_DOCS` and the "Project codes" line of `INSTRUCTIONS` (only the person decides to keep a code)
- [x] The Tracker type `balady` shows as Government ("جهة حكومية"), also in the move-back tick. The stored value stays `balady`. `TOOL_DOCS` of `tracker.log` and `tracker.list` say what it means
- [x] The quick-log type tiles keep at least the width of their word, so "Government" stays in its tile at 390 px (found by the phone screenshots)
- [x] Gates: typecheck; `npm test` 4,650 passed and 6 skipped (457 files; one record test pinned the old rule and moved to the new one); `npm run build`, `build:server`, `build:remote -- test`; `test:mcp` 147 passed. Not run: `test:db`, `test:it` and the MCP conformance runner (Docker off), the prototype smoke. Screenshots: 390 px in EN and AR, light and dark (new project, Edit project, Tracker)
- [x] Test copy and production at 23342eb (2026-10-12). The Pages step of production failed twice at Cloudflare ("Unknown internal error") and went through on a third run of `pages.sh production`. fbk_003 is done, so Faisal got the done notice. Record: proof.md

## 2026-10-12: two small phone fixes (branch `rb/small-fixes`)
- [x] Tracker quick log: on a phone the hint is the example only ("e.g. Client sent the survey"), so it fits the field. An empty field follows the side of the page; with text, `dir="auto"` decides. Before, an empty field with `dir="auto"` was left to right, and the Arabic hint lost its first word
- [x] Requests and bugs: on a phone, Mark done (or Open again) sits on its own line under the message, so the message keeps the width of the row
- [x] Gates, with Docker on (they also cover the three earlier releases of the day): typecheck; `npm test` 4,654 passed and 6 skipped (457 files); the three builds; `test:db` 1,139 passed and 25 skipped (81 files); `test:it` 261 of 261; `test:mcp` 147 passed, conformance 5 of 32 with 27 known gaps; the prototype smoke 87 of 87 after one fix. Screenshots at 390 px: Arabic light and English dark, both screens
- [x] The smoke test "Member daily work" waited for the Home panel "Today". On a day with nothing due today or past due, that panel is "Coming up" (owner, 2026-10-07), so the test failed on Monday 2026-10-12. It now takes either name
- [x] The owner removed the local `madar-direct` MCP entry (`claude mcp remove madar-direct`), so the claude.ai Madar connector works again in this project
- [x] Test copy and production at 817355d (2026-10-12, the owner ran production; every step went through at once). Record: proof.md

## 2026-10-16: files to R2 and the server to Cloudflare Workers (owner; branch `rb/cloudflare`, worktree `~/dev/madar-rb/cloudflare`)
Owner decision (2026-10-16): switch both moves of plan 2b. Files go from Supabase Storage to R2. The server goes from
Supabase Edge Functions to one Worker per copy (Workers Paid, $5 a month), first on the test copy. The Worker stays
only if it measures faster than the Supabase functions (the forwarder rule). The database, Auth and Realtime stay on
Supabase. Production follows in the same run after the test copy passes. The Supabase functions stay deployed as the way back.
- [x] Owner: turn on R2 in the Cloudflare dashboard (card, free plan)
- [x] Workers plan: Free (owner, 2026-10-16: "no money, free"). The account is on Free (a call stopped at 50 fetches). The
  documents say 10 ms of CPU; in practice calls of 26 and 150 ms passed, 500 ms failed 1 time in 10 (proof.md). Madar: median
  14 ms, heaviest 137 ms. The Free day limits stay: 100,000 requests and 100,000 Hyperdrive queries for the whole account.
- [x] The deploy suite on the Worker (Free): 79 of 168 failed. After 7 minutes of grace, Free stopped each call at 10 ms of CPU
  (471 of 1,712 calls gave 503), and a median Madar call needs 37 ms. So both copies keep the server on the Supabase functions
  (`config/server-host.json` test back to `supabase`). The Worker stays deployed and unused. The files stay on R2 (proof.md,
  "The deploy suite on Workers Free"). The one other failure was a test fault ("Today" or "Coming up"), now fixed.
- [ ] Only if a copy goes to the Worker again (Workers Paid): usage meter on Free: count the calls of a UTC day against the day limits (requests, about 15 queries for each call), not
  10 million a month.
- [ ] Heavy test runs (the deploy suite) after office hours: the test copy shares the day limits with production.
- [ ] Owner decision (2026-10-16): no Supabase at all, everything on Cloudflare Free (reason: one vendor, one bill). After this
  run: a plan for the database (Postgres to SQLite in a Durable Object or D1), sign-in (no ready-made Cloudflare service), live
  updates (Durable Objects), the 15-minute jobs (Cron Triggers) and the backups, with its time, for the owner's OK.
  Plan written (`docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md`). The Free CPU limit of the suite run puts
  it at risk: wave 0 must first show that the office object gets more than 10 ms of CPU on Free.
- [x] Map of every change (three readers)
- [x] Hyperdrive probe on madar-test: go on the session pooler 5432, no go on 6543 (proof.md, commit 0457809)
- [x] Live updates on madar-test: no realtime.messages day table for 2026-10-16 at 14:39 UTC. Not a defect: a WebSocket
  client makes the day table (platform-facts.md 2, realtime.send), and no screen of the test copy was open today.
- [ ] Build on `rb/cloudflare`: deploy steps for R2 and the Worker, the screens address, the jobs trigger, the MCP forwarder, guides
- [ ] Cloud setup: two EU buckets and their CORS (both buckets made; test CORS set), the Supabase CA, two Hyperdrive setups (caching off), two Workers (test done)
- [x] Owner: one R2 API token for each bucket, into the secrets files (both checked: put, get, remove, and 403 on the other bucket)
- [x] Test copy: copy the files, switch, deploy suite, measure the Worker against the Supabase functions (the Worker was faster, but Free stops it under load)
- [x] Production: files to R2 (the server stays on the Supabase functions). Production at ae63498 (2026-10-16, the owner ran it):
  7 of 7 files on R2, health `"fileStore":"r2"`. Record: proof.md "Files to R2 on production"
- [x] Wave 0 of the exit plan, the CPU question: a Durable Object on Free passed 2,696 of 2,696 calls of 16 to 135 ms in 45 minutes,
  while a plain Worker failed 1,309 of 1,797 (proof.md "Wave 0 of the Supabase exit")
- [x] The rest of wave 0 (owner, 2026-10-16: "yes go ahead"): rows on one year of data, sockets, bcrypt and ES256 (proof.md
  "Wave 0, the rest"). Sockets and crypto fit Free; rows read is the tight limit (the chat badge is about 75% of it)
- [x] Owner: go for the build of the exit plan (2026-10-17: "go based on ur recommendation"), with the six changes of wave 0
  from day one and the switch soon while production is small
- [x] The throwaway probe Workers `madar-do-probe`, `madar-cpu-probe` and `madar-socket-probe` are deleted (owner OK, 2026-10-17)
- [x] The build plan: `docs/superpowers/plans/2026-10-17-madar-cloudflare-exit-plan.md` (97bbf1c): the roadmap of 6 waves and
  Track R, wave 1 in 19 tasks
- [x] Exit wave 1, Task 1: the transaction facts of the office object on local workerd. Option B holds: a failed transaction
  keeps no row, and no request runs inside an open transaction (proof.md "Wave 1: the transaction facts", 9ec27c4)
- [x] Exit wave 1, Tasks 2 to 19: the SQLite path beside Postgres (`rb/cloudflare`): test:lite and test:office green, the rows
  pins on one year of data, the merge gate green (proof.md "Wave 1 of the Supabase exit: done")
- [x] The plans of exit waves 2 and 3 (`docs/superpowers/plans/2026-10-17-madar-exit-wave2-signin-plan.md`, 22 tasks;
  `docs/superpowers/plans/2026-10-17-madar-exit-wave3-live-plan.md`, 19 tasks; about 7 builder days each). The main session
  settled the schema rule (Merge notes, item 1 of both) and accepted the four design choices of wave 3
- [x] Exit wave 2 build, Blocks A to D (`~/dev/madar-rb/exit-signin`, `rb/exit-signin`): 22 tasks, the gate green once
  (proof.md "Wave 2 of the Supabase exit"); merged to main
- [x] Exit wave 3 build, Blocks A to D (`~/dev/madar-rb/exit-live`, `rb/exit-live`): the gate green on 2026-10-17 (proof.md
  "Wave 3 of the Supabase exit"). The merge, the prototype smoke and the Cron Trigger count wait for the main session
- [x] The second merge of waves 2 and 3 (`rb/exit-live`, 2026-10-17): the Merge notes of both plans, item 8 of the wave 3 plan
  (the sign-in parts on the office object, MCP on the office path included), and the security fix of the office flag of a batch
  (proof.md "The merge of exit waves 2 and 3"). Item 13 of the wave 2 plan (the sign-in specs on a local `wrangler dev`, the
  screenshots of the Madar sign-in screens) moved to wave 4: it needs the seed of wave 4
- [x] Before the first `all.sh test` after the wave 3 merge: count the Cron Triggers of the account (Free allows 5). Counted
  2026-10-17, read-only through the API (`GET /accounts/<id>/workers/scripts/<name>/schedules`): 5 Workers, 0 Cron Triggers. The
  test Worker takes 1 at its next deploy, and production takes 1 at the switch (wave 6): 2 of 5
- [ ] Wave 5: measure the bill of the callback from the office object into the Worker (wave 3 design choice 1), and one
  deployed Cron run with many pushes against the 10 ms CPU of Free
- [x] Wave 2: `users.invites`, `users.resendInvite`, `agents.list` and `agents.remove` on SQLite (`LATER_CALLS` in
  `server/test/liteHarness.ts`: the invite texts of `server/calls/people.ts` and `server/auth/invite.ts`, the agent links of
  `server/calls/agents.ts`)
- [x] Wave 2: the effect kinds `auth.invite`, `auth.ban`, `auth.unban`, `auth.email`, `auth.emailNotice` and `agents.revokeAll`
  on SQLite (`LATER_KINDS`), and the sign-in link of `server/data/officeCache.ts`
- [x] Wave 3: `usage.get` and `usage.retryEffect` on SQLite (the meters of `server/usage/meters.ts`, the outbox job), and the
  mail quota of `server/mail/quota.ts` (`rb/exit-live`, Tasks 12 and 14)
- [x] Wave 3: the mail and push producers on SQLite, with the notice ids of the Diff (`SaveResult.noticeIds`, `rb/exit-live`, Task 2)
- [x] Wave 3: the day meter counts the rows of a rolled-back write too (`server/office/meter.ts`, `rb/exit-live`, Task 4). Whether
  the bill counts them stays unknown: the wave 5 item (c) below compares the meter with the Cloudflare day numbers
- [x] Exit wave 4: `config/server-host.json` value `office` sets `MADAR_DATA = "office"` in the env of the copy and
      `VITE_MADAR_LIVE=socket` in its screens build (`scripts/build-remote.ts`, `remotePublicEnv`). Done in `rb/exit-ops`: Task 2
      (the word gives `VITE_MADAR_AUTH=madar` and `VITE_MADAR_LIVE=socket`) and Task 19 (`worker.sh` deploys with
      `--var MADAR_DATA:office`, `all.sh` runs only the Worker steps for an office copy).
- [x] Exit wave 2 or 4: MCP on the office path: a kind of `OfficeWho` for an agent, its branch in `principalOfWho`, and `/mcp` on
      `officeRoutes` (done in the merge of waves 2 and 3: the object runs the MCP app, `Office.mcp`).
- [ ] Exit wave 5: show the four Free day meters on Admin, Usage (contract field of `usage.get`, words, screenshots EN and AR,
      light and dark, 390 px). Wave 3 sends them only in the 80% mail.
- [ ] Exit wave 5, on the deployed test copy: (a) the bill of a batch with mail (Worker requests and object requests; the network
      callbacks should add none); (b) the CPU of a Cron run and of a batch with effects (`wrangler tail`, 10 ms on Free);
      (c) the office meter against the Cloudflare day numbers (GraphQL, `scripts/proof/do-socket/gql.mjs`); (d) a socket through the
      Pages forwarder and the service binding (a 101 answer); (e) the transaction race of wave 1 on the deployed object.
- [ ] Exit wave 5: the deploy suite on the office path (needs the sign-in rows of wave 2 and the seed of wave 4). The code is
      done in exit wave 4 (`rb/exit-ops` Tasks 16 and 17: `scripts/office/seed.ts`, the peek forms of `tests/e2e-deploy/office.ts`);
      the run on the test copy is wave 5 R7.
- [ ] Exit wave 5: if a socket often fails to open after a hibernation (the ticket lives in memory), move the ticket to a short
      signed form with a Worker secret.
- [ ] Proposal, not built: the hourly Cron run reads about 14,700 rows on the year office, 13,200 of them in the file size sum
      (`FILES_BYTES_LITE`: one row for each file and one for each version). A stored total in `usage_month`, kept up to date by
      the save of `files`, would cut it to 1 row. Today's cost is about 7% of the Free rows read of a day (proof.md, wave 3)
- [x] Wave 3: connect `SigninOffice` to the object method for one batch (body `{ signin, input }`), pass `ownApiRoutes` and
  `mountOAuth` in the hosts, `liteAgentOf` in the object, `liteAuthAdmin` as `deps.authAdmin` of the object, and run
  `cleanupSignin` once a day (done in the merge of waves 2 and 3: `Office.signin`, `server/entries/officeSignin.ts`, the step
  `signin` of `server/office/jobs.ts`)
- [x] Exit wave 4 (moved from the merge of waves 2 and 3, it needs the seed of wave 4): the deploy-suite sign-in specs
  (`account.spec.ts`, `signin.spec.ts`, `agents.spec.ts`) on a local `wrangler dev` with `VITE_MADAR_AUTH=madar`, and the
  screenshots of sign-in, forgot, welcome, reset and consent on the Madar port (EN and AR, light and dark, 390 px). The stack is
  ready (`npm run dev:office`, `rb/exit-ops` Task 22: the own sign-in gave 200 and `/mcp` 401 on it); the Playwright run is
  the step of a delegated helper of the main session (plan Task 22, Step 6). Done 2026-10-17: all 37 pass after two fixes
  (the session key of the own sign-in, and the consent line of the Z7 risk); proof.md, wave 4 section
- [x] Main session, after the merge of waves 2 and 3: the prototype smoke (the merge builder runs no Playwright): 87 of 87, and
  again 87 of 87 at the wave 4 merge
- [ ] Exit wave 5: a copy with `MADAR_AUTH_PRIVATE_JWK` also needs `MCP_URL` in its Worker env (the issuer of the own tokens).
  Without it the browser token check throws, and each batch answers a hidden 500 (found by `npm run smoke:office`)
- [ ] Exit wave 5, on the deployed test copy: the CPU and the bill of one `/mcp` request in the office object (the MCP app is
  built for each request) and of a forgot or renew request (two object calls: `Office.mailRoute`, then `Office.mailWork`)
- [ ] Exit wave 6: `serverEnvFrom` and the reason key of MCP read the Supabase secret key (`SUPABASE_SECRET_KEYS` or
  `MADAR_SECRET_KEY`). After the switch, a Worker secret of Madar takes its place
- [x] Wave 4: the export runs `SIGNIN_EXPORT_SQL` with `BACKUP_DB_URL`; the import calls `importSigninRows`; the restore check
  copies `SIGNIN_TABLES`; `scripts/deploy/secrets.ts` names `MADAR_AUTH_PRIVATE_JWK` (a script makes the key and writes it
  straight to the Worker secret). Done in `rb/exit-ops`: Task 8 (the restore check takes every table, the sign-in tables too),
  Tasks 10 and 11 (`importSigninRows`, `SIGNIN_EXPORT_SQL` in `pgSource`), Task 19 (`KEPT_ON_WORKER` refuses the key in a
  secrets file, `scripts/office/auth-key.ts` writes it to the Worker)
- [x] Before wave 5 turns on `office-backup.yml` (found in exit wave 4, `rb/exit-ops` Task 9): the step "Age of the newest backup"
  of `db-backup.yml` reads the newest release of any name (`gh release list --limit 1`). With a nightly `madar-office-*` release in
  the same repository, a night with no database backup no longer fails that step. Proposal: select the `madar-db-` releases only,
  as `office-backup.yml` does for its copy, and change the pin of that step in `scripts/backup/workflows.test.ts` (done at the
  wave 4 merge: the step reads the `madar-db-` releases only, and the pin checks the filter)
- [x] The backup workflows read the time of a release from `createdAt`, which is the date of the commit of its tag (2026-10-05 for
  every backup). Found 2026-10-17: `db-backup.yml` failed every night from 2026-10-12 (a false "282 hours old"), and its remove
  step would have removed all 13 backups from the night of 2026-11-04 (a read-only dry run of the old filter with that cutoff
  picked 13 of 13; the new filter picks 1). Fixed: `publishedAt` in both age checks and both remove steps of `db-backup.yml`
  and `office-backup.yml`, and a test refuses `createdAt` (`.github/CLAUDE.md`)
- [x] Owner: GitHub refuses to start every CI job of byosamah/madar since 2026-10-17 13:08 UTC ("recent account payments have
  failed or your spending limit needs to be increased"). Cause (the owner's billing page, 2026-10-18): no payment failed; the
  2,000 free minutes of October ($12 of included use) are used up, and the account has no card. GitHub also refused the nightly
  database backup of 2026-10-18. Owner (2026-10-18): `ci.yml` and `ci-stack.yml` start only by hand from now on, and the database
  backup runs from the Mac until the minutes come back (`.github/CLAUDE.md`)
- [ ] The database backup from the Mac, each evening after 17:00 Riyadh until GitHub runs `db-backup.yml` again (end of October):
  `brew install postgresql@17` (owner OK, 2026-10-18), then `scripts/backup/dump.ts` and the upload to madar-backups as the
  workflow does. The newest backup before it: `madar-db-20261017-011632Z`. Done: 2026-10-18 `madar-db-20261018-143030Z`
  (41 tables, 1,508 rows; `scripts/backup/mac-backup.sh --check` of the repo copy passed after it); 2026-10-19
  `madar-db-20261019-143014Z` (42 tables with `sub_companies`, 2,247 rows; GitHub refused the run of 01:08 UTC again).
  GitHub's own run of 2026-10-20 01:44 UTC worked again (`madar-db-20261020-014535Z`). Owner (2026-10-20): every session runs
  `~/dev/madar-rb/mac-backup/scripts/backup/mac-backup.sh --if-due` on each owner message, until the end of October only; it skips
  while GitHub makes the backups (root `CLAUDE.md`, `scripts/backup/due.ts`)
- [x] Wave 5 R3: the test copy at b4eb2e6 (exit waves 1 to 4, the word still `supabase`), `all.sh test` by Claude after the owner's
  `npm install` (2026-10-17). The gate ran on the Mac (GitHub runs no CI): typecheck, `npm test` 5,393 passed. The test Worker has
  its empty office object and the Cron (1 of 5 in the account); the office routes answer 401 with no secret. Production did not
  change. Record: proof.md, "Test copy at b4eb2e6"
- [x] Wave 5 R2 (owner): `MADAR_OPS_SECRET` and `MADAR_EXPORT_SECRET` for the test copy (`scripts/office/new-secret.ts`), then the
  lead runs `auth-key.ts test`, `secrets.ts test` and the R3 export check with the secret. Done 2026-10-18
- [x] Wave 5 R4 and R5 (2026-10-18): the import of the test office (917 records, hash match, 20 s) and the switch of the test copy to
  its office object (f7f504a): health, office check and `/mcp` 401 from `office;colo=JED`. Speed: 136 to 140 ms on the office path,
  287 to 350 ms on the Supabase function. Record: proof.md, "Wave 5 on the test copy, R1 to R5, and the pause"
- [ ] PAUSED (owner, 2026-10-18): the Supabase exit stops after wave 5 R5 for an important feature of the team. The test copy is back
  on `supabase`; production never changed. Restart: the word `office` for test, `all.sh test`, a fresh office (`import.ts --mode
  replace` or the seed), then R5 step 4 and R6 to R14 of the wave 4 plan. Until then, every feature keeps `test:lite` and
  `test:office` green, so the restart stays cheap
- [ ] On the restart: `scripts/proof/server-time.sh` signs in with Supabase Auth, so its member step gets 401 on the office path.
  Give it a sign-in through the own `/api/auth` routes when the copy runs on its office object
- [x] Wave 5: `functions/.well-known/[[path]].ts` (one line, `proxyWellKnown`) and `VITE_MADAR_AUTH=madar` for the test copy
  (done in exit wave 4, `rb/exit-ops` Tasks 2 and 3: two narrow files, `functions/.well-known/oauth-authorization-server/[[path]].ts`
  and `functions/.well-known/openid-configuration/[[path]].ts`, which answer only for an office copy; the word office gives
  `VITE_MADAR_AUTH=madar`)
- [ ] Later, only if an AI app needs it: Client ID Metadata Documents (a fetch in the Worker, not in the object)
- [ ] Wave 5: run the transaction race of Task 1 (`scripts/proof/do-tx/`) again on the deployed object of the test copy. The
  probe is ready (`rb/exit-ops` Task 21: `wrangler.deployed.toml`, the `PROBE_SECRET` guard, `deployed.mjs`); its deploy and its
  delete need the owner's OK (wave 5 R8 (e))
- [ ] Proposal, not built: make `events_undoes` a partial index (`where undoes is not null`). Most events undo nothing, so each
  event would write 9 rows, not 10. First check with a rows pin that `undoLinks` and `notUndone` still use the index
- [x] Track R: the design note of the stored unread number, for the owner's OK before code (`rb/read-cost`). Owner OK, 2026-10-18
- [ ] Track R build (`~/dev/madar-rb/read-cost`, one builder, about 4 days). STOPPED with the pause (owner, 2026-10-18) after its rebase on main (no code yet); it starts again with the move. Its production release waits until after the team's
  week of real use (2026-10-18 to 2026-10-22): no production change before Friday 2026-10-23 unless the owner asks for a fix
- [x] Owner decisions of 2026-10-18: decision 5 is R2 alone (no B2 copy of the files; the restore check reads R2 with
  `--files-lag-days 0`), and decision 6 is form A (the test copy stays on the same account, with the day cap of 50%)
- [ ] When Track R merges: lower the badge pins (`chats.unreadCount`, `chats.list`) in `server/office/test/pins.ts` from the
  ported read (15,449 rows read, ceiling 16,994) to the measured value of the stored unread number plus 10%
- [ ] Wave 3: rows pins for the two reads that keep `events_target_id` and `events_story` (notifications.list with a gone
  target, the story read of events.undoStory). The year office has neither shape, so a pin needs a write or a gone target
  first (proof.md "Wave 1: the rows pins")
- [x] Exit wave 4 (`rb/exit-ops`): the office path whole (sign-in, OAuth, MCP in the object), the word office, the export, the
      nightly workflow (off), the restore check on node:sqlite, the import and its check, the reverse export, the test seed, the
      deploy suite on the office path, the day cap, the wrangler-only deploy, CI with no Docker (proof.md "Wave 4 of the Supabase exit")
- [ ] Exit wave 5: the runbook of Part 2 of `docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md` (R1 to R14)
- [ ] Exit wave 5 runbook: an import carries no agent links, agent approvals, OAuth rows or sessions (`scripts/office/source.ts`).
      After the import of the test copy, each person signs in again and each AI app connects again: tell the owner before R4
- [ ] Exit wave 5 runbook: the import, drop and reverse commands of the test copy need `MADAR_OPS_SECRET` and `MADAR_EXPORT_SECRET`
      in `secrets/test.env` (`new-secret.ts`, R2), and `secrets.ts test` gives both to the Worker on every host word (Task 19)
- [ ] When Track R merges (`unread_counts`): the import carries the stored unread numbers too (`ServerRows.unreadCounts` in
      `pgSource`, `exportSource` and `importFinish`), with a test that a badge after an import equals the badge before it
      (wave 4 plan, Merge note 3)
- [ ] Track R must also count group chats, and treat an archived chat as read: `chats.archive` marks the chat read, so no archived chat holds an unread number (fbk_011, UX audit 2026-10-19, INT-01)
- [ ] Exit wave 6: production takes the word office (lift `OFFICE_COPIES_OPEN`), its binding, migration and Cron, `new-secret.ts`
      and `auth-key.ts` for production, `secrets.ts --office` for production, `office-backup.yml` on production, the restore
      reminder text for office backups
- [ ] Owner decisions of later waves (spec section 7): the switch date, the Supabase delete date, the $5 safety valve (still open:
  no payment without a yes in words). Decided 2026-10-18: R2 alone (decision 5) and form A for the test copy (decision 6)
- [x] The walk and shell faults: the pooler client limit (200) filled under load, so requests failed at once (EMAXCONN). A
  pooler connection now closes after 1 s idle (ff963e1). The 4 walks, acceptance, settings and shell: 38 passed, 0 failed
  (proof.md "The pooler client limit under load")
- [x] Production at ff963e1 (2026-10-16 late, the owner ran it): checks pass, the live bundle matches `9e1127b4`, 0 EMAXCONN after it
- [x] The weekly file backup: its source is now R2 (both copies). Owner decision 5 (2026-10-18): R2 alone, so `files-backup.yml`
  stays paused, with no Backblaze B2 account; the restore check reads R2 (`--files-lag-days 0`)
- [ ] Production: copy the files twice, switch, checks, release record

## 2026-10-18: the 13 team requests (plan `docs/superpowers/plans/2026-10-18-madar-team-requests-plan.md`)

Builders: Haiku 5.5. Checkers: Sonnet 5.5 (owner, 2026-10-18, for these builds). No production change before Friday 2026-10-23.

- [x] Wave 1, track `quick` (built by Haiku, checked by Sonnet, merged to main 2026-10-18)
  - [x] Task 1: 3 pictures then "+N" in the project list (fbk_013)
  - [x] Task 2: no browser memory in the project form (fbk_010)
  - [x] Task 3: see-through photos on the glow (fbk_019)
  - [x] Task 4: Madar calendar on computers (fbk_009)
  - [x] Task 5: What's new page (fbk_018)
- [x] Wave 1, track `inbox` (merged to main 2026-10-18)
  - [x] Task 6: archive a chat (fbk_012)
- [x] Wave 1 gates on the Mac (2026-10-18): typecheck, npm test 5,480, builds, test:lite 1,162, test:office 37, test:db 1,162, test:it 279, test:mcp 176, prototype smoke 87 of 87 (one spec failed once under load and passed alone)
- [x] Wave 2, track `chats` (Tasks 7, 8): group chats, and agents read chats and list what waits for a reply (fbk_011)
- [x] Wave 2, track `subcompanies` (Tasks 9, 10): sub-companies with a logo, one for each project, an MCP filter (fbk_007)
- [x] Wave 2, track `map` (Tasks 11 to 13, 12b): the pin in the project settings, the Dashboard Map tab, the place search with OpenStreetMap (fbk_017). Task 11 steps 3 to 5 (the Saudi map file on R2) wait for the owner OK, see "Open for the owner" below
- [x] Wave 2, track `space` (Task 14): Open space, the read-only mind map (fbk_015)
- [x] Wave 3, track `templates` (Tasks 15 to 24): project templates, drag, copy, timeline, waits, import, link, update (fbk_008)
- [x] Wave 4, track `roles` (Tasks 25 to 29): custom roles with rights (fbk_014), the office report by MCP (fbk_016)
- [x] Waves 2 to 4 joined on `rb/wave24` (2026-10-18): the six tracks, 39 builder commits, the merge fixes, the What's new entries 5 to 12, and the fixes from the screenshots (Open space click, first view and Open all view, the check mark in the group picker, the sub-company badge on the Open space card and the map pin card, the sub-company in the office report)
- [x] Waves 2 to 4 gates on the Mac (2026-10-18): typecheck, npm test 6,043 (581 files; 4 deploy-script tests timed out under load and passed alone), builds, test:lite 1,439, test:office 37, test:db 1,439, test:it 283, test:mcp 192 and the conformance run (5 of 32, as expected), prototype smoke 87 of 87 (one spec clicked the new Make a group button: the test is fixed)
- [x] Waves 2 to 4 on the test copy (2026-10-18, 7183347): the year-report time (median 0.70 s from the Mac, about 40 ms over an empty call) and the deploy suite (165 passed, 3 skipped by design, 0 failed after two reruns of a stale chat test and a pooler sign-in timeout) are in proof.md
- [ ] Waves 1 to 4 release: production from Friday 2026-10-23 by the owner (`! echo production | scripts/deploy/all.sh production` from deploy-test), then the owner says the release is live (then `feedback.setStatus` done for fbk_013, fbk_010, fbk_019, fbk_009, fbk_018, fbk_012, fbk_011, fbk_007, fbk_015, fbk_008, fbk_014, fbk_016; fbk_017 after the free map is checked on the test copy)
- [x] UX audit of the 13 requests (owner, 2026-10-19: "fix everything, pick the best option, keep it consistent"): 4 auditors found 91 findings (scratchpad `ux-audit/*/findings.json`); 4 builders fixed them on `rb/ux-chats`, `rb/ux-projects` (map), `rb/ux-integration` (sub-companies, Open space) and `rb/ux-admin` (templates, roles), joined on `rb/ux-all`. Each design choice took the auditor's recommended option, except: the name "Open space" stays; the map uses free OpenFreeMap tiles in a Madar style (owner, 2026-10-19: zero cost, no account, no key, no bill), and the own R2 file (Task 11 steps 3 to 5) stays only as a later option; template updates stay Admin only (ADM-03 over INT-04).
- [x] The UX fixes on the test copy (2026-10-19, d9b320a): gates green, deploy suite 164 passed and 1 walk timeout that passed on a rerun, the free map draws with pins and no CSP violation. Record: proof.md
- [x] The owner questions of 2026-10-18 are closed by the audit: one tap for a direct chat and a "New group" button, any person can leave a group, a group mention names the group, the template side panel and the timeline give the same stage start (INT-12), the map pin is the project tile with a status shape, the place search keeps the Nominatim policy (no referrer, 1 s between searches), a person added late reads the whole group history, and a quiet line in the chat tells the members who joined (INT-15), the template timeline is the editor (ADM-06).
- [x] Team B (2026-10-19, branch `rb/team-b`): fbk_023 an AI agent sets the dates of one stage with `stages.setDates` (the leader and the Admin; no reason is needed, unlike a task date; 45 tools, 49 for an Admin). fbk_021 the morning email lists the open tasks in three groups with the task title, the project key and the due day (at most 8 lines, "and N more tasks"; owner, 2026-10-19). The merge lead runs `test:it` (new summary statement) and sets the tool count pins if another track adds a tool.

## 2026-10-23: five team requests (branch `rb/team-fixes`, What's new 2026-10-23-26 to 29)

- [x] fbk_032 (Faisal): paste a picture or a file into a chat box (the Inbox box and the comment box of the task panel); same list, limits and upload target as the attach button. At the join with main (2026-10-20) the chat batch (design item 14) won: both boxes take a paste of only pictures (`pastedPictures`), and text stays text
- [x] fbk_030 (Osama): drop files on the open conversation, one quiet overlay "Drop to attach", and a file dropped anywhere else never opens in the tab. At the join with main (2026-10-20) the chat batch (design item 14, `ChatDropArea`) won; the join keeps the drop on the comments of the task panel (with `ChatDropArea`) and the page guard `useBlockFileDrop`
- [x] fbk_028 (Faisal), bug: (a) `public/sw.js` shows no line while a window of Madar is visible and has the focus, in Chromium only (WebKit revokes a subscription that gets a push with no notice, so Safari, iPhone browsers, Firefox and unknown engines always show it); at the join with main (2026-10-20) the server wait of the chat batch (design item 20: 10 s, then no push for a person who read the chat) comes in addition. (b) "Waits for your reply" is gone; "Mark as unread" (`chats.markUnread`, MCP deny list) is in the row menu and in the menu of the open chat
- [x] fbk_029 (Osama): a frame step (drag, zoom, round previews, Save) for the profile picture, one shared `PictureFrame` with the sub-company logo
- [x] fbk_031 (Faisal), bug: a Stage field for every task in the template editor; the move keeps the days of a saved task, and a task that Add task just made goes where Add task would put it in the new stage
- [x] Release: production at 5a98255 (2026-10-20, the owner ran it; record: proof.md). fbk_028, fbk_029 and fbk_031 done at 10:38 after a check of production (fbk_030 and fbk_032 went live with the chat batch and are done, 2026-10-20)
- [ ] Open: the update of linked projects (`syncDiff`) has no kind for a task that moved to another stage; `chats.waiting` stays in the contract and on the MCP allow list but no screen reads it
- [x] `server/it/markUnread.it.test.ts` ran in the join gate (2026-10-19, test:it 318 passed after the fix of 2 Google tests)

## Meetings (fbk_022, plan `docs/superpowers/plans/2026-10-19-madar-meetings-plan.md`)

- [x] Wave 1 (Tasks 1 to 6): the meetings, private meetings with no project, Home and the project tab; on main at 5bc54585, no "Minutes by" (owner, 2026-10-19: any attendee writes the minutes); the privacy page `/privacy` for Google (5e1e537)
- [x] Wave 1 release: production at 5350647 (2026-10-20, the owner ran it, with the chat batch). Record: proof.md
- [x] Wave 2, track minutes (`rb/meetings-minutes`): the 15-minute job settles an ended meeting and makes its Tracker line; any attendee writes the minutes; files of a meeting with no project stay with its people; What's new 2026-10-23-52 (24 on its branch; the chat batch took 24 and 25 first)
- [x] Wave 2, track gcal (`rb/meetings-gcal`): one-way Google Calendar connect in Settings (scope `calendar.app.created`, only the title, the time and the place); the callback passes the code to the signed-in screen, which calls `google.connect`; What's new 2026-10-23-53 (25 on its branch)
- [x] Join on `rb/meetings-join` with the five team requests (2026-10-19) and two security fixes: the organizer is the author of the Tracker line of a meeting, and only the leader or the Admin deletes it; `users.remove` sets the Google row of the person to revoking in its own transaction, so the cleanup deletes it when Google never answers
- [x] Join gates (2026-10-19): typecheck, npm test 7,263 (1 deploy-script test timed out under load, 53 of 53 alone), test:lite 1,773, test:office 38, builds, test:db 1,773, test:it 318 (2 new Google tests fixed: the local runCall runs gcal.revoke at once; the cleanup test has the Google count), test:mcp 240 and conformance 5 of 32 as expected, prototype smoke 87 of 87
- [x] The join merged with main (the chat batch, `ced1a0a4`) on 2026-10-20, in `rb/meetings-join`: lite schema 6 search, 7 meetings settle, 8 Google; What's new 52 and 53 for the minutes and Google; the chat drop and paste of main; Mark as unread with the read rules of item 5
- [x] Merged main again (`5350647`, the chat on a phone) and the gates after both merges (2026-10-20): typecheck, npm test 7,693 (1 deploy-script test timed out under load, 53 of 53 alone), test:lite 1,941, test:office 38, builds (api bundle 748,238 of 760,000), test:db 1,941, test:it 327, test:mcp 252 and conformance 5 of 32 as expected, prototype smoke 87 of 87, 390 px shots of the chat menus and the task comments in English and Arabic, light and dark
- [x] A new connect uses the same Madar calendar (owner test 2026-10-20 found a second calendar after Disconnect and Connect)
- [x] Join to main and the test copy after the wave 1 release (be348234), the 3 Google secrets in both copies, `all.sh test` (2026-10-20). The deploy suite did not run before the wave 2 and wave 3 releases: the owner chose speed (2026-10-20)
- [x] Task 14.5 (2026-10-20, the owner's own account on the test copy): connect, a new meeting and each time change reach Google in about 1 s; Disconnect works; Disconnect and Connect made a second calendar, fixed by the reuse (the line above), and the owner test after the fix kept one calendar
- [x] Wave 2 release: production at 5a98255 (2026-10-20, the owner ran it, with the Google calendar reuse). Record: proof.md. fbk_022 stays open until wave 3 is live
- [x] Wave 3, track series (`rb/meetings-series`): `meetings.create` takes `repeat` (every day Sunday to Thursday, every week, every 2 weeks, with a last day) and makes the first 8 meetings; `meetings.update` and `meetings.cancel` take a `scope` ("This meeting" or "This and later meetings"); `meetings.extend` keeps a series 8 meetings ahead (the 15-minute job step and the prototype timer; no new migration, no new SQLite step); Repeat and Until under "More", the question sheet `ScopeSheet`, the line "Repeats every week" on the meeting sheet; leak tests of a private series; Google Calendar syncs every meeting of a series; What's new 2026-10-23-54
- [x] Wave 3 release: production at 9a8aa6a6 (2026-10-20, run by Claude on the owner's word "once u finish merge to main and deploy"), with the security fix of `meetings.extend` and the heavy test lock. fbk_022 done. Record: proof.md
- [x] Production at 55cae0c5 (2026-10-20): guide lines only, after `all.sh test`. Record: proof.md

## 2026-10-19: a better chat, with lessons from Campfire (branch `rb/chat-campfire`, worktree `~/dev/madar-rb/chat-campfire`)
Design `docs/superpowers/specs/2026-10-19-madar-chat-campfire-design.md` (owner approved 2026-10-19), plan
`docs/superpowers/plans/2026-10-19-madar-chat-campfire-plan.md`. Opus plans and joins, Sonnet 5.5 builds (owner, 2026-10-19). No
separate checker. No production change before Friday 2026-10-23. Answers fbk_028 (both parts) and fbk_030.

- [x] Study of Campfire against the Madar chat, the owner's 16 choices and 6 rule answers, the mockup, the design, the builder check
- [x] The plan: 52 tasks in 4 tracks plus the base (msg B1 to B17, read A1 to A12, find D1 to D13, notify E1 to E10)
- [x] Wave 1: the base, B1 to B7 (one builder on `rb/chat-campfire`)
- [x] Wave 2: track read A1 to A12 (`rb/chat-read`)
- [x] Wave 2: track msg B8 to B14, B17 (`rb/chat-msg`)
- [x] Wave 2: track find D1 to D12 (`rb/chat-find`)
- [x] Wave 2: track notify E1 to E10 (`rb/chat-notify`)
- [x] Join: read, msg, find, notify into `rb/chat-campfire` (2026-10-19; one scroll fix for the saved copy of a sent message, the search reread capped at 3 after the security review, the count pins at 138 shared calls)
- [x] Wave 3: B15, B16, D13 (one builder on `rb/chat-campfire`)
- [x] Gate (2026-10-19, after the join with main and meetings): typecheck, npm test 7,281, builds, test:lite 1,840, test:office 37, test:db 1,840, test:it 305, test:mcp 242 and conformance 5 of 32, prototype smoke 87 of 87, 32 phone shots and the checks in Chrome. Record: proof.md, "Chat batch: the merge gate"
- [x] Main and the test copy (`all.sh test`, 924eb2c), then the deploy suite on the test copy (2026-10-20): 161 passed, 0 failed, 3 skipped by design, the walk in 4 variants. Record: proof.md, "Chat batch: the test copy and the deploy suite"
- [x] fbk_028 part 2 follows the owner decision of 2026-10-20 (the line is gone from the screens; Mark as unread): it wins over item 22 at the join with `rb/meetings-join`, and the waits rule of item 22 stays in the API for `chats.waiting` and the agents
- [x] Release: production at 5350647 (2026-10-20, the owner ran it; the second run went through after a 500 of the Supabase settings step). fbk_030 and fbk_032 done; fbk_028 waits for the meetings join (part 2, Mark as unread, owner 2026-10-20). Record: proof.md
- [x] Phone fixes (owner, 2026-10-20: "fix them"): a task thread title takes up to two lines under 640 px, and the task picture shows only from 640 px; the phone box hint is short and keeps the @ tip ("Use @ to mention." / «اكتب @ لذكر أحد.»), one line at 360 px and 390 px, because a project chat pushes only the people that a message names. What's new: one line on the task title (item 24), and "To reach a person, type @ and pick the name." (item 50). Record: proof.md, "Chat batch: the phone fixes"
- [x] The reaction pills on a phone (owner, 2026-10-20: "fix it"): no change was necessary. A pill is 28 px high, and its press area is 44 x 44 px. Record: proof.md, "Chat batch: the phone fixes"
- [x] The phone tab bar (owner, 2026-10-20: "fix it", icons only, the floating pill chosen): each 24 px icon in the centre of a 48 px tab, the open tab a round pill, the bar 16 px from the sides and the bottom, the Inbox count on its icon. What's new 2026-10-23-31. Gates: npm test (16 files timed out under load 137 and passed alone), prototype smoke 87 of 87, shots EN/AR, light/dark, 390 px. Production at 5a98255
- [x] Cleanup (owner, 2026-10-20: "do only 6"): the raw direction marks in `GroupSheets.tsx` and `ReasonLine.tsx` are escapes now, and `check-rtl.ts` stops the build on a raw mark in `src`. People see no change, so What's new has no line for it
- [ ] Proposed for later (not approved): the other items of "Not in this batch" in the design

## 2026-10-20: the Arabic audit in Thmanyah style (branch `rb/arabic`, owner request)
- [x] Audit with a lint of the Thmanyah rules over all 2,729 Arabic strings (28 word files). Before: 105 strings with «تم» or «يتم», 241 labels that use a noun where a verb fits, 34 stiff phrases, 11 sentences over 14 words. After: 0, 28 (names of things and past-tense verbs, all fine), 0, 0
- [x] Rewrite: 571 strings changed in the word files only (keys unchanged). Buttons are imperative verbs, confirmations are short passive verbs, switches start with «عندما». One word for one thing: «مدير النظام», «لوحة المعلومات», «عبء العمل», «خيارات», «باسم». Rules are in `src/i18n/CLAUDE.md`
- [x] Real mistakes found and fixed: «لوحة المتابعة» and «ضغط العمل» in What's new (the screens say «لوحة المعلومات» and «عبء العمل»), the picture formats missing from a photo error, an Eastern digit in the screenshot hint, five wrong tanween marks, «إجراء» for a meeting task, «أحدث» for "later"
- [x] Merged into main and released: production at 15a9815 (2026-10-20, the owner ran it). Record: proof.md. The owner may still read the before/after page and name any string to revert
- [x] What's new line 2026-10-23-32 for the new Arabic wording

## 2026-10-20: team report fbk_033, the Google Calendar connect (branch `rb/fbk-033`, worktree `~/dev/madar-rb/fbk-033`)
- [x] Cause: on production, 3 of the 4 connects between 12:05 and 12:08 Riyadh failed with `google_unreachable` after 3.5 to 3.7 s, and the one that worked ran 3.3 s (function logs). A Google step of the connect needs about 3 s, and the limit of 3 s cut it. Faisal has no remembered calendar, so the reuse step was not the cause
- [x] Fix: the Google calls of `google.connect` share a budget of 15 s, at most 10 s for one call (`GOOGLE_CONNECT_BUDGET_MS`, `GOOGLE_CONNECT_CALL_MS`), and a test keeps the budget with the revoke (18 s) under the 20 s of the screen. The test copy logs agree: the owner's connects there ran 3.2 and 3.4 s, just under the old limit, and the code swap (the first call) is the slow one. A failed connect logs its step, code and HTTP status. What's new 2026-10-23-55
- [x] Fix: the Ctrl+Z listener of the toasts takes a keydown with no key. Chrome sends one when it fills a saved password: this was the TypeError in Faisal's console
- [x] Gates, `all.sh test`, the owner's try on the test copy (13:10, a new Google account, ok), production at 86bcf255 (2026-10-20, the owner ran it). Record: proof.md. fbk_033 done (Faisal gets the notice)
- [ ] After the release: a connect that timed out at the calendar step may have left an empty calendar "Madar" in that Google account. If Faisal sees two, he deletes the empty one

## 2026-10-20: team reports fbk_034, fbk_035, fbk_036 and the connection line (branch `rb/team-fixes`, worktree `~/dev/madar-rb/team-fixes`)
- [x] fbk_036 (Ibrahim): the past-due sign of a task row wraps to a second line on a phone (`StatusSign wrap`), so it no longer runs under the chat button
- [x] fbk_035 (Abdelrahman): `tasks.help`, a team member joins a task as a helper with one tap or leaves it; the lead gets `helper_joined`. MCP allow, docs, sample
- [x] fbk_034 (Abdelrahman): the lead of a project task may delete it; the maker gets `task_deleted`. A lead who took the task themselves may not (security review, `leadTookTask`)
- [x] Owner, 2026-10-20: the connection line ("Live updates paused", "No connection") floats in the toast lane (`useStandingNotice`), never under the header
- [x] What's new 2026-10-23-56 to 59. Gates: npm test 7,935 (2 timeouts that pass alone; the api bundle bound is 800,000), builds, test:db 2,028, test:it 335, test:mcp 256, shots EN/AR light/dark 390 and 1440
- [x] Prototype smoke 87 of 87, ff main, `all.sh test`, production at ab4b0d0a (2026-10-20, the owner ran it). Record: proof.md. fbk_034 to fbk_036 done
- [x] The same wrap in the project Overview and the two meeting views (`OverviewTab`, `MeetingProjects`, `PeopleStrip`): production at adbc8e5f (2026-10-20)

## 2026-10-20: four owner fixes (branch `rb/owner-fixes`, What's new 2026-10-23-60 to 63)

- [x] Satellite view on every map: one small button, Esri World Imagery through our own route `/satellite` (Madar's own Esri key as
  the Pages secret `ESRI_KEY` on both copies, set 2026-10-20; the key ends 2027-10-19; the referrer lock did not save at Esri)
- [x] The sub-company badge sits in a gap cut out of the project tile: no ring, no pill
- [x] The chat list filter beside the search: All, Projects, To-dos, People (direct chats and groups)
- [x] "Tasks" holds To-dos and Meetings: 209 English texts say to-do; the switch and the project tab say «قائمة المهام»; MCP INSTRUCTIONS line
- [x] Gates: typecheck, npm test (7,943 passed; one deploy test timed out under load and passes alone), build, build:server
- [ ] Not run (owner chose speed): test:db, test:it, the deploy suite, the screenshots (the Chrome extension was off)
- [x] Test copy and production at 3cb6e144 (2026-10-20, the owner's "go production now"). Record: proof.md
- [ ] Screenshots EN/AR, light/dark, 390 px of the four changes (after the release; needs the Chrome extension or a signed-in browser)

## 2026-10-20: owner batch of 7 items (branch `rb/batch-join` from `rb/small-fixes`, `rb/role-rights`, `rb/admin-reach`)
Three Sonnet builders, one for each track, no separate checker. Owner rule for this batch: no test suite over 5 minutes; the owner
tests on the test copy by hand. What's new 2026-10-23-64 to 69.

- [x] Item 1: the chat filter keeps the last choice (`madar.chatKind` in the browser)
- [x] Item 2: the role rights in 7 sections with an All switch (17 rights, 10 new); a role keeps the Member basics and adds Admin parts. Defaults unchanged
- [x] Item 2, security fix: the review need of template tasks asks `task.review`, not `task.updateAny`; a right gives only its own power (`roleRightsPower.test.ts`)
- [x] Item 3 (fbk_037, Faisal): Edit and Cancel meeting in the footer of the meeting sheet; the "..." menu is gone
- [x] Item 4: the To-dos / Meetings switch sits in its own row, 30 px under the title, as the Projects Filter button (measured in Chrome)
- [x] Item 5: `meetings.delete` for a cancelled meeting (scope one or later, Undo). Series rule (owner): Madar never ends or restarts a repeat by itself; "Cancel this and later" sets `until` on every meeting of the series; `meetings.extend` adds by `until` only; a delete changes no repeat
- [x] Item 6: the Admin's "What reaches me" (Only my work, My work and the rest in the list, Everything); in Everything a copy of each office notice goes to the bell, with no push and no mail, never of a private chat
- [x] Item 7: the usage feature is gone (the Admin section, `usage.get`, `usage.retryEffect`, the meter, the 80% warning). The tables `usage_month` and `usage_warnings` stay unused (a drop needs the owner's OK). Nothing shows a failed outbox row now, only the log
- [x] Gates run: typecheck, the shared rule and server tests (217 files, 3,170 tests), the touched screen tests (154 files), `npm run build`, `npm run build:server`
- [ ] Not run (owner rule, over 5 minutes): the full `npm test`, `test:db`, `test:it`, `test:mcp`, the deploy suite, the prototype smoke
- [x] The owner chose to release without a hand test on the test copy
- [x] Production at a115a281 (2026-10-20, the owner said "deploy to production"; Claude ran it). fbk_037 done
- [ ] Later: the step of `.github/workflows/files-backup.yml` that writes the backup size to `usage_month` (nothing reads it now); remove it when file backups start again

## 2026-10-20: phone notifications for the Home Screen app (branch `rb/push-reach`, worktree `~/dev/madar-rb/push-reach`)
Owner: tasks and chat need notifications on the phone. These fixes serve the Home Screen app only until the store app comes (owner,
2026-10-20). What's new 2026-10-23-70.

- [x] Home: an iPhone or iPad in a browser tab shows the 3 steps to the Home Screen (before, it showed nothing and got no push)
- [x] Home: on Android, after the push ask, one button opens the install box of Chrome (`src/app/remote/install.ts`)
- [x] Server: every push with `Urgency: high` (Android sends it at once in sleep mode) and a TTL of 1 day (was 1 hour)
- [x] Gates: typecheck, `npm test` 8,149 passed (726 files), `npm run build`, `build:server`, `build:remote -- test`, `test:db`
  2,205 passed (27 skipped), `test:it` 325 passed (39 files)
- [x] Test copy at 68e209d; deploy suite 206 passed, 0 failed, 13 skipped by design; phone shots EN/AR, light/dark, 390 px
- [x] Found in the owner's hand test (2026-10-21): no iPhone ever got a push. Apple answers `400 BadWebPushTopic` to `Topic: madar`
  (function log "A push service refused a push", host web.push.apple.com; a direct probe gave the reason). Fix: no Topic for Apple
  (`topicFor`, `server/push/send.ts`). Probe with the fixed headers: 201. Gates: typecheck, the server project 2,745 passed;
  `test:db` and `test:it` not run again (one header in one file, no SQL)
- [x] Production at fe21858a (2026-10-21, the owner said "Release now"; Claude ran it). Record: proof.md
- [x] Owner choice (2026-10-21, "Like WhatsApp"): the push line shows the bell sentence, and for a chat or a comment the name and the
  first words of the message; a tap opens that chat or task. It replaces the rule of 2026-10-08 (one fixed line with no data). Built
  on branch `rb/push-text`: the device keys at `push.register` (`hasKeys` in the view, never the keys), the encryption (RFC 8291,
  `server/push/encrypt.ts`, the RFC vector in its test), the line as the person reads it (`server/push/line.ts`), the bell sentence
  shared (`src/lib/noticeSentence.ts`), the server words (`server/push/words.ts`), the worker (`public/sw.js`: the line, a safe link,
  a press opens it), the Settings hint, What's new 2026-10-23-71. No MCP change: the push calls stay on the deny list
- [x] Hand test on the test copy (owner's iPhone, 2026-10-21): three lines, each press opened its place. Production at e361e0cb
  (the owner said "deploy"; Claude ran it). Record: proof.md
- [x] Android: the owner tried the line on production and it worked (2026-10-21)
- [ ] Each phone gets the line after its first open of Madar after the release (the start check sends the keys)
- [ ] Found: What's new shows the day "23 October" for the entries of 2026-10-20 (ids `2026-10-23-*`). Ask the owner before a change:
  a new id marks an entry as new again
- [ ] Later, with the store app: the plan of 2026-10-20 (one code for both phones with Expo, the shared contract, a "phone" list for
  each call and screen, a lowest app version). Decide the Supabase exit first

## Pictures for AI agents (owner, 2026-10-21)

Owner request: agents read the pictures that their person sees (profile pictures and their glow, sub-company logos, the project
tile and color, covers), so a report can look like Madar. Owner choices: picture data only on request (`withPictures: true`), and
the cover from the small picture that Madar keeps (up to 960 px), as data when it is 200 KB or less, else a 10-minute link.

- [x] One glow rule for the screens and the agents (`src/lib/glow.ts`, `markLights`); the screens give the same text as before
- [x] The light-theme drawing for agents (`src/lib/pictureLook.ts`): person glow CSS, project color, project tile as an SVG
- [x] The rows: `hasPicture` and `glow` (users.list), `hasLogo` (subCompanies.list), `look` (projects.list, projects.get,
  reports.office); `withPictures` adds the data (users.list, subCompanies.list, reports.office with `subCompanyLogos`)
- [x] `pictures.get` (no call of its own; it runs users.list, subCompanies.list, projects.get and files.link with their rights);
  an MCP image block, and leak tests for a cover that points at a chat file
- [x] TOOL_DOCS, INSTRUCTIONS (rule 6 names pictures; a Pictures paragraph; the upload note stays), `server/mcp/CLAUDE.md`, samples,
  What's new 2026-10-23-72
- [x] Gates: typecheck, `npm test` 8,214 passed (733 files), `npm run build`, `build:server`, `build:remote -- test`
- [x] `test:db` 2,212 passed (27 skipped), `test:it` 325 passed (39 files), `test:mcp` 278 passed, conformance 5 of 32 (the normal 27
  expected failures)
- [x] Test copy from the branch `rb/mcp-pictures` (main stays free for a hotfix in the live week). Live check as the member's agent:
  53 tools with `pictures.get`, the rows with glow and look, a real cover from R2 as a PNG image (6.9 KB), `prj_404` not_found; the
  check removed its own agent at the end
- [x] Side by side in the prototype (light): the screen tile and the agent SVG at 136 px, and 4 person glows, match. Found and fixed:
  the ring of the SVG grew with its size (`vector-effect="non-scaling-stroke"`)
- [x] What's new shots: EN light 390 px; EN dark and AR dark at desktop width. The auto-mode check refused the Playwright shots of EN
  dark, AR light and AR dark at 390 px; a script check found no sideways scroll and no cut text in all 4
- [x] Test copy at 716c0a2 (main), after the presence proof session took its migration off madar-test; the live check passed again
- [x] Production at 716c0a29 (2026-10-21; the owner said "deploy" and ran it with `!`). Record: proof.md
- [ ] What's new phone shots: EN dark, AR light and AR dark at 390 px (the auto-mode check refused the Playwright shots)

## Times in AM and PM (owner, 2026-10-21: "make the time in AM PM style not 24")

- [x] One clock formatter (`clockFormat`, `src/lib/dates.ts`): English on the 12-hour clock with AM and PM ("5:15 PM", the US form);
  Arabic was already 12-hour («5:15 م») and stays. The meeting view summary used its own "HH:MM": it uses the formatter now
- [x] The fixed times in words, both languages: the summary mail footer and the mail pause line (7:30 AM, 3:00 AM; «صباحًا»), the
  summary hint of Settings, the meeting start hint (10:00 AM; «ص»). Wider time columns: Home meetings card and the meeting summary
  (80 px); the chat side time does not wrap. No MCP change: the tools give stamps, never a clock text
- [x] Gates: typecheck, `npm test` 8,216 passed (733 files), `npm run build`, `build:server`. Shots at 390 px (EN/AR, light/dark):
  the Meetings list and the meeting sheet
- [x] Test copy at 2701ea7, then production at 2701ea78 (2026-10-21; the owner chose it before the presence batch). Record: proof.md

## Role rights version 2 (owner, 2026-10-21: "make it more customizable rights", branch `rb/rr2`, worktree `~/dev/madar-rb/rr2`)
Every power is a switch: 112 switches in 13 sections, with places (Projects I lead, My projects, Every project, Office, No project), the
leader powers and 13 AI assistant switches. Member holds 64, Management 74, Accounting 68, the Admin all. Spec and catalog:
`docs/superpowers/specs/2026-10-21-madar-role-rights-v2-*`. Approved page: https://claude.ai/artifact/4aPwLVAS7sYUQytJGXCQhN (version 2).
Sonnet builders, Claude leads (owner, 2026-10-21). What's new 2026-10-23-74.

- [x] Spec and catalog (112 switch ids, defaults, legacy map of the 17 old ids)
- [x] Core: catalog module, storage (`off` lists, old ids expand on read), `can()` with scopes, the parity record of every call for 8 people
- [x] Work gates: to-dos field by field, meetings, posts, files, chat, Tracker, office to-dos (leak tests), reviewers, Undo fix
- [x] Office gates: projects, people, clients, money, templates, Dashboard, Search, settings, requests
- [x] MCP: one AI switch for each tool, `ai_off`, `ai.connect` stops every agent of the role, texts
- [x] Role sheet, Roles list, person sheet, words of 112 switches in English and Arabic, What's new
- [x] Screens: every control follows its switch; the Dashboard and Search tabs and routes; the 26 stand-in actions deleted
- [x] Merge fixes: a stored switch whose need is off counts as off; the old "edit any project" keeps saving to-do templates;
  a checklist change that also ticks needs "Work on my to-dos"
- [x] Gates: typecheck, `npm test` (757 files, 9,198 passed), `npm run build`, `build:server`, `build:remote -- test` (first load 1,216,617 B)
- [x] Gates: `test:db` (154 files, 2,907 passed), `test:it` (39 files; the summary test passed alone after its fix), `test:mcp` (326 passed,
  conformance 5 of 32 as normal). Fix found by `test:it`: `reviewersOf` read the settings of an office loaded without them
- [x] Prototype smoke: 87 of 87 (`npm run smoke`, 7.6 minutes, no rerun)
- [x] Screenshots (prototype build, claude-in-chrome): EN dark desktop list and sheet; AR light 390 list and AI section; EN light 390 sheet;
  AR dark 390 sheet with To-dos open; EN dark 390 Home of a Member with the Dashboard and Search off (4 tabs, no search icon)
- [x] Test copy: `all.sh test` at 90fd705 and b84b021 (the chat presence session stopped its suite and took its migrations off first)
- [x] Production at b84b0212 (2026-10-21; the owner ran `all.sh production` with `!`). Record: proof.md
- [x] The MCP guide got back the sections that the mcp track cut (Meetings to Pictures), with the switch text
- [x] rb/chat-presence went back on the test copy and released on top of role rights (production faaa6f76, then 7b0ea2ce)

### Open items of role rights version 2 (noted 2026-10-21, after the release; none breaks anything today)
- [ ] **Owner decision: rename stages without "Change project details".** A role with "Change stages and stage dates" (`project.stages`)
  but without "Change project details" (`project.details`) cannot rename stages: the stage names live in the edit sheet of the project
  (`src/features/projects/EditProjectSheet.tsx`, saved by `stages.replace`), and that sheet opens only with `viewerCan.editDetails`.
  The server allows it (`stages.replace` asks `project.stages`). Options: (a) a small "Edit stages" sheet of its own on the Schedule tab
  for `viewerCan.editStages`; (b) open the edit sheet with only the stage part when the person holds `project.stages` alone. Today every
  role holds both by default, so nobody meets it until the Admin turns one off.
- [ ] **Small fix: the Needs field of a maker without "Give to-dos to other people".** The "waits for" field of a to-do (`TaskNeeds` in
  `src/features/project/tasks/TaskSheet.tsx`, line about 482) shows only with `viewerCan.editAll && canDetails`. The server rule of
  prerequisites is `task.any`, or the maker with `task.details` (`tasks.update`, `mayChangePrerequisites`). So a maker whose role has
  `task.assign` off sees no field, although the call would pass. Fix: a new additive flag `viewerCan.editPrerequisites` from the same rule
  (`src/api/views.ts`, `contract/views.ts`), read by the sheet. The parity record compares the old keys only, so a new key is safe.
- [ ] **Step 2: "See every project" (owner chose it as a later step, 2026-10-21).** A switch that limits a role to the projects where the
  person is on the team. A hidden project answers `not_found` on every path, as office to-dos do today. Read paths it touches:
  `projects.list`, `projects.get`, `deadlines.list` and loader `overview.ts`; `tasks.list` and `get`, `updates.list`, `files.list` and
  `link`, `tracker.list` and `export`, project `meetings.list` and `get`, project comments and chat threads; `search.query`,
  `dashboard.get` (tiles, workload, schedule, map), `reports.office`, `events.list`, the client counts; the `project.view` action and
  `mayViewTask`, `mayViewFile`, `mayViewMeeting`; the Realtime signals (`server/data/save.ts`), notices, push and the morning summary
  SQL; Home, the meeting form, the code fields, the new-project sheet, the Clients section, the project-by-code route, the template
  follower counts; the MCP tools with a project id. It needs leak tests on every path (root CLAUDE.md rule). Size: about as big as step 1.
- [ ] **Check not run before the release: the deploy suite on the test copy.** `npx playwright test -c playwright.deploy.config.ts`
  against the test copy, about 45 minutes, in a delegated Playwright subagent (Haiku). It seeds the sample office again at its end, so
  run it when nobody tests by hand on the test copy.
- [ ] **Small polish: the Dashboard tab shows for a moment.** For a role without "See the Dashboard" (`dashboard.view`), the tab shows for
  about half a second while `session.get` loads, then goes. Cause: `useCan` in `src/app/useRight.tsx` gives a tab `whileLoading: true`
  on purpose, so the bar does not jump for the many people who hold it; the route asks again and refuses. Fix: keep the last rights of
  the person in localStorage (as `features/home/roleHint.ts` keeps the role) and use them before the session answers.
- [ ] Test copy, then production after the owner's word

## 2026-10-21: chat status, Seen, typing and emoji (branch `rb/chat-presence`, worktree `~/dev/madar-rb/chat-presence`)
Owner: "add some Slack chat features": Online, Away, Offline, "Seen", "typing...", and an emoji list. Design
`docs/superpowers/specs/2026-10-21-madar-chat-presence-design.md`, mockup next to it (owner: "go ahead", dot look A).

- [x] Owner answers: status automatic plus an Away switch; "Seen" and "Seen by N"; the full emoji list with search; reactions keep
  👍 ✅ 👀 and get a + for any emoji
- [x] Mockup, then the design
- [ ] Builder check of the design, then the plan (Opus, `superpowers:writing-plans`)
- [x] Proof task on madar-test (P1): every policy fact holds; a dead socket shows Offline after 49 to 66 s; the new parts were
  56% to 63% of the free 2 million, so cost steps 1 to 3 are in (typing every 5 s, rest out of view). The migration went off
  madar-test again for another release; the test deploy pushes it again
- [x] Wave 1 base B1 to B6 (reactions with any emoji, seen time, Away switch hidden from others and from History, chats.typing,
  the live port)
- [x] Wave 2: live L1 to L4, faces F1 to F5, emoji E1 to E4 (three builders in parallel), joined with main at 2701ea78
- [x] Owner read the Realtime messages (2026-10-21, Organization, Usage): 15,878 of 2,000,000 used in the period, at most about
  2,900 a day. With the new parts (0.75 to 0.83 million after cost steps 1 to 3) the month comes to about 0.85 to 0.92 million
  (about 45%): under the 50% line, so cost step 4 does not apply
- [x] Merge gate once (proof.md "Chat presence batch: the merge gate"): all green after 3 small fixes; smoke 87 of 87; screenshots
- [ ] Test copy: `all.sh test` from `rb/chat-presence` (not main) when session madar-2b says the test copy is free (its AM and PM
  release waits for the owner). It puts 2 migrations on madar-test: until the batch is on main, a test deploy from main fails at
  db push; the merge lead takes them off again on request
- [x] Test copy at 1eddb950 (2026-10-21): live check 8 of 8 passed; deploy suite stopped at 15 of 17 files (181 passed, 0 failed)
  when the owner put role rights first; both migrations taken off madar-test again
- [ ] After the owner's rr2 hand test: merge main (rr2, a816c42a), gates again, `all.sh test`, the live check, the whole deploy suite
- [x] Production at faaa6f76 (2026-10-21, the owner said "go to production"; Claude ran it). The owner skipped the two-phone test and the browser suite
- [ ] What's new line; production only by the owner

## The Madar report from the AI assistant (owner, 2026-10-21)
- [x] Past due of the office report counts to today while the period runs (a816c42a, b84b0212)
- [x] reports.office: a range from one day to another (400 days at most), the 6-week trend, the status colors in design, and the guide of the
  Madar report with guide: true (from the owner's Claude skill "madar-office-report"); INSTRUCTIONS sends every report request to it
- [x] Test copy and production at 7b0ea2ce (2026-10-21, the owner said "merge to main and deploy to production")
- [x] The Claude skill "madar-office-report" is gone from the owner's AI app (checked 2026-10-21: not in the claude.ai list, not on the Mac)

## Speed audit 2 (owner, 2026-10-21: "audit the performance of the full product and make the best")
Branch `rb/perf2` (worktree `~/dev/madar-rb/perf2`). Sonnet agents, the Opus session leads. Report:
`docs/reviews/2026-10-21-performance-audit/` (README, findings, auditor reports). Fix rule: speed and size only.
- [x] Baseline: first load 50 files, 384 KB gzip (318 KB on 2026-10-08); api.js 827 KB
- [x] Audit workflow wf_cd6fb185-8e4: 7 auditors and 7 skeptics, 113 findings; the gap critic runs
- [x] Build, 6 tracks on Sonnet: 1 first load, 2 lists, 3 calls, 4 server, 5 database, 6 instance reuse probe. The weekly usage
  limit stopped 5 builders on 2026-10-21 at about 20:00; 6 finishers ended them on 2026-10-22 (the lists track split in two)
- [x] Track 6 answer: the platform gives about 95 of 100 calls a new worker, also for a plain function: no code fix (proof.md)
- [x] Merge of the six tracks into rb/perf2 (3f8dcbae); builds and bundle checks pass; first load 34 files, 286,908 B gzip
  (was 384 KB); limits lowered to 970,000 B, 296,000 B gzip, 35 files (fe3a0196)
- [ ] Gap critic findings: a second wave if any holds
- [x] Merge into rb/perf2, then the gates once: typecheck, npm test, test:lite, test:office, build, build:server,
  build:remote test, test:db, test:it, test:mcp, the prototype smoke: all green (one npm test failure fixed, see below)
- [x] Screenshots (EN/AR, light/dark, 390 px), Chrome and WebKit iPhone, and the after numbers on the test copy: no breakage;
  numbers in proof.md "After numbers on the test copy"
- [x] Follow-ups (owner, 2026-10-22: "do both fixes"), run wf_e8be1b35-93b, merged (dffe9a1a): the idle prefetch starts one idle step
  and a 1 s quiet gap after the first fresh answer (safety start at 10 s), 3 chunks at a time in the order Projects, project page,
  Tasks, Inbox, Dashboard (lab: 2 chunks before the first rows, were 66); one save makes one trip: each overview call has a cost
  (callCost, BATCH_BUDGET 30 = 300 ms of CPU on the year office) and the follow reads of a write share one request (jsdom: 1
  request, was 2); the server checks the same sum (413 too_many_overviews). What's new: the line "Madar is faster" covers them
- [x] Gates once on dffe9a1a: typecheck; npm test 9,832 passed (6 skipped); the three builds; test:db 2,990 (27 skipped); test:it 332;
  test:mcp 330 and conformance 5 of 32 (normal); test:lite and test:office at the deploy (owner: "deploy", checks after)
- [x] Test copy and production at fbe8ac55 (owner: "deploy", then "deploy to production now", 2026-10-22); quick checks passed
- [x] After the test deploy: the prototype smoke 87 of 87; one live save sends one request (10 of 10), CPU 175 to 287 ms; the phone
  load shows no time gain (busy Mac, load 10 to 14) but the idle download now starts after the rows and 15% less data loads by 5 s
- [ ] A second phone measure at a low load (load average near 5); the prefetch limit counts screens, not files (proof.md)
- [ ] Security note (automated review, 2026-10-22): the budget prices a one-person tasks.list (mine, review_for_me, workOf, ownerId)
  at 1. These lists are narrow in SQL (owner and helpers, or in review); measured 5 to 10 ms on the year office; the worst request
  the budget and MAX_BATCH allow stays near 0.5 s of the 2 s CPU limit. No change; look again if a person list grows a full scan
- [x] What's new line 2026-10-23-82 "Madar is faster" (d107844d); no MCP change in wave 1 (no call, input, output or rule changes)
- [x] Test copy at b8bb9e42 (`all.sh test` from main, 2026-10-22): quick checks passed; the after numbers and screenshots run
- [x] Production at b8bb9e42 on the owner's word ("deploy to production", 2026-10-22): migration applied, quick checks passed;
  the team week freeze is gone (owner, 2026-10-22)
- [x] Owner decisions (2026-10-21): DF-14 instant Home from the device: yes (clear at sign-out and on a role change); SV-7 and
  DF-2 direct and group chat signals to the members only: yes (with leak tests); DB-13 outbox clean-up: no, keep the rows
- [x] Wave 2 (run wf_adeeec9a-475) merged (79baf983): DF-14 instant Home (first Home rows 42 to 53 ms against 654 ms with a held
  network), SV-7 member-only chat signals (with leak tests), DF-12 WebKit keeps a preflight 10 minutes, so WebKit sends its batch
  calls through the page's own /api (383 ms against 656 ms with a new preflight). First load 289,064 B gzip, 34 files
- [x] Gap critic: 6 findings; GP-1 to wave 3, GP-2 mostly fixed by LV-2 (the rest needs an optimistic display, owner no on
  2026-10-08), GP-3 to GP-5 proposed for later, GP-6 nothing now
- [x] Wave 3 (run wf_fc2be876-cc7) merged (4c55ff97): GP-1, the first frame does not wait for the token renewal (with a held
  renewal of 600 ms: stored Home rows at 76 ms against 701 ms)
- [x] npm test once on 4c55ff97: 9,794 passed, 6 skipped, 1 failed (TemplateMenuRemote: DF-13 read the templates early for a person
  off the team). Fix 29170b22 (the early read only for a right over every project); src/features/project again: 725 of 725
- [x] Builds once: prototype, server and remote with their bundle checks pass; first load 34 files, 947,778 B, 289,341 B gzip
- [x] Prototype smoke once on 29170b22: 87 of 87 (7.6 minutes, delegated)
- [x] Docker suites once on bb8d8527 (GP-1 touches none of their code), 2026-10-22: db reset; test:db 2,979 passed (27 skipped);
  test:it 332 of 332; test:mcp 330 passed, conformance 5 of 32 (the normal result); test:lite 2,979 passed; test:office 40 of 40
- [ ] After the deploy, on a real iPhone: wait 11 minutes, press a tab, check that no OPTIONS reaches the function
- [x] probe-reuse deleted from madar-test on the owner's word (2026-10-22); the test project holds api, mcp and jobs again
- [ ] Not asked, recorded only: LV-1 one font preload (first visit of a new device only)
- [ ] Safari on iPhone (owner, 2026-10-21: "we have safari users on iphone"). Every iPhone browser is WebKit, and every check
  of this audit ran on Chromium. At the merge: no requestIdleCallback, scheduler or navigator.connection without the fallback
  (the idle helper of src/app/screens.ts waits 200 ms in Safari). After the merge: the screenshots and the live numbers also on
  WebKit with an iPhone profile (Playwright webkit 26.6 installed 2026-10-21): cold load, one save, chat delivery
- [x] Wave 2, Safari: WebKit keeps a preflight 10 minutes (Chromium 2 h); WebKit uses the page's own /api; DF-14 falls back to
  a plain load when IndexedDB throws, fails or is missing (tests)

## Team reports of 2026-10-22 (fbk_038 to fbk_048; owner: "go with your recommendations")
Plan and answers: memory and the two design files below. fbk_039 (12-hour clock) was live already and is marked done.
- [x] Batch A (`rb/batch-a`): fbk_040 the file chip and one picture stay inside the bubble, the file names show once; fbk_045 a
  progress bar at every upload spot (Tracker, comments, posts, minutes, Files tab, project cover, feedback); fbk_046 and fbk_047 paste
  and drop in the Tracker, posts and minutes; fbk_043 checklist order by drag (keyboard too); fbk_038 picture zoom (pinch, double-tap,
  wheel, click, keys). What's new 83 to 87.
- [x] Batch C (`rb/batch-c`, on top of A): fbk_042 a View button on Tasks with a Board (To do, In progress, In review with "Your
  review", Done of the last 7 days). What's new 91.
- [x] Gates of A plus C on main f798195a: typecheck, `npm test` (9,908 passed; 2 Inbox timing tests failed under a load average of 12
  and pass alone: `ChatListStage`, `ReactionAny` 3 of 3), `npm run build`, `build:server`, `build:remote -- test` (first load 946,527 B,
  284,743 B gzip, 21 files), screenshots EN and AR, light and dark, 390 px. Not run: `test:db`, `test:it`, `test:mcp` (no handler,
  loader or SQL change; the MCP docs tests are in `npm test`).
- [x] Test copy and production at 8903f5a7 (owner: "Production now", 2026-10-22). fbk_038, 040, 042, 043, 045, 046 and 047 marked done.
  Not seen in a browser yet: the upload bars (the prototype upload ends at once). Check one upload on the live site.
- [x] Batch B (`rb/batch-b`, plan `docs/superpowers/plans/2026-10-22-madar-quiet-hours-everyone-plan.md`): quiet hours (fbk_048) and
  @everyone (fbk_041), plus the photo decode fix. New right `chat.mentionEveryone` (113 switches). What's new 88 to 90 and 92.
  Gates on main c83ad4fb plus B: typecheck; npm test 10,074 passed (1 Home timing test failed under load, passes 2 of 2 alone);
  test:db 3,037; test:it 333 (one pin of the device row updated for the two new columns, 12 of 12 again); test:mcp 335 and conformance
  5 of 32; the four builds (api.js 843.8 kB of 850,000; first load 947,375 B); screenshots EN and AR, light and dark, 390 px (Quiet
  hours, the Everyone row, the chip, the bell line with the female form). Not seen: a real push held and sent at the end of quiet hours.
- [x] Test copy and production at 6f7c3538 (owner: "Production now", 2026-10-22). fbk_041 and fbk_048 marked done. To watch: the first
  `quietEnd` push on Sunday morning, and the first summary at 9:00.
- [x] Polish seen in the shots: the mention list is narrow at 390 px, so long names wrap to two lines (it was so before B). Fixed in `rb/mention-width` (the list stays 18rem wide, one line for each name).
- [x] Batch D (`rb/d-join`, design `docs/superpowers/specs/2026-10-22-madar-hidden-internal-projects-design.md`): hidden projects,
  "See every project" and internal projects (fbk_044). Built in four waves and joined on main of Batch B. Not yet on the test copy.
  - [x] D1: the four rights (117 switches in all), `Project.access`, the view rule, the call `projects.setAccess`, every door.
  - [x] D2: the lists, counts and SQL limits show only the projects the person sees; the Inbox threads.
  - [x] D3: Realtime signals, notices, push, the morning summary, Google Calendar and the jobs follow the view rule.
  - [x] D4: internal projects, the Team tab block, the lock mark, MCP docs, What's new 93 to 95.
  - [ ] D3 open: a push that the server plans before a person loses the view may still send its one fixed line ("You have something new in Madar.").
  - [ ] D3 open: the number `reviews_waiting` of the morning summary is not filtered by the view rule.
  - [ ] D4 open: the guard of the `INT` code head: a client code that already starts with `INT` before this change is not checked.
  - [x] Gates on the join (main 92c3b276 plus D1 to D4 and the mention fix): typecheck; npm test 10,316 passed (6 timing tests failed
    under a load average of 10 to 17 and pass alone, 91 of 91); test:db 3,176 (2 failed on the database only: the hidden-project sweep
    needed more than 30 s, and the notice test deleted a project without its rows; both fixed in the tests, 31 of 31 again); test:it 333;
    test:mcp 339 and conformance 5 of 32; the four builds (api.js 855,764 characters, bound now 900,000; first load under 970,000);
    screenshots EN and AR, light and dark, 390 px: the Projects row with the lock and Internal, the Team tab block, an internal
    project with 6 tabs, the New project choice, and a person off the team who sees no row and a not-found page.
  - [x] Test copy and production at 01af2203 (owner: "Production now", 2026-10-22). fbk_044 marked done. Not run: the prototype
    smoke (Playwright) and the deploy suite.
- [x] `makeThumb` (owner: "add it to Batch B", 2026-10-22): a file over 2 MB decodes straight to 960 px wide (`rb/thumb`, d501f03b, joins
  Batch B). The small picture still comes before the upload: the server signs its upload by its size, so starting both at once needs a
  server change (not done). What's new 92; entry 91 moved to the top.

## fbk_049 and the What's new dates (owner, 2026-10-22)
- [x] fbk_049 (Faisal): the Settings section is "When Madar notifies you" (switch "Notify me only in my work hours", "My work days"), one
  live line says when Madar is quiet, a day the office keeps on looks picked with a small lock (the faded look read as "off"), and the
  built-in office hours and lock are Sunday to Thursday 8:00 AM to 5:00 PM (the morning summary at 8:00). What's new 96.
- [x] What's new dates (owner: "add in whats new the date of each release when it released"): `day` of each of the 75 entries is the
  day its production release went live (Cloudflare production deploys and the release record commits: 19, 20, 21 and 22 October); a
  test refuses a future day or a day out of order. Guides: `src/CLAUDE.md`, `scripts/deploy/CLAUDE.md`.
- [x] Gates: typecheck; npm test 10,311 passed (17 timing tests in 8 files failed under a load average of 25 to 39 from another program,
  224 of 224 alone); test:db 3,178; test:it 333; screenshots EN and AR, light and dark, 390 px, and the What's new page with 4 dates.
- [x] Production at f90bd7e7 (owner: "Production now"; the first run hit a Supabase 500, the second passed). fbk_049 marked done.
- [ ] Note: an office that already saved Work hours in Admin keeps its saved hours; the 8 to 5 default applies only where none is saved.

## fbk_050 and fbk_051 (owner, 2026-10-22; one release)
- [x] fbk_050 (Anas Emam, "Download all attachments"): a quiet "Download all (N)" under every message, to-do comment and post comment with
  2 or more files, and on the Files tab one for each stage group and "Download all files (N)" for the project (hidden when one group holds
  every file). One ZIP made in the browser (`src/lib/zip.ts`: store method, CRC-32, UTF-8 names, no new package; the R2 CORS GET was there).
  "Preparing n of N..." while it runs. What's new 97. Built by a Sonnet builder; the Arabic "preparing" word moved from «نجهّز» to «يجهّز مدار».
- [x] fbk_051 (Faisal): the two times of "When Madar notifies you" read in the order of the quiet line: "Quiet from" (end of work), then
  "Until" (start). Same saved data; the Admin block keeps its order. What's new 98.
- [x] Gates on main d2476c8a plus both: typecheck; npm test 10,385 passed, 0 failed; both builds (first load 950,885 B, 285,936 B gzip);
  screenshots 390 px (the chat button EN light, the Files tab AR dark, the quiet fields EN light and AR dark); the ZIP read back in the
  page (4 names, Arabic intact, "Preparing 2 of 4" to "4 of 4"). Not run: test:db and test:it (no server or SQL change).
- [x] Production at 139ad4ba (owner: "Production now"); fbk_050 and fbk_051 marked done. The live EU bucket allows the GET (preflight 204);
  a real ZIP press on the live site is still not seen by eye.

## Phone Direction D: Today, Inbox, Work, Me (owner, 2026-10-22: "approved", Opus leads, Sonnet builds)
Design `docs/superpowers/specs/2026-10-22-madar-phone-d-design.md` (+ `-areas.md`), plan `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`
(+ `phone-d/track-*.md`), mockups on the private canvas https://claude.ai/artifact/AVpT8zSb2Lexjt7v3t2Cgg. Branch `rb/phone-d`.
- [x] Wave 1 (track S): the four-tab phone bar with words, the top row (mark or back link, one Search), `/me` routes, `--phone-bar`, and the
  shared props (SegmentedControl fill/layoutId/count, Tabs spread/pill, Sheet tall/phoneHeader/onClosed, SheetOrPopover, Menu sheetOnPhone).
- [x] Wave 2 (six Sonnet builders): Work (one header, To-dos/Meetings/Projects, press and hold, the board lane), Today (no project list on a
  phone), a project (five tabs with More), a to-do (the next step first, grouped rows, docked Conversation), Inbox and chat (Chats and
  Notifications, chips, a full-screen chat with every chat feature), Me (the hub and `/me/:section`).
- [x] Join and gates: What's new 2026-10-23-99; guides; npm test 11,093 (4 join faults fixed); builds (first load 965,759 B of 970,000);
  test:db 3,037; test:it 333; prototype smoke 135 of 135 after one fix round (tab-bar fade on a resize, the More slide, the comment under the
  dock, 44 px press areas); screenshots EN/AR, light/dark, 390/360 px, Chromium and WebKit.
- [x] Merged main e4fb10c3 (Batch D, fbk_049 to fbk_051): an internal project has no Tracker tab on a phone either; the ZIP title wraps the
  task Conversation in both layouts.
- [x] Test copy (`all.sh test`), the deploy suite (green at 63847d1), the owner's try, then production at 9fba0e25 on his word (2026-10-22 21:14).
- [x] Owner, 2026-10-22, during the phone try: the tab bar shows icons only (the words stay as screen-reader text, so the link names do
  not change). Each tab is 48 px with a 24 px block icon in its middle (the inline icon sat about 2 px high); the bar is 60 px, and
  `--phone-bar` follows. What's new 2026-10-23-99 names the icon of each tab. The 4 deploy-suite fixes of `rb/phone-d-suitefix` joined main
  before this test deploy. npm test: 11,088 passed, 6 skipped (944 files).
- [x] (Fixed 2026-10-22, `test/fakeMapLib.ts` in the four map tests, guard `mapTestRule.test.ts`.) The map tests (`src/features/map/PinPicker.test.tsx`, `src/features/project/overview/ProjectPlace.test.tsx`) leave 8 unhandled
  "Worker is not defined" errors (maplibre-gl has no Worker in jsdom), so `npm test` exits 1 with every test green. They came with the speed
  release (a8aa4356, already in production). Fix: give those tests a fake map library, or a fake Worker.
- [x] (Fixed 2026-10-22: `reloadOnFailedImport` moved to `app/importReload.ts`, guard `importCycle.test.ts`.) Plain `npx vite` (dev mode) showed an empty page: "Cannot access 'lazy' before initialization" (`src/app/lazyOverlay.tsx`, from
  `src/components/Menu.tsx`). In dev, `vite.config.ts` points `./screenLoaders` at `screenLoaders.static.ts`, which makes the cycle Menu,
  lazyOverlay, the screens, Menu. It came with f08094b5 (the Menu sheet on a phone). Builds are not affected; `--mode test` works.
- [ ] Later: the project To-dos View button and the Work View toggle look different (pill with words vs round icon); make them one look.

## Insight with PostHog (owner, 2026-10-25: "go ahead"; branch `rb/posthog`)

Design: `docs/superpowers/specs/2026-10-25-madar-posthog-insight-design.md`. Plan: `docs/superpowers/plans/2026-10-25-madar-posthog-insight-plan.md`.

- [x] Built (Tasks 1 to 7): the scrub, the private class, the lazy client, the signals, the server sender, the Settings line, the privacy page, What's new `2026-10-23-102`
- [x] Owner: make the PostHog account in the EU region (no card); the keys are in `config/remote.*.env` (`VITE_POSTHOG_KEY`) and `secrets/*.env` (`POSTHOG_KEY`)
- [ ] Owner: in PostHog turn on "Record user sessions" and "Exception autocapture", "Discard client IP data", and the replay minimum duration of 5 s
- [x] Test copy check (madar-52, passed on 3b40b13c): replays with hatched chat bubbles, previews, amounts and file pictures; the test error arrives with the person; clean addresses. Fixes on the way: 4d07d7bb (connect-src `eu-assets.i.posthog.com`) and 89ce45c7 (the ResizeObserver loop warning stays out)
- [x] Screenshots of the Settings and Me line (EN/AR, light/dark, 390 px)
- [x] Production at 4df7db3d (2026-10-25 15:28), with the four team reports and the to-do fixes. PostHog check at 15:35: 2 production
  page views (`env` production) arrived; no production replay yet (the visit was about 10 s); look again in PostHog later
- [ ] Speed check: Home and the Inbox as fast as before (desktop Chrome and iPhone Safari)
- [ ] The office object logger (`server/office/parts.ts`) is not wired to PostHog
- [ ] Later, by the owner, one feature at a time: the PostHog dashboards and the decisions to hide a feature
- [ ] Connect the PostHog MCP server to Claude (personal API key in `.env.local` as `POSTHOG_PERSONAL_KEY`)

## fbk_056 and fbk_057 (owner, 2026-10-25: "plan and build both, don't stop until you finish")

Plan: `docs/superpowers/plans/2026-10-25-madar-inbox-line-agent-projects-plan.md`. Voice notes (fbk_054) dropped by the owner.

- [x] Track A, the Inbox line (`rb/inbox-line`): one line under a filtered list with the unread messages of the other kinds, and "Show all"
- [x] Track B, projects from the AI agent (`rb/agent-projects`): switch `ai.projectSetup` (Admin only), 4 tools, lean lists, words, tests
- [x] Join: both branches on main, What's new 2026-10-23-100 and -101, the R2 line of `server/files/CLAUDE.md`
- [x] Gates once (also test:lite and test:office): typecheck, npm test, builds, test:db, test:it, test:mcp, prototype smoke
- [x] Screenshots: the Inbox line (EN/AR, light/dark, 390 px and desk), the role sheet switch
- [x] Test copy (`all.sh test`), then production at 10c7191b (2026-10-25 12:43), release record
- [x] Mark fbk_056 and fbk_057 done in Madar (2026-10-25 12:45, story sty_b5w6qh34op2hvthd2tz4jw)
- [ ] Found 2026-10-25 (not in this release, propose to the owner): on a 390 px phone in Arabic, the four Inbox kind chips do not fit one row, and «الأشخاص» drops to a second row

## fbk_052, fbk_055, fbk_058, fbk_059 (owner, 2026-10-25: "go ahead"; production waits for the owner)

Plan: `docs/superpowers/plans/2026-10-25-madar-team-reports-2-plan.md`.

- [x] Track D1 (`rb/undo-summary`): Ctrl+Z on an Arabic keyboard, Undo toasts 8 s, the swipe Undo on a notice; the summary on office work days only
- [x] Track D2 (`rb/space-levels`): the Open space "Show more / Show less" with 5 steps, the sub-company column, deadlines and checklists, the refit
- [x] Track D3 (`rb/focus-chat`): the Project chat panel in Focus mode, closed at first, the device remembers
- [x] Join, What's new 2026-10-23-103 to -106, gates once, screenshots; the owner's changes during the join: the docked Focus sidebar, its compact box, the switch to the to-do thread; the phone fixes of the Open space
- [x] One release with `rb/posthog` and madar-4e's three to-do fixes (owner's choice): test copy, then production at 4df7db3d (2026-10-25 15:28), release record
- [x] Mark fbk_052, fbk_055, fbk_058 and fbk_059 done in Madar (2026-10-25 15:30, story sty_heohaeky4y5qqznhxuiag4)
- [ ] Found 2026-10-25 (propose to the owner): in the Focus sidebar (384 px) the message bubbles are narrow, so the text wraps after a few words

## MCP: stages, many to-dos, long lists (owner, 2026-10-26; branch `rb/mcp-bulk`)

- [x] `stages.replace` is a tool (AI switch `ai.projects`, right `project.stages`); the docs say it has no Undo
- [x] `tasks.createMany` (50) and `tasks.updateMany` (100): one story, a failed item does not stop the next, one tool call for the limit
- [x] `projects.list` and `tasks.list` take `limit`, `offset`, `full`; short rows and `page` by default
- [x] An event in an MCP answer keeps no `before` and no `after`
- [x] `tasks.move` and `tasks.update` docs name the stage move; What's new 2026-10-23-115
- [ ] The merge lead runs `test:mcp`, `test:db` and `test:it` (they need Docker)
- [ ] Open: 100 items in one batch are 100 transactions in one request. Measure the Worker CPU time on the test copy before the owner relies on 100.
- [ ] Open: `project.stages_changed` has no Undo. Decide with the owner if an agent change of stages needs one.

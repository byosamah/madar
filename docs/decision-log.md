# Decision log

The owner decisions and the history that the CLAUDE.md guides held until 2026-10-27, in their original words. The guides
keep each decision that still sets a rule, as a rule. This file is the record of when and why. Newest wins.
Sections follow the guide that held the text. Line numbers and counts in this file are from that day and can be old.


History and provenance taken out of the guides of the group ops-data. Grouped by guide, then by section. The text is in the
original words, trimmed where it repeated itself. Dates are the dates of the owner or of the probe.

## CLAUDE.md

### Intro
- "The real build: the same screens over a TypeScript server on Supabase. Built in waves since 2026-10-03. Live since 2026-10-04:
  production https://madar.vado.sa (since 2026-10-05; www.madar.vado.sa and madar-46r.pages.dev also work; first Admin
  o.khalil@mazj.org), test copy https://preview.madar-46r.pages.dev (the sample office, `secrets/test-accounts.env`)."

### Where the truth lives
- "The Supabase exit to Cloudflare (paused 2026-10-18 after wave 5 R5): start at `docs/superpowers/real-build/exit-handoff.md`."

### Owner rules (always)
- "Every Arabic text follows the Thmanyah rules (owner, 2026-10-20): screens, mails, push, What's new, docs, replies."
- "Backups (owner, 2026-10-20): run `mac-backup.sh` only when the owner asks for a backup, never on each message. The nightly
  GitHub backup stays."
- "Fonts: Thmanyah Sans (free, font.thmanyah.com) since 2026-10-05."
- "Never recommend paying Vercel or another Israeli or pro-Israel vendor (owner boycott)." (kept as a rule in the guide)

### Secrets and accounts
- "Example lines of a secrets file for the owner use placeholders that fail the shape check (`<the Bunah key>`, `<the Bunah
  address>`), never a plausible value: `bunah.daftra.com` from an example passed the check while the real address was not set
  (2026-10-26)."
- "Rotated 2026-10-05: both database passwords, the Supabase token, and the Resend key in `.env.local` (the Resend keys are listed
  in `server/mail/CLAUDE.md`)."

### Commands
- "`npm test` - the `unit` and `server` projects (about 11,100 tests, about 7 minutes)."
- "Run them on the newest main too: a branch behind main can fail a test that main already fixed (2026-10-25,
  `ReactionAny.test.tsx`)."
- "Put `-u` after the test files: `vitest run -u <file>` reads the file name as the value of `-u` and runs every test in update
  mode (2026-10-20). Under a load average far above the core count, run only the folders that your change touches."
- "A gate under 5 minutes (owner rule for fast batches) ... (217 files, about 35 s), then the screen folders that the change
  touches (10 folders, about 90 s)." (The audit counted 305 test files in the folders.)
- "`test:db`, `test:it` and the `test:mcp` conformance runner need Docker Desktop and the local stack ... The run that worked
  (2026-10-08): `docker-lock.sh acquire <holder>`, `npx supabase start -x edge-runtime`, `npx supabase db reset`, `npm run
  test:db`, `npm run test:it`, `npm run test:mcp`, `npx supabase stop`, `docker-lock.sh release <holder>` (again on 2026-10-12)."
- "`npm run test:mcp` ... "conformance: 5 of 32 scenarios pass; 27 expected failures" is the normal result."
- "`npm run test:office` - the office object on local workerd (wrangler createTestHarness): host parity, everyCall parity, the rows
  pins, the batch, socket and Cron suites of exit wave 3, and the MCP suite of the merge of waves 2 and 3."
- "`npm run smoke:office` ... 10 checks, the own sign-in and `/mcp` included."
- "`npm run dev:office` - the local office stack (exit wave 4)."
- "One heavy run at a time (owner, 2026-10-20): ... (up to 60 minutes ...). Each vitest run uses at most 5 workers (`maxWorkers`,
  `vite.config.ts`). Why: two or three full runs of other sessions at once filled the 16 GB of memory, the load reached 190 on 10
  cores, and tests failed on their time limits."
- "The MCP cannot read file contents. To study the files of a project (a tile shape, a review), open madar.vado.sa in the owner's
  Chrome ..." and "Drawing checks on this Mac: qlmanage ... paper.js ..." (moved to `docs/superpowers/real-build/build-process.md`).
- "Last counts (2026-10-25, release 4df7db3d): unit+server 11,395 passed (963 files, 6 skipped); test:db 3,192 (27 skipped);
  test:lite 3,192; test:it 333; test:office 40; test:mcp 372, conformance normal (5 of 32); prototype smoke 135 of 135. Older:
  deploy suite 206 passed, 13 skipped (2026-10-20)."

### Rules that cross parts
- "On Supabase almost every API call starts a new worker (about 230 ms and 110 ms of CPU; probe of 2026-10-21,
  `server/CLAUDE.md`)."
- "Every feature or fix updates the What's new page before the deploy ... (owner, 2026-10-19)."
- "Every feature change updates the MCP side in the same commit ... (owner, 2026-10-05)."
- "A feature that hides a record from some people gets leak tests from its own builder ... (office tasks, 2026-10-06). No separate
  leak review (owner, 2026-10-07)."
- "Every new power is a switch (owner, 2026-10-21): a line in the catalog JSON and `rightsCatalog.ts`, its action in `can()`, a
  `viewerCan` flag for its control, words in `rr2sheet`, and its MCP tool in one AI switch. `rightsParity.test.ts` stays equal
  unless the owner approves."

### Build process
- "No separate checker (owner, 2026-10-07)."
- "Claude's `git push origin main` is refused by the auto-mode check ... (2026-10-08)."
- "Before you fast-forward main, message the release lead ... two full runs at once make screen tests time out (2026-10-25)."
- "`npm install` in a worktree whose `node_modules` is a link ... (2026-10-07)."
- "Before you move main or run `all.sh`, tell the peer sessions ... two releases on one main and one test copy break each other
  (2026-10-21)."
- Dated Workflow-agent and join lore (2026-10-20 to 2026-10-26): moved with its dates to
  `docs/superpowers/real-build/build-process.md`.
- "The Z steps (plan Track Z): Z0a, Z0b, Z1 done; Z2 R2 waits; Z3 sender vado.sa; Z4 Pages and madar.vado.sa done; Z5 database
  backups run nightly, file backups wait for the owner's Backblaze B2 (the workflow is paused); Z6 seed done; Z7 security review;
  Z8 first Admin done, then a 2-week pilot." (stale: R2 is live, B2 is dropped)

### Owner decisions (history, newest wins)
The whole section, sorted by date (the guide listed 2026-10-23 before 2026-10-16), in the original words:
- 2026-09-30: web app, English and Arabic, roles Admin and Member plus project leaders; tasks with review, 7 design
  stages, schedules, files, comments, notifications.
- 2026-10-01: the calm redesign (busy screens lose a person with ADHD); hours removed; Management and Accounting roles
  with payments; chat Inbox; Pause/Resume with reason; Tracker; task templates and versions; every date move asks a
  reason (everyone, the Admin too); the stage tag is automatic.
- 2026-10-02: the meeting view (team only, never the client; 5-minute time box; zooms Week/Month/Quarter/Year).
- 2026-10-03: the Balady tick box on a move back; turning off a busy person warns, then allows; one meeting per tab
  in the prototype; the Inbox count includes task threads.
- 2026-10-03 stack: all free plans. Supabase (Frankfurt; the owner confirmed client data may live there), Edge
  Functions, Cloudflare Pages, Supabase Storage first, Resend, Workers paid as the fallback. No Vercel, no Railway.
  Sign-in with email and password. Start empty. AI agents (MCP) in version 1. A mobile app comes later on the same API.
  ("No phone push" held until 2026-10-08, see the browser push decision below.)
- 2026-10-04: logo "Turning doors"; the mark at the top start of every screen; "Invited" until the first password.
- 2026-10-05: production on madar.vado.sa; the short MCP address madar.vado.sa/mcp; one CLAUDE.md for each part; keep
  the old Resend key VADO for now (unused, still live; do not ask again); the font Thmanyah Sans for English and
  Arabic; in the Arabic screens, English text also sits on the right; the test copy is the staging step (no third copy,
  no staging address for now), and production takes only the commit of the last full test deploy
  (`scripts/deploy/CLAUDE.md`, Release flow).
- 2026-10-06: a 15-minute sign-in token (Z7); the Dashboard shows what is past due, waits for review or for our reply,
  the money to receive (payment roles) and the data gaps (Admin); a past-due task marks its project At risk only from 3 days;
  the accountant keeps the books in Daftra (a link waits for his answers, `TASKS.md`).
- 2026-10-08: free browser push (Web Push) replaces "No phone push" of 2026-10-03. No email, WhatsApp, SMS or vendor account. One
  fixed line with no data ("You have something new in Madar." / "لديك جديد في مدار.", title Madar / مدار). It goes for every new
  notice of the bell (all triggers) and every new chat message, to the people who read them, never to the sender, only to active
  people. One switch for each device in Settings: "Notify me on this device". Record: `server/push/CLAUDE.md`.
- 2026-10-09: "Notify me on this device" is on by default. A browser needs one tap on Allow for each device, so Home shows one small
  card with one button (the owner chose the card over an ask at the first tap or at the start). After Allow, push turns on again by
  itself at each sign-in. A person who turns the switch off stays off on that browser. No MCP change: the three push calls stay
  on the deny list. Record: `src/CLAUDE.md`.
- 2026-10-16: move the files from Supabase Storage to R2, and the server from Supabase Edge Functions to one Cloudflare Worker
  for each copy (the test copy first); the database, Auth and Realtime stay; the functions stay as the way back; the Worker
  stays only if it measures faster.
  [Note of the editor: the files part is live (R2). Both copies say `supabase` in `config/server-host.json` now; see the 2026-10-17 and 2026-10-18 lines.]
- 2026-10-17: GO for the full exit from Supabase to Cloudflare Free (one office object for each copy, the own sign-in, live
  sockets, Cron, backups by export); no paid plan.
  [Note of the editor: paused on 2026-10-18; start again from `docs/superpowers/real-build/exit-handoff.md`.]
- 2026-10-18: R2 alone for the files (no Backblaze B2); the test copy on the same Cloudflare account with a 50% day cap; the
  GitHub tests start only by hand, so the free minutes go to the backups; the database backup runs from the Mac until GitHub
  runs it again; the exit pauses after wave 5 R5 for a feature of the team (`docs/superpowers/real-build/exit-handoff.md`).
- 2026-10-20: the Home Screen app is the phone app until the official iPhone and Android app (one code for both phones, later):
  the Home card shows the steps to the Home Screen on an iPhone and one install button on Android; every push is urgent and lives
  one day. 2026-10-21: Apple gets no Topic header (it refused every iPhone push); the push line is "Like WhatsApp" (the name and the
  first words of a message, the bell sentence of a notice, encrypted for each browser; a press opens it). It replaces the fixed line
  with no data of 2026-10-08. Record: `server/push/CLAUDE.md`.

- 2026-10-21 (speed audit 2, `docs/reviews/2026-10-21-performance-audit/`): Home shows the last lists of the person at once after
  a relaunch, from the device (cleared at sign-out, at session end, for another person and on a role change); a direct or group
  chat message signals only its members (the anonymous office signal of INT-16 is gone); the outbox keeps its sent rows. The
  office has Safari users on iPhone: every speed or screen change is checked on WebKit too, and WebKit sends its API calls
  through the page's own `/api` (it keeps a CORS preflight only 10 minutes).
- 2026-10-23: one choice for the Admin, "What reaches me" (Settings): Only my work, My work and the rest in the list (the default, as before), or
  Everything (every project chat message counts, and the bell gets a copy of each notice of the office, with no push and no email). Record: `src/CLAUDE.md`
  and `src/api/CLAUDE.md` ("Copies for the Admin").


## scripts/deploy/CLAUDE.md

### Release flow
- Header: "Release flow (owner, 2026-10-05)".
- "Before a production release with a change that people see, add a What's new entry in plain words for the team, in English and
  Arabic (`src/whatsNew/entries.ts`). Give the entry `right` when only some people can use the feature, and `to` (the address of its
  screen) for the "Open" link." (rule lives in root and `src/i18n/CLAUDE.md`)
- "The deploy suite seeds the sample office at its start and wipes an owner try that is under way: start it only after the owner
  says the try is done (2026-10-22)."
- "When the owner skips the deploy suite, check the test copy in the owner's Chrome ... (2026-10-26)."
- "A cloud proof of another session can put a migration on madar-test that no branch holds yet ... Never repair the migration
  history for it: ask which session holds the proof, and deploy when it is done (2026-10-21)."
- "Another session's `all.sh test` that already put a migration on madar-test cannot be rewound ... ship both in one release, with
  the owner's word (tile shapes and Daftra, 2026-10-26)."
- "`ps` shows `all.sh test` from `$TMPDIR/madar-deploy-*` while any `npm test` runs ... A record off main is another session's
  branch on the test copy (2026-10-21: `rb/chat-presence`, 2 migrations)."
- "Another session may leave changes in the main folder ... `.git/info/exclude` holds `secrets` (2026-10-07)."
- "`all.sh` runs from any clean worktree that holds main ... (2026-10-20: `~/dev/madar-rb/gcal-reuse`, because `deploy-test` sat on
  `rb/phone-bar`)."
- "`all.sh production` can stop at the secrets step with "The Management API refused the key list with 500" (Supabase) ... it passed
  on the second run on 2026-10-20 and 2026-10-22."
- "2026-10-20: after the owner asked, Claude's own `echo production | scripts/deploy/all.sh production` (sandbox off, in the
  background) passed the auto-mode check. While it ran, the check refused an unrelated read-only Bash call as "Production Deploy"."
- "After production: commit the record on main, then `git push origin main`."
- "Notes after `all.sh test` ... go on the batch branch, not main ... (speed release, 2026-10-22)."
- "A `!` command has no keyboard ... (2026-10-08)."
- "A short "ok" did not pass that check, and later the owner's plain words did not pass either (2026-10-07)."
- "Before a release step, check that another session did not do it already ... (2026-10-20)." "A commit on main after another
  session's `all.sh test` blocks that session's production ... (2026-10-20)." "`git branch --contains ...` ... the owner picks the
  order (2026-10-21)."

### Steps
- "`secrets.ts` ... Then the Worker of the copy, when it exists (owner, 2026-10-16)". "`worker.sh --prebuilt` (owner, 2026-10-16)".
  "`checks.sh` (owner, 2026-10-16)".
- The fixed hosts of `connect-src`: "`https://nominatim.openstreetmap.org` (the place search of the pin picker, Task 12b, fbk_017)
  and `https://tiles.openfreemap.org` (the street map, owner 2026-10-19) and `https://eu.i.posthog.com` with
  `https://eu-assets.i.posthog.com` (PostHog Cloud EU: usage data and errors, and the settings of the project as JSON, owner
  2026-10-25)." (now pinned by `scripts/deploy/headers.test.ts`)

### Secrets
- "Browser push keys (owner, 2026-10-08)". "`POSTHOG_KEY` (insight design, owner 2026-10-25) ... (the owner adds both after he
  makes the PostHog account in the EU region)". "Google Calendar values (fbk_022, owner 2026-10-19)". "Daftra
  accounts (the Daftra link, owner 2026-10-26) ... The test copy gets only the MAZJ pair (the owner's test key) until the last step;
  production gets the five pairs at the last step. Each key role in Daftra should be "Only Allow" `invoice` and `client`."
  "NAME is the English name of the sub-company in capitals, only A to Z and 0 to 9 (`MAZJ`, `VADO`, `BUNAH`, `TUBA`, `ZURAA`)."
- "`checkSecrets` wants the key to be 20 to 128 letters and digits and the site to be a bare name on `daftra.com` or `daftara.com`
  (no `https://`, no slash)." (now stated by `scripts/deploy/secrets.ts` and `secrets.test.ts`)
- "R2 (owner, 2026-10-16) ... `secrets.ts` wants the 32 hex characters of the account".

### Switch the files to R2 (owner, 2026-10-16)
The whole runbook moved to `docs/superpowers/real-build/r2-switch-runbook.md`.

### Cloudflare
- "R2 is on (2026-10-16): the buckets `madar-files-test` and `madar-files`, both EU."
- "Workers (owner, 2026-10-16): `worker.sh` deploys ... The account workers.dev subdomain is `vado-sa`".
- "The mail of 2026-10-17 came from the CPU probe of 2026-10-16 (1,332 stops from 18:00 UTC, proof.md wave 0); the Pages Functions
  had none."
- "The next `all.sh test` after wave 3 deploys `madar-server-test` with a Durable Object namespace `Office` (no object, no storage),
  the migration `office-v1`, and a Cron every 15 minutes whose `scheduled()` returns at once (no `MADAR_DATA`): 96 short runs a day
  and 1 of the 5 Cron Triggers of the account. The test copy serves the same, because the Pages forwarder sends `/api` to Supabase
  while `config/server-host.json` says supabase. ... Count the Cron Triggers of the account before that first test deploy (plan of
  exit wave 3, Task 19 Step 3): with 5 in use, the test Cron stays off until wave 5."

### Quick check of production
- "A Pages step that fails with "Failed to publish your Function ..." ... (2026-10-12: the third run went through)."
- "`config.sh` once stopped with `ConfigPushApiUpdateStatusError` (500 ...) on production, after `db.sh` had pushed two migrations
  (2026-10-20). ... The second run went through."
- "`db.sh` once stopped with `DbPushMissingLocalError` (20261008000100 and 20261012000100) while both files were in the folder;
  `db.sh` alone a minute later said up to date (2026-10-16)."
- "The Hyperdrive password step of `secrets.ts` can get 2013 ... (2026-10-16)."
- The curl one-liners (page 200, `POST /mcp` 401, `api/health?forceFunctionRegion=eu-central-1` 200) were cut: `checks.sh` does them.

### The server host (owner, 2026-10-16)
- "Exit wave 4 adds `office` (the office object of the Worker), for the test copy only: the setting refuses `production: office`
  until the switch (wave 6)."
- "First setup of a copy, step 1: The Workers plan. The account stays on Free (owner, 2026-10-16: "free is enough for now"): 10 ms
  of CPU for each request, and 100,000 requests and 100,000 Hyperdrive queries a day for the whole account (`platform-facts.md`
  2.7). Measured 2026-10-16 (proof.md, "The deploy suite on Workers Free"): after about 7 minutes of steady load, Free stops each
  call at 10 ms, and a median Madar call needs 37 ms. So a copy goes to `workers` only on Workers Paid ($5 a month, which only the
  owner buys). Both copies say `supabase` until then."
- "the calls limit of the usage meters and the warning mail (10 million or 500,000; the 10 million are the Paid month ...)".

## server/data/CLAUDE.md

### Tables
- `push_devices` "(`20261008000100_push_devices.sql`, owner 2026-10-08)".
- "A file of a direct chat or a group (owner, 2026-10-19) ... (`save.ts`, owner 2026-10-21)". "A file of a meeting with no project
  (wave 2)". "The minutes (wave 2)". "Chat search (`20261020000200_message_search.sql`, chat design 2026-10-19, item 16)". "`meetings`
  (`20261020000100_meetings.sql`, fbk_022)". "`events.list` adds the test ... the Admin too (owner, 2026-10-19, Q4)". "A series (wave
  3, owner 2026-10-19)".
- "`google_calendars` (`20261021000300_google_calendars.sql`, owner test 2026-10-20)". "`agent_confirms` (owner 2026-10-26, SQLite
  schema version 12)". "Folders of the Files & Links tab (fbk_066, owner 2026-10-26)". "`Project.nameAr` (fbk_062)".
  "`Project.continuous` (fbk_069)". "`usage_month`, `usage_warnings` (both unused since 2026-10-23, kept)".
- The full per-feature text moved to `docs/superpowers/real-build/data-tables.md`.

### Office cache
- "A write asks for the counters with the version (DB-12, 2026-10-21)".

### Loaders
- "Office tasks (no project, owner 2026-10-06)". "Hidden projects (owner 2026-10-22, wave D2)". "Read indexes (performance audit
  2026-10-07)". "perf2 DB-9", "perf2 DB-4 (about 40% fewer bytes)", "perf2 DB-5", "perf2 SV-10 (chat loaders: 3 statements for
  `chats.unreadCount` and `chats.list` (were 9 to 11), and 3 for `chats.waiting` (was 12))". "The unread count ... (fbk_027)".
  "(chat design item 23)". "The choice of the Admin (`adminReachOf`, owner 2026-10-23)". All moved with detail to
  `docs/superpowers/real-build/loader-notes.md`.

### SQL rules
- "It was 120 s until 2026-10-16: Supabase gives each request a new worker that seldom takes a second one ... the client limit of
  200 filled under the deploy suite (EMAXCONN, `server/CLAUDE.md`)." "(proof.md, pooler probes, 2026-10-08)". "(proof.md, Hyperdrive
  probe, 2026-10-16)", `query_timeout` 12 s.

### The SQLite path (Supabase exit, wave 1)
- The version log, in the original words: "Schema version 3 (exit waves 2 and 3): the sign-in rows of wave 2 and the table `usage_day`
  of wave 3 ... Schema version 4 (fbk_007) adds the office list `sub_companies` ... Schema version 5 (fbk_022) adds the table
  `meetings` ... Schema version 6 (chat search) adds `search_text text` to `messages` and `comments` ... Schema version 7 (fbk_022,
  wave 2) ... Schema version 8 (fbk_022) ... Schema version 9 (fbk_022, one calendar for each person) ... Schema version 11 (the
  Daftra link, 2026-10-26) ... The version and the sha pin in `schema.test.ts` changed in place, because the step was not released.
  ... The order of versions 6 to 8 comes from the join of 2026-10-20: the chat batch reached main first with version 6, so the
  meetings settle step (version 6 on its branch) became 7 and the Google step (version 7 on its branch) became 8." (The log skipped
  versions 10 and 12; the code has both.) Moved to `docs/superpowers/real-build/data-tables.md`.
- "Each event index costs 1 row written for each event, and a read needs each of the 8. Task 18 dropped four of them, one at a
  time: a read then took 12,815 to 183,416 rows in place of 4 to 4,189 (proof.md "Wave 1: the rows pins")."
- "`LATER_CALLS` and `LATER_KINDS` ... are empty since the merge of waves 2 and 3".

## server/files/CLAUDE.md

### Stores
- "Supabase Storage first: the private bucket `madar-files`, 50 MB for each file, 1 GB in total."
- "`MADAR_FILE_STORE=r2` switches to it. The owner decided the switch on 2026-10-16 (the test copy first, then production). R2 is
  on for both copies since 2026-10-16 (production at ae63498, health `"fileStore":"r2"`; proof.md "Files to R2 on production")."
- "'Download all' (fbk_050, 2026-10-22)". "No meter counts the storage since the usage feature went (owner, 2026-10-23)."
- "The scripts of the switch: `scripts/storage/move-to-r2.ts --env` ... The runbook is in `scripts/deploy/CLAUDE.md`."

### Rules
- "A file of an office task (no project, owner 2026-10-06)". "A file of a direct chat or a group (owner, 2026-10-19)". "An agent
  follows exactly the rights of its person (owner, 2026-10-26; before, an agent never uploaded into a chat and never opened a chat
  file)". "Its save sends a person signal ... (`diffState`, `Diff.chatKinds`; owner 2026-10-21, replacing the anonymous office
  signal)". "A file of a meeting with no project (wave 2, owner 2026-10-19)". "(`FileRec.folderId`, fbk_066 ...)". "(SV-11,
  2026-10-21)" on adjacent `files.link` entries. "uploads into a direct chat or a group of its person with `conversationId`, as
  that person does (owner, 2026-10-26)".
- "The weekly file backup copies the store to Backblaze B2 (see `.github/CLAUDE.md`)." (stale: the owner chose R2 alone on
  2026-10-18; the workflow is paused)

## server/mail/CLAUDE.md
- "The code mail of an agent act (owner, 2026-10-26, effect `mcp.confirm`)".
- "The Resend keys of the account (2026-10-05): `Madar`: full access, in `.env.local`. `madar-production`: sending only, vado.sa
  only, in `secrets/production.env`. `MAZJ`: the Mazj apps use it. Never change or delete it. `VADO`: the old key. Its value
  leaked in chat and sits in Supermemory. Nothing uses it. The owner keeps it for now. `Onboarding`: not in use."
- "Quota: `QUOTA_LIMITS` (`quota.ts`): notice 90, summary 90, signin 98, warning 98." "On SQLite (the office object, exit waves 2
  and 3) the quota has no mail lock ... `DAY_COUNT_LITE`, `RESERVE_LITE` ... `REFUSAL_MARK_LITE` and `SENT_TODAY_LITE`."
- "Quiet hours (owner, 2026-10-22, fbk_048)". "Copies (owner, 2026-10-23)". "A notice from @everyone (`Notification.everyone`, owner
  2026-10-22, fbk_041) ... The Resend free plan sends 100 mails a day."
- "The morning summary is the one exception (owner, 2026-10-19, fbk_021)". "(owner, 2026-10-22, fbk_048; it was 07:30 for all)". "A
  person who set more days of their own, such as all 7, gets no summary on a day off of the office (fbk_058)." "It adds the count
  of the reviews that wait ... (owner, 2026-10-06)." "Hidden projects (owner, 2026-10-22, wave D3)". The summary rules moved to
  `docs/superpowers/real-build/mail-summary.md`.
- "`meeting_invited`, `meeting_soon`, fbk_022 ... `helper_joined`, `task_deleted`, fbk_034 and fbk_035 ... `payment_due`, 2026-10-26".
  "A meeting sends no mail: the quota is 100 a day".
- "vado.sa has DKIM and SPF from Resend, and DMARC `p=none` (since 2026-10-05)."

## server/auth/CLAUDE.md
- "`jwt_expiry = 900` (owner, 2026-10-06, Z7)."
- "The client address is `cf-connecting-ip` on Supabase (proven: ...)."
- "`users.resendInvite`: 5 a day for each person." "Forgot: 3 in one window for each email (the window is 1 hour, the life of a link
  ...), 10 an hour for each address." "Renew: ... a 1.5 s minimum answer."
- "The own sign-in (Supabase exit, wave 2)". "Rows ... (SQLite schema version 3 since the merge of waves 2 and 3)". "Passwords: ... A
  copied bcrypt hash (owner decision 4) works once". "Tokens: ES256, 900 s ... With the secret set, `verifyBrowserToken` and
  `agentTokenCheckerOf` use the own key; no copy has it before wave 5." "Sessions: ... a second use within 10 s rotates again, a
  later one ends the session. 30 days after the last refresh." "Links: 32 random bytes, sha256 in the table, 1 hour, one use."
  "Limits (`own/limits.ts`): 10 sign-ins for one email and 30 for one address in 15 minutes, 20 link opens and 10 OAuth
  registrations for one address in an hour." (numbers now in `own/limits.ts`, `own/sessions.ts`, `own/password.ts`)

## supabase/CLAUDE.md
- "Number ranges: app 20261004000100-199, realtime 0200, cron 0300, auth and agents 0400s, files 0500, usage 0600s." (true only for
  the files of 2026-10-04; later files use the date as the number, and `20261022000200_platform_presence.sql` uses the 0200 slot of
  a later day.)
- "The Supabase CLI native runtime (no Docker, alpha since 2026-10-02) is not in use: the MinIO suites need Docker. The trial is a
  TASKS.md item."
- Per-migration notes (all cut: the migration headers state them): "`20261022000100_chat_reads_conversation.sql` indexes
  `chat_reads (conversation_id)` ... Its SQLite twin is `LITE_SCHEMA_VERSION` 10. `20261022000200_platform_presence.sql` adds the
  Presence policies `madar_status_track` (insert, only the topic `status:<own id>`) and `madar_status_read` (select, any `status:`
  topic), never for an agent token or a turned-off person." "`20261022000300_read_indexes_perf2.sql` (speed release perf2) ..."
  "`20261026000200_agent_confirms.sql` (the email code guard of agents, owner 2026-10-26) ... Its SQLite twin is
  `LITE_SCHEMA_VERSION` 11." (stale: it is 12)
- "Until the switch (wave 6), a new table or column needs both: a migration here and the SQLite schema with a new version."
- "CLI 2.121.0 starts Postgres `17.11.0.004` and Realtime `v2.143.4`." "(`npx supabase`, version 2.121.0 since 2026-10-20)".
- "The `config push` diff still says `api.enabled` true after every push (2026-10-05)". "Management API logs ... gone
  (2026-09-23) ... works (2026-10-21)".
- "`jwt_expiry = 900` (15 minutes, Z7)". "Every `all.sh` run deploys them, also when `config/server-host.json` says `workers` (owner,
  2026-10-16)".

## tests/CLAUDE.md
- "Playwright `webkit` (26.6)". "`npm run test:office` also runs the live suites (`server/office/{batch,socket,cron,mcp}.wd.test.ts`)
  on the test Worker of `server/office/test/live/`; the harness makes a key of the own sign-in for each run (the MCP suite signs
  its agent tokens with it)." (moved to root Commands)
- "All must pass at each screen merge (135 of 135 on 2026-10-25) ... (about 8 minutes in all)". "(the notices swipe of fbk_052,
  2026-10-25)". "(`acceptance.spec.ts`, 2026-10-12)".
- "The role of that line is `madar_server`, and the walk then fails its sign-in and email steps with "permission denied for schema
  auth" (2026-10-22)."
- "On the office path (exit wave 4)". "Flags: ... `MADAR_E2E_WALK=1` (the whole-product walk, `walk.spec.ts`; its step 15 checks that
  the old `/admin/usage` link shows no Usage section, since 2026-10-23). ... Its first case also checks that the tool list of the
  test copy holds the three chat tools (2026-10-12)."
- "The download fallback takes a signed link of Storage or of the R2 test bucket (owner, 2026-10-16)."
- "The screens before sign-in are light unless the device saved a theme (owner, 2026-10-05)."

## .github/CLAUDE.md
- Intro story: "The pushes of October 2026 used them all by 2026-10-17 13:08 UTC: GitHub then refused every job ... (no card is on
  the account; nothing failed), also the nightly database backup. Since 2026-10-18 (owner) `ci.yml` and `ci-stack.yml` start only by
  hand, the merge gate runs on the Mac, and the minutes go to the backups first. While GitHub refuses, the database backup runs from
  the Mac (see "Backups by hand")." GitHub shows the 2,000 minutes "as $12 of included use".
- "The time of a backup release is `publishedAt`, never `createdAt` (2026-10-17). ... Every release of madar-backups points to the
  one commit of 2026-10-05. With `createdAt`, the age check failed every night from 2026-10-12 (a false "282 hours old" mail), and
  the remove step would have removed every backup, the new one too, from 2026-11-04."
- "`files-backup.yml`, Friday 03:07 Riyadh: rclone sync of the file store to a Backblaze B2 crypt remote. PAUSED since 2026-10-05
  (`disabled_manually`): it waits for the owner's B2 account (`B2_KEY_ID`, `B2_APPLICATION_KEY`, the S3 key of the store, the crypt
  password and salt). After those secrets: `gh workflow enable "Files backup"`, then one run by hand." "After the production switch
  to R2 (owner, 2026-10-16), the source of the file backup is R2 ... The steps: 1. The owner makes the R2 token
  `madar-production-backup` in the dashboard: Object Read only, the bucket `madar-files` only. ..." "Owner decision 5 (R2 alone,
  owner 2026-10-18)". "`--files-lag-days`: 8 (the default) for the weekly B2 copy".
- "`ci.yml` takes about 15 minutes." "The token of this Mac has [the workflow scope] (2026-10-17)."
- "`--if-due` (owner, 2026-10-20): every session runs it on each owner message, from the fixed copy in `~/dev/madar-rb/mac-backup`
  (root CLAUDE.md). `scripts/backup/due.ts` decides. No backup in 08:00 to 17:00 Riyadh, none when the newest successful "DB backup"
  run is less than 26 hours old, none when a `madar-db-` release is less than 18 hours old, and none from 1 November 2026
  (Riyadh). It orders the releases by `publishedAt`." (contradicts the root rule of 2026-10-20 "only when the owner asks"; the copy
  folder is gone)
- "The private key is not on the Mac (deleted 2026-10-05 after a match check with `age-keygen -y` against
  `BACKUP_AGE_RECIPIENT`). The owner holds the only copy."
- "While GitHub refuses jobs (October 2026): `scripts/backup/mac-backup.sh` on the Mac, each evening after 17:00 Riyadh".
- "Office backup (exit wave 4)", "(wave 5: the test copy)".

## functions/CLAUDE.md
- "`api/[[path]].ts`: the page's own `/api` (owner, 2026-10-16)". "`.well-known/...` (exit wave 4)".
- "`map/[[path]].ts`: the same-origin street map files (fbk_017, probe of 2026-10-18) ... The screens do not use it since
  2026-10-19: they read the free OpenFreeMap tiles ... It has no host list; the binding waits for the owner OK (proof.md, Map
  basemap probe)."
- "`maplink.ts` ... (audit 2026-10-19, PRJ-03)". "`satellite/[[path]].ts] ... (owner, 2026-10-20)": "gives each Esri call 8 s and one
  more try, ... lets the browser keep a tile for a day ... Each tile is one Functions request (about 30 for a view)."
- "A same-host forwarder of `POST /api/batch` to the Supabase function was built and measured (2026-10-08, performance audit
  FET-10), then removed: it added 20 to 50 ms to every call. WebKit browsers use it again (2026-10-22, DF-12 and LV-6) ... The api
  forwarder of 2026-10-16 is for the Worker host ... The owner rule: the Worker stays only if it measures faster
  (`scripts/proof/server-time.sh`)."
- "The build of 2026-10-16 is about 24 KB for both functions." (stale: seven functions now). "(checked 2026-10-05)".


The history text that the cleanup removed from the guides. Old line numbers refer to `src/CLAUDE.md` at commit 615d6030.
The rules that the dates explained stay in the guides, without the date story.

## src/CLAUDE.md

### Two builds from one source
- FL-10, 2026-10-21: `zodConfig.ts` imports nothing from zod. It sets `jitless` in place on the one object that zod keeps on
  `globalThis.__zod_globalConfig`.
- Performance audit BND-1: the remote build splits each screen into its own chunk.
- Follow-up 2026-10-22, idle prefetch: "Before, it started at the first render and sent 66 chunk requests (446 KB) before the first Home rows; the
  lab (Pixel 5, 4G, CPU 4x, local build) now sends 2 (35 KB, the word files)." FL-8 2026-10-21: `app/prefetchRules.ts` skips the five sign-in
  screens when a session is stored, and Admin when the cached `session.get` cannot open it.
- FL-3, 2026-10-21: the sheet packages go into an `overlay` chunk. FL-5: the stand-in for the unused Supabase clients is "12 KB gz less".
- The API address (owner, 2026-10-16). The word `office` is "exit wave 4"; "No copy sets it before wave 5".
- WebKit own `/api` (performance audit DF-12 and LV-6, owner 2026-10-21: "we have safari users on iphone"). Measured on the test copy on
  2026-10-22, WebKit 26.6 with the iPhone 15 profile, 15 rounds each: direct with a preflight 656 ms (p90 768), direct with a cached preflight
  370 ms (p90 459), the page's own `/api` 383 ms (p90 417); Chromium 660, 378 and 378. A preflight kept 9 minutes was still in the cache, one
  kept 11 minutes was gone (edge logs: the OPTIONS showed only at 11 minutes). So the forwarder costs about 13 ms more than a cached
  preflight and about 275 ms less than a new one. Chromium keeps a preflight for 2 hours. The CSP needs no change (`connect-src 'self'`).
  "Not measured on a real iPhone; the cap comes from WebKit code that Mac and iOS share." (The reason and numbers now sit in
  `functions/CLAUDE.md`.)
- Perf2 GP-1, 2026-10-22: the access token lives 15 minutes, and a page that opened later waited for the renewal (one preflight, one refresh
  POST, about 0.5 s) before the first frame. `createSupabaseAuth` now reads the stored value with `storedSupabaseUser`.
- `check-bundles.ts` size history: "It stays at 970,000 B raw, 296,000 B gzip (level 9, each file) and 35 files or fewer (FL-11: the real
  size after the speed release of 2026-10-22 is 941,244 B, 286,908 B and 34 files, so a limit sits about 3 percent above it". An older limit of
  1,350,000 B sat 113 KB above the real size (comment in `scripts/check-bundles.ts`). `api/adminReach.ts` was split out on 2026-10-26 so a
  first-load file does not pull `chatState.ts`.

### Google Calendar in Settings (owner, 2026-10-19, fbk_022)
- Section order: after the push section; "one section with the fewest controls".

### The Daftra part of the payment sheet (owner, 2026-10-26)
- "Madar only reads Daftra." The states 0 to 4 and 5 and 6 are the numbered states of the Daftra design. The search starts with the name of
  the project client, then waits 350 ms after each key.

### Browser push in the screens (owner, 2026-10-08)
- The push line (owner, 2026-10-21, "Like WhatsApp"): `push.register` takes the browser keys.
- No notice while Madar is in front (owner, 2026-10-23, fbk_028): `public/sw.js` shows no line when a window of Madar is visible and has the
  focus, in Chromium only. Firefox and an unknown engine show it. WebKit (Safari, and every browser on an iPhone) revokes the subscription of a
  site that gets a push and shows no notice, so there the line always shows, as the first thing the worker does. Record: `server/push/CLAUDE.md`.
- Push is on by default (owner, 2026-10-09). DF-11, 2026-10-21: the screens call `syncDeviceOnce`.
- The Home Screen (owner, 2026-10-20), until the store app comes: three cards in order (push ask, iPhone steps, Android install). "Apple lets no
  page start the install, and a Home Screen app keeps its own storage, so step 3 says to sign in there." Chrome gives the install event once.

### Insight (PostHog, owner 2026-10-25)
- The privacy options that `client.test.ts` pins: ids in `sessionStorage` (no lasting id), `person_profiles: 'identified_only'` (Madar never
  calls `identify`), clicks only for autocapture, no network timing, no console, masked inputs, no referrer and no campaign values saved.
  `before_send` adds `env` and `build`, and adds `personId` and `personName` to a `$exception` record only. The scrub walks every nested value
  and cleans every string with `scrubText`.
- Why no proxy: "the replay packets could use the 100,000 requests a day of the free plan". The CSP also needs
  `https://eu-assets.i.posthog.com` ("the settings of the project as JSON: without it, PostHog keeps the replays and the click records off").
- The posthog-js build: `posthog-js/dist/module.full.no-external`, with the replay recorder, the web vitals and the error capture inside.

### The project pin and the map (owner, 2026-10-18, fbk_017; the free map since 2026-10-19)
- Speed audit 2026-10-21, FL-17 and LV-10: the load order of the map. The library is "about 300 KB gz".
- Zero cost (owner, 2026-10-19). The satellite exception (owner, 2026-10-20): "No free service with no account has pictures sharp enough for a
  plot, and Esri's terms ask a business for an account, so the maps use Madar's own key of the office's Esri account (ArcGIS Location Platform,
  2,000,000 basemap tiles a month at no cost, shared with Kutla; the key ends on 2027-10-19, renew it before). The browser never asks Esri: one
  of its edge addresses never answers from Saudi networks (measured by Kutla, 2026-10-12)." The key facts must live in `functions/CLAUDE.md`.
- Worker policy header (2026-10-19): `releaseUrl` adds the release to the worker address.
- The Location text is the address of the pin (owner, 2026-10-19). The credit is a small button inside the map, "never a line under it
  (owner, 2026-10-19)". The About panel shows the pin at its top "in place of the cover picture (owner, 2026-10-19: 'the map is better')".
- The Files & Links tab (owner, 2026-10-19): the tab keeps its key `files`. Download all (owner, 2026-10-22, fbk_050): ZIP names
  "<project key> <stage name>.zip" and "<project key> <project name>.zip". Folders (owner, 2026-10-26, fbk_066): one level, always in a real stage.
  A person who may not upload sees only groups with files or folders.

### Data on screens
- 2026-10-20: the chat reads read `preferences` (the Admin's "What reaches me"), so `readMap.ts` needed the kind.
- Perf2 savetrip, 2026-10-22: "before, the second one left the request and a second request followed" (the two person lists of Tasks and Home
  cost 1 each). Performance audit FET-3: the prototype sends the write alone. LV-2, 2026-10-21: the echo of the own write.
- LV-3, 2026-10-21: the chat signal waits 150 ms (`chatMs`), "so a chat message shows 0.85 s sooner". Perf2 SV-7 and DF-2 (owner, 2026-10-21): a
  direct chat or a group reaches only its members.
- BG-4 step 1, 2026-10-21: the `heartbeatCallback`; realtime-js 2.117.2 never passes 'disconnected' to the callback, so 'timeout' does the work.
  The worker option (step 2) "waits for the owner". DF-4, 2026-10-21: the join within `VISIBLE_MERGE_MS` adds no second pass.
- Exit wave 3: the office build `VITE_MADAR_LIVE=socket`, "set by no build before wave 5": a ticket, a ping each 30 s, a new socket and a
  reload of every list when no pong comes in 10 s.
- Role rights version 2, 2026-10-21: hide every control that the call would refuse. The `ai.connect` line: "The Admin turned off AI assistants
  for your role." (`agents.off`, `errors.reasons.ai_off`).

### Speed (performance audit 2026-10-07)
- FL-1, FL-4 (2026-10-21): the lazy parts. "a plain `React.lazy` adds about 500 ms to the first press". The loop story: an import of `screens.ts`
  in `importReload` "made a loop through every screen in the prototype dev server, and plain `npx vite` showed an empty page".
- RN-4 (2026-10-21): `useBubbles` reuse by `replaceEqualDeep`. RN-2 (2026-10-21): `whenIdle`, 200 ms where `requestIdleCallback` is missing; the
  Inbox list draws its first 40 rows through `useStaged`. DF-14 (owner, 2026-10-21): the last Home lists stay on the device (IndexedDB
  `madar-home-cache`; start gives up after 150 ms; ignores a record of another build, another person or over 7 days; write at most once a minute;
  never over 1 MB). The Home role hint (owner, 2026-10-26, fbk_065): `admin|mine`, `admin|all`.
- DF-5 (2026-10-21): a closed sheet reads nothing. DF-6: Home starts `meetings.list`. DF-7 (2026-10-21): guard reads. LV-9 (2026-10-21): press reads.
  DF-13: the To-dos tab `templates` option. BG-7: picture rows use `useNearView`. `LINK_STALE_MS` is 8 minutes.

### Sub-companies, the Open space and the people stack (review 2026-10-19)
- The tile cut (owner, 2026-10-20). A new profile picture gets the frame step (owner, 2026-10-23, fbk_029): previews round at 72, 40 and 24 px;
  the saved picture is 128 px and must fit 16 KB.
- Open space "Detail" control (fbk_055, 2026-10-25). Four card kinds measured in Chrome on 2026-10-25 (sub-company 80, deadline 58, checklist 42).
  "The sample office copied 5 times (about 970 cards at the To-dos step) lays out in under 3 ms." Fit floors 0.7 (0.45 on a phone), ceiling 1 up to a
  1400 px window and up to 1.6 at 2200 px.
- The leader ring (owner, 2026-10-26, fbk_060): `ring-[1.5px] ring-ink` with a 2 px gap (`bg-card p-0.5`); the first team picture sits `ms-2`; the
  Projects list set 32 px for the leader (owner, 2026-10-26: 34 was too big) and 26 px for the team. Production 2026-10-26: "an oval leader ring"
  because a photo (an inline img) in a plain box gained a text-line gap.

### Routes and shell
- Admin sections (owner, 2026-10-18, fbk_014): a section with `right` opens for each person who holds that right. "Management reads the role of a
  person as text in the person sheet (owner, 2026-10-18, fbk_014)."
- Project templates: "ADM-06" template editor. Fbk_031 (owner 2026-10-23): "a person could not pick the stage of a task, new or old" (the Stage
  field). Apply a template (owner, 2026-10-19, fbk_020).
- Focus mode: fbk_059 changed the dialog from `z-[70]` to `z-[35]`. The Focus chat (fbk_059, owner 2026-10-25) with a docked sidebar "no card look;
  owner 2026-10-25", the compact box "owner 2026-10-25".
- Tasks: office tasks (owner, 2026-10-06). The Board of Tasks (fbk_042, Faisal, owner 2026-10-22). Drag order (owner, 2026-10-07 and 2026-10-08);
  review 2026-10-25 (the Home Today two groups); fbk_043 (the checklist grip).
- The project To-dos tab (fbk_005 and fbk_006, 2026-10-11). The lead button crash (fbk_064, 2026-10-26, Faisal): "a tab that opened before a release
  asked for a chunk that the host no longer has, and Cloudflare answers such a request with the HTML page (status 200, `text/html`, measured on
  production), so the import failed and a plain `React.lazy` threw into the route error page. ... The press never reproduced in the tests with data
  (internal project, maker who is not the leader, wire form): the chunk was the cause."
- Stage ends (fbk_004, 2026-10-11, V-32). Admin People "Remove from the list" (owner 2026-10-12). Requests and bugs tabs (fbk_067).
- Roles: "Roles: Admin, Management, Accounting, Member; per project a leader and a team. Anyone creates a project and leads it. ... Payments only for the
  payment right (by default Admin, Management, Accounting; fbk_014). Agents never join a team. The person who adds a project task changes and deletes
  it like the leader while on the team; the review stays with the leader (owner, 2026-10-07)."
- The rights list with dates: "The rights are 121 switches in 13 sections (role rights version 2, owner 2026-10-21; the Money switch
  `payment.daftraLink` joined on 2026-10-26 and Accounting holds it by default; the AI switch `ai.projectSetup` joined the AI section on 2026-10-25
  and is off for every built-in role except the Admin; `ai.admin` and `ai.myState` joined on 2026-10-26, MCP parity". The role sheet layout: the All
  control, "4 of 9 on", "Holds 66 of 121", "Back to the standard list", the AI lines, "A person who makes a project leads it." These counts live in
  `src/api/rightsCatalog.test.ts`.
- Home (fbk_026, owner 2026-10-19): the day ring shows its words. `comingUp` (owner 2026-10-07).

### The phone shell (Direction D, owner 2026-10-22)
- "Wave 1 (the shell) never ships alone: it needs the Me hub of wave 2." The four icon-only tabs (owner, 2026-10-22). Each tab 48 px high, 24 px
  icon; the bar is 60 px high. The hide hook story: a full-page screenshot sets the window to 1 px and back. Review 2026-10-25 (task panel typing,
  Home meetings tick). The 400 ms hold, 8 px, 250 ms click guard.

### Hidden and internal projects (owner, 2026-10-22, fbk_044)
- Words: `src/i18n/real/batchd4.*` (`project.internal`, `project.hiddenMark`, `projectForm.kind*`, `projectAccess.*`,
  `errors.reasons.internal_project`). The role sheet needs no change: the four switches come from the catalog (words `batchd`). The prototype office
  "Portfolio 2026": open it as the Admin, Reem Al-Ghamdi (leader) or Lina Mansour.

### Reminders, No lead and quiet lines (owner, 2026-10-19; fbk_024, fbk_025, fbk_027)
- Paused banner, No lead row, reason lines. These are now rules in the project, dashboard and inbox guides.

### Chat messages (track msg, 2026-10-19)
- Items B14 (instant send), B15 (reply strip press), B16 (task panel chat look, design item 6), RN-3 (2026-10-21, row menu on touch).

### Inbox, groups and What's new (owner 2026-10-18; UX audit 2026-10-19)
- Kind menu (owner, 2026-10-20), the persistent kind (owner, 2026-10-23), the "other chats" line (fbk_056, owner 2026-10-25).
- "No 'Waits for your reply' line (owner, 2026-10-19 and 2026-10-20, fbk_028; it wins over item 22 of the chat design, whose waits rule stays in the
  API for `chats.waiting` and the agents)."
- Design items 5, 14, 16, 17, 18, 21, 23. What reaches the Admin (owner, 2026-10-23); the lists change (owner, 2026-10-26, fbk_065).
- Every chat takes files (owner, 2026-10-19). Paste and drop (fbk_030 and fbk_032; the chat part is design item 14, "which won at the join of
  2026-10-20"). Download all (owner, 2026-10-22, fbk_050). Picture preview (owner, 2026-10-19), zoom (fbk_038), long file names (fbk_040).
  `BIG_PICTURE_BYTES` (2 MB) decodes to 960 px wide "so a big phone photo no longer holds about 190 MB first (owner, 2026-10-22)". Upload bars
  (fbk_045), drop spots (fbk_046, fbk_047).

### Chat reading (track read, 2026-10-19) and Who is here (chat presence design, 2026-10-21)
- RN-1 (2026-10-21): first mount of 60 bubbles. DF-10 (2026-10-21): `knowsState`. RN-8 (2026-10-21): emoji groups at idle. Emojibase 17.0.0 and
  CLDR 48.2.0 "installed outside the repo". Constants: `ACTIVE_MS` 10 min, `REST_PHONE_MS` 60 s, `REST_COMPUTER_MS` 30 min, `TYPING_SHOW_MS` 8 s,
  `TYPING_SEND_MS` 5 s.

### Meetings screens (owner, 2026-10-19, fbk_022)
- Words (owner, 2026-10-20): "Tasks" names the umbrella of to-dos and meetings; English "to-do", Arabic «مهمة» (rule now in `src/i18n/CLAUDE.md`).
  The meeting sheet footer (owner, 2026-10-23, fbk_037, Faisal; "the '...' menu is gone"). The WorkSwitch row (owner 2026-10-23). Minutes: waves
  2 and 3 (owner 2026-10-19), "no Minutes by: any attendee writes the minutes". The privacy page: "The Google Auth Platform needs its link to
  publish the app."

### Design rules
- The standing notice rule (owner, 2026-10-20). Toast rules (fbk_052): 8 seconds with Undo, 5 seconds otherwise.
- The tile shape (owner, 2026-10-26, fbk_061): path limits "starts with M; 2000 characters at most"; draws at 62% of the tile (the random form
  stays at 45%; the cover of a project card uses 47% against 34%).
- Chat text and typed text follow their own language (owner, 2026-10-19). The date popover and `Popover` in a dialog (UX audit 2026-10-19, chats-02).
  The raw bidi mark check story (2026-10-20, 2026-10-21). The project Arabic name (owner, 2026-10-26, fbk_062). `CodeAnywayTick` (fbk_003).
- Person menu (owner, 2026-10-26, fbk_063): "make them one button" for Mode and Language.
- Deleted lines: "The owner likes to choose a visual style from a side-by-side comparison artifact." (an owner preference, not a code rule).

### Quiet hours and the Everyone row (owner, 2026-10-22, fbk_048 and fbk_041)
- Words of fbk_049; order of the quiet line (fbk_051); `batchb.*` words. Continuous project (owner, 2026-10-26, fbk_069).

## To merge into other guides (rules that the home map places outside my files)
- `src/i18n/CLAUDE.md` "What's new" (lines 45-64 on 2026-10-27) already holds the id, day and order rules. The incident stories stay here: 2026-10-26, a person
  who saw the usage entry never saw "New" again, and the page showed 25 Oct, 26 Oct, 25 Oct.
- Into `functions/CLAUDE.md` (the Esri key facts are not there yet): the key is the office Esri account key (ArcGIS Location Platform, 2,000,000
  basemap tiles a month at no cost, shared with Kutla), it ends on 2027-10-19 (renew it before), and the browser never asks Esri because one of
  its edge addresses never answers from Saudi networks (measured by Kutla, 2026-10-12).
- Into `src/i18n/CLAUDE.md` line 13: the powers count "84" is wrong. Remove any count and point to `src/api/rightsCatalog.test.ts`.


History text taken out of the guides, in the original words (trimmed where it repeated). The rule that each decision set
stays in the guide, without the date story.

## src/api/CLAUDE.md

### Rules (user avatar, project names, tile shape)
- `Project.nameAr` is the same for a project (fbk_062): optional, trimmed, 120 characters at most; `projects.create` leaves it out when it is empty, and `projects.update` with an empty value clears it.
- `Project.shape` (owner, 2026-10-26, fbk_061) is the own drawn shape of the tile: `ProjectShapeText` (an SVG path in the box 18 by 18, 2000 characters at most, or an empty text for none). A project with no shape gets an empty text before the first set, so the History holds a value that Undo brings back (a missing key is lost in JSON).

### Rules (first load, batcher)
- Batcher: "the cheap person lists of a screen cost 1 each, perf2 savetrip" (speed release of 2026-10-22). "Else the read goes as any other call, and RemoteApi does not name it as fresh."

### The project code (owner, 2026-10-05)
- Project code format `YYMMSSINI-CLS-Type` decided 2026-10-05. Old codes (`KH-26-014`) stay valid.
- "The automatic code (`nextProjectCode`, also every INT code) counts only codes whose end after `<prefix>-YY-` is all digits, so a kept code with that head never gives "NaN" (2026-10-25)."
- MCP (owner, 2026-10-25; MCP parity 2026-10-26): `projects.create` is on the right list (`project.create`), `clients.create` too (`client.create`), and `clients.list` is on the allow list. All four need the AI switch `ai.projectSetup`, off by default except for the Admin. A new project has no Undo (`NOT_UNDOABLE`). The agent gets lean `clients.list` rows (no contact name, phone or email).
- A person may keep a code of their own (feedback fbk_003, 2026-10-12). A new or changed code is visible text of 1 to 60 characters (`FREE_CODE_PATTERN`): only visible characters and the plain space, nothing outside the basic plane, so a code always shows as it is saved.

### The Tracker type Government (owner, 2026-10-12)
- The screens call the type `balady` Government: any government body, not only the Balady portal. The stored value stays `balady`, so the contract, the data and the agents keep it.

### Project templates (owner, 2026-10-05, item 6a)
- A new template needs `templates.projectCreate` (off for a Member by default, owner 2026-10-21).
- Template tasks and stages can wait for other parts of their own template (`prerequisiteIds`, fbk_008).
- A task may move to another stage of its template (fbk_031, owner 2026-10-23).
- Stage templates merged into project templates. "Version 9 and the migration `20261005000100_project_templates.sql` made one project template from each stage template, once."
- Link an older project (fbk_008 item 4). Both calls are MCP tools since the MCP parity track (owner, 2026-10-26; `ai.projectSetup`).
- Apply a template to an ongoing project (owner, 2026-10-19, fbk_020). All five calls are MCP tools since the MCP parity track (owner, 2026-10-26; `ai.projectSetup`): their `TOOL_DOCS` say to ask the person first.
- Update of linked projects (fbk_008 item 4, Admin only). All three are MCP tools since the MCP parity track (owner, 2026-10-26).
- The team's own edits stay (ADM-01). `projectTemplates.list` gives the Admin `followers`.
- Template links (fbk_008 item 4).

### Health and the Dashboard (owner, 2026-10-06)
- A past-due task puts its project At risk only from 3 calendar days past due (owner, 2026-10-06). `isOverdue` still counts it from day 1.
- `dashboard.get` `workload.unassigned { overdue, counts }` (fbk_024, owner 2026-10-19) is the No lead row of the People tab.

### Sub-company filter (fbk_007 review, 2026-10-19)
- Filter by sub-company, `no_sub_company`, `search.query` `subCompanies`, `subCompanies.list` `projectCount`, `subCompanies.delete` with `moveToId`: all from the review of fbk_007, 2026-10-19.

### Office tasks (owner, 2026-10-06)
- Chats and groups (UX audit 2026-10-19). Mark as unread (owner, 2026-10-19, fbk_028). "owner, 2026-10-20: Mark as unread is the one reminder": no screen reads `chats.waiting` any more.
- `search.query` has a `messages` group (chat design 2026-10-19, item 16). Direct chat with no live message (chat design 2026-10-19, item 18). Chat that may not be opened answers `not_found` (chat design 2026-10-19, item 17). `chats.messages` with `around` (item 17). Notify me (item 21, `readMentionNotices` design item 20, `countsNamedOnly` item 23).
- Files of a direct chat or a group (owner, 2026-10-19). "An agent follows exactly the rights of its person (owner, 2026-10-26; it was refused before)".
- `Attachment` carries `mimeType` (owner, 2026-10-19).
- A fifth hidden-notice function, `noticeProjectHidden` (hidden projects, wave D3). A fourth, `hiddenMeeting`, for a meeting with no project (fbk_022).

### Task makers (owner, 2026-10-07)
- The lead of a project task holds `task.deleteOwn` too (fbk_034, owner 2026-10-20): "a task can go into the wrong project". A delete by anyone but the maker sends the maker the in-app notice `task_deleted`.
- `tasks.help` (fbk_035, owner 2026-10-20): a person on the team (`task.help`) joins a project task as a helper, or leaves it, with one tap. The lead gets `helper_joined`; a leave tells nobody.

### The shared order of tasks (owner, 2026-10-07)
- `Task.rank` decided 2026-10-07: everyone who sees two tasks in one group sees them in the same order. On the Tasks screen the tasks the person may move come first, then the tasks they only help with. Home shows only the tasks the person may finish.

### Remove a person (owner, 2026-10-12)
- "No screen brings a removed person back, so the sheet asks first and has no Undo." MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.admin`, right `people.remove`).

### Facts of a row for the list screens (feedback, 2026-10-11)
- `ProjectSummary.stageEnd` and `TaskRow.canEditPeople` came from feedback of 2026-10-11.

### Requests and bugs notices (owner, 2026-10-07)
- Five statuses (fbk_067). "A rollback to a release before fbk_067 cannot read a report with a new status."
- "A former Admin sees an old `feedback_sent` notice as gone ... An Undo never deletes it, and a new promotion shows it again while its report still exists."

### Copies for the Admin (owner, 2026-10-23)
- Decided 2026-10-23 with the setting `adminReach`.

### Browser push devices (owner, 2026-10-08)
- Devices decided with free browser push (owner, 2026-10-08). "A person keeps 10 devices at most; the oldest goes."

### Google Calendar (owner, 2026-10-19, fbk_022)
- "none can work for an agent (MCP parity, owner 2026-10-26)". The calendar named "Madar" is the one Madar made before (it remembers the id, and a disconnect keeps it).

### The project pin (owner, 2026-10-18, fbk_017)
- "**The Location is the address of the pin (owner, 2026-10-19).**"
- MCP: `TOOL_DOCS` of `projects.update` (600 characters, at the limit), and the `Place:` line of `INSTRUCTIONS`. `samples.json` holds inputs only, so it did not change.

### Office rights and roles (owner, 2026-10-18, fbk_014; role rights version 2, 2026-10-21)
- Count history: "The rights are 121 switches in 13 sections (...; 92 powers; "Mention everyone" joined the Chat section on 2026-10-22; the four hidden-project rights joined the Projects section on 2026-10-22; the AI switch `ai.projectSetup` joined the AI section on 2026-10-25; the AI switches `ai.admin`, "AI does Admin work" (off for every built-in role), and `ai.myState`, "AI changes my own marks and settings" (on for every built-in role), joined it on 2026-10-26 with the MCP parity track; the Money switch `payment.daftraLink`, "Link Daftra invoices", joined on 2026-10-26: it needs `payment.view` and Accounting holds it by default; `MAX_STORED_RIGHTS` is 127)."
- "`BASIC_ON` is the 67 switches a Member holds" (it was 68 in the code; the count now sits in `rightsCatalog.test.ts`).
- "Caps: `rights` 120, `off` 70." (`MAX_STORED_RIGHTS` is 127 in the code.)
- Gone stand-in actions of the first release: `project.edit`, `project.changeLeader`, `project.healthOverride`, `project.editCode`, `content.post`, `content.editOwn`, `task.createForSelf`, `task.createForAnyone`, `task.updateOwn`, `task.updateAny`, `task.contribute`, `task.delete`, `meeting.create`, `meeting.edit`, `meeting.minutes`, `event.undoAgent`, and the 10 old office rights as actions. The 17 old stored ids are in `LEGACY_RIGHTS`.
- "`roles.*`, `users.create` and `users.update` are MCP tools since the MCP parity track (owner, 2026-10-26; `ai.admin`), and an agent still cannot undo them."
- `roles.delete` takes `moveTo` (ADM-14).
- The gates of the office calls (track gates-office): the full list of which call asks which switch is in the handlers (`assertCan`) and `rr2Office.test.ts`.

### The office report (owner, 2026-10-18, fbk_016)
- A range (owner, 2026-10-21): `period: 'range'` with `from` and `to`, both days included. `trend` (owner, 2026-10-21): the to-dos made and done in each of the 6 weeks. "Past due (the tasks and the money) counts to today while the period has not ended (`dueEnd`, owner 2026-10-21): on a Wednesday, a to-do due on Thursday is not past due yet."
- "`guide: true` adds `guide`: `REPORT_GUIDE` ... It started as the owner's Claude skill "madar-office-report". Only on request, because it is about 17,000 characters."

### The due notice of a payment / The Daftra link (owner, 2026-10-26)
- Decided with the Daftra link of 2026-10-26. "A payment that is already past due on release day gets none."

### The restart reminder of a pause (owner, 2026-10-19, fbk_025)
- "The restart date of a pause (`pause.resumeOn`) is a reminder. Madar never restarts a project by itself: a person resumes it." MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.projects`).

### Quiet lines of a task thread (owner, 2026-10-19, fbk_027)
- Quiet lines decided 2026-10-19.

### Edit, delete and react to a chat message (chat design 2026-10-19, items 11 and 12)
- "In a direct chat or a group their signal goes to the members only, as a person signal (owner, 2026-10-21; it replaces the nameless office signal of INT-16)." MCP: edit, delete and the reaction are tools since the MCP parity track (owner, 2026-10-26).

### Meetings (owner, 2026-10-19, fbk_022)
- "The Admin has no extra right there (owner, 2026-10-19, Q4: this differs from an office task)": a meeting with no project is read by its organizer and attendees only.
- `minutes_not_attending` (wave 1 only: no call raises it since wave 2, but an old answer can name it).
- "`Task.meetingId` and `Meeting.minutesTaskId` are in the contract and nothing sets them since the owner dropped the minutes task (2026-10-19)." "The person for the minutes is gone (owner, 2026-10-19)."
- Repeating meetings (wave 3, owner 2026-10-19, Q7). "A cancel for "later" is the choice of the person to stop the series (owner, 2026-10-23: the users decide if a meeting repeats, not the platform)". "a cancelled last meeting does not end a series (owner, 2026-10-23)".
- `meetings.extend` ... "the caller must see the last meeting and may change it (review 2026-10-20)".
- Delete (owner, 2026-10-23). MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.meetings`).
- Settle (wave 2, owner 2026-10-19). "The author of the line (`createdBy`) is always the organizer, whoever settles ...; the events name the caller as the actor (security fix, 2026-10-19)."
- Files of a meeting with no project (wave 2, owner 2026-10-19; the pattern of the chat files). The minutes (wave 2, owner 2026-10-19).
- Sample office: one client meeting of an open project and one meeting with no project for the Admin and a leader (`data/sampleMeetings.ts`).

### Hidden projects (owner, 2026-10-22)
- "Design: `docs/superpowers/specs/2026-10-22-madar-hidden-internal-projects-design.md`. Wave D1 builds the core." Waves D1 (core, doors), D2 (lists), D3 (signals and the outside), D4 (internal projects, fbk_044).
- Four rights joined the catalog: `project.seeAll` (See every project) and `project.access.lead` (Choose who sees a project, Projects I lead) are basic and on for every role. `project.access.all` and `project.hidden` (See hidden projects) are for the Admin only. "The Admin always holds every switch (`heldSet`), so an Admin without `project.hidden` cannot exist. Management can get it."
- "A state that holds no delete event reads such a project as open, so a loader must bring the delete event (wave D2)."
- "`settleActorOf` and `extendActorOf` fall back to an Admin." (wave D3)
- Internal projects: the sample office adds one internal project, "Portfolio 2026" (`src/data/sampleInternalProject.ts`; `buildSeed` does not).

### A new call: the checklist
- Server-only call count history: "There are 18 server-only calls (`usage.get` and `usage.retryEffect` were removed, 2026-10-23); `live.ticket` (exit wave 3) is the 9th, and the four `google.*` calls (fbk_022) follow it; `chats.typing` (chat presence design) is the 14th; the four `daftra.*` calls (the Daftra link, 2026-10-26) are the 15th to the 18th."

### Folders of the Files & Links tab (owner, 2026-10-26, fbk_066)
- "Choice: the folders live in the project record, as its links do, and not in a table of their own. So a folder is seen by exactly the people who see the project and its files (the hidden-project doors guard it with no new rule), the office cache and the loaders need nothing new, and no migration or `STATE_VERSION` step is needed."
- MCP: the four calls are on the allow list (`ai.projects`).

### Prototype data
- "The sample office has one custom role, Cashier (`rol_001`, held by Khalid Al-Mutairi), and the project Seaside Villa Compound (KH-26-007) is linked to the template "Villa, full design" (`linkSampleProject`, matched by name, as the link sheet does). No project was added, and `STATE_VERSION` stays 9: the fresh seed has these records, a saved office keeps what it had."
- "The two feedback triggers needed no new `STATE_VERSION`: the switch record is partial, and `inAppOn` reads a missing key as on."

### Tests
- "A long leak sweep needs its own timeout there (about 11 ms a call)."

### Quiet hours and @everyone (owner, 2026-10-22, fbk_048 and fbk_041)
- Defaults decided 2026-10-22: Sunday to Thursday, 8 AM to 5 PM, the lock on with the same days and hours, quiet hours on. Days 0 = Sunday to 6, at least one, `from` before `to` on a 30-minute step.
- `chat.mentionEveryone` is a basic switch, on for every role.

### A continuous project (owner, 2026-10-26, fbk_069)
- "`Project.continuous` is an optional boolean: a project that never ends (an internal tool, a retainer). ... Every project starts with it off, internal ones too." Health: the "stage ends within 7 days with less than 70% done" At risk rule skips it; a to-do 3 or more days past due still makes it At risk; a health override still wins.

## src/i18n/CLAUDE.md

### Files (the track list)
- The list of build tracks (agents, auth, core, files, h, mail, notices, p, people, q, s, dash, office, fbnotices, fbadmin, push, teama, meetings, rr2sheet) and what each track file holds, by owner batch:
  - `rr2screens` (role rights version 2, 2026-10-21): `agents.off`, `errors.reasons.ai_off`, `chat.cannotSend`.
  - `rr2sheet` (2026-10-21): `roleRights` (13 sections, the label and the line of each of the 84 powers [the file has 88, the catalog 92]), What's new entry `2026-10-23-75`.
  - `teama` (team-requests batch of 2026-10-19; fbk_024, fbk_025, fbk_027). `meetings` (fbk_022). `chatfind` (chat search, 2026-10-19). `chatmsg`, `chatread`, `chatnotify`. `series` (repeating meetings, fbk_022 wave 3).
  - `adminreach` ("What reaches me", owner 2026-10-23; What's new `2026-10-23-69`). `space2` (Open space levels, fbk_055, 2026-10-25). `daftra` (owner 2026-10-26; What's new `2026-10-23-113`). `fbk067` (five statuses; What's new `2026-10-23-119`; `settings.triggers.feedback_done` edited in place in `fbnotices`). `fbk050` ("Download all"; `2026-10-23-97`). `batchd4` (internal projects, fbk_044). `batchc` (Board view, fbk_042; `2026-10-23-91`). `batchb` (quiet hours and @everyone, 2026-10-22; `2026-10-23-88` to `-90`). `b26names` (names batch 2026-10-26; `2026-10-23-110`, `-111`; `adminReach.mine.hint` edited in place in `adminreach`). `mcpparity` (`2026-10-23-116`, 2026-10-26; the two AI switches `ai.admin`, `ai.myState`). `mcpguard` (code mail of an agent act, owner 2026-10-26). `focuschat` (fbk_059). `b26small` (small fixes 2026-10-26; `2026-10-23-108`, `-109`). `b26folders` (fbk_066; `2026-10-23-112`). `fbk069` (continuous project; `2026-10-23-118`).
  - The track list now holds about 89 pairs; `ls src/i18n/real` is the list.
- "The push line (2026-10-21) writes the bell sentences on the server."
- Word loading: "(`otherLanguage.ts`, FL-7 of 2026-10-21; the prototype loads it at once)", "3 s after the first reads of the screen settled" (`OTHER_LANGUAGE_GAP_MS`, pinned in the code). "The prototype keeps its words in its one script file (performance audit BND-7)."

### Arabic style (Thmanyah, owner, 2026-10-20)
- "The audit of 2026-10-20 rewrote 571 of 2,729 strings with them."

## src/design/CLAUDE.md

### Files
- `--phone-bar`: `calc(60px + max(16px, env(safe-area-inset-bottom)))` on `:root`, and 0 px under `:root[data-bar-hidden]`. `tokens.test.ts` holds both values.
- "`fonts/`: Thmanyah Sans 400, 500 and 700 (OTF, version 1.003)". `tokens.test.ts` pins the version through the file hashes.

### Rules
- "a 10,796 B Inter subset of 12 characters" (pinned by `scripts/fonts/subset-inter.test.ts`). "which loaded the 74 KB Inter Latin file on the first project page (speed audit 2026-10-21, LV-11)."
- The Thmanyah licence (font.thmanyah.com/licenses) allows the font in a web app only inside the built product. The full licence rule is in the root `CLAUDE.md`.


The history text, in the original words, grouped by guide and section. Each rule that still holds stays in the guide without its date story.


## server/mcp/CLAUDE.md


### AI agents (MCP)

(old line 3)
```
An agent (Claude, ChatGPT and others) acts for one person, with that person's rights. It connects to
https://madar.vado.sa/mcp. The test copy is https://preview.madar-46r.pages.dev/mcp.
Connect Claude Code with `claude mcp add --transport http madar https://madar.vado.sa/mcp`.
```


### The path of a request

(old line 8)
```
1. The Pages Function `functions/mcp/[[path]].ts` runs `server/http/pagesMcpProxy.ts`. It follows the server host of the copy
   (owner, 2026-10-16; `config/server-host.json`). With `workers` and the Pages service binding of the copy
   (`MADAR_SERVER_TEST`, `MADAR_SERVER_PRODUCTION`), the request goes to the Worker as `/mcp<rest>` with the query, and no
   `x-region`. Otherwise it goes to the mcp function of the host's Supabase project, with `x-region: eu-central-1`, and the
   Pages log gets one line (`reason` `setting`, or `binding_missing` as a warning).
```


### The address

(old line 26)
```
- A switch of the server host (owner, 2026-10-16) keeps MCP_URL: the Worker gets the same MCP_URL as the functions
  (`secrets.ts` requires it for the Worker), so the token audience, the metadata and every agent connection stay. No agent
  connects again. MADAR_SECRET_KEY of the Worker is the default secret key of the project, as on Supabase, so a reason
  question that spans a switch keeps its state key.
```


### Tools

(old line 32)
```
- MCP spec 2026-07-28, stateless. A 2025-era client gets the stateless legacy answer.
```

(old line 33)
```
- 158 tools in all (role rights version 2, 2026-10-21; project set-up, 2026-10-25; folders, 2026-10-26; MCP parity, stages, bulk to-dos and uploads, 2026-10-26). `MCP_ALLOW` holds 127: `madar.readFirst`, `pictures.get`,
  `story.start`, the reads and writes of an office project, `stages.replace`, the two bulk to-do tools and `files.uploadContent`. `MCP_BY_RIGHT` holds 28, each behind a right of the person: `payments.list` (`payment.view`),
  `payments.create` (`payment.add`), `payments.update` and `payments.delete` (`payment.change`), `payments.markReceived` (`payment.receive`), `dashboard.get`
  (`dashboard.view`), `search.query` (`search.use`), `reports.office` (`report.office`), the three `feedback.*` tools (`feedback.manage`), `feedback.send` and `feedback.sendWithScreenshots` (`feedback.send`),
  `projects.create` (`project.create`), `clients.create` (`client.create`), and the Admin work of the screens: `users.create` and `users.resendInvite` (`people.invite`),
  `users.update` (`people.change`), `users.deactivate` and `users.reactivate` (`people.turnOff`), `users.remove` (`people.remove`), the three `teams.*` writes (`people.teams`),
  `clients.update` (`clients.change`), `subCompanies.save` and `subCompanies.delete` (`subCompanies.manage`) and `settings.update` (`office.settings`).
  `MCP_ADMIN` holds 3 since the MCP parity track: `roles.create`, `roles.update` and `roles.delete`, which need `admin.manage` (the Admin only) and the switch `ai.admin`.
  A default Member agent gets 118 tools, Accounting 123, Management 124, the Admin 158 (42 reads and 116 writes). `tasks.help` (fbk_035) joins the person to a task as a helper, or takes them off it.
  The Admin's agent may get more tools than a client accepts (VS Code allows 128 in one request across all servers): the lists of the other roles stay far below it.
  The factory in `app.ts` picks the list for each request from the office rights of the owner, never the agent user. A 2026-07-28 client can keep tools/list for 5 minutes, and a
  2025-era client keeps it until it connects again (the server says listChanged but never sends that notice). So a role change
  shows late in a client, and tools/call always checks.
```

(old line 46)
```
- The size of the tool list (owner, 2026-10-26; `toolSize.test.ts`): the Admin's `tools/list` (158 tools) was 167 KB of JSON and is under 110 KB, and no tool is over 2 KB (name, title,
  text, schema and annotations). The zod input of a tool stays whole and checks every rule on the server (`argumentsOf` validates with it, `runCall` parses again); `slimSchema` (`tools.ts`)
  only shortens the JSON Schema that the agent reads: every pattern but the client initials, the lengths, counts and number bounds, empty defaults, `additionalProperties: false`, an enum of
  more than 20 values (the 120 right ids of `roles.create` and `roles.update`: `madar.readFirst` lists them for the Admin, `roleRightsLine`, and a wrong id gets the list in the error), the
  text of `storyId` and of the paging arguments, and the item schema of the two bulk tools (the item is the input of the single tool, named in the text). A union of one type and null is a type
  list. `wireAnnotations` (`tools.ts`) leaves out the title and the hints that equal the defaults of the MCP spec (`readOnlyHint` false, `destructiveHint` true, `idempotentHint` false); `ToolDef.annotations`
  keeps all of them. A new text or field must fit: run `toolSize.test.ts` and shorten the text, not the test.
```

(old line 53)
```
- `projectTemplates.list` takes the tool-only argument `id` (owner, 2026-10-26): it gives that one template in full (the row of the screens: roles, stages, tasks), so an agent reads a template before
  `projectTemplates.save`. Without it the list stays lean. An unknown id answers `not_found`.
```

(old line 55)
```
- The AI switches (role rights version 2, design section 5.12; `aiSwitches.ts`). Each tool of both lists has exactly one AI switch, from
  `MCP_TOOLS_BY_SWITCH` (`src/api/rightsCatalog.ts`, the catalog JSON in `docs/superpowers/specs`): `ai.readWork` (22: the 17 reads, `pictures.get` included, and
  `notifications.list`, `notifications.count`, `users.get`, `teams.list`, `settings.get`), `ai.readChats` (4), `ai.todos` (18, `tasks.createMany` and `tasks.updateMany` included), `ai.posts` (7), `ai.messages` (7), `ai.meetings` (5),
  `ai.tracker` (6), `ai.projects` (31, `stages.replace` and `files.uploadContent` included), `ai.projectSetup` (14: project set-up and the templates of projects and stages), `ai.payments` (5), `ai.feedback` (5, `feedback.send` and `feedback.sendWithScreenshots` included), `ai.report` (1),
  `ai.admin` (17), `ai.myState` (12) and `ai.undo` (2). `madar.readFirst` and `story.start` need only `ai.connect`. The two switches `ai.admin` ("AI does Admin work",
  a new power, off for every built-in role, held by the Admin) and `ai.myState` ("AI changes my own marks and settings", basic, on for every built-in role) came with the MCP
  parity track (owner, 2026-10-26). `ai.myState` holds the marks and the own settings: `notifications.markRead`, `.markAllRead`, `.markUnread`, `.updateSettings`,
  `chats.markRead`, `.markUnread`, `.archive`, `.setNotify`, `me.updateProfile`, `me.updatePreferences`, `agents.list` and `agents.remove`.
  `ai.undoOthers` has no tool: the Undo rule of the History reads it (`history.ts`, another track). A new tool needs a line in the catalog
  and a test fails without it (`aiSwitches.test.ts`).
```

(old line 76)
```
  - Every `ai.*` switch needs `ai.connect`, and a stored switch whose need is off counts as off (`dropUnmetNeeds`, `rightsOf`). So
    `ai.connect` off turns every AI switch off, also for a stored role that keeps the others on (fixed at the merge, 2026-10-21).
```

(old line 80)
```
  - `INSTRUCTIONS` says in two lines that the Admin decides what each role and its assistants may do and that a closed call fails with
    `ai_off` or `forbidden`. `TOOL_DOCS` name the switch of the leader powers (`project.details`, `project.stages`, `project.archive`,
    `project.deadlines`, `task.review`) and of the money, the report and the requests (`payment.*`, `report.office`, `feedback.manage`).
```

(old line 83)
```
- Chat presence (owner, 2026-10-21): `chats.typing` is on `MCP_DENY` (an agent never types, and agents see no live status). `chats.messages` gives
  `seen` (the members who looked, and when), `seenUpTo` and `others`, and its `TOOL_DOCS` say so. A reaction is any one emoji (`TOOL_DOCS` of `chats.messages` and
  `comments.list`); `reactions.toggle` is a tool since the MCP parity track.
```

(old line 87)
```
- After a release, a running session keeps its old tool list: a new argument goes out with the old schema (a number arrives as text:
  "expected number, received string"). Reconnect the Madar connector or start a new session before you use a new tool or argument (2026-10-26).
```

(old line 89)
```
- Meetings (owner, 2026-10-19, fbk_022): `meetings.list` and `meetings.get` (reads) and `meetings.create`, `meetings.update` and `meetings.cancel`
  (writes) are on `MCP_ALLOW`. `meetings.create` is additive; the other two writes are not. They tell the attendees, who are real people, so
  `TOOL_DOCS` and the `Meetings:` paragraph of `INSTRUCTIONS` say: ask your person before you add attendees. A meeting with no project is
  private to its organizer and its attendees: for anyone else, also an agent of an Admin who is not invited, every call answers `not_found`.
  An agent gets no notice and sends none of its own: the attendees get `meeting_invited` as for any person, and the person of the agent none
  (`notify` skips the actor and the person of an agent actor).
  Wave 2 (owner, 2026-10-19): any attendee writes the minutes, and there is no minutes task and no person for the minutes. `meetings.saveMinutes`
  is on `MCP_ALLOW` (a write that replaces the old minutes, so it is not additive). The `Meetings:` paragraph of `INSTRUCTIONS` says who writes them
  (the organizer and the attendees; for a project meeting the leader and the Admin), to write only what the person gives, that Madar makes the Tracker line
  of a project meeting that is not a team meeting and keeps the minutes there (do not log it with `tracker.log`), and that an agent never opens a file of a
  meeting with no project. `TOOL_DOCS` of `meetings.get` and `tracker.list` name the minutes. `meetings.settle` is on `MCP_DENY`: the job and the minutes
  call settle a meeting, and an agent never makes the Tracker line. For a meeting with no project that the person is not in, `meetings.saveMinutes` answers
  `not_found` as for an unknown id. The tools leave out `minutesById`. The meeting writes take `storyId` like any write.
```

(old line 102)
```
- Repeating meetings (wave 3, owner 2026-10-19): `meetings.create` takes `repeat` and makes the first 8 meetings of a series; `meetings.update` and
  `meetings.cancel` take `scope` (`one` or `later`). No new tool. `meetings.extend` is on `MCP_DENY`: the job keeps a series full, an agent does not.
  `meetings.delete` (owner, 2026-10-23: a person deletes a cancelled meeting in the screens) became a tool in the MCP parity track (owner, 2026-10-26): an agent deletes a cancelled
  meeting after its person says yes. `INSTRUCTIONS` and `TOOL_DOCS` of `meetings.cancel` and `meetings.delete` say so. A cancel with `scope` `later` ends the series (the last day goes on every meeting); `scope` `one` never does (the users decide if a meeting
  repeats, not the platform).
  The `Meetings:` paragraph of `INSTRUCTIONS` and `TOOL_DOCS` of `meetings.create`, `.update`, `.cancel` and `.list` say it, and tell the agent to ask its person
  before it plans a series. A private series answers every call as an unknown id for anyone who is not in it. The tests are in `meetingTools.test.ts`.
```

(old line 109)
```
- Google Calendar (owner, 2026-10-19, fbk_022): the four `google.*` calls are on `MCP_DENY` (a person connects in the Settings screen; an agent cannot
  connect, disconnect or read a connection). The MCP parity track (owner, 2026-10-26) kept them closed because each of the four refuses an agent with `forbidden`
  (`server/calls/google.ts` and the prototype fake), so no tool of them can work. `INSTRUCTIONS` ends with a `Google Calendar:` paragraph: the meetings of its person reach their own
  Google Calendar with the title, the time and the place only. No tool changed.
```

(old line 113)
```
- The Daftra link (owner, 2026-10-26): the six calls `daftra.status`, `daftra.paymentLink`, `daftra.findClients`, `daftra.matchClient`, `payments.linkInvoice` and `payments.unlinkInvoice` are on `MCP_DENY`: an agent
  never touches Daftra, and the tool counts do not change (127 in `MCP_ALLOW`, 28 in `MCP_BY_RIGHT`, 3 in `MCP_ADMIN` after the join with main; they were 49, 12 and 61 before the parity track). The `TOOL_DOCS` of `payments.list` name the optional read-only `daftra` field (`invoiceNo`, `total`), and those of `payments.markReceived` say that a
  payment with that field gets Received from Daftra by itself. `INSTRUCTIONS` ends with one `Daftra:` rule after the `Google Calendar:` paragraph. The sample answers did not change (the sample office has no linked
  payment). Tests: `daftraTools.test.ts`. The paid write of the job is the internal call `payments.daftraPaid`, which is in no MCP list and in no public map.
```

(old line 117)
```
- Sub-companies (review 2026-10-19): `dashboard.get`, `tasks.list`, `deadlines.list`, `projects.list` and `reports.office` take `subCompanyId`;
  `projects.list` filter `no_sub_company` lists the projects with none; `search.query` and `subCompanies.list` (`projectCount`) carry counts. An agent
  never undoes a sub-company event (`events.undo`, `events.undoStory`).
```

(old line 120)
```
- Folders (fbk_066, owner 2026-10-26): `folders.create`, `folders.rename`, `folders.delete` and `files.move` are on `MCP_ALLOW` and belong to the AI switch
  `ai.projects` (the label and the hint of that switch stay as they were). `folders.create` is additive; the other three are destructive. The handlers
  ask the upload right (`file.upload`) of the person, so an agent of a person who cannot upload gets `forbidden`. A folder lives in the project, so
  `projects.get` lists the folders (`folders`: id, stageId, name) and `files.list` gives each file a `folderId` (null: the root of its stage). A delete
  never deletes a file, and `events.undoStory` brings the folder and the place of its files back. For an agent of a person who does not see a hidden
  project every folder tool answers `not_found` as for a missing record (`folderTools.test.ts`). `INSTRUCTIONS` has a `Folders:` line; an agent uploads a file
  into a folder with `files.uploadContent` (see "Uploads by content" below).
```

(old line 127)
```
- Every other call is in `MCP_DENY` (`tools.ts`). A test fails for a call in no list or in two, so every new shared call goes
  into exactly one of them. Since the MCP parity track (owner, 2026-10-26) the deny list held 16 calls (after the join with `rb/mcp-bulk` and `rb/mcp-upload`) and holds 22 since the join with main (the six Daftra calls), each with its reason in `tools.ts`: `session.get`, `projects.delete`
  (no Undo: only an Admin deletes a project, in the screens), `files.upload`, `files.uploadStart` and `feedback.uploadStart` (the raw upload calls need a signed link and a browser `PUT`: the two upload tools carry the content instead),
  `meetings.settle` and `meetings.extend` (the job does them), the three `push.*` calls (browser push devices: an agent has no device, owner 2026-10-08), `live.ticket` (exit wave 3:
  an agent opens no socket), `chats.typing`, the four `google.*` calls (see above) and the six Daftra calls (see the Daftra bullet above).
```

(old line 132)
```
- What reaches the Admin (owner, 2026-10-23): `chats.list` of an agent of an Admin follows the choice of its person (`adminReachOf`, `mine` leaves
  out the project chats the Admin neither leads nor works on, `all` counts every message). The agent cannot set it: `me.updatePreferences` is a tool since the MCP
  parity track, but the call refuses `adminReach`, `awayByHand` and `workHours` for an agent. The `TOOL_DOCS` of `chats.list` (600 characters at most) and the Messages paragraph of
  INSTRUCTIONS say so. Notices are not an MCP read, so the copies for the bell need no tool text. "Only my work" also changes the Home and Projects screens (fbk_065), but `projects.list` of an agent keeps its explicit `filter` input; the `projects.list` doc and the Messages paragraph of INSTRUCTIONS say so.
```

(old line 136)
```
- The Arabic name of a project (fbk_062): `nameAr` goes through the zod input and output of `projects.create`, `projects.update`, `projects.get` and `projects.list`, so no list changes. A `TOOL_DOCS` text is 600 characters at most (tests fail over it): the how-to for a list of Arabic names sits in the line "Arabic names:" of INSTRUCTIONS, and the four project docs only name `nameAr`.
```

(old line 137)
```
- The tile shape of a project (fbk_061, owner 2026-10-26): `shape` goes through the zod input of `projects.update` and the output of `projects.get` and
  `projects.list`, so no list changes (right `project.details`, an empty text clears it, Undo works). `look.tile` (`pictures.ts`, `tileSvg`) draws it at 62%
  with evenodd. The line "Tile shapes:" of INSTRUCTIONS holds the owner procedure (2026-10-26): an agent never sets a shape on its own idea; it asks for
  the inspiration source, shows about 5 options (an artifact, each in the tile at 34 and 22 px), works with the person until one is accepted, only then calls
  `projects.update`, and tells the person (Undo takes it back). It also holds the drawing rules: a solid mass, the real outline from the plan, the special
  places as holes (1.3 units from each other and the edge), nothing under 2 units, a shape only this project has. The Pictures paragraph says that the shape of a tile is
  the one picture an agent can change. The three `TOOL_DOCS` of the reads and `projects.update` name `shape` in 600 characters or less.
```

(old line 144)
```
- Messages (owner, 2026-10-12): an agent messages the team with `chats.openDirect` (the direct chat with one person, made when
  there is none), `chats.list` (the chats the person may open, to find a project chat) and `chats.send` (one message as the
  person; the author is the agent and `actingForId` the person, so the Inbox shows both names). For one task it uses
  `comments.create`, and for the feed of a project `updates.create`. Owner, 2026-10-18 (fbk_011): an agent also reads the chats of
  its person. `chats.messages` (one page of a chat the person may open, with `not_found` for a chat the person may not open) and
  `chats.waiting` (what waits for the reply of the person, from `waitingFor` in `handlers/chats.ts`) are on `MCP_ALLOW`, and
  `chats.list` keeps the preview of every chat (`run.ts` no longer blanks it). `chats.messages` of a group also gives `lines`, its quiet lines (added, removed, left, renamed); a line is no message
  (UX audit 2026-10-19). The texts of `chats.list` and `chats.waiting` say how to read and answer a row of kind task. `chats.markRead`, `chats.unreadCount`,
  `chats.markUnread` (fbk_028), `chats.archive`, `chats.setNotify` (the Notify me choice, chat design item 21) and the three group writes (`chats.createGroup`,
  `chats.updateGroup`, `chats.leaveGroup`) were on `MCP_DENY` until the MCP parity track (owner, 2026-10-26, replacing the rules of 2026-10-12, 2026-10-18 and 2026-10-23: "an
  agent never marks, archives or makes a group"). They are tools now, and `INSTRUCTIONS` says an agent marks and archives only when its person asks. The marks write
  the read mark of the person, never one of the agent (`ctx.authority`); a read by the agent is not a read by the person. A sent
  message writes no event, so no Undo takes it back, and `chats.openDirect` and `chats.send` are not additive (the client may
  ask its person first). INSTRUCTIONS has a Messages paragraph that says: send only when the person asks.
```

(old line 158)
```
- Context (owner, 2026-10-27): the paragraph "Context:" of `INSTRUCTIONS`, right after the six rules, tells the agent to read the project chat
  (`projects.get` gives `chatId`, then `chats.messages`), the posts (`updates.list`), the to-do thread (`comments.list`) and `search.query` before it answers
  a question about a project or a to-do, or writes a summary, a plan or a report of one, and to say in which chat it found the answer. A client can show
  only the start of the instructions: Claude Code cut them at about 4,100 of 24,330 characters (2026-10-27), and an agent that only reads may never call
  `madar.readFirst`. So a rule that an agent needs for a read goes in the first 4,000 characters. `contextDocs.test.ts` pins the place.
  The first line of `INSTRUCTIONS` and the text of `madar.readFirst` ask for that call once, before any other tool (owner, 2026-10-27; it was "before
  your first change"), so an agent that only reads gets every rule too. The cost: one call and about 24,000 characters at the start of a session.
```

(old line 165)
```
- `search.query` finds the messages of the chats that the person may open (`messages`, the newest 5; chat design 2026-10-19, item 16).
  The `TOOL_DOCS` of `search.query` and the Messages paragraph of INSTRUCTIONS say so. Search finds no chat file (owner, 2026-10-19); an agent opens a chat file with `files.link` since 2026-10-26 (see Chat files).
```

(old line 167)
```
- A chat that the person may not open answers `not_found` for the agent too, for every kind (chat design 2026-10-19, item 17): it was
  `forbidden` for a direct or project chat. `TOOL_DOCS` of `chats.send` says so.
```

(old line 169)
```
- `chats.messages` takes `around` (a message id; chat design 2026-10-19, item 17): the page that holds the message, and `newer` says
  that more follow. A search hit or a notice gives the agent the id to open. A message that the person may not read gives the newest page.
```

(old line 171)
```
- Chat files (owner, 2026-10-19; changed 2026-10-26): a message of a direct or group chat may carry files. An agent follows exactly the rights of its
  person. The agent of a member reads the id, the name and the type of the file in `chats.messages`, sends a file into the chat with
  `files.uploadContent` (`conversationId`; then `chats.send` with `fileIds` posts it) and opens a file with `files.link`. The agent of a person who is no
  member (the Admin too, when not a member) gets not_found on every path: the upload start and the upload, the link, `chats.messages`, with no file name in
  the text (leak tests: `uploadContent.test.ts`, `src/api/handlers/chatFiles.test.ts`, `server/calls/chatFiles.test.ts`). Every rule of the person stays:
  `chat.direct`, an active person, a chat that is not closed (`person_left`), and a project chat that uses the files of its project.
  AI switches (security review 2026-10-26): opening a chat file (`files.link`, `files.get`, a cover picture) needs `ai.readChats`, as `chats.messages` does
  (`assertAgentMayOpenChatFile`, `assertMayViewChatFile`: `forbidden`, reason `ai_off`, checked after the member check, so a non-member still gets not_found).
  A chat upload (`files.uploadContent` with `conversationId`, and the `files.uploadStart` and `files.upload` it runs) needs `ai.messages`, as `chats.send` does
  (`chatForUpload` takes the actor; the check follows the member check).
  A chat file is never a project cover (`projects.update` refuses it with reason `cover_chat_file`, for everyone). `files.list` and
  `search.query` show no chat file, for a person or an agent. Before 2026-10-26 `chatForUpload` and `mayOpenFile` refused every agent; only the file of a
  meeting with no project stays closed to an agent. INSTRUCTIONS (Files, Messages) and the `TOOL_DOCS` of `chats.messages`, `files.link` and
  `files.uploadContent` say so. A file row also carries its type (`mimeType`), so the agent sees `image/jpeg` beside the name (owner, 2026-10-19).
```

(old line 185)
```
- Edit, delete and react (chat design 2026-10-19, items 11 and 12): `chats.editMessage`, `chats.deleteMessage` and `reactions.toggle` (also for a chat message) were on
  `MCP_DENY` until the MCP parity track (owner, 2026-10-26). They are tools now. The calls still allow only a message of the person or of its agent (`isMine`, reason `not_author`
  for another author). INSTRUCTIONS (Messages) says: ask your person first, and write the words your person approves. An agent also
  reads `reactions`, `editedAt`, `replyTo` (with `deleted` for an old message that is gone) and `namesMe` in `chats.messages`, which leaves a deleted message out, and sends a reply with `replyToId`.
```

(old line 189)
```
- `feedback.setStatus` takes the five statuses and `reason` for `rejected`; `feedback.list` takes each status and `open` (fbk_067). The tool schemas
  come from the call's zod input. INSTRUCTIONS ("Requests and bugs:"): done only when the person says the fix is live; reject only when the person says
  so, with the reason in the person's words, never invented. The rights are unchanged (`feedback.manage`, `ai.feedback`).
```

(old line 199)
```
- The serverInfo version is the release: "1.0.<number of commits>" (`releaseVersion`, `vite.server.config.ts`, stamped into the bundles
  as `__MADAR_SERVER_VERSION__`; tests and scripts read "1.0.0"). claude.ai kept the tool list of a fixed "1.0.0": after the message
  tools went live (2026-10-12) its connector, also removed and added again, still showed the old 41 tools, while a direct client of
  the test copy got the chat tools. `check-bundles.ts server` fails a bundle with the placeholder. `server/discover` and `tools/list`
  both say 5 minutes (`cacheHints`).
```

(old line 206)
```
- claude.ai ignores both today (2026-10-06): its connector list shows Google's favicon of the main domain
  (`/s2/favicons?domain=vado.sa`), so the Madar connector shows the vado.sa icon. A new connector or a reconnect does not
  change it. Only a change of the vado.sa icon or an MCP address on another main domain would.
```

(old line 209)
```
- `users.list` gives both names (`name`, `nameAr`) and adds `roleName` to each row, the role name that the screens show (`run.ts`, INT-19).
```

(old line 210)
```
- Pictures (owner, 2026-10-21; `pictures.ts`): an agent reads the pictures its person sees, so a report can look like Madar. The rows give
  the rules of each picture, never its data by default: `users.list` adds `hasPicture` and `glow` (the CSS of the round picture), and
  leaves picture data out of `avatarUrl`; `subCompanies.list` adds `hasLogo` and leaves `logo` null; `projects.list` and `projects.get` add
  `look` (`color` and `tile`, an SVG of 34 px); `reports.office` adds the same to its rows. One profile picture is up to 16 KB, about
  4,000 to 8,000 tokens as text, so 15 of them would fill the context of an agent. `withPictures: true` (an argument of the tool only:
  `run.ts` takes it out before the call) adds the data on `users.list`, `subCompanies.list` and `reports.office` (each logo once, in
  `subCompanyLogos`). The colors are the light theme (`src/lib/pictureLook.ts`, checked against tokens.css), for a white page. The glow and
  the tile come from the same rules as the screens (`src/lib/glow.ts`, `markLights`).
```

(old line 226)
```
- Stage dates (owner, fbk_023): `stages.setDates` is on `MCP_ALLOW`. It sets both dates of one stage, as the Schedule tab does, for the
  project leader and the Admin by default (`project.stages`, with the scope of the person); an agent of a person without it gets `forbidden`. It needs no reason: the
  call never asks for one, so it has no `dateReason` field (that field belongs to `tasks.update`). The stages sit in time order by
  their dates, so new dates can move the current stage of the project and its health. `stages.replace` is a tool since 2026-10-26 (see below) and
  `stages.setPrerequisites` (what a stage needs) is a tool since the MCP parity track. INSTRUCTIONS has a
  Stages paragraph that says: change a stage date only when the person asks. The tests are in `stageDates.test.ts`.
```

(old line 232)
```
- Stages as a tool (owner, 2026-10-26): `stages.replace` moved from `MCP_DENY` to `MCP_ALLOW`, with the AI switch `ai.projects` and the right
  `project.stages`, as `stages.setDates`. It renames, adds, removes and orders the stages of one project: the whole list in the new order, the id of
  each stage that stays, a stage with no id is new, a stage left out is removed (`stage_has_tasks` while it holds to-dos). A date left out stays as it is: the call defaults both
  dates to null, so `run.ts` fills each missing date of a stage that keeps its id from the current stage of the same project before the call runs
  (`keepDates.ts`, `keepStageDates`; the owner asked for it on 2026-10-26). A null that the agent sends clears the date, a new stage has none, and an id of
  another project copies nothing (the call refuses it). Tests: `keepDates.test.ts`. `project.stages_changed` is in
  `NOT_UNDOABLE`: the change has no Undo, and `events.undoStory` fails for a story that holds it, so the docs say to leave `storyId` out and to ask the
  person first. `stages.setPrerequisites` is a tool too (MCP parity track, `ai.projects`). The tests are in `stageReplace.test.ts`.
```

(old line 240)
```
- Uploads by content (owner, 2026-10-26: "the agent sends the file content in the call"; `upload.ts`): `files.uploadContent` (AI switch `ai.projects`, as `files.move`)
  and `feedback.sendWithScreenshots` (AI switch `ai.feedback`) are MCP-only tools in `NO_CALL_TOOLS`. `files.uploadContent` is on `MCP_ALLOW`; `feedback.sendWithScreenshots` is in `MCP_BY_RIGHT` beside `feedback.send` with the right `feedback.send` (the join, 2026-10-26), so a person without that right sees an unknown tool. `files.uploadContent` takes the place as
  `files.uploadStart` does (`projectId` with `stageId`, `taskId` and `folderId`; `taskId` alone for an office to-do; `meetingId`; `conversationId`),
  `name`, `type` (MIME), `contentBase64` and `receivedFromClient`. No fetch of an outside address and no limit but 10 MB decoded (`MAX_UPLOAD_BYTES`,
  also the total of the 1 to 3 pictures of a report). A text longer than the base64 of 10 MB, and bytes over 10 MB, are refused with `file_too_large`
  before any store work. The tool runs `files.uploadStart` through `ctx.runCall` (same person, rights and refusals as the screens), puts the bytes with
  `PUT` to the signed link from the server (`ToolRunCtx.storeFetch`, default the global `fetch`; the link never leaves the function), then runs
  `files.upload` with the upload ID, so the preflight copies and checks the FINAL object (size, type, inline-safe rule). The answer is the id, name,
  version, size, type and place: no storage key and no link. The same name in the same place adds a version, as on the screens. No cleanup of our own: a
  failure after the PUT leaves one staging object, and the `uploads` job step removes it after 2 hours 10 minutes. An agent uploads into a direct
  chat or a group of its person (`conversationId`; owner, 2026-10-26: `chatForUpload` follows the person, and a non-member gets `not_found`); a meeting with no project and an office to-do work as on the screens. The body of
  an upload call may be `UPLOAD_BODY_BYTES` (about 14 MB): `readMcpBody` raises the 256 KB limit only for these two tool names (the `Mcp-Name` header, or the
  name in the first 4 KB of the body for an earlier client), and `app.ts` checks the parsed name again and answers 413 for any other tool; the SDK
  option `maxRequestBodySize` is raised to the same size (its default is 4 MB). A profile picture and a sub-company logo go as picture data inside the call (owner, 2026-10-26, pictures are uploads
  too; INSTRUCTIONS, Pictures); a project cover is a
  file (`files.uploadContent`, then `projects.update` `coverFileId`). Tests: `uploadContent.test.ts`, `feedbackShots.test.ts` (harness
  `upload.testing.ts`: the fake files database for the intents, a `storeFetch` stub that writes the fake file store).
```

(old line 257)
```
- Many to-dos at once (owner, 2026-10-26; `bulk.ts`): `tasks.createMany` (1 to 50 items, each the input of `tasks.create`) and `tasks.updateMany` (1 to 100
  items, each the input of `tasks.update`: `id`, `patch`, `reason`, `dateReason`) are MCP-only tools in `NO_CALL_TOOLS`, with the AI switch `ai.todos`
  like their single call. `runBulk` runs the single tool once for each item through `runTool` (the same path, rights and refusals), in order, in one
  story (the given `storyId`, or one that `story.start` makes). A failed item does not stop the next. A reason request is the error of that item only
  (`details.reason` `stage_back_reason` or `date_reason_needed`): the agent asks its person and sends that item again with `reason` or `dateReason`. A
  `storyId` that is not the agent's fails the whole tool (`story_not_yours`). The answer is `{ storyId, done, failed, results }` with a short row for
  each item. The whole batch is one tool call for the 60 a minute limit (the limit counts the request). Each item still runs its own transaction, so a
  batch of 100 is 100 transactions: the Worker CPU time is open (see the owner list). The tests are in `bulkTasks.test.ts`.
```

(old line 265)
```
- Long lists (owner, 2026-10-26; `paging.ts`): `projects.list` and `tasks.list` take `limit` (default 50, at most 200), `offset` and `full` as arguments of the tool
  only (`run.ts` takes them out before the call, so the call does not change; other tools keep their own `limit`). The answer keeps `output` as the array
  of rows and adds `page: { total, offset, limit, next }` beside it. Without `full` the rows are short (`shortTaskRow`, `shortProjectRow`: no look, no
  client record, no stage list); with `full` they are the rows of the screens, cut to the page. The page is cut before the picture looks are built. The
  tests are in `pagedLists.test.ts`.
```

(old line 270)
```
- Light answers (owner, 2026-10-26; `toolResult`, `run.ts`): an event object (it has `verb`) in an MCP answer keeps no `before` and no `after`, at any depth, so
  `events.list` gives none either. The screens still get both. The description of a to-do stays once in the task record, so a `tasks.create` answer is
  about 60% of the old size (its history under a quarter); a `tasks.update` of a long description is under half. The tests are in `lightAnswers.test.ts`.
```

(old line 273)
```
- Names (owner, 2026-10-26): `tasks.move` sets the status only; a move to another stage is `tasks.update` with `patch.stageId` (`tasks.updateMany` for many).
  `TOOL_DOCS` of both say so. `INSTRUCTIONS` has the lines "Many to-dos:" and "Long lists:".
```

(old line 275)
```
- Project set-up (owner, 2026-10-25, fbk_057): `projects.create`, `clients.create`, `clients.list` and `projectTemplates.list` belong to ONE AI switch,
  `ai.projectSetup` ("AI creates projects and clients"). It is a non-basic switch with `newPower`: off for Member, Management and Accounting, held by the
  Admin as every switch, needs `ai.connect`. The Admin turns it on for a custom role (for example "Project managers"). A role saved before keeps its own
  `rights` and `off` lists and so does not get it (`projectCreate.test.ts`). `projects.create` needs `project.create` too and `clients.create` needs
  `client.create`: a right closes its tool as an unknown tool, the switch closes it with `ai_off`. Both writes are not additive (the client may ask first).
```

(old line 294)
```
- A running Claude session keeps the MCP tool schema it loaded at its start. After a release that adds an input field, a call with that field
  still reaches the server and works (`projects.update` patch.shape, 2026-10-26); check the result, because an older server drops the field.
```


### MCP parity (owner, 2026-10-26)

(old line 300)
```
- Owner answers: (1) read marks and the personal screen state, only when the person asks (replaces the old "agent never marks" rules of 2026-10-12, 2026-10-18 and
  2026-10-23); (2) deletes and edits are open, except `projects.delete` (no Undo), which stays on `MCP_DENY`; (3) all Admin work is open with the screen rights, and the docs
  tell the agent to ask its person before an invitation (a real email), a change of a person, a role or the office settings (this covers team report fbk_068); (4) uploads came with `rb/mcp-upload` (`files.uploadContent`, `feedback.sendWithScreenshots`).
```


### Join with main (2026-10-26: Daftra, tile shapes)

(old line 322)
```
- The six Daftra calls are on `MCP_DENY` (22 names in all). The tile shape is `patch.shape` of `projects.update`: no new tool. `INSTRUCTIONS` holds the `Tile shapes:` paragraph of main word for word (the owner's rule: ask for the inspiration source, show about 5 options, iterate until the person accepts, only then set the shape). Do not shorten it.
```


### The email code guard (owner decision, 2026-10-26, after a security review)

(old line 347)
```
- The mail (`guard.ts`, `renderConfirmMail`, words `mcpGuardMail` in `src/i18n/real/mcpguard.*.json`): to the address of the PERSON only (read again when it runs), in the
  language of the person, with one plain line of the act (names cleaned: no control or direction mark, 60 characters) and, for the role acts, what the act does (fix of 2026-10-26: `roles.create` lists the rights it gives and the basic rights it turns off; `roles.update` lists the rights added and removed against the stored role, by the held list of `heldRightsOfRole`, and the new names; `roles.delete` names the role that takes its people; `users.update` names the old and the new role; `users.create` names the email, the name and the role; a list shows EVERY right id, the risky ones first (people, payment, admin and every-record rights: `isRiskyRight` in guard.ts), each id cut at 40 characters and the count never cut (security review fix 6); words in `mcpGuardMail.lines`), the code, "one time, 10 minutes", and no link. It counts
  as sign-in mail against the day quota (`sendCounted`, key `mcp-confirm-<id>`). A row that runs after the end time sends nothing. The code sits in the outbox payload until the
  mail goes; the effect then removes it (`SCRUB_SQL`, as the invitation removes its token). The table keeps a hash of `<id>:<code>` only. The code is in no answer, log line or event.
```


### Token and approval

(old line 364)
```
- An agent user is named after its person and its AI app (owner, 2026-10-12): "<first name> <app> Agent", for example "Osama Claude
  Agent", and "وكيل <first name> <app>" when the person has an Arabic name (`agentNamesOf`, `src/lib/agentName.ts`). With no app name it
  reads "Osama Agent". `agent_links.client_name` keeps the plain app name: the match of a reconnect reads it, never the user name.
  The migration `20261012000100_agent_names.sql` gave the names to the agents that existed (only an agent that still had its app
  name, so a name that an Admin set stays). Change the function and the migration together.
```

(old line 371)
```
- Open risk (owner decision, Z7): an agent token has the person's full rights on the own endpoints of Auth.
```


### Tests

(old line 384)
```
- A live check of a tool on the test copy needs no browser (2026-10-21): a one-off script signs in the sample member with the
  password grant (`secrets/test-accounts.env`, never printed), registers a client, sends the authorize step, then the steps of the
  consent screen (GET `/auth/v1/oauth/authorizations/<id>`, POST `api/agents/approve`, POST `.../consent` with `approve`), and
  trades the code for the agent token. At the end it revokes the grant (DELETE `/auth/v1/user/oauth/grants?client_id=`) and runs
  `agents.remove` through `api/batch` (with `X-Madar-Build`), so no agent stays in Settings, Agents.
```


### The own OAuth server (Supabase exit, wave 2)

(old line 395)
```
- The approval: the consent gives a code only after `POST /api/agents/approve` with a browser token. Every own route refuses an
  agent token, so the open risk of Z7 (an agent token with the full rights of its person at Auth) does not exist on the own stack.
  So the consent screen of the own stack leaves out the line "can also use your account outside the Madar screens"
  (`agentReachesAccount: false` of `madarOAuthPort`, `src/features/oauth/oauthPort.tsx`).
```

(old line 404)
```
- MCP clients try `/.well-known/oauth-authorization-server/mcp` first. Exit wave 4 adds the two Pages Functions
  (`functions/.well-known/`, logic in `server/http/pagesWellKnown.ts`): they answer only for a copy with the word office, and
  every other copy answers 404. A client of such a copy finds `/mcp/.well-known/openid-configuration`.
```

(old line 409)
```
- On the office path (the merge of exit waves 2 and 3), the object runs the whole MCP app for each request (`Office.mcp`,
  `server/office/parts.ts`): the own issuer, the own agent token check, `liteAgentOf`, `mountOAuth`, and each tool call on the
  batch path of the object (the who kind `agent`). No region hop runs in the object. No tool, `TOOL_DOCS` line or `INSTRUCTIONS`
  rule changed in the merge.
```

(old line 413)
```
- No tool, `TOOL_DOCS` line or `INSTRUCTIONS` rule changed in wave 2: an agent never reads the connect flow; its AI app runs it.
```

(old line 414)
```
- Exit wave 4: on the office path `/mcp` runs inside the office object, as above, and the deploy suite on the office path
  (`agents.spec.ts`) uses the own OAuth routes under `/mcp` (register, authorize, token). The day cap of the test Worker counts a
  request of `/mcp` itself as a write and the OAuth routes as reads (`server/office/cap.ts`). No tool, `TOOL_DOCS` line or
  `INSTRUCTIONS` rule changed in wave 4.
```

(old line 418)
```
- Reminders and lines (owner, 2026-10-19): `INSTRUCTIONS` has a "Pauses:" line (the restart date `project.pause.resumeOn` is a reminder, and
  Madar never restarts a project by itself) and `projects.setStatus` says it. `projects.pause`, `projects.resume`, `projects.setRestart`, `projects.setAccess` (who sees a project) and the link calls are tools since the MCP parity track (owner, 2026-10-26). `TOOL_DOCS` of `projects.get` and `projects.list` name `access`, and `INSTRUCTIONS` says that a project or task that answers `not_found` may be hidden from the person (hidden projects, 2026-10-22).
  `comments.list` gives `kind` (`message`, `due_date`, `start_date`, `shifted`, `reopened`) and `chats.list` gives `previewKind`: a line is
  no message and never waits for a reply. `dashboard.get` gives `workload.unassigned` (the No lead row). Tests: `pauseDocs.test.ts`,
  `dashboardDocs.test.ts`.
```

(old line 424)
```
- Words (owner, 2026-10-20): `INSTRUCTIONS` has a "Words:" paragraph. The screens call a task a "to-do", and the Tasks tab holds To-dos and Meetings. The calls and
  the tools keep the word "tasks". Test: `officeDocs.test.ts`.
```

(old line 426)
```
- The Madar report (owner, 2026-10-21): the "Reports:" line of `INSTRUCTIONS` sends every request for a Madar report (an office report, a
  weekly report, a report from one day to another) to `reports.office` with `guide: true`, and the agent follows that guide
  (`src/api/reportGuide.ts`, from the owner's Claude skill "madar-office-report"). So the report needs no skill in the AI app, and every
  person with the report right gets the same report. No new tool at that time. Tests: `reportGuide.test.ts` (the tools, fields and
  colors that the guide names) and `tools.test.ts` (the words of the tool text and the line). After a change of the guide, tell the owner
  that a Claude skill with the old text in his AI app can disagree with it.
```


### Quiet hours and @everyone (owner, 2026-10-22)

(old line 434)
```
- `me.updatePreferences` and `settings.update` are tools since the MCP parity track (owner, 2026-10-26), but the call refuses quiet hours, Away and the choice of what reaches the
  Admin for an agent (only a person sets them), and `settings.update` needs the Admin right `office.settings`. The switch
  "Mention everyone" (`chat.mentionEveryone`) is a Chat switch, not an AI switch, and opens no tool. An agent writes `@everyone` with the rights of its
  person. `INSTRUCTIONS` has the line "Quiet hours:" (an agent cannot change the quiet hours of its person; `settings.get` reads the office default) and `TOOL_DOCS` of `chats.send` (599 characters) and `comments.create` (571) name the words, the
  switch, "a notice and a push, no email" and the quiet hours hold. Test: `quietEveryone.test.ts`.
```

(old line 440)
```
- A continuous project (fbk_069): `continuous` goes through the zod input and output of `projects.create`, `projects.update` (`patch.continuous`), `projects.get` and `projects.list`, so no list
  changes. The four docs name it; all four sit at 590 to 600 characters (a test fails over 600), so the rule is in INSTRUCTIONS: "Health:" (a continuous project never turns late from a stage date,
  the 7-day rule skips it, a to-do 3 or more days past due still puts it at risk) and "New projects:" (continuous: true, no target end date, the `stage_no_end` filter skips it). Test: `projectContinuous.test.ts`.
```


## server/CLAUDE.md


### Server

(old line 3)
```
One Hono app in TypeScript. The same source runs on Supabase Edge Functions (Deno, pinned to eu-central-1) and on one
Cloudflare Worker for each copy (`wrangler.server.toml`: `madar-server-test`, `madar-server-production`, placed in
aws:eu-central-1). `config/server-host.json` says which host serves each copy (owner, 2026-10-16; `core/serverHost.ts`):
`supabase`, `workers`, or `office` (the office object; exit wave 4, the test copy only until wave 6, `OFFICE_COPIES_OPEN`).
The other host stays deployed as the way back. Each area below has its own guide: `mcp/`, `auth/`, `data/`, `mail/`,
`files/`, `push/`.
```


### Folders

(old line 16)
```
- `office/`: the office object of the Supabase exit (wave 3), off on every deployed Worker. See "The office object" below.
```

(old line 17)
```
- `jobs/` (the 15-minute job), `signal/` (change signals), `push/` (browser push). The usage meter, the 80% warning and the Usage screen were removed (owner, 2026-10-23: an internal tool, not paid).
```


### Request path

(old line 21)
```
- `POST /api/batch` (`http/batch.ts`; on a Supabase function URL with `?forceFunctionRegion=eu-central-1`, on the Worker
  through the page's own `/api`): at most 12 entries, 256 KB, and calls whose
  cost adds up to 30 at most (`callCost` and `BATCH_BUDGET` in `src/api/remote/wire.ts`, 1 unit = 10 ms of CPU on the year office; `http/limits.ts`
  refuses a request over it with 413 `too_many_overviews`). A call that scans a list of the office has a cost: `projects.list` 20, `events.list` 15,
  `dashboard.get` 10, `search.query` 10, `tasks.list` of one person (`mine`, `review_for_me`, `workOf`, `ownerId`) 1, any other `tasks.list` 4, a
  `tasks.list` of one project and every other call 0. The follow reads of a save use the same function (perf2 savetrip, 2026-10-22). The client sends
  up to the budget only for the follow reads of a write; any other call keeps one overview call for each request, so a cold start sends the same requests
  as before. Change a cost only with a new CPU table of the year office (`node --import tsx scripts/proof/overview-cost.ts`; the heaviest request the budget allows took 277 ms in memory). An old `X-Madar-Build` gives 409 `client_outdated`. CORS allows only listed origins, never `*`.
```

(old line 29)
```
- Extra routes (`http/routes.ts`) sit under the api app: `POST /auth/forgot` answers at `/api/auth/forgot`. `GET /google/callback` (fbk_022,
  `google/callback.ts`) has no sign-in, reads no database and writes nothing: it checks the signed state and answers 302 to
  `<APP_URL>/settings#google=<word>` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. On the office path it answers `#google=not_ready`
  and calls no object (`entries/officeSignin.ts`). The Pages forwarder passes it with its query and its 302 as they are.
```

(old line 41)
```
- The email code guard (owner, 2026-10-26; `mcp/guard.ts`, flow in `mcp/CLAUDE.md`) sits in the write step of `runCall`: for eight risky Admin acts of an agent the transaction stops after the handler and before the
  save unless the call carries the right `confirmCode`. It writes the server table `agent_confirms` and the outbox row `mcp.confirm` in a transaction of its own, so every route (Pages, mcp function, Worker, office object) passes it.
```

(old line 46)
```
- The kinds in `AFTER_ANSWER_KINDS` (`core/effects.ts`: `mail.notice`, `mail.quotaWarning`, `push.notify`,
  `push.chat`, `mail.chatNotice`, `gcal.sync`, `gcal.revoke`, `gcal.tidy`) run after the answer when the host has `after`, on one chain per batch
  (`BatchScope.mail`), so the mails keep the order of the entries. Every other kind runs before the answer. With no `after` (tests,
  scripts), every kind runs before the answer. A new mail or push kind goes into `AFTER_ANSWER_KINDS`; `effects.test.ts` pins the
  names (performance audit 2026-10-07). The kinds in `WAITED_KINDS` (`push.chat`, `mail.chatNotice`) wait `CHAT_WAIT_MS` (10 s)
  after the answer on a chain of their own, so the server can skip a person who read the chat (design item 20). The office object
  runs them with no wait (exit-handoff section 10).
```

(old line 53)
```
- The screens depend on two facts of this path (performance audit FET-3). `http/batch.ts` runs the calls of a request one
  after the other, and a write clears `batch.office` (`core/runCall.ts`), so a read after a write in the same request sees
  the write. A change that runs the reads of a request in parallel, or keeps the office copy across a write, lets a screen
  show an old list after its own save. Adjacent `files.link` entries are the one exception: reads only, side by side.
```

(old line 57)
```
- A batch with a
  write calls `db.warm('write')` after the token check. Adjacent `files.link` entries run side by side, each with its own
  error, and the answers keep their order. Every other entry runs alone, in order. Before such a run of two or more, `prefetchLinkRun`
  (`calls/files.ts`) reads the files of the whole run with one statement (`FILES_DOCS_SQL`, SV-11) into `batch.files`; `filesLink`
  uses that record, still checks the view right per link, and `handleBatch` drops `batch.files` after the run.
```

(old line 62)
```
- The first read joins the sign-in (performance audit SV-5, 2026-10-21). When the first call of a batch is a plain read
  (`joinsFirstRead` in `core/runCall.ts`: a shared read with no preflight hook), `handleBatch` opens one read transaction, reads the
  office in it, and runs that call in it (`RunRequest.open`, `CallData.on`). One begin, one `office_meta` read and one commit go.
  Only the first call joins, and a failed first call rolls the transaction back. A server call never joins: it opens its own
  transactions, and a nested one is refused. `apiApp` turns the join on only with the real `runCall` and the real office read; a
  test that replaces either passes `joinFirst` itself. The office object (`office/batch.ts`) has its own batch and no join.
```


### Errors to PostHog (insight design, owner 2026-10-25)

(old line 74)
```
- `runCall` adds `personId` and `agentId` to the line "A call failed.". With no key, nothing changes. The office object logger (exit wave 4) is not wired.
```


### Calls

(old line 78)
```
- 18 server-only calls (`calls/index.ts`): `story.start`, `files.uploadStart`, `files.link`, `feedback.uploadStart`,
  `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove`, `live.ticket`, and the four Google
  Calendar calls `google.status`, `google.connectStart`, `google.connect`, `google.disconnect` (fbk_022, `calls/google.ts`, `server/google/`), `chats.typing` (chat presence design B, `calls/typing.ts`): it saves nothing,
  takes no lock, and sends a typing signal (`TypingPort`, `server/signal/typing.ts`, event `typing` on `person:<id>`) to the other members of the chat, and the four Daftra calls
  `daftra.status`, `daftra.paymentLink`, `daftra.findClients`, `daftra.matchClient` (the Daftra link, owner 2026-10-26, `calls/daftra.ts`, `server/daftra/CLAUDE.md`).
```

(old line 86)
```
- `SERVER_EXCLUDED` (prototype only): `session.previewAs`, `session.setSimulateErrors`, `session.resetSampleData`, `files.get`.
  runCall answers `not_found` for them.
```


### Entries and bundles

(old line 115)
```
- `entries/bundles.test.ts` bounds the minified api bundle (950,000 characters since 2026-10-26, MCP parity and the requests of that day). A long text constant in `src/api`
  counts (the report guide: about 17,000). Raise the bound with one history line in the test.
```

(old line 117)
```
- Supabase serves each request with a new worker: about one cold start for each request, each worker lives 75 s and then
  stops (`EarlyDrop`), and about 5 calls in 100 reach a worker that already served one (function logs of madar-test,
  2026-10-16). The platform does this, not our code: a probe function with a plain `Deno.serve` and no code of ours gets the
  same rate as the real api bundle (probe on madar-test, 2026-10-21, proof.md). Do not look for a code fix for the cold start.
  So the pools close an idle
  connection after 1 s (`IDLE_TIMEOUT_MS`, `data/sql.ts`), and each entry also closes its pools on `beforeunload`
  (`closeOnUnload`, `entries/start.ts`). With the old 120 s, about 85 workers under the deploy suite held up to 2 pooler
  clients each, the client limit of the pooler (200) filled, and requests failed at once with `EMAXCONN` (a whole-batch 500).
```


### Ports

(old line 131)
```
- `Config.google` (fbk_022): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MADAR_GOOGLE_KEY`, all three or none (`google/keys.ts`; the server refuses to
  start with some and names the absent ones). `Deps.googleFetch` is the fetch of a test stub; no test reaches Google (`google/fakeGoogle.ts`).
```

(old line 133)
```
- `Config.daftra` (the Daftra link, owner 2026-10-26): one Daftra account for each sub-company, `DAFTRA_<NAME>_KEY` and `DAFTRA_<NAME>_SITE`, both or none for each name (`daftra/config.ts`, a name
  pattern, no fixed list; `env.names()` lists the names of the host). `Deps.daftraFetch` is the fetch of a test stub; no test reaches Daftra (`daftra/fakeDaftra.ts`).
```


### Rules a change must keep

(old line 146)
```
- An effect or a job step that needs what a person may see runs a read call as that person: `(deps.runCall ?? runCall)(deps,
  { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } })`. It works on both databases
  (`server/push/line.ts`, `jobs/steps/meetings.ts`). The one exception: the Google calls of `google.connect` share a budget of 15 s, at most 10 s
  for one call (`GOOGLE_CONNECT_BUDGET_MS`, `GOOGLE_CONNECT_CALL_MS`; fbk_033), because the person waits on the screen and the first call
  took about 3 s on production. The budget and the 3 s revoke of a failure stay under the 20 s of the screen.
```


### Google Calendar (fbk_022, owner 2026-10-19)

(old line 163)
```
- One calendar for each person (owner test 2026-10-20: Disconnect, then Connect made a second calendar "Madar" with the same meetings at two times). The scope
  reaches every calendar that Madar made, also with the token of a newer link, but it cannot list calendars (`users/me/calendarList` gives 403). So Madar
  remembers the calendar id in `google_calendars` (one row for each person). Each connect that gets a calendar id upserts the row in the transaction that inserts
  the connection (`rememberCalendar`; the row changes only when the id changes). Before it makes a calendar, `google.connect` reads the row and asks Google for
  that calendar with the new access token (`getCalendar`, GET `calendars/<id>`): 200 uses it and writes one `gcal.tidy { userId }` row after the sync rows;
  404 or 410 (the person deleted it in Google) makes a new calendar and updates the row; any other answer (timeout, network error, 5xx, 429, 401, 403) ends the
  connect with `google_unreachable`, takes the new grant back, and makes no calendar, so the person presses Connect again. A disconnect keeps the row on purpose;
  `users.remove` deletes it in its transaction (`revokeRowsOf`). A person who connects with another Google account gets 404 for the old id and a new
  calendar: Google answers 404 for a calendar that the account cannot see (probe with the owner's link on the test copy, 2026-10-20).
```

(old line 172)
```
- The producers (`rows.ts`): after the save of `meetings.create`, `meetings.update`, `meetings.cancel`, `meetings.extend`, `events.undo`, `events.undoStory` and
  `projects.delete` (`GCAL_CALLS`), `gcalRows` writes one `gcal.sync { userId, meetingId }` for each connected organizer or attendee (state ok or
  not_synced) and each person who has a Google event for a touched meeting (`SaveResult.meetingIds`, set by `data/save.ts`); it asks the database only
  when the save touched a meeting. The producer of `users.remove` (`revokeRowsOf`) sets the live connection of the person to `revoking` (`startRevoking`,
  at the time of the call), deletes the `google_events` rows of the person, and writes one `gcal.revoke { connectionId }` (security fix, 2026-10-19): so a
  revoke that fails leaves no live token of a removed person, and the cleanup step deletes the row after one day. A person who is only turned off keeps
  the connection (plan decision 11). The producers run in the transaction of the call; `runCall` gives each producer the time of the call (`at`).
```

(old line 179)
```
- The effects (`sync.ts`) run after the answer (`AFTER_ANSWER_KINDS`) and write only `google_connections` and `google_events`, server-only rows (as the
  mail effects write `mail_log`): no event, no signal, no State table. `gcal.sync` reads again when it runs: the live connection, the person, the meeting
  and the event row. The event id is the hex of `madar:<meeting id>` (`eventIdOf`); the body has exactly the title, the place, the start, the end and the
  status (`eventBodyOf`, owner Q2). The access token lives in memory only, for the life of the isolate, until 60 seconds before it ends; a 401 drops it
  and tries once more.
```

(old line 184)
```
- Errors: `grant_gone`, a seal that does not open, or a deleted calendar (404 on an insert) ends the connection (state `broken`, the token is deleted at
  once, the event rows go) and the row is done. A timeout, a network error, a 5xx or a rate limit sets `not_synced` and throws, so the outbox tries again
  (5 times, then the row stays failed in the outbox; no screen lists it since the Usage section went, 2026-10-23). Any other refusal sets `not_synced` with `last_error` `refused` and does not retry. An error text, a
  log line and an outbox error hold the code and the ids, never a token, a code, a title or a Google answer (`leaks.test.ts` proves it).
```

(old line 188)
```
- A connect that a Google step ends writes one warn line, "A Google Calendar connect failed.", with `userId`, `step` (`token`, `calendar_read`,
  `calendar_make`), `code` (the GoogleError code, or `no_refresh_token`, `scope_missing`) and `status` (the HTTP status, absent for a timeout or a
  network error) (fbk_033, 2026-10-20: production answered `google_unreachable`, and no line said which call failed). The answer to the person does not change.
```

(old line 203)
```
- Hidden projects (owner, 2026-10-22, wave D3): a meeting of a project syncs only for a person who views the project. `gcal.sync` asks
  `viewsProject` (`google/store.ts`, the one rule `mayViewProject` on the rows of the project, the team, the person and the roles) and takes the Google event away
  from a person who does not (state `deleted`). `GCAL_CALLS` gains `projects.setAccess`, `members.remove` and `projects.setLeader`: a save that touched no
  meeting but touched a project that not every active person views (`SaveResult.hiddenProjects`) makes `gcalRows` name the scheduled meetings of that
  project (`meetingIdsOfProjects`), so each pair with an event or a connection gets a `gcal.sync` row and the person who lost the view loses the event.
  A person also loses the view through a role: `roles.update`, `roles.delete` and `users.update` are in `GCAL_CALLS` and `GCAL_VIEW_CALLS`, and their producer
  (`gcalViewRows`, the wide road) queues one `gcal.sync` for every Google event row of a meeting of a project (of the one person for `users.update`, of
  everyone for a role call), so `syncOne` checks the view again and a person who lost it loses the event; a person who kept it gets the same event put once more.
  `gcalRows` takes the union of the meetings of the save and the meetings of its hidden projects.
  Tests: `google/hiddenProject.test.ts`.
```


### Realtime, jobs

(old line 219)
```
- A save that changes an office task, its comments or its files (`Diff.privateChange`, `data/save.ts`) sends that part
  only as a person signal, with its own id and no `actorId` or `storyId`, to each person of the task (maker, lead,
  helpers, before and after) and each active holder of `task.officeAll` (the Admin holds it; `rightsOf` reads the roles of the saved state). The office signal tells only the project part (`Diff.publicKinds`),
  with its names, and a save of office tasks alone sends none (review 2026-10-06). The Realtime rules need no change: the
  server sends on any `person:` topic, and each person reads only their own.
```

(old line 229)
```
- A save that changes a meeting with no project, its notices or its events (fbk_022, owner 2026-10-19; `officeMeetings` in `data/save.ts`) is
  private in the same way: its signals are person signals with no names, to the organizer (the person behind an agent) and the attendees,
  before and after the change. The Admin gets one only as one of those people. A save that touches office tasks and a private meeting
  sends the union of the two groups (the signal tells only kinds). `server/core/meetingsSignal.test.ts` proves it.
```

(old line 233)
```
- A direct chat or a group tells only its members (owner, 2026-10-21, perf2 SV-7 and DF-2; it replaces the anonymous office signal of
  INT-16, UX audit 2026-10-19). `diffState` puts the records of such a chat in `Diff.chatKinds` (messages, the chat itself, its files, and
  the read marks and notices of its people) and `Diff.chatPeople`: every member before and after the change, so a person taken out or
  added hears it too (an agent member is mapped to its person), and the owner of each mark and notice. These kinds are never in
  `publicKinds`, so no office signal tells them, and the save makes no `office_meta` update for them. `writeDiff` sends each person of
  `chatPeople` one person signal with the kinds of the public part and the chat part, with its own id. The people of a save go in the
  one `person_seq` statement and the one `realtime.send`, whatever their number (a group of 50 writes 50 `person_seq` rows). A project chat
  keeps the office signal with the actor and the story. A save that also touches other kinds keeps its office signal for them, without
  the chat part (`Diff.restKinds`, `Diff.publicOffice`). The old nameless office signal (`Diff.anonymous`) stays only as the fallback for
  a message or file whose chat neither State holds. Tests: `core/chatSignalMembers.test.ts`, `core/chatSignalLeaks.test.ts`,
  `data/save.test.ts`.
```

(old line 244)
```
- A project that at least one active person may not view (hidden projects, owner 2026-10-22, wave D3) tells only the people who view it.
  `data/projectAudience.ts` (`audienceFinder`) asks the one view rule of a project for each active human, in `before` and in `after`: a project
  is "restricted" when someone may not view it in either State (hidden, or open for a role without "See every project"). `diffState`
  puts every record that names such a project (the project, its members, stages, deadlines, to-dos, posts, files, comments, messages, chat,
  events and meetings) in `Diff.hidden` (kinds and people for each project), never in `publicKinds`, `restKinds` or `projects`, and never
  marks the office. `writeDiff` sends each person of the audience (before and after, so a person who loses the view and a person who gains it
  both hear) one person signal with its own id, the kinds of the hidden projects that the person views, and those project ids. The office
  signal never names the project. A person of another part of the same save keeps those kinds in the same signal. A comment whose target the call
  did not load is looked up by `writeDiff` (`COMMENT_TARGETS_SQL`), and the audience of the project found asks `Diff.audienceOf` after the
  lookup (no new SQL, so the SQLite form needs no change). With the default settings no project is restricted and every signal is as before.
  The three live paths (Postgres, the memory path of the tests and the SQLite socket path of the office object) share `diffState` and
  `writeDiff`. `test/invariants.ts` knows the part. Tests: `data/hiddenProjectSignals.test.ts`, `data/hiddenProjectSignalsRun.test.ts`.
```

(old line 256)
```
- pg_cron calls `jobs/run` of the Supabase jobs function every 15 minutes, in both host settings (owner, 2026-10-16), with the
  secret header `x-madar-jobs-secret`. The Worker keeps `/jobs` mounted, but nothing calls it: pg_cron and the Vault
  `project_url` do not change. Steps (`jobs/steps/`):
  heartbeat, triggers, meetings, daftra, summary, quietEnd, outbox, cleanup, uploads. Each step is idempotent. `daftra` (the Daftra link, `jobs/steps/daftra.ts`, `daftra/CLAUDE.md`) reads Daftra
  one account at a time with no lock and a budget of 20 calls and 60 s, sets "Received" for a paid invoice through the internal call `payments.daftraPaid`, and fills the invoice cache. It returns at once
  with no Daftra account, and on the office object path until a `NetApi` method exists. `summary` sends the morning summary at
  the start of the work hours of each person (a job_runs row `summary:<day>:<person>` closes one person for one day). `quietEnd` sends the one push
  to a person whose push was held in quiet hours (`push/held.ts`; `server/push/CLAUDE.md`). `core/quiet.ts` reads the work hours for the effects. The triggers step also sends `resume_due`
  (the planned restart day of a paused project) to the leader and to the person who paused it (`src/api/CLAUDE.md`).
```

(old line 265)
```
- The meetings step (fbk_022, wave 2; `jobs/steps/meetings.ts`) settles the meetings that ended. One read (`SETTLE_SQL`, `SETTLE_LITE`, served by the
  partial index `meetings_to_settle`) gives at most 20 due meetings, the oldest end first: scheduled, not settled, ended in the last 14 days. For each
  one the step runs the normal call `meetings.settle` as the organizer (`settleActorOf`: the organizer only while the organizer views the project of the meeting, hidden projects, owner 2026-10-22; else the first active
  Admin who views the project for a project meeting, else the first active attendee; `extendActorOf` follows it), so the mark and the Tracker line come from the one settle rule and carry the events of a normal call. It writes no row of
  its own. A failure logs the id and the code only and the loop goes on. It reports `{ settled, skipped, failed, extended }`. The second half keeps the repeating
  series full (wave 3): one read (`EXTEND_SQL`, `EXTEND_LITE`; no new index: the base is the meetings that start today or later, served by `meetings_starts`)
  gives the last meeting of each series that is scheduled and has fewer than 8 scheduled meetings ahead (`ends_at` after the run), the fewest ahead first, at most
  20 series. The step skips a series whose rule has no day left (`occurrencesOf`) and a series of a completed or archived project, then runs the normal call `meetings.extend { seriesId }` for each, as the same
  person who may change the series (`extendActorOf` of the last meeting: the organizer, else the first active Admin of a project series; a private series of an
  organizer who left is skipped, review 2026-10-20), and counts the meetings added in `extended`. A failure logs the series id and the code only. `Deps.runCall` (`core/ports.ts`) is the run of a normal call for a step: only the office object sets it (its own SQLite run, `office/parts.ts`);
  every other host uses the Postgres `runCall`.
```

(old line 276)
```
- The usage feature is gone (owner, 2026-10-23: "no need for it, remove it"; the meter only counted and warned, it blocked nothing). Removed: the Admin
  Usage section, the calls `usage.get` and `usage.retryEffect`, `server/usage/` (the request, byte and failed-signal meter, `countRequest` after each
  batch and MCP request and job run, the 80% warning and its effect `usage.limitWarning`), the job step `usage`, the mail template `limitWarning`
  and its words. Kept: the Resend quota guard (`mail.quotaWarning`, `mail/quota.ts`), the job step `heartbeat` (the row `job_runs` "heartbeat"; the
  health check of the office object reads it as `lastJob`, `JOBS_LAST_RUN_SQL` in `jobs/steps/heartbeat.ts`), the outbox retries, and the database tables
  `usage_month` and `usage_warnings` (unused now: no migration, no drop; a drop needs the owner's OK). `usage_day` and the office cap stay (below).
```


### The office object (Supabase exit, wave 3)

(old line 284)
```
- Off on every deployed Worker: the office path runs only with the binding `OFFICE` and the var `MADAR_DATA = "office"`
  (`entries/officeEntry.ts`, `onOffice`). The bundle entry is `entries/workerMain.ts`; `entries/worker.ts` stays the Postgres path.
  Exit wave 4: the office ops under `/api/office/` go to the office path whenever the binding exists (`servesOffice`,
  `entries/officeWorker.ts`), so the import of wave 5 reaches the object before the word changes. The Cron still needs `onOffice`.
```

(old line 307)
```
- On the year office one Cron run reads about 1,500 rows (the file size sum of the usage step went, 2026-10-23; `CRON_PINS`, `office/test/pins.ts`).
```

(old line 308)
```
- The sign-in on the office object (the merge of exit waves 2 and 3): the object deps take `liteAuthAdmin`, so the invite and
  auth effects run in the object and only their mail goes through the Worker. With `MADAR_AUTH_PRIVATE_JWK`, `officeEntry` mounts
  the routes of `ownApiRoutes` under `/api` (`entries/officeSignin.ts`): each step is one call of `Office.signin`. The forgot and
  renew routes run their limits in `Office.mailRoute` and their mail after the answer in `Office.mailWork`; the Worker pads the
  answer to 1.5 s. A copy with the key also needs `MCP_URL`: it is the issuer of the own tokens. The Cron runs `cleanupSignin`
  in its first run after 00:00 UTC (the step `signin`, `office/jobs.ts`).
```

(old line 319)
```
- The hold (exit wave 4, `office/ops.ts`, `OfficeHold`, in memory): an export holds the office for at most 5 minutes, an import
  for at most 30. An export refuses a batch with a write (reason `busy`, "Madar saves its nightly backup"), a request of `/mcp`
  itself (503) and the Cron steps; reads, the sign-in steps, forgot, renew and the OAuth routes under `/mcp/` run, because their
  rows are the drift tables (`DRIFT_TABLES`). An import refuses every call, step and mail route, and the effects wait for the
  Cron. `Office.fetch` sends `/office/*` to `parts.ops`: `export` (begin, pages of at most 1,000 rows in rowid order, end with
  the version and `office_seq` of the begin) and `peek` (one select, at most 200 rows, only with `testToolsOn`). `/office/drop`
  deletes the storage of a spare object named `rehearsal-YYYYMMDD` only; that object takes no request after it.
```

(old line 326)
```
- The import (exit wave 4, `office/import.ts`, `/office/import`): begin (mode `empty`, `resume`, or `replace` with `testToolsOn`
  only) takes the hold of an import; each part (at most 2,000 rows of one records table) is one transaction, and a part whose
  first row is there already is skipped, so a client may send it again. The finish writes the server rows and the sign-in rows,
  adds the meters (the day row keeps the rows of the import), and raises the version above the object and the source, so no held
  office list looks current; then every socket closes. A replace also deletes the snapshot and raises the version.
```

(old line 331)
```
- The ops routes of the Worker (exit wave 4, `entries/officeWorker.ts`): `POST /api/office/export|import|peek|drop?office=<name>`,
  before CORS and Hono. Each one checks its secret header with `sameSecret` first: `x-madar-export-secret` (`MADAR_EXPORT_SECRET`,
  the nightly GitHub export) for `export`, `x-madar-ops-secret` (`MADAR_OPS_SECRET`, the Mac) for the others; a copy with no
  secret answers 401. Then the name: `export` and `import` take `office` or a rehearsal name, `peek` only `office`, `drop` only a
  rehearsal name (403 else). The body goes on to the object as a stream, with the name in `x-madar-office-name`.
```

(old line 339)
```
- The day cap of the test Worker (exit wave 4, `office/cap.ts`, `MADAR_DAY_CAP`, owner decision 6 form A: half of each Free day
  limit, `[env.test.vars]` only): over the rows written a write batch and a request of `/mcp` itself get `busy`; over the rows
  read or the requests every batch, sign-in step, forgot, renew and MCP request gets `busy` ("It works again at 03:00 Riyadh").
  The object reads the day counts again at most once a minute (`DAY_CAP_TTL_MS`) and at each new UTC day. The Cron, the effects
  and the ops are never capped.
```


## server/push/CLAUDE.md


### Browser push

(old line 3)
```
Madar sends a push to the browsers of its people (owner, 2026-10-08). It is free: the browser API (a service worker and the
push service of the browser). There is no email, no WhatsApp, no SMS and no account with a vendor. It works in Chrome, Edge,
Firefox and Safari on a computer, on Android, and on an iPhone once Madar is on the Home Screen.
```


### The push line (owner, 2026-10-21, "Like WhatsApp"; it replaces the empty push of 2026-10-08)

(old line 8)
```
- The push carries a line: a title, a body, a link in Madar, a tag and a language. A chat gives the name of the sender (a direct
  chat), of the group or of the project as the title, and "Name: first words" as the body (the words alone in a direct chat). A task
  comment gives the task title and "Name: words". A notice gives its project (or "Madar") and the sentence of the bell. The person's
  own language, with the Arabic name on Arabic screens (a person, and a project too, since fbk_062: `shownName` in `line.ts`). The body stops at 180 characters. A press opens that chat, task thread or
  notice. The lock screen shows it: the Settings hint says so.
```

(old line 19)
```
- A device with no keys (saved before 2026-10-21), a line that cannot be made (`lineOrNull` logs the error name only, never its
  text), or keys of a wrong form get the EMPTY push, and the service worker (`public/sw.js`) shows ONE fixed line: title "Madar"
  and body "You have something new in Madar." (Arabic: "مدار" and "لديك جديد في مدار."). The worker also shows the fixed line for a
  line it cannot trust (a missing title or body, a tag that does not start with `madar-`, a link that is not a path of this site).
```


### Quiet while Madar is in front (owner, 2026-10-23, fbk_028)

(old line 28)
```
Request: "each reply creates a desktop notification, even when the dm window is open". The push has no data, so the worker cannot tell a chat
message from a notice, and the server cannot know that a window is open. The fix is in `public/sw.js`, and it is small:
```

(old line 32)
```
- **WebKit never stays silent.** WebKit (Safari on a Mac, and every browser on an iPhone or iPad, whatever its name) needs a visible notice for every
  push. "Violations of the `userVisibleOnly` promise will result in a push subscription being revoked" (WebKit blog, "Meet Web Push", and "Meet
  Declarative Web Push": "if an event handler doesn't show the user visible notification for any reason we revoke its push subscription").
  A person would then get no push at all. So `mayStaySilent(userAgent)` answers true only for Chromium (`Chrome/`, `Chromium/`, so Edge and Samsung
  Internet too), and false for every iPhone and iPad agent (`iPhone`, `iPad`, `CriOS`, `FxiOS`, `EdgiOS`, `OPiOS`), Safari, Firefox and any engine
  that is not known. For those the worker calls `showNotification` first, before it asks for the windows. A list of windows that
  cannot be read also shows the line. The wrong answer is always "show the line", never "stay silent".
```

(old line 39)
```
- Why Chromium may: Chromium skips its "This site has been updated in the background" notice when a tab of the site is visible
  (`push_messaging_notification_manager.cc`, `IsTabVisible`, named in Chromium issue 549525847); the worker asks for more than that (visible and
  focused). Firefox is left out on purpose: its help page names a quota for pushes with no notice (Mozilla, "Web Push notifications in Firefox")
  but not the rule for a window in front, and a line too many costs nothing while a lost subscription costs every later push.
```

(old line 45)
```
- **The server wait and this rule work together** (the join of 2026-10-20). The chat batch (design item 20) gave the server a wait: a
  `push.chat` row (a chat message, a task comment, or a mention or reply notice of one) waits `CHAT_WAIT_MS` (10 s) after the answer on a chain
  of its own (`WAITED_KINDS` in `core/effects.ts`, `runCall`), so it holds neither the answer nor the mail chain of the batch. After the wait the
  server skips each person who already read that chat or task thread on any device ("Who gets a push"). A `push.notify` row has no wait. The
  worker rule stays for what the wait does not catch: a `push.notify` row, and a chat push for a person who did not read the chat in the 10
  seconds but has a window of Madar in front. The office object runs the waited kinds with no wait (exit-handoff section 10).
```


### Quiet hours (owner, 2026-10-22, fbk_048)

(old line 55)
```
A person sets work days and one time range (Settings, "Quiet hours"). Outside it Madar is quiet for that person: no push and no email. The bell and
the Inbox still collect everything. The rule is one pure function, `isQuiet` (`src/lib/quietHours.ts`, Riyadh time). The office sets the default range
and the lock (Sunday to Thursday, 8 AM to 5 PM since fbk_049, on by default): nobody is quiet inside the lock.
```


### Files

(old line 76)
```
- `words.ts`: the words of the line in an i18next instance of its own (as `server/mail/templates/words.ts`). It imports only the
  `inbox`, `notices` and `push` parts of the word files BY NAME, so the bundle keeps those parts only (the api bundle has a bound of
  900,000 characters; 853,323 on 2026-10-22 after hidden projects). `words.test.ts` checks that its `inbox` words are all the `inbox` words of the screens:
  a track that adds a bell sentence in a new word file adds that file to `words.ts`.
```

(old line 82)
```
- `server/it/push.it.test.ts` pins the exact row of `PUSH_DEVICES_SQL`: a new column fails only `test:it` (2026-10-22, the work hours).
```


### Who gets a push

(old line 88)
```
- A new unread notice that does not point to a chat message or a task comment (`isChatItemNotice`) gives a `push.notify` row at
  once (the notices of requests, bugs and meetings too, fbk_022). A new chat message, a new task comment, and a mention or reply notice of one give a `push.chat` row, after the 10-second wait.
  `planPushes` (`chatRule.ts`) decides: a direct chat or a group pushes its members; a project chat pushes the people its message
  names (an @mention or a reply); a person who picked All messages (`ChatRead.notify`) gets every message; a task comment pushes the
  task lead and the maker of an office task, and other people only when named. A named person gets the push of an office task comment only when the person reads the
  task: the maker, the lead, a helper, or a holder of `task.officeAll` (`PushPerson.officeAll`, from the roles of the office settings in `PUSH_PEOPLE_SQL`). A holder
  of `chat.project.all` outside the team is no candidate of a project chat: the person gets a push only when a message names the person. Never the author or the person an agent writes for;
  never for a reaction, a delete, a quiet line or an Undo; an edit pushes only a person it names for the first time. One row for each
  person for each save: a `push.notify` row wins over a `push.chat` row. The mention switch of Settings does not stop a push that
  names a person.
```

(old line 98)
```
- A hidden project (owner, 2026-10-22, wave D3): a person who does not view the project of a message or a comment gets no push, whatever the
  mention, the reply or the lead says, and also not through a notice of the item. `MessageFact.project` and `CommentFact.project` (`ProjectFact`:
  `hidden`, `teamIds`, `viewerIds`) carry the people of the project; `PushPerson.seesAll` and `seesHidden` carry `project.seeAll` and
  `project.hidden` (the Admin holds both). The view rule in `planPushes` is the one of `mayViewProject`: a holder of `project.hidden`, the
  leader, the team, a chosen person, and a holder of `project.seeAll` when the project is open. A chosen person is in `viewerIds`, never in `teamIds`,
  so a project chat pushes the person only when a message names the person. `PUSH_ITEMS_SQL` reads the team and `projects.doc->'access'` for a
  message and for a comment; the SQLite reader reads the office lists (`teamOf`). A fact with no project reads as the old rule, everyone. Quiet
  hours (`held.ts`) send the fixed line with no data and name no project. Tests: `hiddenProjectPush.test.ts`, `hiddenProjectLeaks.test.ts`.
```

(old line 106)
```
- An @everyone notice (`Notification.everyone`, 2026-10-22) gives the push like any mention notice of a new item: `planPushes` adds the person from the
  notice. It sends no mail. A person in quiet hours gets it later ("Quiet hours" above).
```

(old line 108)
```
- A copy for an Admin who picked "Everything" (`Notification.forUserIds`, owner 2026-10-23) gives no push: `PUSH_NEW_NOTICES_SQL` and the SQLite
  reader skip it. The choice does not change the push of a chat message either: `planPushes` reads the stored "Notify me" level and the default
  "named" of a project chat, never the Admin choice. Tests: `adminCopies.test.ts`.
```


### The path

(old line 116)
```
1. After the save of a write call, the producer (`pushRows`, registered for every shared write except `PUSH_FREE_CALLS`) reads the
   facts of the save (`chatFacts.ts`: at most two statements on Postgres, in the transaction of the call: the new notices, then `PUSH_FACTS_SQL`, which reads the items, the people with the device flag and the stored levels in one statement (SV-9, 2026-10-21; it was three); the office lists and
   reads by key on SQLite), asks `planPushes`, and writes one outbox row for each person (`push.notify` or `push.chat`). A rollback
   sends nothing. A new notice is a row whose `xmin` is the id of the open transaction (the rule of `NEW_NOTICES_SQL` in the mail
   guide). A new message and a new comment are `SaveResult.messageIds` and `SaveResult.commentIds` (the ids that the save inserted).
   An Undo call (`UNDO_CALLS`) pushes nothing for the comments it brings back.
```

(old line 138)
```
5. The headers are `Authorization: vapid t=<jwt>, k=<public key>`, `TTL: 86400`, `Urgency: high` and `Topic: madar` (owner,
   2026-10-20). One day of life: a phone with no signal for some hours still gets the line, and the topic keeps only the newest
   unsent push for each device. High: Android holds a normal push while the phone is in sleep mode (Doze) until it wakes.
   These fixes serve the Home Screen app until the store app comes.
   **Apple gets no Topic** (`topicFor`, 2026-10-21). Apple answers `400 {"reason":"BadWebPushTopic"}` to a push with
   `Topic: madar`, and the sender logs it only as "A push service refused a push" with the host. So no iPhone got a push from
   2026-10-08 to 2026-10-21. A probe on the test copy posted to a real iPhone: with the Topic 400 (also with the old TTL 3600,
   Urgency normal and a 1-hour token), with no Topic 201 (also with Urgency high and TTL 86400). A "refused" warning for
   `web.push.apple.com` in the function logs is the first sign of this kind of fault; the answer body of Apple names the reason.
   The sender sets no `Content-Length`: a fetch POST with no body sends `Content-Length: 0` by itself. The token has `aud` = the origin of the endpoint, `exp` under 12 hours (11 hours) and `sub` = VAPID_SUBJECT.
   The fetch never follows a redirect.
```

(old line 149)
```
6. On the office object (exit wave 3), `sendPush` signs the VAPID token in the object and posts through `deps.pushFetch`, the
   network port of the Worker. The Worker posts only to a push service (`postPush`, `server/office/net.ts`). The producer reads
   the new notices from `SaveResult.noticeIds` in place of the `xmin` test, and the effect marks or removes the devices with one
   statement for each endpoint (`PUSH_SENT_LITE`, `PUSH_GONE_LITE`).
```


### Rules

(old line 161)
```
- The server posts only to a push service. `isPushEndpoint` (`src/api/contract/push.ts`) lists the hosts: `fcm.googleapis.com`,
  `updates.push.services.mozilla.com`, `push.services.mozilla.com`, `*.push.apple.com` and `*.notify.windows.com`. The record
  refuses any other address, https only, no login, no port. `sendPush` checks it again. A browser with a new push host needs
  a line in `PUSH_HOSTS`.
```

(old line 167)
```
- The keys of a browser (owner, 2026-10-21) are as private as its endpoint: no view gives them, the person's own included
  (`PushDeviceView.hasKeys` only says that they exist; `pushLeaks.test.ts`). The log never holds the words of a line.
```

(old line 172)
```
- A sign-out removes the device of the browser and unsubscribes the browser (`removeThisDevice`, `src/app/remote/push.ts`), so the
  person who signed out gets no push. Push is on by default (owner, 2026-10-09): the permission stays in the browser, so the next
  sign-in saves the device again for that person, and `push.register` moves the endpoint to them (see `src/CLAUDE.md`).
```


### Keys and secrets

(old line 182)
```
- `npx tsx scripts/push/make-vapid.ts <test|production>` makes a pair, appends the three lines to `secrets/<env>.env`, sets the
  public value, and prints the public key only. It refuses to run when a VAPID line exists. A new pair makes every old
  subscription useless: the check at the start of the app (`syncThisDevice`) makes the browser subscribe again with the new key
  when the permission is still granted. Test and production each have a pair of their own (made 2026-10-08).
```


### Tests

(old line 191)
```
- The line (2026-10-21): `encrypt.test.ts` (the vector of RFC 8291, Appendix A), `line.test.ts` (the real calls on the sample office
  in memory: a direct chat, a group, an outsider who gets null, a task comment for a helper, an office task, a notice, Arabic),
  `notifyLine.test.ts` (the effects; the test decrypts the body as the browser does), `words.test.ts`.
```

(old line 194)
```
- The Docker lock and `test:it` run the integration suite. On 2026-10-08 the SQL and the migration were also run once on an
  in-memory Postgres 18 (pglite, outside the repo), because Docker was off. The local stack runs Postgres 17, so `test:it` stays the proof.
```

(old line 196)
```
- Proven on a real push service: desktop Chrome (team report fbk_028, 2026-10-19) and, after the Topic fix, Apple on an iPhone
  (201 from web.push.apple.com, 2026-10-21). The phone itself shows the line only on the owner's device check.
```


## server/daftra/CLAUDE.md


### Daftra link (the Daftra link, flow A, owner 2026-10-26)

(old line 3)
```
Madar only reads Daftra. The accountant keeps the books in Daftra, and Madar keeps the payment schedule of each project. A person links a payment to a
Daftra invoice in the screens. The 15-minute job then reads the invoice, and when Daftra says it is paid, Madar sets "Received". The spec is
`docs/superpowers/specs/2026-10-26-daftra-link-design.md`. Facts of the Daftra API: `docs/superpowers/real-build/proof.md`, section "Daftra study on the Mazj account".
```


### One account for each sub-company

(old line 20)
```
- The test copy gets only the MAZJ pair (the owner's test key) until the last step. Production gets the five pairs at the last step. Each key role should be
  "Only Allow" `invoice` and `client`.
```

(old line 22)
```
- Test copy setup (2026-10-26): `secrets/test.env` holds the `DAFTRA_MAZJ_*` pair, and the sample office has the sub-company MAZJ (مزج)
  with prj_001 under it. Its links point at real Mazj invoices: read only, and a payment recorded in Mazj Daftra is a real entry there.
```

(old line 24)
```
- Check a key role from the Mac with one GET of `/api2/products.json`: 403 means the role "Only Allow" `invoice` and `client` holds; 200 means
  it is not on (2026-10-26: all five production keys answered 200; Madar's own lock keeps them GET-only).
```


### The client (`client.ts`)

(old line 29)
```
- The read-only lock is Madar's own (owner, 2026-10-26): Daftra has no read-only key, and a key role ("Only Allow") limits the record types,
  not the changes. `readOnly.ts` wraps the fetch of `client.ts` and refuses any request that is not a GET or that has a body, with the code
  `read_only`, before it leaves. `client.ts` is the one door to `/api2/` (`readOnly.test.ts` scans `server/`). To let Madar write to Daftra,
  the owner decides first; then `DAFTRA_READ_ONLY` and the tests change in one commit.
  `daftraOf(deps, account)` gives a client for one account (undefined without keys for it), `daftraClientOf` is the same with explicit values.
  Address `https://<site>/api2/<entity>.json`, header `apikey`. `Deps.daftraFetch` is the fetch of a test: no test reaches Daftra (`fakeDaftra.ts`, one fake for each
  account, and `daftraDeps(...fakes)` routes each request by host).
```


### The calls (`server/calls/daftra.ts`)

(old line 54)
```
- Four server-only calls: `daftra.status` (the accounts and their state), `daftra.paymentLink` (account, match, one suggestion, up to 10 others; from the copy, plus one fresh look in Daftra when no invoice matches and the newer of the last invoice read and the last look (`daftra:look:<ACCOUNT>:<client>` in job_runs, saved before the look whatever its result) is a minute old or more, `FRESH_LOOK_MS`, owner 2026-10-26; a failed look keeps the copy and logs the code),
  `daftra.findClients` (the one live read of a screen), `daftra.matchClient` (keeps the match, fills the cache). Two shared calls: `payments.linkInvoice` (the preflight
  `paymentsLinkInvoiceHooks` reads the invoice from the account of the project, never from the browser) and `payments.unlinkInvoice`.
```


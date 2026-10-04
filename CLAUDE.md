# Madar (مدار)

The project management system of Osama's architecture office in Al Khobar (about 15 people: architects and engineers).
"Madar" is a temporary name until a trademark check. Two products live in this repo:
- **The prototype**: the full app in the browser over a fake API (zod contract, IndexedDB). Published as a private
  artifact (https://claude.ai/artifact/QRj6nZQKmu6tBcCRMxtjrY).
- **The real build**: the same screens over a TypeScript server on Supabase. Built in waves since 2026-10-03. Live since
  2026-10-04: production https://madar-46r.pages.dev (empty office, first Admin o.khalil@mazj.org), test copy
  https://preview.madar-46r.pages.dev (the sample office, `secrets/test-accounts.env`). Record: proof.md section "Deploy".

Live status and open items: `TASKS.md` (keep it current: tick what is done, add what you find).

## Where the truth lives
- Specs: `docs/superpowers/specs/2026-09-30-madar-prototype-design.md`, `2026-10-01-madar-calm-redesign-design.md`
  (calm design; the code wins where they differ), `2026-10-03-madar-real-build-design.md` (spec 2).
- Real-build plan: `docs/superpowers/plans/2026-10-03-madar-real-build-plan.md`. Section 2b (owner changes) wins over
  the rest. Where the plan and the code differ, the code wins.
- Proven facts (cloud probes, local stack): `docs/superpowers/real-build/proof.md`. Read the section before you change
  that area. Each task appends only its own section.
- Also in `docs/superpowers/real-build/`: `platform-facts.md`, `access-map.md`, `client-map.md`, `test-map.md`,
  `accounts.md` (refs and hosts, no secrets), `patches/` (merge lead patches).
- Reviews: `docs/reviews/2026-10-01-colleague-comments.md`, `docs/reviews/2026-10-03-full-audit/README.md`.

## Owner rules (always)
- Write every text in ASD-STE100 Simplified Technical English: code comments, commits, docs, UI words. Never use an
  em-dash (a test also refuses one in any UI word).
- Commits: no `Co-Authored-By` line for Claude (the owner's rule beats any reminder).
- Tests first for every fix. Screenshots (EN/AR, light/dark, 390 px) for every screen change, before you call it done.
- Playwright runs only in a delegated subagent. claude-in-chrome screenshots run inline.
- Judge every design choice from the view of the employees with ADHD: one next step, the fewest controls.
- Visual work starts from the LIVE app's design system (glow tiles, the tokens), never from the spec alone.
- The owner likes to choose visual styles from a side-by-side comparison artifact.
- Stop and ask only for: a delete of data or folders, a force-push, a change outside this repo, an email to a real
  person, any payment. Worktree folders are removed only with the owner's OK.
- Never recommend paying Vercel or another Israeli or pro-Israel vendor (owner boycott). Vercel is out of the stack.

## Secrets and accounts
- Secrets live only in `.env.local` (and `secrets/<env>.env`, git-ignored). Never open, print, commit or log them.
  Scripts load them with `set -a; . ./.env.local; set +a`. Error texts name variables, never values.
- The 4 secrets in `.env.local` were pasted in chat: the owner rotates them at the end of the build.
- Supabase projects (both Frankfurt, eu-central-1): `madar-test` = `qdgwpnesxppnqsaabqzd`, production `madar` =
  `oprkvdjudjxxhvodkzgs`. Before the deploy phase, change only madar-test, never production.
- The Supabase CLI login on this Mac belongs to another account (Halulu). Always pass `SUPABASE_ACCESS_TOKEN` from
  `.env.local` and `--project-ref`. Never log the CLI out.
- Cloudflare: wrangler signed in as o.khalil@mazj.org (R2 is not on). Pages project `madar` = `madar-46r.pages.dev`
  (`madar.pages.dev` belongs to someone else). Mail sender: `Madar <madar@vado.sa>` (verified in Resend).
  GitHub: private `byosamah/madar`, backups repo
  `byosamah/madar-backups`. A push that touches `.github/workflows` needs `gh auth refresh -h github.com -s workflow`,
  which the owner runs in his own terminal.

## Commands
- `npm run dev` - the prototype on Vite. `npm run build` - the prototype build (check-rtl, tsc, vite, check-bundles).
- `npm run build:remote -- <test|production>` - the real screens from `config/remote.<env>.env` (public VITE_ names only).
- `npm run build:server` - the server bundles: `supabase/functions/_build/{api,mcp,jobs}.js` and `dist-server/worker.js`.
- `npm run typecheck` - both tsconfigs (screens and server).
- `npm test` - the `unit` and `server` projects (about 3,400 tests). Run it alone: next to a build or Playwright,
  screen tests time out.
- `npm run test:db` - the `src/api` rule tests again on the local Postgres (one schema per worker, as madar_server).
- `MADAR_IT=1 npx vitest run --project it <files>` - integration tests on the full local stack, one file at a time.
  Each suite uses its own schema, so it leaves the public office alone. `scripts/restore-check.test.ts` needs
  `MADAR_AGE` (the `age` binary). Storage and R2 suites need MinIO (`server/it/minio.ts`).
- `npm run test:mcp` - MCP tests plus the conformance runner. `npm run icons` - the app icons.
- `npx supabase start -x edge-runtime` - the local stack (project CLI 2.119.0). Never the global `supabase`: it starts
  older images, and Realtime then refuses madar_server. A change to `supabase/config.toml` needs a stop and a start.
- `scripts/dev/docker-lock.sh run <holder> -- <cmd>` - every Docker or database task takes this lock first
  (`acquire`/`release` for long work, `status`). Only one local stack at a time (16 GB Mac).
- `npx supabase db reset` - after any migration change, from your own worktree, under the lock.

## Run the real product locally
1. `scripts/dev/docker-lock.sh acquire <holder>`, `npx supabase db reset`, `npm run build:server`.
2. `npx tsx tests/e2e-deploy/local.ts functions-env <file>`, then `npx supabase functions serve --env-file <file>`.
3. `npx tsx tests/e2e-deploy/local.ts seed` - the sample office and 4 accounts (`tests/e2e-deploy/accounts.ts`:
   Admin hala.nasser, Management turki.al.otaibi, Accounting noura.al.shammari, Member faisal.al.harbi, all
   `@madar.test`; passwords in `localPasswords` of `local.ts`).
4. `VITE_MADAR_API=remote VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
   npx vite build --mode remote-local --outDir test-results/remote-local`, then
   `npx vite preview --mode remote-local --outDir test-results/remote-local --host 127.0.0.1 --port 4174 --strictPort`.
- `supabase status -o env` has no API_URL: the API is `http://127.0.0.1:54321`. Postgres is 54322, Mailpit 54324.
- Mail stays local (`MAIL_DRIVER=outbox`, table `mail_outbox`). Release the lock when the owner is done.

## Architecture
- Screens: React + TypeScript + Vite + Tailwind v4, React Router, TanStack Query, Motion, i18next, vaul sheets.
- Server: one Hono app in TypeScript, the same source for Supabase Edge Functions (Deno, pinned to eu-central-1) and a
  Cloudflare Workers fallback (paid plan, local only today). Database, Auth, Realtime and Storage: Supabase (Free).
- Hosts: screens on Cloudflare Pages (project `madar`, one project for test and production, risk 21). Email: Resend.
- Two builds from one source: `VITE_MADAR_API` (`fake` default, `remote`) is fixed at build time. Use
  `PROTOTYPE`/`REMOTE` from `src/app/mode.ts`. `src/main.tsx` loads only one bootstrap.
- The prototype uses `createHashRouter` (links `#/...`, base `./`, one script file). The remote build uses
  `createBrowserRouter` (path links, base `/`). Screen tests use the hash router.

### Screens and data
- Screens call `api.call(name, input)`. Hooks: `useCall` (reads) and `useAction` (writes) in `src/app/runtime.tsx`.
- Each call is `defineCall({ input, output, run, prepare?, readOnly?, prototypeOnly? })` (`src/api/registry.ts`).
  Handlers live in `src/api/handlers/*.ts`. `src/api/calls.ts` joins them with `serverFakes.ts` (the fakes of the
  server-only calls). The output is checked inside the change, so a wrong shape rolls it back (`src/api/execute.ts`).
- The contract: `src/api/contract/entities.ts` (records, ids like `prj_`, `tsk_`), `views.ts` (read shapes),
  `server.ts` (the server-only calls and `PASSWORD_SET_MARK`).
- One permission function: `can(actor, action, resource)` in `src/api/permissions.ts`. No screen checks a right
  another way. An agent acts with its owner's rights (`resolveAuthority`).
- `src/app/readMap.ts` says which change kinds each read reads. The remote build keeps answers until a change signal
  names them (`src/app/signals.ts`, `src/app/remote/channel.ts`).
- `src/api` never imports `server/` or `src/app/`. A contract change is additive or keeps both forms. The fake API
  implements every new call. The test count only grows.

### Server request path
- `POST /api/batch?forceFunctionRegion=eu-central-1` (`server/http/batch.ts`): at most 12 entries, 256 KB, 1 overview
  call. An old `X-Madar-Build` gives 409 `client_outdated`. CORS allows only listed origins.
- The token check (`server/auth/verify.ts`): jose, ES256 only, issuer `${SUPABASE_URL}/auth/v1` (or `AUTH_ISSUER`).
  Never compare `aud` by hand. A token with `client_id` is an agent token: the api function refuses it with 403.
- `principalOf` (`server/auth/principal.ts`) finds the person by `auth_user_id`. The role comes from the users row,
  never from the token. A turned-off person gets 403 `account_off`.
- `runCall` (`server/core/runCall.ts`) for each entry: a read runs in a repeatable-read, read-only transaction with no
  lock. A write runs preflight outside the lock, then `set local lock_timeout 5s` and `statement_timeout 10s`, the
  office lock, the idempotency check, the story, the loader, `executeParsed`, the diff save, the outbox rows, the
  signals, the commit. After the commit `processOutbox` runs the effects once; the 15-minute job retries the rest.
- 10 server-only calls: `story.start`, `files.uploadStart`, `files.link`, `feedback.uploadStart`, `users.invites`,
  `users.resendInvite`, `agents.list`, `agents.remove`, `usage.get`, `usage.retryEffect` (`server/calls/`).
  Server hooks replace the prototype `prepare` of `files.upload`, `feedback.send`, `feedback.screenshot`,
  `projects.delete`. `SERVER_EXCLUDED`: `session.previewAs`, `session.setSimulateErrors`, `session.resetSampleData`,
  `files.get`.
- Entries: `server/entries/{api,mcp,jobs,apps}.ts`, Deno wrappers `deno-*.ts`, Workers `worker.ts` (one Db for each
  request, database through the Hyperdrive binding `DB`). Each Supabase function imports only its own mount.
- Deno needs the bundle (no extensionless imports). `wrangler dev` uses esbuild with no `import.meta.glob`, so server
  code reads word files with plain JSON imports (`server/workerGraph.test.ts`).
- Ports (`server/core/ports.ts`): Db, Clock, FilesPort, MailPort, SignalPort, AuthAdminPort, MeterPort. Fakes in
  `server/test/fakes`. `buildDeps` (`server/core/deps.ts`) names a missing env variable, never a value.

### Data layer
- Each entity table: `id text pk`, `ord bigserial`, `doc jsonb` (the whole zod record), generated key columns,
  `search_text`, `chg` (`supabase/migrations/20261004000100_core.sql`, `server/data/tables.ts`).
- `events` only grows: a trigger refuses update and delete, and madar_server has only select and insert. Undo is a new
  event (`undoes`). The save never writes `undoneBy`.
- Counters are a table under the office lock (no gaps). Story IDs: `sty_` + 22 base32 characters, under 24 hours, same
  actor. Idempotency keys belong to the actor, digest = sha256 of name and input; the same key with another input
  gives `conflict` `key_reused`.
- Office cache (`server/data/officeCache.ts`): committed rows only, frozen, versioned by `office_meta.version`. Any
  change to an office table raises the version, sets `chg` and records deletes in `office_deletes` (kept 7 days).
- Loaders (`server/data/loaders`): every call needs a loader entry, or a test fails. The db-mode shadow run
  (`server/test/shadow.ts`) runs each API test in memory and on the database and fails on any difference.
- Server-only tables (`20261004000101_server_tables.sql`): office_meta, office_deletes, person_seq, platform_config,
  stories, idempotency, outbox, upload_intents, agent_links, mail_log, mail_outbox, usage_month, usage_warnings,
  rate_limits, job_runs.
- madar_server owns nothing. RLS is on for every table, with one policy for madar_server only. anon and authenticated
  have no grant. The Data API (PostgREST, GraphQL) is off. New functions get no default EXECUTE: grant each by name.
- `madar_private` security definer functions: `current_madar_user_id`, `agent_session_ok`, `agent_session_at`,
  `agent_client`, `agent_authorization`, `storage_bytes`. Public: `madar_access_token_hook`.
- Migrations: never write `public.` in a table name. Never edit a merged migration: add a new file. No migration holds
  a secret (CI checks `create_secret(`). Files named `*_platform_*` need Supabase schemas, so the test harness skips
  them. Ranges: app 20261004000100-199, realtime 0200, cron 0300, auth and agents 0400s, files 0500, usage 0600s.

### Rules a change must keep
- Never write to the database outside `runCall` (or a server write call that copies its steps). Handlers stay
  synchronous and pure. Outside work goes through the outbox, written in the call's transaction.
- Lock order: the office lock, then the mail lock. The mail reserve takes only the mail lock, in its own transaction.
- A preflight hook does network work before the transaction and never holds the lock. Every network call has a 3 s
  timeout. Only `set local` on the pooler: `server/data/sql.ts` refuses a plain SET.
- Every shared call works in the prototype fake and on the server. A new zod collection needs a table in a migration
  and in `tables.ts`. A new effect kind needs `registerEffect`. A new shared call goes into the MCP allow or deny list.
- Database TLS fails closed: TLS with the Supabase root CA (`DATABASE_CA`) for every host except loopback and the
  local Docker hosts. No `sslmode` in a URL.

## Features and their security rules
### Sign-in and people
- Email and password. Open sign-up is off. Only an Admin invites. Madar sends the invitation and reset mail itself.
- `otp_expiry = 3600`. Never 86400: Auth has one life for every email link, so a reset link would live a day too.
- Invitation (`server/auth/invite.ts`): an `invite` link while the Auth user is unconfirmed, a `recovery` link after
  (Auth answers 422 `email_exists`). Call `generate_link` only for an email that a users row holds.
- Renew key ("Send me a new link", `server/auth/renew.ts`): random, 52 base32 characters; Madar keeps only its
  sha256 after the send, and a key works only after its mail went out. The same answer for every key, limits per key
  and per address, a 1.5 s minimum answer, the work after the answer.
- Forgot: the same answer for every email, 3 a day per email, 10 an hour per address, no office-wide cap.
- The client address is `cf-connecting-ip` only (proven: it cannot be forged behind Cloudflare). Never read
  `x-forwarded-for` or `true-client-ip`.
- Welcome and Reset use the link token only on the button press, and sign out the other devices after a save.
- Accepted = a confirmed email AND the user_metadata mark `madar_password_set` (`PASSWORD_SET_MARK`). Auth confirms
  the email and stores a password value as soon as an invite link opens. The screens set the mark with each password
  save and after a password sign-in. users.invites, the renew route and the auth.email effect use this rule.
- Only an Admin changes an email, never through an agent. After acceptance the old address gets a notice (no link).
  A security notice is never marked done unless its mail went out.
- Turn-off: `auth.ban` (100 years) and `agents.revokeAll`. Effects read the person again when they run.
- First Admin: `npx tsx scripts/first-admin.ts --env test|production|local --email --name --language --gender`.

### AI agents (MCP)
- MCP spec 2026-07-28, stateless, with a 2025 fallback. 36 tools (15 reads, 21 writes); everything else is in
  `MCP_DENY` (`server/mcp/tools.ts`), and a test fails for a call in neither list.
- MCP token: ES256, `aud` = MCP_URL (set by the token hook from `platform_config.mcp_url`), `client_id` required, only
  from the Authorization header. Every 401 carries `WWW-Authenticate` with `resource_metadata`.
- Madar records its own approval before Auth approves (`server/mcp/approval.ts`), because Auth lets an agent token
  approve a client itself. A removed link never links again (`agent_removed`). Agent users are reused only for the
  same person, app name and the whole sorted set of redirect addresses.
- The consent screen: `safeRedirect` (`src/features/oauth/knownHosts.ts`) refuses script schemes; an unknown host gets
  a warning. 60 tool calls a minute per person. Reasons (stage back, date move) use `input_required`.
- Open risk (owner decision, Z7): an agent token has the person's full rights on Auth's own endpoints.

### Files
- Supabase Storage first (private bucket `madar-files`, 50 MB per file, 1 GB total). R2 is built behind the S3
  interface and switches with `MADAR_FILE_STORE=r2` (owner has not turned R2 on).
- Inline only for pictures, PDF, plain text, video and audio (`INLINE_SAFE`). Every other type is stored as
  `application/octet-stream`. The confirm step checks size and type of the FINAL object. Upload links never upsert.
- Check `project.view` (and that the person is active) right before signing any link (`server/files/rights.ts`).
  Never put a signed link in a message.

### Email
- Resend over HTTPS. Free plan: 100 a UTC day. `QUOTA_LIMITS`: notice 90, summary 90, signin 98, warning 98
  (`server/mail/quota.ts`). Every invitation and reset counts as signin. A full day throws `QuotaFull`: the row waits
  until the next UTC midnight. `release()` gives back the place of a row that never made a link.
- Notice and summary mail carry no client data (no task, project or comment text). Morning summary 07:30 Riyadh,
  Sunday to Thursday. Arabic mail is right to left with `_female` forms. The sending domain waits for the owner.

### Realtime, jobs, usage, backups
- Change signals go out inside the save transaction (`realtime.send`, topics `office` and `person:<id>`). A rollback
  sends nothing. A failed send only warns, and the sender counts it.
- pg_cron every 15 minutes calls `jobs/run` (secret `x-madar-jobs-secret`). Steps: heartbeat, triggers, summary,
  outbox, cleanup, uploads, usage. Each step is idempotent.
- Usage meters and the 80% Admin warning (`server/usage/`). Free-plan limits in `FREE_PLAN_LIMITS`.
- Nightly database backup (age-encrypted, `byosamah/madar-backups`, 30 days), weekly files copy to B2, monthly
  restore check by hand (`scripts/restore-check.ts`).

## Screens and design system
- Routes (`src/app/routes.tsx`): `/` Home, `/projects`, `/projects/:id` (tabs overview, tasks, activity, tracker,
  schedule, files, team), `/work` (Tasks), `/dashboard`, `/dashboard/meeting` (full screen), `/inbox`,
  `/notifications`, `/search`, `/settings`, `/admin`. Remote only: `/sign-in`, `/welcome`, `/forgot`, `/reset`,
  `/oauth/consent`.
- Shell (`src/app/AppShell.tsx`): a floating tab pill (Home, Projects, Tasks, Dashboard, Inbox, plus Search and the
  bell; top on desktop, bottom on a phone), the Madar mark at the top start (a press opens Home), the person menu.
  No sidebar. Focus mode is `?focus=<taskId>` with a 25-minute timer.
- Roles: Admin, Management, Accounting, Member; per project a leader and a team. Anyone creates a project and leads it.
  Everyone sees all projects. Payments only for Admin, Management, Accounting. Agents never join a team.
- Tokens: `src/design/tokens.css` (`tokens.test.ts` checks contrast). The signature is solid navy `#1F2A55` (dark
  `#C9D4FF`), never a gradient, only on the one main button, the open tab, the day ring and the timer.
- The glow (three soft lights) sits only behind "Next for you" and in the logo tile. 8 project hues from a hash of the
  id. Project pictures are "glow forms" with a unique `mark`. Status words are shape signs plus an ink word (no
  tinted pill). The stage steps line takes the status colour. Red only for Late and errors.
- Calm rules (`expectCalm` in tests): one title, at most one main button, no filter chip rows (one Filter button), no
  grid view, no avatar stacks, "On track" never shows in lists. Liquid Glass is gone: only the tab pill keeps a blur.
- Icons: animated Lucide icons from lucide-animated.com through `AnimatedIcon`. Logo: `MadarMark` ("Turning doors"),
  only in the sign-in frame and the app frame, never in a project list (`MadarMark.test.tsx` lists the files).

### Words
- Every visible word has an English and an Arabic key: base `src/i18n/en.json`/`ar.json`, track files in
  `src/i18n/real/<track>.{en,ar}.json`. A key may not exist twice. `keys.test.ts`, `i18n.test.ts` and
  `arabic.test.ts` check the keys, the placeholders, the Arabic script and the plural forms.
- An Arabic verb after a person's name needs a `_female` key. Arabic plurals use `_one/_two/_few/_many/_other`.
- Western digits and the Gregorian calendar in both languages (`ar-SA-u-ca-gregory-nu-latn`). Office time is UTC+3.
  The week is Sunday to Thursday.
- Gentle wording: "3 days past due" in the attention colour, never a red "Overdue".
- RTL: logical classes only (`start/end`, `ms/me`, `ps/pe`). `scripts/check-rtl.ts` fails on left or right styles.

### Prototype data
- `src/data/seed.ts` builds the sample office (Hala Nasser is Admin). `STATE_VERSION` is 8 (`src/api/store.ts`);
  each version has a step in `src/data/migrate.ts`. A newer or unreadable saved office is never wiped.
- `scripts/check-bundles.ts`: the remote build must hold no sample names; the prototype build must hold no "supabase".

## Tests
- The test layers are listed in Commands. Last counts: unit+server 3,367 passed; test:db 826; test:it 236.
- Prototype smoke: `playwright.config.ts` (`tests/e2e`, port 4173), 87 of 87 at each screen merge.
- Deploy suite: `npx playwright test -c playwright.deploy.config.ts`. Local by default (needs
  `MADAR_LOCAL_PUBLISHABLE_KEY` and a fresh seed); `MADAR_DEPLOY_URL` points it at the test deployment. Flags:
  `MADAR_E2E_AFTER_G=1`, `MADAR_E2E_AFTER_M=1`, `MADAR_E2E_WALK=1` (the whole-product walk, `walk.spec.ts`).
- Screen test gotchas: links are `#/...` (hash router). A whole project page can take more than the 1 s `findBy`
  default: use `{ timeout: 10_000 }`. A panel that waits for its own query (DecisionsPanel on `projects.get`) can come
  after the card: wait for the panel itself.

## CI and deploy
- `.github/workflows/`: `ci.yml` (every push: typecheck, unit, build, server tests, builds), `ci-stack.yml` (db and
  integration on the local stack), `db-backup.yml`, `files-backup.yml`, `restore-reminder.yml`, `deploy.yml` (by hand,
  test functions only, never screens).
- Deploy scripts `scripts/deploy/`: `all.sh <env>` runs `db.sh`, `config.sh`, `secrets.ts`, `functions.sh`,
  `pages.sh`. Production deploys only from the Mac and asks for the typed word `production`. `config.sh` refuses until
  `supabase/config.toml` has `[remotes.test]` and `[remotes.production]` (they wait for the domain).
- `scripts/seed-test-office.ts` seeds madar-test only (load `.env.local` and `secrets/test-accounts.env`). The Z steps
  (plan Track Z): Z0a, Z0b done; Z1 mostly done (open: legacy keys and HS256 revoke by the owner, "require current
  password"); Z2 R2 waits; Z3 sender vado.sa chosen; Z4 Pages done (own domain later); Z5 backups wait; Z6 seed done;
  Z7 security review; Z8 first Admin done, then a 2-week pilot.
- Server secrets of each project: `secrets/<env>.env` (git-ignored). `all.sh production` asks for the typed word; the
  auto-mode safety system may refuse a production deploy or a key change until the owner says so in chat.
- wrangler 4.147+ sends `pages project create` to the new Workers path; the project exists now, so `pages deploy` works.

## Build process
- One worktree per track at `~/dev/madar-rb/<track>` (branch `rb/<track>`, `node_modules` symlinked). Each wave: build,
  2 reviewers, repair, merge lead (in plan order, with the merge lead patches), then a whole-product check on the
  local stack (`db reset`, remote build, functions, seed, the walk in 4 variants, the deploy suite).
- Merge gate: rebase on main, typecheck, `npm test`, `npm run build`, `build:server`, `build:remote -- test`,
  `test:db`, `test:it`, and the prototype smoke at screen merges. No merge with a red check.
- A task edits only its own files. New words go only into its own `src/i18n/real/<track>` files.
- Never send a message to a running Workflow agent: it starts a duplicate copy in the same worktree.

## Owner decisions (history, newest wins)
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
  Sign-in with email and password. Start empty. AI agents (MCP) in version 1. No phone push; a mobile app comes later
  on the same API.
- 2026-10-04: logo "Turning doors"; the mark at the top start of every screen; "Invited" until the first password.

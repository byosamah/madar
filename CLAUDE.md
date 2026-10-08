# Madar (مدار)

The project management system of Osama's architecture office in Al Khobar (about 15 people: architects and engineers).
"Madar" is a temporary name until a trademark check. Two products live in this repo:
- **The prototype**: the full app in the browser over a fake API (zod contract, IndexedDB). Published as a private
  artifact (https://claude.ai/artifact/QRj6nZQKmu6tBcCRMxtjrY).
- **The real build**: the same screens over a TypeScript server on Supabase. Built in waves since 2026-10-03. Live since
  2026-10-04: production https://madar.vado.sa (since 2026-10-05; www.madar.vado.sa and madar-46r.pages.dev also work;
  first Admin o.khalil@mazj.org), test copy https://preview.madar-46r.pages.dev (the sample office,
  `secrets/test-accounts.env`). Record: proof.md section "Deploy".

Live status and open items: `TASKS.md` (keep it current: tick what is done, add what you find).

## Guides for each part
This file holds only the rules for the whole repo. Each part has its own CLAUDE.md, and Claude Code loads it when it
opens a file in that folder. Read the guide of a part before you change that part.

| Part | Guide | What it covers |
| --- | --- | --- |
| Server | `server/CLAUDE.md` | request path, runCall, calls, entries, ports, change rules, realtime, jobs, usage |
| AI agents (MCP) | `server/mcp/CLAUDE.md` | the /mcp address, tools lists, token, approval, conformance |
| Sign-in and people | `server/auth/CLAUDE.md` | invitations, renew, forgot, limits, Accepted or Invited, first Admin |
| Data layer | `server/data/CLAUDE.md` | tables, counters, idempotency, office cache, loaders, roles |
| Email | `server/mail/CLAUDE.md` | Resend, drivers, the day quota, mail content, deliverability |
| Files | `server/files/CLAUDE.md` | stores, the upload flow, safe types, signed links |
| Screens | `src/CLAUDE.md` | two builds, routes, shell, roles, design rules, screen tests |
| API contract | `src/api/CLAUDE.md` | defineCall, the contract, `can()`, the new-call checklist, prototype data |
| Words | `src/i18n/CLAUDE.md` | word keys, Arabic forms, dates and digits |
| Design tokens | `src/design/CLAUDE.md` | tokens.css, how to keep `DESIGN.md` in step |
| Design system | `DESIGN.md` | the full design system (Google DESIGN.md format) |
| Supabase | `supabase/CLAUDE.md` | migrations, config.toml, functions, the local stack, hosted settings |
| Deploy | `scripts/deploy/CLAUDE.md` | all.sh, production rules, Cloudflare, DNS, first Admin |
| Browser tests | `tests/CLAUDE.md` | prototype smoke, deploy suite, its env and guards |
| CI and backups | `.github/CLAUDE.md` | workflows, their secrets, backups |
| Browser push | `server/push/CLAUDE.md` | the empty push, VAPID, who gets one, devices, keys, the service worker |
| Pages Functions | `functions/CLAUDE.md` | the /mcp forwarder on Cloudflare Pages |

**Keep the guides true.** When you learn a fact about one part, write it in that part's guide, not here. When a change
makes a guide line wrong, fix the line in the same commit. A rule that applies to two or more parts stays in this file.

## Where the truth lives
- Specs: `docs/superpowers/specs/2026-09-30-madar-prototype-design.md`, `2026-10-01-madar-calm-redesign-design.md`
  (calm design; the code wins where they differ), `2026-10-03-madar-real-build-design.md` (spec 2).
- Real-build plan: `docs/superpowers/plans/2026-10-03-madar-real-build-plan.md`. Section 2b (owner changes) wins over
  the rest. Where the plan and the code differ, the code wins.
- Proven facts (cloud probes, local stack): `docs/superpowers/real-build/proof.md`. Read the section before you change
  that area. Each task appends only its own section. The cloud probes that proof.md names live in `scripts/proof/`. No
  build runs them, but keep them.
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
- Stop and ask only for: a delete of data or folders, a force-push, a change outside this repo, an email to a real
  person, any payment. Worktree folders are removed only with the owner's OK.
- Never recommend paying Vercel or another Israeli or pro-Israel vendor (owner boycott). Vercel is out of the stack.
- Fonts: Thmanyah Sans (free, font.thmanyah.com) since 2026-10-05. Its licence forbids any change to the files and any
  copy outside the built product (see `src/design/CLAUDE.md`).

## Secrets and accounts
- Secrets live only in `.env.local` and `secrets/<env>.env` (both git-ignored). Never open, print, commit or log them.
  Scripts load them with `set -a; . ./.env.local; set +a`. Error texts name variables, never values.
- To get a secret from the owner: `open -a TextEdit .env.local` and ask him to add a `NAME=value` line, then check its
  shape without printing it. Never ask for a secret in chat: Supermemory also saves what is pasted in chat.
  The sandbox blocks `open`: ask the owner to type `! open -a TextEdit <file>` in the prompt.
- Rotated 2026-10-05: both database passwords, the Supabase token, and the Resend key in `.env.local` (the Resend keys
  are listed in `server/mail/CLAUDE.md`).
- The backup private key is not on the Mac. The owner holds it (password manager and paper). Opening a backup needs him.
- Supabase (both Frankfurt): `madar-test` = `qdgwpnesxppnqsaabqzd`, production `madar` = `oprkvdjudjxxhvodkzgs`.
  The CLI login on this Mac belongs to another account (Halulu): always pass `SUPABASE_ACCESS_TOKEN` and `--project-ref`.
- Cloudflare: wrangler as o.khalil@mazj.org, Pages project `madar`. GitHub: private `byosamah/madar`, backups
  `byosamah/madar-backups`. Mail sender: `Madar <madar@vado.sa>`.

## Commands
- `npm run dev` - the prototype on Vite. `npm run build` - the prototype build (check-rtl, tsc, vite, check-bundles).
- `npm run build:remote -- <test|production>` - the real screens from `config/remote.<env>.env` (public VITE_ names only).
- `npm run build:server` - the server bundles: `supabase/functions/_build/{api,mcp,jobs}.js` and `dist-server/worker.js`.
- `npm run typecheck` - both tsconfigs (screens and server).
- `npm test` - the `unit` and `server` projects (about 4,380 tests). Run it alone: next to a build or Playwright,
  screen tests time out. With a load average far above the core count (`uptime`), other screen tests time out on each
  run: run the failed files alone (`--no-file-parallelism --testTimeout=60000`) before you call a test broken.
- Port 5173 on this Mac often runs another project. Start Madar with `npx vite --host 127.0.0.1 --port 5180
  --strictPort` and check that the page title is "Madar". Run it from `deploy-test`: the main folder's `node_modules` can
  lack a new package, and the page then breaks.
- `npm run build` and `build:remote` both write `dist/`. In the sandbox, `build:remote` fails with
  `listen EPERM ... tsx-*.pipe`: run it with the sandbox off.
- A one-off script in the sandbox: `node --import tsx <file>` needs no tsx pipe. Add `NODE_USE_ENV_PROXY=1` when the
  script uses `fetch`. A script outside the repo needs the `.mts` ending.
- A direct Postgres connection (the pooler, port 5432) fails in the sandbox with `ENOTFOUND`: run it with the sandbox off.
- `npm run test:db` - the `src/api` rule tests again on the local Postgres (one schema per worker, as madar_server).
- `test:db` tests also time out under a load average far above the core count: check `uptime`, and run the failed files
  again at a low load before you call a test broken.
- `test:db` and `test:it` need Docker Desktop running. The sandbox blocks `open -a Docker`: ask the owner to start it.
- `MADAR_IT=1 npx vitest run --project it <files>` - integration tests on the full local stack, one file at a time.
  Each suite uses its own schema. `scripts/restore-check.test.ts` needs `MADAR_AGE` (the `age` binary). Storage and R2
  suites need MinIO (`server/it/minio.ts`).
- `npm run test:mcp` - MCP tests plus the conformance runner. `npm run icons` - the app icons.
- `npx supabase start -x edge-runtime` - the local stack (project CLI only, see `supabase/CLAUDE.md`).
- `scripts/dev/docker-lock.sh run <holder> -- <cmd>` - every Docker or database task takes this lock first.
- Size of an old build: `git archive <sha> | tar -x -C $TMPDIR/base`, link `node_modules` into it, build there.
- `npx supabase db reset` - after any migration change, from your own worktree, under the lock.
- Last counts: unit+server 4,382 passed (437 files); test:db 1,063; test:it 241; prototype smoke 87 of 87.

## Run the real product locally
1. `scripts/dev/docker-lock.sh acquire <holder>`, `npx supabase db reset`, `npm run build:server`.
2. `npx tsx tests/e2e-deploy/local.ts functions-env <file>`, then `npx supabase functions serve --env-file <file>`.
3. `npx tsx tests/e2e-deploy/local.ts seed` - the sample office and 4 accounts (`tests/e2e-deploy/accounts.ts`:
   admin, management, accounting and member, each `@madar.test`; passwords in `localPasswords` of `local.ts`).
4. `VITE_MADAR_API=remote VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
   npx vite build --mode remote-local --outDir test-results/remote-local`, then
   `npx vite preview --mode remote-local --outDir test-results/remote-local --host 127.0.0.1 --port 4174 --strictPort`.
- Mail stays local (`MAIL_DRIVER=outbox`, table `mail_outbox`). Release the lock when the owner is done.

## Architecture in one view
- Screens (`src/`): React + Vite + Tailwind v4 on Cloudflare Pages. One source makes two builds, fixed at build time by
  `VITE_MADAR_API`: `fake` (the prototype) and `remote` (the real build).
- Contract (`src/api/`): every call is a zod-checked `defineCall`. The prototype runs it in the browser. The server runs
  the same handler.
- Server (`server/`): one Hono app on Supabase Edge Functions (Deno, Frankfurt), with a Workers fallback.
- Data: Supabase Postgres, Auth, Realtime and Storage (Free plans). Email: Resend. Browser push: Web Push, free (`server/push/`).
  AI agents: MCP at /mcp.
- A screen calls `api.call(name, input)`. The remote build sends it to `POST /api/batch`. The server runs it in `runCall`
  under the office lock, saves the difference, and sends a change signal on Realtime.

## Rules that cross parts
- `src/api` never imports `server/` or `src/app/`.
- Never write to the database outside `runCall`. Handlers stay synchronous and pure. Outside work goes through the outbox.
- Every shared call works in the prototype fake and on the server. Follow the new-call checklist in `src/api/CLAUDE.md`
  (loader entry, MCP allow, Admin or deny list, the `WRITE_KINDS` line of a write, words).
- A new zod collection needs a table in a migration and an entry in `server/data/tables.ts`.
- A contract change is additive or keeps both forms. The test count only grows, except when the code a test checks
  is deleted.
- Every visible word has an English and an Arabic key.
- Every feature change updates the MCP side in the same commit: the allow, Admin or deny list (`server/mcp/tools.ts`), `TOOL_DOCS`
  (`server/mcp/docs.ts`), and `INSTRUCTIONS` when a rule changes (owner, 2026-10-05).
- A feature that hides a record from some people gets leak tests from its own builder: probes as an outsider on
  every read path, error texts and Realtime signals included (office tasks, 2026-10-06). No separate leak review
  (owner, 2026-10-07).

## Build process
- One worktree per track at `~/dev/madar-rb/<track>` (branch `rb/<track>`, `node_modules` symlinked). Each wave: build,
  merge lead (in plan order, with the merge lead patches), then a whole-product check on the
  local stack (`db reset`, remote build, functions, seed, the walk in 4 variants, the deploy suite).
- No separate checker (owner, 2026-10-07): no reviewer, verifier or critic agent after a build. Run each suite once.
  Run it again only after a fix for a failure.
- Merge gate: rebase on main, typecheck, `npm test`, `npm run build`, `build:server`, `build:remote -- test`,
  `test:db`, `test:it`, and the prototype smoke at screen merges. No merge with a red check.
- A task edits only its own files. New words go only into its own `src/i18n/real/<track>` files.
- Agent tool worktrees live in `.claude/worktrees/agent-*` (Workflow agents: `wf_<run>-<n>`, branch `worktree-wf_<run>-<n>`)
  and may start on an old commit: brief each agent to run
  `git merge --ff-only <batch branch>` first. Removal: `git worktree remove --force`, `git worktree prune`, then `git branch -d`
  its branch and its `worktree-agent-*` branch (sandbox off).
- While a release waits on its recorded commit, build the next batch in a worktree branch: production refuses any new commit
  on main.
- A helper that a subagent starts reports to the main session, not to that subagent: forward what the subagent needs.
- Claude's `git push origin main` is refused by the auto-mode check. Commit on main in `deploy-test`, then hand the owner
  `! git -C /Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test push origin main` (2026-10-08).
- A Playwright agent writes `.playwright-mcp/` into its working directory. In the repo it is a new untracked folder, and
  production refuses a folder with a new file. Brief each agent to `cd` into the scratchpad first. After each run, check
  `git status` in the main folder and in `deploy-test`, and move the folder out.
- Start a browser-check agent without `name`: named agents became teammates that handed the work to a sub-agent, and several
  reports ended with "no report". Ask for the report in the final message and in a scratchpad file.
- `git branch -d` tests against the HEAD of the folder where it runs. The main folder is detached, so it refused merged
  branches. Run it from `deploy-test` (HEAD = main), or check `git merge-base --is-ancestor <branch> main` and use `-D`.
- Agents without Docker cannot run `test:db` or `test:it`: the merge lead runs them and fixes what they pin.
- Never send a message to a running Workflow agent: it starts a duplicate copy in the same worktree.
- A Workflow agent that stopped (an API error) keeps its commits, but SendMessage cannot resume it, and a re-run
  starts it again from its brief. Start a finisher in the same worktree with the commit list and the transcript
  (`subagents/workflows/<run>/agent-*.jsonl`; `agent-*.meta.json` names the label).
- Ask each builder to write its report to a file in its worktree before it returns it, so a dropped last call loses nothing.
- A Workflow `scriptPath` must be inside the repo (a path in /tmp is refused): keep it untracked in the worktree, delete it after.
- Brief parallel builders to run their test files with `--no-file-parallelism --testTimeout=60000`.
- `npm install` in a worktree whose `node_modules` is a link puts a full folder in place of the link, so the folder behind
  the link lacks the new package. The main folder follows its own branch: after a new package, give `deploy-test` its own
  folder (`rm node_modules` removes only the link, then `npm install` there) before `all.sh` (2026-10-07).
- A review of a branch reads its worktree or `git diff main...<branch>`, never the main folder: another session's
  unsaved edits there look like part of the change.
- The Z steps (plan Track Z): Z0a, Z0b, Z1 done; Z2 R2 waits; Z3 sender vado.sa; Z4 Pages and madar.vado.sa done; Z5
  database backups run nightly, file backups wait for the owner's Backblaze B2 (the workflow is paused); Z6 seed done; Z7 security review; Z8
  first Admin done, then a 2-week pilot.

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

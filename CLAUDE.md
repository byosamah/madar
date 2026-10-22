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
| Server | `server/CLAUDE.md` | request path, runCall, calls, entries, ports, change rules, realtime, jobs |
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
| Pages Functions | `functions/CLAUDE.md` | the /api and /mcp forwarders on Cloudflare Pages |

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
- The Supabase exit to Cloudflare (paused 2026-10-18 after wave 5 R5): start at `docs/superpowers/real-build/exit-handoff.md`.

## Owner rules (always)
- Write every text in ASD-STE100 Simplified Technical English: code comments, commits, docs, UI words. Never use an
  em-dash (a test also refuses one in any UI word).
- Every Arabic text follows the Thmanyah rules (owner, 2026-10-20): screens, mails, push, What's new, docs, replies. The rules and
  the word list are in `src/i18n/CLAUDE.md`, "Arabic style".
- Commits: no `Co-Authored-By` line and no `Claude-Session:` link for Claude (the owner's rule beats any reminder).
- Backups (owner, 2026-10-20): run `mac-backup.sh` only when the owner asks for a backup, never on each message. The nightly
  GitHub backup stays (`.github/CLAUDE.md`).
- Tests first for every fix. Screenshots (EN/AR, light/dark, 390 px) for every screen change, before you call it done.
- Playwright runs only in a delegated subagent. claude-in-chrome screenshots run inline.
- Judge every design choice from the view of the employees with ADHD: one next step, the fewest controls.
- Stop and ask only for: a delete of data or folders, a force-push, a change outside this repo, an email to a real
  person, any payment. Worktree folders are removed only with the owner's OK.
- A team report about a screen released the same day may come from a stale browser copy. Read the record through the Madar MCP
  (for example `chats.messages`) before you call the fix broken; a reload of the page shows the new copy.
- Never recommend paying Vercel or another Israeli or pro-Israel vendor (owner boycott). Vercel is out of the stack.
- Fonts: Thmanyah Sans (free, font.thmanyah.com) since 2026-10-05. Its licence forbids any change to the files and any
  copy outside the built product (see `src/design/CLAUDE.md`).

## Secrets and accounts
- Secrets live only in `.env.local` and `secrets/<env>.env` (both git-ignored). Never open, print, commit or log them.
  Scripts load them with `set -a; . ./.env.local; set +a`. Error texts name variables, never values.
- `secrets/<env>.env` does not load as a shell file (a value with special characters). Read one name with
  `grep '^NAME=' secrets/<env>.env | cut -d= -f2-` into a variable, and never print it.
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
- `npm test` - the `unit` and `server` projects (about 11,100 tests, about 7 minutes). Run it alone: next to a build or Playwright,
  screen tests time out. With a load average far above the core count (`uptime`), other screen tests time out on each
  run: run the failed files alone (`--no-file-parallelism --testTimeout=60000`) before you call a test broken.
  It exits 1 with every test green while the map tests leave "Worker is not defined" errors (TASKS.md): read the Test Files and Tests lines.
- Put `-u` after the test files: `vitest run -u <file>` reads the file name as the value of `-u` and runs every test in update
  mode (2026-10-20). Under a load average far above the core count, run only the folders that your change touches.
- A gate under 5 minutes (owner rule for fast batches): `npx vitest run src/api server/mcp server/core server/data/loaders
  server/push server/mail server/google server/jobs server/http/health.test.ts --testTimeout=60000` (217 files, about 35 s),
  then the screen folders that the change touches (10 folders, about 90 s).
- Port 5173 on this Mac often runs another project. Start Madar with `npx vite --mode test --host 127.0.0.1 --port 5180
  --strictPort` and check that the page title is "Madar". Plain dev mode shows an empty page ("Cannot access 'lazy' before
  initialization", TASKS.md) until its import cycle is fixed. Run it from `deploy-test`: the main folder's `node_modules` can
  lack a new package, and the page then breaks.
  Another session may hold 5180 too (`lsof -iTCP:5180 -sTCP:LISTEN`): then take a free port, such as 5187.
- A dev server in a worktree whose `node_modules` links to `deploy-test` answers 403 for the `@fontsource` files (outside
  its root): Arabic screenshots then show a fallback font.
- `npm run build` and `build:remote` both write `dist/`. In the sandbox, `build:remote` fails with
  `listen EPERM ... tsx-*.pipe`: run it with the sandbox off.
- While `all.sh` runs in a folder, never build there: a browser check uses the dev server, not the default Playwright config (its
  webServer runs `npm run build`).
- A one-off script in the sandbox: `node --import tsx <file>` needs no tsx pipe. Add `NODE_USE_ENV_PROXY=1` when the
  script uses `fetch`. A script outside the repo needs the `.mts` ending.
- A direct Postgres connection (the pooler, port 5432) fails in the sandbox with `ENOTFOUND`: run it with the sandbox off.
- `npm run test:db` - the `src/api` rule tests again on the local Postgres (one schema per worker, as madar_server).
- `test:db` tests also time out under a load average far above the core count: check `uptime`, and run the failed files
  again at a low load before you call a test broken.
- `npm run test:lite` - the `src/api` rule tests and the shadow run on node:sqlite, no Docker (Supabase exit, wave 1).
- `npm run test:office` - the office object on local workerd (wrangler createTestHarness): host parity, everyCall parity, the
  rows pins, the batch, socket and Cron suites of exit wave 3, and the MCP suite of the merge of waves 2 and 3. Sandbox off when
  listen() fails with EPERM. Add `--silent=false` to see the lines of a test that passes.
- `npm run smoke:office` - the real Workers bundle on local wrangler dev with the office path on (after `build:server`, sandbox
  off): 10 checks, the own sign-in and `/mcp` included.
- `test:db`, `test:it` and the `test:mcp` conformance runner need Docker Desktop and the local stack. The sandbox blocks
  `open -a Docker`; with the sandbox off it works, and Docker is up in about 10 s. The run that worked (2026-10-08):
  `docker-lock.sh acquire <holder>`, `npx supabase start -x edge-runtime`, `npx supabase db reset`, `npm run test:db`,
  `npm run test:it`, `npm run test:mcp` (its conformance runner needs the stack), `npx supabase stop`,
  `docker-lock.sh release <holder>` (again on 2026-10-12).
- `MADAR_IT=1 npx vitest run --project it <files>` - integration tests on the full local stack, one file at a time.
  Each suite uses its own schema. `scripts/restore-check.test.ts` needs `MADAR_AGE` (the `age` binary). Storage and R2
  suites need MinIO (`server/it/minio.ts`).
- `npm run test:mcp` - MCP tests plus the conformance runner (it needs the local stack running; "conformance: 5 of 32
  scenarios pass; 27 expected failures" is the normal result). `npm run icons` - the app icons.
- `npm run dev:office` - the local office stack (exit wave 4): the real bundle on wrangler dev with the own sign-in, the seeded
  sample office and the Madar screens on 127.0.0.1:4174, with no Docker. It writes `test-results/office-local/run.env` for the
  deploy suite on the office path (`tests/CLAUDE.md`), and removes it at the stop. Run it after `build:server`, sandbox off.
- `npx supabase start -x edge-runtime` - the local stack (project CLI only, see `supabase/CLAUDE.md`).
- `scripts/dev/docker-lock.sh run <holder> -- <cmd>` - every Docker or database task takes this lock first.
- One heavy run at a time (owner, 2026-10-20): `npm test`, `test:server`, `test:db`, `test:lite`, `test:office`, `test:it`,
  `test:mcp` and `npm run smoke` take `scripts/dev/heavy-lock.sh` by themselves and wait for the run before them (up to 60
  minutes; `heavy-lock: waiting for ...` names the holder). Start them in the background. Each vitest run uses at most 5 workers
  (`maxWorkers`, `vite.config.ts`). A few files with `npx vitest run <files>` take no lock. Why: two or three full runs of other
  sessions at once filled the 16 GB of memory, the load reached 190 on 10 cores, and tests failed on their time limits.
- A change to a test script in `package.json` also changes `scripts/vite-config.test.ts`: it pins the script texts.
- Size of an old build: `git archive <sha> | tar -x -C $TMPDIR/base`, link `node_modules` into it, build there.
- `npx supabase db reset` - after any migration change, from your own worktree, under the lock.
- Last counts (2026-10-22, speed release gate): unit+server 9,794 passed (822 files); test:db 2,979 (27 skipped);
  test:lite 2,979; test:it 332; test:office 40; test:mcp 330, conformance normal (5 of 32); prototype smoke 87 of 87. Older: deploy
  suite 206 passed, 13 skipped (2026-10-20).
- `grep -c` that counts 0 exits 1, so it stops a `&&` chain: end the count with `; true` or check its number apart.

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
- Server (`server/`): one Hono app on Supabase Edge Functions (Deno, Frankfurt) or on one Cloudflare Worker for each copy;
  `config/server-host.json` picks the host of each copy, and the other host stays deployed as the way back.
- Data: Supabase Postgres, Auth and Realtime (Free plans); files on Cloudflare R2 (since 2026-10-16). Email: Resend. Browser push: Web Push, free (`server/push/`).
  AI agents: MCP at /mcp.
- A screen calls `api.call(name, input)`. The remote build sends it to `POST /api/batch`. The server runs it in `runCall`
  under the office lock, saves the difference, and sends a change signal on Realtime.

## Rules that cross parts
- `src/api` never imports `server/` or `src/app/`.
- On Supabase almost every API call starts a new worker (about 230 ms and 110 ms of CPU; probe of 2026-10-21, `server/CLAUDE.md`).
  A screen change that saves a call saves more than a server change: count the calls of each change.
- Never write to the database outside `runCall`. Handlers stay synchronous and pure. Outside work goes through the outbox.
- Every shared call works in the prototype fake and on the server. Follow the new-call checklist in `src/api/CLAUDE.md`
  (loader entry, MCP allow, Admin or deny list, the `WRITE_KINDS` line of a write, words).
- A new zod collection needs a table in a migration and an entry in `server/data/tables.ts`.
- A contract change is additive or keeps both forms. The test count only grows, except when the code a test checks
  is deleted.
- Every visible word has an English and an Arabic key.
- Every feature or fix updates the What's new page before the deploy (`src/whatsNew/entries.ts`, `whatsnew.en.json` and
  `whatsnew.ar.json`): one short line in the person's terms, in an entry that the people who use it can see (owner, 2026-10-19).
- Every feature change updates the MCP side in the same commit: the allow, Admin or deny list (`server/mcp/tools.ts`), `TOOL_DOCS`
  (`server/mcp/docs.ts`), and `INSTRUCTIONS` when a rule changes (owner, 2026-10-05).
- A feature that hides a record from some people gets leak tests from its own builder: probes as an outsider on
  every read path, error texts and Realtime signals included (office tasks, 2026-10-06). No separate leak review
  (owner, 2026-10-07).
- Every new power is a switch (owner, 2026-10-21): a line in the catalog JSON and `rightsCatalog.ts`, its action in `can()`, a
  `viewerCan` flag for its control, words in `rr2sheet`, and its MCP tool in one AI switch. `rightsParity.test.ts` stays equal unless the owner approves.

## Build process
- One worktree per track at `~/dev/madar-rb/<track>` (branch `rb/<track>`, `node_modules` symlinked to `deploy-test/node_modules`,
  never to the main folder, which can lack a new package). Each wave: build,
  merge lead (in plan order, with the merge lead patches), then a whole-product check on the
  local stack (`db reset`, remote build, functions, seed, the walk in 4 variants, the deploy suite).
- No separate checker (owner, 2026-10-07): no reviewer, verifier or critic agent after a build. Run each suite once.
  Run it again only after a fix for a failure.
- Merge gate: rebase on main, typecheck, `npm test`, `npm run build`, `build:server`, `build:remote -- test`,
  `test:lite`, `test:office` (from exit wave 1 on), `test:db`, `test:it`, and the prototype smoke at screen merges. No merge
  with a red check.
- A task edits only its own files. New words go only into its own `src/i18n/real/<track>` files.
- Agent tool worktrees live in `.claude/worktrees/agent-*` (Workflow agents: `wf_<run>-<n>`, branch `worktree-wf_<run>-<n>`)
  and may start on an old commit: brief each agent to run
  `git merge --ff-only <batch branch>` first. Removal: `git worktree remove --force`, `git worktree prune`, then `git branch -d`
  its branch and its `worktree-agent-*` branch (sandbox off). Before `git worktree remove`, run `rm <worktree>/node_modules`
  (it removes the link only): a clean worktree then goes without `--force`.
- While a release waits on its recorded commit, build the next batch in a worktree branch: production refuses any new commit
  on main, and any changed file in the folder of main (a guide line too). Edit on a branch, and fast-forward main after the release.
- A helper that a subagent starts reports to the main session, not to that subagent: forward what the subagent needs.
- Claude's `git push origin main` is refused by the auto-mode check. Commit on main in `deploy-test`, then hand the owner
  `! git -C /Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test push origin main` (2026-10-08).
- A Playwright agent writes `.playwright-mcp/` into its working directory. In the repo it is a new untracked folder, and
  production refuses a folder with a new file. The Playwright MCP saves only inside the repo, so a `cd` does not help: brief
  each agent to `mv` every shot into the scratchpad. After each run, check
  `git status` in the main folder and in `deploy-test`, and move the folder out.
- Start a browser-check agent without `name`: named agents became teammates that handed the work to a sub-agent, and several
  reports ended with "no report". Ask for the report in the final message. The system may refuse a report file from a subagent.
- `git branch -d` tests against the HEAD of the folder where it runs. The main folder is detached, so it refused merged
  branches. Run it from `deploy-test` (HEAD = main), or check `git merge-base --is-ancestor <branch> main` and use `-D`.
- Agents without Docker cannot run `test:db` or `test:it`: the merge lead runs them and fixes what they pin.
- One builder for a track works in `deploy-test` on `rb/<track>` (`git switch -c`): no commit on main, no push, no deploy.
  The merge lead rebases it on main (`git rebase main`; the branch is not pushed), runs the gates once, then
  `git switch main && git merge --ff-only rb/<track>` and `git branch -d rb/<track>`.
- When no folder holds main, check it out in a clean worktree (`git switch main`) and `git merge --ff-only <branch>` there.
  `git update-ref refs/heads/main` was refused by the auto-mode check as Git Destructive (2026-10-20).
- Never send a message to a running Workflow agent: it starts a duplicate copy in the same worktree.
- Before you move main or run `all.sh`, tell the peer sessions (ListAgents, SendMessage) and send "released" after: two releases
  on one main and one test copy break each other (2026-10-21). ListAgents does not name the branch of a session; ask by branch name.
- A Workflow agent that stopped (an API error) keeps its commits, but SendMessage cannot resume it, and a re-run
  starts it again from its brief. Start a finisher in the same worktree with the commit list and the transcript
  (`subagents/workflows/<run>/agent-*.jsonl`; `agent-*.meta.json` names the label).
- A usage limit stops every running agent at once. Give each finisher a tail of the transcript (the last 70 text and tool
  steps of `agent-*.jsonl`, cut by a script) and `git status` of its worktree. A Docker lock of a stopped agent is stale after
  its 3-hour hold: the finisher takes it again under the same holder name.
- Ask each builder to write its report to a file in its worktree before it returns it, so a dropped last call loses nothing.
- A builder that sends the same report again ("waiting on its own background work") after its work is merged: stop it with
  `TaskStop` (2026-10-20).
- A Workflow `scriptPath` must be inside the repo (a path in /tmp is refused): keep it untracked in the worktree, delete it after.
- Brief parallel builders to run their test files with `--no-file-parallelism --testTimeout=60000`.
- Parallel waves on one rule: the first builder makes a checkpoint commit of the core (rule, data, rights) that it never rewrites; the
  next wave branches from it. A wave that changes another batch's files starts from that batch's branch plus the cherry-picked core (2026-10-22).
- A join picks one commit at a time (`git -c merge.conflictStyle=diff3 cherry-pick <hash>`) and reads each pinned count from a failing
  run, never by adding deltas.
- A background security review of a builder's commit goes back to that builder with a test-first fix; the lead does not patch it beside the builder.
- `npm install` in a worktree whose `node_modules` is a link puts a full folder in place of the link, so the folder behind
  the link lacks the new package. The main folder follows its own branch: after a new package, give `deploy-test` its own
  folder (`rm node_modules` removes only the link, then `npm install` there) before `all.sh` (2026-10-07).
- A review of a branch reads its worktree or `git diff main...<branch>`, never the main folder: another session's
  unsaved edits there look like part of the change.
- The Z steps (plan Track Z): Z0a, Z0b, Z1 done; Z2 R2 waits; Z3 sender vado.sa; Z4 Pages and madar.vado.sa done; Z5
  database backups run nightly, file backups wait for the owner's Backblaze B2 (the workflow is paused); Z6 seed done; Z7 security review; Z8
  first Admin done, then a 2-week pilot.
- A branch that holds track merges takes main with `git merge main`: `git rebase main` replays every track commit and its conflicts (2026-10-21).
- At a merge, read `git diff --stat main...<track> -- '*CLAUDE.md'`: a builder cut 66 lines of `server/mcp/CLAUDE.md` while it added its own (2026-10-21).
- Take the next What's new id at the merge, not in the build: parallel sessions took the same id twice (2026-10-21).

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
- 2026-10-09: "Notify me on this device" is on by default. A browser needs one tap on Allow for each device, so Home shows one small
  card with one button (the owner chose the card over an ask at the first tap or at the start). After Allow, push turns on again by
  itself at each sign-in. A person who turns the switch off stays off on that browser. No MCP change: the three push calls stay
  on the deny list. Record: `src/CLAUDE.md`.
- 2026-10-23: one choice for the Admin, "What reaches me" (Settings): Only my work, My work and the rest in the list (the default, as before), or
  Everything (every project chat message counts, and the bell gets a copy of each notice of the office, with no push and no email). Record: `src/CLAUDE.md`
  and `src/api/CLAUDE.md` ("Copies for the Admin").
- 2026-10-16: move the files from Supabase Storage to R2, and the server from Supabase Edge Functions to one Cloudflare Worker
  for each copy (the test copy first); the database, Auth and Realtime stay; the functions stay as the way back; the Worker
  stays only if it measures faster.
- 2026-10-21 (speed audit 2, `docs/reviews/2026-10-21-performance-audit/`): Home shows the last lists of the person at once after
  a relaunch, from the device (cleared at sign-out, at session end, for another person and on a role change); a direct or group
  chat message signals only its members (the anonymous office signal of INT-16 is gone); the outbox keeps its sent rows. The
  office has Safari users on iPhone: every speed or screen change is checked on WebKit too, and WebKit sends its API calls
  through the page's own `/api` (it keeps a CORS preflight only 10 minutes).
- 2026-10-17: GO for the full exit from Supabase to Cloudflare Free (one office object for each copy, the own sign-in, live
  sockets, Cron, backups by export); no paid plan.
- 2026-10-18: R2 alone for the files (no Backblaze B2); the test copy on the same Cloudflare account with a 50% day cap; the
  GitHub tests start only by hand, so the free minutes go to the backups; the database backup runs from the Mac until GitHub
  runs it again; the exit pauses after wave 5 R5 for a feature of the team (`docs/superpowers/real-build/exit-handoff.md`).
- 2026-10-20: the Home Screen app is the phone app until the official iPhone and Android app (one code for both phones, later):
  the Home card shows the steps to the Home Screen on an iPhone and one install button on Android; every push is urgent and lives
  one day. 2026-10-21: Apple gets no Topic header (it refused every iPhone push); the push line is "Like WhatsApp" (the name and the
  first words of a message, the bell sentence of a notice, encrypted for each browser; a press opens it). It replaces the fixed line
  with no data of 2026-10-08. Record: `server/push/CLAUDE.md`.

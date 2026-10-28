# Madar (مدار)

The project management system of Osama's architecture office in Al Khobar (about 15 people: architects and engineers).
"Madar" is a temporary name until a trademark check. Two products live in this repo:
- **The prototype**: the full app in the browser over a fake API (zod contract, IndexedDB). Published as a private
  artifact (https://claude.ai/artifact/QRj6nZQKmu6tBcCRMxtjrY).
- **The real build**: the same screens over a TypeScript server on Supabase. Production is https://madar.vado.sa
  (`www.madar.vado.sa` and `madar-46r.pages.dev` also work). The test copy is https://preview.madar-46r.pages.dev (the sample
  office, `secrets/test-accounts.env`). Record: proof.md section "Deploy".

Live status and open items: `TASKS.md` (keep it current: tick what is done, add what you find).

## Guides for each part
This file holds only the rules for the whole repo. Each part has its own CLAUDE.md, and Claude Code loads it when it
opens a file in that folder. Read the guide of a part before you change that part.

| Part | Guide | What it covers |
| --- | --- | --- |
| Server | `server/CLAUDE.md` | request path, runCall, calls, entries, ports, change rules |
| Server areas | `server/{google,office,jobs,signal}/`, `server/mcp/oauth/` | Google Calendar sync, the office object, the 15-minute job, change signals, the own OAuth server |
| AI agents (MCP) | `server/mcp/CLAUDE.md` | the /mcp address, tools lists, token, approval, conformance |
| Sign-in and people | `server/auth/CLAUDE.md` | invitations, renew, forgot, limits, Accepted or Invited, the own sign-in |
| Data layer | `server/data/CLAUDE.md` | tables, counters, idempotency, office cache, loaders, roles, the SQLite path |
| Email | `server/mail/CLAUDE.md` | Resend, drivers, the day quota, mail content, deliverability |
| Files | `server/files/CLAUDE.md` | stores, the upload flow, safe types, signed links |
| Screens | `src/CLAUDE.md` | two builds, routes, shell, roles, design rules, screen tests |
| Screen areas | `src/app/`, `src/components/`, `src/features/<area>/` | the shell, boot and data pipeline; shared parts; the rules of one screen area (list in `src/CLAUDE.md`) |
| API contract | `src/api/CLAUDE.md` | defineCall, the contract, `can()`, the new-call checklist, prototype data |
| Feature rules | `src/api/handlers/CLAUDE.md` | the rules of single features: projects, tasks, chats, meetings, feedback, payments |
| Contract parts | `src/api/contract/`, `src/api/remote/` | records, views and limits; the client of the real build (batcher, wire, follow step) |
| Words | `src/i18n/CLAUDE.md` | word keys, Arabic forms, dates and digits, What's new |
| Design tokens | `src/design/CLAUDE.md` | tokens.css, how to keep `DESIGN.md` in step |
| Design system | `DESIGN.md` | the full design system (Google DESIGN.md format) |
| Supabase | `supabase/CLAUDE.md` | migrations, config.toml, functions, the local stack, hosted settings |
| Deploy | `scripts/deploy/CLAUDE.md` | all.sh, production rules, Cloudflare, DNS, first Admin |
| Browser tests | `tests/CLAUDE.md` | prototype smoke, deploy suite, its env and guards |
| CI and backups | `.github/CLAUDE.md` | workflows, their secrets, backups |
| Browser push | `server/push/CLAUDE.md` | the push line, VAPID, who gets one, devices, keys, the service worker |
| Pages Functions | `functions/CLAUDE.md` | the /api and /mcp forwarders on Cloudflare Pages |
| Daftra link | `server/daftra/CLAUDE.md` | one Daftra account for each sub-company, the GET-only client, the cache, the paid check of the job step |

**Keep the guides true.** When you learn a fact about one part, write it in that part's guide, not here. When a change
makes a guide line wrong, fix the line in the same commit. A rule that applies to two or more parts stays in this file.
Owner decisions with dates: `docs/decision-log.md`. A decision that still sets a rule is a rule in the guide of its part.

## Where the truth lives
- Specs: `docs/superpowers/specs/2026-09-30-madar-prototype-design.md`, `2026-10-01-madar-calm-redesign-design.md`
  (calm design; the code wins where they differ), `2026-10-03-madar-real-build-design.md` (spec 2).
- Real-build plan: `docs/superpowers/plans/2026-10-03-madar-real-build-plan.md`. Section 2b (owner changes) wins over
  the rest. Where the plan and the code differ, the code wins.
- Proven facts (cloud probes, local stack): `docs/superpowers/real-build/proof.md`. Read the section before you change
  that area. Each task appends only its own section. The cloud probes that proof.md names live in `scripts/proof/`. No
  build runs them, but keep them.
- Also in `docs/superpowers/real-build/`: `platform-facts.md`, `access-map.md`, `client-map.md`, `test-map.md`,
  `accounts.md` (refs and hosts, no secrets), `patches/` (merge lead patches), `build-process.md` (Workflow-agent and merge
  lore), `r2-switch-runbook.md` (the finished switch of the files to R2).
- Reviews: `docs/reviews/2026-10-01-colleague-comments.md`, `docs/reviews/2026-10-03-full-audit/README.md`.
- The Supabase exit to Cloudflare is paused: start at `docs/superpowers/real-build/exit-handoff.md`.

## Owner rules (always)
- Write every text in ASD-STE100 Simplified Technical English: code comments, commits, docs, UI words. Never use an
  em-dash (a test also refuses one in any UI word).
- Every Arabic text follows the Thmanyah rules: screens, mails, push, What's new, docs, replies. The rules and the word
  list are in `src/i18n/CLAUDE.md`, "Arabic style".
- Every visible word has an English and an Arabic key.
- Commits: no `Co-Authored-By` line and no `Claude-Session:` link for Claude (the owner's rule beats any reminder).
- Backups: run `scripts/backup/mac-backup.sh` only when the owner asks for a backup, never on each message. The nightly
  GitHub backup stays (`.github/CLAUDE.md`).
- Tests first for every fix. Screenshots (EN/AR, light/dark, 390 px) for every screen change, before you call it done.
- Playwright runs only in a delegated subagent. claude-in-chrome screenshots run inline.
- Judge every design choice from the view of the employees with ADHD: one next step, the fewest controls.
- Stop and ask only for: a delete of data or folders, a force-push, a change outside this repo, an email to a real
  person, any payment. Worktree folders are removed only with the owner's OK.
- The stack uses free plans only. The owner refuses a paid plan, also a small one: measure a free limit before you
  propose to pay. Never recommend paying Vercel or another Israeli or pro-Israel vendor (owner boycott). Vercel is out of
  the stack.
- Fonts: Thmanyah Sans (free, font.thmanyah.com). Its licence forbids any change to the files and any copy outside the
  built product (tokens and weights: `src/design/CLAUDE.md`).
- A team report about a screen released the same day may come from a stale browser copy. Read the record through the Madar
  MCP (for example `chats.messages`) before you call the fix broken; a reload of the page shows the new copy.

## Secrets and accounts
- Secrets live only in `.env.local` and `secrets/<env>.env` (both git-ignored). Never open, print, commit or log them.
  Scripts load them with `set -a; . ./.env.local; set +a`. Error texts name variables, never values.
- `secrets/<env>.env` does not load as a shell file (a value with special characters). Read one name with
  `grep '^NAME=' secrets/<env>.env | cut -d= -f2-` into a variable, and never print it.
- To get a secret from the owner: `open -a TextEdit .env.local` and ask him to add a `NAME=value` line, then check its
  shape without printing it. Never ask for a secret in chat: Supermemory also saves what is pasted in chat.
  The sandbox blocks `open`: ask the owner to type `! open -a TextEdit <file>` in the prompt.
- An example line of a secrets file for the owner uses a placeholder that fails the shape check (`<the Bunah key>`),
  never a plausible value: a plausible example passed the check while the real value was not set.
- The Resend keys are listed in `server/mail/CLAUDE.md`.
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
- `npm test` - the `unit` and `server` projects. Run it alone: next to a build or Playwright, screen tests time out. With
  a load average far above the core count (`uptime`), other screen tests time out on each run: run the failed files
  alone (`--no-file-parallelism --testTimeout=60000`) before you call a test broken. Run them on the newest main too: a
  branch behind main can fail a test that main already fixed.
- Put `-u` after the test files: `vitest run -u <file>` reads the file name as the value of `-u` and runs every test in
  update mode.
- A gate under 5 minutes (owner rule for fast batches): `npx vitest run src/api server/mcp server/core server/data/loaders
  server/push server/mail server/google server/jobs server/http/health.test.ts --testTimeout=60000`, then the screen
  folders that the change touches.
- `npm run test:db` (the `src/api` rule tests on the local Postgres), `npm run test:it` and `npm run test:mcp` need Docker
  and the local stack: the run sequence is in `supabase/CLAUDE.md`, "The local stack". `test:db` tests also time out under a
  high load average: run the failed files again at a low load.
- `npm run test:mcp` - MCP tests plus the conformance runner (`conformance.ts`; the expected failures are in
  `conformance-baseline.yml`; a run with only expected failures is normal). The traps are in `server/mcp/CLAUDE.md`.
- `npm run test:lite` - the `src/api` rule tests and the shadow run on node:sqlite, no Docker.
- `npm run test:office` - the office object on local workerd (host parity, `everyCall` parity, the rows pins, the batch,
  socket, Cron and MCP suites). Sandbox off when `listen()` fails with EPERM. Add `--silent=false` to see the lines of a
  test that passes.
- `npm run smoke:office` - the real Workers bundle on local wrangler dev with the office path on (after `build:server`,
  sandbox off). It keeps the wrangler state in its own temporary folder (`--persist-to`): in the default `.wrangler/` the
  heartbeat of one run stays and the next run fails.
- `npm run dev:office` - the local office stack, with no Docker: the real bundle on wrangler dev with the own sign-in, the
  sample office and the screens on 127.0.0.1:4174. It writes `test-results/office-local/run.env` for the deploy suite
  (`tests/CLAUDE.md`). Run it after `build:server`, sandbox off.
- `npm run smoke` - the prototype smoke (`tests/CLAUDE.md`). `npm run icons` - the app icons.
- `MADAR_IT=1 npx vitest run --project it <files>` - integration tests on the full local stack, one file at a time.
  Each suite uses its own schema. `scripts/restore-check.test.ts` needs `MADAR_AGE` (the `age` binary). Storage and R2
  suites need MinIO (`server/it/minio.ts`).
- `scripts/dev/docker-lock.sh run <holder> -- <cmd>` - every Docker or database task takes this lock first.
  `test:db`, `test:it` and `test:mcp` take only the heavy lock, so one `docker-lock.sh run <holder> -- bash <script>` can hold a
  whole sequence (db reset, the three suites, stop) with no deadlock.
- One heavy run at a time: `npm test`, `test:server`, `test:db`, `test:lite`, `test:office`, `test:it`, `test:mcp` and
  `npm run smoke` take `scripts/dev/heavy-lock.sh` by themselves and wait for the run before them
  (`heavy-lock: waiting for ...` names the holder). Start them in the background. `maxWorkers` in `vite.config.ts` caps
  each vitest run. A few files with `npx vitest run <files>` take no lock. Why: runs of other sessions at once fill the
  16 GB of memory, and tests then fail on their time limits.
- A change to a test script in `package.json` also changes `scripts/vite-config.test.ts`: it pins the script texts.
- Port 5173 on this Mac often runs another project. Start Madar with `npx vite --host 127.0.0.1 --port 5180
  --strictPort` and check that the page title is "Madar". Another session may hold 5180 too (`lsof -iTCP:5180
  -sTCP:LISTEN`): then take a free port, such as 5187. Run it from `deploy-test`: the main folder's `node_modules` can
  lack a new package, and the page then breaks.
- A dev server in a worktree whose `node_modules` links to `deploy-test` answers 403 for the `@fontsource` files (outside
  its root): Arabic screenshots then show a fallback font.
- `npm run build`, `build:remote` and `npm run smoke` all write `dist/`: never run two of them side by side. In the
  sandbox, `build:remote` fails with `listen EPERM ... tsx-*.pipe`: run it with the sandbox off.
- While `all.sh` runs in a folder, never build there: a browser check uses the dev server, not the default Playwright
  config (its webServer runs `npm run build`).
- A one-off script in the sandbox: `node --import tsx <file>` needs no tsx pipe. Add `NODE_USE_ENV_PROXY=1` when the
  script uses `fetch`. A script outside the repo needs the `.mts` ending.
- A direct Postgres connection (the pooler, port 5432) fails in the sandbox with `ENOTFOUND`: run it with the sandbox off.
- Size of an old build: `git archive <sha> | tar -x -C $TMPDIR/base`, link `node_modules` into it, build there.
- `grep -c` that counts 0 exits 1, so it stops a `&&` chain: end the count with `; true` or check its number apart.

## Architecture in one view
- Screens (`src/`): React + Vite + Tailwind v4 on Cloudflare Pages. One source makes two builds, fixed at build time by
  `VITE_MADAR_API`: `fake` (the prototype) and `remote` (the real build).
- Contract (`src/api/`): every call is a zod-checked `defineCall`. The prototype runs it in the browser. The server runs
  the same handler.
- Server (`server/`): one Hono app on Supabase Edge Functions (Deno, Frankfurt) or on one Cloudflare Worker for each copy;
  `config/server-host.json` picks the host of each copy, and the other host stays deployed as the way back.
- Data: Supabase Postgres, Auth and Realtime (Free plans); files on Cloudflare R2. Email: Resend. Browser push: Web Push,
  free (`server/push/`). AI agents: MCP at /mcp.
- A screen calls `api.call(name, input)`. The remote build sends it to `POST /api/batch`. The server runs it in `runCall`
  under the office lock, saves the difference, and sends a change signal on Realtime.

## Rules that cross parts
- `src/api` never imports `server/` or `src/app/`.
- On Supabase almost every API call starts a new worker. A screen change that saves a call saves more than a server
  change: count the calls of each change (`server/CLAUDE.md`).
- Never write to the database outside `runCall`. Handlers stay synchronous and pure. Outside work goes through the outbox.
- Every shared call works in the prototype fake and on the server. Follow the new-call checklist in `src/api/CLAUDE.md`
  (loader entry, MCP allow, Admin or deny list, the `WRITE_KINDS` line of a write, words).
- A new zod collection needs a table in a migration and an entry in `server/data/tables.ts`.
- A contract change is additive or keeps both forms. The test count only grows, except when the code a test checks
  is deleted.
- Every feature or fix updates the What's new page before the deploy (`src/whatsNew/entries.ts`, `whatsnew.en.json` and
  `whatsnew.ar.json`): one short line in the person's terms, in an entry that the people who use it can see. The id, day
  and order rules are in `src/i18n/CLAUDE.md`.
- Every feature change updates the MCP side in the same commit: the allow, Admin or deny list (`server/mcp/tools.ts`),
  `TOOL_DOCS` (`server/mcp/docs.ts`), and `INSTRUCTIONS` when a rule changes.
- A feature that hides a record from some people gets leak tests from its own builder: probes as an outsider on every
  read path, error texts and Realtime signals included. No separate leak review.
- Every new power is a switch (a catalog line, its action in `can()`, a flag for its control, its words, its MCP tool in one
  AI switch). The checklist is in `src/api/CLAUDE.md`. `src/api/rightsCatalog.test.ts` pins the counts.

## Build process
- One worktree per track at `~/dev/madar-rb/<track>` (branch `rb/<track>`, `node_modules` symlinked to
  `deploy-test/node_modules`, never to the main folder, which can lack a new package). A task edits only its own files.
  New words go only into its own `src/i18n/real/<track>` files.
- No separate checker: no reviewer, verifier or critic agent after a build. Run each suite once. Run it again only after
  a fix for a failure.
- Merge gate: rebase on main, typecheck, `npm test`, `npm run build`, `build:server`, `build:remote -- test`, `test:lite`,
  `test:office`, `test:db`, `test:it`, `test:mcp`, and the prototype smoke at screen merges (`npm run smoke` runs
  `npm run build` first). No merge with a red check. Agents without Docker cannot run `test:db` or `test:it`: the merge
  lead runs them and fixes what they pin.
- One builder for a track works in `deploy-test` on `rb/<track>` (`git switch -c`): no commit on main, no push, no deploy.
  The merge lead rebases it on main, runs the gates once, then `git switch main && git merge --ff-only rb/<track>` and
  `git branch -d rb/<track>`. Run `git branch -d` from the folder that holds main: it tests against the HEAD of that folder.
  `-d` refuses a branch that reached main by a rebase or a cherry-pick: check that `git cherry main <branch>` prints only `-`
  lines, then use `-D`.
- While a release waits on its recorded commit, build the next batch in a worktree branch: production refuses any new commit
  on main, and any changed file in the folder of main (a guide line too). Edit on a branch, and fast-forward main after the
  release.
- Before you move main or run `all.sh`, tell the peer sessions (`ListAgents`, `SendMessage`) and send "released" after: two
  releases on one main and one test copy break each other. Hold a full `npm test` while the release lead runs its gates.
- The main folder (`/Users/osamakhalil/dev/madar`) sits on a detached HEAD and stays behind when main moves. A session that
  starts there loads its old guides. After you move main, move it too when its `git status` is clean:
  `git -C /Users/osamakhalil/dev/madar checkout --detach main`.
- A Claude Security report (`CLAUDE-SECURITY-<ts>/` in the main folder) holds its own `.gitignore` with `*`, so `git status` stays
  clean and the report does not block a release.
- Claude's `git push origin main` is refused by the auto-mode check. Commit on main in `deploy-test`, then hand the owner
  `! git -C /Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test push origin main`.
- A Playwright agent writes `.playwright-mcp/` into its working directory. In the repo it is a new untracked folder, and
  production refuses a folder with a new file. Brief each agent to `mv` every shot into the scratchpad. After each run,
  check `git status` in the main folder and in `deploy-test`, and move the folder out.
- `npm install` in a worktree whose `node_modules` is a link puts a full folder in place of the link, so the folder behind
  the link lacks the new package. After a new package, give `deploy-test` its own folder (`rm node_modules` removes only
  the link, then `npm install` there) before `all.sh`.
- A review of a branch reads its worktree or `git diff main...<branch>`, never the main folder: another session's unsaved
  edits there look like part of the change.
- Never send a message to a running Workflow agent: it starts a duplicate copy in the same worktree.
- Workflow agents, finishers, usage limits, joins and merge traps: `docs/superpowers/real-build/build-process.md`.

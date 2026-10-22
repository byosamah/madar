# Browser tests (Playwright)

Two Playwright suites. Unit, server, db and integration tests sit next to their code (see Commands in the root
CLAUDE.md). Run Playwright only in a delegated subagent: its output floods the main context.
Playwright `webkit` (26.6) is installed next to `chromium`. The office has Safari users on iPhone: check a speed or screen change
in a node script with `devices['iPhone 15']` too. Both configs run Desktop Chrome only.

`npm run test:office` also runs the live suites (`server/office/{batch,socket,cron,mcp}.wd.test.ts`) on the test Worker of
`server/office/test/live/`; the harness makes a key of the own sign-in for each run (the MCP suite signs its agent tokens with
it). `npm run smoke:office` runs the real bundle on `wrangler dev` (sandbox off), with a key and `MCP_URL` made for the run.
The smoke keeps the local state of wrangler dev in its own temporary folder (`--persist-to`): in the default `.wrangler/` beside
the config, the heartbeat of one run stays and the next run fails.

## The prototype smoke (`e2e/`)
- `npm run smoke` (the heavy lock of the root guide, then `playwright test`; `playwright.config.ts`, port 4173). 87 of 87 must pass at each screen merge.
  It runs `npm run build` first, so it rewrites `dist/` (about 8 minutes in all). Never serve `dist/` for screenshots
  while it runs.
- The sample office follows the real date. An assertion on Home or on due dates must hold on any day: the Home panel is
  "Today" or "Coming up" (`acceptance.spec.ts`, 2026-10-12).
- Prototype data for screenshots: edit IndexedDB `madar`, store `data`, key `state`, then reload (for example a due date 157 days back).
  A Playwright clock does not age tasks: the start moves the sample dates to the new today. For the memory line, set `state.version = 999`
  and reload; a blocked `indexedDB` did not bring it. A script in the scratchpad imports Playwright by its absolute path in the worktree.

## The deploy suite (`e2e-deploy/`)
- `npx playwright test -c playwright.deploy.config.ts`. It runs the real screens on the server.
- Local by default: it needs `MADAR_LOCAL_PUBLISHABLE_KEY` and a fresh seed (`npx tsx tests/e2e-deploy/local.ts seed`).
- On the test copy: load `.env.local` and `secrets/test-accounts.env`, then set `MADAR_DEPLOY_URL`,
  `MADAR_E2E_SUPABASE_URL`, `MADAR_E2E_PUBLISHABLE_KEY` (from `config/remote.test.env`), `MADAR_E2E_DATABASE_URL`
  (madar-test session pooler) and `MADAR_E2E_MCP_URL=https://preview.madar-46r.pages.dev/mcp`. Seed before and after the run.
  The seed also revokes the AI app grants of the 4 accounts, so an app that a one-off check approved does not stay.
- `MADAR_E2E_DATABASE_URL`: the host of the `DATABASE_URL` line of `secrets/test.env` with port 5432 (the line is the
  transaction pooler, port 6543), and the role `postgres.<ref>` with `MADAR_TEST_DB_PASSWORD` of `.env.local`. The role of
  that line is `madar_server`, and the walk then fails its sign-in and email steps with "permission denied for schema auth"
  (2026-10-22). `withClient` of `tests/e2e-deploy/mail.ts` reads madar-test from a one-off script (sandbox off).
- A script that acts as a sample account on the test copy: the Supabase password grant, then `POST <SUPABASE_URL>/functions/v1/
  api/batch?forceFunctionRegion=eu-central-1` with `X-Madar-Build: buildId(new Date())` (`scripts/build-remote.ts`). With no
  build header the server answers 409 `client_outdated`. The body is `{ v: 1, calls: [{ i, name, input }] }`; each answer is
  `results[i].output` or `results[i].error`. `https://preview.madar-46r.pages.dev/api/batch` takes it too.
- On the office path (exit wave 4): set `MADAR_E2E_OFFICE_URL` (the local office `http://127.0.0.1:8792`, or
  `https://preview.madar-46r.pages.dev`) and `MADAR_E2E_OPS_SECRET` (the `MADAR_OPS_SECRET` of that copy). The specs then read
  `mail_outbox` and the walk's checks through the peek route (`tests/e2e-deploy/office.ts`, the SQLite form of each walk text in
  `OFFICE_SQL`), and `agents.spec.ts` uses the own OAuth routes under `/mcp`. Seed with
  `npx tsx scripts/office/seed.ts --to <address>` before and after the run. A new SQL text in the walk needs its SQLite form in
  `OFFICE_SQL`: `scripts/e2e-deploy-helpers.test.ts` fails without it, and prepares each form on the SQLite schema.
- Flags: `MADAR_E2E_AFTER_G=1`, `MADAR_E2E_WALK=1` (the whole-product walk, `walk.spec.ts`; its step 15 checks that the old `/admin/usage` link shows no Usage section, since 2026-10-23). `agents.spec.ts` skips
  itself without `MADAR_E2E_AFTER_G=1` ("1 skipped" is no pass). Its first case also checks that the tool list of the test copy holds
  the three chat tools (2026-10-12). One case alone: `-g "an approved agent shows in Settings"`.
- `full.spec.ts` alone takes about 12 minutes, more than the 600 s limit of a foreground Bash call: run it in the background.
- It is the only check of the CSP: `vite preview` sends no CSP (`csp.spec.ts`).
- The walk names the file store from the host of its upload PUT (`store.ts`): Supabase Storage or R2. On Storage it counts
  `storage.objects`. On R2 it heads the new keys in `madar-files-test`, only with the four R2 lines of `secrets/test.env` in the
  environment (zsh: `set -a; . <(grep '^R2_' secrets/test.env); set +a`. The bash of macOS (3.2) loads nothing that way: use
  `while IFS= read -r line; do export "$line"; done < <(grep '^R2_' secrets/test.env)`. Never source all of `secrets/test.env`:
  it stops with a syntax error on line 5). Without them it reports the count as n/a. The download
  fallback takes a signed link of Storage or of the R2 test bucket (owner, 2026-10-16).
- Playwright's Chromium does not start in the sandbox (SIGTRAP): run browser scripts with the sandbox off.
- Signed-in screens take the language and theme saved on the account (server). The device keys change only the screens
  before sign-in. A change through the person menu is a write: on a test account, set it back to English and light after.
- The test copy shows timing races that the local stack hides. Repeat a suspect spec with `--repeat-each=3` there.
- Many `ERR_INTERNET_DISCONNECTED` failures in one run mean the Mac lost its connection. Check the test copy with
  `curl -sI`, then run the suite again. It is not a code fault.

## Guards (`e2e-deploy/targets.ts`)
- The suite never reads the production database and never names a production host. It reads madar-test or the local
  stack only. Keep these guards. A new target needs a new guard and a test in `scripts/e2e-deploy-helpers.test.ts`.
- `TEST_MCP_HOST` is the only short host it accepts, and only for `MADAR_E2E_MCP_URL`.
- `r2BucketTarget` takes only the R2 bucket `madar-files-test` on the R2 EU endpoint (`r2Values` of `scripts/deploy/secrets.ts`).
- No `ssl` or `sslmode` in a database URL: the specs pass the root certificate as `ca`.

## Helpers
- `goto.ts`: `settle(page)` waits for the network, then for every finite animation to end. Use it before a size check
  or a screenshot.
- `steps.ts`: `signIn`, `expectCalm`, `expectNoSeriousA11y`, and the widths (390, 820, 1440), languages and themes.
- The screens before sign-in are light unless the device saved a theme (owner, 2026-10-05). A dark run of them calls
  `signedOutTheme(page, theme)` (`steps.ts`) as well as `emulateMedia`. The sample accounts keep the System theme, so
  `emulateMedia` alone still drives them.
- `accounts.ts`: the 4 sample accounts, with role emails: admin@, management@, accounting@ and member@madar.test.
  The seed (`testOffice`) gives these emails to the 4 people of the test office; the prototype keeps its sample emails.
  Local passwords are in `local.ts`. Test copy passwords are in `secrets/test-accounts.env` (the owner sets them).
- A spec that leaves a grant or a setting behind removes it in a `finally` (as `agents.spec.ts` does), so the next run
  starts from the same office.

## Rules
- Never run a shared `supabase functions serve` next to `test:mcp` or `test:it`.
- A flaky step needs a fix of its cause (a missing wait, an animation), never a longer timeout alone.

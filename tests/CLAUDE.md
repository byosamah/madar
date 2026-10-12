# Browser tests (Playwright)

Two Playwright suites. Unit, server, db and integration tests sit next to their code (see Commands in the root
CLAUDE.md). Run Playwright only in a delegated subagent: its output floods the main context.

## The prototype smoke (`e2e/`)
- `npx playwright test` (`playwright.config.ts`, port 4173). 87 of 87 must pass at each screen merge.
  It runs `npm run build` first, so it rewrites `dist/` (about 8 minutes in all). Never serve `dist/` for screenshots
  while it runs.
- The sample office follows the real date. An assertion on Home or on due dates must hold on any day: the Home panel is
  "Today" or "Coming up" (`acceptance.spec.ts`, 2026-10-12).

## The deploy suite (`e2e-deploy/`)
- `npx playwright test -c playwright.deploy.config.ts`. It runs the real screens on the server.
- Local by default: it needs `MADAR_LOCAL_PUBLISHABLE_KEY` and a fresh seed (`npx tsx tests/e2e-deploy/local.ts seed`).
- On the test copy: load `.env.local` and `secrets/test-accounts.env`, then set `MADAR_DEPLOY_URL`,
  `MADAR_E2E_SUPABASE_URL`, `MADAR_E2E_PUBLISHABLE_KEY` (from `config/remote.test.env`), `MADAR_E2E_DATABASE_URL`
  (madar-test session pooler) and `MADAR_E2E_MCP_URL=https://preview.madar-46r.pages.dev/mcp`. Seed before and after the run.
  The seed also revokes the AI app grants of the 4 accounts, so an app that a one-off check approved does not stay.
- Flags: `MADAR_E2E_AFTER_G=1`, `MADAR_E2E_AFTER_M=1`, `MADAR_E2E_WALK=1` (the whole-product walk, `walk.spec.ts`). `agents.spec.ts` skips
  itself without `MADAR_E2E_AFTER_G=1` ("1 skipped" is no pass). Its first case also checks that the tool list of the test copy holds
  the three chat tools (2026-10-12). One case alone: `-g "an approved agent shows in Settings"`.
- It is the only check of the CSP: `vite preview` sends no CSP (`csp.spec.ts`).
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

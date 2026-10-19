# Deploy

Production is live at https://madar.vado.sa with real people on it. A wrong step here reaches them. Production deploys
only from the Mac, after the typed word `production`. The test copy is https://preview.madar-46r.pages.dev.

## Release flow (owner, 2026-10-05)
The test copy is the staging step. There is no third copy: Supabase gives 2 free projects, and Madar uses both.
1. Commit the change on main, with every merge gate green.
2. `scripts/deploy/all.sh test`. At its end it records the commit (`.git/madar-test-deploy`, shared by every worktree).
3. Run the deploy suite on the test copy (`tests/CLAUDE.md`). It seeds the sample office again at its end.
4. The owner tries the change on the test copy with a sample account: admin@, management@, accounting@ or
   member@madar.test (passwords in `secrets/test-accounts.env`).
5. After the owner's OK: `scripts/deploy/all.sh production` from the same commit.
- Before a production release with a change that people see, add a What's new entry in plain words for the team, in English and Arabic (`src/whatsNew/entries.ts`). Give the entry `right` when only some people can use the feature, and `to` (the address of its screen) for the "Open" link.
- The deploy suite takes about 45 minutes. Tell the owner before you start it. When the owner asks for production while
  it runs, stop it, deploy the recorded commit, and write the unfinished suite in the proof.md record.
- Production refuses, before the typed word: a commit that is not the recorded one, a change that is not committed (also
  a new file), and a folder that is not a git checkout. A new commit (also a merge or a rebase) needs `all.sh test` again.
- `all.sh test` removes the record before its first step, so a test deploy that stops part way blocks production. A
  step alone (`db.sh test`, `deploy.yml` on GitHub) records nothing.
- No switch skips the check. A hotfix also goes through `all.sh test` first (a few minutes).
- Load the keys first: `set -a; . ./.env.local; set +a`, then `scripts/deploy/all.sh test`.
- Commit TASKS.md and proof.md before `all.sh test`: any later commit (also a note) needs `all.sh test` again.
- Another session may leave changes in the main folder. Then deploy from a clean worktree of main: `git fetch . <branch>:main`,
  `git worktree add .claude/worktrees/deploy-test main`, and link `node_modules`, `secrets` and `.env.local` into it.
  `.gitignore` has `secrets/`, which does not match a link, so `.git/info/exclude` holds `secrets` (2026-10-07). Without it
  the tree is not clean, and `all.sh test` records no commit.
- When `deploy-test` exists, it holds main, so `git fetch . <branch>:main` refuses. Use
  `git -C .claude/worktrees/deploy-test merge --ff-only <branch>`.
- After production: commit the record on main, then `git push origin main` (GitHub holds each release).
- The test copy keeps every mail in `mail_outbox` and sends none. Show the owner a mail change from that table.
- Each seed empties the test copy: only the 4 sample accounts and the sample office stay. Trial data does not survive. Push
  devices go too: turn the switch on again after a seed (and after the deploy suite, which seeds at its end).
- The seed uploads the sample files to the file store of the test copy under real object keys, the pictures as PNG
  (`scripts/seed-pictures.ts`; the real store serves an SVG only as a download). `MADAR_FILE_STORE` of `secrets/test.env`
  chooses the store: Supabase Storage, or with `r2` the R2 bucket `madar-files-test` (the four R2 lines must be there; it
  refuses every other bucket). With `MAIL_DRIVER=outbox` it also empties `mail_log`, so the day count of test mail starts again.

## Steps
- `scripts/deploy/all.sh <test|production>` runs every step in this order. Each step also runs alone:
  1. `db.sh`: pushes the new migrations. It links the CLI, pushes, and unlinks again.
  2. `config.sh`: pushes `supabase/config.toml` through the `[remotes.<env>]` block (`config-check.ts` checks it first).
     The check refuses the Data API, vector buckets (the free plan has none; a push with them on stops with 402), and a
     `jwt_expiry` above 900.
  3. `secrets.ts`: from `secrets/<env>.env`. It writes the Vault secrets, `platform_config.mcp_url`, the madar_server
     password (as a SCRAM verifier), and the function secrets. Then the Worker of the copy, when it exists (owner,
     2026-10-16): the origin password of its Hyperdrive config `madar-db-<env>`, and its secrets through `wrangler secret bulk`
     (JSON on stdin; see "The server host" below). It prints names, never a value.
  4. `functions.sh`: builds the server bundles and deploys `api`, `mcp`, `jobs`. Then it asks `api/health` in Frankfurt.
  5. `worker.sh --prebuilt` (owner, 2026-10-16): deploys the Worker of the copy (`madar-server-<env>`, `wrangler deploy -c
     wrangler.server.toml --env <env>`) with the bundle of step 4, then lists its deployments. A copy whose Hyperdrive id in
     `wrangler.server.toml` is still the placeholder is skipped with a clear line. Every run deploys both hosts, so the way
     back always holds the same code.
  6. `pages.sh`: builds the remote screens, writes `dist/_headers` (CSP) with `headers.ts`, and uploads to the Pages
     project `madar`: branch `preview` for test, `main` for production. The `functions/` folder (the /api and /mcp forwarders)
     goes too. `headers.template` gives `/sw.js` the header `Cache-Control: no-cache` and the CSP `worker-src 'self'`. The push
     services need no `connect-src`: the browser, not the page, talks to them. The page's own `/api` needs none either. The fixed
     hosts of `connect-src` are `https://nominatim.openstreetmap.org` (the place search of the pin picker, Task 12b, fbk_017) and
     `https://tiles.openfreemap.org` (the street map, owner 2026-10-19). `script-src` holds `'wasm-unsafe-eval'` for the Arabic text plugin of the map.
  7. `checks.sh` (owner, 2026-10-16): through the page host, `GET /api/health` gives 200 with `x-madar-server` of the host in
     `config/server-host.json`; with `JOBS_SECRET` (curl reads it on stdin, `-K -`) database, lock and asyncContext are ok;
     `POST /mcp` with no token gives 401 from the same host. It only reads, so it asks no typed word. A failed check stops
     `all.sh test` before it records the commit.
- All CLIs come from `package.json`, never a global copy.

## Production rules
- `all.sh production` asks once for the typed word, after the commit check of the release flow. Without a terminal:
  `echo production | scripts/deploy/all.sh production`.
- A `!` command has no keyboard. Without `echo production |` it stops with "the typed word was not production" and changes
  nothing (2026-10-08). The owner may also run the script in his Terminal window and type the word.
- `all.sh test` asks "Do you want to push api config to remote? [Y/n]" (`api.enabled`: config.toml false, the hosted projects
  true). A run with no keyboard takes yes by itself, so the owner runs `all.sh test` in his Terminal and answers (2026-10-08).
- After production, check the live site: `all.sh` ends with `checks.sh` (the health, the database check and `POST /mcp` with no
  token 401, through the page host), then page 200 with the title Madar and `/favicon.ico` 200. Then write the release
  record: a section before "Performance audit" in `docs/superpowers/real-build/proof.md`, a line in `TASKS.md`, one commit
  on main. The owner pushes it. That commit changes HEAD, so the next production needs `all.sh test` again.
- Every script refuses production when `CI` or `GITHUB_ACTIONS` is set. A `MADAR_DEPLOY_CONFIRMED` from the shell never counts.
- The auto-mode safety system may refuse a production deploy or a key change until the owner says so in chat. Respect
  the refusal. Never work around it.
- A short "ok" did not pass that check, and later the owner's plain words did not pass either (2026-10-07). After one
  refusal, give the owner the one-line command with `!` as the very first character of the input box. Without that, it
  arrives as chat text and runs nothing.
- A test deploy of a newer commit replaces the record. While an older commit waits for production, hold `all.sh test`
  of the newer one until production is done.
- Change only madar-test unless the owner asked for production.

## Secrets
- `secrets/test.env`, `secrets/production.env`, `secrets/test-accounts.env`: git-ignored, mode 600. Never print them.
- `secrets.ts` needs `SUPABASE_ACCESS_TOKEN` (the Madar account) and the postgres password: `MADAR_TEST_DB_PASSWORD` for
  test, `MADAR_DB_PASSWORD` for production (both in `.env.local`).
- `MCP_URL` in each file is the short MCP address (see `server/mcp/CLAUDE.md`).
- Browser push keys (owner, 2026-10-08): `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` in each file, all three or none
  (`secrets.ts` checks their size). `npx tsx scripts/push/make-vapid.ts <env>` makes them (see `server/push/CLAUDE.md`). The public
  key also sits in `config/remote.<env>.env` as `VITE_VAPID_PUBLIC_KEY`, and `pages.sh` warns when it is missing.
- R2 (owner, 2026-10-16): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, all four or none. `secrets.ts`
  wants the 32 hex characters of the account, and the bucket of the copy: `madar-files-test` for test, `madar-files` for production.

## Switch the files to R2 (owner, 2026-10-16)
For one copy: the test copy first, then production. `<env>` is `test` or `production`, `<bucket>` is `madar-files-test` or
`madar-files`. The lead runs the cloud steps; each network step needs the sandbox off.

**Read this first.** No copy from R2 back to Storage exists. After the switch, a return to `MADAR_FILE_STORE=supabase` loses
every file that people uploaded after the switch. The way back of the server host (the Supabase functions in place of the
Worker) keeps `MADAR_FILE_STORE=r2`. The Storage bucket stays as it is (no delete without the owner's OK). In production, the
switch refuses the open screens for some minutes (step 4): do it in a quiet time and tell the office first.

Before: R2 is on, `<bucket>` exists with `--jurisdiction eu`, its CORS rule is set
(`npx wrangler r2 bucket cors set <bucket> --file config/r2-cors.<env>.json --jurisdiction eu --force`), and the owner has an R2
token with Object Read & Write on `<bucket>` only (`server/files/CLAUDE.md`).
1. The owner adds the four R2 lines to `secrets/<env>.env` (`! open -a TextEdit secrets/<env>.env`). `MADAR_FILE_STORE` stays
   `supabase`: the server ignores the R2 lines until the switch. Check: `npx tsx scripts/deploy/secrets.ts <env> --dry-run`.
2. The first copy: `npx tsx scripts/storage/move-to-r2.ts --env <env>` (production: `echo production | npx tsx ...`). The JSON
   report must say `"mismatched": []`. The screens keep working during the copy.
3. Right before the switch, the same command again. It copies every object again, then the new and changed ones, and removes
   from R2 the keys that Storage no longer has. Production: in the quiet time, with no uploads.
4. The switch. In `secrets/<env>.env` the owner sets `MADAR_FILE_STORE=r2` and `MIN_CLIENT_BUILD` to the build of the switch.
   The Worker gets the same two values in the same step (the Worker secrets of the server track): the file store does not
   follow the server host. Then `scripts/deploy/all.sh <env>` (production: the Release flow and its typed word).
   - The build ID is the UTC day of the build (`buildId` in `scripts/build-remote.ts`, for example `2026.10.16`), or
     `VITE_MADAR_BUILD` when the environment sets it. The server refuses a screen build older than `MIN_CLIENT_BUILD`
     (`buildOlder`, `server/http/limits.ts`) with "Madar has a new version. Reload the page.", so a tab from before the switch
     reloads and gets the new CSP (the R2 host in `img-src`, `connect-src`, `frame-src`).
   - When the copy had a deploy earlier on the same UTC day, give the switch build a fourth part: run all.sh with
     `VITE_MADAR_BUILD=2026.10.16.1` and set `MIN_CLIENT_BUILD=2026.10.16.1`. Every later deploy on that UTC day then needs the
     same `VITE_MADAR_BUILD` or a higher one, else the server refuses its own new screens. From the next UTC day the plain day
     is higher again.
   - From the secrets step to the end of the pages step, the server refuses the old screens, and a reload still gets them.
     After the pages step a reload gets the new screens. An upload in flight at the switch fails with "The file did not
     arrive. Upload it again.": the person uploads it again.
5. `npx tsx scripts/storage/move-to-r2.ts --env <env> --copy-only`: it copies the files that people confirmed on Storage after
   step 3. It never removes and never overwrites a key. The full move now refuses by itself (the file says r2).
6. `npx tsx scripts/storage/verify-r2-keys.ts --env <env>`: exit 0 with `"missing": []`. A missing key: step 5 again, then step 6.
7. Test only: the seed (`npx tsx scripts/seed-test-office.ts`, which now writes the 72 sample files to `madar-files-test`), then
   the deploy suite (`tests/CLAUDE.md`; it counts R2 objects only with the R2 lines in the environment).
8. The record: a proof.md section with the two move reports, the copy-only report, the key check and the deploy suite.
   After production: make R2 the source of the weekly file backup (`.github/CLAUDE.md`, the read-only R2 token).

## Cloudflare
- wrangler is signed in as o.khalil@mazj.org. The Pages project `madar` is `madar-46r.pages.dev` (`madar.pages.dev`
  belongs to someone else). R2 is on (2026-10-16): the buckets `madar-files-test` and `madar-files`, both EU.
- wrangler 4.147+ sends `pages project create` to the new Workers path. The project exists, so `pages deploy` works.
- Pages custom domains go through the Cloudflare API with the wrangler login token (`npx wrangler whoami` refreshes it;
  `oauth_token` in `~/Library/Preferences/.wrangler/config/default.toml`).
- vado.sa DNS is in a Vercel team that the CLI cannot see. Give the owner the records, and he adds them himself.
  Never pay Vercel.
- Workers (owner, 2026-10-16): `worker.sh` deploys `madar-server-<env>` from `wrangler.server.toml`. The account workers.dev
  subdomain is `vado-sa`, but no Madar Worker has a workers.dev address (`workers_dev` and `preview_urls` false). A Worker
  fetch of a workers.dev address of the same account fails with error 1042, so Pages reaches the Worker only through its
  service binding. Never touch the Worker `binhindi-massing` of the same account.
- Cloudflare mails "[Action required] Workers CPU limit exceeded" once a day while any Worker of the account (also a probe) hits
  the Free CPU limit in the last 24 hours. To find the source, query `workersInvocationsAdaptive` and
  `pagesFunctionsInvocationsAdaptiveGroups` (dimensions `scriptName`, `status`, `datetimeHour`) with
  `scripts/proof/do-socket/gql.mjs`; a stop is the status `exceededResources`, and a deleted Worker shows as `__unknown__`. Run
  `npx wrangler whoami` first when the query gives 401: it renews the OAuth token. The mail of 2026-10-17 came from the CPU probe
  of 2026-10-16 (1,332 stops from 18:00 UTC, proof.md wave 0); the Pages Functions had none. Never take its "Upgrade" button.
- The next `all.sh test` after wave 3 deploys `madar-server-test` with a Durable Object namespace `Office` (no object, no
  storage), the migration `office-v1`, and a Cron every 15 minutes whose `scheduled()` returns at once (no `MADAR_DATA`): 96 short
  runs a day and 1 of the 5 Cron Triggers of the account. The test copy serves the same, because the Pages forwarder sends `/api`
  to Supabase while `config/server-host.json` says supabase. `madar-server-production` gets no binding, no migration and no Cron
  (`migrations = []`, `crons = []`); wrangler prints one warning about `durable_objects` on each production deploy, which is
  expected until wave 6. Count the Cron Triggers of the account before that first test deploy (plan of exit wave 3, Task 19
  Step 3): with 5 in use, the test Cron stays off until wave 5.

## Other scripts
- First Admin: `npx tsx scripts/first-admin.ts --env test|production|local --email --name --language --gender`.
  `--password-stdin` reads the typed word and the password from one stdin.
- `scripts/seed-test-office.ts` seeds madar-test only (load `.env.local` and `secrets/test-accounts.env`).
- Test copy passwords: the owner edits `secrets/test-accounts.env` (8 characters or more, the Auth minimum). The seed
  then sets them, and it also resets the sample office.
- Sign-in check with no printed password: node writes `{email,password}` from the env, curl sends it with `--data @-`
  to `$VITE_SUPABASE_URL/auth/v1/token?grant_type=password` with the publishable key and prints only `%{http_code}`.
- `deploy.test.ts`: a production test calls `readyForConfigPush()`, `commitAll()` and `deployTest()` first.
- `token-scope.sh` is the first step of `deploy.yml`: it stops the GitHub job if the token can reach production.
- After a deploy, run the deploy suite on the test copy (see `tests/CLAUDE.md`), and write the result in proof.md,
  section "Deploy".

## Quick check of production
- `npx wrangler pages deployment list --project-name madar` shows the commit of each production and preview deploy.
- The `config push` step always says `api.enabled` true and pushes false: a false difference (`supabase/CLAUDE.md`).
- A Pages step that fails with "Failed to publish your Function. Got error: Unknown internal error occurred." is a fault at
  Cloudflare when `functions/` did not change. The steps before it stay done: run `scripts/deploy/pages.sh <env>` again after a
  few minutes (2026-10-12: the third run went through).
- `db.sh` once stopped with `DbPushMissingLocalError` ("Remote migration versions not found in local migrations directory",
  20261008000100 and 20261012000100) while both files were in the folder; `db.sh` alone a minute later said up to date
  (2026-10-16). Run `db.sh` again. Never run the `supabase migration repair` that the CLI suggests: it rewrites the migration
  history of the project.
- The Hyperdrive password step of `secrets.ts` can get 2013 (invalid credentials) right after it writes the new verifier: the
  session pooler keeps the old one for some time (2026-10-16). `secrets.ts` tries again within its sign-in limit (60 s).
- `madar.vado.sa/api/health` goes through the page api (`functions/api`) to the host of `config/server-host.json`, and its
  `x-madar-server` names that host (`checks.sh`). Straight to the function, the health needs `forceFunctionRegion`, else it
  answers from another region.
- Just after a deploy, madar.vado.sa can serve the old bundle for a short time. Compare the `index-*.js` name there with
  the deploy address (`<id>.madar-46r.pages.dev`, the last line of `all.sh`).
- `curl -s -o /dev/null -w '%{http_code}' https://madar.vado.sa/` gives 200.
- `POST https://madar.vado.sa/mcp` with no token gives 401 (the right answer).
- `https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/api/health?forceFunctionRegion=eu-central-1` gives 200.
- `gh run list -R byosamah/madar --workflow "DB backup" --limit 1` shows the last nightly backup.

## The server host (owner, 2026-10-16)
`config/server-host.json` holds one word for each copy: `supabase` (the Supabase functions) or `workers` (the Worker of the
copy). Exit wave 4 adds `office` (the office object of the Worker), for the test copy only: the setting refuses `production:
office` until the switch (wave 6). With `workers`, the database, Auth and Realtime stay on Supabase. Every `all.sh` run of
`supabase` or `workers` deploys both hosts with the same code, so the other host is always the way back. The file store does not
follow the host (see the R2 runbook).
- The word `office` (exit wave 4; the test copy only until wave 6): the copy runs on its office object. `all.sh` then runs
  `secrets.ts --office` (the Worker secrets only: no Supabase token, no database password, no Hyperdrive; `MADAR_SECRET_KEY` and
  `MADAR_AUTH_PRIVATE_JWK` stay as the Worker has them), `worker.sh` (it builds the bundle and deploys with `--var MADAR_DATA:office`),
  `pages.sh` (the screens with `VITE_MADAR_AUTH=madar` and `VITE_MADAR_LIVE=socket`) and `checks.sh` (`office;colo=...` and the office
  health). `db.sh`, `config.sh` and `functions.sh` stay out: the Supabase project keeps its last state as the way back.
- The office ops (`/api/office/export|import|peek|drop`) reach the Worker of a copy through the Pages binding whatever the word says,
  and need `MADAR_EXPORT_SECRET` or `MADAR_OPS_SECRET`. Both go into `secrets/<env>.env`, and `secrets.ts` gives them to the Worker
  on every word (never to the Supabase functions). `npx tsx scripts/office/new-secret.ts test <NAME>` makes each one (the owner
  runs it), `npx tsx scripts/office/auth-key.ts test` makes the sign-in key. `MADAR_AUTH_PRIVATE_JWK` never goes into a secrets
  file: `secrets.ts` refuses a file that holds it. The first switch of the test copy: wave 5, Part 2 of
  `docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md`.
- What follows the word: the `VITE_API_URL` of the screens (`build:remote`: the page's own `/api`, or the api function); the
  Pages Functions of `/api` and `/mcp` (the Worker through the service binding, or the Supabase function); the calls limit of
  the Usage page (10 million or 500,000; the 10 million are the Paid month, see First setup step 1); what `checks.sh` wants in `x-madar-server`. The Pages Functions get the word when
  Pages builds them, so a change reaches them only with `pages.sh`.
- What does not follow it: MCP_URL (the agents keep their connection), the jobs (pg_cron calls the Supabase jobs function in
  both settings), the Vault, the database password.
- Names: the Workers `madar-server-test` and `madar-server-production` (`wrangler.server.toml`, `[env.test]` and
  `[env.production]`); the Pages bindings `MADAR_SERVER_TEST` (preview) and `MADAR_SERVER_PRODUCTION` (production); the
  Hyperdrive configs `madar-db-test` and `madar-db-production` (the session pooler, port 5432: the transaction pooler hangs
  behind Hyperdrive, proof.md). Ids in `accounts.md`.
- `secrets.ts` gives the Worker every function secret but `DATABASE_URL`, `DATABASE_READ_URL` and `DATABASE_CA` (Hyperdrive
  replaces them), and the two office secrets, with `MADAR_SECRET_KEY` from the Management API and `MCP_URL` required. A name removed from the file goes as
  null, so the Worker loses it. The same run sets the Hyperdrive password from `DATABASE_URL`, so a new password never cuts the
  Worker off. A deploy resets the Worker vars (`SUPABASE_URL`, `WORKER_REGION`) to the file and keeps its secrets.

### First setup of a copy (once, before its first switch)
The lead runs these with the sandbox off. Production needs the owner's yes and the typed word.
1. The Workers plan. The account stays on Free (owner, 2026-10-16: "free is enough for now"): 10 ms of CPU for each
   request, and 100,000 requests and 100,000 Hyperdrive queries a day for the whole account (`platform-facts.md` 2.7).
   Measured 2026-10-16 (proof.md, "The deploy suite on Workers Free"): after about 7 minutes of steady load, Free stops each
   call at 10 ms, and a median Madar call needs 37 ms. So a copy goes to `workers` only on Workers Paid ($5 a month, which
   only the owner buys). Both copies say `supabase` until then.
2. `npx tsx scripts/deploy/cloudflare-setup.ts --env <env>`: the CA, the Hyperdrive config, the R2 bucket and its CORS rule
   (only when R2 is on), and the Pages binding (it waits for the Worker). It prints the Hyperdrive id: put it into
   `[[env.<env>.hyperdrive]]` of `wrangler.server.toml` and into `accounts.md`, then commit.
3. `scripts/deploy/worker.sh <env>`: the first deploy makes the Worker. Then `npx tsx scripts/deploy/secrets.ts <env>` gives it
   its secrets (a run before the Worker existed skipped it with a clear line).
4. `cloudflare-setup.ts --env <env>` again: now it sets the Pages binding. The next `pages.sh` uses it.
5. `scripts/deploy/all.sh <env>`, with the word still `supabase`: `checks.sh` must pass.

### The switch of a copy
1. Set the word of the copy to `workers` in `config/server-host.json`, in its own commit.
2. `scripts/deploy/all.sh test` (production: the Release flow). `checks.sh` then wants `x-madar-server: workers;colo=...` through
   the page host, and the database check. A tab that was open before keeps calling the api function until it reloads; both
   hosts serve it.
3. `scripts/proof/server-time.sh 20` (sandbox off, from the Mac). The Worker stays only if it measures faster (owner rule).

### The way back
Set the word back to `supabase`, commit, `all.sh test`, check, then `all.sh production`. The screens get the api function
again, and the forwarders send `/api` and `/mcp` to the Supabase functions, so a tab built for the Worker keeps working through
the page api. Nothing in the database changes. The Worker stays deployed with its secrets.

### Quick checks of the Worker
- `scripts/deploy/checks.sh <env>`: the health, the database check and `POST /mcp`, through the page host. It only reads.
- `npx wrangler deployments list -c wrangler.server.toml --env <env>` shows the versions of the Worker.
- `npx wrangler tail madar-server-<env>` shows the live log (the logs are on, also in the dashboard).
- The Pages log has one JSON line for each request that went to a Supabase function (`reason` `setting` or `binding_missing`).
- The GitHub workflow "Deploy test" updates only the functions: after a switch it leaves the test Worker on older code.

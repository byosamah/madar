# Deploy

Production is live at https://madar.vado.sa with real people on it. A wrong step here reaches them. Production deploys
only from the Mac, after the typed word `production`. The test copy is https://preview.madar-46r.pages.dev.

## Release flow
The test copy is the staging step. There is no third copy: Supabase gives 2 free projects, and Madar uses both.
1. Commit the change on main, with every merge gate green.
2. `scripts/deploy/all.sh test`. At its end it records the commit (`.git/madar-test-deploy`, shared by every worktree).
3. Run the deploy suite on the test copy (`tests/CLAUDE.md`). It seeds the sample office again at its end.
4. The owner tries the change on the test copy with a sample account: admin@, management@, accounting@ or
   member@madar.test (passwords in `secrets/test-accounts.env`).
5. After the owner's OK: `scripts/deploy/all.sh production` from the same commit.
- Before `all.sh test`, set the `day` of each new What's new entry to the planned production day (`src/whatsNew/entries.ts`;
  the rule is in the root guide).
- Load the keys first: `set -a; . ./.env.local; set +a`, then `scripts/deploy/all.sh test`.
- Commit TASKS.md and proof.md before `all.sh test`: any later commit (also a note) needs `all.sh test` again. Notes after
  `all.sh test` go on the batch branch, not main. After production, fast-forward main to that branch with the release record.
- The deploy suite seeds the sample office at its start and wipes an owner try that is under way: start it only after the
  owner says the try is done. It takes about 45 minutes: tell the owner before you start it. When the owner asks for
  production while it runs, stop it, deploy the recorded commit, and write the unfinished suite in the proof.md record.
- When the owner skips the deploy suite, check the test copy in the owner's Chrome (it holds a session as the admin sample, so no
  password), try each changed screen, and write the skip and the checks in the release record.
- Production refuses, before the typed word: a commit that is not the recorded one, a change that is not committed (also
  a new file), and a folder that is not a git checkout. A new commit (also a merge or a rebase) needs `all.sh test` again.
  No switch skips the check. A hotfix also goes through `all.sh test` first (a few minutes).
- `all.sh test` removes the record before its first step, so a test deploy that stops part way blocks production. A
  step alone (`db.sh test`, `deploy.yml` on GitHub) records nothing.
- A migration that another session put on madar-test (a cloud proof, or its `all.sh test`) cannot be rewound: `db push` needs
  that migration in your tree. `all.sh test` then stops at its first step with `DbPushMissingLocalError` ("Remote migration
  versions not found in local migrations directory"), after it removed the record. Never repair the migration history for
  it. Ask which session holds the migration. Then wait for its release, or rebase onto its main and ship both in one release
  with the owner's word.
- Before `all.sh test`, check the record: `git merge-base --is-ancestor $(cat "$(git rev-parse --git-common-dir)/madar-test-deploy") main`.
  A record off main is another session's branch on the test copy: `git branch --contains <record>` names the branch. Ask that
  session first (`ListAgents`, `SendMessage`); the owner picks the order. A test deploy of a newer commit replaces the
  record: while an older commit waits for production, hold `all.sh test` of the newer one.
- `ps` shows `all.sh test` from `$TMPDIR/madar-deploy-*` while any `npm test` runs: those are the deploy script's own tests,
  not a release.
- Another session may leave changes in the main folder. Then deploy from a clean worktree of main: `git fetch . <branch>:main`,
  `git worktree add .claude/worktrees/deploy-test main`, and link `node_modules`, `secrets` and `.env.local` into it.
  `.gitignore` has `secrets/`, which does not match a link, so `.git/info/exclude` holds `secrets`. Without it the tree is
  not clean, and `all.sh test` records no commit.
- When `deploy-test` exists, it holds main, so `git fetch . <branch>:main` refuses. Use
  `git -C .claude/worktrees/deploy-test merge --ff-only <branch>`.
- `all.sh` runs from any clean worktree that holds main, with links to `node_modules`, `secrets` and `.env.local`.
  `git worktree list | grep '\[main\]'` finds it. `all.sh test` also runs with the sandbox off and `< /dev/null`: the prompt
  takes yes, and the record is written.
- After production: commit the record on main, then `git push origin main` (GitHub holds each release). Tell every session that
  waits on main (`SendMessage`) and give it the new commit of the record.
- `all.sh production` can stop at the secrets step with "The Management API refused the key list with 500" (Supabase).
  Nothing is deployed yet then: run it once more.
- Release history: `npx wrangler pages deployment list --project-name madar --environment production --json` gives each
  production commit (times only as "2 hours ago"); the "Release record: production at <commit>" commits give the exact time.
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
     password (as a SCRAM verifier), and the function secrets. Then the Worker of the copy, when it exists: the origin
     password of its Hyperdrive config `madar-db-<env>`, and its secrets through `wrangler secret bulk` (JSON on stdin; see
     "The server host"). It prints names, never a value.
  4. `functions.sh`: builds the server bundles and deploys `api`, `mcp`, `jobs`. Then it asks `api/health` in Frankfurt.
  5. `worker.sh --prebuilt`: deploys the Worker of the copy (`madar-server-<env>`, `wrangler deploy -c wrangler.server.toml
     --env <env>`) with the bundle of step 4, then lists its deployments. A copy whose Hyperdrive id in `wrangler.server.toml`
     is still the placeholder is skipped with a clear line. Every run deploys both hosts, so the way back always holds the
     same code.
  6. `pages.sh`: builds the remote screens, writes `dist/_headers` (CSP) with `headers.ts`, and uploads to the Pages
     project `madar`: branch `preview` for test, `main` for production. The `functions/` folder (the Pages Functions) goes
     too. `headers.ts` holds the fixed hosts of the CSP and `headers.test.ts` pins them. `/sw.js` gets `Cache-Control:
     no-cache`. The push services need no `connect-src`: the browser, not the page, talks to them. The page's own `/api`
     needs none either. `script-src` holds `'wasm-unsafe-eval'` for the Arabic text plugin of the map.
  7. `checks.sh`: through the page host, `GET /api/health` gives 200 with `x-madar-server` of the host in
     `config/server-host.json`; with `JOBS_SECRET` (curl reads it on stdin, `-K -`) database, lock and asyncContext are ok;
     `POST /mcp` with no token gives 401 from the same host. It only reads, so it asks no typed word. A failed check stops
     `all.sh test` before it records the commit.
- All CLIs come from `package.json`, never a global copy.

## Production rules
- `all.sh production` asks once for the typed word, after the commit check of the release flow. Without a terminal:
  `echo production | scripts/deploy/all.sh production`.
- A `!` command has no keyboard. Without `echo production |` it stops with "the typed word was not production" and changes
  nothing. The owner may also run the script in his Terminal window and type the word.
- After the owner asks, `echo production | scripts/deploy/all.sh production` (sandbox off, in the background) has passed the
  auto-mode check. If the check refuses it, hand the owner the `!` command. While it runs, the check can refuse an unrelated
  read-only Bash call as "Production Deploy": wait for the run to end. The push still needs the owner's `!`.
- `all.sh test` asks "Do you want to push api config to remote? [Y/n]" (`api.enabled`: config.toml false, the hosted projects
  true). A run with no keyboard passes `--yes` (`yes_unless_terminal`), and yes is the right answer (the push keeps the Data API
  off, see "Quick check of production"), so Claude may run `all.sh test` in the background.
- After production, check the live site: `all.sh` ends with `checks.sh`, then page 200 with the title Madar and `/favicon.ico`
  200. Then write the release record: a section at the end of `docs/superpowers/real-build/proof.md` (after the last "Release
  record"), a line in `TASKS.md`, one commit on main. That commit changes HEAD, so the next production needs `all.sh test` again.
- To prove what a copy serves, grep a new English word in `assets/words.en-*.js`. `index.html` does not name that file: a first-load
  script does. Find it with `for s in $(curl -s <host>/ | grep -o '/assets/[^"]*\.js' | sort -u); do curl -s <host>$s | grep -o 'words\.en-[A-Za-z0-9_-]*\.js'; done | sort -u` (sandbox off).
- Just after a deploy, madar.vado.sa can serve the old bundle for a short time. Compare the `index-*.js` name there with the
  deploy address (`<id>.madar-46r.pages.dev`, the last line of `all.sh`).
- Every script refuses production when `CI` or `GITHUB_ACTIONS` is set. A `MADAR_DEPLOY_CONFIRMED` from the shell never counts.
- The auto-mode safety system may refuse a production deploy or a key change until the owner says so in chat. Respect the
  refusal. Never work around it. After one refusal, give the owner the one-line command with `!` as the very first character
  of the input box. Without that, it arrives as chat text and runs nothing.
- A `!` command runs in the folder of the session, often the main folder. Start each release command with
  `cd <deploy-test> &&` or `git -C <deploy-test>`.
- Before a release step, check that another session did not do it already: `git fetch`,
  `npx wrangler pages deployment list --project-name madar`, and the release record on main.
- A commit on main after another session's `all.sh test` blocks that session's production. Tell that session (`ListAgents`,
  then `SendMessage` with the new commit).
- Change only madar-test unless the owner asked for production.

## Secrets
- `secrets/test.env`, `secrets/production.env`, `secrets/test-accounts.env`: git-ignored, mode 600. Never print them.
- `secrets.ts` needs `SUPABASE_ACCESS_TOKEN` (the Madar account) and the postgres password: `MADAR_TEST_DB_PASSWORD` for
  test, `MADAR_DB_PASSWORD` for production (both in `.env.local`).
- `MCP_URL` in each file is the short MCP address (see `server/mcp/CLAUDE.md`).
- Each group below is all or none. `secrets.ts` checks the shape, and its error names the variable, never the value.
  - Browser push: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`. `npx tsx scripts/push/make-vapid.ts <env>` makes them
    (`server/push/CLAUDE.md`). The public key also sits in `config/remote.<env>.env` as `VITE_VAPID_PUBLIC_KEY`, and `pages.sh`
    warns when it is missing.
  - R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (the bucket of the copy: `madar-files-test` for
    test, `madar-files` for production).
  - Google Calendar: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MADAR_GOOGLE_KEY`. `npx tsx scripts/google/setup-secrets.ts
    <env>` reads the two client values from `.env.local`, makes a new key, and appends the three lines; it refuses when one of
    the three lines is there already (a new key makes every sealed token useless). Each copy has its own key. With none,
    Google is off (`google.status` says `ready: false`). See `src/api/CLAUDE.md`, "Google Calendar".
  - Daftra: `DAFTRA_<NAME>_KEY` and `DAFTRA_<NAME>_SITE` for each sub-company (`server/daftra/config.ts`). With no pair, the
    link is off. A Daftra account that the file drops is not removed from the Worker by the run: remove its two secrets by
    hand with `wrangler secret delete`.
- `POSTHOG_KEY` is the public PostHog project key, optional. The same key sits in `config/remote.<env>.env` as
  `VITE_POSTHOG_KEY`. With none, the server sends no error record and the screens send nothing.
- `MIN_CLIENT_BUILD`: the server refuses a screen build older than it. A build ID is the UTC day (`2026.10.5`, no zero
  padding; `buildOlder` in `server/http/limits.ts` compares number by number). To raise it on a day that already had a deploy,
  give the build a fourth part (`VITE_MADAR_BUILD=2026.10.16.1`); every later deploy on that UTC day then needs the same value
  or a higher one. The steps of one use are in `r2-switch-runbook.md`.

## Switch the files to R2
Done for both copies. The Worker and the Supabase functions of one copy get the same `MADAR_FILE_STORE` and R2 values in one
step: the file store does not follow the server host. No copy from R2 back to Storage exists, so a return to
`MADAR_FILE_STORE=supabase` loses every file that people uploaded after the switch. The scripts stay:
`scripts/storage/move-to-r2.ts --env <env>` (`--copy-only` after a switch) and `scripts/storage/verify-r2-keys.ts --env <env>`
(every record key has an object on R2). The full steps: `docs/superpowers/real-build/r2-switch-runbook.md`.

## Cloudflare
- wrangler is signed in as o.khalil@mazj.org. The Pages project `madar` is `madar-46r.pages.dev` (`madar.pages.dev`
  belongs to someone else). R2 buckets: `madar-files-test` and `madar-files`, both EU.
- wrangler 4.147+ sends `pages project create` to the new Workers path. The project exists, so `pages deploy` works.
- Pages custom domains go through the Cloudflare API with the wrangler login token (`npx wrangler whoami` refreshes it;
  `oauth_token` in `~/Library/Preferences/.wrangler/config/default.toml`).
- vado.sa DNS is in a Vercel team that the CLI cannot see. Give the owner the records, and he adds them himself.
  Never pay Vercel.
- `worker.sh` deploys `madar-server-<env>` from `wrangler.server.toml`. No Madar Worker has a workers.dev address
  (`workers_dev` and `preview_urls` false). A Worker fetch of a workers.dev address of the same account fails with error 1042,
  so Pages reaches the Worker only through its service binding. Never touch the Worker `binhindi-massing` of the same account.
- `madar-server-production` has no Durable Object binding, no migration and no Cron (`migrations = []`, `crons = []`).
  Wrangler prints one warning about `durable_objects` on each production deploy: this is expected. Count the Cron Triggers of
  the account (Free allows 5) before you add one.
- Cloudflare mails "[Action required] Workers CPU limit exceeded" once a day while any Worker of the account (also a probe) hits
  the Free CPU limit in the last 24 hours. Find the source: query `workersInvocationsAdaptive` and
  `pagesFunctionsInvocationsAdaptiveGroups` (dimensions `scriptName`, `status`, `datetimeHour`) with
  `scripts/proof/do-socket/gql.mjs`; a stop is the status `exceededResources`, and a deleted Worker shows as `__unknown__`. Run
  `npx wrangler whoami` first when the query gives 401: it renews the OAuth token. Never take its "Upgrade" button.

## Other scripts
- First Admin: `npx tsx scripts/first-admin.ts --env test|production|local --email --name --language --gender`.
  With no terminal, `--password-stdin` reads the typed word `production` and the password from one stdin.
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
- A step that stops once and passes on the second run: a Pages step with "Failed to publish your Function. Got error: Unknown
  internal error occurred." (a fault at Cloudflare when `functions/` did not change; run `scripts/deploy/pages.sh <env>` again
  after a few minutes), `ConfigPushApiUpdateStatusError` (500) in `config.sh` (check that the Data API is still off, then run
  `all.sh production` again), `DbPushMissingLocalError` in `db.sh` while both files are in the folder (run `db.sh` again), and
  error 2013 (invalid credentials) in the Hyperdrive password step of `secrets.ts` (the session pooler keeps the old verifier
  for some time; `secrets.ts` tries again within its sign-in limit). Run the step again once. Never run the `supabase
  migration repair` that the CLI suggests: it rewrites the migration history of the project.
- `madar.vado.sa/api/health` goes through the page api (`functions/api`) to the host of `config/server-host.json`, and its
  `x-madar-server` names that host (`checks.sh`). Straight to the function, the health needs `forceFunctionRegion`, else it
  answers from another region.
- `gh run list -R byosamah/madar --workflow "DB backup" --limit 1` shows the last nightly backup.

## The server host
`config/server-host.json` holds one word for each copy: `supabase` (the Supabase functions), `workers` (the Worker of the copy,
the Postgres path) or `office` (the office object of the Worker). `OFFICE_COPIES_OPEN` in `server/core/serverHost.ts` lists the
copies that may take `office`: the setting refuses `production: office`. Both copies say `supabase` now. Every `all.sh` run of
`supabase` or `workers` deploys both hosts with the same code, so the other host is always the way back.
- The word `workers` needs Workers Paid: on Free, a median Madar call needs more CPU than the 10 ms limit (proof.md, "The deploy
  suite on Workers Free"). The owner refuses a paid plan, so use `supabase` or `office`.
- The word `office`: the copy runs on its office object. `all.sh` then runs `secrets.ts --office` (the Worker secrets only: no
  Supabase token, no database password, no Hyperdrive; `MADAR_SECRET_KEY` and `MADAR_AUTH_PRIVATE_JWK` stay as the Worker has
  them), `worker.sh` (it builds the bundle and deploys with `--var MADAR_DATA:office`), `pages.sh` (the screens with
  `VITE_MADAR_AUTH=madar` and `VITE_MADAR_LIVE=socket`) and `checks.sh` (`office;colo=...` and the office health). `db.sh`,
  `config.sh` and `functions.sh` stay out: the Supabase project keeps its last state as the way back.
- The office ops (`/api/office/export|import|peek|drop`) reach the Worker of a copy through the Pages binding whatever the word
  says, and need `MADAR_EXPORT_SECRET` or `MADAR_OPS_SECRET`. Both go into `secrets/<env>.env`, and `secrets.ts` gives them to the
  Worker on every word (never to the Supabase functions). `npx tsx scripts/office/new-secret.ts test <NAME>` makes each one (the
  owner runs it), `npx tsx scripts/office/auth-key.ts test` makes the sign-in key. `MADAR_AUTH_PRIVATE_JWK` never goes into a
  secrets file: `secrets.ts` refuses a file that holds it. The first switch of the test copy: Part 2 of
  `docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md`.
- What follows the word: the `VITE_API_URL` of the screens (`build:remote`); the Pages Functions of `/api` and `/mcp`; the calls
  limit of the usage meters and the warning mail; what `checks.sh` wants in `x-madar-server`. The Pages Functions get the word
  when Pages builds them, so a change reaches them only with `pages.sh`.
- What does not follow it: MCP_URL (the agents keep their connection), the jobs (pg_cron calls the Supabase jobs function in
  both settings), the Vault, the database password.
- Names: the Workers `madar-server-test` and `madar-server-production` (`wrangler.server.toml`, `[env.test]` and
  `[env.production]`); the Pages bindings `MADAR_SERVER_TEST` (preview) and `MADAR_SERVER_PRODUCTION` (production); the
  Hyperdrive configs `madar-db-test` and `madar-db-production` (the session pooler, port 5432: the transaction pooler hangs
  behind Hyperdrive, proof.md). Ids in `accounts.md`.
- `secrets.ts` gives the Worker every function secret but `DATABASE_URL`, `DATABASE_READ_URL` and `DATABASE_CA` (Hyperdrive
  replaces them), and the two office secrets, with `MADAR_SECRET_KEY` from the Management API and `MCP_URL` required. A name
  removed from the file goes as null, so the Worker loses it. The same run sets the Hyperdrive password from `DATABASE_URL`, so
  a new password never cuts the Worker off. A deploy resets the Worker vars (`SUPABASE_URL`, `WORKER_REGION`) to the file and
  keeps its secrets.

### First setup of a copy (once, before its first switch)
The lead runs these with the sandbox off. Production needs the owner's yes and the typed word.
1. `npx tsx scripts/deploy/cloudflare-setup.ts --env <env>`: the CA, the Hyperdrive config, the R2 bucket and its CORS rule
   (only when R2 is on), and the Pages binding (it waits for the Worker). It prints the Hyperdrive id: put it into
   `[[env.<env>.hyperdrive]]` of `wrangler.server.toml` and into `accounts.md`, then commit.
2. `scripts/deploy/worker.sh <env>`: the first deploy makes the Worker. Then `npx tsx scripts/deploy/secrets.ts <env>` gives it
   its secrets (a run before the Worker existed skipped it with a clear line).
3. `cloudflare-setup.ts --env <env>` again: now it sets the Pages binding. The next `pages.sh` uses it.
4. `scripts/deploy/all.sh <env>`, with the word still `supabase`: `checks.sh` must pass.

### The switch of a copy
1. Set the word of the copy in `config/server-host.json`, in its own commit.
2. `scripts/deploy/all.sh test` (production: the Release flow). `checks.sh` then wants `x-madar-server: <word>;colo=...` through
   the page host, and the database check. A tab that was open before keeps calling the api function until it reloads; both
   hosts serve it.
3. `scripts/proof/server-time.sh 20` (sandbox off, from the Mac). The Worker stays only if it measures faster (owner rule).

### The way back
Set the word back to `supabase`, commit, `all.sh test`, check, then `all.sh production`. The screens get the api function
again, and the forwarders send `/api` and `/mcp` to the Supabase functions, so a tab built for the Worker keeps working through
the page api. Nothing in the database changes. The Worker stays deployed with its secrets.

### Quick checks of the Worker
- `scripts/deploy/checks.sh <env>` reads the health, the database check and `POST /mcp` through the page host.
- `npx wrangler deployments list -c wrangler.server.toml --env <env>` shows the versions of the Worker.
  `npx wrangler tail madar-server-<env>` shows the live log.
- The Pages log has one JSON line for each request that went to a Supabase function (`reason` `setting` or `binding_missing`).
- The GitHub workflow "Deploy test" updates only the functions: after a switch it leaves the test Worker on older code.

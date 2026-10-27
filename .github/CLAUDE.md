# CI and backups (GitHub Actions)

Private repo `byosamah/madar`. The free plan gives 2,000 minutes a month. When they are used up, GitHub refuses every job
(also the nightly database backup) with "recent account payments have failed or your spending limit needs to be increased".
No card is on the account and nothing failed: the minutes come back with the new month. So `ci.yml` and `ci-stack.yml` start
only by hand, the merge gate runs on the Mac, and the minutes go to the backups first.

## Workflows (`workflows/`)
- `ci.yml`, by hand only (`gh workflow run CI --ref main`): typecheck, unit, build, server tests, the builds, the migration secret
  check, and `lite` (`test:lite` on node:sqlite). No secret. A new run of the same branch cancels the older run, so that commit
  gets no full result.
- `ci-stack.yml`, by hand only (`gh workflow run "CI stack" --ref main`): `db` (`test:db` on Postgres only), `integration` (full
  local stack and MinIO), and `office` (`build:server`, `test:office` on local workerd and `smoke:office` on local wrangler dev;
  no Docker). The integration order is fixed: server bundles, the stack, `test:mcp`, `npx supabase db reset`, `test:it`. Never
  add a shared `supabase functions serve` step (`supabase/CLAUDE.md`, "The local stack").
- `deploy.yml`, by hand only: migrations and functions of madar-test. Its first step is `scripts/deploy/token-scope.sh`.
  Production, settings, secrets and screens never deploy from GitHub. Nor does the Worker: a Workers token could change
  production too. After a switch of the test copy to the Worker, `deploy.yml` leaves the test Worker on older code: use
  `scripts/deploy/all.sh test`.
- `db-backup.yml`, nightly at 02:07 Riyadh: an age-encrypted database dump to a release of `byosamah/madar-backups`
  (kept 30 days). Needs `secrets.BACKUP_DB_URL`, `secrets.BACKUP_REPO_TOKEN` (fine-grained, contents write on madar-backups
  only) and `vars.BACKUP_AGE_RECIPIENT` (the owner's public key).
- `office-backup.yml`, nightly at 02:07 Riyadh: the export route of an office object to an age-encrypted release
  `madar-office-<copy>-<stamp>` of `byosamah/madar-backups` (kept 30 days, removed by copy). Off until `vars.OFFICE_BACKUP_URL`
  is set: every run then ends at its first step with success. Needs `secrets.OFFICE_EXPORT_SECRET` (the `MADAR_EXPORT_SECRET` of
  that Worker), `vars.OFFICE_BACKUP_COPY`, `secrets.BACKUP_REPO_TOKEN` and `vars.BACKUP_AGE_RECIPIENT`. The restore check of its
  file needs no Docker (`scripts/restore-check.ts` sees the name). Its age check reads only the `madar-office-<copy>-` releases,
  and the age check of `db-backup.yml` reads only the `madar-db-` releases, so a newer release of the other kind never hides a
  missed backup.
- Use `publishedAt` for the time of a backup release, never `createdAt`. GitHub gives a release the `createdAt` of the commit that
  its tag points to, and every release of madar-backups points to the same commit. A test refuses `createdAt` in any backup
  workflow (`scripts/backup/workflows.test.ts`).
- `files-backup.yml` (Friday 03:07 Riyadh) is PAUSED (`disabled_manually`). The owner chose R2 alone for the files and no
  Backblaze B2. The source is the R2 bucket `madar-files` with a read-only R2 token (never the server token; the workflow follows
  `vars.MADAR_FILE_STORE`). The file still names a B2 crypt remote as its target: change that before you enable it. To start it:
  the owner makes the read-only token, then `gh variable set MADAR_FILE_STORE --body r2`, `gh secret set FILES_S3_ENDPOINT`,
  `FILES_S3_ACCESS_KEY_ID` and `FILES_S3_SECRET_ACCESS_KEY` (the owner types the values at the prompt, never in chat), then
  `gh workflow enable "Files backup"` and one run by hand. Each GitHub write needs the owner's OK. `FILES_BUCKET` stays
  `madar-files`. The test copy has no file backup.
- `restore-reminder.yml`, the first day of each month: opens one issue with the steps of the restore check.

## Rules
- Every action is pinned by its commit SHA, with the version in a comment.
- Checkout uses `persist-credentials: false`.
- A job never has an `if:` on the event: GitHub reports a skipped job as Success.
- A push that touches `.github/workflows` needs the `workflow` scope of the gh token. Without it, the owner runs
  `gh auth refresh -h github.com -s workflow` in his own terminal and types the code at once.
- After a change to a workflow, update `scripts/ci/ci-workflow.test.ts` if it checks that step.
- `gh run list --commit` needs the full SHA. A short SHA gives an empty list, which looks like "no run".
- A red `db` job with every test passed is the speed gate (`GATE_RUN_MS`, `server/test/speed.ts`). Read the job log before you look
  for a broken test.

## Backups by hand
- `gh workflow run "DB backup"`.
- `scripts/backup/mac-backup.sh` makes the same file and release as `db-backup.yml` from the Mac. Run it only when the owner asks
  for a backup (root rule), after 17:00 Riyadh (the dump holds the office lock for a few seconds), sandbox off. `--check` sends one
  read-only query and uploads nothing. It needs `brew install postgresql@17`, `MADAR_DB_PASSWORD` and `BACKUP_REPO_TOKEN`.
  `--if-due` asks `scripts/backup/due.ts` whether a backup is due (the rules and the end date `END` are in that file). The header
  comments of `mac-backup.sh` and `due.ts` still say that each session runs it: the root rule wins.
- The private key is not on the Mac. The owner holds the only copy.
- To check one: the owner gives the key for the check, `age -d -i <owner key>` opens it, then delete the opened copy and the key
  file.
- The monthly restore check runs on the Mac: `scripts/restore-check.ts` (it needs the owner's offline key).
- An office backup (`madar-office-<copy>-<stamp>.tar.gz.age`) goes to the same script: the name picks
  `scripts/backup/officeRestore.ts`, which restores every table into node:sqlite with the schema of this build (no Docker) and
  compares the rows and the sha256 of each table with the manifest. A backup of a newer schema fails with its version.
- The file step takes `--files-lag-days`: 0 for the live R2 bucket (`--files-remote madar-r2:madar-files-test --files-lag-days 0`,
  with an rclone remote on a read-only R2 token).
- The check makes each role that the dumps name but do not make (`rolesToMake`, `scripts/backup/check.ts`). The CLI dump
  quotes every name, so a quoted name with a dot after it (`FROM "public"."events"` of CREATE STATISTICS) is a table, never a role.
- A server table that is written outside the office lock goes into `OUTSIDE_OFFICE_LOCK` of `scripts/backup/check.ts`
  (`server/data/CLAUDE.md`, "Tables").

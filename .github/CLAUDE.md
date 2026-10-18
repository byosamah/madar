# CI and backups (GitHub Actions)

Private repo `byosamah/madar`. The free plan gives 2,000 minutes a month (GitHub shows them as $12 of included use). The pushes
of October 2026 used them all by 2026-10-17 13:08 UTC: GitHub then refused every job with "recent account payments have failed or
your spending limit needs to be increased" (no card is on the account; nothing failed), also the nightly database backup. Since
2026-10-18 (owner) `ci.yml` and `ci-stack.yml` start only by hand, the merge gate runs on the Mac, and the minutes go to the
backups first. While GitHub refuses, the database backup runs from the Mac (see "Backups by hand").

## Workflows (`workflows/`)
- `ci.yml`, by hand only (`gh workflow run CI --ref main`): typecheck, unit, build, server tests, the builds, the migration secret check, and `lite` (`test:lite` on
  node:sqlite, exit wave 4). No secret.
- `ci-stack.yml`, by hand only (`gh workflow run "CI stack" --ref main`): `db` (`test:db` on Postgres only), `integration` (full local stack and MinIO), and
  `office` (`build:server`, `test:office` on local workerd and `smoke:office` on local wrangler dev; no Docker, exit wave 4).
  The integration order is fixed: server bundles, the stack, `test:mcp`, `npx supabase db reset`, `test:it`. Never add a
  shared `supabase functions serve` step: it broke the conformance and integration suites.
- `deploy.yml`, by hand only: migrations and functions of madar-test. Its first step is `scripts/deploy/token-scope.sh`.
  Production, settings, secrets and screens never deploy from GitHub. Nor does the Worker (owner, 2026-10-16): a Workers token
  could change production too. After a switch of the test copy to the Worker, `deploy.yml` leaves the test Worker on older
  code: use `scripts/deploy/all.sh test`.
- `db-backup.yml`, nightly at 02:07 Riyadh: an age-encrypted database dump to a release of `byosamah/madar-backups`
  (kept 30 days). Needs `secrets.BACKUP_DB_URL`, `secrets.BACKUP_REPO_TOKEN` (fine-grained, contents write on madar-backups
  only) and `vars.BACKUP_AGE_RECIPIENT` (the owner's public key).
- `office-backup.yml` (exit wave 4), nightly at 02:07 Riyadh: the export route of an office object to an age-encrypted release
  `madar-office-<copy>-<stamp>` of `byosamah/madar-backups` (kept 30 days, removed by copy). Off until `vars.OFFICE_BACKUP_URL`
  is set (wave 5: the test copy): every run then ends at its first step with success. Needs `secrets.OFFICE_EXPORT_SECRET` (the
  `MADAR_EXPORT_SECRET` of that Worker), `vars.OFFICE_BACKUP_COPY`, `secrets.BACKUP_REPO_TOKEN` and `vars.BACKUP_AGE_RECIPIENT`.
  The restore check of its file needs no Docker (`scripts/restore-check.ts` sees the name). Its age check reads only the
  `madar-office-<copy>-` releases, and the age check of `db-backup.yml` reads only the `madar-db-` releases, so a newer
  release of the other kind never hides a missed backup.
- The time of a backup release is `publishedAt`, never `createdAt` (2026-10-17). GitHub gives a release the `createdAt` of the
  commit that its tag points to, and every release of madar-backups points to the one commit of 2026-10-05. With `createdAt`,
  the age check failed every night from 2026-10-12 (a false "282 hours old" mail), and the remove step would have removed every
  backup, the new one too, from 2026-11-04. A test refuses `createdAt` in any backup workflow.
- `files-backup.yml`, Friday 03:07 Riyadh: rclone sync of the file store to a Backblaze B2 crypt remote. PAUSED since
  2026-10-05 (`disabled_manually`): it waits for the owner's B2 account (`B2_KEY_ID`, `B2_APPLICATION_KEY`, the S3 key of
  the store, the crypt password and salt). After those secrets: `gh workflow enable "Files backup"`, then one run by hand.
- After the production switch to R2 (owner, 2026-10-16), the source of the file backup is R2: the workflow follows
  `vars.MADAR_FILE_STORE`. The source key is a read-only R2 token, never the server token. Each GitHub write needs the
  owner's OK. The steps:
  1. The owner makes the R2 token `madar-production-backup` in the dashboard: Object Read only, the bucket `madar-files` only.
  2. `gh variable set MADAR_FILE_STORE --body r2 -R byosamah/madar`.
  3. `gh secret set FILES_S3_ENDPOINT --body https://d76d34779c63849f5acdf3d6af3751cd.eu.r2.cloudflarestorage.com -R byosamah/madar`.
  4. `gh secret set FILES_S3_ACCESS_KEY_ID -R byosamah/madar`, then `gh secret set FILES_S3_SECRET_ACCESS_KEY -R byosamah/madar`:
     the owner types each value of the read-only token at the prompt (never in chat).
  5. One run by hand (`gh workflow run "Files backup"`), when the workflow is on.
  `FILES_BUCKET` stays `madar-files`: the production bucket has that name on both stores. The test copy has no file backup.
- `restore-reminder.yml`, the first day of each month: opens one issue with the steps of the restore check.

## Rules
- Every action is pinned by its commit SHA, with the version in a comment.
- Checkout uses `persist-credentials: false`.
- A job never has an `if:` on the event: GitHub reports a skipped job as Success.
- A push that touches `.github/workflows` needs the `workflow` scope of the gh token. The token of this Mac has it (2026-10-17);
  without it, the owner runs `gh auth refresh -h github.com -s workflow` in his own terminal and types the code at once.
- After a change to a workflow, update `scripts/ci/ci-workflow.test.ts` if it checks that step.
- `ci.yml` takes about 15 minutes. A new run of the same branch cancels the older run, so that commit gets no full result.
- `gh run list --commit` needs the full SHA. A short SHA gives an empty list, which looks like "no run".
- A red `db` job with every test passed is the speed gate (`GATE_RUN_MS`, `server/test/global-setup.ts`, 180 s). Read
  the job log before you look for a broken test.

## Backups by hand
- `gh workflow run "DB backup"`.
- While GitHub refuses jobs (October 2026): `scripts/backup/mac-backup.sh` on the Mac, each evening after 17:00 Riyadh (the dump
  holds the office lock for a few seconds), sandbox off. The same file and release as `db-backup.yml`; `--check` sends one
  read-only query and uploads nothing. It needs `brew install postgresql@17`, `MADAR_DB_PASSWORD` and `BACKUP_REPO_TOKEN`.
- The private key is not on the Mac (deleted 2026-10-05 after a match check with `age-keygen -y` against
  `BACKUP_AGE_RECIPIENT`). The owner holds the only copy.
- To check one: the owner gives the key for the check, `age -d -i <owner key>` opens it, then delete the opened copy
  and the key file.
- The monthly restore check runs on the Mac: `scripts/restore-check.ts` (it needs the owner's offline key).
- An office backup (exit wave 4, `madar-office-<copy>-<stamp>.tar.gz.age`) goes to the same script: the name picks
  `scripts/backup/officeRestore.ts`, which restores every table into node:sqlite with the schema of this build (no Docker) and
  compares the rows and the sha256 of each table with the manifest. A backup of a newer schema fails with its version.
- The file step takes `--files-lag-days`: 8 (the default) for the weekly B2 copy, 0 for the live R2 bucket. Owner decision 5
  (R2 alone, owner 2026-10-18): `--files-remote madar-r2:madar-files-test --files-lag-days 0`, with an rclone remote on a read-only R2 token.
- The check makes each role that the dumps name but do not make (`rolesToMake`, `scripts/backup/check.ts`). The CLI dump
  quotes every name, so a quoted name with a dot after it (`FROM "public"."events"` of CREATE STATISTICS) is a table, never a role.

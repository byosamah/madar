# CI and backups (GitHub Actions)

Private repo `byosamah/madar`. The free plan gives 2,000 minutes a month, so each workflow stops an older run of the same
branch, and a push that changes only `docs/` runs nothing.

## Workflows (`workflows/`)
- `ci.yml`, every push: typecheck, unit, build, server tests, the builds, the migration secret check. No secret.
- `ci-stack.yml`, pull requests and main: `db` (`test:db` on Postgres only) and `integration` (full local stack and MinIO).
  The integration order is fixed: server bundles, the stack, `test:mcp`, `npx supabase db reset`, `test:it`. Never add a
  shared `supabase functions serve` step: it broke the conformance and integration suites.
- `deploy.yml`, by hand only: migrations and functions of madar-test. Its first step is `scripts/deploy/token-scope.sh`.
  Production, settings, secrets and screens never deploy from GitHub.
- `db-backup.yml`, nightly at 02:07 Riyadh: an age-encrypted database dump to a release of `byosamah/madar-backups`
  (kept 30 days). Needs `secrets.BACKUP_DB_URL`, `secrets.BACKUP_REPO_TOKEN` (fine-grained, contents write on madar-backups
  only) and `vars.BACKUP_AGE_RECIPIENT` (the owner's public key).
- `files-backup.yml`, Friday 03:07 Riyadh: rclone sync of the file store to a Backblaze B2 crypt remote. PAUSED since
  2026-10-05 (`disabled_manually`): it waits for the owner's B2 account (`B2_KEY_ID`, `B2_APPLICATION_KEY`, the S3 key of
  the store, the crypt password and salt). After those secrets: `gh workflow enable "Files backup"`, then one run by hand.
- `restore-reminder.yml`, the first day of each month: opens one issue with the steps of the restore check.

## Rules
- Every action is pinned by its commit SHA, with the version in a comment.
- Checkout uses `persist-credentials: false`.
- A job never has an `if:` on the event: GitHub reports a skipped job as Success.
- A push that touches `.github/workflows` needs `gh auth refresh -h github.com -s workflow`. The owner runs it in his own
  terminal and types the code at once.
- After a change to a workflow, update `scripts/ci/ci-workflow.test.ts` if it checks that step.
- `ci.yml` takes about 15 minutes. A push before it ends cancels the older run, so that commit gets no full result.
  Wait for the result before the next push when the commit changes code.
- `gh run list --commit` needs the full SHA. A short SHA gives an empty list, which looks like "no run".
- A red `db` job with every test passed is the speed gate (`GATE_RUN_MS`, `server/test/global-setup.ts`, 180 s). Read
  the job log before you look for a broken test.

## Backups by hand
- `gh workflow run "DB backup"`.
- The private key is not on the Mac (deleted 2026-10-05 after a match check with `age-keygen -y` against
  `BACKUP_AGE_RECIPIENT`). The owner holds the only copy.
- To check one: the owner gives the key for the check, `age -d -i <owner key>` opens it, then delete the opened copy
  and the key file.
- The monthly restore check runs on the Mac: `scripts/restore-check.ts` (it needs the owner's offline key).
- The check makes each role that the dumps name but do not make (`rolesToMake`, `scripts/backup/check.ts`). The CLI dump
  quotes every name, so a quoted name with a dot after it (`FROM "public"."events"` of CREATE STATISTICS) is a table, never a role.

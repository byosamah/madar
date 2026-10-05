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
- `files-backup.yml`, Friday 03:07 Riyadh: rclone sync of the file store to a Backblaze B2 crypt remote. It waits for the
  owner's B2 account (`B2_KEY_ID`, `B2_APPLICATION_KEY`, the S3 key of the store, the crypt password and salt).
- `restore-reminder.yml`, the first day of each month: opens one issue with the steps of the restore check.

## Rules
- Every action is pinned by its commit SHA, with the version in a comment.
- Checkout uses `persist-credentials: false`.
- A job never has an `if:` on the event: GitHub reports a skipped job as Success.
- A push that touches `.github/workflows` needs `gh auth refresh -h github.com -s workflow`. The owner runs it in his own
  terminal and types the code at once.
- After a change to a workflow, update `scripts/ci/ci-workflow.test.ts` if it checks that step.

## Backups by hand
- `gh workflow run "DB backup"`.
- To check one: open it with `age -d -i <owner key>`, then delete the opened copy.
- The monthly restore check runs on the Mac: `scripts/restore-check.ts` (it needs the owner's offline key).

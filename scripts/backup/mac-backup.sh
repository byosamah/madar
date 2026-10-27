#!/bin/bash
# The nightly database backup of Madar, from the Mac, while GitHub Actions refuses jobs (owner OK, 2026-10-18; .github/CLAUDE.md).
# The same steps as .github/workflows/db-backup.yml: scripts/backup/dump.ts, then a release of byosamah/madar-backups.
#
#   scripts/backup/mac-backup.sh            the backup and its upload (sandbox off; after 17:00 Riyadh, see below)
#   scripts/backup/mac-backup.sh --check    the inputs and one read-only query: no dump, no upload
#   scripts/backup/mac-backup.sh --if-due   the backup only when scripts/backup/due.ts says it is due (run it only when the
#                                           owner asks for a backup, root CLAUDE.md)
#
# Needs: `brew install postgresql@17` (pg_dump 17, the version of the server), `age`, the gh CLI, and in .env.local
# MADAR_DB_PASSWORD (production) and BACKUP_REPO_TOKEN (write on madar-backups only). The backup holds the office lock for the
# data dump (a few seconds), so an office write in that time waits and can fail as busy: run it outside office hours.
# It never prints a secret. It removes no old backup: db-backup.yml does that again when GitHub runs it.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env.local; set +a
if [[ "${1:-}" == "--if-due" ]]; then
  NEWEST="$(GH_TOKEN="$BACKUP_REPO_TOKEN" gh release list --repo byosamah/madar-backups --limit 100 --json tagName,publishedAt \
    --jq '[.[] | select(.tagName | startswith("madar-db-"))] | sort_by(.publishedAt) | last | .publishedAt // ""')"
  GITHUB="$(gh run list -R byosamah/madar --workflow "DB backup" --status success --limit 1 --json createdAt --jq '.[0].createdAt // ""')"
  DUE="$(npx tsx scripts/backup/due.ts "$NEWEST" "$GITHUB")"
  echo "Mac backup: $DUE"
  [[ "$DUE" == due:* ]] || exit 0
fi
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
BACKUP_DB_URL="$(node -e 'const p=process.env.MADAR_DB_PASSWORD||"";if(!p)process.exit(1);process.stdout.write(`postgresql://postgres.oprkvdjudjxxhvodkzgs:${encodeURIComponent(p)}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`)')"
export BACKUP_DB_URL
BACKUP_AGE_RECIPIENT="$(gh variable get BACKUP_AGE_RECIPIENT -R byosamah/madar)"
export BACKUP_AGE_RECIPIENT
[[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || { echo "The age recipient has a wrong shape."; exit 1; }
echo "pg_dump: $(pg_dump --version)"
if [[ "${1:-}" == "--check" ]]; then
  node --import tsx -e '
    import pg from "pg"; import { clientConfig } from "./scripts/backup/dump.ts";
    const c = new pg.Client(clientConfig(process.env.BACKUP_DB_URL)); await c.connect();
    const r = await c.query("select current_setting(\x27server_version\x27) v, (select count(*) from public.users) n");
    console.log(`database: Postgres ${r.rows[0].v}, ${r.rows[0].n} users rows`); await c.end();'
  GH_TOKEN="$BACKUP_REPO_TOKEN" gh release list --repo byosamah/madar-backups --limit 1 --json tagName --jq '"upload key: reads madar-backups, newest " + .[0].tagName'
  exit 0
fi
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
npx tsx scripts/backup/dump.ts --out "$OUT" > "$OUT/backup.json"
cat "$OUT/backup.json"
FILE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).file)' "$OUT/backup.json")"
NAME="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name)' "$OUT/backup.json")"
GH_TOKEN="$BACKUP_REPO_TOKEN" gh release create "$NAME" "$FILE" --repo byosamah/madar-backups --title "$NAME" \
  --notes "Nightly database backup of Madar, encrypted with age to the owner's key, made on the Mac while GitHub Actions refused jobs. Check it with scripts/restore-check.ts."
echo "Uploaded $NAME to byosamah/madar-backups."

#!/usr/bin/env bash
# scripts/deploy/db.sh <test|production>: the migrations of supabase/migrations into the project (plan 5.9).
# It links the CLI to the project with the Madar token, lists the new migrations, pushes them, and unlinks again, so a later
# command by hand never reaches a project by mistake.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
confirm_production
need_supabase_token
export_db_password
cd "$ROOT"

supabase_cli link --project-ref "$REF"
trap 'supabase_cli unlink >/dev/null 2>&1 || true' EXIT
supabase_cli db push --linked --dry-run
supabase_cli db push --linked $(yes_unless_terminal)
echo "Migrations of $TARGET ($REF) are up to date."

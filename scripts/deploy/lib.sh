#!/usr/bin/env bash
# Shared by the deploy scripts (plan 5.9). Each script sources this file and calls deploy_target with its argument.
# It works with the bash 3.2 of macOS: no associative arrays, no mapfile.
set -euo pipefail

TEST_REF=qdgwpnesxppnqsaabqzd
PRODUCTION_REF=oprkvdjudjxxhvodkzgs
FUNCTION_REGION=eu-central-1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The CLIs that package.json pins, never a global copy and never a download.
BIN="$ROOT/node_modules/.bin"

# deploy_target <test|production>: sets TARGET, REF and SUPABASE_URL, or stops with the usage.
deploy_target() {
  case "${1:-}" in
    test) REF=$TEST_REF ;;
    production) REF=$PRODUCTION_REF ;;
    *)
      echo "Usage: $(basename "$0") <test|production>" >&2
      exit 2
      ;;
  esac
  TARGET=$1
  SUPABASE_URL="https://$REF.supabase.co"
}

# Production runs from the Mac only, after the typed word production (plan, section 10, decision 9).
# all.sh asks once and exports MADAR_DEPLOY_CONFIRMED, so its steps do not ask again.
confirm_production() {
  [ "$TARGET" = production ] || return 0
  if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "Production deploys run from the Mac only (plan, section 10, decision 9). GitHub deploys only the test project." >&2
    exit 1
  fi
  [ "${MADAR_DEPLOY_CONFIRMED:-}" = production ] && return 0
  printf 'This changes the production project %s. Type production to go on: ' "$REF" >&2
  local word=''
  IFS= read -r word || true
  if [ "$word" != production ]; then
    echo "Stopped: the typed word was not production. Nothing changed." >&2
    exit 1
  fi
  export MADAR_DEPLOY_CONFIRMED=production
}

# The Supabase CLI on this Mac is signed in to another account (Halulu). Every Madar command uses the Madar token instead.
need_supabase_token() {
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "SUPABASE_ACCESS_TOKEN is not set. Load the Madar token first: set -a; . ~/dev/madar/.env.local; set +a" >&2
    exit 1
  fi
}

# The postgres password of the chosen project goes to the CLI as SUPABASE_DB_PASSWORD, never as an argument.
export_db_password() {
  local name=MADAR_TEST_DB_PASSWORD
  [ "$TARGET" = production ] && name=MADAR_DB_PASSWORD
  if [ -z "${!name:-}" ]; then
    echo "$name is not set: the postgres password of $TARGET." >&2
    exit 1
  fi
  export SUPABASE_DB_PASSWORD="${!name}"
}

supabase_cli() {
  "$BIN/supabase" "$@"
}

# A person at a terminal answers the CLI prompts. A run without a terminal (GitHub, a pipe) passes --yes, because the CLI would
# otherwise skip every change without an answer. Production has had its typed word by then.
yes_unless_terminal() {
  [ -t 0 ] || echo --yes
}

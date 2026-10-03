#!/usr/bin/env bash
# The fixed local values of the running Supabase stack, as NAME=value lines for $GITHUB_ENV (plan 6.3, task O1).
#
#   scripts/ci/stack-env.sh >> "$GITHUB_ENV"
#
# DATABASE_URL is the database address (the db-mode harness reads it) and SUPABASE_URL is the API address.
# With the Data API off (config.toml, [api] enabled = false) the status has no API address, but the gateway still serves
# Auth, Storage, Realtime and the functions. So SUPABASE_URL then comes from the [api] port of config.toml.
# The other names (ANON_KEY, SERVICE_ROLE_KEY, PUBLISHABLE_KEY, SECRET_KEY, JWT_SECRET and so on) keep the CLI's names.
# These are the public demo keys of the local stack, not secrets. The script fails, and prints nothing, when the
# status has no database address or the address is not on this machine.
set -euo pipefail

SUPABASE="${SUPABASE:-npx supabase}"
SUPABASE_CONFIG="${SUPABASE_CONFIG:-$(dirname "$0")/../../supabase/config.toml}"

# shellcheck disable=SC2086 # SUPABASE can be a command with an argument ("npx supabase").
raw="$($SUPABASE status -o env --override-name db.url=DATABASE_URL --override-name api.url=SUPABASE_URL)"
lines="$(printf '%s\n' "$raw" | sed -n -E 's/^([A-Z][A-Z0-9_]*)="?([^"]*)"?$/\1=\2/p')"

db_url="$(printf '%s\n' "$lines" | sed -n 's/^DATABASE_URL=//p')"
if [ -z "$db_url" ]; then
  echo "stack-env: supabase status gave no DATABASE_URL. Is the local stack running?" >&2
  exit 1
fi
case "$db_url" in
  *@127.0.0.1:* | *@localhost:*) ;;
  *)
    echo "stack-env: DATABASE_URL is not on this machine (127.0.0.1 or localhost), so the tests refuse it." >&2
    exit 1
    ;;
esac

if ! printf '%s\n' "$lines" | grep -q '^SUPABASE_URL='; then
  api_port="$(sed -n '/^\[api\]$/,/^\[/s/^port *= *\([0-9][0-9]*\).*/\1/p' "$SUPABASE_CONFIG" | head -n 1)"
  if [ -z "$api_port" ]; then
    echo "stack-env: supabase status gave no API address, and $SUPABASE_CONFIG has no [api] port." >&2
    exit 1
  fi
  lines="$lines"$'\n'"SUPABASE_URL=http://127.0.0.1:$api_port"
fi

printf '%s\n' "$lines"

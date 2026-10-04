#!/usr/bin/env bash
# scripts/deploy/config.sh <test|production>: the settings of supabase/config.toml into the project (plan 5.9): Auth, the OAuth
# server, the token hook and the function settings. config.toml holds the local values, so the [remotes.<env>] block of the
# project must replace them; scripts/deploy/config-check.ts refuses the push without it. Run db.sh first: the hook needs its function.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
confirm_production
need_supabase_token
cd "$ROOT"

node scripts/deploy/config-check.ts "$TARGET" "$REF"
supabase_cli config diff --project-ref "$REF"
supabase_cli config push --project-ref "$REF" $(yes_unless_terminal)
echo "Settings of $TARGET ($REF) are pushed."

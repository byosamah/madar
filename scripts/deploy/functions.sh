#!/usr/bin/env bash
# scripts/deploy/functions.sh <test|production>: the three functions api, mcp and jobs (plan 5.9). The server bundles are made
# here (npm run build:server) and bundled again on the Supabase servers (--use-api), so no Docker is needed.
# Then it asks api/health in Frankfurt: the URL carries forceFunctionRegion, like every function URL of the screens.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
confirm_production
need_supabase_token
cd "$ROOT"

npm run build:server
supabase_cli functions deploy api mcp jobs --project-ref "$REF" --use-api

health="$SUPABASE_URL/functions/v1/api/health?forceFunctionRegion=$FUNCTION_REGION"
answer=''
for attempt in 1 2 3 4 5 6; do
  answer="$(curl -fsS --max-time 20 "$health" 2>/dev/null || true)"
  case "$answer" in
    *"\"region\":\"$FUNCTION_REGION\""*)
      echo "api answers in $FUNCTION_REGION: $answer"
      exit 0
      ;;
  esac
  sleep 10
done
echo "The api function of $TARGET did not answer from $FUNCTION_REGION at $health. Last answer: ${answer:-none}" >&2
exit 1

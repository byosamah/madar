#!/usr/bin/env bash
# scripts/deploy/functions.sh <test|production> [--prebuilt]: the three functions api, mcp and jobs (plan 5.9). The server
# bundles are made here (npm run build:server) and bundled again on the Supabase servers (--use-api), so no Docker is needed.
# With --prebuilt it builds nothing and deploys the bundles of an earlier step, so the build and its dependency code never run
# with the access token (the Build step of deploy.yml).
# Then it asks api/health in Frankfurt: the URL carries forceFunctionRegion, like every function URL of the screens.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
prebuilt=''
case "${2:-}" in
  '') ;;
  --prebuilt) prebuilt=yes ;;
  *)
    echo "Usage: $(basename "$0") <test|production> [--prebuilt]" >&2
    exit 2
    ;;
esac
confirm_production
need_supabase_token
cd "$ROOT"

if [ -n "$prebuilt" ]; then
  for name in api mcp jobs; do
    if [ ! -s "supabase/functions/_build/$name.js" ]; then
      echo "supabase/functions/_build/$name.js is missing: run npm run build:server first. Nothing deployed." >&2
      exit 1
    fi
  done
else
  npm run build:server
fi
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

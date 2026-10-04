#!/usr/bin/env bash
# scripts/deploy/token-scope.sh: the first step of .github/workflows/deploy.yml (plan, section 10, decision 9). GitHub deploys only
# the test project, so its Supabase token must not reach production. This asks the Management API for the production project with
# SUPABASE_ACCESS_TOKEN and goes on only when the answer is 401, 403 or 404. Any other answer, a network failure too, stops the job.
# The token goes to curl on its standard input, never as an argument.
. "$(dirname "$0")/lib.sh"
need_supabase_token

code="$(printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_ACCESS_TOKEN" |
  curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -K - "https://api.supabase.com/v1/projects/$PRODUCTION_REF" 2>/dev/null || true)"
case "$code" in
  401 | 403 | 404)
    echo "The access token cannot read the production project (HTTP $code). Going on with the test project."
    exit 0
    ;;
esac
echo "Stopped: the access token reaches the production project $PRODUCTION_REF or the check failed (HTTP ${code:-none})." >&2
echo "GitHub may hold only a token that cannot reach production: a scoped token for madar-test, or a user of the madar-test organization only." >&2
exit 1

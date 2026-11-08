#!/usr/bin/env bash
# scripts/deploy/pages-platform.sh <test|production>: the site Madar enterprises on the Cloudflare Pages project madar-platform
# (design 12, D7). It builds dist-platform (npm run build:platform), compiles the one Pages Function of functions-platform into
# dist-platform/_worker.js, writes dist-platform/_routes.json (only /api/platform and the paths under it run the function), and uploads
# dist-platform: the branch preview for test, main for production. The headers file comes from the build (config/headers.platform).
# The project and its service bindings are an owner step (scripts/deploy/CLAUDE.md, "The platform site"). When the project does not
# exist yet, this script prints one clear line and ends with 0, so all.sh goes on. Wrangler signs in as pages.sh does.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
confirm_production
cd "$ROOT"

PROJECT=madar-platform
# The Madar Cloudflare account (accounts.md). Not a secret.
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-d76d34779c63849f5acdf3d6af3751cd}"

if ! listing="$("$BIN/wrangler" pages project list 2>&1)"; then
  echo "Stopped: wrangler could not list the Pages projects, so the platform site is not deployed. Sign in to wrangler and run it again." >&2
  exit 1
fi
if ! printf '%s\n' "$listing" | grep -Eq "(^|[^A-Za-z0-9-])$PROJECT([^A-Za-z0-9-]|\$)"; then
  echo "Skipped: the Pages project $PROJECT does not exist yet, so the platform site is not deployed. The owner makes the project and its service bindings first (scripts/deploy/CLAUDE.md, \"The platform site\")."
  exit 0
fi

npm run build:platform
"$BIN/wrangler" pages functions build functions-platform --outfile dist-platform/_worker.js
printf '{\n  "version": 1,\n  "include": ["/api/platform", "/api/platform/*"],\n  "exclude": []\n}\n' > dist-platform/_routes.json

branch=preview
[ "$TARGET" = production ] && branch=main
"$BIN/wrangler" pages deploy dist-platform --project-name "$PROJECT" --branch "$branch"

#!/usr/bin/env bash
# scripts/deploy/worker.sh <test|production> [--prebuilt]: the Worker of the copy (owner, 2026-10-16): madar-server-test or
# madar-server-production, from [env.<copy>] of wrangler.server.toml. It builds the server bundles (npm run build:server)
# unless --prebuilt says that an earlier step did (all.sh runs it after functions.sh), deploys with wrangler, and lists the
# deployments, so the new version shows. The Worker has no public address: scripts/deploy/checks.sh checks it through the page
# host after pages.sh. A copy whose Hyperdrive id is still the placeholder is skipped with a clear line.
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
cd "$ROOT"

worker="madar-server-$TARGET"
if [ -z "$(node scripts/deploy/wranglerServer.ts hyperdrive "$TARGET")" ]; then
  echo "Skip: [env.$TARGET] of wrangler.server.toml has no Hyperdrive id yet, so $worker is not deployed. Run npx tsx scripts/deploy/cloudflare-setup.ts --env $TARGET, put the id it prints into wrangler.server.toml, and commit."
  exit 0
fi
if [ -n "$prebuilt" ]; then
  if [ ! -s dist-server/worker.js ]; then
    echo "dist-server/worker.js is missing: run npm run build:server first. Nothing deployed." >&2
    exit 1
  fi
else
  npm run build:server
fi
# The Madar Cloudflare account (accounts.md). Not a secret.
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-d76d34779c63849f5acdf3d6af3751cd}"
# An office copy (config/server-host.json, exit wave 4): MADAR_DATA = office turns its office path on. wrangler.server.toml sets
# the var for no env, so the word stays the one switch. Bash 3.2 with set -u needs the guarded form of an empty array.
vars=()
if [ "$(node scripts/deploy/serverHost.ts host "$TARGET")" = office ]; then
  vars=(--var MADAR_DATA:office)
fi
"$BIN/wrangler" deploy -c wrangler.server.toml --env "$TARGET" ${vars[@]+"${vars[@]}"}
"$BIN/wrangler" deployments list -c wrangler.server.toml --env "$TARGET"
echo "$worker is deployed. secrets.ts sets its secrets (all.sh runs it before this step)."

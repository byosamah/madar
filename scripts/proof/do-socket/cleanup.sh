#!/usr/bin/env bash
# Turns off the workers.dev address of the probe, deploys again, and checks that the address gives 404.
P=/private/tmp/claude-501/-Users-osamakhalil-dev-madar/9b5e837d-c0a6-4378-88ad-ce5c0bb71639/scratchpad/do-socket
W=/Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test/node_modules/.bin/wrangler
export CLOUDFLARE_ACCOUNT_ID=d76d34779c63849f5acdf3d6af3751cd
cd "$P" || exit 1
perl -pi -e 's/^workers_dev = true/workers_dev = false/; s/workers_dev is true only while the probe measures/workers_dev was true only while the probe measured/' wrangler.toml
grep -n "workers_dev" wrangler.toml
$W deploy 2>&1 | grep -E "Uploaded|Deployed|workers.dev|Version|No deploy targets|error" 
sleep 8
for path in /state /ws /verify; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "x-probe-secret: $(cat keys/secret.txt)" "https://madar-socket-probe.vado-sa.workers.dev$path")
  echo "$path -> $code"
done

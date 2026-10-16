#!/usr/bin/env bash
P=/private/tmp/claude-501/-Users-osamakhalil-dev-madar/9b5e837d-c0a6-4378-88ad-ce5c0bb71639/scratchpad/do-socket
W=/Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test/node_modules/.bin/wrangler
export CLOUDFLARE_ACCOUNT_ID=d76d34779c63849f5acdf3d6af3751cd
cd "$P" || exit 1
$W tail madar-socket-probe --format json > tail-crypto.jsonl 2> tail-crypto.err &
TP=$!
sleep 12
date -u +"start %H:%M:%S" > crypto-run.txt
GAP_MS=1200 node crypto.mjs >> crypto-run.txt 2>&1
sleep 12
kill $TP
date -u +"end %H:%M:%S" >> crypto-run.txt

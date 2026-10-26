#!/bin/zsh
# Read-only probe of a Daftra account (the Daftra study, proof.md, 2026-10-26).
# It sends GET only and never prints the key. The key reads and writes the whole account, so never add a write here.
# Usage: scripts/proof/daftra-read.sh <path with query> <out file>
#   for example: scripts/proof/daftra-read.sh '/invoices.json?limit=5' "$TMPDIR/inv.json"
# Keys: DAFTRA_MAZJ_KEY and DAFTRA_MAZJ_SITE (for example mazj.daftra.com) in .env.local.
set -u
cd "$(git rev-parse --show-toplevel)"
set -a; . ./.env.local; set +a
site="${DAFTRA_MAZJ_SITE#https://}"; site="${site%/}"
result=$(curl -sS -m 60 -X GET -o "$2" -w '%{http_code} %{time_total}s' \
  -H "apikey: ${DAFTRA_MAZJ_KEY}" -H 'Accept: application/json' \
  "https://${site}/api2$1")
echo "GET $1 -> $result, $(wc -c < "$2" | tr -d ' ') bytes"

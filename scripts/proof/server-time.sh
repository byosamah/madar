#!/usr/bin/env bash
# scripts/proof/server-time.sh <rounds>: the time of one server call on the test copy, on the Supabase api function and on the
# page's own /api (the Worker once config/server-host.json says workers for test). Owner rule (2026-10-16): the Worker stays
# only if it measures faster. Run it from the Mac with the sandbox off. The logic and its tests: scripts/proof/server-time.ts.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --import tsx scripts/proof/server-time.ts "${1:-20}"

#!/usr/bin/env bash
# scripts/deploy/all.sh <test|production>: every deploy step in order (plan 5.9): migrations, settings, secrets, functions, the
# Worker, screens, then the quick checks through the page host (owner, 2026-10-16). A copy whose host word is office (exit
# wave 4) runs only the Worker secrets, the Worker, the screens and the checks.
# Production runs only from the Mac, and only after the typed word production (plan, section 10, decision 9). It asks once,
# before any step, and the steps do not ask again. A MADAR_DEPLOY_CONFIRMED from the shell never counts here: only the typed word.
# Production also takes only the commit that the last full all.sh test put on the test copy (lib.sh, require_tested_commit).
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
unset MADAR_DEPLOY_CONFIRMED
confirm_production
DIR="$ROOT/scripts/deploy"

# Test: note the commit now, and forget the old record until the last step ends (lib.sh, record_test_commit).
TESTED=''
if [ "$TARGET" = test ]; then
  TESTED="$(clean_head)"
  forget_test_record
fi

# The host word of the copy (config/server-host.json). serverHost.ts takes its path from the root.
cd "$ROOT"
host="$(node scripts/deploy/serverHost.ts host "$TARGET")"
if [ "$host" = office ]; then
  # An office copy (exit wave 4): wrangler only. The Supabase project of the copy keeps its last state: it is the way back.
  echo "The $TARGET copy runs on its office object: db.sh, config.sh and functions.sh stay out."
  "$BIN/tsx" "$DIR/secrets.ts" "$TARGET" --office
  "$DIR/worker.sh" "$TARGET"
else
  "$DIR/db.sh" "$TARGET"
  "$DIR/config.sh" "$TARGET"
  "$BIN/tsx" "$DIR/secrets.ts" "$TARGET"
  "$DIR/functions.sh" "$TARGET"
  # The Worker of the copy (owner, 2026-10-16) gets the same code as the functions in every run, so the way back always holds it.
  "$DIR/worker.sh" "$TARGET" --prebuilt
fi
"$DIR/pages.sh" "$TARGET"
"$DIR/checks.sh" "$TARGET"
if [ "$TARGET" = test ]; then
  record_test_commit "$TESTED"
fi
echo "All steps of $TARGET ($REF) are done."

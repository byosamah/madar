#!/usr/bin/env bash
# scripts/deploy/all.sh <test|production>: every deploy step in order (plan 5.9): migrations, settings, secrets, functions, screens.
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

"$DIR/db.sh" "$TARGET"
"$DIR/config.sh" "$TARGET"
"$BIN/tsx" "$DIR/secrets.ts" "$TARGET"
"$DIR/functions.sh" "$TARGET"
"$DIR/pages.sh" "$TARGET"
if [ "$TARGET" = test ]; then
  record_test_commit "$TESTED"
fi
echo "All steps of $TARGET ($REF) are done."

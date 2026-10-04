#!/usr/bin/env bash
# scripts/deploy/all.sh <test|production>: every deploy step in order (plan 5.9): migrations, settings, secrets, functions, screens.
# Production runs only from the Mac, and only after the typed word production (plan, section 10, decision 9). It asks once,
# before any step, and the steps do not ask again.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
confirm_production
DIR="$ROOT/scripts/deploy"

"$DIR/db.sh" "$TARGET"
"$DIR/config.sh" "$TARGET"
"$BIN/tsx" "$DIR/secrets.ts" "$TARGET"
"$DIR/functions.sh" "$TARGET"
"$DIR/pages.sh" "$TARGET"
echo "All steps of $TARGET ($REF) are done."

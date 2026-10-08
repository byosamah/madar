#!/usr/bin/env bash
# scripts/deploy/pages.sh <test|production>: the real screens on Cloudflare Pages (plan 5.9).
# It builds with the public values of config/remote.<env>.env, writes dist/_headers from config/headers.template with the hosts
# of that environment only (scripts/deploy/headers.ts), and uploads dist to the Pages project madar: the branch preview for
# test, main for production. Wrangler signs in with CLOUDFLARE_API_TOKEN, or with `wrangler login` on the Mac.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
confirm_production
cd "$ROOT"

if ! grep -Eq '^VITE_SUPABASE_PUBLISHABLE_KEY=.+' "config/remote.$TARGET.env"; then
  echo "config/remote.$TARGET.env has no VITE_SUPABASE_PUBLISHABLE_KEY, so the screens could not sign in. Nothing deployed." >&2
  exit 1
fi
# Browser push (owner, 2026-10-08): the screens need the public VAPID key to subscribe. Without it the Settings row says that push is
# not set up. This is a warning, not a stop: the rest of the screens work.
if ! grep -Eq '^VITE_VAPID_PUBLIC_KEY=.+' "config/remote.$TARGET.env"; then
  echo "config/remote.$TARGET.env has no VITE_VAPID_PUBLIC_KEY, so browser push shows as not set up. Run: npx tsx scripts/push/make-vapid.ts $TARGET" >&2
fi
npm run build:remote -- "$TARGET"
node scripts/deploy/headers.ts "$TARGET" dist/_headers

branch=preview
[ "$TARGET" = production ] && branch=main
# The Madar Cloudflare account (accounts.md). Not a secret.
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-d76d34779c63849f5acdf3d6af3751cd}"
"$BIN/wrangler" pages deploy dist --project-name madar --branch "$branch"

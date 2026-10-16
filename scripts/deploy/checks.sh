#!/usr/bin/env bash
# scripts/deploy/checks.sh <test|production>: the quick checks after a deploy (owner, 2026-10-16), through the page host of the
# copy, the address that the screens and the agents use. They only read, so production needs no typed word here.
#   1. GET <page>/api/health gives 200, and x-madar-server names the host of config/server-host.json: workers;colo=<data center>
#      or supabase. Up to 6 tries, 10 s apart, while the new Pages deploy settles.
#   2. With JOBS_SECRET in secrets/<env>.env: the same GET with x-madar-jobs-secret (curl reads it from stdin with -K -, never
#      from an argument) gives database, lock and asyncContext ok: the database path, TLS, the transaction lock, AsyncLocalStorage.
#   3. POST <page>/mcp with no token gives 401, with x-madar-server of the same host.
. "$(dirname "$0")/lib.sh"
deploy_target "${1:-}"
cd "$ROOT"

host="$(node scripts/deploy/serverHost.ts host "$TARGET")"
page="$(node scripts/deploy/serverHost.ts page "$TARGET")"

# The status, one header and the body of a `curl -i` answer.
status_of() { printf '%s\n' "$1" | tr -d '\r' | head -n 1 | awk '{print $2}'; }
header_of() { printf '%s\n' "$1" | tr -d '\r' | sed -n '1,/^$/p' | grep -i "^$2:" | head -n 1 | sed 's/^[^:]*:[[:space:]]*//'; }
body_of() { printf '%s\n' "$1" | tr -d '\r' | sed '1,/^$/d'; }
# True when the header names the host of the setting.
names_host() {
  case "$host:$1" in
    workers:workers\;colo=*) return 0 ;;
    supabase:supabase) return 0 ;;
  esac
  return 1
}

answer=''
server=''
for attempt in 1 2 3 4 5 6; do
  answer="$(curl -sS --max-time 20 -i "$page/api/health" 2>/dev/null || true)"
  server="$(header_of "$answer" x-madar-server)"
  if [ "$(status_of "$answer")" = 200 ] && names_host "$server"; then
    break
  fi
  if [ "$attempt" = 6 ]; then
    echo "Stopped: $page/api/health did not answer 200 from the host $host of config/server-host.json. Status: $(status_of "$answer"), x-madar-server: ${server:-none}." >&2
    exit 1
  fi
  sleep 10
done
echo "Health: $page/api/health answers from $server. $(body_of "$answer")"
placement="$(header_of "$answer" cf-placement)"
if [ -n "$placement" ]; then
  echo "cf-placement: $placement"
fi
if [ "$server" = 'workers;colo=unknown' ]; then
  echo "Note: the Worker saw no data center (colo=unknown) through the service binding. The cf-placement header names the run place." >&2
fi

file="secrets/$TARGET.env"
if [ -f "$file" ] && grep -q '^JOBS_SECRET=.' "$file"; then
  # node reads the secret inside its own process and writes one curl config line; curl reads it on stdin (-K -).
  checked="$(node -e '
    const text = require("fs").readFileSync(process.argv[1], "utf8");
    const value = /^JOBS_SECRET=(.*)$/m.exec(text)[1].trim().replace(/^(["\x27])(.*)\1$/, "$2");
    process.stdout.write(`header = "x-madar-jobs-secret: ${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"\n`);
  ' "$file" | curl -sS --max-time 20 -K - "$page/api/health" 2>/dev/null || true)"
  case "$checked" in
    *'"database":"ok"'*'"lock":"ok"'*'"asyncContext":"ok"'*) echo "Database check: database, lock and asyncContext ok." ;;
    *)
      echo "Stopped: the health check with the jobs secret did not give database, lock and asyncContext ok on $page." >&2
      exit 1
      ;;
  esac
else
  echo "Skip: $file has no JOBS_SECRET, so the database check did not run."
fi

mcp="$(curl -sS --max-time 20 -i -X POST -H 'Content-Type: application/json' --data '{}' "$page/mcp" 2>/dev/null || true)"
mcp_server="$(header_of "$mcp" x-madar-server)"
if [ "$(status_of "$mcp")" != 401 ] || ! names_host "$mcp_server"; then
  echo "Stopped: POST $page/mcp with no token must give 401 from the host $host. Status: $(status_of "$mcp"), x-madar-server: ${mcp_server:-none}." >&2
  exit 1
fi
echo "MCP: POST $page/mcp with no token gives 401 from $mcp_server."
echo "The quick checks of $TARGET passed on the host $host."

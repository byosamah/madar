#!/usr/bin/env bash
# One local Supabase stack at a time (plan, section 2b, point 6).
# The lock is a folder: mkdir is atomic, so only one task gets it. The folder holds a "holder" file with the task and the time.
#
#   scripts/dev/docker-lock.sh run <holder> -- <command...>   take the lock, run the command, release on exit (also on failure)
#   scripts/dev/docker-lock.sh acquire <holder>               take the lock and keep it (for work across several shells)
#   scripts/dev/docker-lock.sh release <holder>               release a lock that this holder took with acquire
#   scripts/dev/docker-lock.sh status                         tell who holds the lock
#
# A task waits for the lock, and gives up after 30 minutes with the name of the holder.
# Every Docker task: take the lock, run "supabase db reset" from its own worktree, do its work, release the lock. Never run two stacks.
set -euo pipefail

LOCK="${MADAR_DOCKER_LOCK:-/tmp/madar-docker.lock}"
WAIT_SECONDS="${MADAR_DOCKER_LOCK_WAIT_SECONDS:-1800}"
POLL_SECONDS="${MADAR_DOCKER_LOCK_POLL_SECONDS:-5}"

usage() {
  sed -n '2,12p' "$0" >&2
  exit 2
}

holder_of() {
  cat "$LOCK/holder" 2>/dev/null || echo "holder=unknown"
}

acquire() {
  local who="$1" waited=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      echo "docker-lock: gave up after ${WAIT_SECONDS}s. The lock is held by: $(holder_of | tr '\n' ' ')" >&2
      echo "docker-lock: if that holder is gone, run: $0 release <holder>" >&2
      exit 1
    fi
    if [ "$waited" -eq 0 ]; then echo "docker-lock: waiting for $(holder_of | tr '\n' ' ')" >&2; fi
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS))
  done
  printf 'holder=%s\nsince=%s\npid=%s\nworktree=%s\n' "$who" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$PWD" > "$LOCK/holder"
}

release() {
  local who="$1"
  if [ ! -d "$LOCK" ]; then return 0; fi
  if ! grep -qx "holder=$who" "$LOCK/holder" 2>/dev/null; then
    echo "docker-lock: the lock is not held by $who. It is held by: $(holder_of | tr '\n' ' ')" >&2
    exit 1
  fi
  rm -rf "$LOCK"
}

[ $# -ge 1 ] || usage
case "$1" in
  run)
    [ $# -ge 4 ] && [ "$3" = "--" ] || usage
    who="$2"
    shift 3
    acquire "$who"
    trap 'rm -rf "$LOCK"' EXIT INT TERM
    set +e
    "$@"
    code=$?
    set -e
    exit "$code"
    ;;
  acquire)
    [ $# -eq 2 ] || usage
    acquire "$2"
    echo "docker-lock: held by $2"
    ;;
  release)
    [ $# -eq 2 ] || usage
    release "$2"
    echo "docker-lock: released by $2"
    ;;
  status)
    if [ -d "$LOCK" ]; then holder_of; else echo "free"; fi
    ;;
  *)
    usage
    ;;
esac

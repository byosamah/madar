#!/usr/bin/env bash
# One local Supabase stack at a time (plan, section 2b, point 6).
# The lock is a folder: mkdir is atomic, so only one task gets it. The folder holds a "holder" file with the task, the mode and the time.
#
#   scripts/dev/docker-lock.sh run <holder> -- <command...>   take the lock, run the command, release on exit (also on failure)
#   scripts/dev/docker-lock.sh acquire <holder>               take the lock and keep it (for work across several shells)
#   scripts/dev/docker-lock.sh release <holder>               release a lock that this holder took with acquire
#   scripts/dev/docker-lock.sh status                         tell who holds the lock
#
# A task waits for the lock, and gives up after 30 minutes with the name of the holder.
# A stale lock does not block: a "run" lock whose process is dead, or an "acquire" lock older than its longest hold (3 hours).
# Every Docker task: take the lock, run "supabase db reset" from its own worktree, do its work, release the lock. Never run two stacks.
set -euo pipefail

# heavy-lock.sh runs this script for its own lock (one heavy test run at a time, owner 2026-10-20) with MADAR_LOCK_PATH,
# MADAR_LOCK_WAIT_SECONDS and MADAR_LOCK_LABEL. They belong to that one lock: the script unsets them, so a command under it may take the other lock.
LOCK="${MADAR_LOCK_PATH:-${MADAR_DOCKER_LOCK:-/tmp/madar-docker.lock}}"
WAIT_SECONDS="${MADAR_LOCK_WAIT_SECONDS:-${MADAR_DOCKER_LOCK_WAIT_SECONDS:-1800}}"
LABEL="${MADAR_LOCK_LABEL:-docker-lock}"
unset MADAR_LOCK_PATH MADAR_LOCK_WAIT_SECONDS MADAR_LOCK_LABEL
POLL_SECONDS="${MADAR_DOCKER_LOCK_POLL_SECONDS:-5}"
MAX_HOLD_SECONDS="${MADAR_DOCKER_LOCK_MAX_HOLD_SECONDS:-10800}"
# A lock folder with no holder file this long after it was made is stale (the holder died between mkdir and the write).
NO_HOLDER_SECONDS=60

usage() {
  sed -n '2,13p' "$0" >&2
  exit 2
}

holder_of() {
  cat "$LOCK/holder" 2>/dev/null || echo "holder=unknown"
}

# The value of one field of a holder text.
field() {
  printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n 1
}

# The age of a path in seconds (macOS stat first, then GNU stat).
age_of() {
  local made
  made="$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || date +%s)"
  echo $(($(date +%s) - made))
}

# Prints why the lock with this holder text is stale, or nothing when its holder may still work.
stale_reason() {
  local text="$1" mode pid since max
  if [ -z "$text" ]; then
    if [ -d "$LOCK" ] && [ "$(age_of "$LOCK")" -ge "$NO_HOLDER_SECONDS" ]; then echo "it has no holder file after ${NO_HOLDER_SECONDS}s"; fi
    return 0
  fi
  mode="$(field "$text" mode)"
  pid="$(field "$text" pid)"
  if [ "$mode" = "run" ] && [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "its process $pid is dead"
    return 0
  fi
  if [ "$mode" = "acquire" ]; then
    since="$(field "$text" since_epoch)"
    max="$(field "$text" max_hold)"
    max="${max:-$MAX_HOLD_SECONDS}"
    if [ -n "$since" ] && [ $(($(date +%s) - since)) -ge "$max" ]; then echo "it is older than its longest hold of ${max}s"; fi
  fi
}

# Breaks the lock when its holder is stale. The folder moves away in one step, so two waiters never both break it.
break_if_stale() {
  local text reason moved
  text="$(cat "$LOCK/holder" 2>/dev/null || true)"
  reason="$(stale_reason "$text")"
  [ -n "$reason" ] || return 0
  moved="$LOCK.stale.$$"
  mv "$LOCK" "$moved" 2>/dev/null || return 0
  if [ "$(cat "$moved/holder" 2>/dev/null || true)" != "$text" ]; then
    # Another waiter broke the stale lock and took a new one between the read and the move: give it back.
    if [ ! -e "$LOCK" ]; then mv "$moved" "$LOCK" 2>/dev/null || true; fi
    return 0
  fi
  rm -rf "$moved"
  echo "$LABEL: broke a stale lock ($reason). It was held by: $(printf '%s' "$text" | tr '\n' ' ')" >&2
}

acquire() {
  local who="$1" mode="$2" waited=0 err
  while true; do
    if err="$(mkdir "$LOCK" 2>&1)"; then break; fi
    if [ ! -e "$LOCK" ]; then
      # The holder may have released between the two steps, so try once more before we stop.
      if err="$(mkdir "$LOCK" 2>&1)"; then break; fi
      if [ ! -e "$LOCK" ]; then
        echo "$LABEL: cannot make the lock folder $LOCK: $err" >&2
        exit 1
      fi
    fi
    break_if_stale
    if [ ! -e "$LOCK" ]; then continue; fi
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      echo "$LABEL: gave up after ${WAIT_SECONDS}s. The lock is held by: $(holder_of | tr '\n' ' ')" >&2
      echo "$LABEL: if that holder is gone, run: $0 release <holder>" >&2
      exit 1
    fi
    if [ "$waited" -eq 0 ]; then echo "$LABEL: waiting for $(holder_of | tr '\n' ' ')" >&2; fi
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS))
  done
  {
    printf 'holder=%s\nmode=%s\nsince=%s\nsince_epoch=%s\n' "$who" "$mode" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%s)"
    if [ "$mode" = "run" ]; then printf 'pid=%s\n' "$$"; else printf 'max_hold=%s\n' "$MAX_HOLD_SECONDS"; fi
    printf 'worktree=%s\n' "$PWD"
  } > "$LOCK/holder"
}

release() {
  local who="$1"
  if [ ! -d "$LOCK" ]; then return 0; fi
  if ! grep -qx "holder=$who" "$LOCK/holder" 2>/dev/null; then
    echo "$LABEL: the lock is not held by $who. It is held by: $(holder_of | tr '\n' ' ')" >&2
    exit 1
  fi
  rm -rf "$LOCK"
}

# The exit step of "run": it removes the lock only while this run still holds it, never the lock of a later holder.
release_own_run() {
  if grep -qx "pid=$$" "$LOCK/holder" 2>/dev/null && grep -qx "mode=run" "$LOCK/holder" 2>/dev/null; then rm -rf "$LOCK"; fi
}

[ $# -ge 1 ] || usage
case "$1" in
  run)
    [ $# -ge 4 ] && [ "$3" = "--" ] || usage
    who="$2"
    shift 3
    acquire "$who" run
    trap release_own_run EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    set +e
    "$@"
    code=$?
    set -e
    exit "$code"
    ;;
  acquire)
    [ $# -eq 2 ] || usage
    acquire "$2" acquire
    echo "$LABEL: held by $2"
    ;;
  release)
    [ $# -eq 2 ] || usage
    release "$2"
    echo "$LABEL: released by $2"
    ;;
  status)
    if [ -d "$LOCK" ]; then holder_of; else echo "free"; fi
    ;;
  *)
    usage
    ;;
esac

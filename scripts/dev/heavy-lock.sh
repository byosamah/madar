#!/usr/bin/env bash
# One heavy test run at a time on this Mac (owner, 2026-10-20). npm test, test:server, test:db, test:lite, test:office, test:it, test:mcp
# and the prototype smoke (npm run smoke) take this lock by themselves (package.json). Two or three full runs of other sessions at once
# filled the 16 GB of memory, the load reached 190 on 10 cores, and tests failed on their time limits.
# The commands and the stale rules are those of docker-lock.sh, with its own lock folder. A run waits for the run before it, for up to
# 60 minutes. The Docker lock stays separate: a Docker task takes both locks, the Docker lock first.
#
#   scripts/dev/heavy-lock.sh run <holder> -- <command...>
#   scripts/dev/heavy-lock.sh status
set -euo pipefail
export MADAR_LOCK_PATH="${MADAR_HEAVY_LOCK:-/tmp/madar-heavy.lock}"
export MADAR_LOCK_WAIT_SECONDS="${MADAR_HEAVY_LOCK_WAIT_SECONDS:-3600}"
export MADAR_LOCK_LABEL=heavy-lock
exec bash "$(dirname "$0")/docker-lock.sh" "$@"

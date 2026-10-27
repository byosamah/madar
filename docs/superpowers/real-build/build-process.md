# Build process lore

The long rules of the build process that the root `CLAUDE.md` keeps short. Read this file before you run a Workflow of
builders, join branches, or merge a track. It is a reference, not a guide: no session loads it by itself.

## Worktrees and Workflow agents
- Agent tool worktrees live in `.claude/worktrees/agent-*` (Workflow agents: `wf_<run>-<n>`, branch `worktree-wf_<run>-<n>`)
  and may start on an old commit: brief each agent to run `git merge --ff-only <batch branch>` first. Removal:
  `git worktree remove --force`, `git worktree prune`, then `git branch -d` its branch and its `worktree-agent-*` branch
  (sandbox off). Before `git worktree remove`, run `rm <worktree>/node_modules` (it removes the link only): a clean worktree
  then goes without `--force`.
- A helper that a subagent starts reports to the main session, not to that subagent: forward what the subagent needs.
- Start a browser-check agent without `name`: named agents became teammates that handed the work to a sub-agent, and several
  reports ended with "no report". Ask for the report in the final message. The system may refuse a report file from a subagent.
- The Playwright MCP saves only inside the repo, so a `cd` does not help: brief each agent to `mv` every shot into the scratchpad.
- Ask each builder to write its report to a file in its worktree before it returns it, so a dropped last call loses nothing.
- A builder that sends the same report again ("waiting on its own background work") after its work is merged: stop it with
  `TaskStop`.
- A Workflow agent that stopped (an API error) keeps its commits, but SendMessage cannot resume it, and a re-run starts it
  again from its brief. Start a finisher in the same worktree with the commit list and the transcript
  (`subagents/workflows/<run>/agent-*.jsonl`; `agent-*.meta.json` names the label).
- A usage limit stops every running agent at once. Give each finisher a tail of the transcript (the last 70 text and tool
  steps of `agent-*.jsonl`, cut by a script) and `git status` of its worktree. A Docker lock of a stopped agent is stale after
  its 3-hour hold: the finisher takes it again under the same holder name.
- A build Workflow stopped with `TaskStop` (a design change mid-build) leaves its running agent's edits uncommitted: commit them
  as WIP in the worktree, edit the script, and resume with `resumeFromRunId`, so the finished agents come from the cache.
- A Workflow `scriptPath` must be inside the repo (a path in /tmp is refused): keep it untracked in the worktree, delete it after.
- Brief parallel builders to run their test files with `--no-file-parallelism --testTimeout=60000`.
- A background security review of a builder's commit goes back to that builder with a test-first fix; the lead does not patch it
  beside the builder.

## Branches, joins and merges
- `git branch -d` tests against the HEAD of the folder where it runs. The main folder is detached, so it refused merged branches.
  Run it from `deploy-test` (HEAD = main), or check `git merge-base --is-ancestor <branch> main` and use `-D`.
- When no folder holds main, check it out in a clean worktree (`git switch main`) and `git merge --ff-only <branch>` there.
  `git update-ref refs/heads/main` was refused by the auto-mode check as Git Destructive (2026-10-20).
- Before you move main or run `all.sh`, tell the peer sessions (ListAgents, SendMessage) and send "released" after: two releases
  on one main and one test copy break each other (2026-10-21). ListAgents does not name the branch of a session; ask by branch name.
- Before you fast-forward main, message the release lead (the session in `deploy-test`, found with `ListAgents`), and hold a full
  `npm test` while its gates run: two full runs at once make screen tests time out (2026-10-25).
- Session names change while they run (madar-87 became daftra, 2026-10-26): when SendMessage says a name is not reachable, run
  ListAgents again.
- Parallel waves on one rule: the first builder makes a checkpoint commit of the core (rule, data, rights) that it never rewrites;
  the next wave branches from it. A wave that changes another batch's files starts from that batch's branch plus the
  cherry-picked core (2026-10-22).
- A join picks one commit at a time (`git -c merge.conflictStyle=diff3 cherry-pick <hash>`) and reads each pinned count from a
  failing run, never by adding deltas.
- A branch that holds track merges takes main with `git merge main`: `git rebase main` replays every track commit and its
  conflicts (2026-10-21).
- At a merge, read `git diff --stat main...<track> -- '*CLAUDE.md'`: a builder cut 66 lines of `server/mcp/CLAUDE.md` while it
  added its own (2026-10-21).
- Take the next What's new id at the merge, not in the build: parallel sessions took the same id twice (2026-10-21).

## Dev tips
- The MCP cannot read file contents. To study the files of a project (a tile shape, a review), open madar.vado.sa in the
  owner's Chrome: Files & Links, the file menu, Preview. A large PDF preview fills the window when JS sets its dialog and
  iframe to `position: fixed; inset: 0` (the browser tool blocks signed links in its output).
- Drawing checks on this Mac: `qlmanage -t -s 400 -o <dir> <file.svg>` renders an SVG to PNG, PIL is installed, shapely is not.
  For exact shape geometry (unions, holes), use paper.js from cdnjs in a local page served on 127.0.0.1 and read the paths with
  the Chrome JS tool.
- The run that worked on the local stack (2026-10-08, again 2026-10-12): `docker-lock.sh acquire <holder>`,
  `npx supabase start -x edge-runtime`, `npx supabase db reset`, `npm run test:db`, `npm run test:it`, `npm run test:mcp`,
  `npx supabase stop`, `docker-lock.sh release <holder>`.
- Why the heavy lock exists (2026-10-20): two or three full runs of other sessions at once filled the 16 GB of memory, the load
  reached 190 on 10 cores, and tests failed on their time limits.

## The Z steps (plan Track Z, status of 2026-10-27)
Z0a, Z0b, Z1 done; Z2 R2 done (2026-10-16); Z3 sender vado.sa; Z4 Pages and madar.vado.sa done; Z5 database backups run
nightly, the file backup is paused (R2 alone, no Backblaze B2: `.github/CLAUDE.md`); Z6 seed done; Z7 security review; Z8 first
Admin done, then a 2-week pilot.

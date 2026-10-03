# Madar redesign tasks

Spec: docs/superpowers/specs/2026-10-01-madar-calm-redesign-design.md. Plans 1 to 5 are done.

## Step A

- [x] 1. Tokens and project colors
- [x] 2. Gentle due words
- [x] 3. Calm shared parts
- [x] 4. The tab pill, the person menu and the routes
- [x] 5. The Projects list
- [x] 6. Home
- [x] 7. A calm project header and the About panel
- [x] 8. Calm task rows and one filter button

## Step B

- [x] Solid panels for sheets, popovers, menus, toasts; Glass setting removed
- [x] Dashboard: filter button, three numbers, Projects / People / Schedule
- [x] Calm colors for schedules, board, workload
- [x] Inbox, Search, Settings restyle; one main button per screen
- [x] Focus mode with the 25-minute timer
- [x] The 8 motion moments and the screen entrance
- [ ] Browser sweep (agent running)
- [ ] Independent review and fix pass (agent running)
- [ ] Guide and report (agent running)
- [ ] Review link, merge to main, memory

## Full product audit (2026-10-03)

- [x] Decisions filter in the Activity tab (main 77d087a, v42)
- [x] Language-turn fix: page stayed hidden after leaving Settings mid-turn
- [x] Five code auditors done: api 21, project 25, shell 23, dashboard 17, personal 19 findings
- [x] Browser auditor: 20 findings (BRW), all assigned
- [x] Personal fixes PER-1..19 (branch audit-fixes, 540a094)
- [x] Parallel fixers done: api 27+, project 28, shell 29, dashboard 19 (+ my PER 19, BRW-9, BRW-16)
- [x] All branches merged into audit-fixes with no conflicts; 1424 tests pass; build passes
- [x] Security hardening of the story Undo relief (e97dbeb)
- [x] Verification workflow: 123/132 verified, 6 partial (owner questions), ~38 new issues (1 HIGH Ctrl+Z after Done)
- [x] Fix wave 2: 38/38 fixed; 9 review findings repaired (A, B, C); merged (f97eddd); 1489 tests pass twice; STATE_VERSION 8
- [x] Wave 3: Balady box, turn-off warning, S-1..S-4, group D review (2 repaired); merged 8658de6; 1567 tests pass twice
- [x] Final browser check: 272 screens, 0 console errors, 23 confirmed problems (1 HIGH: Escape loses typed task text)
- [x] Wave 4: 23/23 fixed, 7 review findings repaired; merged (one board conflict resolved by hand); 1630 tests pass twice
- [x] Targeted re-check: 22/23 at once, F-2 (Arabic phone tab bar) fixed after and measured at 320-412 px
- [x] Audit record in docs/reviews/2026-10-03-full-audit; merged into main 773a240; 1630 tests; published v43
- [x] Cleanup: the owner approved on 2026-10-03; removed the 17 merged temporary worktrees
- [ ] Screenshots of changed screens (EN/AR)
- [x] Owner answered (2026-10-03): Balady box back; warn then allow on turn-off; one meeting per tab; Inbox count keeps task threads
- [x] Built in wave 3: Balady tick box (API-14), turn-off warning (API-7); screenshots checked
- [ ] Full suite, merge to main, publish, memory

## 2026-10-03: /simplify and /code-review of the audit merge

- [x] 4 cleanup reviewers (reuse, simpler code, wasted work, fix depth); about 35 cleanups applied in 3 commits (b967a44 server, 35f9b9c shared parts, 475f448 screens)
- [x] Code review: 6 bugs fixed with tests (ae56352): story Undo after a single Undo, Tracker Close ends the wait like Edit, owner pull-back for a reviewer-owner, task panel save only as the same person and for a live task, date field resend after a refusal, save before the file-data delete; plus Ctrl+Z on a tick box (35f9b9c) and the meeting reply picker leaves out inactive people (475f448)
- [x] Prototype v44 published; 1,640 tests pass
- [ ] Skipped on purpose (need a contract change or a browser-checked layout change): holdsAdminRights mirror in PeopleSection, leaders list from projects.list status all, one dashboard.get for the schedule status, one ResizeObserver for the office schedule, session.get per task row, toast.undo/toast.failed API, one focus-return hook for both sheet modes, Escape ownership, DateReason draft effect, TasksTab sendBack reset effect
- [ ] Skipped review items: the direct currentStageId write in watchStage (needs a check of every path that moves the tag), settleFuture on a real office (prototype only)

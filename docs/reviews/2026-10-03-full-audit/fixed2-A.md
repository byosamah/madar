# Fix wave 2, group A (API and data): report

Worktree: /Users/osamakhalil/dev/madar-w2-api, branch w2-api, last commit 050df3e.

## Items

V-2 | fixed | 9e6f2b4 | Each task.reopened and task.dates_shifted event now records its cause (causeEventId), and a story Undo relieves a follow-on change only when its cause is a change of the same story that the same call takes back, so the forged-story path is refused and the reopens that an Undo writes are never relieved.
V-3 | fixed | bab3658 | A date note keeps the due day it was made for (forDueDate), and shiftPlan subtracts an earlier move only for the same due day, so a late version 2 with a new due day moves the dependent by its full lateness, in the real shift and in the meeting preview alike.
V-13 | fixed | 59100ad | A tracker.update that ends the wait now unlinks a reply task that cannot finish yet (both ways) and leaves it open with no error; the Tracker posting right may undo the unlink, and Close keeps its API-9 refusal.
V-17 | fixed | 3ba7bdb | Area in design now treats a project as out of design when its tag is the last stage of its own stage list (time order), so a rename of the office default stage and a project-only name such as "Site supervision" no longer count as design.
V-21 | fixed | 3f1ee2a | settle walks the story's stage moves newest first as a chain (a move comes back while the saved stage is still where it put the project and the tag is not there), so the health override comes back after two moves in one story.
V-37a | fixed | bf7ae24 | tasks.list and deadlines.list take an optional teamId (the Dashboard rule), and the Task list screen reads team from the link in both modes and names the team in the subtitle.
V-4a | fixed | 050df3e | Each member of projects.get now carries a required active flag.

Counts: 7 fixed, 0 not a bug, 0 skipped.

## Notes for the controller

- V-37a: I also gave deadlines.list the teamId, because the Dashboard Deadlines row opens this screen in deadlines mode. Without it, the team on that link (Group D, V-37b) would change nothing.
- V-13: entry.replyTaskId is now nullable in the contract (TaskId.nullable().optional()), so the unlink can be undone.
- V-2: Event gets an optional causeEventId. Events saved before this change have none, so a member's story Undo of such an old story gets no relief. Undo toasts live 5 seconds, so this has no effect in practice.
- V-17: the insights test world now gives prj_001 a third stage (Supervision), so its Schematic Design is not its last stage.
- Full suite under machine load (load average 50 to 128): 1438 of 1439 passed with 4 workers. The one failure was the first test of src/features/project/tasks/TaskFeatures.test.tsx, which timed out on first render. That file passed alone 3 times (14 of 14). tsc and check-rtl pass.

## Questions for the owner

1. V-17: a project counts as "on site" when its tag is the last stage of its own list. A design-only project whose last stage is, for example, Construction Documents, leaves Area in design while it is still in that last stage. Is that right, or should a stage carry its own "site" mark (owner question 3 from DSH-16)?
2. V-13: when the client withdraws a question, the reply task stays open on the person's list, with no link to the entry. Should Madar tell the person (a notice or a comment on the task), or is the open task enough?

## Screens that changed

- /tasks?filter=overdue&team=tm_003 : the subtitle says "Team: Interiors" (Arabic "فريق المكتب: Interiors"), and the list holds only the past-due tasks of that team's projects (the same count as the Dashboard tile with Team Interiors).
- /tasks?mode=deadlines&from=2026-09-30&to=2026-10-14&team=tm_003 : the subtitle starts with the team, and the list holds only that team's deadlines.
- /dashboard : the Area in design number can change with older offices whose last stage was renamed (the seed office shows the same number as before).
- No other screen changed. The Tracker entry sheet now saves "no reply needed" instead of showing "Finish ... first." when the reply task waits for another task.

## Repair

Three reviewer findings on the group A diff. I confirmed each one in the code and with a failing test before the fix. Last commit: db164b8.

V-17 (last stage) | fixed | 994cc2a | Area in design now takes the last stage of the project's own list (the highest order), not the last stage in time, so an undated middle stage never becomes the last stage. A project with only one stage now stays in design, because it has no separate site stage. Tests: undated middle stage (both ways), one-stage project (state and projects.create).
V-3 (old date notes) | fixed | 6157d66 | State version 8 fills in forDueDate on older date notes: the due day the finished task had when the note was written (the day before its first due-day change after the note, else its due day now). The strict match in shiftPlan stays. I also found a second path to the same defect and fixed it in the same commit: the daily date shift (src/data/shift.ts) moved the task due day but not forDueDate, so a note from an earlier day never matched. forDueDate is now a shifted day field. Tests: a migration test with a main-era note, and an API-3 test with the daily shift between two late finishes.
Story Undo with an open prerequisite | fixed | db164b8 | After eventsUndoStory takes back every event, each task that it brought back to Done or In review gets the finish check (assertMayFinish). A refusal fails the call, so nothing changes. The reviewer probe is now a test, with a control test that a story which reopened both tasks still brings both back.

Counts: 3 fixed, 0 not real, 0 skipped.

Notes for the controller:
- STATE_VERSION is now 8 (src/api/store.ts, src/data/migrate.ts). If another group also adds a version step, the merge needs one order for the two steps.
- Owner question 1 above changes: a project is on site when its tag is the last stage of its own list by list order. A project with one stage always counts as in design. Owner question 3 from DSH-16 (a site mark on a stage) stays open.
- Full suite under load (load average 45 to 53): 1444 of 1445 passed. The one failure was a test in src/features/project/tasks/TaskFeatures.test.tsx that did not find its button in time. That file passed alone twice (14 of 14). My changes do not touch that screen. tsc and check-rtl pass.

Screens that changed: /dashboard (Area in design, only for a project with an undated middle stage or a project with one stage). The Undo toast can now show the "Finish ... first." refusal in the rare forged-story case.

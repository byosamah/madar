## Repair

Branch w3-drepair, worktree /Users/osamakhalil/dev/madar-w3-drepair. Base f97eddd. Last commit 65b51d3.

V-12 meeting round trip | Fixed | edaaa93 | The meeting exit now sets `view=schedule` when the meeting status is not Active, because only the Schedule section shows and keeps a status. The new test in MeetingView.test.tsx opens the meeting from `/dashboard?view=schedule&status=all`, presses Escape, checks that the Schedule tab is selected and the status stays in the link, then opens the meeting again and finds Tamr Staff Housing. Before the fix it failed: the Dashboard opened on the Projects tab.
V-12 Dashboard test timing | Fixed | 65b51d3 | Confirmed: with a 200 ms API delay the old synchronous read failed every time, and with 20 ms it failed once in three runs. The test now gives the API a 100 ms delay and reads the Office schedule with `findByRole`; it passed three runs out of three.

Checks: full suite 1490 tests. The full run had 7 failures in ProjectAudit, ProjectByCode and TaskFeatures (files this branch does not touch); the three files alone pass 81 of 81, so the cause is machine load. `npx tsc -p tsconfig.json --noEmit` passes. `node scripts/check-rtl.ts` passes.

Note (not changed): after a Status change, the Office schedule section is empty for the time the new call takes, because the schedule call has no keepPrevious. The base blanked the whole Dashboard in the same case, so this is not a regression.

Screens that changed: `#/dashboard?view=schedule&status=all`, press Meeting view, then Escape. The Dashboard opens on the Schedule tab with the status kept.

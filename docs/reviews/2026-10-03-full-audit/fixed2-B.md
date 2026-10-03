# Fix wave 2, group B (project screen): report

Branch w2-project in /Users/osamakhalil/dev/madar-w2-project. Last commit 6d8bbfa.
Full suite 149 files, 1441 tests, all pass. Type check passes. RTL check passes.
Under the current machine load (average 50 to 190), a full run can fail one or two first-render tests. The untouched base branch fails the same way. Each such test passed when run alone.

## Items

V-5 | fixed | f0c04f7, a1200f2 | One rule (moveTargets in src/lib/board.ts) now sets the Board Move menu and the drop columns: the reviewer of a card in review gets Done and "Send back with a note" (which opens the task panel on its review block), and the refusal says "lead" / "المسؤول الرئيسي عنها".
V-4b | fixed | 6ae5187 | The Tracker quick log and Assign a reply list only members whose active flag is not false (replyPeople in src/lib/tracker.ts), and the default stays the viewer or the first person in the list.
V-14 | fixed | 5dd95f1 | A failed Save dates opens the reason sheet again and shows the error toast with no Retry, so the sheet's Save dates is the one place to try again.
V-20 | fixed | 71033a1 | FilesTab reads view.canDelete and FeedEntry reads item.attachments directly; the fileNames prop and the files.list call in ActivityTab are gone.
V-23 | fixed | b38c162 | The deadline edit now says "Edit deadline" / "تعديل الموعد" and "Edit <name>" / "تعديل <name>".
V-24 | fixed | 4bd64d9 | The Schedule tab timeline and deadline list draw the deadline diamonds in bg-ink-2, as the Dashboard and the meeting do.
V-30 | fixed | 5636c70 | When an entry sheet closes and the focus is not on the Tracker tab, the tab gives the focus to the entry row, or else to the Tracker tab itself (checked in Chrome: the focus lands on the row).
V-33 | fixed | e1c0cc3 | On a phone the file row is a grid with Versions on its own line under the name; at 390 px the name now gets 138 px, not 20 px.
V-35 | fixed | eaa9bff | A helper's task row shows "Helper · Lead: <name>"; Arabic "مساعد · المسؤول الرئيسي: <name>", with "مساعدة" for a woman.
V-36 | fixed | 9f21b88 | usePanelLink (src/features/project/panelLink.ts) opens the task panel and the payment sheet with one history step that remembers where Close leads; Close goes back over it, so Back closes a panel and Close leaves no extra step (checked in Chrome).
V-9 | fixed | 6d8bbfa | The two PRJ-1 tests now wait for the flag that the same refresh shows and record every route change; on the old code both fail 3 of 3 for the right reason.

## Questions for the owner

1. Arabic word for Lead (V-5, V-35). The plan said "المسؤول", but the app uses "المسؤول الرئيسي" everywhere for Lead (task panel, helpers hint, history). I used "المسؤول الرئيسي" to keep one word for one meaning. Is that right?
2. Two tasks in a row (V-36). When a person opens a second task while one is open, the second now takes the place of the first. One Back then closes the panel. Before, Back went to the first task. Is that the behavior you want?
3. The Tracker entry sheet has the same extra Back as the task panel had (open adds a step, Close replaces it). The new hook can fix it in one line. It is not in this wave. Do you want it?

## Notes for the merge

- V-4b reads a member-level flag, `projects.get` members[].active. If Group A puts the flag in another place (for example on the user card), change the one line in replyPeople in src/lib/tracker.ts.
- V-36 and Group C's V-10 both touch focus return when a sheet closes. My V-30 code runs after the sheet's own focus return, and only when the focus is not on the Tracker tab, so it works with or without V-10.
- Pre-existing, not fixed: the Tracker entry sheet header puts an icon that renders a div inside a p, which logs a React dev-mode warning. On a phone, a file with two chips (Version A and Cover) still truncates its name hard ("Cover re..."). The BRW-3 test in ProjectAudit.test.tsx still sleeps 30 ms (same class as V-9).

## Screens that changed

- #/projects/prj_001?tab=tasks, Board view, as Faisal (usr_002): the "..." menu of "Toilet details" (In review) shows only Done and "Send back with a note"; the second item opens the task panel.
- #/projects/prj_001?tab=tasks&task=tsk_007 with Simulate errors on, change the due date and Save dates: the reason sheet comes back, and the error toast has no Retry.
- #/projects/prj_001?tab=schedule: grey deadline diamonds in the timeline and the list; press a deadline name: the sheet title says "Edit deadline" (Arabic "تعديل الموعد").
- #/projects/prj_001?tab=files at 390 px: "Ground floor plan.pdf" shows most of its name, with Versions on the line under it. 1440 px looks as before.
- #/projects/prj_001 (Overview), focus "Open Asked the client for the signed fee agreement", Enter, then Escape: the focus ring is on that row in the Tracker tab.
- A helper row: as Sara (usr_005) after adding her as a helper on "Stair details", #/projects/prj_001?tab=tasks and #/work show "Helper · Lead: Yousef Saleh" under the title. Arabic: "مساعدة · المسؤول الرئيسي: Yousef Saleh".
- No visual change, behavior only: Back and Close of the task panel and payment sheet; the Tracker reply-person list (differs only once a member is inactive and Group A's flag lands); the Activity tab (no files.list call).

## Repair

Two reviewer findings, both confirmed in the code and both fixed on w2-project.

V-36 (Forward) | fixed | 32a1a6c | usePanelLink kept the key of the step that Close went back from and never cleared it. Forward brings that step back with the same key, so Close and Escape did nothing. The hook now clears the key when the link moves on (an effect on location.key). The guard still blocks a second Close before the Back lands, because the key does not change in that window. New tests in ProjectAudit.test.tsx close the task panel (with Close, then with Escape) and the payment sheet after Forward. Both failed before the fix ("expected dialog to be null") and pass now.
V-23 (Links) | fixed | f44d3d8 | The Links panel said "Change the link" and "Change <name>". en.json now says "Edit link" and "Edit <name>". Arabic already said "تعديل الرابط" and "تعديل <name>", so ar.json has no change. A new test in OverviewTab.test.tsx opens the link edit by its "Edit Pinterest: facades" name and finds the "Edit link" sheet. The outsider test now looks for an /^Edit / button, not /^Change /.

Checks after the repair: full suite 149 files, 1444 tests, all pass. tsc --noEmit passes. check-rtl passes.

Screens that changed in the repair:
- #/projects/prj_001 (Overview), About, Links, as Faisal (usr_002): the pencil of a link reads "Edit <name>", and its sheet title says "Edit link".
- Behavior only: on #/projects/prj_001?tab=tasks, open "Stair details", Close, press browser Forward, then Close or Escape: the panel closes. The same holds for a payment sheet on the Overview.

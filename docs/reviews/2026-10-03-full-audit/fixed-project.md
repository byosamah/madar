# Project screen fixes (branch fix-project)

All tests for these findings are in `src/features/project/ProjectAudit.test.tsx`. Each test failed before its fix.

| ID | Result | Commit | What changed, or why skipped |
|---|---|---|---|
| PRJ-1 | Fixed | bd03fc9 | The project and the task panel stay on screen after a failed refresh; only a missing project says "Project not found", a failed first load says "The data did not load." with Retry, and the panel shows Retry when the task did not load. |
| PRJ-2 | Fixed (screen part) | 1992899 | The reviewer gets no Status menu on a task in review, so Approve and Send back are the only ways; a new test proves the board keeps a refused card in its column and shows the reason in a toast (the board needed no change). |
| PRJ-3 | Skipped | none | Nothing to change on the screen: the Team tab already hides Remove when `openTasks > 0`, so it follows once fix-api counts helper tasks, and the new refusal sentence arrives through the normal error toast. |
| PRJ-4 | Fixed | 784e595 | Tasks, Activity, Tracker, Files and Payments show "The data did not load." with Retry when their first load fails. |
| PRJ-5 | Fixed (up to 200 items) | c540fe2 | Activity has "Show older" (50 more each press, up to the API limit of 200), and a link to an older post loads older items until the post shows. |
| PRJ-6 | Fixed | 07c7b77 | Post files are `FileChips` that save the file, and a deleted file says "File removed"; the chips read `item.attachments` when the API sends it, else the names come from the file list. |
| PRJ-7 | Fixed | 41277f2 | A failed or refused save puts the checklist and the task date fields back to the saved values; the Schedule stage dates do the same. |
| PRJ-8 | Fixed | 1992899 | Approve and Send back come first for the reviewer; empty "Needs first" and "Unlocks" no longer show, and the leader gets one "Add a task it needs first" press. |
| PRJ-9 | Fixed | 2a4fc46 | Close of the task panel and the payment sheet replaces the link, so Back does not open them again. |
| PRJ-10 | Fixed | 2a4fc46 | A task closed on the Overview also drops `thread`, so the next task opens on Details. |
| PRJ-11 | Fixed | b4b1a00 | Arabic `overview.healthNote_female` and `taskSheet.joinsTeam_female` added, and both calls pass `actorContext`. |
| PRJ-12 | Fixed | b4b1a00 | The payment amount uses `areaValue` from `projectForm.ts` (left in place to keep the merge clean), so Arabic-Indic and Persian digits and marks work. |
| PRJ-13 | Fixed | c540fe2 | The deadline name opens a "Change deadline" sheet (name, date, stage) that calls `deadlines.update`, with Undo. |
| PRJ-14 | Fixed (banner words) | b4b1a00 | After the restart date the banner says "Planned restart was <date>." in the Attention color. |
| PRJ-15 | Fixed | 1af55e4 | With no clipboard or a refusal, a toast says so and a read-only path field shows, focused and selected. |
| PRJ-16 | Fixed (screen part) | 07c7b77 | The file menu shows Delete from `view.canDelete` when the API sends it, else the old rule. |
| PRJ-17 | Skipped | none | Assigned to fix-api (API side). |
| PRJ-18 | Fixed | 77c54b3 | The Overview shows a quiet placeholder until the tasks arrive, never a false "Nothing needs attention." |
| PRJ-19 | Fixed | ae4b2fc | A client item on the Overview opens that Tracker entry; the open entry lives in the link as `entry`. |
| PRJ-20 | Fixed | b4b1a00 | Resume shows only on the paused banner; the menu offers it only when no banner shows. |
| PRJ-21 | Fixed | c540fe2 | "Make leader" opens the leader sheet with the person picked; nothing changes before Save. |
| PRJ-22 | Fixed | ae4b2fc | Tasks (`show`, `done`), Activity (`feed`) and Tracker (`type`, `side`, `open`) filters live in the link and stay across tabs, reloads and Back. |
| PRJ-23 | Fixed | b4b1a00 | A stage with one date says "Starts <date>" or "Ends <date>" on the Schedule and in the stage list. |
| PRJ-24 | Fixed | 07c7b77 | Task files are chips: a picture or a PDF opens the preview, any other file saves. |
| PRJ-25 | Fixed | c540fe2 | The Tracker type picker has one Tab stop, and the arrow keys move the choice (mirrored in Arabic). |
| BRW-3 | Fixed | c993b6b | `DateDraftField` remembers the draft it sent and skips a second commit of the same draft, so one Cancel closes the reason sheet. |
| BRW-5 | Fixed (task panel part) | c993b6b | Approve in the task panel uses `useUndoable('tasks.approve')` and offers Undo. |
| BRW-6 | Fixed | c993b6b | A failed save puts the title back to the saved one; a description keeps the typed text with "Not saved yet. Leave the field to try again."; a failed save of dates with a reason opens the reason sheet again with the typed reason. |
| BRW-7 | Fixed | bd03fc9 | Done with PRJ-1: a failed load says "The data did not load."; "Project not found" shows only for a missing project. |
| BRW-11 | Fixed | c993b6b | Quick add is read only (with `aria-busy`), not disabled, while it saves, so the focus stays in the field. |
| BRW-13 | Fixed | c993b6b, 6fd8f8e | A person who cannot tick a task sees a plain mark, not a disabled button (spec 2.3); the old TasksTab test now expects no tick. |
| BRW-15 | Fixed | c993b6b | The close toast says "Marked as answered." or "Marked as received." (Arabic "سُجّل أنه تم الرد." / "سُجّل أنه تم الاستلام."), in the Tracker and in the meeting view; `tracker.closedToast` is gone. |

## Questions for the owner

1. PRJ-5: `updates.list` returns 200 items at most, so "Show older" stops there. A busy project with more than 200 feed items still hides its oldest posts. Should the API get a "before this item" cursor?
2. PRJ-24: the task panel can open its files, but a person can add a file only through a Conversation message. Should the panel get its own Upload button (one more control)?
3. PRJ-14: the banner now says when the planned restart passed, but the project stays paused and nobody gets a notice. Should the leader get an Inbox item on that day? (API work.)

## Notes for the merge

- BRW-13 changed one test outside my area: `src/features/tasklist/TaskListScreen.test.tsx` counted rows by their tick buttons; it now counts the list items (6fd8f8e).
- BRW-15 changed one line in `src/features/dashboard/meeting/ClientItemsPanel.tsx` (the close toast), because the key it used is gone. fix-dashboard had not touched that file when I checked.
- PRJ-6 and PRJ-16 read the new API fields through a cast (`item.attachments`, `view.canDelete`) so this branch passes alone. After fix-api merges, the casts still compile; they can be simplified later.
- Three timing tests fail now and then under heavy machine load (load average was 130 during my runs), on the base commit too: `SearchScreen` "opens the preview of a file it found" (1 in 6 runs at base 540a094), `TaskFeatures` "lists only the templates saved for that stage", and `ProjectByCode` "turns a project code in a post into a link". Each passes when run alone. My branch did not cause them.

## Screens that changed

- `/projects/prj_001?tab=tasks&task=tsk_010` as Faisal (usr_002): the Review block (Approve, note, Send back) is at the top; Status is plain text, not a menu.
- `/projects/prj_001?tab=tasks&task=tsk_013` as Faisal: no empty "Needs first" or "Unlocks"; one "+ Add a task it needs first" press, which opens the picker.
- Task panel Files (upload a file to tsk_007 first): file chips; a PNG or PDF opens the preview sheet.
- `/projects/prj_001?tab=activity`: post files are chips; "Show older" under the list once a project has more than 50 items.
- `/projects/prj_001?tab=schedule` as Faisal: deadline names press to open "Change deadline"; set one stage to a start date only to see "Starts <date>".
- `/projects/prj_001?tab=team` as Hala (usr_001): "Make leader" in a member menu opens "Change leader" with that person picked.
- `/projects/prj_001?tab=tracker`: the type picker (focus ring moves with the arrow keys); an Overview client item opens `?tab=tracker&entry=<id>` with the entry sheet open.
- Paused banner (`/projects/prj_012`): the "…" menu has no Resume; with a restart date in the past the banner reads "Planned restart was <date>." in the Attention color.
- Overview About panel on a plain http:// address: Copy on the office folder shows the toast and a selected path field.
- Overview on a slow link: a quiet panel stands in until the tasks load.
- Task panel with Simulate errors on: a failed title save shows the saved title again; a failed description save shows "Not saved yet." under the field; a failed "Save dates" brings the reason sheet back with the reason.
- Task panel: type a new due date, press Enter, then Cancel once: the reason sheet closes for good.
- `/projects/prj_005?tab=tasks` as Khalid (view only): task rows show plain marks, no tick buttons.
- Tracker: answer an open item: the toast says "Marked as answered.".
- Any project tab with "Simulate errors" on: "The data did not load." with Retry instead of an empty tab.
- Arabic: the Overview health note after Hala sets the health reads "حدّدته Hala Nasser:"; the Lead and Helper pickers say "تنضم" for a woman.
- Payment sheet: the amount accepts "١٥٬٠٠٠".

# Wave 4, group "project": fix report

Branch `w4-project` in `/Users/osamakhalil/dev/madar-w4-project`, from `audit-fixes` (8658de6). Last commit: 171d9ac.
Full suite: 162 files, 1583 tests pass (1567 before, plus 16 new). `npx tsc -p tsconfig.json --noEmit` is clean. `node scripts/check-rtl.ts` passes.
Browser check: Playwright against a production build (the dev server refuses the app fonts through the linked node_modules, so text widths were wrong there). Script: `audit/w4-project-check.mjs`. Screenshots: `audit/fixed4-project-shots/`. No console errors or warnings.

ID | Result | Commit | What changed
--- | --- | --- | ---
F-1 | fixed | 380456a | Edit post and Edit comment move the focus into the edit box, and Cancel or Save gives it back to that item's actions button (new hook `src/components/editFocus.ts`).
F-7 | fixed | 99e392f | The lead name on the helper line sits in its own `bdi` box, so the Arabic line wraps before the name, and a name too long for the line is cut at its own end.
F-9 | fixed | 65df15a | While the reviewer lifts a card in review, To do and In progress say "This task cannot move here."; a drop there shows the refusal reason in a toast with "Open task", which opens the review block.
F-11 | fixed | 72e2e64 | The tracker row now carries the title of its reply task (`TrackerRow.replyTask.title`), and the Reply task block shows that title as a link that opens the task panel.
F-12 | fixed | 0869f13 | The current stage bar on the project Schedule tab uses `currentTone` of the Dashboard: grey on track or paused, orange tint at risk, solid red late.
F-13 | fixed | 65df15a, 171d9ac | Only the title keeps the 96 px free space for the card buttons (in a box that follows the page direction), the due words never wrap, and the waiting label has its own line, uncut.
F-20 | fixed | 0f51405 | The share toast names the place ("Shared in the <project> chat.", "Shared with <person>.", "Shared in the task “<title>”.") and its "Open" action goes to that chat or to the task conversation.
F-23 | fixed | 3c0fa3e | In the entry sheet the direction mark leaves out its hidden copy of the words, so "From the client" is read one time; the History rows keep the hidden words.

## Questions for the owner

1. F-12: the calm redesign spec (line 141) asked for the project color on this bar. Wave 4 chose the Dashboard state tones, which follow your 2026-10-02 rule ("the color of the current stage says the state of the project"). Do you confirm? The project Schedule tab has no legend for the tones yet (the Dashboard has one). Do you want the same legend line there?
2. F-7: I chose "wrap" over "cut". On a phone in Arabic, a row where you help is one line taller, and the lead's full name always shows. Is that the right trade?
3. F-11: the API contract changed. `TrackerRow.replyTask` now has `title` (src/api/contract/views.ts). The Python build must send it too.

## Notes for the merge

- F-9 and F-8 (group "sheet") touch the same Board file. My toast action "Open task" calls the same `onOpen` as the menu item "Send back with a note". If F-8 gives that menu item a special "send back" opening (focus in "What needs to change?"), the toast action should use the same opening. My hunks stay away from that menu item.
- F-20 removed the key `files.shared` and added `files.sharedChat`, `files.sharedPerson`, `files.sharedTask`, `files.sharedOpen`. F-9 added `tasks.dropClosed` and `tasks.openTask`. All have Arabic text.

## Screens that changed

- `#/projects/prj_003?tab=activity`: "Actions for this post" > Edit post. The focus goes into the edit box; Cancel and Save return it to the "..." button. Same for "Actions for this comment" > Edit in the Conversation of a task panel.
- `#/work` and `#/projects/prj_001?tab=tasks`, as Sara (helper on Stair details), Arabic, 390 px: the helper line wraps to "مساعدة · المسؤول الرئيسي:" and then "Yousef Saleh" in full (shots f7-*).
- `#/projects/prj_001?tab=tasks`, Board view, 1440 px, English and Arabic: due words on one line, waiting label on its own line, titles clear of the grip and "..." buttons (shots f13-*).
- Same Board as Faisal: drag "Toilet details" (In review) over In progress. To do and In progress say "This task cannot move here." After the drop, a toast gives the reason and "Open task" (shots f9-*).
- `#/projects/prj_001?tab=tracker`, open "The client asked to move the lobby entrance", Assign a reply: the Reply task block shows "Reply: The client asked to move the lobby entrance" as a link to the task (shot f11-*). The direction words show one time.
- `#/projects/prj_005?tab=schedule` (On track): current stage bar is grey. `#/projects/prj_001?tab=schedule` (Late): it is solid red (shots f12-*).
- `#/projects/prj_001?tab=files`, "..." on Site plan.pdf > Share in chat: the toast names the place and has "Open" (shot f20-*).

## Repair

F-9 repair | fixed | 4683f18 | The refused-drop toast did not show on a phone. The reviewer was right: in @dnd-kit/core 6.3.1 the `delta` of the drag end is the pointer move plus the scroll change since the drag began (core.esm.js:2983, :3139), but the column boxes were measured after that scroll. The board now keeps the screen point of the pointer while a card is lifted (window `pointermove` and `pointerup` listeners, only during the drag) and compares that point with the column boxes. A keyboard drag still gets no toast, because it cannot reach a closed column.

- Test: `src/features/project/tasks/BoardWave4.test.tsx`, "says why after a drop on To do when the board scrolled during the drag". The board scrolls from 500 to 0 between pointer down and pointer up. It failed before the fix; the same test without the scroll event passed on the old code, so the failure came from the scroll.
- Browser check (production build, port 5493, script `verify4/project/repair-check.mjs`, the reviewer's check4 with my port): 390 x 844, Faisal, Board. English: the board scrolls from 487 to 0, release at x=195 over To do, the card stays in In review, and the toast shows the reason and "Open task". Arabic: the same, with the Arabic toast. Shots: `verify4/project/repair-shots/f9-phone-{en,ar}-{before,after}-drop.png`.
- Desktop 1440 px (`verify4/project/repair-desktop.mjs`): a release over To do shows the toast; a release over Done moves the card ("Moved to Done." with Undo).
- Full suite: 162 files, 1584 tests pass. `tsc --noEmit` and `check-rtl` pass.

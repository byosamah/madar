# Wave 4, group "sheet": report

Branch `w4-sheet` in `/Users/osamakhalil/dev/madar-w4-sheet`, from `audit-fixes` (8658de6). Last commit: 6e48073.
Full suite: 159 files, 1593 tests pass. `npx tsc -p tsconfig.json --noEmit`: no errors. `node scripts/check-rtl.ts`: passed.
Real-browser check (Playwright, Chromium, own Vite on port 5391, now stopped): 13 of 13 checks pass for F-15, F-16, F-17, F-8 and F-22. Screenshots: `audit/final/shots/w4-sheet/`.

## Items

F-15 | fixed | 38918ef | The task panel saves the typed Title, Description and "Add an item" text on every way of closing (Escape, X, a tap outside on a phone, Back, another task), sends no value twice and saves nothing after a delete.
F-16 | fixed | 6f6cf67, 6e48073 | A press outside no longer closes the date-reason sheet, the typed reason stays in the person's drafts for that task so the next date move opens with it, and Cancel now says "Keep the old date" (or "Keep the old dates").
F-17 | fixed | 0a2885d | The Payments panel keeps a typed new or edited payment, per project and per sheet, until Save, Cancel, Mark as received or Delete, and the sheet gets a quiet Cancel button.
F-19 | fixed | 76e6ee2 | While a task that needs review waits, its lead gets only To do and In progress next to "In review" in the Status menu, the board Move menu and a drag; the pull-back stays.
F-22 | fixed | 0b0fa99 | A new lead shows the Undo toast "<name> now leads this task." (or "... and joined the project team."), one Undo takes back the lead, the team join and the notices, and Arabic has the form for a woman.
F-8 | fixed | dd56613 | "Send back with a note" on the board opens the panel with the focus in "What needs to change?", Send back as the main button and Approve at the end as a plain button.

## Questions for the owner

1. F-17: the Edit payment sheet now has four buttons (Delete, Mark as received, Cancel, Save). Is that acceptable, or should Delete move into a "..." menu?
2. F-8: on a phone, "Send back with a note" puts the focus in the note box, so the keyboard opens at once. Elsewhere a sheet on a phone keeps the keyboard closed. I chose to open it because the person chose to write. Keep this?
3. F-15: a close now adds the text typed in "Add an item" as a new checklist item. Is that right, or should the text stay as a visible "Not saved" draft instead?
4. F-16: Escape and Close put the date back with no message (the typed reason stays). Do you want a short message such as "The date did not change."?

## Notes for the merge

- F-19 adds an optional third input (`needsReview`) to `moveTargets` in `src/lib/board.ts` and passes it at three calls in `src/features/project/tasks/TaskBoard.tsx` (the Move menu, `onDragEnd` and the Column `closed` prop). The project group (F-9, F-13) also edits TaskBoard.tsx, so expect small one-line conflicts there.
- F-16 adds a `keepOnOutsidePress` option to the shared `src/components/Sheet.tsx`.
- New i18n keys: `dateReason.keep*` and `taskSheet.newLead*` in both `en.json` and `ar.json`.

## Screens that changed

- `#/projects/prj_001?tab=tasks&task=tsk_007` (Stair details): type in Description, Title or "Add an item", press Escape, open the task again. The text is saved.
- Any task panel, move the Due date (for example `#/projects/prj_003?tab=tasks&task=tsk_032`): the "Why do the dates change?" sheet has "Keep the old date" in place of Cancel; a press outside does nothing; after Escape, the next move opens with the typed reason.
- `#/projects/prj_001` Overview > Payments > Add payment, and a payment row (Edit payment): a new Cancel button in the footer; typed values come back after Escape or a press outside.
- Preview as Khalid Al-Mutairi, open `#/tasks?task=tsk_032&project=prj_003` (Core layout) and pick Done once (it goes to review). The Status menu then shows only To do, In progress and In review. On the `#/projects/prj_003?tab=tasks` Board, "Move Core layout" shows only To do and In progress. (The seeded "Toilet details" does not need review, so it still offers Done, which works there.)
- Any task panel, Lead menu (for example `#/projects/prj_002?tab=tasks&task=tsk_021`, pick Khalid Al-Mutairi): the toast "Khalid Al-Mutairi now leads this task and joined the project team." with Undo. Check Arabic too.
- `#/projects/prj_001?tab=tasks`, Board, as the Admin or Faisal: Move Toilet details > Send back with a note. The panel opens with the focus in the note box, Send back is the main button and Approve is last.

## Repair

Four review findings, all confirmed in the code first. Last commit: 39d6e09.
Full suite: 159 files, 1597 tests pass. `npx tsc -p tsconfig.json --noEmit`: no errors. `node scripts/check-rtl.ts`: passed.
Real-browser check (Playwright, Chromium 1440x900, own Vite dev server on port 5473, now stopped): 5 of 5 pass. Screenshots: `audit/verify4/sheet/shots/repair-f8-same-task.png`, `repair-after-send-back.png`.

F-8 same task | fixed | 3a2faa8 | The note took the focus only when the panel mounted (autoFocus). An effect now moves the focus into "What needs to change?" each time "Send back with a note" turns on, also when the panel of that task is already open.
Focus after Send back and Approve | fixed | 3a2faa8 | The Review block goes away with the pressed button, so the focus fell to the page body. The focus now goes to the panel. Existed before wave 4.
F-15 tests | fixed | bec828e | The two tests counted events, and the server writes no event for a value it already has. They now count the `tasks.update` calls. I broke the guard on purpose two ways (no "sent" memory; a save on every close) and the tests failed each time.
Escape focus on the task panel | fixed | 39d6e09 | The cause is React StrictMode, which runs each effect twice in development: the second run took the panel itself for the opener, so the close left the focus on the page body. A production build was not affected. The side panel now notes the opener once, before the focus moves. Existed before wave 4.

New tests: 3 in `TaskReview.test.tsx` (note focus with the panel open, focus after Send back, focus after Approve), 1 in `overlays.test.tsx` (a non-blocking panel in StrictMode gives the focus back).

### Screens that changed

- `#/projects/prj_001?tab=tasks`, Board: press the "Toilet details" card, then "Move Toilet details" > "Send back with a note". The focus is in the note box.
- Same flow: type a note, press Send back (or press Approve on `&task=tsk_010`). The focus stays on the panel, not the page body. Nothing changes on screen.
- `#/projects/prj_001?tab=tasks`, List: Tab to "Stair details", press Enter, then Escape or X. The focus goes back to the row (dev server).

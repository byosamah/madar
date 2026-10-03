# Wave 3, track "balady": the Balady tick box on the move-back sheet (API-14, decision D3)

Branch `w3-balady`, worktree `~/dev/madar-w3-balady`, last commit `a976088`. Full suite: 153 files, 1501 tests pass (1489 before, 12 new). `npx tsc -p tsconfig.json --noEmit` passes. `node scripts/check-rtl.ts` passes.

## Items

API-14 server | done | b8aeca6 | `tasks.create`, `tasks.createFromTemplate`, `tasks.update`, `tasks.move` and `tasks.newVersion` take an optional `logInTracker`; when it is true and the project really moves back, the API writes one Balady entry (side "third party", dated today, the reason as the title, a reason over 200 characters also whole in the note) in the same story, so one Undo takes back the move and the entry.
API-14 sheet | done | c5ddd47 | The sheet "This moves the project back to X. Why?" shows one tick box under the reason, unticked: "Also log this in the Tracker as a Balady update" (Arabic: "سجّل هذا أيضًا في المتابعة كتحديث من بلدي"), and only to a person with the Tracker posting right (`viewerCan.post`); all five callers (task panel, board, quick add, template menu, search "New task") pass that right.
D3 doc line | done | a976088 | Added "D3, 2026-10-03: the owner confirmed the tick box after the automatic stage tag; built again." directly after the decision table, because a line inside the table would break it.

Tests: `src/api/handlers/stageBackTracker.test.ts` (7 tests: the entry with its fields, Undo of the story, each of the 5 calls, a long reason, nothing logged when unticked or with no move back, the same reason question as before, the Tracker rule) and `src/features/project/tasks/StageBackTracker.test.tsx` (5 tests: unticked by default and under the reason, ticked logs one entry that the Tracker tab shows, Undo takes both back, the quick add path, no box without the posting right). Both files take away only the posting right with a small mock, because no real person reaches that case today (see note 1).

Notes:
1. The posting right (`content.post`) belongs to the leader, the team and the Admin. Every call that can move the project back needs one of those roles, so today everyone who sees the sheet also sees the box. The rule still guards the box and the API, so a later change of rights stays safe.
2. The StageBack.tsx change leaves the `autoFocus` line untouched, and the box sits after `</form>`, with one unchanged line between, so the "small" track (S-2) merges cleanly.
3. The old 1 Oct build logged the entry as "from the client". Since 2 Oct a Balady entry may only have the side "third party", so the new entry uses it.

## Questions for the owner

1. The "New version" form in the task panel asks its own reason and never opens the move-back sheet, so it shows no Balady box. The API accepts `logInTracker` there (for an agent). Should the New version form also offer the box? It already logs a "message from the client" Tracker entry for every new version, so a second box there could be one control too many.
2. When a person without the posting right sends `logInTracker: true` (only an agent can, the screen hides the box), the API refuses the whole call with "forbidden", as `tracker.log` does, and the move is not made. No real person reaches this today. Do you prefer that, or should the API make the move and skip the entry?

## Screens that changed

- `/projects/prj_001?task=tsk_003` as Faisal (usr_002): set Status to "To do". The sheet "This moves the project back to Design Development. Why?" now has the tick box under "Reason", unticked. Look at it in English, in Arabic (right to left), and at phone width (the box wraps under the text box, 44 px tall row).
- `/projects/prj_001?tab=tracker` after a ticked move: the new Balady entry, side "Third party", with the reason as its title. Undo from the toast removes it.
- The same sheet with the box also opens from the Tasks tab (quick add or a template in an earlier stage, a drag on the board) and from the search "New task" sheet.

## Repair

Branch `w3-balady`, last commit `ebb4f04`. Full suite: 153 files, 1502 tests pass (1 new). `npx tsc -p tsconfig.json --noEmit` passes. `node scripts/check-rtl.ts` passes.

Stray Balady entry on a call that does not move back (reviewer findings 1 and 3, the same bug) | Fixed | ebb4f04 | `watchStage().finish` in `src/api/flow.ts` logged when the box was ticked and the project held any move-back note, so a call that kept an older note wrote a stray entry (empty title without a reason, which then broke `tracker.list`); it now logs only when this call moves the project back (`movedBack = back && ask && before !== null`). New test in `src/api/handlers/stageBackTracker.test.ts`: a move back without the box, then three calls that do not move the tag with the box ticked (with and without a reason) write no entry, `tracker.list` still loads, and a person without the posting right is not refused. The reviewers' two scratch tests in `verify3/balady` now pass.
New-version form has no Balady box (reviewer finding 2) | Skipped | none | The gap is real, but it needs an owner decision: every new version already writes its own automatic Tracker entry with the same reason, a new version does not always move the project back, and the brief limits the box to the move-back sheet. This is question 1 above, still open.

Note: with the fix, owner question 2 above now applies only to a call that really moves the project back. A call that does not move it back ignores the box and is never refused.

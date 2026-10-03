# Wave 4: the 23 problems the final browser check confirmed

Every item has its full steps, the confirmer's analysis (cause, file lines) and screenshots in `audit/final-findings.md` (F-1 to F-23). Read your items there first. The brief `audit/FIX-BRIEF.md` applies in full (TDD, small commits, the commit trailer, no Co-Authored-By, no em-dash, STE writing, English + Arabic with plural and `_female` forms, the ADHD rule). Each worktree is a fresh branch from `audit-fixes` (commit 8658de6, 1567 tests pass). These are found in a real browser, so where jsdom cannot show the bug, also check your fix with Playwright (allowed for you; use @playwright/test from your worktree's node_modules against `npx vite` started in your worktree on a free port, and stop it when done).

Owner decisions that stay: the lead may still pull their own task back from review (do not remove that); one meeting per browser tab; the Arabic word for Lead is "المسؤول الرئيسي"; do not change an Arabic product word (like the Dashboard name) without the owner: fit it instead.

## Group "sheet" (../madar-w4-sheet, branch w4-sheet): the task panel and its small sheets

- F-15 (HIGH): Escape (and a click outside) closes the task panel and throws away a typed Title, Description or new checklist text; the X button keeps them. Every way of closing must save what was typed, exactly as the X button does (or keep it as a visible "Not saved" draft). Test each close path.
- F-16 (MEDIUM): the date-reason sheet ("Why do the dates change?") closes on Escape or one click outside, loses the typed reason and silently puts the date back. A click outside must not close this required step; Escape and Cancel may close it, but the typed reason stays for that task, so the next date move opens with it filled in; the Cancel button says what happens (for example "Keep the old date").
- F-17 (MEDIUM): the Add payment sheet loses the typed name and amount on Escape or a click outside. Keep them until Save or Cancel, the same rule as the New Project sheet (src/features/projects/NewProjectSheet.tsx).
- F-19 (MEDIUM): the lead of a task in review sees "Done" in the Status menu; picking it does nothing and says nothing. For the lead while the task waits for review: offer only the pull-back choices (To do, In progress) next to the plain "In review" state, never Done. Keep the pull-back.
- F-22 (LOW): a new lead for a task (Lead picker in the task panel) gives no confirmation and no Undo. Show the usual Undo toast: "<name> now leads this task." (Arabic with the `_female` form), and say it in the same toast when the person also joined the team.
- F-8 (LOW): "Send back with a note" from the Board opens the task panel with the focus on the panel and Approve as the main button. When the panel opens for a send back, put the focus in "What needs to change?" and make Send back the main button for that moment.

## Group "project" (../madar-w4-project, branch w4-project): Board, Schedule, Tracker, Files, posts and comments

- F-1 (MEDIUM): Edit post (Activity) and Edit on a comment drop the keyboard focus on the page body when the edit box opens and when it closes (on desktop one Tab then lands in "Add a comment", so a person can send a duplicate). Edit moves the focus into the edit box; Cancel and Save return it to that item's actions button. Files: src/features/project/overview/FeedEntry.tsx and src/features/comments/CommentThread.tsx.
- F-7 (MEDIUM): the Arabic helper line "مساعدة · المسؤول الرئيسي: <name>" cuts the lead's name from its start at phone width. The name must stay readable: let the line wrap, or cut the name at its end (isolate it with bdi so the ellipsis falls at the end of the name).
- F-9 (LOW): dropping an in-review card on To do or In progress snaps back with no visible reason. While dragging, mark those columns as closed for that card, and after a refused drop show a short visible toast with the reason and an "Open task" action that opens the review block.
- F-11 (LOW): the Tracker entry's "Reply task" block shows no task title and cannot open the task. Name the task and open its panel on a press.
- F-12 (LOW): the project Schedule tab paints the current stage in the project color (amber for an On track project, green for a Late one). Use the state tones the Dashboard and the meeting use (src/features/dashboard/scheduleMarks.tsx: grey on track or paused, orange tint at risk, solid red late).
- F-13 (LOW): Board cards at 1440 px wrap the due words over three lines and cut "Waiting for". Keep the due words on one line and put the waiting label on its own line.
- F-20 (LOW): the "File shared." toast does not say where the file went. Name the target ("Shared in the <project> chat", "Shared with <person>", "Shared in <task>") and add an "Open" action to that chat or task.
- F-23 (LOW): the Tracker entry sheet reads "From the client" twice to a screen reader. Read it once.

## Group "dash" (../madar-w4-dash, branch w4-dash): Dashboard and meeting

- F-18 (MEDIUM): the meeting summary and the message shared to the project chat drop who owns an Action and when it is due. Write an Action line as the panel shows it: "Action: <title> · <person> · <weekday day month>" (Arabic too), in the summary, "Copy as a table" and Share.
- F-21 (LOW): Skip gives no feedback. Show the usual Undo toast: "<project> moved to the end of the agenda." Undo puts it back where it was.
- F-5 (LOW): on a phone (below 640 px) the meeting still offers Timeline, which squeezes the bars into a 30 px strip. On a phone offer Projects only (hide the mode switch; a timeline link on a phone opens Projects). Keep the earlier, Today and later controls on one row in Arabic.
- F-10 (LOW): the workload cell's screen-reader label says "1 tasks". Give `dashboard.cell` plural forms in English (and check Arabic) and pass `count`.
- F-14 (LOW): the Dashboard Leader filter lists all 10 people, 6 of whom lead nothing. List only people who lead at least one project in the current status.

## Group "shell" (../madar-w4-shell, branch w4-shell): the app frame

- F-2 (MEDIUM): on a phone in Arabic, the Dashboard tab label "لوحة المعلومات" (81 px) is wider than its tab (69 px) and is cut to "حة المعلوما" on the current tab. Make every tab label fit its tab and its highlight pill in both languages at 360 and 390 px, without changing the word (for example: let a long label wrap to two short lines, or fit its size down to a readable floor). Check English too (it nearly touches the pill edge).
- F-3 (LOW): the language switch in the person menu closes the menu and leaves the focus on the page body. Return it to the person picture button, as the other menu items do (use the existing close helper in src/app/PersonMenu.tsx).
- F-4 (LOW): the Search suggestion list has the English screen-reader label "Suggestions" in Arabic (cmdk default). Pass a translated label.
- F-6 (LOW): on a phone the person menu's last item "Request a feature or report a bug" wraps to two centred lines. Start-align every row.

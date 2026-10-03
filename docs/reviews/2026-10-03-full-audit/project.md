# Project screen audit

Scope: everything under `src/features/project` (header, actions, health, stage, paused banner, all seven tabs, task panel, tracker, schedule, files, team, payments), plus `src/features/comments/CommentThread.tsx` as the task Conversation.

Method: I read every file end to end and traced each control to its API call. I proved the main findings with scratch Vitest runs over the sample office (`scratchpad/audit/prj/proofs.test.tsx` and `rollback.test.tsx`, logs `run1.log` to `run4.log`). The existing 226 project tests pass.

## Findings

### PRJ-1 A failed background refresh closes the task panel or replaces the whole project, and typed text is lost
- Type: BUG
- Severity: HIGH
- Where: src/features/project/ProjectScreen.tsx:28-42, src/features/project/tasks/TaskSheet.tsx:337-339, src/features/project/overview/OverviewTab.tsx:281
- What happens: every change refreshes every query (src/app/runtime.tsx:21-26). TanStack Query 5 keeps the old `data` on a failed refresh but also sets `error`. The screens test `error` first. Proof (P1): leader opens `?tab=tasks&task=tsk_007`, types " DRAFT TEXT" in Description, any other change happens, the next `tasks.get` fails -> the panel closes at once and the store has no draft. Proof (P2): the same with `projects.get` failing -> the whole project is replaced by a page titled "Project not found" (twice) with a Retry button, and the open panel is gone. With "Simulate errors" on (1 call in 5 fails), each edit in the panel has about a 1 in 3 chance to close it. Spec 11.6 expects a rollback and a Retry toast, not a lost screen. The title "Project not found" is also wrong for a failed call.
- Fix idea: show the error page only when there is no data (`isLoadingError`, or `error && !data`). In TaskSheet close only on a `not_found` error code. Use a "Could not load" title for a failed call.

### PRJ-2 The status menu and the board skip the review rules: no "approved" notice, no send-back note
- Type: BUG
- Severity: MEDIUM
- Where: src/features/project/tasks/TaskSheet.tsx:238-242, src/features/project/tasks/TaskBoard.tsx:121-126 and :99, src/api/handlers/tasks.ts:422-435
- What happens: proof (P3), as leader Faisal on `tsk_010` (in review, owner Sara): `tasks.move` to In progress -> status changes, 0 new comments, 0 `task_sent_back` notices. `tasks.move` to Done -> status done, 0 `task_approved` notices. The Status select in the task panel, the board drag and the board "Move to" menu all call `tasks.move`. Spec 5.5 step 5 says send back needs a required note that posts as a comment and tells the owner. Spec 7.1 says the owner gets "My task is approved". The Approve and Send back buttons do this; the other three paths do not.
- Fix idea: in `tasks.move`, treat a reviewer's move of an In review task to Done as `approve`, and refuse a move back to In progress or To do without a note (or route it to `sendBack`). In the panel, hide the status select while the task is In review for the reviewer.

### PRJ-3 The Team tab counts only lead tasks, so Remove shows for a helper and then fails with a vague error
- Type: BUG
- Severity: MEDIUM
- Where: src/api/views.ts:202-203, src/features/project/team/TeamTab.tsx:34 and :44, src/api/handlers/projects.ts:441-442
- What happens: proof (P4): Lina is on the prj_001 team and helps on open task "Stair details", and leads nothing. The Team tab shows "Open tasks: 0". The Overview "Who is doing what" panel shows "1 open task" for the same person. The Team menu offers "Remove from team"; the press gives the toast "Some fields are not valid." because `members.remove` counts helper tasks. Two numbers for one fact, and an action that fails after the press with no reason a person can act on.
- Fix idea: count `involves(task, userId)` in `detailOf` (lead or helper), so the menu hides Remove. Give the refusal a reason code with its own sentence ("Give their open tasks to someone else first.").

### PRJ-4 Five tabs have no error state: a failed load shows an empty tab with no Retry
- Type: GAP
- Severity: MEDIUM
- Where: src/features/project/tasks/TasksTab.tsx:71, src/features/project/overview/ActivityTab.tsx:40-52, src/features/project/tracker/TrackerTab.tsx:78-82, src/features/project/files/FilesTab.tsx:181, src/features/project/payments/PaymentsPanel.tsx:65
- What happens: proof (P9): first `tasks.list` fails -> the Tasks tab shows only the Filter button: 0 rows, no message, no Retry. Same for Activity when `updates.list` fails (0 posts, no message, no Retry). Tracker, Files and Payments read `.data` only, so they fail the same way. A person sees an empty project and thinks the data is gone. Overview and the Conversation already use `LoadFailed`; these five do not (spec 11.6: a failed call offers Retry).
- Fix idea: render `<LoadFailed error onRetry>` when the query has an error and no data, as OverviewTab does.

### PRJ-5 The Activity feed stops at 50 items, so older posts and their comments are out of reach
- Type: GAP
- Severity: MEDIUM
- Where: src/features/project/overview/ActivityTab.tsx:20, src/api/handlers/content.ts:48
- What happens: `updates.list` returns 50 items by default and the tab has no "Show more". Proof (P5b): after 50 new posts on prj_001, the post "I uploaded revision B..." is gone from the tab, and nothing in the project leads back to it or its comments. The sample projects hold 24 to 35 feed items today, and every task created, finished, file added or member added adds one, so an active project passes 50 within weeks. A link with `?update=<id>` for an older post (from a mention) opens and scrolls to nothing.
- Fix idea: add "Show older" that raises `limit` (or a cursor). When `update` is in the link and not in the list, load until it is found.

### PRJ-6 Files in a post cannot be opened, and a deleted file shows its raw ID
- Type: GAP
- Severity: MEDIUM
- Where: src/features/project/overview/FeedEntry.tsx:93-101
- What happens: proof (P6): a post with "Brief notes.txt" shows the name as plain text, not a button or a link, so nobody can open or save the file from the post. After the file is deleted, the post shows `fil_061`. Comments and Tracker entries already use `FileChips`, which downloads the file and says "removed" for a deleted one.
- Fix idea: give `FeedItem.update` an `attachments` list from `attachmentsOf` and render `FileChips`.

### PRJ-7 A failed save does not roll back: the screen shows a tick or a date that was not saved
- Type: BUG
- Severity: MEDIUM
- Where: src/features/project/tasks/TaskSheet.tsx:55-63 (Checklist), src/components/Fields.tsx:57-68 (DateDraftField, used in TaskTiming and the Schedule stage dates)
- What happens: proof (P10): a checklist tick whose `tasks.update` fails -> error toast, the box stays ticked, the store says not done. Proof (P11): a start date whose save fails -> the field shows 2026-01-05, the store holds null. The field keeps the wrong value until the next save of the same task lands. A refused value (for example a due date before the start) also stays on screen. Spec 11.6: "The optimistic change rolls back."
- Fix idea: reset the local copy in the mutation's `onError` (Checklist `setItems(task.checklist)`, DateDraftField `setDraft(value)`).

### PRJ-8 In the task panel, Approve and Send back sit below about ten other sections
- Type: ADHD
- Severity: MEDIUM
- Where: src/features/project/tasks/TaskSheet.tsx:225-291, src/features/project/tasks/TaskNeeds.tsx:42 and :75-79
- What happens: a leader opens a task in review. Before Approve come: Title, Status, Lead, Stage, Helpers, Needs first, Unlocks, Start date, Schedule mode with its hint, Due date, Flag switch, Needs review switch. For a leader, "Needs first" and "Unlocks" show on every task even when both are empty ("No task waits for this one."). On a phone, the one next step is several screens down, and the Status select above it offers a second way to finish the task with different effects (PRJ-2).
- Fix idea: when the task is In review and the viewer reviews, put the Approve / Send back block first. Hide empty Needs first and Unlocks behind one "Add a task it needs" link.

### PRJ-9 Back after closing a panel opens it again
- Type: BUG
- Severity: LOW
- Where: src/features/project/tasks/TasksTab.tsx:35-40, src/features/project/overview/OverviewTab.tsx:276-280, src/features/project/payments/PaymentsPanel.tsx:42-47
- What happens: proof (P7): open "Stair details", press Close, press Back -> the panel opens again (`?tab=tasks&task=tsk_007`). Close pushes a new history entry, so each task looked at costs two Back presses and the closed panel comes back. Same for the payment sheet.
- Fix idea: close with `{ replace: true }`.

### PRJ-10 A task closed on Overview leaves `thread=1` in the link, so the next task opens on Conversation
- Type: BUG
- Severity: LOW
- Where: src/features/project/overview/OverviewTab.tsx:276-280
- What happens: proof (P8): open a task from "Who is doing what", switch to Conversation, Close -> link is `?thread=1`; open another task -> it opens on "Conversation (2)", not Details. TasksTab deletes `thread` on close; OverviewTab does not.
- Fix idea: delete `thread` in OverviewTab's `close`, as TasksTab does.

### PRJ-11 Arabic: two sentences always use the male verb
- Type: BUG
- Severity: LOW
- Where: src/features/project/overview/OverviewTab.tsx:96 (`overview.healthNote` "حدّده {{name}}:"), src/features/project/tasks/TaskHelpers.tsx:12 (`taskSheet.joinsTeam` "(ينضم إلى الفريق)")
- What happens: when Hala Nasser (Admin, female) sets a health override, the Overview reads "حدّده Hala Nasser:". The Lead and Helper pickers mark every outside person, Sara or Lina too, with "ينضم". Neither call passes `actorContext`, and `ar.json` has no `_female` form for these keys.
- Fix idea: add `healthNote_female` ("حدّدته") and `joinsTeam_female` ("تنضم") and pass `context: actorContext(person)`.

### PRJ-12 The payment amount refuses Arabic-Indic digits
- Type: BUG
- Severity: LOW
- Where: src/features/project/payments/PaymentSheet.tsx:16-19
- What happens: `Number('١٥٠٠٠')` is NaN, so typing ١٥٠٠٠ on a phone with Arabic digits shows the amount error and the payment cannot be saved. The field uses `inputMode="decimal"`, which brings up the native digit pad.
- Fix idea: map ٠-٩ (and ۰-۹, "٫", "٬") to Western characters in `parseAmount`.

### PRJ-13 Deadlines cannot be edited
- Type: GAP
- Severity: LOW
- Where: src/features/project/schedule/ScheduleTab.tsx:226-280
- What happens: the Schedule tab adds and deletes deadlines, but no screen calls `deadlines.update` (spec 11.3). A wrong date or name needs delete and add again.
- Fix idea: make the deadline row open a small edit form (name, date, stage) that calls `deadlines.update`.

### PRJ-14 A restart date in the past still reads "Restarts <date>." and nothing happens
- Type: BUG
- Severity: LOW
- Where: src/features/project/PausedBanner.tsx:27
- What happens: pause with a restart date of tomorrow. Two days later the banner still says "Restarts 1 October 2026." in the present tense, the project stays paused, and nobody is told. No code reads `resumeOn` after the pause.
- Fix idea: after the date, say "Planned restart was <date>" in the Attention color, or send the leader an Inbox item on that day.

### PRJ-15 Copy for an office network path gives no feedback when the clipboard is blocked
- Type: BUG
- Severity: LOW
- Where: src/features/project/overview/ProjectLinks.tsx:108-110
- What happens: on a plain `http://` office server, `navigator.clipboard` is undefined, so the optional chain skips the whole call: the press does nothing and says nothing. A refused write is also swallowed (`() => undefined`). The open item "where the app runs (STUDIO server)" makes this likely.
- Fix idea: on no clipboard or a refusal, show a toast and select the path text so the person can copy it by hand.

### PRJ-16 The file menu shows Delete to an uploader who left the team, and the server refuses it
- Type: BUG
- Severity: LOW
- Where: src/features/project/files/FilesTab.tsx:37, src/api/handlers/files.ts:139-142
- What happens: the screen shows Delete when `uploadedBy === me`. The API allows it only to a person still on the project (`content.editOwn`). After a member is removed, their own files still offer Delete, and the press ends in "You cannot do this on this project." This is also a second permission rule outside `can()` (spec 2.3).
- Fix idea: send `canDelete` in `FileView` from the API, as Tracker rows do.

### PRJ-17 Completing or archiving a paused project leaves its "waiting for the client" loop open
- Type: BUG
- Severity: LOW
- Where: src/features/project/ProjectActions.tsx:137-149, src/api/handlers/projects.ts (projectsSetStatus)
- What happens: a project paused as "Awaiting client" offers Mark completed and Archive in the "…" menu. Either one changes only `status`. The Tracker entry the pause made stays open, and the Overview still lists it under "Waiting for the client"; only Resume closes it, and Resume is not offered once the project is completed.
- Fix idea: when a paused project moves to completed or archived, close its pause entry as Resume does, or ask to resume first.

### PRJ-18 The Overview says "nothing needs attention" while the tasks still load
- Type: ADHD
- Severity: LOW
- Where: src/features/project/overview/OverviewTab.tsx:282 and :131
- What happens: while `tasks.list` loads, `rows` is `[]`, so Attention shows the all-clear sentence, Standing shows 0 of 0 tasks, and every person shows "No open tasks". Then the real lists replace them. On a slow link the screen flashes a false "all clear".
- Fix idea: render the three panels only after `tasks.data` exists (a quiet placeholder until then).

### PRJ-19 A client item in Overview opens the Tracker tab, not the item
- Type: GAP
- Severity: LOW
- Where: src/features/project/overview/OverviewTab.tsx:118-122 and :177
- What happens: the row is labelled "Open <title>", but the press only switches to the Tracker tab. The person must find the same entry again in the list. The open entry is local state in TrackerTab (TrackerTab.tsx:34), so it is not in the link either.
- Fix idea: keep the open entry in the link (`entry=<id>`) and set it from the Overview row.

### PRJ-20 Resume shows twice on a paused project
- Type: ADHD
- Severity: LOW
- Where: src/features/project/PausedBanner.tsx:31-33, src/features/project/ProjectActions.tsx:146
- What happens: the banner has a Resume button and the "…" menu has a Resume item. Two places for one action.
- Fix idea: keep the banner button and hide the menu item while the banner shows.

### PRJ-21 "Make leader" is one tap with no Undo and no confirmation
- Type: ADHD
- Severity: LOW
- Where: src/features/project/team/TeamTab.tsx:30, src/features/project/ProjectActions.tsx:20
- What happens: in the Team tab, each member's menu starts with "Make leader". One tap hands the project over and the old leader loses the right to undo it (plan clarification 6 removed the Undo for that reason). Nothing replaced the Undo, so a mis-tap needs the Admin to repair it.
- Fix idea: route it through the existing Change leader sheet (pick, then Save), or keep the Undo for the Admin.

### PRJ-22 Filters reset when the person leaves the tab
- Type: ADHD
- Severity: LOW
- Where: src/features/project/tasks/TasksTab.tsx:21-22, src/features/project/overview/ActivityTab.tsx:17, src/features/project/tracker/TrackerTab.tsx:33
- What happens: Show (Mine, Past due, Flagged), Show done tasks, the feed filter and the Tracker filter are local state. A trip to another tab, a reload or Back puts them back to All. The board/list choice is kept, so the screen is half remembered.
- Fix idea: keep these values in the link, as Projects and Dashboard do.

### PRJ-23 A stage with only one date shows "No dates"
- Type: BUG
- Severity: LOW
- Where: src/features/project/schedule/ScheduleTab.tsx:135 and :214, src/features/project/StageControl.tsx:32-34
- What happens: a stage with a start date and no end date (or the reverse) draws no bar and reads "No dates" to everyone who cannot edit, although one date is set.
- Fix idea: show "Starts <date>" or "Ends <date>" when only one is set.

### PRJ-24 The task panel lists its files as names only
- Type: GAP
- Severity: LOW
- Where: src/features/project/tasks/TaskSheet.tsx:306-311
- What happens: the Files section shows each file name as text. No open, preview or download, and no way to add a file there (only through a Conversation message).
- Fix idea: reuse `FileChips` (download) and the Files tab preview.

### PRJ-25 The Tracker type picker says "radio" but the arrow keys do nothing
- Type: BUG
- Severity: LOW
- Where: src/features/project/tracker/QuickLog.tsx:98-116
- What happens: five buttons carry `role="radio"` inside `role="radiogroup"`, and each is its own Tab stop. A screen reader announces a radio group, but Left and Right do not move the choice (spec 10.9: everything works with a keyboard, as the WAI radio pattern expects).
- Fix idea: add arrow-key handling with one Tab stop, or drop the radio roles and use `aria-pressed` buttons.

## Unconfirmed
- Escape while the Title or Description field of the task panel has focus may close the panel without the `onBlur` save (TaskSheet.tsx:232-234, :299-301). React does not fire `onBlur` on unmount; the Vaul exit animation may or may not move focus first. Not proved in jsdom.
- A same-name upload from a task comment adds a version to the existing file and keeps that file's old `taskId` and `stageId` (src/api/handlers/files.ts:90-97), so the task panel's Files list would not show it. API area; not run.
- The task panel's agent Undo uses its own rule (`detail.viewerCan.review || actingForId === me`, TaskSheet.tsx:194) while the feed uses the API's `canUndo`. For an agent that acts for a Member, the button can show and then be refused. The sample agent acts for the Admin, so I could not trigger it with sample data.
- Phone layout (390 px) and Big screen were checked by reading the classes only, not by screenshot.

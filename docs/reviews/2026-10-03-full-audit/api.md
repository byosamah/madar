# API and business rules audit

Scope: `src/api` (handlers, store, permissions, events, notify, views, contract, client, flow, pause, chat state), `src/data/migrate.ts`, `src/data/shift.ts`, `src/data/seed.ts`, and the rule helpers in `src/lib`.

Method: I read every handler and rule helper end to end. I proved each finding with a probe test against the real `calls` and `testApi` world (probes in `scratchpad/audit/api-probe/`, run with `npx vitest run --root ~/dev/madar --config <probe config>`). The existing suite passes (692 tests in `src/api`, `src/lib`, `src/data`). The sample data passes every contract schema and my invariant checks.

World used in the steps: project prj_001, leader Faisal (usr_002), team member Sara (usr_003), Admin Hala (usr_001), and Omar (usr_004), who is not on the project. Today is Wed 30 Sep 2026 unless a step says otherwise.

## Findings

### API-1 A member cannot undo their own tick when it moved another person's task
- Type: BUG
- Severity: HIGH
- Where: src/api/handlers/history.ts:235 (story undo checks every event), src/api/handlers/history.ts:99-110 (task rights per event), src/api/flow.ts:88-105 and src/api/flow.ts:114-141 (side effects written in the same story)
- What happens: Sara owns task A, due Thu 24 Sep. Faisal owns dynamic task B, which needs A. Sara ticks A on 30 Sep -> B moves 4 working days, Madar posts a date message on B and logs a Tracker entry. Sara presses Undo in the toast -> `events.undoStory` fails with `forbidden {action: task.updateOwn}`, and nothing comes back. The same failure happens when Sara drags her done task back to To do and Faisal's done task reopens with it, and when Sara opens a new version of such a task. The toast offers Undo for 5 seconds (spec 5.5, 11.5), and spec 17.5 says a person undoes their own changes. Sara cannot fix the mistake: unticking does not move B back (see API-3).
- Fix idea: In a story, check the right of the change the person made. Accept the automatic follow-on changes (reopened dependents, shifted dates, the Madar date message, the shift Tracker entry) under that right, for example by marking them as follow-on events.

### API-2 A saved office from a newer or rolled-back build is wiped with no warning
- Type: BUG
- Severity: HIGH
- Where: src/data/migrate.ts:66, src/app/bootstrap.ts:16-20
- What happens: A browser holds an office saved at version 7, or a deploy reverts a merge that raised `STATE_VERSION` (the colleague-comments file plans such reverts, for example `git revert -m 1 3b26c75`). On load, `migrateState` returns null -> `persister.clear()` deletes the office and every file -> the 12 sample projects replace it. Probe: a saved project "MY REAL PROJECT" at version 7 is gone after `bootstrap`. Any read error from IndexedDB takes the same path (`load().catch(() => null)`). The person gets no message.
- Fix idea: Never clear on an unknown version or a read error. Keep the saved copy under a backup key, run in memory, and show the existing "not saved" banner. Seed only when nothing is saved.

### API-3 Finishing a task twice shifts its dependents twice
- Type: BUG
- Severity: MEDIUM
- Where: src/api/handlers/tasks.ts:100, src/lib/stageFlow.ts:90-105
- What happens: Today Wed 23 Sep. Task A is due Mon 21 Sep. Dynamic task B starts Sun 27 Sep and needs A. Sara ticks A -> B moves 2 working days to 29 Sep (correct). Sara unticks A, then ticks it again the same day -> B moves 2 more days to 1 Oct. B now carries 2 date notes and the Tracker holds 2 "moved" entries, for 2 days of lateness. Unticking A does not move B back. Owner decision O4 says the dependent moves by the days the prerequisite was late.
- Fix idea: Shift from the dates B had before any shift by A (the first `dateNotes` entry with `byTaskId` A), not from B's current dates. Or move B back when A reopens.

### API-4 Review time is written up as the owner's lateness
- Type: BUG
- Severity: MEDIUM
- Where: src/api/handlers/tasks.ts:445 (approve runs the late shift), src/api/flow.ts:114-141, src/lib/stageFlow.ts:65-69
- What happens: Sara sends "Ground floor plan" to review on its due day, Mon 28 Sep. Faisal approves on Thu 1 Oct -> the dependent moves 3 working days. Its Conversation and the client Tracker say "Ground floor plan finished 3 working days late". Spec 4.2 says a task in review is not overdue, so Sara was on time. The Tracker is the client log that the office exports.
- Fix idea: Measure lateness to the day the owner finished (the day it entered review). If the office wants review delay to move dependents, word the note as review time, not as a late finish.

### API-5 Undo does not bring back the health override the change cleared
- Type: BUG
- Severity: MEDIUM
- Where: src/api/flow.ts:169 (a stage move clears the override), src/api/events.ts:14-16 (the stage event is "derived" and not undone), src/api/flow.ts:177-184 (`resyncStage` does not restore it)
- What happens: Faisal sets the health to Late with the reason "Client changed the brief". Sara ticks the last open task of Concept -> the stage tag moves -> the override clears. Sara presses Undo -> the task opens again and the tag goes back, but the override stays empty. Faisal's setting and reason are lost. The focus rule says Undo restores exactly what changed.
- Fix idea: Record the override and `stageBack` values that `watchStage` clears as an undoable event in the same story, or have `resyncStage` restore them from the derived event's `before`.

### API-6 A team member cannot undo their own link change
- Type: BUG
- Severity: MEDIUM
- Where: src/api/handlers/history.ts:86-92 (every other project event needs `project.edit`), src/api/handlers/projects.ts:282 (adding a link needs only `content.post`)
- What happens: Sara adds a moodboard link -> the toast offers Undo -> `events.undoStory` fails with `forbidden {action: project.edit}`. The same applies to her link edits and removals. src/features/project/overview/ProjectLinks.tsx shows the Undo toast for all three.
- Fix idea: In `assertMayUndo`, map a `project.updated` event that changed only `links` to `content.post`.

### API-7 A deactivated leader still gets every review request
- Type: BUG
- Severity: MEDIUM
- Where: src/api/notify.ts:36-40, src/api/handlers/people.ts:194-205, src/api/handlers/shared.ts:85
- What happens: Hala deactivates Faisal, who leads prj_001. Sara finishes a task that needs review -> it goes to In review -> `reviewersOf` returns only Faisal, `notify` skips him because he is inactive -> nobody gets a notice. Hala's `tasks.list` with `review_for_me` is empty. The project keeps an inactive leader, and the API still accepts the inactive person as a task lead, helper or replier, because `ensureOnTeam` returns early for anyone on the team.
- Fix idea: In `reviewersOf`, fall back to the active Admins when the leader is inactive. On deactivation, warn about led projects and open tasks, or refuse until they are handed over. Refuse inactive people as lead, helper or replier.

### API-8 Completing or archiving a paused project keeps the pause and its open client item
- Type: BUG
- Severity: MEDIUM
- Where: src/api/handlers/projects.ts:208-218, src/features/project/ProjectActions.tsx:137-145
- What happens: Faisal pauses prj_001 as "Awaiting client" -> a Tracker item "Waiting for the client" opens. On the paused project the "…" menu offers Completed and Archived. Faisal picks Completed, later Reopen -> the project is Active, still holds the old `pause`, and the Tracker still shows the item as waiting for the client. The Overview and the meeting agenda then show the project as waiting for the client. Through the API, `projects.setStatus` with `on_hold` also pauses a project with no reason and no pause record, against owner decision D7 (a pause needs a reason).
- Fix idea: Refuse `on_hold` in `projects.setStatus`. When the status leaves `on_hold`, do what `projects.resume` does: clear `pause` and close its open client item.

### API-9 Reply tasks skip the task rules
- Type: BUG
- Severity: MEDIUM
- Where: src/api/handlers/tracker.ts:80 (stage), src/api/handlers/tracker.ts:76-89 (no stage watch), src/api/handlers/tracker.ts:170-173 (close finishes the task by hand), src/api/handlers/tracker.ts:199-201 (wait removed)
- What happens:
  1. Faisal makes the reply task need another open task. `tasks.complete` refuses with `prerequisite_open` (correct). `tracker.close` on its entry then marks the reply task Done anyway, which breaks owner decision O2.
  2. `tracker.close` changes the status without the stage watch. When the reply task was the last open task of its stage, the tag moves forward, but no "stage changed" event or notice is written, the health override stays, and the saved `currentStageId` stays behind.
  3. `openReplyTask` puts the new task in the saved `project.currentStageId`, not the computed tag. With a stale saved stage (after step 2, or in an office saved before the tag became automatic on 2 Oct), the reply task opens in a finished stage. The tag moves back to it with no reason and no Overview note. Probe: tag Schematic Design -> Concept after one reply task, `stageBack` null.
  4. When someone edits the entry to "not waiting", the reply task stays open in the person's list and turns past due. A past-due task makes the project "At risk".
- Fix idea: Close the reply task through `changeStatus` inside a `watchStage`. Open it in `stageTag(...)` with a `watchStage`, as `createTask` does. Close or unlink the reply task when the wait is removed.

### API-10 The daily date shift skips some time fields
- Type: BUG
- Severity: MEDIUM
- Where: src/data/shift.ts:12-13, src/app/bootstrap.ts:21-23
- What happens: Each new day, `shiftState` moves every date by the days since the last load, but only for the field names in its two lists. `chatReads.lastReadAt`, `pause.at`, `stageBack.at`, `dateNotes[].at`, `versions[].openedAt` and `finishedAt`, feedback `doneAt` and `pause.resumeOn` do not move. Results:
  1. Sara reads the project chat. Next day the message times move one day later but her read mark does not -> the message is unread again (probe: unread 0 -> 1). This repeats every morning, so the chat badge shows old messages as new.
  2. The sample client pause ("12 days ago", stale limit 30) turns "Stale" after 19 days of use, while its Tracker item still reads 12 days old.
  3. Version history and date notes show times that drift away from the task dates.
- Fix idea: Add `lastReadAt`, `at`, `openedAt`, `finishedAt`, `doneAt` to the stamp list and `resumeOn` to the day list. Also decide with the owner if real work typed by the team should shift at all.

### API-11 A task due on Sunday gets its "due tomorrow" reminder only on Saturday
- Type: BUG
- Severity: MEDIUM
- Where: src/api/notify.ts:50-70 (line 59)
- What happens: A task is due Sun 4 Oct. `runScheduledTriggers` makes no reminder on Thu 1 Oct (the last working day) and none on Sun 4 Oct. It makes one only on Sat 3 Oct, a day off. In the prototype the triggers run only while the app is open, so a person who opens Madar on Sunday gets no reminder at all. About one task in five is due on a Sunday.
- Fix idea: Send "due next working day" on the last working day before the due date (Thursday for a Sunday task), with the same dedupe key.

### API-12 Every person can read every bug report through `events.list`
- Type: BUG
- Severity: MEDIUM (wrong permission in the contract; no screen shows these events today)
- Where: src/api/handlers/feedback.ts:53, src/api/handlers/history.ts:30-32
- What happens: Faisal sends a bug report "Private: my manager keeps changing my due dates". Omar (a member) calls `feedback.list` -> `forbidden`. Omar calls `events.list {targetType: 'feedback'}` -> he gets the full report text, page and sender. `events.list` hides only payment events. The Python build and the agent tools will copy this call.
- Fix idea: In `events.list`, hide `feedback` events unless the reader holds `admin.manage`. Better: one function decides which targets a person may read, used by `events.list`, `undo` and the feeds.

### API-13 Undo leaves the notices of the undone change, and the badge counts a blank item
- Type: ADHD
- Severity: MEDIUM
- Where: src/api/events.ts:99-137 (undo does not touch notices), src/api/handlers/notifications.ts:38-44 (`deletedCopy` reads only `*.deleted` events)
- What happens: Faisal adds a task for Sara and presses Undo at once. Sara's Inbox keeps an unread "task assigned" item with an empty title and nothing to open, and her badge shows 1. The same happens after an undone mention, review request or stage move. For a person with ADHD, a badge for a thing that does not exist is a false alarm that they cannot clear by doing the work.
- Fix idea: When an undo removes the target, delete the notices that the undone events created (same story ID). At the least, leave them out of the badge and take the title from the creation event.

### API-14 A move back to an earlier stage can no longer be logged in the Tracker as a Balady update
- Type: GAP
- Severity: MEDIUM (ask the owner: decision O3 replaced the hand-picked stage but did not drop this option)
- Where: src/api/flow.ts:153-174, src/features/project/tasks/StageBack.tsx:43-71; removed in commit 0f2b7ec together with `projects.setStage` and its `logInTracker` input
- What happens: Decision D3 approved "an optional tick box logs it in the Tracker as a Balady update". Today the "moves the project back" sheet asks only for a reason, and no call can log the move in the Tracker.
- Fix idea: Add an optional `logInTracker` to the calls that pass a stage-back reason (`tasks.create`, `tasks.update`, `tasks.move`, `tasks.newVersion`), and a tick box in the stage-back sheet.

### API-15 Each automatic stage move notifies the whole team
- Type: ADHD
- Severity: LOW
- Where: src/api/flow.ts:171
- What happens: Faisal adds a task to Concept (an earlier stage, with a reason) and ticks it a minute later. Sara gets two "stage changed" items for one small action. With the automatic tag, every task that opens or closes the earliest open stage notifies every team member. The badge does not count these items, but they fill the Inbox list.
- Fix idea: Notify only on a forward move, or merge moves of one project into one item per day.

### API-16 `files.upload` with `asCover` accepts a file that is not a picture
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/files.ts:83 and :104-106, compare src/api/handlers/projects.ts:184
- What happens: An upload of `contract.pdf` with `asCover: true` sets the PDF as the cover. `projects.update` refuses the same file ("The cover must be an image."). The New Project sheet limits its picker to pictures, so a person reaches this only by picking "All files"; an agent reaches it directly.
- Fix idea: Apply the same image check in `files.upload` when `asCover` is true.

### API-17 Deleting a project leaves its Tracker entries and all its file data
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/projects.ts:366-390; `Persister.deleteBlob` is never called anywhere
- What happens: Faisal logs a meeting, then Hala deletes the project -> the Tracker entry stays in the office with no project (probe: 1 entry left). The stored file data of every version stays in IndexedDB forever. The Python build would hold rows that point to a deleted project.
- Fix idea: Drop `trackerOf(state)` entries of the project with the payments. Delete the file data of a deleted project after the delete, since it cannot be undone.

### API-18 The restart date of a pause does nothing when it passes
- Type: GAP
- Severity: LOW
- Where: src/api/handlers/projects.ts:228-253, src/api/notify.ts:50-71, src/features/project/PausedBanner.tsx:27
- What happens: Faisal pauses a project with the restart date 3 Oct. On 10 Oct the banner still says "Restarts on 3 October". Nothing reminds Faisal, and the project stays paused.
- Fix idea: On the restart day, send the leader a notice with a one-press Resume, and show "Restart date passed" in place of the old date.

### API-19 `reactions.toggle` changes a comment but writes no event
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/content.ts:161-172
- What happens: An agent adds 👍 to a comment -> the comment changes, but the log has no event with the agent and the person it acts for. Spec 11.3 step 4 and spec 17.2 ask for one event, with two names, for each change.
- Fix idea: Write a `comment.reacted` event with the before and after reaction lists.

### API-20 `events.list` compares the "since" time as text
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/history.ts:37
- What happens: The contract accepts any time offset. An agent sends `since: '2026-09-30T06:00:00.000Z'` (09:00 office time) -> an event at `08:00:00+03:00` (before the meeting) comes back, because the text compare puts "08" after "06". The meeting screen sends office time, so the screen is correct today.
- Fix idea: Compare `Date.parse` values, or accept only `+03:00` stamps.

### API-21 `tasks.create` refuses a team member who sends the default review setting
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/tasks.ts:193
- What happens: Sara calls `tasks.create` for herself with `needsReview: true` (the default value) -> `forbidden`. Any value of `needsReview`, even the safe one, needs leader rights. The screens leave the field out, but an agent that sends a full task body is refused.
- Fix idea: Ask for `task.updateAny` only when `needsReview` is false.

## Unconfirmed
- Team members can assign a reply task to another person (`tracker.log` with `replyBy`, `tracker.assignReply`). Spec 2.3 gives "create a task for anyone" to the leader and the Admin only. A comment in src/api/handlers/history.ts:100 suggests this is on purpose, but I found no owner decision that says so.

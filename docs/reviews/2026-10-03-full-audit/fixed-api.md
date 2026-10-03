# Fixed: the fake API and the data rules

Branch `fix-api` in `/Users/osamakhalil/dev/madar-fix-api`. Last commit `6b01076`. Full suite: 143 files, 1303 tests, all pass (clean run at a load average of about 8). `tsc`, `check-rtl` and `vite build` pass.
Test note: at a load average of about 82 (all fixers running), 1 to 4 screen tests timed out on their first render, a different set each run. Each of those files passed alone, and the later clean run confirms it was load.

## Findings

API-1 | Fixed | 0edbb62 | A story Undo accepts the follow-on changes (a reopened task, a moved date) under the right of the change that caused them, so a team member can undo their own late finish, reopen or new version.
API-2 | Fixed | e274a25 | An office from a newer build, or one that cannot be read, is never cleared: Madar runs in memory with the "not saved" banner and leaves the saved copy untouched.
API-3 | Fixed | 3e91cf0 | A task that finishes late again moves its dependent only by the days it did not move it yet (from the last date note of that task), so untick and tick no longer move it twice.
API-4 | Fixed | 3e91cf0 | Lateness is measured to the day the owner sent the task to review, so review time is not written up as the owner's lateness.
API-5 | Fixed | 0edbb62 | When the Undo brings the stage tag back, the stage move of the story is taken back too, so the health override and the "moved back" note return.
API-6 | Fixed | 0edbb62 | Undo of a project change that touched only links needs the right to post, so a team member can undo their own link change.
API-7 | Fixed | 4f6c21d | Reviews go to the active Admins when the leader is inactive, and an inactive person cannot be named as a new lead, helper or replier (reason `person_inactive`); the deactivation warning is a question below.
API-8 | Fixed | 7c4feb6 | `projects.setStatus` refuses `on_hold` (reason `pause_needs_reason`), and a paused project that leaves the pause by another status ends it as Resume does.
API-9 | Fixed | 4f6c21d | `tracker.close` and an entry that stops waiting for our reply finish the reply task through the normal status change inside a stage watch, and a new reply task opens in the stage tag.
API-10 | Fixed | 687588e | The daily shift also moves `lastReadAt`, `at`, `openedAt`, `finishedAt`, `doneAt` and `resumeOn`; whether typed work should shift is a question below.
API-11 | Fixed | 687588e, 6b01076 | The "due" reminder goes out from the last working day before the due day (Thursday for a Sunday task), and it names the day: the notice keeps `dueDate`, the Inbox view sends it, and the Inbox writes "“<task>” is due on Sunday 4 October" (Arabic with the weekday).
API-12 | Fixed | 0edbb62 | `events.list` hides feedback events from everyone without `admin.manage`.
API-13 | Fixed | 0edbb62 | Notices now carry the story ID, and a story that is wholly undone deletes its notices, so no blank item stays in the Inbox or the badge.
API-14 | Skipped | - | Owner question: decision O3 removed the hand-picked stage, and nobody decided to keep or drop the Balady log option of D3.
API-15 | Fixed | 3e91cf0 | Only a forward stage move notifies the team.
API-16 | Fixed | 43c2356 | `files.upload` with `asCover` refuses a file that is not a picture before it stores the data (reason `cover_not_image`, also on `projects.update`).
API-17 | Fixed | 7c4feb6 | `projects.delete` drops the Tracker entries of the project, and a new `after` step of a call removes the stored file data of the project after the delete.
API-18 | Fixed | 687588e | On or after the planned restart day, the leader (or the active Admins) gets one `resume_due` Inbox notice; the office goes to version 7 so every person has the new setting.
API-19 | Fixed | 43c2356 | `reactions.toggle` writes a `comment.reacted` event with both names, and the person may undo their own reaction.
API-20 | Fixed | 0edbb62 | `events.list` compares `since` as a time with `Date.parse`, not as text.
API-21 | Fixed | 3e91cf0 | `tasks.create` asks for the leader's right only when `needsReview` is false.
PRJ-2 | Fixed | 3e91cf0 | A reviewer's Done on a task in review (status menu, board, tick) runs the approve path with its event and notice; a reviewer's move back is refused with reason `review_send_back`.
PRJ-3 | Fixed | 7c4feb6 | The project detail counts open tasks a member leads or helps on, and `members.remove` gives reason `member_has_open_tasks` with its own sentence.
PRJ-6 | Fixed | 43c2356 | A post item in the feed carries `attachments` (the comment shape, a null name for a deleted file).
PRJ-16 | Fixed | 43c2356 | Each `FileView` carries `canDelete` from the same rule as `files.delete`.
PRJ-17 | Fixed | 7c4feb6 | Same fix as API-8: Completed or Archived on a paused project closes its pause and its open client item.
BRW-4 | Fixed | c7cdf1b | A new step `settleFuture` (in `src/data/shift.ts`, same field list as the daily shift) moves every stamp later than the load time to just before it, in the same order and day; bootstrap runs it after the seed and after the shift, and the sample reset runs it too.

Found on the way and fixed (43c2356): Undo of a comment edit was always refused, because the reference check expected a whole comment. It now works.

## Questions for the owner

Rulings from the controller (no change needed): API-10 keeps shifting everything; API-4 stays as fixed; PRJ-2 keeps the owner's pull-back; API-9 Done is right; API-18 has no one-press Resume for now; API-11 words now name the day (done in 6b01076). Questions 1 and 2 go to the owner.

1. API-14: Decision D3 approved a tick box that logs a move back in the Tracker as a Balady update. The new automatic stage tag removed it. Do you want it back?
2. API-7: When an Admin turns off a person who leads projects or holds open tasks, should Madar warn, or refuse until the work goes to someone else? Today it only sends reviews to the Admins and refuses that person for new work.
3. API-10: Should work that the team typed (comments, Tracker entries, read marks) move with the daily date shift, or only the sample data?
4. API-4: Time in review no longer moves the tasks that wait. Should review time move them too, with a note that says "review time", not "finished late"?
5. API-11: The reminder goes out on Thursday for a Sunday task, but the words still say "due tomorrow". Should they say "due on the next working day"?
6. PRJ-2: The owner may still pull their own task back from review (an existing test asks for this). Keep that, or should only the reviewer move a task out of review?
7. API-9: When an entry stops waiting for our reply, its open reply task becomes Done, with no reply logged. Is Done right, or should the task be deleted?
8. API-18: The restart notice counts in the badge and opens the project, where Resume is. Do you want a one-press Resume button on the Inbox item, like Approve?

Merge notes for the controller: `STATE_VERSION` is now 7 (migration step 6 to 7 in `src/data/migrate.ts`). `CallDef` has a new optional `after` step (`src/api/registry.ts`, `src/api/client.ts`). `src/api/handlers/tracker.ts` now imports from `flow.ts` and `tasks.ts` (an import cycle that vitest and vite build accept). `src/features/projects/feed.test.ts` got one field (`attachments: []`).

## Screens that changed

- `/notifications` (Inbox): a paused project on or after its restart day shows "<project> reached its planned restart date" and counts in the badge. Undo of a new task no longer leaves a blank item.
- `/settings`: a new notification switch "A paused project reaches its restart date", and the due switch now reads "My task is due the next working day".
- `/notifications` (Inbox), due reminder: "“<task>” is due on Sunday 4 October" in place of "is due tomorrow" (Arabic: "«<task>» مستحقة يوم الأحد، 4 أكتوبر").
- `/projects/<id>?tab=team`: the open-task count includes tasks the person helps on; Remove on such a person shows "This person still has open tasks here. Give their open tasks to someone else first."
- `/projects/<id>?tab=tasks` (board, task panel, status menu): a reviewer who drags an In review task to Done approves it (the owner gets "approved"). A reviewer who drags it back gets "This task is in review. Use Send back and write a note for the owner."
- `/projects/<id>` "…" menu on a paused project: Mark completed or Archive closes the "Waiting for the client" item (Overview list and Tracker tab).
- `/projects/<id>?tab=tracker`: closing an entry whose reply task waits for another task shows "Finish <task> first."; setting an entry to "not waiting" marks its reply task Done.
- New project sheet and project cover upload: a file that is not a picture shows "The cover must be a picture."
- Any screen after a toast Undo of a late finish by a team member: the leader's moved task goes back, and a health override cleared by the stage move comes back.
- Storage banner ("Changes will not be saved in this window.") shows when the saved office comes from a newer build.
- Dashboard meeting, chains panel: a dependent that already moved for a task shows only the new days.
- BRW-4, open the app before 09:35 office time with fresh sample data (or after "Reset sample data"): `/inbox` shows no seed chat as "now" above a new chat, and a meeting started then has a summary with only its own changes (no "09:35 ... added the task" lines from other projects).
- API only, screens done by the project fixer: post `attachments` (Activity feed) and file `canDelete` (Files tab).

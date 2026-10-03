# Fix wave 2, group C: app frame, shared parts, chat, notifications, settings, words

Branch `w2-shell` in `/Users/osamakhalil/dev/madar-w2-shell`, last commit `a3ba659`. 15 items: 15 fixed, 0 not a bug, 0 skipped.
Final checks: full suite 151 files, 1436 tests, all pass; `tsc --noEmit` clean; `check-rtl` passed.

## Items

V-1 | fixed | eee44ea | The meeting Done toast now sets `isUndo`, and `isUndo` is now a required boolean on every toast action, so Ctrl+Z after Done takes back Done and keeps the decision (6 other callers now say `isUndo: false`).
V-15 | fixed | cfba730 | The toast stack notes which toast holds the pointer or the focus and ends that hold when that toast goes away, so the other toasts time out again.
V-16 | fixed | b701a42 | `useUndoable` takes a new `onUndo` step that runs after a good Undo; the notice row uses it to call `notifications.markUnread` when the notice was unread before Approve.
V-26 | fixed | 69faa2c | The Mark all read toast says "Marked 2 notifications as read." (new key `inbox.markedRead` with all Arabic plural forms); "All caught up." stays in the files.
V-25 | fixed | aa8a278 | The chat says "Inactive" / "غير نشط" (feminine "غير نشطة"), and the closed chat and its refusal say "This person is inactive. This chat takes no new messages." (also the API message).
V-27 | fixed | aa8a278 | The Reset question now says it removes everything you added or changed in this browser, also your name, language and notification choices, with no Undo.
V-28 | fixed | aa8a278 | `settings.triggers.overdue` in Arabic is now "تجاوز مهمتي موعدها".
V-19 | fixed | aa8a278 | `dashboard.meeting.personLate_two` in Arabic is now "اثنتان تجاوزتا موعدهما".
V-29 | fixed | d4ddcd6 | The Arabic reminder test starts i18n itself, so it passes alone and in any order.
V-34 | fixed | 1a6415e | The wrong-link and broken-screen page shows a ScreenTitle (h1) above its empty state, as the project error state does.
V-31 | fixed | 19091fb | Each line of the sliders icon now starts from its "normal" variant; with no start value, a re-render in the same moment as the first animation wrote x1/x2="undefined" (checked in Chromium: 0 errors, the icon still moves).
V-8 | fixed | be0f39a | `renderApp` uses `history.replaceState` in place of a hash set, so jsdom fires no late popstate; the full suite ran twice after it, and the only failures were load timeouts that pass alone.
V-22 | fixed | 647fe61 | New `src/app/drafts.ts` puts the person's ID in every draft key (text and picked files), the chat box and the comment thread start again on a change of person, and the app shell deletes the drafts of everyone but the current person.
V-10 | fixed | 4a9de8a | The sheet notes its opener and the panel that held it as it opens (Radix skips this when autoFocus takes the focus first); on close, when the focus is lost, it goes to the opener, its rebuilt copy with the same id, that panel, or the page title, never the body.
V-11 | fixed | a3ba659 | The toast region notes each pointerdown that starts on it, and the sheet asks about that same event, because Radix decides at the click when React has already removed the toast; new Playwright spec `tests/e2e/toastUndo.spec.ts` proves it at 390 x 844 with touch.

## Notes for the controller

- V-11 proof: `tests/e2e/toastUndo.spec.ts` has 3 tests (click on Undo, tap on Undo, a tap outside still closes). It failed 2 of 2 before the fix and passes 3 of 3 after. I ran it against my own dev server, not the repo config: the repo config reuses any server on port 4173, and another group can have its build there.
- V-10 browser check (Chromium, my dev server): the stage-back sheet gives the focus back to "From a template in Design Development" at 1440 and 390 px. The due-date reason sheet gives it to the rebuilt Due date field (`#task-due`) at 1440 px.
- V-1 touches files of other groups by one property each (`isUndo: false` or `true`): `src/features/dashboard/meeting/AgendaBar.tsx`, `src/features/project/files/FilesTab.tsx`, `src/features/projects/NewProjectSheet.tsx`, `src/features/search/NewTaskSheet.tsx`. A new toast action from another branch that has no `isUndo` will fail `tsc` after the merge. That is on purpose: add `isUndo: true` for an Undo, `false` for anything else.
- V-22 renames nothing shared, but `Composer` (Thread.tsx) and `CommentThread` now render nothing until `session.get` has loaded (a few milliseconds at app start).
- Machine load: two full runs during the work had timeouts on first renders (load average up to 161). Each failed file passed when run alone. The final full run passed 1436 of 1436.

## Questions for the owner

1. Both error pages (wrong link, and a project that does not exist) now show the same title twice: as the page title and again in the card. Should the card drop its own title, so the words show once?
2. V-22 deletes a person's unsent words when another person becomes current (Preview as, or Reset). An Admin who previews as someone else and comes back loses a half-typed message. Is that right, or should drafts stay per person and only stay hidden from others?
3. On a phone, the stage-back reason sheet still puts the focus in its text box (its `autoFocus`), so the keyboard opens over the sheet. Every other sheet focuses its title on a phone. That code is in the project screen (StageBack.tsx, group B). Should it follow the phone rule?
4. The `arrow-right` animated icon has the same pattern as the V-31 icon (an animated `d` with no start state). Nobody saw an error from it. Fix it the same way?
5. The key `inbox.allRead` ("All caught up.") is now used nowhere. Keep it for a future empty state, or delete it?

## Screens that changed

- `#/dashboard/meeting?mode=projects`: add a decision, press Done, press Ctrl+Z. The project comes back as not discussed, and the decision stays. The Done toast's Undo now has the Ctrl+Z shortcut.
- Any screen with two toasts (for example, tick two tasks fast): move the mouse over the first toast and press its Undo, then leave the mouse still. The second toast closes after 5 seconds.
- `#/notifications` as Faisal (usr_002): Approve a review notice, then Undo. The notice is unread again and the bell counts it.
- `#/notifications`: press Mark all read. The toast says "Marked N notifications as read." (Arabic "تم تعليم N إشعارات كمقروءة.").
- `#/inbox`, direct chat with an inactive person (Admin, turn off Faisal): subtitle "Inactive", and the line "This person is inactive. This chat takes no new messages." In Arabic: "غير نشط" and "هذا الشخص غير نشط. لا تقبل هذه المحادثة رسائل جديدة."
- `#/settings`, Reset sample data: the question text is new (English and Arabic).
- `#/settings` in Arabic, notification switches: the past-due switch says "تجاوز مهمتي موعدها".
- `#/dashboard/meeting` in Arabic, people strip, a person with 2 past-due tasks: "اثنتان تجاوزتا موعدهما".
- `#/projectz` (any wrong link), 1440 and 390 px: a big page title "This page does not exist" now sits above the card.
- Any Filter button (for example `#/projects/prj_001?tab=tasks`): press Filter right away. The console shows no `<line> attribute` errors, and the icon still moves on hover.
- `#/inbox` and a task panel's Conversation, with Settings > Preview as: type a message or comment, switch person. The box is empty for the new person.
- `#/projects/prj_001?tab=tasks`, 1440 px: "From a template in Design Development" > first template > Escape. The focus goes back to that button. Then `&task=tsk_007`: type a new Due date, Enter, Escape on "Why do the dates change?". The focus is on the Due date field.
- `#/projects/prj_001?tab=tasks&task=tsk_007` at 390 x 844 with touch: Conversation, post a comment, delete it, tap Undo on the toast. The comment comes back and the sheet stays open.

## Repair

Two reviewers found 4 problems in the group C diff. I confirmed all 4 in the code and with a failing test first. 4 fixed, 0 not real, 0 skipped. Branch `w2-shell`, last commit `db14cd4`.
Final checks: full suite 151 files, 1439 tests, all pass; `tsc --noEmit` clean; `check-rtl` passed.

V-22 repair | fixed | 893a9d9 | The project update box kept its text and picked files after Preview as, and the next person could post them. The app shell now keys the routed screen by a person turn that goes up only when one known person changes to another, so every form on the screen (update box, tracker QuickLog and the rest) starts empty for the new person. The first load of the session does not restart the screen.
V-27 repair | fixed | 2b33b2d | The Reset question said "everything that you added or changed", but Reset keeps the Simulate errors switch and the stored view choices. It now names what goes and what stays, in English and Arabic. A new test proves that the switch stays on after Reset.
V-26 repair | fixed | ff79d09 | The Mark all read toast took its count from the IDs cut to 200 for Undo. It now counts every notice that it marked (205 says 205), and Undo sends them back in groups of 200, so the toast number is also what Undo puts back.
V-34 repair | fixed | db14cd4 | The error pages said their title twice (h1 and the card h2). The EmptyState title is now optional; the wrong-link page, the broken-screen page and the project error state show the title once, as the page title.

### Notes for the controller

- V-22: the old owner keys in the chat box (Thread.tsx) and CommentThread stay. They are now extra, but harmless, and removing them would only add merge risk.
- V-22: one Inbox test ("shows a message from another person that arrives while the chat is open") sets the person to Faisal in the store for one send and back. That short change now restarts the screen, so the test asks for the message log again on each try. Its meaning is the same.
- V-22: Reset sample data while a preview is on also changes the person, so the Settings screen restarts. I checked the focus in that case: it goes to the page title "Settings", not to the page body.
- V-26: the Undo in groups of 200 goes one small step past the reviewer's fix. Without it, the toast would say 205 and Undo would give back only 200.
- V-34 touches `src/features/project/ProjectScreen.tsx` (group B's area) by one line, and its test file `ProjectScreen.test.tsx`. No other wave-2 branch changes those two files. I did not touch `ProjectAudit.test.tsx`, which group B changes.
- Owner question 1 (the title twice on the error pages) is now closed by the V-34 repair. If the owner wants the card title back, pass `title` to EmptyState again in the three error states.

### Screens that changed (repair)

- `#/projects/prj_001?tab=activity`: type an update and attach a file, then Preview as Faisal from the person menu. The update box is empty and shows no file.
- `#/settings`, Reset sample data: the question text is new in English and Arabic (it names what goes and that Simulate errors and view choices stay).
- `#/notifications` with more than 200 unread notices: Mark all read says the full number, and Undo makes all of them unread again.
- `#/projectz`, a broken screen, and `#/projects/prj_999`, at 1440 and 390 px: the title shows once at the top. The card under it has only the sentence and the link or button.

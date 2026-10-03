# Fixed: shell, chat, notifications, settings and admin, words (branch fix-shell)

Worktree: /Users/osamakhalil/dev/madar-fix-shell. Last commit: 0e99454. Base: 540a094.
Final run: `npx vitest run` 140 files, 1289 tests passed. `npx tsc -p tsconfig.json --noEmit` clean. `node scripts/check-rtl.ts` passed.

SHL-1 | Fixed | 82d8451 | A "…" menu inside an open sheet now draws inside that sheet (focus and pointer work), its place converts to the sheet's units, and Escape closes only the menu.
SHL-2 | Fixed | 82d8451 | Vaul 1.1.2 never passes `modal` to Radix, so the non-blocking panel on a computer is now a plain side panel (no trap, no aria-hidden page, page takes typing); phones keep the Vaul sheet.
SHL-3 | Fixed | 82d8451 | Ctrl+Z or Cmd+Z runs the newest Undo (not inside a text field), a toast keeps its time while hovered or focused, and a press on a toast no longer closes an open sheet.
SHL-4 | Fixed | ace4fb6 | The chat box keeps its text per chat in sessionStorage (same keys as the comment box, so a task thread and its task share one draft); picked files wait in memory.
SHL-5 | Fixed | 2894258 | Task threads count unread comments like chats (after my own last comment and my last read), the Inbox tab counts them, and `chats.markRead` takes a task id; opening the thread or the task panel reads it.
SHL-6 | Fixed | df6722b | A wrong link and a broken screen show a translated calm page with "Go to Home" inside the shell; a break in the shell or the meeting view shows the same page on its own.
SHL-7 | Fixed | c9bd1d2 | New call `users.reactivate` (same rules as Deactivate, undoable) and a "Reactivate" item for inactive people.
SHL-8 | Fixed | 65e6b1c | "Reset sample data" opens a sheet that says what is lost, with Cancel, like Delete project.
SHL-9 | Fixed | 8af2599 | The Kind field shows to the Admin only, and the row menu hides from Management for anyone with Admin rights (an Admin or an Admin's agent).
SHL-10 | Fixed | 66412ae | `useAction` and `useUndoable` remember the per-call steps with each input, and Retry passes them again (fixes the chat double post and the team forms).
SHL-11 | Fixed | 9c3c02b | The notice turns read in the approval's success step only.
SHL-12 | Fixed | b6b1198 | The badge leaves out notices of deleted items, and the list marks such a notice read once it shows it (screen side and badge rule only; fix-api owns deleting notices of undone changes).
SHL-13 | Fixed | b6b1198 | `notifications.list` returns every unread notice, also past the limit, then the newest read ones, in time order.
SHL-14 | Fixed | 85d6f1c | A direct chat notice has an empty target, and the screen says "mentioned you in a direct message" (Arabic feminine form added).
SHL-15 | Fixed | 1cb3a20 | Chat rows carry `personLeft`; the header says "Left the office", a line replaces the box, and `chats.send` refuses with reason `person_left`.
SHL-16 | Fixed | b946bd2 | "Mark all read" shows Undo, which calls the new `notifications.markUnread` for the cleared notices (read marks stay out of the shared event log).
SHL-17 | Fixed | 6fa77c5 | Template rows carry `createdByGender`, and `stageTemplates.savedBy` and `taskTemplates.savedBy` have `_female` forms (حفظته, حفظتها).
SHL-18 | Fixed | a817082 | SegmentedControl is one Tab stop with a roving tabindex and arrow keys (left arrow forward in Arabic); props unchanged.
SHL-19 | Fixed | 9793097 | The menu focuses the picture before the feedback sheet opens, so the focus comes back there.
SHL-20 | Fixed | d841389 | A popover closes when the focus lands outside it and its control, and the focus stays where the person put it.
SHL-21 | Fixed | de526d3, e0905d3 | A picked file with no words now sends with its file name as the words, the same way Share already does; no contract change.
SHL-22 | Fixed | 95b9f33 | The profile form uses the shared text field, so a refused name or discipline shows under the field.
SHL-23 | Fixed | bfbdf9d | Deleted the 21 keys from both files after a scan of this branch and, read-only, of the other four fix worktrees: no literal or dynamic use.
BRW-2 | Fixed | ad22442 | A blocking sheet gives the focus to its first field, or to its title (the title on a phone, so the keyboard does not cover it), and gives it back to the opening control on close; DateDraftField untouched.
BRW-5 | Fixed | c06db16 | Notifications part only: Approve uses the Undo toast, and each button's name is "Approve “<task>”" while the visible word stays Approve.
BRW-10 | Fixed | ce6e7fe | The round Inbox and bell links carry the count in their aria-label ("Notifications, 1 item needs action").
BRW-12 | Fixed | ce6e7fe | Added nav.inboxBadge_one and _other in English; Arabic got its plural forms in the same colon style, which the language parity test needs.
BRW-17 | Fixed | 24ff9b2 | The chat preview sits in its own bdi with its own cut-off, so an English line in Arabic keeps its full stop at the end and loses its end, not its start.
BRW-20 | Fixed | 0e99454 | index.html has an inline SVG favicon: an orbit ring with one dot, dark on light and light on dark.

Counts: 29 fixed (23 SHL, 6 BRW), 0 not a bug, 0 skipped.

## Notes for the merge

- New calls: `users.reactivate`, `notifications.markUnread`. They are in a new `AUDIT_CALLS` list in `src/api/calls.test.ts`; another branch that adds calls touches the same concat line.
- Contract changes (all additive): `ChatRow.personLeft`, `ChatRead.conversationId` also takes a task id, `chats.markRead` takes a task id, `StageTemplateRow` and `TaskTemplateRow` gain `createdByGender`, `notifications.list` may return more than `limit` when there are more unread notices.
- `src/api/handlers/notifications.ts`: my hunks are `counts()` (badge rule), the `notificationsList` body, the chat branch of `viewOf` (target), and a new `notificationsMarkUnread`. fix-api's API-13 work may also touch `counts()`.
- `src/api/handlers/people.ts`: one new function `usersReactivate` after `usersDeactivate`, and one line in `peopleCalls`.
- The sample office now shows Hala 2 task threads with a new comment, so the Inbox tab reads 5, not 3. Two Inbox tests changed to match.
- BRW-2: Radix gives the focus back only to a Dialog.Trigger, which the app does not use, so the Sheet now remembers and restores the opening control itself. Tests that expect the focus on a page control right after a sheet opens would now see it inside the sheet; none in this branch did.
- BRW-5: the task panel's Approve (src/features/project/tasks/TaskSheet.tsx) is the project fixer's part.
- A full run under a load average near 100 (four fixers at once) timed out up to 13 screen tests; all passed on rerun at normal load.

## Questions for the owner

1. SHL-21: a chat file with no words now goes with its file name as the words, as Share does. Is that right, or should a message allow no words at all? That needs the Message contract to change.
2. SHL-5: the Inbox tab count now includes task threads with new comments. Is that the count you want, or should task threads show only the mark on their row, so the tab count stays calmer?
3. SHL-12: a notice of a deleted item turns read as soon as the list shows it, with no press. Is that calm enough, or should the person press it?
4. SHL-16: the Undo of "Mark all read" uses a new call, not the event log, because read marks are private to each person. Should the Python build copy `notifications.markUnread` as is?
5. Not in my findings, but next to SHL-4: the feedback sheet still clears a typed report on Escape or a swipe down. Should it keep a draft the same way the chat box now does?

## Screens that changed

- Task panel on a computer, for example `#/projects/prj_001?tab=tasks&task=tsk_007`: the panel slides in from the end side with no dim layer; type in the Tasks quick-add field while it is open; Escape closes it and the focus goes back to the row.
- Task panel on a phone (390 px), same link: open the "…" of your own comment. The menu must open next to its button inside the sheet. jsdom cannot measure this, and the Chrome extension was not connected, so this place has unit tests only. Please screenshot it.
- Any Undo toast (for example tick a task): hover it and wait past 5 seconds; press Cmd+Z with the focus outside a text field.
- `#/settings`: clear Name and press Save (message under the field); press "Reset sample data" (a sheet asks first); Language and Theme choices move with the arrow keys.
- `#/projectz`: the "This page does not exist" page with "Go to Home", tabs still there. Also in Arabic.
- `#/admin`: an inactive person's menu shows "Reactivate". Preview as Turki (Management): no Kind field in Add person, no menu on Madar Assistant. In Arabic, templates read "حفظته Hala Nasser" and "حفظتها Hala Nasser".
- `#/notifications`: "Mark all read" toast with Undo; a mention in a direct chat reads "... mentioned you in a direct message".
- `#/inbox`: task thread rows show "Unread: 1" and the Inbox tab shows 5 for Hala; type a draft, open another chat, come back; pick a file with an empty box and press Send; deactivate Faisal in Admin, then open his chat ("Left the office", no message box).
- Person picture menu: Tab past the last item closes it; "Request a feature or report a bug" then Escape puts the focus back on the picture.
- Any blocking sheet, for example New Project or the meeting Agenda, opened with the keyboard: the focus lands on the first field or on the title; Escape puts it back on the button that opened it.
- `#/notifications` as a leader with a review waiting: Approve shows "Task approved." with Undo.
- The pill on a computer: the Inbox and bell icons have the count in their names (check with a screen reader or the accessibility tree).
- `#/inbox` in Arabic with your last message in English: "You:" then the whole English line, full stop at its end.
- The browser tab shows the orbit icon, and the console has no favicon 404.

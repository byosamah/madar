# Shell, chat, settings and words audit

Scope: `src/app`, `src/components`, `src/features/inbox`, `notifications`, `feedback`, `settings` (with Admin), `placeholder`, `src/i18n`, `src/design`. Commit 77d087a.

How I proved things: scratch Vitest files in `scratchpad/audit/vt/` (own config, root at `~/dev/madar`, jsdom, the repo's `src/test/setup.ts`). They import the real components and `renderApp`. Nothing in the repo changed. Re-run with:
`npx vitest run --config <scratchpad>/audit/vt/vitest.config.ts --silent=false`. The i18n checks are `audit/i18n_scan.py`, `audit/plural_scan.py` and `audit/render.mjs`.

## Findings

### SHL-1 A "…" menu inside a modal sheet cannot be used
- Type: BUG
- Severity: MEDIUM
- Where: src/components/Menu.tsx:132 (the list portals to `document.body`), src/components/Sheet.tsx:31 (`modal = phone || blocking`), used by src/features/comments/CommentThread.tsx:114 inside src/features/project/tasks/TaskSheet.tsx:219
- What happens: Open a task on a phone (the task panel is modal there). Press "…" on your own comment. The menu draws outside the sheet. Radix Dialog sets `pointer-events: none` on `<body>`, so the menu items inherit it, and the focus trap pulls the focus back to the "…" button. Proof (overlays.audit.test): body pointer-events = `none`, the menu is not inside the dialog, focus stays on the trigger, and user-event refuses the click ("element has pointer-events: none"). So Edit and Delete of a comment do not work on a phone. On a computer the task panel is not modal, so a mouse click works, but the menu never takes the focus, so the arrow keys and Enter do nothing.
- Fix idea: Portal the menu list into the nearest open `[role="dialog"]` (or the sheet content) instead of `document.body`, so it is inside the dialog's layer and focus scope.

### SHL-2 The "non-blocking" task panel traps the focus and hides the page from screen readers
- Type: BUG
- Severity: MEDIUM
- Where: src/components/Sheet.tsx:38 (with vaul 1.1.2: node_modules/vaul/dist/index.mjs:1341 passes no `modal` to Radix `Dialog.Root`, so Radix always runs as modal)
- What happens: On a computer, open a task panel and click inside it (title, comment box). Then click the quick-add field of the Tasks tab and type. The focus jumps back into the panel and the text goes nowhere. Proof (overlays2.audit.test): after a click inside the panel, a click on a page input leaves the focus on "Inside", and typing "abc" leaves the input value `""`. Tab never leaves the panel, and the page carries `aria-hidden="true"` for screen readers. The Sheet comment (line 11) and spec 5.4 promise that this panel "leaves the page usable".
- Fix idea: For `blocking={false}`, do not use the Radix modal path: render a plain side panel (or Radix Dialog with `modal={false}` set directly), so there is no focus trap and no `hideOthers`.

### SHL-3 The Undo in a toast cannot be reached by keyboard, and a press on it closes an open sheet
- Type: BUG
- Severity: MEDIUM
- Where: src/app/toasts.tsx:23-44, src/app/actions.ts:44-51
- What happens: Undo is the safety net for every change (spec 10.7: Undo replaces "Are you sure?"; Deactivate a person, Delete a team and others have no confirmation). (a) Keyboard: there is no Ctrl/Cmd+Z anywhere, and the toast is the last element of the page, so a keyboard user must Tab through the whole page in 5 seconds. Inside an open sheet it is impossible: proof (overlays.audit.test) `undo.focus()` returns the focus to the sheet, and 6 Tab presses stay in the sheet. Spec 10.9: everything works with a keyboard. (b) Mouse: in a modal sheet (every sheet on a phone), a press on Undo counts as a press outside the sheet. Proof (overlays2.audit.test): Undo runs, and the sheet gets `onOpenChange(false)`, so the sheet closes with anything typed in it.
- Fix idea: Add a Ctrl/Cmd+Z shortcut for the newest Undo toast, pause the 5-second timer while a toast has focus or hover, and stop a press on a toast from counting as "outside" (for example `onPointerDownOutside` that ignores the toast region).

### SHL-4 A typed chat message is lost when the person opens another chat
- Type: ADHD
- Severity: MEDIUM
- Where: src/features/inbox/ConversationPane.tsx:125-126 (`key={id}`), src/features/inbox/Thread.tsx:113-114 (the draft lives in component state)
- What happens: Type "Half a thought about the riser" in the Corniche chat, open Faisal's chat, come back. The box is empty (proof: app.audit.test, value `""`). Picked files are lost too. The same happens when the person presses another tab or Cmd+K (src/app/AppShell.tsx:61-70). Owner rule: nothing resets or loses work by accident.
- Fix idea: Keep one draft (text and picked files) per conversation id in a module-level map or `sessionStorage`, and restore it when the chat opens again.

### SHL-5 Task threads in the Inbox never show unread, and a plain comment on my task tells me nothing
- Type: GAP
- Severity: MEDIUM
- Where: src/api/handlers/chats.ts:75 (`unread: 0` for every task thread), src/api/handlers/chats.ts:91-93 (the tab count reads project and direct chats only); no `notify` call for a task comment without a mention
- What happens: Faisal writes "Please fix the door schedule" on Sara's task without an @mention. Sara's Inbox row for that task moves up, but it shows no unread mark, the Inbox tab count does not change, and the bell gets no notice. Only an @mention notifies. A person can miss feedback on their own task, although the Inbox lists task threads as chats.
- Fix idea: Keep read marks for task threads the same way as chat reads, and count them in `chats.unreadCount`. Or add a "comment on my task" trigger.

### SHL-6 A wrong link or a crash shows the router's English developer page, with no way back
- Type: GAP
- Severity: MEDIUM
- Where: src/app/routes.tsx:18-40 (no `*` route and no `errorElement`)
- What happens: Open `#/projectz`. The page shows "Unexpected Application Error! 404 Not Found 💿 Hey developer 👋 You can provide a way better UX..." (proof: app.audit.test). The tab pill and the person menu are gone, and an Arabic user sees English. Any render error in any screen shows the same page. Spec 11.6 asks for a calm empty or error state with one action.
- Fix idea: Add an `errorElement` on the root and shell routes and a `*` route that render a translated EmptyState with a link to Home.

### SHL-7 A deactivated person can never come back, and cannot be added again
- Type: GAP
- Severity: MEDIUM
- Where: src/api/handlers/people.ts:194-205 (deactivate), people.ts:166-176 (the update patch is strict and has no `active`), people.ts:103-106 (the email check counts inactive people), src/features/settings/admin/PeopleSection.tsx:58
- What happens: Admin or Management deactivates Sara by mistake and misses the 5-second Undo. Proof (api.audit.test): `users.create` with Sara's email is refused `email_taken`; `users.update` with `active: true` is refused "Unrecognized key". There is no other way back, so a colleague stays locked out, or comes back under a new email without their history. The later Python build copies this contract.
- Fix idea: Add `users.reactivate` (undoable, same permission rules as deactivate) and a "Turn on again" menu item for inactive people.

### SHL-8 "Reset sample data" wipes the whole office in one press
- Type: ADHD
- Severity: MEDIUM
- Where: src/features/settings/SettingsScreen.tsx:117-119, src/api/handlers/system.ts:8-24 (clears the persister, records no event)
- What happens: Settings > Prototype > "Reset sample data". One press deletes every project, task, message and screenshot the reviewer added in this browser. There is no confirmation and no Undo. Spec 10.7: Undo replaces confirmations, and only Delete project asks; this action has neither. Owner rule: nothing resets work by accident. (Not HIGH only because it is a prototype control.)
- Fix idea: Ask first, the same way as Delete project, and say what is lost.

### SHL-9 Management sees person actions that the API refuses
- Type: BUG
- Severity: LOW
- Where: src/features/settings/admin/PersonFormSheet.tsx:75-80 (the Kind select offers "Agent" to Management), src/features/settings/admin/PeopleSection.tsx:54 (the menu shows on the Admin's agent "Madar Assistant", because its role is `member`)
- What happens: As Turki (Management), add a person with kind Agent, or Deactivate Madar Assistant. Proof (api.audit.test): both are refused `forbidden` ("Only an Admin can add an agent.", "Only an Admin can change an Admin or the agent of an Admin."). The person sees an error toast after filling the form. Spec 11.6: screens hide actions the user may not do.
- Fix idea: Show the Kind field only to the Admin. Hide the row menu for any user who holds Admin rights (an Admin or an agent of an Admin).

### SHL-10 Retry after a failed send leaves the message in the box, so the next Send posts it twice
- Type: BUG
- Severity: LOW
- Where: src/app/runtime.tsx:54-68 (Retry calls `mutation.mutate(input)` without the per-call callbacks), src/features/inbox/ConversationPane.tsx:68 and :115
- What happens: Make `chats.send` fail once, then press Retry in the toast. The message posts, but the box still holds the text and files. Press Send: the message is now in the chat twice (proof: app.audit.test, 2 copies). The same cause hits src/features/project/team/AddTeam.tsx:32 and src/features/project/team/TeamTab.tsx:86 (after a Retry, no "added" toast and the form keeps its values).
- Fix idea: Keep the per-call options next to the input and pass them again on Retry, or move those callbacks into the hook options.

### SHL-11 Approve on a notice marks it read even when the approval fails
- Type: BUG
- Severity: LOW
- Where: src/features/notifications/NotificationsScreen.tsx:97-101
- What happens: `approve.mutate()` and `read()` run together. When `tasks.approve` is refused (for example a new open task in an earlier stage blocks finishing: src/api/flow.ts:35-39) or the call fails, the error toast shows, but the notice turns read and the bell count drops. The review is still waiting.
- Fix idea: Call `read()` in the approve `onSuccess`.

### SHL-12 A notice for a deleted item stays unread on a computer
- Type: BUG
- Severity: LOW
- Where: src/features/notifications/NotificationsScreen.tsx:79 (a "gone" row is a plain div with no press), src/api/handlers/notifications.ts:101-104 (the bell counts gone notices)
- What happens: A "task assigned" notice whose task was deleted keeps its blue dot and the red bell count. On a computer only "Mark all read" clears it (the swipe exists only on a phone).
- Fix idea: Mark a gone notice read when the list shows it, or leave gone notices out of the badge.

### SHL-13 The bell counts notices that the list does not show
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/notifications.ts:107 (`limit` default 100), src/features/notifications/NotificationsScreen.tsx:115
- What happens: The screen asks for the newest 100 notices; the bell counts every unread action notice. After 100 newer notices, an older unread "review requested" keeps the red count up but never appears in the list.
- Fix idea: Always include every unread notice, then the newest read ones.

### SHL-14 A mention in a direct chat names the sender twice
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/notifications.ts:78-79
- What happens: Faisal writes "@Hala Nasser can you check this?" in his direct chat with Hala. Hala's notice reads "Faisal Al-Harbi mentioned you in Faisal Al-Harbi" (proof: mention.audit.test). The target is "the other member", which is the sender.
- Fix idea: For a direct chat, use a fixed phrase ("in your chat") instead of a name.

### SHL-15 A direct chat with a person who left the office looks normal and still sends
- Type: GAP
- Severity: LOW
- Where: src/api/chatState.ts:33-35, src/api/handlers/chats.ts:156-166, src/api/contract/views.ts:8-15 (UserCard has no `active`)
- What happens: After Sara is deactivated, Hala's chat with Sara shows no sign of it, and Hala can keep sending messages nobody will read.
- Fix idea: Add `active` to the card, show "Left the office" in the chat header, and close the composer.

### SHL-16 "Mark all read" has no Undo
- Type: ADHD
- Severity: LOW
- Where: src/features/notifications/NotificationsScreen.tsx:116 and :125, src/api/handlers/notifications.ts:142-149 (no event, so nothing to undo)
- What happens: One press clears every unread dot, including "review requested" and "task assigned" reminders. A mis-press loses the person's to-do signals.
- Fix idea: Record the change as one story and show the usual Undo toast.

### SHL-17 Four Arabic texts keep a masculine verb after a woman's name
- Type: BUG
- Severity: LOW
- Where: src/i18n/ar.json keys `overview.healthNote` ("حدّده {{name}}:"), `stageTemplates.savedBy` ("حفظه {{name}}"), `taskTemplates.savedBy` ("حفظها {{name}}"), `taskSheet.joinsTeam` ("{{name}} (ينضم إلى الفريق)"); callers pass no `context`: src/features/project/overview/OverviewTab.tsx:96, src/features/settings/admin/StageTemplatesSection.tsx:23, src/features/settings/admin/TaskTemplatesSection.tsx:64, src/features/project/tasks/TaskHelpers.tsx:12
- What happens: Hala (the Admin) is a woman. A template she saved reads "حفظه Hala" where Arabic needs "حفظته". Correct forms: حدّدته, حفظته, حفظتها, تنضم. Every other person sentence in ar.json (feed, Inbox) already has a `_female` form.
- Fix idea: Add the four `_female` keys and pass `context: actorContext(person)`. The template rows need the saver's gender.

### SHL-18 The choice buttons say "radio" but the arrow keys do not move them
- Type: BUG
- Severity: LOW
- Where: src/components/SegmentedControl.tsx:5-17 (used for Language, Theme and the feedback kind)
- What happens: The group is `role="radiogroup"` with `role="radio"` buttons, but every button is a Tab stop and the arrow keys do nothing. A screen-reader user hears a radio group and presses the arrows, as the pattern says, and nothing changes.
- Fix idea: Use a roving tabindex and the arrow keys, the same way src/components/Tabs.tsx:9-18 does (with the RTL swap).

### SHL-19 The focus is lost after the feedback sheet closes
- Type: BUG
- Severity: LOW
- Where: src/app/PersonMenu.tsx:75
- What happens: Person picture > "Request a feature or report a bug" > Escape. The focus lands on `<body>` (proof: app.audit.test), so a keyboard user starts again from the top of the page. The menu closes in the same render as the sheet opens, so the sheet remembers no control to return to.
- Fix idea: Focus the picture button (`ref.current`) before opening the sheet, as `Menu` does at src/components/Menu.tsx:74-76.

### SHL-20 A popover stays open when the focus leaves it
- Type: BUG
- Severity: LOW
- Where: src/components/Popover.tsx:14-21 and :31-36
- What happens: In the person menu or the Filter popover, Tab past the last control. The focus leaves the popover, the popover stays open over the page, and Escape no longer closes it (the Escape handler sits on the popover itself). `MenuList` closes on Tab; `Popover` does not.
- Fix idea: Close on `focusout` when the new focus is outside the popover and the anchor.

### SHL-21 A file cannot be sent in a chat without words
- Type: GAP
- Severity: LOW
- Where: src/features/inbox/Thread.tsx:121 and :172, src/api/handlers/chats.ts:159 (`body` min 1)
- What happens: Pick a drawing in a project chat and press Send with an empty box. Send stays disabled, and nothing says why.
- Fix idea: Allow an empty body when files are attached (API and composer), or show a short hint.

### SHL-22 The Settings profile form shows its errors only as a toast
- Type: BUG
- Severity: LOW
- Where: src/features/settings/SettingsScreen.tsx:23-30 and :64-74
- What happens: Clear the name and press Save. The API refuses, and a toast says "Some fields are not valid." No message shows under the Name field, and the field is not marked. Spec 11.6: an inline message under the field.
- Fix idea: Use `TextField` with `fieldError(profile.error, 'name' | 'discipline', ...)`, as the Admin forms do.

### SHL-23 21 text keys that no code uses any more
- Type: GAP
- Severity: LOW
- Where: src/i18n/en.json and src/i18n/ar.json
- What happens: These keys exist in both files but no source file names them, literally or through a dynamic prefix (checked with `audit/i18n_scan.py`, then each one by hand): `admin.person`, `admin.stages`, `admin.week`, `chat.title`, `common.none`, `common.remove`, `inbox.open`, `newTask.due`, `overview.deadlines`, `overview.facts`, `overview.team`, `projects.openTasks`, `schedule.end`, `schedule.start`, `screens.home`, `screens.project`, `screens.tasks`, `taskList.count`, `tasks.filters`, `tasks.overdue`, `tracker.region`. They cost translator time and can confuse the native-speaker review.
- Fix idea: Delete them from both files.

Clean results, for the record: en.json and ar.json have the same base keys, no empty values, the same placeholders, and no English left in ar.json except the language name "English". Every key called with `count` either has the five Arabic plural forms or is a label with a colon that needs none (`nav.inboxBadge`, `filter.withCount`, `tasks.count` and similar). The missing `_zero` forms fall back to the base text, which reads correctly. All dynamic keys of this area exist in both files (Inbox triggers, Settings triggers, roles, preview hints, feedback kinds, error codes, languages, themes).

## Unconfirmed
- SHL-1 on a phone: because the menu has `pointer-events: none`, a tap on "Delete" may land on the sheet control under the menu (for example a reaction button) instead of doing nothing. This needs a real phone browser to confirm.
- The Admin can open every project chat (src/api/chatState.ts:36-38), so the Admin's Inbox count includes unread messages of projects she is not on. For an ADHD Admin this count may never reach zero. It may be an owner choice.
- Language, theme and "Preview as" each sit in two places: the person menu and Settings. That breaks "one place for each thing", but the person-menu items may be an owner decision that is not written down.
- Spec 9 lists a profile photo in Settings. There is no photo control. It may have been dropped with the "one-color people pictures" change.
- The feedback sheet clears a typed report on Escape or a swipe down (src/features/feedback/FeedbackSheet.tsx:35-43). That is written as intended, but it is the same "lost work" risk as SHL-4.

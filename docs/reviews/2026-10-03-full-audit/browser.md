# Browser audit

Build: `main` served at http://127.0.0.1:5320 on Saturday 3 October 2026, 00:40 to 01:30 office time (Asia/Riyadh).
Tools: Playwright (Chromium). Screenshots are in `audit/shots/` and `audit/sweep/` (paths below are relative to `audit/`).

What I covered:
- Route sweep: 21 routes (every route, every project tab, the three Dashboard sections, the meeting view, the code link) in English and Arabic, light and dark, at 1440 x 900 and 390 x 844. That is 168 screens. Result: no console error except the favicon 404, no sideways scroll, no clipped edge, no raw translation key, every heading in under 200 ms. The only English on Arabic screens is sample data (project, task, stage and person names).
- Flows, end to end, as Hala (Admin): create a project; add a task; set dates; move the due date (reason sheet); hand the task to Sara; send it to review as Sara; approve as Hala; log a tracker item and close it; upload two files; share one in chat; send a project chat message and a direct message; open a notification; search by code; switch language with an unsent chat draft; run a meeting (Projects and Timeline, Decision, Action, Done, Skip, Agenda, summary, share, Big screen in English and Arabic at 1440 and 1920).
- Roles: Khalid (Member), Noura (Accounting), Turki (Management), Madar Assistant (agent for Hala), on Admin, on a project they are not on, payments, tracker, files, the meeting.
- Phone flows (390 x 844, touch, English and Arabic): task sheet, date reason sheet, New Project sheet, meeting.
- Failure handling with Settings > Simulate errors on: quick add, chat send, date reason, title edit, project load.

Things that worked and need no change: role gating (Member gets no payments and no Admin; Accounting and Management see payments; view-only header label), Arabic gender verbs (أرسلت for Sara, أرسل for Yousef), Arabic quote marks, mirrored timeline and arrows, the date reason refusal and its post in the Conversation, quick add and chat keeping the typed text after a failed send, the language switch keeping the page and the draft, focus rings in both themes, Big screen fitting the screen.

## Findings

### BRW-1 Escape on the Agenda sheet or a person sheet leaves the whole meeting
- Type: BUG
- Severity: MEDIUM
- Where: src/features/dashboard/MeetingView.tsx:387-399
- What happens: In the meeting view (Projects mode), press Agenda, then press Escape. The sheet closes and the meeting view also closes: the screen goes to the Dashboard (`#/dashboard?mode=projects`). The same happens after a click on a person chip in the People strip, then Escape. Reproduced 3 of 3 times. Escape on a task opened from Needs attention closes only the task (correct). The comment at line 387 says "A dialog owns the keys while it is open. Escape then closes the dialog only." The sheet closes itself first, so the check `document.querySelector('[role="dialog"]')` at line 388 finds nothing and `exit()` runs. In a live meeting on the room screen, the most natural key to close the agenda throws the whole room out of the meeting. Also, `mode=projects` leaks into the Dashboard link.
- Screenshot: shots/BRW-escape-left-meeting.png (the Dashboard after one Escape on the Agenda sheet)
- Fix idea: Note in a ref when a dialog is open (set on open, cleared one tick after close), or handle Escape in the capture phase before the sheet does. Drop `mode` from the link in `exit()`.

### BRW-2 No sheet moves the keyboard focus into itself
- Type: BUG
- Severity: MEDIUM
- Where: src/components/Sheet.tsx:38 (vaul 1.1.2 `Drawer.Root` defaults `autoFocus` to false and calls `preventDefault()` on the open focus, node_modules/vaul/dist/index.mjs:1476-1480)
- What happens: Open New Project with the keyboard: focus stays on the page body. Open the meeting Agenda: focus stays on the Agenda button, and Tab goes to "Pause timer" behind the sheet, not into it. Press Enter in a task's Due date field: the reason sheet opens but focus stays in the Due date field behind it (inside a region hidden from screen readers), so typed keys change the hidden date. A screen reader does not announce any sheet when it opens. This is every Sheet in the app (task panel, filters, share, reason, agenda, person form).
- Screenshot: shots/BRW-date-reason-focus-behind.png
- Fix idea: Pass `autoFocus` to `Drawer.Root` for blocking sheets, or focus the first field or the title in `onOpenAutoFocus`.

### BRW-3 After Enter in a date field, the first Cancel on the reason sheet does not close it
- Type: BUG
- Severity: MEDIUM
- Where: src/components/Fields.tsx:58-86 (commit on Enter and again on blur), src/features/project/tasks/DateReason.tsx:48-52
- What happens: Open a task, type a new due date, press Enter. The reason sheet opens (focus stays in the date field, see BRW-2). Click Cancel: the sheet closes and opens again at once, with the same "from / to" line. A second Cancel closes it. Reproduced 3 of 3. The click blurs the date field, the field commits the same draft a second time, the server refuses again, and the sheet comes back. With Tab or a click elsewhere instead of Enter, one Cancel works.
- Screenshot: shots/BRW-date-reason-focus-behind.png
- Fix idea: In `DateDraftField`, remember the last value sent and skip a second commit of the same draft; BRW-2's fix also removes the blur.

### BRW-4 Sample data dated later today shows up as "now" and lands in the meeting summary
- Type: BUG
- Severity: MEDIUM
- Where: src/data/seed.ts:204 (tasks created "today" at 09:xx), src/data/seed.ts:361 and :378 (chat messages "today" at 07:15, 07:50 and later)
- What happens: At 00:51 I started a meeting, added two decisions and one action, and opened the summary. "Changes since 00:51" lists four other projects (Shore Walk, Rakah, Eastern Shore, Tamr) with "09:35 Faisal Al-Harbi added the task As-built review" and similar, eight hours in the future, from projects the meeting never touched. "Share to the project chats" then said "The summary went to 5 chats", so four project chats got a meeting summary with nothing from the meeting. Same cause in the Inbox: the Corniche chat shows messages at "Today 7:15" and "7:50" as "now", and three seed chats stay above the chat I had just written in. Any meeting that starts before 09:35 office time (the normal meeting hour) gets the same wrong summary.
- Screenshot: shots/meeting-summary.png, shots/flow-dm.png
- Fix idea: Clamp every seeded "today" stamp to before the load time (for example, now minus N minutes), or seed today's events relative to now, not to fixed hours.

### BRW-5 Approve has no Undo, and the Approve buttons have no task in their name
- Type: GAP
- Severity: MEDIUM
- Where: src/features/notifications/NotificationsScreen.tsx:32, src/features/project/tasks/TaskSheet.tsx:168
- What happens: In Notifications, press Approve: the toast says "Task approved." with no Undo, and the task is done. "Sent to review" right before it had Undo. Spec (2026-09-30-madar-prototype-design.md:458): "Undo replaces 'Are you sure?' dialogs." So a mis-press on Approve has neither. The Notifications list had two buttons both named only "Approve", so a screen-reader person cannot tell which task each one approves.
- Screenshot: shots/flow-approve.png
- Fix idea: Use `useUndoable('tasks.approve', ...)` in both places. Name each button "Approve <task title>" (aria-label) and keep the visible word.

### BRW-6 A failed save leaves the unsaved value in the field after the Retry toast fades
- Type: BUG
- Severity: MEDIUM
- Where: src/features/project/tasks/TaskSheet.tsx:161 and :178-183 (title state, no reset on error), src/components/Fields.tsx:57 (date draft resets only when the saved value changes)
- What happens: With Simulate errors on, change a task title to "Stair details v0" and press Tab. The save fails ("Something went wrong. Try again." with Retry for 5 seconds). After the toast goes, the Title field still says "Stair details v0" while the sheet heading and the saved task say "Stair details". Nothing on screen says the edit was not saved. The date fields behave the same: after a failed "Save dates", the reason sheet has closed, the field shows the new date, and the saved date is the old one; the typed reason is gone once the toast fades. The real Python build will have real network failures.
- Screenshot: shots/BRW-failed-save-field-keeps-unsaved.png
- Fix idea: On error, put the field back to the saved value (or mark it "Not saved" next to the field until it saves). Keep the reason text for the retry.

### BRW-7 Any load failure on a project says "Project not found"
- Type: BUG
- Severity: MEDIUM
- Where: src/features/project/ProjectScreen.tsx:32-34
- What happens: With Simulate errors on, open `#/projects/prj_013`. When the load fails, the page heading and the panel title both say "Project not found", and the body says "Something went wrong. Try again." with Retry. The project exists; Retry opens it. A person reads the heading first and thinks the project was deleted. Line 29 already knows the difference (`gone`), but the title ignores it.
- Screenshot: shots/BRW-project-not-found-on-load-error.png
- Fix idea: Use the not-found title only when `gone`; otherwise use a "Could not load this project" title.

### BRW-8 Escape or Close throws away a filled-in New Project form
- Type: ADHD
- Severity: MEDIUM
- Where: src/features/projects/NewProjectSheet.tsx (no draft keep), src/components/Sheet.tsx (no unsaved-changes guard anywhere in src)
- What happens: Open New Project, type a name and a location, press Escape. The sheet closes with no question. Open it again: every field is empty. The owner's rule says "nothing that resets or loses work by accident". A search of src finds no unsaved-changes guard in any sheet, so other sheets with typed text are likely the same (not tested one by one).
- Screenshot: shots/flow-newproject-sheet.png
- Fix idea: Keep the draft in memory until Create or an explicit Discard, or ask "Discard this project?" only when a field has text.

### BRW-9 On Friday and Saturday, next week's tasks sit under "Later"
- Type: BUG
- Severity: MEDIUM
- Where: src/lib/myWork.ts:13 (with `weekStartOf`, src/lib/dates.ts:59)
- What happens: On Saturday 3 October, Sara's Tasks page has the groups Past due, Today, Later. "Finishes schedule, In 3 days" (Tuesday 6 Oct) and every task due Sunday to Thursday of the coming work week are under "Later". "This week" runs Sunday 27 Sept to Saturday 3 Oct, so on Friday and Saturday it holds nothing ahead. The office week is Sunday to Thursday with Friday and Saturday off, so on the weekend "This week" should mean the coming Sunday to Thursday.
- Screenshot: shots/BRW-weekend-later-group.png
- Fix idea: On Friday and Saturday, start the week at the next Sunday.

### BRW-10 Screen readers never hear the unread counts on Inbox and the bell
- Type: BUG
- Severity: MEDIUM
- Where: src/app/TabPill.tsx:79 and :99 (`aria-label` on the link), src/components/Badge.tsx (the sr-only label inside)
- What happens: The accessibility tree names the links "Inbox" and "Notifications" only. The hidden texts "Unread messages: 3" and "2 items need action" are inside the link, but an `aria-label` replaces the content, so they are not part of the name. A blind person never learns there is something waiting.
- Screenshot: none (accessibility tree, checked with Playwright `ariaSnapshot`)
- Fix idea: Drop the link's `aria-label` and use visible-hidden text for the name, or put the count into the `aria-label` ("Notifications, 2 need action").

### BRW-11 Quick add drops the focus after each task
- Type: BUG
- Severity: LOW
- Where: src/features/project/tasks/TaskList.tsx:37
- What happens: In a project's Tasks tab, type a title in "Add a task" and press Enter. The task is added, but focus goes to the page body, so the next typed title goes nowhere. The input is `disabled` while the call runs, and a disabled field loses focus. Adding five tasks takes five extra clicks.
- Screenshot: shots/flow-tasks-empty.png
- Fix idea: Use `readOnly` (or `aria-busy`) instead of `disabled` while saving, or focus the field again in `onSuccess`.

### BRW-12 "1 items need action"
- Type: BUG
- Severity: LOW
- Where: src/i18n/en.json:12
- What happens: After one approval, the bell's screen-reader text reads "1 items need action". The key has no `_one` form. (The Arabic key puts the number after a colon, so it is fine.)
- Screenshot: none (screen-reader text)
- Fix idea: Add `inboxBadge_one` and `inboxBadge_other`.

### BRW-13 View-only people see task circles that look live but do nothing
- Type: GAP
- Severity: LOW
- Where: src/features/project/tasks/TaskRowItem.tsx:74-76
- What happens: As Khalid on Tamr Boutique Hotel (not his project), the header says "View only", but each task row still shows the round tick button, only slightly faded (`disabled`, opacity 0.6). A click does nothing and says nothing. Spec line 92: "The screen hides edit controls. It does not show disabled controls."
- Screenshot: shots/role-khalid-prj005-tasks.png
- Fix idea: When the viewer cannot tick, show a plain status mark (not a button), as the task sheet does with `Fact`.

### BRW-14 Meeting decisions and actions cannot be undone, edited or removed in the meeting
- Type: ADHD
- Severity: LOW
- Where: src/features/dashboard/meeting/DecisionsPanel.tsx:21 and :42
- What happens: Add a Decision or an Action in the meeting. The line appears in the list, with no toast, no Undo and no edit or remove control. The Action also creates a real task for the chosen person (Yousef went from 2 to 3 open tasks on the person chip) with no word on screen that a task was made. A typo goes onto the room screen and into the shared summary. The fix needs a trip to the project's Activity tab or the task.
- Screenshot: shots/meeting-decisions.png
- Fix idea: Use the Undo toast for both, and add "Task added for Yousef" as the toast text for an Action.

### BRW-15 One state, two words on the tracker
- Type: ADHD
- Severity: LOW
- Where: src/i18n/en.json:1176 and :1179
- What happens: The tracker button says "Answered", the item afterwards says "Answered", and the toast says "Marked as closed." The owner's rule asks for clear state words; two words for one state reads as two different things.
- Screenshot: shots/flow-tracker-closed.png
- Fix idea: Make the toast "Marked as answered." (and check the Arabic pair).

### BRW-16 Home says "1 thing today" above a panel that says "Nothing is due today"
- Type: ADHD
- Severity: LOW
- Where: src/features/home/HomeScreen.tsx:67
- What happens: The greeting line counts due tasks plus reviews ("Saturday 3 October · 1 thing today"); the Today panel right under it counts only due tasks ("Nothing is due today."). The one thing is the review in the Next card. Two counts for "today" disagree on the same screen.
- Screenshot: sweep/1440-en-light_home.png
- Fix idea: Count the same set in both places, or word the header "1 thing waiting for you".

### BRW-17 Arabic chat previews break when the message is in English
- Type: BUG
- Severity: LOW
- Where: src/features/inbox/ChatList.tsx:40-42
- What happens: In Arabic, a chat whose last message is mine and in English reads ".Client moved the site visit :أنت": the full stop jumps to the front, and when the line is long, the cut-off removes the start of the message ("...am, the survey is booked for Sunday" for "Team, the survey..."). The span is `dir="auto"` and starts with "أنت:", so the whole line runs right to left and the English part is not isolated.
- Screenshot: shots/flow-lang-switch-inbox.png
- Fix idea: Wrap `{row.preview}` in `<bdi>`.

### BRW-18 The meeting timeline is unusable at phone width
- Type: BUG
- Severity: LOW
- Where: src/features/dashboard/MeetingView.tsx (timeline grid)
- What happens: At 390 px the name column takes nearly the whole width; the bars get a strip about 20 px wide, the month label is cut at the edge ("أو"), and names cut to "Al Waha C...". The Projects mode works on a phone. The plan does not promise the timeline on a phone, so this is low.
- Screenshot: sweep/390-ar-dark_dashboard-meeting.png
- Fix idea: Below 640 px, open the meeting in Projects mode, or stack the name above the bars.

### BRW-19 The agenda shows no state word for a skipped project
- Type: ADHD
- Severity: LOW
- Where: src/features/dashboard/meeting/AgendaSheet.tsx:76
- What happens: Press Skip on Corniche Office Tower. It moves to place 10 of 10 with no word next to it, while a finished project says "Discussed" and the current one says "Now". Someone who glances at the agenda cannot tell it was skipped and still needs time.
- Screenshot: shots/meeting-agenda-sheet.png
- Fix idea: Show "Skipped" (or "Later") on a project that was moved to the end.

### BRW-20 Missing favicon logs a console error on every first load
- Type: BUG
- Severity: LOW
- Where: index.html (no `<link rel="icon">`)
- What happens: Each fresh page load logs "Failed to load resource: 404 (File not found) favicon.ico". It is the only console error in the whole sweep, so it hides real errors in a quick check.
- Screenshot: none
- Fix idea: Add the Madar mark as an inline SVG favicon.

## Unconfirmed
- Search by code without dashes ("KH26001") finds nothing; "26-004" and "kh-26-011" work. I did not find a spec line that asks for dash-free matching.
- A new project with a target end date shows "No deadline" in the header and "No deadlines yet." in Coming up, because those read deadline items, not the target end date. It may confuse, but it follows the data model.
- The New Project name check uses the browser's own message ("Please fill out this field."), which comes in the browser's language, not the app's. I did not test it in an Arabic browser.
- The meeting's Today line runs through stage labels on the timeline ("T|ender", "P|ermits"); a visual nit.

# Meeting View, Phases 1 to 3: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task is one implementer dispatch plus one task review.

**Goal:** The meeting view becomes one page for the whole team meeting. People act on tasks, close client items, follow an agenda with a timer, write decisions, read a summary, look at drawings, see who is busy, see payments (for the people who may), see what waits and what will move, and use a big-screen mode.

**Architecture:** The meeting view lives in `src/features/dashboard/MeetingView.tsx` (the timeline and the top bar) and `src/features/dashboard/MeetingProjects.tsx` (one project per screen, mode `projects`). Each new panel goes in its own file under `src/features/dashboard/meeting/`. The panels reuse the calls and parts that exist today. A small meeting context in `src/app/meeting.tsx` tells shared parts (the date-reason box) that they show inside a meeting.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 4, TanStack Query, i18next (English plus Arabic, right to left), zod 4, Vitest with jsdom and Testing Library.

**Spec:** The owner-approved report "Meeting view: one page for the whole meeting" (artifact WzJx4nWgvrwTbQYgTnxkVB, 2 Oct 2026), with the owner decisions of 2 Oct 2026 listed below. No separate spec file exists; this plan carries the report's requirements.

## Global Constraints

- Repository: `~/dev/madar`, branch `meeting-view`. Do not push. Do not merge.
- Owner decision: meetings are for the team only. The client never sees the meeting screen. So there is NO "Client view" switch, and meeting decisions NEVER write to the Tracker. Decisions post to the project's Activity only.
- Owner decision: the time box is 5 minutes for each project by default. The person who runs the meeting can change it.
- Owner decision: keep the screen calm. A panel that only shows things, and has nothing to show, is not rendered at all (no empty card, no "nothing here" text). Panels with an input (Decisions) always show.
- Owner decision: when a person moves a task date inside a meeting, the date-reason box also offers a one-press reason "Decided in the meeting on <date>".
- Rights: a person does in the meeting only what they can do elsewhere. Never loosen a server permission check. Hide a control the viewer may not use (no dead controls).
- Language: all user-facing text uses ASD-STE100 Simplified Technical English: active voice, short sentences, one word for one meaning. NEVER use the em-dash character (U+2014) anywhere: strings, code comments, test names, commit messages.
- i18n: every new string goes in BOTH `src/i18n/en.json` and `src/i18n/ar.json`. Arabic plurals use the keys `_zero`, `_one`, `_two`, `_few`, `_many`, `_other` where a count shows (follow the existing `counted` helper and nearby keys). No Latin letters inside Arabic strings. The `{{placeholders}}` must match between the two languages. The test `src/i18n` parity checks and `npm run check:rtl` must pass.
- Icons: use only the animated icons in `src/components/icons/animated/` through `AnimatedIcon`. If you need a new one, take it from `https://lucide-animated.com/r/<name>.json`, add a first-line comment with that source URL, replace the `cn` import with `./cx`, and remove `"use client"`.
- Code style: match the surrounding code: comment density, naming, `useCall` and `useAction` from `src/app/runtime`, `Sheet`, `Button`, `TextField`, `SelectField` from `src/components`. Tests sit next to the component, use `renderApp` from `src/test/render`, and query by role and visible name. Server tests use `testApi(calls)` from `src/test/factories`.
- Today in all tests is Wed 30 Sep 2026 (`NOW` in `src/test/factories`).
- Commands: focused tests `npx vitest run <path>`; the full suite `npx vitest run` (1,104 tests pass at the branch start); the type check `npx tsc -p tsconfig.json`; `npm run check:rtl`. All three must be clean before each commit.
- Commits: one or more commits per task, subject line in plain STE English. End every commit message with exactly this trailer line and no other trailer (no Co-Authored-By):
  `Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY`
- Never run Playwright or the e2e folder. Never start a dev server.

## Review Focus

1. Escape and the arrow keys: with a task panel or any sheet open, Escape closes only that sheet, and the arrows and letter keys do not change the project.
2. A change made in a panel shows on the meeting screen at once (counts, columns, client items) without a reload.
3. Arabic: every new text exists in Arabic, plural forms are right, and the layout mirrors (start and end, not left and right).
4. The meeting session state (agenda order, discussed projects, timer, start time) survives a reload of the page on the same day, and a broken or blocked browser storage never breaks the screen.
5. A viewer with fewer rights (a team member who does not lead the project, an Accounting user) sees no control they cannot use.

---

### Task 1: Act in place, and the meeting reason for a date move

**Why:** Most "let me open the project" moments in a meeting are one small change to one task.

**Files:**
- Create: `src/app/meeting.tsx` (the meeting context)
- Modify: `src/features/dashboard/MeetingView.tsx`, `src/features/dashboard/MeetingProjects.tsx`, `src/features/project/tasks/DateReason.tsx`, `src/i18n/en.json`, `src/i18n/ar.json`
- Test: `src/features/dashboard/MeetingActInPlace.test.tsx` (new), `src/features/project/tasks/DateReason.test.tsx` (extend)

**Interfaces:**
- Produces: `src/app/meeting.tsx` exports `MeetingProvider({ value, children })` and `useMeeting(): { startedAt: string } | null`. `startedAt` is an ISO stamp. In this task, `MeetingView` sets it to the time the meeting view opened (Task 3 replaces the source with the meeting session). Outside a meeting, `useMeeting()` returns `null`.
- Produces: a rule in `MeetingView`: the meeting's own keyboard keys (Escape to leave, the arrows) do nothing while any dialog is open (`document.querySelector('[role="dialog"]')` or the equivalent the Sheet component gives). Escape then closes only the dialog. Later tasks add letter keys under the same rule.
- Consumes: `ProjectTaskSheet` from `src/features/project/tasks/TaskSheet.tsx` (`{ projectId, taskId, onClose }`).

**Requirements:**
1. On the project screen of a meeting (mode `projects`), every task item in "In progress" and "Needs attention" is one pressable button. Its accessible name starts with the task title. A press opens the task panel (`ProjectTaskSheet`) for that task over the meeting screen. The meeting screen stays mounted below it.
2. The open task is kept in the link as `task=<id>` on `/dashboard/meeting` (replace, do not push history). Closing the panel removes it and returns to the same project screen ("Project N of M" does not change).
3. A change in the panel (approve, send back, tick done, change the lead or the helpers, move a date) updates the meeting screen at once, without a reload. If the meeting's task list does not refresh by itself after an action, make it refresh the same way other screens do (check how `useAction` invalidates queries).
4. Escape with the panel open closes the panel only. The meeting stays open. The arrow keys with the panel open do not change the project.
5. Date reason in a meeting: in `DateReasonSheet`, when `useMeeting()` is not null, show a button above the reason field. Its text is `t('dateReason.meetingReason', { date })`, where `date` is today in the `withWeekday` format of `formatDay`. English: `Decided in the meeting on {{date}}`. Arabic: `تقرر في الاجتماع يوم {{date}}`. One press sends exactly that text as the reason and saves the dates (same path as "Save dates"). Outside a meeting the button does not show.
6. Do NOT add a "+ Task" button in this task. Task 4 adds new tasks from the Decisions panel ("Action").

**Tests (write first, watch each fail):**
- Press a task in "In progress" on the meeting project screen: a dialog named after the task opens, and the meeting heading "Madar" is still in the document. Close it: the dialog is gone and the same "Project N of M" text shows.
- Escape with the task panel open closes the panel; the meeting view is still there (the link still has `/dashboard/meeting`).
- Approve a task that waits for review from its panel in the meeting: after the approval, the task no longer shows under "Needs attention" with the review label.
- In a meeting, move the due date of a static task: the reason box shows the button "Decided in the meeting on Wed 30 Sept" (use the exact text `formatDay` gives for 2026-09-30 in English with `withWeekday`); a press saves the new date and the task's Conversation gets a message with that exact body.
- Outside a meeting (the existing DateReason test path), the meeting button is absent.

**Commit:** `Meeting view: open a task panel in place, and offer a meeting reason for a moved date`

---

### Task 2: Client items on each project

**Why:** Client loops are the items the team most often forgets between meetings.

**Files:**
- Create: `src/features/dashboard/meeting/ClientItemsPanel.tsx`
- Modify: `src/features/dashboard/MeetingProjects.tsx`, `src/i18n/en.json`, `src/i18n/ar.json`
- Test: `src/features/dashboard/meeting/ClientItemsPanel.test.tsx`

**Interfaces:**
- Consumes: `tracker.list` with `{ projectId, openOnly: true }`, `tracker.close` `{ id }`, `tracker.assignReply` `{ id, userId, dueDate }`. Reuse what exists in `src/features/project/tracker/` (`ageText` in `marks.tsx`, `ReplyFields.tsx`, the `Loop` row in `OpenLoops.tsx` where it fits) and the existing i18n words of the Tracker tab for "Answered", "Received", "Who replies?" if they exist. Read `src/lib/tracker.ts` for the field that says who the entry waits for and the age.
- Consumes: the project's members and the viewer's rights, the same way `TrackerTab.tsx` gets them (`projects.get`).

**Requirements:**
1. A "Client items" panel on the meeting project screen. Place: in the second column, below "Needs attention".
2. Two groups, each with a small heading: "Waiting for our reply" and "Waiting for the client". Each item shows its title and its age ("5 days"), oldest first.
3. An item that waits for our reply has a one-press "Answered" button; an item that waits for the client has a one-press "Received" button. The press calls `tracker.close`, and the item leaves the panel at once.
4. An item that waits for our reply and has no open reply task has a "Who replies?" button. It opens a small sheet with the person and the due date (`ReplyFields`), then calls `tracker.assignReply`. An item with an open reply task shows "Reply: <name> · <due date>" instead.
5. The buttons show only for a viewer who may post in the project (the same rule the Tracker tab uses).
6. The panel does not render when the project has no open items.

**Tests (write first):**
- A project with open items shows both groups with titles and ages.
- "Answered" closes the item: it leaves the panel, and `tracker.list` with `openOnly` no longer returns it.
- "Who replies?" with a person and a date assigns the reply; the item then shows the person's name.
- A project with no open items shows no "Client items" region.
- A viewer who may not post sees the items but no buttons.

**Commit:** `Meeting view: client items on each project, with one-press close and reply tasks`

---

### Task 3: Agenda and timer

**Why:** A clear order and a visible time box keep the meeting short. This helps the team members with ADHD most.

**Files:**
- Create: `src/lib/agenda.ts` and `src/lib/agenda.test.ts`
- Create: `src/features/dashboard/meeting/session.ts` (the meeting session state and its hook)
- Create: `src/features/dashboard/meeting/AgendaBar.tsx` (the agenda button, the timer, Done and Skip) and `src/features/dashboard/meeting/AgendaSheet.tsx`
- Modify: `src/api/handlers/insights.ts` (dashboard schedule rows), `src/features/dashboard/MeetingView.tsx`, `src/features/dashboard/MeetingProjects.tsx`, `src/app/meeting.tsx` (startedAt now comes from the session), the i18n files
- Test: `src/api/handlers/insights.test.ts` (extend, or the existing dashboard handler test file), `src/features/dashboard/meeting/Agenda.test.tsx`

**Interfaces:**
- Produces: each `dashboard.get` schedule row gains `openLoops: { us: number, client: number }`: the counts of open Tracker entries of that project that wait for us and that wait for the client.
- Produces: `agendaOrder(rows)` in `src/lib/agenda.ts`. It returns the rows in four groups, in this order: 1. health `late`; 2. health `at_risk`; 3. stale (`pause?.staleDays` is not null) or waiting for the client (`openLoops.client > 0`); 4. all others. Inside a group, the rows keep their input order.
- Produces: `useMeetingSession(projectIds)` in `session.ts` returning `{ startedAt, order, current, discussed, minutes, setMinutes, goTo(index), done(), skip(), elapsedFor(id), paused, togglePause(), restart() }` (names may be adjusted; keep them clear). The state is kept in `sessionStorage` under one key for the day (`madar.meeting.<YYYY-MM-DD>`). Wrap every read and write in try/catch: blocked storage gives a fresh session, never an error. A new day starts a new session. `restart()` starts a new meeting (new `startedAt`, the agenda order again, nothing discussed, timers at zero). Tasks 4, 5, 10 consume `startedAt`, `togglePause`, `goTo`, and the order.

**Requirements:**
1. In mode `projects`, the meeting shows the projects in agenda order. The timeline keeps its present order.
2. The top bar (mode `projects` only) shows an "Agenda" button with the text "Project 3 of 9" style position (reuse `dashboard.meeting.projectOf` if it fits) and a quiet timer: `4:12 left` (minutes and seconds, tabular numbers). The timer counts down only while that project is on screen. Each project keeps its own used time, so going back continues it. When the time runs out, the text changes to `1:05 over` in the attention color. No sound, no popup, no flashing.
3. A "Pause timer" / "Resume timer" button sits next to the timer.
4. "Done" marks the current project as discussed and shows the next project that is not discussed. "Skip" moves the current project to the end of the order and shows the next one. A discussed project shows a small "Discussed" sign in its header.
5. The "Agenda" button opens a sheet: the projects in order, each with its state (discussed, now, next), and a press on one goes to it. The sheet also holds "Time for each project" with the choices 3, 5, 10 and 15 minutes (default 5), and a "Start a new meeting" button (`restart()`).
6. When every project is discussed, the agenda sheet and the top bar say "All projects discussed".
7. Keep the timer re-render inside a small component, so the whole screen does not re-render every second.
8. `MeetingProvider` now gets `startedAt` from the session.

**Tests (write first):**
- `agendaOrder`: late before at risk before stale or waiting for the client before the rest; input order kept inside a group.
- `dashboard.get`: a project with one open entry that waits for the client and two that wait for us gives `openLoops: { us: 2, client: 1 }`; closed entries do not count.
- UI: in mode `projects`, the first project shown is a late one.
- UI: the timer shows `5:00 left`; after 61 seconds (fake timers) it shows `3:59 left`; choose 10 minutes in the agenda sheet and a fresh project shows `10:00 left`; past the time it shows the `over` text.
- UI: Pause stops the count; Resume continues it.
- UI: Done marks the project discussed and moves on; Skip puts the project last in the agenda sheet.
- UI: a reload (unmount and render again on the same day) keeps the discussed projects; a `sessionStorage` that throws on access still renders the meeting.

**Commit:** `Meeting view: an agenda in order of need, with a timer for each project`

---

### Task 4: Decisions and action items

**Why:** Decisions go into Madar, where the work is, not on paper or WhatsApp.

**Files:**
- Create: `src/features/dashboard/meeting/DecisionsPanel.tsx`
- Modify: `src/api/contract/entities.ts` (Update), `src/api/handlers/content.ts` (`updates.create`), the feed view of an update in `src/api/views.ts` or where `updateItemOf` lives, `src/features/project/overview/FeedEntry.tsx` (the "Decision" label), `src/features/dashboard/MeetingProjects.tsx`, the i18n files
- Test: `src/api/handlers/content.test.ts` (extend), `src/features/dashboard/meeting/DecisionsPanel.test.tsx`

**Interfaces:**
- Produces: `Update` gains `decision: z.literal(true).optional()`. `updates.create` input gains `decision: z.boolean().optional()`; the update stores `decision: true` only when it is true. The feed item carries it, so the Activity feed can show it.
- Consumes: `useMeeting().startedAt` (Task 3), `updates.list`, `updates.create`, `tasks.create` (read `QuickAdd` in `src/features/project/tasks/TaskList.tsx` and `tasks.create` in `src/api/handlers/tasks.ts` for the input), the project members and the viewer's rights from `projects.get`.

**Requirements:**
1. A "Decisions" panel on every meeting project screen. Place: the third column, at the top. It always shows (it has an input).
2. A one-line field "Write a decision" with an "Add" button (Enter also adds). It calls `updates.create` with `decision: true`. The decision posts to the project's Activity as a project update. It NEVER writes a Tracker entry.
3. A second choice "Action": a title, a person (the project's members), and a due date. "Add" calls `tasks.create` in the project's current stage, with that person as the lead and that due date. It is a first date, so no date reason is asked.
4. The panel lists the decisions and actions added for this project since the meeting started (`startedAt`), newest last: "Keep the lobby double height." and "Action: Revise sections · Sara · Thu 8 Oct".
5. In the project's Activity feed, a decision update shows a small "Decision" label before its text.
6. The decision input shows only for a viewer who may post updates; the action input shows only for a viewer who may create a task for another person. If the viewer may do neither, the panel shows only the list, and the panel does not render when the list is empty.

**Tests (write first):**
- Server: `updates.create` with `decision: true` stores the flag and the feed item has it; without it, no flag.
- UI: type a decision and press Enter: it shows in the panel, and the project's Activity shows it with the "Decision" label.
- UI: add an action with a person and a date: a task with that title, lead and due date exists in the project, and the panel shows the action line.
- UI: after a decision, `tracker.list` for the project has the same number of entries as before.
- UI: a decision made before `startedAt` does not show in the panel.

**Commit:** `Meeting view: decisions post to Activity, and actions become tasks`

---

### Task 5: Summary at the end

**Why:** The meeting ends with minutes, without anyone writing them.

**Files:**
- Create: `src/features/dashboard/meeting/MeetingSummary.tsx`
- Modify: `src/api/handlers/history.ts` (`events.list`), `src/features/dashboard/MeetingView.tsx`, `src/features/dashboard/meeting/AgendaBar.tsx` or `AgendaSheet.tsx`, the i18n files
- Test: `src/api/handlers/history.test.ts` (extend), `src/features/dashboard/meeting/MeetingSummary.test.tsx`

**Interfaces:**
- Produces: `events.list` input gains `since: Stamp.optional()` (an ISO stamp). With it, only events at or after that stamp return. Use the existing time field of the event.
- Consumes: `useMeeting().startedAt`, the agenda order (Task 3), the event sentence that the project Activity already uses (find it: `historyText` in `src/features/project/tasks/history.ts` or the Activity tab's own), `chats.list` (conversations of kind `project`) and `chats.send` `{ conversationId, body }`, and the copy-to-clipboard code of the Tracker `ExportSheet.tsx`.

**Requirements:**
1. A "Summary" button in the meeting top bar (both modes). When every project is discussed (Task 3), the "All projects discussed" text offers it too.
2. The summary shows inside the meeting screen (not a new page). It lists, for each meeting project in agenda order, every change since `startedAt`: who, what (the same sentence as the Activity feed), and the time (hours and minutes). A project with no changes does not show. With no changes at all, one line says "No changes in this meeting yet."
3. "Copy as a table" copies a table with the columns Project, Who, What, Time (tab-separated lines, with a header line) to the clipboard. Catch a refused clipboard and show the existing error toast.
4. "Share to the project chats" posts one message per project with changes to that project's chat: a first line "Meeting summary, <date>" and one line per change. It skips a project whose chat the viewer cannot post in. A toast says how many chats got the summary.
5. A "Back" button returns to the meeting screen where it was.

**Tests (write first):**
- Server: `events.list` with `since` returns only the events at or after the stamp.
- UI: approve a task in the meeting, open Summary: the project shows a line with the approval and the person's name.
- UI: "Copy as a table" writes the header line and one line per change (mock `navigator.clipboard.writeText`).
- UI: "Share to the project chats" adds one message to the project's chat that starts with "Meeting summary".
- UI: with no changes, the "No changes in this meeting yet." line shows.

**Commit:** `Meeting view: a summary of the meeting, to copy or share to the project chats`

---

### Task 6: Drawings in the meeting

**Why:** Design reviews need the drawings on the same screen.

**Files:**
- Create: `src/features/project/files/PreviewSheet.tsx` (move the `PreviewSheet` out of `FilesTab.tsx` and add next and previous), `src/features/dashboard/meeting/DrawingsStrip.tsx`
- Modify: `src/features/project/files/FilesTab.tsx` (import the moved sheet), `src/features/dashboard/MeetingProjects.tsx`, the i18n files
- Test: `src/features/dashboard/meeting/DrawingsStrip.test.tsx`; `FilesTab.test.tsx` must stay green

**Interfaces:**
- Produces: `PreviewSheet({ views, index, onIndex, onClose })`. With one view, it behaves as today. With more, it shows "Previous drawing" and "Next drawing" buttons, and its title is the file name.
- Consumes: `files.list` for the project (read `FilesTab.tsx` for the input and for how it decides image or PDF).

**Requirements:**
1. A "Drawings" strip at the bottom of the meeting project screen, across the full width. It shows the project's 6 newest image or PDF files (newest version first): a thumbnail for an image, the PDF icon and the name for a PDF.
2. A press opens the preview over the meeting, with next and previous across those 6 files. Closing returns to the meeting. The meeting keys do nothing while the preview is open (Task 1 rule).
3. The strip does not render when the project has no image or PDF files.

**Tests (write first):**
- A project with files shows the strip with at most 6 items, newest first.
- A press opens the preview named after the file; "Next drawing" shows the next file's name; Escape closes only the preview.
- A project with no image or PDF files shows no "Drawings" region.

**Commit:** `Meeting view: the newest drawings of each project, full screen with next and previous`

---

### Task 7: People strip

**Why:** The team sees who is busy and moves work to someone with room, in the meeting.

**Files:**
- Create: `src/features/dashboard/meeting/PeopleStrip.tsx`
- Modify: `src/features/dashboard/MeetingProjects.tsx`, the i18n files
- Test: `src/features/dashboard/meeting/PeopleStrip.test.tsx`

**Interfaces:**
- Consumes: the open task rows the meeting already loads (`tasks.list` in `MeetingView`), `dueWord` from `src/lib/due.ts`, and the task panel in place (Task 1).

**Requirements:**
1. One line under the project header: each person who leads at least one open task in this project, with the avatar, the name and "6 open · 2 late" (late means past due). The busiest person first.
2. A press on a person opens a small sheet with that person's open tasks in this project (title and due word). A press on a task opens its task panel in place (Task 1), where a leader can change the lead.
3. The strip does not render when the project has no open tasks.

**Tests (write first):**
- The strip shows each lead with the right open and late counts, the busiest first.
- A press on a person lists their tasks; a press on a task opens its task panel.
- A project with no open tasks shows no "People" region.

**Commit:** `Meeting view: the people of each project with their open and late tasks`

---

### Task 8: Payments in the meeting

**Why:** Management and Accounting check money without leaving the meeting.

**Files:**
- Create: `src/features/dashboard/meeting/MeetingPayments.tsx` (a thin wrapper, only if needed)
- Modify: `src/features/dashboard/MeetingProjects.tsx`
- Test: `src/features/dashboard/meeting/MeetingPayments.test.tsx`

**Interfaces:**
- Consumes: `PaymentsPanel({ projectId })` from `src/features/project/payments/PaymentsPanel.tsx`, and the rule the project Overview uses to decide who sees it.

**Requirements:**
1. The meeting project screen shows the project's payments (received, awaiting, overdue), using `PaymentsPanel`, in the third column below "Latest update".
2. It shows only for a viewer who sees payments on the project Overview (the same rule). For everyone else it is not rendered, and no payments call runs.
3. It does not render when the project has no payments.
4. No "Client view" switch (owner decision).

**Tests (write first):**
- The Admin (or an Accounting user) sees the payments panel of a project with payments.
- A team member who may not see payments sees no payments region.
- A project with no payments shows no payments region.

**Commit:** `Meeting view: payments for the people who may see them`

---

### Task 9: What waits, and what will move

**Why:** The team sees the chains and the cost of a late task before it happens.

**Files:**
- Modify: `src/lib/stageFlow.ts` (a pure shift calculation), `src/api/flow.ts` (`shiftDependents` uses it), `src/features/dashboard/MeetingProjects.tsx`, the i18n files
- Create: `src/features/dashboard/meeting/ChainsPanel.tsx`
- Test: `src/lib/stageFlow.test.ts` (extend), `src/features/dashboard/meeting/ChainsPanel.test.tsx`; `src/api/flow.test.ts`, `src/api/handlers/taskDateReason.test.ts` and `src/api/handlers/tasksSchedule.test.ts` must stay green

**Interfaces:**
- Produces: `shiftPlan(task, dependents, finishDay)` in `src/lib/stageFlow.ts`. `task` has `dueDate`; `dependents` are the tasks that need it. It returns, for each dependent that is not done, is `dynamic`, and has a `startDate` and `durationDays`, `{ id, lateDays, from: { startDate, dueDate }, to: { startDate, dueDate } }`. It returns an empty list when the task finishes on or before its due day. This is the same rule `shiftDependents` applies today (`workingDaysLate`, `addWorkingDays`, `dueFromDuration`). `shiftDependents` must call `shiftPlan`, so the preview and the real shift can never disagree.
- Consumes: the open task rows the meeting loads (`TaskRow.task`, `TaskRow.waitingFor`).

**Requirements:**
1. A "What waits" panel in the first column, below "In progress".
2. One line for each open task that waits for another task: "Specifications draft waits for Stair details".
3. One line for each open task that is past due and has dynamic dependents that would move: "If Stair details finishes today, Specifications draft moves 3 working days, to Tue 13 Oct." (the working-days count uses the plural keys; the date uses `formatDay`).
4. The panel does not render when it has no lines.

**Tests (write first):**
- `shiftPlan`: a dynamic dependent moves by the working days late; a static or done dependent does not move; finishing on time gives an empty list.
- The existing shift tests still pass after `shiftDependents` uses `shiftPlan`.
- UI: a past-due task with a dynamic dependent shows the "If ... finishes today ..." line with the right count and date.
- UI: a project with no chains shows no "What waits" region.

**Commit:** `Meeting view: what waits for what, and which dates move if a late task finishes today`

---

### Task 10: Big-screen mode and meeting keys

**Why:** The meeting runs on a room screen, from a keyboard.

**Files:**
- Modify: `src/features/dashboard/MeetingView.tsx`, `src/features/dashboard/meeting/AgendaSheet.tsx` (the keys line), the i18n files
- Create: `src/features/dashboard/meeting/useWakeLock.ts`
- Test: `src/features/dashboard/meeting/BigScreen.test.tsx`; `src/features/dashboard/MeetingView.test.tsx` must stay green

**Interfaces:**
- Consumes: the session actions of Task 3 (`goTo`, `togglePause`), the agenda sheet, and the Task 1 rule (no meeting keys while a dialog is open).

**Requirements:**
1. A "Big screen" toggle button in the top bar (`aria-pressed`). On: the whole meeting screen shows 1.25 times larger (CSS `zoom` on the meeting content is acceptable). The choice is kept in `localStorage` (try/catch; blocked storage means off).
2. Single keys, by physical key (`event.code`, so they also work with an Arabic keyboard): N (KeyN) next project, B (KeyB) previous project, A (KeyA) opens the agenda, T (KeyT) pauses or resumes the timer. Escape leaves the meeting (as today). The letter keys work in mode `projects`; N and B do nothing on the timeline.
3. No meeting key acts while the focus is in an input, a text area, a select or an editable element, while a modifier key (Alt, Ctrl, Meta) is down, or while a dialog is open.
4. The agenda sheet shows one line: "Keys: N next, B back, A agenda, T timer, Esc leave" (Arabic: the same keys as Latin letter names are not allowed inside Arabic text, so write the Arabic line with the key names in Arabic words, for example "المفاتيح: التالي، السابق، جدول الأعمال، المؤقت، الخروج", and show the letters as separate `<kbd>` elements outside the translated string).
5. The screen stays awake while the meeting view is open and visible: request `navigator.wakeLock.request('screen')`, request it again when the page becomes visible, and release it when the meeting view closes. A missing API or a refusal does nothing.

**Tests (write first):**
- N and B change the project in mode `projects`; A opens the agenda sheet; T pauses the timer (the time text stays the same after time passes).
- Typing "n" in the decision field does not change the project.
- With a task panel open, N does nothing.
- "Big screen" toggles `aria-pressed` and stays on after the meeting view renders again.
- With a mocked `navigator.wakeLock`, the meeting requests a lock on open and releases it on Exit; without the API, the meeting renders with no error.

**Commit:** `Meeting view: big-screen mode, single keys, and a screen that stays awake`

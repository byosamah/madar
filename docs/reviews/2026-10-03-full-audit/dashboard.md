# Dashboard and meeting mode audit

Scope: `src/features/dashboard/**`, `src/lib/agenda.ts`, `src/lib/schedule.ts`, and the API calls they use (`dashboard.get`, `events.list`, `tasks.list`, `chats.*`). I read the meeting plan and its ledger first. This report does not repeat a parked or deferred minor from the ledger.

How I proved the findings: I ran probe tests from the scratchpad against the real code (`audit/probe/*.test.tsx`, run with `npx vitest run --config audit/probe/vitest.config.mjs`). The repository is unchanged. The existing dashboard and meeting suites pass (19 files, 140 tests).

## Findings

### DSH-1 The summary drops every line of a project that leaves the agenda
- Type: BUG
- Severity: MEDIUM
- Where: src/features/dashboard/MeetingView.tsx:293, src/features/dashboard/meeting/MeetingSummary.tsx:115, src/api/handlers/insights.ts:140
- What happens: The summary lists only the projects in `agendaIds`. `agendaIds` comes from `dashboard.get` schedule, and the schedule holds only active and paused projects. Probe: add the decision "Hand over the kiosks." on Shore Walk Retail Kiosks, open the summary (the line shows), then set the project to Completed. The summary now says "No changes in this meeting yet." The decision, and the status change itself, are gone from the summary, from "Copy as a table" and from "Share to the project chats". A team that closes or archives a project in the meeting loses that project from its minutes. The same happens when a person leaves the meeting, changes a filter on the Dashboard, and comes back. Plan Task 5 requirement 2: "every change since startedAt".
- Fix idea: Build the groups from every project that has events since `startedAt`. Keep the agenda order first and put the other projects after it. Take the names from the event view or from `projects.list` with status `all`, not from the schedule.

### DSH-2 A room screen left on overnight runs the morning meeting with yesterday's start time, then drops the first decisions
- Type: BUG
- Severity: MEDIUM
- Where: src/features/dashboard/meeting/session.ts:88-108, src/features/dashboard/meeting/DecisionsPanel.tsx:73,83, src/features/dashboard/meeting/MeetingSummary.tsx:96
- What happens: The new-day check runs only when the page becomes visible again or when a change saves (Done, Skip, N, B, T, Pause, the agenda). A room screen with the wake lock stays visible, so nothing runs the check in the morning. Probe: write "Yesterday decision" on 30 Sept, move the clock to 08:00 on 1 Oct, write "Morning decision", then press Done at 08:04. Results: (1) Before Done, the Decisions panel of the new day still lists "Yesterday decision". (2) Done starts the new meeting with `startedAt` 08:04, so "Morning decision" leaves the Decisions panel. (3) The summary says "Changes since 08:04" and does not hold "Morning decision", so the share to the chats also misses it. The ledger re-graded this case (Minor 7) into the fix wave. The fix covers the save and the page-show paths only, not a page that stays visible.
- Fix idea: Run the day check on a timer while the meeting is open (for example once a minute, or in the Timer tick). Alternatively, give a new day's meeting the start of that day's first change, not the moment of the first press.

### DSH-3 Done, Skip, the keys and the Decision/Action switch throw away a typed decision or action
- Type: ADHD
- Severity: MEDIUM
- Where: src/features/dashboard/MeetingView.tsx:520, src/features/dashboard/meeting/DecisionsPanel.tsx:20,39-41,103-104
- What happens: The decision text and the action title live in local state. `MeetingProject` has `key={project.id}`, so any move to another project unmounts the forms. Probe 1: type "Half typed decision" (no Add), press Done, press B to come back: the field is empty. The arrow keys, N, B, an agenda pick, the summary and the mode switch do the same. Probe 2: type a decision, switch to Action, type an action title, switch back to Decision: both fields are empty, because only one form is mounted at a time. Nothing warns the person. Owner ADHD rule: "nothing that resets or loses work by accident".
- Fix idea: Keep one draft for each project and kind in the meeting (state in `MeetingView`, or the meeting session). Keep both forms mounted and hide the one that is not chosen, or keep the text when the kind changes.

### DSH-4 "Share to the project chats" posts the same summary twice
- Type: BUG
- Severity: MEDIUM
- Where: src/features/dashboard/MeetingView.tsx:298, src/features/dashboard/meeting/MeetingSummary.tsx:135-161
- What happens: The "already shared" state lives in `MeetingView` React state only, and it covers the whole summary as one block. Probe 1: share, press Exit, open the meeting view again, open the summary. The Share button is enabled again, and a press posts a second, identical summary to the project chat (2 messages). A reload does the same. Probe 2: share a summary of projects A and B, then add one decision in B and share again. A's chat gets the same unchanged summary a second time (bodies equal). Every person in those chats sees the duplicates. Commit 0f6babe promised "Share posts once until the summary changes".
- Fix idea: Keep what went out in the meeting session (sessionStorage), for each project. On a later share, post only to the projects whose lines changed since their last share, and say "Shared" when nothing changed.

### DSH-5 An action in a paused project makes a task but never shows it
- Type: BUG
- Severity: MEDIUM
- Where: src/features/dashboard/meeting/DecisionsPanel.tsx:76, src/api/handlers/tasks.ts:121,130
- What happens: `DecisionsPanel` reads `tasks.list({ projectId })`. That call defaults to `activeProjectsOnly: true`, so it returns no tasks for a paused project (probe: Gulf Crest HQ Interiors has 13 tasks, the call returns 0). Paused projects are in the meeting when the status filter is On hold or All. Probe: open the meeting with `status=all`, go to Gulf Crest HQ Interiors, add the action "Call the client back". The task is made, the field clears, and the panel lists nothing. The person sees no result and is likely to add it again, which makes a duplicate task. The Decisions panel promise (plan Task 4, requirement 4) is that it lists the actions added since the start.
- Fix idea: Call `tasks.list` with `activeProjectsOnly: false` in `DecisionsPanel`, as `MeetingView` already does.

### DSH-6 A workload cell counts the lead's tasks, and the list it opens adds helper tasks
- Type: BUG
- Severity: MEDIUM
- Where: src/api/handlers/insights.ts:113-114, src/features/dashboard/Workload.tsx:40, src/api/handlers/tasks.ts:132
- What happens: `dashboard.get` counts a task for a person only when `ownerId` is that person. The cell links to `/tasks?owner=<id>&from&to`, and `tasks.list` with `ownerId` uses `involves()`, which also matches helpers. Probe: make Hala Nasser a helper on "Structural drawings check" (due this week). Her cell for the week of 27 Sept says 0. The list it opens shows 1 task. Spec 8.4: "A click on a cell opens the Task list for that person and that week", so the number and the list must agree.
- Fix idea: Choose one rule. Either count helper tasks in the cell (the person's real load), or give `tasks.list` a lead-only option for this link.

### DSH-7 The Dashboard numbers drop the Team filter when they open a list
- Type: BUG
- Severity: MEDIUM
- Where: src/features/dashboard/Numbers.tsx:22,28, src/features/dashboard/Charts.tsx:47,54-56
- What happens: With a Team filter, every number counts only that team's projects, but the links open `/projects?status=active`, `/projects?filter=at_risk`, `/projects?health=...` and `/projects?stage=...` with no `team`. The Projects screen reads `team` from the link (src/features/projects/ProjectsScreen.tsx:37-38), so it can show the same set. Probe (sample office, team Interiors): "Active projects" says 5 and opens 9 projects; "At risk or late" says 3 and opens 5. Plan 4 accepted that the leader and client filters do not carry over because the target screens had no such filters. The Team filter came later (comment D6), and the Projects screen supports it.
- Fix idea: Add `team` (and, through `projects.list`, which already accepts them, `leader` and `client`) to the Projects links. For the task-list links, either add the team filter there or show the team in the list subtitle.

### DSH-8 A decision shows twice on the project screen
- Type: ADHD
- Severity: LOW
- Where: src/features/dashboard/MeetingProjects.tsx:92-93,166-179
- What happens: A decision is a project update. "Latest update" shows the newest update, so the decision the person just added shows in the Decisions panel and again in Latest update (probe: "Keep the lobby double height." appears in both regions). Owner ADHD rule: one place for each thing.
- Fix idea: In the meeting, let Latest update skip updates that carry the decision flag, or skip updates made since `startedAt`.

### DSH-9 Display panels still show "nothing here" text and a zero count
- Type: ADHD
- Severity: LOW
- Where: src/features/dashboard/MeetingProjects.tsx:72,134,152,168
- What happens: A project with no future deadline shows the panel "Coming up" with "No deadlines yet.". A project with no update shows "Latest update" with "No updates yet.". "Needs attention" shows a "0" badge and "Nothing needs attention.". Owner decision (plan Global Constraints): "A panel that only shows things, and has nothing to show, is not rendered at all (no empty card, no 'nothing here' text)". The ADHD pass applied this to "In progress" and says "A count of zero is not said" for the timeline, but not to these panels.
- Fix idea: Hide Coming up and Latest update when they are empty. Ask the owner if "Nothing needs attention." stays as a positive state word, and drop the "0" badge either way.

### DSH-10 Done cannot be undone
- Type: ADHD
- Severity: LOW
- Where: src/features/dashboard/meeting/session.ts:165-171, src/features/dashboard/meeting/AgendaSheet.tsx:64-79
- What happens: Done is the primary button. A press marks the project "Discussed" and moves on. There is no way to take the mark back: Done again keeps it, the agenda only goes to the project, and "Start a new meeting" clears every mark and timer. One wrong press can make the bar say "All projects discussed" too early. Owner ADHD rule: nothing that resets by accident, and every change has a way back.
- Fix idea: Show an Undo toast after Done, or let a press on the "Discussed" sign in the agenda take the mark back.

### DSH-11 The project clock runs while the tab is hidden or the computer sleeps
- Type: BUG
- Severity: LOW
- Where: src/features/dashboard/meeting/session.ts:101-108,142
- What happens: The clock runs when `onScreen && !paused`. `onScreen` is the mode, not the page visibility, and the visibility handler only checks the day. If the person switches to another tab to show an email, or closes the laptop for lunch, the time keeps counting, so the project returns as "55:00 over". Plan Task 3, requirement 2: "The timer counts down only while that project is on screen."
- Fix idea: Stop the clock when `document.visibilityState` is `hidden`, and start it again when the page shows.

### DSH-12 Each browser tab has its own meeting
- Type: GAP
- Severity: LOW
- Where: src/features/dashboard/meeting/session.ts:33,46
- What happens: The session lives in `sessionStorage`, which belongs to one tab. A second tab (a laptop that follows the room screen, or the room computer after the browser closes) starts a new meeting: a new start time, no discussed marks, the timers at zero. The Decisions panel and the summary of that tab then miss everything from before it opened. The plan chose `sessionStorage`; no owner decision covers the loss.
- Fix idea: Keep the day's session in `localStorage` under the same day key, so all tabs and a reopened browser share one meeting.

### DSH-13 Status Completed or Archived makes every Dashboard number 0, and each 0 opens a full list
- Type: ADHD
- Severity: LOW
- Where: src/api/handlers/insights.ts:69-70,119-125,140, src/features/dashboard/Numbers.tsx:22
- What happens: The tiles, the charts and the workload count only active projects inside the chosen status. Probe (sample office): status Completed or Archived gives Active 0, At risk 0, Past due 0, Deadlines 0, Area 0, no stages, no health mix, an empty schedule and an all-zero workload. Status On hold gives the same, except 2 schedule rows and the throughput. "Active projects 0" still opens the list of 9 active projects. Two of the five status choices change nothing a person can read. ADHD rule: the fewest controls, no control without an effect.
- Fix idea: Remove Completed and Archived from the Dashboard status filter, or make the numbers and the schedule follow the chosen status.

### DSH-14 The office schedule hides deadlines and the current stage from keyboard and screen-reader users
- Type: BUG
- Severity: LOW
- Where: src/features/dashboard/OfficeSchedule.tsx:52,137,154-160
- What happens: The bar area of each row is `aria-hidden`. The deadline diamonds carry their name only in `title`, so a keyboard user cannot reach them and a screen reader never reads them. In the opened stage lines, done, current and next differ by color only. The meeting timeline already solved both (deadline buttons, and stage labels with the state).
- Fix idea: Reuse the meeting timeline's `DeadlineMarks` and its stage `aria-label` with the state word.

### DSH-15 The office schedule colors mean other things than in the meeting
- Type: ADHD
- Severity: LOW
- Where: src/features/dashboard/OfficeSchedule.tsx:95,97,148,159
- What happens: The deadline diamonds use the attention color (`bg-attn`), but the owner's ADHD pass made them quiet grey in the meeting ("A deadline is a date, not a warning"). The legend shows a blue swatch for "Current stage", but each bar uses its own project hue, so the legend does not match most rows. The same office then shows one mark in two colors on two screens.
- Fix idea: Use the meeting colors here too (grey diamonds, the state tone for the current stage), or at least draw the legend swatch as "the project color".

### DSH-16 "Area in design" depends on the English stage name "Supervision"
- Type: BUG
- Severity: LOW
- Where: src/api/handlers/insights.ts:124
- What happens: The tile leaves out projects whose stage tag is named exactly "Supervision". The Admin can rename the default stages (`settings.update` accepts `defaultStages`, src/api/handlers/people.ts:283), and a project can use other stage names. A project in "Site supervision" (or an Arabic name) counts as in design, so the area is too high.
- Fix idea: Mark the supervision stage by its place (the last default stage) or by a flag in the settings, not by its English name.

### DSH-17 Share does not say which projects it skipped
- Type: GAP
- Severity: LOW
- Where: src/features/dashboard/meeting/MeetingSummary.tsx:148-162
- What happens: Share posts only to chats the viewer can see. A team member who is not on every project gets "The summary went to 1 chat." for a summary of 3 projects. The toast does not name the 2 projects that got nothing, so the person thinks the minutes reached everyone. (The ledger's parked note covers the empty `catch`, not this message.)
- Fix idea: Name the skipped projects in the toast, for example "Not shared: Corniche Office Tower, Tamr Staff Housing".

## Checked, no finding

- Arabic summary lines: every summary sentence has a `_female` form, and `actorContext` passes the gender. The counts (`minutes`, `shared`, `sharedButton`, `deadlineCount`, `personOpen`, `personLate`) have the Arabic plural forms.
- Arabic keyboards: the letter keys use `event.code`, and the arrows follow the reading direction.
- Agenda changes during a meeting: a project that leaves the filter or the active list drops out of the order, and the first open project shows (the one-frame flash is a parked minor).
- Deadlines tile against the deadline list: 12 and 12. Past-due tile against `/tasks?filter=overdue`: equal when no people filter is on.
- Timeline at Week, Month, Quarter and Year: labels, the today line and the steps behave as the commits say.

## Unconfirmed

- Big screen: `DeadlineMarks` measures its row with `getBoundingClientRect` and does not divide by the root zoom (src/features/dashboard/MeetingView.tsx:121). Under the 1.25 zoom, two close deadlines may not group and their 24 px buttons may overlap. I could not check this without a browser.
- After Exit, the "Meeting view" button opens the timeline, not the project screen the person left, because the Dashboard link keeps the filters only (src/features/dashboard/DashboardScreen.tsx:58). The session still holds the project, so this is friction, not loss.

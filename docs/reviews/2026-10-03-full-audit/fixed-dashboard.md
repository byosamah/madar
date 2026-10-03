# Fixed: Dashboard and meeting mode

Branch `fix-dashboard` in `/Users/osamakhalil/dev/madar-fix-dashboard`, last commit `b587392`. Full suite 1270/1270, `tsc` clean, `check-rtl` clean.

Note on the full suite: while other fixers ran their suites, the machine load average reached about 130, and 1 to 5 tests in files I did not touch (TaskFeatures, SearchScreen, ProjectByCode, TeamFilter) timed out, a different set each run. Each of those files passes alone (TaskFeatures 3 of 3), and the full run at a lower load passed 1270/1270.

DSH-1 | Fixed | ae9c5fb | The summary now covers every project of this meeting (the session's saved order), so a project that the meeting completes or a filter hides keeps its lines; its name comes from `projects.list` with status `all`.
DSH-2 | Fixed | c54a3b6 | The day check also runs once a minute, so a room screen that stays visible starts the new day's meeting by itself, before the first change of the morning.
DSH-3 | Fixed | 2d6b363 | The meeting context holds one draft for each project and kind (and the chosen kind), so Done, Skip, the keys, the agenda and the Decision/Action switch keep typed text.
DSH-4 | Fixed | ae9c5fb | The meeting session (sessionStorage) keeps the lines that went to each project chat; Exit, reload and Back keep "Shared", and a later share posts only to projects whose lines changed.
DSH-5 | Fixed | 98fdcd5 | `DecisionsPanel` reads `tasks.list` with `activeProjectsOnly: false`, so an action in a paused project shows in the panel.
DSH-6 | Skipped | none | Not in my task: already fixed (the workload counts helper tasks).
DSH-7 | Fixed (part) | feb5454, b587392 | Active projects, At risk or late, the health mix, the stage bars and Area in design now carry `team=` to the Projects screen; the task-list links (Past-due tile, Deadlines row, weekly chart) do not, because the task list has no team filter (see question 2).
DSH-8 | Fixed | b81131f | Latest update skips a decision made since the meeting started, so the decision shows in the Decisions panel only.
DSH-9 | Fixed | b81131f | Coming up and Latest update do not render when empty; Needs attention keeps "Nothing needs attention." and no longer shows a "0" badge.
DSH-10 | Fixed | 05bb30d | Done shows the app toast "<project> marked as discussed." with Undo; Undo shows the project again and takes back the mark only when Done added it.
DSH-11 | Fixed | c54a3b6 | The project clock stops when the page is hidden (another tab, or a computer that sleeps and sends the page-hidden event) and runs again when the page shows.
DSH-12 | Skipped | none | Owner question (see question 1): a shared session in localStorage would let two tabs write one meeting at once.
DSH-13 | Fixed | feb5454 | Completed and Archived are gone from the Dashboard and meeting status choices; a link that carries them reads as Active.
DSH-14 | Fixed | 071699a | The office schedule uses the meeting's deadline buttons (keyboard and screen reader reach the name and date) and gives each stage bar its name and state as a label.
DSH-15 | Fixed | 071699a | The office schedule uses the meeting colors: grey diamonds, and the current stage grey on track, orange tint with orange edge at risk, solid red late; the legend names the three states; shared code moved to `src/features/dashboard/scheduleMarks.tsx`.
DSH-16 | Fixed (part) | 1ecc2ab | Area in design now leaves out the last stage of the office default list (by place), so a renamed or Arabic list works; a project-only stage name such as "Site supervision" is not caught (see question 3).
DSH-17 | Fixed | ae9c5fb | The share toast names the projects that got nothing, for example "The summary went to 1 chat. Not shared: Corniche Office Tower."
BRW-1 | Fixed | 395f0b2 | The meeting key listener now runs in the capture phase on the window, before a sheet closes itself, and an open menu also blocks it; `exit()` drops `mode` and `task` from the Dashboard link (the test forces React to draw between listeners, as a browser does, to show the bug in jsdom).
BRW-14 | Fixed | a30dc16 | Decision and Action use the app's Undo toast: "Decision added." and "Task added for <person>."; Undo takes the update or the task back and the line leaves the panel.
BRW-18 | Fixed | 395f0b2 | Below 640 px the meeting opens in Projects mode; `mode` in the link still wins, and Timeline stays a choice (it writes `mode=timeline` there).
BRW-19 | Fixed | 4adc77a | The session keeps the projects that Skip moved, and the agenda says "Skipped" next to one until it is discussed.

## Questions for the owner

1. DSH-12: each browser tab has its own meeting. A shared meeting (localStorage) lets a laptop follow the room screen, but two tabs that press Done at the same time would overwrite each other's marks and clocks. Keep one meeting per tab, or share it with "the last change wins"?
2. DSH-7: the Past-due tile, the Deadlines row and the weekly chart open the task list, which has no team filter. With a team filter on, the number counts the team and the list shows the whole office. Add a team filter to the task list (a new `tasks.list` input), or say the team in the list title?
3. DSH-16: a project can name its site stage freely ("Site supervision"). The new rule catches only the last stage name of the office list. Add a "site stage" mark to the stage or to the settings?
4. DSH-1: the summary covers every project that was in the meeting on that day, also from an earlier filter. A second meeting with another filter on the same day, in the same tab, still lists the first meeting's projects until someone presses "Start a new meeting". Should a new filter start a new meeting?

## Screens that changed

- `/dashboard/meeting?mode=projects`, Agenda, then Escape: only the sheet closes. The same for a person chip in the People strip. A decision or an action: the toast "Decision added." or "Task added for <person>." with Undo. After Skip, the agenda says "Skipped" next to the project.
- `/dashboard/meeting` at 390 px: opens on the project screen, not the timeline.
- `/dashboard/meeting?mode=projects`: type a decision, press Done, press B: the text is still there. After Done: the toast with Undo at the bottom. A project with no future deadline or no update: no Coming up or Latest update panel. Needs attention with nothing: the calm sentence with no "0" badge. A new decision shows in the Decisions panel only.
- `/dashboard/meeting?mode=projects`, Agenda, "See the meeting summary": after Share the button reads "Shared to N chats" and stays so after Exit and return; the toast names projects with no chat.
- `/dashboard?view=schedule`: grey deadline diamonds (now 24 px buttons with a hover and focus label), the current stage colored by state (grey, orange tint, red), and the legend line "Current stage: On track / At risk / Late".
- `/dashboard/meeting` (timeline): the deadline diamonds have a thin edge in the panel color (a small visual change from the shared code).
- `/dashboard`, Filter: the Status list has Active, Paused, All statuses only. `/dashboard?status=completed` shows the Active numbers.
- `/dashboard?team=tm_003`: Active projects and At risk or late open `/projects?...&team=tm_003` with the same count.

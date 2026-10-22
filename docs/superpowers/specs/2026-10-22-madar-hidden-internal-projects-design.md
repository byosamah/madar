# Batch D: hidden projects, "See every project" and internal projects

Owner: Osama, 2026-10-22. Lead: Claude (Opus). Status: design approved by the owner's answers; the build waits for his word.
It joins two open items: step 2 of role rights ("See every project", `TASKS.md`) and the team report fbk_044.

## The report (fbk_044, Faisal)
"internal projects, projects that do not have location or code and other stuff, but projects for internal development, for example
portfolio project, where the team have tasks and stages and deadlines like other projects, but remove stuff like location and area and
other construction related things, these projects visibility should be hidden by default, and can be controlled to be viewable for some
users, or viewable to all"

## Owner decisions (2026-10-22, final)
1. **Any project can be hidden.** Each project has one choice: "Everyone in the office" or "Only the team and chosen people". An
   internal project starts hidden. A client project starts open.
2. **A hidden project shows to its leader, its team, its chosen people and the Admin** (like office to-dos).
3. **The project leader and the Admin change who sees a project**: a new power with two scopes, "Projects I lead" on for every role,
   "Every project" for the Admin only. The Admin can turn the power off for a role.
4. **An internal project** has no code on the screens, no client, no location or map pin, no area, no sub-company, no contract date,
   no payments and no Tracker. It keeps stages, to-dos, deadlines, meetings, files, chat and posts. It counts in workload and in the
   to-do lists, never in client, money or map numbers.
5. (Earlier, 2026-10-21) "See every project" is step 2 of role rights: a role without it sees only the projects where the person
   works. Nobody gains or loses a power on release day: the switch is on for every role by default.

## Lead's calls (not asked; the owner can change them)
- **"See hidden projects" is a switch**, held by the Admin only by default (every new power is a switch, role rights version 2). The
  Admin can give it to Management, for example.
- **A chosen person gets what any office person outside the team gets on an open project today** (read, comment, chat, and the to-do
  rights of the role). No new "read only" level.
- **The internal project keeps a code in the data, never on the screens.** `Project.code` is required in the contract and many readers
  use it, so an internal project gets the old automatic form with the prefix `INT` (`INT-26-001`, `nextProjectCode`). The screens show
  the word "Internal" where a code shows. This keeps the contract additive. Agents see the code and `kind`.
- **The kind is chosen at creation and does not change** in this batch. A wrong kind: delete the project and make it again.
- **A hidden project answers exactly as a missing one** (`not_found`, the text of an unknown id) on every read and write, for every
  person who does not see it, the Admin's agent included when the Admin lacks the switch. Sequential ids stay (accepted for office
  to-dos on 2026-10-06).

## The rule (one function)
`mayViewProject(state, project, viewer)` in `src/api/permissions.ts` (with `can(actor, 'project.view', resource)`):
- true for a holder of `project.hidden` (the Admin by default);
- true for the leader, a team member, or a chosen person (`viewerIds`);
- true when the project is open and the viewer holds `project.seeAll`;
- false otherwise.
An inactive person keeps today's rule (`project.view` true) only for names in the History of projects they already saw; a hidden
project never shows to them. Agents use the rights of their person.

## Data (additive, no migration: projects keep the whole record in `doc`)
- `Project.kind`: `'client' | 'internal'`, optional; missing means `client`.
- `Project.access`: `{ hidden: boolean, viewerIds: UserId[] }`, optional; missing means open with no chosen people. At most 50 people.
- New rights in the catalog JSON and `src/api/rightsCatalog.ts` (counts grow by 4; each role count follows the defaults):
  - `project.seeAll`, "See every project": basic, on for every role.
  - `project.access.lead` (basic, on for every role) and `project.access.all` (Admin only): "Choose who sees a project".
  - `project.hidden`, "See hidden projects": Admin only.
- A new call `projects.setAccess { id, hidden, viewerIds }`: needs `project.access` on the project (scope by role). It writes one
  event (`project.access_changed`, before and after), so Undo works. A person who loses the view by this change gets nothing more about
  the project; a chosen person gets the notice `added_to_project`. MCP: deny list (people work happens in the screens), with one line
  in `TOOL_DOCS` of `projects.get` and `projects.list` about `kind` and `access`, and one line in `INSTRUCTIONS`: a project that answers
  `not_found` may be hidden from the person; never guess its content.
- `projects.create` takes `kind`. An internal project: `clientId`, `geo`, `areaM2`, `subCompanyId` and `contractStartDate` must be
  empty (reason `internal_project` on the field), `access.hidden` starts true, and the code is the `INT` automatic code (any typed
  code or `codeParts` is refused with `internal_project`). `projects.update` refuses those fields on an internal project.
  `payments.create` and `tracker.log` refuse an internal project (reason `internal_project`).

## Where the rule must hold
Every path in the read-path map (appendix, from the research of 2026-10-22): the read calls, the loaders and the office cache, the
Realtime signals (a hidden project's changes go as person signals to the people who see it, like `privatePeople` of office to-dos in
`server/data/save.ts`), the notices (`notify` skips a person who does not see the project; a notice whose project became hidden reads
as gone), the push plan, the email (notice mail and the morning summary), Google Calendar (a meeting of a hidden project syncs only
for its people), search, the Dashboard (tiles, workload, schedule, map, gaps, money), `reports.office`, the client counts, the template
follower counts, `events.list` and Undo, chats (project chat rows, task threads, unread counts, `chats.waiting`), files and links,
`#code` links in posts and the project-by-code route, and every MCP tool that takes a project id.
Counts follow what the viewer sees: a workload cell of another person counts only the to-dos of projects the viewer sees (the rule of
office to-dos in `activeTasks`).

## Internal projects in the numbers
- Count: workload, the to-do lists, Home, the morning summary (for its people), deadlines, the schedule.
- Never: client counts, money, the map, the client report parts, and the gaps that ask for client data (`no_area`, `no_sub_company`,
  `stage_no_end` stays: stages still have dates).

## Screens
- New project sheet: the first control is one choice "Client project" / "Internal project" (Client by default). Internal hides the
  code fields, client, location, area, sub-company and contract date, and shows one line: "Only the team sees an internal project.
  You can share it later."
- The project header and every row show the word "Internal" where the code shows. A hidden project shows a small lock mark beside
  its name, with the words "Only the team and chosen people" for screen readers and on hover.
- An internal project has no Tracker tab and no payments part. A client project keeps both.
- Team tab: a block "Who sees this project" at the top, with two choices (radio): "Everyone in the office" and "Only the team and
  chosen people"; with the second, the chosen people with "Add people" (the picker of `AddTeam`) and a remove on each. Only for a
  person with `project.access` on the project; others see one plain line that says who sees it. Each change saves at once with a
  toast and Undo.
- Role sheet: the four new switches in the Projects section, with their words.
- What's new: (a) internal projects; (b) hide a project from the office; (c) for the Admin: a role can see only its own projects.

## Leak tests (root rule: the builder writes them)
For a person outside a hidden project, and for the agent of that person: every read path of the map answers as for a missing
project (no row, no count, the same error text), every Realtime signal leaves the person out, no notice, push or email names it,
search finds nothing, the Dashboard and the report count nothing of it, `#code` and `/p/<code>` links resolve to nothing. The same for a
role without `project.seeAll` and an open project where the person does not work. Then the same probes as a chosen person, who must
see it all. The Admin without `project.hidden` (a test office with the switch off) must see nothing.

## More lead's calls (from the read-path map)
- **A chosen person is no team member.** Chat, push, notices and `task.add` treat a chosen person like an office person outside the
  team on an open project: a project chat pushes them only when a message names them, and a new to-do needs the "every project" scope.
- **The people of a meeting of a hidden project must see the project.** `meetings.create` and `meetings.update` refuse anyone else
  (reason `not_in_project_audience`). A person who loses the view loses the meeting too, and Google Calendar takes the event away
  (`GCAL_CALLS` gains `projects.setAccess`, `members.remove` and `projects.setLeader`).
- **The events of a deleted project that was hidden show only to holders of `project.hidden`** (the Admin). An open project keeps
  today's rule.
- **A code question never names a hidden project.** `code_taken` keeps its reason but leaves out the key when the other project is
  hidden from the person. The server still checks every project, so codes stay unique. Internal projects take `INT` codes and never use
  a series of the client code.
- **The Home cache on a device** may show a project for a moment after the person lost the view, until the fresh read replaces it.
  That data was already on the device; the next read removes it.
- **The office cache stays as it is** (it loads every project for every call). Every guard runs in the handlers and in the SQL of the
  loaders, as for office to-dos.

## Build (when the owner says go)
Too big for one pass, so four waves, one Sonnet builder each, each wave merged with its gates before the next starts:
- D1, the core: the rights and the data, `mayViewProject`, `projects.setAccess`, and the doors that every call passes:
  `requireProject` (P-view first, `not_found`, before any `assertCan`), `taskResource` and `can('task.view' | 'comment.read')`,
  `mayViewFile` and `server/files/rights.ts` (`not_found`, never `forbidden`), `meetingResource`, `seesEvent`, `notify`, the child
  doors (`requireDeadline`, stage ids, `requirePayment`, `requireEntry`, `requireUpdate`, `requireComment`, `targetOf`,
  `tasksCreateFromTemplate`, `assertMayApply`). Leak tests for each door.
- D2, the lists and the SQL: `projects.list`, `peopleFilter` and `teamFilter` (they gain the viewer), `tasks.list`, `deadlines.list`,
  `dashboard.get` (and `leaderIds`), `search.query`, `reports.office` (stage moves by project), `subCompanies.list`, the template
  `usage` and `followers`, `session.get` leaders, `taskThreads` and the three thread sources (`threadsSql`, memory, lite), the SQL limits
  of search, messages and `events.list`, `meetingConds`. Leak tests that fill the limits with hidden rows.
- D3, the signals and the outside: `diffState` and `writeDiff` (a hidden project's kinds go as private person signals to its audience
  before and after a change), the comment lookup fallback, push facts and `planPushes`, the morning summary SQL, Google Calendar,
  `settleActorOf` and `extendActorOf` (fall back to an Admin), the notice view twins (`hiddenProject` beside `hiddenTask`, in the four
  mirrored places), the sweep traps (`server/data/loaders/sweep.ts`, `everyCall.ts`, the shadow run).
- D4, internal projects and the screens: `kind`, the `INT` code, the refusals, the numbers, and every screen of this design.
- The lead runs the full suite, `test:db`, `test:it`, `test:mcp` and the screenshots once per wave.

## Appendix: the read-path map (research of 2026-10-22, condensed)
Five facts that shape the job:
1. The office cache (`OFFICE_COLLECTIONS`, `server/core/types.ts:15`) gives projects, members, stages, deadlines, project chats and
   sub-companies to every call. A project cannot be hidden by loading less: guard in handlers and in loader SQL (`meetingConds`,
   `server/data/loaders/meetings.ts:22`, is the model).
2. Almost no read asks `project.view` today (`permissions.ts:322` answers true). `requireProject` (`handlers/shared.ts:38`) only checks
   that the row exists. Making it P-view aware is the central fix, as `requireTask` and `mayViewTask` are for office to-dos.
3. `assertCan` throws `forbidden`, so any call that reaches it before the view check tells an outsider that the project exists.
4. The Realtime office signal names every project (`writeDiff`, `server/data/save.ts:584-696`), and every signed-in tab can join it.
5. Old notices, events, screen caches and the Home cache keep what they had: hide by the current state, never by a stamp.

The doors and lists, by group (file:line on main fde7c8c3):
- Projects: `projectsList` (projects.ts:285), `projectsGet` (:328, also `pictures.get`), `deadlinesList` (:995), `requireEditable` (:263),
  `requireDeadline` (:269), `stagesSetDates` (:914), `stagesSetPrerequisites` (:934), codes (:81-130, :409).
- To-dos: `tasksList` (tasks.ts:160), `tasksGet` and every write through `requireTask`, `createTask` (:316), `tasksCreateFromTemplate`
  (:388, the stage error comes first today).
- Posts and comments: `updatesList` (content.ts:60), `requireUpdate` (:21), `requireComment` (:31), `targetOf` (:45), `commentsList`
  (:120, `assertCan` before the view), `commentsCreate` (:133), `reactionsToggle` (:182).
- Files: `filesList` (files.ts:39), `filesUpload` (:179), `mayViewFile` (views.ts:452), `attach.ts:9,18,35`, `sharing.ts:57`,
  `server/files/rights.ts:43-52` and `server/calls/files.ts:58,111` (today `forbidden` for a hidden project; must be `not_found`),
  `serverFakes.ts:109,128`.
- Tracker: `trackerList` (tracker.ts:177), `trackerLog` (:198), `trackerExport` (:342), `requireEntry` (:26, no project check today).
- Payments: `paymentsList` (payments.ts:36), `requirePayment` (:25, no project check at all today).
- Meetings: `requireMeeting` (meetings.ts:54), `meetingsGet` (:599), `meetingsList` (:608), `assertMayPlan` (:209), `checkPeople` (:185),
  `meetingResource` and `mayViewMeeting` (permissions.ts:236-243, `meeting.view` true for a project meeting today).
- History: `seesEvent` (history.ts:63), `eventsList` (:74), `eventsUndo` (:585), `eventsUndoStory` (:600), `noticeTaskHidden` (:525).
- Dashboard and search: `dashboardGet` (insights.ts:143; `leaderIds` at :232 scans all projects), `searchQuery` (:336; projects at :350
  and sub-company counts at :370 are unfiltered), `messageHits` (messageSearch.ts:89).
- Report: `buildReport` (reports.ts:61); the stage-move total (:83-86) is office wide in SQL: use `REPORT_KEYS.stageMovesOf`.
- Chats: `taskThreads` (chats.ts:147), `taskRows` (:174), `requireTaskThread` (:410), `totalUnread` (:214), `waitingFor` (:751),
  `chatsList` (:259), `requireConversation` (:36), `canSeeConversation` (chatState.ts:47).
- Templates and the rest: `projectTemplates.ts` `rowOf` followers (:45), `usage` (:400), `matchPlan` (:241), `link` (:274), `syncApply`
  (:443), `assertMayApply` (:230); `subCompaniesList` (:30); `sessionGet` leaders (people.ts:53); the notice views (`notifications.ts`
  `hiddenTask` :74, `hiddenMeeting` :84, `isGone` :91, `viewOf` :117).
- Loaders: `overview.ts` (`projectsList` :30, `dashboardGet` :49, `tasksList` :81, `searchQuery` :121 with `limit: 5`, `messageHits`
  :150, `eventsList` :182 with a SQL limit, `templateSyncTasks` :208), `report.ts:41`, `chat.ts` thread reads (`threadsSql` in
  `sqlSource.ts:245`, `memorySource.ts:177`, `lite/source.ts:201`, limit 20), `meetings.ts:22`, `steps.ts:41` (`officeTaskConds`, the model).
- Signals, notices, push, mail, Google: `diffState` (save.ts:201-560), `writeDiff` (:621-686), `COMMENT_TARGETS_SQL` (:603-617),
  `notify` (notify.ts:92), `runScheduledTriggers` (:186), `planPushes` (`server/push/chatRule.ts`), `PUSH_ITEMS_SQL` (`chatFacts.ts`),
  `summary.ts` SQL, `settleActorOf` and `extendActorOf` (`server/jobs/steps/meetings.ts:64,78`), `gcalRows` and `GCAL_CALLS`
  (`server/google/rows.ts`, `sync.ts:32`).
- MCP: no tool code changes for reads and writes (they run the shared calls as the person); `pictures.ts:157` inherits; the words of
  `docs.ts` (:63, :179) and the `projects.*` docs change.
- Screens that inherit `projects.list`: `ProjectByCode.tsx:20` (and every `#code` link), `ProjectCodeFields.tsx:42-63` and
  `codeForm.ts:38-53` (the series hint), `MeetingForm.tsx:106`, `ClientsSection.tsx:86-94` (counts), `PersonSheet.tsx:33`,
  `DeactivateSheet.tsx:26`, Home, `DashboardMap`, `OpenSpaceScreen`, the meeting summary, `ProjectActions`, `EditProjectSheet`.

Test patterns to copy: `officeTaskLeaks.test.ts`, `officeTaskPrivacy.test.ts`, `meetingLeaks.test.ts`, `messageSearchLeaks.test.ts`,
`chatsGroupLeaks.test.ts`, `pushLeaks.test.ts`, `rolesLeaks.test.ts`; server: `meetingsSignal.test.ts`, `chatSignalLeaks.test.ts`,
`save.test.ts`, `meetingFiles.test.ts`, `meetingTools.test.ts`, `adminCopies.test.ts`, `google/leaks.test.ts`, `meetings.it.test.ts`;
sweeps: `loaders/sweep.ts` (`trapOffice`), `everyCall.ts` (`EXPECTED_REFUSALS`), the shadow run `server/test/shadow.ts`.

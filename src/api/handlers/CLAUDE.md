# Handlers: rules of single features

Rules that a change to a handler can break without a test that fails. The tests state what a feature does. The rights,
the hidden-project rule, the notices and the new-call checklist are in `src/api/CLAUDE.md`. Field rules are in
`src/api/contract/CLAUDE.md`.

## Projects
- **Code** (`lib/projectCode.ts`, `YYMMSSINI-CLS-Type`). Old codes (`KH-26-014`) stay valid. Two projects of one contract
  share one code, so the projects table has no unique rule on the code. `projects.create` takes at most one of `codeParts`,
  `code` or `sameContractAs`. `nextProjectCode` counts only codes whose end after `<prefix>-YY-` is all digits, so a kept code
  with that head never gives "NaN".
- A typed code outside the office pattern fails with `code_format`. A code with the YYMMSS of another contract fails with
  `code_taken`. `codeAnyway: true` skips both. `codeWarning` is the one rule for the screens and the handler. A kept code is
  its own key (`projectKey`), has no contract, and gets no `#` link in posts. A save that keeps the stored code checks nothing.
  A new code is free text (`FREE_CODE_PATTERN`), a new building type passes `TYPE_PATTERN`, and the record takes any code of
  the office pattern (`RECORD_CODE_PATTERN`).
- Only `project.code` corrects a code (`patch.code`, verb `project.code_changed`).
- **Names and tile.** A view that names a project builds the ref with `projectRef` or `projectTile` (`src/lib/projectRef.ts`),
  never by hand, so `nameAr` and `shape` come along. `projects.update` with an empty `nameAr` clears it (no event when there
  was none). A ref carries `shape` only when it is not empty, and `ProjectRef.shape` refuses an empty text. A view that draws
  a tile needs `shape` in its ref.
- **Pin and Location.** `Project.location` stays a string, the address of the pin. `placeRule` and `saveLinks`
  (`handlers/projects.ts`) keep the pin and the text together in one patch, so one Undo takes both back. A write that moves
  the pin and gives no `location` sets `location` to ''. A write that removes the pin sets it to '', even when the write sends
  a text. A `location` alone fails with `location_needs_pin` while the project has a pin. `projects.addLink` and
  `updateLink` take an optional `location` for the pin that the link sets. `TOOL_DOCS` of `projects.update` sits at the length
  limit (`server/mcp/tools.test.ts`).
- **Continuous** (`Project.continuous`). Set it on and the call clears `targetEndDate` in the same change. A target end date beside it
  fails with `continuous_has_no_end`. A continuous project never turns Late from a stage end date (`health.ts`). The gap "a
  stage with no end date" skips it in the same three places, so the count equals the list: `dashboard.get`
  (`projectsStageNoEnd`), the `projects.list` filter `stage_no_end` (also `server/data/loaders/overview.ts`), and the line of
  `reports.office`. Test: `projectContinuous.test.ts`.
- **Internal projects** (`Project.kind`, set only by `projects.create`, never changed). Helpers: `src/api/internalProject.ts`,
  `INTERNAL_PREFIX` and `isInternalCode` in `lib/projectCode.ts`. The fields of a client project (`clientId`, `geo`,
  `areaM2`, `subCompanyId`, `contractStartDate`, `location`, a typed code) fail with `internal_project`; an empty value passes
  on update. The code is `INT-YY-NNN`, counted apart (`nextSeries` and `contractClash` read no INT code) and never shown (the
  word "Internal", `shownKey`, `src/lib/projectLabel.ts`). `Settings.codePrefix` may not be `INT`. `access` starts hidden.
  No payments and no Tracker: `payments.create` and `tracker.log` call `assertNotInternal`, and `addTrackerEntry` is the one
  door. The automatic lines skip it before the door (the shift line, the new-version line, the Balady tick, the meeting
  line). It stays out of the gaps `noArea` and `noSubCompany`, the money, and the Tracker counts; it stays in `stage_no_end`
  and the workload (`internalNumbers.test.ts`).
- **Folders** (`Project.folders`, `handlers/folders.ts`). They live in the project record, so exactly the people who see the
  project see them. A list row leaves them out (`withoutBase`, `views.ts`). All four calls ask `file.upload`. A folder
  change is the event `project.folders_changed`, a move is `file.moved`; neither is in `FEED_VERBS`. A move is no news:
  it never touches the project, so the "last update" order stays. `folders.delete` writes the `file.moved` events first
  and the folder event last, so one `events.undoStory` brings the folder back before it puts the files in it. Undo of a move
  into a folder needs the folder to stand (`assertReferencesExist`); the Undo of a folder change sends the files of a gone
  folder to the root (`releaseFilesOfGoneFolders`). A removed stage (`stages.replace`) takes its folders with it, silently.
  A file of a chat, a meeting or an office task cannot move. Leak tests: `folderLeaks.test.ts`,
  `server/data/folderSignals.test.ts`, `server/mcp/folderTools.test.ts`.
- **Tracker type Government.** The stored value stays `balady`. The screens call it Government. The `TOOL_DOCS` of
  `tracker.log` and `tracker.list` say what it means.
- `projects.pause` with a restart date: `pause.resumeOn` is a reminder. Madar never restarts a project. `projects.setRestart`
  asks `project.archive` and no reason, because the date of a reminder is no plan date. `runScheduledTriggers` (`notify.ts`)
  sends `resume_due` once for each person and each date (the dedupe key holds the day).

## Project templates
- Ids inside a template (`r1`, `s1`, `t1`) are unique in it. `ProjectTemplate.partSeq` is the highest part number ever given,
  so a part id is never given twice. `tasks.delete` and `stages.replace` add the removed part id to `droppedPartIds`, and
  `projectTemplates.link` fills it for each part with no pick.
- `projectTemplates.save` refuses a wait on a part that the template lacks (`prerequisite_not_in_template`), a repeated wait and a loop
  (`dependency_cycle`, `hasCycle` in `flow.ts`). A new project links the waits to its new ids.
- A task may move to another stage of its template: a plain save with a new `stageId` (`assertParts`). The update of linked
  projects (`syncDiff`) has no kind for it, so the project task keeps its stage.
- Stage templates merged into project templates. Their calls stay in the contract, their screens are gone.
- `link`, `matchPlan` and the add need `project.template` on the target project, and the project must be open (reason
  `project_closed`, `assertMayApply`). `link` with `replace: true` first removes the part ids of the old template (an event for
  each, so one Undo of the story brings them back). The same template fails with `already_linked`. `syncApply` with
  `apply: true` and only the picks of `isApplyChoices` (`bringBack`) needs the project right. Any other pick needs
  `templates.updateProjects`. The added parts start from `shiftAdded` (`lib/projectPlan.ts`); an old item never moves. The
  last event is `project.template_applied` in place of `project.template_synced` (both are feed verbs).
- The team's own edits stay (`src/api/templateSync.ts`). `templateLink.base` keeps a copy of each part as the project got it
  (`baseOf`). A part counts as changed only when the template differs from that copy. When the project item also differs,
  the diff puts it in `edited`, and the update keeps the team's version unless the Admin picks `edited: 'use_template'`. A
  description is never replaced with an empty one. A link made before the copy existed shows every difference as `edited`,
  and its first update writes the copy (`nextBase`). A kind that the Admin left out keeps its old copy.
- A closed task keeps its dates and its lead in `syncApply`. A dropped part comes back only with `bringBack`.

## Health, Dashboard and filters
- A past-due task makes a project At risk only from `AT_RISK_DAYS_PAST_DUE` days (`health.ts`). `isOverdue` still counts from
  day 1 ("Past-due to-dos", the Past due column, the `tasks.list` filter `overdue`). Keep both thresholds.
- Each Dashboard number has a list that holds the same records: `tasks.list` and `deadlines.list` take `leaderId`, `clientId`,
  `teamId` and `subCompanyId` (`peopleFilter`, `pause.ts`, loader code in `overview.ts`). The gap `projectsStageNoEnd` counts
  projects, never stages: it equals the `stage_no_end` list. A filter by sub-company leaves the office tasks out.
- `dashboard.get` returns `gaps` and `money` only for `gaps.view` and `payment.view`. Anyone else, and the agent of anyone
  else, gets null. `charts.healthMix` and `charts.throughput` stay for agents. The field `workload.unassigned` is optional, so
  an older answer parses; a task with no due date sits in no cell. Tests: `dashboardPeople.test.ts`.
- `reports.office` takes `subCompanyId` for rows, totals, people, money and the Tracker count. The stage moves count by
  project (`REPORT_KEYS.stageMovesOf`) only with the filter.
- `subCompanies.delete` takes `moveToId`: it moves the projects first, then deletes, in one story. An agent never undoes a
  sub-company event (`assertMayUndo`).
- `review.ts` gives the day a task last went to review, from its events.
- `reportRange` (`reportPeriod.ts`) gives the days of a range to the handler and the loader alike. The input refuses each
  wrong mix of `period`, `start`, `from` and `to` by its field.

## Tasks
- **Office task** (`projectId` and `stageId` null). It has no stage, no prerequisites, no Tracker entry and no stage move.
  `FileRec.projectId` is null for its files. The view rule is `can(actor, 'task.view', taskResource(state, task, viewerId))`
  or `mayViewTask`: a project task shows to everyone; an office task shows to its maker (`principalOf(createdBy)`), its lead,
  its helpers and the Admin. The maker holds the leader's rights there.
- A hidden office record answers exactly as an unknown one: `not_found` Task, Comment, File or Story, and `file_missing` in
  `attach.ts`. Never a `forbidden` that tells that it exists. The doors: `requireTask`, `mayViewFile`, `seesEvent`
  (`handlers/history.ts`), `notify`. Every event, comment and file of an office task carries `officeTaskId` (`events.ts`), so a
  loader filters on it. An undo event takes the `officeTaskId` of the event it undoes. A comment of a deleted office task
  reads `lastTaskCopy`.
- `task.officeAll` gives a person the place of the Admin on every office task: the view rule, the loaders
  (`officeTaskConds`), the private signals (`Diff.privatePeople`), the push (`PushPerson.officeAll`) and the rights of the
  maker. `notify`, `adminCopies` and the notice rules attach the rights of the person first (`ensureRights`).
- Office tasks count in the lists of a person, `overdueTasks`, the workload, `inReview` and the gaps of `dashboard.get` only
  with no people filter. They never count in a project number.
- **Review.** It applies only when the maker is not the lead. `reviewersOfTask` (`notify.ts`) gives the maker, or the Admins
  when the maker left. For a project, `reviewersOf` gives the active leader only while the leader holds `task.review.lead`
  (`canReview`); else the active Admins review. The Dashboard `inReview`, the `review_for_me` filter and the morning summary
  (`SUMMARY_COUNTS_SQL`, the leaders who review as `$3`) follow the same rule.
- **Makers.** The person who adds a project task (`principalOf(createdBy)`, so the task of an agent belongs to its person)
  holds the leader's rights on it while on the team. `taskResource` names `makerId` for a project task too. The gates are in
  `taskGates.ts` and `meetingGates.ts`; `tasks.update` asks one gate for each field (read the code). A person who may change
  any task of the project (`task.any`) passes every kind. Only the leader and the Admin name a person outside the team
  (`ensureOnTeam` asks with the project role alone).
- The rights that pass the project role alone stay with the leader: the files and comments of others, Tracker deletes,
  `taskTemplates.save`, and the undo of an agent change (`ai.undoOthers`).
- A write that a person makes on themselves (`tasks.take`, `tasks.help`) needs its own rule in `assertMayUndo`
  (`isOwnTake`, `isOwnHelp`, `history.ts`). Without it, Undo asks for the right of the general change, and the toast fails.
  Nobody joins an office task (`office_help`).
- An Undo of a change of a project task reads the rights on that task, or on the last copy of a deleted one
  (`projectTaskOf`, `history.ts`).
- **Order.** `Task.rank` is the place of a task inside a date group. `tasks.arrange` writes one `task.arranged` event for a
  drag (`arrangeRanks`, `lib/arrange.ts`). An order never changes a date, a status or a lead. The meeting summary and the
  project feed leave `task.arranged` out.
- **Quiet lines of a task thread** (`lineKindOf`, `lib/commentLine.ts`). A comment is a message or a quiet line (`due_date`,
  `start_date`, `shifted`, `reopened`). A line is never unread and never waits for a reply: `taskUnread` and `waitingThread`
  read the messages only, and the loader does the same (`MESSAGES_ONLY`, `server/data/loaders/chat.ts`). `tasks.newVersion`
  writes the `reopened` line, so `comments` is in its `WRITE_KINDS` line.
- **Unread number on a to-do row** (`TaskRow.unreadCount`, fbk_071, owner 2026-10-27). The chat icon of a row shows a number only for
  the comments that the person has not read, and none when all are read. Only `tasks.list` gives it (`tasks.get` leaves it out: the
  panel has no icon); the field is optional and `commentCount` stays. The rule is one (`src/api/taskUnread.ts`): `newCommentsOf`,
  `inTaskThread` (the lead, the leader of the project, the maker of an office task, or a person who commented) and `threadUnread`
  (a thread marked unread counts at least 1). The Inbox (`taskThreads`, `taskUnread` in `chats.ts`) and the row both call it, so the two
  numbers never differ. A person who is no part of the thread gets 0. One difference: the Inbox keeps only the newest
  `TASK_THREAD_LIMIT` threads, and the row has no cap. The list builds one lookup of the comments for the call (`ViewIndex.taskCommentsOf`),
  never a scan for each row (`viewCost.test.ts`). The loader (`taskRowsUnread`, `server/data/loaders/chat.ts`) reads the marks and the
  own comments of all rows in one round and counts in a second round, and it puts a count only for a thread that the person is part of: a
  loaded read with no count for a to-do reads as 0. `tasks.list` reads `chatReads` in `readMap.ts`, so a read mark reloads the lists of
  to-dos. Tests: `taskRowUnread.test.ts` (rule and leaks), `server/data/loaders/taskRowUnread.test.ts` (parity and statements),
  `ChatIconUnread.test.tsx` (the icon).
- **Remove a person** (`users.remove`). `User.removed` is true. The record stays, so the History keeps the name (`cardOf`),
  and the email stays reserved (`assertEmailFree`). `users.list` and `detailOf` leave removed users out; `users.update`
  and `users.reactivate` refuse them (reason `removed`); `users.get` still gives the record. The agents of a removed person
  go with them. A second call is harmless. The call sweep (`everyCall.ts`) runs it after `users.deactivate`, because it is
  a remover. No Undo.

## Chats
- A chat that the person may not open answers `not_found` ("Conversation <id> does not exist."), whatever its kind, the same
  as for an id that was never made, the Admin included for a direct chat. `requireConversation` serves `chats.messages`,
  `chats.send`, `chats.markRead`, `chats.archive` and the group writes.
- `requireMessage(ctx, id, { author, allowDeleted })` is the one door of edit, delete and reaction. An unknown message, a
  message of a chat the person may not open, and (without `allowDeleted`) a deleted message answer `not_found` Message. A
  person who can open the chat but is not the author gets `forbidden`, reason `not_author`.
- `chats.editMessage` writes no History event; a name that is new gets a mention notice, a name that goes loses its notices.
  `chats.deleteMessage` with `deleted: false` (the Undo of the toast) writes the notices again, already read, so a restore
  sends no push and no mail. `reactions.toggle` writes no event and no notice. In a direct chat or a group the signal of
  these calls goes to the members only.
- `ChatRead.markedUnread` is optional, so there is no `STATE_VERSION` step. `writeReadMark` drops it (`chats.markRead`,
  `chats.send`, an archive). `chats.markRead` and `chats.archive` also mark the unread mention and reply notices of that chat
  read (`readMentionNotices`), so their `WRITE_KINDS` lines hold `notifications`. `chats.markUnread` has `WRITE_KINDS`
  `['chatReads']`. `chats.waiting` stays in the contract and on the MCP allow list; no screen reads it.
- `Conversation.log` (the quiet lines of a group) keeps the newest `GROUP_LOG_MAX`. A line is no message: no unread count, no
  preview, no push. `actingMaker` is the maker while active, else the first active person (`ChatRow.makerId`).
- A direct chat with no live message shows in `chats.list` only for the person who has a read mark on it. `chats.openDirect`
  writes that mark when the actor is a human; an agent writes none.
- **Files of a chat.** `files.upload` and `files.uploadStart` take `conversationId`. `mayViewFile` is `canSeeConversation`
  of the chat, never the Admin who is not a member. `chatForUpload` (`chatState.ts`) is the upload rule for the browser and
  the server alike. An agent follows exactly the rights of its person (`chatForUpload`, `mayOpenFile`). `assertFilesForDirect`
  takes a chat file only for its own chat; every other carrier refuses it with reason `file_chat`. `files.delete` and
  `files.markDelivered` refuse it, and `search.query` and `files.list` never show one. Leak tests: `chatFiles.test.ts`,
  `server/calls/chatFiles.test.ts`.
- A message view (`messageViewOf`) drops the file row of a file that the reader may not view (`mayViewFile`). The loader
  brings the office task of each file (`attachedFiles`), so the scoped load gives the same rows.
- `search.query` has a `messages` group (`messageHits`, `messageSearch.ts`): the chats the person may open
  (`canSeeConversation`) and the comments of the tasks the person may read. An agent gets the hits of its person. The loader
  reads the newest rows of each kind, so the cut of the handler gives the same rows. Leak tests:
  `messageSearchLeaks.test.ts`.
- @everyone (`mentionsEveryone`, `lib/text.ts`; `handlers/everyone.ts`). A project chat names `chatMemberIds` (an Admin or a
  `chat.project.all` holder outside the team is not named). A direct chat names nobody. Never the sender, an agent or a person
  who is off, and only a writer who holds `chat.mentionEveryone`. A person named by name or reply gets that notice, not a
  second one. An @everyone notice makes no Admin copy (`makesCopies`) and no email (`NEW_NOTICES_SQL`, `liteNoticeRows`).
  Tests: `everyone.test.ts`, `server/push/everyoneLeaks.test.ts`.

## Meetings
- `create` is the first key of `meetingCalls` on purpose: the call sweep (`server/core/everyCall.ts`) runs in that order and
  the others need a meeting. `State.meetings` is optional (`meetingsOf`).
- A hidden meeting (no project; the people who see it are its organizer and its attendees) answers `not_found` Meeting
  (`requireMeeting`) on get, update and cancel, and shows in no list, `events.list` or `search.query`. Every event of it
  carries `officeMeetingId`, and `seesEvent` shows it to its people only. The Admin who is not invited sees nothing.
  `events.undo` and `events.undoStory` answer such an event as an unknown one. The notice reads as gone (`hiddenMeeting`,
  `noticeMeetingHidden`), and `notify` skips a person who does not see the meeting. The organizer of an agent is its
  person (`organizerId` is always a person). Leak tests: `meetingLeaks.test.ts`, `server/mcp/meetingTools.test.ts`,
  `server/core/meetingsSignal.test.ts`, `server/it/meetings.it.test.ts`.
- `rev` only grows. An Undo of a meeting change raises `rev` once more (`undoOne`), so a calendar sees the change.
- **Settle** (`meetings.settle`, `settleMeeting`, `dueToSettle`). After `endsAt` Madar marks the meeting over (event
  `meeting.settled`) and, when `hasTrackerLine` (`lib/meetings.ts`), makes a Tracker line with `auto: 'meeting'`. The mark has
  no Undo: `meeting.settled` is in `NOT_UNDOABLE`, reason `settle_final`, because the next job run would settle again. The line
  author (`createdBy`) is always the organizer; the events name the caller. `mayDeleteTracker` (`views.ts`) lets only the
  leader or the Admin delete an auto line. `meetings.settle` stays on the MCP deny list. The job
  (`server/jobs/steps/meetings.ts`) and the prototype minute timer call it. Test: `meetingSettle.test.ts`.
- **Minutes** (`meetings.saveMinutes`). `minutesRefusal(state, meeting, viewer, at)` checks the phase and the right in this
  order: `not_found`, `meeting_cancelled`, `minutes_not_yet`, `forbidden`, `minutes_line_gone`. A project meeting that is not a
  team meeting keeps the minutes on its Tracker line (verb `tracker.minutes_saved`); other meetings keep them on the meeting
  (verb `meeting.minutes_saved`). A save settles the meeting in the same call, with a story of its own
  (`cor_settle_<meeting>`), so the Undo toast takes back the minutes only and never meets the mark that has no Undo.
  `since` is the `updatedAt` that the screen opened: another value gives `conflict`, reason `minutes_changed`.
  `tracker.log` and `tracker.update` never take `minutes` or `meetingId`.
- **Files of a meeting with no project.** `files.upload` takes `meetingId`. `mayViewFile` is `mayViewMeeting`. Only a meeting
  with no project takes a file; a project meeting uses the files of its project, and `meetingId` there fails with
  `file_meeting`. `assertFilesForMeeting` (`attach.ts`) takes only the file of the meeting itself. Every other carrier refuses
  it with `file_meeting`. Leak tests: `meetingFiles.test.ts`, `server/calls/meetingFiles.test.ts`.
- **Series.** `meetings.create` with `repeat` makes the first `SERIES_AHEAD` meetings at once, all in one story. `meeting.added`,
  `meeting.series_updated`, `meeting.series_cancelled` and `meeting.extended` are not feed verbs. `scope: 'later'` of update
  and cancel changes the meeting and each scheduled later meeting of the series; a new day is refused
  (`series_day_one_only`). A cancel for "later" is the choice of the person to stop the series: it sets `repeat.until` of
  EVERY meeting of the series that the person sees, and a cancel of one meeting changes no rule. `meetings.extend` keeps a
  series full (the 15-minute job and the prototype timer call it; MCP deny list). It adds by the rule only, so a cancelled last
  meeting does not end a series, and a completed or archived project gets none. `seriesToExtend` is the rule of the job for
  the prototype timer.
- **Delete.** Only a cancelled meeting (`meeting_not_cancelled`). `meeting.deleted` holds the whole record in `before`
  (`recordDelete`), so the Undo of the toast brings it back. A delete changes no repeat rule. `meetings.delete` is in
  `GCAL_CALLS` (`server/google/sync.ts`). `seesEvent` reads the last copy of a deleted meeting (`lastMeetingCopy`).
- `projects.delete` deletes the meetings of the project and their notices.
- The dedupe key of `meeting_soon` holds the id and `startsAt`, so a moved meeting reminds again. Both meeting triggers are in
  `IN_APP_ONLY_TRIGGERS` and `ACTION_TRIGGERS`.
- The prototype day shift moves `startsAt` and `endsAt` (`PLANNED_FIELDS`, `src/data/shift.ts`) and never pulls them back
  before now.

## Feedback (requests and bugs)
- `feedback_sent` goes to each active holder of `feedback.manage` (`activeAdmins`, `notify.ts`; it attaches the rights with
  `withRights`, so it needs `state.settings`). `feedback.list`, `feedback.screenshot`, `feedback.setStatus`, the History of a
  report and `feedbackNoticeHidden` ask the same right.
- A report notice carries `feedback: { kind, excerpt }` (`NoticeFeedback`, `excerptOf` in `lib/text.ts`), so its line needs no
  report row. A report notice also reads as gone when its report row is gone, so the Inbox loader loads the report row of each
  notice (`server/data/loaders/inbox.ts`). A former Admin sees an old `feedback_sent` notice as gone. A `feedback_done` notice
  always shows to its owner.
- Five statuses (`FeedbackStatus`, `entities.ts`). `feedback.setStatus` takes `reason`: required with `rejected`, refused with
  any other status. A move into `done` or `rejected` from another status sends one `feedback_done` notice to
  `principalOf(createdBy)`; `rejected` on a rejected report only changes the reason. `setStatus` writes `rejectReason` null
  first on an old report, so a JSON event holds both sides and an Undo restores null. The Undo of a story keeps one notice for
  each move that stands (`movesInto`, `history.ts`). A rollback to a release before the five statuses cannot read a report with
  a new status. Tests: `feedbackStatus.test.ts`.

## Payments
- `payment_due` is in `TRIGGERS`, `IN_APP_ONLY_TRIGGERS` and `ACTION_TRIGGERS`, and not in `COPY_TRIGGERS`.
  `runScheduledTriggers` sends it on the due day only, with the dedupe key `payment_due:<paymentId>:<dueDate>`. The people are
  `paymentDuePeople` (`getsPaymentDue`). The notice holds the snapshot `Notification.payment { id, name }`. A viewer without
  `payment.view` reads it as gone (`hiddenPayment`). `loadJobs` (`server/data/loaders/jobs.ts`) loads the open payments of the
  day of the run. Test: `paymentDue.test.ts`.
- The state may have no `payments` list: read `state.payments ?? {}`.
- The Daftra link: `server/daftra/CLAUDE.md`. `markReceived` and `update` keep their rules for a linked payment; the screens hide
  the button. `payment.received_daftra` has no Undo (`daftra_final`).

## Push devices
- `push.register`, `push.remove` and `push.mine` are for a person, for the person: an agent gets `forbidden`, and all three stay
  on the MCP deny list. They write no event and no History row, and the save sends no change signal. `WRITE_KINDS` is `[]` for
  both writes, and `push.mine` is `rule('none', [])`. `State.pushDevices` is optional (`pushDevicesOf`). One row for each
  endpoint; a register of an endpoint that another person holds moves it to the current person.
- The endpoint must be the https address of a known push service (`isPushEndpoint`): the server posts to it, so a free address
  would let a person aim the server at any host. See `server/push/CLAUDE.md`.

## Quiet hours
- One pure rule: `isQuiet`, `workHoursOf`, `workStartOn`, `coversLock` in `src/lib/quietHours.ts` (the defaults are
  `DEFAULT_OFFICE_WORK_HOURS`). `me.updatePreferences` takes `workHours` for the person only (an agent gets `forbidden`), and
  a range with quiet on must hold the lock (`work_hours_lock`). `settings.update` takes the default range
  (`work_hours_default_lock`). A stored range that no longer holds a moved lock is not changed: `isQuiet` adds the lock at read
  time. An agent may not undo a change of the work hours (`changesEmail` in `history.ts`). Both calls stay on the MCP deny list.

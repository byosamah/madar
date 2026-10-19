# API contract and the fake API

Every call of Madar is defined here once. The prototype runs these handlers in the browser. The server runs the same
handlers inside `runCall` (see `server/CLAUDE.md`). An AI agent reaches the allowed ones as MCP tools.

## Files
- `registry.ts`: `defineCall({ input, output, run, prepare?, readOnly?, prototypeOnly? })`.
- `handlers/*.ts`: one file for each area. `handlers/serverFakes.ts`: the prototype fakes of the server-only calls.
- `calls.ts`: joins the handlers and the fakes. `sharedCalls.ts`: the calls the server runs, without `SERVER_EXCLUDED`.
- `contract/entities.ts` (records, ids like `prj_`, `tsk_`), `contract/views.ts` (read shapes), `contract/server.ts`
  (the server-only calls, `UPLOAD_LIFE_MS`, `FREE_PLAN_LIMITS`), `contract/limits.ts` (the plain limits and marks with no zod:
  `MAX_FILE_BYTES`, `MAX_SHOT_BYTES`, `MAX_ATTACHMENTS`, `MAX_HELPERS`, `MAX_PREREQUISITES`, `REACTIONS`, `PICTURE_DATA`,
  `PASSWORD_SET_MARK`, `DEFAULT_STALE_DAYS`). entities.ts and server.ts export these again under the same names.
- `rowKeys.ts`: `memberKey` and `chatReadKey` (store.ts exports them again). `permissions.ts` and `store.ts` take no value
  from the schema files: `can()` is in the first load of the real build (`limits.test.ts` checks it).
- `contract/push.ts`: the plain limits and the endpoint rule of browser push (`isPushEndpoint`, `PUSH_HOSTS`), with no zod.
- `permissions.ts`: `can(actor, action, resource)`. `execute.ts`: runs a call. `errors.ts`: `ApiError` and its codes.
- `store.ts`, `persist.ts`: the prototype store in IndexedDB. `remote/`: the client of the real build (batcher, wire, keys,
  `follow.ts`: the reads that go after an own write, in a file of its own so the prototype bundle never takes RemoteApi). With
  no session token it sends nothing: the call fails with `unauthenticated`, reason `no_session` (AuthGate ignores that reason).

## Rules
- `User.avatarUrl` takes picture data (WebP, JPEG or PNG, up to 24,000 characters) or an https address (`UserAvatarInput`).
  `userCard()` leaves picture data out, so lists stay small. `User.nameAr` is the Arabic name; an empty value means none.
- `src/api` never imports `server/` or `src/app/`.
- The output is checked inside the change, so a wrong shape rolls it back (`execute.ts`).
- One permission function: `can()`. No screen and no handler checks a right another way. An agent acts with its owner's
  rights (`resolveAuthority`).
- A contract change is additive, or it keeps both forms.
- A change to the rule of a stored field keeps the old rule as one side of a union (`RECORD_CODE_PATTERN`), so stored
  records still load. Free text that names a record refuses hidden characters (`visibleText`, `lib/projectCode.ts`).
- Handlers stay synchronous and pure. A handler never does network work. Outside work is an effect.
- The test count only grows, except when the code a test checks is deleted.
- A screen file of the first load (the shell, Home, the sign-in gate and what they import) takes a plain limit from
  `contract/limits.ts`, never from entities.ts or server.ts: those load the zod schemas. The bundle check fails a first load
  that holds `$ZodObject`.
- A write handler whose signals can name a new kind needs that kind in its `WRITE_KINDS` line (`src/app/writeKinds.ts`).
  `server/core/writeKinds.test.ts` runs every write of `everyCall` and of the write sweep in memory, and fails on a kind
  that the line does not hold. A missing kind leaves no old list: the signals still reload that read, one round trip later.
- The Batcher (`remote/batcher.ts`) places a read with `after` (a read of a follow step) in the request of that write, right
  after it, while the request has fewer than 12 calls and no second overview call. Else the read goes as any other call, and
  RemoteApi does not name it as fresh. A read that goes again after a lost answer goes alone and drops `after`.
- `Store.runIf(fn)` saves and tells the listeners only when fn returns true; on an error it puts the state back, as `run()`
  does. The prototype minute timer (`startScheduler`, `src/app/bootstrap.ts`) uses it.

## The project code (owner, 2026-10-05)
- `lib/projectCode.ts` reads and builds `YYMMSSINI-CLS-Type` (key `YYMMSSINI`, contract `YYMMSS`). Old codes (`KH-26-014`)
  stay valid. Two projects of one contract share one code, so the projects table has no unique rule on the code.
- `projects.create` takes `codeParts`, `code` or `sameContractAs` (at most one); with none, the old automatic code. A typed
  code whose YYMMSS belongs to another contract fails with `code_taken`. `codeParts` initials go onto a client with none.
- Only the Admin corrects a code (`project.editCode`, `projects.update` `patch.code`, verb `project.code_changed`).
- A person may keep a code of their own (feedback fbk_003, 2026-10-12). A new or changed code is visible text of 1 to 60
  characters (`FREE_CODE_PATTERN`): only visible characters and the plain space, nothing outside the basic plane, so a code
  always shows as it is saved. A new building type passes `TYPE_PATTERN`. The record takes that or any code of the office
  pattern (`RECORD_CODE_PATTERN`), so a code saved before still loads. A typed code (create, or the Admin's correction) outside the office pattern fails with
  `code_format`, and one with the YYMMSS of another contract with `code_taken`, unless the call says `codeAnyway: true`.
  `codeWarning` (`lib/projectCode.ts`) is the one rule for the screens and the handler. A kept code is its own key
  (`projectKey`), has no contract, and gets no `#` link in posts. A save that keeps the stored code checks nothing.

## The Tracker type Government (owner, 2026-10-12)
- The screens call the type `balady` Government: any government body, not only the Balady portal. The stored value stays
  `balady`, so the contract, the data and the agents keep it. `TOOL_DOCS` of `tracker.log` and `tracker.list` say what it means.

## Project templates (owner, 2026-10-05, item 6a)
- `ProjectTemplate` (`ptp_`): roles (a name and a default person), stages, and tasks with a start day and a length in working
  days (Sunday to Thursday, day 0 is the project start) and `flexible`. Ids inside a template (`r1`, `s1`, `t1`) are unique in it.
- `projectTemplates.list`, `.save` (no `id` makes one, an `id` changes one) and `.delete`. Saving needs `project.create`; a change
  or a delete needs the person who saved it or the template right (`templates.manageAll`). MCP: deny list.
- `projects.create` takes `template: { templateId, startDate, endDate?, roles, fixedTaskIds }`, never with `stages`, `startDate`
  or `targetEndDate`. The plan comes from `lib/projectPlan.ts`, the same function as the screen. Locked tasks that do not fit
  refuse with reason `template_too_short` (`names` holds the days they need). A role person joins the team; a role with no
  person gives tasks with no lead. The tasks send no notice: their people had the one notice of their place on the team.
- Template tasks and stages can wait for other parts of their own template (`prerequisiteIds`, fbk_008). `projectTemplates.save`
  refuses a wait on a missing part (`prerequisite_not_in_template`), a repeated wait and a loop (`dependency_cycle`, `hasCycle`
  in `flow.ts`). A new project links the waits to its new ids. A task with waits is `dynamic` there, with its planned working days.
- Stage templates merged into project templates. Their calls stay in the contract, their screens are gone. Version 9 and the
  migration `20261005000100_project_templates.sql` made one project template from each stage template, once.
- Link an older project (fbk_008 item 4): `projectTemplates.matchPlan` reads the matches by name (`matchByNames`,
  `src/lib/templateMatch.ts`). `projectTemplates.link` writes one story: the `templateLink`, each matched part id, and `droppedPartIds`
  for each part with no pick. A second link is refused (`already_linked`). Both calls are on the MCP deny list.
- Apply a template to an ongoing project (owner, 2026-10-19, fbk_020): `matchPlan`, `link` and the adding need `project.edit` on the
  target project (the leader and the Admin), and the project must be open (`active` or `on_hold`; else reason `project_closed`),
  `assertMayApply`. A project holds one `templateLink`. `link` with `replace: true` takes another template for a project that follows
  one: it first removes the part ids of the old template from the stages and tasks (an event for each, so one Undo of the story brings
  them back), then writes the new link. The same template is refused (`already_linked`): that is an update. The adding is
  `syncApply` with `apply: true` and exactly the picks of `isApplyChoices` (only `bringBack`): the project right is enough. Any other
  pick, or `apply` without them, needs `admin.manage` as before. In apply mode the added parts start from `shiftAdded`
  (`lib/projectPlan.ts`): when the earliest added part starts before today, all added parts move forward by the same working days so it
  starts today; an old item never moves. The lead of a new task is the role's person from `link.rolePeople` (the sheet sends the
  default person only when active) and gets the `task_assigned` notice. The closing event is `project.template_applied`
  (a feed verb; `after.addedParts` holds `{ stages, tasks }`) in place of `project.template_synced`. Template edits, `usage`,
  `syncPlan` and the update of many projects stay with the Admin. All five calls stay on the MCP deny list: an agent cannot apply.
- Update of linked projects (fbk_008 item 4, Admin only): `projectTemplates.usage` lists the open projects, linked or not.
  `projectTemplates.syncPlan` gives the diff (`syncDiff`, `src/api/templateSync.ts`) of each listed project linked to the template.
  `projectTemplates.syncApply` makes the picked changes of one project, in one story. A closed task keeps its dates and its lead.
  A dropped part comes back only with `bringBack`. The plan uses the template lengths from the project start. All three are on the MCP deny list.
- The team's own edits stay (ADM-01, `src/api/templateSync.ts`): `templateLink.base` keeps a copy of each template part as it was when
  the project was made, linked or last updated (`baseOf`; the dates are the dates the project got). A part counts as changed only when the
  template differs from that copy. When the project item also differs from it, the diff puts the item in `edited`, and the update keeps the
  team's version unless the Admin picks `edited: 'use_template'`. A description is never replaced with an empty one. A link made before
  the copy existed shows every difference as `edited`, and its first update writes the copy (`nextBase`). A kind that the Admin left out
  keeps its old copy, so the next update offers it again. The diff items carry the new title, the dates and the leads, so the review
  screen names each change. `projectTemplates.list` gives the Admin `followers` (open projects that follow the template).
- `project.template_synced` is a feed verb: the project feed says "updated this project from the template X" above the task changes.
- Template links (fbk_008 item 4): a project made from a template keeps `Project.templateLink`. Each stage and task keeps its `templatePartId`.
  `ProjectTemplate.partSeq` is the highest part number ever given, so a part id is never given twice. `tasks.delete` and `stages.replace`
  add the removed part id to `droppedPartIds`. `projectTemplates.link` fills it for each part with no pick.

## Health and the Dashboard (owner, 2026-10-06)
- `health.ts`: a past-due task puts its project At risk only from `AT_RISK_DAYS_PAST_DUE` (3) calendar days past due.
  `isOverdue` still counts it from day 1 ("Past-due tasks", the Past due column, `tasks.list` filter `overdue`).
- `dashboard.get` returns `gaps` only for `can(admin.manage)` and `money` only for `can(payment.manage)`; anyone else, and an
  agent of anyone else, gets null. Contract changes stay additive: `charts.healthMix` and `charts.throughput` stay for agents.
- Each Dashboard number has a list that holds the same records: `tasks.list` and `deadlines.list` take `leaderId`, `clientId`
  and `teamId` (`peopleFilter`, `pause.ts`); `tasks.list` `workOf` is the work of one person (open tasks that are not in
  review, plus the reviews of that person); filters `no_date` (tasks), `no_area` and `stage_no_end` (projects). So the gap
  `projectsStageNoEnd` counts projects, never stages: it equals the `stage_no_end` list.
- `review.ts`: the day a task last went to review, from its events (the review wait and `finishedOn`).
- `dashboard.get` `workload.unassigned { overdue, counts }` (fbk_024, owner 2026-10-19) is the No lead row of the People tab: the open
  tasks with `ownerId` null, past due and due in each of the 4 weeks from today, in the same columns as a person and with no review part.
  It counts the tasks of the active projects in the filters and the office tasks that the viewer sees (`activeTasks`). The field is
  optional, so an older answer parses. A cell opens `tasks.list` with `filter: 'no_lead'` and `dueTo` yesterday (past due) or `dueFrom`
  and `dueTo` of the week. A task with no due date sits in no cell: the row name opens every open task with no lead.

## Sub-company filter (fbk_007 review, 2026-10-19)
- `subCompanyId` joins `leaderId`, `clientId` and `teamId` in `peopleFilter` (`pause.ts`). `dashboard.get`, `tasks.list`, `deadlines.list`
  and `projects.list` take it, with the same loader code (`overview.ts`). A filter by sub-company leaves the office tasks out, as the others do.
- `reports.office` takes `subCompanyId`: rows, totals, people, money and the Tracker count that sub-company only, and `office.name` is its
  name. The stage moves count by project (`REPORT_KEYS.stageMovesOf`) only with the filter.
- `projects.list` filter `no_sub_company` lists the projects with none. `dashboard.get` `gaps.noSubCompany` counts them for the Admin, and the
  report gap line does too, both only when the office has a sub-company.
- `search.query` gives `subCompanies` (id, names, project count): one row opens the filtered Projects list. It lists no project one by one.
- `subCompanies.list` gives `projectCount`. `subCompanies.delete` takes `moveToId`: it moves the projects first, then deletes, in one story.
- An agent never undoes a sub-company event (`assertMayUndo`), as it never makes one.

## Office tasks (owner, 2026-10-06)
- A task with `projectId` and `stageId` null is an office task. `tasks.create` without `projectId` makes one. It has no stage,
  no prerequisites, no Tracker entry and no stage move. `FileRec.projectId` is null for its files (`taskId` names the task).
- One view rule: `can(actor, 'task.view', taskResource(state, task, viewerId))` (`permissions.ts`), or `mayViewTask`. A project
  task shows to everyone. An office task shows to its maker (`principalOf(createdBy)`), its lead, its helpers and the Admin.
  The maker holds the leader's rights there (lead, helpers, review need, review, delete); the lead changes and finishes it.
- `requireTask` answers `not_found` for an office task the person does not see, so every task write checks the view first.
  `mayViewFile` does the same for files, `seesEvent` (`handlers/history.ts`) for events, `notify` for notices.
- Every event of an office task, its comments and its files carries `officeTaskId` (`events.ts`), so a loader filters on it.
  An undo event takes the `officeTaskId` of the event it undoes; a comment of a deleted office task reads `lastTaskCopy`.
- A hidden office record answers exactly as a missing one: `not_found` Task, Comment, File or Story, and `file_missing` in
  the attach rules (`attach.ts`). Never a `forbidden` that tells that it exists.
- Chats and groups (UX audit 2026-10-19): `chats.archive` also marks the chat read up to now when it archives (the Inbox badge never
  counts a chat that is out of the list); moving back keeps the read mark. `chats.createGroup` takes an optional name; with none, the
  group takes the first names of its people in the language of the maker (`autoGroupName`). A person can always leave
  (`chats.leaveGroup`); a removal keeps at least two people. `actingMaker` is the maker while active, else the first active person;
  `ChatRow.makerId` and the remove rule use it, and the record keeps the first maker. A group with no other active person is closed
  (`ChatRow.personLeft`, `chats.send` refuses it, `chats.waiting` skips it). `Conversation.log` keeps the newest `GROUP_LOG_MAX` (100)
  quiet lines (added, removed, left, renamed); `chats.messages` returns them as `lines` for a group. They are no messages, so no
  unread count, preview or push reads them. `chats.updateGroup` sends the trigger `added_to_group` (in-app only) to each added person.
  `NotificationView.chatKind` and `target` (the group name while the viewer is a member) let a group notice name the group.
- `search.query` has a `messages` group (chat design 2026-10-19, item 16): `messageHits` (`messageSearch.ts`) gives the newest 5 live chat
  messages of the chats the person may open (`canSeeConversation`) whose folded text (`bodySearchText`) holds every word of the query
  (`searchWords`), when one word has 3 letters or more. Each hit has `chatId`, `kind`, `title`, `project`, `person`, `author`, `mine`,
  `line` (`hitLine`) and `at`. The loader reads the newest 5 matching rows of the visible chats, so the cut of the handler gives the
  same rows. An agent gets the hits of its person. Chat files stay out of search.
- A chat that the person may not open answers `not_found` ("Conversation <id> does not exist."), whatever its kind (chat design
  2026-10-19, item 17): `requireConversation` serves `chats.messages`, `chats.send`, `chats.markRead`, `chats.archive` and the group
  writes. The answer equals the one for an id that was never made, so an outsider learns nothing, the Admin included for a direct chat.
- `chats.messages` with `around` (chat design 2026-10-19, item 17) opens the page at one message: `messagePageAround` (`chatAround.ts`)
  gives the newest page when the message is in it, else 20 live messages before it and every newer one, up to 500 in all, and
  `ChatThread.newer` is true when more follow. `around` with `before` fails `invalid`. A message that is no live message of this
  chat (deleted, another chat, unknown) gives the newest page and no error. The loader reads the window next to the newest page.
- Files of a direct chat or a group (owner, 2026-10-19): `files.upload` and `files.uploadStart` take `conversationId` in place of a
  project or an office task. `FileRec.conversationId` (optional, so older files load) names the chat; `projectId`, `stageId` and `taskId`
  are null. `mayViewFile` is `canSeeConversation` of that chat: exactly the people who read its messages, never the Admin who is not a
  member. `chatForUpload` (`chatState.ts`) is the rule of who uploads, for the browser and the server alike. The upload writes no event
  (`uploadChatFile`). `mayOpenFile` keeps an agent from opening one (`files.get`, the `files.link` fake). `assertFilesForDirect` takes a
  chat file only for its own chat; every other carrier (project chat, comment, post, Tracker, `files.share`) refuses it with reason
  `file_chat`. `files.delete` and `files.markDelivered` refuse it too, and `mayDeleteFile` is false. `search.query` finds no chat file,
  and `files.list` never lists one. The leak tests: `handlers/chatFiles.test.ts`, `server/calls/chatFiles.test.ts`.
- `Attachment` (a file row of a comment, a message, a post or a Tracker row) carries `mimeType`, the type of the newest version
  (owner, 2026-10-19; optional, so older answers load; a deleted file has none), so a screen can show a picture as a preview. `attachmentsOf`
  sets it. It adds no right: the rows still pass `mayViewFile`.
- A message view (`messageViewOf`, `handlers/chats.ts`) drops the file row, and the file id in `message.fileIds`, of a file that
  the reader may not view (`mayViewFile`). A member of a group reads the old messages of other people, so this holds for a late
  member too. Every project file is open to every person, so its row stays. The chat rules keep an office file out of a message;
  the rule is a guard for data that gets in by another way. The loader `chats.messages` brings the office task of each file
  (`attachedFiles`), so the scoped load gives the same rows.
- Review: only when the maker is not the lead; `reviewersOfTask` (`notify.ts`) gives the maker, or the Admins when the maker left.
- Office tasks count in the lists of a person, `overdueTasks`, the workload, `inReview` and the gaps of `dashboard.get`, only
  with no people filter. They never count in a project number.
- Three functions hold the rule of a hidden notice: `hiddenTask` (`notifications.ts`) and `noticeTaskHidden`
  (`handlers/history.ts`) for an office task, and `feedbackNoticeHidden` (`notify.ts`) for a report. Change them together.

## Task makers (owner, 2026-10-07)
- The person who adds a project task (`principalOf(createdBy)`, so the task of an agent belongs to its person) holds the
  leader's rights on it while on the team: `task.updateAny` (lead, helpers, prerequisites), `task.updateOwn` (title, dates,
  stage, status, checklist) and `task.delete`. `taskResource` names `makerId` for a project task too.
- The review stays with the leader and the Admin: `task.review` (approve, send back) and the review need (`needsReview` in
  `tasks.update`, and `needsReview: false` in `tasks.create`). `TaskDetail.viewerCan.setNeedsReview` shows the switch.
- `task.createForAnyone` equals `task.createForSelf` on a project: a team member names any team mate as lead and helpers.
  Only the leader and the Admin name a person outside the team (`ensureOnTeam` asks with the project role alone), so the
  task panel offers a maker only the team.
- An Undo of a change of a project task reads the rights on that task, or on the last copy of a deleted one
  (`projectTaskOf`, `handlers/history.ts`). An Undo of a review-need change asks `task.review`.
- The rights that pass the project role alone stay with the leader: the files and comments of others, Tracker deletes,
  `taskTemplates.save` (and `saveTemplate`), `event.undoAgent`.

## The shared order of tasks (owner, 2026-10-07)
- `Task.rank` (a number, null or missing) is the place of a task inside a date group of the Tasks screen (`groupMyTasks`) and
  Home (`lib/home.ts`). A lower number sits higher. A task with no number sits under the placed ones, in the old order. The
  number belongs to the task, so everyone who sees two tasks in one group sees them in the same order.
- `tasks.arrange { ids, moved? }` takes the new order of one group, top first. Each task needs `task.updateOwn` (its lead, its
  maker, the leader, the Admin). `arrangeRanks` (`lib/arrange.ts`) keeps the numbers that already go up and gives new ones only
  to the others, so one drag writes one `task.arranged` event. The first order of a group writes one event for each task.
- An order never changes a date, a status or a lead. The meeting summary and the project feed leave `task.arranged` out.
- On the Tasks screen the tasks the person may move come first, then the tasks they only help with (no grip, and no drop
  between them). Home shows only the tasks the person may finish, in the same order.

## Remove a person (owner, 2026-10-12)
- `users.remove { id }` takes a turned-off person or agent out of every list for good: `User.removed` is true. The record stays, so the
  History, tasks, comments and messages keep the name (`cardOf` still finds it), and the email stays reserved (`assertEmailFree`).
  `users.list` (also with `includeInactive`) leaves removed users out, `detailOf` leaves them out of a project team, and `users.update` and
  `users.reactivate` refuse them (reason `removed`). `users.get` still gives the record.
- The rules: `people.manage`, `assertMayTouch` (Management never removes an Admin or the agent of an Admin), never yourself, and only a
  person who is off (reason `still_active`). The agents of a removed person go with them, turned off first. A second call is harmless
  and writes no second event. Event verb `user.removed`. No screen brings a removed person back, so the sheet asks first and has no Undo.
- MCP: deny list (people work is in the screens). The sweep (`everyCall.ts`) runs it after `users.deactivate`, because it is a remover.

## Facts of a row for the list screens (feedback, 2026-10-11)
- `ProjectSummary.stageEnd { date, daysLeft }` is the end date of the current stage (`stageTagOf`, the same stage that the Late tag
  reads) of an active project. It is null with no end date or with a project that is not active. A row shows it as "Stage ends"
  while `nextDeadline` (a named deadline) is null. The sort `deadline` of `projects.list` uses `nextDeadline`, then `stageEnd`.
  The field is optional, so older answers still parse. MCP: `TOOL_DOCS` of `projects.get` and `projects.list` name it.
- `TaskRow.canEditPeople` is `can('task.updateAny')`, the rule of `viewerCan.editAll` in the task panel (the leader, the maker of
  the task, the Admin). The avatar of a task row opens its small pop-up for the lead and the helpers only when it is true.

## Requests and bugs notices (owner, 2026-10-07)
- `feedback_sent`: a new report tells each active Admin (`activeAdmins`, `notify.ts`). `feedback_done`: a report that goes
  from open to done tells `principalOf(createdBy)`. The skips of `notify` apply: the actor and the person of an agent actor,
  agents, people who left, and a switch that is off.
- `Preferences.notifications` is a `partialRecord`: a missing trigger means on. Read a switch only with `inAppOn`
  (`notify.ts`). So a person stored before a new trigger still loads, with no backfill.
- zod 4 `z.record(enumKey, …)` needs every key, so a new enum value refuses every stored doc. A stored map uses `z.partialRecord`.
- `IN_APP_ONLY_TRIGGERS` (both) send no email: `emailOn` is false, `notifications.updateSettings` refuses their email switch
  with reason `in_app_only`, and Settings shows no email switch for them. `EMAIL_TRIGGERS` holds the other triggers.
- `ADMIN_ONLY_TRIGGERS` (`feedback_sent`): `visibleTriggers` shows its switch only with `admin.manage`. The value stays.
- A report notice carries `feedback: { kind, excerpt }` (`NoticeFeedback`), so its line needs no report row. `excerptOf`
  (`lib/text.ts`) makes the excerpt: one space for each run of white space, 80 code points or fewer, cut at a space, then "…".
- Only the move from open to done sends a notice. Done on a done report and "Open again" send nothing, and the done notice
  stays. Done after "Open again" sends a second one. `feedback.list` takes `status` (`new` or `done`).
- An Undo keeps a report notice only while a change of the same report stands in its story (`dropNotices`,
  `handlers/history.ts`). So the Undo of one done change takes back only the notice of that report.
- A done notice stays only once for each standing change of its story that moved the report from `new` to `done`; the newest
  extra ones go. So done, open, done and then the Undo of the last done leaves one done notice.
- A former Admin sees an old `feedback_sent` notice as gone: no words, no sender (`actorId` null), no report id (`targetId`
  `'hidden'`), no story (`correlationId` left out), no link and no place on the bell. An Undo never deletes it, and a new
  promotion shows it again while its report still exists. A `feedback_done` notice always shows to its owner.
- A report notice also reads as gone, in the same form, when its report row is gone: the Undo of a send keeps the hidden
  notice of a former or inactive Admin, and it must not show again later. So the Inbox loader loads the report row of each
  notice (`server/data/loaders/inbox.ts`). `readMap.ts` needs no `feedback` kind: that answer never changes on a report change.
- Both triggers count on the bell (`ACTION_TRIGGERS`). A done notice has the link `''`: its row only marks it read.

## Browser push devices (owner, 2026-10-08)
- `PushDevice` (`pdv_`): `userId`, `endpoint`, `label`, `createdAt`, `lastPushAt`. `State.pushDevices` is optional (`pushDevicesOf`), so
  there is no `STATE_VERSION` step. It is private to its person: nobody else reads it, the Admin included.
- `push.register {endpoint, label}`, `push.remove {endpoint}`, `push.mine {}` (the own devices: id, label, endpoint, createdAt). Only a
  person, for the person: an agent gets `forbidden`, and all three are on the MCP deny list. They write NO event and NO History
  row, and the save sends NO change signal for a device. `WRITE_KINDS` is `[]` for both writes and `push.mine` is `rule('none', [])`,
  so the Settings switch reads the browser first and asks `push.mine` itself.
- One row for each endpoint. A register of an endpoint that another person holds MOVES it to the current person (a shared browser;
  `lastPushAt` starts again). A person keeps 10 devices at most; the oldest goes. `push.remove` of an endpoint that is not the
  own answers `removed: false`, as for a missing one.
- The endpoint must be the https address of a known push service (`isPushEndpoint`): the server posts to it, so a free address
  would let a person aim the server at any host. See `server/push/CLAUDE.md`.

## The project pin (owner, 2026-10-18, fbk_017)
- `Project.geo` is an optional `GeoPoint` (`lat` -90 to 90, `lng` -180 to 180). `ProjectSummary.geo` is that point or null (`summaryOf`).
- `projects.create` takes `geo` (default null). `projects.update` takes `patch.geo` (null removes the pin). Both refuse a value out of range.
- MCP: `TOOL_DOCS` of `projects.update`, `projects.get` and `projects.list` name `geo`. `samples.json` holds inputs only, so it did not change.
- **The Location is the address of the pin (owner, 2026-10-19).** `Project.location` stays a string. `placeRule` and `saveLinks` in
  `handlers/projects.ts` keep the pin and the text together in one patch, so one Undo takes both back:
  - A write that moves the pin and gives no `location` sets `location` to ''. A write that removes the pin (geo null) sets it to '', even
    when the write sends a text. A pin that does not move leaves the text. "Moves" is a check against the pin that the project shows
    (`pinOf`: the own pin, else the place of the location link).
  - A `location` alone, with no `geo`, fails with reason `location_needs_pin` while the project has a pin, unless it is the same text.
    A project with no pin (old data) still takes a text alone.
  - `projects.addLink` and `projects.updateLink` take an optional `location`: the address of the pin that the link sets. The server uses it
    only when the link moves the pin. Without it, the text is cleared. Both calls stay on the MCP deny list.
  - `search.query` does not read `location`.
  - MCP: `TOOL_DOCS` of `projects.update` (600 characters, at the limit) and `projects.get`, and the `Place:` line of `INSTRUCTIONS`.

## Office rights and roles (owner, 2026-10-18, fbk_014)
- The seven office rights are in `OfficeRight` (`contract/entities.ts`). The Admin holds all seven.
- `Settings.roles` holds the rights of Management, Accounting and Member, and the custom roles. `rightsOf` (`rights.ts`) reads them.
- A check of an office right reads the person with the rights attached. A handler gets them in `ctx.authority` (`execute.ts`). A loader
  (`Load.authority`) and a server call use `withRights(state, user)`.
- `can()` fails closed: a person other than the Admin, with no `officeRights` attached, holds no office right. A path that forgets
  `withRights` then denies, and never gives the default of a role. A test that calls `can()` for Management needs `withOfficeRights`.
  The Admin screens (`sections.ts`, `opensAdminPage`) read the rights the same way.
- Only the Admin changes a role: `systemRole` or `roleId`. The reason is `admin_only`. A save with the same value is no change.
- The undo of a role change follows the same rule (`handlers/history.ts`). An agent never takes back a role change, also the agent
  of an Admin: `assertMayUndo` refuses a role event (`settings`) and a `user` event for an agent. `rolesLeaks.test.ts` proves it for
  `events.undo` and `events.undoStory`. The MCP deny list holds `roles.*`, `users.create` and `users.update`.
- `admin.manage` reads only the Admin role, so it needs no office right.
- `session.get` returns the authority with its `officeRights`, so a screen reads the same rights.
- `roles.create`, `roles.update` and `roles.delete` (`handlers/roles.ts`) need `admin.manage`. Each change writes one settings event:
  `role.created`, `role.updated` or `role.deleted`. Its target is the role id, or `management`, `accounting` or `member` for a built-in
  role. `handlers/history.ts` (`undoOne`) takes these back with `undoRoleChange`, not with `undoEvent`. MCP: deny list.
- `roles.delete` takes `moveTo` (ADM-14): a built-in role (not Admin) or another custom role. The people of the deleted role move to it
  (`user.updated` events) before the role goes, all in one story, so one Undo brings the role and the people back. Without `moveTo`,
  a role that people hold is still refused (`role_in_use`).

## The office report (owner, 2026-10-18, fbk_016)
- `reports.office { period, start? }` (`handlers/reports.ts`): a week (Sunday to Saturday), a month, a quarter or a year. `periodRange`
  (`reportPeriod.ts`) picks the period that holds `start`; with no start it gives the last full period before today.
- The right is `report.office` (assertCan). Money needs `payment.manage` (null otherwise); gaps need `admin.manage` (null otherwise).
- The stage moves, completions and pauses come from `state.counts` (`REPORT_KEYS`, the loader counts them in SQL). The reviews come from
  the review events that the loader reads once (`state.events`). The handler counts them for each person by `actingForId`. Without
  `state.counts` it counts `state.events` for the other three too (the prototype). Both give the same numbers (`loaders.test.ts`).
- Office tasks stay out of the report. The MCP tool is `reports.office`, on the right list `MCP_BY_RIGHT` (`server/mcp/tools.ts`): an agent
  gets it only when its person holds `report.office`.
- The answer carries `design`: the design guide `REPORT_DESIGN` (`reportDesign.ts`). Its colors and sizes copy `tokens.css`, and
  `reportDesign.test.ts` checks them. The guide is the same for every person who may ask.

## The restart reminder of a pause (owner, 2026-10-19, fbk_025)
- The restart date of a pause (`pause.resumeOn`) is a reminder. Madar never restarts a project by itself: a person resumes it.
- `runScheduledTriggers` (`notify.ts`) sends `resume_due` on the planned day, or in the first run after it. It goes to the leader
  (`reviewersOf`: the Admins when the leader is off) and to the person who paused (`principalOf(pause.by)`), once for each person and each
  date, because the dedupe key holds the day. The notice keeps the planned day in `dueDate`. `notifications.list` gives it, and for a notice
  made before it holds the day it made. The screen says "is today" on that day and "was <day>" after it (`inbox.trigger.resume_due`
  and `resume_due_past`).
- `projects.setRestart { id, resumeOn }` changes only the date of a paused project. The date must be after today. It needs `project.archive`,
  as Pause and Resume do. The reason, the kind, the person and the day of the pause stay. It writes the event verb `project.restart_moved`
  and asks no reason, because the date of a reminder is no plan date. A new date gives a new notice. MCP: deny list.

## Quiet lines of a task thread (owner, 2026-10-19, fbk_027)
- A comment of a task is a message or a quiet line (`lineKindOf`, `lib/commentLine.ts`): `due_date` or `start_date` (the reason of a date
  move: the comment has `dates`), `shifted` (a Madar shift: `dates.byTaskId`) or `reopened` (the reason of `tasks.newVersion`: the stored
  field `Comment.kind`). A comment saved before reads the new way from its `dates`. A move-back reason of a stage goes to the Tracker, never to
  the thread. The note of `tasks.sendBack` stays a message: a reviewer writes it to the lead.
- `CommentView.kind` and `ChatRow.previewKind` give the kind (additive; MCP `comments.list` and `chats.list` name them).
- A line is never unread and never waits for a reply. `taskUnread` and `waitingThread` (`handlers/chats.ts`) read the messages only, and a
  line that a person wrote is no reply. The loader does the same (`MESSAGES_ONLY`, `server/data/loaders/chat.ts`). The newest item of a thread
  still gives the preview and the order, so a line can be the preview. `tasks.newVersion` writes the `reopened` line, so `comments` is in its
  `WRITE_KINDS` line.

## A new call: the checklist
1. `defineCall` in its handler file, with tests.
2. If it is server-only: its contract in `contract/server.ts`, its fake in `handlers/serverFakes.ts`, its server body in
   `server/calls/`. There are 11 server-only calls; the 11th is `live.ticket` (exit wave 3).
3. A loader entry in `server/data/loaders/` (a test fails without it).
4. The MCP allow list, Admin list (`MCP_ADMIN`, only an agent of an Admin sees it) or deny list in `server/mcp/tools.ts`
   (a test fails without it). An allowed or Admin tool needs `TOOL_DOCS`. It also needs a sample: add a call to
   `scripts/record-samples.ts`, then run `node --import tsx scripts/record-samples.ts`.
5. An input in `server/core/everyCall.ts` if the loader sweep does not name it.
6. Its read kinds in `src/app/readMap.ts` if it is a read.
7. Its line in `WRITE_KINDS` (`src/app/writeKinds.ts`) if it is a write: the change kinds that its signals can name for the
   screen of its actor. `server/core/writeKinds.test.ts` fails without the line.
8. Words in English and Arabic for every new message.
9. Raise the pinned call counts: `src/api/calls.test.ts`, `server/core/serverCallMap.test.ts`, `server/http/health.test.ts`,
   `server/it/worker.it.test.ts`, and the MCP tool count tests.

## A new record type
- A new zod collection needs a table in a new migration and an entry in `server/data/tables.ts`.
- The prototype store needs a new `STATE_VERSION` and a step in `src/data/migrate.ts`.

## Prototype data
- `src/data/seed.ts` builds the sample office (Hala Nasser is Admin). `STATE_VERSION` is 9 (`store.ts`).
- The sample office has one custom role, Cashier (`rol_001`, held by Khalid Al-Mutairi), and the project Seaside Villa Compound (KH-26-007)
  is linked to the template "Villa, full design" (`linkSampleProject`, matched by name, as the link sheet does). No project was added, and
  `STATE_VERSION` stays 9: the fresh seed has these records, a saved office keeps what it had. The call sweep (`server/core/everyCall.ts`)
  makes `rol_002` and removes it.
- The two feedback triggers needed no new `STATE_VERSION`: the switch record is partial, and `inAppOn` reads a missing key as on.
- `src/api` never imports `src/data/`. `session.resetSampleData` takes the sample office from the runtime (`createApi` option
  `sampleOffice`, `src/data/sampleOffice.ts`), so the server bundles hold none. `settleFuture` runs only on sample data: the
  prototype, the test office seed (madar-test only) and the local seed.
- Each version has a step in `src/data/migrate.ts`. A newer or unreadable saved office is never wiped.

## Tests
- `npm test` runs the rule tests on the store in memory. `npm run test:db` runs them again on the local Postgres (one
  schema for each worker, as madar_server).

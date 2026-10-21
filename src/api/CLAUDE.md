# API contract and the fake API

Every call of Madar is defined here once. The prototype runs these handlers in the browser. The server runs the same
handlers inside `runCall` (see `server/CLAUDE.md`). An AI agent reaches the allowed ones as MCP tools.

## Files
- `registry.ts`: `defineCall({ input, output, run, prepare?, readOnly?, prototypeOnly? })`.
- `handlers/*.ts`: one file for each area. `handlers/serverFakes.ts`: the prototype fakes of the server-only calls.
- `calls.ts`: joins the handlers and the fakes. `sharedCalls.ts`: the calls the server runs, without `SERVER_EXCLUDED`.
- `contract/entities.ts` (records, ids like `prj_`, `tsk_`), `contract/views.ts` (read shapes), `contract/server.ts`
  (the server-only calls, `UPLOAD_LIFE_MS`), `contract/limits.ts` (the plain limits and marks with no zod:
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
- A task may move to another stage of its template (fbk_031, owner 2026-10-23): `projectTemplates.save` only checks that `stageId` names a stage of the same
  template (`assertParts`), so a move is a plain save of the same task id with a new `stageId` (one `projectTemplate.updated` event; Undo takes it back).
  The update of linked projects (`syncDiff`) has no kind for it: the project task keeps its stage, and its dates follow the offsets as before. A task
  that is new to a project still comes under the stage that the template names.
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
  pick, or `apply` without them, needs `templates.updateProjects` (the Admin holds it). In apply mode the added parts start from `shiftAdded`
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
  `isOverdue` still counts it from day 1 ("Past-due to-dos", the Past due column, `tasks.list` filter `overdue`).
- `dashboard.get` returns `gaps` only for `can(gaps.view)` (the Admin, or a role with that right) and `money` only for `can(payment.manage)`; anyone else, and an
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
- Mark as unread (owner, 2026-10-19, fbk_028): `chats.markUnread { conversationId }` (a chat or a task thread) answers `{ unread: true }`. It sets
  `ChatRead.markedUnread` (optional, so there is no `STATE_VERSION` step and no migration: the table keeps the whole record in `doc`). `unreadIn` and
  `taskUnread` count at least 1 for a marked chat, and the mark never adds to a real count (3 new messages stay 3). A read mark ends it: `writeReadMark`
  (`chats.markRead`, `chats.send`, an archive) drops the field. An archived chat comes back to the Inbox, so the badge never counts a chat that is out of
  the list. It writes no event, no notice and no push, and its only signal is the kind `chatReads` to the person. The checks are those of
  `chats.markRead` and `chats.archive`, so a hidden chat answers the same way. Its loader is that of `chats.archive`; `WRITE_KINDS`: `['chatReads']`.
  MCP: deny list, as `chats.markRead` (an unread mark is the own reminder of the person; `INSTRUCTIONS` says so). `chats.waiting` stays in the contract
  and on the MCP allow list, with the waits rule of chat design item 22 (a 👍 or ✅ answers, a group waits only when it names you), but no screen reads
  it any more (owner, 2026-10-20: Mark as unread is the one reminder). The mark counts at least 1 also in the Admin's other project chats
  (`countsNamedOnly`, item 23), and also when a server loader gave the count (`state.counts`).
- `search.query` has a `messages` group (chat design 2026-10-19, item 16): `messageHits` (`messageSearch.ts`) gives the newest 5 of the
  live chat messages of the chats the person may open (`canSeeConversation`) and the comments of the tasks the person may read
  (`can(viewer, 'comment.read', taskResource)`: every project task, an office task for its people and the Admin; the quiet reason lines
  count, the comments on posts do not), whose folded text (`bodySearchText`) holds every word of the query (`searchWords`), when one
  word has 3 letters or more. Each hit has `chatId` (the task id for a comment), `kind` (`project`, `direct`, `group`, `task`), `title`,
  `project`, `person`, `author`, `mine`, `line` (`hitLine`) and `at`. A comment of a deleted task is dropped. The loader reads the newest
  5 matching rows of each kind, so the cut of the handler gives the same rows. An agent gets the hits of its person. Chat files stay out.
- A direct chat with no live message shows in `chats.list` only for the person who has a read mark on it (chat design 2026-10-19, item 18).
  `chats.openDirect` writes that mark when the chat has no live message and the actor is a human; an agent writes none, so its person sees
  the chat after the first message. The loader `chatsOpenDirect` (`loaders/chatOpen.ts`) loads the newest live message and the mark.
- A notice with `messageId` links to `/inbox/<chat or task>?at=<id>` (`chatLink`, `lib/params.ts`): a chat notice opens the chat at the
  message, and a task notice whose `messageId` starts with `cmt_` opens the Inbox task thread at that comment. A notice with no
  `messageId` (saved before) keeps its old link; an office task that the viewer no longer sees still gives no link.
- A chat that the person may not open answers `not_found` ("Conversation <id> does not exist."), whatever its kind (chat design
  2026-10-19, item 17): `requireConversation` serves `chats.messages`, `chats.send`, `chats.markRead`, `chats.archive` and the group
  writes. The answer equals the one for an id that was never made, so an outsider learns nothing, the Admin included for a direct chat.
- `chats.messages` with `around` (chat design 2026-10-19, item 17) opens the page at one message: `messagePageAround` (`chatAround.ts`)
  gives the newest page when the message is in it, else 20 live messages before it and every newer one, up to 500 in all, and
  `ChatThread.newer` is true when more follow. `around` with `before` fails `invalid`. A message that is no live message of this
  chat (deleted, another chat, unknown) gives the newest page and no error. The loader reads the window next to the newest page.
- Notify me (chat design item 21): `chats.setNotify { conversationId, notify }` keeps `ChatRead.notify` ("all" or "named") for the person and
  one chat (a project chat, a direct chat or a group; a task thread id fails the input). It writes the own read mark only, keeps the other
  fields (`lastReadAt`, `archivedAt`), and writes no event. With no mark it stores `NEVER_READ`. The default is "named" for a project chat
  and "all" otherwise (`levelFromRead`). `chats.markRead` and `chats.archive` (when it archives) also mark the unread mention and reply
  notices of that chat or task thread read (`readMentionNotices`, design item 20), so their `WRITE_KINDS` lines hold `notifications`.
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
  (`handlers/history.ts`) for an office task, and `feedbackNoticeHidden` (`notify.ts`) for a report. Change them together. A fourth,
  `hiddenMeeting` (`notifications.ts`) with `noticeMeetingHidden` (`history.ts`), holds the rule of a meeting with no project (fbk_022).

## Task makers (owner, 2026-10-07)
- The person who adds a project task (`principalOf(createdBy)`, so the task of an agent belongs to its person) holds the
  leader's rights on it while on the team: `task.updateAny` (lead, helpers, prerequisites), `task.updateOwn` (title, dates,
  stage, status, checklist) and `task.delete`. `taskResource` names `makerId` for a project task too.
- The lead of a project task holds `task.delete` too (fbk_034, owner 2026-10-20): a task can go into the wrong project. A delete
  by anyone but the maker sends the maker the in-app notice `task_deleted`. An office task stays with its maker and the Admin.
- `tasks.help` (fbk_035, owner 2026-10-20): a person on the team (`task.help`) joins a project task as a helper, or leaves it,
  with one tap. The lead gets the in-app notice `helper_joined`; a leave tells nobody. Nobody joins an office task (`office_help`);
  its helper may leave. `isOwnHelp` (`history.ts`) lets the person undo their own join or leave. `viewerCan.help` shows the join.
- A write that a person makes on themselves (`tasks.take`, `tasks.help`) needs its own rule in `assertMayUndo` (`isOwnTake`,
  `isOwnHelp`, `history.ts`). Without it, Undo asks for the right of the general change, and the toast fails.
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
- `feedback_sent`: a new report tells each active person who holds `feedback.manage` (`activeAdmins`, `notify.ts`; it attaches the rights
  with `withRights`, so it needs `state.settings`). The calls `feedback.list`, `feedback.screenshot` and `feedback.setStatus`, the
  History of a report (`events.list`, its Undo) and `feedbackNoticeHidden` ask the same right. The viewer of `feedbackNoticeHidden` and
  `visibleTriggers` must carry the attached rights, or the notice reads as hidden. `feedback_done`: a report that goes
  from open to done tells `principalOf(createdBy)`. The skips of `notify` apply: the actor and the person of an agent actor,
  agents, people who left, and a switch that is off.
- `Preferences.notifications` is a `partialRecord`: a missing trigger means on. Read a switch only with `inAppOn`
  (`notify.ts`). So a person stored before a new trigger still loads, with no backfill.
- A new in-app notice type: `TRIGGERS` and `IN_APP_ONLY_TRIGGERS` (`entities.ts`), the words `settings.triggers.<t>` and
  `inbox.trigger.<t>` (with `_female` in Arabic), the pins in `entities.test.ts`, `notify.test.ts` and `NotificationsSection.test.tsx`,
  and the list in `server/mail/CLAUDE.md`. No migration: the column is text.
- zod 4 `z.record(enumKey, …)` needs every key, so a new enum value refuses every stored doc. A stored map uses `z.partialRecord`.
- `IN_APP_ONLY_TRIGGERS` (both) send no email: `emailOn` is false, `notifications.updateSettings` refuses their email switch
  with reason `in_app_only`, and Settings shows no email switch for them. `EMAIL_TRIGGERS` holds the other triggers.
- `ADMIN_ONLY_TRIGGERS` (`feedback_sent`): `visibleTriggers` shows its switch only with `feedback.manage`. The value stays.
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

## Copies for the Admin (owner, 2026-10-23)
- An Admin with `Preferences.adminReach` `all` gets a COPY of each notice of the office that the Admin did not get as a recipient.
  `notify()` calls `copyForAdmins` (`adminCopies.ts`) after the normal notices, with the notices it made (`told`). The copy is a
  `Notification` with `forUserIds`: the people that the original went to. A call that tells nobody makes no copy.
- The triggers that copy (`COPY_TRIGGERS`): `task_assigned`, `review_requested`, `task_approved`, `task_sent_back`, `stage_changed`,
  `added_to_project`, `meeting_invited`, `helper_joined`, `task_deleted`, and `mention` only for a project chat message or a task comment
  (`makesCopies`). Never `added_to_group`, a reminder (`due_tomorrow`, `overdue`, `resume_due`, `meeting_soon`), a report notice, or a
  mention in a direct chat, a group or a project post. A new trigger makes no copy until it is in `COPY_TRIGGERS`.
- One copy for each notice call and each Admin. The Admin gets none when the Admin is a recipient of the call, is the actor or the person
  behind an agent actor, is inactive, has the in-app switch of the trigger off, or may not see the target (`mayViewTask`, `mayViewMeeting`,
  `canSeeConversation`, an existing project). A message that names one person and replies to another is two calls, so two copies.
- A copy sends no push and no email: the producers skip a notice with `forUserIds` (`PUSH_NEW_NOTICES_SQL`, `NEW_NOTICES_SQL`, and the
  SQLite forms). Tests: `server/push/adminCopies.test.ts`. A copy joins the story of the call (`correlationId`), so `dropNotices` takes it back
  with the original. An edit of a chat message that removes a name takes the name out of the copy, and the copy goes with its last name
  (`dropMessageNotices`); the restore of a deleted message makes its copies read (`readCopiesOf`).
- The view (`NotificationView.forPeople`) names the people. A copy of an office task, a meeting or a chat that the person no longer sees names
  nobody (`peopleOfCopy`), and the line reads `adminReach.copyGone`. The words are `adminReach.copy.<trigger>` (the mention and the meeting
  have `mention_chat`, `reply_chat`, `mention_task`, `reply_task`, `meeting_new`, `meeting_moved`, `meeting_cancelled`), in
  `src/i18n/real/adminreach.*.json`. A copy counts on the bell like any notice (`ACTION_TRIGGERS`).
- The choice is saved by `me.updatePreferences` (`adminReach`). It refuses a person who is not an Admin, and an agent, with `forbidden`.

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

## Google Calendar (owner, 2026-10-19, fbk_022)
- Four server-only calls (`contract/server.ts`, `server/calls/google.ts`): `google.status` (read) gives `{ ready, state, connectedAt }` with `state` one of
  `none`, `ok`, `not_synced`, `broken`. `google.connectStart` (read) gives the Google address with a signed state. `google.connect { code, state }`
  swaps the code and gets the calendar "Madar" in the Google account of the person: the one that Madar made before (it remembers the id, and a disconnect
  keeps it), else a new one. `google.disconnect` stops the sync. Only a person, for the person:
  an agent gets `forbidden`, and no call takes the id of another person. All four are on the MCP deny list.
- They touch only the three server-only tables `google_connections`, `google_events` and `google_calendars` (`server/google/store.ts`). No State collection reads them, so the
  calls write no event, no History row and no change signal, and `WRITE_KINDS` has `[]` for the two writes. The prototype fakes give `ready: false`
  and refuse the other three with `google_not_ready`.
- Reasons: `google_not_ready` (this copy has no Google values), `google_link_old` (the state is changed or past 10 minutes, or Google calls the code
  gone), `google_link_person` (the state is of another person; `forbidden`), `google_denied` (no refresh token, or the calendar scope is absent),
  `google_unreachable` (`failed`; Google timed out or answered 5xx). The reason `google_link_person` is not `google_link_other`: i18next reads a key
  that ends with `_other` as a plural form.
- The callback `GET /api/google/callback` has no sign-in. It checks the signed state and sends the code to the Settings screen in the address fragment
  (`/settings#google=finish&code=...&state=...`); the signed-in screen then calls `google.connect`. See `server/CLAUDE.md`.

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
- The 17 office rights are in `OfficeRight` (`contract/entities.ts`), in 7 sections (`RIGHT_SECTIONS`, `permissions.ts`; `OFFICE_RIGHTS`
  follows it, and a test checks that both agree). The Admin holds all of them. A role always keeps what a Member does today; each right adds
  one power of the Admin (owner, 2026-10-23, role-rights). The defaults of Management, Accounting and Member add none of the ten new rights.
  - Projects: `project.editAny` (passes `project.edit` and `project.healthOverride` off the team), `project.changeLeaderAny`
    (`project.changeLeader`), `project.archiveAny` (`project.archive`: pause, resume, status, restart date), `project.delete`, `project.editCode`.
  - To-dos: `task.reviewAny` (`task.review`), `task.changeAny` (`task.updateAny`, `task.updateOwn`, `task.contribute`, `task.delete` of a
    project task; never an office task, and `task.delete` only when the resource describes a task, so a file or a Tracker entry stays with the leader).
  - People: `people.manage`, `clients.manage`, `subCompanies.manage` (`subCompanies.save` and `.delete`, the Undo of a sub-company event;
    an agent still never makes, changes or undoes a sub-company).
  - Money: `payment.manage`. Templates: `templates.manageAll`, `templates.updateProjects` (`projectTemplates.usage`, `.syncPlan`, the full
    `.syncApply`, the follower count; the apply by a project leader keeps `project.edit`).
  - AI and reports: `report.office`, `agents.undoAny` (`event.undoAgent` on any project; the Undo still asks the right of the change itself).
  - Office: `feedback.manage` (requests and bugs, see the notices section), `gaps.view` (the gaps of `dashboard.get` and `reports.office`).
- A right gives only its own power. A rule that stands in for the leader asks the right that fits: "no review" on template tasks asks
  `task.review`, naming a person outside the team (`ensureOnTeam`) and a to-do template made from a task ask `project.edit`. Before a new
  right passes an action, grep every use of that action and check what it stands in for.
- A stored role keeps its own order of rights; a save of the same rights in another order is no change (`sameRights`, `handlers/roles.ts`).
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
- The right is `report.office` (assertCan). Money needs `payment.manage` (null otherwise); gaps need `gaps.view` (null otherwise).
- The stage moves, completions and pauses come from `state.counts` (`REPORT_KEYS`, the loader counts them in SQL). The reviews come from
  the review events that the loader reads once (`state.events`). The handler counts them for each person by `actingForId`. Without
  `state.counts` it counts `state.events` for the other three too (the prototype). Both give the same numbers (`loaders.test.ts`).
- Past due (the tasks and the money) counts to today while the period has not ended (`dueEnd`, owner 2026-10-21): on a Wednesday, a
  to-do due on Thursday is not past due yet. A period that has ended counts to its last day, as before.
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

## Edit, delete and react to a chat message (chat design 2026-10-19, items 11 and 12)
- `requireMessage(ctx, id, { author, allowDeleted })` (`handlers/chats.ts`) is the one door of the calls below (the reaction of B10 too). A missing message, a message of
  a chat the person may not open, and (without `allowDeleted`) a deleted message all answer `not_found` Message, the answer for an id that was
  never made, for a direct chat, a project chat and a group alike. With `author`, a person who can open the chat but is not the author (or the
  person behind the agent that wrote it, `isMine`) gets `forbidden` with reason `not_author`.
- `chats.editMessage { id, body }`: the author only, at any time, in a closed chat too. The same body changes nothing. A new body sets `editedAt`
  and finds the names again (`namesIn`, the rule of `postMessage`): a person named for the first time gets the mention notice with `messageId`,
  a person whose name goes loses the notices of that message, and the reply author stays named while active and in the chat. No History event.
- `chats.deleteMessage { id, deleted = true }`: sets `deletedAt` (a deleted message leaves every read path, `isLiveMessage`) and takes away the
  notices of the message. `deleted: false` is the Undo of the toast: it removes `deletedAt` and writes the notices again, already read, so a
  restore sends no push and no mail. The same value changes nothing. The files of the message stay. `messagePage` accepts a deleted `before`,
  so "Earlier messages" works when the oldest shown message was deleted meanwhile.
- `reactions.toggle { commentId | messageId, emoji }` takes exactly one id (older inputs with `commentId` stay valid). A message reaction toggles
  the id of the person behind the call in `Message.reactions` (a missing record starts from `emptyReactions()`), for any person who may open
  the chat, in a closed chat too. It writes no event and no notice and leaves `createdAt` alone, so it makes no unread mark and no push. The
  output is a `CommentView` or a `MessageView`. The loader reads the message with `chatMessageRows`, and `WRITE_KINDS` adds `messages`.
- The three calls name only the kinds `messages` and `notifications` (the reaction only `messages`), so their signals stay nameless (INT-16).
  MCP: edit, delete and the reaction are on the deny list.

## Meetings (owner, 2026-10-19, fbk_022)
- `Meeting` (`mtg_`, `contract/entities.ts`): a meeting, a client meeting, a team meeting or a site visit (`MeetingKind`). Kind and project are two
  separate choices. `projectId` may be null. Stamps are in office time (`+03:00`): `startsAt` is a multiple of 5 minutes, and `endsAt` is
  stored. A meeting lasts 15 to 720 minutes. `State.meetings` is optional (`meetingsOf`), so there is no `STATE_VERSION` step.
  Plain limits: `MEETING_LIMITS` and `MEETING_KINDS` in `contract/limits.ts`. Plain rules: `src/lib/meetings.ts` (`dayOf`, `phaseOf`, `kindDefaults`).
- Calls (`handlers/meetings.ts`): `meetings.list` (window of the office day of the start, default today to 60 days, at most 400 days, 200 rows,
  `mine` true by default, `mine: false` needs `projectId`), `meetings.get`, `meetings.create`, `meetings.update`, `meetings.cancel`, `meetings.delete`. `create` is
  the first key of `meetingCalls` on purpose: the call sweep (`server/core/everyCall.ts`) runs in that order and the others need a meeting.
- Reasons (`invalid_input` unless said): `in_the_past` (a start more than 14 days ago), `start_not_on_five`, `project_closed` (the project is
  not active or on hold), `minutes_not_attending` (wave 1 only: no call raises it since wave 2, but an old answer can name it), `attendee_agent`, `person_inactive`, `title_hidden`, `project_fixed` (a meeting never
  changes its project), `window_too_long`, `window_reversed`, `project_needed`; `conflict`: `meeting_cancelled`, `meeting_over` (after the end
  only `notes` change, and a cancel is refused), `meeting_not_cancelled` (a delete of a meeting that is not cancelled).
- Rights (`permissions.ts`): `meeting.view`, `meeting.create`, `meeting.edit`, with `meetingResource` and `mayViewMeeting`. A project meeting is
  read by everyone, planned by the team, the leader and the Admin (the right to post), and changed or cancelled by its organizer, the leader and
  the Admin. A meeting with no project is read by its organizer and its attendees only, and changed by its organizer only. The Admin has no
  extra right there (owner, 2026-10-19, Q4: this differs from an office task). The organizer of an agent is its person (`organizerId` is always
  a person; `createdBy` is the agent).
- `rev` starts at 1 and grows with a change of the start, the end or the place, and with a cancel. It is not in the event: an Undo of a meeting
  change raises `rev` once more (`undoOne`), so `rev` never goes down and a calendar sees the change.
- A hidden meeting answers as a missing one (owner, 2026-10-19): `not_found` Meeting (`requireMeeting`) on get, update and cancel, and nothing in
  `meetings.list`, `events.list` or `search.query`. Every event of a meeting with no project carries `officeMeetingId` (`events.ts`, as
  `officeTaskId`), and `seesEvent` (`handlers/history.ts`) shows it to the people of that meeting only. The Admin who is not invited sees
  nothing, and a meeting that is gone shows its events to nobody. An Undo event takes the `officeMeetingId` of the event it undoes.
  `events.undo` and `events.undoStory` answer such an event or story as a missing one. The notice of a meeting that its owner no longer sees
  (a person taken off the attendees) reads as gone and names nothing (`hiddenMeeting`, `notifications.ts`; `noticeMeetingHidden`, `history.ts`);
  `notify` skips a person who does not see the meeting. The leak tests: `handlers/meetingLeaks.test.ts`, `server/mcp/meetingTools.test.ts`,
  `server/core/meetingsSignal.test.ts`, `server/it/meetings.it.test.ts`.
- Notices (owner, 2026-10-19; `handlers/meetings.ts`, `notify.ts`): two triggers, `meeting_invited` and `meeting_soon`. Both are in
  `IN_APP_ONLY_TRIGGERS` (no mail and no email switch; push goes for every notice) and in `ACTION_TRIGGERS` (the bell counts them).
  `Notification.meeting.change` is `new`, `moved` or `cancelled`. Create: each attendee gets `new`. Update: an added attendee gets `new`;
  a change of the start, the end (day, time or length) or the place gives `moved` to the attendees who stay, and to the organizer when
  another person made the change; a title, note, guest, kind or minutes change tells nobody. Cancel: each attendee, and the organizer when
  another person cancelled, gets `cancelled`; a second cancel tells nobody. The actor and the person of an agent actor get none (`notify`).
  The notice joins the story of the call, so an Undo of the story takes it back (`dropNotices`). `NotificationView.target` is the title,
  `startsAt` the start (null when the viewer no longer sees the meeting), `link` is `meetingLink` (`/meetings?meeting=<id>`).
  The reminder: `runScheduledTriggers` gives the organizer and the attendees of a scheduled meeting one `meeting_soon` from 30 minutes
  before the start (`MEETING_SOON_MS`) until the start; the dedupe key is `meeting_soon:<id>:<startsAt>`, so a moved meeting reminds again.
  The server job loads the scheduled meetings that start within the hour (`loadJobs`, `now` of the run). The screen words are in
  `src/i18n/real/meetings.*.json` (`inbox.trigger.meeting_invited`, `_moved`, `_cancelled`, `meeting_soon`, `inbox.meetingGone`).
- `projects.delete` deletes the meetings of the project and their notices. A person who is an attendee and leaves keeps the record.
- `Task.meetingId` and `Meeting.minutesTaskId` are in the contract and nothing sets them since the owner dropped the minutes task (2026-10-19).
- Repeating meetings (wave 3, owner 2026-10-19, Q7; `handlers/meetings.ts`, `lib/meetings.ts`): `meetings.create` takes `repeat: { every: 'day' | 'week' | 'two_weeks',
  until: Day | null }` (optional, null is none) and makes the first `SERIES_AHEAD` (8) meetings at once, one row for each, with `seriesId` (the id of the first)
  and the same `repeat`. `occurrencesOf(rule, first, after, count)` gives the days: "day" is Sunday to Thursday (also when the first day is a Friday), "week" and
  "two_weeks" keep the weekday of the first day. `until` is the last day and is kept; it is refused before the first day (`until_before_start`) and more than
  400 days after it (`until_too_far`), both `invalid_input` on `repeat`. The events: `meeting.created` for the first meeting, `meeting.added` for each of the others
  (cause: the first event), all in the story of the call, so one `events.undoStory` takes the series back with its notice. The project feed shows the first
  meeting alone: `meeting.added`, `meeting.series_updated`, `meeting.series_cancelled` and `meeting.extended` are not feed verbs (a daily series would fill
  the feed and refresh the "last activity" of a project). The attendees get one `meeting_invited` notice for the series, with the dedupe key
  `meeting_invited:<seriesId>` (and `:<userId>`), aimed at the first meeting.
- The scope (`scope: 'one' | 'later'`, default `one`) of `meetings.update` and `meetings.cancel`. "later" changes the meeting and every scheduled meeting of the
  series that starts after it and is not over (`laterOf`); a past meeting and a cancelled meeting never change. The rights and the checks are those of the
  meeting alone (a meeting in no series is one meeting whatever the scope). An update changes only what changed on this meeting: each changed field goes to the
  later meetings (the people replace their lists); a new time of day applies to each later meeting on its own day, a new length to each; a new day is refused
  with `series_day_one_only` (`invalid_input` on `startsAt`) and is made one meeting at a time. A cancel for "later" is the choice of the person to stop the series (owner, 2026-10-23: the users decide if a meeting repeats, not the platform), so it sets `repeat.until` of EVERY
  meeting of the series that the person sees, the earlier ones too (cancelled or not, past or not), to the day before this meeting (an earlier `until` stays). A meeting that
  is not cancelled by it only changes its rule: event `meeting.series_updated`, no `rev`, no notice. A cancel of one meeting (scope "one"), also the last one, changes no rule. The target writes `meeting.updated` or `meeting.cancelled`; each other
  meeting writes `meeting.series_updated` or `meeting.series_cancelled` with the target's event as its cause. Each changed start, end or place raises `rev`
  of that meeting. One notice for the whole change (the target's), `moved` or `new` or `cancelled`, with no dedupe key. One Undo of the story takes it all back.
- `meetings.extend { seriesId } -> { added }` keeps a series full (the 15-minute job and the prototype timer call it, as they call `meetings.settle`; MCP deny
  list; `WRITE_KINDS`: events, meetings). It reads the visible meetings of the series from today on, takes the last one as the template, and adds meetings after it
  until `SERIES_AHEAD` scheduled meetings that are not over are ahead, or until `until`. It adds by the rule only (`until`, the 8 ahead): a cancelled last meeting does not end a series (owner, 2026-10-23), and the new meeting copies the last one and is
  scheduled. It adds none for a series of a project that is completed or archived (a paused project goes on), and a series with no meeting from today on reads as `not_found` (so does an unknown or hidden id, with the text of an unknown id). New meetings start
  after the last day, or after today when the series ran dry, copy the title, kind, project, place, guests, notes, organizer, people, length and time of day, get
  `createdBy` of the caller, and have no notice. One mark `meeting.extended` (target: the last meeting, not undoable, `NOT_UNDOABLE`) and one `meeting.added` for each
  new meeting with the mark as its cause. The call counts every meeting of the series, also those that the caller does not see; the caller must see the
  last meeting and may change it (`meeting.edit`: the organizer, or the leader and the Admin of a project meeting; review 2026-10-20), else `not_found` or `forbidden`. `seriesToExtend(state, at)` is the rule of the job read for the
  prototype timer.
- Reasons added: `until_before_start`, `until_too_far`, `series_day_one_only`.
- Delete (owner, 2026-10-23; `meetings.delete { id, scope? } -> { deleted }`, handlers/meetings.ts): only a cancelled meeting (else `conflict` `meeting_not_cancelled`), by the right
  `meeting.edit` (the organizer, the leader and the Admin of a project meeting; the organizer of a meeting with no project); a hidden meeting answers `not_found`. It writes
  `meeting.deleted` with the whole record in `before` (`recordDelete`; a meeting with no project carries `officeMeetingId`), so the Undo of the toast (`events.undoStory`) brings it
  back (`rev` grows once more). Scope "later" deletes this meeting and every later CANCELLED meeting of the series that the person sees, never a scheduled one; the later events
  name the first as their cause, all in one story. A delete changes NO repeat rule (the cancel did that). It sends no notice; a notice of the meeting then reads as gone
  (`inbox.meetingGone`). `seesEvent` (history.ts) reads the last copy of a deleted meeting for an Undo (`lastMeetingCopy`), so the people of a meeting with no project take the delete
  back, and nobody else does (`not_found`). `MeetingDetail.viewerCan.delete` is true for a cancelled meeting that the person may change. The call is in `GCAL_CALLS` (a cancel whose
  sync never ran leaves a Google event row; the delete sends a sync row for it). MCP: deny list (an agent cancels only). Tests: `meetingDelete.test.ts`.
- Settle (wave 2, owner 2026-10-19; `meetings.settle { id }`, `settleMeeting`, `dueToSettle` in `handlers/meetings.ts`): after `endsAt` Madar marks the
  meeting as over (`settledAt`, event verb `meeting.settled`) and, when `hasTrackerLine` (`lib/meetings.ts`: a project meeting that is not a team
  meeting), makes its Tracker line: type `meeting`, side `both`, the title and notes of the meeting, the day of the start, the organizer and the
  first 19 attendees, `auto: 'meeting'`, `meetingId`, `minutes: null`. The line event (`tracker.logged`) carries `causeEventId` of the mark, so the
  History shows that Madar made the line because the meeting ended. A team meeting and a meeting with no project get the mark only. There is no
  minutes task, no notice, no push and no mail. The call needs only the view of the meeting (`requireMeeting`). Before the end, for a cancelled
  meeting and after the first settle it writes nothing and gives the stored `{ settledAt, trackerEntryId }`. The job (`server/jobs/steps/meetings.ts`)
  and the prototype minute timer call it for each meeting of `dueToSettle` (scheduled, not settled, ended in the last `SETTLE_BACK_DAYS` days).
  The mark has no Undo: `events.undo` answers `conflict`, reason `settle_final` (`meeting.settled` is in `NOT_UNDOABLE`, and `undoOne` raises the
  reason first), because the next job run would settle the meeting again. The Undo of `tracker.logged` deletes the line, as for any line; the
  meeting then keeps `trackerEntryId`, which `REFERENCE_FIELDS` leaves out on purpose, so the delete is not refused. MCP: deny list.
  The author of the line (`createdBy`) is always the organizer, whoever settles (the job, the first minutes save, or any person who sees the
  meeting); the events name the caller as the actor (security fix, 2026-10-19). `mayDeleteTracker` (`views.ts`) gives a line with `auto: 'meeting'`
  no author delete: only the project leader or the Admin deletes it, and so only they undo its `tracker.logged` (`history.ts` uses the same rule).
  The screens read `canDelete` of the row, so the Delete button follows. Tests: `meetingSettle.test.ts` ("the author and the delete of the line").
- Files of a meeting with no project (wave 2, owner 2026-10-19; the pattern of the chat files): `files.upload` and `files.uploadStart` take `meetingId`
  in place of a project, an office task or a chat. `FileRec.meetingId` (optional) names the meeting; `projectId`, `stageId` and `taskId` are null. Only a
  meeting with no project takes one: a project meeting, also a team meeting, uses the files of its project, and an upload with its id fails with
  `invalid_input`, reason `file_meeting` (so does a `meetingId` next to a project, a chat, a stage, a task, a cover or a client mark). Who uploads:
  `minutesRefusal(state, meeting, viewer, at)` (`handlers/meetings.ts`) must be null. In this order: `not_found` Meeting (the viewer does not see it; the
  text of an unknown id), `conflict` `meeting_cancelled`, `conflict` `minutes_not_yet` (before `endsAt`), `forbidden` (no `meeting.minutes`: the
  organizer and the attendees; for a project meeting the leader and the Admin too), and `conflict` `minutes_line_gone` (a Tracker line meeting whose
  settled line is gone). `mayViewFile` is `mayViewMeeting` of the meeting: the people who see it, the Admin only when invited, and nobody once the
  meeting is gone. `mayOpenFile` keeps an agent from opening one (`files.get`, the `files.link` fake). The upload writes no event (`uploadMeetingFile`).
  `assertFilesForMeeting` (`attach.ts`) takes only a file of the meeting itself, and reads any other file as `file_missing`. Every other carrier (a task
  comment, a project chat or a direct chat, the Tracker, `files.share`) refuses a meeting file with reason `file_meeting` (a post gives its plain
  refusal for any file that is not a file of its project). `files.delete` and `files.markDelivered` refuse it too, and `mayDeleteFile` is false.
  `search.query` finds no meeting file, and `files.list` never lists one. The leak tests: `handlers/meetingFiles.test.ts`, `server/calls/meetingFiles.test.ts`.
- The minutes (wave 2, owner 2026-10-19; `meetings.saveMinutes { id, text, fileIds, since? }` in `handlers/meetings.ts`): any attendee of a meeting that
  ended writes them, as one text of at most 10,000 letters (`MEETING_LIMITS.minutesMax`) with files (`MAX_ATTACHMENTS`), replaced as a whole. The right is
  `meeting.minutes` (`permissions.ts`): the organizer and the attendees; for a project meeting the leader and the Admin too (the minutes join the project
  record that the leader answers for); a team member who did not attend only reads them. For a meeting with no project the Admin writes only when invited.
  `minutesRefusal` checks the phase and the right (see the files above). Where they live (`minutesOf`): a project meeting that is not a team meeting
  (`hasTrackerLine`) keeps them on its Tracker line (`TrackerEntry.minutes`, event verb `tracker.minutes_saved`); a team meeting and a meeting with no project
  keep them on the meeting (`Meeting.minutes`, verb `meeting.minutes_saved`; `officeMeetingId` for a meeting with no project). Both verbs are feed verbs
  (`FEED_VERBS`), `meeting.settled` is not. A meeting that has a Tracker line and no mark is settled in the same call, so the person never waits for the
  job; the mark and the line then get a story of their own (`cor_settle_<meeting>`), so the Undo toast of the save (`events.undoStory`) takes back the
  minutes only and never meets the mark that has no Undo. `files` of a project meeting are files of its project (`assertFilesInProject`); a meeting with no
  project takes only its own files (`assertFilesForMeeting`). `since` is the `updatedAt` that the screen opened (null for no minutes yet): another value gives
  `conflict`, reason `minutes_changed`, so a late save never replaces what another attendee wrote. An empty text with no files writes `minutes: null`. The
  same text and files write nothing. No notice, no push, no badge and no task. The Undo of either verb needs `meeting.minutes` on its meeting
  (`assertMayUndo`, `handlers/history.ts`), and the change stays the person's own (`assertUndoRight`). `MeetingDetail` gives `minutes`, `minutesPlace` and
  `viewerCan.minutes`; `TrackerRow` of an auto meeting line gives `meeting`, `minutes` and `canEditMinutes` (other rows leave the three out).
  `tracker.log` and `tracker.update` never take `minutes` or `meetingId`: zod strips the keys. MCP: `meetings.saveMinutes` is on the allow list, not additive.
- The person for the minutes is gone (owner, 2026-10-19). `Meeting.minutesById` is optional and nothing writes or reads it. The inputs of
  `meetings.create` and `meetings.update` lost `minutesById`: zod strips the key, so an old tab or an old agent still works. `MeetingDetail.minutesBy`
  and `minutesTask` stay in the shape, always null. A stored row with `minutesById` still parses. No migration and no backfill.
- The sample office (`data/sampleMeetings.ts`, only the prototype and `sampleOffice`, as the sample sub-companies): one client meeting of an open
  project and one meeting with no project for the Admin and a leader. The prototype day shift moves `startsAt` and `endsAt` (`PLANNED_FIELDS`,
  `data/shift.ts`) and never pulls them back before now.

## A new call: the checklist
1. `defineCall` in its handler file, with tests.
2. If it is server-only: its contract in `contract/server.ts`, its fake in `handlers/serverFakes.ts`, its server body in
   `server/calls/`. There are 13 server-only calls (`usage.get` and `usage.retryEffect` were removed, 2026-10-23); `live.ticket` (exit wave 3) is the 9th, and the four `google.*` calls (fbk_022) follow it.
3. A loader entry in `server/data/loaders/` (a test fails without it).
4. The MCP allow list, right list (`MCP_BY_RIGHT`, only an agent whose person holds the right sees it; `MCP_ADMIN` is empty) or deny list in `server/mcp/tools.ts`
   (a test fails without it). An allowed or right tool needs `TOOL_DOCS`. It also needs a sample: add a call to
   `scripts/record-samples.ts`, then run `node --import tsx scripts/record-samples.ts`.
5. An input in `server/core/everyCall.ts` if the loader sweep does not name it.
6. Its read kinds in `src/app/readMap.ts` if it is a read.
7. Its line in `WRITE_KINDS` (`src/app/writeKinds.ts`) if it is a write: the change kinds that its signals can name for the
   screen of its actor. `server/core/writeKinds.test.ts` fails without the line.
8. Words in English and Arabic for every new message.
9. Raise the pinned call counts: `src/api/calls.test.ts`, `server/core/serverCallMap.test.ts`, `server/http/health.test.ts`,
   `server/it/worker.it.test.ts`, and the MCP tool count tests: `server/mcp/app.test.ts`, `server/mcp/tools.test.ts` (two
   destructive counts, member and Admin), `server/mcp/oauth/sdk.test.ts`, and the counts in `server/mcp/CLAUDE.md` and the `docs.ts` header.

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
- A delete of the last task of a stage records a stage change after the delete. A test undoes the delete event or the story,
  never "the newest event".
- `npm test` runs the rule tests on the store in memory. `npm run test:db` runs them again on the local Postgres (one
  schema for each worker, as madar_server).

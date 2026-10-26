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
  `userCard()` leaves picture data out, so lists stay small. `User.nameAr` is the Arabic name; an empty value means none. `Project.nameAr` is the same for a project (fbk_062): optional, trimmed, 120 characters at most; `projects.create` leaves it out when it is empty, and `projects.update` with an empty value clears it (and writes no event when there was none). A view that names a project builds the ref with `projectRef` or `projectTile` (`src/lib/projectRef.ts`), never by hand, so `nameAr` comes along.
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
  after it, while the request has fewer than 12 calls and the cost of its calls stays within `BATCH_BUDGET` (`callCost`, `remote/wire.ts`; the cheap person lists
  of a screen cost 1 each, perf2 savetrip). Every other call keeps the limit of one overview call for each request, so the cold start of a screen sends the same
  requests as before. Else the read goes as any other call, and
  RemoteApi does not name it as fresh. A read that goes again after a lost answer goes alone and drops `after`.
- A rule over two input fields: chain `.refine(fn, { path, message })` on the `z.object` of `defineCall`. zod 4 keeps a ZodObject,
  so the MCP inputSchema still builds, and `invalidInput` lists each path in `details.fields` (`reports.office`).
- `Store.runIf(fn)` saves and tells the listeners only when fn returns true; on an error it puts the state back, as `run()`
  does. The prototype minute timer (`startScheduler`, `src/app/bootstrap.ts`) uses it.

## The project code (owner, 2026-10-05)
- `lib/projectCode.ts` reads and builds `YYMMSSINI-CLS-Type` (key `YYMMSSINI`, contract `YYMMSS`). Old codes (`KH-26-014`)
  stay valid. Two projects of one contract share one code, so the projects table has no unique rule on the code.
- `projects.create` takes `codeParts`, `code` or `sameContractAs` (at most one); with none, the old automatic code. A typed
  code whose YYMMSS belongs to another contract fails with `code_taken`. `codeParts` initials go onto a client with none.
  The automatic code (`nextProjectCode`, also every INT code) counts only codes whose end after `<prefix>-YY-` is all digits, so a kept
  code with that head never gives "NaN" (2026-10-25).
  MCP (owner, 2026-10-25; the rest of the project set-up tools are in `server/mcp/CLAUDE.md`, MCP parity 2026-10-26): `projects.create` is on the right list (`project.create`), `clients.create` too (`client.create`), and `clients.list` is on the allow list. All four
  need the AI switch `ai.projectSetup`, off by default except for the Admin. A new project has no Undo (`NOT_UNDOABLE`). The agent gets lean `clients.list` rows (no contact name, phone or email).
- Only a person with the switch `project.code` corrects a code (`projects.update` `patch.code`, verb `project.code_changed`). The switch
  passes only where `project.details` passes, so a holder who is not the leader and has no `project.details.all` is refused.
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
- `projectTemplates.list`, `.save` (no `id` makes one, an `id` changes one) and `.delete`. A new template needs `templates.projectCreate`
  (off for a Member by default, owner 2026-10-21). A change or a delete needs the person who saved it, or `templates.projectAny`. MCP: `.list` is on the allow list (lean rows, AI switch `ai.projectSetup`); `.save`, `.delete` and the link and update calls are tools since the MCP parity track (owner, 2026-10-26), with the same switch.
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
  for each part with no pick. A second link is refused (`already_linked`). Both calls are MCP tools since the MCP parity track (owner, 2026-10-26; `ai.projectSetup`).
- Apply a template to an ongoing project (owner, 2026-10-19, fbk_020): `matchPlan`, `link` and the adding need `project.template` on the
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
  `syncPlan` and the update of many projects stay with the Admin. All five calls are MCP tools since the MCP parity track (owner, 2026-10-26; `ai.projectSetup`): their `TOOL_DOCS` say to ask the person first.
- Update of linked projects (fbk_008 item 4, Admin only): `projectTemplates.usage` lists the open projects, linked or not.
  `projectTemplates.syncPlan` gives the diff (`syncDiff`, `src/api/templateSync.ts`) of each listed project linked to the template.
  `projectTemplates.syncApply` makes the picked changes of one project, in one story. A closed task keeps its dates and its lead.
  A dropped part comes back only with `bringBack`. The plan uses the template lengths from the project start. All three are MCP tools since the MCP parity track (owner, 2026-10-26).
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
- `dashboard.get` returns `gaps` only for `can(gaps.view)` (the Admin, or a role with that right) and `money` only for `can(payment.view)`; anyone else, and an
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
  MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.myState`), as `chats.markRead`: an agent marks only when its person asks (`INSTRUCTIONS`). `chats.waiting` stays in the contract
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
  member. `chatForUpload` (`chatState.ts`, `(state, conversationId, person)`) is the rule of who uploads, for the browser and the server alike. The upload writes no event
  (`uploadChatFile`). An agent follows exactly the rights of its person (owner, 2026-10-26; it was refused before): `chatForUpload` and `mayOpenFile` read the
  person, so the agent of a member uploads and opens, and the agent of a person who is no member gets not_found on every path. `mayOpenFile` still keeps an agent
  from opening the file of a meeting with no project (`files.get`, the `files.link` fake). `assertFilesForDirect` takes a
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
- Review: only when the maker is not the lead; `reviewersOfTask` (`notify.ts`) gives the maker, or the Admins when the maker left. For a project, `reviewersOf`
  gives the active leader only while the leader holds `task.review.lead` (`canReview`). Else the active Admins review, as for a project with no leader. The
  Dashboard `inReview`, the `review_for_me` filter and the morning summary (`SUMMARY_COUNTS_SQL` takes the reviewing leaders as `$3`) follow the same rule.
- `task.officeAll` gives a person the place of the Admin on every office task: the view rule, the loaders (`officeTaskConds`), the private signals
  (`Diff.privatePeople`), the push (`PushPerson.officeAll`) and the rights of the maker. `notify`, `adminCopies` and the notice rules attach the rights of the
  person first (`ensureRights`), so a holder keeps its notices.
- Office tasks count in the lists of a person, `overdueTasks`, the workload, `inReview` and the gaps of `dashboard.get`, only
  with no people filter. They never count in a project number.
- Three functions hold the rule of a hidden notice: `hiddenTask` (`notifications.ts`) and `noticeTaskHidden`
  (`handlers/history.ts`) for an office task, and `feedbackNoticeHidden` (`notify.ts`) for a report. Change them together. A fourth,
  `hiddenMeeting` (`notifications.ts`) with `noticeMeetingHidden` (`history.ts`), holds the rule of a meeting with no project (fbk_022). A fifth,
  `noticeProjectHidden` (`hiddenNotice.ts`), holds the rule of an item of a project that the person may not view (hidden projects, wave D3): the
  notice view (`hiddenProject` in `notifications.ts`: `isGone`, `viewOf`, `peopleOfCopy`), `dropNotices` (`history.ts`) and `mayView` of
  `adminCopies.ts` all call it. A deleted hidden project reads from its last copy (leader, chosen people, holders of `project.hidden`).

## Task makers (owner, 2026-10-07)
- The person who adds a project task (`principalOf(createdBy)`, so the task of an agent belongs to its person) holds the
  leader's rights on it while on the team: the lead and the helpers (`task.assign`), the prerequisites (`task.details`), the other fields (`task.details`,
  `task.dates`, `task.work`) and the delete (`task.deleteOwn`). `taskResource` names `makerId` for a project task too. The gates of one kind of change are
  in `taskGates.ts` (`mayChangeTask`, `mayAssignTask`, `mayChangePrerequisites`, `mayTickChecklist`, `mayDeleteTask`); `meetingGates.ts` holds the two
  of a meeting (`mayEditMeeting`, `mayWriteMinutes`). A person who may change any task of the project (`task.any`) passes every kind.
- `tasks.update` asks one gate for each field: `startDate`, `dueDate`, `schedule` and `durationDays` ask `task.dates`; `title`, `description`, `stageId`, `flagged`
  and the checklist itself ask `task.details`; a tick asks `task.work` (a helper ticks too); `ownerId` and `helperIds` ask `task.assign` (the maker) or `task.any`;
  `prerequisiteIds` ask `task.any`, or the maker with `task.details` (the lead alone does not change them); `needsReview` asks `task.review`. Complete, move, arrange
  and a new version ask `task.work`. Naming another person as the lead or as a helper of a new task asks `task.assign`.
- The lead of a project task holds `task.deleteOwn` too (fbk_034, owner 2026-10-20): a task can go into the wrong project. A delete
  by anyone but the maker sends the maker the in-app notice `task_deleted`. An office task stays with its maker and the Admin.
- `tasks.help` (fbk_035, owner 2026-10-20): a person on the team (`task.help`) joins a project task as a helper, or leaves it,
  with one tap. The lead gets the in-app notice `helper_joined`; a leave tells nobody. Nobody joins an office task (`office_help`);
  its helper may leave. `isOwnHelp` (`history.ts`) lets the person undo their own join or leave. `viewerCan.help` shows the join.
- A write that a person makes on themselves (`tasks.take`, `tasks.help`) needs its own rule in `assertMayUndo` (`isOwnTake`,
  `isOwnHelp`, `history.ts`). Without it, Undo asks for the right of the general change, and the toast fails.
- The review stays with the leader and the Admin: `task.review` (approve, send back) and the review need (`needsReview` in
  `tasks.update`, and `needsReview: false` in `tasks.create`). `TaskDetail.viewerCan.setNeedsReview` shows the switch.
- A new task asks `task.add` (the team scope for a project, the office switch for an office task). Naming another person asks `task.assign` on top: a team member names any team mate as lead and helpers.
  Only the leader and the Admin name a person outside the team (`ensureOnTeam` asks with the project role alone), so the
  task panel offers a maker only the team.
- An Undo of a change of a project task reads the rights on that task, or on the last copy of a deleted one
  (`projectTaskOf`, `handlers/history.ts`). An Undo of a review-need change asks `task.review`.
- The rights that pass the project role alone stay with the leader: the files and comments of others, Tracker deletes,
  `taskTemplates.save` (and `saveTemplate`), and the undo of an agent change (`ai.undoOthers`).

## The shared order of tasks (owner, 2026-10-07)
- `Task.rank` (a number, null or missing) is the place of a task inside a date group of the Tasks screen (`groupMyTasks`) and
  Home (`lib/home.ts`). A lower number sits higher. A task with no number sits under the placed ones, in the old order. The
  number belongs to the task, so everyone who sees two tasks in one group sees them in the same order.
- `tasks.arrange { ids, moved? }` takes the new order of one group, top first. Each task needs `task.work` (its lead, its
  maker) or `task.any` (the leader, the Admin). `arrangeRanks` (`lib/arrange.ts`) keeps the numbers that already go up and gives new ones only
  to the others, so one drag writes one `task.arranged` event. The first order of a group writes one event for each task.
- An order never changes a date, a status or a lead. The meeting summary and the project feed leave `task.arranged` out.
- On the Tasks screen the tasks the person may move come first, then the tasks they only help with (no grip, and no drop
  between them). Home shows only the tasks the person may finish, in the same order.

## Remove a person (owner, 2026-10-12)
- `users.remove { id }` takes a turned-off person or agent out of every list for good: `User.removed` is true. The record stays, so the
  History, tasks, comments and messages keep the name (`cardOf` still finds it), and the email stays reserved (`assertEmailFree`).
  `users.list` (also with `includeInactive`) leaves removed users out, `detailOf` leaves them out of a project team, and `users.update` and
  `users.reactivate` refuse them (reason `removed`). `users.get` still gives the record.
- The rules: `people.remove`, `assertMayTouch` (Management never removes an Admin or the agent of an Admin), never yourself, and only a
  person who is off (reason `still_active`). The agents of a removed person go with them, turned off first. A second call is harmless
  and writes no second event. Event verb `user.removed`. No screen brings a removed person back, so the sheet asks first and has no Undo.
- MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.admin`, right `people.remove`): the docs tell the agent to ask first. The sweep (`everyCall.ts`) runs it after `users.deactivate`, because it is a remover.

## Facts of a row for the list screens (feedback, 2026-10-11)
- `ProjectSummary.stageEnd { date, daysLeft }` is the end date of the current stage (`stageTagOf`, the same stage that the Late tag
  reads) of an active project. It is null with no end date or with a project that is not active. A row shows it as "Stage ends"
  while `nextDeadline` (a named deadline) is null. The sort `deadline` of `projects.list` uses `nextDeadline`, then `stageEnd`.
  The field is optional, so older answers still parse. MCP: `TOOL_DOCS` of `projects.get` and `projects.list` name it.
- `TaskRow.canEditPeople` is `mayAssignTask`, the rule of `viewerCan.editAll` in the task panel (the leader, the maker of
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
  person, for the person: an agent gets `forbidden`, and all three stay on the MCP deny list. They write NO event and NO History
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
  an agent gets `forbidden`, and no call takes the id of another person. All four stay on the MCP deny list: none can work for an agent (MCP parity, owner 2026-10-26).
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
    only when the link moves the pin. Without it, the text is cleared. Both calls are MCP tools since the MCP parity track (owner, 2026-10-26; `TOOL_DOCS` of `projects.addLink` names `location`).
  - `search.query` does not read `location`.
  - MCP: `TOOL_DOCS` of `projects.update` (600 characters, at the limit) and `projects.get`, and the `Place:` line of `INSTRUCTIONS`.

## Office rights and roles (owner, 2026-10-18, fbk_014; role rights version 2, 2026-10-21)
- The rights are 120 switches in 13 sections (`OfficeRight`, `contract/entities.ts`; 91 powers; "Mention everyone" joined the Chat section on 2026-10-22; the four hidden-project rights joined the Projects section on 2026-10-22; the AI switch `ai.projectSetup` joined the AI section on 2026-10-25; the AI switches `ai.admin`, "AI does Admin work" (off for every built-in role), and `ai.myState`, "AI changes my own marks and settings" (on for every built-in role), joined it on 2026-10-26 with the MCP parity track; `MAX_STORED_RIGHTS` is 126). The one source is the catalog JSON in
  `docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json`; `rightsCatalog.ts` is its plain copy (no zod), and
  `rightsCatalog.test.ts` checks that the two agree. The Admin holds all of them. A switch id is `<power>.<scope>` for a power with
  scopes (`lead`, `team`, `all`, `office`, `none`), or the power name for a power with one switch. `BASIC_ON` is the 67 switches a Member holds.
- A power with scopes asks `scopeAllows` (`permissions.ts`): hold `<power>.all`, or `<power>.lead` and lead the project, or
  `<power>.team` and be on the team (the leader counts as on the team). An "own" power keeps the people rule (maker, lead, author,
  organizer) and needs its switch. `project.code` passes only where `project.details` passes. The Admin holds every `.all`.
- Storage (additive, no migration): `RoleSettings.rights[role]` and `CustomRole.rights` are the held switches beyond `BASIC_ON`, and may
  still hold the 17 old ids (`StoredRight`; `expandRights` maps them with the `legacy` map). New `RoleSettings.off[role]` and
  `CustomRole.off` list the `BASIC_ON` switches the role does not hold. `rightsOf` (`rights.ts`): a built-in role = (`BASIC_ON` minus
  `off`) plus the expanded `rights` (or `DEFAULT_EXTRA`), minus each switch whose need on another power is off (`dropUnmetNeeds`, fail
  closed: `ai.connect` off turns every AI switch off; the sheet turns needs on with `withNeeds`); a custom role with no `off` = the Member switches
  plus its own (the meaning of before); with `off` = its own full list; a deleted role leaves the Member switches. `heldRightsOfRole` gives
  the list to the screens. `session.get` and every output give the 120 ids only. A save writes new ids only (`roles.*` expand old ids).
  Caps: `rights` 120, `off` 70.
- The actions of `can()` are the power names. The stand-ins of the first release are gone (`project.edit`, `project.changeLeader`,
  `project.healthOverride`, `project.editCode`, `content.post`, `content.editOwn`, `task.createForSelf`, `task.createForAnyone`,
  `task.updateOwn`, `task.updateAny`, `task.contribute`, `task.delete`, `meeting.create`, `meeting.edit`, `meeting.minutes`,
  `event.undoAgent`, and the 10 old office rights as actions): every call site asks the action of its own power. What stays is the old
  name that is also the name of a power (`project.create`, `project.archive`, `project.delete`, `task.take`, `task.help`, `task.review`,
  `chat.project`, `report.office`, `subCompanies.manage`, `templates.updateProjects`, `feedback.manage`, `gaps.view`) and `admin.manage`
  (the Roles section and the role events). With the default settings the answers equal the answers of before
  (`server/core/rightsParity.test.ts` proves it against a record made on the code before this release). A stored list may still hold an
  old id (`LEGACY_RIGHTS` of `rightsCatalog.ts`); that is a stored right, never an action. The pure power actions are in
  `rightSwitches.test.ts`, one group of tests for each of the 120 switches. A to-do rule that combines the own power and `task.any` lives
  in `taskGates.ts` (`mayChangeTask`, `mayAssignTask`, `mayDeleteTask`, `mayTickChecklist`).
- A right gives only its own power. Before a right passes an action, grep every use of that action and check what it stands in for.
- A check of an office right reads the person with the rights attached. A handler gets them in `ctx.authority` (`execute.ts`); the
  `ctx.actor` of an agent carries the rights of its person. A loader (`Load.authority`) and a server call use `withRights(state, user)`.
  A place that asks `can()` for another person of the office uses `ensureRights(state, user)` first (`canSeeConversation`, `attach.ts`,
  `server/files/rights.ts`).
- `can()` fails closed: a person other than the Admin, with no `officeRights` attached, holds no office right. A path that forgets
  `withRights` then denies. A test that calls `can()` for a Member needs `withOfficeRights`.
- Only the Admin changes a role: `systemRole` or `roleId`. The reason is `admin_only`. A save with the same value is no change.
- The Undo asks the right of its own act (`handlers/history.ts`, `assertMayUndo`): the Undo of a new to-do asks `task.add`, the Undo of
  a delete asks the delete switch. Role events keep `admin.manage`; a `settings.updated` event asks `office.settings`. An agent never takes
  back a role change, also the agent of an Admin (`rolesLeaks.test.ts`). `roles.*`, `users.create` and `users.update` are MCP tools since the MCP parity track (owner, 2026-10-26; `ai.admin`), and an agent still cannot undo them.
- The Undo of a CREATE event (a to-do, a file or a version, a post, a comment, a Tracker entry, a meeting) uses the create right only when the
  event is the change of the caller (`isOwnChange`: `actingForId` is the caller, also through the caller's own agent). An item that another
  person's agent made, which the leader takes back through `ai.undoOthers`, needs the right that deletes the item: `task.any` or `task.deleteOwn`,
  `file.deleteAny` or `file.deleteOwn`, `tracker.deleteAny` or `tracker.deleteOwn`, `meeting.any` or `meeting.editOwn`; a post or a comment stays with its
  author (`post.editOwn`). `assertUndoRight` asks `ai.undoOthers` on a project, and the place of the maker (`isTaskMaker`) on an office task.
  Tests: `handlers/rr2Undo.test.ts`.
- The chat send check is in `postMessage` (`handlers/chats.ts`, `assertMayWriteIn`), the one door of `chats.send` and `files.share`: a project chat asks
  `chat.project`, a direct chat or a group asks `chat.direct`. An edit, a delete, a reaction and a file (`chatForUpload`) of a direct chat or a group ask
  `chat.direct` too. `chats.openDirect` asks `chat.direct`, `chats.createGroup` asks `chat.groupCreate`, a rename or an add of `chats.updateGroup` asks
  `chat.groupChange`. Reading, the read marks, archive, Notify me and leaving stay free. A holder of `chat.project.all` outside the team opens every
  project chat, and the Inbox counts it as it counts the Admin's other chats: only the messages that name the person (`countsNamedOnly`), unless the
  person picks All messages. The push of such a chat goes to the person only when a message names the person (`planPushes`).
- `ProjectSummary.viewerCan.post` and `.edit` are the old flags of the first release, kept in the contract. `post` is true only when the person
  posts, comments, adds links, uploads, delivers and logs here (all six switches), `edit` only when all six project powers hold. No screen
  reads them for a split power any more: the screens read the single flags (`postUpdate`, `comment`, `links`, `upload`, `deliver`,
  `logTracker`, `editDetails`, `editTeam`, `editStages`, `editDeadlines`, `applyTemplate`). A control that has no project or to-do reads the
  rights of the session (`useRight` and `useCan` in `app/useRight.tsx`, which call `can()` with `session.get -> authority`).
- `admin.manage` reads only the Admin role, so it needs no office right.
- `roles.create`, `roles.update` and `roles.delete` (`handlers/roles.ts`) need `admin.manage`. Each change writes one settings event:
  `role.created`, `role.updated` or `role.deleted`; the event keeps `rights` and `off` (an `off: null` on the old side says the role had
  none). Its target is the role id, or `management`, `accounting` or `member`. `undoRoleChange` takes these back; an Undo of an old
  event expands its old ids. MCP: tools since the MCP parity track (owner, 2026-10-26; `ai.admin`, `admin.manage`).
- `roles.delete` takes `moveTo` (ADM-14): a built-in role (not Admin) or another custom role. The people of the deleted role move to it
  (`user.updated` events) before the role goes, all in one story. Without `moveTo`, a role that people hold is still refused (`role_in_use`).
- The gates of the office calls (track gates-office). Projects: `projects.update` asks `project.details` (the code field also `project.code`;
  the map pin of a link also `project.details`), `members.*` and `ensureOnTeam` ask `project.team`, `stages.*` ask `project.stages`,
  `deadlines.*` ask `project.deadlines`, the template calls ask `project.template`, `setLeader` asks `project.leader`, the health override
  asks `project.health`, the links ask `project.links`, the delete asks `project.delete`. People: `users.create` and `users.resendInvite`
  ask `people.invite`, `users.update` asks `people.change`, `teams.*` ask `people.teams`, deactivate and reactivate ask `people.turnOff`,
  `users.remove` asks `people.remove`, and `users.invites` passes for any of the five. `clients.create` asks `client.create`,
  `clients.update` asks `clients.change`. Money: `payments.list` asks `payment.view`, create `payment.add`, update and delete
  `payment.change`, `markReceived` `payment.receive`; the money of `dashboard.get` and `reports.office` asks `payment.view`.
  Templates: a new project or stage template asks `templates.projectCreate`; the change of another person's one asks `templates.projectAny`
  (the saver always changes their own); a to-do template saved from a to-do asks `templates.taskSave` on the project of the to-do, by hand it
  asks `templates.taskSave.all`, or `.lead` for a person who leads a project; another person's to-do template asks `templates.taskAny`.
  `dashboard.get` asks `dashboard.view`; without `workload.view` its `workload` has `rows: []` and `unassigned: null`. `search.query` asks
  `search.use`, and an agent whose person lacks `ai.readChats` gets no message hits. `settings.update` asks `office.settings`.
  `feedback.send` and `feedback.uploadStart` ask `feedback.send`. The loaders (`overview.ts`, `report.ts`) mirror the Dashboard, Search and
  money gates. `rr2Office.test.ts` tests each gate: on, off, scope, and the agent of a person without the switch.
- `viewerCan` (`contract/views.ts`) has one optional flag for each new gate of a project (`editDetails`, `editTeam`, `editStages`,
  `editDeadlines`, `applyTemplate`, `links`, `upload`, `deliver`, `logTracker`, `postUpdate`, `comment`, `addTask`, `planMeeting`,
  `deleteAnyFile`, `deleteAnyTracker`, `projectChat`, `changeAnyTask`) and of a to-do (`editDetails`, `editDates`, `work`, `comment`, `upload`).

## The office report (owner, 2026-10-18, fbk_016)
- `reports.office { period, start? }` (`handlers/reports.ts`): a week (Sunday to Saturday), a month, a quarter or a year. `periodRange`
  (`reportPeriod.ts`) picks the period that holds `start`; with no start it gives the last full period before today.
- The right is `report.office` (assertCan). Money needs `payment.view` (null otherwise); gaps need `gaps.view` (null otherwise).
- The stage moves, completions and pauses come from `state.counts` (`REPORT_KEYS`, the loader counts them in SQL). The reviews come from
  the review events that the loader reads once (`state.events`). The handler counts them for each person by `actingForId`. Without
  `state.counts` it counts `state.events` for the other three too (the prototype). Both give the same numbers (`loaders.test.ts`).
- Past due (the tasks and the money) counts to today while the period has not ended (`dueEnd`, owner 2026-10-21): on a Wednesday, a
  to-do due on Thursday is not past due yet. A period that has ended counts to its last day, as before.
- Office tasks stay out of the report. The MCP tool is `reports.office`, on the right list `MCP_BY_RIGHT` (`server/mcp/tools.ts`): an agent
  gets it only when its person holds `report.office`.
- The answer carries `design`: the design guide `REPORT_DESIGN` (`reportDesign.ts`). Its colors and sizes copy `tokens.css`, and
  `reportDesign.test.ts` checks them. The guide is the same for every person who may ask.
- A range (owner, 2026-10-21): `period: 'range'` with `from` and `to`, both days included, at most `REPORT_RANGE_MAX_DAYS` (400). The
  input refuses each wrong mix by its field: a range with `start`, a named period with `from` or `to`, `to` before `from`. `reportRange`
  (`reportPeriod.ts`) gives the days to the handler and the loader alike.
- `trend` (owner, 2026-10-21): the to-dos made and done in each of the 6 weeks (Sunday to Saturday, `trendWeeks`) up to the week that holds
  the last day. It reads the tasks that the loader already loads, so it needs no SQL.
- `guide: true` adds `guide`: `REPORT_GUIDE` (`reportGuide.ts`), the steps, pages, numbers rules, design and checks of the Madar report. It
  started as the owner's Claude skill "madar-office-report". Only on request, because it is about 17,000 characters. A change of a tool name,
  a field or a color that the guide names fails `server/mcp/reportGuide.test.ts`. `design.colors` holds the status colors too (`onTrack`,
  `atRisk`, `late`, `muted`).

## The restart reminder of a pause (owner, 2026-10-19, fbk_025)
- The restart date of a pause (`pause.resumeOn`) is a reminder. Madar never restarts a project by itself: a person resumes it.
- `runScheduledTriggers` (`notify.ts`) sends `resume_due` on the planned day, or in the first run after it. It goes to the leader
  (`leaderOrAdmins`: the Admins when the leader is off; a leader who lacks the review switch still gets it) and to the person who paused (`principalOf(pause.by)`), once for each person and each
  date, because the dedupe key holds the day. The notice keeps the planned day in `dueDate`. `notifications.list` gives it, and for a notice
  made before it holds the day it made. The screen says "is today" on that day and "was <day>" after it (`inbox.trigger.resume_due`
  and `resume_due_past`).
- `projects.setRestart { id, resumeOn }` changes only the date of a paused project. The date must be after today. It needs `project.archive`,
  as Pause and Resume do. The reason, the kind, the person and the day of the pause stay. It writes the event verb `project.restart_moved`
  and asks no reason, because the date of a reminder is no plan date. A new date gives a new notice. MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.projects`).

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
- The three calls name only the kinds `messages` and `notifications` (the reaction only `messages`). In a direct chat or a group their signal goes
  to the members only, as a person signal (owner, 2026-10-21; it replaces the nameless office signal of INT-16).
  MCP: edit, delete and the reaction are tools since the MCP parity track (owner, 2026-10-26; `ai.messages`, `ai.posts`).

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
- Rights (`permissions.ts`): `meeting.view`, `meeting.plan`, `meeting.editOwn`, `meeting.any`, `meeting.minutesOwn`, `meeting.minutesAny`, with `meetingResource`
  and `mayViewMeeting`. A project meeting is read by everyone, planned with `meeting.plan` (the team, or every project), and changed or cancelled by its organizer
  (`meeting.editOwn`) or by the leader or every project (`meeting.any`). A meeting with no project is planned with `meeting.plan.none`. A meeting with no project is read by its organizer and its attendees only, and changed by its organizer only. The Admin has no
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
  last meeting and may change it (`meeting.editOwn` for the organizer, `meeting.any` for the leader or every project; review 2026-10-20), else `not_found` or `forbidden`. `seriesToExtend(state, at)` is the rule of the job read for the
  prototype timer.
- Reasons added: `until_before_start`, `until_too_far`, `series_day_one_only`.
- Delete (owner, 2026-10-23; `meetings.delete { id, scope? } -> { deleted }`, handlers/meetings.ts): only a cancelled meeting (else `conflict` `meeting_not_cancelled`), by the right
  `meeting.editOwn` or `meeting.any` (the organizer, the leader and the Admin of a project meeting; the organizer of a meeting with no project); a hidden meeting answers `not_found`. It writes
  `meeting.deleted` with the whole record in `before` (`recordDelete`; a meeting with no project carries `officeMeetingId`), so the Undo of the toast (`events.undoStory`) brings it
  back (`rev` grows once more). Scope "later" deletes this meeting and every later CANCELLED meeting of the series that the person sees, never a scheduled one; the later events
  name the first as their cause, all in one story. A delete changes NO repeat rule (the cancel did that). It sends no notice; a notice of the meeting then reads as gone
  (`inbox.meetingGone`). `seesEvent` (history.ts) reads the last copy of a deleted meeting for an Undo (`lastMeetingCopy`), so the people of a meeting with no project take the delete
  back, and nobody else does (`not_found`). `MeetingDetail.viewerCan.delete` is true for a cancelled meeting that the person may change. The call is in `GCAL_CALLS` (a cancel whose
  sync never ran leaves a Google event row; the delete sends a sync row for it). MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.meetings`): the agent asks its person first. Tests: `meetingDelete.test.ts`.
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
  meeting then keeps `trackerEntryId`, which `REFERENCE_FIELDS` leaves out on purpose, so the delete is not refused. MCP: `meetings.settle` stays on the deny list.
  The author of the line (`createdBy`) is always the organizer, whoever settles (the job, the first minutes save, or any person who sees the
  meeting); the events name the caller as the actor (security fix, 2026-10-19). `mayDeleteTracker` (`views.ts`) gives a line with `auto: 'meeting'`
  no author delete: only the project leader or the Admin deletes it, and so only they undo its `tracker.logged` (`history.ts` uses the same rule).
  The screens read `canDelete` of the row, so the Delete button follows. Tests: `meetingSettle.test.ts` ("the author and the delete of the line").
- Files of a meeting with no project (wave 2, owner 2026-10-19; the pattern of the chat files): `files.upload` and `files.uploadStart` take `meetingId`
  in place of a project, an office task or a chat. `FileRec.meetingId` (optional) names the meeting; `projectId`, `stageId` and `taskId` are null. Only a
  meeting with no project takes one: a project meeting, also a team meeting, uses the files of its project, and an upload with its id fails with
  `invalid_input`, reason `file_meeting` (so does a `meetingId` next to a project, a chat, a stage, a task, a cover or a client mark). Who uploads:
  `minutesRefusal(state, meeting, viewer, at)` (`handlers/meetings.ts`) must be null. In this order: `not_found` Meeting (the viewer does not see it; the
  text of an unknown id), `conflict` `meeting_cancelled`, `conflict` `minutes_not_yet` (before `endsAt`), `forbidden` (no `meeting.minutesOwn` for the
  organizer and the attendees, and no `meeting.minutesAny` for the leader or every project), and `conflict` `minutes_line_gone` (a Tracker line meeting whose
  settled line is gone). `mayViewFile` is `mayViewMeeting` of the meeting: the people who see it, the Admin only when invited, and nobody once the
  meeting is gone. `mayOpenFile` keeps an agent from opening one (`files.get`, the `files.link` fake). The upload writes no event (`uploadMeetingFile`).
  `assertFilesForMeeting` (`attach.ts`) takes only a file of the meeting itself, and reads any other file as `file_missing`. Every other carrier (a task
  comment, a project chat or a direct chat, the Tracker, `files.share`) refuses a meeting file with reason `file_meeting` (a post gives its plain
  refusal for any file that is not a file of its project). `files.delete` and `files.markDelivered` refuse it too, and `mayDeleteFile` is false.
  `search.query` finds no meeting file, and `files.list` never lists one. The leak tests: `handlers/meetingFiles.test.ts`, `server/calls/meetingFiles.test.ts`.
- The minutes (wave 2, owner 2026-10-19; `meetings.saveMinutes { id, text, fileIds, since? }` in `handlers/meetings.ts`): any attendee of a meeting that
  ended writes them, as one text of at most 10,000 letters (`MEETING_LIMITS.minutesMax`) with files (`MAX_ATTACHMENTS`), replaced as a whole. The right is
  `meeting.minutesOwn` (the organizer and the attendees) or `meeting.minutesAny` (`permissions.ts`; for a project meeting the leader and the Admin too, because the minutes join the project
  record that the leader answers for); a team member who did not attend only reads them. For a meeting with no project the Admin writes only when invited.
  `minutesRefusal` checks the phase and the right (see the files above). Where they live (`minutesOf`): a project meeting that is not a team meeting
  (`hasTrackerLine`) keeps them on its Tracker line (`TrackerEntry.minutes`, event verb `tracker.minutes_saved`); a team meeting and a meeting with no project
  keep them on the meeting (`Meeting.minutes`, verb `meeting.minutes_saved`; `officeMeetingId` for a meeting with no project). Both verbs are feed verbs
  (`FEED_VERBS`), `meeting.settled` is not. A meeting that has a Tracker line and no mark is settled in the same call, so the person never waits for the
  job; the mark and the line then get a story of their own (`cor_settle_<meeting>`), so the Undo toast of the save (`events.undoStory`) takes back the
  minutes only and never meets the mark that has no Undo. `files` of a project meeting are files of its project (`assertFilesInProject`); a meeting with no
  project takes only its own files (`assertFilesForMeeting`). `since` is the `updatedAt` that the screen opened (null for no minutes yet): another value gives
  `conflict`, reason `minutes_changed`, so a late save never replaces what another attendee wrote. An empty text with no files writes `minutes: null`. The
  same text and files write nothing. No notice, no push, no badge and no task. The Undo of either verb needs the same minutes right on its meeting
  (`assertMayUndo`, `handlers/history.ts`), and the change stays the person's own (`assertUndoRight`). `MeetingDetail` gives `minutes`, `minutesPlace` and
  `viewerCan.minutes`; `TrackerRow` of an auto meeting line gives `meeting`, `minutes` and `canEditMinutes` (other rows leave the three out).
  `tracker.log` and `tracker.update` never take `minutes` or `meetingId`: zod strips the keys. MCP: `meetings.saveMinutes` is on the allow list, not additive.
- The person for the minutes is gone (owner, 2026-10-19). `Meeting.minutesById` is optional and nothing writes or reads it. The inputs of
  `meetings.create` and `meetings.update` lost `minutesById`: zod strips the key, so an old tab or an old agent still works. `MeetingDetail.minutesBy`
  and `minutesTask` stay in the shape, always null. A stored row with `minutesById` still parses. No migration and no backfill.
- The sample office (`data/sampleMeetings.ts`, only the prototype and `sampleOffice`, as the sample sub-companies): one client meeting of an open
  project and one meeting with no project for the Admin and a leader. The prototype day shift moves `startsAt` and `endsAt` (`PLANNED_FIELDS`,
  `data/shift.ts`) and never pulls them back before now.

## Hidden projects (owner, 2026-10-22)
Design: `docs/superpowers/specs/2026-10-22-madar-hidden-internal-projects-design.md`. Wave D1 builds the core.
- Four rights joined the catalog (117 switches and 88 powers then; 118 and 89 since 2026-10-25, 120 and 91 since 2026-10-26): `project.seeAll` (See every project) and `project.access.lead` (Choose who sees a
  project, Projects I lead) are basic and on for every role. `project.access.all` and `project.hidden` (See hidden projects) are for the
  Admin only. The Admin always holds every switch (`heldSet`), so an Admin without `project.hidden` cannot exist. Management can get it.
- `Project.access` is `{ hidden, viewerIds }`, optional, at most `MAX_PROJECT_VIEWERS` (50). Missing means open with no chosen people.
  No migration and no `STATE_VERSION` step.
- One rule: `mayViewProject(state, project, viewer)` = `can(viewer, 'project.view', projectResource(state, projectId, viewerId))`. True for a
  holder of `project.hidden`, the leader, a team member, a chosen person, and a holder of `project.seeAll` when the project is open.
  `project.view`, `task.view` and `comment.read` of a project resource, and `meeting.view` of a project meeting, all read it. A resource
  with no project facts (`can(actor, 'comment.read')`) is the plain question "may this person read" and answers true. A person who left the
  office never sees a hidden project. `projectResource` carries `projectRole` and `access`; `taskResource` and `meetingResource` use it.
- The rule fails closed. `can()` reads `project.view`, `task.view`, `comment.read` and a project `meeting.view` from the facts of
  `projectResource`. A resource with no `access` facts, or with no project at all, denies everyone except a holder of `project.hidden`,
  the leader and the team (those two by role). Never write `{ projectRole }` alone for a view check: build the resource with
  `projectResource`. A check that only asks "is this person active" tests `actor.active`, not `comment.read`.
- `projects.setAccess { id, hidden, viewerIds }` (needs `project.access` with its scope on the project): writes the event
  `project.access_changed` (before and after of `access`, Undo asks `project.access`), keeps the chosen people also while the project is
  open, sends `added_to_project` to a new chosen person who is not on the team, and writes nothing when the value is the same. A new
  person must be active and human (reasons `person_inactive`, `viewer_agent`). MCP: a tool since the MCP parity track (owner, 2026-10-26; `ai.projects`). `WRITE_KINDS`: `events`, `projects`.
- The doors (wave D1): `requireProject` (`handlers/shared.ts`) answers `not_found Project <id>` for a project the person does not see, before
  any `assertCan`. `seesProject(ctx, id)` is the same test for a child record. A record that sits in a project answers as an unknown record
  of its own kind: `requireDeadline`, the stage of `stages.setDates` and `stages.setPrerequisites`, the stage of `tasks.createFromTemplate`
  (before `template_other_stage`), `requireUpdate`, `requireComment`, `targetOf`, `requireEntry`, `requirePayment`, `mayViewFile`
  (`not_found File`, never `forbidden`, also on the server in `server/files/rights.ts` and `server/calls/files.ts`), `requireTask`
  (through `mayViewTask`), `requireMeeting` (through `mayViewMeeting`), `seesEvent`, and `canSeeConversation` (a project chat needs the view
  too). The template calls (`matchPlan`, `link`, `syncApply`) read the project with `requireProject` before `assertMayApply`.
  `subCompanies.delete` counts only the projects the person sees in `sub_company_in_use`, and a person who sees none of them while a
  hidden one names the sub-company gets `forbidden` (action `project.hidden`): only a holder of `project.hidden` deletes then. A move with
  `moveToId` still moves every project.
- `notify` skips a person who does not see the project of the target (`projectOfTarget`, `targetProject.ts`). A meeting of a project needs
  attendees who see the project (reason `not_in_project_audience`). `seesEvent` hides the events of a deleted project that was hidden
  from everyone but a holder of `project.hidden` (`lastProjectCopy`, `events.ts`); an open deleted project keeps the old rule. A state that
  holds no delete event reads such a project as open, so a loader must bring the delete event (wave D2).
- `code_taken` leaves out the key of a project the person does not see (the server still checks every project), and `sameContractAs` of
  such a project reads as an unknown project.
- Leak tests: `handlers/hiddenProjectLeaks.test.ts` (every door, with a person, an agent, a role without `project.seeAll`, Management with and
  without `project.hidden`), `handlers/subCompaniesHidden.test.ts`, `server/mcp/hiddenProjectTools.test.ts`, `server/calls/hiddenProjectFiles.test.ts`;
  the loader sweep reads and writes the hidden project `prj_005` of `trapOffice` (`HIDDEN_PROJECT` in `server/data/loaders/sweep.ts`).
- `mayViewProject`, `mayViewTask` and `mayViewMeeting` attach the office rights (`ensureRights`). A bare `can()` on a raw user holds no
  `project.seeAll` (it fails closed), so a test that asks `can()` for a Member needs `withRights`.
- The lists (wave D2). `src/api/projectView.ts` holds the view rule for lists: `projectViewer(state, viewer)` gives one test for many
  projects (rights attached once), `visibleProjectIds`, `hiddenProjectIds`, and `eventProjectViewer` for changes. `peopleFilter` and
  `teamFilter` (`pause.ts`) take the viewer as their last parameter and never pass a project the viewer does not see, so
  `projects.list`, `tasks.list`, `deadlines.list` and every number of `dashboard.get` (tiles, charts, schedule, workload rows, the No
  lead row, money, `waitingForUs`, `attention.stale`) count only the visible projects. A count of another person's work counts only
  the to-dos of the visible projects (the rule of office to-dos). A new list or count over projects must call one of them first.
  `search.query` (projects, project tasks, project files, the sub-company counts), `reports.office` (rows, totals, people, money,
  the office stage-move count), `subCompanies.list` `projectCount`, `projectTemplates.list` `followers`, `projectTemplates.usage`
  and the leader hint of `session.get` follow the same test. `canSeeConversation` also asks the view of the project for a project
  chat, and `taskThreads` drops a thread of a project task that the person does not see (so `chats.list`, `chats.unreadCount` and
  `chats.waiting` never count it). `events.list` drops the changes of a project that the person does not see. The changes of a deleted
  project that was hidden (the `before` of its `project.deleted` event holds `access`) show only to a holder of `project.hidden`.
- Wave D3, the signals and the outside (owner, 2026-10-22):
  - Realtime: a project that someone may not view tells only its people (`server/CLAUDE.md`, `data/projectAudience.ts`). A notice whose item
    belongs to a project the person does not view reads as gone: no words, no names, no link, no badge (`noticeProjectHidden`). An Undo
    keeps such a notice.
  - The push, the morning summary and Google Calendar skip a person who does not view the project (`server/push/CLAUDE.md`,
    `server/mail/CLAUDE.md`, `server/google/`). `settleActorOf` and `extendActorOf` fall back to an Admin.
- Internal projects (fbk_044, wave D4). `Project.kind` is `'client' | 'internal'`, optional; a missing value is a client project, and a
  client project stores no `kind`. The kind is set by `projects.create { kind: 'internal' }` and never changes (no call takes it).
  Helpers: `src/api/internalProject.ts` (`isInternal`, `isInternalId`, `internalRefusal`, `assertNotInternal`), `INTERNAL_PREFIX` and
  `isInternalCode` in `src/lib/projectCode.ts`.
  - Create: `clientId`, `geo`, `areaM2`, `subCompanyId`, `contractStartDate`, `location`, and a typed `code`, `codeParts` or `sameContractAs`
    are refused with the reason `internal_project` on that field. `subCompanyOfNew` is skipped, so an office with sub-companies asks for
    none. The code is the old automatic form with the head `INT` (`INT-26-001`, `nextProjectCode`); its series counts only `INT-YY-` codes,
    so it never takes a series of a client code, and `nextSeries` and `contractClash` read no INT code (an INT code has no contract part).
    `access` starts `{ hidden: true, viewerIds: [] }`.
  - Update: a value in one of those fields, or a `code` correction, is refused with `internal_project`; an empty value passes (the edit
    form sends them empty). `projects.pause` with kind `client` is refused (it writes a Tracker line).
  - No payments, no Tracker: `payments.create` and `tracker.log` call `assertNotInternal` (a person who does not see the project gets
    `not_found` first). `addTrackerEntry` is the one door: it throws `internal_project` for an internal project, so a file received, a file
    delivered and a move back logged stop there. The automatic lines skip it before the door: the shift line (`shiftDependents`), the
    new-version line (`tasks.newVersion`), the Balady tick (`stageBackError` gives `canLog` false) and the meeting line (`hasLine` in
    `handlers/meetings.ts`: an internal project meeting settles with the mark only and keeps its minutes on the meeting, `minutesPlace: 'meeting'`).
  - `viewerCan` (additive): `access` (`project.access` with its scope), and for an internal project `payments`, `logTracker`, `deliver`
    and `editCode` are false. The screens read these flags, so they show no Tracker control and no payments part.
  - The numbers: it counts in the workload, the to-do lists, Home, deadlines and the schedule. It stays out of the gaps `noArea` and
    `noSubCompany` (dashboard and report), `tiles.inDesignWithoutArea`, the `no_area` and `no_sub_company` filters of `projects.list`, the
    money (`moneyOf` of the dashboard and the report) and the Tracker counts of the report. It stays in `stage_no_end`, the project rows
    and `totals.projects` of the report. The code `INT-...` shows on no screen: the word "Internal" takes its place (`shownKey`,
    `shownCode` in `src/lib/projectLabel.ts`).
  - `Settings.codePrefix` may not be `INT` (reason `code_prefix_taken`).
  - The event `project.access_changed` is in `FEED_VERBS`: the project activity says "changed who sees this project".
  - The sample office adds one internal project, "Portfolio 2026" (`src/data/sampleInternalProject.ts`; `buildSeed` does not).

## A new call: the checklist
1. `defineCall` in its handler file, with tests.
2. If it is server-only: its contract in `contract/server.ts`, its fake in `handlers/serverFakes.ts`, its server body in
   `server/calls/`. There are 14 server-only calls (`usage.get` and `usage.retryEffect` were removed, 2026-10-23); `live.ticket` (exit wave 3) is the 9th, and the four `google.*` calls (fbk_022) follow it; `chats.typing` (chat presence design) is the 14th.
3. A loader entry in `server/data/loaders/` (a test fails without it).
4. The MCP allow list, right list (`MCP_BY_RIGHT`, only an agent whose person holds the right sees it; `MCP_ADMIN` is empty) or deny list in `server/mcp/tools.ts`
   (a test fails without it). An allowed or right tool needs `TOOL_DOCS` and one AI switch: add its name to the `mcpTools` list of that
   switch in the catalog (`docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json` and `src/api/rightsCatalog.ts`;
   `server/mcp/aiSwitches.test.ts` fails without it). It also needs a sample: add a call to
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
- A small list that belongs to one record can live in that record's `doc`, as the links and the folders of a project do (no table, no migration, no loader).
- The prototype store needs a new `STATE_VERSION` and a step in `src/data/migrate.ts`.

## Folders of the Files & Links tab (owner, 2026-10-26, fbk_066)
- `Project.folders` (optional, up to `MAX_FOLDERS` 100): `ProjectFolder` = id (`fld_`), `stageId` (a real stage of the project), `name` (trimmed, 1 to
  `FOLDER_NAME_MAX` 60 letters), `createdBy`, `createdAt`. Choice: the folders live in the project record, as its links do, and not in a table of their own.
  So a folder is seen by exactly the people who see the project and its files (the hidden-project doors guard it with no new rule), the office cache and the
  loaders need nothing new, and no migration or `STATE_VERSION` step is needed. The record has no `projectId`: the project that holds it is the project. A list
  row leaves the folders out (`withoutBase` in `views.ts`); `ProjectDetail.folders` carries them (default `[]`). `FileRec.folderId` (null or missing: the root
  of its stage) is optional, so older files load; a file in a folder has the stage of the folder.
- Calls (`handlers/folders.ts`, `files.ts`): `folders.create { projectId, stageId, name }`, `folders.rename { id, name }`, `folders.delete { id }` and
  `files.move { id, stageId | null, folderId | null }`; `files.upload` takes `folderId` (the file takes the stage of the folder; another `stageId` is refused).
  Rights: `file.upload` of the project for all four (no new switch). A hidden project reads as missing (`requireProject`, `requireFolder`: `not_found Folder`).
  Refusals (reasons): `folder_name_taken` (a name repeats inside one stage, with no difference of capital letters; it may repeat across stages),
  `folder_limit`, `folder_other_stage` (a folder with another stage, or with "No stage"), `folder_missing`. A file of a chat, a meeting or an office task
  cannot move. A move to the place where the file sits writes nothing. Organizing is no news: no folder call and no move touches the project, so the "last update" order of the
  projects stays (a move signals the kinds `events` and `files`; a folder change `events` and `projects`).
- Events: a folder change is a `project.folders_changed` event on the project (before and after hold the whole `folders` list; Undo asks `file.upload`), a move
  is a `file.moved` event (stage and folder together). `folders.delete` writes the `file.moved` events of its files first and the folder event last, so one
  `events.undoStory` brings the folder back before it puts the files in it. Undo of a `file.moved` into a folder needs the folder to stand (`assertReferencesExist`),
  and the Undo of a folder change sends the files of a folder that is gone back to the root (`releaseFilesOfGoneFolders`). Neither event is in `FEED_VERBS`.
- A removed stage (`stages.replace`): its files go to "No stage" as before, the files in its folders too (`folderId` cleared), and its folders go with it
  (silently, as the files do; `project.stages_changed` has no Undo).
- MCP: the four calls are on the allow list (`ai.projects`); `projects.get` lists the folders and `files.list` gives `folderId` (`server/mcp/CLAUDE.md`).
  Leak tests: `handlers/folderLeaks.test.ts`, `server/data/folderSignals.test.ts` (Realtime), `server/mcp/folderTools.test.ts`.

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
- `test:db` refuses a test that edits the state by hand and breaks a foreign key ("db mode: the test's own edits break a database rule"):
  a deleted project takes its members, stages, deadlines, tasks, updates, files, conversations, tracker and payments rows. A long leak
  sweep needs its own timeout there (about 11 ms a call).

## Quiet hours and @everyone (owner, 2026-10-22, fbk_048 and fbk_041)
- Contract (all additive): `Preferences.workHours` (`{ quiet, days, from, to }`; days 0 = Sunday to 6, at least one, `from` before `to` on a
  30-minute step) and `Settings.workHours` (`{ days, from, to, lock: { on, days, from, to } }`). A missing value means Sunday to Thursday, 8 AM to
  5 PM, the lock on with the same days and hours, and quiet hours on (`DEFAULT_OFFICE_WORK_HOURS`, `src/lib/quietHours.ts`: the one pure rule
  `isQuiet`, `workHoursOf`, `workStartOn`, `coversLock`). `Notification.everyone`, `Comment.mentions`, `PushDevice.heldAt`, `ChatThread.everyone` and
  `TaskDetail.everyone` are optional.
- `me.updatePreferences` takes `workHours`: only the person (an agent gets `forbidden`, action `me.workHours`), and a range with quiet on must
  hold the lock (`work_hours_lock`). `settings.update` takes `workHours` (`office.settings`): the default range must hold the lock
  (`work_hours_default_lock`). A stored range that no longer holds a moved lock is not changed; `isQuiet` adds the lock at read time. An agent
  may not undo a change of the work hours (`changesEmail` in `history.ts`). Both calls stay on the MCP deny list.
- @everyone: `mentionsEveryone(body)` (`lib/text.ts`: `@everyone`, `@all`, `@الجميع` as a whole word) and `handlers/everyone.ts` (`everyoneOfChat`,
  `everyoneOfTask`, `namedByEveryone`). A group: its members. A project chat: `chatMemberIds` (the leader and the team: an Admin or a holder
  of `chat.project.all` outside the team is not named). A to-do thread: lead, helpers, maker and project leader (an office to-do has no
  leader). A direct chat names nobody. Never the sender, an agent or a person who is off, and only a writer who holds `chat.mentionEveryone`
  (basic switch, on for every role). A person named by name or by a reply gets that notice, not a second one. The people join
  `Message.mentions` and `Comment.mentions`; each gets one `mention` notice with `everyone: true` (`NotifyInput.everyone`). An edit names
  a person for the first time only. An @everyone notice makes no Admin copy (`makesCopies`) and no email (`NEW_NOTICES_SQL`,
  `liteNoticeRows`); it gives the push through the normal notice path. `chats.messages` and `tasks.get` give the count for the mention
  list row (`everyone`, missing when it is 0). Tests: `handlers/everyone.test.ts`, `server/push/everyoneLeaks.test.ts` (the leak probes).

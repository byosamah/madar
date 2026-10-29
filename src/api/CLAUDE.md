# API contract and the fake API

Every call of Madar is defined here once. The prototype runs these handlers in the browser. The server runs the same
handlers inside `runCall` (see `server/CLAUDE.md`). An AI agent reaches the allowed ones as MCP tools.

Folder guides: `contract/CLAUDE.md` (fields and limits), `handlers/CLAUDE.md` (the rules of single features),
`remote/CLAUDE.md` (the browser client). The rules for all parts are in the root `CLAUDE.md`: no `server/` import,
pure handlers, an additive contract, a table for a new collection, a test count that only grows.

## Files
- `registry.ts`: `defineCall({ input, output, run, prepare?, readOnly?, prototypeOnly? })`. `execute.ts` runs a call.
  `errors.ts`: `ApiError` and its codes.
- `handlers/*.ts`: one file for each area. `handlers/serverFakes.ts`: the prototype fakes of the server-only calls.
- `calls.ts` joins the handlers and the fakes. `sharedCalls.ts`: the calls the server runs (all but `SERVER_EXCLUDED`).
- `contract/entities.ts` (records, ids like `prj_`, `tsk_`), `contract/views.ts` (read shapes), `contract/server.ts`
  (the server-only calls), `contract/limits.ts` and `contract/push.ts` (plain limits, no zod).
- `permissions.ts`: `can(actor, action, resource)`. `rights.ts`: `rightsOf`. `rightsCatalog.ts`: the rights catalog.
  `taskGates.ts` and `meetingGates.ts`: the gates of one kind of change.
- `notify.ts`, `adminCopies.ts`, `hiddenNotice.ts`: the notices. `projectView.ts`: the view rule for lists of projects.
- `store.ts`, `persist.ts`: the prototype store in IndexedDB. `Store.runIf(fn)` saves and tells the listeners only when
  `fn` returns true. On an error it puts the state back, as `run()` does (the prototype minute timer `startScheduler` uses it).
- `rowKeys.ts`: `memberKey` and `chatReadKey` (`store.ts` exports them again). `remote/`: the client of the real build.

## Rules
- The output is checked inside the change, so a wrong shape rolls it back (`execute.ts`).
- One permission function: `can()`. No screen and no handler checks a right another way. An agent acts with its owner's
  rights (`resolveAuthority`).
- A list view that builds a row for each project or each to-do (`projects.list`, `tasks.list`) makes one `viewIndexOf(state)` for the
  call and passes it to `summaryOf` or `taskRowOf`. The lookups hold the tasks, members, stages, deadlines, posts and feed changes of a
  project, so no row scans the office (`viewCost.test.ts` counts the scans and pins the output). A write never keeps the lookups: a change
  makes them old. `feedFor` labels only the newest `limit` rows; keep its tie order (time, then id) when you change it.
- `leadTookTask` takes the changes of the task as its third argument when the caller has them (`taskDetailOf`).

## Office rights and roles
- The catalog JSON `docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json` is the one source. `rightsCatalog.ts`
  is its plain copy (no zod). `rightsCatalog.test.ts` checks that both agree and pins every count (sections, powers,
  switches, basic switches). No guide states a count.
- A switch id is `<power>.<scope>` for a power with scopes (`lead`, `team`, `all`, `office`, `none`), or the power name for
  a power with one switch. The Admin holds every switch (`heldSet`). `BASIC_ON` is the list of switches that a Member holds.
- A power with scopes asks `scopeAllows` (`permissions.ts`): `<power>.all`, or `<power>.lead` and lead the project, or
  `<power>.team` and be on the team (the leader counts as on the team). An "own" power keeps the people rule (maker, lead,
  author, organizer) and needs its switch. `project.code` passes only where `project.details` passes.
- **Add a switch:**
  1. Add it to the catalog JSON and to `rightsCatalog.ts` (id, scope, `basic`, `needs`, the defaults of each built-in role,
     `mcpTools` of an AI switch). Update the counts in `rightsCatalog.test.ts`.
  2. Keep `MAX_OFF_RIGHTS` at or above the number of basic switches, and `MAX_STORED_RIGHTS` above the switches that a role
     can hold (`contract/entities.ts`). No test pins the two caps. A role save over a cap fails in zod.
  3. Add the label and the hint to `roleRights.powers.<power>` in `src/i18n/real/rr2sheet.*.json`. The English texts and
     the Arabic labels come word for word from the catalog JSON (`roleRightsWords.test.ts`).
  4. Ask the action of the power name in the call. Add a group to `rightSwitches.test.ts` and the gate cases to
     `rr2Office.test.ts` (on, off, scope, and the agent of a person without the switch).
  5. A control reads a `viewerCan` flag (`contract/views.ts`). The loaders (`overview.ts`, `report.ts`) mirror the gates of
     the Dashboard, Search and money.
- Storage is additive, with no migration. `RoleSettings.rights[role]` and `CustomRole.rights` hold the switches beyond
  `BASIC_ON`, and may still hold the old ids (`StoredRight`; `expandRights` maps them with the `legacy` map). `off` lists the
  `BASIC_ON` switches that the role does not hold. `rightsOf` (`rights.ts`) builds a built-in role as (`BASIC_ON` minus `off`)
  plus the expanded `rights` (or `DEFAULT_EXTRA`), minus each switch whose need on another power is off (`dropUnmetNeeds`,
  fail closed: `ai.connect` off turns every AI switch off; the sheet turns needs on with `withNeeds`). A custom role with no
  `off` holds the Member switches plus its own. A deleted role leaves the Member switches. Every output gives the new ids
  only, and a save writes new ids only.
- The action of `can()` is the power name. Every call site asks the action of its own power. A few old names stay because
  they are also power names (`project.create`, `task.review`, `report.office`, `feedback.manage`, `gaps.view`, and so on),
  and `admin.manage` reads only the Admin role. `server/core/rightsParity.test.ts` proves that the default settings answer
  as the first release did. A stored list may hold an old id (`LEGACY_RIGHTS`): that is a stored right, never an action.
- A right gives only its own power. Before a right passes an action, grep every use of that action.
- A check of an office right reads the person with the rights attached. A handler gets them in `ctx.authority`
  (`execute.ts`). A loader (`Load.authority`) and a server call use `withRights(state, user)`. A place that asks `can()` for
  another person of the office calls `ensureRights(state, user)` first (`canSeeConversation`, `attach.ts`, `server/files/rights.ts`).
- `can()` fails closed: a person other than the Admin, with no `officeRights` attached, holds no office right. A test that
  calls `can()` for a Member needs `withOfficeRights`.
- Only the Admin changes a role (`systemRole` or `roleId`, reason `admin_only`). `roles.*` write one settings event each.
  `undoRoleChange` takes them back, and an agent never takes one back (`rolesLeaks.test.ts`).
- The Undo asks the right of its own act (`assertMayUndo`, `handlers/history.ts`). The Undo of a CREATE event uses the create
  right only when the event is the change of the caller (`isOwnChange`, also through the caller's own agent). An item that
  the agent of another person made, taken back through `ai.undoOthers`, needs the right that deletes the item. Tests:
  `handlers/rr2Undo.test.ts`.
- The chat send check is in `postMessage` (`handlers/chats.ts`, `assertMayWriteIn`), the one door of `chats.send` and
  `files.share`. A project chat asks `chat.project`. A direct chat or a group asks `chat.direct` for send, edit, delete,
  reaction and file. Read, the read marks, archive, Notify me and leave stay free. A holder of `chat.project.all`
  outside the team opens every project chat. The Inbox counts it as it counts the Admin's other chats (`countsNamedOnly`),
  and the push goes only when a message names the person (`planPushes`).
- `ProjectSummary.viewerCan.post` and `.edit` are flags of the first release, kept in the contract. No screen reads them for
  a split power. The screens read the single flags. A control with no project or to-do reads the rights of the session
  (`useRight`, `useCan` in `app/useRight.tsx`).

## Hidden projects and who may view a project
- `Project.access` is `{ hidden, viewerIds }`, optional, with at most `MAX_PROJECT_VIEWERS` viewers. No value means open with
  no chosen people. No migration and no `STATE_VERSION` step. `Project.kind` is `'client' | 'internal'`, optional.
- One rule: `mayViewProject(state, project, viewer)` = `can(viewer, 'project.view', projectResource(state, projectId, viewerId))`.
  True for a holder of `project.hidden`, the leader, a team member, a chosen person, and a holder of `project.seeAll` when
  the project is open. `task.view` and `comment.read` of a project resource and `meeting.view` of a project meeting read the
  same rule. A person who left the office never sees a hidden project, and sees only the open projects that the person saw while active.
  The own meeting rights (`meeting.editOwn`, `meeting.minutesOwn`) also need this rule; `meeting.plan` does not.
- The rule fails closed. A resource with no `access` facts, or with no project, denies everyone except a holder of
  `project.hidden`, the leader and the team. Never write `{ projectRole }` alone for a view check: build the resource with
  `projectResource`. `mayViewProject`, `mayViewTask` and `mayViewMeeting` attach the rights (`ensureRights`).
- A hidden record answers as an unknown record of its own kind: `requireProject` (`handlers/shared.ts`) answers
  `not_found Project <id>` before any `assertCan`. `seesProject(ctx, id)` is the test for a child record. These doors use it:
  `requireDeadline`, the stage of `stages.setDates`, `stages.setPrerequisites` and `tasks.createFromTemplate`, `requireUpdate`,
  `requireComment`, `targetOf`, `requireEntry`, `requirePayment`, `mayViewFile` (`not_found File`, never `forbidden`, also in
  `server/files/rights.ts` and `server/calls/files.ts`), `requireTask`, `requireMeeting`, `seesEvent`, `canSeeConversation`.
  The template calls read the project with `requireProject` before `assertMayApply`.
- A list or a count over projects calls `projectViewer(state, viewer)` first (`projectView.ts`: `visibleProjectIds`,
  `hiddenProjectIds`, `eventProjectViewer`). `peopleFilter` and `teamFilter` (`pause.ts`) take the viewer as their last
  parameter. This covers `projects.list`, `tasks.list`, `deadlines.list`, every number of `dashboard.get`, `search.query`,
  `reports.office`, `subCompanies.list`, `projectTemplates.list` and `.usage`, the leader hint of `session.get`,
  `events.list`, and `taskThreads` (so `chats.list`, `chats.unreadCount` and `chats.waiting` never count a hidden thread).
- The events of a deleted project follow its delete event (`viewsGoneProject`, `projectView.ts`; `seesProjectEvent`,
  `eventProjectViewer` and `eventProjectConds` all call it). A project deleted while hidden shows only to a holder of
  `project.hidden`. A project deleted while open shows to a holder of `project.hidden` or `project.seeAll`, to `before.leaderId`,
  to `before.access.viewerIds` and to the people of the team list `teamIds` that `projects.delete` records on the event (the rule
  of a live project, `can('project.view')`, decides the last step, so a person who left the office sees it only if that person
  worked on it). A delete event with no `teamIds` (written before the list) takes its team from every change of a team row before
  it (target type `member`: the adds, the removes and their undos, by their shape). A state with no delete event of the project
  reads it as open, so a loader must bring the delete event and, for an old one, the member changes (`goneProjects`, `steps.ts`;
  `events.list` and the story loader call it).
- `notify` skips a person who does not see the project of the target (`projectOfTarget`, `targetProject.ts`). A notice whose
  item belongs to a hidden project reads as gone (`noticeProjectHidden`). An Undo keeps such a notice. A meeting of a project
  needs attendees who see it (`not_in_project_audience`). Realtime, push, the morning summary and Google Calendar skip a person
  who does not view the project: each layer has one line (`server/data/projectAudience.ts`).
- `code_taken` leaves out the key of a project the person does not see. `sameContractAs` of such a project reads as unknown.
  `subCompanies.delete` counts only visible projects in `sub_company_in_use`.
- Leak tests: `handlers/hiddenProjectLeaks.test.ts` (every door), `handlers/subCompaniesHidden.test.ts`,
  `server/mcp/hiddenProjectTools.test.ts`, `server/calls/hiddenProjectFiles.test.ts`. The loader sweep reads and writes the
  hidden project of `trapOffice` (`HIDDEN_PROJECT`, `server/data/loaders/sweep.ts`).

## Locked folders (fbk_074)
- The switch `folder.locked` ("Locked folders", one switch, off for every role but the Admin). A person without it never learns
  that a locked folder exists, nor any file in it: every call that names them answers as an unknown id (`not_found`, same code,
  text and details). The pure rule is `folderLock.ts` (`holdsLockedFolders`, `foldersFor`, `fileHiddenByLock`, `fileInLockedFolder`,
  `eventTouchesLocked`, `eventHiddenByLock`, `eventForViewer`, `lockedFolderChange`). Every path asks one of them.
- Read paths: `projects.get` (`foldersFor`), `files.list`, `mayViewFile` (so `files.get`, `files.link`, delete, move, mark delivered and
  share all read a locked file as missing), `search.query`, `attachmentsOf` (with the viewer), `feedFor`, `seesEvent` (the History, Undo,
  `events.undoStory`) and `eventViewOf` (takes the locked folders out of a folder list that an event keeps, such as `project.created`),
  `server/calls/files.ts` (`files.link`), and the change signals (`server/data/save.ts`: a change inside a locked folder goes only
  to the holders who view the project; a lock or unlock goes to all, with the kinds `projects` and `files`).
- A locked folder hides its whole past: an event about a folder that is locked now stays hidden, also from the days when it was open.
- Write paths: `requireFolder` and `checkPlace` read a locked folder as missing for a person without the switch; `addVersion` skips a
  locked file that the person cannot see, so an upload of the same name makes a new file and tells nothing; `updates.create` and
  `assertFilesInProject` refuse a locked file; `folders.delete` refuses a locked folder. The id lists of a post, a comment and a Tracker line
  (`shownFileIds`) and their attachments leave out a locked file. A new door that takes a file id, a folder id or a folder list must ask `folderLock.ts`.
- `ViewerCan.lockFolders` (the switch with the upload right) is the flag of the lock control. Leak tests: `handlers/lockedFolderLeaks.test.ts`,
  `server/calls/lockedFolderFiles.test.ts`, `server/data/lockedFolderSignals.test.ts`, `server/mcp/folderTools.test.ts`.

## Notices
- `Preferences.notifications` is a `partialRecord`: an absent trigger means on. Read a switch only with `inAppOn`
  (`notify.ts`). A person stored before a new trigger still loads, with no backfill.
- **Add an in-app notice type:** `TRIGGERS` and `IN_APP_ONLY_TRIGGERS` (`entities.ts`), the words `settings.triggers.<t>` and
  `inbox.trigger.<t>` (with `_female` in Arabic), the pins in `entities.test.ts`, `notify.test.ts` and
  `NotificationsSection.test.tsx`, a line in `server/push/words.ts` for a new `inbox.*` sentence, and the list in
  `server/mail/CLAUDE.md`. No migration: the column is text.
- `IN_APP_ONLY_TRIGGERS` send no email: `emailOn` is false, `notifications.updateSettings` refuses their email switch with
  reason `in_app_only`, and Settings shows none. `ADMIN_ONLY_TRIGGERS`: `visibleTriggers` shows the switch only with the right.
  `ACTION_TRIGGERS` count on the bell.
- `notify` skips the actor and the person of an agent actor, agents, people who left, and a switch that is off.
- Hidden-notice rules change together: `hiddenTask` (`notifications.ts`) and `noticeTaskHidden` (`handlers/history.ts`) for an
  office task, `feedbackNoticeHidden` (`notify.ts`) for a report, `hiddenMeeting` with `noticeMeetingHidden` for a meeting with
  no project, and `noticeProjectHidden` (`hiddenNotice.ts`) for a hidden project (the notice view, `dropNotices` and `mayView`
  of `adminCopies.ts` all call it). A deleted hidden project reads from its last copy. The viewer of `feedbackNoticeHidden`
  and `visibleTriggers` must carry the attached rights, or the notice reads as hidden.
- An Undo keeps a notice only while a change of the same story stands (`dropNotices`).

## Copies for the Admin
- An Admin with `Preferences.adminReach` `all` gets a COPY of each notice of the office that the Admin did not get as a
  recipient. `notify()` calls `copyForAdmins` (`adminCopies.ts`) after the normal notices. The copy is a `Notification` with
  `forUserIds`. A call that tells nobody makes no copy.
- Only the triggers in `COPY_TRIGGERS` copy (`makesCopies` also limits `mention` to a project chat message or a task comment).
  A new trigger makes no copy until it is in the list. No copy for `added_to_group`, a reminder, a report notice, an
  @everyone notice, or a mention in a direct chat, a group or a project post.
- One copy for each notice call and each Admin. The Admin gets none when the Admin is a recipient, is the actor or the person
  behind an agent actor, is inactive, has the in-app switch of the trigger off, or may not see the target.
- A copy sends no push and no email. The producers skip a notice with `forUserIds` (`PUSH_NEW_NOTICES_SQL`,
  `NEW_NOTICES_SQL`, and the SQLite forms). Test: `server/push/adminCopies.test.ts`. A copy joins the story of the call, so
  `dropNotices` takes it back with the original. A message edit that removes a name takes the name out of the copy
  (`dropMessageNotices`); the restore of a deleted message makes its copies read (`readCopiesOf`).
- The words are `adminReach.copy.<trigger>` in `src/i18n/real/adminreach.*.json`. `me.updatePreferences` refuses `adminReach`
  for a person who is not an Admin and for an agent (`forbidden`).

## Google Calendar
- Four server-only calls (`contract/server.ts`, `server/calls/google.ts`): `google.status`, `google.connectStart`,
  `google.connect`, `google.disconnect`. Only a person, for the person: an agent gets `forbidden`. All four stay on the MCP
  deny list.
- They touch only the tables `google_connections`, `google_events` and `google_calendars` (`server/google/store.ts`). No State
  collection reads them, so the calls write no event, no History row and no change signal. `WRITE_KINDS` is `[]` for the two
  writes. The prototype fakes give `ready: false` and refuse the other three with `google_not_ready`.
- The reason is `google_link_person`, not `google_link_other`: i18next reads a key that ends with `_other` as a plural form.
- The callback `GET /api/google/callback` has no sign-in. It sends the code to Settings in the address fragment, and the
  signed-in screen calls `google.connect` (see `server/google/CLAUDE.md`).

## The office report
- `reports.office` needs `report.office`. Money needs `payment.view` (null otherwise). Gaps need `gaps.view` (null otherwise).
  Office tasks stay out. The MCP tool is on `MCP_BY_RIGHT`.
- The stage moves, completions and pauses come from `state.counts` (`REPORT_KEYS`, counted in SQL by the loader). The reviews
  come from `state.events`. Without `state.counts` the handler counts `state.events` for all four (the prototype). Both give
  the same numbers (`loaders.test.ts`).
- Past due counts to today while the period runs. A period that has ended counts to its last day.
- The answer carries `design` (`REPORT_DESIGN`, `reportDesign.ts`). Its colors and sizes copy `tokens.css`
  (`reportDesign.test.ts` checks them). `guide: true` adds `REPORT_GUIDE` (`reportGuide.ts`). A change of a tool name, a field
  or a color that the guide names fails `server/mcp/reportGuide.test.ts`.

## A new call: the checklist
1. `defineCall` in its handler file, with tests.
2. A server-only call: its contract in `contract/server.ts`, its fake in `handlers/serverFakes.ts`, its body in
   `server/calls/`. A server read must also be in `READ_CALLS` (`remote/keys.ts`), or the browser gives it an idempotency key.
   `server/core/serverCallMap.test.ts` pins the list.
3. A loader entry in `server/data/loaders/` (a test fails without it).
4. The MCP allow list, right list (`MCP_BY_RIGHT`: an agent sees the tool only when its person holds the right),
   `MCP_ADMIN` (the three role tools, which need `admin.manage`) or deny list in `server/mcp/tools.ts` (a test fails without
   it). An allowed or right tool needs `TOOL_DOCS` (40 to 600 characters; the tools of the parity track are in
   `server/mcp/docsParity.ts`) and one AI switch: add its name to the `mcpTools` list of that switch in the catalog
   (`server/mcp/aiSwitches.test.ts` fails without it). It also needs a sample: add a call to `scripts/record-samples.ts`,
   then run `node --import tsx scripts/record-samples.ts`.
5. An input in `server/core/everyCall.ts` if the loader sweep does not name it. A call that removes something runs after
   the call that makes it.
6. Its read kinds in `src/app/readMap.ts` if it is a read.
7. Its line in `WRITE_KINDS` (`src/app/writeKinds.ts`) if it is a write: the change kinds that its signals can name for the
   screen of its actor. `server/core/writeKinds.test.ts` fails without the line. A kind that the line lacks leaves no old list: the
   signals still reload that read, one round trip later.
8. Words in English and Arabic for every new message.
9. A new event verb: add it to `NOT_UNDOABLE` or `DERIVED` (`events.ts`) when it has no Undo, give it a right in
   `assertMayUndo` (`handlers/history.ts`), and add it to `FEED_VERBS` (`views.ts`) when the project feed shows it.
10. Raise the pinned call counts: `src/api/calls.test.ts`, `server/core/serverCallMap.test.ts`, `server/http/health.test.ts`,
    `server/it/worker.it.test.ts`, and the MCP tool count tests (`server/mcp/app.test.ts`, `server/mcp/tools.test.ts`,
    `server/mcp/oauth/sdk.test.ts`).

## A new record type
- A new zod collection needs a table in a new migration and an entry in `server/data/tables.ts`.
- A small list that belongs to one record can live in that record's `doc`, as the links and the folders of a project do (no
  table, no migration, no loader).
- An optional `State` collection (read through an `xOf` function, such as `meetingsOf` or `pushDevicesOf`) needs no
  `STATE_VERSION` step. A required one needs a new `STATE_VERSION` and a step in `src/data/migrate.ts`.
- Daftra calls: see `server/daftra/CLAUDE.md`. `Payment.daftra` is absent when empty (`ABSENT_WHEN_NULL`, `events.ts`).

## Prototype data
- `src/data/seed.ts` builds the sample office. `STATE_VERSION` is in `store.ts`. Each version has a step in
  `src/data/migrate.ts`. A newer or unreadable saved office is never wiped.
- The prototype adds the standard folders of the sample client projects in `src/data/sampleFolders.ts` (bootstrap and `sampleOffice`, not
  `buildSeed`: the screen tests count the folders of the plain sample office).
- `src/api` never imports `src/data/`. `session.resetSampleData` takes the sample office from the runtime (`createApi`
  option `sampleOffice`, `src/data/sampleOffice.ts`), so the server bundles hold none.
- `settleFuture` runs only on sample data: the prototype, the test office seed (madar-test only) and the local seed.
- The call sweep (`server/core/everyCall.ts`) makes the role `rol_002` and removes it.

## Tests
- A delete of the last task of a stage records a stage change after the delete. A test undoes the delete event or the story,
  never "the newest event".
- `npm test` runs the rule tests on the store in memory. `npm run test:db` runs them again on the local Postgres (one schema
  for each worker, as madar_server).
- `test:db` refuses a test that edits the state by hand and breaks a foreign key ("db mode: the test's own edits break a
  database rule"). A long leak sweep needs its own timeout there.

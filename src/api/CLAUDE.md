# API contract and the fake API

Every call of Madar is defined here once. The prototype runs these handlers in the browser. The server runs the same
handlers inside `runCall` (see `server/CLAUDE.md`). An AI agent reaches the allowed ones as MCP tools.

## Files
- `registry.ts`: `defineCall({ input, output, run, prepare?, readOnly?, prototypeOnly? })`.
- `handlers/*.ts`: one file for each area. `handlers/serverFakes.ts`: the prototype fakes of the server-only calls.
- `calls.ts`: joins the handlers and the fakes. `sharedCalls.ts`: the calls the server runs, without `SERVER_EXCLUDED`.
- `contract/entities.ts` (records, ids like `prj_`, `tsk_`), `contract/views.ts` (read shapes), `contract/server.ts`
  (the server-only calls, `PASSWORD_SET_MARK`, file limits).
- `permissions.ts`: `can(actor, action, resource)`. `execute.ts`: runs a call. `errors.ts`: `ApiError` and its codes.
- `store.ts`, `persist.ts`: the prototype store in IndexedDB. `remote/`: the client of the real build (batcher, wire, keys). With
  no session token it sends nothing: the call fails with `unauthenticated`, reason `no_session` (AuthGate ignores that reason).

## Rules
- `User.avatarUrl` takes picture data (WebP, JPEG or PNG, up to 24,000 characters) or an https address (`UserAvatarInput`).
  `userCard()` leaves picture data out, so lists stay small. `User.nameAr` is the Arabic name; an empty value means none.
- `src/api` never imports `server/` or `src/app/`.
- The output is checked inside the change, so a wrong shape rolls it back (`execute.ts`).
- One permission function: `can()`. No screen and no handler checks a right another way. An agent acts with its owner's
  rights (`resolveAuthority`).
- A contract change is additive, or it keeps both forms.
- Handlers stay synchronous and pure. A handler never does network work. Outside work is an effect.
- The test count only grows, except when the code a test checks is deleted.

## The project code (owner, 2026-10-05)
- `lib/projectCode.ts` reads and builds `YYMMSSINI-CLS-Type` (key `YYMMSSINI`, contract `YYMMSS`). Old codes (`KH-26-014`)
  stay valid. Two projects of one contract share one code, so the projects table has no unique rule on the code.
- `projects.create` takes `codeParts`, `code` or `sameContractAs` (at most one); with none, the old automatic code. A typed
  code whose YYMMSS belongs to another contract fails with `code_taken`. `codeParts` initials go onto a client with none.
- Only the Admin corrects a code (`project.editCode`, `projects.update` `patch.code`, verb `project.code_changed`).

## Project templates (owner, 2026-10-05, item 6a)
- `ProjectTemplate` (`ptp_`): roles (a name and a default person), stages, and tasks with a start day and a length in working
  days (Sunday to Thursday, day 0 is the project start) and `flexible`. Ids inside a template (`r1`, `s1`, `t1`) are unique in it.
- `projectTemplates.list`, `.save` (no `id` makes one, an `id` changes one) and `.delete`. Saving needs `project.create`; a change
  or a delete needs the person who saved it or the Admin. MCP: deny list.
- `projects.create` takes `template: { templateId, startDate, endDate?, roles, fixedTaskIds }`, never with `stages`, `startDate`
  or `targetEndDate`. The plan comes from `lib/projectPlan.ts`, the same function as the screen. Locked tasks that do not fit
  refuse with reason `template_too_short` (`names` holds the days they need). A role person joins the team; a role with no
  person gives tasks with no lead. The tasks send no notice: their people had the one notice of their place on the team.
- Stage templates merged into project templates. Their calls stay in the contract, their screens are gone. Version 9 and the
  migration `20261005000100_project_templates.sql` made one project template from each stage template, once.

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
- Review: only when the maker is not the lead; `reviewersOfTask` (`notify.ts`) gives the maker, or the Admins when the maker left.
- Office tasks count in the lists of a person, `overdueTasks`, the workload, `inReview` and the gaps of `dashboard.get`, only
  with no people filter. They never count in a project number.
- Three functions hold the rule of a hidden notice: `hiddenTask` (`notifications.ts`) and `noticeTaskHidden`
  (`handlers/history.ts`) for an office task, and `feedbackNoticeHidden` (`notify.ts`) for a report. Change them together.

## Requests and bugs notices (owner, 2026-10-07)
- `feedback_sent`: a new report tells each active Admin (`activeAdmins`, `notify.ts`). `feedback_done`: a report that goes
  from open to done tells `principalOf(createdBy)`. The skips of `notify` apply: the actor and the person of an agent actor,
  agents, people who left, and a switch that is off.
- `Preferences.notifications` is a `partialRecord`: a missing trigger means on. Read a switch only with `inAppOn`
  (`notify.ts`). So a person stored before a new trigger still loads, with no backfill.
- `IN_APP_ONLY_TRIGGERS` (both) send no email: `emailOn` is false, `notifications.updateSettings` refuses their email switch
  with reason `in_app_only`, and Settings shows no email switch for them. `EMAIL_TRIGGERS` holds the other triggers.
- `ADMIN_ONLY_TRIGGERS` (`feedback_sent`): `visibleTriggers` shows its switch only with `admin.manage`. The value stays.
- A report notice carries `feedback: { kind, excerpt }` (`NoticeFeedback`), so its line needs no report row. `excerptOf`
  (`lib/text.ts`) makes the excerpt: one space for each run of white space, 80 code points or fewer, cut at a space, then "…".
- Only the move from open to done sends a notice. Done on a done report and "Open again" send nothing, and the done notice
  stays. Done after "Open again" sends a second one. `feedback.list` takes `status` (`new` or `done`).
- An Undo keeps a report notice only while a change of the same report stands in its story (`dropNotices`,
  `handlers/history.ts`). So the Undo of one done change takes back only the notice of that report.
- A former Admin sees an old `feedback_sent` notice as gone: no words, no sender (`actorId` null), no link and no place on
  the bell. An Undo never deletes it, and a new promotion shows it again. A `feedback_done` notice always shows to its owner.
- Both triggers count on the bell (`ACTION_TRIGGERS`). A done notice has the link `''`: its row only marks it read.

## A new call: the checklist
1. `defineCall` in its handler file, with tests.
2. If it is server-only: its contract in `contract/server.ts`, its fake in `handlers/serverFakes.ts`, its server body in
   `server/calls/`.
3. A loader entry in `server/data/loaders/` (a test fails without it).
4. The MCP allow list or deny list in `server/mcp/tools.ts` (a test fails without it). An allowed tool needs `TOOL_DOCS`.
5. An input in `server/core/everyCall.ts` if the loader sweep does not name it.
6. Its read kinds in `src/app/readMap.ts` if it is a read.
7. Words in English and Arabic for every new message.
8. Raise the pinned call counts: `src/api/calls.test.ts`, `server/core/serverCallMap.test.ts`, `server/http/health.test.ts`,
   `server/it/worker.it.test.ts`, and the MCP tool count tests.

## A new record type
- A new zod collection needs a table in a new migration and an entry in `server/data/tables.ts`.
- The prototype store needs a new `STATE_VERSION` and a step in `src/data/migrate.ts`.

## Prototype data
- `src/data/seed.ts` builds the sample office (Hala Nasser is Admin). `STATE_VERSION` is 9 (`store.ts`).
- The two feedback triggers needed no new `STATE_VERSION`: the switch record is partial, and `inAppOn` reads a missing key as on.
- `src/api` never imports `src/data/`. `session.resetSampleData` takes the sample office from the runtime (`createApi` option
  `sampleOffice`, `src/data/sampleOffice.ts`), so the server bundles hold none. `settleFuture` runs only on sample data: the
  prototype, the test office seed (madar-test only) and the local seed.
- Each version has a step in `src/data/migrate.ts`. A newer or unreadable saved office is never wiped.

## Tests
- `npm test` runs the rule tests on the store in memory. `npm run test:db` runs them again on the local Postgres (one
  schema for each worker, as madar_server).

# Office tasks (tasks with no project)

Owner decisions of 2026-10-06. A person adds a task on the Tasks page that belongs to no project: an "office task".

## The rules
1. A person adds an office task on the Tasks page. It has no project and no stage.
2. Who sees an office task: its maker (the person who made it; for an agent, the person the agent acts for), its lead, its
   helpers, and the Admin. Nobody else. An agent sees what its person sees (`resolveAuthority`).
3. The maker gives the task to any active person as lead, and adds helpers. The lead gets the usual notice.
4. An office task has what a project task has (dates, lead, helpers, checklist, comments, files, review, versions), except the
   project, the stage and prerequisites.
5. Office tasks count in the lists of a person (My Work, the Task list), in "Past-due tasks" and in the People tab of the
   Dashboard (workload and reviews). They never change a project's health, a stage tag or any project number.

## Model
- `Task.projectId` and `Task.stageId` are nullable. Null is an office task. The database already allows it (`tasks.project_id`
  is a generated column with no NOT NULL). No migration.
- `FileRec.projectId` is nullable. An office file has `taskId` set to its office task. `files.project_id` has no NOT NULL.
- `Event.officeTaskId` (optional): set on every change of an office task, of its comments and of its files. The read rules
  and the loaders filter on it, so a SQL limit and the handler give the same rows.
- `TaskRow.project` and `TaskRow.stage` are null for an office task. `dashboard.get` `inReview` rows and `search.query` task
  rows take a null `projectId`. Every other field stays.

## One visibility rule
- `can(actor, 'task.view', resource)` with the resource of `taskResource(state, task, viewerId)` (`src/api/permissions.ts`).
  A project task gives `{ projectRole, ownerId, helperIds }`: everyone sees it, as today. An office task gives
  `{ office: true, makerId, ownerId, helperIds }`.
- Rights on an office task: view, comment, tick (`task.contribute`) and take: the maker, the lead, a helper, the Admin.
  Edit and complete (`task.updateOwn`): the maker, the lead, the Admin. Lead, helpers, review need, review, delete, undo of an
  agent change: the maker and the Admin.
- `requireTask` refuses an office task that the person cannot see with `not_found`, so every write checks the view first.
- Review: an office task needs review only when its maker is not its lead. Then the maker reviews it (`reviewersOfTask`; an
  inactive maker gives every active Admin). A lead change to the maker turns the review need off.
- Notices: `notify` drops a person who cannot see the office task (a mention of an outsider sends nothing). A notice of an
  office task that the person can no longer see reads as gone, with no title.

## Every place that reads or writes a task, and the change
| Place | Change |
| --- | --- |
| `tasks.create` | `projectId` optional. With none: an office task. No stage, no prerequisites, no stage move, no Tracker. |
| `tasks.list` | Visible office tasks only. They pass with no project filter (`projectId`, `leaderId`, `clientId`, `teamId`). `workOf` and `review_for_me` use `reviewersOfTask`. |
| `tasks.get`, every task write | `requireTask` checks the view. Writes use `taskResource`. |
| `tasks.createFromTemplate`, `tasks.newVersion` | Template: project only. New version: no Tracker entry for an office task. |
| `taskTemplates.save` | Refuses an office task (a template belongs to a stage). |
| `comments.*`, `reactions.toggle` | The target task must be visible. Files of a comment: files of the same office task. |
| `files.list`, `files.upload`, `files.get`, `files.delete`, `files.markDelivered`, `files.share` | `projectId` optional with an office `taskId`. Delivered and share refuse an office file, except share into its own task. |
| `files.uploadStart`, `files.link` (server) | Office key form `office/<task>/<intent>/file`. Rights: the task view right, then the person is active. |
| `search.query` | Visible office tasks and their files only. |
| `dashboard.get` | Visible office tasks in `overdueTasks`, the workload and `inReview`, only with no people filter. Never in health, stage, throughput or project counts. |
| `notifications.*` | Gone with no title when the person cannot see the task. |
| `chats.list`, `chats.unreadCount` (task threads) | An office thread for its lead, its maker and a person who commented, while that person sees the task. |
| `events.list`, the History of a task | An event with `officeTaskId` shows only to a person who sees that task. |
| `events.undo`, `events.undoStory` | The same check before the undo rules. |
| Meeting view | Groups by project, so office tasks never show there. |
| Due reminders (job) | Office tasks get them, as project tasks of active projects. |
| Morning summary mail | Counts office tasks due today and office reviews of the maker. |
| MCP | `tasks.create` without `projectId`; `TOOL_DOCS` and `INSTRUCTIONS` say who sees an office task. |

## Server loaders
- A visible office task in SQL: `project_id is null` and, for a person who is not an Admin, `owner_id`, `helperIds` or
  `createdBy` (the person or one of their agents). `tasks.list`, `search.query`, `dashboard.get`, the jobs load, the task
  threads and the events filter (`officeTaskId` in the visible ids) use it.

## Screens
- The Tasks page (My Work) gets one secondary button "Add a task" over the list. It opens the sheet "New office task": the
  title, the lead (me by default), the due date. One main button: Add. Helpers and the rest live in the task sheet.
- An office task shows the word "Office" (Arabic "المكتب") where a project key shows. Its sheet has no stage field, no
  prerequisites and no "Save as template". A link to an office task opens it on the Tasks page (`/work?task=<id>`).

## Privacy review (2026-10-06)
- A hidden office record reads exactly as a missing one: a task, a comment (`comments.update`, `.delete`,
  `reactions.toggle`), a file (the attach rules give `file_missing`, `files.link` gives `not_found`) and a story
  (`events.undoStory`).
- An undo event takes the `officeTaskId` of the event it undoes. A comment or a file of a deleted office task reads its
  last task copy (`lastTaskCopy`, `events.ts`), so no change of it becomes public.
- A Realtime signal of an office task change goes to every person, so it names no actor and no story. The screens match
  their own changes by the signal id.
- Known limit, accepted by the owner: the ids count up for the whole office (`tsk_`, `cmt_`, `fil_`) and so does the event
  `seq`. A gap in the ids or the seqs that a person sees shows that hidden records exist, but never what they are.

## Tests
- The privacy rule for each read path: a Member who is not on an office task never sees it, its comments, its files, its
  events, its notices or its count; the Admin sees it; an agent of a Member sees what the Member sees.
- The loader sweep runs on an office with office tasks, in memory (`npm test`) and on the database (`test:it`).
- Screen tests for the add sheet and the "Office" word.

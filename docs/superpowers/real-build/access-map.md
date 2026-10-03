# Madar real build: the data access map of the 112 calls

**Date:** 2026-10-03
**For:** the people who build the load, run and save steps (spec 2, section 5.3).
**Status:** Research. No code under `src/` changed.

## 1. What this report says

The real server loads the records a call needs into a `State`, runs the same handler, and saves the difference. This report says, for each call, which `State` collections the handler reads and writes, and how it reads the large collections. It then groups the calls into loaders, estimates the data size after 1 and 3 years, and names the handlers that need a small change before a partial load is safe.

The five main findings:

1. **A scan is safe only when the loader gives it the complete set that its filter can match.** Most handlers scan a whole collection and filter by `projectId`, `targetId` or `correlationId`. That is safe with a scoped load. It is not safe where the handler decides on absence (`!state.tasks[id]`). Section 6 lists 18 such places.
2. **Two handlers are not safe with any scoped load, and need a change:** `projects.delete` deletes every comment and notice whose task or post is not in `State`, and the Undo helper `isUsedElsewhere` scans 20 collections for a reference. With a project-scoped load, the first deletes other projects' comments and notices, and the second lets an Undo delete a record that is still in use.
3. **Events never load whole.** Events are about 53% of all data (63 MB of JSON after 3 years). Every call reads them by target, by story, or as the newest few of one project.
4. **The free-plan egress quota is a tighter limit than the database size.** Supabase counts the bytes that the database and the shared pooler send to any client, and the Edge Function is such a client. 5 GB a month over the expected 150,000 requests gives about 33 KB per request for loads and answers together. Spec 2, section 15 does not list this limit. The office lists must come from a memory cache, and the large lists must load scoped.
5. **The notice dedupe scan is not in any call.** Only `runScheduledTriggers` (the 15-minute job) passes a `dedupeKey`, so only the `jobs` function needs a lookup by dedupe key.

## 2. How the map was made

| Step | What ran | Result |
|---|---|---|
| Recorder | A Vitest setup file wraps `run`, `prepare` and `after` of every call. It gives the handler a `Proxy` over `State` that records each key read, each `Object.values`/`entries`/`keys` scan (with the source line), and each `in` check. A deep compare of `State` before and after the run gives the writes. | Scratch files in `/private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/realbuild/` (`record-access.ts`, `merged-full.json`, `access-full.txt`) |
| API tests | `src/api`, 45 files | 613 of 613 tests pass with the recorder |
| All tests | 167 files, so the screen tests also call the API | 1,622 of 1,640 pass. The other 18 time out only because the recorder copies the whole sample office on each call: 3 of the 6 files were run again without it and pass |
| Coverage | 111 of the 112 calls ran at least once | `projects.clearHealthOverride` did not run. Its row comes from the code (it is the same as `projects.setHealthOverride`) |
| Code read | Every handler and the helpers in `handlers/shared.ts`, `flow.ts`, `notify.ts`, `views.ts`, `events.ts`, `history.ts`, `chatState.ts`, `pause.ts`, `health.ts`, `permissions.ts` | Finds the scans the tests do not show, and the filter of each scan |
| Sizes | The sample office (`buildSeed`) | Measured JSON bytes per row, used in section 8 |

The call map has 112 calls: the 108 calls of spec 2, plus 4 prototype-only controls (`session.get` in its prototype form, `session.previewAs`, `session.setSimulateErrors`, `session.resetSampleData`).

## 3. Words used in the table

| Word | Meaning |
|---|---|
| **R** | Read-only call (`readOnly: true`). It runs outside the office lock and saves nothing. |
| **W** | Write call. It runs under the office lock. Every W call that writes an event also reads and writes `counters` (the next id and the event `seq`). |
| **Proto** | Prototype-only. Spec 2, section 3 removes it. |
| **P** | The project the call works on. |
| **Office lists** | `users`, `teams`, `settings`, `clients`, `stageTemplates`, `taskTemplates`. Small. Many helpers read `users` by any id (`cardOf`, `principalOf`, `notify`). |
| **Project index** | Every row of `projects`, `members`, `stages`, `deadlines` and `conversations`. Small. `projectRoleOf` reads `members` by key, so every permission check needs it. |
| **Project core of P** | The row of P, with its members, stages and deadlines (a part of the project index). |
| **Project view of P** | What `detailOf` and `summaryOf` (`views.ts`) read. Most project writes return it. It reads: the project core, **all tasks of P** (stage tag, health, open counts), the client, the cover file by id, and `feedFor(P, 'all', 2)`. Today `feedFor` scans **all posts of P and all events of P** and counts the comments of **every** post, then keeps 2 items. A scoped load gives it the newest 2 posts and the newest 2 feed events of P (not undone, verb in `FEED_VERBS`), with the comments of those 2 posts. |
| **Task view of T** | What `taskDetailOf` reads: task T, all tasks of its project, the stages of its project, **all comments on T** (count), **all files with `taskId` T** (count), and **all events with target T** (history). |
| **Status change of T** | What `changeStatus` and `watchStage` (`tasks.ts`, `flow.ts`) can touch: all tasks of P (prerequisites, dependents, stage tag), the events of T (`finishedOn`, only when T is in review), the Tracker entry of a reply task and the files it names, and the reviewers (users, project). It can write: tasks (T, reopened and moved dependents), comments (one per moved dependent), tracker (one per moved dependent, and the reply loop), notifications, the project (stage tag), events. |
| **Full scan** | The handler scans every row of the collection today, with no key that a loader can use. |

## 4. The per-call table

Only the large, growing collections have an access pattern column: `events`, `notifications`, `comments`, `messages`, `chatReads`, `files`, `tracker`, `updates`, `tasks` (and `payments`). The input field in `code` is the one that scopes the load. "Reactions" are not a collection in `State`: they are the `reactions` field of each comment (see section 7.6).

### 4.1 People, clients, settings, session

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `session.get` | Proto, R | users (scan), projects (scan, for the preview hints) | none | none. The real `session.get` reads the person by id only |
| `session.previewAs` | Proto, W | users by `userId` | none | session |
| `session.setSimulateErrors` | Proto, W | none | none | session |
| `users.list` | R | users (scan) | none | none |
| `users.get` | R | users by `id` | none | none |
| `users.create` | W | users (scan: email is free) | none | users +1, events +1 |
| `users.update` | W | users by `id`, users (scan: email, last Admin) | none | users, events +1 |
| `users.deactivate` | W | users by `id` | none | users, events +1 |
| `users.reactivate` | W | users by `id` and its owner | none | users, events +1 |
| `me.updateProfile` | W | the actor | none | users, events +1 |
| `me.updatePreferences` | W | the actor | none | users, events +1 |
| `clients.list` | R | clients (scan) | none | none |
| `clients.create` | W | none | none | clients +1, events +1 |
| `clients.update` | W | clients by `id` | none | clients, events +1 |
| `settings.get` | R | settings | none | none |
| `settings.update` | W | settings | none | settings, events +1 |

### 4.2 Projects, members, stages, deadlines

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `deadlines.list` | R | project index (deadlines scan; members by key for the team filter), teams by `teamId` | none | none |
| `projects.list` | R | project index (projects scan; stages, members, deadlines of each project), clients, teams by `teamId` | For **each** listed project (`status`, default active): all tasks of the project (health, stage tag, open count), and `feedFor` (all posts and all events of the project today; newest 2 of each needed), comments of each post (count), files by id (cover) | none |
| `projects.get` | R | project core of `id` | project view of `id` | none |
| `projects.create` | W | projects (scan: next code and colour mark), clients by `clientId`, users by `leader` and `teamIds`, settings | project view of the new project (empty) | projects +1, stages +N, members +N, conversations +1, notifications (added to project), events |
| `projects.update` | W | project `id`, clients by `patch.clientId`, files by `patch.coverFileId` | project view | projects, events |
| `projects.setLeader` | W | project `id`, users by `leaderId` | project view | projects, members (+1 for a new leader), notifications, events |
| `projects.setStatus` | W | project `id` | tracker by id (`pause.trackerId`); project view | projects, tracker (closes the client wait), events |
| `projects.pause` | W | project `id` | project view | projects, tracker +1 (client pause), events |
| `projects.resume` | W | project `id` | tracker by id (`pause.trackerId`); project view | projects, tracker, events |
| `projects.addLink` | W | project `projectId` | project view | projects, events |
| `projects.updateLink` | W | project `projectId` | project view | projects, events |
| `projects.removeLink` | W | project `projectId` | project view | projects, events |
| `projects.setHealthOverride` | W | project `id` | project view | projects, events |
| `projects.clearHealthOverride` | W | project `id` | project view (from the code; no test ran it) | projects, events |
| `projects.delete` | W, prepare, after | project `id` | **prepare:** files of P (by `projectId`), events of P with target type file (by `projectId` + target type), for the stored data keys. **run:** by `projectId`: stages, deadlines, tasks, updates, files, members, payments, tracker. **comments: full scan**, deletes each comment whose task or post is absent. **notifications: full scan**, deletes the notices of P and each notice whose task or post is absent. The chat of P (conversations scan by `projectId`), its messages and chat reads (by `conversationId`), its chat notices (by target). **after: files full scan** (is a data key still used?) | deletes all the rows above, events +1 (`project.deleted`) |
| `members.add` | W | project core, users by `userId` | project view | members +1, notifications, events |
| `members.addTeam` | W | project core, teams by `teamId`, users | project view | members +N, notifications, events |
| `members.remove` | W | project core | tasks of P (open tasks of `userId`); project view | members -1, events |
| `members.update` | W | project core | project view | members, events |
| `stages.replace` | W | project core | tasks of P (does a removed stage still have tasks?), deadlines and files of P (by `stageId` of each removed stage); project view | stages, deadlines and files (stage cleared), project (stage tag), notifications (stage forward), events |
| `stages.setDates` | W | stage `stageId`, project core | tasks of P (stage tag); project view | stages, project, notifications, events |
| `stages.setPrerequisites` | W | stage `stageId`, stages of P | project view | stages, events |
| `deadlines.create` | W | project core, stage `stageId` | project view | deadlines +1, events |
| `deadlines.update` | W | deadline `id`, project core | project view | deadlines, events |
| `deadlines.delete` | W | deadline `id`, project core | project view | deadlines -1, events |

### 4.3 Tasks

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `tasks.list` | R | project index (project status, team filter, stage order), teams, users | **tasks: full scan**, filtered by `projectId`, `ownerId`, `filter` (mine, overdue, flagged, review for me), `status`, the date ranges and `activeProjectsOnly`. For each row: comments of the task (count, scan), files of the task (count, scan), and tasks of its project when it has prerequisites. Scope: `projectId` when given, else an SQL filter that mirrors the input | none |
| `tasks.get` | R | project core of the task | task view of `id` | none |
| `tasks.create` | W | project core of `projectId`, users by `ownerId` and `helperIds` | tasks of P (stage tag, prerequisites); task view of the new task | tasks +1, members (a new owner or helper joins), notifications (task assigned, stage forward), project, tracker +1 (with `logInTracker` when the project moves back), events |
| `tasks.createFromTemplate` | W | task template `templateId`, stage `stageId`, then as `tasks.create` | as `tasks.create` | as `tasks.create` |
| `tasks.update` | W | task `id`, project core | tasks of P (prerequisites, stage tag); task view | tasks, comments +1 (date reason), members, notifications, project, tracker (+1 with `logInTracker`), events |
| `tasks.newVersion` | W | task `id` | tasks of P (reopens done dependents, stage tag); task view | tasks, tracker +1 (auto "version"), project, events |
| `tasks.complete` | W | task `id` | status change of `id`; task view | the status change writes |
| `tasks.move` | W | task `id` | status change of `id`; task view | the status change writes |
| `tasks.approve` | W | task `id` | status change of `id`; task view | the status change writes |
| `tasks.sendBack` | W | task `id` | status change of `id`; task view | tasks, comments +1 (the note), notifications, project, events |
| `tasks.delete` | W | task `id` | tasks of P (stage tag) | tasks -1, project, events. The comments and files of the task stay |

### 4.4 Posts, comments, reactions

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `updates.list` | R | project core of `projectId` | `feedFor(P, filter, limit)`: **all posts of P and all events of P today**, then sort and keep `limit` (default 50, at most 200). Comments of each post (count). Files by id (attachments). Target rows by id (event labels). For each agent event, the undo rules: tasks of P, events by `correlationId` (cover rule). Scope: the newest `limit` posts and the newest `limit` feed events of P, with the same `filter` | none |
| `updates.create` | W | project core, files by `fileIds` | comments of the new post (count) | updates +1, notifications (mention), project, events |
| `updates.update` | W | post `id` | comments of the post (count) | updates, notifications, events |
| `updates.delete` | W | post `id` | none | updates -1, events. The comments of the post stay |
| `comments.list` | R | the task or post `targetId` | comments by target (`targetType` + `targetId`), files by id | none |
| `comments.create` | W | target `targetId`, files by `fileIds` | none | comments +1, notifications (mention), project, events |
| `comments.update` | W | comment `id` and its target | none | comments, notifications, events |
| `comments.delete` | W | comment `id` and its target | none | comments -1, events |
| `reactions.toggle` | W | comment `commentId` and its target | none | comments (the `reactions` field), events |

### 4.5 Files

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `files.list` | R | project core | files of P (by `projectId`; filter `stageId`, `taskId`) | none |
| `files.get` | R, prepare | none | file by `id`. **prepare** reads the stored data. Real build: a signed R2 link, so no data passes the server | none |
| `files.upload` | W, prepare | project core, stage `stageId`, task `taskId` | files of P (scan for the same name, so a second upload becomes version B). **prepare** stores the data. Real build: the browser sends the data to R2 with a signed link first | files +1 or a new version, project (cover, updated), tracker +1 (`receivedFromClient`), events |
| `files.delete` | W | file `id`, its project | none | files -1, project (cover cleared), events |
| `files.markDelivered` | W | file `id` | none | tracker +1, project, events |
| `files.share` | W | file `fileId`, task `target.taskId` or user `target.userId` | task: none. Project chat: conversations (scan by `projectId`), messages of that chat (newest, for the read mark). Person: conversations (scan for the direct pair) | comments +1 or messages +1, conversations (+1 for a new direct chat), chat reads, notifications, project, events (task comment only) |

### 4.6 History and Undo

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `events.list` | R | target rows by id (labels: tasks, tracker, files, projects, stages, users) | **events: full scan** with the filters `projectId`, `targetType`, `targetId`, `correlationId`, `since`; newest `limit` (default 50, at most 500). Scope: the given filter. With no filter: the newest `limit` of the office | none |
| `events.undo` | W | the rows each event names | event by `eventId`. Events of the same target after it (by target type + `targetId`). Events of its story (by `correlationId`: `settle`, `dropNotices`, the cover rule). Notifications of the story (by `correlationId`). For the Undo of a create: **20 collections, full scan** (`isUsedElsewhere`). Tasks and stages of P (stage tag, reopened dependents) | the target record (any collection), events (+1 undo; the undone event gets `undoneBy`), tasks, project, notifications (deleted) |
| `events.undoStory` | W | as `events.undo` | events of the story (by `correlationId`), then as `events.undo` for each event | as `events.undo` |

### 4.7 Notifications

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `notifications.list` | R | project index, users | **notifications: full scan** for the person (by `userId`): all unread, plus the newest read ones up to `limit` (default 100). Target rows by `targetId` (tasks, posts, projects, conversations). **Events: full scan for each notice whose target is gone** (`deletedCopy`, by verb `<type>.deleted` and `targetId`) | none |
| `notifications.count` | R | conversations, members (chat notices) | notifications of the person (by `userId`); only the unread ones count. Target rows by `targetId` (`isGone`) | none |
| `notifications.markRead` | W | none | notifications by `ids`, then the count | notifications (read) |
| `notifications.markAllRead` | W | none | notifications of the person (by `userId`; only unread ones change), then the count | notifications (read) |
| `notifications.markUnread` | W | none | notifications by `ids`, then the count | notifications (unread) |
| `notifications.updateSettings` | W | the authority | none | users (preferences), events |

### 4.8 Chats

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `chats.list` | R | conversations (scan: visible ones), project index, users | **messages: full scan for each visible conversation** (by `conversationId`: the newest message, and the unread count after the read mark). Chat reads by key (`conversationId:userId`). **comments: full scan of all task comments** (task threads), tasks by id | none |
| `chats.messages` | R | conversation `conversationId`, users (scan: who can see it) | messages of the conversation: **all of them, oldest first, with no page limit**. Chat read by key. Files by id | none |
| `chats.send` | W | conversation `conversationId`, files by `fileIds` | messages of the conversation (newest, for the read mark) | messages +1, chat reads, notifications (mention) |
| `chats.markRead` | W | conversation, or task by id (`conversationId` may be a task id) | messages of the conversation (newest) or comments of the task (newest). Then the full unread count, as `chats.unreadCount` | chat reads |
| `chats.openDirect` | W | conversations (scan for the direct pair), users by `userId` | none | conversations (+1 when new) |
| `chats.unreadCount` | R | conversations (scan), project index, users | as `chats.list`, without the rows | none |

### 4.9 Dashboard and search

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `dashboard.get` | R | project index, teams, users (scan), settings | **tasks: full scan** (health, stage tag, overdue, throughput of 12 weeks, workload of 4 weeks). **tracker: full scan** (open loops). Scope: tasks of the projects in scope (`status`, default active; `leaderId`, `clientId`, `teamId`); open tracker entries | none |
| `search.query` | R | projects, clients, users (scans) | **tasks: full scan** by title (active projects). **files: full scan** by name. Scope: an SQL text filter on a stored, normalized text column, in creation order, then the same code keeps 5 | none |

### 4.10 Templates, feedback, teams, payments

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `stageTemplates.list` | R | stage templates (scan), users | none | none |
| `stageTemplates.save` | W | stage templates (scan: unique name) | none | stage templates +1, events |
| `stageTemplates.delete` | W | template `id` | none | stage templates -1, events |
| `taskTemplates.list` | R | task templates (scan, filter `stageName`), users | none | none |
| `taskTemplates.save` | W | task templates (scan: unique name); projects (scan: does the person lead one) or task `fromTaskId` and its stage | none | task templates +1, events |
| `taskTemplates.rename` | W | template `id`, task templates (scan) | none | task templates, events |
| `taskTemplates.delete` | W | template `id` | none | task templates -1, events |
| `feedback.send` | W, prepare | none | **prepare** stores up to 3 screenshots. Real build: signed R2 uploads | feedback +1, events |
| `feedback.list` | R | feedback (scan), users | none | none |
| `feedback.screenshot` | R, prepare | report `id` | **prepare** reads the screenshot data. Real build: a signed link | none |
| `feedback.setStatus` | W | report `id` | none | feedback, events |
| `teams.list` | R | teams (scan), users | none | none |
| `teams.create` | W | teams (scan: unique name), users by `memberIds` | none | teams +1, events |
| `teams.update` | W | team `id`, teams (scan), users by `memberIds` | none | teams, events |
| `teams.delete` | W | team `id` | none | teams -1, events |
| `payments.list` | R | project `projectId`, users | payments of P (by `projectId`) | none |
| `payments.create` | W | project `projectId` | none | payments +1, events |
| `payments.update` | W | payment `id` | none | payments, events |
| `payments.markReceived` | W | payment `id` | none | payments, events |
| `payments.delete` | W | payment `id` | none | payments -1, events |

### 4.11 Tracker

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `tracker.list` | R | project core of `projectId`, users | tracker of P (by `projectId`; filter type, direction, open), reply tasks by id, files by id | none |
| `tracker.log` | W | project core, files by `fileIds`, users by `peopleIds` and `replyBy.userId` | tasks of P (stage tag, for a reply task) | tracker +1, tasks +1 (reply task), notifications, project, events |
| `tracker.close` | W | entry `id` | reply task by id; status change of the reply task | tracker, tasks (finished or unlinked), the status change writes, events |
| `tracker.update` | W | entry `id`, files by `fileIds`, users by `peopleIds` | as `tracker.close` when the wait for our reply ends | tracker, tasks, events |
| `tracker.delete` | W | entry `id` | reply task by id | tracker -1, tasks (unlinked), project, events |
| `tracker.assignReply` | W | entry `id`, users by `userId` | reply task by id; tasks of P (stage tag) | tasks +1, tracker, notifications, project, events |
| `tracker.export` | R | project `projectId`, users | **events of P with target type tracker: all of them**, replayed in order (by `projectId` + target type). Files by id | none |

### 4.12 System

| Call | Kind | Small reads | Large reads: pattern and scope | Writes |
|---|---|---|---|---|
| `session.resetSampleData` | Proto, W, prepare | none | **prepare** clears the stored data and builds the sample office | every collection |

## 5. Loader rules

Each call uses one loader. The loader reads from Postgres into a `State` of the same shape. For a W call, the loader runs **after** the office lock is taken, so it never reads a value that another write is about to change.

| Loader | Calls | What it loads |
|---|---|---|
| **Office** (every call) | all | Office lists and the project index, from a memory cache in the function. One small `office_version` row tells the function if the cache is current; each save that changes these tables raises it. `counters` loads inside the lock for W calls only. `feedback` loads only for the 4 feedback calls. |
| **Project (P)** | `projects.get` and all project, member, stage and deadline writes; `tasks.*` with a task or project id; `tracker.*`; `files.list`, `files.upload`; `payments.*` | Office, plus: all tasks of P; the newest N posts of P and the newest N feed events of P (N = 2 for the project view, `limit` for `updates.list`, same `filter`), with the comments of those posts; the tracker entries and files of P only for the tracker and file calls (the files of P also for `stages.replace`); the payments of P only for the payment calls. Rows that a call names by id (a tracker entry, a reply task, a file, a comment) load by id. |
| **Task (T)** | `tasks.get` and every task write; `tracker.close`, `tracker.update`, `tracker.assignReply` (for the reply task) | Project (P of T), plus: all events with target T (history, `finishedOn`), all comments on T, all files with `taskId` T. For a status change: the Tracker entry of a reply task and the files it names. |
| **Content** | `comments.*`, `reactions.toggle`, `updates.create`, `updates.update`, `updates.delete` | The comment or post by id, its target task or post by id, its project core, the comments of the target (count), files by id. |
| **Story (C)** | `events.undo`, `events.undoStory` | The event by id or all events of story C (by `correlationId`); for each target in the story, the later events of that target (by target type + id); Project (P) for each project in the story; each row named in an event's `before` (reference check); the notifications of C (by `correlationId`). For an Undo of a create, targeted reference queries instead of the 20-collection scan (section 7.1). Undo events that point at the loaded events, to fill `undoneBy` (section 7.8). |
| **Inbox (person U)** | `notifications.*` | Office, plus: the unread notices of U; for `notifications.list` also the newest read notices of U up to `limit`; the target row of each notice by `targetId`; for each target that is gone, its delete event (by verb `<type>.deleted` + `targetId`). `markRead` and `markUnread` add the notices by `ids`. |
| **Chat (person U)** | `chats.*`, `files.share` to a chat | Office, plus: the chat reads of U; for each visible conversation the newest message and every message after U's read mark; for the task threads of U (tasks U owns, tasks in projects U leads, tasks U commented on) the newest comment, every comment after U's read mark, and one own comment to prove the thread is U's; `chats.messages` loads the messages of one conversation, newest first with a page limit (section 7.5). |
| **Overview** | `projects.list`, `dashboard.get`, `tasks.list` without `projectId`, `deadlines.list`, `search.query`, `events.list` without a filter | Office, plus: the tasks of the projects in scope (by project status; for `tasks.list` an SQL filter that mirrors the input, plus the tasks of each project that has a task with prerequisites); for `projects.list` the newest 2 posts and 2 feed events of each project (one SQL query with a lateral join) and the comments of those posts; for `dashboard.get` the open tracker entries; for `search.query` the candidate tasks and files from the text filter; for `events.list` the newest `limit` events that match. Read-only calls may load trimmed task rows (section 9). |
| **Project delete** | `projects.delete` | Everything of P by `projectId`, the comments on P's tasks and posts, the notices that point at P, at its tasks, posts and chat, the chat of P with its messages and chat reads, the file events of P (prepare), and a query for the data keys that another project still uses (after). Needs the change in section 7.2. |
| **Jobs** | the `jobs` function (`runScheduledTriggers`), not a call | Open tasks with a due day in active projects, paused projects with a restart day, the reviewers, and the notices with the dedupe keys this run can write (section 7.3). |

**Indexes the loaders need:** `events (target_type, target_id, seq)`, `events (correlation_id)`, `events (project_id, seq desc)` for the feed verbs, `events (undoes)`; `notifications (user_id, read, created_at desc)`, `notifications (correlation_id)`, `notifications (target_type, target_id)`, a unique `notifications (dedupe_key)`; `comments (target_type, target_id, created_at)`; `messages (conversation_id, created_at)`; `chat_reads` key `(conversation_id, user_id)`; `files (project_id)`, `files (task_id)`, `file_versions (blob_key)`; `tasks (project_id)`, `tasks (owner_id)` and a GIN index on the helper list; `tracker (project_id)` and a partial index on open waits; `updates (project_id, created_at desc)`; `payments (project_id)`.

**One column to add:** comments have no `projectId` (their target is a task or a post). A server-only `project_id` column on `comments`, set from the target on insert, makes the project loads and `projects.delete` simple. The `State` shape stays the same.

## 6. Places where a partial load gives a wrong answer

These code lines decide on absence or count rows. The loader must give each one the **complete** set that its filter can match, or the code must change.

| # | Code | What goes wrong with a partial load | Rule |
|---|---|---|---|
| 1 | `projects.delete`, comments loop (`projects.ts:414`) | Deletes every comment whose task or post is not loaded: other projects' comments | Change the code (7.2) |
| 2 | `projects.delete`, notifications loop (`projects.ts:418`) | Deletes other projects' task and post notices | Change the code (7.2) |
| 3 | `isUsedElsewhere` (`events.ts:94`) | An Undo of a create deletes a record that a row outside the load still uses | Change the code (7.1) |
| 4 | `undoEvent`, the later events of the target (`events.ts:117`) | An Undo writes over a later change, because the conflict check sees no later event | Load all events of the target |
| 5 | `dropNotices` (`history.ts:250`) | Deletes the notices of a story that still stands | Load all events of the story |
| 6 | `assertReferencesExist` (`events.ts:74`) | Refuses a valid Undo, because a referenced row is not loaded | Load each row named in `before` by id |
| 7 | `isGone` and `viewOf` (`notifications.ts:52`) | A live task shows as deleted; the badge leaves it out | Load the target of each notice |
| 8 | `countComments` (`views.ts:39`) and the file count in `taskRowOf` (`views.ts:240`) | Too low a count | Load all comments or files of each shown target, or use counts (7.4) |
| 9 | `attachmentsOf` (`views.ts:275`) and `replyTaskDone` (`tracker.ts:137`) | A live file reads as deleted; an auto reply entry loses its files | Load the named files by id |
| 10 | `projectRoleOf` (`permissions.ts:15`) | A team member reads as "other", and the call refuses | Load all members (project index) |
| 11 | `addMember` (`shared.ts:70`) | A second insert of the same member | Load all members (project index) |
| 12 | `files.upload`, the same-name check (`files.ts:91`) | A second file instead of version B | Load all files of P |
| 13 | `stages.replace` (`projects.ts:524`) and `members.remove` (`projects.ts:478`) | Removes a stage that still has tasks, or a member with open tasks | Load all tasks of P |
| 14 | `directWith` (`chats.ts:233`) | A second direct chat for the same two people | Load all conversations (project index) |
| 15 | `taskThreads` (`chats.ts:81`) | A thread disappears from the Inbox | Load the task of each thread |
| 16 | `finishedOn` (`tasks.ts:95`) | The lateness counts from today, not from the review day, so dependents move too far | Load all events of the task |
| 17 | `eventLabel` (`views.ts:54`) | Empty labels in the feed and the meeting summary | Load the target row of each shown event |
| 18 | `nextProjectCode`, `pickMark`, and the unique-name checks (users, teams, templates) | A second project code, colour or name | Load these small lists whole |

## 7. Handlers that need a small change

### 7.1 `isUsedElsewhere` in `events.ts` (must change)
The Undo of a create scans every collection except events and notifications, 3 levels deep, for any value equal to the target id. In the tests it scanned 20 collections, messages and chat reads included. A scoped load cannot answer it. **Change:** an explicit reference map per target type (for example: a file id can be in `comments.fileIds`, `messages.fileIds`, `updates.fileIds`, `tracker.fileIds`, `projects.coverFileId`; a task id in `comments.targetId`, `files.taskId`, `tracker.replyTaskId`, `tasks.prerequisiteIds`, `dateNotes.byTaskId`). The prototype uses the same map, so its tests prove it gives the same answer. The server runs one `EXISTS` query per entry. Note: a direct chat message can carry a project file (`attach.ts`), so the file check must include messages outside the project.

### 7.2 `projects.delete` in `projects.ts` (must change)
The run deletes comments and notices by absence (rows 1 and 2 above), and `after` scans all files for a data key in use. **Change:** collect the ids of P's tasks and posts before the drops, then delete the comments and notices that point at those ids, at P, or at P's chat. In `after`, ask the database which of the keys a file version still uses.

### 7.3 `notify` dedupe in `notify.ts` (must change, jobs only)
`notify` scans all notifications when it gets a `dedupeKey`. No call passes one; only `runScheduledTriggers` does (`notify.ts:82`, `87`, `96`). The recorder confirms that no call scans notifications through `notify`. **Change:** give `notify` a lookup for "is this dedupe key used", backed by the unique index, or let the job load the notices of the keys it can write before it runs.

### 7.4 `countComments` and the file count in `views.ts` (should change)
`tasks.list` counts comments and files with one scan per row (23,241 comment scans in the test run). `feedFor` counts the comments of every post of P before it keeps 2. **Change:** let the loader put counts in `State` (for example an optional `counts` map) and let both helpers read it first, with the scan as the fallback. The prototype keeps its behaviour.

### 7.5 Chats in `chats.ts` (should change)
`chats.messages` returns every message of a conversation with no limit, and `chats.list` returns every task thread the person was ever part of. Both grow without end: a project chat can hold thousands of messages after 3 years. **Change:** a page limit on `chats.messages` (a `before` stamp and a `limit`), and a limit on the task threads of `chats.list`. The loader rule for unread counts (section 5, Chat) needs no code change.

### 7.6 Reactions (save step)
`reactions` is a field of each comment. Spec 2, section 6 lists a `reactions` table. If the database keeps that table, the loader must rebuild `comment.reactions` from its rows, and the save step must turn a changed `reactions` field into row inserts and deletes. Only `reactions.toggle` and the Undo of `comment.reacted` change it.

### 7.7 `counters` (save step, spec gap)
`nextId` reads and writes `state.counters` on every create, and each event's `seq` is `counters.evt`. Spec 2, section 6 does not list a counters table. **Rule:** keep a `counters` table, read and written inside the office lock in the same transaction. Postgres sequences would leave gaps after a rollback, which the prototype never does.

### 7.8 `undoneBy` (save step)
`undoEvent` sets `event.undoneBy`, which is an update. Spec 2, section 5.6 forbids updates on `events`. **Rule:** the undo event gets a field that names the event it undoes (`undoes`). The loader fills `undoneBy` from those undo events. The save step writes the new undo event and ignores the `undoneBy` change. Every event load must also load the undo events that point at it, because many handlers filter on `undoneBy`.

### 7.9 `deletedCopy` in `notifications.ts` (no change needed)
It scans all events once for each notice whose target is gone. With the Inbox loader (only the delete events of the gone targets), the scan is short and the code can stay.

### 7.10 Read paths that create a collection
`trackerOf`, `feedbackOf`, `teamsOf`, `stageTemplatesOf` and `taskTemplatesOf` add a missing collection (`??= {}`). The recorder saw this "write" in read-only calls on old test offices. The loader always gives these collections, so it does not happen on the server.

## 8. Size estimate for an office of 15 people

**Rates assumed** (12 people do project work, 240 working days a year): 30 new projects a year, 7 stages, 5 members, 6 deadlines and 5 payments each; 3,000 tasks a year (about one per person per working day); 2 comments per task; 1 post per active project per week; 2,000 file records and 2,000 Tracker entries a year; 10 chat messages per person per working day; about 7 notices per task; about 12 events per task (all event kinds together). Bytes per row come from the sample office (events 585 measured, rounded to 600; tasks 389 measured, raised to 450 for checklists, date notes and versions).

| Collection | Bytes per row | Rows after 1 year | MB after 1 year | Rows after 3 years | MB after 3 years | Load |
|---|---|---|---|---|---|---|
| events | 600 | 35,000 | 21.0 | 105,000 | 63.0 | scoped: by target, by story, newest N of P |
| messages | 254 | 36,000 | 9.1 | 108,000 | 27.4 | scoped: by conversation, after the read mark |
| notifications | 204 | 20,000 | 4.1 | 60,000 | 12.2 | scoped: by person (unread + newest N), by id, by story, by dedupe key |
| comments | 249 | 6,000 | 1.5 | 18,000 | 4.5 | scoped: by target, by id |
| tasks | 450 | 3,000 | 1.4 | 9,000 | 4.1 | scoped: by project; by project status for the overview |
| chatReads | 111 | 6,500 | 0.7 | 19,500 | 2.2 | scoped: by person |
| tracker | 345 | 2,000 | 0.7 | 6,000 | 2.1 | scoped: by project, by id, open waits |
| files | 301 | 2,000 | 0.6 | 6,000 | 1.8 | scoped: by project, by id, by task |
| updates (posts) | 252 | 1,200 | 0.3 | 3,600 | 0.9 | scoped: newest N of P, by id |
| payments | 218 | 150 | 0.03 | 450 | 0.1 | scoped: by project (payment calls only) |
| projects, members, stages, deadlines, conversations | 85 to 662 | 660 | 0.1 | 1,890 | 0.3 | whole, from the cache |
| users, teams, clients, templates, feedback | 86 to 496 | 130 | 0.04 | 310 | 0.1 | whole, from the cache (feedback on demand) |
| **Total JSON** | | | **39.6** | | **118.6** | |

**On disk:** row headers, JSONB and indexes roughly double the JSON size. So plan for about 80 MB after 1 year and about 240 MB after 3 years, against the 500 MB of the free plan. This agrees with spec 2, section 15 ("under 100 MB in the first year"). Events and messages are 76% of the total. The 80% warning (400 MB) comes at about year 5 at these rates.

**One project:** about 100 tasks, 1,170 events, 200 comments, 67 files and 67 Tracker entries a year. A long project has about 3,500 events (2.1 MB) after 3 years. That is why no call loads all events of P.

## 9. What loads whole, and what loads scoped

**Load whole per request (from the memory cache):** users, teams, settings, clients, stage templates, task templates, projects, members, stages, deadlines, conversations. Together 118 KB after 1 year and 314 KB after 3 years. `counters` loads whole inside the lock. `feedback` loads whole only for the feedback calls.

**Load scoped, never whole:** events, messages, notifications, comments, chat reads, tasks, tracker, files, posts, payments. Section 5 gives each one's keys.

**Why the cache matters (egress):**
- Supabase's free plan includes 5 GB of egress a month, and counts the bytes that the database and the shared pooler send to a client (Supabase docs, "Manage Egress usage" and "All about Supabase Egress"). The Edge Function is such a client. We must assume its loads count, and measure it at build step 1.
- Spec 2 expects about 150,000 requests a month. 5 GB over 150,000 requests is about 33 KB per request, for the load and the answer together.
- A fresh load of the office lists and the project index on each request would use about 17.7 GB a month in year 1. So the cache is not optional.
- The worst scoped loads are the overview calls: all tasks of 25 active projects is about 1.7 MB at full width. `projects.list` and `dashboard.get` read only `id`, `projectId`, `stageId`, `status`, `dueDate`, `ownerId`, `helperIds`, `createdAt` and `completedAt` of a task (the stage tag uses only `stageId` and `status`). A read-only call can load trimmed task rows of about 150 bytes, because a read never saves. If that is still too much, the summary table of spec 2, section 18 is the next step.
- **Spec gap:** spec 2, section 15 lists 6 free-plan limits and not egress. It should list "Egress: 5 GB a month", with an Admin warning at 80%.

**CPU (2 seconds per request):** the scoped loads also keep the handlers fast. With whole loads after 3 years, `projects.list` would count comments for every post of 25 projects against 18,000 comments (about 67 million compares), and `chats.unreadCount` would scan 108,000 messages for each of up to 100 conversations. Both pass 2 seconds. With the loads of section 5, each is a few thousand compares.

**Hot calls:** in the screen tests, the calls that ran most were `session.get` (1,756 runs), `taskTemplates.list` (1,538), `users.list` (1,136), `tasks.list` (1,012), `notifications.count` (885), `chats.unreadCount` (881) and `projects.get` (849). The app shell mounts the badges and lists on every screen, so these loads must be the cheapest: the first three come from the cache only, and the two badge counts read only unread rows.

## 10. Async work outside the state

| Call | Hook | Prototype | Real build |
|---|---|---|---|
| `files.upload` | prepare | Stores the file data in IndexedDB | The browser gets a signed R2 upload link (spec 2, section 8), sends the file, then calls `files.upload` with the object key |
| `files.get` | prepare | Reads the file data | Returns a signed R2 link for 10 minutes; no data passes the server |
| `feedback.send` | prepare | Stores up to 3 screenshots | Signed R2 uploads, as for files |
| `feedback.screenshot` | prepare | Reads one screenshot | A signed link |
| `projects.delete` | prepare and after | Collects the data keys of P's files and file events, then removes the keys no other file uses after the save | Same, with an R2 delete after the database commit and the key check as a query (7.2) |
| `session.resetSampleData` | prepare | Clears the data and builds the sample office | Removed (prototype only) |

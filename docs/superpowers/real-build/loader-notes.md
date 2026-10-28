# Loader notes: detail for each feature

The per-feature detail of the loaders in `server/data/loaders/`. The rules that a change can break silently are in
`server/data/CLAUDE.md`. Each note here is pinned by the tests it names.

## Office tasks (no project)
`officeTaskConds` (`steps.ts`) is the view rule in SQL. A read with a limit loads each kind with its own limit (search), or
filters in SQL first (`events.list`: `officeTaskId` of the tasks the person sees), so the cut of the handler gives the same rows.
`trapOffice` (`sweep.ts`) holds office tasks and ties at the cut of the newest rows (`newestTies`, in prj_004) for the sweep.
`badgeTraps` holds the badge and bell cases: a tie with the own last comment, a helper, a task that an agent made, a hidden
notice, a gone task and a report. `hiddenProjectTraps` (`sweep.ts`, in `trapOffice`) adds a hidden project (leader usr_005, team
usr_006, chosen usr_007) with a to-do, a comment, a post and a chat line, and `hiddenProjectWrites` its writes, so the signal
invariants (`test/invariants.ts`) see a hidden part. The Inbox loader (`inbox.ts`, `deletedProjects`) also brings the
`project.deleted` event of every project that a notice names through its item and the office no longer holds, because
`noticeProjectHidden` fails closed without it.

## Hidden projects in SQL
The view rule of a project in SQL is `visibleProjects`, `visibleIds` and `projectConds` (`steps.ts`), built from
`L.office.projects`, `L.office.members` and `L.authority` with `projectViewer` (`src/api/projectView.ts`). Every read across
projects takes its ids from them: `projects.list`, the Dashboard, `tasks.list` (through `peopleFilter`), the search (tasks,
files, comments; each kind keeps its own limit), `reports.office`, `meetingConds`. `eventProjectConds` (`steps.ts`) is the
condition of `events.list` and of the office stage-move count: `project_id notIn` the projects the person does not see and the
deleted projects the person did not see (`goneProjects`, `viewsGoneProject`: hidden at the delete, or open and the person was not its
leader, team, chosen person or a holder of `project.seeAll`). A holder of `project.hidden` needs no pre-read. Any other person costs one
read of the `project.deleted` events (a few rows), and of the member changes of a project whose delete event has no team list, before the
main read. The story loader (`events.undo`, `events.undoStory`) calls `goneProjects` for the projects of its events. The task threads of the Inbox take `ThreadsArgs.seen` (the visible
ids): `threadsSql`, `memorySource` and `lite/source.ts` keep a thread of a project task only when its project is in `seen`, so
the cut by `limit` never counts a thread that the handler drops. `hiddenTraps` and `hiddenSweep` (`sweep.ts`) fill each SQL limit
with rows of a hidden project, and the tests of `loaders.test.ts` check that the visible rows stay.

## Read indexes
- `20261007000100_read_indexes.sql` adds the statistics `events_office_task` on `doc->'officeTaskId'` and the indexes
  `events_created_c`, `events_project_created`, `messages_conversation_newest`, `comments_target_id` and `events_target_id`, then
  runs analyze. `server/it/readIndexes.it.test.ts` checks that the loader statements use them on growth data.
- `20261022000300_read_indexes_perf2.sql`: `comments_author_task` (the threads statement), `notifications_inbox_c` (it replaces
  `notifications_inbox`: the unread read and the newest read ones, in text order), and the partial index `events_report_verbs`
  (the five report verbs, for `reports.office`). `readIndexes.it.test.ts` pins each plan.
- A Select with `per`, a limit and a top-level in-list on the `per` column reads each key with a LATERAL subquery on the index of
  that key (`fetch first n rows with ties` for ties, else `limit n`). Every other Select with a limit keeps the `rank()` or
  `row_number()` window form. Both forms give the same rows in the same order (`sqlSource.ts`, `selectSql`).
- A Select with a limit, no `per`, no ties and an order that ends with the id (`order.id`) takes the plain LIMIT form: one key of
  an in-list reads as an equality, the order is the order columns and the id (no `t.ord`), and the outer `order by x.ord` keeps
  the row order. An index in that order then gives the first rows with no sort (the Inbox list, `notifications_inbox_c`).
- A field pick (`Select.pick`) returns one jsonb array for each row: a mask first (bit i is 1 when the doc has no key i), then the
  value of each key in the order of the pick. `sqlSource.select` builds the object back (`unpick`), in the key order of jsonb, so
  an absent field stays absent and a JSON null stays null. The key names never repeat in a row and go in one array parameter,
  never in the SQL text. A pick of more than 50 keys keeps the object form with `jsonb_each` (Postgres takes at most 100
  arguments in a function call, and the array holds the mask and one value for each key).
- `atOrAfter` (`events.list` since) adds a text lower bound on `created_at collate "C"`: the UTC text of the time minus 36 hours.
  The timestamptz test still decides, so the bound never removes a row. A count with a bounds condition on its `per` column
  counts each key in a LATERAL subquery on that column (a plain join let Postgres scan every message at 15,000 messages).
- `after` is the mirror of `before`, and `order.asc` reads oldest first (no ties); `chats.messages` with `around` uses both.
  `contains` sends an escaped LIKE on Postgres (`likeOf`, `sqlSource.ts`), so a trigram index serves it; memory and SQLite keep
  the substring test.
- `referencing` (the Undo check of a create) sends one equality on the text column when the reference path is one plain field
  with a text column in `query.ts` (`columnOfField`). A list or nested path keeps `jsonb_path_exists`.

## Search
`search.query` reads the message hits after its other reads (`messageHits`, `loaders/overview.ts`): the newest 5 live messages of
the visible chats, the newest 5 comments of project tasks (the read goes again without a task that the load does not hold,
because Postgres keeps the project of the comment of a deleted task), and the newest 5 comments of the office tasks that the
person sees. `OFFICE_TASK_HIT` adds the title to the pick of those tasks. `source.sweep.test.ts` lets these three statements sort
in a temporary b-tree: they scan `search_text` on the office path until the restart.

## Picks and leaks
- `chats.unreadCount` has its own loader (`chatsUnread`), with `THREAD_TASK_FIELDS` and `THREAD_COMMENT_FIELDS` (`chat.ts`).
  `notifications.count` reads its targets with `INBOX_TASK_FIELDS` (`inbox.ts`), and posts with `INBOX_UPDATE_FIELDS` (id and
  project: `noticeProjectHidden` reads the project of a post) and reports with the id only, and its own unread notices with
  `INBOX_COUNT_NOTICE_FIELDS` (count mode only: the list and the writes keep whole rows). `chats.list`, `chats.markRead` and
  the notification writes keep whole rows.
- Picks that never save a row: the jobs loader reads each open task with `JOB_TASK_FIELDS` and only the tasks past due or due
  within `JOB_DUE_AHEAD_DAYS` of the run (`atBefore` on `due_date`; with no run time it reads every open task); `reports.office`
  reads the Tracker lines with `REPORT_TRACKER_FIELDS`; `tasks.list` reads the tasks of a waiting project a second time only
  when its first read had a narrowing condition. `perf2.test.ts` pins each one against the whole office.

## Chat counts
- The unread count and the reply that waits of a task thread read the messages only: the chat loader adds `MESSAGES_ONLY`
  (`dates` and `kind` null) to the count, to the newest message and to the own newest message, and keeps the reads of the newest
  item of any kind (the preview, the order, who is in the thread). Change `taskUnread` and `waitingThread`
  (`src/api/handlers/chats.ts`) with it.
- The unread count of a chat is one grouped count, or two: the project chats that `countsNamedOnly` marks (the Admin's chats of
  projects that the Admin neither leads nor works on, with no stored `notify: 'all'`) get a second grouped count with the extra
  condition `{ has: 'mentions', value: userId }`; every other chat keeps the first. Change `unreadIn` (`src/api/chatState.ts`)
  with it.
- The choice of the Admin (`adminReachOf`) feeds the same rule in the loader: `chatsOf` passes it to `countsNamedOnly` (`all`
  counts every message), and `chatsAll`, `chatsUnread` and `chatsMarkRead` read the chats through `listed(L)` (`mine` leaves out
  the project chats with the role `other`, `hiddenByReach`). `chats.markRead` of such a hidden chat loads that chat by itself
  (`chatsOf`), because the list no longer does. `loaders.test.ts` keeps the whole office and the scoped load equal for each
  choice. A copy of a notice has `forUserIds` and no column.

## Batches
`Load.batch(steps)` sends reads that do not depend on each other as ONE statement: `sqlSource.batch` joins them with `union all`
(`batchSql`) and gives one row for each read, with that read's rows as one jsonb array (`jsonb_agg`). The chat loaders (`chat.ts`:
`everyChat`, `chatsWaiting`) run in rounds. One read left in a batch keeps its own statement. `loaders.it.test.ts` pins the
statement count for the badge and the list.

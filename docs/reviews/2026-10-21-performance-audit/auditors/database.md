# Database audit (key: database, prefix DB), Madar at 1d45aae5, 2026-10-21

Scope: plans, indexes, writes, Realtime publication, RLS, triggers, the bytes that each loader moves. Local stack only (Postgres 17.11, Docker, 128 MB shared_buffers, default planner settings). Production and the test copy were not touched. The Docker lock was held as `perf-db` and released. `deploy-test` was not changed (git status clean).

## How I measured

- Fixture: the one-year office of `server/office/test/yearOffice.ts` (the sample office grown by clones), adjusted so each table has the size of the brief: 60,909 events, 6,100 tasks (85 for each of 72 projects), 20,000 comments (spread over all tasks), 15,000 messages (200 for each of 75 chats), 30,000 notices (10 people, 300 unread each), 3,000 posts, 6,000 files, 1,500 Tracker lines, 1,500 meetings, 5,780 read marks, 60 push devices. Written with the real save step (`writeState`) as the postgres role, then re-ordered so that `ord`, `created_at` and `seq` follow insertion order (as in production, where the History only grows). A first pass left events out of order and the planner chose a seq scan with a 15 MB disk sort for `events.list`: that was a fixture fault, not a finding (checked, fixed with CLUSTER, and the plan is the index plan again).
- Reads: the real loaders (`loadFor` with `sqlSource`) for 46 call shapes, as `usr_001` (Admin) and `usr_005` (Member), inside a repeatable-read read-only transaction with `set local role madar_server` (RLS on). Each statement ran once for its rows and bytes, then EXPLAIN (ANALYZE, BUFFERS), best of 3 after one warm-up. Output: `audit/db-probe-4.md` (all calls), `audit/db-probe-5-before-*.md` and `db-probe-5-after-*.md` (chat calls before and after the fix).
- Writes: the real `runCall` with `realtimeSender`, the mail, push, Google and auth producers registered, as `madar_server` with real commits (`audit/db-write-2.md`).
- Scripts (in my copy): `scratchpad/copies/database/server/it/perf*.mts`, `exp.mts`, `e1..e9.mts`. Captured statements with their parameters: `audit/captured.json`.
- Load on the Mac was 2 to 4 during the runs. Timings are in-database milliseconds on localhost. Add one network round trip for each statement for the real Frankfurt path (not measured, see "Not checked").
- Existing pins: `server/it/readIndexes.it.test.ts` passes 6 of 6 on this commit.

## The numbers that matter

Bytes are what the database sends to the Edge Function (the guide `access-map.md` says Supabase counts them as egress; 5 GB a month is 33 KB a request at 150,000 requests).

| Call | statements | DB ms | rows | bytes |
|---|---|---|---|---|
| office lists, cold (every request on Supabase) | 1 | 3.3 (JS parse + freeze 5) | 1,118 | 263,316 |
| dashboard.get Admin, active / all | 6 | 35 / 48 | 5,127 / 6,745 | 1,351,000 / 1,770,000 |
| dashboard.get Member | 5 | 35 | 5,091 | 1,343,000 |
| reports.office year / month / week | 7 | 81 / 49 / 45 | 7,667 | 2,224,000 |
| tasks.list all (Admin) | 5 | 24.5 | 9,659 | 2,188,000 |
| projects.list active / all (Admin) | 8 | 19 / 26 | 4,894 / 6,526 | 843,000 / 1,125,000 |
| tasks.list mine (Member) | 4 | 4.6 | 1,274 | 275,000 |
| jobs loader (every 15 minutes) | 4 | 14 | 1,630 | 676,000 |
| chats.unreadCount Member / Admin (the badge) | 9 / 10 | 24 / 33 | 588 / 630 | 66,000 / 75,000 |
| chats.list Member / Admin | 10 / 11 | 29 / 43 | 625 / 705 | 131,000 / 162,000 |
| chats.markRead | 13 | 32 | 646 | 131,000 |
| chats.messages (open one chat) | 5 | 6.9 | 62 | 15,000 |
| notifications.count (300 unread) | 3 | 0.4 | 309 | 67,000 |
| notifications.list | 4 | 3.3 | 417 | 93,000 |
| events.list 50 Admin / Member | 6 / 7 | 0.9 / 0.7 | 400 / 250 | 220,000 / 135,000 |
| meetings.list default | 1 | 0.3 | 45 | 24,000 |
| search.query | 6 | 2 to 4 | 15 | 5,000 |

Writes (statement counts, plus BEGIN and COMMIT): chats.send 14, comments.create 14 (18 with a mention), tasks.update that makes notices 23, tasks.move 19, chats.markRead 18, notifications.markAllRead 11. Each statement takes 0.3 to 1.0 ms. The office lock is held 9 to 25 ms on localhost for those calls (`tx total` lines in `db-write-2.md`).

Size of the year: 115 MB in `public` (events 64 MB, comments 13, notifications 13, messages 11, tasks 3.7, files 3.2).

## Checked and fine (no finding)

- Realtime publication: `supabase_realtime` holds no table (`pg_publication_tables` is empty). A write on a big table causes no Realtime or logical-decoding work. The only Realtime cost is the explicit `realtime.send` of the save: one statement, 0.5 ms, one insert for each signal into the day partition of `realtime.messages`.
- RLS: `madar_server` pays nothing measurable for the `server_all` policy. dashboard task read 31.8 ms as postgres and 31.9 ms as madar_server; the plan time is the same. `madar_private.current_madar_user_id()` (the Realtime policies) takes 14 microseconds a call.
- Triggers: the only app trigger is `events_append_only` (before update or delete). It costs nothing on insert.
- Index upkeep: 20,000 events into a table with the 8 secondary indexes take 272 ms, and into a table with only the key and seq index 97 ms. That is 8.7 microseconds for each event. At 167 events a day it is 1.5 ms a day. Do not drop an event index for write cost. Writes to `office_meta`, `counters` and `person_seq` are all HOT updates (19 of 19, 15 of 15, 5 of 5).
- The 2026-10-08 plans still hold: events by seq, feed LATERAL on `events_project_created`, newest message LATERAL on `messages_conversation_newest`, comment counts by index-only scan, `chat_reads_conversation` (0.02 ms), meetings window (0.3 ms), the message search (trigram index, 0.9 ms), the push loaders, `SETTLE_SQL`/`EXTEND_SQL` (0.02 to 0.04 ms). Meetings, reactions, sub-companies, push devices and Google tables cost nothing at this size.
- Plans of the paused SQLite path were not looked at.

## Findings

IDs match the structured result. Fix texts are tried on the local stack where a number is given.

### DB-1 The office lists load in full on every request (263 KB)
`readOffice` caches in module memory (`server/data/officeCache.ts:119-170`), but a Supabase worker serves one request and stops (`server/CLAUDE.md`, "Supabase serves each request with a new worker", measured 2026-10-16). So each request reads `OFFICE_ROWS_SQL` with `chg > -1`: 13 tables, 1,118 rows, 263,316 B, 3.3 ms in Postgres and about 5 ms of JS (pg parse, deepFreeze, build; 13 ms the first time). By collection: projects 62.6 KB, stages 63.3 KB, deadlines 24.6 KB, members 14.8 KB, conversations 9.1 KB, users 7.3 KB, templates 6.2 KB. It runs in front of every call: the 12-call batch (once), `chats.typing` (a server call that reads `ctx.office`, one signal each 5 s per typist), `files.link`, the cron. At 33 KB a request the guide's own budget, this one read is 8 times the budget. The size grows with projects (72 here), 7 stages and 3 deadlines for each.
Fix: let a call name the parts it needs. `stages` and `deadlines` (88 KB, 33%) and the templates (6 KB) are not needed by `notifications.count`, `chats.unreadCount`, `chats.typing`, `push.*`, `files.link`. Light calls would read about 95 KB. `OFFICE_ROWS_SQL` is built from `OFFICE_COLLECTIONS` already, so the statement can take a subset; the in-isolate cache must then track what each entry holds. Risk: a handler that reads a list it did not declare sees an empty list (silent). A test that runs every call with only its declared parts (`everyCall`) would catch it. regression: the 2026-10-07 plan relied on the cache being warm ("the office lists must come from a memory cache"); since the isolate rule it is cold on Supabase.

### DB-2 The 15-minute job loads the whole open-task table and the office (about 0.95 MB a run)
`server/data/loaders/jobs.ts:15` reads every open task of every active project as whole docs: 1,609 rows, 675,450 B, 14 ms, plus the office 263 KB. 96 runs a day, 2,880 a month, also at night and at weekends: about 2.7 GB a month, over half of the 5 GB egress, with no person using Madar. The step also holds the office lock while it loads and clones the State (`jobs/steps/triggers.ts`): 22 ms for the load plus 13 ms for the dedupe pass on localhost, so every user write waits that long, 96 times a day.
`runScheduledTriggers` (`src/api/notify.ts:186-231`) reads only `status`, `dueDate`, `projectId`, and through `peopleOfTask`/`mayViewTask` the lead, helpers and maker. Only a task that is overdue or due within one working day gives a notice.
Fix, measured: `pick` of 7 fields (`id, projectId, status, dueDate, ownerId, helperIds, createdBy`): 267,145 B (-60%). With `due_date <= today + 4 days` on the generated text column `due_date` as well: 1,113 rows, 185,242 B (-73%). Both give the same notices; no task row changes, so the save writes nothing new. The unit and `jobs.it` tests must confirm the field list. A new text condition (`dueBy`) is needed in `query.ts`, `sqlSource.ts`, `memorySource.ts` (the SQLite compile too), or the pick alone.

### DB-3 dashboard.get reads every task of the scope: 1.35 MB, and the handler spends 250 ms on them
`server/data/loaders/overview.ts:69` (`tasksOf(L, ids, DASHBOARD_TASK_FIELDS)`): 4,630 rows (active) or 6,100 (all), 1,351,054 B and 1,769,734 B, 35 to 48 ms (the plan sorts 1.5 to 2 MB by `ord`). It runs on Home for people with the switch and on the Dashboard: `DashboardScreen.tsx:64-65` asks twice (`active` and the shown status) when they differ, and the `office` read rule runs it again after each change of tasks, projects, events and others. The handler spends 248 ms of CPU on those rows on the Mac (`handlers/insights.ts` filters `tasks` once for each project and 12 weeks); 330 ms in all in `runCall`. The 2026-10-08 proof measured 0.95 MB on smaller task docs; the fields of `DASHBOARD_TASK_FIELDS` now add `title` and `createdBy`.
Fixes, measured on 6,100 rows: (a) array encoding of picks (DB-4 below) 1,772,663 B -> 1,077,263 B (-39%); (b) no `title` for tasks that are not `in_review` (the title only shows in the review rows): -10%; (c) done tasks older than 12 weeks that no stage tag, health or throughput rule reads, counted in SQL by (project, stage, status): rows 4,630 -> about 3,000 here and fewer each year; this needs the stage tag and health rules (`flow.ts`, `health.ts`) proven on counts, so it is the large one. Also tell the server side: group `tasks` by project once in `dashboardGet` (it is O(projects x tasks)).

### DB-4 Picked rows repeat their key names in every row
`pickSql` (`server/data/loaders/sqlSource.ts:117-126`) returns each picked doc as a JSON object: the 11 key names and the `": "` spacing of jsonb text are about 40% of the bytes of a task row. Returning `jsonb_build_array(values)` and rebuilding the object in `sqlSource.select` from the pick list (absent keys need a bit mask, because jsonb cannot say "absent") cuts the dashboard rows 39% (measured above) and helps every picked read: dashboard, projects.list (710 KB of 843 KB are task picks), reports, the thread and notice picks, `pickedByKey`. No change to the Source contract: the rows come out as before. Risk medium (absent vs null; the loader tests `sqlSource.test.ts` and `loaders.it.test.ts` pin it). Effort M.

### DB-5 The unread count joins the whole message table (regression of DB-6)
`countSql` joined branch (`sqlSource.ts:182-195`): `from jsonb_to_recordset($1) b join messages t on t.conversation_id = b.k where <bounds>`. At one year the planner chooses a hash join and a seq scan of all 15,000 messages for any number of keys: 6.6 to 8.2 ms (1,665 buffers), and a second one for the chats that count only mentions. `chats.messages` pays it for one key (6.9 ms to open a chat). It runs in `chats.list`, `chats.unreadCount` (the badge in the tab pill), `chats.markRead` and `chats.messages`. The 2026-10-08 fix (join on the key so each key uses its index) holds only while the planner agrees; here it does not, and the cost grows with the message table: join form 1.4 / 2.6 / 4.0 / 5.3 / 6.7 ms at 3k / 6k / 9k / 12k / 15k messages, lateral form 0.11 to 0.40 ms.
Fix, tried: count with a LATERAL subquery for each key:
`select b.k as v, x.n from jsonb_to_recordset($1::jsonb) as b(...) cross join lateral (select count(*)::integer as n from messages t where t.conversation_id = b.k and <same terms>) x where x.n > 0`.
Same rows (checked on the six counts and by `server/it/loaders.it.test.ts`, 9 of 9). Worst case (37 chats never opened) 10.7 -> 5.8 ms. In the real loaders: chats.messages 7.0 -> 0.7 ms, chats.unreadCount Admin 33.4 -> 15.9 ms, Member 24.4 -> 14.4 ms (with DB-6), chats.list Admin 43 -> 26.7, Member 28.7 -> 19.5, chats.markRead 32 -> 22. The unit pin `sqlSource.test.ts:117` (the old text) must change with it. No write cost. Same change for the comments count (already an index plan, 0.7 -> 0.55 ms).

### DB-6 The task threads read scans the comment table twice
`threads()` (`sqlSource.ts:248-275`), one statement in each of `chats.list`, `chats.unreadCount`, `chats.markRead`, `chats.waiting`: seq scan of all 20,000 comments for `doc->>'authorId' = any(me)` (the `mine` CTE, 5 ms) and a hash join with a second scan for the thread maxima, 2,319 + 2,742 buffers. 13.4 to 17.4 ms of the 24 to 43 ms of those calls. It grows with comments.
Fix, tried: `create index comments_author_task on comments (target_type, (doc->>'authorId'), target_id);` The statement text stays. Member 13.4 -> 9.5 ms, Admin 17.0 -> 10.2 ms, same rows. Adding a rewrite of the thread maxima as a LATERAL (index probe for each candidate task) gives 9.1 ms, little more, so the index alone is enough. Write cost: 20,003 comment inserts 435 -> 482 ms (+2.3 microseconds for each comment). Remaining cost is the seq scan of `tasks` for the OR condition (about 7 ms), which would need the candidate set rewritten as a union of index reads (tried; the planner did not take it).

### DB-7 events.list reads every private meeting of the person, whole, on every call
`privateMeetingsOf` (`loaders/meetings.ts:36`, used at `overview.ts:201`): `meetings where project_id is null and (organizer or attendee)`, whole docs, no limit: 300 rows / 169,369 B for the Admin and 150 rows / 84,685 B for a Member, for 1,500 meetings a year, on each `events.list` (History, feeds). It grows with the years. The loader only needs the ids for its SQL condition, and the handler (`handlers/history.ts:67-69`, `seesEvent`) reads `projectId, organizerId, attendeeIds` for the view rule, and the label reads `title`.
Fix, measured: pick `id, projectId, organizerId, attendeeIds, title`: 84,685 B -> 22,129 B (-74%). Careful: a picked row stays in the State, so a later `byKey('meetings')` keeps the picked copy (`pickedByKey` rule in `server/data/CLAUDE.md`): the pick must hold every field that `eventTargets` and `lineMinutes` read for a meeting target, and a project-less meeting has no Tracker line. Leak tests of the meeting rule (`meetings.it.test.ts`) stay.

### DB-8 The bell count reads every unread notice whole
`inboxCount` (`loaders/inbox.ts:22-26`, `:50-55`): `unreadOf` selects `notifications where user_id = any and read = false` with whole docs. 300 unread: 66,481 B on each `notifications.count`, which is the second badge of the tab pill, refetched after each signal that touches notices, projects, tasks, updates or users. The count reads `userId, read, trigger, targetType, targetId` (and `feedback` for a report notice) (`handlers/notifications.ts:91-105,222-227`). A person who never clears the bell keeps a growing backlog (2,000 notices for each person a year).
Fix, measured: pick of those fields in the count mode (`!L.write`): 64,787 -> 38,687 B (-40%). markAllRead and the list keep whole rows (the write needs them).

### DB-9 notifications.list sorts all read notices of the person
`selectSql` window form (`sqlSource.ts:157-170`) orders by `created_at collate "C" desc, id collate "C" desc, ord desc`. The index `notifications_inbox (user_id, read, created_at desc)` has the default collation, so Postgres reads all 2,700 read notices (bitmap scan, 2,327 buffers) and sorts 859 KB to keep 100: 2.7 to 3.3 ms, linear in the age of the account (about 10 ms after three years). The `= any(array)` form also stops an ordered scan.
Fix, tried: one-element in-lists as equality (`t.user_id = $1::text`), the plain LIMIT form with the outer `order by ord`, and `create index notifications_inbox_c on notifications (user_id, read, created_at collate "C" desc, id collate "C" desc)` (it can replace `notifications_inbox`; the unread read stays an index read on the first two columns): 2.44 -> 0.09 ms (80 buffers instead of 1,806), same rows. A new index next to the old one costs nothing measurable (30,003 inserts 259 vs 247 ms; 3,000-row markAllRead 60 vs 63 ms). The same one-element rule is general: any limited read with one key could use its order index.

### DB-10 reports.office moves 2.2 MB whatever the period, and scans the event table four times
`loaders/report.ts:35-36`: all 6,100 tasks (1,657,779 B, 41 ms, sort 2 MB) and all 1,500 Tracker lines whole (539,415 B) for a week as well as for a year; the handler counts the days itself. Then 4 event reads (`report.ts:41-53`) for the year each scan 20,300 events: 10.0, 8.5, 7.9 ms (a parallel seq scan, 6,500 buffers), about 27 ms; the week and the month use `events_created_c`.
Fix, tried: a partial index with the five report verbs: `create index events_report_verbs on events (verb, created_at collate "C") where verb in ('project.stage_changed','project.status_changed','project.paused','task.approved','task.sent_back');` 10.0 -> 2.5 ms for the stage count, 8.8 and 9.3 -> 0.02 ms for the other two (these verbs are few in my fixture, so the review read is not shown; the pattern is the same). The index only takes the inserts of those verbs. Tracker lines: pick the fields the report reads (`id, projectId, direction, date, waiting, closedAt`). Tasks: array encoding (DB-4). The report is a weekly screen, so the impact is low.

### DB-11 Two reads of the same tasks (tasks.list)
`tasksList` (`overview.ts:117-119`): a listed open task that waits for others brings every task of its project, again. For the Admin's `all` list the projects are the same ones read in the first statement: 507 rows, 204,059 B read twice (0.3 ms). Skip the projects whose tasks the load already holds in full (a set of loaded project ids in `Load`). For narrow lists (`mine`) the read stays. Also: `count(...) where target_id = any($1)` over 4,576 ids plans for 9.7 ms (8.2 ms to run) in the `all` list.

### DB-12 A save sends 11 to 25 statements
From `db-write-2.md`: lock, office_meta, story insert, loader reads, counters select, `office_meta` update, one upsert for each table, counters upsert, `person_seq`, `set constraints all immediate`, the producers' reads, outbox insert, `realtime.send`. A chat message is 14 statements + BEGIN + COMMIT, all under the office lock. Candidates that change nothing visible: the counters read (`select prefix, n from counters`, 21 rows) could come with `META_SQL` (the first statement after the lock); `set constraints all immediate` is needed only when a table with the deferred foreign key (`project_id`) was written (a message save writes none); `PUSH_PEOPLE_SQL` (`push/chatFacts.ts:53,126`) re-reads all users on every message and every comment, though the office snapshot holds the same rows. In the real path each statement is a round trip inside the lock. Effort M, impact small each (1 of 14 statements).
Also: the chat reads send near-duplicate statements: `chats.list` reads read marks twice, and the newest comment per thread three times (newest, newest own, newest own message), each a LATERAL on the same index: 3 round trips that one statement could answer.

### DB-13 The outbox is never cleaned
No `delete from outbox` in the server (`jobs/steps/cleanup.ts` lists stories, idempotency, office_deletes, rate_limits, google revoking). Each notice mail, push, chat push and Google row stays after `done_at` is set. 60,000 rows cost 16 MB with indexes (my estimate of the year from 30,000 notices and 15,000 messages; the measured fixture has 6 rows). `INVITE_SENT_SQL` (`calls/people.ts:33`) and the invite checks (`auth/invite.ts:94-117`) scan it without an index: 8.8 ms at 60,000 rows (only the People screen and the invite flows). Fix: delete done rows older than 30 days for the mail and push kinds in the cleanup step; keep `auth.invite` and `auth.email` rows (their `sentAt` is data). This deletes data, so it needs the owner's OK (behaviorChange).

### DB-14 Size runway
115 MB in a year; events are 56% of it (820 bytes each; they hold `before` and `after`). The 500 MB limit (system schemas included) is about four years away at this rate. No cheap fix found (I tried compression storage options on a copy of `events`; no change). Watch the number.

## Fix bundle that I would ship first (all tried on the local stack)

1. Migration with `comments_author_task`, `notifications_inbox_c`, `events_report_verbs` (+ analyze). 2. `countSql` LATERAL. 3. One-element in-list equality and LIMIT form in `selectSql` for ordered reads. 4. Jobs loader pick + due filter. 5. Pins: add the count statement, the notice list and the report verbs to `readIndexes.it.test.ts`, so the planner flip of DB-5 cannot come back without a red test (the 2026-10-08 pins did not cover that statement).

## Not checked

- Production and the test copy (out of bounds, or not needed).
- The real round trip between an Edge Function and the pooler in Frankfurt, the pg connect cost per request (the pool closes idle connections after 1 s, so each request connects), and the Edge Function CPU limit. The 248 ms and 330 ms of `dashboard.get` are on this Mac.
- Whether Supabase counts the traffic from the database to an Edge Function as egress. The guide `access-map.md` assumes it does, and I used it as an assumption. The Egress report of the test project would answer this in one look.
- Realtime delivered-message counts and presence traffic (client side), `chats.typing` frequency.
- Real doc shapes: my tasks are 427 B, real tasks may carry descriptions and checklists, so bytes here are low for tasks and the notice and comment docs are typical. The comment authors are random over 10 people.
- The paused Supabase-exit SQLite path, the Workers and Durable Objects.
- Autovacuum behaviour on the hosted Free plan, and the Free plan disk IO budget.

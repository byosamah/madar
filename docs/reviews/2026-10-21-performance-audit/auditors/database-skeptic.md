# Skeptic report: database audit (DB-1 to DB-14), Madar at 1d45aae5, 2026-10-21

Method. I re-read the cited code in deploy-test. I restarted the auditor's local stack (its Docker volume still held the one-year fixture: 60,909 events, 6,100 tasks, 20,003 comments, 15,015 messages, 30,003 notices). I re-ran the key statements with EXPLAIN (ANALYZE, BUFFERS), compared result hashes, and profiled the dashboard.get handler. All index tests ran inside a transaction that I rolled back. The stack is stopped and the Docker lock is released. deploy-test is untouched.

## Verdicts

| id | verdict | score | one line |
|---|---|---|---|
| DB-1 | weakened | 3 | Real (263,452 B, 1,119 rows, 3.2 ms re-measured), but the fix only helps batches whose calls are all light. |
| DB-2 | confirmed | 3 | Re-measured 1,609 rows, 697 KB; pick of 7 fields gives 253 KB (-64%). The real saving is about 1.2 GB a month, not 2.7. |
| DB-3 | weakened | 3 | Home does not call dashboard.get. The 250 ms handler cost is in stageTag and todayISO, not in the row bytes. |
| DB-4 | confirmed | 3 | 1,342,366 B as objects, 770,366 B as arrays (-43%). |
| DB-5 | confirmed | 3 | Join 5.9 ms, LATERAL 0.45 ms, identical result hash. A saving of 5 ms. |
| DB-6 | weakened | 2 | Index gives 11.5-12 ms down to 7.5-8.3 ms (about 4 ms), not more. |
| DB-7 | weakened | 2 | Real, but the proposed pick lacks `kind`, so it is unsafe as written. |
| DB-8 | weakened | 2 | -32% (64.7 KB to 43.8 KB), and 300 unread is an extreme case. |
| DB-9 | weakened | 1 | 2.5 ms to 0.1 ms on one Inbox open. |
| DB-10 | weakened | 2 | The index only matters for year and quarter reports. A week is already 0.35 ms. |
| DB-11 | confirmed | 2 | The project To-dos tab (projectId) reads the same project twice when one task waits. |
| DB-12 | weakened | 1 | Gain is a few ms of lock time. Two of the three fixes are unsafe or incomplete. |
| DB-13 | weakened | 1 | 16 MB a year of a 500 MB limit. The row delete needs the owner's OK. |
| DB-14 | confirmed | 1 | Sizes re-measured (events 64 MB). Informational, no fix. |

## Evidence by finding

### DB-1 weakened (score 5 down to 3)
- Re-ran perfOffice: 1,119 rows, 263,452 B, 3.19 ms in Postgres. By list: projects 62,550, stages 63,258, deadlines 24,576, members 14,880. Numbers confirmed.
- The cache is cold on every Supabase request (server/CLAUDE.md, proof.md lines 961-972: 205 isolates for 222 requests). Confirmed. The office is read once for each batch (`batch.office`), not once for each call.
- Why smaller than claimed. (1) The fix saves only on a batch where every call is light. The Batcher windows the calls of one moment (`setTimeout(0)`, src/api/remote/batcher.ts), so after a signal the badge reads (`chats.unreadCount`, `notifications.count`) usually travel in a batch with the active screen reads, which need the full lists. Light-only batches are the typing calls, `files.link` and a few badge-only refetches. (2) The cost a person feels is about 3 ms of database time plus about 5 ms of JS next to a cold start of 230 ms (server.md: health 233 ms). (3) The egress claim (39 GB a month) needs both that pooler bytes count as egress and 150,000 requests; neither is measured. Production had 212 requests on 2026-10-16 (proof.md line 968).
- The fix is also risky: a handler that reads a list it did not declare sees an empty list, silently, and a write needs all the parts for `beforeOf`.
- fixSafe: true with care (the everyCall test the auditor names is the right guard).

### DB-2 confirmed (4 down to 3)
- Re-measured on the fixture: 1,609 rows, 697,257 B; pick of 7 fields 252,877 B (-64%); with `due_date <= today+4` 1,113 rows, 175,438 B (-75%).
- Code read: loadJobs (server/data/loaders/jobs.ts:15-16) loads whole docs. `runScheduledTriggers` reads status, dueDate, projectId (project status), and through peopleOfTask and mayViewTask the fields ownerId, helperIds, createdBy. `notify` and `copyForAdmins` read the same fields. No task row is written, so the save writes no task (before and after are equal).
- Due-day bound is safe: the only look ahead is `due_tomorrow` (the last working day before the due day, Sunday to Thursday week, no holidays in `isWorkingDay`), so at most 3 days. A bound of +4 days keeps all past due and all reminder cases. The bound needs a new condition in query.ts, sqlSource.ts, memorySource.ts and the SQLite compile (effort M); the pick alone is S.
- Correction of the impact: the 2.7 GB a month counts the office read (263 KB) too. The fix saves about 0.43 MB a run with the pick (1.2 GB a month) and 0.51 MB with the bound (1.5 GB). The office read stays. Whether pooler bytes count as egress is not proven.
- fixSafe: true. The 96 runs a day are real (`JOB_STEPS` run on every pg_cron call, no night skip).

### DB-3 weakened (4 down to 3)
- Re-measured: 4,576 rows, 1,342,366 B (active, objects), 1,268,262 B on the wire in the statement; array form 770,366 B (-43%); without title 1,201,757 B (-10.5%).
- Home does NOT call dashboard.get. I grepped src: only `DashboardScreen.tsx:64-65` and `MeetingView.tsx:233` call it. So the "every Home load" part of the user impact is wrong. Only people on the Dashboard tab, the meeting view, and agents pay it. With status active, both Dashboard calls are one key (one request).
- Re-ran the call through runCall: 300 to 365 ms total, of which the database statements are about 51 ms (the big task statement 43 ms). So about 250 ms is JS.
- I profiled it (node --cpu-prof, 6 runs). The hot spots are `stageTag` in flow.ts (about 135 ms a call, `tasksOfProject` = `Object.values(state.tasks).filter(...)` once for each project) and `todayISO` through `stampDay` (about 60 to 80 ms a call, called for each task). The group-by-project step the auditor names in `dashboardGet` is minor; `stageTag` scans all tasks itself. The SQL fixes (a) and (b) cut bytes and JSON parse only, not this CPU. The real CPU lever is stageTag and the date helper: that belongs to a handler fix (grouping tasks by project once and avoiding `new Date` for each task), and it keeps behavior.
- fixSafe: (a) is safe (see DB-4). (b) needs a conditional pick that pickSql does not have (a second read of titles for in_review rows). (c) is a rule rewrite that the auditor already marks large.

### DB-4 confirmed (score 3)
- Array form -43% on the dashboard rows (770,366 vs 1,342,366 B). The pick builder is `pickSql` (sqlSource.ts:117-126), used by dashboard, projects.list, reports.office, thread and notice picks.
- The saving is bytes and JSON.parse only. Risk is absent versus null; the existing mask logic must be kept. Not additive with DB-3(a): DB-3(a) is this finding.
- fixSafe: true.

### DB-5 confirmed (score 4 down to 3)
- Reproduced with the captured statement for usr_005 (37 chats): join form Hash Join plus Seq Scan on messages, 5.9 to 11.0 ms; LATERAL form with `x.n > 0`, Bitmap Index Scan on messages_conversation_newest, 0.44 to 0.9 ms. Result hash identical (md5 74f698b9...).
- Real, cheap, safe, and it grows with the message table. But it saves about 5 ms of database time in a call that is 25 to 45 ms; a person does not feel it.
- fixSafe: true. The unit pin at sqlSource.test.ts:117 must change.

### DB-6 weakened (3 down to 2)
- Reproduced the threads statement (member and admin): 11.4 to 14.8 ms before; 7.3 to 8.7 ms with `comments_author_task`. Same hash for both users. Saving about 4 ms. The plan still reads all 20,003 comments in the `threads` CTE (Seq Scan on comments c) and all tasks.
- fixSafe: true (an index in a migration).

### DB-7 weakened (3 down to 2)
- Code read: `privateMeetingsOf` loads whole docs (meetings.ts:36-38) and the rows stay in the State.
- The proposed pick (id, projectId, organizerId, attendeeIds, title) is not enough. The feed label for a meeting target reads `meeting?.kind` (src/api/views.ts:144-148), and the feed words depend on kind (`_meeting` or `_visit`). Without `kind`, a label falls back to the event side, which can lack it. The pick must add `kind` (and any field of `meetingResource` that `mayViewMeeting` reads). `Load.byKey` never reloads a row it holds (build.ts:110-113), so a picked copy would also hide fields from a later whole read; for a private meeting there is no Tracker line, so no later read.
- Size: 1,500 meetings a year with 300 private for the Admin is a high assumption; the effect is 60 KB or less for an events.list call.
- fixSafe: false as written; safe with `kind` added.

### DB-8 weakened (3 down to 2)
- Re-measured for the three people with about 300 unread: 64.7 KB whole, 43.8 KB with the pick (-32%). The auditor says -40%.
- `counts` reads userId, read, trigger, targetType, targetId (notifications.ts:91-105 and `hiddenTask`); `feedbackNoticeHidden` reads targetType and trigger only. So the pick is safe in count mode. 300 unread for each person is an extreme fixture; a person who clears the bell has a few.
- fixSafe: true.

### DB-9 weakened (2 down to 1)
- Reproduced: 2.5 ms before (Bitmap Heap Scan 3,000 rows, sort 944 kB, top 100) and 0.107 ms with `notifications_inbox_c` (Index Scan, limit 100). One Inbox open, 2.4 ms. Real, tiny.
- Care: the final `order by ord` of the window form must stay, so the call returns the same order; the generic `selectSql` path is shared.
- fixSafe: true.

### DB-10 weakened (stays 2)
- Reproduced for the stage count with a year range: 10.8 to 11.3 ms down to 2.4 to 3.5 ms with the partial index. For a week range the existing `events_created_c` index already gives 0.35 ms (Bitmap Index Scan on the text bound), and the partial index gives 0.05 ms. So the index matters for year and quarter reports only, and the Reports screen is mostly a weekly screen.
- Re-ran reports.office through runCall: 190 to 205 ms for a week and 200 ms for a year, so the period does not change the cost. The cost is the 2.2 MB of tasks and Tracker rows plus handler CPU. That part of the finding (the period does not narrow the read) holds.
- fixSafe: true.

### DB-11 confirmed (score 2)
- Code read overview.ts:117-119: `tasksOf(L, waiting.map(projectId))` reads the whole project again even when the first read had no narrowing condition (`where` empty).
- It also happens on `tasks.list {projectId}` (the project To-dos tab, the common case). Measured on prj_001: the first statement reads 85 rows, 29,596 B, so the second read repeats about 30 KB for one project. Admin all-list case (the auditor): about 204 KB.
- fixSafe: true when the skip applies only if the first read had no narrowing conditions for that project.

### DB-12 weakened (2 down to 1)
- Code read: `set constraints all immediate` (save.ts) exists on purpose ("a bad save fails the call", TM R11); skipping it needs a proof of which tables carry the deferred key. `PUSH_PEOPLE_SQL` (chatFacts.ts:53) also reads `exists (select 1 from push_devices ...)` for each user, which the office snapshot does not hold, so "give the producer the users from the snapshot" is incomplete. Round-trip times were not measured.
- Gain: a few ms of lock hold on a write path with about 40 writes a person a day. No contention at 15 people.
- fixSafe: false for the set-constraints skip and the snapshot users as written; the counters-with-META_SQL merge is safe.

### DB-13 weakened (2 down to 1)
- Confirmed: no `delete from outbox` in server (cleanup.ts has none). Size: about 16 MB a year from the auditor's own copy (an estimate, not measured on a real year). Of the 500 MB limit that is small. INVITE_SENT_SQL runs on the People screen and the invite flows only (8.8 ms at 60,000 rows).
- behaviorChange true stays (it deletes stored rows): needs the owner's OK. fixSafe: true after that OK.

### DB-14 confirmed (score 1)
- Re-measured: events 64 MB total (50 MB heap), comments 13, notifications 13, messages 11, tasks 3.7, files 3.2; database 130 MB with system tables. 638 B an event. Informational; no cheap fix.

## Other things I found
- Local-only: I granted `madar_server` to `postgres` and set its password on the throwaway local stack to run the auditor's scripts. No project file changed.
- The dashboard.get hot spots (stageTag in src/api/flow.ts, todayISO and stampDay in src/lib/dates.ts) are worth a finding of their own for the handler auditors: about 200 ms of CPU a call at 4,576 tasks that grows with tasks times projects. It keeps behavior if the tasks are grouped once.

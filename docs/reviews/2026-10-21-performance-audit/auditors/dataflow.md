# Data flow audit (key: dataflow, ids DF-n), commit 1d45aae5

Scope: the client query layer of Madar. Code read only in the deploy-test worktree. Experiments ran in a copy
(`scratchpad/copies/dataflow`). Production was not touched. The live numbers come from the test copy
(madar-test, member and admin sample accounts, 7 to 9 rounds each, from the owner's Mac).

## How I measured

1. Call counts per screen. A jsdom test renders the whole app over the sample office as the real build runs it
   (runtime mode remote, the real query client, answers held so each round of calls shows). It groups the calls of each
   round into requests with the rules of `batcher.ts` (12 calls, one overview call for each request).
   Files in the copy: `src/test/dfaudit.test.tsx`, `dfsignals.test.tsx`, `dfjoin*.test.tsx`, `dfchat.test.tsx`.
   Raw output: `audit/dataflow-rounds.txt`, `dataflow-rounds2.txt`, `dataflow-signals.txt`, `dataflow-join*.txt`, `dataflow-chat.txt`.
2. Reloads for each change signal. The same app gets one office signal (as `server/data/save.ts` builds it) and the test
   counts the calls in the next 1.35 s (the merge window is 1 s).
3. Live timing on the test copy with Node scripts (`scripts/df/*.mts` in the copy). They sign in with the password grant, send
   real `/api/batch` requests and open real Realtime channels. They print times and sizes only.
4. Patches in the copy for two fixes (DF-5, DF-6), then 21 touched test files (193 tests) with
   `--no-file-parallelism --testTimeout=60000`: all passed.

## Baseline numbers

First load of each main screen (admin, no role hint in the test, so Home shows one more round than the real build):

| Screen | Calls | Requests | Round trips | Notes |
|---|---|---|---|---|
| Home | 10 | 4 | 2 | 3 overview reads = 3 requests; meetings.list waits for round 2 |
| Tasks | 7 | 2 | 1 | |
| Projects | 11 | 2 | 2 | 5 reads for the closed New project sheet |
| Project overview | 13 | 2 | 2 | admin: projects.list{all}, projectTemplates.list, payments.list in round 2 |
| Project Tasks tab | 11 | 2 | 2 | admin; templates in round 2 |
| Inbox | 6 | 1 | 1 | |
| Dashboard | 8 | 2 | 2 | waits for the session |
| Meeting view | 7 | 3 | 2 | round 1 is session.get alone |
| Open Space | 5 | 3 | 2 | round 1 is session.get alone |
| Admin | 8 | 2 | 2 | waits for the session |
| Settings, What's new, Notifications, Meetings | 5 to 6 | 1 | 1 | |
| Search | 9 | 3 | 2 | 4 reads for the closed New project sheet |

Every screen sends the same 5 shell reads: session.get, chats.unreadCount, notifications.count, subCompanies.list, users.list.

Live (test copy, from the Mac, medians): session.get 524 ms, chats.unreadCount 697 ms, notifications.count 532 ms,
dashboard.get 450 ms, projects.list{all} 499 ms, tasks.list (all open) 443 ms, chats.list 494 ms (11.4 KB),
users.list 14.6 KB (22 people, no pictures), session.get 6.7 KB, projects.list (member Home) 23 KB, push.mine 353 ms.
Home first load, 4 requests in parallel: wall 534 ms median (634 ms in the first single run).

## Realtime: channels and messages

- One tab joins 17 channels with 15 active people: `office`, `person:<me>` and one `status:<id>` for each active human, the own one
  included (`LiveProvider.tsx:33` gives `watch` every active human; `presence.ts` joins them all). The test copy has 22 humans, so 24.
  The Free limits are 100 channels for each connection and 200 connections: both safe.
- Measured join times on the test copy: office and person channels SUBSCRIBED 718 and 769 ms after the answer of session.get
  (the first one includes the WebSocket connect); 22 status topics 2,945 ms; all 24 channels 3.6 to 4.0 s.
- The status of other people shows only in the Inbox: `PersonFace` (Inbox list, chat header, bubbles, mention list, group sheets)
  and `ConversationPane`. The only face with a state outside the Inbox is the own one in the person menu. Yet every tab on every
  screen listens to all topics.
- Frames (from the probe in proof.md "Chat presence: the Realtime probe", 1 frame for each socket joined on the topic): one state
  change gives 1 `presence_diff` to each listening tab. A join gives 1 `presence_state` for each topic. So a tab that wakes
  (phone after 60 s out of view, computer after 30 min) takes 16 frames and sends 1 track. A flip of one person gives about 20 frames.
- Idle tab: no app frame. The 25 s heartbeat is not a billed message (inferred from the Supabase page quoted in proof.md).
  I could not read raw frames in supabase-js (no public hook), so I did not re-measure the probe.
- Month estimate with the formula (15 people, 22 days, L listening tabs): status = flips x 2 x L x 15 x 22 + wakes x (16 + 2L).
  With L = 20, 40 flips for each person each day and 10 phones with 30 wakes each day: 264k + 370k = about 0.63M. With 100 flips
  for each person: 0.9M. The design estimate was 0.59 to 0.86M for status and 0.16 to 0.24M for typing. Both are against 2M Free.
  Change signals add about 0.12M (260 signals a day x 21 frames x 22). Total about 0.9 to 1.2M (45 to 60%).
- Typing does not use a Realtime message from the client. It is one Edge call (`chats.typing`) every 5 s while a person types
  (`typing.ts:7,138`), plus one stop.

## Findings

(See the structured result for the ranked list. Details and evidence below.)

### DF-1 Every write by anyone reloads every visible tab, and the rules are wide
Evidence (measured in jsdom, one office signal, counts for one open tab, 1.35 s later):

| Screen open | task change in the same project | task change in ANOTHER project | chat message (DM, anonymous) |
|---|---|---|---|
| Home | 6 calls, 3 requests | 6 calls, 3 requests | 1 call (chats.unreadCount) |
| Tasks | 4 calls, 2 requests | 4 calls, 2 requests | 1 |
| Projects | 4 calls, 2 requests | 4 calls, 2 requests | 1 |
| Project overview | 7 calls, 1 request | 4 calls, 1 request | 1 |
| Settings | 2 calls, 1 request | 2 calls, 1 request | 1 |
| Inbox | 3 calls, 1 request | 3 calls, 1 request | 2 |
| Dashboard | 3 calls, 1 request | 3 calls, 1 request | 1 |

Why: `readMap.ts` gives `tasks.list` (no projectId, so any project, line 50), `projects.list` (line 60), `meetings.list` (line 77),
`chats.unreadCount` (94) and `notifications.count` (92) kinds that every task, comment, event or message carries. The signal names the project,
but a read with no projectId in its input cannot use it (`affects`, `signals.ts:78-90`). Overview reads go one for each request
(`wire.ts:53`, `batcher.ts`), so Home pays 3 Edge calls for 1 signal. Hidden tabs cost nothing until they show (`refetchType: 'none'`).
Size: one Home pass is about 40 KB of JSON (tasks 9.5 KB + 1.6 KB, projects 23 KB).
Month estimate (inferred): the owner read 2,900 Realtime messages on 19 October, which is about 220 to 260 signals. With 12 visible tabs
and 1.9 requests for each tab and each pass: about 4,500 to 5,900 Edge calls on such a day, up to 100,000 a month (20% of 500,000).
Fix: reload a person-filtered list only when the project of the signal is one the cached answer already holds (its rows, plus
`projects.list{mine}` for a member), or when the signal names the person, or the office flag is on. A new assignment names the person
through a notice. Prove it with a test that runs every write of `server/core/everyCall.ts` as 3 roles (the style of `readMap.test.ts`).
A change of one 'projects' list for an Admin stays as it is. Risk: a missing case leaves a list old, so the test comes first.

### DF-2 chats.unreadCount and notifications.count reload on every task change and every chat message, in every tab
Measured above: Settings pays 2 calls for each task change and 1 for each message. chats.unreadCount is slow (697 ms median) and
sits in the shell of every screen (`TabPill.tsx:17,87`). A message in a chat of other people makes every other tab ask (the office
signal of a DM is anonymous on purpose, INT-16). 60 to 250 messages a day x 12 tabs = 720 to 3,000 calls a day (inferred).
Fix (server and client): the signal of a message names the members (it already names people with a notice or a read mark); the
client skips the others. `notifications.count` does not need 'projects' and 'updates' for a task change of another project.
Needs the server auditor and the leak tests of INT-16.

### DF-3 The first join of every page load repeats all reads
Evidence: `channel.ts:109` sends `tell([], 'join')` at the first SUBSCRIBED; `signals.ts:293-300` turns it into `all`; `affects`
returns true for every read (`signals.ts:80`). Measured in jsdom: Home 9 calls, 3 requests; project page 13 calls; Inbox 6; Dashboard 8
(the same size as the open). Measured live: first Home load 634 ms, then the repeat 754 ms. Cause of the late join: the socket
starts after `session.get` answers (`bootstrap.ts:241`, a raw call) and then needs 0.7 s. The reads of the first screen are done by then.
A join pass that comes while the first reads are still loading adds nothing: jsdom test, 8 calls before and 8 after (TanStack reuses the
running fetch). Fix: open the two channels at once from a stored Madar id (keyed by the auth user id, the way the role hint is stored),
in parallel with the first batch. If the stored id is wrong the join is refused and the normal path starts. Also share the session.get:
today `AuthGate` (`useCall`) and `personChangeSource` (`api.call`) both send it in the first request (two entries in one batch,
no time cost measured: 524 ms against 535 ms). Risk: a change saved between the read and the join in a window of about 0.3 s is missed
until the next signal. The seq check of the first signal does not cover it.
Saves about 3 Edge calls and 9 heavy reads for each page load. A phone loads the page 5 to 20 times a day (inferred).

### DF-4 A tab hidden for more than 60 s reloads everything on return, and a phone can do it twice
`signals.ts:330`: after 60 s hidden the pass is `all`. Measured: Home 9 calls (3 requests), project page 13, with nothing changed.
If the Realtime channels also drop and rejoin (a phone), the join pass comes a moment later: measured 18 calls where one reload is 9
(the second pass cancels the first running fetch, which the server already ran). Fix: skip the 60 s pass when the source stayed 'open'
since the tab hid and no join came in that time (a dropped socket already makes a join pass). Merge the join pass into a visibility pass
that started in the last second. Risk: a frozen tab whose socket is dead. The heartbeat of supabase-js ends it, and that gives the join.
About 20,000 Edge calls a month (inferred: 20 to 40 returns a day for each person).

### DF-5 Closed sheets read data on every Projects, Search and project page open
Evidence: `ProjectsScreen.tsx:222` and `SearchScreen.tsx:164` mount `NewProjectSheet` for every person who may create (everyone), and it
reads settings.get, projectTemplates.list and projects.list{status:'all'} at once (`NewProjectSheet.tsx:28-34`). `ApplyTemplateSheet.tsx:28`
reads projectTemplates.list on every project page. `EditProjectSheet.tsx:48` reads projects.list{all} for the Admin on every project page.
They arrive in round 2 and, as `projects.list` is an overview read, in their own request. They also reload on every signal while the screen
stays open (table in DF-1: Projects pays 2 requests where 1 would do; the project page keeps `projects.list{all}` in every pass).
Patch in the copy (`enabled: open`): Projects 11 calls, 2 requests, 2 round trips became 9 calls, 1 request, 1 round trip. Project overview
(admin) loses projects.list{all} and projectTemplates.list from round 2. Search loses 3 reads. 21 touched test files, 193 tests, pass.
The sheet already handles late data (`NewProjectSheet.tsx:60`, "can arrive after the sheet opens"). Add a start of the reads on
`pointerdown` of the button (`usePrefetchCall`), as the project row does, so the sheet shows no delay.

### DF-6 Home reads meetings.list only after three answers
`HomeScreen.tsx:151` returns null until session, mine and review answer, so `MeetingsCard` (`MeetingsCard.tsx:20`) mounts in round 2.
Measured live: 920 ms for the whole Home with the waterfall, 534 ms (504 ms) with meetings.list in the first request. One Edge call fewer
for each cold Home. Patch in the copy: `usePrefetchCall` in an effect of HomeScreen with `todayMeetingsInput(today)`; the test copy of the
rounds shows meetings.list in round 1. Tests pass.

### DF-7 Dashboard, Meeting view, Open Space and Admin wait for the session, then start their reads
`RequireRight` (`useRight.tsx:26`) and `AdminScreen.tsx:31` render nothing until session.get answers. Their reads start in round 2.
Measured live: session.get then dashboard.get + clients + teams 857 ms against both together 502 ms (+355 ms from the Mac; more on 4G).
Cold only (a deep link, a reload, the office TV at the start of the weekly meeting). Fix: the route gives a list of reads (as `tabReads`),
and the guard starts them with the session for a signed-in person. A person without the right wastes one set of reads (rare).

### DF-8 Every tab joins the status topic of every person on every screen
See "Realtime". Only the Inbox shows other people's states. Estimate: status is 0.6 to 0.9M of 2M Free messages for about 20 listening tabs.
If only tabs on the Inbox (or with a chat panel open) listen, L falls to about 4 and status falls by 70 to 85% (0.4 to 0.7M a month, inferred).
A mass reconnect (the office Wi-Fi restarts): 20 tabs x (16 presence_state + 20 track frames) = 720 frames in seconds, against the Free limit of
100 messages a second (inferred, not tested). Fix: `usePersonState` and the Inbox ask `live.watch` with a use count; the own topic stays joined to
track. A tab joins 15 topics when the Inbox opens, and starts the join on `pointerdown` of the Inbox tab and when a message notice arrives.
behaviorChange: the dots of the Inbox can show up to about 1.5 s after the first open of a visit (22 topics took 2.9 s on the Mac).

### DF-9 Away is sent at once, for each window switch
`activity.ts:13`: a page out of view is Away at once and `setMine` tracks at once (`presence.ts:setMine`). A window switch to CAD and back
sends 2 tracks, which is about 40 frames. 20 to 100 flips a day for each person (inferred) = 0.26 to 0.66M a month. Fix: send Away after 15 to 20 s
out of view and cancel it when the tab returns first. behaviorChange: Away shows 15 to 20 s later.

### DF-10 Typing sends an Edge call when nobody can see it
`typing.ts:138-141`: one `chats.typing` call every 5 s while a person types, also when every other member is Offline or Away (the call and
its `realtime.send` statement still run, 376 ms median measured on a not_found answer). The design estimate is 3,000 signals a day, 66,000 calls
a month (13% of 500,000). Fix: skip the call when the port knows the states of all other members and none is Online (a state that is unknown
still sends). The typist sees no difference. Inferred saving: 30 to 60%.

### DF-11 push.mine runs again at each Home open
`usePushDevice.ts:41` runs `syncThisDevice` (one `push.mine` call) in an effect at each mount, and `PushAskCard` mounts at each visit to Home
(`HomeScreen.tsx:75`). `PushSync.tsx:23` runs it once more 3 s after the start. A cold Home with push on sends 2 calls of 353 ms, each alone (not in a batch).
Fix: one check for each page (a module flag, or a stamp in sessionStorage); `usePushDevice` only reads the local state.

### DF-12 CORS preflights
`proof.md:1255`: 3 preflights in a cold load (3 parallel requests, an empty cache). Each one is an Edge call of its own (`server/http/cors.ts`,
Max-Age 7200 is the Chromium cap). Safari and every iPhone browser cap the cache at about 10 minutes (MDN; not measured here). A phone that works with
pauses pays a preflight (about one round trip, 300 ms or more on 4G) on the first call after each pause. The 2026-10-08 audit measured only Chrome and
removed the same-origin forwarder. Fix idea: for WebKit only, use the page's own `/api/batch` (the forwarder in `functions/api` exists). Needs a real iPhone measure first.

### DF-13 A project's Tasks tab asks taskTemplates.list after projects.get
The gate is `detail.viewerCan.addTask` (`TasksTab.tsx:95`), so the read leaves in round 2. LIV-5 put it in one call, but the later prefetch (`tabReads`) moved
`tasks.list` to round 1, and the template read stayed behind. Fix: add it to `tabReads('tasks')` for a cached session with `task.add`, as payments does.

### DF-14 A cold start has no cache
Every page load starts empty (no persister). The first screen waits for session.get and the lists (about 0.6 s on the Mac, 1 to 1.6 s on 4G, inferred).
A persisted answer of Home and the shell shows the last view at once and the reload follows. behaviorChange: stale data for a moment, and data on the device.
Needs the owner's choice (privacy). Impact is highest on phones, where the page restarts often.

### DF-15 Small ones
- A save on Home costs 3 Edge calls: the write with 4 follow reads, then `projects.list` and `tasks.list{review_for_me}` each in an own request on the own pass
  (one overview call for each request, `signals.ts:107,166`). A save on Tasks costs 2.
- The follow list of `chats.markRead` includes `chats.messages` (measured with `readsAfterWrite`: 4 reads). An arriving message in an open chat reads
  `chats.messages` twice in a second (the signal pass, then the follow of the mark). Inferred: the reader's own mark does not change the reader's thread.
- Search sends one overview call for each 150 ms pause (`SearchScreen.tsx:130`). 250 ms would cut about a third of the calls in a typed word (inferred).
- `me.updatePreferences` follows `users.list` (14 KB, up to 240 KB with 16 KB pictures) after a theme change. Rare.

## Waterfalls found (calls in order)
- Home: R1 session, shell, tasks mine, tasks review, projects.list; R2 meetings.list (DF-6). Admin without a stored hint: projects.list{all} in R2 too.
- Project page (any tab): R1 projects.get with the tab reads; R2 projectTemplates.list, projects.list{all} (admin), payments.list (admin, cold), taskTemplates.list (DF-5, DF-13).
- Dashboard, Meeting view, Open Space, Admin: R1 session (and the shell), R2 the screen (DF-7).
- Home or Tasks task panel by a link: R1 lists, R2 projects.get, tasks.get, files.list. Inbox task thread: tasks.get then projects.get. Inbox chat: chats.messages then markRead (by design).

## Not found (checked)
- No polling of data. `refetchOnWindowFocus` is off. The only intervals are the storage banner, the meeting clock and the live socket ping (the office build, off).
- Same read twice with the same key: TanStack shares it. `dashboard.get` with two equal inputs is one call. The only raw duplicate is session.get at the start.
- The own pass after a write skips the reads that answered in the write's request (`freshOf`). The Realtime echo of an own signal does nothing (same id).
- The 2026-10-07 fixes hold: FET-8 (role hint), FET-9 (Tasks placeholder), FET-3 (reads after the write in one request), LIV-5 as a single call.

## Not checked
- Production (out of bounds). The real Supabase usage page (no API; proof.md says the owner reads it). A real iPhone or Android socket and preflight behavior.
- Raw Realtime frame counts in this session (supabase-js has no public hook; I used the probe numbers of proof.md).
- The server cost of each read (the server auditor).

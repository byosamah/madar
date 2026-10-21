# Madar read cost on Postgres (Track R): design note

2026-10-17, branch `rb/read-cost`, base 97bbf1c (all file:line references). For the owner's OK before code. Sources: the
exit plan (A.1, A.2 Track R, A.4) and the map of reads (11.1).

## 1. What the owner sees
Nothing changes on screen: the number on the chat icon, the Inbox list and the chat rows keep their values. The server
reads fewer rows. The wave 0 probe (one year of made-up data, SQLite form, proof.md "Wave 0, the rest") measured the badge
(`chats.unreadCount`) at 21,064 rows a call for a member and 56,258 for the Admin: 4,421 of the 5,925 rows of an average
call (75%). After the change, the badge reads one row for each chat the person sees and the newest 100 thread rows. The
it-test holds it at 200 rows a call or fewer. The day estimate falls from 3.3 to 1.9 million rows (38% of Free; an
estimate). Postgres runs the same scan today; the new integration test (it-test) measures its new numbers.

## 2. The table
`unread_counts`, a server table: an entry in `SERVER_TABLES` (`tables.ts:102`), not in `TABLES` (no zod collection).

| Column | Type | What it holds |
|---|---|---|
| `user_id` | text | a human person (an agent reads the rows of its person) |
| `target_type` | text, `chat` or `task` | a chat, or the comment thread of a task |
| `target_id` | text | the conversation id or the task id |
| `n` | integer, 0 or more | the unread number |
| `last_at` | text, collate "C" | the stamp of the newest message or comment |

- Primary key (`user_id`, `target_type`, `target_id`). Index (`target_type`, `target_id`): the rows of one chat or thread.
- Partial index (`user_id`, `last_at` desc, `target_id` desc) where `target_type = 'task'`: the newest 100 threads in a cut
  that the index gives. Chat rows stay out of it, so a message writes no row of this index. No foreign key.
- Chat rows: every human person for each project chat with a message, and the two people of a direct chat. The number does
  not depend on who sees the chat, so a team change needs no upkeep. The read applies `canSeeConversation`
  (`chatState.ts:33`) from the office lists, as today. An absent chat row reads as 0.
- Thread rows: exactly the threads of each person, by the rule of `taskThreads` (`chats.ts:98-106`), with every person
  treated as active. Task T is a thread of person P when T has a comment, and: for a project task, its project exists and P
  leads T, leads the project, or commented (also through P's agent); for an office task, P sees T (Admin, lead, helper or
  maker) and P leads T, made T, or commented.

## 3. The rules that the number keeps
- Chat (`unreadIn`, `chatState.ts:58-65`): the messages after P's read mark ('' with none), not by P or P's agents
  (`principalOf`), and not with `actingForId` P.
- Thread (`taskUnread`, `chats.ts:70-76`): the comments by other people after P's own last comment (stamp, then id) and
  after P's read mark. Only the newest 100 count (`chatState.ts:45`, `chats.ts:110-112`): by `last_at`, then task id.
- One rule in one place: `chatState.ts` exports the scan rules as pure functions, with `unreadRowsOf(state)` (every row of
  an office). The handler scan, the memory form, the recount and the rebuild all call them.
- One additive contract change: an optional `State.threads` (`{ taskId, lastAt }[]`, newest first), which only a server
  loader sets, as `State.counts` (`store.ts:62-67`). It joins the exclusions of `TableCollection` (`tables.ts:15`) and the
  save never writes it. With it, `totalUnread` (`chats.ts:136-139`) adds the counts of those threads, and `taskThreads`
  takes those tasks in that order. The prototype never sets it, so its scan stays the same.
- Who may see: a read takes only the rows of the authority of the call. The badge trusts the thread rows. `chats.list`
  loads each thread task whole and checks the view rule again (`chats.ts:99-102`), so a wrong row never shows a hidden task.
- Reads after the change (`server/data/loaders/chat.ts`): the badge reads the chat rows (by key) and the 100 thread rows,
  nothing else. `chats.list` also reads the newest message and comment (as today) and the 100 tasks. `chats.markRead` is as
  `chats.list` plus its mark; `chats.messages` reads one row. The `threads()` query, the own comment read and both
  `countWhere` reads go.

## 4. The writes that change a row
The save step (`server/data/save.ts`) keeps the table from the Diff, in the transaction of the call. So an undo
(`events.ts:136-190`, one form for each record type) counts as the same change of the same rows. Two forms:
- The step (chats). A chat gets a message only at the stamp of its call, and no undo touches a message. The step adds 1 to
  the row of each person whose read mark is earlier than the stamp. It adds nothing when the message is by that person or an
  agent of that person, or has that person in `actingForId`. It is exact and reads no history.
- The recount (threads). The save counts the one thread again with the rule functions, for its lead, its maker, the leader
  of its project, the people behind its comments and the people with a row now. It writes only the rows that change.

| Change | Where (file:line) | The save |
|---|---|---|
| A new message | `chats.send` (`chats.ts:214`, `:232`); `files.share` to a chat (`sharing.ts:45`, `:52`) | the step |
| A chat read mark (each message also marks its sender) | `writeReadMark` (`chats.ts:147`), from `chats.markRead` (`:254`) and `postMessage` (`:216`) | n = 0: the mark is at or after the newest item (`chats.ts:146`) |
| A thread read mark | `chats.markRead` with a task id (`chats.ts:237-246`) | n = 0 on a row that is there; a mark never makes a thread |
| A chat that goes | `projects.delete` (`projects.ts:646`, `chatState.ts:21-29`) | its rows go |
| A new human person | `users.create` (`people.ts:141-175`) | a row for each project chat with a message: n = its message count |
| A person that goes | the undo of `users.create` (`events.ts:155-159`) | the rows of the person go |
| A task comment added or removed | `comments.create` (`content.ts:139`, `shared.ts:73`); date reason (`tasks.ts:492`); send back (`tasks.ts:676`); dependent date move (`flow.ts:155`); `files.share` to a task (`sharing.ts:36`); `comments.delete` (`content.ts:171`); the undo of each | the recount |
| A lead change | `tasks.update` (`tasks.ts:489`), `tasks.take` (`tasks.ts:519`), the undo | the recount |
| A helper change, office task | `tasks.update` (`tasks.ts:484-489`), `tasks.take` (`tasks.ts:516`), the undo | the recount (project task helpers change no thread, `chats.ts:103-105`) |
| A task that goes or comes back | `tasks.delete` (`tasks.ts:690`; its comments stay for Undo, `projects.ts:618`); the undo of `task.deleted` or `task.created` | its rows go, or the recount |
| A project leader change | `projects.setLeader` (`projects.ts:408`), the undo | the recount of each commented task of the project |
| A project that goes | `projects.delete` (`projects.ts:629-646`) | the rows of its tasks and chat go |
| A role change to or from Admin | `users.update` (`people.ts:214`), the undo | the recount of P's row of each commented office task (an Admin sees each office task, `permissions.ts:74-77`) |

No upkeep, on purpose:
- A person turned off, on, or removed (`people.ts:227`, `:246`, `:272`): the rows treat each person as active, and an off
  person makes no call (`account_off`).
- A new agent (`people.ts:161-166`, `server/mcp/agentUser.ts:147`): it wrote nothing yet, and an agent's owner never changes
  (`people.ts:183-191`: the patch has no kind and no `ownerId`). A test pins this case.
- A team change, a comment edit or reaction (`content.ts:155`, `:186`), a new project or direct chat (`projects.ts:344`,
  `chatState.ts:13-18`).
- Writes outside runCall run the rebuild after them: the test's own edits (`writeDown`, `server/test/db.ts:91`), the seed of
  the test copy (`scripts/seed-test-office.ts`), the local seed (`tests/e2e-deploy/local.ts`) and a restore.

## 5. The memory form and the shadow run
`Source` gets one method, `unread({ userId, chatIds, limit })`. `memorySource` and `memoryData` (runCall in memory) compute
it from the whole office with `unreadRowsOf`; `sqlSource` reads the table. So `compare.ts` checks it as today: the loader
tests and the sweep in memory, `loaders.it.test.ts` on the database, and the db-mode shadow run on every API test. A new
harness check 6 (`server/test/invariants.ts`): after each call, the table equals `unreadRowsOf(after)`. A difference names
the call, so a broken upkeep fails at the write that broke it.

## 6. The migration and the rebuild
- The migration: the table, its indexes, row level security, the revoke from public, anon and authenticated, the madar_server
  grants and the `server_all` policy (pattern `20261005000100_project_templates.sql`). Also `office_meta.unread_ready`
  (false): the switch. A call reads it with the office version, so it costs no row.
- The rebuild (`scripts/unread-rebuild.ts <test|production>`, also a function for the harness and the seeds): under the
  office lock, in one transaction, it reads the whole office (`whole.ts`), prints how many rows differ (a count only),
  writes `unreadRowsOf`, and sets the switch on. It is safe to run at any time. `--check` writes nothing; `--off` turns the
  switch off.
- While the switch is off, the save keeps the table and the loaders read the old way. So no badge is wrong at the release.

## 7. The tests
1. Rule tests (`chatsUnread.test.ts`): `unreadRowsOf` gives the numbers of the scan for each person; the handler with
   `State.threads` and counts gives the answers of the whole scan (the form of `scoped()`, lines 58-79).
2. Upkeep it-test (`server/it/unreadCounts.it.test.ts`): one case for each line of section 4, each undo, the new agent and
   the off person. After each call, the table equals `unreadRowsOf`.
3. Check 6 and the shadow run on every API test (`test:db`). The sweep `badgeTraps` gets the new cases.
4. Leak test as an outsider (the builder's own file): comments on an office task leave the outsider's badge, list and rows
   unchanged; `chats.markRead` on it answers `not_found` as for no task; a removed helper loses the thread in the same save;
   no Realtime signal names the outsider (the table adds no signal kind).
5. Badge rows it-test on the growth data of `readIndexes.it.test.ts` (plus chats and marks): for a member, a leader and the
   Admin, `chats.unreadCount` reads 200 rows a call or fewer (the actual rows of each plan, as madar_server). The
   `chats.list` rows go into proof.md.
6. Rebuild it-test: on growth data the rebuild writes `unreadRowsOf`; a second run changes nothing.

## 8. The risk: a wrong count
- How a person sees it: the number on the chat icon shows new messages that are not there, or misses some. A task thread
  is absent from the Inbox, or stays after the person left the task. A hidden office task never shows (section 3).
- How it heals: when the person opens the chat, its number goes to 0; a new comment counts its thread again; the rebuild
  fixes every row at once.
- The way back: `unread-rebuild.ts production --off`. The badge goes back to the old scan at once, with no deploy.
- The cost: a project chat message writes about 15 more rows (one for each person); a comment reads the comments of its
  thread and writes the rows that change. Wave 1 Task 18 measures the day total on SQLite.

## 9. The release
1. The merge gate of the root `CLAUDE.md`, with the tests of section 7.
2. `scripts/deploy/all.sh test` runs the rebuild after the server deploy, so the switch goes on. Then the deploy suite (its
   seed runs the rebuild too).
3. The owner tries the badge on the test copy: a message as member@madar.test, then the number as admin@madar.test.
4. After the owner's OK, the owner runs `all.sh production` (Claude gives the `!` line). It runs the rebuild at its end.
5. `--check` on production after the release and once a day for a week. After 2 weeks with 0 differences, a follow-up
   removes the switch and the old reads (`Source.threads`, `countWhere`, their tests), before wave 1 Task 18.
- No MCP change: no call, input, output or rule changes, so `tools.ts`, `TOOL_DOCS` and `INSTRUCTIONS` stay.

## 10. Sorts in JavaScript (Track R part a)
- `selectSql` drops the outer `order by t.ord` (`sqlSource.ts:130`), `order by x.ord` (`:143`) and `order by ord`
  (`:150`). The source sorts the rows by `ord` before it returns them. pg gives `ord` (bigint) as text, so the sort compares
  numbers ("10" comes before "9" as text).
- The cut orders stay in SQL: the inner order with its limit or `with ties` (`:143`), the window order (`:148`), and
  `referencing` (`:221`, `:226`). The answer stays the same: `Load` sorts every collection by `ord` (`build.ts:67-69`, `:143`).
- Gain: on SQLite an outer sort with no index reads each row twice (wave 0: `projects.list` 4,268 to 2,954,
  `dashboard.get` 6,015 to 4,236, `files.list` 253 to 128). On Postgres it removes one sort step from each read.
- Tests: `sqlSource.test.ts` pins each text with no outer order; a fake query that gives the rows in reverse order still
  gives them in `ord` order; `loaders.it.test.ts` and `readIndexes.it.test.ts` stay green.

## 11. Changes to the plan that this note asks for
- Plan item (c): the three `chatsUnread` skips (`db-mode.skip.ts:86-98`) stay, with a new reason. The tests write
  `State.counts` by hand, and the database computes the counts from the rows, so a hand value cannot reach it.
- "A new agent of the person" needs no recount (section 4). Chats need no recount when membership changes (section 2).
- New in Track R: the switch on `office_meta`, the rebuild step in `all.sh`, and the follow-up that removes the old reads.

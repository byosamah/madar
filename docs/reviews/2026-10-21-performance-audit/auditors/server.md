# Server audit (key: server, prefix SV). Commit 1d45aae5, 2026-10-21.

Scope: POST /api/batch on Supabase Edge Functions. Production was not touched. Live calls went to the test copy only (about 300 HTTP calls).

## What I measured, and how

1. Live timing (test copy, Mac in Al Khobar, 20 rounds after 1 warm-up, 300 ms gap). Server time comes from the Supabase function_edge_logs
   (execution_time_ms) and function_logs (cpu_time_used at Shutdown), read through the management API with the test project token.
   - GET /api/health (no database): client median 280 ms, server execution median 233 ms, server CPU median 111 ms.
   - batch with a bad token: client median 365 ms.
   - notifications.count: server 358 ms, CPU 143 ms. tasks.list: 367 / 154. chats.list: 391 / 170. chats.unreadCount: 388 / 189.
     admin projects.list: 401 / 174. member projects.list + dashboard.get (same body size, mixed): 412 / 198. cold Home batch of 4 reads: 499 / 195.
   - Client medians (p90): session.get 429 (513), notifications.count 399 (552), chats.unreadCount 444 (531), projects.list 477 (598),
     tasks.list mine 414 (589), dashboard.get 425 (487), chats.list 432 (505), admin dashboard.get 483 (524), admin projects.list 434 (532),
     cold Home batch 583 (696).
2. New isolate for each request. 205 distinct execution_id values for 222 requests. A run of 15 back-to-back health calls gave 15 isolates;
   10 calls with a 2 s gap gave 9; 6 calls with a 12 s gap gave 6. Without forceFunctionRegion the function runs in ap-south-1 and
   still gave 11 isolates for 12 calls. The runtime logs "booted (time: 37 to 52 ms)" for each one. Median heap 20.7 MB.
3. Statement counts of real calls (my copy of the server code, run on the Mac against the madar-test database, with the pg client
   wrapped to log each statement; counts are exact, times are not representative). "Cold" is the real Supabase case: an empty office cache.
   - session.get 7, notifications.count 10, chats.messages 12, notifications.list 12, tasks.list mine 12, dashboard.get 12 (admin 13),
     projects.list 15, chats.unreadCount 16, chats.list 17, chats.typing 7, notifications.markAllRead 17.
   - cold Home batch (session.get, projects.list, notifications.count, chats.unreadCount): 36 statements in 5 transactions.
   - writes: tasks.update 20 to 23, comments.create 20, chats.send 22, chats.markRead 25. A write runs 19 to 21 of these inside the office lock.
   - The sign-in office read alone is 4 statements and 72,453 B (260 rows) on the sample office (15 projects, 105 stages, 23 users).
4. Cost of one statement: about 5.4 ms from an edge function to the pooler. Two checks agree. Live lock holds in the function logs of
   the last 24 h (Frankfurt): chats.send median 118 ms (22 statements), tasks.update 115, chats.markRead 94, comments.create 93,
   tasks.move 99. A line fit over the live read times gives 4.7 to 5.4 ms for each extra statement.
5. Time of one call, split (reads): cold start 233 ms (61 %), token check plus the database connect about 75 ms (20 %),
   statements 50 to 85 ms (13 to 22 %).
6. Import cost of api.js in Deno 2.9.7 on this Mac (8 runs): 62 to 66 ms. mcp.js 70 to 75 ms, jobs.js 60 ms, an empty file 10 ms.
   `pg` from npm is 25 to 36 ms of that. The profile of an unminified build (3 runs) puts 10.3 ms in src/api/contract/emoji.ts,
   12 to 16 ms in zod schema building, 1.5 ms in i18next, 5 ms in the rest of src/api. First request after import (build of the app): 5 ms.
7. Tests of two import fixes: a lazy Intl.Segmenter gave a median 54 ms against 64 ms (8 runs). `pg` bundled with esbuild into one
   file (86 KB) imports in a median 19 ms against 30 ms for npm:pg (10 runs).
8. Other numbers: the batch response is gzip on the wire (47,884 B decoded, 9,376 B on the wire, projects.list). CORS preflight is cached 2 h
   (CORS_MAX_AGE 7200), so it costs one call in 2 h. The Edge gateway does not verify the JWT (verify_jwt false). tools/list of an agent
   of an Admin is 57 tools, 59,029 B; a member agent 47 tools, 48,612 B; the server instructions are 13,211 B. mcpTools first build 10.5 ms.
   CPU of the office snapshot work is small: build 0.15 ms, structuredClone of all office lists 0.37 ms for each call (sample office).

## Answers to the seven questions

1. Round trips. See the counts above. A read call is: 4 statements for the sign-in office read (begin, office_meta, office rows, commit), then its own
   transaction (begin, office_meta, loaders, commit). The call opens a second transaction although the first one already holds the office.
2. Cold start. Every request is a cold start. The import runs zod schema building (12 to 16 ms), one Intl.Segmenter (10 ms), the npm pg load (25 to 36 ms),
   i18next (1.5 ms) and the parse of 827 KB. No word table or contract JSON is large at import.
3. Work in the request. Push, mail and Google run after the answer (AFTER_ANSWER_KINDS). The signal is one statement inside the lock before the commit.
   The push producer runs 4 statements inside the lock for a chat message or a comment (SV-9). Nothing slow runs before the answer.
4. Batch. Entries run one after the other, each in its own transaction and (for a write) its own lock. Only adjacent files.link entries use Promise.all,
   and they share one read connection, so they run one after the other at the database (SV-11).
5. Office cache. Module memory. On Supabase it never hits, because each request is a new isolate. Every request reads the full office (SV-5).
6. Live numbers: above.
7. MCP. See SV-15.

## Findings (ranked)

### SV-1 (impact 5) Every request is a cold start: 233 ms of the 360 to 500 ms of a call
Evidence: 205 distinct isolates for 222 requests, also with no gap. Health (no database) is 233 ms and 111 ms of CPU; one reused isolate answered in 75 ms.
This is about 60 % of the server time of a read and 55 % of its CPU. The platform decides it, so only a smaller import helps (SV-2, SV-3, SV-4).
Fix: see SV-2 to SV-4. The pooler pools already close after 1 s because of it (data/sql.ts:IDLE_TIMEOUT_MS).

### SV-2 (impact 4, regression) A module-level Intl.Segmenter costs 10 ms in every cold start
Where: src/api/contract/emoji.ts:20. Measured: `new Intl.Segmenter(undefined, {granularity:'grapheme'})` is 9.5 to 12.7 ms in Deno; the import falls from 64 to 54 ms
when it is made lazy (8 runs). New code from the reaction work brought it. The 2026-10-07 audit fixed cold start (SRV-11) and set the rule "no new Intl at module level" for dates.
Fix: build it on the first call of isReactionEmoji. No behavior change. Also helps the first load of the browser (emoji.ts is a first-load file; not measured there).

### SV-3 (impact 3) pg loads from npm at each cold start
Where: vite.server.config.ts:EXTERNAL (pg), supabase/functions/*/deno.json. The npm package costs 25 to 36 ms to import in Deno (many CJS files, node resolution ops in the profile).
One esbuild file of pg (86 KB) imports in 19 ms (median of 10). Gain 10 ms here; the edge runtime is slower, so about 15 ms there, plus a smaller eszip.
Fix: bundle pg into the entry (rolldown failed with "Class extends value #<Object>", so use esbuild for pg only, or a vite alias to a prebuilt file). Keep pg external for the Worker build.
Not tested on the Supabase runtime.

### SV-4 (impact 2) The key check waits for the key download, which starts only after the 65 ms import
Where: server/entries/deno-api.ts:warm, auth/verify.ts:warmKeySet. A bad-token batch costs 85 ms more than health; token check plus connect is about 75 ms.
Fix A: start the key download in supabase/functions/api/index.ts before a dynamic import of the bundle, so it overlaps the import. Fix B: keep the public keys in a variable and use
createLocalJWKSet, with the remote set only when the key id is unknown. Gain 0 to 40 ms (the database connect starts at the same time and may be the slower one). Not measured on the platform.

### SV-5 (impact 4) The office is read twice for each request, in two transactions, and the cache never hits
Where: http/batch.ts:61 (readOffice with no transaction), core/runCall.ts:155 (a second read transaction), data/officeCache.ts.
Evidence: notifications.count is 10 statements and 3 of them (begin, office_meta, commit) only repeat the sign-in transaction. The cold Home batch is 36 statements,
15 of them transaction overhead. The full office read is 72 KB for the sample office (56 KB of docs). By the row counts of the sample, a year office would be about 4 times that.
Fix: (a) the sign-in read and the first read call share one transaction; (b) the reads of a batch share one repeatable-read transaction, and a read that follows skips the
office_meta read (same snapshot). Saves 3 statements for each request, 12 for the cold Home batch (about 15 ms and 65 ms of 499 ms). A failing read needs a savepoint so it never poisons the next one.
(c) A scoped office for calls that need only users and settings (unreadCount, count, typing) cuts the 72 KB. Risk: medium (error isolation, snapshot meaning). 

### SV-6 (impact 4) chats.markRead loads the whole chat list under the office lock
Where: data/loaders/chat.ts:190 (everyChat with inWrite). 25 statements, 21 inside the lock, to write one read mark. Live lock hold: median 94 ms, p90 113 ms (17 calls).
The Seen feature and every chat open call it, and each call blocks every other write for that time. One message in a chat with 4 viewers costs about 118 + 4 x 94 = 500 ms of lock.
Fix: a loader that reads only the chat, its read mark and its newest message, and a handler that still gives the same count. Needs the leak tests of the chat rules again. Risk: medium.

### SV-7 (impact 4) Each chat message wakes every open tab with a 16-statement read
Where: data/save.ts:116 and :457 (PRIVATE_CHAT_KINDS, the anonymous office signal), app/readMap.ts:94 (chats.unreadCount has scope person and the kind messages).
A message is a public kind in the office signal, so every tab reloads chats.unreadCount (16 statements, 388 ms server time, one Edge call) when it is not a member of the chat.
Estimate (inferred): 15 people with 20 tabs and 150 chat messages a day make about 3,000 calls a day, about 90,000 of the 500,000 calls of a month, and a Realtime delivery for each tab.
Fix: for a save that touches only a direct chat or a group, send person signals to the members only (they carry the same kinds), no office signal. Check INT-16 (the owner wanted other browsers to learn that somebody wrote). A cheaper
unreadCount (SV-10) cuts the cost without any rule change.

### SV-8 (impact 3) A write runs 19 to 21 statements inside the lock; about 8 can join
Where: data/save.ts:writeDiff (office_meta update, one upsert for each table, counters upsert, person_seq, set constraints), core/runCall.ts:195 (stories insert), data/sql.ts counters read (loaders/sqlSource.ts:270).
tasks.update: lock, office_meta, stories insert, 6 loader reads, counters read, office_meta update, 4 upserts, set constraints, realtime.send, commit. Live lock hold 115 ms.
Fix: (a) one statement with data-modifying CTEs for the office_meta update, the table upserts, the counters and person_seq; (b) fold the stories insert into it; (c) send "set constraints all immediate; commit" as one simple
query; (d) read the counters in the office_meta statement. Saves 6 to 9 statements (30 to 50 ms of lock). An idempotency key adds 2 more statements under the lock (inferred; not measured). Risk: medium to high (FK timing, row order).

### SV-9 (impact 3) The push producer reads all people again under the lock
Where: push/chatFacts.ts:PUSH_PEOPLE_SQL, postgresFacts. chats.send is 22 statements: 3 of them are producer reads, one of them returns the 23 users (5 KB) that the office snapshot already holds.
Fix: take users, roles and agents from the snapshot (as liteFacts does) and ask the database only for devices, or put the 3 reads in one statement. Saves 2 to 3 statements of the 118 ms lock of each message and comment.

### SV-10 (impact 4) The most used reads send 12 to 17 statements one after the other
chats.unreadCount 16, chats.list 17, projects.list 15, dashboard.get 12, tasks.list 12. The two reads of chat_reads, the three LATERAL reads and the counts of chats.unreadCount do not depend on each other.
Fix: a Source method that sends the independent selects of one loader as one statement (union all or a json array), and Promise.all in those loaders. Estimate: unreadCount 9 loader reads to 4, saving about 25 ms of 388.
Effort L, risk medium (the read-index plans in readIndexes.it.test.ts must stay).

### SV-11 (impact 2) files.link costs 3 statements for each link, and the links do not run side by side at the database
Where: server/files/records.ts:34 (db.statement), calls/files.ts:98, http/batch.ts:79. Each link opens its own transaction on the one read connection (pool max 1), so a screen with 12 pictures sends 36 statements one after the other (about 180 ms).
With the Supabase Storage store, each link is also one HTTP call (parallel). Fix: read all files of the run with one statement.

### SV-12 (impact 2) A write request opens two database connections
Where: http/batch.ts:61 (warm write), data/sql.ts:pools. The sign-in read uses the read pool and the write uses the write pool, so a new isolate makes two TCP, TLS and pooler logins and holds two pooler clients for at least 1 s (client limit 200 on madar-test, EMAXCONN on 2026-10-16).
No request has two calls at the same time at the database. Fix: one pool inside a Supabase isolate. Saves about 10 to 30 ms of CPU and half of the pooler clients. Risk: low to medium.

### SV-13 (impact 2) Each after-answer effect runs 6 statements in 2 transactions, and a chat message keeps the isolate 10 s
Where: core/effects.ts:processOutbox (claim and done through db.statement), core/effects.ts:CHAT_WAIT_MS. A mention in a chat makes push.chat and mail.chatNotice rows: 12 statements and a new connection after the 10 s sleep.
Nobody waits for it, but it uses database time and one isolate (20 MB) for 10 s each. Fix: claim and done in one statement; one connection for the chain. Low priority.

### SV-14 (impact 2) chats.typing is a full request, 7 statements and 72 KB, to send one signal
Where: server/calls/typing.ts, signal/typing.ts. It sends every 5 s while a person types and once to stop. About 6 calls for a 30 s message. Per call: cold start, office read, one transaction for realtime.send (3 statements).
Fix: send with one statement and no begin and commit (the signal needs no lock and no timeout of its own, but the "set local" rule asks for a transaction, so test it). Gain 10 ms; the main cost stays the cold start.

### SV-15 (impact 2) MCP tool calls open two connections and about 10 statements before runCall
Where: mcp/app.ts:331 to 343 (agentOf read statement, office read, limit statement on the write pool), mcp/app.ts:231 (McpServer and 47 to 57 registerTool for each request), mcp/tools.ts (mcpTools first build 10.5 ms).
mcp.js imports in 72 ms against 64 ms for api.js. tools/list is 59 KB (Admin agent) or 49 KB (member agent) plus 13 KB of instructions, no outputSchema. Not live-tested (needs an agent token).
Fix: one transaction for the agent read, the office and the limit update; build the tool list once for each isolate (it is already once for each request, so it needs a module cache for the JSON Schemas). Low traffic, low priority.

## Fixes that are already in place (checked, not reported again)
SRV-9 joined start (sql.ts START: one query for begin and set local), SRV-4/SRV-1 after-answer kinds, LIV-7 warm of keys and connection, SRV-11 minified bundle, read indexes (statement counts do not show a scan).
The deliberate 1 s idle close (2026-10-16) is right for per-request isolates.

## Not checked
Production (out of bounds). The Workers and office-object code. Year-size data on a local Postgres (no Docker started: other agents hold it). Live write timing (writes were counted on a local run
against the test database, with push stubbed; the lock holds come from the function logs). The Supabase edge runtime for the SV-3 and SV-4 gains. Realtime message counts (code read only). MCP live calls. Whether the test copy runs the HEAD code (the function logs show deployment version 158).

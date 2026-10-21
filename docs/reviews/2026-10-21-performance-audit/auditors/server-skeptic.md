# Skeptic verdicts: server request path (SV-1 to SV-15)

Re-measured on the Mac (Deno 2.9.7, load average about 3): api.js import, Intl.Segmenter, npm pg against an esbuild bundle of pg.
Not re-measured: the live Supabase numbers. The logs endpoint of the management API changed its table names, so the lock holds
(94 and 118 ms) and the per-statement cost (5.4 ms) stay as the auditor read them.

General point. The 5.4 ms for each statement is a line fit over whole calls. It includes the JavaScript of the handler in a cold
isolate, so the pure round trip is lower (inferred 2 to 4 ms). Every saving counted in statements (SV-5, SV-8, SV-9, SV-10, SV-14)
is probably half of the claimed milliseconds.

SV-1 weakened, 2. Real (and already written in server/CLAUDE.md since 2026-10-16), but it has no fix of its own. The part the code
controls is the import, 63 to 65 ms here (reproduced: 62.3 to 64.5 ms). SV-2 plus SV-3 take about 17 ms of it, SV-4 about 0.
SV-2 confirmed, 3. Reproduced: new Intl.Segmenter is 9.6 ms; a lazy copy of api.js imports in 54 ms against 64 ms (8 runs each).
Same answers when built on the first call. Smaller than a score of 4 suggests: 10 ms of a 360 to 500 ms call.
SV-3 weakened, 2. Reproduced the direction, not the size: npm pg 25 to 29 ms, one esbuild file 20 to 22 ms (about 6 ms, not 10).
It needs a createRequire banner (the plain bundle throws "Dynamic require of events"), it adds 86 KB to a bundle that is 826,972 B
against the test bound of 850,000 characters (bundles.test.ts), and the Supabase edge runtime was not tried.
SV-4 weakened, 1. The key download and the database connect both start at the end of the import and run side by side. The token
check and the first office read wait for the slower of the two, and the connect (TCP, TLS, login) is probably the slower. Moving
the key download earlier gains only when the key is the slower one. Option B (a fixed key list) is a rotation risk.
SV-5 weakened, 3. The code agrees (batch.ts readOffice, then runRead opens a second transaction). But the full office rows are
read once: the second transaction reads only office_meta and hits the module cache inside the same isolate. So it is 3 wasted
statements for each request (begin, office_meta, commit), about 6 to 16 ms, not "the office read twice". FET-3 limits fix (b).
SV-6 weakened, 2, fix not safe as written. chats.markRead returns { unread: totalUnread(...) }, the total of ALL chats and
threads (handlers/chats.ts). A loader of one chat gives a different number: a contract change. The cost is the same load as
chats.list plus the preview reads. Safe form: keep the counts, skip only the newest-message preview reads in this call.
At 15 people the lock is held a small share of the time, so waiting for the lock is rare.
SV-7 weakened, 3. The mechanism is real (messages is a public kind, the unreadCount rule has scope person, affects() returns
true). But a hidden tab only marks its lists (signals.ts), so only visible tabs reload. The 90,000 calls a month assumes 20 tabs
in view all day. A plausible figure is 20,000 to 40,000 (4 to 8 % of 500,000). The fix covers direct chats and groups only.
SV-8 weakened, 2. Real (20 statements under the lock). At 2 to 4 ms a statement, joining 6 to 9 of them saves 15 to 35 ms of
lock for each write. Risk high (foreign key timing, row order). Behavior stays the same if done right.
SV-9 weakened, 1, fix saves nothing as written. The people read also holds the device flag (exists on push_devices), which the
snapshot does not have, so a "devices only" read is still one statement. Safe form: one statement for items, people and levels
(saves 2 statements for each chat message and comment; they run only when a message or comment was inserted).
SV-10 weakened, 3. Statement counts hold (code read). But Promise.all gives no overlap on one connection (pool max 1 per mode,
no pipelining). Only a union-all of independent selects removes round trips. Saves about 10 to 25 ms of a 388 ms unreadCount.
SV-11 confirmed, 2. db.statement opens its own transaction (3 statements) and the read pool has max 1, so adjacent files.link
calls queue at the database. Not timed live.
SV-12 weakened, 1. readUrl falls back to writeUrl (the test copy sets no DATABASE_READ_URL), so both pools reach one database.
But warm('write') starts the second connect during the sign-in read, so it adds CPU (a TLS and login, a few ms), not wait.
At 15 people the pooler client limit (200) is not near.
SV-13 weakened, 1. After the answer, nobody waits. db.statement is a short transaction by design (the set local rule), so
"no transaction of their own" conflicts with server/data/CLAUDE.md. Safe form: claim all rows of a batch in one statement.
SV-14 confirmed, 2. Code read: realtime typing goes through db.statement, which is begin, select, commit (3 statements), and the
file comment "outside any transaction" is out of date. The cost is mostly the Edge call (quota), not the 10 ms.
SV-15 weakened, 1. Agent traffic only. "Build the schemas once for each isolate" saves nothing on Supabase, because an isolate
serves one request. Only the one-transaction part of the fix has value.

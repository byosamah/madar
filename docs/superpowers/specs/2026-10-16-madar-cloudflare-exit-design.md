# Madar on Cloudflare only: the Supabase exit plan

16 October 2026. A proposal for the owner's OK. Nothing is built yet.

## Summary
- **What moves:** the database, sign-in, live updates, the 15-minute jobs and the backups leave Supabase. Each copy gets one Cloudflare Worker and one Durable Object. The screens and the business rules stay.
- **Money:** $0 a month on Workers Free. The safety valve is Workers Paid at $5 a month.
- **Time:** about 4 weeks of build, 1 week on the test copy, then one evening with a stop of about 1 hour.
- **People:** each person signs in again once, with the same password. Each AI agent connects again once.
- **Biggest risk:** the Free day limits of the database (rows read, rows written). If Madar uses one up, that part stops until 03:00 Riyadh.
- **Second risk:** Free documents 10 ms of processor time for each request, and Madar needs up to 137 ms. Wave 0 checks if the object gets 30 s.
- **Your decisions:** the go after the probes, the $5 safety valve, the switch date, the passwords, the file backup, the test copy account, the Supabase delete date.

## 1. The Free limits I checked
I read these on developers.cloudflare.com on 16 October 2026. The limits are for the whole account, so the test copy and production share them. A day ends at 00:00 UTC (Coordinated Universal Time), which is 03:00 Riyadh. Above a day limit, "further operations of that type will fail with an error".

| Service | Free limit | Source |
|---|---|---|
| Worker requests (Pages Functions too) | 100,000 a day. A service binding hop adds no request. | [1] [2] |
| Processor time (CPU time), fetch calls, Cron | 10 ms and 50 fetch calls for each request or Cron run. 5 Cron Triggers for the account. | [1] |
| Durable Object (DO) requests | 100,000 a day. A socket open is 1. 20 messages from browsers are 1. Messages to browsers are free. | [3] |
| DO duration | 13,000 GB-s a day. An idle object that can hibernate costs nothing. | [3] [9] |
| DO rows | 5 million read and 100,000 written a day. A delete and an alarm count as writes. | [3] |
| DO storage | 5 GB for the account. One object: 10 GB in the table, "1 GB on the Free plan" in the FAQ. | [4] |
| DO processor time | 30 s in the table. The FAQ says "the same as any Worker" (10 ms on Free). | [4] |
| R2 | 10 GB-month, free egress | [8] |

Not verified: the processor and storage limits of one DO on Free (one page gives two values for each). Wave 0 measures the first; this plan assumes 1 GB for the second. I assume that an index update counts as one more row written, as D1 documents.

## 2. The target design
The Pages Function still forwards `/api` and `/mcp` to the Worker. The Worker checks the token and gives the whole batch to the office object in one call. The object runs `runCall` and holds the database, the sign-in records and the live sockets. So most processor time moves out of the Worker.

| Job | Chosen | Rejected, and why |
|---|---|---|
| Database | SQLite in the office object. The object runs one request at a time, so it gives the lock and the transaction. `runCall`, the handlers and the zod contract stay. About 110 SQL texts change; about 25 need design. | **D1:** no transaction across queries, 50 queries for each run on Free (a full batch can need 180), 500 MB cap [6]. **Postgres at another vendor:** two vendors again. |
| Sign-in | Own sign-in in the Worker. Tokens stay ES256 and 15 minutes, with a new issuer. Passwords: PBKDF2, 100,000 rounds (the Workers maximum). Links: random, 1 hour, one use (closes security fix 8). Agents: own OAuth 2.1 routes with the Madar approval inside. supabase-js leaves the screens. | **Cloudflare Access:** email codes in place of passwords, no OAuth for agents, and it needs vado.sa DNS on Cloudflare (not verified). **`workers-oauth-provider`:** keeps tokens in KV, which allows 1,000 writes a day [7]. |
| Live updates | The sockets live in the office object (Hibernation API). After the commit, the object sends each signal. A 60-second ticket (`live.ticket`) signs in the socket, because a browser socket cannot carry a header. The screens get one new file, `liveSocket.ts`. | **A separate hub object:** one more request for each write, and a send can get lost. **A poll every 10 s:** about 54,000 requests a day. |
| 15-minute jobs | A Cron Trigger on each Worker (2 of 5). The object runs the steps; the Worker sends mail and push. The 07:30 summary uses the Resend batch call, so it stays under 50 fetch calls. | **A DO alarm:** each alarm is a row write, and it runs inside the object, where Madar does no network work. |
| Backups | (1) Point-in-time recovery (PITR): any minute of 30 days, in place [5]. (2) Each night, GitHub calls a secret export route, with writes stopped for at most 5 minutes at 02:00 Riyadh. GitHub encrypts the export to your key and keeps 30 days, as today. (3) The restore check loads it into a local SQLite. | **PITR alone:** no copy outside Cloudflare. **D1 Time Travel:** 7 days only [6]. |
| Deploy and tests | `wrangler deploy` only. The object updates its own schema at start. The Supabase config, functions, Vault and Hyperdrive go. `test:db` runs on `node:sqlite` with no Docker. The shadow run proves that SQLite gives the same rows as the memory form. | **Docker and Postgres for tests:** they test a database that production no longer uses. |

Two rules keep the budget. First, the object does no network work: mail, push and file links stay in the Worker, as today. Second, every read uses an index, and the office lists load from a snapshot. An object that sleeps loses its memory. Without the snapshot, each wake reads about 2,000 rows again; with it, about 20. A test pins the rows read of each call.

## 3. The Free budget for 15 people
Assumptions: production makes 5,000 calls a day in 3,000 requests, and the test copy 2,000 calls (measured). Both copies make 1,000 writes a day. The data is one year of growth (about 140,000 records). An average call reads 300 rows. Wave 0 measures these numbers.

| Day limit | Free | Expected | Share |
|---|---|---|---|
| Worker requests | 100,000 | 6,500 (screens, agents, token renewals, jobs, sockets) | 7% |
| DO requests | 100,000 | 6,500 | 7% |
| DO duration | 13,000 GB-s | under 800 GB-s | 6% |
| DO rows read | 5 million | 2.5 million (calls, jobs, nightly export) | 50% |
| DO rows written | 100,000 | 50,000 (about 40 rows for each write, with event, notices and indexes) | 50% |
| DO storage | 1 GB for the object | 0.3 GB after one year | 30% |
| R2 storage | 10 GB | under 1 GB | under 10% |

Requests and duration are safe. Rows read and rows written are the tight limits. One seed or one full deploy suite can write tens of thousands of rows, so heavy test runs stay after office hours. The usage meter counts the rows of each day and warns the Admin at 80%.

## 4. The move of the live data and the people
Before the day:
1. Finish the open R2 switch of production.
2. Rehearse: import a copy of production into a spare object, compare it, then delete it.
3. The day before, tell the team in Madar.

The evening of the switch (a stop of about 1 hour):
1. The Worker refuses every write with a short message. Agents stop too.
2. The job sends the mails that are still in the outbox. Run the Supabase backup by hand.
3. Export every record, plus the server rows that must move: counters, the office version, person numbers, the mail count of the day, the usage month and the push devices.
4. Read the sign-in rows (id, email, bcrypt hash, banned, "password set") with the database address of the backup. Each id stays the same.
5. Import into the office object, in parts.
6. Check each table: the row count and a hash of each record must match. A difference stops the switch.
7. Deploy the screens without Supabase. The owner signs in and runs the checks, then opens Madar.

After the switch, the first sign-in of each person checks the old bcrypt hash once and saves a PBKDF2 hash in its place. Old invitation and reset links stop, so the Admin sends them again. Each AI agent connects again, also the claude.ai Madar connector. Browser push continues.

The way back: Supabase stays untouched for 30 days. Before the first write on Cloudflare, a deploy of the old screens takes 5 minutes. After writes, a reverse export takes the records back to Postgres. The rehearsal tests it.

## 5. The build waves, in order

| Wave | Delivers | Rough size |
|---|---|---|
| 0. Probes | The processor limit of a DO on Free. The rows read of 3 heavy calls on one year of data. A socket to an object that sleeps. The processor time of PBKDF2 and bcrypt. Then your go or no-go. | 1 to 2 days |
| 1. Database | The DO adapter, one SQLite schema in place of 18 migrations, the query compiler, the save, the office snapshot. `test:db` (1,063 tests) and the shadow run green on SQLite. | 6 to 8 days |
| 2. Sign-in and agents | Passwords, tokens, links, sign-in limits, the screens sign-in port, the OAuth routes. | 5 to 6 days |
| 3. Live updates and jobs | Sockets, `liveSocket.ts`, the Cron Trigger, the meters on the Free day limits. | 3 days |
| 4. Backups and deploy | Export, import and reverse export, the restore check, a wrangler-only deploy, GitHub checks with no Docker, the test seed. | 3 to 4 days |
| 5. Test copy | The new stack on the test copy, the deploy suite after hours, one week of use, the rehearsal. | 1 week |
| 6. Switch and watch | The evening switch, 30 days of watch, then the Supabase delete with your OK. | 1 evening, 30 days |

## 6. Risks

| Risk | Cost if it happens | The way back |
|---|---|---|
| Madar uses up a day limit (most likely rows read) | That part fails until 03:00 Riyadh, maybe the rest of a work day | Workers Paid ($5 a month) lifts the limits in minutes. The meter warns at 80%. |
| Cloudflare holds Free to 10 ms | Heavy calls fail with error 1102 | Workers Paid, or less work in those calls |
| One object holds only 1 GB | After about 3 years, writes fail | Move old History to an archive object, or Workers Paid |
| SQLite gives other rows than Postgres | Wrong lists or counts on screen | The shadow run; no switch until it is green |
| The move loses a record | Lost work | The hash check stops the switch. Supabase stays 30 days. |
| bcrypt is too heavy for Free | Some first sign-ins fail once | Try again, or "Forgot password" |
| The test copy uses up the shared limits | Production stops for the day | Heavy runs after hours; a day cap on the test Worker |

## 7. Decisions for the owner
1. **Go or no-go after wave 0.** I recommend no build before the probes.
2. **The safety valve.** If a Free limit stops Madar: Workers Paid ($5 a month), or a stop until 03:00 Riyadh? I recommend the $5, agreed in advance.
3. **The switch date.** An evening or a Friday, about 1 hour.
4. **The passwords.** Copy the bcrypt hashes, or a new password for each person. I recommend the copy.
5. **A second copy of the files.** Backblaze B2 (a second vendor, free to 10 GB), or R2 alone.
6. **The test copy.** The same account (shared limits), or a second free Cloudflare account (its own limits).
7. **The Supabase delete.** I recommend 30 days after the switch, after a last backup and a restore check.
8. **Mail.** Resend stays (free, no bill). I did not check the Cloudflare mail service.

## Sources
1. https://developers.cloudflare.com/workers/platform/limits/
2. https://developers.cloudflare.com/workers/platform/pricing/
3. https://developers.cloudflare.com/durable-objects/platform/pricing/
4. https://developers.cloudflare.com/durable-objects/platform/limits/
5. https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
6. https://developers.cloudflare.com/d1/platform/limits/ (day rows: https://developers.cloudflare.com/d1/platform/pricing/)
7. https://developers.cloudflare.com/kv/platform/limits/
8. https://developers.cloudflare.com/r2/pricing/
9. https://developers.cloudflare.com/durable-objects/best-practices/websockets/

Measured facts: `docs/superpowers/real-build/proof.md`, section "The test copy on the Worker".

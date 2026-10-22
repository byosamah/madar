# Speed audit of 2026-10-21

Owner request (2026-10-21): "audit the performance of the full product and make the best". Sonnet agents audit and build;
the Opus session leads. Base: main at 1d45aae5 (the test copy serves 23b2c902, the same code). Production was not touched.

Run: workflow wf_cd6fb185-8e4. Seven auditors (first load, screen rendering, client data flow, server path, database,
background paths, live numbers on the test copy), one skeptic for each, then a gap critic. Every finding with its verdict is in
`findings.md`. The full auditor reports are in `auditors/`. Raw probes stay in the session scratchpad.

The fix rule is the rule of the audit of 2026-10-07: a fix changes only speed and size. It never changes behavior, visuals,
words, data, the API contract or the security rules. A finding that needs a visible change waits for the owner.

## 1. What a person feels today

| Moment | Number | How measured |
|---|---|---|
| Cold load on a laptop, first rows on Home | 2.0 s (first paint 1.0 s) | Playwright, test copy, 4 rounds each role |
| Warm load on a laptop, first rows | 0.8 s (first paint 0.2 s) | same |
| Cold load on a phone (4G, CPU 4x slower), first rows | 6.2 s (first paint 5.0 s) | same, 5 runs |
| First open of a screen in a session | 0.45 to 0.65 s | click to data, warm |
| One save (a task title) | 0.7 s | blur to answer, 6 rounds |
| A chat message shows on the other person's screen | 2.2 s | 8 rounds |
| One API call on the server | 0.36 to 0.50 s, of which about 0.23 s is the start of a new server instance | Supabase function logs, 222 requests |
| Memory of a tab after 30 screen changes and 5 idle minutes | 16.5 MB, no growth | CDP heap |

The numbers of 2026-10-08 were better on the network side (the time to first byte was 69 ms then, 313 to 352 ms now). Most of
that difference is the route of the measuring Mac (Jeddah to the Marseille edge), not the product.

## 2. The causes, in order of size

1. **Every API call starts a new server instance.** Supabase served 205 of 222 calls with a new instance. The start costs about
   230 ms and 110 ms of CPU before any work. The Supabase guide says a booted instance can take more requests, so the cause is
   not proven. Track 6 tests it with a probe function on the test project.
2. **One change by anyone makes every open tab call the server again.** A save sends 3 batches where 1 is enough (the echo of
   the own write defeats the skip of 2026-10-07: a regression). A chat message makes the sender mark its own message read
   (1 more batch). Each call pays cause 1.
3. **The first load grew by 21%.** 50 script files and 384 KB gzip, against 22 files and 318 KB on 2026-10-08. The chat upgrade
   pulled the whole task panel into Home (38 KB gzip), and the drag order of the Today list pulled dnd-kit in (18 to 28 KB).
4. **Some screens wait for one call before they start the next.** Home asks for meetings only after three answers; the Dashboard,
   the meeting view, Open Space and Admin start their reads only after the session answers; closed sheets read data that
   nobody sees.
5. **Long lists draw too much again.** One changed task draws every task row again; a new message in a chat at its 200-message
   limit draws all 200 bubbles; the emoji panel builds 1,878 buttons at each open.
6. **A few database reads grew with the data.** On one year of data, the unread badge reads the whole message table (a
   regression), the thread read scans the comments twice, the Dashboard moves 1.35 MB from the database and spends about 250 ms
   of CPU in the handler, and the 15-minute job reads every open task whole.
7. **Chat waits on a 1 s merge.** The signal of a new message reaches the other tab in about 0.6 s, then the tab waits 1 s
   before it asks for the message.

Checked and fine: memory over a long session, the cache headers of the hashed files (one year, immutable), Row Level Security
cost (none), the Realtime publication (no table), the index upkeep of events, the CSS of the first page (one file, 16 KB gzip),
the fonts that the first screen uses (all three weights).

## 3. The build (branch rb/perf2)

Six tracks, one Sonnet builder each. Each fix comes with its test first. The merge lead runs every suite once at the end.

| Track | Findings | What a person gets |
|---|---|---|
| 1 First load | FL-1, FL-3, FL-4, FL-5, FL-7 (option A), FL-8 (safe part), FL-10, FL-11, FL-17 (safe form), LV-10, LV-11 | a smaller first load (target about 300 KB gzip), map and second-language files that start at the right moment |
| 2 Lists | RN-1, RN-2, RN-3, RN-4, RN-5 with FL-2, RN-6, RN-7, RN-8, RN-10, BG-7 | less work after each change and at each open of a chat, the Inbox, the task lists and the emoji panel |
| 3 Calls | LV-2, LV-3 (short form), LV-4, LV-9, DF-4 (safe part), DF-5, DF-6, DF-7, DF-10, DF-11, DF-13, BG-4 (step 1) | one batch for each save, chat about 1 s sooner, fewer round trips at each screen open |
| 4 Server | SV-2, SV-5 (a), SV-9, SV-11, SV-12 (if safe), DB-3 (handler CPU), DB-12 (counters) | about 15 to 40 ms off each call, about 200 ms of CPU off each Dashboard read |
| 5 Database | DB-2, DB-4, DB-5, DB-6, DB-8, DB-9, DB-10, DB-11, SV-10 | fewer bytes and statements on the badge, the bell, the Dashboard, the report and the job |
| 6 Instance reuse | the cause of cause 1 | if our start code blocks the reuse: about 230 ms off most calls |

## 4. Waits for the owner

Owner answers (2026-10-21): DF-14 yes, SV-7 and DF-2 yes, DB-13 no. LV-1 and the probe function are still open.

- **DF-14, instant Home after a relaunch.** Keep the last lists of each person on the device and show them at once; the fresh
  lists replace them about a second later. A phone shows Home 0.6 to 1.5 s sooner. A done task can show as open for that second,
  and the data rests on the device until sign-out.
- **SV-7 and DF-2, chat signals to the chat members only.** A direct or group message would no longer tell every other browser
  that somebody wrote (INT-16). The other tabs then skip a badge reload for each message. It is more private, and it needs
  leak tests.
- **DB-13, clean the outbox.** Delete sent mail, push and calendar rows after 30 days. It deletes stored rows.
- **LV-1, the font preload.** Preload only the Regular weight: the first visit of a new phone shows its first text about 1 s
  sooner, with a short swap of the bold text.
- **The probe function of track 6** on the test project: remove it when the probe is done.

## 5. Not built, and why

- DF-1 (reload only the lists that a change can touch): the biggest saving of calls, but the skeptic found a case where a list
  stays old (a task given to a person in a project where the person holds no row). It needs a generated test of every write
  first. Proposed for later.
- DF-3 and LV-8 (the reload after the first Realtime join): the reload is the guard for a change between the first read and the
  join. A safe form needs a new server call ("what changed since"). Proposed for later.
- DF-8, DF-9, BG-1, BG-3 (presence messages): the owner read the Realtime use on 2026-10-21 and accepted about 45% of the free
  quota with presence in. Each fix shows a dot later than today.
- DB-1 and BG-2 (a smaller office read for each call): a small saving on a few calls; the picture part is unsafe as written.
- FL-9 (WOFF2 fonts): the Thmanyah licence forbids a converted file. FL-12 (split the motion library): two tries gave no saving.
  FL-14 (brotli level): Cloudflare Pages gives no control. FL-6, FL-13, FL-15, FL-16, FL-18: small or not safe.
- DF-12 and LV-6 (CORS preflights): measured on 2026-10-08; the same-origin forwarder was slower. Needs a real iPhone first.
- SV-3 (bundle pg, about 6 ms) and SV-8 (join the save statements, high risk): not worth the risk now. SV-1, SV-4, SV-13 to SV-15:
  no change with a gain.
- RN-9 (keep the map alive), BG-12 (a picture cache in the service worker, a security question), DB-7 (a picked meeting copy can
  hide fields), DB-14 (database size, about four years to 500 MB): watch only.

## 6. The gap critic (2026-10-22)

The critic looked for what the seven auditors missed. Its six findings and their verdicts are at the end of `findings.md`.
- GP-1 (the first paint waits for the token renewal after 15 minutes, about 0.5 s on each later open): built in wave 3, after
  instant Home, because instant Home needs an early first render.
- GP-2 (a switch or a tick shows its result 1.3 to 1.9 s after the press): about 0.7 s of it was LV-2, fixed in wave 1. The rest
  needs an optimistic display, which the owner ruled out on 2026-10-08. Measured again after the release.
- GP-3 (uploads: confirm the file and its small picture together, three files at a time), GP-4 (a stable shell chunk, so a
  release renames fewer files), GP-5 (profile pictures as data in users.list): proposed for later. GP-5 first needs the Egress
  chart of production, which the owner reads.
- GP-6 (the nightly backup): nothing today; look again when the database passes about 50 MB.

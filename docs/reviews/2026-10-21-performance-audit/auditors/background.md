# Audit: background paths (key "background", prefix BG), code at 1d45aae5

## Measured (test copy madar-test only, read-only; no production contact)
- One tab = 1 socket + 17 channels (office, person:me, 15 status topics). Script: 24 channels (22 people) joined in 0.9 s warm, 3.6 s cold; 46 frames to join; 4 own state flips = 8 frames to the own tab (2 each); idle 70 s = 7 frames.
- pg_cron on madar-test: schedule */15, 731 runs in 7.5 days, 0 failed, 42 ms average for the cron command. Job statements are tiny (0.01 to 1.4 ms each).
- pg_stat_statements: the office load (OFFICE_ROWS_SQL, 3 text variants) ran 62,570 times, 211 rows each; office_meta was read 291,001 times. So 21 percent of reads started with a full office load. Test office = 258 rows, 60 KB JSON.
- Test copy sizes: chats.list 23 rows = 11.2 KB gzip; a message = 605 B raw JSON; users.list 14.6 KB with no pictures; sample task doc 378 B.
- Latency from the Mac: Pages /mcp 401 0.51 to 0.77 s, Pages /api/health 0.48 to 0.63 s; direct Supabase mcp function 0.83 to 0.97 s (region hop, not the user path); api health 0.36 to 0.44 s.
- Map first view cost (baseline build, gzip): maplibre 281 KB, worker 144 KB, rtl text 43 KB, css 10 KB = 478 KB.
- Not measured: a real browser heap or idle traffic (a sign-in would put a password in a tool call), anything on production.

## Checked and fine
Object URLs are revoked (files.ts:54-56). All intervals are cleared on unmount. keepAnswers timers and the midnight timer are removed. connectChanges keeps 500 ids at most. Presence maps drop a person who leaves (presence.ts close()). The typing board clears its timers. The satellite tile route sets private max-age 86400. Mail, push and Google run after the answer (AFTER_ANSWER_KINDS). Gone push endpoints (404/410) are deleted (notify.ts postToDevices). VAPID key import is cached. No fixed finding of 2026-10-08 came back.
The TASKS.md proposal "hourly cron reads 14,700 rows, 13,200 in the file size sum" is moot: JOB_STEPS has no usage step since 2026-10-23.

## Findings
See the structured result. Ranked: BG-1 presence flips, BG-2 cold office load and avatars, BG-3 hidden tabs listen, BG-4 background-tab heartbeat, BG-5 chat reload, BG-6 map chunk on every project page, BG-7 files tab thumbs, then smaller ones.

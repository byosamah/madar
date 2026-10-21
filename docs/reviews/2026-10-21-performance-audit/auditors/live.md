# Live audit of the test copy (key: live, prefix LV)
Run 2026-10-21 from a Mac in Jeddah (STC), Chromium 1243 headless over Playwright, test copy https://preview.madar-46r.pages.dev at 1d45aae5.
Raw JSON: scratchpad/live/*.json (a-coldwarm, c-screens, d-task, e-chat, f-idle, g-mobile, g-mobile-fonts, h-heap, s-signin, floor). Scripts in the same folder.
API calls to the test copy: about 505 (file api-count.json). Production was not touched. Writes: 5 chat messages x3 runs (cnv_013, member to admin, left in place) and 6 title edits of task tsk_010 (restored to the first title).

## Measurements (median [min-max], 4 rounds each, desktop 1280x800, load average 1 to 3.5)
| Step | member | admin | 2026-10-08 |
| --- | --- | --- | --- |
| Cold TTFB | 352 [308-382] ms | 313 [291-341] | 69 |
| Cold FCP | 964 [956-1004] | 1078 [844-1144] | 636-680 |
| Cold LCP | 2242 [2160-2580] | 2174 [2040-2196] | 1732-1888 |
| First batch answer | 1788 [1636-1870] | 1936 [1692-2001] | 1588-1720 |
| First rows on screen | 2038 [2011-2351] | 2025 [1951-2185] | n/a |
| Requests / OPTIONS / batches | 115 / 3 / 7 | 115 / 3 / 7 | 3 preflights |
| Bytes on the wire (all) | 1,249 KB (scripts 900, fonts 298, api 28) | 1,256 KB (api 34) | scripts 557, fonts 353 |
| Warm FCP / first rows | 220 / 820 ms | 188 / 813 ms | |
| Warm requests on the network | 8 (document 304 plus 7 batches), 0 OPTIONS, 0 assets | same | |

Notes. The TTFB gap is the route of this Mac (TLS to the Cloudflare edge Marseille takes 160 to 230 ms; curl shows 290 to 510 ms to first byte for both the HTML and an asset). Compare ratios, not the absolute values. Cache-control: /assets/* (scripts, fonts, words, css) is public, max-age=31536000, immutable; index.html is public, max-age=0, must-revalidate with an etag (304 on warm).
Edge call floor: GET /api/health 268 to 345 ms, a batch with session.get 176 to 286 ms, tasks.list mine 276 to 523 ms (same TLS connection). So each Edge call costs about 270 ms before any database work.
Screens (warm cache, click to data, median): Tasks 64 ms (cached Home rows, API 420-760), Projects 565, project page 600 (map canvas 730-1270), Inbox 500, a chat 483, Dashboard 549, Dashboard Map 948 to 974 (API 440), Open space 64 (cached), Meetings 515 to 646, task panel 582 to 664 (all reads 977 to 1076; one 2148 outlier), Notifications 483 to 548, Settings 65, Admin 65 (cached). Admin and member are alike.
One save: task title update, blur to answer 714 [649-1045] ms for the write batch (8 calls, 6 KB gzip). Two more batches follow at once (see LV-2).
Chat: press to own bubble 37 to 50 ms (instant send), press to send answer 500 to 850 ms, press to the other person's screen 2175 [2030-2445] ms.
Idle tab 2 minutes: 4 websocket frames a minute (2 heartbeats out, 2 replies in), 0 API calls. A 5 minute idle: 55 frames (33 presence_diff caused by other tabs on the test copy). The tab joins 24 channels (office, person, 22 status topics); the join costs 83 frames, 30 KB.
Mobile (Pixel 5, 4G 150 ms 1.6 Mbps 750 Kbps, CPU x4, cold): FCP 4960 [4896-4996], LCP 6296 [6172-6344], first rows 6172 [5968-6221], first batch answer 5694 [5572-5992], 4 long tasks (max 113 ms), TBT 160 [107-189] ms, 1.25 MB on the wire. Without the 3 fonts: FCP 3524, LCP 4640, first rows 4282, first batch 3983, 0.96 MB.
Sign-in page (signed out): mobile FCP 4608 to 4792 ms, desktop 876 to 880 ms; 98 scripts (900 KB gzip) and 3 fonts (287 KB) load there too.
Heap (CDP, after GC): 10.5 MB after load, 15.4 MB after 10 screen changes, 16.4 MB after 30, 16.5 MB after 5 idle minutes. Nodes 1,156 and listeners 1,019 stay flat from 10 to 30 changes. No leak. Idle main thread 2.8 ms a second.

## Findings
See the structured result. Short list: LV-1 font preload (mobile first data minus 1.9 s), LV-2 own write echo makes 3 batches for 1 save (regression of FET-3), LV-3 1 s merge window (chat 2.2 s), LV-4 chat send amplification, LV-5 idle prefetch of all 98 chunks, LV-6 three cold preflights, LV-7 words and render before first call, LV-8 join pass repeats the first load, LV-9 every tab press waits one edge trip, LV-10 map code on click, LV-11 Inter Latin 74 KB on first project page, LV-12 presence fan out, LV-13 immutable header on the SPA fallback.

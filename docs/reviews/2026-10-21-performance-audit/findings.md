# Findings of the speed audit of 2026-10-21

Each finding as the auditor wrote it, then the verdict of its skeptic. The skeptic form of a fix wins over the auditor fix.
Scores: 5 = everyone feels it every day, 1 = rare or tiny. The first score is the auditor score, the second is the skeptic score.

## First load

Measurements: Method: rebuilt 1d45aae5 in a copy (vite build --mode remote-test with config/remote.test.env, VITE_MADAR_API=remote). Same hashes as the test copy and baseline-remote (50 files, 1,236,844 B raw, 383,620 to 383,624 B gzip -9 per file by my script; the task file says 384,369 B, the difference is the gzip tool). A rolldown plugin dumped per-chunk module sizes and the module import graph; source maps gave minified bytes per package. Rebuilt 62855bc2 (end of the 2026-10-08 audit): 22 files, 1,055,514 B raw, 318,454 B gz. vendor and supabase chunks are byte-identical today and then, so all growth (+181 KB raw, +65 KB gz, +28 files) is app code via two static edges of Home: the task panel (37.6 KB gz) and dnd-kit through the Today list (27.8 KB gz with row glue; 17.9 KB gz for the library). Cumulative first-load results: base 383,624 B gz / 50 files; A (lazy task panel) 345,978 / 32; +F (3 overlays) 337,700 / 33; +C (supabase stubs) +Z (zod) 321,968 / 33; +overlay chunk for vaul and radix 302,311 B gz / 983,734 B raw / 33 files (minus 81,313 B gz, minus 21 %). All existing check-bundles rules pass on that build. Alone: A minus 37,646; B minus 35,687; C minus 11,976 gz. Timing (local HTTP/2 server, brotli 5, Cloudflare-like cache headers, Chrome CDP throttle 4x CPU, phone 390 px; medians of 4 to 5 runs): Slow 4G sign-in page first paint 4,572 to 4,096 ms; signed-in Home (API proxied to the test project) first paint 4,632 to 4,136 ms, heading 5,670 to 5,060 ms; Fast 4G first paint 1,520 to 1,360 ms. Words preload extra: 4,124 to 3,984 ms (Slow 4G), 1,352 to 1,192 ms (Fast 4G). Task panel press: 815-823 ms base; 1,317-1,328 ms with plain React.lazy; 816-827 ms with the loaded-module pattern. Real test copy (signed in as member@madar.test, phone profile Slow 4G): cold first paint about 4.75 s, Home heading 5.8 to 6.3 s, 1,230 KB and 115 requests (JS 906 KB); with prefetched screens blocked 893 KB and 94 requests and the same heading time; warm reload first paint 0.61 s, heading 1.3 s, 107 requests all from cache. Laptop: cold heading 1.97 s, warm 0.95 s. Cache headers (curl): hashed assets `public, max-age=31536000, immutable`, index and manifest `max-age=0, must-revalidate`, sw.js `no-cache`; dist/_headers is written by scripts/deploy/pages.sh from config/headers.template. sw.js handles push only and never fetch. CSS: one file on first load, 80,945 B raw, 16.4 KB gz, 83 % used on Home; no maplibre or emoji CSS. Fonts: first screen uses weights 400, 500/600, 700 (all three needed). Dev servers on ports 5181 to 5191 were stopped. Full report: /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/firstload.md and the per-file table in firstload-table.md next to it.

Not checked: Production (out of bounds). Real devices and real mobile networks: all timings use Chrome CDP throttling on this Mac with a local HTTP/2 server, not Cloudflare, and the signed-in runs proxy the API through Node. iOS Safari cache eviction and Home Screen app behavior. Early Hints (judged not useful: the HTML is a 2.5 KB edge-cached file). The dnd-kit static fallback and the motion feature split were not built (FL-2 measured with the whole list lazy plus an isolated library build; FL-12 two attempts failed). Words split by screen was only sized by a static scan, not built. The full unit tests, test:db, test:it and the prototype smoke were not run (single-file rule); the edits were checked with tsc (only the zodConfig test file needs an `export {}` and a test change), check-bundles, and a Playwright smoke on the local build (sign-in, Home, task panel, Realtime websocket). MapLibre load on a pinned project was not measured in a browser. Warm-load CPU was not measured with a real HTTP cache (Playwright turns the cache off when it routes requests), only the cold script and task durations. Chunk merging of the many tiny files (about 18 files under 1 KB) was not tested: HTTP/2 makes it worth about 10 KB. Cloudflare compression level was inferred from sizes, not from a setting. The Supabase-exit code (Workers, Durable Objects) was skipped except the parts bundled into the live first load (FL-16).

### FL-1: Home imports the whole task panel (chat log, comments, date picker, attachments) into the first load

- Score 4 to 3, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression True, confidence measured
- Where: src/features/home/HomeScreen.tsx:18 and :169; chain TaskSheet.tsx -> comments/CommentThread.tsx -> comments/TaskComments.tsx -> inbox/MessageLog.tsx (markRead chunk 47 KB raw), CalendarPopover.tsx, TaskTiming.tsx, Attachments.tsx
- Evidence: Rolldown module graph of 1d45aae5: HomeScreen -> ProjectTaskSheet is a static import, used only when ?task= is in the address. Rebuild of 62855bc2 (audit end) = 22 files, 318,454 B gz; today 50 files, 383,620 B gz. The chat upgrade made the panel pull MessageLog, MessageBubble, MessageMenu, ReactionPills, ImageViewer, PictureAttachments, EmojiButton, DateReason, MentionField (markRead chunk 14.7 KB gz), TaskSheet 11.6 KB gz, DateField, calendar, TaskTiming, Attachments, files. Coverage on signed-in Home: markRead 8 % used, TaskSheet 9 %, DateField 8 %, calendar 9 %, TaskTiming 10 %, Attachments 11 %. Measured: lazy TaskSheet at Home gives 32 files, 1,128,586 B raw, 345,978 B gz (minus 37,646 B gz, minus 108 KB raw, minus 18 files). Pitfall measured: plain React.lazy adds about 500 ms to the first press (Suspense reveal throttle): press to dialog 815-823 ms base, 1,317-1,328 ms plain lazy, 816-827 ms with the loaded-module pattern below.
- Impact: Every person after every release (the changed app chunks download again) and every cold phone: about 38 KB gz and 18 requests before first paint. On Slow 4G (1.6 Mbps, 150 ms) each KB costs about 5 ms; with the other fixes first paint is 476 ms sooner (4,572 to 4,096 ms on the sign-in page), 496 ms sooner and heading 610 ms sooner on signed-in Home. Fast 4G: first paint 120 to 160 ms sooner.
- Fix: In HomeScreen.tsx keep a module-level `let loadedSheet`; `const loadSheet = () => import('../project/tasks/TaskSheet').then(m => { loadedSheet = m.ProjectTaskSheet; return m; })`; `const LazySheet = lazy(() => loadSheet().then(m => ({default: m.ProjectTaskSheet})))`. Render `loadedSheet ? <loadedSheet .../> : <Suspense fallback={null}><LazySheet .../></Suspense>`. Call loadSheet 1 s after Home mounts (effect with timer) and at once in main.tsx warmFirstScreens when the address holds ?task=. Update the Home tests to await the panel. Raise a bound in check-bundles.ts (see FL-11) and add a none-rule for a string only the panel holds.
- Behavior note: A press in the first second after Home shows the panel one chunk load later. Deep links with ?task= keep the panel at the same time if the chunk is started in warmFirstScreens.
- Skeptic impact: About 38 KB gz (190 ms on Slow 4G) after each release, because the panel chunks sit in the app code that changes. Not a reverted fix: the panel was already static at 62855bc2 (inside the index chunk) and grew with the chat upgrade.
- Skeptic fix note: The loaded-module pattern is safe. Also start loadSheet in warmFirstScreens when the address holds ?task= (push links open Home with a task).
- Skeptic evidence: Re-read HomeScreen.tsx:18,169. Diffed xa against main. Re-counted first load: 50 files 383,620 B gz to 32 files 345,978. Old build 62855bc2 has no TaskSheet chunk because it was inside index.

### FL-2: dnd-kit (drag order) sits in the first load through the Today list

- Score 3 to 2, verdict confirmed, fix safe True, effort M, risk medium, behavior change False, regression True, confidence measured
- Where: src/features/home/TodayPanel.tsx:6 and :18; src/features/project/tasks/SortableTaskRows.tsx:1-2 (also used by TaskList.tsx and WorkTasks.tsx, lazy screens)
- Evidence: index chunk holds @dnd-kit/core 85 KB rendered, sortable 14.8, utilities 6.4, accessibility 1.1. Isolated build of only the imported names: 54,629 B raw, 17,908 B gz. Not in the 62855bc2 first load (added by the drag-order feature of 2026-10-07/08). Measured with the whole row list lazy: 27 files, 347,937 B gz alone (minus 35.7 KB, includes TaskRowItem which a static fallback must keep); A+B together 318,179 B gz = the 2026-10-08 size.
- Impact: Every cold load and every release re-download: about 18 KB gz (up to 28 KB with the row glue) before first paint; about 90 ms on Slow 4G.
- Fix: Split SortableTaskRows: a static list with the same markup (TaskRowItem rows, same grip button, no listeners) and a lazy DragLayer (DndContext, SortableContext, useSortable) swapped in after the chunk loads. Use the loaded-module pattern of FL-1 (no Suspense step), warm it at idle. Keep AnimatePresence behavior and the 'still' state. Add a first-load none-rule for the string 'DndDescribedBy'.
- Behavior note: A grip press in the first second may wait for the chunk if the layer is not loaded yet.
- Skeptic impact: 18 to 28 KB gz (about 90 ms on Slow 4G) in the index chunk, repeated each release. Added by commit ef24a113 on 2026-10-08, after the last audit, so new growth rather than a reverted fix.
- Skeptic fix note: Swapping a static list for the drag layer remounts the rows once. Add a test that a focused row keeps focus and no row re-enters with an animation. Warm the chunk at idle.
- Skeptic evidence: Read SortableTaskRows.tsx and TodayPanel.tsx. Re-counted xb: 20 files 318,179 B gz, minus 27.8 KB against xa.

### FL-3: vaul, radix and scroll-lock packages are forced into the first-load vendor chunk

- Score 3 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: vite.config.ts:89-91 (REMOTE_CHUNKS vendor test lists vaul, @radix-ui, react-remove-scroll, react-remove-scroll-bar, react-style-singleton, use-callback-ref, use-sidecar, aria-hidden)
- Evidence: Source-map attribution of vendor: vaul 8.3 KB gz, react-remove-scroll 1.7, radix dismissable-layer 1.6, dialog 1.4, focus-scope 1.1, presence 0.8, slot 0.7, others, aria-hidden 0.4, use-sidecar 0.3: about 19.7 KB gz. After FL-1 and FL-4 no first-load module imports Sheet.tsx or vaul (module graph). Build with those names removed from the vendor test and a new group `overlay`: 33 files, 983,734 B raw, 302,311 B gz (minus 19,657 B gz on top of A+F+C+Z); overlay chunk is 65,532 B raw, imports only rolldown-runtime and vendor, so it keeps a stable name across releases. check-bundles passes (all rules).
- Impact: Every cold load: 19.7 KB gz less before first paint, about 100 ms on Slow 4G. The overlay chunk loads when the first sheet opens or at idle prefetch.
- Fix: In vite.config.ts remove those package names from the vendor test and add `{ name: 'overlay', test: /node_modules[\\/](vaul|@radix-ui|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden)[\\/]/ }` before the supabase group. Add 'overlay' to checkStableChunks in scripts/check-bundles.ts (allowed imports: rolldown-runtime-, vendor-). Do it after FL-1 and FL-4, or Sheet stays static and nothing is gained.
- Skeptic impact: The bytes are real (19.7 KB gz, about 100 ms) but they sit in the vendor chunk, whose hash is identical at 62855bc2 and today and which is immutable. After a release the browser keeps it, so the saving is only for the first visit of a device. Moving the packages also changes the vendor hash once, so everyone downloads vendor again after that release.
- Skeptic fix note: Safe, and it works only after FL-1 and FL-4. Expect one extra vendor download on release day. Worth doing only if first visits on new phones matter.
- Skeptic evidence: Compared vendor-Qsj3nOJd.js in old2/dist and baseline: same name. Re-counted xg: 33 files 983,734 B raw, 302,311 B gz. curl on the test copy: cache-control public, max-age=31536000, immutable.

### FL-4: Three conditional overlays are in the first load: FocusMode, FeedbackSheet, SessionExpiredSheet

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/app/AppShell.tsx:7 and :132 (FocusMode); src/app/PersonMenu.tsx:23 and :134 (FeedbackSheet); src/features/auth/AuthGate.tsx:8 and :69 (SessionExpiredSheet)
- Evidence: index chunk attribution: FocusMode 1.4 KB gz, FocusTimer 0.6, FeedbackSheet 0.9, SessionExpiredSheet 0.5, plus Sheet and icons. Build with the three lazy on top of A: 33 files, 337,700 B gz vs 345,978 B (minus 8,278 B gz, minus 21 KB raw).
- Impact: About 8 KB gz and a few ms of parse on every cold load. Small, but they also keep Sheet and vaul static (see FL-3).
- Fix: Same loaded-module pattern as FL-1. FocusMode: render the lazy component only when ?focus= is set (useFocusLink). FeedbackSheet: mount it at the first open and keep it mounted so the close animation stays. SessionExpiredSheet: mount when `expired` is true. Warm each chunk at idle.
- Behavior note: A first open inside the first second waits for one small chunk.
- Skeptic impact: About 8 KB gz (40 ms on Slow 4G) in the index chunk. Its main value is to unlock FL-3, which is itself small.
- Skeptic fix note: Safe. In the experiment the lazy FeedbackSheet and FocusMode mount at first render, so the chunk request starts at once (small). Mount on first open as the finding says.
- Skeptic evidence: Diffed xe against main. Re-counted xe: 33 files 337,700 B gz, minus 8,278 B against xa.

### FL-5: Supabase chunk carries storage, postgrest, functions and iceberg clients that the app never calls

- Score 3 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: vite.config.ts (add resolve.alias for the remote modes); src/app/remote/supabase.ts:1; node_modules/@supabase/supabase-js/dist/index.mjs:680-688 (constructor builds PostgrestClient and StorageClient)
- Evidence: grep of src: the app uses only supabase.auth.*, supabase.channel, supabase.removeChannel, supabase.realtime.setAuth. Attribution of supabase-hBF1nWiT.js (54,229 B gz): auth-js 24.7 KB gz, realtime-js 7.6, phoenix 6.4, storage-js 5.6, postgrest-js 4.1, supabase-js 2.6, iceberg-js 1.3, functions-js 0.7. Build with the three packages aliased to an empty-class stub: supabase chunk 166,510 B raw (was 213,590), first load 371,648 B gz alone (minus 11,976 B gz). Functional check on the local build with proxied API: sign-in works, Home loads, 1 websocket opens (Realtime), task panel opens, no console errors.
- Impact: Every cold load: 12 KB gz and 47 KB raw less before first paint (about 60 ms on Slow 4G, less parse).
- Fix: In vite.config.ts add for remote modes alias entries '@supabase/storage-js', '@supabase/postgrest-js', '@supabase/functions-js' -> src/stubs/unusedClients.ts (empty classes: PostgrestClient, PostgrestError, StorageClient, StorageApiError, FunctionsClient, FunctionsError, FunctionsFetchError, FunctionsHttpError, FunctionsRelayError, FunctionRegion). Add a test that fails when src uses client.from(, .rpc(, .storage or .functions, and a check-bundles none-rule for 'StorageUnknownError'. Remove iceberg-js from the supabase group test if it stays unused.
- Skeptic impact: 12 KB gz and 47 KB raw, but in the supabase chunk (same hash then and now, immutable). It repeats only for the first visit of a device, plus a few ms of parse each load. One extra supabase download after the release that ships it.
- Skeptic fix note: Safe for today (the app calls only auth, channel, removeChannel, realtime.setAuth). An alias on node_modules packages is fragile: keep the source-scan test so a supabase-js upgrade that calls these clients fails the build.
- Skeptic evidence: Read src/app/remote/supabase.ts (createClient only). Re-counted xc: 371,648 B gz, minus 11,972 B. Read the stub in xc/src/stubs. Hash supabase-hBF1nWiT.js is identical in old2 and base.

### FL-6: The first-language words start only after the whole first-load closure has run

- Score 2 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence measured
- Where: vite.config.ts:41-52 (earlyLinks plugin); src/i18n/firstWords.ts:10; src/main.tsx:69 (await loadWords)
- Evidence: Slow 4G phone timeline on the test copy: vendor ends 4,075 ms, words.en 4,233 to 4,585 ms (34 KB), first Home API call starts 4,774 ms. Desktop: words.en starts 513 ms after the scripts end. Local build with a modulepreload for words.en and mergeWords added to index.html: signed-in Home first paint 4,124 to 3,984 ms (Slow 4G) and 1,352 to 1,192 ms (Fast 4G); heading minus 60 ms. No extra bytes: en words load in every session (fallback language).
- Impact: Every cold load, 140 to 160 ms sooner first paint, and the API calls start earlier.
- Fix: In earlyLinks add modulepreload links for the words.en chunk and its static imports (mergeWords), found like the bootstrap closure. Change scripts/check-bundles.ts: the rule 'no words of a language in the first-load scripts' counts modulepreload files, so exempt the words chunks (check the marker in the entry closure only, or allow words.en by name).
- Skeptic impact: 140 to 160 ms was measured with an English browser. In an Arabic browser the words.en preload (34 KB) is a second request on the critical path next to words.ar, and may delay it. It conflicts with FL-7 option B.
- Skeptic fix note: No language-blind safe form: CSP forbids an inline script that could pick the language. Skip it, or do it only if the office browsers are English.
- Skeptic evidence: Read firstWords.ts, main.tsx:85 and vite.config.ts earlyLinks: the first language comes from browserLanguage() at run time.

### FL-7: The other language loads at the first render in every session

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change True, regression False, confidence measured
- Where: src/main.tsx:85 (void loadWords(language === 'ar' ? 'en' : 'ar'))
- Evidence: Cold sessions fetch words.ar 47.8 KB on the wire (English session) or words.en 37.2 KB (Arabic session) right after the first render, at the same time as the Home API calls (Slow 4G: 4,623 to 5,249 ms). Both files stay in the cache until the next release changes them. Tests show no latency effect on the Home heading, so the cost is data and battery.
- Impact: 38 to 48 KB gz of data per cold session for people who never switch language, and a new download after each release that changes the words (almost every release adds words).
- Fix: Option A (no behavior change): load it after the first Home data settled plus an idle gap of 3 s. Option B: load it only when the person switches language (withWords already waits for the words, so the first switch takes one chunk load). Keep fallbackLng 'en' only if a test proves every Arabic key exists (words.test.ts).
- Behavior note: Option B: the first language switch of a cold session waits about 100 to 300 ms for the words. Option A has no visible change.
- Skeptic impact: 38 to 48 KB gz of phone data after each release (the words chunks change with What's new). No delay a person feels, no cost on a free plan (Cloudflare Pages).
- Skeptic fix note: Option A (load after the first Home data and an idle gap) is safe. Option B changes behavior and makes FL-6 harmful.
- Skeptic evidence: Read main.tsx:85. words.en 117,883 B (36,250 gz), words.ar 186,697 B (46,565 gz) measured on baseline.

### FL-8: Idle prefetch loads all 20 screens in every cold session, including screens the person cannot or never opens

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change True, regression False, confidence measured
- Where: src/main.tsx:87 (prefetchScreens); src/app/screens.ts prefetchScreens; src/app/screenLoaders.ts (order)
- Evidence: Signed-in member on the test copy, Slow 4G phone profile: cold session 1,230 KB on the wire and 115 requests; with the screen chunks blocked 893 KB and 94 requests (JS 906 vs 566 KB). The prefetch fetches DashboardScreen 91.5 KB, ProjectScreen 32.2, AdminScreen 31.2, schemas 24, OpenSpaceScreen 59.9 + CSS 3.6, MeetingView 17.1, Inbox 12.3, Search 9.2 and the five sign-in screens (signIn, welcome, forgot, reset, consent, 11 KB) for a person who is signed in. Heading time: 5,784 / 6,322 / 5,880 ms with prefetch, 5,753 / 5,771 / 5,896 ms without: no effect on first data.
- Impact: About 340 KB of mobile data and radio time in each cold session (each release makes most devices cold again), plus parse of 1.2 MB raw JS at idle. No visible delay today.
- Fix: Skip signIn, welcome, forgot, reset and consent when a session is stored (hasStoredSession). Skip admin when opensAdminPage (src/api/rights.ts) is false for the session. Stop the queue when navigator.connection.saveData is true or effectiveType is 2g or 3g. Keep the others so a release that removes old chunks still finds them in memory (loadForNavigation already reloads once on a failed import).
- Behavior note: A first open of a skipped screen waits for its chunk once (about 100 to 300 ms on a phone).
- Skeptic impact: The 340 KB is the whole prefetch. The safe fix (skip the 5 sign-in screens for a signed-in person, and Admin for a person who cannot open it) saves about 36 KB gz (5.6 KB + 30 KB), not 340 KB. The saveData and 2g/3g part changes behavior.
- Skeptic fix note: Skipping sign-in screens is not fully free: SessionExpiredSheet leads to Sign in, so that screen then loads on demand once. Keep Dashboard and the others.
- Skeptic evidence: Read screens.ts prefetchScreens and screenLoaders.ts. gzip -9 of baseline chunks: SignIn 921, Welcome 1,530, Forgot 703, Reset 905, Consent 1,565, Admin 29,972 B.

### FL-9: Thmanyah fonts ship as OTF; WOFF2 would save about 45 KB on each cold load

- Score 2 to 1, verdict weakened, fix safe False, effort S, risk medium, behavior change False, regression False, confidence measured
- Where: src/design/fonts/thmanyahsans-*.otf; vite.config.ts:41 (font preload type font/otf); scripts/check-bundles.ts:56 (FONT_WEIGHTS, sha256 compare)
- Evidence: Sizes raw 241,292 / 242,116 / 242,808 B. Cloudflare sends them as brotli at 92.9 / 94.0 / 94.0 KB (281 KB total, 37 % of the cold critical bytes on Slow 4G). Same OTF tables in a WOFF2 container (fontTools, lossless): 77,896 / 79,272 / 79,436 B (236.6 KB). The first screen uses all three weights (400, 500/600, 700 measured on Sign in, Home, Projects, Work, Inbox), so the three preloads must stay. fetchpriority=low on the preloads gave no gain (first paint 4,108 vs 4,096 ms).
- Impact: About 45 KB less on a cold load: 225 ms on Slow 4G, 40 ms on Fast 4G.
- Fix: Owner decision first: the licence forbids any change to the font files; ask if a lossless WOFF2 container counts. If yes: build step makes woff2 from the three OTF files, tokens.css points to them with format('woff2'), preload type font/woff2, check-bundles compares the glyph tables or the source hash. If no: leave as is.
- Skeptic impact: The saving is real on paper (about 45 KB), but it comes only from a stronger compression level: brotli 11 of the OTF files gives 79,214 / 78,707 / 77,638 B, equal to WOFF2. Fonts stay cached across releases, so it repeats only on first visits.
- Skeptic fix note: src/design/CLAUDE.md says never convert, subset or rename the Thmanyah files. A WOFF2 container is a conversion. The owner would need a written yes from Thmanyah. No safe form.
- Skeptic evidence: Read src/design/CLAUDE.md lines 28 to 31. Measured brotli 5 and 11 of the three OTF files in baseline-remote.

### FL-10: zodConfig.ts pulls zod core utilities into the first load

- Score 1 to 1, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/app/zodConfig.ts:1; src/app/zodConfig.core.test.ts
- Evidence: index chunk holds zod/v4/core/util.js 15.2 KB rendered and core.js 3.1 KB (attribution 3.3 KB gz) only because of `import { config } from 'zod/v4/core'` (the barrel). Replacing it with a write to globalThis.__zod_globalConfig (the object that config() fills, zod/v4/core/core.js:135) removes it: minus 3.9 KB gz. The first test of zodConfig.core.test.ts already checks the global.
- Impact: About 4 KB gz on every cold load.
- Fix: Write `globalThis.__zod_globalConfig = { ...(globalThis.__zod_globalConfig ?? {}), jitless: true }` in zodConfig.ts (add `export {}`), change the second test (it pins the import line) to forbid any zod import, keep the first test as the guard against a zod upgrade that renames the key.
- Skeptic impact: About 3.9 KB gz in the index chunk, each release.
- Skeptic fix note: Use an in-place change, not a replacement of the object: `const g = (globalThis.__zod_globalConfig ??= {}); g.jitless = true`. A replacement breaks a zod core that loaded earlier and already holds the old object. Keep the guard test.
- Skeptic evidence: Read node_modules/zod/v4/core/core.js:135-141 (zod 4.6.5) and the xf zodConfig.ts. xf minus xe = 15.7 KB gz with FL-5.

### FL-11: check-bundles bound is 113 KB above the real first load, so the growth passed the gate

- Score 2 to 2, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: scripts/check-bundles.ts:45 (FIRST_LOAD_MAX_BYTES = 1_350_000) and checkFirstLoad (raw bytes only, no file count, no gzip)
- Evidence: The first load grew from 1,055,514 B raw (62855bc2) to 1,236,844 B and the rule stayed green (limit 1,350,000). Measured sizes after each fix: A 1,128,586 B raw / 345,978 B gz / 32 files; A+F 1,107,739 / 337,700 / 33; A+F+C+Z 1,049,403 / 321,968 / 33; A+F+C+Z+overlay 983,734 / 302,311 / 33; with FL-2 about 930,000 / 284,000 / 28. check-bundles passed all existing rules on the 983,734 B build.
- Impact: Prevents the next silent growth; the audit of 2026-10-07 set the rule but the limit is too loose.
- Fix: After FL-1 to FL-5 set FIRST_LOAD_MAX_BYTES to 1,010,000 and add FIRST_LOAD_MAX_GZIP 312,000 (gzip -9 per file, sum) and FIRST_LOAD_MAX_FILES 40. After FL-2 lower to 955,000 raw / 295,000 gz / 34 files. Add none-rules for markers of code that must stay lazy: 'DndDescribedBy' (dnd-kit), 'StorageUnknownError' (storage client), a string of MessageLog (chat log), and the vaul marker. Update each bound in the same commit as its saving.
- Skeptic impact: A guard, no speed gain by itself. The limit 1,350,000 B is 113 KB above the real 1,236,844 B.
- Skeptic fix note: Set each bound in the same commit as the saving it guards. Add the gzip and file-count rules.
- Skeptic evidence: Read check-bundles.ts:45,186. Re-counted the base build: 1,236,844 B raw.

### FL-12: The motion library (38.8 KB gz) is fully in the first-load vendor chunk; layout, drag and projection code is not needed at first paint

- Score 3 to 1, verdict weakened, fix safe False, effort L, risk medium, behavior change False, regression False, confidence inferred
- Where: vite.config.ts:89-91 (vendor test lists motion, motion-dom, motion-utils, framer-motion); 20 files import `motion` from 'motion/react'; src/main.tsx:6 and :56 (MotionConfig)
- Evidence: Attribution of vendor: motion-dom 28.6 KB gz + framer-motion 10.2 KB gz. layoutId and layout are used (TabPill.tsx:43, Tabs.tsx:38, ProjectListRow.tsx:49 and :66, TaskRowItem.tsx:100, ProjectHeader.tsx:27), so domMax is needed after first paint but not before. Two attempts in a copy gave 0 bytes: (1) `import { m as motion }` in 20 files plus LazyMotion with a dynamic domMax: vendor still holds everything because the vendor group forces the motion packages in and `motion/react` does `import * as fm`; (2) alias motion/react to framer-motion and drop the packages from vendor: Rolldown still puts projection and drag code (86 KB raw) in a chunk that the entry imports statically.
- Impact: Potential 20 to 28 KB gz off the first load (about 130 ms on Slow 4G) if the features chunk can be isolated.
- Fix: Add a chunk group that holds only framer-motion/dist/es/render/dom/features-max, motion/features, gestures and motion-dom/projection, import them only from a dynamic features module used by LazyMotion, alias motion/react to framer-motion for the remote build, and use `m` in the 20 files. Trace with the module graph until the first-load closure holds no create-projection-node. Check the tab pill and project name transitions in screenshots (EN/AR, light/dark, 390 px).
- Behavior note: Layout animations start after the features chunk loads (a few ms after first paint).
- Skeptic impact: Unproven (two attempts gave 0 bytes). The code is in the vendor chunk, which stays cached, so it repeats only on first visits. LazyMotion starts the animation features after first paint.
- Skeptic fix note: Entrance, exit and layout animations would start later than today: a visible change. Not safe without screenshots in EN/AR, light/dark, 390 px, and no proven saving. Drop it.
- Skeptic evidence: Read the finding's two failed attempts and vite.config.ts vendor group. Vendor hash is the same at 62855bc2 and today.

### FL-13: Words could split by screen (small gain)

- Score 1 to 1, verdict confirmed, fix safe True, effort L, risk medium, behavior change False, regression False, confidence inferred
- Where: src/i18n/words.en.ts, words.ar.ts, src/i18n/index.ts (loadWords), src/app/screenLoaders.ts
- Evidence: words.en 117,883 B raw (37.2 KB wire), words.ar 186,697 B raw (47.8 KB wire). Top-level key sizes (en, chars): whatsNew 14.9K, roleRights 11.3K, projectTemplates 8.7K, errors 8.5K, dashboard 7.2K. A static scan finds only 35K of 120K en chars (29 %) and 40K of 130K ar chars referenced by lazy modules alone; the big groups (whatsNew, dashboard, admin, tracker) are also referenced by first-load code (links, nav, person menu).
- Impact: At most about 5 KB gz (en) or 8 KB gz (ar) off the critical path, and the words still download later.
- Fix: Only after FL-1 to FL-7: move lazy-only groups (roleRights, mail, signinMail, map, adminReach, gcal, series, taskHistory, links, projectForm and similar) into words.<lang>.late.ts, loaded by the screen loader of the screens that use them. Add a test that scans src for `t('<group>.` and fails when a first-load module uses a late group.
- Skeptic impact: At most 5 to 10 KB gz for a large change. Effort L.
- Skeptic fix note: There are 148 dynamic t() calls, so a static key scan is not complete. Add a run-time check for missing keys before moving a group.
- Skeptic evidence: Measured words sizes on baseline. grep count of t(`...`) calls in src.

### FL-14: Cloudflare compresses with a low brotli level

- Score 2 to 1, verdict weakened, fix safe True, effort L, risk medium, behavior change False, regression False, confidence inferred
- Where: Cloudflare Pages (config/headers.template cannot set content-encoding); scripts/deploy/pages.sh
- Evidence: curl with Accept-Encoding br on the test copy: vendor 189,561 B (br) vs 185,500 B (gzip) vs 160,882 B (brotli level 11 offline); index 47.7 KB served vs 41.4 KB at level 11; Thmanyah Regular 92.9 KB served vs 77.6 KB. First load as delivered 438 KB (with headers) vs 333.5 KB at level 11 for the 50 files.
- Impact: Up to 20 to 25 % of the cold-load JS bytes (about 50 KB gz for the lean first load, 0.25 s on Slow 4G).
- Fix: Pages cannot take precompressed files. Only a Worker that serves the assets with Content-Encoding (the paused Cloudflare Worker path of the Supabase exit) or a custom serving step could use level 11. Record it as a reason to keep the first load small; do not build now.
- Skeptic impact: I confirm the numbers on the test copy: vendor 189,488 B (br) against 185,500 B (gzip) and 160,882 B (brotli 11); index 47,896 B (br). But Cloudflare Pages gives no control of the level, and vendor is cached. Not actionable.
- Skeptic fix note: No change to make. Keep it as a note that supports a small first load.
- Skeptic evidence: curl with Accept-Encoding br and gzip on preview.madar-46r.pages.dev (test copy). brotli -q 5 and -q 11 on baseline vendor: 177,928 and 160,882 B.

### FL-15: The digits font starts only after the first data renders

- Score 1 to 1, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/design/tokens.css:227 (Madar Digits, Madar Dot), vite.config.ts:41-52 (3 font preloads), scripts/check-bundles.ts:56 and checkEarlyLinks (expects exactly 3 font links)
- Evidence: inter-digits-dot-CXY0a2cG.woff2 (11 KB) is requested at 1,539 ms on the laptop and 5,786 ms on the Slow 4G phone, right after the Home data rendered; numbers show first in the fallback digits (font-display swap) and then swap.
- Impact: A small swap of digits on every cold Home (counts, dates) about 100 to 220 ms after the data. 11 KB on the critical path if preloaded (55 ms on Slow 4G).
- Fix: Add a fourth preload for the digits file in earlyLinks and let check-bundles accept it (update the count rule and its test). Only worth it if the owner sees the swap.
- Behavior note: Removes a visible swap.
- Skeptic impact: A small digit swap after the first data, about 100 to 220 ms. The preload adds 11 KB on the sign-in page, which may show no digit.
- Skeptic fix note: Safe. It must change the three-font rule and its test in check-bundles.ts. Only do it if the owner sees the swap.
- Skeptic evidence: Read the finding's tokens.css and earlyLinks references. earlyLinks preloads FONT_WEIGHTS only (vite.config.ts).

### FL-16: Exit-path code and the full rights catalog are in the first load of the Supabase build

- Score 1 to 1, verdict weakened, fix safe True, effort M, risk low, behavior change False, regression False, confidence read
- Where: src/app/remote/bootstrap.ts:4,15,16 (liveSocket, madarAuth, officeLive); src/app/remote/authMail.ts; src/api/rightsCatalog.ts (permissions chunk)
- Evidence: Attribution of bootstrap-*.js (9,172 B gz): madarAuth.ts 1.0 KB gz, liveSocket.ts 1.0, officeLive.ts 0.3, authMail.ts 0.2: about 2 KB gz that runs only with VITE_MADAR_AUTH=madar or VITE_MADAR_LIVE=socket (no copy sets them). permissions chunk 21,126 B raw: rightsCatalog.ts 16.3 KB min, 3.1 KB gz (112 switch ids with scopes and needs) for can().
- Impact: About 5 KB gz and a little parse on every cold load.
- Fix: Import madarAuth and officeLive with import() behind the build flags (VITE_MADAR_AUTH, VITE_MADAR_LIVE) so the Supabase build drops them; keep isTypingSignal in its own small file. Optionally store the catalog as a compact string table. The Supabase-exit code is paused, so keep this behind a flag test.
- Skeptic impact: About 2 KB gz of paused exit code in the bootstrap chunk. The rights catalog is needed by can(), so no saving there.
- Skeptic fix note: The flags are read at run time (authModeOf), so the bundler cannot drop the code. It needs a build-time constant guard: effort M for 2 KB, and it touches the paused exit path. Low value.
- Skeptic evidence: Read bootstrap.ts lines 4 to 16, 34, 211 and authMode.ts.

### FL-17: MapLibre (about 480 KB gz) starts only when the About tab has rendered a pinned project

- Score 2 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence read
- Where: src/features/project/overview/ProjectPlace.tsx:7 and :20; src/features/map/MapCanvas.tsx:79-84 (loadMapLib)
- Evidence: Sizes: maplibre-gl 1,062,985 B raw (282 KB gz9), maplibre worker 509,702 (145 KB), rtl text plugin 147,947 (43 KB), CSS 82,962 (10 KB): about 480 KB gz, about 600 KB with Cloudflare brotli. The import starts after the project read answered and ProjectPlace rendered (detail.geo). The chunks have stable names, so they stay cached across releases. Not measured in a browser (no pinned project looked at).
- Impact: The first About view of a pinned project on a device waits for the project read and then for the map download: about 2.5 s of transfer on Slow 4G before the map shows.
- Fix: Start the import of MapCanvas and loadMapLib when the project route loads (in the project screen loader or in the same moment as the project read), so it overlaps the read. Do not prefetch at Home on phones (480 KB). Measure on a pinned project of the test office first.
- Skeptic impact: The map chunks have stable names, so the wait (about 479 KB gz, 2.5 s on Slow 4G) is only the first pinned project on a device. The chain is read, then the MapCanvas chunk, then maplibre, worker and rtl in parallel.
- Skeptic fix note: Starting the import at the route load pulls 479 KB gz for every project, also the ones with no pin (ProjectSummary has no geo). Safe form: call loadMapLib() inside the lazy factory of ProjectPlace so the library request starts with the MapCanvas request.
- Skeptic evidence: Read ProjectPlace.tsx and MapCanvas.tsx:79-84. gzip -9 sizes: maplibre 281,095, worker 144,198, rtl 43,302, css 10,424 B.

### FL-18: No live check of the cache headers, and the manifest and icons revalidate on every load

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: tests/e2e-deploy (no cache-control assertion); scripts/deploy/pages.sh:21 and config/headers.template (/assets/* and /sw.js rules only)
- Evidence: Test copy: /assets/*.js, *.css, *.otf, *.woff2 send `public, max-age=31536000, immutable` (curl), and a warm reload made 107 cached requests with 0 bytes on the wire except the document. That comes only from dist/_headers, which pages.sh writes at deploy; only scripts/deploy/headers.test.ts checks the generator. /manifest.webmanifest, /icons/*, /favicon.ico send `max-age=0, must-revalidate`. The HTML revalidates on each load (84 to 120 ms laptop, about 160 ms phone), by design.
- Impact: If a deploy ever ships without _headers, every warm load would revalidate 50 files (about 50 conditional requests, 300 ms or more on a phone). Now the manifest costs one conditional request per load.
- Fix: Add a deploy-suite test that fetches one hashed script and one font from the live copy and expects `immutable` and a content-encoding. Add `/icons/*` and `/manifest.webmanifest` rules with `max-age=86400` to config/headers.template. Keep index.html on must-revalidate (a stale shell would point at removed chunks).
- Skeptic impact: The risk is hypothetical: pages.sh always writes _headers and headers.test.ts covers the generator. The manifest costs one parallel conditional request, off the critical path.
- Skeptic fix note: A live header test in the deploy suite is cheap and safe. A one-day cache for icons and the manifest delays an icon change by one day.
- Skeptic evidence: Read config/headers.template and scripts/deploy/pages.sh:21. curl on the test copy: manifest cache-control public, max-age=0, must-revalidate; vendor chunk immutable.

## Screen rendering

Measurements: All numbers are jsdom (Vitest 5.0.2, single files, --no-file-parallelism, load average 2.8 to 3.4), in my copy at scratchpad/copies/render over the sample office plus bulk data (150 groups, 200 messages, 150 tasks, 110 projects, 100 notices). Counts are exact; milliseconds only compare runs (Chrome is about 3 to 5 times faster). Inbox: 167 rows, 4,444 nodes, 667 to 678 ms mount; chat of 200 messages: 203 li, 3,741 nodes, 1,029 to 1,102 ms open; new message: 1 bubble render at 106 messages, 200 at 200 messages (1 with trial fix). Presence change: 1 face render in the list, 67 in an open chat (the faces of that person). Typing signal: 1 row, 0 bubbles. 5 keystrokes in the box: 0 bubble renders, 20 ms. Chat search 5 keys: 71 ms. Tasks list 205 rows 5,506 nodes, one change renders 205; project To-dos tab 157 rows 6,626 nodes, one change renders 157 rows and 157 faces, 314 rect reads (trial: 1 and 1). Projects: 122 rows 4,190 nodes, one change renders 122 rows and 122 tiles, 653 ms (trial: 1 tile, 128 ms). Notifications: 100 rows 1,740 nodes, 561 ms mount, one read renders 100 (trial: 4). Emoji panel: 159.7 ms mount, 1,878 cells, 3,807 nodes, focus move 16.9 ms, clear search 113 ms. Open space: 122 cards 3,449 nodes, task panel open renders 122. Dashboard schedule: 119 rows 3,003 nodes, one row open 233 ms. Shell: 5 query changes give TabPill 5, PersonMenu 10. Hidden tools: 8 of 19.7 nodes per bubble, 7 of 23 per chat row. The five existing *Renders.test.tsx files pass; 64 tests of 10 touched files pass with the trial patch (scratchpad/audit/render-trial.patch). Full report: scratchpad/audit/render.md.

Not checked: No real browser (no layout, paint, GPU, battery or Safari/iOS numbers), so RN-9, RN-13, RN-14, RN-17 are inferred. Not read in depth: Tracker history, project Activity feed entries (paged 50 to 200, not memoized), Files rows (3 mutation hooks per row), Workload table and recharts charts, meeting view, Admin sections other than Roles (small lists, no issue found). Data dimension, for the data auditor: session.get, chats.unreadCount and notifications.count are always mounted and reload on any tasks or projects change office-wide (src/app/readMap.ts:88-95), which multiplies every render count above; session.get carries the person's picture twice (user and authority, up to 16 KB each) and users.list carries every picture. Presence Realtime message budget was already modelled in proof.md (about 0.85 to 0.92 million a month), not repeated. Server and Workers code skipped as told. No production contact.

### RN-1: Chat log has no windowing: opening a 200-message chat builds 3,741 DOM nodes

- Score 4 to 3, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/features/inbox/MessageLog.tsx:204-218; src/features/inbox/earlier.ts:10,49; src/features/inbox/MessageBubble.tsx
- Evidence: MessageLog maps every bubble. chats.messages gives up to 200 and each Earlier press adds 200 more with none removed. Measured in jsdom: a chat with 200 old messages is 203 li and 3,741 nodes (18.4 per bubble), 1,029 to 1,102 ms to open (100 messages: 900 ms). After 3 Earlier presses about 800 bubbles and 15,000 nodes (computed).
- Impact: Everyone, every time a busy project chat opens; worst on phones. About 3,700 nodes and 200 memo renders on each open.
- Fix: Draw the newest 60 bubbles first and the rest at idle or on scroll up (keep data-message-id for ?at= and reply jumps), or content-visibility:auto with contain-intrinsic-size on each li. Check logScroll.ts anchor logic and the Newest button.
- Skeptic impact: Counts are exact (203 li, 3,741 nodes), but it bites only chats of 100+ messages and the 1,029 ms figure includes the fake API. Estimate: 100 to 190 ms on a laptop, 500 to 700 ms on a phone, at each open of a busy chat.
- Skeptic fix note: content-visibility with estimated sizes would break the scroll to the New line and to ?at= targets. Safe form: mount the newest 60 bubbles at once and the rest in an idle pass, with the same re-anchor step as askEarlier, and test focusId, the New line and the Newest button.
- Skeptic evidence: Re-ran zzAuditInbox on baseline: OPEN chat 203 li, 3,741 nodes, 1,155 ms. With 150 groups and 0 old messages the open is already 740 ms vs 197 ms with no groups, so jsdom time mixes fake API work. Read MessageLog.tsx 190-218 and earlier.ts.

### RN-2: Inbox list has no windowing: 167 rows are 4,444 DOM nodes

- Score 4 to 3, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/features/inbox/ChatList.tsx:288-302 (rows), src/api/chatState.ts:161 (TASK_THREAD_LIMIT 100)
- Evidence: The list holds every project chat, direct chat, group and up to 100 task threads, so about 250 rows for 120 projects. Measured: 17 sample chats plus 150 groups gives 167 rows, 4,444 nodes (26.6 per row), 667 to 678 ms mount in jsdom. Each row is a motion.li with drag, Link, face or tile, Age and a Menu.
- Impact: Everyone, each Inbox open (the most used tab after Home); about 4,400 nodes at mount, more on a full office.
- Fix: content-visibility:auto on each row with the fixed row height (min-h 4.25rem), or a windowed list with the same row height. Rows are already memoized, so only first mount and scroll cost remain.
- Skeptic impact: Node counts hold (167 rows, 4,444 nodes). Row count is 17 to 150 now and 100 to 250 only after months. Mount time in jsdom (751 vs 305 ms) includes the fake API for 150 groups. One mount for each Inbox open, about 100 to 150 ms on a laptop, more on a phone.
- Skeptic fix note: content-visibility:auto adds paint containment on each li, which can clip the focus ring and the swipe reveal, and the row is min-h, not fixed. Safe form: staged mount (first 40 rows, then the rest at idle) so the final DOM is the same. Part of the cost is the hidden row menu (RN-3).
- Skeptic evidence: Re-ran baseline: INBOX mount 772 ms with 167 rows 4,444 nodes; GROUPS=0 gives 305 ms and 394 nodes. Read ChatList.tsx 225-302 (non-archived rows, kind filter) and chatState.ts:161.

### RN-3: The '...' menus are mounted on touch screens where CSS hides them

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/inbox/MessageBubble.tsx:135; src/features/inbox/MessageMenu.tsx:113; src/features/inbox/ChatList.tsx:198
- Evidence: MessageTools (a Menu with AnimatePresence, portal, animated icon with 3 motion circles and 4 listeners) is mounted for each saved bubble and hidden by pointer-coarse:hidden. Measured: 48 of 118 nodes in a 6-bubble log sit under [data-part=side] (8 per bubble, about 40%). The row menu is 7 of 23 nodes per row (119 of 396 in a 17-row list).
- Impact: Every phone user pays about 40% of the nodes of a chat log and 30% of the Inbox list for a button that never shows.
- Fix: Do not render MessageTools and the row ChatMenu when matchMedia('(pointer: coarse)') or useIsPhone() says touch (the long-press sheet path stays). On a desk nothing changes.
- Skeptic impact: Real, but it is about a third of the nodes of a bubble, only on touch screens, and display:none costs no layout, so only React and DOM creation are wasted. Roughly 20 to 30 percent of the mount work of RN-1 and RN-2 on phones.
- Skeptic fix note: Skip MessageTools and the row ChatMenu only when not in the sheet (actions.inSheet must still render it) and when matchMedia pointer coarse or max-width 639 holds; keep subscribe for a pointer change. InboxScreen.test.tsx:531 pins the classes and needs a test update.
- Skeptic evidence: Read MessageMenu.tsx 95-120 (pointer-coarse:hidden unless inSheet), MessageBubble.tsx 135, ChatList.tsx 197 (pointer-coarse:hidden max-sm:hidden), Menu.tsx. Node counts of the auditor consistent with the 118-node log.

### RN-4: A new message in a chat with 200 or more messages renders all 200 bubbles again

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/inbox/bubbles.ts:10-22; src/features/inbox/ConversationPane.tsx:179; src/features/inbox/earlier.ts:37-39
- Evidence: useBubbles keeps a bubble per view object in a WeakMap. chats.messages returns the newest 200; a new message slides the window by one, TanStack structural sharing compares by index, so every view after the shift is a new object and the memo of MessageBubble fails (prop bubble changed on 199 of 200). Measured with one new message and a reload of chats.messages, chats.list, chats.unreadCount: 106-message chat renders 1 bubble and 1 face; 200-message chat renders 200 bubbles and 200 faces. Trial patch (cache by message id, reuse when replaceEqualDeep is equal): 200 to 1, 340 to 247 ms for the whole reload in jsdom. Same shift on delete.
- Impact: Every person in a busy chat, at each incoming message and each own send: about 25 ms on a laptop and about 100 ms on a mid phone (inferred from jsdom 0.5 ms per bubble).
- Fix: useBubbles(views, toBubble, resetKey, idOf) keyed by message id as in render-trial.patch (bubbles.ts, ConversationPane.tsx).
- Skeptic impact: Mechanism confirmed, but only when a chat holds 200 or more messages (below the cap a new message adds 1 bubble: measured 1 render at the sample chat). About 0.5 ms a bubble in Chrome: 25 to 40 ms on a laptop, about 100 ms on a mid phone, at each message in a chat at the cap.
- Skeptic fix note: Safe: bubbleOfMessage depends only on the view, and the replaceEqualDeep check reuses a bubble only when the view is equal. Keep resetKey and the outbox claimed rule.
- Skeptic evidence: Re-ran baseline: NEW MESSAGE at 200 messages renders 200 bubbles and 200 avatars; WHY {bubble:199}. At the 6-message chat 1 bubble. Read bubbles.ts, ConversationPane.tsx 165-195 and earlier.ts.

### RN-5: One changed task renders every task row again (rows not memoized, dnd-kit inputs change each render)

- Score 3 to 2, verdict weakened, fix safe True, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/features/project/tasks/TaskRowItem.tsx:57,100; src/features/project/tasks/SortableTaskRows.tsx:19,45,74-78; src/features/tasklist/TaskListScreen.tsx:91; src/features/work/WorkTasks.tsx:28
- Evidence: TaskRowItem has no memo and callers pass a new onOpen closure per row. SortableTaskRows also gives dnd-kit new sensor option literals (76-78) and a new ids array (74), so the dnd-kit contexts change and each useSortable row renders even behind a memo. Measured with 150 extra tasks: /tasks has 205 rows, 5,506 nodes; one change renders 205 rows. Project To-dos tab: 157 rows, 6,626 nodes (42 per row); one change renders 157 rows and 157 faces, plus 314 getBoundingClientRect reads from framer layout='position'; 164 to 246 ms. Trial patch (memo SortableRow and TaskRowItem, hoisted sensor options, memoized ids): 157 to 1 row, 157 to 1 face; 64 touched tests pass.
- Impact: Anyone with Tasks, Home or a project open while teammates save: each save reloads the list and renders all rows (about 160 rows).
- Fix: As render-trial.patch, and make onOpen stable in every caller (pass the row, not a closure) so no custom compare is needed.
- Skeptic impact: Real, but a person has 20 to 50 rows (not 157 to 205), and the parent renders only when a visible row changes (equal data keeps the same object). About 15 to 30 ms in Chrome per such change.
- Skeptic fix note: onOpen is already stable in TaskListScreen (useStableHandler line 123) and WorkTasks (line 97), so no stale closure. TaskRowItem reads todayISO() inside the row (line 94): pass today as a prop, or the due word freezes across midnight. Hoist the dnd-kit sensor options and memo the ids as in the trial.
- Skeptic evidence: Read TaskRowItem.tsx 94-96, TaskListScreen.tsx 91 and 123, WorkTasks.tsx 28 and 97, SortableTaskRows.tsx. WorkBody is already memo (RND-2).

### RN-6: One changed project renders every project row again (Projects and the Admin's Home)

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/projects/ProjectListRow.tsx:39,49; src/features/projects/ProjectsScreen.tsx:56; src/features/home/HomeScreen.tsx:88; src/app/readMap.ts:60
- Evidence: ProjectListRow is not memoized. projects.list reads projectTouched and the project detail kinds, so each task or stage save in any project changes one row and reloads the list. An Admin's Home lists every live project. Measured with 110 extra projects: 122 rows, 4,190 nodes (34 per row); one changed project renders 122 rows and 122 tiles, 653 ms in jsdom. Trial patch (memo): 1 tile, 128 ms.
- Impact: Admin and Management on Home or Projects: a hitch (about 150 ms on a laptop, inferred) at each teammate save; Members see fewer rows.
- Fix: memo(ProjectListRow). summary is shared by structural sharing and source is a string.
- Skeptic impact: Real; Admin Home and the Projects list show every live project and projects.list changes after any task or stage save. Counts reproduce (122 rows, 122 tiles). About 1 ms a row in Chrome, so 40 to 120 ms for 40 to 120 rows, not 653 ms; the jsdom time includes the fake API.
- Skeptic fix note: memo(ProjectListRow) is safe: no clock read in the row, summary and source are stable props.
- Skeptic evidence: Re-ran zzAuditProjects: 122 rows, 122 tiles, 4,190 nodes, mount 1,186 ms, reload+render 702 ms. Read ProjectListRow.tsx 39-60, ProjectsScreen.tsx 56, HomeScreen.tsx 88, readMap.ts 60.

### RN-7: Notifications: three mutation hooks per row and one read renders all rows

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/notifications/NotificationsScreen.tsx:28-45,197
- Evidence: InboxItem calls useAction twice, useUndoable once (a third mutation) and useIsPhone for each row, and is not memoized. Measured with 100 notices: 561 ms mount, 1,740 nodes. Marking one read gives 100 ageOf calls and 100 face renders. Trial patch (memo): 4 and 4.
- Impact: Everyone who opens the bell: 300 mutation observers, and every press on a notice re-renders the whole list.
- Fix: memo(InboxItem) now; later move the mutations to the list so a row holds none.
- Skeptic impact: Real: the list limit is 100 so it is full after a few weeks, and each row holds 3 mutation observers. Mount about 60 ms in Chrome (jsdom 556 ms includes the app boot of about 300 ms). Each press renders the list once.
- Skeptic fix note: memo(InboxItem) alone freezes the Age text of each row (Age reads the clock when it renders). Wrap the list in AgeRefresh.Provider with a new object on each parent render, as src/CLAUDE.md says for every memo list.
- Skeptic evidence: Re-ran zzAuditNotices: 100 items, 1,740 nodes, mount 556 ms; one read gives 100 Age calls. Read NotificationsScreen.tsx 28-60 and 140-215, Age.tsx, notifications.ts limit default 100.

### RN-8: Emoji panel builds 1,878 buttons at every open

- Score 3 to 2, verdict weakened, fix safe True, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/features/emoji/EmojiPanel.tsx:119,149,185-191; src/features/emoji/EmojiButton.tsx; src/features/inbox/MessageMenu.tsx
- Evidence: All 8 groups mount at once. content-visibility:auto saves layout and paint only. It mounts again after each close (every reaction + and smiley press). Measured (React Profiler, jsdom): mount 159.7 ms, 1,878 cells, 3,807 nodes. A focus move renders the whole panel (16.9 ms, builds 1,878 objects). Clearing the search remounts all (113 ms).
- Impact: Anyone who reacts or adds an emoji; the open stutters on a phone (about 160 ms jsdom, more on a mid phone).
- Fix: Draw Recent and the first group at once, the other sections after first paint or when near view (heights known from containIntrinsicSize). Memoize one component per group so a focus move renders 2 cells.
- Skeptic impact: Real (1,878 cells at each open, a focus move renders the whole panel). About 40 to 50 ms a mount on a laptop and 150 ms or more on a phone during the open animation. It opens on demand only (reaction or smiley press).
- Skeptic fix note: Safe if each section keeps its id and its known height before it fills, so the group buttons still scroll and the arrow-key navigation (nextCell) works. Memoize the grid of each group.
- Skeptic evidence: Re-ran zzAuditEmoji: mount 167.7 ms in jsdom, 1,878 cells, 3,807 nodes, focus move 17.5 ms, clear query 115 ms. Read EmojiPanel.tsx 100-200 (nameOf for every item at every render).

### RN-9: Project About starts a MapLibre map at once and builds a new one at each visit

- Score 3 to 2, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence inferred
- Where: src/features/project/overview/ProjectPlace.tsx:7-30; src/features/map/MapCanvas.tsx:179,191,242,285
- Evidence: Each pinned project mounts MapCanvas. Lazy chunk 1.06 MB, worker 510 KB, Arabic plugin 148 KB, CSS 83 KB (baseline-remote/assets). It creates a WebGL map, style, glyphs and tiles, and made?.remove() runs on unmount, so a trip to another tab and back builds a new map. A change of pinsKey replaces every marker. Not measured in a browser.
- Impact: Phone users opening a pinned project: about 1.7 MB first download on 4G and a WebGL start on each About visit (inferred, a few hundred ms and heat).
- Fix: Start the map when the box is near the view (IntersectionObserver) or after the first paint; keep it alive while the project page stays open (hide, do not remove).
- Behavior note: The grey box stays a little longer before the map shows.
- Skeptic impact: The download is smaller than claimed: 281 KB + 144 KB + 43 KB + 10 KB = 478 KB gzip (brotli about 397 KB), not 1.7 MB, one time per device and then cached for a year. The real recurring cost is a new WebGL map at each About visit (the map unmounts with the tab).
- Skeptic fix note: IntersectionObserver gives no gain: the map sits at the top of About, the first tab. Keep-alive (hide, not remove) holds a WebGL context and memory on a phone. Safe form: nothing to change for the download; a start after the first paint is the only behavior-neutral step and gains little.
- Skeptic evidence: Measured gzip and brotli of the four files in baseline-remote/assets. Read ProjectPlace.tsx, MapCanvas.tsx 236-246 (made?.remove() on unmount), tabs.tsx (overview is the first tab) and AboutPanel.tsx 72.

### RN-10: PersonFace brings useTranslation and two t() calls back into every face (RND-8 undone for faces with presence)

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression True, confidence measured
- Where: src/components/PersonFace.tsx:13-18; src/app/lang.test.tsx (pins Avatar at 0 calls)
- Evidence: StateFace calls useTranslation() and builds the label with two t() calls on every render of every face. The 2026-10-07 fix made Avatar read the language with useLang (0 useTranslation calls); faces with a live port bring it back. Measured: opening a 6-bubble chat makes 289 useTranslation calls; 150 faces hold 150 i18n listeners and 300 t() calls per full render.
- Impact: Every screen with faces in the real build (live port): extra work on each list render, small per face, large for 150 to 200 faces.
- Fix: Use useLang() and a cached label per (state, language, context, name) in a Map; no hook per face.
- Skeptic impact: A true regression of the RND-8 rule, but negligible: one face label (2 t calls) costs 4.8 microseconds (measured with i18next in node). 150 faces cost 0.7 ms in a full render.
- Skeptic fix note: Safe and tiny: useLang plus a label cache keyed by state, language, context and name.
- Skeptic evidence: Read PersonFace.tsx 12-18 (useTranslation in StateFace) and lang.test.tsx. Ran a 100,000-loop benchmark of the two t() calls: 4.81 microseconds each.

### RN-11: Open space renders all 122 cards and all of them again on any state change

- Score 2 to 1, verdict weakened, fix safe True, effort M, risk low, behavior change False, regression False, confidence measured
- Where: src/features/space/OpenSpaceScreen.tsx:226-237,299; src/features/space/SpaceNode.tsx
- Evidence: nodes is rebuilt on every render with a new data object per card; no onlyRenderVisibleElements. Measured with 110 extra projects: 122 cards, 3,449 nodes (28 per card); opening the task panel (a query-string change) renders 122 cards again (mocked React Flow, same props as the real one).
- Impact: Managers in the Open space: heavy first draw and a stutter on each open or close of a card or panel.
- Fix: useMemo the nodes on their inputs, keep stable data per node, memo the cards. onlyRenderVisibleElements needs an owner choice.
- Behavior note: Only onlyRenderVisibleElements would change behavior: keyboard users could not Tab to cards out of view.
- Skeptic impact: Real mechanism (new node and data objects on each render), but a rare manager screen, tens of cards in a real office, and the auditor used a mocked React Flow so the count of the real library is not measured.
- Skeptic fix note: useMemo of nodes on their inputs and stable data are safe. Do not add onlyRenderVisibleElements (keyboard reach changes).
- Skeptic evidence: Read OpenSpaceScreen.tsx 205-245 and 290-310: nodes rebuilt on each render, data from cardOf.

### RN-12: Dashboard schedule renders all rows again for one click

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/dashboard/OfficeSchedule.tsx:155-185 (stageOverlaps at 159)
- Evidence: One component maps every row; toggle, zoom and the width measure render all rows, and stageOverlaps(row.stages) runs per row each time. Measured with 119 rows: 3,003 nodes; opening one row took 233 ms in jsdom.
- Impact: Admin and Management on Dashboard Schedule: a stutter at each row open or zoom change.
- Fix: memo a ScheduleRow component; compute stageOverlaps once per row in useMemo.
- Skeptic impact: Real but small: a rare Admin screen, about 40 rows in a real office, about 1 ms a row in Chrome. stageOverlaps per row is cheap.
- Skeptic fix note: memo a ScheduleRow and pass the clock values as props; safe.
- Skeptic evidence: Read OfficeSchedule.tsx 120-200: one component maps every row, overlaps computed in the map.

### RN-13: Next for you runs two endless transform animations on 180% layers

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change True, regression False, confidence inferred
- Where: src/design/tokens.css:395-406,647-664; src/features/home/NextCard.tsx:23
- Evidence: .glow::before and ::after are inset -40% (180% of the card) and animate translate, rotate and scale for ever (8 s each) while Home is in front. Not measured; Chrome pauses them in a hidden tab.
- Impact: A phone left on Home keeps the compositor busy (battery, warm phone). Everyone lands on Home.
- Fix: animation-play-state paused when the card is out of view (IntersectionObserver) or after 60 s without input.
- Behavior note: The soft light stops moving after a long idle time or when scrolled away.
- Skeptic impact: Inferred only. Two transform-only animations run on the compositor, Chrome pauses them in a hidden tab, and only the Next for you card uses .glow. A small battery cost, not measured.
- Skeptic fix note: The finding already says behaviorChange true (the light stops after an idle time or when out of view).
- Skeptic evidence: Read tokens.css 388-406 and 647-670 and NextCard.tsx 23; grep shows .glow is used only by NextCard.

### RN-14: Files tab asks a signed link for every picture row at mount

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence inferred
- Where: src/features/project/files/FilesTab.tsx:38; src/features/files/PictureAttachments.tsx:19 (useNearView)
- Evidence: FileRow calls useFileLink(..., 'thumb') for each picture. loading=lazy gates the image download only. The chat tile waits until it is within 400 px; the Files row does not. MAX_BATCH is 12 (src/api/remote/wire.ts:51), so 120 pictures send 120 files.link calls in 10 requests at the first open.
- Impact: Anyone opening Files & Links of a project with many pictures: extra Edge Function calls and database checks for rows far below the screen (free plan calls).
- Fix: Reuse useNearView (400 px margin) for the row thumbnail.
- Skeptic impact: True (no near-view gate on Files rows), but the cost is about 10 batched requests for 120 pictures, once per 8 minutes (LINK_STALE_MS), against 500,000 function calls a month. Small.
- Skeptic fix note: Reuse useNearView with the 400 px margin; behavior stays the same.
- Skeptic evidence: Read FilesTab.tsx 27-45 and 249-254 (all files of every stage listed, no fold), files.ts useFileLink.

### RN-15: The shell renders on every change of the query string

- Score 1 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/app/AppShell.tsx:35,105; src/app/TabPill.tsx:16,65,86,108; src/features/feedback/FeedbackSheet.tsx (useLocation)
- Evidence: Parts use useLocation() for the path only. Measured: 5 changes of search parameters (opening a task panel) give TabPill 5, PersonMenu 10 (wide and phone copies), StorageBanner 5, FocusMode 5 renders.
- Impact: Every press that sets a filter or opens a panel renders the whole frame again; small per render.
- Fix: Read the path through a small useSyncExternalStore hook over the router, or memo the parts and pass pathname as a prop.
- Skeptic impact: Negligible: one cheap render of the pill and the person menu per query change.
- Skeptic fix note: A pathname prop or a small hook over the router is safe, but the gain is too small to justify the change.
- Skeptic evidence: Auditor counts are plausible (one render per change); read AppShell and TabPill use of useLocation.

### RN-16: Small repeated costs: Age refresh object per ChatList render, matchMedia per hook and per snapshot

- Score 1 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/inbox/ChatList.tsx:238; src/app/useIsPhone.ts:6,13
- Evidence: const refresh = {} makes all 167 Age components render at each ChatList render (665 ageOf calls for 5 search keystrokes), chosen on purpose in RND-5. useIsPhone makes a new MediaQueryList per subscriber and per snapshot read: 58 matchMedia calls at Inbox mount, 75 more when a 6-bubble chat opens.
- Impact: Small: a few ms at each Inbox render and at each list mount.
- Fix: A once-a-minute tick for the Age context; one shared MediaQueryList for useIsPhone.
- Skeptic impact: Negligible: 167 ageOf calls are under 1 ms and 58 matchMedia calls at mount are under 1 ms. The Age refresh object is deliberate and written in src/CLAUDE.md.
- Skeptic fix note: A once-a-minute tick would render 167 rows every minute at rest and change when ages update. Leave Age as is. A shared MediaQueryList is safe but not worth a change.
- Skeptic evidence: Read ChatList.tsx 236-240, Age.tsx and src/CLAUDE.md (Speed section), useIsPhone.ts.

### RN-17: Each keystroke in the message box writes to localStorage

- Score 1 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence inferred
- Where: src/app/drafts.ts:60-65 (useDraftText, writeDraft)
- Evidence: set() calls writeDraft (a synchronous setItem) before setText on every key. Not measured.
- Impact: A sync write for each key in chats and comments; small on desk, more on a slow phone or a large storage.
- Fix: Debounce 300 ms, and write on unmount and on pagehide.
- Skeptic impact: A localStorage.setItem of a short string costs microseconds on a keystroke; the auditor's own 5-key test took 20 ms in jsdom with no bubble render. No measurable effect.
- Skeptic fix note: A 300 ms debounce can lose a draft when a phone kills the tab (pagehide does not always fire), and src/CLAUDE.md promises the draft stays after the tab closes. Do not change.
- Skeptic evidence: Read drafts.ts 33-65 (writeDraft inside set). Not measured in a browser.

## Client data flow

Measurements: Test copy (madar-test), from the owner's Mac, Node scripts with the password grant, 7 to 9 rounds each, medians. Whole request time of one call alone: session.get 524 ms, chats.unreadCount 697 ms, notifications.count 532 ms, dashboard.get 450 ms, projects.list{all} 499 ms, tasks.list all open 443 ms, meetings.list 432 ms, chats.list 494 ms (11.4 KB), push.mine 353 ms, chats.typing 376 ms. Sizes (JSON): session.get 6.7 KB, users.list 14.4 KB (22 people, no pictures), tasks.list mine 9.5 KB, projects.list member Home 23 KB. Cold Home: 4 requests in parallel 534 ms median (634 ms first run); the join repeat 754 ms. Realtime: office and person channels SUBSCRIBED 718 and 769 ms after session.get answered; 22 status topics 2,945 ms; 24 channels in 3.6 to 4.0 s. Waterfalls: Home with meetings.list in round 2 920 ms against 504 to 534 ms in round 1; session.get then dashboard reads 857 ms against 502 ms together; a second session.get in the first request costs nothing measurable (524 vs 535 ms). Counts per screen open and per change signal come from jsdom tests over the sample office with the real-build runtime (files src/test/dfaudit.test.tsx, dfsignals.test.tsx, dfjoin*.test.tsx, dfchat.test.tsx in the copy; outputs audit/dataflow-rounds*.txt, dataflow-signals.txt, dataflow-join*.txt, dataflow-chat.txt). Patches for DF-5 and DF-6 in the copy: Projects 11 calls in 2 requests became 9 calls in 1 request; 21 touched test files (193 tests) passed with --no-file-parallelism --testTimeout=60000. Monthly Edge and Realtime numbers are estimates from these counts and the owner's reading of 2,900 Realtime messages on 19 Oct, marked inferred. Full report: /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/dataflow.md

Not checked: Production (out of bounds, no request of any kind). The real Supabase Usage page (no API; the owner reads it), so the monthly Edge call and Realtime message totals are estimates. A real iPhone or Android: the WebKit preflight cache, socket drops on wake, and the double reload on a phone wake (only simulated in jsdom). Raw Realtime frame counts in this session: supabase-js 2.117 has no public hook, so I used the probe numbers of proof.md for frames. The 429 or too-many-messages behavior at the 100 messages a second Free limit (not tested on purpose). The server cost of each read and the server side of the signals (the server auditor). Rendering cost of the extra reloads (structural sharing should keep the same data object, not tested). The office build (Durable Objects, sockets) is skipped as told. Prototype build data flow (it has no network).

### DF-1: Every write by anyone reloads every visible tab: wide read rules and one overview read for each request

- Score 4 to 3, verdict weakened, fix safe False, effort L, risk high, behavior change False, regression False, confidence measured
- Where: src/app/readMap.ts:50,60,77,92,94; src/app/signals.ts:78-90,107,166; src/api/remote/wire.ts:53; src/api/remote/batcher.ts
- Evidence: Measured in jsdom over the sample office (real-build runtime): one office signal 'task change in ANOTHER project' makes one open Home tab send 6 calls in 3 requests, Tasks 4 calls in 2 requests, Projects 4 calls in 2 requests, project page 4 to 7 calls in 1 request, Settings 2 calls, Inbox 3, Dashboard 3 (audit/dataflow-signals.txt). Cause read in readMap.ts: tasks.list with no projectId is 'any project', projects.list reads events and tasks, meetings.list reads tasks, chats.unreadCount and notifications.count read tasks and projects. Overview reads go one for each request, so Home pays 3 Edge calls for 1 signal. One Home pass is about 40 KB JSON (live: tasks 9.5 KB + 1.6 KB, projects 23 KB). Month estimate (inferred): 2,900 Realtime messages on 19 Oct is about 220 to 260 signals; with 12 visible tabs at 1.9 requests per pass that is 4,500 to 5,900 Edge calls on such a day, up to 100,000 a month (20% of 500,000). Hidden tabs only mark stale (cost 1 pass on return).
- Impact: Everyone who keeps Madar visible. Each write by anybody in the office costs every visible tab 1 to 3 Edge calls and 2 to 9 heavy server reads, on every screen, also for projects the person has nothing to do with. It is the largest steady use of the 500,000 Free Edge calls and of the database. On a phone it is battery and data.
- Fix: In affects() (signals.ts), reload a person-filtered list (tasks.list filter mine or review_for_me, meetings.list mine, projects.list filter mine) only when the signal's projects meet the projects that the cached answer already holds (rows, plus the member's projects.list{mine}), or the signal names the person, or the office flag is on; an Admin's projects.list{all} stays as it is. A new assignment reaches the person through a notice signal. Prove it first with a generated test (style of readMap.test.ts) that runs every write of server/core/everyCall.ts for 3 roles and checks that no list that changed is skipped. Optional later: let a request hold 2 cheap overview reads (needs the server auditor).
- Skeptic impact: Real: person-filtered lists reload for any project (signals.ts:75-88, readMap.ts:50,60,77). But the 100,000 calls a month figure is an upper bound (busiest day x 22, 12 visible tabs all day, 1.9 requests for every signal). A mixed day (chat messages cost 1 call) gives about 30,000 to 50,000 a month (6 to 10 percent), and the fix saves only the part for projects the person holds no row in. Production made about 422 calls a day before the team week.
- Skeptic fix note: As written the fix can leave a list old. A task newly assigned in a project where the person holds no row is found only by the notice signal, but tasks.list does not list 'notifications' in readMap.ts, so affects() line 83 does not reload it. Self-assign and agent writes send no notice. Add the notice route to readMap and write the generated every-write test first, or the fix is unsafe.
- Skeptic evidence: Re-read signals.ts affects(), readMap.ts rules, save.ts signal composition (office signal names no people). Read the jsdom output dataflow-signals.txt. Recomputed the month figure from proof.md (2,900 Realtime messages on 19 Oct is about 200 signals) and the 422 calls a day line in the presence design.

### DF-14: A cold start has no cache: every page load and phone relaunch waits for the network

- Score 4 to 3, verdict weakened, fix safe True, effort L, risk medium, behavior change True, regression False, confidence inferred
- Where: src/app/runtime.tsx:44-58 (no persister); src/app/remote/bootstrap.ts; src/features/home/HomeScreen.tsx:151
- Evidence: The query cache lives in memory only. Every page load (new tab, reload, iPhone relaunch) sends session.get and the lists again. Live: first Home load wall 534 to 634 ms from the Mac (4 parallel requests, 57 KB JSON); on 4G the 2026-10-08 audit saw first data at 1.6 to 1.7 s. Home renders nothing until session, mine and review answer (HomeScreen.tsx:151).
- Impact: Everyone on every cold start, most on phones where the page restarts 5 to 20 times a day (inferred). They see an empty Home for 0.6 s (desk) to about 1.5 s (4G).
- Fix: Keep the last answers of session.get, tasks.list mine, projects.list and the shell counters in IndexedDB for each person (clear at sign-out), show them at once and let the normal reload replace them (staleTime already Infinity, so mark them invalidated at start). Needs the owner's choice because data stays on the device and an old number can show for a moment.
- Behavior note: Home shows the last known lists for about a second, then the fresh ones. A person who left a task done on another device may see it open for that moment. Client data at rest on the device.
- Skeptic impact: Real: no persister anywhere in src and Home returns null until three answers (HomeScreen.tsx:151). But the JS download still comes first, the 5 to 20 phone relaunches a day is inferred, and a laptop tab cold starts about once a day. The fix puts client data at rest on the device and can show old numbers, so it needs the owner's choice.
- Skeptic fix note: Finding already declares behaviorChange. Add: keep the cache per person, clear at sign-out and on a role or rights change, and never show cached rows of a project the person may no longer see.
- Skeptic evidence: grep for persistQueryClient and persister found none; read runtime.tsx createQueryClient and HomeScreen.tsx:151.

### DF-2: chats.unreadCount and notifications.count reload in every tab on every task change and every chat message

- Score 3 to 2, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/app/readMap.ts:92,94; src/app/TabPill.tsx:17,87; server/data/save.ts (anonymous office signal of a DM)
- Evidence: Measured: Settings (shell reads only) pays 2 calls for each task change (chats.unreadCount, notifications.count) and 1 call for each chat message, also a DM between two other people (the office signal of a DM is anonymous on purpose, INT-16). chats.unreadCount is slow: 697 ms median live against 524 ms for session.get. Every screen mounts both counters in the shell. A message gives 1 call in each of about 12 visible tabs: 60 to 250 messages a day = 720 to 3,000 calls a day (inferred).
- Impact: Every visible tab, every screen. 13 to 24 bytes of answer but a server read each time, and a whole Edge call when the tab has no other read in the pass (Settings, What's new, Notifications).
- Fix: Server and client together: the signal of a message names the chat members (it already names people for notices and read marks); the client reloads chats.unreadCount only for a named person or a project chat of a project in the person's list. Drop 'projects' and 'updates' from notifications.count for a task change of another project once a test proves the count cannot change. Needs the server auditor and the leak tests of INT-16 (no actor leaks).
- Skeptic impact: Real (readMap.ts:92,94, scope person, messages kind). Only the anonymous direct or group chat signal is avoidable: a project chat message must still reach every person who can open that chat. Volume is 60 to 250 messages a day by the finding's own figure, about 10,000 to 40,000 calls a month at most, and the call joins an existing batch on Home, Tasks and Projects.
- Skeptic fix note: Not a client-only fix. It needs a server change in who hears a direct message (INT-16: the office signal is anonymous on purpose) with new leak tests. A client skip of 'messages' for person reads would leave project chat counts old.
- Skeptic evidence: Re-read readMap.ts and the save.ts signal code (officeBase nameless for private chat kinds, person signals name one person). Compared the finding's volume with the 422 calls a day line.

### DF-3: The first Realtime join of each page load repeats every read, about 0.75 s after the screen shows

- Score 3 to 2, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/app/remote/channel.ts:109; src/app/signals.ts:80,293-300; src/app/remote/bootstrap.ts:100-122,241
- Evidence: channel.ts:109 sends tell([], 'join') at the first SUBSCRIBED, signals.ts turns it into 'all', and affects() returns true for every read. jsdom: Home 9 calls in 3 requests, project page 13 calls, Inbox 6, Dashboard 8: the same size as the open (audit/dataflow-join.txt). Live on the test copy: first Home load 634 ms, channels SUBSCRIBED 718 and 769 ms after session.get answered, then the repeat took 754 ms. The socket waits for a raw api.call('session.get') (bootstrap.ts:241) and AuthGate also sends session.get, so the first request holds 2 session.get entries (cost not measurable: 524 vs 535 ms). A join pass that comes while the first reads are still loading adds 0 calls (jsdom: 8 before, 8 after).
- Impact: Everyone at every page load: about 3 extra Edge calls (Home) and 9 heavy reads, plus 40 KB of JSON and one more parse and merge about a second after the first paint. A phone does this 5 to 20 times a day (inferred).
- Fix: Open the office and person channels at once, in parallel with the first batch, from a Madar user id stored for the auth user id (like roleHint.ts); if it is wrong the join is refused and the old path runs. The join then comes while the first reads are in flight and adds nothing. Also let personChangeSource use the cached session (one session.get). Add a test with held answers: join before the first answer gives 0 extra calls.
- Skeptic impact: Real (channel.ts:109 tells join, signals.ts:293 makes it an all pass) but small: about 3 extra calls per page load, and the repeat returns the same data so nothing re-renders. The proposed fix does not reach its goal: the socket needs about 0.72 s after its start and the first Home reads end at about 0.53 s, so the join still comes after the reads even when the socket starts at time 0.
- Skeptic fix note: The join reload is the guard for a change saved between the read and the join. Opening the socket earlier does not remove the repeat at the measured speeds and adds a missed-change window. No safe form found without a server sequence check.
- Skeptic evidence: Read channel.ts, bootstrap.ts person() path, signals.ts join handling. Read the auditor's join2 test: a join while reads have no data adds 0 (TanStack reuses the fetch), but the live timing (718 ms join vs 534 ms reads) puts the join after the reads.

### DF-5: Closed sheets read data on every Projects, Search and project page open

- Score 3 to 3, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/projects/ProjectsScreen.tsx:222; src/features/search/SearchScreen.tsx:164; src/features/projects/NewProjectSheet.tsx:28-34; src/features/project/ApplyTemplateSheet.tsx:28; src/features/projects/EditProjectSheet.tsx:48
- Evidence: NewProjectSheet is mounted for everyone who may create and reads settings.get, projectTemplates.list and projects.list{status:'all'} (an overview read) while closed; ApplyTemplateSheet reads projectTemplates.list on every project page; EditProjectSheet reads projects.list{all} for the Admin on every project page. They start in round 2 (after the session) in their own request, and reload on every signal while the screen is open (DF-1 table: Projects pays 2 requests where 1 would do). Patch in my copy (enabled: open): Projects 11 calls, 2 requests, 2 round trips became 9 calls, 1 request, 1 round trip; the admin project page loses projects.list{all} and projectTemplates.list; Search loses 3 reads. 21 touched test files (193 tests) passed.
- Impact: Everyone on Projects and Search, Admin and project leaders on every project page: one extra round trip, one extra Edge call, and the heaviest read of the app (all projects) on every signal while the page stays open.
- Fix: Add enabled: open to these reads and start them on pointerdown of the New project button and the menu items with usePrefetchCall (the project row does the same). The sheet already copes with late data (NewProjectSheet.tsx:60).
- Skeptic impact: Holds. Closed sheets read without a gate: NewProjectSheet.tsx:28-34 (mounted for everyone who may create), ApplyTemplateSheet.tsx:28 (every project page), EditProjectSheet.tsx:48 (Admin). Measured by the auditor: Projects 11 calls in 2 round trips became 9 calls in 1 round trip.
- Skeptic fix note: Safe with the pointerdown prefetch. A template picker or the code warning can show a moment late on the very first open if no prefetch ran.
- Skeptic evidence: Read the four files and ProjectActions.tsx:170-174 (sheets always mounted). Read dataflow-rounds.txt and dataflow-rounds-patched.txt.

### DF-6: Home reads meetings.list only after three answers

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/home/HomeScreen.tsx:151; src/features/home/MeetingsCard.tsx:20
- Evidence: HomeScreen returns null until session, mine and review answer, so MeetingsCard mounts in round 2 (audit/dataflow-rounds.txt). Live, test copy, 9 rounds: whole Home 920 ms median with the waterfall against 504 to 534 ms with meetings.list in the first request. Patch in my copy (usePrefetchCall in an effect with todayMeetingsInput(today)) moves it to round 1; Home tests pass.
- Impact: Everyone, each cold Home: the Meetings card shows about 385 ms later (more on 4G) and costs one extra Edge call.
- Fix: Call usePrefetchCall in HomeScreen for meetings.list with todayMeetingsInput(today), as tabReads does for the project page. Same exact key, so the card finds the answer.
- Skeptic impact: Real (MeetingsCard mounts only after HomeScreen.tsx:151 passes) but the card draws nothing on a day with no meeting, and the patch cuts a member's Home from 4 requests to 3 only (an admin stays at 4 because projects.list all stays in round 2). Gain: the card shows about 0.4 s sooner on meeting days.
- Skeptic fix note: Use the same today value as MeetingsCard (todayISO) so the key matches. Safe.
- Skeptic evidence: Read HomeScreen.tsx, MeetingsCard.tsx, prefetch.ts and the before and after round files (4 requests before and after for the admin test user).

### DF-8: Every tab joins the status topic of every person on every screen, but only the Inbox shows other people's states

- Score 3 to 2, verdict weakened, fix safe True, effort M, risk medium, behavior change True, regression False, confidence inferred
- Where: src/app/live/LiveProvider.tsx:26-33; src/app/remote/presence.ts (joinMissing, reconcile); src/components/PersonFace.tsx; src/features/inbox/*
- Evidence: One tab joins 17 channels (office, person, 15 status topics; 24 on the test copy with 22 humans). Live: the 22 status topics took 2,945 ms to join, all 24 channels 3.6 to 4.0 s. Only the Inbox (list, header, bubbles, mentions, group sheets) shows another person's dot; elsewhere only the own face does. From the probe frames in proof.md (1 frame per listening tab per change, 1 presence_state per topic on a join): status is about 0.6 to 0.9M of the 2M Free messages a month for about 20 listening tabs (formula in audit/dataflow.md). With listeners limited to Inbox tabs (about 4) status falls 70 to 85%. A mass reconnect (office Wi-Fi restart) would send about 20 x (16 + 20) = 720 frames in seconds against the 100 messages a second Free limit (inferred, not tested).
- Impact: Not felt in daily use; it decides how long the Free Realtime quota lasts (0.4 to 0.7M messages a month saved, inferred) and how a Wi-Fi blip behaves. Phones save battery and data on each wake (16 joins).
- Fix: Give LivePort.watch a use count: usePersonState and the Inbox ask for the people they show; the own topic stays joined so the person can track. Join the 15 topics when the Inbox mounts, on pointerdown of the Inbox tab, and when a message notice arrives; leave them 5 minutes after the Inbox closes.
- Behavior note: The dots of the Inbox can show up to about 1.5 s after the first Inbox open of a visit (joining 22 topics took 2.9 s on the Mac); the pre-join on pointerdown hides most of it.
- Skeptic impact: Real (LiveProvider.tsx:33 watches every active human), but the owner already booked the Realtime total at about 45 percent of 2M with this cost included (proof.md 2026-10-21, TASKS.md), the 100 messages a second case is untested, and states of other people also show in MentionField (composers outside the Inbox), so the Inbox-only listener rule in the finding is not enough.
- Skeptic fix note: Finding already declares behaviorChange (dots up to 1.5 s late). Use a use count over every consumer of usePersonState, MentionField included, not an Inbox mount flag.
- Skeptic evidence: grep of usePersonState and PersonFace users: Inbox files and MentionField.tsx. Read the Realtime message budget lines in proof.md and TASKS.md.

### DF-9: Away goes out at once for every window switch

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change True, regression False, confidence inferred
- Where: src/app/live/activity.ts:13-16; src/app/remote/presence.ts (setMine, trackNow)
- Evidence: A page out of view is Away at once and setMine tracks at once. A switch to CAD and back is 2 tracks, about 40 frames to 20 listening tabs. The design assumed about 10 computer changes for each person a day; an office that works in CAD and the browser can do 20 to 100 (inferred). 20 to 100 flips a day for 15 people = 0.26 to 0.66M messages a month.
- Impact: Free Realtime quota only; no felt effect.
- Fix: Send Away after 15 to 20 s out of view and cancel it if the page shows again first; send Online at once.
- Behavior note: Another person sees Away 15 to 20 s later than today after a window switch.
- Skeptic impact: Real in code (activity.ts:13-16) but 'a page out of view is Away at once' is a written owner rule (chat presence design, line 65). It uses the same listeners as DF-8, so the two savings do not add. Quota only, no felt effect, and the 20 to 100 flips a day is inferred.
- Skeptic fix note: Finding already declares behaviorChange. Needs the owner to change the written rule.
- Skeptic evidence: Read activity.ts and the presence design spec lines 63-65.

### DF-4: A tab hidden for more than 60 s reloads every read on return, and a phone can do it twice

- Score 2 to 2, verdict confirmed, fix safe False, effort S, risk medium, behavior change False, regression False, confidence measured
- Where: src/app/signals.ts:188,326-336
- Evidence: signals.ts:330 runs an 'all' pass after 60 s hidden. jsdom with nothing changed: Home 9 calls (3 requests), project page 13, Inbox 6, Dashboard 8 (audit/dataflow-join.txt). If the Realtime channels also rejoin (a phone) the join pass follows: 18 calls for Home where one reload is 9 (audit/dataflow-join3.txt); the second pass cancels the first running fetch, which the server already ran. 20 to 40 returns a day for each person (inferred) = about 20,000 Edge calls a month.
- Impact: Everyone who switches away for a minute and back: one full reload of the screen (2 to 3 Edge calls) each time; on phones sometimes two.
- Fix: Skip the 60 s pass when the live source stayed 'open' since the tab hid and no join came (a dead socket already causes a join pass through the supabase-js heartbeat). Merge a join pass into a visibility pass that started in the last second.
- Skeptic impact: Holds (signals.ts:330; the second pass cancels a running fetch that has data, so a phone can run two passes). Size about 20,000 calls a month is inferred.
- Skeptic fix note: Part two is unsafe: status() is only the SUBSCRIBED flags (channel.ts:158), and a socket of a sleeping laptop or a locked phone looks open until the heartbeat fails, so lists stay old up to a minute. Safe form: merge the join pass into a visibility pass of the last second (safe), and skip the 60 s pass only for hidden times under about 5 minutes on a computer, never on a phone.
- Skeptic evidence: Read signals.ts onVisibility and channel.ts status(); read dataflow-join3.txt (18 calls where one reload is 9).

### DF-7: Dashboard, Meeting view, Open Space and Admin start their reads only after session.get answers

- Score 2 to 2, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/app/useRight.tsx:26-31; src/features/settings/admin/AdminScreen.tsx:31-33; src/app/routes.tsx (right: dashboard.view)
- Evidence: RequireRight renders nothing until the session answers, so the screen's reads start in round 2 (Meeting view and Open Space: round 1 is session.get alone; Dashboard and Admin: round 2 after the shell). Live, 7 rounds: session.get then dashboard.get + clients + teams 857 ms median against 502 ms when both go together (+355 ms from the Mac).
- Impact: A cold open of the Dashboard, the weekly meeting view on the office screen, Open Space or Admin (deep link, reload) waits one extra round trip: +355 ms here, more on 4G.
- Fix: Give each guarded route a list of reads (like tabReads) and let the guard start them with the session for a signed-in person (usePrefetchCall). A person without the right wastes one set of reads.
- Skeptic impact: Holds for a cold open of Dashboard, Meeting view, Open Space and Admin (reload or phone relaunch on that screen). In-app navigation has the session cached, so it is rare. +355 ms live.
- Skeptic fix note: Safe: the server still refuses a person without the right. A speculative read for such a person is a wasted refused call, rare.
- Skeptic evidence: Read useRight.tsx:26-31 (RequireRight returns null until session.authority) and routes.tsx right entries.

### DF-10: Typing sends an Edge call every 5 s even when nobody can see it

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence inferred
- Where: src/app/live/typing.ts:7,128-166; server/signal/typing.ts
- Evidence: useTypingSender calls chats.typing (a server call with one realtime.send statement) every 5 s while a person types, also when every other member is Offline or Away. Live: 376 ms median for the call. The design estimate is 3,000 signals a day = 66,000 Edge calls a month (13% of 500,000).
- Impact: Free Edge quota and a pooler connection for each signal. No felt effect.
- Fix: Skip the call when the live port knows the state of every other member of the chat and none is Online. An unknown state still sends. The typist sees nothing different. Inferred saving 30 to 60%.
- Skeptic impact: Real in code (typing.ts:128-166) but the 66,000 calls a month rests on the design guess of 3,000 typing signals a day. With the finding's own chat volume (60 to 250 messages a day, a few signals each) it is about 4,000 to 16,000 calls a month.
- Skeptic fix note: Safe in effect. One edge: a reader who is visible but idle (Away) would miss the typing line, so skip only when every other member is Offline, or accept that edge.
- Skeptic evidence: Read typing.ts and the design spec line 210-213 (3,000 signals a day is a design estimate; production made 422 calls a day).

### DF-11: push.mine runs again at each Home open and twice at a cold start

- Score 2 to 2, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence read
- Where: src/features/settings/usePushDevice.ts:41; src/features/home/PushAskCard.tsx:27; src/features/home/HomeScreen.tsx:75; src/app/remote/PushSync.tsx:23
- Evidence: usePushDevice runs syncThisDevice (one push.mine call, a raw api.call outside the cache, so never in a batch) in an effect at each mount. PushAskCard mounts at each visit to Home and at Settings. PushSync runs it again 3 s after the start. Live: push.mine 353 ms median. A person who has allowed push sends 2 calls at a cold Home and 1 at each later Home visit.
- Impact: People with push on: 1 to 2 extra Edge calls for each Home open (about 5,000 to 10,000 a month, inferred), each alone.
- Fix: Run the check once for each page (module flag or a sessionStorage stamp of the last sync for the user); make usePushDevice read only the local state.
- Skeptic impact: Holds: usePushDevice runs syncThisDevice at each mount (usePushDevice.ts:41-47), which calls push.mine (push.ts:209) outside the cache; PushAskCard mounts at each Home visit and PushSync adds one at 3 s. About 5,000 to 10,000 calls a month.
- Skeptic fix note: Safe if the once-a-page flag still lets a new person on the same browser run the check (key it by user id) and a turn on or off re-checks.
- Skeptic evidence: Read usePushDevice.ts, PushSync.tsx, PushAskCard.tsx, push.ts syncThisDevice.

### DF-12: CORS preflights: 3 in a cold load and a short cache on iPhone

- Score 2 to 1, verdict weakened, fix safe True, effort M, risk medium, behavior change False, regression False, confidence inferred
- Where: server/http/cors.ts:12,24; src/api/remote/remoteApi.ts (post); docs/superpowers/real-build/proof.md:1255,1258
- Evidence: proof.md records 3 preflights in a cold load (3 parallel requests with an empty cache). Each OPTIONS runs the function, so it is an Edge call and a round trip (537 to 558 ms with preflight against 285 ms without, measured 2026-10-08). Max-Age 7200 is the Chromium cap; WebKit (Safari and every iPhone browser) caps near 10 minutes (MDN, not measured here). The 2026-10-08 audit measured Chrome only and removed the same-origin forwarder.
- Impact: Phones on iOS: one extra round trip (300 ms or more on 4G) and one Edge call for the first call after each pause over 10 minutes. Everyone: 3 extra Edge calls at each cold start.
- Fix: First measure the real iPhone cache. Then use the page's own /api/batch (the forwarder in functions/api exists) for WebKit only, or for the first request of a page. Needs a measure on a real iPhone before any change.
- Skeptic impact: The Edge call claim is wrong: platform-facts.md line 110 quotes Supabase that preflight (OPTIONS) requests are not billed. The 3 cold-load preflights run in parallel, so they cost one round trip, not three. The iPhone cache cap is not measured here, and the 2026-10-08 audit measured the forwarder as not faster over a session.
- Skeptic fix note: No change before a real iPhone measure. The forwarder was slower on Chrome (305 to 339 ms against 285 ms direct), so use it for WebKit only if the iPhone number shows a gain.
- Skeptic evidence: Read cors.ts (Max-Age 7200), platform-facts.md line 110 and proof.md lines 1252-1258.

### DF-13: The project Tasks tab asks taskTemplates.list after projects.get

- Score 1 to 1, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/project/tasks/TasksTab.tsx:95; src/features/project/tabs.tsx:tabReads
- Evidence: Round 2 of /projects/prj_001?tab=tasks in the jsdom run holds taskTemplates.list (and projectTemplates.list, fixed by DF-5), after tasks.list in round 1. The gate is detail.viewerCan.addTask, which needs projects.get. LIV-5 of 2026-10-07 made it one call; the later prefetch moved tasks.list to round 1 and left the templates behind.
- Impact: Leaders and members who can add a to-do: one more round trip and Edge call when they open the Tasks tab cold.
- Fix: Add taskTemplates.list {} to tabReads('tasks') when the cached session can add a to-do, as payments.list does.
- Skeptic impact: Holds (TasksTab.tsx:95 gates on viewerCan.addTask from projects.get) but only for a cold deep link to ?tab=tasks; in-app, projects.get is already cached and the call joins the tasks.list batch.
- Skeptic fix note: A prefetch gated on the session right would read templates for a person who cannot add on that project (small waste, same security).
- Skeptic evidence: Read TasksTab.tsx and tabs.tsx tabReads.

### DF-15: Small ones: save cost on Home, a double chats.messages read, a short search pause

- Score 1 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence read
- Where: src/app/signals.ts:107,166; src/app/writeKinds.ts:92; src/features/search/SearchScreen.tsx:130
- Evidence: A save on Home sends the write with 4 follow reads, then projects.list and tasks.list{review_for_me} each in an own request on the own pass: 3 Edge calls (readsAfterWrite lists 4 reads on Home and 3 on Tasks; the second overview read cannot join). chats.markRead follows chats.messages too (4 reads measured), so an arriving message in an open chat reads chats.messages twice within a second (inferred: the reader's own mark does not change the reader's thread). Search sends one overview call for each 150 ms pause. me.updatePreferences follows users.list (14 KB, up to 240 KB with pictures).
- Impact: A few percent of Edge calls and some bytes; no felt effect.
- Fix: Drop chats.messages from the follow list of chats.markRead after a test proves nothing shows differently; raise the search pause to 250 ms; let a request hold two cheap overview reads (needs the server auditor).
- Skeptic impact: Small. The Home save count follows the one-overview-read-per-request rule (wire.ts:53). Dropping chats.messages after chats.markRead is wrong, and the search pause change alters feel.
- Skeptic fix note: ChatThread.readUpTo is the reader's own lastReadAt (handlers/chats.ts:321), so the follow read of chats.messages after markRead keeps the New line right. Without it a chat that opens again within the hour shows a stale New line from the cache. Leave it.
- Skeptic evidence: Read writeKinds.ts, readMap.ts chats.messages kinds, handlers/chats.ts:321, SearchScreen.tsx:130.

## Server request path

Measurements: Live on the test copy only (about 300 calls, Mac in Al Khobar, 20 rounds after 1 warm-up). Server time and CPU read from the Supabase function_edge_logs (execution_time_ms) and function_logs (cpu_time_used) through the management API with the test project token. Health (no db): client 280 ms, server 233 ms, CPU 111 ms. Bad-token batch client 365 ms. Server median/CPU: notifications.count 358/143, tasks.list 367/154, chats.list 391/170, chats.unreadCount 388/189, admin projects.list 401/174, projects.list+dashboard.get 412/198, cold Home batch of 4 reads 499/195. Client median (p90): session.get 429 (513), notifications.count 399 (552), chats.unreadCount 444 (531), projects.list 477 (598), tasks.list 414 (589), dashboard.get 425 (487), chats.list 432 (505), admin dashboard 483 (524), cold Home batch 583 (696). 205 distinct isolates for 222 requests. Statement counts (my copy of the server against the madar-test database, pg client wrapped): session.get 7, notifications.count 10, chats.messages 12, tasks.list 12, dashboard.get 12, projects.list 15, chats.unreadCount 16, chats.list 17, Home batch 36, tasks.update 20-23, comments.create 20, chats.send 22, chats.markRead 25, chats.typing 7. About 5.4 ms a statement (live lock holds: chats.send 118 ms, tasks.update 115, chats.markRead 94, comments.create 93). Import of api.js in Deno 2.9.7: 62-66 ms (mcp 70-75, jobs 60, npm:pg 25-36); profile: emoji Segmenter 10.3 ms, zod 12-16 ms, i18next 1.5 ms. Lazy Segmenter: 64 to 54 ms (8 runs). Bundled pg: 29.7 to 19.4 ms (10 runs). Office read 72 KB / 260 rows for the sample office (15 projects, 105 stages, 23 users). tools/list 59 KB admin, 48.6 KB member. Full report: /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/server.md

Not checked: Production (out of bounds). The Workers and office-object code (not live). Year-size data on a local Postgres (no Docker started, other agents hold it), so the year-size office read is an estimate from row counts. Live timing of writes: I counted statements on a local run against the test database (push stubbed) and took lock holds from the function logs, so write latency from the browser is not measured. The effect of SV-3 and SV-4 on the real Supabase edge runtime (Deno 1.x compat there; I tested Deno 2.9.7 on the Mac). Realtime message counts and the real tab count (code read and an estimate). MCP live calls (needs an agent token), and whether the test copy runs the HEAD code (function logs show deployment version 158). Mail, Resend and Google sync timing. The client side of the reload fan-out in SV-7 beyond reading signals.ts and readMap.ts.

### SV-1: Every request is a cold start: 233 ms of the 360 to 500 ms of a call

- Score 5 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: supabase/functions/api/index.ts; server/entries/deno-api.ts:1-18; server/entries/start.ts; server/data/sql.ts (IDLE_TIMEOUT_MS)
- Evidence: function_edge_logs of madar-test: 205 distinct execution_id for 222 requests; 15 back-to-back health calls gave 15 isolates, 10 calls with a 2 s gap gave 9, 6 with a 12 s gap gave 6. Without forceFunctionRegion it runs in ap-south-1 and still gave 11 for 12. Health (no database): server 233 ms median, CPU 111 ms; the one reused isolate answered in 75 ms. notifications.count: 358 ms / 143 ms CPU. Cold start is about 61% of the server time of a read.
- Impact: Every person, every request (page load, each signal reload, each press). About 230 ms and 110 ms of CPU of each call are the start of the isolate, before any work. The platform sets it; only a smaller import helps (SV-2, SV-3, SV-4).
- Fix: No code removes it. Cut the import: SV-2 (lazy Segmenter, -10 ms), SV-3 (bundle pg, -10 ms), keep zod schema building (12 to 16 ms) in mind for later. Keep the 1 s pool idle close.
- Skeptic impact: Real and already documented in server/CLAUDE.md (2026-10-16). It has no fix of its own. The controllable part is the import, about 63 to 65 ms locally; SV-2 and SV-3 save about 17 ms of it, SV-4 about 0.
- Skeptic fix note: Nothing to change here; treat SV-2 and SV-3 as the real work. Consider closing this as context.
- Skeptic evidence: Re-ran api.js import in Deno 2.9.7: 62.3 to 64.5 ms (6 runs). Read server/CLAUDE.md, which already states one cold start per request. Did not re-measure the live 233 ms.

### SV-2: Module-level new Intl.Segmenter costs 10 ms in every cold start

- Score 4 to 3, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression True, confidence measured
- Where: src/api/contract/emoji.ts:20
- Evidence: Deno 2.9.7 profile of an unminified api build puts 10.2 to 10.5 ms in emoji.ts (3 runs). new Intl.Segmenter(undefined,{granularity:'grapheme'}) alone: 9.5 to 12.7 ms. A copy with a lazy segmenter imports in a median 54 ms against 64 ms (8 runs), -16%. Introduced by the reaction/emoji work; src/lib/dates.ts already builds every Intl object lazily and the 2026-10-07 audit set that rule.
- Impact: Every request on Supabase pays it (about 10 ms here, more on the edge CPU); also a few ms on the main thread of the first load, because emoji.ts is a first-load file (not measured in the browser).
- Fix: Build the segmenter on the first call of isReactionEmoji (a module-level let with ??=). Test: isReactionEmoji keeps the same answers.
- Skeptic impact: Holds: about 10 ms of the cold start of every request (15% of the import). The size is right, but 10 ms of a 360 to 500 ms call is felt little, so score 3.
- Skeptic fix note: Lazy build on the first call of isReactionEmoji keeps the same answers. Keep the 'Segmenter in Intl' guard inside the lazy build.
- Skeptic evidence: new Intl.Segmenter alone: 9.6 ms (5 runs). Patched copy of api.js with a lazy segmenter: 54 ms against 64 ms (8 alternating runs). Read src/api/contract/emoji.ts:20.

### SV-3: pg loads from npm at each cold start (25 to 36 ms)

- Score 3 to 2, verdict weakened, fix safe True, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: vite.server.config.ts:EXTERNAL; supabase/functions/api/deno.json, mcp/deno.json, jobs/deno.json
- Evidence: npm:pg@8.23.1 imports in a median 29.7 ms in Deno; one esbuild file of pg (86 KB, pg-native and cloudflare:sockets external) imports in 19.4 ms (10 alternating runs). The profile shows op_require_read_file, resolve_exports and real_path ops (about 12 ms). A rolldown bundle of pg failed with 'Class extends value #<Object>'.
- Impact: About 10 ms locally, about 15 ms on the edge, on each request of the three functions, and a smaller eszip.
- Fix: Bundle pg into the Supabase entries (esbuild step for pg only, then alias in vite.server.config.ts), keep it external for the Worker build. Run test:it for the pooler TLS path.
- Skeptic impact: Gain is about 6 to 7 ms locally (npm pg 25 to 29 ms, bundled 20 to 22 ms), not 10. Edge gain not measured. The bundle grows 86 KB toward the 850,000 character bound of bundles.test.ts (api.js is 826,972 B).
- Skeptic fix note: Needs a createRequire banner (a plain esbuild bundle throws 'Dynamic require of events'), a raised bundle bound with a history line, a live test on the test copy for the pooler TLS path, and the Worker build must keep pg external. Medium risk for about 6 ms.
- Skeptic evidence: 6 alternating runs each of npm:pg and an esbuild bundle of pg in Deno 2.9.7; read vite.server.config.ts and bundle sizes.

### SV-4: The key download starts only after the 65 ms import, so the token check waits for it

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence inferred
- Where: server/entries/deno-api.ts:13-14; server/entries/api.ts:warmApi; server/auth/verify.ts:warmKeySet
- Evidence: A batch with a bad token costs 85 ms more than health (365 ms against 280 ms client side); token check plus database connect together are about 75 ms (intercept of the line fit: 358 ms for 10 statements, minus health 233 ms, minus 50 ms of statements). The JWKS fetch begins at module end, so it is on the critical path.
- Impact: Up to 40 ms on each request (0 if the database connect is the slower one; not separable from outside).
- Fix: Option A: in supabase/functions/api/index.ts start fetch(JWKS) first, then await import('../_build/api.js'), and give the result to jose (createLocalJWKSet). Option B: keep the public keys in a variable and use createLocalJWKSet, fall back to the remote set on ERR_JWKS_NO_MATCHING_KEY.
- Skeptic impact: The key download and the database connect start together at the end of the import and run side by side. The wait is the slower of the two, probably the connect, so moving the key download earlier likely gains 0 to a few ms.
- Skeptic fix note: Option A (start the key fetch before the dynamic import) is safe but needs plumbing into jose and gains little. Option B (a fixed key list) is a key rotation risk; only with a fallback to the remote set.
- Skeptic evidence: Read deno-api.ts, start.ts, api.ts warmApi and verify.ts warmKeySet: both warm calls fire in the same tick at module end. The auditor marked it inferred.

### SV-5: The office is read twice for each request in two transactions, and the office cache never hits

- Score 4 to 3, verdict weakened, fix safe True, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: server/http/batch.ts:56-63 (readOffice with no transaction); server/core/runCall.ts:155-165 (second read transaction, office_meta again); server/data/officeCache.ts:read
- Evidence: Counted statements (cold cache, test database): session.get 7, notifications.count 10, cold Home batch of 4 reads 36 in 5 transactions. Sign-in read = begin, office_meta, 260 rows / 72,453 B, commit; each call then repeats begin, office_meta, commit (3 statements). 15 of the 36 statements of the Home batch are transaction overhead. At about 5.4 ms a statement (lock holds in function logs, line fit of exec time). Cache cannot hit: new isolate for each request. CPU of snapshot build is small (0.15 ms; structuredClone 0.37 ms).
- Impact: Every request: 3 wasted statements (about 15 ms); the first-load batch 12 wasted statements (about 65 ms of 499 ms). The 72 KB office read (about 4 times that on a year office, inferred from row counts) is paid by every call, also typing and the unread count.
- Fix: (a) Run the sign-in office read and the first read call in one transaction. (b) Run the read calls of one batch in one repeatable-read transaction and skip the repeated office_meta read (same snapshot); use a savepoint so one failing read does not poison the next. (c) Later: a smaller office read for calls that need only users and settings. Keep the rule that a read after a write sees the write (FET-3).
- Skeptic impact: The code agrees, but the full office rows are read once per request. The second transaction reads only office_meta and hits the in-isolate cache. The waste is 3 statements per request (about 6 to 16 ms), not a second 72 KB read. The 'cache never hits' holds only across requests.
- Skeptic fix note: Do (a) first (one transaction for the sign-in read and the first read call). Option (b) must keep FET-3: a read after a write in the same request must see the write. db.savepoint exists for the error isolation. The 5.4 ms per statement is an upper bound.
- Skeptic evidence: Read server/http/batch.ts:56-63, server/core/runCall.ts runRead and officeCache.read (cached.version === version returns the snapshot).

### SV-6: chats.markRead loads the whole chat list under the office lock

- Score 4 to 2, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: server/data/loaders/chat.ts:190-205 (everyChat with inWrite), chatsMarkRead
- Evidence: 25 statements for one read mark, 21 inside the lock (14 loader reads: chat_reads twice, 3 LATERAL newest-message reads, counts, tasks, notices). Live lock hold in the function logs of madar-test: median 94 ms, p90 113 ms, max 189 ms (17 calls). chats.send holds 118 ms.
- Impact: Every chat open and every Seen mark blocks all other writes of the office for about 100 ms. One message in a chat with 4 viewers costs about 118 + 4 x 94 = 500 ms of lock. Under a busy hour this makes other people wait, and a wait over 5 s gives 'busy'.
- Fix: A loader for markRead that reads the one chat, its read mark and its newest message, and a handler that gives the same answer (the unread numbers of that chat). Keep the leak tests of the chat rules and the whole-office versus scoped-load test (loaders.test.ts).
- Skeptic impact: The load is the same as chats.list (confirmed in chat.ts chatsMarkRead and everyChat), but the output of chats.markRead is the total unread of all chats, so a one-chat loader changes the answer. At 15 people the lock is a small share of the time, so waiting is rare.
- Skeptic fix note: A loader of one chat gives a different { unread } (a contract change). Safe form: keep the counts and skip only the newest-message preview reads in markRead (a new mode flag). Do not use badge mode: pickedByKey would poison the saved task rows. Overlaps SV-10 for the shared everyChat statements.
- Skeptic evidence: Read src/api/handlers/chats.ts chatsMarkRead (output unread: totalUnread) and server/data/loaders/chat.ts everyChat, chatsOf, pickedByKey note in server/data/CLAUDE.md. Lock hold numbers not re-measured (the logs endpoint changed).

### SV-7: Each chat message makes every open tab reload chats.unreadCount (16 statements)

- Score 4 to 3, verdict weakened, fix safe True, effort M, risk medium, behavior change True, regression False, confidence inferred
- Where: server/data/save.ts:116 and :457 (PRIVATE_CHAT_KINDS, anonymous office signal), :525 (officeSignal); src/app/readMap.ts:94 (chats.unreadCount, scope person, kind messages); src/app/signals.ts:75-86
- Evidence: messages is a public kind, so the office signal carries it and affects() returns true for a person-scope read that reads it, for every tab (the 1 to 2 s merge only joins signals). One reload of chats.unreadCount is 16 statements, 388 ms server time and one Edge call. Estimate with 20 open tabs and 150 chat messages a day: about 3,000 calls a day, about 90,000 of the 500,000 Edge calls of a month, plus a Realtime delivery for each tab (not measured).
- Impact: Free-plan budget (calls, Realtime messages, database time) and a hot phone for people who are not in the chat. Grows with the number of tabs and messages.
- Fix: For a save that touches only a direct chat or a group, send the person signals to the members only (they carry the same kinds) and no office signal. Check INT-16 with the owner first (other browsers learning that somebody wrote). Cheaper without any rule change: SV-10 (fewer statements for unreadCount).
- Behavior note: A person outside a direct chat or group would no longer reload their badge when someone else writes there. Their numbers do not change, so nothing visible differs; INT-16 (the office learns that somebody wrote) needs the owner's yes.
- Skeptic impact: The mechanism is real (messages is a public kind, the unreadCount rule has scope person). But a hidden tab only marks its lists (signals.ts), so only tabs in view reload. 90,000 calls a month assumes 20 tabs in view all day; a plausible figure is 20,000 to 40,000 (4 to 8 % of 500,000). The fix covers direct chats and groups only, not project chats.
- Skeptic fix note: The finding already sets behaviorChange true and INT-16 needs the owner's yes. The cheaper path is fewer statements for unreadCount (SV-10).
- Skeptic evidence: Read src/app/signals.ts (affects, hiddenReloadMs), readMap.ts:94, PERSONAL_KINDS, server/data/save.ts:110-117 and :457-460.

### SV-8: A write runs 19 to 21 statements inside the lock; about 8 can join

- Score 3 to 2, verdict weakened, fix safe True, effort L, risk high, behavior change False, regression False, confidence measured
- Where: server/data/save.ts:508-560 (office_meta update, one upsert for each table, counters, person_seq, 'set constraints all immediate'); server/core/runCall.ts:195-200; server/data/loaders/sqlSource.ts:270 (counters read)
- Evidence: tasks.update: begin+set, lock, office_meta, stories insert, 6 loader reads, counters select, office_meta update, 4 upserts, set constraints, realtime.send, commit (20 to 23 in all). Live lock hold: tasks.update 115 ms, comments.create 93 ms, chats.send 118 ms, tasks.move 99 ms, all 20 to 22 statements. An idempotency key adds a read and an insert under the lock (inferred, not in my probe).
- Impact: Every press that saves waits about 100 to 120 ms inside the lock, and every other write waits behind it.
- Fix: One statement with data-modifying CTEs for the office_meta update, the table upserts, the counters and person_seq; fold the stories insert in; send 'set constraints all immediate; commit' as one simple query; read the counters in the office_meta statement. Saves 6 to 9 statements (30 to 50 ms of lock).
- Skeptic impact: 20 statements under the lock is right, but at 2 to 4 ms a statement, joining 6 to 9 saves about 15 to 35 ms of lock for each write, not 30 to 50. Risk is high for that gain.
- Skeptic fix note: Behavior can stay the same, but foreign key timing and row order need test:db and test:it. Judge the gain against the risk.
- Skeptic evidence: Read runCall.ts runWrite order (lock, office, story, loader, save, outbox, keys, signal). Statement cost of 5.4 ms includes handler JavaScript, so it is an upper bound.

### SV-9: The push producer reads all people again under the lock

- Score 3 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/push/chatFacts.ts:PUSH_PEOPLE_SQL and postgresFacts (about lines 60-130)
- Evidence: chats.send is 22 statements; 3 are producer reads (notices/items, 'select u.id ... from users' returning the 23 users, 5,125 B, chat_reads levels). The office snapshot already holds users, roles and agents (liteFacts uses it).
- Impact: 2 to 3 statements (10 to 15 ms) added to the 118 ms lock of each chat message and each comment.
- Fix: Take people, roles and owners from the snapshot and ask the database only for devices (or put the 3 reads in one statement).
- Skeptic impact: The people read also holds the device flag (exists on push_devices), which the snapshot lacks, so the proposed 'devices only' read is still one statement: no round trip saved. Only the 5 KB payload goes. The producer reads run only when a message or comment was inserted.
- Skeptic fix note: Safe form: one statement for items, people and levels (saves 2 statements per chat message and comment). Plumbing the snapshot into postgresFacts needs a signature change.
- Skeptic evidence: Read server/push/chatFacts.ts PUSH_PEOPLE_SQL, postgresFacts (early return when no item ids).

### SV-10: The most used reads send 12 to 17 statements one after the other

- Score 4 to 3, verdict weakened, fix safe True, effort L, risk medium, behavior change False, regression False, confidence measured
- Where: server/data/loaders/chat.ts (everyChat, chatsUnread); server/data/loaders/overview.ts (projectsList, dashboardGet, tasksList); server/data/loaders/sqlSource.ts
- Evidence: Counted: chats.unreadCount 16 (9 loader reads), chats.list 17, projects.list 15 (113 rows then lateral reads, 3 files reads, comments count, undo link), dashboard.get 12, tasks.list 12. chat_reads is read twice; three LATERAL reads and two counts do not depend on each other. Exec fit: about 5 ms for each statement (cold Home 499 ms for 36 statements, notifications.count 358 ms for 10).
- Impact: Home, Inbox badge and Inbox list on every load and every signal reload: 25 to 60 ms of each of those requests, plus database time on the free plan.
- Fix: Let a Source send the independent selects of one loader as one statement (union all of json rows) and use Promise.all in those loaders; start with chatsUnread and chatsAll. Keep server/it/readIndexes.it.test.ts green and the whole-office versus scoped-load equality.
- Skeptic impact: Statement counts hold by code read. But Promise.all gives no overlap on one connection (pool max 1, no pipelining), so only a union-all of independent selects removes round trips. Realistic saving about 10 to 25 ms of a 388 ms unreadCount, run on every signal reload.
- Skeptic fix note: Drop the Promise.all part of the fix. Keep the read-index plans (readIndexes.it.test.ts) and the whole-office versus scoped-load equality. Start with everyChat, which also helps markRead (SV-6).
- Skeptic evidence: Read server/data/loaders/chat.ts chatsOf, threadsOf (3 comment selects, 2 counts) and server/data/sql.ts poolConfig max 1.

### SV-11: files.link costs 3 statements for each link and the links do not overlap at the database

- Score 2 to 2, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence read
- Where: server/files/records.ts:34 (db.statement); server/calls/files.ts:98-120; server/http/batch.ts:76-82 (Promise.all)
- Evidence: readFile runs db.statement('read'): begin, select, commit on the one read connection (pool max 1), so Promise.all queues at the pool. 12 links = 36 statements one after the other, about 180 ms at 5 ms. The Supabase store adds one HTTP call for each link (parallel); the R2 store signs in CPU. Code read; not timed live.
- Impact: A Files tab or a chat with many pictures waits about 15 ms for each link in a row.
- Fix: Read the files of the whole run with one statement (id = any) before the signing, or run the run in the batch transaction (SV-5).
- Skeptic impact: Holds by code read: each files.link opens its own short transaction (3 statements) on the one read connection, so adjacent links queue at the database. About 6 to 15 ms per link in a row; the HTTP signing runs in parallel. Not timed live.
- Skeptic fix note: One read of all files of the run before the signing keeps the answers and their order.
- Skeptic evidence: Read server/files/records.ts:34, server/calls/files.ts filesLink, server/data/sql.ts statement() and run(), server/http/batch.ts Promise.all of adjacent link entries.

### SV-12: A write request opens two database connections

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk medium, behavior change False, regression False, confidence inferred
- Where: server/http/batch.ts:60-61 (warm write); server/data/sql.ts:poolOf (read pool and write pool, max 1 each)
- Evidence: The sign-in read uses the read pool; the write uses the write pool, so a new isolate does two TCP, TLS and pooler logins and holds two pooler clients for at least 1 s (client limit 200 on madar-test; EMAXCONN on 2026-10-16). No request has two statements at the same time, so the second connection buys no overlap. Code read.
- Impact: About 10 to 30 ms of CPU for each write request (inferred) and half of the pooler clients under load.
- Fix: One pool inside a Supabase isolate (keep two for the Worker if still needed). Test that a read never waits behind a lock wait: in one isolate the calls of a request are in order.
- Skeptic impact: readUrl falls back to writeUrl (the test copy sets no DATABASE_READ_URL), so both pools reach one database. warm('write') starts the second connect during the sign-in read, so it costs a few ms of CPU, not wait. At 15 people the pooler client limit of 200 is not near.
- Skeptic fix note: One pool inside a Supabase isolate is a safe small change; the gain is small.
- Skeptic evidence: Read server/data/sql.ts poolOf and poolConfig, server/core/deps.ts:127-138; counted DATABASE_READ_URL in secrets/test.env (0 lines, value not printed).

### SV-13: Each after-answer effect runs 6 statements in 2 transactions and a chat message keeps the isolate 10 s

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence read
- Where: server/core/effects.ts:processOutbox (claim and done through db.statement), CHAT_WAIT_MS; server/core/runCall.ts:225-238
- Evidence: A mention in a chat makes push.chat and mail.chatNotice rows: claim (begin, update, commit) and done (begin, update, commit) for each, plus the handler reads and a new connection after the 10 s sleep (pools close after 1 s). Code read.
- Impact: Not felt by the sender. Costs database time and one isolate (about 20 MB) for 10 s or more for each such message.
- Fix: One statement for claim and one for done without a transaction of their own, or claim all rows of a batch in one statement; keep one connection for the chain.
- Skeptic impact: Nobody waits for it. It costs a few statements after the answer and an idle isolate for 10 s, which the design wants (design item 20). Not a felt or budget problem at 15 people.
- Skeptic fix note: 'No transaction of their own' conflicts with the set local rule (server/data/CLAUDE.md). Safe form: claim all rows of a batch in one statement.
- Skeptic evidence: Read server/core/effects.ts:142-159 (db.statement claim, done, wait, fail) and CHAT_WAIT_MS.

### SV-14: chats.typing is a full request (7 statements, 72 KB) to send one signal

- Score 2 to 2, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/calls/typing.ts; server/signal/typing.ts; src/app/live/typing.ts (one call each 5 s)
- Evidence: Counted: office read transaction (4 statements, 260 rows, 72 KB) plus a transaction of 3 statements for realtime.send. Each call is a cold start (233 ms, 111 ms CPU). About 6 calls for a 30 s message.
- Impact: Free-plan calls (about 5 % of 500,000 a month with 15 busy people, inferred) and a little database time.
- Fix: Send the signal with one statement (no separate begin and commit) if the 'set local' rule allows; the cold start stays the main cost.
- Skeptic impact: Holds: realtime typing goes through db.statement, which is begin, select, commit (3 statements); the file comment 'outside any transaction' is out of date. The real cost is one Edge call (quota) per signal, not the 10 ms.
- Skeptic fix note: A single statement with no begin loses the set local timeouts, so gain is about 10 ms; the cold start and the quota cost stay.
- Skeptic evidence: Read server/calls/typing.ts, server/signal/typing.ts, server/data/sql.ts statement(), src/app/live/typing.ts TYPING_SEND_MS 5 s.

### SV-15: MCP tool calls use two connections and about 10 statements before runCall

- Score 2 to 1, verdict weakened, fix safe True, effort M, risk low, behavior change False, regression False, confidence read
- Where: server/mcp/app.ts:331-343 (agentOf statement, office read, limit statement on the write pool), :231-262 (McpServer and registerTool of 47 to 57 tools for each request), server/mcp/tools.ts (mcpTools)
- Evidence: mcp.js 1.27 MB imports in 70 to 75 ms against 62 to 66 ms for api.js (Deno, 4 runs). mcpTools first build 10.5 ms for 57 tools. tools/list: 59,029 B for an Admin agent, 48,612 B for a member agent, no outputSchema; server instructions 13,211 B. The limit statement is db.statement on the write pool. Not live-tested (needs an agent token).
- Impact: AI agent calls only: about 40 to 60 ms more than a browser read. Low traffic.
- Fix: One transaction for the agent read, the office and the limit update; build the JSON Schemas of the tools once for each isolate and reuse them in registerTool; keep tools/list small (descriptions of the 5 largest tools are 450 to 600 characters).
- Skeptic impact: Agent traffic only (60 calls a minute limit per person). 'Build the schemas once for each isolate' saves nothing on Supabase because an isolate serves one request. Only the one-transaction part has value.
- Skeptic fix note: Drop the schema cache idea. Optionally register only the called tool for tools/call (the factory already knows callName).
- Skeptic evidence: Read server/mcp/app.ts:222-270 (a McpServer and registerTool loop in the factory, once for each request) and :320-350.

## Database

Measurements: Local stack (Docker, Postgres 17.11, default planner settings, madar_server role under RLS), one-year fixture built with server/office/test/yearOffice.ts and the real save step: 60,909 events, 6,100 tasks (85 per project, 72 projects), 20,000 comments, 15,000 messages (75 chats), 30,000 notices (300 unread per person), 3,000 posts, 6,000 files, 1,500 meetings, 1,500 Tracker lines, 5,780 read marks; 115 MB in public. Rows reordered to insertion order (an earlier unordered fixture made events.list pick a seq scan: a fixture fault, discarded). Reads: the real loaders (loadFor with sqlSource) for 46 call shapes as Admin and Member, per statement EXPLAIN (ANALYZE, BUFFERS) best of 3 after warm-up, plus rows and JSON bytes. Writes: real runCall with realtimeSender and the mail, push, Google and auth producers, with a recording Db. Key numbers: cold office read 1,118 rows 263 KB 3.3 ms; dashboard.get 1.35 MB 35 ms (handler 248 ms CPU); reports.office 2.2 MB; jobs loader 676 KB; chats.unreadCount 24 to 33 ms DB time (15 ms after DB-5 and DB-6); chats.messages 7.0 to 0.7 ms; notifications.list 2.7 to 0.09 ms; chats threads statement 13.4 to 9.5 ms; events year reads 10 ms to 0.02 to 2.5 ms; a save is 11 to 25 statements at 0.3 to 1.0 ms each. Checked and fine: Realtime publication supabase_realtime holds no table; RLS cost none (31.8 vs 31.9 ms); events_append_only trigger costs nothing on insert; the 8 event indexes cost 8.7 microseconds per event; office_meta, counters and person_seq updates are all HOT; readIndexes.it.test.ts passes 6 of 6; loaders.it.test.ts passes 9 of 9 with the LATERAL count; the only unit test that fails with the DB-5 change is the old text pin at sqlSource.test.ts:117. Report and probe outputs are in /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/ (database.md, db-probe-4.md, db-probe-5-before-*.md, db-probe-5-after-*.md, db-write-2.md, captured.json). Stack stopped and Docker lock released.

Not checked: Production and the test copy (out of bounds or not needed). The real round trip between an Edge Function and the Frankfurt pooler, the pg connect per request (idle connections close after 1 s) and the Edge Function CPU limit: all times are localhost database milliseconds and the 248 ms handler time is on this Mac. Whether Supabase counts database to Edge Function traffic as egress: access-map.md assumes yes, and the Egress chart of the test project would show it in one look. Realtime delivered-message counts and presence traffic (client side). The request path (shared read transactions) and the client refetch rules belong to other auditors. Real doc shapes: my task docs are 427 B and comment authors are random over 10 people, so byte counts for tasks are likely low. The paused Supabase-exit SQLite path and Workers were skipped. Autovacuum and the Free plan disk IO budget on the hosted project. A DB-1 subset of the office would need a test that runs every call with only its declared parts.

### DB-1: The office lists load in full on every request (263 KB, 1,118 rows)

- Score 5 to 3, verdict weakened, fix safe True, effort L, risk medium, behavior change False, regression True, confidence measured
- Where: server/data/officeCache.ts:71-75 and 119-170 (OFFICE_ROWS_SQL, read, refresh); server/core/runCall.ts:152,183; server/calls/typing.ts (reads ctx.office)
- Evidence: OFFICE_ROWS_SQL with chg > -1 on the one-year fixture: 13 tables, 1,118 rows, 263,316 B, 3.3 ms in Postgres, about 5 ms JS (13 ms first run). By list: projects 62.6 KB, stages 63.3 KB, deadlines 24.6 KB, members 14.8 KB, conversations 9.1 KB, users 7.3 KB, templates 6.2 KB. server/CLAUDE.md says a Supabase worker serves one request and stops, so the module cache is always cold. 263 KB is 8 times the 33 KB per request that access-map.md gives for 5 GB egress at 150,000 requests.
- Impact: Every request on Supabase pays it, before the loader reads: the badge calls, chats.typing (one call each 5 s per typist), files.link, the cron. About 263 KB and 5 to 15 ms of JS CPU per request; at 150,000 requests a month it is 39 GB if the pooler traffic counts as egress.
- Fix: Let each call name the office parts it needs. stages and deadlines (88 KB, 33%) and the templates (6 KB) are not needed by notifications.count, chats.unreadCount, chats.typing, push.* and files.link: those would read about 95 KB. Build OFFICE_ROWS_SQL from a subset (it is already built from OFFICE_COLLECTIONS) and track the held parts in the in-isolate cache. Test every call with only its declared parts (everyCall) so an undeclared list fails loudly.
- Skeptic impact: Real: 263,452 B and 1,119 rows on every cold request, about 3 ms of database time plus about 5 ms of JS next to a 230 ms cold start. The per-call parts fix only saves on batches whose calls are all light (typing, files.link, some badge-only refetches), because the Batcher groups calls of one moment and screen reads need the full lists. The 39 GB egress figure needs unproven pooler egress counting and 150,000 requests (production had 212 requests on 2026-10-16).
- Skeptic fix note: Safe only with the everyCall test that runs each call with its declared parts, and writes must keep all parts (beforeOf). Expect a saving on a minority of requests.
- Skeptic evidence: Re-ran perfOffice: 1,119 rows, 263,452 B, 3.19 ms. Read officeCache.ts, runCall.ts, batch.ts:61, batcher.ts, proof.md 961-972.

### DB-2: The 15-minute job loads every open task whole plus the office: about 0.95 MB a run, 2.7 GB a month

- Score 4 to 3, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/data/loaders/jobs.ts:15-16; server/jobs/steps/triggers.ts (lock, load, structuredClone twice); src/api/notify.ts:186-231
- Evidence: loadJobs on the fixture: 1,609 open tasks, 675,450 B, 14 ms, plus the office 263 KB. 96 runs a day, 2,880 a month, also at night. Measured fixes: pick of id, projectId, status, dueDate, ownerId, helperIds, createdBy gives 267,145 B (-60%); plus due_date <= today+4 days gives 1,113 rows, 185,242 B (-73%). The step holds the office lock for the load (22 ms) and the dedupe pass (13 ms) on localhost.
- Impact: A fixed cost with nobody using Madar: about 2.7 GB a month of the 5 GB free egress (if pooler traffic counts), and every user write waits behind the lock for 35 ms or more (plus round trips) 96 times a day.
- Fix: In loadJobs pick the 7 fields and add a due_date upper bound (new text condition dueBy in query.ts, sqlSource.ts, memorySource.ts, or the pick alone). runScheduledTriggers reads only status, dueDate, projectId and, through peopleOfTask and mayViewTask, lead, helpers and maker. Confirm with loaders tests and jobs.it.test.ts.
- Skeptic impact: Confirmed on 96 runs a day with no night skip. Re-measured 1,609 rows, 697 KB whole; pick of 7 fields 253 KB (-64%); with a due bound 175 KB (-75%). The saving is about 1.2 GB a month with the pick (1.5 GB with the bound), not 2.7 GB, because the 263 KB office read stays. Whether pooler bytes count as egress is not proven.
- Skeptic fix note: Pick of id, projectId, status, dueDate, ownerId, helperIds, createdBy is safe: runScheduledTriggers, notify, copyForAdmins and mayViewTask read only those; no task row is written. A due bound of +4 days is safe (due_tomorrow looks at most 3 days ahead, no holidays), but it needs a new condition in 4 files (effort M); the pick alone is S.
- Skeptic evidence: SQL on the fixture, read jobs.ts, triggers.ts, notify.ts:85-170,191-207, workdays.ts, run.ts.

### DB-3: dashboard.get reads every task of the scope: 1.35 MB, and the handler spends 250 ms CPU on them

- Score 4 to 3, verdict weakened, fix safe True, effort L, risk medium, behavior change False, regression False, confidence measured
- Where: server/data/loaders/overview.ts:69 and :30 (DASHBOARD_TASK_FIELDS); src/features/dashboard/DashboardScreen.tsx:64-65; src/api/handlers/insights.ts:143-300
- Evidence: Admin active: 4,630 rows, 1,351,054 B, 35 ms; all: 6,100 rows, 1,769,734 B, 48 ms; Member 1,342,590 B. Handler plus output 248 ms on this Mac (330 ms in runCall); load 57 ms. Measured: array encoding of the 11 fields 1,772,663 B to 1,077,263 B (-39%); no title except for in_review tasks -10%. 2026-10-08 proof had 0.95 MB on smaller docs.
- Impact: Every Home or Dashboard load of a person with the switch, up to twice per screen, and again after each change signal of tasks, projects, events and others. 1.3 to 1.8 MB from the database and 250 ms or more of Edge Function CPU each time.
- Fix: (a) Array encoding of picks (DB-4). (b) Read the title only for in_review tasks. (c) Count done tasks older than 12 weeks per project, stage and status in SQL instead of loading them (needs the stage tag and health rules proven on counts, so it is the large step). Also group tasks by project once in dashboardGet (it filters tasks for each project and each week).
- Skeptic impact: Home does not call dashboard.get (only DashboardScreen.tsx:64-65 and MeetingView.tsx:233 do), so only Dashboard and meeting view users pay it. The 1.34 MB is confirmed, but the 250 ms is JS: a CPU profile shows stageTag in flow.ts (about 135 ms a call, a full Object.values filter of all tasks for each project) and todayISO through stampDay (60 to 80 ms a call). The SQL fixes (array encoding, no title) cut bytes and JSON parse, not this CPU.
- Skeptic fix note: Fix (a) is safe (see DB-4). (b) needs a conditional pick that pickSql lacks. (c) is a rule rewrite (large). The real CPU lever is a handler fix: group tasks by project once for stageTag and avoid new Date for each task in stampDay. Grouping only inside dashboardGet does not help, because stageTag scans state.tasks itself.
- Skeptic evidence: Re-ran dashboard.get through runCall: 300 to 365 ms total, database statements about 51 ms. Profile of 6 runs. SQL: 1,342,366 B objects, 770,366 B arrays, 1,201,757 B without title.

### DB-4: Picked rows repeat their key names in every row (about 40% of the bytes)

- Score 3 to 3, verdict confirmed, fix safe True, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: server/data/loaders/sqlSource.ts:117-126 (pickSql) and the select in sqlSource
- Evidence: Dashboard task rows as jsonb objects 1,772,663 B; as jsonb arrays of the same 11 values 1,077,263 B (-39%). Reads that use pick: dashboard.get, projects.list (710 KB of its 843 KB are task picks), reports.office, thread tasks and comments, notices, pickedByKey.
- Impact: Less data from the database for every picked read: about 0.7 MB less on each dashboard.get, 0.28 MB on projects.list, 0.65 MB on reports.office.
- Fix: Return jsonb_build_array(values) plus a small absent mask, and rebuild the object in sqlSource.select from the pick list. The Source contract and the rows stay as they are. Pin with sqlSource.test.ts and loaders.it.test.ts (absent versus null).
- Skeptic impact: Array form is -43% on the dashboard rows (770,366 vs 1,342,366 B). It saves bytes and JSON.parse only. Its saving is the same as DB-3 fix (a), not additive.
- Skeptic fix note: Safe if the absent-versus-null mask is kept; pin with sqlSource.test.ts and loaders.it.test.ts.
- Skeptic evidence: SQL on the fixture for 4,576 active tasks; read pickSql in sqlSource.ts:117-126.

### DB-5: The unread count scans the whole message table (regression of DB-6)

- Score 4 to 3, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression True, confidence measured
- Where: server/data/loaders/sqlSource.ts:180-195 (countSql joined branch); server/data/loaders/chat.ts:55-65 (countOf)
- Evidence: Statement joins jsonb_to_recordset to messages. At 15,000 messages the planner uses a hash join and a seq scan of all messages: 6.6 to 8.2 ms, 1,665 buffers, a second one 8 ms for the mention-only chats; chats.messages pays 6.9 ms for ONE chat. Join form 1.4, 2.6, 4.0, 5.3, 6.7 ms at 3k, 6k, 9k, 12k, 15k messages; LATERAL form 0.11 to 0.40 ms. Same rows (server/it/loaders.it.test.ts 9 of 9). Real loaders before to after: chats.messages 7.0 to 0.7 ms, chats.unreadCount Admin 33.4 to 15.9 ms and Member 24.4 to 14.4 ms (with DB-6), chats.list Admin 43 to 26.7 and Member 28.7 to 19.5, chats.markRead 32 to 22. Worst case (37 chats never opened) 10.7 to 5.8 ms.
- Impact: Runs in chats.unreadCount, the badge of the tab pill that every open tab refetches after each chat, task, comment or project signal, and in chats.list, chats.markRead and every chat open. 7 to 15 ms of database time per call, growing with the message table.
- Fix: Count each key with a LATERAL subquery: select b.k as v, x.n from jsonb_to_recordset($1::jsonb) as b(...) cross join lateral (select count(*)::integer as n from <table> t where t.<per> = b.k and <terms>) x where x.n > 0. Update the text pin at server/data/loaders/sqlSource.test.ts:117 and add the statement to readIndexes.it.test.ts so the plan cannot flip back unseen.
- Skeptic impact: Reproduced: join form 5.9 to 11 ms (Seq Scan on messages), LATERAL form 0.44 to 0.9 ms, identical result hash. Real and grows with messages, but it is about 5 ms inside a 25 to 45 ms call, so a person does not feel it.
- Skeptic fix note: Safe; the old text pin at sqlSource.test.ts:117 must change, and add the statement to readIndexes.it.test.ts.
- Skeptic evidence: EXPLAIN ANALYZE of the captured unread_member statement against the LATERAL form on the fixture; md5 of both results equal (74f698b9a6e98545f1a13e78bf843fc3).

### DB-6: The task threads statement scans the comment table twice

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/data/loaders/sqlSource.ts:248-275 (threads); used by chats.ts list, unreadCount, markRead, waiting
- Evidence: 13.4 to 17.4 ms, 5,061 buffers: seq scan of 20,000 comments for doc->>'authorId' = any(me) (5 ms) and a hash join with a second scan for the thread maxima. Tried: create index comments_author_task on comments (target_type, (doc->>'authorId'), target_id): Member 13.4 to 9.5 ms, Admin 17.0 to 10.2 ms, same rows; plus a LATERAL rewrite 9.1 ms (little more). Write cost: 20,003 comment inserts 435 to 482 ms (+2.3 microseconds each). Remaining cost is a seq scan of tasks for the OR condition (about 7 ms).
- Impact: 13 to 17 ms of every chats.unreadCount, chats.list and chats.markRead call (half of their database time), growing with comments.
- Fix: Migration: create index comments_author_task on comments (target_type, (doc->>'authorId'), target_id); analyze comments. The statement text stays. Add it to readIndexes.it.test.ts.
- Skeptic impact: Index comments_author_task takes the threads statement from 11.4 to 14.8 ms to 7.3 to 8.7 ms (about 4 ms), same rows. The statement still scans all 20,003 comments and all tasks.
- Skeptic fix note: Safe (a migration with an index and analyze). Add it to readIndexes.it.test.ts.
- Skeptic evidence: EXPLAIN ANALYZE of captured statements for usr_005 and usr_001 before and after the index (rolled back); equal md5 for both users.

### DB-7: events.list reads every private meeting of the person, whole, on every call

- Score 3 to 2, verdict weakened, fix safe False, effort S, risk medium, behavior change False, regression False, confidence measured
- Where: server/data/loaders/meetings.ts:36-38 (privateMeetingsOf); server/data/loaders/overview.ts:201; src/api/handlers/history.ts:67-69
- Evidence: Admin 300 rows, 169,369 B; Member 150 rows, 84,685 B, 0.3 ms, for 1,500 meetings a year. A pick of id, projectId, organizerId, attendeeIds, title: 84,685 B to 22,129 B (-74%). It has no limit and grows with the years.
- Impact: Each History or feed read (events.list) carries 85 to 170 KB of meeting docs that only give ids to a SQL condition; real docs with minutes and notes are larger.
- Fix: Pick those 5 fields in privateMeetingsOf. A picked row stays in the State, so the pick must hold every field that eventTargets, lineMinutes and the label read for a meeting target (a meeting with no project has no Tracker line). Keep the leak tests in meetings.it.test.ts.
- Skeptic impact: Real but at most about 60 KB for one events.list call, and 1,500 meetings a year with 300 private for one person is a high assumption.
- Skeptic fix note: The proposed pick (id, projectId, organizerId, attendeeIds, title) lacks kind. The feed label reads meeting?.kind (src/api/views.ts:144-148) and the feed words depend on it (_meeting or _visit). Add kind, and any field that meetingResource or mayViewMeeting reads. Load.byKey never reloads a held row, so a picked copy would hide fields from a later whole read; keep the leak tests.
- Skeptic evidence: Read meetings.ts:36-38, overview.ts:201, history.ts:55-80, views.ts:138-150, build.ts:104-115.

### DB-8: The bell count reads every unread notice whole

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/data/loaders/inbox.ts:22-26 and 50-55 (unreadOf, inboxCount); src/api/handlers/notifications.ts:222-227 (counts)
- Evidence: 300 unread: 300 rows, 66,481 B per notifications.count (0.3 ms). The count reads only userId, read, trigger, targetType, targetId (and feedback for a report notice). A pick of those: 64,787 B to 38,687 B (-40%). A person who never clears the bell has about 2,000 notices a year.
- Impact: notifications.count is the second badge of the tab pill and refetches after each notice, project, task, update or user change: 66 KB each time at 300 unread, more for a person with a backlog.
- Fix: In count mode (!L.write) select unread notices with pick userId, id, read, trigger, targetType, targetId, feedback. markAllRead, markRead and the list keep whole rows.
- Skeptic impact: Pick saves 32% (64.7 KB to 43.8 KB for the people with about 300 unread), not 40%, and 300 unread is an extreme state; most people have a few.
- Skeptic fix note: Safe in count mode: notifications.ts counts() and isGone read only userId, read, trigger, targetType, targetId. Keep whole rows for the list and the writes.
- Skeptic evidence: SQL on the fixture for usr_003, usr_004, usr_007; read inbox.ts, notifications.ts:74-105,201-207.

### DB-9: notifications.list sorts all read notices of the person to keep 100

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/data/loaders/sqlSource.ts:157-170 (window form with ord in the order); supabase/migrations/20261004000100_core.sql notifications_inbox
- Evidence: Plan: bitmap scan of 2,700 read notices (2,327 buffers), sort 859 KB, keep 100: 2.7 to 3.3 ms, linear with the age of the account. notifications_inbox has the default collation; the loader orders by collate C, and = any(array) stops an ordered scan. Tried: equality for a one-element in-list, plain LIMIT form with outer order by ord, and index (user_id, read, created_at collate C desc, id collate C desc): 2.44 ms to 0.09 ms, 80 buffers instead of 1,806, same rows. A second index costs nothing measurable (30,003 inserts 259 vs 247 ms; 3,000-row markAllRead 60 vs 63 ms).
- Impact: Every Inbox bell open: 3 ms now, about 10 ms after three years of notices.
- Fix: Migration: create index notifications_inbox_c on notifications (user_id, read, created_at collate "C" desc, id collate "C" desc), which can replace notifications_inbox. In selectSql emit equality for a one-element in-list and use the LIMIT form when ties are off and order.id is set (id is unique, so t.ord is not needed).
- Skeptic impact: Reproduced 2.5 ms to 0.1 ms on each Inbox bell open. Real but tiny; it grows slowly with the age of the account.
- Skeptic fix note: Safe if the outer order by ord is kept so the row order of the loader stays the same; selectSql is shared, so pin with sqlSource tests.
- Skeptic evidence: EXPLAIN ANALYZE of the captured notif_list statement and of the LIMIT form with the new index (rolled back).

### DB-10: reports.office moves 2.2 MB whatever the period and scans the events four times

- Score 2 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/data/loaders/report.ts:35-36 and 41-53
- Evidence: Week, month and year all read 7,667 rows, 2,223,760 B: 6,100 tasks (1,657,779 B, 41 ms) and 1,500 Tracker lines whole (539,415 B). For the year, 3 event reads each scan 20,300 events: 10.0, 8.5, 7.9 ms (6,500 buffers). Tried partial index on events (verb, created_at collate C) where verb in the 5 report verbs: 10.0 to 2.5 ms and 8.8 and 9.3 to 0.02 ms, same rows.
- Impact: The Reports screen (a weekly screen): 2.2 MB and 45 to 95 ms of database time per open or refetch, 125 ms handler CPU.
- Fix: Migration: create index events_report_verbs on events (verb, created_at collate "C") where verb in ('project.stage_changed','project.status_changed','project.paused','task.approved','task.sent_back'); analyze events. Pick the Tracker fields the report reads. Use array encoding (DB-4) for the tasks.
- Skeptic impact: The 2.2 MB read whatever the period holds (reports.office runs 190 to 205 ms for a week and 200 ms for a year). The event scans are slow only for long periods: year 10.8 to 11.3 ms, down to 2.4 to 3.5 ms with the partial index; a week is already 0.35 ms on events_created_c. So the index helps year and quarter reports, not the usual weekly one.
- Skeptic fix note: Safe. Pick the Tracker fields the report reads and use array encoding for the tasks for the byte saving.
- Skeptic evidence: EXPLAIN ANALYZE of the stage count for a year and a week range, with and without the partial index (rolled back); runCall timing of reports.office.

### DB-11: tasks.list reads the tasks of the waiting projects a second time

- Score 2 to 2, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: server/data/loaders/overview.ts:117-119
- Evidence: tasks.list all as Admin: statement 1 reads 4,576 task rows (1.87 MB), statement 3 reads 507 rows, 204,059 B of the same projects again; the comment count over 4,576 ids plans for 9.7 ms and runs 8.2 ms.
- Impact: About 200 KB wasted on a full task list of the Admin, plus 18 ms for the comment counts of the full list.
- Fix: Keep a set of project ids whose tasks the load already holds in full and skip them in tasksOf. A narrow list (mine) still needs the read.
- Skeptic impact: Confirmed in code (overview.ts:117-119). It also happens on tasks.list {projectId} (the project To-dos tab): the project's 85 tasks (29.6 KB) are read twice when one task waits. The Admin all-list case wastes about 204 KB.
- Skeptic fix note: Safe when the skip applies only to projects whose first read had no narrowing condition.
- Skeptic evidence: Read overview.ts:96-121, steps.ts tasksOf; runCall statement list for tasks.list prj_001 (85 rows, 29,596 B).

### DB-12: A save sends 11 to 25 statements under the office lock

- Score 2 to 1, verdict weakened, fix safe False, effort M, risk low, behavior change False, regression False, confidence read
- Where: server/data/save.ts:529-561; server/core/runCall.ts:179-205; server/push/chatFacts.ts:53,126 (PUSH_PEOPLE_SQL); server/data/loaders/chat.ts (duplicate newest-comment reads)
- Evidence: db-write-2.md: chats.send 14 statements plus BEGIN and COMMIT, comments.create 14 (18 with a mention), tasks.update with notices 23, markRead 18, markAllRead 11. Each statement 0.3 to 1.0 ms in the database; lock held 9 to 25 ms on localhost. Avoidable: select prefix, n from counters (21 rows) on every write; set constraints all immediate on a save that wrote no table with the deferred foreign key; PUSH_PEOPLE_SQL re-reads all users on every message and comment though the office snapshot holds them. chats.list sends the newest-comment LATERAL three times and the read marks twice.
- Impact: Every write holds the lock for as many round trips as statements: about 14 to 25 times the Frankfurt round trip. One or two statements saved is a few ms on each chat message, comment and task change.
- Fix: Return the counters with META_SQL (first statement after the lock); skip set constraints when no FK table was written; give the push producer the users from the office snapshot; merge the three newest-comment reads of a thread into one statement. Round trip times were not measured.
- Skeptic impact: A few ms of lock hold on a write path with about 40 writes a person a day; round trips were not measured and there is no lock contention at 15 people.
- Skeptic fix note: Do not skip set constraints all immediate without a proof of which tables carry the deferred key (TM R11 safety check). PUSH_PEOPLE_SQL also reads exists(push_devices) for each user, which the office snapshot does not hold, so using the snapshot is incomplete. Returning counters with META_SQL is safe.
- Skeptic evidence: Read save.ts:529-561 and chatFacts.ts:53-56,126.

### DB-13: The outbox is never cleaned and is scanned without an index by the invite checks

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change True, regression False, confidence inferred
- Where: server/jobs/steps/cleanup.ts (no outbox delete); server/calls/people.ts:33-35 (INVITE_SENT_SQL); server/auth/invite.ts:94-117
- Evidence: No delete from outbox exists in server/. Done rows stay for ever (mail.notice, push.notify, push.chat, mail.chatNotice, gcal.sync). A copy of the table with 60,015 rows is 16 MB with indexes; INVITE_SENT_SQL and the inviteId updates seq scan it: 8.8 ms and 6.6 ms. The row count for a year is my estimate from 30,000 notices and 15,000 messages (the fixture has 6 rows).
- Impact: Database size (500 MB limit) and the People screen and invite flows get slower each year. Small today.
- Fix: In the cleanup step delete done rows older than 30 days for the mail, push and gcal kinds. Keep auth.invite and auth.email rows (their sentAt is data). This deletes data, so it needs the owner's OK.
- Behavior note: Old done outbox rows of mail and push kinds are deleted. Nothing visible changes, but stored data does.
- Skeptic impact: No outbox delete exists, confirmed. About 16 MB a year is an estimate of the auditor's copy, small against 500 MB; INVITE_SENT_SQL runs only on the People screen and invite flows.
- Skeptic fix note: Safe after the owner approves deleting done mail, push and gcal rows older than 30 days (stored data changes). Keep auth.invite and auth.email rows.
- Skeptic evidence: Read cleanup.ts (no outbox delete), run.ts, migration outbox_open index.

### DB-14: Database size: 115 MB for one year, 56% in the events table

- Score 1 to 1, verdict confirmed, fix safe True, effort L, risk low, behavior change False, regression False, confidence measured
- Where: supabase/migrations/20261004000100_core.sql (events); server/data/tables.ts
- Evidence: public schema after VACUUM FULL: events 64 MB (50 MB heap, 13 MB indexes, 820 B an event with before and after), comments 13, notifications 13, messages 11, tasks 3.7, files 3.2, others under 2 MB each. About four years to 500 MB with the system schemas. I tried toast_tuple_target and lz4 on a copy of events: no size change.
- Impact: A free plan limit that arrives in a few years. No effect today.
- Fix: No cheap fix found. Watch the size once a quarter. Options for later: a smaller before and after in events, or a move of old events to a cold table.
- Skeptic impact: Confirmed and informational: events 64 MB of 130 MB database on the fixture (638 B an event). No cheap fix; watch the size.
- Skeptic fix note: No fix proposed.
- Skeptic evidence: pg_total_relation_size on the fixture: events 64 MB, comments 13, notifications 13, messages 11, tasks 3.7.

## Background paths

Measurements: Test copy madar-test only, read-only, no production contact. (1) Realtime tab script (scripts/proof/bg-realtime.ts in the scratchpad copy): 24 channels joined in 0.875 s warm and 3.6 s cold, 46 frames to join, 7 frames idle for 70 s, 8 frames for 4 own state flips. (2) pg_cron: schedule */15, 731 runs in 7.5 days, 0 failed, 42 ms average command time. (3) pg_stat_statements: office load 62,570 runs of 211 rows against 291,001 office_meta reads (21 percent); realtime.authorize 20,599 calls at 2.08 ms mean; realtime.send of signals 1.81 ms mean; job statements 0.01 to 1.4 ms. (4) Office size on the test copy 258 rows, 60 KB JSON; sample task doc 378 B; chats.list 11.2 KB gzip for 23 rows; message 605 B raw; users.list 14.6 KB. (5) Latency from the Mac: Pages /mcp 401 0.51 to 0.77 s, Pages /api/health 0.48 to 0.63 s, direct mcp function 0.83 to 0.97 s (region hop), api health 0.36 to 0.44 s, session.get 0.38 to 0.46 s five times in a row (no warm gain). (6) Baseline build sizes gzip: maplibre 281 KB, map worker 144 KB, rtl plugin 43 KB, css 10 KB, emoji panel 93 KB. Report: /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/background.md

Not checked: No real browser run: a sign-in needs the password typed into a tool call, so heap growth over hours, idle traffic of an open tab, hidden-tab socket drops (BG-4) and jank from the avatar glow or a 200-message chat DOM are read from code only. Production is untouched, so real egress, real avatar sizes, real Realtime message counts and the real number of presence flips are unknown: the owner should read Organization, Usage on Supabase (Egress, Realtime Messages, Edge Function calls) before choosing between BG-1, BG-2 and BG-3. The Free join-rate limit (BG-15) is from memory. The Worker, Durable Object and Supabase exit code was skipped. MCP and the IndexedDB prototype got short checks only (MCP via Pages is as fast as the API; prototype saves are debounced). Mail: the send path runs after the answer, only auth.* effects (invites, rare) run before; no deeper read. The Esri satellite route sets private max-age 86400 and uses one Pages Function call per tile; not measured against the 100,000 a day Pages limit.

### BG-1: Every tab switch flips the presence state at once, and each flip costs one Realtime message per listening tab

- Score 4 to 3, verdict weakened, fix safe True, effort S, risk low, behavior change True, regression False, confidence inferred
- Where: src/app/live/activity.ts:30-36,71-76; src/app/remote/presence.ts (setMine, trackNow); src/app/live/LiveProvider.tsx:46-49
- Evidence: deviceStateOf returns away the moment document.hidden is true, with no delay. setMine then calls channel.track, and Realtime sends one presence_diff to every tab joined on that topic. Measured on the test copy: 4 own flips = 8 frames to the own tab (2 each); the proof (proof.md 2060-2130) shows 1 frame per listening tab for each change. The cost model of the chat presence work assumes about 150 computer changes a day for the whole office and 20 listening screens, and already reaches 45 percent of the 2,000,000 free messages (0.85 to 0.92 million). Architects who swap between Revit/AutoCAD and the Madar tab many times a day are not in that model. Each extra 1,000 flips a day adds about 22 percent of the free quota (1,000 x 20 listeners x 22 days = 440,000).
- Impact: The whole office. If the real number of flips is 3 to 10 times the model, the free Realtime quota (2 million a month) runs out before the month ends. This is a risk to the free plan, not to speed. No cost shows on screen today.
- Fix: In useDeviceState (activity.ts) keep the Online to Away step 15 to 20 seconds late: start a timer when the page hides, cancel it if the page shows again, and send Away only if it fires. Online stays instant. A real visit of under 20 s then sends nothing. Add a test in activity.test.ts. Read the Supabase Usage page (Realtime messages per day) once before and after to confirm.
- Behavior note: A person who leaves the tab shows the Away dot for others about 15 to 20 seconds later. Online appears at once as before.
- Skeptic impact: Real but unmeasured. A 15 to 20 s delay only removes short hides; a long alt-tab still sends the same frames. Production used 15,878 of 2,000,000 messages before presence. Extra reason: Free plan allows 5 presence calls per client per 30 s (docs), and the adapter never retries a failed track.
- Skeptic fix note: The fix is a visible rule change (the owner rule 'Away at once', pinned by activity.test.ts:80), so the owner must agree. Read the Supabase Usage page after the release before any change.
- Skeptic evidence: Read activity.ts:17-20, presence.ts trackNow/setMine, proof.md 2150 cost model, TASKS.md:931 (15,878 used), Supabase Realtime limits page (presence calls per client per 30 s = 5, presence messages per second = 20).

### BG-2: Every API request, job run and typing signal starts with a full office load, and profile pictures sit inside that load

- Score 5 to 3, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence inferred
- Where: server/data/officeCache.ts:96-133 (OFFICE_ROWS_SQL, refresh); server/CLAUDE.md (one cold start per request); src/api/contract/entities.ts:224 (avatarUrl in the users doc); src/lib/picture.ts:10-11,98-110 (16 KB limit, quality 0.85 first); server/jobs/steps/triggers.ts:50-60; server/calls/typing.ts
- Evidence: pg_stat_statements on madar-test: the office load ran 62,570 times with 211 rows each, against 291,001 office_meta reads (21 percent of reads load everything). server/CLAUDE.md records that Supabase gives each request a new worker and none takes a second request, so the module cache does not help there. Test office = 258 rows, 60 KB; access-map.md puts a year office at 118 KB and says Supabase counts pooler bytes toward the 5 GB egress. users docs carry the picture as base64: about 6 to 12 KB each (up to 16 KB), so 15 people add roughly 100 to 240 KB to every cold load; users.list sends the same data to the browser. The 15-minute job pays one cold load per run (96 a day), and so does every chats.typing call (about 4 for each chat message), every push.mine call and every read of the push line.
- Impact: Egress and database time on the free plan. A year office is about 120 KB per cold load, 300 KB or more with pictures. At 5,000 calls a day that is 0.6 to 1.5 GB a day against a 5 GB monthly limit. This is a cross-dimension finding: check the real egress on the Supabase Usage page first. Latency is not hurt (a trivial call is 0.36 to 0.46 s and the load adds little).
- Fix: Take the picture out of the office rows: in OFFICE_ROWS_SQL select users.doc - 'avatarUrl' (and the sub_companies logo), then add the picture back only in the loaders of users.list and the calls that return it (session.get, subCompanies.list). Keep the shadow run and loaders.test.ts equal. Second step: let calls that need no office lists (chats.typing, push.mine) use a smaller read.
- Skeptic impact: Mechanism is real (a cold office load per request) but volume is lower: production had 212 cold starts on 2026-10-16 and about 422 calls a day, not 5,000. That is about 0.4 to 1.5 GB a month at 60 to 120 KB, rising with chats.typing calls. Not 0.6 to 1.5 GB a day.
- Skeptic fix note: Unsafe as written: the diff save writes the whole doc of a changed user (save.ts:15) and User requires avatarUrl (entities.ts:224), so a write from a snapshot without the picture would erase it or fail the parse. Safe form: a slim read-only copy for calls that never save (userCard already drops picture data, views.ts:25), or move the picture to its own column. Effort M to L.
- Skeptic evidence: Read officeCache.ts:96-175, runCall.ts, save.ts, entities.ts:212-224, views.ts:25, proof.md:964-968 (212 cold starts), access-map.md:332-337, chat presence design cost table (about 422 calls a day).

### BG-3: A hidden desktop tab keeps listening to 15 status topics for 30 minutes

- Score 3 to 3, verdict confirmed, fix safe True, effort M, risk low, behavior change False, regression False, confidence inferred
- Where: src/app/live/activity.ts:9-12,86-97 (REST_COMPUTER_MS 1,800,000); src/app/remote/presence.ts:197-205 (setResting)
- Evidence: A hidden computer tab is Away (tracked on its own topic) but still joins all 14 other status topics until it has been hidden 30 minutes. Every presence change of the office is then delivered to it, and nobody looks at it. When the tab shows again, connectChanges already reloads everything after 60 s hidden, and a join gives a new presence_state. The proof counts 20 listening screens; hiding after a few minutes was only costed for phones (60 s).
- Impact: About 60 percent of the status frames (0.86 million of the 1.2 million in the proof) go to screens that nobody sees. Saves roughly 0.2 to 0.4 million messages a month (10 to 20 percent of the free quota) if most tabs are hidden most of the time.
- Fix: After a hidden time of 3 to 5 minutes, leave only the 14 status topics of other people and keep the own topic tracked, so others still see Away. On show, join them again. A rejoin costs about 15 frames, so use a threshold above 5 minutes.
- Skeptic impact: Holds. A hidden tab listens to 14 status topics until 30 minutes. Break-even for a rejoin (about 15 frames) is about 5 minutes. The 0.2 to 0.4 million saving is an estimate.
- Skeptic fix note: Keep the own topic tracked so others still see Away. One small visible effect: after a return from 5 to 30 minutes the dots of others show Offline for a moment until the topics sync (design rule: an unsynced topic shows Offline). Say so to the owner.
- Skeptic evidence: Read activity.ts:9-12,86-97, presence.ts setResting/reconcile/wants, proof.md cost steps 1 to 3.

### BG-4: The Realtime client has no background-tab heartbeat setting

- Score 3 to 2, verdict weakened, fix safe False, effort S, risk medium, behavior change False, regression False, confidence inferred
- Where: src/app/remote/supabase.ts:7-11; node_modules/@supabase/realtime-js 2.117.2 (worker, heartbeatCallback); config/headers.template:19 (worker-src 'self')
- Evidence: createClient is called with auth options only. Supabase's own troubleshooting page (Realtime: handling silent disconnections in backgrounded applications) and realtime-js issue 121 say a hidden tab throttles the 25 s heartbeat timer, the server drops the socket after about 50 to 66 s without it (proof.md measured 49 to 66 s), and the fix is worker: true plus a heartbeatCallback that reconnects. Not reproduced here: a test needs a real hidden Chrome tab for more than 5 minutes.
- Impact: A person who works in another window for a long time may drop off Realtime (others see Offline instead of Away), then every channel (17) joins again and the lists reload when the tab shows. That adds presence frames and calls. Size unknown.
- Fix: First add heartbeatCallback: on 'disconnected' or 'timeout' call supabase.realtime.connect(), and reconnect on visibilitychange. Then test worker: true with a worker file served by the site (the default worker is a blob and worker-src 'self' blocks blob). A CSP change is a security rule, so ask the owner before it.
- Skeptic impact: Documented Supabase behavior but not reproduced. Effect is bounded: others see Offline instead of Away for a tab hidden 1 to 30 minutes, plus a rejoin. Lists already reload after 60 s hidden.
- Skeptic fix note: Step 1 (heartbeatCallback that reconnects) is safe. Step 2 (worker: true) needs a served worker file and a CSP change (worker-src 'self'): a security rule, ask the owner. Do step 1 alone first.
- Skeptic evidence: Read supabase.ts:7-11, realtime-js 2.117.2 RealtimeClient.js (no visibilitychange, HEARTBEAT_INTERVAL 25000, worker option), headers.template:19, signals.ts:326-335.

### BG-5: Any chat message, reaction or edit anywhere reloads the open chat (200 messages) and the chat list in every visible tab

- Score 3 to 3, verdict confirmed, fix safe False, effort L, risk medium, behavior change False, regression False, confidence inferred
- Where: src/app/readMap.ts:93-95 (chats.list, chats.messages are scope 'person' with the kind messages); src/app/signals.ts:affects(); src/features/inbox/earlier.ts:10 (EARLIER_PAGE 200)
- Evidence: affects() returns true for a person-scope read when the merged kinds hold messages, whatever the chat. Private chats send an anonymous office signal with kinds only, so all tabs get it. An open chat pane then reloads its newest page of 200 messages (605 B raw JSON each on the test copy, about 120 KB raw, 20 to 30 KB gzip by estimate) and chats.list (11.2 KB gzip for 23 rows; about 490 B a row, so 50 to 60 KB for a year office). The merge window is 1 s, so a busy chat is one batch call each second or two.
- Impact: Each person with the Inbox open: one batch call and 50 to 90 KB for every message of the office. About 100 chat events a day times a few open Inboxes is 0.5 to 1 GB of database egress a month by estimate.
- Fix: Let the open chat ask only for messages newer than the newest one it holds and merge them (the loader already supports 'after'); reload chats.list rows only for the chat named by the signal. For anonymous signals keep the full reload every few seconds at most. Needs the server input to accept after (additive).
- Skeptic impact: Holds: every message signal reloads chats.messages (200 messages) and chats.list in each visible tab that shows them, whatever the chat. Size is by estimate.
- Skeptic fix note: Unsafe as written: a read of only newer messages would miss reactions, edits, deletes and Seen changes on messages already held, and chats.messages has no 'after' input (only before and around, chats.ts:291-300). Safe form: name the chat in the person signal for its members so other open chats skip the reload (the anonymous office signal must stay anonymous, INT-16). Effort L.
- Skeptic evidence: Read signals.ts:75-87, readMap.ts:30 and 93-95 (messages is not a personal kind), earlier.ts, handlers/chats.ts:291-345.

### BG-6: Every project page with a pin loads the whole map library at once on the default tab

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence read
- Where: src/features/project/overview/ProjectPlace.tsx:11-35; src/features/project/overview/AboutPanel.tsx:72; src/features/map/MapCanvas.tsx:70-85 (loadMapLib)
- Evidence: The About panel is on the Overview tab, the default of /projects/:id. When the project has a pin, ProjectPlace mounts MapCanvas, which loads maplibre (281 KB gzip, 1.06 MB raw), the worker (144 KB gzip), the Arabic text plugin (43 KB gzip) and the css (10 KB) = 478 KB gzip, then starts a WebGL context and fetches tiles, in parallel with the project data. Sizes from the baseline build. After the first visit the files come from the cache.
- Impact: The first project page with a pin on a phone on 4G: about 0.5 MB more to download and about 1.5 MB of script to parse, competing with the project data, plus a hot GPU. Later visits only start WebGL and tiles.
- Fix: Load the map after the project data is on screen: start loadMapLib from requestIdleCallback or when the box is within 200 px of the view (IntersectionObserver), and keep the grey h-56 box. No tap needed, so the map looks the same.
- Skeptic impact: Sizes are right (maplibre 282 KB, worker 145 KB, rtl 44 KB, css 10 KB gzip, measured on the baseline). But the load starts after the project detail arrives (ProjectPlace needs detail), not in parallel with it, and the files are hashed and cached for a year. Cost is the first pinned project on a device.
- Skeptic fix note: Load at idle or when the box is near the view, keep the grey h-56 box. Looks the same.
- Skeptic evidence: Read ProjectPlace.tsx:11-35, MapCanvas.tsx loadMapLib and its effect (no gate), AboutPanel.tsx:72; gzip sizes of baseline-remote/assets.

### BG-7: The Files tab asks a link for every picture row and loads a 960 px picture for a 40 px square

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence read
- Where: src/features/project/files/FilesTab.tsx:38,63-65; src/features/dashboard/meeting/DrawingsStrip.tsx:15; src/app/thumbs.ts:1-3 (THUMB_EDGE 960)
- Evidence: FileRow calls useFileLink(..., 'thumb') on mount for each picture, with no near-view gate (PictureAttachments.tsx has one at 400 px). Each link is one files.link entry (12 to a batch; a Supabase Storage sign is an HTTP call, R2 is local). The small picture is up to 960 px WebP at quality 0.8 (typically 60 to 150 KB, by estimate) shown at 40 px. Chrome loads lazy images up to 1,250 px (2,500 px on slow networks) from the view, so most rows load.
- Impact: A project with 60 pictures: 5 batch calls and 4 to 8 MB of pictures to fill a list of small squares, on a phone. Storage egress too.
- Fix: Gate the link with the same useNearView as PictureAttachments (S, no visible change). Later, make a second 160 px picture at upload (M, needs a backfill for old files).
- Skeptic impact: The link call for every picture row is real. The img is lazy, so only rows within about 1,250 px load bytes: about 3 MB for a 60 picture project, not 4 to 8 MB. Files tab is not the default tab.
- Skeptic fix note: Gate the link with the near-view hook of PictureAttachments. No visible change.
- Skeptic evidence: Read FilesTab.tsx:34-66 (useFileLink at mount, loading=lazy on img), files.ts, thumbs.ts, supabaseStorage.ts presignGet (one HTTP sign each).

### BG-8: Every tab load calls push.mine, one more Edge Function call

- Score 2 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence read
- Where: src/app/remote/PushSync.tsx:21-26; src/app/remote/push.ts:198-214
- Evidence: syncThisDevice runs 3 s after each start. A device that already has a subscription always calls push.mine (read rule 'none', never cached) to compare the endpoint. That call also pays a cold office load (BG-2).
- Impact: One call (about 0.5 s of server time) for every tab load of every person with push on. With 40 to 100 loads a day that is 1,200 to 3,000 calls a month of the 500,000 free calls. Small.
- Fix: Store the verified endpoint with the user id and the time in localStorage (madar.pushOk.<id>) and skip push.mine for 24 hours when the endpoint is the same and keys exist. Clear it on sign-out and on turn off.
- Skeptic impact: True but tiny: production made about 13,000 calls a month, so 1,200 to 3,000 more is under 1 percent of the free 500,000.
- Skeptic fix note: A 24 hour skip delays the repair when the server removed the device (404 or 410 push answer) or the keys repair. Recommend no change.
- Skeptic evidence: Read PushSync.tsx:21-26, push.ts:198-214 syncThisDevice, server/push/CLAUDE.md path step 4, chat presence design cost note.

### BG-9: The typing signal adds a call at the end of each message, and every typing call is a full Edge Function call

- Score 2 to 1, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence inferred
- Where: src/app/live/typing.ts:121-165 (send, stop); server/calls/typing.ts:13-22
- Evidence: A typing true goes at once and every 5 s while the person types, and a typing false when the box clears (stop() on send). Each is its own batch call: token check, cold office load, typingRecipients, one realtime.send statement. About 4 calls for each chat message (1 start, 1 to 2 while typing, 1 stop). 70 messages a day gives about 280 calls a day, 8,000 a month (1.7 percent of the free calls).
- Impact: Small in calls; each one still loads the office (BG-2) and sends one Realtime frame for each other member.
- Fix: Do not send the stop call when the box clears because of a send: chats.send already tells the server. Let the server send the stop signal to the chat's other members in the same transaction as the message (or let the receiver drop the typist when the message arrives). The receiving board must drop the typist on a new message from that person.
- Skeptic impact: About 240 typing calls a day (4 per message): far under the free call limit. Each one does load the office (BG-2).
- Skeptic fix note: The board removes a typist only on a stop signal or after 8 s (typing.ts TYPING_SHOW_MS). Skipping the stop leaves the line up to 8 s, or about 1 s with a new receiver rule: a small visible change. Not worth one call in four.
- Skeptic evidence: Read typing.ts:1-60 and 121-165, calls/typing.ts.

### BG-10: The 15-minute job takes the office lock and reads all open tasks even when nothing is due

- Score 2 to 2, verdict weakened, fix safe True, effort M, risk low, behavior change False, regression False, confidence inferred
- Where: server/jobs/steps/triggers.ts:42-65; server/data/loaders/jobs.ts:14-24; src/api/notify.ts:186-231
- Evidence: Each run (96 a day, 731 runs in 7.5 days on madar-test, none failed) opens a write transaction, takes the office lock, loads the office (cold, BG-2), all open tasks of active projects and office tasks, the meetings of the next hour, then asks which dedupe keys exist and finds no new notice. The year-office pins record 708 trigger-loader rows and 750 dedupe rows a run (proof.md 1726). With about 400 B a task that is roughly 0.3 MB of tasks plus the office per run, 1 to 1.4 GB a month by estimate. The lock is held for the whole load, so a user's save in that window waits (lock_timeout 5 s). The other steps are tiny (0.01 to 1.4 ms each on the test copy). The TASKS.md proposal about the file size sum is moot (no usage step).
- Impact: A save that arrives during the load waits a few hundred ms. Database egress about 20 to 25 percent of the 5 GB limit by estimate.
- Fix: Do a read-only first pass with no lock: load the same rows in a read transaction, run runScheduledTriggers on a copy with the dedupe lookup, and take the lock only when it finds a notice (the second pass re-checks under the lock, so it stays exact). Optionally read only the picked task fields in the first pass (Select.pick).
- Skeptic impact: Code is as described, but the proposed read-only first pass cuts only the lock time (a few hundred ms every 15 minutes), not the egress. It reads the same rows. About 1 GB a month is a year-office estimate; today's office is much smaller.
- Skeptic fix note: Safe but does not cut egress. A real saving: in loadJobs add a SQL filter for tasks with a due date (notify.ts:197 skips tasks with none) and pick only the fields the triggers read (Select.pick).
- Skeptic evidence: Read triggers.ts:42-65, loaders/jobs.ts:14-24, notify.ts:186-231.

### BG-11: A wake from sleep reloads every visible list twice

- Score 2 to 1, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence read
- Where: src/app/signals.ts:300-322 (onVisibility), :270-290 (join origin); src/app/remote/channel.ts:130-146
- Evidence: After more than 60 s hidden, onVisibility runs invalidateQueries for all active reads at once. A socket that died during sleep then takes up to one heartbeat (25 s) to notice, rejoins its channels, and each join tells an empty list with origin 'join', which reloads everything again. invalidateQueries cancels and restarts the load of a read that is still in flight, otherwise it loads twice.
- Impact: Two batches of 8 to 15 reads for each wake of a laptop or phone, 5 to 10 wakes a day for each person. Roughly 100 to 300 KB twice. The second reload is needed (signals may be lost) but could be cheap.
- Fix: When the socket status is closed at wake, skip the first reload and let the join do it (with a 3 s fallback timer). When it is open, keep the first reload and treat a join in the next 60 s as already covered only if no signal gap was seen. Needs care: do not lose a change made while the socket was down.
- Skeptic impact: The second reload happens only when the socket died while the tab was hidden or asleep. Usually one reload runs. invalidateQueries cancels an in-flight refetch by default, so the passes often merge.
- Skeptic fix note: The join reload is needed: signals can be lost until the rejoin. Skipping it risks a lost change. Leave as is.
- Skeptic evidence: Read signals.ts:196-254 and 300-335, channel.ts join origin.

### BG-12: Signed picture links change at every renewal, so the browser downloads the same picture again

- Score 2 to 2, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence read
- Where: src/app/files.ts:19,50-60 (LINK_STALE_MS 8 min); server/files/supabaseStorage.ts:110-118 (presignGet); public/sw.js (no fetch handler)
- Evidence: Each files.link call signs a new token, so the picture URL is new. A chat or list that opens again after 8 minutes asks a new link and the browser loads the picture again. A confirmed file version never changes (server/files/CLAUDE.md), and the object path inside the URL is stable.
- Impact: Anyone who goes back to a chat or Files tab with pictures after more than 8 minutes pays the picture bytes again (60 to 150 KB each). Storage or R2 egress, and 4G time on a phone.
- Fix: Add a fetch handler to sw.js that caches picture responses (Cache API) under the object path without the query, for the file store hosts only, and clear it at sign-out. Needs a CSP/worker review, so ask the owner. Cheaper: gate links (BG-7).
- Skeptic impact: True that each sign gives a new URL and the picture loads again after 8 minutes. Cost is the visible pictures of one chat or tab per return after 8 minutes.
- Skeptic fix note: A service worker cache would store private pictures on the device (shared browser, sign-out): a security surface, needs the owner. Gating links (BG-7) is the safe part.
- Skeptic evidence: Read files.ts:19, supabaseStorage.ts:107-114, public/sw.js (listeners: install, activate, push, notificationclick only).

### BG-13: Report screenshots still load at full size for an 80 px thumbnail

- Score 1 to 1, verdict confirmed, fix safe True, effort M, risk low, behavior change False, regression False, confidence read
- Where: server/calls/feedback.ts:42 (thumbKey: null); src/features/settings/admin/FeedbackSection.tsx:22-50; TASKS.md:254
- Evidence: Still open from the 2026-10-07 audit: reports store the original (up to 10 MB), the screen requests a link and loads the original in a 80 px box (lazy only).
- Impact: Only the Admin or a holder of feedback.manage, a few times a week. Each screenshot is 0.5 to 3 MB, more on a retina screen; a list of 20 reports can load tens of MB.
- Fix: Make the 960 px small picture at report time (feedbackAdapter can call makeThumb as files.upload does) and use variant 'thumb' for the list.
- Skeptic impact: Holds. Admin or feedback.manage only, a few times a week. Still open in TASKS.md:254.
- Skeptic fix note: Make the 960 px picture at report time and use the thumb variant in the list.
- Skeptic evidence: Read calls/feedback.ts:42 (thumbKey null), FeedbackSection.tsx:41, TASKS.md:254.

### BG-14: A draft is written to localStorage on every key press

- Score 1 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence read
- Where: src/app/drafts.ts:70-76 (useDraftText, writeDraft)
- Evidence: set() calls window.localStorage.setItem for each change of the box. localStorage writes are synchronous on the main thread.
- Impact: A fraction of a millisecond on a computer; a few ms on a weak phone while typing in the chat box. Small.
- Fix: Write after 300 ms of quiet and on unmount, visibilitychange and pagehide; keep the in-memory text immediate.
- Skeptic impact: A write per key press costs well under 1 ms for chat text.
- Skeptic fix note: A delayed write could bring back a draft after sign-out that keepDraftsOf just removed. The gain is too small for that risk.
- Skeptic evidence: Read drafts.ts:28-34, 70-76 and keepDraftsOf.

### BG-15: Fifteen tabs that reload together send 255 channel joins at once

- Score 1 to 1, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence inferred
- Where: src/app/remote/presence.ts:179-195 (joinMissing); src/app/remote/channel.ts (REJOIN_MS)
- Evidence: Each tab joins 17 private channels in one pass, and each join runs realtime.authorize (2.08 ms mean, 20,599 calls on madar-test, max 686 ms). A release that forces a reload (client_outdated) or a Realtime restart makes all tabs join in the same seconds. The free plan limit for joins a second is 100 (from memory of the Supabase limits page; not checked here). The code already retries with 1, 2, 5, 10, 30 s.
- Impact: A short burst of failed joins and Offline dots after a release or an outage, then recovery. Rare.
- Fix: Join the status topics in groups of 5 with 200 ms between, and add random jitter to REJOIN_MS.
- Skeptic impact: Limit verified: 100 joins a second on Free. A 255 join burst needs all 15 tabs to join in one second: a Realtime restart, not a normal release. Rare.
- Skeptic fix note: Random jitter on REJOIN_MS is safe. Grouping joins adds a small delay to the first status dots.
- Skeptic evidence: Read presence.ts:179-195, channel.ts REJOIN_MS, Supabase Realtime limits page (channel joins per second 100).

### BG-16: The push line is built with the heavy chat and notice lists, once for every recipient and one after the other

- Score 2 to 2, verdict confirmed, fix safe True, effort M, risk medium, behavior change False, regression False, confidence read
- Where: server/push/line.ts:36-110 (chatLine, noticeLine); server/push/notify.ts:200-215; server/core/effects.ts:136-166 (processOutbox)
- Evidence: For each recipient chatLine runs session.get and chats.list as that person (all chats, the previews, up to 100 task threads), and noticeLine runs session.get and notifications.list. The rows of one save run one after the other (claim, work, done). chats.list on the test copy is 11.2 KB gzip for 23 rows and about 120 ms more than session.get. The push itself waits 10 s for chat items and runs after the answer, so no screen waits.
- Impact: Database time and egress after every message and notice: a group message to 5 people runs 10 reads of the full lists. About 175 recipient pushes a day by estimate, 10 to 50 KB each. Small to medium.
- Fix: Read one chat row instead of the whole list (a chats.list input with the id, or a narrow read), and send the pushes of one save in parallel with Promise.all in groups of 4.
- Skeptic impact: Holds. Each recipient gets session.get and chats.list as that person, one after the other, after the answer. Small egress, no screen waits.
- Skeptic fix note: Parallel runs only with a cap of 3 or 4 (pooler clients, EMAXCONN note in server/CLAUDE.md). A single-chat read needs a new additive input, a loader and shadow tests (medium).
- Skeptic evidence: Read push/line.ts:36-117, push/notify.ts:185-235, server/push/CLAUDE.md path section.

## Live numbers (test copy)

Measurements: Test copy only, from a Mac in Jeddah, Chromium via Playwright (CDP network, websocket frames, PerformanceObserver), 4 rounds per role cold and warm, 3 rounds per role for screens, 5 rounds for chat and task save, 3 context test with a third idle person, mobile Pixel 5 with 4G 150 ms/1.6 Mbps/750 Kbps and CPU x4 (5 runs; 2 more runs with the fonts aborted). Cold desktop median (member / admin): TTFB 352 / 313 ms, FCP 964 / 1,078, LCP 2,242 / 2,174, first batch answer 1,788 / 1,936, first rows 2,038 / 2,025, 115 requests, 3 OPTIONS, 7 batches, 1.25 MB wire (scripts 900 KB, fonts 298 KB, api 28-35 KB). Warm: FCP 220 / 188, first rows 820 / 813, 8 network requests, 0 OPTIONS, 0 assets, document 304. 2026-10-08 comparison: TTFB 69, FCP 636-680, LCP 1,732-1,888, first batch 1,588-1,720, scripts 557 KB, fonts 353 KB; the TTFB gap is the route of this Mac (TLS 160-230 ms to the Cloudflare Marseille edge). Edge floor about 270 ms (health 268-345). Screens warm click to data 64 ms (cached) to 950 ms (map). Task save blur to answer 714 ms (649-1,045). Chat to the other screen 2,175 ms (2,030-2,445). Idle tab 4 websocket frames a minute, 0 API calls; 24 channels; join 83 frames 30 KB. Mobile cold: FCP 4,960, LCP 6,296, first rows 6,172, TBT 160 ms, 4 long tasks max 113 ms; fonts aborted: FCP 3,524, first rows 4,282. Sign-in page signed out: mobile FCP 4.6-4.8 s, desktop 0.88 s, 98 scripts. Heap 10.5 MB after load, 15.4 after 10 screens, 16.4 after 30, 16.5 after 5 idle minutes, nodes and listeners flat. About 505 API calls used (file api-count.json). Full report: /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/live.md, raw JSON in /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/live/.

Not checked: Lighthouse: the chrome-devtools lighthouse_audit tool excludes the performance category, so I measured the sign-in page with my own throttled Playwright run (FCP and LCP) and did not get a Lighthouse score. A real phone, Safari and Firefox (preflight cache length, websocket behavior) were not tested. The server side time inside each Edge call was not split (no Server-Timing header); only the client view and the 270 ms floor were measured. I did not apply or test any fix, so the gains in the fixes are estimates except the font abort test. The idle-chunk abort experiment (LV-5) failed to finish (the app reloaded on a missing chunk), so its effect on first data is not measured. Admin-only screens other than Admin were not split from the member run. I did not measure a 15-person load, only 3 tabs, so the monthly call and message counts are estimates from per-event numbers. Task and chat undo: the test messages in cnv_013 were left in place; the task title was restored. The Settings Google Calendar and Push sections were not opened.

### LV-1: The 3 preloaded Thmanyah fonts (299 KB) delay JS and first data by about 1.9 s on 4G

- Score 4 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change True, regression False, confidence measured
- Where: vite.config.ts:51-55 (earlyLinks font preload), src/design/tokens.css:194-214
- Evidence: Mobile cold load (Pixel 5, 150 ms, 1.6 Mbps, CPU x4, 5 runs): FCP 4,960 ms, LCP 6,296, first rows 6,172, first batch answer 5,694, 1.25 MB. With the .otf requests aborted (2 runs): FCP 3,524, LCP 4,640, first rows 4,282, first batch 3,983, 0.96 MB. The fonts (298 KB) share the pipe with 384 KB of preloaded JS, and the SPA paints nothing until the JS runs.
- Impact: Every phone on a first visit or after a release that changes the font hash: first data 1.9 s later, FCP 1.4 s later. Warm visits read the fonts from disk, so they do not feel it.
- Fix: Keep the preload only for Thmanyah Regular, or drop all three preloads (the files load when text needs them; font-display swap stays). Or add fetchpriority=low. Do not change the font files (licence).
- Behavior note: On a first visit a person may see the fallback font (Inter / IBM Plex) for a moment before Thmanyah swaps in. Warm visits are the same as today.
- Skeptic impact: Real on a first visit of a new device or a cleared cache only. The font hash never changes (licence forbids edits) and the files are immutable for a year, so a release does not bring the cost back. The aborted-font test is an upper bound because the fonts still load after first paint.
- Skeptic fix note: The fix is a visible change (fallback font flash on a first visit), already flagged by the finding. Safe form: preload only Regular, or add fetchpriority low, and measure with delayed fonts instead of aborted fonts.
- Skeptic evidence: Read vite.config.ts:51-55, tokens.css font-face, config/headers.template (/assets/* immutable). Font files are fixed by licence, so their hashed names stay the same.

### LV-2: One save runs 3 batches: the echo of the own write defeats the FET-3 skip

- Score 5 to 3, verdict weakened, fix safe True, effort M, risk medium, behavior change False, regression True, confidence measured
- Where: src/app/signals.ts:296-315 (take, mixed, owns, freshOf), src/app/runtime.tsx:211-235 (writeWithReads)
- Evidence: Task title save, 6 of 6 rounds: batch 1 = tasks.update + 7 reads (6.0 KB gzip, 25 KB raw), answer at 649-1,045 ms; batch 2 (chats.unreadCount, notifications.count, tasks.list) and batch 3 (tasks.list, projects.get, tasks.get, files.list, tasks.list) start 3 to 8 ms after the answer and load the same 8 reads again (2.3 KB + 5.7 KB gzip). A chat send shows the same duplicate (chats.unreadCount, chats.list, chats.messages) in 3 of 5 rounds. The Realtime signal of the own write arrives at about 600 ms, before the answer (650 to 1,000 ms) because the server runs the follow reads first. It is queued as origin channel, so the pass is mixed and freshOf returns undefined.
- Impact: Every save by every person: 2 extra Edge calls, 2.4x the bytes (14 KB instead of 6 KB gzip) and 2.4x the database reads, and the screen re-renders twice. Roughly 600 extra calls a day office wide (inferred, 300 saves a day).
- Fix: In connectChanges, when the own answer carries signals whose ids are all in the pending merge (taken from the channel first), clear mixed so freshOf skips the fresh reads. Also keep the ids of own answers for a few seconds so an echo that comes later is dropped (take already does this). Add a test with the channel signal before the own answer.
- Skeptic impact: Real and measured (6 of 6 rounds, 3 batches), a regression of FET-3. But the extra passes return the same data, so no visible delay. Cost is 2 extra Edge calls and about 8 KB gzip per save, about 3 to 4 percent of the free calls at 300 saves a day.
- Skeptic fix note: Safe only with care: keep the ids of the channel signals that set mixed, remove the ids that the own answer names, and keep mixed true for a seq gap, an empty-list signal (join), or any id the own answer does not name. Add a test with the channel signal before the own answer.
- Skeptic evidence: Read signals.ts:186-315 (take, owns, mixed, freshOf, subscribe) and remoteApi.ts:241-252. Re-read d-task.json: each of 6 rounds shows batch 2 and 3 starting 1 to 3 ms after the answer with the same reads.

### LV-3: A change by another person waits a 1 s merge window: chat shows on the other screen after 2.2 s

- Score 4 to 3, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/app/signals.ts:186-187 and 255-257 (mergeMs 1000, maxMergeMs 2000)
- Evidence: Member presses Enter, admin sees the text at 2,175 ms (2,030-2,445, 5 rounds + 3 more). The send answer comes at 500-850 ms. The changed signal reaches the admin tab and a third idle tab at 570-640 ms (websocket frame times). The reload call starts at 1,570-1,750 ms, then takes 400-550 ms. So about 1 s is the merge timer.
- Impact: Every change made by a colleague (chat, to-do, comment) shows 1 s late on every other open tab. Chat feels slow: 2.2 s from press to reply on screen.
- Fix: Fire at once (after about 100 to 150 ms to catch the twin office and person signals) for the first signal after a quiet period, then keep the 1 s trailing merge for the rest of a burst. Keep maxMergeMs.
- Skeptic impact: The 1 s merge window is the written plan 5.3 design to save calls (signals.ts header). Chat at 2.2 s is real. The fix costs calls: a burst gets a leading pass and a trailing pass, and chat talk comes in bursts.
- Skeptic fix note: Behavior and data stay the same, but quota use rises. Safer form: a short window (about 150 ms) only when the signal names the kind messages and the Inbox is open. Keep 1 s for the rest.
- Skeptic evidence: Read signals.ts:186-187 and 255-262 (schedule, mergeMs 1000, maxMergeMs 2000) and the file header comment that states the 1 second merge on purpose.

### LV-4: A chat message costs about 21 Edge calls: own markRead after own send, duplicate reads, and every open tab reloads chats.unreadCount

- Score 4 to 2, verdict weakened, fix safe True, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/features/inbox/ConversationPane.tsx:211-227 (behind, seenBehind), server signal for chats with no project (anonymous office signal), src/app/readMap.ts
- Evidence: One message in a direct chat (cnv_013), 8 runs: sender sends chats.typing (1), chats.send + 3 reads (1), the same 3 reads again (1, in 3 of 5 runs), chats.markRead + 4 reads (1, because the own newest message is newer than readUpTo), 3 reads again after the receiver's seen signal (1) = 4 to 5 batches. Receiver: 3 reads, markRead + 4 reads, 3 reads again = 3 batches. A third idle person on Home (management) sends chats.unreadCount once per message (8 of 8). A 15 person office with all tabs open would add 13 more calls.
- Impact: About 21 Edge calls for one message (3 are needed). With 60 messages a day (15,000 a year) that is about 1,300 calls a day, 28,000 a month, 5 to 6 percent of the 500,000 free calls, and a write transaction plus signals for each markRead.
- Fix: Do not count the person's own newest message in behind and seenBehind (or let chats.send advance the sender's readUpTo in the same transaction). Together with LV-2 this removes 3 of the sender's batches. For the idle tabs, a signal with kind messages of a chat that the person is not in and that is not in the unread list can skip the unreadCount reload (the server names the people in a private-kind signal).
- Skeptic impact: The 21 calls figure mostly counts the idle tabs (13, a server signal change, same as DF-2), the LV-2 duplicate, and by-design reads and typing. The part fixable on the client is the sender's own markRead, 1 batch (a write and 4 reads) for each message sent, about 60 batches a day.
- Skeptic fix note: The cause in the finding is partly wrong: chats.send already calls markReadNow (handlers/chats.ts:389), so readUpTo is current and behind is false. The markRead comes from seenBehind (ConversationPane.tsx:214-219). Exclude the own newest message from seenBehind only. Edge case: a sender who sends while an older message of the other person is still in flight no longer marks it seen too early (more exact).
- Skeptic evidence: Read ConversationPane.tsx:190-227, handlers/chats.ts:224-240 and 370-390, and the markRead handler at 425-445.

### LV-5: Every cold load, also the signed-out sign-in page, downloads all 98 script chunks (900 KB gzip, 2.7 MB raw)

- Score 3 to 2, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression True, confidence measured
- Where: src/main.tsx (prefetchScreens at idle, loadWords of the other language), src/app/screens.ts:126-136
- Evidence: Cold Home: 98 scripts, 900 KB gzip on the wire (first load is 50 files, 384 KB). Idle chunks include DashboardScreen 94 KB gzip, OpenSpaceScreen 61, AdminScreen 32, words.ar 49 (for an English person), MeetingView 18, plus SignIn, Welcome, Forgot, Reset and Consent for a signed-in person. They start 735 ms after the document (4,845 ms on mobile). Sign-in page signed out: 98 scripts, 1.21 MB total, mobile FCP 4.6 to 4.8 s. Mobile total bytes 1.25 MB.
- Impact: About 500 KB more than needed on every first visit: mobile data, battery and radio time. The idle downloads share the pipe with the first API answers on a slow link (first batch took 1.0 s on mobile although the server part is the same as desktop).
- Fix: Prefetch only the likely next screens (Projects, Tasks, Inbox, Project) and fetch the rest on pointerdown or hover of the tab. Skip the prefetch on the sign-in screens, when navigator.connection.saveData is on, or when effectiveType is 2g or 3g. Load the other language only when the person switches (or at the first press in Settings).
- Behavior note: A screen that was not prefetched shows its first frame one chunk later (about 100 to 200 ms) unless a pointerdown or hover prefetch starts it.
- Skeptic impact: Real (main.tsx:85-87, screens.ts:126-136) but only on a cold cache, since chunks are hashed and cached. It is on purpose: a release that removes old chunks finds them in memory. Mobile first batch took 0.73 s from POST against 0.84 s on desktop, so no sign that it slows the first answer.
- Skeptic fix note: Do not drop the prefetch of the common screens: it protects open tabs across a release. Safe form: skip on saveData and on the sign-in screens, and fetch Dashboard, Open Space and Admin on pointerdown.
- Skeptic evidence: Read main.tsx:55-90 and screens.ts:59-136 (comment on release protection).

### LV-6: Three parallel CORS preflights block the first batches for 300 to 500 ms and cost 3 Edge calls on each cold load

- Score 3 to 2, verdict weakened, fix safe False, effort M, risk medium, behavior change False, regression False, confidence measured
- Where: src/api/remote (cross-origin POST to https://<ref>.supabase.co/functions/v1/api/batch), server/http/cors.ts
- Evidence: Every cold load: 3 OPTIONS start at 947 ms with the 3 first POSTs, answer at 1,255 / 1,310 / 1,453 ms (each runs a cold Deno function: x-deno-execution-id present, 257-316 ms wait); the POST answers come at 1,725-1,987 ms. Warm load (preflight cached): 0 OPTIONS and first batch answer at 528-705 ms. Chrome caches 2 h; Safari and iPhone keep it a much shorter time (inferred).
- Impact: First data after a cold start of a tab (first visit of the day, a new profile, and every return on an iPhone after the short cache ends): about 300 to 450 ms later. 3 of 10 Edge calls of a cold load are preflights.
- Fix: Remove the preflight from the critical path: the same-origin /api Pages Function (removed after FET-10 because it was not faster over a session; measure the cold start again), or send the 3 first reads as one batch so only 1 preflight runs. Do not move the token from the header to the body (security rule).
- Skeptic impact: Not 3 billed Edge calls: Supabase does not bill OPTIONS (platform-facts.md line 110). The 3 preflights run in parallel, so they cost one round trip (about 300 ms) on a cold tab. They existed on 2026-10-08, and the forwarder fix was measured and removed (FET-10, proof.md line 1256). Max-Age is 7200.
- Skeptic fix note: The only real fix is the same-origin forwarder that was measured as not faster over a session. Needs a new measure, and a real iPhone test for the Safari cache.
- Skeptic evidence: Read server/http/cors.ts (CORS_MAX_AGE 7200), platform-facts.md:110, proof.md:1255-1258.

### LV-7: The first API call waits for the words file and the render; the first load is a serial chain

- Score 3 to 2, verdict weakened, fix safe True, effort M, risk low, behavior change False, regression False, confidence measured
- Where: src/main.tsx:60-80, src/i18n/firstWords.ts, vite.config.ts (earlyLinks)
- Evidence: Cold desktop timeline: document 376 ms, scripts done 730, words.en fetched 735 to 906 (it starts only when the entry module runs, after vendor 598 KB is loaded), first POST at 947, first rows at 2,036. Mobile: scripts done 4.2 to 4.8 s, first POST at 4.96 s. Home's meetings.list is a fourth serial batch (1,904 to 2,351 ms) after the rows.
- Impact: About 170 ms on desktop and about 350 ms on 4G on every cold load (first load of the day, after a release).
- Fix: Start the words load and the Home reads (the role-hint reads) from a tiny entry that has no static imports, or modulepreload the words file of the saved language (a small external classic script may add the link, the CSP blocks inline). Put the Home meetings.list in the first request.
- Skeptic impact: BND-7 already starts the words with the first script. What is left is the overlap of the words fetch with the script fetch: about 170 ms on a cold desktop load only. The Home meetings.list step is DF-6 (the card draws nothing on a day with no meeting).
- Skeptic fix note: A link to the words file needs a small external script or a build step, and the CSP blocks inline script. Effort is more than S.
- Skeptic evidence: Read main.tsx:55-88 and i18n/firstWords.ts.

### LV-8: The first Realtime join reloads every read of the first load again (3 duplicate batches)

- Score 3 to 2, verdict weakened, fix safe False, effort M, risk medium, behavior change True, regression False, confidence measured
- Where: src/app/signals.ts:290-300 (join, joinMs 100), src/app/remote/channel.ts:112-124
- Evidence: Cold Home, 8 of 8 loads: at 2,977 ms (1 s after the rows) 3 more batches repeat all 7 calls of the first load (users.list, session.get, subCompanies.list, chats.unreadCount, notifications.count, tasks.list mine, tasks.list review, projects.list, meetings.list): 5.1 + 1.7 + 6.2 KB gzip, 56 KB raw, 3 Edge calls. Warm load: one 6-call batch waited 1,055 ms. The same pass runs again after every rejoin (laptop wake, network change, token end).
- Impact: 3 of the 7 batches of a cold load, and of every wake, are repeats. About 3 calls and 13 KB gzip each time, a re-render, and a busy main thread on phones. Roughly 3,000 to 6,000 calls a month office wide (inferred).
- Fix: On the first join, reload only the reads whose request started before the channel was subscribed and ended more than a few seconds before, or ask the server for the kinds changed since the oldest read (new additive call) and reload only those. Open the socket in parallel with the first batch so the window gets short.
- Behavior note: A change saved in the 1 to 3 s window between the read and the subscription would show only at the next signal or reload, unless the server call is added.
- Skeptic impact: Same as DF-3 of the dataflow audit. 3 Edge calls per cold load and per rejoin, about 1 to 2 percent of the quota. The repeat returns the same data, so nothing re-renders.
- Skeptic fix note: The join pass is the guard for a change saved between the first read and the subscription. The proposed skip rule keeps that gap open, and the finding already says behaviorChange true. A safe form needs a server call 'kinds changed since' (a contract addition).
- Skeptic evidence: Read signals.ts:290-300 (join, joinMs) and dataflow.md DF-3 text with its jsdom measure (same size repeat).

### LV-9: Every tab press waits one full Edge trip (450 to 650 ms); only 4 screens show cached data first

- Score 3 to 2, verdict weakened, fix safe True, effort M, risk low, behavior change False, regression False, confidence measured
- Where: src/app/prefetch.ts (usePrefetchCall only on project rows), src/app/nav.ts, src/app/AppShell.tsx
- Evidence: Warm click to data, median: Projects 565 ms (2 batches, 24 KB), project page 600, Inbox 500, chat 483, Dashboard 549, Meetings 515-646, Notifications 483-548, task panel 582-664 (all reads 977-1,076; one admin outlier 2,148). Tasks, Open space, Settings and Admin show at 64 ms from cache. The Edge floor is about 270 ms (health 268-345 ms) plus 100 to 250 ms of work.
- Impact: Every screen change for everyone, all day: half a second of wait on each.
- Fix: Start the main read of a tab on pointerdown or hover of its link (usePrefetchCall), as the project rows do. Fold Projects into one batch. Fewer round trips is the only code lever: the floor is the Edge start.
- Skeptic impact: createQueryClient gives every api read staleTime Infinity and gcTime of one hour (runtime.tsx:53). A screen opened before shows from the cache at once. The 450 to 650 ms is the first open of each screen in a session. Pointerdown prefetch saves only the press time, about 50 to 150 ms.
- Skeptic fix note: Use pointerdown, not hover: hover would add calls for tabs that are never opened (quota).
- Skeptic evidence: Read runtime.tsx:47-58 and prefetch.ts. src/CLAUDE.md says an unseen answer stays for an hour.

### LV-10: Map code loads on the click: Dashboard Map tab takes 950 ms, project page map 730 to 1,270 ms

- Score 2 to 2, verdict confirmed, fix safe True, effort S, risk low, behavior change False, regression False, confidence measured
- Where: src/features/map/MapCanvas.tsx (lazy loader), src/features/dashboard/DashboardMap.tsx, src/features/project/overview/ProjectPlace.tsx
- Evidence: Dashboard Map tab click to pins: 893-1,316 ms (member), 960-977 (admin) while the API answers in 440-510 ms; the click loads maplibre-gl 284 KB gzip (1.06 MB raw), its css 12 KB, the worker and the rtl plugin. Project page map canvas appears at 730-1,267 ms.
- Impact: The first map view of a session waits about 500 ms more than the data. A phone on 4G waits for 296 KB.
- Fix: Start the import of MapCanvas (not its tiles) on hover or pointerdown of the Map tab, and when a project page with a pin starts; keep it out of the first load.
- Skeptic impact: Holds, with a note: part of the 893 to 1,316 ms is the map start and the tile style, which a chunk prefetch does not remove. Only the first map view of a session pays the chunk.
- Skeptic fix note: Start the import on pointerdown or hover of the Map tab. Never put it in the idle prefetch (284 KB gzip).
- Skeptic evidence: Read the lazy imports in DashboardMap.tsx:19, ProjectPlace.tsx:7, PinPicker.tsx:14 and MapCanvas.tsx:79-84.

### LV-11: The first project page loads the full Inter Latin font (74 KB)

- Score 2 to 1, verdict weakened, fix safe True, effort S, risk low, behavior change False, regression False, confidence inferred
- Where: src/main.tsx (@fontsource-variable/inter/opsz.css), src/design/tokens.css font stacks
- Evidence: Click on a project from the list: a new request /assets/inter-latin-opsz-normal-BwkfbSeq.woff2, 73,949 B, in the first of 3 rounds (member). The digits already use a 10 KB subset.
- Impact: 74 KB on the first project page of a session (more on 4G), unless the cache has it.
- Fix: Find the text that falls back to Inter on the project page (a glyph that Thmanyah lacks) and map it to the Madar Digits subset, or add the glyph to the subset (an Inter subset is allowed, only Thmanyah files are protected).
- Skeptic impact: 74 KB once per device, then cached. The cause is found: U+00B2 (the square sign in m2) is the only glyph in the project words and screens that Thmanyah lacks (checked with fontTools).
- Skeptic fix note: Add U+00B2 to the Madar Digits subset (inter-digits-dot.woff2, an Inter file, so a subset is allowed). Check that the glyph looks the same as the Inter variable glyph today.
- Skeptic evidence: Ran fontTools on the three .otf files against the characters of src/features/project, src/i18n/real and src/i18n/*.json. Only U+00B2 is missing. Read tokens.css font stack.

### LV-12: Each tab joins 24 Realtime channels and gets a presence_diff for every state flip of every person

- Score 2 to 1, verdict weakened, fix safe True, effort M, risk low, behavior change False, regression False, confidence inferred
- Where: src/app/remote/presence.ts:104-140 (one status:<id> topic for each active person), src/app/remote/channel.ts
- Evidence: Member tab: 24 phx_join (office, person, 22 status topics), 83 frames and 30 KB at the join, then only 4 frames a minute idle (2 heartbeats). A 5 minute idle with other tabs on the test copy: 33 presence_diff (5.8 KB). Typing and changed signals arrive at 490-640 ms.
- Impact: Small today. Each flip of Online, Away or Offline of one person sends one message to every tab (15 tabs: 15 messages). Estimate: 15 people x 30 flips x 15 tabs x 22 days = about 150,000 of 2,000,000 Realtime messages a month, plus the joins (inferred).
- Fix: Watch only the status topics of the people on the screen (the chat list, the open project team) and join the others on demand; the code already takes a list in watch(ids). Check the real count of watch() ids in the shell.
- Skeptic impact: Overlaps DF-8. The owner read the usage on 2026-10-21 and booked about 45 percent of the 2 million with the presence parts in, and decided that cost step 4 does not apply (TASKS.md:931). The 150,000 estimate is inside that.
- Skeptic fix note: A watch by screen shows the dots late (a behavior change), and MentionField in the composers needs a use count, not an Inbox only switch.
- Skeptic evidence: Read TASKS.md:925-934, LiveProvider.tsx:33 and src/CLAUDE.md section on who is here.

### LV-13: A missing asset URL gets the HTML page with the immutable one-year cache header

- Score 1 to 1, verdict weakened, fix safe False, effort S, risk low, behavior change False, regression False, confidence measured
- Where: config/headers.template (/assets/* rule), Cloudflare Pages SPA fallback
- Evidence: curl https://preview.madar-46r.pages.dev/assets/ returns 200, content-type text/html, 5,679 B, cache-control public, max-age=31536000, immutable.
- Impact: A tab left open across a release that asks for a removed chunk can cache index.html under that chunk URL for a year in that browser. The screenReload guard recovers once; rare.
- Fix: Make the Pages build keep the old chunks for one release, or send a 404 for /assets/* misses (a _redirects rule for /assets/* with 404). Do not change the cache of real files.
- Skeptic impact: The header is real (curl on the test copy: 200 text/html with immutable for /assets/nothing-abc123.js). But a removed chunk URL is not asked for again after the reload guard, so the bad copy sits under a URL that no page uses. No real harm.
- Skeptic fix note: A _redirects 404 rule or a 404.html can turn off the SPA fallback or hit real assets. Test on the preview copy first. Pages keeps no old chunks.
- Skeptic evidence: Ran curl -D on the test copy for /assets/nothing-abc123.js and /assets/. Read config/headers.template.

## Gaps found by the completeness critic

Measurements: Test copy only (preview.madar-46r.pages.dev, project qdgwpnesxppnqsaabqzd), Chrome via Playwright, CDP timings. GP-1: expired vs valid token, warm HTTP cache, 3 runs each: desktop first paint 236 vs 764 ms and rows 838 vs 1,332 ms; phone profile (Pixel 5, 150 ms, 1.6 Mbps down, 750 Kbps up, CPU x4) first paint 520 vs 1,048 ms and rows 1,303 vs 1,903 ms; auth preflight about 235 ms plus POST about 360 ms. Fix A/B with a patched bundle served from disk for the preview origin: desktop 520 -> 128 ms first paint, phone 824 -> 372 ms, rows 1,697 -> 1,428 ms. GP-2: switch press to flip 1,297 to 1,914 ms desktop (8 runs), 1,567 to 1,898 ms phone (6 runs), 11 to 22 ms with the patched bundle; to-do tick to row exit 1,576 and 1,887 ms; task panel comment 1,536 and 1,559 ms. GP-3: files.upload 0.98 to 1.39 s without a small picture, 1.46 to 1.57 s with one, read floor 0.37 to 0.42 s; four files 8.57 s serial vs 5.36 s with parallel prepare. GP-4: two release pairs built and compared by chunk name and gzip size (32 of 100 chunks / 442 KB and 31 of 102 / 370 KB renamed); first-load part 87 and 72 KB; shell-chunk trial 277 and 205 KB. Also measured, no finding: sign-in submit to Home rows 1.5 to 2.0 s desktop; tab return after 65 s hidden costs nothing extra (supabase-js renews in the background, first batch 0.5 to 0.7 s); Realtime token renewal = 24 access_token frames and 2 auth requests per tab every 15 minutes, 0 API calls; satellite 30 tiles 1.5 s median cold then 0.2 to 0.3 s, 15 to 22 KB a tile; thumbnail maker 122 ms for a 4032x3024 photo; one change signal costs 5 to 55 ms of script on the phone profile; Home idle 23 ms/s of main thread vs 4 to 9 ms/s on other screens (supports RN-13); project tabs, Search, Meeting view, Admin and Settings 0 to 8 calls and 0 to 85 KB each. Report: /private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/gaps.md

Not checked: A real phone, Safari, Firefox and the iOS Home Screen app (Chrome with CDP throttling only). The invitation, reset and forgot flows (code read only; forgot and renew wait 1.5 s on purpose, a security rule). The MCP path with an agent token (none available; the code shows nothing beyond SV-15). Production egress and real profile picture sizes (GP-5, GP-6 are inferred). The lead picker, status menu, checklist tick, new to-do row and project post (same code pattern as GP-2, not measured). The Files tab with hundreds of files (files.list has no limit; a row is about 650 B plus 220 B per older version). The prototype build and dark mode. The GP-3 and GP-4 fixes were not built, only sized (GP-4 with a partial shell-chunk trial).

### GP-1: First paint waits for the token renewal when the 15-minute token has ended

- Score 4 to 3, verdict weakened, fix safe True, effort S, risk low, behavior change False
- Where: src/app/remote/auth.ts:45 (await supabase.auth.getSession() in createSupabaseAuth), src/app/remote/bootstrap.ts:215 (await createSupabaseAuth), src/main.tsx:64 (await Promise.all before createRoot().render)
- Evidence: The access token lives 15 minutes. An open after that waits for one CORS preflight (about 235 ms) and one refresh POST (about 360 ms) before the first render. Measured on the test copy, warm HTTP cache, 3 runs: desktop first paint 236 ms (valid token) vs 764 ms (ended), Home rows 838 vs 1,332 ms; phone profile (Pixel 5, 4G, CPU x4) first paint 520 vs 1,048 ms, rows 1,303 vs 1,903 ms. Tried a fix in a copy (read the stored session at once, run getSession in the background): bundle served from disk for the preview origin, real backend, 3 runs: desktop ended-token first paint 520 -> 128 ms, rows 1,074 -> 1,040 ms; phone first paint 824 -> 372 ms, rows 1,697 -> 1,428 ms; valid-token control unchanged.
- Impact: Every person, on every open after more than 15 minutes away (morning start, back from a meeting, phone relaunch, a few times a day): a blank screen for 0.5 s longer, and the data 0.5 to 0.6 s later. The fix gives back 0.4 to 0.45 s of first paint and about 0.3 s of data time on a phone.
- Fix: In createSupabaseAuth read the stored session from localStorage at once (SESSION_KEYS.supabase, refresh token present means signed_in) and call supabase.auth.getSession() without await; keep onAuthStateChange as the signal for a dead session. accessToken() keeps awaiting getSession, so the first batch still gets the new token. Add a test for a dead refresh token (shell shows briefly, then Sign in) and for blocked storage. Do not move the renewal to a same-origin route (saves about 200 ms but adds a hop and a surface). A longer token life is a security choice of the owner.
- Skeptic impact: Real on a fresh page load after 15 minutes. The fix gives a shell at about 0.13 s instead of 0.5 s. The data time barely moves (desktop 1,074 to 1,040 ms, phone about 0.27 s), because the first batch still waits for the new token.
- Skeptic fix note: Safe in the normal case. In the rare dead-session case the shell shows briefly before Sign in, so behaviorChange is not strictly false. Reuse hasStoredSession from authMode.ts, wrap storage reads in try/catch, and keep a test for a dead refresh token and for blocked storage.

### GP-2: A switch, a to-do tick and a task comment show their result 1.3 to 1.9 s after the press

- Score 4 to 3, verdict weakened, fix safe False, effort M, risk medium, behavior change True
- Where: src/features/project/tasks/TaskSheet.tsx:500 and 505-507 (Switch checked reads the server copy), src/features/project/tasks/TaskRowItem.tsx:91 (setTimeout 500 ms before complete.mutate), CommentThread/TaskComments in the task panel (no outbox), src/app/runtime.tsx:283-300 (useAction returns isPending and variables)
- Evidence: No optimistic state in src (grep finds none outside the drag order and the Inbox outbox). Test copy, press to visible result: flag switch desktop 1,297 / 1,349 / 1,377 / 1,386 / 1,438 / 1,453 / 1,481 / 1,566 / 1,914 ms, phone profile 1,567 to 1,898 ms (6 runs); to-do tick, row leaves the list 1,576 and 1,887 ms (500 ms of it is a fixed wait before the call; the write answer is back at about 1.07 s); comment in the task panel 1,536 and 1,559 ms (the Inbox shows its own bubble in 37 to 50 ms). For the switch the write answer is back at 0.67 to 0.80 s and the flip waits for the later batches (visible side of LV-2). Fix tried in a copy: checked={update.isPending && update.variables?.patch.flagged !== undefined ? update.variables.patch.flagged : task.flagged} on both switches: the switch moved in 11 to 22 ms (desktop 13, 13, 11, 12; phone 22, 17, 18, 14).
- Impact: Every person, many times a day: each quick control feels broken for over a second on an office line and about 1.7 s on a phone, and a second tap is likely. Fixing LV-2 alone would still leave about 0.8 s (fast line) to 1.2 s (phone).
- Fix: Show the pending value while the mutation runs and fall back to the server copy on error (isPending/variables of useAction), for the two switches, the lead and helper pick, the status menu and the checklist tick. In TaskRowItem send complete.mutate at once and let the 0.42 s tick animation run beside it. Give the task panel comment box the outbox that the Inbox already has (features/inbox/outbox.ts). Cover each control with a test of the failure path.
- Skeptic impact: The 1.4 to 1.7 s delay is real (re-measured). About 0.7 s of it is the visible cost of LV-2: batch 1 (write plus tasks.get) answers at 0.56 to 0.89 s, batch 2 starts 1 to 2 ms later and answers at 1.4 to 1.7 s, and the flip waits for batch 2 because the own-echo pass cancels the first fetch. The rest is by owner choice.
- Skeptic fix note: The optimistic display reverses the owner plan a of 2026-10-08 (TASKS.md line 310, commit 5ce55c53): no optimistic update. Ask the owner. The 500 ms tick wait is a designed animation. Safe part: fix LV-2 (drop only the channel ids that the own answer names), which should flip the switch at 0.6 to 0.9 s with no behavior change. Overlaps LV-2.

### GP-3: Each upload spends 1.0 to 1.6 s in files.upload, and several files go one after the other

- Score 3 to 2, verdict weakened, fix safe True, effort M, risk medium, behavior change False
- Where: server/calls/files.ts:143-144 (confirmUpload then confirmThumb, one after the other), server/files/confirm.ts:49-79 (head final, head staging, copy, head final, then the staging removal), server/files/effects.ts:61 (removeNowOrLater awaits the removal), src/features/project/files/FilesTab.tsx:145-148 and src/features/files/Attachments.tsx:94-120 (for ... await api.call('files.upload')), server/data/loaders/project.ts:71 (files.upload reads every file of the project)
- Evidence: Test copy, 250 to 300 KB files, Edge function from this Mac: files.uploadStart 0.23 to 0.43 s; PUT 0.38 to 0.83 s; files.upload 0.98 / 1.12 / 1.21 / 1.39 s without a small picture and 1.46 / 1.46 / 1.57 / 1.57 s with one; a users.list read takes 0.37 to 0.42 s. Four files one after the other: 8.57 s (start 1.65, put 2.07, finish 4.85). Four files with start and PUT in parallel, then the finishes in a row: 5.36 s (prepare phase 1.22 s). The finish step spends 0.6 to 1.2 s above the call floor in 4 to 8 store round trips.
- Impact: Anyone who uploads drawings, PDFs or site photos (Files tab, chat, task comments, meeting minutes): about 2 s of overhead per file on top of the transfer. A chat message with 3 photos waits about 7 s before it is saved; a set of 8 PDFs spends 13 s on overhead alone.
- Fix: Server: confirm the file and the small picture at the same time (about -0.3 to -0.5 s for a picture), look at the staging key first and at the final key only when staging is missing (retry case), remove the staging key after the answer, and read only the files of the same name in the loader. Client: start and PUT the files of a queue 3 at a time, keep the file id order and the Retry rule. Measured gain of the client part alone: 8.6 s -> 5.4 s for 4 files.
- Skeptic impact: The serial confirm code is real. The avoidable part for one file is about 0.3 to 0.6 s, since files.upload includes a 0.4 s call floor. The multi-file gain was measured on a desktop line and is smaller on a phone uplink, where PUTs share the bandwidth. Uploads are a few a day and mostly one file.
- Skeptic fix note: Safe if: the post-answer staging removal uses a background hook on both hosts (EdgeRuntime.waitUntil or ctx.waitUntil); a copied thumb is removed when confirmUpload throws while confirmThumb runs in parallel; the Retry rule (queue.slice(sent)) is rewritten for parallel starts; finishes stay in order.

### GP-4: Every release renames about 30 of 100 script files, so a person fetches 370 to 440 KB gzip again

- Score 2 to 1, verdict weakened, fix safe True, effort M, risk medium, behavior change False
- Where: vite.config.ts:86-98 (REMOTE_CHUNKS has only vendor and supabase), src/app/screenLoaders.ts (the table of dynamic imports sits in the entry chunk), src/whatsNew/entries.ts (in the entry chunk, edited by every release)
- Evidence: Lazy screens import the entry chunk (from"./index-<hash>.js" in DashboardScreen, OpenSpaceScreen, ProjectScreen, AdminScreen, MeetingView, schemas), so a change in the entry renames every importer. Built two commit pairs in remote test mode: whatsNew/entries.ts only (86d06bc8^ -> 86d06bc8): 32 of 100 JS chunks renamed, 442 KB gzip of 1,108 KB; Composer.tsx only (6cbeeaed^ -> 6cbeeaed): 31 of 102 chunks, 370 KB of 1,203 KB. First-load files renamed: 3 files, 87 KB and 72 KB gzip (index, words.en, bootstrap). Production had about 10 releases on 2026-10-21 and 9 on 2026-10-20. Trial in a copy: a shell chunk with only the components and lib modules of the entry cut the renamed set to 25 chunks / 277 KB and 24 / 205 KB (Dashboard and Open space stopped changing).
- Impact: Each person after each release: 72 to 87 KB on the critical path of the first open (about 0.4 s on 4G), then 290 to 360 KB more in the idle prefetch that competes with the first data and spends mobile data. About 4 MB a day per phone in a week of 10 releases.
- Fix: Move the entry modules that lazy chunks import into a stable shell chunk (codeSplitting group list taken from the sourcemap of the entry), leave the entry as main.tsx plus the loader table, keep volatile modules (whatsNew entries, words) out of the shell. Keep the check-bundles rules (no zod schemas, no words, vendor and supabase import no app chunk) and re-measure with two builds.
- Skeptic impact: The mechanism holds (27 of 105 baseline chunks import the entry chunk). The '4 MB a day per phone' figure is too high: a person fetches the sum of changes once per open, not once per release. A shell chunk saves about 165 KB gzip per fetch on the lazy part only. The first-load files still change with every release. Pages is free, so the cost is phone data only.
- Skeptic fix note: Safe in behavior. Medium build risk (chunk cycles, check-bundles rules). Do it only after a two-build measurement, as the finding says.

### GP-5: Profile pictures travel as data text in users.list and twice in session.get

- Score 2 to 2, verdict weakened, fix safe True, effort M, risk medium, behavior change False
- Where: src/api/handlers/people.ts:40-70 (session.get returns user and authority, both whole User records), src/api/handlers/people.ts:109-116 (users.list keeps avatarUrl; userCard() drops it), src/app/pictures.tsx:15-23, src/lib/picture.ts:10 and 107-121 (up to 16 KB each)
- Evidence: Read in code; the test copy has no pictures (users.list 14.6 KB, session.get 6.7 KB), so no measurement. With 15 people at 5 to 12 KB, base64 adds 33%: 100 to 240 KB of text, 70 to 180 KB after gzip (WebP does not compress). It rides in the first batch and in every full reload (tab back after 60 s DF-4, wake BG-11). Egress estimate: 15 people x 16 loads a day x 100 KB x 22 days = about 0.5 GB a month.
- Impact: Everyone on every load and reload: 0.35 to 0.9 s of extra download on a 4G phone (1.6 Mbps), not noticed on office wifi. About 10% of the 5 GB Free egress.
- Fix: users.list returns a short picture version for each person; the screen keeps picture data in IndexedDB under that version and asks only for new ones (additive call users.pictures { ids }, MCP unchanged). session.get leaves the second copy out (authority keeps rights only). Measure with real pictures on production numbers first (the owner can read the Egress chart).
- Skeptic impact: The double copy in session.get is the own picture only (user and authority are the same person), at most 2 x 21 KB, typically 2 x 5 to 10 KB. Everyone's pictures travel once in users.list: about 45 to 120 KB gzip for 15 people, 0.2 to 0.6 s on a 1.6 Mbps line, in the first batch and each full reload. Not measured (test copy has no pictures).
- Skeptic fix note: Additive call and a picture cache are safe in behavior but medium risk (new-call checklist, MCP allow or deny, tests). Ask the owner to read the production Egress chart first, as the finding says.

### GP-6: The nightly backup pulls the whole database through the pooler and holds the office lock

- Score 2 to 1, verdict weakened, fix safe False, effort M, risk high, behavior change False
- Where: scripts/backup/dump.ts:106-126 (data dump inside the lock transaction, limit 5 minutes), .github/workflows/db-backup.yml, scripts/backup/mac-backup.sh
- Evidence: access-map.md: Supabase counts every byte the database or the pooler sends to a client; a dump is a client. Latest production backup sizes (GitHub release metadata, tar.gz.age): 129 KB (10-17), 166, 256, 244, 443, 519 KB (10-22), so a few MB of text today. At the DB-14 year size (115 MB, 56% events) the nightly data dump moves 60 to 110 MB: 2 to 3 GB a month of the 5 GB Free egress, next to DB-2 (2.7 GB) and DB-1. The dump holds the office lock, so writes answer busy while it runs (seconds today, longer at year size; the Mac run starts after 17:00 Riyadh).
- Impact: Nobody today. In the second half of the first year it can take half of the egress quota and block saves for a minute at night or after 17:00.
- Fix: Back up the append-only tables (events, notifications, messages, comments) by rows newer than the last backup, with one full dump a week; or run the full dump every second night after month 6. The recovery point is the owner's choice, so ask him before any change.
- Skeptic impact: Nothing today: the archive is 519 KB compressed (a few MB raw, about 0.1 GB a month). The lock runs at 05:07 Riyadh time (cron 7 2 * * * UTC), so busy answers touch nobody; the Mac run happens only when the owner asks. The 2 to 3 GB a month is a year-end estimate. Backup bytes to an outside client do count as egress.
- Skeptic fix note: Changes the recovery point, which is the owner's choice. Do nothing now. Revisit when the database passes about 50 MB (DB-14 runway).

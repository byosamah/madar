# Skeptic report: first load, bundles, CSS, fonts, caching (key firstload)

Method. I re-read the cited code in deploy-test (1d45aae5). I re-ran the first-load count over the auditor's builds
(copies/firstload, xa to xg, old2) with my own reading of index.html: the sizes match (base 50 files 383,620 B gz, A 345,978,
A+B 318,179, C 371,648, E 337,700, F 321,968, G 302,311). I diffed the experiment copies against main to read the patches. I
measured gzip, brotli 5 and brotli 11 of the baseline files myself. I curled the test copy for the compression and cache headers
(test copy only, never production).

## Main correction: which saving repeats after a release
The vendor chunk (vendor-Qsj3nOJd) and the supabase chunk (supabase-hBF1nWiT) have the same hash at 62855bc2 and today. Assets are
`immutable`. So after a release the browser keeps vendor, supabase and the fonts, and downloads only the app chunks that changed.
A saving that comes from the vendor chunk (FL-3, FL-12), the supabase chunk (FL-5) or a font (FL-9) pays only on the first visit
of a device (new phone, cleared cache). The auditor's "every cold load" holds for the app chunks only (FL-1, FL-2, FL-4, FL-10).
Moving code out of vendor or supabase also changes their hash once, so every person downloads them again once.

Other corrections:
- FL-1 and FL-2 are not a reverted fix. At 62855bc2 the task panel was already a static import of Home (inside the index chunk).
  The panel grew with the chat upgrade, and dnd-kit came on 2026-10-08. The first-load budget regressed, no fix came back.
- Impact scores were not on one scale (190 ms scored 4, 150 ms scored 2). I used: 150 ms or more = 3, 60 to 150 ms = 2, less = 1,
  and I cut one point where the saving repeats only on the first visit of a device.
- FL-6 and FL-7 pull against each other (see below).

## Verdicts
- FL-1 confirmed, score 3 (was 4). About 38 KB gz, 190 ms on Slow 4G, after each release. Fix pattern is safe and was measured.
- FL-2 confirmed, score 2 (was 3). 18 to 28 KB gz in the index chunk, repeats each release. Swapping a static list for a drag layer
  remounts the rows once: test that a focused row keeps its focus.
- FL-3 weakened, score 1 (was 3). Real bytes, but vendor stays cached across releases. One extra download of vendor on release day.
- FL-4 weakened, score 1 (was 2). 8 KB gz. Only useful as the step that lets FL-3 work.
- FL-5 weakened, score 1 (was 3). Same reason: the supabase chunk stays cached. The stub works, but it hides a package behind an alias:
  a supabase-js upgrade can start to call these clients. Keep the test.
- FL-6 weakened, score 1 (was 2). The gain was measured with an English browser. For an Arabic browser, words.en is a 34 KB
  second request on the critical path next to words.ar. FL-7 option B would make it a pure cost. No safe language-blind form.
- FL-7 weakened, score 1 (was 2). The words chunks change at each release (What's new), so 38 to 48 KB gz of phone data each
  release, with no delay a person feels. Option A is safe.
- FL-8 weakened, score 1 (was 2). The 340 KB is the cost of all screens. The safe fix (skip the 5 sign-in screens and Admin for a
  person who cannot open it) saves 5.6 KB + 30 KB = about 36 KB gz. The saveData part changes behavior.
- FL-9 weakened, score 1 (was 2), fixSafe false. src/design/CLAUDE.md says "never convert, subset or rename the files". A WOFF2
  container is a conversion. My brotli 11 of the OTF files gives 79,214 / 78,707 / 77,638 B, the same as WOFF2: the gain is only
  the compression level. The owner would have to ask Thmanyah first. And fonts stay cached across releases.
- FL-10 confirmed, score 1. I read zod core.js: the global object is `globalThis.__zod_globalConfig`. Safer form: change the
  object in place (`const g = (globalThis.__zod_globalConfig ??= {}); g.jitless = true`), never replace it.
- FL-11 confirmed, score 2. Limit 1,350,000 B against 1,236,844 B real. Set the new bounds in the same commit as each saving.
- FL-12 weakened, score 1 (was 3), fixSafe false. Inferred, two attempts gave 0 bytes. It sits in vendor (cached). LazyMotion
  starts the animation features after first paint, so entrance and layout animations would start later: a visible change.
- FL-13 confirmed, score 1. Small, L effort. 148 dynamic t() calls make a static scan of keys incomplete: scan at runtime too.
- FL-14 weakened, score 1. I confirm the numbers on the test copy: vendor 189,488 B (br) against 185,500 B (gzip) and 160,882 B
  (brotli 11); index 47,896 B (br). Cloudflare Pages gives no control of the level, and vendor is cached. Not actionable.
- FL-15 confirmed, score 1. The preload costs 11 KB on the sign-in page, which may not show a digit. The bundle check expects 3 fonts.
- FL-16 weakened, score 1. About 2 KB gz (bootstrap code of the paused exit). The rights catalog is needed by can(). The flags are
  read at run time, so the bundler cannot drop the code: it needs a build-time constant, M effort for 2 KB.
- FL-17 weakened, score 1 (was 2). The map chunks have stable names (cached across releases), so the wait is the first pinned
  project of a device. Starting at the route load would pull 479 KB gz for every project, also the ones with no pin. Safe form:
  in the lazy factory of ProjectPlace call loadMapLib() with the MapCanvas import, so the two requests go in parallel.
- FL-18 weakened, score 1. pages.sh always writes _headers, and headers.test.ts covers the generator. The risk is hypothetical.
  A live header test and a one-day rule for the icons and the manifest are cheap and safe.

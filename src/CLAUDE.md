# Screens

React + TypeScript + Vite + Tailwind v4, React Router, TanStack Query, Motion, i18next, vaul sheets. Read `DESIGN.md` at the repo root
before any screen work. The root `CLAUDE.md` rules apply (ADHD test, screenshots, word keys, run `npm test` alone).

## Folders and guides
- `app/`: the shell, routes, runtime hooks, boot, and `app/remote/` (Supabase client, sign-in port, realtime channel). `features/<area>/`: one
  folder for each screen area. `components/`: shared parts. `lib/`: pure helpers (dates, due, stages). `data/`: the sample office of the
  prototype. `test/`: render helpers, factories, setup.
- Guides of the whole of `src/`: `api/` (the contract and the fake API), `i18n/` (words, What's new), `design/` (tokens, fonts).
- Guides that load only in their folder: `app/` (routes, shell, boot, data pipeline, phone shell), `app/insight/` (PostHog), `components/`,
  `features/map/`, `features/inbox/` (chat, presence, emoji), `features/files/` (attachments, Download all, picture preview),
  `features/meetings/`, `features/project/`, `features/projects/`, `features/settings/` (Admin, rights sheet, push, Google Calendar,
  quiet hours, What reaches the Admin), `features/home/`, `features/focus/`, `features/space/`, `features/dashboard/`, `features/work/`.
- Push in the screens: `features/settings/CLAUDE.md`. Download all: `features/files/CLAUDE.md`. The bubble handlers
  (`BubbleActionsContext`): `features/inbox/CLAUDE.md`.

## Two builds from one source
- `VITE_MADAR_API` (`fake` default, `remote`) is fixed at build time. Use `PROTOTYPE` and `REMOTE` from `app/mode.ts`. `REMOTE` does not
  fold in a module that must keep a library out of the prototype: write `import.meta.env.VITE_MADAR_API === 'remote'` there.
- `main.tsx` loads only one bootstrap. The remote build splits each screen into its own chunk. A route names its screen and never imports
  a screen file. A new screen needs a loader in both `app/screenLoaders.ts` and `app/screenLoaders.static.ts`. Boot, chunks and prefetch:
  `app/CLAUDE.md`.
- The prototype uses `createHashRouter` (links `#/...`, one script file). The remote build uses `createBrowserRouter` (path links). Screen
  tests use the hash router.
- `scripts/check-bundles.ts <remote|prototype|server> [folder]` checks a build. The remote build holds no sample names. Its first load (the
  scripts of `index.html`, their static imports and the modulepreload links) holds no chart code, no zod schemas, no words, no emoji data and
  none of the `LAZY_MARKERS` (the chat message log, the vaul drawer, the Supabase storage client, the PostHog library) or `DRAG_MARKER`. It
  stays under `FIRST_LOAD_MAX_BYTES`, `FIRST_LOAD_MAX_GZIP` and `FIRST_LOAD_MAX_FILES`. A limit sits about 3 percent above the real size, so a
  change that adds first-load code fails there (`check-bundles.test.ts`). The vendor, overlay and supabase chunks import no app chunk. The
  prototype build holds no "supabase", is one script file and has no early link. The preconnect rule runs only with `VITE_SUPABASE_URL` or a
  full `VITE_API_URL` set.
- A red "no zod schemas" line: a first-load file imports from `contract/entities.ts` or `server.ts`, or imports a function of a heavy
  `src/api` module (`chatState.ts` pulls the rules and the store). Take the limit from `contract/limits.ts`, use a type-only import, or move
  the small pure function into its own file (`api/adminReach.ts`). To see which source file pulled code into the first load, build with
  `--sourcemap` into `$TMPDIR` and read the `sources` of `assets/index-*.js.map`.
- A red "first load starts 35 files or fewer" line with no new code: a new shared module that a first-load file and a lazy screen both
  import can cut code out of the index chunk into many small chunks. One loader file shared by the task rows and the Files tab took the
  first load from 30 to 48 files (2026-10-27). Run `build:remote` after a cleanup that adds a shared file. To find the cause, build each
  commit from `git archive` and compare the chunk names of the first load.

## The API address
- `build:remote` sets `VITE_API_URL` from `config/server-host.json` (`scripts/build-remote.ts`, `remotePublicEnv`): the page's own `/api` when the
  copy runs on the Worker (`workers` or `office`), the Supabase api function otherwise. The word `office` also sets `VITE_MADAR_AUTH=madar` and
  `VITE_MADAR_LIVE=socket`. `config/remote.<env>.env` must not set any of the three. `regionUrl` (`api/remote/region.ts`) adds
  `forceFunctionRegion=eu-central-1` only to a `*.supabase.co` URL, and a relative `/api` stays relative. `dev:remote` always uses the api
  function: Vite runs no Pages Function.
- WebKit browsers (Safari, and every browser on an iPhone or iPad) send their batch calls through the page's own `/api`, because they keep a
  CORS preflight only 10 minutes. The code: `api/remote/pageApi.ts` (`isWebKit`, `batchApiUrl`). `build:remote` sets `VITE_API_PAGE_HOSTS` only
  when the api function is the host. The reason and the measurements: `functions/CLAUDE.md`.

## Data on screens
- Screens call `api.call(name, input)` through `useCall` (reads) and `useAction` (writes) in `app/runtime.tsx`. The pipeline (`readMap.ts`,
  signals, write follow reads) is in `app/CLAUDE.md`. A read that starts to read a new collection needs that kind in its `readMap.ts` line. A
  new write needs its `WRITE_KINDS` line (`src/api/CLAUDE.md`, new-call checklist).
- A screen never checks a right by itself. It asks `can()` (`api/CLAUDE.md`). Hide every control that the call would refuse. A control of a
  project or a to-do reads the `viewerCan` flag of that project or to-do (`contract/views.ts`). A control with no project or to-do reads the
  rights of the session with `useRight(action, resource?, whileLoading?)` or `useCan()` (`app/useRight.tsx`). Before the session arrives a
  button is hidden (fail closed), and a tab of the tab bar shows (`whileLoading`), so the bar does not jump. `RequireRight` guards a route.
  The switch of a route is the `right` of its entry in `routes.tsx`. The Search icon, Ctrl+K and the Search commands follow the switches of
  what they open. A control that offers a person (the lead of a new to-do, the one who replies, the people of a meeting) offers only the
  person when `task.assign` is off. The new words of role rights are in `i18n/real/rr2screens.*.json`.
- Who may see a hidden project is a rule of the contract (`src/api/CLAUDE.md`). A screen only shows what the server sends, and shows the lock
  (`HiddenMark`).

## Speed rules
- A list screen splits into a parent and a `React.memo` body. The parent keeps `useSearchParams`, the reads, the clock values (`todayISO`,
  `officeHour`) and the panel. The body gets plain props and stable handlers (`app/useStableHandler.ts`), so a panel that opens renders no row
  again. Never put a router hook in a row body.
- A part that most sessions never open loads in its own chunk through `lazyOverlay` (`app/lazyOverlay.tsx`). Never import such a part
  statically from the shell, Home or `AuthGate` (`app/firstLoadImports.test.ts`). `useLang` (`app/lang.ts`) reads the language with
  `useSyncExternalStore`: do not call `useTranslation` in a hot part.
- Every step that waits for an idle moment goes through `whenIdle` (`app/whenIdle.ts`), never through `requestIdleCallback`,
  `scheduler.postTask`, `scheduler.yield`, `navigator.connection` or a `longtask` observer: Safari has none of them, and every browser on an
  iPhone is Safari. `useStaged(total, first)` (`app/useStaged.ts`) draws the first rows of a long list at once and the others at the idle step.
- Start a read early with `usePrefetchCall` in an effect or an event, never in render. A press starts reads on pointerdown, never on hover.
  The read lists sit next to the parts that mount them (`features/project/CLAUDE.md`). A change to a `useCall` key in such a part changes its
  list in the same commit.
- Never write `new Intl.DateTimeFormat`, `Intl.NumberFormat` or `Intl.ListFormat` in a screen. `lib/dates.ts` keeps one formatter for each
  language and style (`formatDay`, `formatMonth`, `formatMonthYear`, `formatWeekday`, `formatNumber`, `listFormat`, `clockFormat`).
  `dates.recorded.json` pins every text in English and Arabic.
- Bubble handlers reach a memoized bubble through `BubbleActionsContext`, not through props: `features/inbox/CLAUDE.md`.
- Row pictures load and decode only near the view (`useNearView`, `loading="lazy" decoding="async"`): `features/files/CLAUDE.md`.
- Home keeps stored answers and a role hint on the device: `app/CLAUDE.md` (Early reads). Never store a token or a file link there.

## Design rules (the short form of `DESIGN.md`)
- A notice that stays while a state lasts ("Live updates paused", "No connection") goes through `useStandingNotice` (`app/toasts.tsx`): it floats
  in the toast lane. Never put a strip above the page: the header floats over it.
- Toasts: a toast with Undo stays `UNDO_STAY_MS`, any other toast `STAY_MS`. Ctrl+Z or Cmd+Z (no Shift, no Alt) runs the newest Undo
  (`isUndoKey`): the key is "z", or the code is `KeyZ` and the key is not a Latin letter (an Arabic layout). Never test the code alone: on a
  French AZERTY keyboard `KeyZ` is the W key. A text field keeps its own undo. A swipe that marks an unread notice read shows a toast with
  Undo, and Undo calls `notifications.markUnread` (a read mark writes no event, so `events.undoStory` cannot undo it). A tap on a row and a
  swipe on a read notice show no toast.
- Start from the LIVE app's design system (glow tiles, the tokens), never from the spec alone.
- The signature is solid navy `#1F2A55` (dark `#C9D4FF`), never a gradient. It goes only on the one main button, the open tab, the day ring
  and the timer. The glow (three soft lights) sits only behind "Next for you" and in the logo tile. Only the tab pill keeps a blur.
- Status words are shape signs plus an ink word (no tinted pill). The stage steps line takes the status color. Red only for Late and errors.
  Gentle words: "3 days past due" in the attention color, never a red "Overdue". The unread badge is red on the Inbox and the bell only.
- Calm rules: one title and at most one main button (`expectCalm` in `tests/e2e-deploy/steps.ts` checks these two). One Filter button and no
  filter chip rows (the one exception is the four kind chips of the phone Inbox, a radiogroup whose open chip is a white card and never
  navy). No grid view. "On track" never shows in lists. Avatar stacks only as `AvatarStack` with the leader ring.
- Shared parts (avatars, tiles, logo, icons, required fields, dates, popovers): `components/CLAUDE.md`.
- RTL: logical classes only (`start/end`, `ms/me`, `ps/pe`). `scripts/check-rtl.ts` fails on left or right styles.
- Write a direction mark as an escape (`⁨`), never as the raw character: GitHub flags hidden bidi characters. The Write tool can save a
  typed `⁨` as the raw mark. After a new file with one, run `npx tsx scripts/check-rtl.ts` before `all.sh test`: the check stops
  the build at the screens step. `check-rtl.ts` (`findRawDirectionMark`) stops the build on a raw mark in `src`. It does not read test files or
  word files. An escape typed into a tool command can arrive as the raw character: build the backslash apart (Python `chr(92)`), then check
  the file with `git grep -nP '[\x{2066}-\x{2069}\x{200E}\x{200F}]'`. A report excerpt or a name in a notice sentence sits between FSI and PDI.
- Text with its own direction (`dir="auto"`, `dir="ltr"`, `<bdi>`) takes its side from the page (`tokens.css`), so an English name sits on
  the right in Arabic. Typed text (`textarea` or `input` with `dir="auto"`) and the text of a chat or a comment (`natural-side`) follow their
  own language: Arabic from the right, English from the left. Put `dir="auto"` on the text, never on a flex or grid box or with
  `text-start` or `text-end`: `scripts/check-rtl.ts` fails on that. A name with a colon is one `<bdi>`.
- A direction isolate is needed for a name or an invoice number inside an Arabic sentence (`isolate`).

## Before you call a screen change done
- A change to a picture, a ring or a people stack: check it with a real photo, not initials. Put a photo in the saved office:
  `users[id].avatarUrl` = a JPEG data address under 24,000 characters (IndexedDB `madar`, store `data`, key `state`), then reload.
- Chrome slows the timers of a hidden tab. The tab that claude-in-chrome opens is hidden (`document.hidden` is true), and then
  `connectChanges` marks the lists old and never loads them again: a saved change does not show until a reload. In that tab run
  `Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })` and dispatch `visibilitychange` first.
- Prototype language and theme live in IndexedDB (the person menu from 640 px, the Me tab on a phone). A switch takes a few seconds, and
  `<html lang>` can show the old value meanwhile. Wait before a screenshot.
- A quick 390 px check without Playwright: in the claude-in-chrome tab, add a fixed 390 x 844 `iframe` of the same page (`innerWidth` is
  390). Switch the language or theme in the outer tab, then load the frame again (they share IndexedDB). Measure a phone text fit at 360 px and
  390 px in both languages: Arabic buttons («إرسال») are wider. To check a press area, use `elementFromPoint` on a grid around the element:
  a box measure misses an `after:` press strip.
- Shots from a branch worktree: `npx vite build --outDir test-results/proto-<x>`, then `python3 -m http.server <port> --bind 127.0.0.1` there
  (sandbox off). A new port keeps its own saved office: run `indexedDB.deleteDatabase('madar')` and reload first.
- To set the prototype person, language or theme, or add a sample record, without clicks: edit the saved office (IndexedDB `madar`, store
  `data`, key `state`: `session.currentUserId`, `users[id].preferences.language` and `.theme`), then reload.
- Prototype data with no clicks in the 390 px frame: attach a file with `input.files = dataTransfer.files` and a `change` event. Pick a mention
  with Enter (a synthetic click picks nothing). Set the box to '' before '@' (a stored draft can hold the same text, and React then sees no
  change). For a download control, wrap `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` in the page to keep the Blob and its
  name in memory (a ZIP starts "PK").
- A What's new test finds its entry by id, never by `WHATS_NEW[0]`. The id, day and order rules: `src/i18n/CLAUDE.md`.

## Screen test gotchas
- Links are `#/...` (hash router). A whole project page can take more than the 1 s `findBy` default: use `{ timeout: 10_000 }`.
- A read with `wire.output` gives the screen the wire form in the real build: test it with `runtime.mode: 'remote'`
  (`features/files/CLAUDE.md`).
- The task panel is named after the saved title: `findByRole('dialog', { name: <new title> })` proves that a title save came back
  (`TaskSheetTyping.test.tsx`). A Home Today test first moves the other to-dos of its person out of Today (the sample office has more). A panel
  that waits for its own query (DecisionsPanel on `projects.get`) can come after the card: wait for the panel itself.
- `vite preview` sends no CSP, so only the deploy suite on the test copy catches a policy break.
- A test helper that makes a router awaits `preloadScreens()` at the top of its module (`test/render.tsx`, `test/heldRemoteApp.tsx`,
  `features/auth/renderAuth.tsx`). Without it the first frame is empty and React Router warns that a HydrateFallback is absent.
  `test/setup.ts` gives the words of both languages to the screens (`addWords`).
- A test with a real-build runtime must not use `vi.runAllTimers`: the midnight timer of `keepAnswers` sets itself again. Use
  `vi.advanceTimersByTime`. A real-build test that checks the toast or onSuccess of a write waits for it (`findBy` or `waitFor`): the success
  steps come after the reads of the request.
- `renderHeldRemoteApp` (`test/heldRemoteApp.tsx`) renders the whole app over the sample office as the real build runs it, with no change
  signals. Its API records each call (`asked`, `callsOf`). `hold`, `release` and `releaseHeld(match)` hold the answers, and `fail` makes chosen
  calls fail. It also takes `auth` (a port with `userId()`) and `home` (starts `startHomeCache` before the first frame, as `main.tsx` does).
  `HomeInstant.test.tsx` shows a first page life that writes the record and a second one that starts with a held network.
- `renderWireApp` (`test/wireApp.tsx`) renders the whole app over the real `RemoteApi` (batcher, follow reads, own signals) and a fake server
  that refuses a request over `BATCH_BUDGET` with 413. `trips` lists each request. `settle()` waits until no new request goes out. Use it to
  count the requests of one save (`app/SaveTrip.test.tsx`). `renderHeldRemoteApp` and `renderRemoteApp` see calls, not requests.
- `renderRemoteApp` (`test/renderRemote.tsx`) renders the app with runtime mode remote and the query client of the real build. `sent` lists each
  call in order, and `hold` keeps the calls it picks until `release()`. A render-count test wraps a component with
  `vi.mock(path, importOriginal)` and waits until the count is stable before it compares.
- `vi.mock` replaces an export for the other modules only. A hook in the same file that calls that export calls its own copy, and the test
  no longer sees the call. Put such a hook in its own file that imports the export (`app/useDownloadFile.ts`, 2026-10-27).

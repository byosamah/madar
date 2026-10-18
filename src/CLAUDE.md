# Screens

React + TypeScript + Vite + Tailwind v4, React Router, TanStack Query, Motion, i18next, vaul sheets. Other guides here:
`api/` (the contract and the fake API), `i18n/` (words), `design/` (tokens). Read `DESIGN.md` at the repo root before
any screen work.

## Folders
- `app/`: the shell, routes, runtime hooks, modes, and `app/remote/` (Supabase client, sign-in port, realtime channel).
- `features/<area>/`: one folder for each screen area. `components/`: shared parts. `lib/`: pure helpers (dates, due, stages).
- `data/`: the sample office of the prototype. `test/`: render helpers, factories, setup.

## Two builds from one source
- `VITE_MADAR_API` (`fake` default, `remote`) is fixed at build time. Use `PROTOTYPE`/`REMOTE` from `app/mode.ts`.
- `main.tsx` loads only one bootstrap. Its first import is `app/zodConfig.ts` (zod runs jitless, so the CSP holds), and its
  second is `i18n/firstWords.ts`. `zodConfig.ts` imports only `config` from `zod/v4/core`. Never import `z` from `zod` there:
  that puts the zod schemas into the first load.
- The remote build splits each screen into its own chunk (performance audit BND-1). `app/screenLoaders.ts` holds one loader
  for each screen, and `app/screens.ts` the module cache. A route in `app/routes.tsx` names its screen and never imports a
  screen file. The frame, the sign-in gate, Home and the error pages stay in the first script. `main.tsx` loads the screens of
  the first address (plus Sign in when no session is stored) before it makes the router, then the others one at a time at
  idle. A failed import at a screen change reloads the page once (session mark `madar.screenReload`). A new screen needs a
  loader in both `screenLoaders.ts` and `screenLoaders.static.ts` (the prototype takes the plain imports through an alias in
  `vite.config.ts`, so its one file stays small; `screenLoaders.test.ts` keeps the lists the same).
- `vite.config.ts` (remote modes): the first-screen packages go into a `vendor` chunk and `@supabase` into a `supabase` chunk
  (`REMOTE_CHUNKS`), so a release that changes only app code keeps their names in the browser cache. zod stays out of
  `vendor`. The plugin `earlyLinks` adds the modulepreload, font preload and preconnect links. The prototype gets none.
- The prototype uses `createHashRouter` (links `#/...`, base `./`, one script file). The remote build uses
  `createBrowserRouter` (path links, base `/`). Screen tests use the hash router.
- The remote build moves `www.<host>` to `<host>` before it starts (`app/canonicalHost.ts`).
- The API address (owner, 2026-10-16): `build:remote` sets `VITE_API_URL` from `config/server-host.json`
  (`scripts/build-remote.ts`, `remotePublicEnv`): the page's own `/api` when the copy runs on the Worker (`workers` or `office`),
  the Supabase api function otherwise. The word `office` (exit wave 4) also sets `VITE_MADAR_AUTH=madar` and
  `VITE_MADAR_LIVE=socket`. `config/remote.<env>.env` must not set any of the three. `regionUrl` (`api/remote/region.ts`) adds
  `forceFunctionRegion=eu-central-1` only to a `*.supabase.co` URL, and a relative `/api` stays relative (fetch resolves it
  against the page). `dev:remote` always uses the api function: Vite runs no Pages Function.
- The sign-in of the remote build (`src/app/remote/authMode.ts`): `VITE_MADAR_AUTH` unset is the Supabase port of today;
  `madar` is the Madar port (`madarAuth.ts`, `madarOAuthPort`) for the own stack. No copy sets it before wave 5. Each port
  keeps its session under its own localStorage key (`SESSION_KEYS`: `madar.auth` for Supabase, `madar.session` for Madar);
  `main.tsx` and the deploy specs read the key of the build's port (`hasStoredSession`), never a fixed name.
- `scripts/check-bundles.ts <remote|prototype|server> [folder]`: the remote build holds no sample names. Its first load (the
  scripts of index.html, their static imports and the modulepreload links) holds no chart code, no zod schemas and no words,
  and stays at 1,350,000 B or less. Its index.html preloads the bootstrap chunk and its imports, the three Thmanyah files and
  a connection to each Supabase origin. The vendor and supabase chunks import no app chunk. The prototype build holds no
  "supabase", is one script file, and its index.html has no early link. The preconnect rule runs only with `VITE_SUPABASE_URL`
  or a full `VITE_API_URL` set (`build:remote` sets them; the page's own `/api` needs no preconnect). A red "no zod schemas" line: a first-load file imports from
  `contract/entities.ts` or `server.ts`; take the limit from `contract/limits.ts` or use a type-only import.
- To see which source file pulled code into the first load: build with `--sourcemap` into `$TMPDIR` and read the
  `sources` of `assets/index-*.js.map`.

## Browser push in the screens (owner, 2026-10-08)
- Real build only. `app/remote/push.ts` (no React, no zod): the state of the switch (`statusOf`), `turnOn`, `turnOff`, the check at the
  start (`syncThisDevice`, run by `app/remote/PushSync.tsx` in the shell) and `removeThisDevice` (the sign-out step in
  `features/auth/signOut.ts`, 4 s at most). Settings has `features/settings/PushSection.tsx`: one switch, "Notify me on this device",
  and a plain note, with no switch, where the browser cannot push (not supported, add Madar to the Home Screen first, blocked, not set up).
- The permission question starts inside the click, before any wait (Safari refuses it otherwise): `turnOn` calls
  `Notification.requestPermission()` first. `src/test/pushBrowser.ts` makes a browser for the tests.
- `public/sw.js` is plain JavaScript with no build step. The prototype build never registers it and `workerOnlyInRemote`
  (`vite.config.ts`) drops the file from its dist; `check-bundles.ts` fails a prototype with it and a remote build without it.
- The public VAPID key comes from `VITE_VAPID_PUBLIC_KEY` (`config/remote.<env>.env`). Without it the section says push is not set up.
- A sign-out unsubscribes the browser, so the person who stays signed out gets no push.
- Push is on by default (owner, 2026-10-09). A browser lets a page turn push on only after a tap on Allow, so each new device gets
  one ask: `features/home/PushAskCard.tsx`, a small card under Today on Home with one short line and one button (not the main
  button; `canAsk` in `push.ts`). Any answer ends the ask; a closed question leaves it. The permission then stays in the browser, so
  `syncThisDevice(api, key, userId)` turns push on again by itself when the permission is granted and the browser holds no
  subscription (after a sign-out, or for the next person on a shared browser). It never asks the question.
- Only a person who turned the switch off stays off. `usePushDevice` keeps that choice in localStorage for each person
  (`madar.pushOff.<user id>`, `isPushOptedOut` and `setPushOptOut` in `push.ts`), sets it before the turn off, takes it back when
  the turn off fails, and clears it at a turn on. The ask also stays away from that person. The choice is never on the server.

## The project pin and the map (owner, 2026-10-18, fbk_017)
- `src/features/map/`: `MapCanvas.tsx` is the one MapLibre wrapper, `PinPicker.tsx` the pin sheet, `mapStyle.ts` the Madar style.
  `src/lib/geo.ts` reads a pasted link or a pair of coordinates. The form line "Pin on the map" is in `ProjectFields.tsx`.
- MapLibre loads only in the real build. `PinPicker.tsx` folds the flag with `import.meta.env.VITE_MADAR_API === 'remote'` itself
  (as `main.tsx` does): `REMOTE` from mode.ts does not fold, and the prototype would keep the map code and its stylesheet.
- The worker and the stylesheet come from the lazy loader in `MapCanvas.tsx`. The worker is a `?worker&url` import (it needs its own
  imports bundled). `check-bundles.ts` fails a prototype dist or a first load that holds the `maplibregl-` marker.
- The map style follows the theme and the language of the screens. Its colors are tokens (`MAP_COLORS`, checked by `mapStyle.test.ts`).
- A short Google Maps link holds no place: the paste field says so, and no pin is set.
- The Dashboard has a Map tab (`src/features/dashboard/DashboardMap.tsx`, `MapPinCard.tsx`). It reads `projects.list` with the Leader, Client and Team filters, and folds the flag itself as `PinPicker.tsx` does. In the prototype it shows the pinned list and the note "The map works in the real Madar.", and no map.
- The real build's pin picker has a place search (`src/lib/placeSearch.ts`). It asks OpenStreetMap (`nominatim.openstreetmap.org`) only on Search or Enter, never while the person types.

## Data on screens
- Screens call `api.call(name, input)` through `useCall` (reads) and `useAction` (writes) in `app/runtime.tsx`.
- `app/readMap.ts` says which change kinds each read reads. The remote build keeps answers until a change signal names
  them (`app/signals.ts`, `app/remote/channel.ts`). An answer that no screen shows stays for an hour (`keepAnswers`,
  `app/runtime.tsx`). A read of rule scope 'none', `search.query`, and an answer that a change marked go 5 minutes after
  their last screen closed. Every unseen answer goes when the office day changes.
- In the real build, `useAction` and `useUndoable` load the active reads that the write will change (`readsAfterWrite`,
  `app/signals.ts`, from `WRITE_KINDS` in `app/writeKinds.ts`) in the request of the write, right after it (`writeWithReads`,
  `app/runtime.tsx`). The read that shows the record of the write goes first. At most 11 reads and one overview read go. The
  own pass of `connectChanges` does not reload a read that answered there. The success steps of the action run after those
  reads, plus one task. The prototype sends the write alone (performance audit FET-3).
- A Realtime channel that joins sends its empty list with the origin 'join'. `connectChanges` waits 100 ms after a join
  (`joinMs`) for the other channel and for any signal, then reloads every list in one pass. A change of the prototype store
  still reloads at once.
- The office build (exit wave 3, `VITE_MADAR_LIVE=socket`, set by no build before wave 5) gets its signals from one socket of the
  office object (`api/remote/liveSocket.ts`, picked by `liveSourceOf` in `app/remote/bootstrap.ts`): a ticket, a ping each 30 s,
  a new socket and a reload of every list when no pong comes in 10 s. A build with `VITE_MADAR_AUTH=madar` has no Supabase
  client, so it always opens the socket (`liveKindOf`). Every other build keeps Supabase Realtime (`app/remote/channel.ts`).
- A screen never checks a right by itself. It asks `can()` (see `api/CLAUDE.md`).
- Theme: a new person starts light (`defaultPreferences`). The screens before sign-in take the theme saved on the device
  (`madar.theme`, written at each sign-in by `app/AppearanceSync.tsx`), else light. The sample office keeps System.

## Speed (performance audit 2026-10-07)
- A list screen splits into a parent and a `React.memo` body. The parent keeps `useSearchParams`, the reads, the clock
  values (`todayISO`, `officeHour`) and the panel. The body gets plain props and stable handlers (`app/useStableHandler.ts`),
  so a panel that opens or closes renders no row again. Never put a router hook in a row body: a row part that needs one
  is its own small component, as `RowMenu` in `features/projects/ProjectListRow.tsx`.
- `useLang` (`app/lang.ts`) reads the language with `useSyncExternalStore` over the one i18next instance and its
  `languageChanged` event. It does not call `useTranslation`.
- `usePrefetchCall` (`app/prefetch.ts`) starts a read early under the exact key of `useCall`, in the remote build only.
  Call it in an effect or an event, never in render. A project row prefetches `projects.get` on pointerdown, never on hover.
- The read lists sit next to the parts that mount them: `taskPanelReads` (`features/project/tasks/TaskSheet.tsx`), `tabReads`
  (`features/project/tabs.tsx`, next to `TAB_BODY`) and `meetingProjectReads` (`features/dashboard/MeetingProjects.tsx`).
  `features/project/reads.ts` holds `prefetchReads` and `sessionSeesPayments`: only a cached session with
  `can(user, 'payment.manage')` prefetches `payments.list`. A change to a `useCall` key in one of these parts changes its list
  in the same commit; `tabs.test.tsx`, `TaskSheetPrefetch.test.tsx` and `MeetingPrefetch.test.tsx` pin the lists.
- The Overview tab owns the open Tracker read (`tracker.list {projectId, openOnly: true}`) and gives it to Attention. In the
  meeting (remote build), `PrefetchNextProject` starts the reads of the next project once no `['api']` read is in flight. The
  meeting task panel takes its project from the meeting `tasks.list` row, and any `tasks.get` error still closes it.
- Never write `new Intl.DateTimeFormat`, `Intl.NumberFormat` or `Intl.ListFormat` in a screen. `lib/dates.ts` keeps one
  formatter for each language and style (`formatDay`, `formatMonth`, `formatMonthYear`, `formatWeekday`, `formatNumber`,
  `listFormat`, `clockFormat`). `dates.recorded.json` pins every text in English and Arabic.
- A list that stops its rows with `React.memo` (the comments, the task history, the Inbox rows and bubbles) wraps them in
  `AgeRefresh.Provider` (`components/Age.tsx`) with a new object on each render, so each `Age` still reads the clock in the
  same renders as before. The Inbox keeps one Bubble for each message view object (`useBubbles`, `ConversationPane.tsx`).
- Home keeps the last role it saw for each auth user in localStorage (`madar.homeRole.<auth user id>`,
  `features/home/roleHint.ts`). Before `session.get` answers, the real build asks for the `projects.list` of that role. The
  session answer always decides. The sign-in port gives the auth user id at once (`AuthPort.userId()`, optional).
- In the real build, Tasks shows the cached Home answer of `tasks.list {filter:'mine'}` without the done rows while its own
  list loads (`features/work/minePlaceholder.ts`), only when no change marked that answer. `WorkTasks` reads its list with
  `useQuery` under the `useCall` key, so a change to `useCall` must also go there.
- The project Tasks tab asks `taskTemplates.list {}` once, with its `tasks.list`, under the gates of the menu (list view and
  `createTaskForSelf`). Each `TemplateMenu` keeps the templates of its stage with `lib/sameText.ts`, as the handler does.
- In the real build, a picture hook (`useFileLink`, `useScreenshotLink`) keeps its signed link in the cache for
  `LINK_STALE_MS` (8 minutes) after the screen closes. The row pictures (Files rows, the meeting drawings, the report
  thumbnails) have `loading="lazy" decoding="async"`. A sheet or preview picture does not.

## Routes and shell
- Routes (`app/routes.tsx`): `/` Home, `/projects`, `/projects/:id` (tabs overview, tasks, activity, tracker, schedule,
  files, team), `/work` (Tasks), `/dashboard`, `/dashboard/meeting` (full screen), `/dashboard/space` (Open space, full screen, read only), `/inbox`, `/notifications`, `/search`,
  `/settings`, `/admin` and `/admin/:section`. Remote only: `/sign-in`, `/welcome`, `/forgot`, `/reset`, `/oauth/consent`.
- Admin: a grouped side list, one section at a time. The sections, their groups and roles are in one registry,
  `features/settings/admin/sections.ts`; a new section is one line there. A desk opens the first section at `/admin`; a
  phone shows the list there. An unknown or forbidden section goes back to `/admin`.
- Project templates: the Admin section (`ProjectTemplatesSection.tsx`, the editor works on a text draft, `templateDraft.ts`)
  and "Start from a template" in the new-project form (`features/projects/TemplateUse.tsx`, `templateForm.ts`). A chosen
  template takes the place of the stage list and makes the start date required. The ticks "Can stretch" stay folded, and show
  only when the end date gives another length. The dates come from `lib/projectPlan.ts`, as on the server.
- Shell (`app/AppShell.tsx`): a floating tab pill (Home, Projects, Tasks, Dashboard, Inbox, plus Search and the bell; top
  on desktop, bottom on a phone; on a phone the tabs show icons only, and the word of each tab stays `sr-only` below
  640 px, owner 2026-10-08), the Madar mark at the top start (a press opens Home), the person menu. No sidebar.
- Focus mode is `?focus=<taskId>` with a 25-minute timer.
- Tasks (`/work`): one main button, New office task (`features/work/NewOfficeTaskSheet.tsx`: title, lead, due date). A list
  screen opens a task panel with `?task=<id>` and, for a project task, `&project=<id>` (`openTask`, `lib/params.ts`).
  `taskLink(null, id)` sends an office task to `/work?task=<id>`. An office task has no project: the word Office
  (`office.word`) shows where a project shows, and its panel (`TaskSheet` with `detail` null) has no stage and no
  prerequisites (owner, 2026-10-06).
- A date group of the Tasks screen, Home Today and each stage of the project task list take a new order by drag (owner,
  2026-10-07 and 2026-10-08): one component, `SortableTaskRows` (`features/project/tasks/`, `@dnd-kit/sortable`), with a grip at
  the end of each row the person may move, and Space plus the arrow keys on the grip. Coming up on Home has no grips, because its
  tasks fall on different days. The row content sits in an inner box (`RowDrag`, `TaskRowItem.tsx`), so the drag and the slide of
  the row never set one transform.
- The project Tasks tab (feedback fbk_005 and fbk_006, 2026-10-11, `features/project/tasks/`): the "+" before "Add a task" opens
  `NewTaskSheet` (title, a lead from the team, due date; a new task has no lead until one is picked), and the words next to it stay
  the quick add. A refusal "move the project back" opens the reason sheet over it, as in the quick add. The avatar of a row is
  `TaskPeople`: for a person with `row.canEditPeople` a press opens a small pop-up with the lead list (the lead first, then the
  team, then the others, who join the team), and a small "+" beside it (it shows on hover or focus, and is gone on a touch screen
  and under 640 px: `pointer-coarse:hidden max-sm:hidden`) opens the helper list. The pop-up also holds an "Add a helper" row,
  which is the only way on a phone. One press on a name changes the task at once, with an Undo toast and no confirm button. The
  pop-up takes its people from the cached `users.list` and `projects.get`, with the rules of the task panel. A row without the right
  keeps an empty box of the "+" size, so the avatars line up. The pop-up is a `Popover` with `fit`: it takes the side with room, its
  height stops 8 px inside the screen (`popoverPlace`), and only its list scrolls, so the heading and "Add a helper" stay in view.
- The Projects list and the project header show "Stage ends" (the end of the current stage, `ProjectSummary.stageEnd`) while the
  project has no named deadline (feedback fbk_004, 2026-10-11). "No deadline" shows only with neither. That line wraps on a narrow
  row and never truncates (a named deadline still gives way and truncates, V-32).
- Admin People (`PeopleSection.tsx`): a turned-off person or agent has "Remove from the list" in the row menu (`RemoveSheet.tsx`, owner
  2026-10-12). The sheet asks first (Cancel has the focus, the confirm sits on the start side) and has no Undo. The person leaves the
  list for good, and the History keeps the name (`api/CLAUDE.md`).
- Admin Requests and bugs (`FeedbackSection.tsx`) has two tabs, Waiting (the default) and Done. A report moves between them.
- Dashboard (`features/dashboard/`): every link to a list carries the Leader, Client and Team filters (`withFilters`,
  `Tiles.tsx`), and the Projects screen and the Task list read `leader`, `client` and `team` from the link. A new card in the
  pattern of Stale projects uses `AttentionCard.tsx` and shows only when it has a row. Money and Data gaps draw only when
  `dashboard.get` sends them (the server decides by role).
- Roles: Admin, Management, Accounting, Member; per project a leader and a team. Anyone creates a project and leads it.
  Everyone sees all projects. Payments only for Admin, Management, Accounting. Agents never join a team. The person who adds a
  project task changes and deletes it like the leader while on the team; the review stays with the leader (owner, 2026-10-07).
- Home (`features/home/`): the Today panel lists my tasks due today or past due. With none, it is "Coming up": my next 3 open
  tasks with a due date (`comingUp`, `lib/home.ts`, owner 2026-10-07). With neither, it says that nothing is due today. Home
  follows the shared order of the Tasks screen (`api/CLAUDE.md`).

## Design rules (the short form of DESIGN.md)
- Judge every choice from the view of the employees with ADHD: one next step, the fewest controls.
- Start from the LIVE app's design system (glow tiles, the tokens), never from the spec alone.
- The signature is solid navy `#1F2A55` (dark `#C9D4FF`), never a gradient. It goes only on the one main button, the
  open tab, the day ring and the timer.
- The glow (three soft lights) sits only behind "Next for you" and in the logo tile.
- 8 project hues from a hash of the id. Project pictures are "glow forms" with a unique `mark`.
- Status words are shape signs plus an ink word (no tinted pill). The stage steps line takes the status colour.
- Red only for Late and errors. Gentle words: "3 days past due" in the attention colour, never a red "Overdue".
- Calm rules (`expectCalm` in the Playwright suites): one title, at most one main button, no filter chip rows (one Filter
  button), no grid view, no avatar stacks, "On track" never shows in lists. Only the tab pill keeps a blur.
- Icons: animated Lucide icons from lucide-animated.com through `components/icons/AnimatedIcon.tsx`.
- Logo: `MadarMark` ("Turning doors"), only in the sign-in frame and the app frame, never in a project list
  (`MadarMark.test.tsx` lists the files).
- Fonts: Thmanyah Sans for English and Arabic (files in `design/fonts/`), then Inter and IBM Plex Sans Arabic as the
  fallback. Number spots use the `tabular` class: it takes the digits from Inter. Weights: Bold (`font-bold`, the title
  and headline styles) only for headings, Medium (`font-medium` or `font-semibold`, which renders Medium) for emphasis in
  rows, labels and buttons, Regular for body text.
- RTL: logical classes only (`start/end`, `ms/me`, `ps/pe`). `scripts/check-rtl.ts` fails on left or right styles.
- Write a direction mark as an escape (`\u2068`), never as the raw character: GitHub flags hidden bidi characters.
- Text with its own direction (`dir="auto"`, `dir="ltr"`, `<bdi>`) takes its side from the page (`tokens.css`), so an
  English name sits on the right in Arabic. Put `dir="auto"` on the text, never on a flex or grid box or with
  `text-start`/`text-end`: `scripts/check-rtl.ts` fails on that. A name with a colon is one `<bdi>` ("Faisal:").
- Every visible word comes from a word key (see `i18n/CLAUDE.md`).
- Dates: a date that saves itself uses `DateDraftField`. A date in a form that saves with its own button uses `DateField`
  (`components/DateField.tsx`). Both show "Set date…" when empty. Only the Tracker quick log keeps a raw date field (its
  date is never empty and has no label).
- A required field: `required` on `TextField`, `SelectField`, `TextArea` or `DateField` shows an asterisk after the label
  and a hidden "required" word in the description. The label text stays the field name, and the browser never checks
  the field.
- A project code shows as its key (`projectKey`) in lists and rows, and in full in the project header and About.
- A code typed by hand (the new-project form, the Admin's correction) with a warning shows the tick "Use this code anyway"
  under its field (`CodeAnywayTick`, feedback fbk_003): the code does not match the office pattern, or another contract has
  its month and series. The warning is the field message until the tick. A change of the code clears the tick.
- A person has an English name (`name`) and maybe an Arabic name (`nameAr`). Every spot that shows a person's name uses
  `usePersonName()` (`app/personName.ts`, the name of the screen language), and lists of people sort with
  `useByPersonName()`. A name that the server writes into a detail has an `Ar` twin: read it with `localName`.
- A person card (`UserCard`) carries no picture data. `Avatar` takes the picture from `users.list` through
  `app/pictures.tsx` (the app frame and the meeting view mount it).
- A report screenshot uses `useScreenshotLink` (`app/files.ts`). A press opens it in a sheet, and a press on the big
  picture opens it at full size in a new tab. The thumbnail has `loading="lazy"`; the sheet picture does not.
- A picture hook (`useFileLink`, `useScreenshotLink`) asks for one new link after an error. It gives up only when the new
  link breaks: an error of the old link while the new link loads is no strike. A screen checks `broken` before `url`.
- A report excerpt in a notice sentence sits between FSI and PDI (`\u2068`, `\u2069`), so it keeps its own direction.

## Before you call a screen change done
- Tests first. Then screenshots in EN and AR, light and dark, at 390 px.
- claude-in-chrome screenshots run inline. Playwright runs only in a delegated subagent.
- Chrome slows the timers of a hidden tab, so a list can show a change late. Bring the tab to the front
  before you judge it. The tab that claude-in-chrome opens is hidden (`document.hidden` is true), and then `connectChanges` marks
  the lists old and never loads them again: a saved change does not show until a reload (2026-10-12, fbk_006). In that tab run
  `Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })` and dispatch `visibilitychange` first.
- Prototype language and theme: the person menu (stored in IndexedDB, not localStorage). A switch takes a few seconds,
  and `<html lang>` can show the old value meanwhile. Wait before a screenshot.
- The owner likes to choose a visual style from a side-by-side comparison artifact.
- A quick 390 px check without Playwright: in the claude-in-chrome tab, add a fixed 390 x 844 `iframe` of the same page
  (`innerWidth` is 390). Switch the language or theme in the outer tab, then load the frame again (they share IndexedDB).
- To set the prototype person, language or theme, or add a sample record, without clicks: edit the saved office (IndexedDB
  `madar`, store `data`, key `state`: `session.currentUserId`, `users[id].preferences.language` and `.theme`), then reload.

## Screen test gotchas
- Links are `#/...` (hash router).
- A read with `wire.output` (`feedback.screenshot`, `files.link`) gives the screen the wire form in the real build. Test such a
  screen with `runtime.mode: 'remote'`: the prototype test alone passed while the real build showed grey boxes.
- A whole project page can take more than the 1 s `findBy` default. Use `{ timeout: 10_000 }`.
- A panel that waits for its own query (DecisionsPanel on `projects.get`) can come after the card. Wait for the panel itself.
- `vite preview` sends no CSP, so only the deploy suite on the test copy catches a policy break.
- Run `npm test` alone. Next to a build or Playwright, screen tests time out.
- A test helper that makes a router awaits `preloadScreens()` at the top of its module (`test/render.tsx`,
  `test/heldRemoteApp.tsx`, `features/auth/renderAuth.tsx`). Without it, the first frame is empty and React Router warns
  about a missing HydrateFallback. `test/setup.ts` gives the words of both languages to the screens (`addWords`).
- A test with a real-build runtime must not use `vi.runAllTimers`: the midnight timer of `keepAnswers` sets itself again.
  Use `vi.advanceTimersByTime`. A real-build test that checks the toast or onSuccess of a write waits for it (findBy or
  waitFor): the success steps come after the reads of the request.
- `renderHeldRemoteApp` (`test/heldRemoteApp.tsx`) renders the whole app over the sample office as the real build runs it,
  with no change signals. Its API records each call (`asked`, `callsOf`). `hold`, `release` and `releaseHeld` hold the
  answers, and `fail` makes chosen calls fail: use it to test which reads start before the first answer.
- `renderRemoteApp` (`test/renderRemote.tsx`) renders the app with runtime mode remote and the query client of the real
  build. `sent` lists each call in order, and `hold` keeps the calls it picks until `release()`: use it to test the order of
  requests. A render-count test wraps a component with `vi.mock(path, importOriginal)` and waits until the count stops
  changing before it compares.
- A picture row of the real build: render with `runtime.mode: 'remote'` and an api stub that answers `files.link`
  (`features/project/files/FilesTab.remote.test.tsx`).
- `DateDraftField` (`components/DateDraftField.tsx`): a change event with no focus counts as a pick from the date picker and
  saves at once. To test typing, focus the field first (inside `act`): the full field shows and saves on blur or Enter.
- `DateField` gives every change to the form at once, so `fireEvent.change` on the input by its label works as before. A
  focus with no press (the keyboard, or the form that moves to an error) shows the full field until the blur.
- A dnd-kit keyboard drag in jsdom needs `getBoundingClientRect` mocked for each row
  (`features/work/WorkOrder.test.tsx`). The place message (`onDragOver`) replaces the pick-up message at once, so assert
  the place message. Await the place message after Space and after the arrow key before the next key, or the drop never happens.

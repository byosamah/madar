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

## Google Calendar in Settings (owner, 2026-10-19, fbk_022)
- `features/settings/GoogleCalendarSection.tsx`, after the push section: one section with the fewest controls. The state of `google.status` decides the one
  control: `none` gives the main button "Connect Google Calendar", `ok` and `not_synced` give a quiet "Disconnect", `broken` gives the main button
  "Connect again". `ready: false` gives one line and no control, and the prototype gives one line (`gcal.prototype`) and asks nothing.
- Connect asks `google.connectStart` and leaves for the address (`leave`, a prop for the tests). The page leaves only for `https://accounts.google.com`. Google
  sends the person back through `GET /api/google/callback` (`server/google/callback.ts`) to `/settings#google=<word>`. The section reads the fragment once,
  removes it at once with `history.replaceState` (a reload never runs the step again, and the code never stays in the address bar), and for the word
  `finish` calls `google.connect` once with the code and the state. The words `denied`, `failed`, `old` and `not_ready` show their sentence, and the Connect
  button stays. A refusal of `google.connect` shows the words of its reason inline (no toast).
- Disconnect asks first: Keep has the focus, and Disconnect sits at the start side (`me-auto`). It has no Undo: Connect is the way back. The calendar "Madar"
  stays in Google. The words are in `src/i18n/real/gcal.*.json`. The privacy page (`public/privacy.html`, `src/app/privacy.test.ts`) says what a disconnect does.

## Browser push in the screens (owner, 2026-10-08)
- The push line (owner, 2026-10-21, "Like WhatsApp"): `push.register` takes the keys of the browser (`keysOf`, from
  `subscription.toJSON().keys`), and `syncThisDevice` saves a listed device again when `push.mine` says `hasKeys: false`. A browser that
  gives no keys never loops. `public/sw.js` shows the line of the push (`lineOf`; the fixed line for an empty push or a line it cannot
  trust) and keeps its link in `data.url`; a press moves an open window there (`navigate`) or opens a new one, and `safeUrl` keeps every
  link a path of this site. The bell sentence lives in `lib/noticeSentence.ts`, shared with the server (`server/push/CLAUDE.md`).
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
- No notice while Madar is in front (owner, 2026-10-23, fbk_028): `public/sw.js` shows no line when a window of Madar is visible and has the focus, in
  Chromium only. Firefox and an engine that is not known show it. WebKit (Safari, and every browser on an iPhone) revokes the subscription of a site that gets a push and shows no notice, so
  there the line always shows, as the first thing the worker does. An engine that is not known shows it too. Record and reasons: `server/push/CLAUDE.md`.
- Push is on by default (owner, 2026-10-09). A browser lets a page turn push on only after a tap on Allow, so each new device gets
  one ask: `features/home/PushAskCard.tsx`, a small card under Today on Home with one short line and one button (not the main
  button; `canAsk` in `push.ts`). Any answer ends the ask; a closed question leaves it. The permission then stays in the browser, so
  `syncThisDevice(api, key, userId)` turns push on again by itself when the permission is granted and the browser holds no
  subscription (after a sign-out, or for the next person on a shared browser). It never asks the question.
- Only a person who turned the switch off stays off. `usePushDevice` keeps that choice in localStorage for each person
  (`madar.pushOff.<user id>`, `isPushOptedOut` and `setPushOptOut` in `push.ts`), sets it before the turn off, takes it back when
  the turn off fails, and clears it at a turn on. The ask also stays away from that person. The choice is never on the server.
- The Home Screen (owner, 2026-10-20), until the store app comes: `PushAskCard` shows one of three cards, in this order. (1) The
  push ask. (2) On an iPhone or iPad in a browser tab (`needs_install`), the 3 steps to the Home Screen, with no button: Apple lets no
  page start the install, and a Home Screen app keeps its own storage, so step 3 says to sign in there. (3) On Android, after the
  first push check, one button "Add to Home Screen" when Chrome offers the install. `src/app/remote/install.ts` keeps the
  `beforeinstallprompt` event (Android only, so a computer keeps the install icon of Chrome) and stops the bar of Chrome; `main.tsx`
  starts it before the first screen. The tap calls `promptInstall` first. Chrome gives the event once, so any answer ends the card.

## The project pin and the map (owner, 2026-10-18, fbk_017; the free map since 2026-10-19)
- `src/features/map/`: `MapCanvas.tsx` is the one MapLibre wrapper, `PinPicker.tsx` the one field of the pin, `PinSheet.tsx` the sheet
  around it (Cancel and "Use this place"), `ProjectPin.tsx` the pin of a project, `mapStyle.ts` the Madar style.
  `src/lib/geo.ts` reads a pasted link or a pair of coordinates. The form field "Location" (`LocationField`) is in `ProjectFields.tsx`.
- **Zero cost (owner, 2026-10-19): a map service has no account, no key and no bill.** OpenFreeMap (tiles and glyphs) and OpenStreetMap
  Nominatim (the place search) pass. `mapStyle.test.ts` pins the one host in the style. A paid or keyed service (Mapbox, Google Maps JS,
  MapTiler, Stadia) never goes in. The own map file (`functions/map`, `server/http/pagesMap.ts`, `scripts/map/build-basemap.sh`) stays in the
  repo as the later option; no screen uses it.
- **The one exception: the satellite view (owner, 2026-10-20).** No free service with no account has pictures sharp enough for a plot, and
  Esri's terms ask a business for an account, so the maps use Madar's own key of the office's Esri account (ArcGIS Location Platform,
  2,000,000 basemap tiles a month at no cost, shared with Kutla; the key ends on 2027-10-19, renew it before). The browser never asks Esri: one of its edge addresses never answers from Saudi
  networks (measured by Kutla, 2026-10-12). The style (`satellite.ts`) asks `madar-satellite://tile/{z}/{y}/{x}`; the loader (`addProtocol`)
  fetches our own route `/satellite/<z>/<y>/<x>` with the sign-in token (`app/remote/tileToken.ts`, set by the bootstrap). The route
  (`functions/satellite`, `server/http/pagesSatellite.ts`) checks the person and adds the key (the Pages secret `ESRI_KEY`, never in a page
  or a file) and the referrer that the key allows (`https://madar.vado.sa`, for both copies). `VITE_MADAR_SATELLITE=on` in `config/remote.<env>.env` shows
  the button; without it, no button. `MapCanvas` puts one small button in the top start corner of every map ("Satellite", then "Street map");
  the choice stays for the next map (`madar.mapLayer` in localStorage). "Powered by Esri" shows beside the credit button while the pictures
  show (Esri's rule; the sources sit behind the "i"). An error of the satellite source before its first tile (no key, signed out, Esri down)
  goes back to the street map with one line and hides the button. The CSP needs no Esri host. Esri's terms forbid stored copies of its
  pictures: never keep a tile on our side.
- The style is written by hand for the OpenMapTiles layers: `MAP_COLORS` are tokens (`mapStyle.test.ts` checks it), labels follow the language
  of the screen (`name:ar` first in Arabic), no points of interest, glyph stacks `Noto Sans Regular` and `Noto Sans Bold` (both hold the Arabic block).
- The Arabic text plugin is a file of this build: `MapCanvas.tsx` imports `@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url` by a path
  into `node_modules` (the package lists only `src/index.js` in its exports). Its WebAssembly needs `'wasm-unsafe-eval'` in `script-src`
  (`config/headers.template`). Never load it from a CDN.
- MapLibre loads only in the real build. `PinPicker.tsx` folds the flag with `import.meta.env.VITE_MADAR_API === 'remote'` itself
  (as `main.tsx` does): `REMOTE` from mode.ts does not fold, and the prototype would keep the map code and its stylesheet.
- The worker, the plugin and the stylesheets come from the lazy loader in `MapCanvas.tsx`. The worker is a `?worker&url` import (it needs its own
  imports bundled). `check-bundles.ts` fails a prototype dist or a first load that holds the `maplibregl-` marker.
- The worker obeys the policy header of its own file, and a browser keeps an assets file for a year. `releaseUrl` adds the release
  (`VITE_MADAR_BUILD`) to the worker address, so a policy change reaches the worker at the next release (2026-10-19).
- The map box is `dir="ltr"`: MapLibre places pins, cards and controls left to right, and an Arabic page (`dir="rtl"`) put them far away.
  The card of a pin sets the language direction again.
- A pin is a React tree in a MapLibre marker (a portal): `ProjectPin` is the project tile with a ring, and the status shape on Late and At risk
  only. A press opens the card next to the pin (a MapLibre popup) on a computer, and a sheet on a phone or when the map did not load.
  When the map cannot start or the tiles do not come, the box shows the one line "The street map is not ready yet."
- The pin picker is one field: a link or two coordinates are read at once, a name is searched on Enter (OpenStreetMap, one search each second,
  and one second search with a shorter name when nothing is found). A pair outside Saudi Arabia (`inSaudi`) sets no pin and offers "Swap them".
  A short Google Maps link goes to the Pages Function `/maplink` (`server/http/pagesMapLink.ts`), which follows the redirect; when it fails the
  field says to paste the full address. The prototype has no server and no search.
- The place is one record: the pin. A saved location link that holds coordinates inside Saudi Arabia sets the pin in the same save
  (`saveLinks` in `src/api/handlers/projects.ts`). Old data with no pin (`geo` undefined, never null) shows the place of its location link
  (`pinFromLinks` in `src/api/views.ts`); a removed pin is null and stays removed. The About panel gives "Open in Google Maps" from the pin.
- **The Location text is the address of the pin (owner, 2026-10-19).** A project has one place, so the form has one field, "Location"
  (`LocationField` in `ProjectFields.tsx`), and no free-text Location. It shows the address, or "Pinned on the map." when the pin has no
  address, or "No location yet". An old project with typed text and no pin shows its text until someone sets a pin ("Remove" clears it).
  The pin sheet hands over the point and its address: `PinSheet` `onUse(point, address)`. The address is the name of a search hit, else
  one lookup at OpenStreetMap Nominatim when the person presses "Use this place" (`addressOf` in `src/lib/placeAddress.ts`; never while the
  pin moves). A pin that did not move keeps its address (`address` prop). A failed or slow lookup (5 s) gives '' and the pin still saves.
  The prototype has no lookup: `addressOf` gives '' there, never raw numbers.
- One write: the form, the Dashboard map and the link sheet send `geo` and `location` together in one `projects.update` (or one
  `projects.addLink` / `updateLink` with `location`), so one Undo takes both back. The server clears the text of a pin that moves with no text
  (`src/api/CLAUDE.md`). `LinkSheet` in `src/features/project/files/ProjectLinks.tsx` looks up the address of a location link before the save,
  only when the link moves the pin and the person may edit.
- **The Files & Links tab (owner, 2026-10-19).** The project tab `?tab=files` keeps its key and shows "Files & Links". The links of the project
  (`ProjectLinks`, with the model folder) sit above the files. The About panel does not show them. One "Add" menu button (`Menu` with
  `text` and `align="start"`) offers "Upload a file" and "Add a link"; "Add a link" opens the same `LinkSheet` that edits a link. Who sees
  the button is `viewerCan.post`, for both choices. With no file and no link the tab shows one empty state, and the Add button sits in it
  (never twice). A link with the kind Location still sets the pin, as above.
- **One gate for Nominatim.** `src/lib/nominatimGate.ts` (`gated`) runs every request to Nominatim one at a time and at least 1 s after the
  last start, for the place search and the address lookup together. No header and no referrer of our own (`Referrer-Policy: no-referrer`).
  A test that sends a search calls `resetGate()` first. The About panel shows the address, then "Open in Google Maps"; with a pin and no
  address it shows the link alone.
- The Dashboard has a Map tab (`src/features/dashboard/DashboardMap.tsx`, `MapPinCard.tsx`). It reads `projects.list` with the Leader, Client and Team filters, and folds the flag itself as `PinPicker.tsx` does. In the prototype it shows the pinned list and the note "The map works in the real Madar.", and no map. A person who may not edit an unpinned project sees its leader.
- The credit of the free map is the small MapLibre button inside the map (`AttributionControl`, `compact`, `MAP_CREDIT` in
  `MapCanvas.tsx`), never a line under it (owner, 2026-10-19). It starts folded to the "i" (`foldCredit`); a tap opens it. Never
  remove the button: the data is free only with the credit (ODbL).
- `fullscreen` on `MapCanvas` adds the MapLibre full screen button beside the zoom (the Dashboard map and the project map). A
  browser with no full screen (iPhone) fills its window instead.
- The About panel shows the pin at its top, in place of the cover picture (owner, 2026-10-19: "the map is better";
  `features/project/overview/ProjectPlace.tsx`, a `compact` map), only in the real build and only when the project has a pin. The cover
  still shows on the Open space cards.
- The real build's pin picker has a place search (`src/lib/placeSearch.ts`). It asks OpenStreetMap (`nominatim.openstreetmap.org`) only on Enter, never while the person types.

## Data on screens
- Screens call `api.call(name, input)` through `useCall` (reads) and `useAction` (writes) in `app/runtime.tsx`.
- `app/readMap.ts` says which change kinds each read reads. The remote build keeps answers until a change signal names
  them (`app/signals.ts`, `app/remote/channel.ts`). An answer that no screen shows stays for an hour (`keepAnswers`,
  `app/runtime.tsx`). A read of rule scope 'none', `search.query`, and an answer that a change marked go 5 minutes after
  their last screen closed. Every unseen answer goes when the office day changes.
- A read that starts to read a new collection needs that kind in its `readMap.ts` line (2026-10-20: the chat reads read
  `preferences`, the Admin's "What reaches me"). `readMap.test.ts` fails without it. Check the tests that use that kind as one a
  read does not read (`signals.test.tsx`).
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
- The project To-dos tab asks `taskTemplates.list {}` once, with its `tasks.list`, under the gates of the menu (list view and
  `createTaskForSelf`). Each `TemplateMenu` keeps the templates of its stage with `lib/sameText.ts`, as the handler does.
- In the real build, a picture hook (`useFileLink`, `useScreenshotLink`) keeps its signed link in the cache for
  `LINK_STALE_MS` (8 minutes) after the screen closes. The row pictures (Files rows, the meeting drawings, the report
  thumbnails) have `loading="lazy" decoding="async"`. A sheet or preview picture does not.

## Sub-companies, the Open space and the people stack (review 2026-10-19)
- A sub-company logo sits on a white plate (`LOGO_PLATE`, `SubCompanyLogo.tsx`) in both themes. The badge of `ProjectTile` is 18 px at
  least and has a `title` with the name. The tile loses a circle 2 px wider than the badge (`tile-cut` in `tokens.css`, a mask), so the
  surface under it shows around the badge and no ring of one color draws an edge (owner, 2026-10-20). The badge box is a flex box: an inline
  box took the height of a text line and drew the old ring as a pill. The badge shows wherever a project picture shows and the data has `subCompanyId`: the lists
  of `projects.list`, the Dashboard cards (`dashboard.get` refs carry `subCompanyId`), the meeting, the map list, the Open space.
- A new logo gets a frame step (`LogoFrame.tsx`): drag, zoom, and a preview at 18, 22 and 28 px. The crop (`PictureCrop`, `cropPlace`,
  `cropPreview` in `lib/picture.ts`) feeds both the canvas and the CSS preview. The frame itself is the shared `components/PictureFrame.tsx`
  (drag, arrow keys, the zoom slider, `CropCircle`); the logo and the profile picture each give it their plate, words and preview row.
- A new profile picture gets the same frame step (owner, 2026-10-23, fbk_029). Choosing a file in Settings opens `AvatarFrameSheet.tsx` (title "Frame
  your picture", Cancel and Save), no longer a save at once. It starts as the centre square (`fillCrop`, `start="fill"`: the picture fills the circle, as
  before the frame existed), so a person who presses Save gets what they got before. Previews are round at 72, 40 and 24 px (Settings, the chat
  header, the bubbles) on the glow of the person (`glowOf`). Save makes the 128 px picture once from the frame (`pictureOf(file, { crop })`), then
  `me.updateProfile` saves it with the Undo toast as before. A picture the browser cannot load closes the step and shows the old line; a picture that
  does not fit 16 KB keeps the step open with the old line. The welcome step and the Admin forms have no picture upload. `buildSeed` has no sub-company: the prototype adds two
  (`data/sampleSubCompanies.ts`, called by `bootstrap` and `sampleOffice`). A saved prototype office keeps its data until "Reset sample data".
- The project form shows 2 to 5 sub-companies as one row of logo choices (`SegmentedControl` with `icon`), more than 5 as a select. A
  new project starts with the only sub-company, or the one of the last project of the same client, until the person taps.
- The Dashboard filter, the Projects filter, the task lists, the meeting and the Open space read `subCompany` in the link (`useScope`,
  `app/useScope.ts`, names it in a subtitle). The Projects filter has "No sub-company" (`filter=no_sub_company`, a data gap).
- Open space (`features/space/`): one project open at a time, and the view follows the open (fitView with `nodes`). A person in focus
  opens every project and stage where the person works (`focusPlan`). A task card opens the task panel over the map (`?task=&project=`).
  `CARD_HEIGHT` in `spaceTree.ts` is the measured height of each card kind (offsetHeight in a browser): measure again after a card change.
  The first view fits the office and 4 projects (a phone: 3 projects, no office). The name stays "Open space" (the team's own word).
- `AvatarStack`: one hidden person shows as a picture, never as "+1". "+N" names the hidden people on hover and in `aria-label`.

## Routes and shell
- Routes (`app/routes.tsx`): `/` Home, `/projects`, `/projects/:id` (tabs overview, tasks, activity, tracker, schedule,
  files, team), `/work` (Tasks), `/meetings` (the second view of Tasks), `/dashboard`, `/dashboard/meeting` (full screen), `/dashboard/space` (Open space, full screen, read only), `/inbox`, `/notifications`, `/search`,
  `/settings`, `/admin` and `/admin/:section`. Remote only: `/sign-in`, `/welcome`, `/forgot`, `/reset`, `/oauth/consent`.
- Admin: a grouped side list, one section at a time. The sections, their groups and roles are in one registry,
  `features/settings/admin/sections.ts`; a new section is one line there. A section with `right` opens for each person who holds
  that right (owner, 2026-10-18, fbk_014): `sectionsFor` reads the viewer, and `opensAdminPage` (`api/rights.ts`) decides the person
  menu. The Roles section is the Admin's only: `RolesSection.tsx` is one row for each role (people and rights), `RoleSheet.tsx` is the sheet of one role (people, names, switches, Save role, Delete with a move). A desk opens the first section at `/admin`; a
  phone shows the list there. An unknown or forbidden section goes back to `/admin`.
- Project templates: the Admin section (`ProjectTemplatesSection.tsx`) and "Start from a template" in the new-project form
  (`features/projects/TemplateUse.tsx`, `templateForm.ts`; the picker sits right under the Name, and the people of the roles are ticked
  and locked in the Team list). A chosen template takes the place of the stage list and makes the start date required. The ticks "Can
  stretch" stay folded. The dates come from `lib/projectPlan.ts`, as on the server. The row menu has Duplicate (`duplicateDraft`); the
  update item and the follower count are for the Admin and for a role with `templates.updateProjects` (the calls ask that right). A person with only
  that right sees the section and a row menu with the update item alone.
- The template editor (`ProjectTemplateEditor.tsx`, ADM-06): a full-screen sheet (`Sheet full`) on a desk. The timeline (`TemplateGantt.tsx`)
  is the main view, with one row for each stage and task; a press on a row or a bar picks it, and `TemplateDetails.tsx` shows its fields
  beside the chart (a Sheet on a phone, with `TemplateList.tsx` as the rows). The editor works on a text draft (`templateDraft.ts`):
  a stage start moves its tasks by the same days (`moveStageStart`, on blur), a new wait that points back moves the waiting part
  (`addWait`, with an Undo toast), a save problem names its part and field (`draftProblem`), and Cancel, Escape and the close button ask
  "Discard the changes?" when the draft changed (a control with `data-autofocus` takes the focus in a sheet).
  The details of a task have a **Stage** field under the title (fbk_031, owner 2026-10-23: a person could not pick the stage of a task, new or old).
  `moveTaskToStage` (`templateDraft.ts`) has one rule: the move changes the stage and nothing else, so the days of a task stay where they are and the
  waits stay true; a note under the field says when the days are outside the own days of the new stage (`taskOutsideStage`; the stage panel keeps
  its notes `tasksEndDay` and `startsBeforeStageAbove`). The one exception is a task that Add task just made and the person has not touched
  (`DraftTask.fresh`, set by `addTask`, cleared by `touchTask` when the person or a bar of the chart sets its days; a task with a wait is never
  placed again): it goes where Add task would put it in the new stage. The list stays grouped by stage: the moved task goes after the last task of
  its new stage. `fresh` lives in the draft only; `draftInput` and `draftOf` never carry it.
- Apply a template (owner, 2026-10-19, fbk_020): "Apply a template" in the "More actions" menu of the project header
  (`features/project/ApplyTemplateSheet.tsx`), for `viewerCan.edit` (the leader and the Admin) on an active or paused project. Step 1 is a
  list of the office templates (name, stages, tasks); one press opens step 2, `LinkProjectSheet` in `mode="apply"` over it (same matching,
  "Add them to the project" chosen, main button "Apply template", Undo toast). A project that follows a template shows one line and a confirm
  tick before the list works; the new template then replaces the link (`replace`). The sheet says the lead rule and the dates of the new
  parts in two short lines, from `shiftAdded` (the server uses it too). The Admin's Link in Project templates uses the same sheet in
  `mode="link"` (start choice "Leave them out") and the same dates and lead rules.
- The update of linked projects (`TemplateProjectsSheet.tsx`, `SyncSteps.tsx`): pick the projects, then one review screen with one tick
  for each kind of change and a line for each task (old value, new value). The main button runs only the projects that change and the
  sheet closes with the toast "Updated 2 projects. Undo". After a save of a followed template the toast offers "Update them"
  (`reviewAll`). A person who is not the Admin sees "Office" (not "Admin") as the title of the page.
- Shell (`app/AppShell.tsx`): a floating tab pill (Home, Projects, Tasks, Dashboard, Inbox, plus Search and the bell; top
  on desktop, bottom on a phone; on a phone the tabs show icons only, and the word of each tab stays `sr-only` below
  640 px, owner 2026-10-08; each phone tab is 48 px high with its 24 px icon in the centre, the open tab is a round pill, the
  bar sits 16 px from the sides and the bottom, and the Inbox count sits on the icon, owner 2026-10-20), the Madar mark at the top
  start (a press opens Home), the person menu. No sidebar.
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
- The project To-dos tab (feedback fbk_005 and fbk_006, 2026-10-11, `features/project/tasks/`): the "+" before "Add a to-do" opens
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
  Everyone sees all projects. Payments only for the payment right (by default Admin, Management, Accounting; fbk_014). Agents never join a team. The person who adds a
  project task changes and deletes it like the leader while on the team; the review stays with the leader (owner, 2026-10-07).
  Only the Admin changes a role. Management reads the role of a person as text in the person sheet (owner, 2026-10-18, fbk_014).
  The role sheet shows 17 rights in 7 sections (`RIGHT_SECTIONS`, `permissions.ts`): a heading, an All switch for a section of two or
  more rights, and one switch for each right. The Admin sections of sub-companies and requests and bugs open for `subCompanies.manage` and
  `feedback.manage`; the project templates open for `templates.manageAll` or `templates.updateProjects` (`alsoRights` in `sections.ts`).
  The words are in `real/rolerights.*`. A role with many rights shows only the count in the person sheet (`roles.line.many`).
- Home (`features/home/`): the day ring shows its words, "11 of 14 done today" (owner, 2026-10-19, fbk_026); the text wraps under the date on a
  narrow phone. The Today panel lists my tasks due today or past due. With none, it is "Coming up": my next 3 open
  tasks with a due date (`comingUp`, `lib/home.ts`, owner 2026-10-07). With neither, it says that nothing is due today. Home
  follows the shared order of the Tasks screen (`api/CLAUDE.md`).

## Reminders, No lead and quiet lines (owner, 2026-10-19; fbk_024, fbk_025, fbk_027)
- The paused banner (`features/project/PausedBanner.tsx`) says "Restart reminder on <date>." before the day, and after it "Planned restart was
  <date>. Resume the project or set a new date." in the Attention color, with Resume project and one quiet field "Set a new date"
  (`DateDraftField` with `emptyText`, `min` tomorrow, `projects.setRestart`, a toast with Undo). Only a person who may resume sees it. The
  pause sheet names the field "Remind me to restart on" with one hint line. Never write "Restarts": Madar restarts nothing (`api/CLAUDE.md`).
- The Workload table has a "No lead" row first (`features/dashboard/Workload.tsx`) with a dashed empty mark in place of a face. It shows only
  when it holds a task. The Task list says "Due until <day>" for a range with one end (`taskList.dueUntil`).
- A reason of a date move, of a reopening and a Madar shift is a quiet line, never a bubble (`features/comments/ReasonLine.tsx`, one sentence
  for the task panel, the Inbox thread and the Inbox preview). In the task panel it is a grey line with its age, the moved dates under it, and
  an Edit menu for the author of a date reason only. In the Inbox thread it is one centered grey line (`Bubble.reason`, `ReasonLineItem`), as
  a group line is. The sentence keeps the name and the reason between FSI and PDI (`\u2068`, `\u2069`).

## Chat messages (track msg, 2026-10-19)
- One small menu for each message (`features/inbox/MessageMenu.tsx`). On a computer a "..." button (`MessageTools`, a `Menu` with a `head`) sits in the
  side spot (`data-part="side"`) of the row and shows on hover or focus, never on a touch screen. The `head` of `Menu` is the row of the three
  reactions (`role="menuitemcheckbox"`); a press on one closes the menu. On a phone a long press of a finger (`longPress.ts`, 500 ms, 10 px) opens
  `MessageSheet` (a `Sheet`: the preview, the reactions, the items, "Copy text"; no Copy item where the browser has no clipboard).
- The handlers of a bubble reach `MessageBubble` through `BubbleActionsContext` (`bubbleActions.ts`), never through a `MessageLog` prop. The ChatPane
  and the TaskPane each give one stable object (`useMemo`). A task thread names its menu "Actions for this comment"; a person who may not post sees
  plain pills and no menu. Reaction pills (`ReactionPills.tsx`) are 28 px high with a 44 px press area; the names come in `title` and, after a long
  press, in a `role="tooltip"`; the pill of the reader has the ring; no faces.
- Reply: the menu item "Reply" (first in the list, also in the phone sheet) puts `ComposerReplyStrip` above the field of the box (the name, the first line
  and an X; Escape in the field with no open mention list drops it too) and moves the focus into the field. The next send passes `replyToId` (`chats.send`
  or `comments.create`) and clears the strip. The sent bubble shows `BubbleReplyQuote` above its words (the name and the first line, or only "Deleted message").
  A closed chat has no Reply (`canReply`). The server names the author of the old message (`api/CLAUDE.md`).
- Edit and delete (own messages only, `Bubble.canEdit`): the menu shows Edit and Delete (red) after Reply (after "Copy text" on the phone sheet). Edit
  puts `MessageEditForm` in place of the words (`EditingContext` holds the id; Enter saves, Escape cancels; Save is a secondary button) and the box
  gets the focus back at the end. The Up key in an empty box with no picked file opens the edit of the newest own bubble (`Composer` `onEditLast`).
  The box has `field-sizing: content`, so an empty box takes the height of its hint. On a phone (`useIsPhone`) the hint is `chat.placeholderPhone`
  ("Use @ to mention." / «اكتب @ لذكر أحد.»), one line at 360 px. Keep the @ tip in every hint: a project chat pushes only the people that a
  message names.
  Delete asks nothing: `useDeleteMessage` (`deleteMessage.ts`) calls `chats.deleteMessage` and shows the toast "Message deleted." with Undo (the same
  call with `deleted: false`); a task comment keeps `comments.update` and `useUndoable('comments.delete')`. `useEarlierMessages` keeps a message that
  left the newest page only when it is older than the oldest message of the new page, so a deleted message does not stay after "Earlier messages".
- Instant send (`features/inbox/outbox.ts`, a chat and a task thread in the Inbox): a send adds an entry to the outbox and clears the box at once; the log
  draws it as a faded bubble (`Bubble.status` "pending", `aria-busy`) with no menu. The saved message takes its place: `matchOutbox` pairs an entry with the
  saved message of the person that has the same words and was not in the log at the send (or with the message of the answer id), one to one, oldest first,
  so a change signal that comes before the answer shows the message once. The saved bubble has `fromOutbox` and skips its rise. A send that fails (code
  `failed`) shows "Not sent" in the error color with "Send again" (`useAction` `retry`: the same input and the idempotency key of the failed attempt, so
  nothing goes twice) and no toast; a refusal still shows its toast, and a failure after the pane closed shows the toast with Retry as before.
- A press on a reply strip goes to the old message (B15): `BubbleReplyQuote` is a button (the name and the first line, 44 px high) when the old
  message is live and the pane gives `BubbleActions.focusMessage`; the strip of a deleted message stays plain text. The ChatPane and the TaskPane hold
  `focusId` and pass `focusId` and `onFocused` to `MessageLog`, which puts the old message in the middle and frames it for one second (`FRAME_MS`).
- The task panel takes the chat look (B16, design item 6): `CommentThread` draws a task comment with `TaskComments.tsx` (by day, `MessageBubble` with
  `runStart` from `runs.ts`, the pills, the menu "Actions for this comment", its own `BubbleActionsContext` and `EditingContext`) and a post comment with
  `CommentItem.tsx` as before. A quiet reason line is still a `CommentItem` line (a grey line with its age and Edit). The comments stay in the scroll
  of the panel: no Newest button, no "New" line, no faded copy. A press on a strip there scrolls the old comment to the middle (`scrollIntoView`) and
  frames it. The box of a task holds `ComposerReplyStrip` and sends `replyToId`; the X drops the reply (Escape stays with the panel). `bubbles.ts`
  (`useBubbles`, `bubbleOfComment`) is shared by `TaskPane` and `TaskComments`.
- The bell says "X replied to you" for a mention notice with `reply: true` (`NotificationsScreen.tsx`): `notices.repliedDirect` in a direct chat,
  `notices.repliedGroupGone` in a group the reader left, `notices.repliedToYou` elsewhere. The link, the face and the row stay as for a mention.

## Inbox, groups and What's new (owner 2026-10-18; UX audit 2026-10-19)
- Inbox list (`features/inbox/ChatList.tsx`): a menu button beside the search shows one kind of chat (owner, 2026-10-20): All,
  Projects (project chats), To-dos (the threads of to-dos) and People (direct chats and groups). The button names the shown kind. The
  choice lasts: it stays after the Inbox closes, after a reload and for the next visit (owner, 2026-10-23; `usePersistentChoice`, key
  `madar.chatKind`, fallback All); the search and "Archived (n)" look only in
  that kind, and an empty kind says "No chats here.". "Archived (n)" is one quiet row under the search field, only while a chat is archived
  and nothing is typed. The archived view has a back arrow, the title "Archived chats" and its own search words. A search in the
  main list looks in every chat, and an archived match carries the word "Archived". A group matches by its name (only its members
  have its row). An archive and a move back show a toast with Undo (`archive.ts`, `useArchive`; `chats.archive` writes no event, so
  the Undo calls it again with the other value). The menu button of a row shows on hover or focus only (`pointer-coarse:hidden`,
  `max-sm:hidden`); on a phone or a finger a swipe on the row archives it. The menu button names its chat ("Options for <title>").
- No "Waits for your reply" line (owner, 2026-10-19 and 2026-10-20, fbk_028; it wins over item 22 of the chat design, whose waits rule stays in the
  API for `chats.waiting` and the agents): the Inbox does not call `chats.waiting` any more. In its
  place the menu of a chat has "Mark as unread" (`chatMenuItems` in `ChatList.tsx`: the row menu, and the menu in the header of the open chat, which is
  the way on a phone). It shows only for a chat with nothing unread that is not archived. The call is `chats.markUnread`; the toast "Marked as unread."
  has Undo, which calls `chats.markRead` (`inbox/markUnread.ts`, kept in `InboxScreen` so the toast stays when the open chat closes). The open chat
  goes back to the list. The chat is bold again, the badge counts it, until the person opens it again. `ChatPane` marks a chat read at its first look
  (the first fresh answer while the tab shows, design item 5), and after that only when a message is newer than the read time (`behind`), so a mark
  set on the open chat (from another device, or before the chat closes) stays, also when a hidden tab shows again. `useMarkTaskRead` marks a thread
  once for each new count of comments, and also sends the mark for a thread that the cached list shows as unread, so a thread whose newest comment
  is the own comment of the person ends it too.
- A group has one picture, `GroupPicture` (the glow of its id and a people icon), never a stack of faces. The header shows the
  count of people ("4 people") as a button; it and the picture open the People sheet (`GroupSheets.tsx`): names with "You" and
  "Group maker", Add people at the top, Remove on each other row for the maker (toast with Undo), Leave group at the end (a confirm
  sheet with Cancel in focus). The group menu holds Rename, Mark as unread and Archive, then the Notify me choice. A group of one person left reads a closed chat.
- Notify me (design item 21): the header menu of a project chat, a direct chat or a group holds, under Archive, the heading Notify me and two
  radio items (`useNotifyItems`, `NotifyChoice.tsx`), saved by `chats.setNotify`. A `MenuItem` takes `checked`, `heading` and `note`
  (`components/Menu.tsx`): a checked item is `role="menuitemradio"` with a check mark at its end. The row menu of the list and a task
  thread have no Notify me.
- The Admin's count (design item 23): the Inbox count and the badge of an Admin cover the project chats of the projects that the Admin leads
  or works on (the leader or a team member), plus every message that names the Admin. The other project chats stay in the list and open
  as before, and their row counts only the unread messages that name the Admin, unless the Admin picked All messages in the chat menu
  (`countsNamedOnly`, `chatState.ts`). Because such a row can count 0 while plain messages are new, `ChatPane` marks the chat read on
  open when its newest message is newer than `readUpTo` (`behind`), not only when the count is above 0.
- What reaches the Admin (owner, 2026-10-23): one choice for a person with the Admin role, `Preferences.adminReach`, in Settings
  (`settings/AdminReachSection.tsx`, "What reaches me", before the notification switches; three radio choices, saved at once by
  `me.updatePreferences` with a toast). Read it only with `adminReachOf` (`chatState.ts`): a missing value means `mixed`, and any person who is
  not an Admin reads `mixed` whatever is stored. `mixed` is item 23 above, with no change. `mine` ("Only my work") leaves the project
  chats with the role `other` out of the Inbox list and the badge (`hiddenByReach`); such a chat still opens (a link, a search, a notice, the
  project page), and a message that names the Admin still gives the bell notice. `all` ("Everything") counts every message of every
  project chat (`countsNamedOnly` takes the choice as its fourth argument) and makes copies for the bell (`src/api/CLAUDE.md`, "Copies
  for the Admin"). The push of a chat message does not follow the choice: it keeps `levelFromRead` and the default "named" of a project
  chat. The agent of an Admin follows the choice of its person, and cannot set it. The base word tree has no type for the track words, so a
  test reads `adminReach.*` through a cast.
- New group (`InboxScreen.tsx`): the title says "New group", a line counts the people, the name field shows from the start and is
  optional (an empty name takes the first names), and one full-width button makes the group.
- Every chat takes files (owner, 2026-10-19). The box of a project chat uploads into the files of its project. The box of a direct chat
  and of a group uploads into the chat itself (`UploadTarget.conversationId`, `ConversationPane.tsx`), with the same attach button and
  the same limits. A chat file shows in no Files tab and no search.
- Paste and drop in the comments of the task panel (fbk_030 and fbk_032; the chat part is design item 14 of the chat batch, which won at the
  join of 2026-10-20): `CommentThread.tsx` wraps its section in `ChatDropArea` with `className="relative"` (no flex item, so the panel keeps
  its layout) and the note of a project task or an office task; `DropReceiver` registers the box with `useChatDropReceiver` where the person
  may post. A paste uses the one rule of the chat box, `pastedPictures` (`features/files/Attachments.tsx`): a paste that holds text stays
  text, a paste of only pictures adds them. `useBlockFileDrop` (`Attachments.tsx`, called by `InboxScreen` and `CommentThread`) stops the
  browser from opening a file that is dropped anywhere else, with or without an open chat, and sets the cursor to "not here" there. It leaves
  a drag that a drop area took first (`defaultPrevented`), so `ChatDropArea` keeps its "copy" cursor and its drop.
- `/inbox/<id>?at=<msg_ or cmt_>` opens the chat at that message (chat design 2026-10-19, item 17): `ConversationPane` reads the mark
  (`messageParam`) and keys each pane by id and mark, so a new mark opens a new pane. A chat asks `chats.messages` with `around`; a window
  of an old message ends with a plain "Show newer messages" button (`NewerMessages.tsx`), and a send from a window goes to the newest page
  (`navigate(chatLink(id), { replace: true })`). A window page holds at least 220 messages, so the Earlier messages control shows by the
  size rule of `useEarlierMessages`. The ChatPane and the TaskPane start `focusId` at the mark (`focusFromRoute`), so the opened message goes to the
  middle and wears the soft frame once; the query keeps `around` after the frame. A press on a reply strip (`focusMessage` of the ChatPane) frames the
  old message when it is in the loaded pages, and else navigates to `chatLink(id, target)`, the page at that old message.
- Shortcuts to a chat (chat design 2026-10-19, item 18): the person sheet of Search has a grey Message button (`PersonSheet.tsx`) that calls
  `chats.openDirect` and opens `/inbox/<id>`; the own person and an agent have none. The project page header has a grey Project chat link
  (`ProjectHeader.tsx`, `ProjectDetail.chatId`, null for a person who may not open the chat). Both use the message icon and the secondary
  look, never the navy main button.
- Search has a Messages group, last (`features/search/MessageHits.tsx`; chat design 2026-10-19, item 16): the newest 5 messages and task
  comments with every word (a word of 3 letters or more). A hit shows the chat picture (32 px), the chat name, the person ("You" for the
  own line), the line with each matched whole word in a grey `<mark>`, and the date; a press opens `/inbox/<id>?at=<message>`. The words
  of the hit fold as the server folds them (`lib/searchMatch.ts`), so an Arabic word marks across letter forms.
- A picture in a chat bubble or a task comment shows as a preview (owner, 2026-10-19). `AttachmentList` (`features/files/PictureAttachments.tsx`)
  replaces `FileChips` in `Thread.tsx` and `CommentThread.tsx`: a picture (`Attachment.mimeType` and `usePictureTest`) is a small rounded
  picture, at most 240 px wide, from the thumb link (`useFileLink(..., 'thumb')`); two or more sit in a grid; every other file stays a chip.
  The box holds its place while the picture loads (the last known shape in `SHAPES`, else 4 to 3), the picture has
  `loading="lazy" decoding="async"` and asks for its link only within 400 px of the screen. A picture that breaks, or that the store keeps
  as a download (an SVG in the real build), shows as a chip. A press opens `ImageViewer` (`components/ImageViewer.tsx`): the picture on a
  dark backdrop, the file name, an X, a Download button, Escape and a press on the dark space close it, the arrow keys follow the page
  direction between the pictures of one message, and the focus returns to the preview. A message of only pictures leaves out the file names
  that the box put there as its words (`photoOnlyBody`). `MessageLog` keeps the newest message in view while a picture grows its box.
  Posts and the Tracker keep `FileChips`.
- The quiet lines of a group (`Conversation.log`, `ChatThread.lines`) draw as one grey centered line between the messages
  (`GroupLineItem` in `Thread.tsx`), in the screen language. They are no messages: never unread, no push.
- The mention list of the Inbox box opens above the box (`MentionField placement="above"`) and ranks the names that start with
  the typed letters first (`rankedMatches`, `lib/personName.ts`).
- What's new (`whatsNew/entries.ts`): an entry may have `right` (the page shows it only to a person who holds it, by `can()`) and
  `to` (one quiet link "Open"). An entry newer than the last one the person saw has the word "New". The person menu shows the word
  "New" after the item, and Home ends its date line with the link "See what's new", until the person opens the page. There is no dot
  and no bold item.

## Chat reading (track read, 2026-10-19)
- Runs (`features/inbox/runs.ts`): the messages of one person within 5 minutes of the one before form a run; a new day, a quiet line, another person, an agent message or the New line starts a run. A next message shows no face and no name; its time sits in the side spot (`data-part="side"`) at opacity 0 until hover or focus.
- Names you: `MessageView.namesMe` and `CommentView.namesMe` (a mention or a reply to you) give another person's bubble `bg-mention-bg`, a 3 px `bg-mention-bar` on its start side and the hidden sentence `chat.namesYou`.
- Keep my place (`MessageLog`, `logScroll.ts`): a new message moves the log only when the reader is in the last 80 px or sent it. Else the round Newest button shows (sticky inside the log, `aria-live="off"`), still, with no count.
- New line (`newLine.ts`): the pane keeps the read state of the first fresh answer (`useOpenMark`) and shows the log only then. A chat places the line by `ChatThread.readUpTo`, a task thread by the unread count of its `chats.list` row. The line goes when the person sends. The mark read goes only after the mark exists, so a stale cached answer never clears the unread count first.
- Open at one message: `MessageLog` `focusId` centers that bubble (by `data-message-id`), frames it for 1 s (`FRAME_MS`, `data-framed`) and calls `onFocused` once. Tracks msg (reply strip) and find (notices, search, the route) pass it. At the open the focus message beats the New line, and the New line beats the bottom.
- Read only while you look: `ChatPane` and `useMarkTaskRead` mark read only while `usePageVisible()` (`app/usePageVisible.ts`) is true. A task thread is marked once for each new count of comments. A hidden tab only marks the lists (`app/signals.ts`), so a message reaches an open chat in a hidden tab only when something else loads it; a test that needs that loads the chat itself with `queryClient.refetchQueries`.
- Links (`segmentsOf`, `RichText`): an `http://` or `https://` address is a link with `dir="ltr"` and `break-all`; an outside address opens in a new tab with `noopener noreferrer`. The marks of the sentence at its end (`. , ; : ! ? ' "`, the Arabic comma, semicolon and question mark, `»`, `]`, `}`) and a closing bracket the address did not open stay out of the link.
- Drafts (`app/drafts.ts`): the text of a draft lives in localStorage for each person, so it stays after the tab closes. A sign-out (`keepDraftsOf('')`) and a change of person clear both stores. A draft of the old session store moves to localStorage on its first read. Picked files stay in memory only.
- On a phone (`useIsPhone`) Enter in the chat box adds a line; the Send button sends.
- A cut title: the `<bdi>` itself is `block truncate`, never its parent, so a title in the other language cuts at its end (`Header` in `ConversationPane.tsx` takes a plain string).
- Upload progress: `CallMeta.onProgress` reaches `xhrPut` through the upload adapter (screen only, never on the wire; the small picture reports nothing). `useAttachments` keeps a whole percent for each file (`progress`), `PickedFiles` draws a 3 px grey bar for each file and locks Remove while the uploads run; the uploads still start at Send, and `onSend(body, fileIds, clear)` keeps its order.
- Drop and paste (`ChatDrop.tsx`): `ChatDropArea` wraps a loaded chat or task thread (and the comments of the task panel, see above) and shows its frame only while the box registered a receiver (`useChatDropReceiver`); it still stops the browser from opening a dropped file. Files go to the picked chips; nothing sends until Send. A paste with text stays text; a paste of only pictures adds them. Picked files wait in memory for each chat (`app/drafts.ts`), so a test that picks files calls `keepDraftsOf('')` after it.

## Meetings screens (owner, 2026-10-19, fbk_022)
- `/meetings` is the second view of the Tasks tab (`features/meetings/`, `MeetingsScreen.tsx`). The tab pill keeps 5 tabs: `isNavActive` keeps
  Tasks open on `/meetings`, and `screenKey` (`AppShell.tsx`) gives both views one entrance. The switch `WorkSwitch`
  (`features/work/`, a `SegmentedControl` over the address) sits in its own row under the title "Tasks", in `ScreenControls`
  (`components/`, owner 2026-10-23): the same row and the same space as the Filter button of Projects (20 px under the title block, 16 px above the list; the
  screen wrapper has no gap of its own). It picks To-dos (`meetings.switch.todos`, Arabic «قائمة المهام») or Meetings. The one main
  button follows the view: "New office to-do" or "New meeting".
- Words (owner, 2026-10-20): "Tasks" now names the umbrella of to-dos and meetings. Only the tab (`nav.tasks`) and the screen title
  (`screens.myWork`) say "Tasks". Every other English text calls one old task a "to-do" (the project tab "To-dos", "Add a to-do", "To-do list").
  Only two Arabic texts changed (`meetings.switch.todos` and `project.tab.tasks`, both «قائمة المهام»): the Arabic «مهمة» covers both.
  Keys, calls, MCP tool names and code names keep "task".
- The view reads `meetings.list {from: today - 7 days, to: today + 60 days, mine: true}`. `groups.ts` makes Today, This week and Later (the week of
  the Tasks screen: on a Friday or a Saturday it is the coming Sunday to Saturday). The days before today are one folded row, "Earlier (n)".
  An empty list is one line. A press on a row opens the sheet with `?meeting=<id>` (`openMeeting`, `closeMeeting`, `meetingParam` in `lib/params.ts`).
  A notice and the Home card link to `meetingLink(id)` (`/meetings?meeting=<id>`).
- `MeetingSheet.tsx` has at most one main button, chosen by `mainAction` (`meetingLinks.ts`): "Join" (the place is one `https://` link, and the
  meeting starts in 30 minutes or less or is on), else "Open in Google Maps" (a site visit of a project with a pin; the pin comes from `projects.get`),
  else none. A cancelled or finished meeting has none. The footer of the sheet holds the buttons (owner, 2026-10-23, fbk_037, Faisal; the "..." menu is gone), in this order: "Cancel meeting" (`destructive`, at the start side with `me-auto`) or, for a
  cancelled meeting, "Delete meeting" in its place; then "Edit" (secondary); then the one main button. Each shows by `viewerCan` (`cancel`, `delete`, `edit`). The Sheet footer is `flex flex-wrap justify-end`, so on a
  narrow screen the row wraps and never overflows. Cancel asks first (Keep meeting has the focus), then a toast with Undo. "Delete meeting" (a cancelled meeting that the person may change)
  asks nothing for a meeting in no series: the call `meetings.delete`, the sheet closes, and the toast "Meeting deleted." offers Undo (the meeting comes back). For a meeting of a series it opens
  `ScopeSheet` in mode `delete` ("This meeting" / "This and later meetings"; the second deletes only the later cancelled meetings); the toast says "Meetings deleted." for more than one. A meeting that the person may not see reads "This meeting is not available.", as one that does not exist. Use `now()` from
  `lib/dates.ts`, never `new Date()`: the tests fix the clock.
- `MeetingForm.tsx` plans and edits. Eight controls: Kind, Title, Project, Day, Time, Length, People, Where. The fold "More" holds Guests and Notes
  (no Minutes by: any attendee writes the minutes, owner 2026-10-19). A kind sets the length until the person chooses it (`kindDefaults`), and the place of a site visit
  starts with the address of the project. The edit form has no Project (`project_fixed`), sends only the fields that changed, writes nothing when
  nothing changed, and after the end opens only the Notes. A refusal of the server shows in the form (`role="alert"`). `TimeField.tsx` is a select of
  15-minute steps from 06:00 to 22:00; `formModel.ts` holds the pure rules (slots, lengths, `defaultSlot`, `stampOf`).
- The minutes on the screens (wave 2, owner 2026-10-19; `meetings/MinutesPart.tsx`, `MinutesSheet.tsx`). After the end, the meeting sheet shows one quiet
  text button "Add the minutes" under the people, until someone writes them (`viewerCan.minutes`): no task, no notice, no badge, no main button. With
  minutes it shows a fact "Minutes": the text (`dir="auto"`, line breaks kept), the file chips, "By <name>, <day>", a quiet "Edit the minutes" for the
  people who may, and for `minutesPlace: 'tracker'` a quiet link "Open in the Tracker" (`trackerEntryLink`, `lib/params.ts`). Every quiet control uses
  `QUIET` (a text link in the link colour). `MinutesSheet` has one text area (`dir="auto"`, 8 rows, 10,000 letters), the attach button with the files that
  stand (each with a remove button) and the files picked, and one main button "Save the minutes". A project meeting uploads to its project
  (`{ projectId }`); a meeting with no project to the meeting (`{ projectId: null, meetingId }`). The save sends `since`, the `updatedAt` that the
  sheet opened (kept in state, so a newer read behind the sheet never changes it); `minutes_changed` keeps the text in the field and shows its word
  (`role="alert"`). After the save a toast "Minutes saved." offers Undo (`useUndoable`, the story of the call holds the minutes only). The Tracker entry
  sheet of an auto meeting line shows the same part (`TrackerRow.meeting`, `minutes`, `canEditMinutes`), the quiet link "Open the meeting", and the auto
  word `tracker.autoMeeting`; a Tracker row with minutes shows the small word "Minutes". The feed words are `feed.meeting.minutes_saved_<meeting|visit>`
  for `meeting.minutes_saved` and `tracker.minutes_saved`. Screen tests: `meetings/testMeetings.ts` (`ENDED`, `SOME_MINUTES`, `withLine`).
- Repeating meetings on the screens (wave 3, owner 2026-10-19; `series.*` words in `i18n/real/series.*.json`). The new meeting form keeps Repeat under "More"
  (`REPEATS` in `formModel.ts`: Does not repeat, Every day (Sunday to Thursday), Every week, Every 2 weeks), and Until (a `DateField`, optional, not before the day
  of the first meeting and at most `REPEAT_MAX_DAYS` after it) shows only when a repeat is chosen. The visible controls stay eight. The edit form has neither: the rule of
  a series is fixed. `ScopeSheet.tsx` is the question before a change, a cancel or a delete (mode `edit`, `cancel`, `delete`) of a meeting with a `seriesId`: two plain buttons, "This meeting" and "This and
  later meetings", with the focus on the first; Escape or Close leaves the meeting as it is. The edit form opens it after Save when something changed (nothing
  changed: it closes, as before), and turns the second button off with a short line when the change moves the meeting to a new day (the server refuses a new
  day with `later`). The meeting sheet opens it (mode `cancel`) in place of the plain "Cancel this meeting?" question for a meeting of a series; the plain question
  stays for a meeting in no series. The toasts say "Meetings saved." and "Meetings cancelled." for `later`, and the Undo of the toast takes the story back. The sheet
  shows one quiet line under the time: "Repeats every week", with ", until <day>" when the rule has a last day. Tests: `ScopeSheet.test.tsx`, `MeetingForm.test.tsx`,
  `MeetingSheet.test.tsx` (`withSeries` in `testMeetings.ts`).
- Home: `home/MeetingsCard.tsx` ("Meetings today", only my meetings that are on or still to come, three rows). Project Overview:
  `project/overview/ProjectMeetings.tsx` (the next two meetings; the button "Plan a meeting" for `viewerCan.post` on an open project). Both read
  through `meetings/readInputs.ts`, and `tabReads` (`project/tabs.tsx`, now with `today`) prefetches the panel read with the same input.
- `public/privacy.html` is the public privacy page at `/privacy` (English and Arabic, no script, no outside file). The Google Auth Platform
  needs its link to publish the app. It names the one calendar scope and says Madar writes only the title, the time and the place: a change
  of the Google sync changes this page in the same commit (`app/privacy.test.ts`).
- The feed words: `feed.meeting.<created|updated|cancelled>_<meeting|visit>` (`projects/feed.ts`, with `_female` forms in Arabic).
- Screen tests: `meetings/testMeetings.ts` (`withMeeting`, `as`). In the test office usr_002 (Faisal) leads prj_001, usr_005 and usr_006 are on its team,
  and "now" is Wednesday 2026-09-30 09:00 in Riyadh.

## Design rules (the short form of DESIGN.md)
- Judge every choice from the view of the employees with ADHD: one next step, the fewest controls.
- A notice that stays while a state lasts ("Live updates paused", "No connection") goes through `useStandingNotice` (`toasts.tsx`):
  it floats in the toast lane. Never put a strip above the page: the header floats over it (owner, 2026-10-20).
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
- Logo: `MadarMark` ("Turning doors"), only in the sign-in frame, the app frame and the office card of the Open space map,
  never in a project list (`MadarMark.test.tsx` lists the files).
- Fonts: Thmanyah Sans for English and Arabic (files in `design/fonts/`), then Inter and IBM Plex Sans Arabic as the
  fallback. Number spots use the `tabular` class: it takes the digits from Inter. Weights: Bold (`font-bold`, the title
  and headline styles) only for headings, Medium (`font-medium` or `font-semibold`, which renders Medium) for emphasis in
  rows, labels and buttons, Regular for body text.
- RTL: logical classes only (`start/end`, `ms/me`, `ps/pe`). `scripts/check-rtl.ts` fails on left or right styles.
- Write a direction mark as an escape (`\u2068`), never as the raw character: GitHub flags hidden bidi characters.
  `check-rtl.ts` (`findRawDirectionMark`) stops the build on a raw mark in `src`; it does not read test files or word files.
  An escape typed into a tool command can arrive as the raw character (2026-10-20): build the backslash apart (Python `chr(92)`),
  then check the file with `git grep -nP '[\x{2066}-\x{2069}\x{200E}\x{200F}]'`.
- Text with its own direction (`dir="auto"`, `dir="ltr"`, `<bdi>`) takes its side from the page (`tokens.css`), so an
  English name sits on the right in Arabic. Typed text (a `textarea` or `input` with `dir="auto"`) and the text of a chat or a comment
  (`natural-side`) follow their own language instead: Arabic from the right, English from the left (owner, 2026-10-19). Put `dir="auto"` on the text, never on a flex or grid box or with
  `text-start`/`text-end`: `scripts/check-rtl.ts` fails on that. A name with a colon is one `<bdi>` ("Faisal:").
- Every visible word comes from a word key (see `i18n/CLAUDE.md`).
- Dates: a date that saves itself uses `DateDraftField`. A date in a form that saves with its own button uses `DateField`
  (`components/DateField.tsx`). Both show "Set date…" when empty. Only the Tracker quick log keeps a full date field (its
  date is never empty and has no label); on a computer a press on it opens the calendar of Madar under it (UX audit 2026-10-19).
  A date that cannot come before or after another takes `min` and `max` (project end after start, stage end after start,
  Received on not in the future): the calendar greys the days out. The calendar (`CalendarPopover.tsx`) has a solid ink
  circle for the chosen day, a press on the month title for a grid of 12 months with year arrows, and a Today button.
- `Popover` draws inside the closest `[role="dialog"]` of its anchor, as `Menu` does, and turns its place into the units of
  that dialog (`fixedFrame`, `inFrame`). A blocking sheet traps the focus, so a panel outside it lost the focus at once and a date
  field in a sheet turned into the browser box (UX audit 2026-10-19, chats-02).
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
  Measure a phone text fit at 360 px and 390 px in both languages: Arabic buttons («إرسال») are wider. To check a press area, use
  `elementFromPoint` on a grid around the element: a box measure misses an `after:` press strip.
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

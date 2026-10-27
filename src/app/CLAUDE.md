# App shell, boot and data pipeline

`src/app/`: the routes, the shell (desk and phone), the boot, the runtime hooks, the change signals and the early reads. The rules for all
screens are in `src/CLAUDE.md`. The remote sign-in, realtime and storage ports are in `app/remote/`. PostHog: `src/app/insight/CLAUDE.md`.

## Routes and shell
- `routes.tsx` is the source of the routes. An entry names its screen (`ScreenName`) and may name a `right`. A route never imports a screen
  file. `RequireRight` shows the page of a wrong link (`NotFound`) without the switch, and the screen never mounts. `NAV` items carry
  `right`. The phone bar (`PHONE_NAV`) has no gated tab: the Dashboard and Admin are rows of the Me tab.
- The redirects of Settings and Me live in `routes.tsx` (`phoneTo` and `deskTo` of an `Entry`), never in a screen. `/settings` on a phone
  goes to `/me` (to `/me/calendar` when the hash starts with `#google=`). `/me` and `/me/:section` on a desk go to `/settings`. Search and
  hash stay. The section id of Google Calendar is `calendar`. A phone turned sideways passes 640 px and follows the rule.
- The meeting view (`/dashboard/meeting`) and the Open space (`/dashboard/space`) sit outside the shell and fill the screen. Sign-in screens
  sit outside the sign-in gate (`remote` only).
- The desk shell (`AppShell.tsx`, from 640 px): a tab pill that floats at the top centre, the Madar mark at the top start (a press opens Home) and
  the person menu at the top end. No sidebar. The phone (`useIsPhone`, under 640 px) has its own shell (below).
- Layer numbers: the tab pill and the corner buttons `z-30`, Focus `z-[35]`, the dim layer of a sheet `z-40`, sheets, picture viewer and menus
  `z-50`, toasts `z-80`. Pin every new layer against these.
- The person menu (`PersonMenu.tsx`, from 640 px) has three groups with a hairline before each: `quick` (Away only with a live port; Mode and
  Language, each one button that names the other choice, in `QuickRow` with 44 px rows and one control height), `places` (Admin, Settings,
  What's new, the feedback button) and `signout` (real build only). The phone has no person menu: the Me hub holds the same choices.
- Theme: a new person starts light (`defaultPreferences`). The screens before sign-in take `madar.theme`, written at each sign-in by
  `AppearanceSync.tsx`, else light. The sample office keeps System.

## Boot and first load
- `main.tsx` loads only one bootstrap. Its first import is `zodConfig.ts` (zod runs jitless, so the CSP holds). It imports nothing from zod: it
  sets `jitless` on the one object zod keeps on `globalThis.__zod_globalConfig`. Never import from `zod` there. The second import is
  `i18n/firstWords.ts`.
- The remote build splits each screen into its own chunk. `screenLoaders.ts` holds one loader for each screen, `screens.ts` the module cache.
  The frame, the sign-in gate, Home and the error pages stay in the first script. `main.tsx` loads the screens of the first address (plus Sign in
  when no session is stored) before it makes the router. A new screen needs a loader in both `screenLoaders.ts` and `screenLoaders.static.ts`
  (the prototype takes the plain imports through an alias in `vite.config.ts`). `screenLoaders.test.ts` keeps the lists the same.
- The idle prefetch (`idlePrefetch.ts`, constants `PREFETCH_GAP_MS`, `PREFETCH_SAFETY_MS`, `PREFETCH_AT_ONCE`) loads the other screens after the
  first screen shows its data, in the order of `prefetchOrder()`. It starts after the first fresh answer of the page (data or error, never an
  answer that the Home cache stored) with no read on its way, and the safety timer starts it anyway. A screen that a person opens first loads
  at once through `loadScreen`. `warmAtIdle` starts in the same step. `prefetchRules.ts` skips the five sign-in screens when a session is
  stored, and Admin when the cached `session.get` cannot open it. A failed import at a screen change reloads the page once (session mark
  `madar.screenReload`).
- `vite.config.ts` (remote modes): first-screen packages go into a `vendor` chunk, the sheet packages (vaul, Radix, scroll lock) into an
  `overlay` chunk, `@supabase` into a `supabase` chunk (`REMOTE_CHUNKS`), so a release that changes only app code keeps their names in the
  browser cache. zod stays out of `vendor`. A static import of `Sheet` in a first-load module brings the overlay chunk back: `check-bundles.ts`
  fails on the vaul marker. The remote modes alias `@supabase/storage-js`, `postgrest-js` and `functions-js` to `src/stubs/unusedClients.ts`.
  The screens use only `auth`, `channel`, `removeChannel` and `realtime.setAuth`. `remote/unusedClients.test.ts` fails on `.from(`, `.rpc(`,
  `.storage` or `.functions`, and on a name that a supabase-js upgrade imports and the stub lacks. The plugin `earlyLinks` adds the
  modulepreload, font preload and preconnect links. The prototype gets none.
- `lazyOverlay.tsx` takes `reloadOnFailedImport` from `importReload.ts`, which imports nothing. An import of `screens.ts` there made a loop
  through every screen in the prototype dev server and an empty page (`importCycle.test.ts`). `warm()` keeps the loaded component in a
  module variable: a part that mounts after it renders with no Suspense step, and a part that mounts before it keeps `React.lazy` for its
  whole life. `useOnceOn` mounts a sheet at its first use and keeps it, so the close animation stays. Never import the lazy parts
  statically from the shell, Home or `AuthGate`: `firstLoadImports.test.ts` and `check-bundles.ts` fail on it. The lazy parts are the Home
  task panel, Focus mode, the feedback sheet, the sheet of an ended session (`overlays.tsx`) and the panel of the person menu
  (`PersonMenuPanel.tsx`; the test helpers await `loadPersonMenuPanel()`).
- Auth ports (`remote/authMode.ts`): `VITE_MADAR_AUTH` unset is the Supabase port. `madar` is the Madar port (`madarAuth.ts`). Each port
  keeps its session under its own key (`SESSION_KEYS`). `main.tsx` and the deploy specs read the key of the build's port
  (`hasStoredSession`), never a fixed name.
- The Supabase port starts at once on a stored session. `createSupabaseAuth` (`remote/auth.ts`) reads the stored value with
  `storedSupabaseUser` (a refresh token and a user id, every read in try/catch): that is `signed_in`, and `getSession()` runs beside the first
  frame, not awaited. `accessToken()` still awaits `getSession`, so the first batch carries the new token. Storage that throws or holds
  another shape gives the old wait. A renewal that ends with no session tells `signed_out` with the change `unrenewed` (`sessionEnd.ts`):
  `AuthGate` then runs `useLeaveScreen` with no reason, and Sign in follows with the Home cache cleared. No "Your session ended" sheet.
  Tests: `remote/authFastStart.test.ts` (`fakeAuth.expireAtStart()` plays the failed renewal).
- `canonicalHost.ts` moves `www.<host>` to `<host>` before the remote build starts.
- `remote/supabase.ts` gives the Realtime client a `heartbeatCallback` that calls `supabase.realtime.connect()` on 'timeout' or 'disconnected':
  a hidden tab throttles the heartbeat, and the client joins again at once. The worker option waits for a served worker file and a CSP change
  (`worker-src 'self'`).

## Data pipeline
- `useCall` (reads) and `useAction` (writes) live in `runtime.tsx`. `readMap.ts` says which change kinds each read reads. The remote build
  keeps answers until a change signal names them (`signals.ts`, `remote/channel.ts`). An answer that no screen shows stays for `KEEP_MS`
  (`keepAnswers`). A read of rule scope 'none', `search.query` and an answer that a change marked go `SHORT_MS` after their last screen
  closed. Every unseen answer goes when the office day changes.
- A read that starts to read a new collection needs that kind in its `readMap.ts` line. `readMap.test.ts` fails without it. Check the tests
  that use that kind as one a read does not read (`signals.test.tsx`).
- `useAction` and `useUndoable` load the active reads that the write will change (`readsAfterWrite`, from `WRITE_KINDS` in `writeKinds.ts`)
  in the request of the write (`writeWithReads`). The read that shows the record of the write goes first. The count of reads stays under `FOLLOW_MAX`, and their
  cost (`callCost`, `src/api/remote/wire.ts`) adds up to `BATCH_BUDGET` at most. The two person lists of Tasks and Home cost 1 each. A read
  past the budget loads on the signals. The success steps of the action run after those reads, plus one task. The prototype sends the write
  alone. The Realtime frame of the own write can come before the own answer: `connectChanges` keeps its id (`echoes`) until the answer names
  it, so one save sends one request. A gap of the seq, a join and an id that no own answer names keep the pass mixed. `wireApp.tsx` and
  `SaveTrip.test.tsx` count the requests of one save.
- A signal of another person that names `messages` while the Inbox or a chat is on screen waits `chatMs`, not the full window. It keeps the full
  window while an own write is on the wire (`queryClient.isMutating()`), because a direct chat or group signal names the sender too. A direct
  chat or a group reaches only its members: the server sends a person signal and no office signal. `affects` needs no rule for it.
  `signals.test.tsx` ("the person signal of a direct chat or group message") pins it. A project chat keeps its office signal.
- A Realtime channel that joins sends its empty list with the origin 'join'. `connectChanges` waits `joinMs` after a join, then reloads every
  list in one pass. A join within `VISIBLE_MERGE_MS` after the pass of a tab that shows again adds no second pass: a second one would   the reads in progress. The 60 s pass itself always runs, because a socket of a laptop in sleep looks open until its heartbeat fails.
- The office build (`VITE_MADAR_LIVE=socket`) gets its signals from one socket of the office object (`api/remote/liveSocket.ts`, picked by
  `liveSourceOf` in `remote/bootstrap.ts`): a ticket, a ping each `LIVE_PING_MS`, and a reload of every list when no pong comes. A build with
  `VITE_MADAR_AUTH=madar` has no Supabase client, so it always opens the socket (`liveKindOf`).

## Early reads
- A guarded route starts the reads of its screen with the session: `guardReads.ts` (`GUARD_READS`) lists the reads of each screen as a function
  of the link, and `StartReads` (`useRight.tsx`, put around the screen by `routes.tsx`) starts them once at the mount. A change to a read of
  one of these screens changes its line in the same commit. `GuardReads.test.tsx` fails on a key that the list missed.
- A press on a tab of the bar starts the main read of its screen on pointerdown, never on hover: `usePressReads` and `PRESS_READS`
  (`pressReads.ts`). The Projects line follows the reach of the cached session (`projectsDefaultShow`). A change to one of these reads
  changes its line there too. `PressReads.test.tsx` holds the keys. Home shows from the cache and starts nothing.
- `usePrefetchCall` (`prefetch.ts`) starts a read early under the exact key of `useCall`, in the remote build only. Call it in an effect or an
  event, never in render.
- Home keeps the last role it saw for each auth user (`madar.homeRole.<auth user id>`, `features/home/roleHint.ts`). The session answer
  always decides. The hint also carries the Admin choice (`admin|mine`, `admin|all`; a plain `admin` means `mixed`). `useRoleHint` gives
  Home and Projects `{ admin, reach, known }`.
- The Home cache (`remote/homeCache.ts`, started by `main.tsx` in the real build only; the file header has the timing rules) stores the answers
  of the first Home request in IndexedDB `madar-home-cache`. A new read in the first request of Home goes in `homeKeys` in the same commit.
  `HomeInstant.test.tsx` pins the names and `homeCache.test.ts` the rest. `homeKeys(role, today, phone, reach)` takes the reach from the
  session answer, so a stored answer of the other input never shows. A phone leaves out `projects.list`. Never keep a token or a file link in
  the record. The record clears at sign-out, at the end of the session, for another person and for another role or other rights.
- In the real build Tasks shows the cached Home answer of `tasks.list {filter:'mine'}` without the done rows while its own list loads
  (`features/work/minePlaceholder.ts`). `WorkTasks` reads its list with `useQuery` under the `useCall` key, so a change to `useCall` must also
  go there.

## The phone shell (under 640 px)
New phone code sits in lazy chunks.
- Tab bar (`PhoneTabBar.tsx`, `PHONE_NAV` and `phoneTabOf` in `nav.ts`): four tabs that show only their icon (the word stays as `sr-only`
  text): Today `/`, Inbox `/inbox`, Work (`workTabLink()`, the last Work view of the visit) and Me `/me`. Words: `phoneShell.tab.*`. Each
  tab has a 24 px block icon in its middle: an inline icon sits on the text line and rises about 2 px. The Inbox badge is the unread chats
  plus `notifications.count.badge` (`inboxName`). A press on the open tab scrolls to the top. Only `WorkHeader` calls `rememberWorkView`.
- The bar hides through `usePhoneBarHide`: for an open chat (`isPhoneChatPath`) and Focus mode it leaves the page. With the open keyboard
  (`useKeyboardOpen`: `visualViewport` more than 150 px shorter than the window, never while pinch-zoomed) it stays mounted, clear and
  inert. The hook reads the live `visualViewport`, not a saved copy: a full-page screenshot sets the window to 1 px and back, and a saved
  copy made the bar hide and fade in again, which failed the axe contrast check. While it hides, `<html>` carries `data-bar-hidden` and the
  token `--phone-bar` is 0 px. The page and the toast lane use `--phone-bar` (`max-sm:pb-[calc(var(--phone-bar)+1.5rem)]`), never `pb-32` or
  `bottom-24`.
- Top row (`PhoneTopRow.tsx`): the mark or the back link of `backLinkOf` (`phoneBack.ts`) and one Search icon. No bell and no person picture.
  An open chat has no top row. `screenKey` and `tabIndexOf` live in `phoneShell.ts` and take a `phone` argument. Without the Me hub a phone
  has no bell, no person menu, no Sign out and no Preview as: the shell never ships without it.
- Me hub (`features/me/`): `MeScreen`, `MeSectionScreen` and `meSections.tsx` (`meSectionOf`), `MeRow.tsx`, `PersonPanels`, `NoticePanel`,
  `OfficeGroup`, `HomeScreenSheet`, `useMeSummary`. `settings/bare.tsx` (`BareProvider`, `useBare`) makes the h2 of Settings parts `sr-only`,
  leaves the Morning summary out of `/me/notices` and makes the column names sticky; a desk has no provider. Shared with the desk:
  `PrototypeTools.tsx`, `feedback/useFeedbackSheet.tsx`, `SwitchButton` in `Switch.tsx`, `effectiveWorkHours` in `workRange.ts`, `PUSH_NOTE`.
  Sign out on the hub is one press and ignores a second press while it runs.
- Shared parts: `SegmentedControl` takes `fill`, `layoutId`, `onOptionPointerDown` and per option `count` and `countLabel`. `Tabs` takes
  `spread` and `variant="pill"`. `Sheet` takes `tall`, `phoneHeader` and `onClosed` (runs 500 ms after a close, also when the parent closed it;
  vaul's `onAnimationEnd` does not). `SheetOrPopover` is a Popover on a desk and a Sheet on a phone. `Menu` takes `sheetOnPhone`: on a phone the
  items open as `MenuSheet`, loaded on first press. `Menu.tsx` must never import `Sheet` or `MenuSheet` statically (`firstLoadImports.test.ts`).
- Press and hold: `useTouchPhone()` is `useIsPhone() && usePointerCoarse()`. `dragSensors.ts` holds `useDragSensors`, and only `DragLayer.tsx`
  and `TaskBoard.tsx` import it. A touch phone gets Mouse (distance), Touch (hold) and Keyboard sensors, and the grip is `sr-only` there. A click
  soon after a drop or cancel opens nothing. `contextmenu` is stopped on a touch row. The hold is not proven on a real iPhone.
- Phone tests: `phoneMedia(initial)` and `fakeVisualViewport()` from `src/test/phoneMedia.ts` (it answers `(max-width: 639px)` and
  `(pointer: coarse)` and restores `matchMedia` after the test). `features/inbox/phoneHarness.ts` and `src/test/renderPanel.tsx` wrap it. For
  reduced motion use `reduceMotion()` (`features/project/tasks/testMotion.ts`). After a test lifts a drag, end it, or the dnd-kit click guard
  stays on `document`.
- Work tab (`features/work/WorkHeader.tsx`): the title "Work" with the main button of the view, then the full-width `SegmentedControl`
  (`layoutId="work-switch"`) and the View toggle. After a keyboard change of view the focus goes to the checked part (route state
  `focusSwitch`). The Board on a phone is a snap lane, and a touch drop reads the point from `touchmove` and `touchend`.
- Meetings on a phone: `MeetingCard` with Join as a secondary anchor, and `useMinuteTick` (one 60 s tick that stops while the page is hidden).
- Home on a phone: `src/features/home/CLAUDE.md`. Project page on a phone: `src/features/project/CLAUDE.md`. Inbox and chat on a phone:
  `src/features/inbox/CLAUDE.md`.

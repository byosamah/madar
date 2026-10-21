# Render audit of Madar (key: render, prefix RN), commit 1d45aae5, 2026-10-21

Scope: React rendering work in the browser. Code read in the deploy-test worktree. All measurements ran in jsdom, in my own copy
(`/private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/copies/render`). jsdom has no layout and no paint,
so the counts (renders, DOM nodes) are exact and the milliseconds only compare one run with another. A real Chrome is about 3 to 5 times faster
than these milliseconds; a mid phone is about the same as jsdom or slower. No real browser, no production contact.

Trial patch (all existing render tests and 64 touched tests pass with it): `/private/tmp/claude-501/-Users-osamakhalil-dev-madar/0f64063a-761d-4d89-ae4a-594b91e00442/scratchpad/audit/render-trial.patch`
(row memo, stable dnd-kit inputs, bubble reuse by message id). It is a trial, not a finished fix.

## What is good now (checked, no finding)
- Presence: one person changes state, the Inbox list renders 1 face (avatars +1). With a 200-message chat open it renders the 67 faces of that
  one person, which is the right number. No other row renders.
- Typing: a typing signal renders 1 chat row (list) and 0 bubbles (open chat). `TypingContext` value is memoized.
- Composer: 5 keystrokes in a chat of 200 bubbles render 0 bubbles (20 ms in jsdom).
- Chat list search: 5 keystrokes with 167 rows take 71 ms in jsdom, rows are memoized.
- The 2026-10-07 fixes RND-2 and RND-M1 hold: the five `*Renders.test.tsx` files pass (task panel open and close render no row again).
- `useActive` changes state only at the edge; scroll and key events render nothing. `useCompactBars` is rAF-throttled and passive.

## Findings, ranked

### RN-1 The chat log has no windowing: opening a chat of 200 messages builds 3,741 DOM nodes (impact 4, measured)
- `src/features/inbox/MessageLog.tsx:204-218` maps every bubble. `chats.messages` returns up to 200 (`earlier.ts:10`), and "Earlier messages"
  adds 200 more each time with nothing removed (`earlier.ts:49`).
- Measured: a chat with 200 old messages plus the sample talk gives 203 `li`, 3,741 nodes (18.4 per bubble). Opening it took 1,029 to 1,102 ms in jsdom
  (a 100-message chat: 900 ms). After three "Earlier" presses the log holds 800 bubbles and about 15,000 nodes.
- Who feels it: everyone, each time a busy project chat opens, most on phones.
- Fix: draw the newest 60 bubbles first and the rest at idle or on scroll up (keep `data-message-id` for `?at=` and reply jumps), or
  `content-visibility: auto` with `contain-intrinsic-size` on each `li`. Needs a check of the "keep my place" logic (`logScroll.ts`, `anchor`).
- behaviorChange false; risk medium (scroll anchoring, focus frame, Newest button); effort M.

### RN-2 The Inbox list has no windowing: 167 rows are 4,444 DOM nodes (impact 4, measured)
- `src/features/inbox/ChatList.tsx:288-302`. The list holds every project chat, direct chat, group and up to 100 task threads
  (`TASK_THREAD_LIMIT` in `src/api/chatState.ts:161`), so an office with 120 projects reaches about 250 rows.
- Measured: 17 sample chats plus 150 groups: 167 rows, 4,444 nodes (26.6 per row), 667 to 678 ms mount in jsdom (whole app). Each row is a
  `motion.li` with drag, a Link, a face or tile, an `Age`, and a `Menu`.
- Fix: `content-visibility: auto` on each row with a fixed intrinsic height (the row is `min-h-[4.25rem]`), or a windowed list with the same
  row height. The rows are already memoized, so only the first mount and the scroll cost remain.
- behaviorChange false; risk medium (swipe to archive, focus, search results); effort M.

### RN-3 The "..." menus are mounted on touch screens where CSS hides them (impact 3, measured)
- `src/features/inbox/MessageBubble.tsx:135` mounts `MessageTools` for each saved bubble; `MessageMenu.tsx:113` hides it with
  `pointer-coarse:hidden`. `ChatList.tsx:198` does the same for the row menu (`pointer-coarse:hidden max-sm:hidden`).
- Measured: 48 of the 118 nodes of a 6-bubble log sit under `[data-part="side"]` (8 nodes per bubble, about 40%). The row menu is 7 of 23 nodes
  per row (119 of 396 in a 17-row list). Each `Menu` also makes an `AnimatePresence`, a portal, an `AnimatedIcon` with 3 motion circles and
  4 listeners. A phone pays this for 200 bubbles and 250 rows and never shows it.
- Fix: do not render the tools when `matchMedia('(pointer: coarse)')` or `useIsPhone()` says touch (the sheet path stays). On a desk the
  "..." button stays as is.
- behaviorChange false (the button was `display: none`); risk low; effort S.

### RN-4 A new message in a chat of 200 or more messages renders all 200 bubbles again (impact 3, measured)
- Cause: `useBubbles` keeps a bubble per view object in a `WeakMap` (`bubbles.ts:11-22`). `chats.messages` returns the newest 200. A new message slides
  the window by one, and TanStack's structural sharing compares by index, so every view after the shift is a new object, every bubble is a
  new object, and every `MessageBubble` memo fails (`prop bubble` changed on 199 of 200).
- Measured over the sample office with one new message and a reload of `chats.messages`, `chats.list` and `chats.unreadCount`:
  chat of 106 messages: 1 bubble and 1 face render; chat of 200: 200 bubbles and 200 faces render, plus 167 `Age` renders from the list.
  Trial fix (cache by message id, reuse when `replaceEqualDeep` says equal): 200 to 1 bubble, 340 to 247 ms in jsdom for the whole reload.
  The same shift happens on a delete and, after "Earlier messages", still on the newest window.
- Who feels it: every person in a busy chat, at every incoming message and every own send (about 25 ms on a laptop, about 100 ms on a mid phone).
- Fix: `useBubbles(views, toBubble, resetKey, idOf)` as in the trial patch (`bubbles.ts`, `ConversationPane.tsx:179`).
- behaviorChange false; risk low; effort S. The 2026-10-07 fix RND-5 had this hole; it is not a new regression.

### RN-5 One changed task renders every task row again (impact 3, measured)
- `TaskRowItem` is not memoized (`src/features/project/tasks/TaskRowItem.tsx:57`). Its callers pass a new `onOpen` closure for each row
  (`TaskListScreen.tsx:91`, `WorkTasks.tsx:28`, `SortableTaskRows.tsx:45`), and `SortableTaskRows` also hands dnd-kit new inputs on every
  render: the sensor options are object literals (`SortableTaskRows.tsx:76-78`) and `ids` is a new array (`:74`), so the dnd-kit
  contexts change and every `useSortable` row renders again even behind a `memo`.
- Measured (150 extra tasks in prj_001): the Tasks list `/tasks` has 205 rows and 5,506 nodes (26.9 per row); one title change renders all
  205 rows. The project To-dos tab has 157 rows and 6,626 nodes (42 per row); one change renders 157 rows and 157 faces, and framer
  `layout="position"` reads `getBoundingClientRect` 314 times (2 per row). Reload plus render: 164 to 246 ms in jsdom.
  Trial fix (memo on `SortableRow` and `TaskRowItem`, hoisted sensor options, memoized `ids`): 157 to 1 row and 157 to 1 face.
- Who feels it: anybody who keeps Tasks, Home or a project open while the team works; each save by a teammate triggers it.
- Fix: as in the trial patch, plus make the `onOpen` of every caller stable (pass the row, not a closure) so the memo needs no custom compare.
- behaviorChange false; risk low to medium (a stale closure if a caller's `onOpen` captures changing state); effort M.

### RN-6 One changed project renders every project row again, on Projects and on the Admin's Home (impact 3, measured)
- `ProjectListRow` is not memoized (`src/features/projects/ProjectListRow.tsx:39`); the parents map all rows (`ProjectsScreen.tsx:56`,
  `HomeScreen.tsx:88`). An Admin's Home lists every live project. `projects.list` reads `projectTouched` and the project detail kinds
  (`src/app/readMap.ts:60`), so each task or stage save in any project changes the `updatedAt` of one row and reloads the list.
- Measured with 110 extra projects: 122 rows, 4,190 nodes (34 per row). One changed project renders 122 rows and 122 tiles; 653 ms in
  jsdom (about 5 ms a row). Trial fix (`memo`): 1 tile, 128 ms.
- Fix: `memo(ProjectListRow)`. The `summary` object is shared by structural sharing, `source` is a string.
- behaviorChange false; risk low; effort S.

### RN-7 Notifications: 100 rows, three mutation hooks in each row, and one read renders all rows (impact 3, measured)
- `InboxItem` (`src/features/notifications/NotificationsScreen.tsx:28-45`) calls `useAction` twice, `useUndoable` once (a third mutation)
  and `useIsPhone` for each row, and is not memoized (`:197`). Every press on a notice marks it read and reloads the list.
- Measured with 100 notices: 561 ms mount in jsdom, 1,740 nodes. Marking one read gives 100 `ageOf` calls and 100 face renders. Trial fix
  (`memo(InboxItem)`): 4 and 4.
- Fix: `memo`, and move the three mutations to the list (one `markRead`, one `approve`) with the row calling a stable function.
- behaviorChange false; risk low; effort S for the memo, M for the hooks.

### RN-8 The emoji panel builds 1,878 buttons at each open (impact 3, measured)
- `src/features/emoji/EmojiPanel.tsx:185-191` draws all 8 groups at once. `content-visibility: auto` saves layout and paint only; React
  and the DOM still build everything. It opens for every reaction "+" and every smiley press, and it mounts again after each close.
- Measured (React Profiler, jsdom): mount 159.7 ms, 1,878 cells, 3,807 nodes. A move of the focus renders the whole panel (16.9 ms,
  because `grid()` builds 1,878 objects). Clearing the search remounts everything (113 ms).
- Fix: draw the first group and Recent at once; draw the other sections after the first paint (idle) or when they come near the view
  (their height is known from `containIntrinsicSize`). Memoize one section per group so a focus move renders 2 cells, not the grid.
- behaviorChange false; risk low to medium (the group buttons scroll to a section that must exist); effort M.

### RN-9 The project page starts a MapLibre map at once and again at every visit to About (impact 3, inferred)
- `src/features/project/overview/ProjectPlace.tsx:7-30` mounts `MapCanvas` for each pinned project. The lazy chunk is 1.06 MB plus a 510 KB
  worker, a 148 KB Arabic plugin and 83 KB CSS (baseline-remote/assets). `MapCanvas.tsx:191` makes a WebGL map, loads the style,
  glyphs and vector tiles, and `made?.remove()` runs on unmount (`:242`), so a trip to the Tasks tab and back makes a new map. Any change of
  `pinsKey` replaces every marker (`MapCanvas.tsx:179,285`).
- Not measured (no real browser). Expected: a few hundred ms of main thread plus GPU on a phone for each About visit, and about 1.7 MB of
  first download on 4G.
- Fix: start the map when the box is near the view (IntersectionObserver) or after the first paint of the page; keep the map alive while
  the project page stays open (hide it, do not remove it).
- behaviorChange false if idle-start (the grey box stays a little longer); risk medium; effort M.

### RN-10 A face adds `useTranslation` and two `t()` calls again (RND-8 undone for faces with presence) (impact 2, measured, regression)
- `src/components/PersonFace.tsx:13-18`: `StateFace` calls `useTranslation()` and builds the label with two `t()` calls on every render of every face.
  The 2026-10-07 fix made the Avatar read the language without `useTranslation` (`lang.test.tsx` pins 0 calls for `Avatar`). Faces with a live
  port now bring it back.
- Measured: opening a 6-bubble chat makes 289 `useTranslation` calls. A page with 150 faces holds 150 i18n listeners and 300 `t()` calls for
  each full render.
- Fix: use `useLang()` and a cached label per (state, language, context) (a small `Map`), no hook per face.
- behaviorChange false; risk low; effort S.

### RN-11 The Open space renders all 122 cards at once and again on every state change (impact 2, measured)
- `src/features/space/OpenSpaceScreen.tsx:226-237` builds the `nodes` array on every render with a new `data` object for each card;
  there is no `onlyRenderVisibleElements` (`:299`). With 110 extra projects: 122 cards, 3,449 nodes (28 per card). Opening the task panel
  (a query-string change) renders all 122 cards again.
- Fix: memoize `nodes` on its inputs (`tree`, lookups, `toggle`), keep `data` objects stable per node, and give the cards `memo`.
  `onlyRenderVisibleElements` would hide off-screen cards from the Tab key, so it needs an owner choice.
- behaviorChange false for the memo (true for `onlyRenderVisibleElements`: a keyboard user would not reach hidden cards); risk low; effort M.

### RN-12 The Dashboard schedule renders all rows again for one click (impact 2, measured)
- `src/features/dashboard/OfficeSchedule.tsx:155-185`: one component maps every row; `toggle`, a zoom change and the width measure (`useWidth`)
  render all rows, and `stageOverlaps(row.stages)` (`:159`) runs for each row at each render. 119 rows are 3,003 nodes; opening one row took 233 ms in jsdom.
- Fix: `memo` a `ScheduleRow` component; compute `stageOverlaps` once per row in `useMemo`.
- behaviorChange false; risk low; effort S.

### RN-13 "Next for you" runs two endless animations on large layers (impact 2, inferred)
- `src/design/tokens.css:395-406` and `:647-664`: `.glow::before` and `::after` are 180% of the card and animate `transform` (translate, rotate,
  scale) for ever, 8 s each, while Home is in front. Chrome pauses them in a hidden tab. A phone that sits on Home keeps the compositor busy.
- Not measured. Fix without a visual change in normal use: set `animation-play-state: paused` when the card is out of view (IntersectionObserver) or
  after 60 s without input.
- behaviorChange true (the light stops after a long idle time); risk low; effort S.

### RN-14 The Files tab asks a signed link for every picture row at mount (impact 2, inferred)
- `src/features/project/files/FilesTab.tsx:38` calls `useFileLink(..., 'thumb')` for each picture row. `loading="lazy"` stops the image
  download only. The chat tile waits until it is within 400 px (`PictureAttachments.tsx:18-31`, `useNearView`); the Files rows do not.
- A project with 120 pictures sends 120 `files.link` calls (10 batches of 12, `MAX_BATCH`) at the first open, for rows that are far below.
- Fix: reuse `useNearView` for the row thumbnail.
- behaviorChange false; risk low; effort S.

### RN-15 The shell renders on every change of the query string (impact 1, measured)
- `AppShell.tsx:35` and `TabPill.tsx:16,65,86,108` use `useLocation()` for the path only. Five changes of the search parameters
  (opening a task panel) gave TabPill 5, PersonMenu 10 (two copies, wide and phone), StorageBanner 5, FocusMode 5 renders. `FeedbackSheet`
  inside each `PersonMenu` also calls `useLocation`.
- Fix: read the path through a small hook with `useSyncExternalStore` over the router, or `memo` the parts and pass `pathname` as a prop.
- behaviorChange false; risk low; effort S. Small cost for each render, listed for completeness.

### RN-16 Small repeated costs (impact 1, measured)
- `ChatList.tsx:238` makes `const refresh = {}` on each render, so all 167 `Age` components render again at each ChatList render (665 `ageOf`
  calls for 5 search keystrokes). It was chosen on purpose (RND-5) so ages stay fresh; a once-a-minute tick would give the same result.
- `useIsPhone` (`src/app/useIsPhone.ts:6,13`) makes a new `MediaQueryList` for every subscriber and for every snapshot read: 58
  `matchMedia` calls at Inbox mount and 75 more when a chat with 6 bubbles opens. One shared list would do.
- behaviorChange false; risk low; effort S.

### RN-17 Each keystroke in the message box writes to localStorage (impact 1, inferred)
- `src/app/drafts.ts:60-65` (`useDraftText`) calls `writeDraft` inside `set`, a synchronous `setItem` for each key. A 300 ms debounce
  plus a write on unmount and on `pagehide` gives the same result.
- behaviorChange false; risk low; effort S.

## Measurements (jsdom, Vitest 5.0.2, single files, `--no-file-parallelism`; load average 2.8 to 3.4)
| Scenario | Count or time |
| --- | --- |
| Inbox mount, 167 rows | 4,444 DOM nodes, 667 to 678 ms |
| Open a chat with 200 old messages | 203 li, 3,741 nodes, 1,029 to 1,102 ms |
| New message, chat with 106 messages | 1 bubble render |
| New message, chat with 200 messages | 200 bubble renders (1 with the trial fix) |
| Presence change, Inbox list only | 1 face render |
| Typing signal, list of 167 rows | 1 row render |
| 5 keystrokes in the message box (200 bubbles open) | 0 bubble renders, 20 ms |
| Tasks list, 205 rows, one change | 205 row renders, 5,506 nodes |
| Project To-dos tab, 157 rows, one change | 157 row and 157 face renders (1 and 1 with the trial fix), 6,626 nodes |
| Projects list, 122 rows, one change | 122 row and 122 tile renders, 653 ms (1 and 128 ms with the trial fix) |
| Notifications, 100 rows, one read | 100 `ageOf` and 100 face renders (4 and 4 with the trial fix) |
| Emoji panel mount | 159.7 ms, 1,878 cells, 3,807 nodes; focus move 16.9 ms; clear search 113 ms |
| Open space, 122 cards | 3,449 nodes; task panel open renders 122 cards |
| Dashboard schedule, 119 rows | 3,003 nodes; one row open 233 ms |
| Shell, 5 query-string changes | TabPill 5, PersonMenu 10, StorageBanner 5, FocusMode 5 renders |
| Tests that pass with the trial patch | 5 `*Renders` files plus 10 touched files (64 tests) |

## Not checked
- Any real browser time, GPU or battery work (RN-9, RN-13 are inferred). Safari and iOS memory.
- Tracker history, project Activity feed entries (paged at 50 to 200, not memoized), Files rows (`FileRow` has 3 mutation hooks), the Workload table and the
  recharts charts, the meeting view, the Admin sections other than Roles (4 roles, 13 folded sections of at most 20 rows: no issue).
- For the data auditor: `session.get`, `chats.unreadCount` and `notifications.count` are always mounted and reload on any `tasks` or `projects`
  change in the office (`src/app/readMap.ts:88-95`), which multiplies every render count above. `session.get` carries the person's picture twice (`user` and
  `authority`, up to 16 KB each) and `users.list` carries every picture.
- The Realtime message budget of presence was already modelled in proof.md (about 0.85 to 0.92 million a month); I did not repeat it.

> Part of `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`. Read that file first: its Global Constraints, shared interfaces and Lead amendments win over this file.

## Track W: Work (wave 2, branch rb/phone-d-work)

**Owns:**
- `src/features/work/` (all files and tests). New: `WorkHeader.tsx`.
- `src/features/meetings/MeetingsScreen.tsx`, `MeetingRow.tsx`, `readInputs.ts`. New: `useMinuteTick.ts`, `MeetingsPhone.test.tsx`. Not `MeetingSheet`, `MeetingForm`.
- `src/features/projects/ProjectsScreen.tsx`. New: `ProjectSearch.tsx`, `projectSearch.ts`, `ProjectSearch.test.tsx`.
- `src/features/project/tasks/`: `RowGrip.tsx`, `TaskRowItem.tsx`, `DragLayer.tsx`, `TaskBoard.tsx`, `TaskPeople.tsx`, `SortableTaskRows.tsx` (no change planned). New: `dragSensors.ts`, `useTouchPhone.ts`, `testPhone.ts` (test helper), and the tests of tasks W1 to W5.
- Words: new `src/i18n/real/phonework.en.json` and `phonework.ar.json` (root key `phoneWork`).
- Browser specs: `tests/e2e/work.spec.ts`, `tests/e2e-deploy/work.spec.ts`.
- Never edit: `SegmentedControl.tsx`, `ScreenControls.tsx`, `pressReads.ts`, `lastList.ts`, `AppShell.tsx`, `nav.ts` (track S); `src/whatsNew/entries.ts`, `src/CLAUDE.md`, `DESIGN.md` (lead).

**Reads:** design file (Lead decisions 1, 2, 4, 5, 8, 11, 14; rules 1, 6, 7, 8); areas sections "Work: To-dos and the Board" and "Work: Meetings and Projects"; contract: `isPhoneNow`/`useIsPhone`, `SegmentedControl` (`fill`, `layoutId`, `onOptionPointerDown`), `rememberWorkView`, `workTabLink`, `--phone-bar`. Rows of the shell (tab, top row, `screenKey`, Work tab lit on `/projects/*`) belong to track S. Wave 1 must be merged before this branch starts. Start with `git merge --ff-only` of the wave 1 branch.

Rules for the whole track:
- A phone test calls `phone()` from `src/features/project/tasks/testPhone.ts` (task W1). A desk test calls nothing. The desk look must not change: every desk test of the area stays green.
- Run Playwright never. The browser agent of the lead runs the specs of task W10.
- `RowGrip`, `SortableTaskRows` and `TaskRowItem` are first-load files. They never import `dragSensors.ts` or a value of `@dnd-kit` (task W1 pins it).

---

### Task W1: Touch sensors and the phone test helper

**Files:**
- Create: `src/features/project/tasks/useTouchPhone.ts`
- Create: `src/features/project/tasks/dragSensors.ts`
- Create: `src/features/project/tasks/testPhone.ts`
- Test: `src/features/project/tasks/dragSensors.test.tsx`
- Test: `src/features/project/tasks/dragSensorsImports.test.ts`

**Interfaces:**
- Consumes: `useIsPhone()` (`app/useIsPhone`), `usePointerCoarse()` (`app/usePointerCoarse`).
- Produces: `useTouchPhone(): boolean` (true when both queries match). `useDragSensors(distance: number, coordinateGetter: KeyboardCoordinateGetter): SensorDescriptor<SensorOptions>[]`. `HOLD_MS = 400`, `HOLD_TOLERANCE_PX = 8`, `prefersReducedMotion(): boolean` (reads `(prefers-reduced-motion: reduce)` at the call). `phone(o?: { phone?: boolean; touch?: boolean; reducedMotion?: boolean })` returns the `matchMedia` spy (defaults: phone true, touch true, reducedMotion false).

- [ ] **Step 1: Write the failing test**
```ts
// dragSensors.test.tsx
it('gives a touch phone Mouse, Touch and Keyboard', () => {
  phone();
  const { result } = renderHook(() => useDragSensors(4, sortableKeyboardCoordinates));
  expect(result.current.map((s) => s.sensor)).toEqual([MouseSensor, TouchSensor, KeyboardSensor]);
  expect(result.current[0]!.options).toEqual({ activationConstraint: { distance: 4 } });
  expect(result.current[1]!.options).toEqual({ activationConstraint: { delay: 400, tolerance: 8 } });
  expect(result.current[2]!.options).toEqual({ coordinateGetter: sortableKeyboardCoordinates });
});
it('gives a desk, and a narrow window with a mouse, Pointer and Keyboard', () => {
  phone({ touch: false });   // expect [PointerSensor, KeyboardSensor], pointer distance 4
  phone({ phone: false });   // a wide touch screen: the same two sensors
});
it('keeps the same array and options between renders', () => { /* rerender: result.current toBe the first array */ });
it('reads the reduced motion query at the call', () => { /* phone({ reducedMotion: true }) -> prefersReducedMotion() true */ });
// dragSensorsImports.test.ts: read RowGrip.tsx, SortableTaskRows.tsx, TaskRowItem.tsx as text.
// expect none to match /^import\s[^;]*from\s+'[^']*dragSensors'/m
// expect none to match /^import\s(?!type\b)[^;]*from\s+'@dnd-kit/m
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/project/tasks/dragSensors.test.tsx src/features/project/tasks/dragSensorsImports.test.ts --no-file-parallelism --testTimeout=60000`. Expected: the first file fails (`useDragSensors` is not found). The imports test passes now and guards the later tasks.
- [ ] **Step 3: Implement**
`useTouchPhone` is `useIsPhone() && usePointerCoarse()`. `useDragSensors` calls `useSensor` for Pointer, Mouse, Touch and Keyboard on every render, then returns `useSensors(touch ? undefined : pointer, touch ? mouse : undefined, touch ? touchSensor : undefined, keyboard)`. This keeps the order of the hooks fixed. Options keep their identity: `TOUCH_OPTIONS` is a module constant; the pointer, mouse and keyboard options come from `useMemo` on `distance` and `coordinateGetter`. Only `DragLayer.tsx` and `TaskBoard.tsx` import `dragSensors.ts`.
- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS).
- [ ] **Step 5: Commit**
`git add src/features/project/tasks/useTouchPhone.ts src/features/project/tasks/dragSensors.ts src/features/project/tasks/testPhone.ts src/features/project/tasks/dragSensors.test.tsx src/features/project/tasks/dragSensorsImports.test.ts` then `git commit -m "Add the drag sensors for press and hold on a touch phone"`.

---

### Task W2: Press and hold on a list row

**Files:**
- Modify: `src/features/project/tasks/RowGrip.tsx` (grip is `sr-only` on a touch phone; no blank spacer there)
- Modify: `src/features/project/tasks/TaskRowItem.tsx` (`RowDrag.listeners`; hold classes; lift look; `contextmenu` stop)
- Modify: `src/features/project/tasks/DragLayer.tsx` (`useDragSensors(4, sortableKeyboardCoordinates)`; row listeners; click guard; no slide under reduced motion)
- Test: `src/features/work/HoldToReorder.test.tsx` (new)

**Interfaces:**
- Consumes: `useDragSensors`, `useTouchPhone`, `prefersReducedMotion`, `phone` (W1); `useStableHandler`.
- Produces: `RowDrag` gets `listeners?: Pick<HTMLAttributes<HTMLElement>, 'onMouseDown' | 'onTouchStart'>`. `DragRows` keeps its props. Task W3 and the Today panel get the hold with no work of their own.

- [ ] **Step 1: Write the failing test** (`/work` as `usr_005`; reuse the `today()` data and the rect mock of `WorkOrder.test.tsx`; after the first render use `vi.useFakeTimers({ shouldAdvanceTime: true })`)
```ts
const rowBox = (title: string) => within(group).getByText(title).closest('li')!.firstElementChild as HTMLElement;
it('hides the grip and the spacer on a touch phone', () => { // phone()
  expect(grip('Civil Defense drawings')).toHaveClass('sr-only');
  expect(group.querySelectorAll('li span[aria-hidden].w-8')).toHaveLength(0); // the helper row has no blank
});
it('keeps the grip and the spacer on a desk', () => { /* no sr-only; the helper row keeps the w-8 spacer */ });
it('lifts a row after a 400 ms hold', async () => {
  fireEvent.touchStart(rowBox('Civil Defense drawings'), { touches: [{ clientX: 100, clientY: 100 }] });
  await advance(399);  expect(status()).not.toMatch(/Picked up/);
  await advance(1);    expect(status()).toMatch(/Picked up Civil Defense drawings\. It is at place \d of 2\./);
  expect(rowBox('Civil Defense drawings')).toHaveClass('scale-[1.02]', 'motion-reduce:scale-100');
});
it('does not lift when the finger moves 20 px before 400 ms', ...); // touchMove to y 120 at 100 ms, then advance 400: no "Picked up"
it('does not lift on a desk', ...);                                  // no phone(): touchStart + 500 ms: no "Picked up"
it('keeps a plain tap working on the tick, the title and the conversation button', ...); // tap = touchStart, touchEnd, click
it('ignores a click within 250 ms of a drop, and accepts it after', ...); // keyboard drop; spy Date.now; click title: no dialog; +300 ms: dialog
it('stops the context menu of a touch row only', ...); // expect(fireEvent.contextMenu(rowBox(..))).toBe(false) on a touch phone, true on a desk
it('gives the hold to the project To-dos tab', ...);   // /projects/prj_001?tab=tasks as usr_005, phone(): the grips are sr-only
it('sets no slide on the moved rows under reduced motion', ...); // phone({ reducedMotion: true }): after Space on a grip, no row box has inline `transition`; with reducedMotion false one has it
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/work/HoldToReorder.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the grip is not `sr-only`; no row lifts after the hold.
- [ ] **Step 3: Implement**
- `RowGrip`: `const touch = useTouchPhone()`. The button class is `sr-only` when `touch`, else the class of today. A row with `!row.canMove` returns `null` when `touch`, else the `w-8` spacer.
- `DragLayer`: `SortableRow` reads `touch = useTouchPhone()`. It passes `drag.listeners = touch && listeners ? { onMouseDown: listeners.onMouseDown, onTouchStart: listeners.onTouchStart } : undefined`. The grip keeps `{ ...attributes, ...listeners }` and the activator ref (the keyboard starts only there). `useSortable` gets `transition: prefersReducedMotion() ? null : undefined`. `DragRows` calls `useDragSensors(4, sortableKeyboardCoordinates)` and replaces the two module constants. A `droppedAt` ref is set in `onDragEnd` and `onDragCancel`. `onOpen` goes to the rows through `useStableHandler((row, thread) => { if (Date.now() - droppedAt.current > 250) onOpen(row, thread); })`.
- `TaskRowItem`: `holdable = Boolean(drag?.listeners)`. The row box spreads `drag.listeners` and, when `holdable`, adds `touch-manipulation pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]` and `onContextMenu={(event) => event.preventDefault()}`. The lifted class is `surface relative z-10 shadow-float` and, when `holdable`, also `scale-[1.02] transition-[scale] duration-[350ms] ease-[cubic-bezier(0.2,0.9,0.3,1.15)] motion-reduce:scale-100 motion-reduce:transition-none`. The CSS `scale` property does not clash with the `transform` of dnd-kit. The curve is the drop curve of the Board.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `src/features/work/WorkOrder.test.tsx`, `DragLayerSwap.test.tsx`, `WorkRenders.test.tsx`, `src/features/project/tasks/TaskListOrder.test.tsx`, `RowRenders.test.tsx`, `dragSensorsImports.test.ts`. Expected PASS.
- [ ] **Step 5: Commit**
`git add src/features/project/tasks/RowGrip.tsx src/features/project/tasks/TaskRowItem.tsx src/features/project/tasks/DragLayer.tsx src/features/work/HoldToReorder.test.tsx` then `git commit -m "Let a touch phone press and hold a to-do row to change its order"`.

---

### Task W3: The 44 px press area of the people picture

**Files:**
- Modify: `src/features/project/tasks/TaskPeople.tsx` (lead button press area on a phone)
- Test: `src/features/project/tasks/TaskPeople.test.tsx` (add one test)

**Interfaces:**
- Consumes: `phone` (W1).
- Produces: no new name.

- [ ] **Step 1: Write the failing test**
```ts
it('gives the lead button a 44 px press area on a phone', async () => {
  phone();
  await renderApp(TAB, asLeader);
  const button = await screen.findByRole('button', { name: `Lead and helpers of ${TITLE}` });
  expect(button).toHaveClass('max-sm:min-h-11', 'max-sm:min-w-11', 'max-sm:justify-center', 'max-sm:m-0', 'max-sm:p-0');
});
```
The `max-sm:` classes are in the class list on a desk too, so the test needs no desk case. The Playwright probe of W10 measures the real box.
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/project/tasks/TaskPeople.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the new test fails on the missing classes.
- [ ] **Step 3: Implement**
Add `max-sm:m-0 max-sm:p-0 max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center` to the lead button. The layout grows by about 14 px, and the grip (32 px) leaves a touch phone, so the row gains room. The "+" button stays `max-sm:hidden`. The read-only branch has no press target and stays.
- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Also run `RowRenders.test.tsx`.
- [ ] **Step 5: Commit**
`git add src/features/project/tasks/TaskPeople.tsx src/features/project/tasks/TaskPeople.test.tsx` then `git commit -m "Give the people picture of a to-do row a 44 px press area on a phone"`.

---

### Task W4: The Board lane, the dots and the column notes

**Files:**
- Modify: `src/features/project/tasks/TaskBoard.tsx` (snap lane on a phone, `BoardDots`, `doneNote`, empty column line)
- Modify: `src/features/work/WorkBoard.tsx` (pass the Done note on a phone)
- Create: `src/i18n/real/phonework.en.json`, `src/i18n/real/phonework.ar.json`
- Test: `src/features/work/BoardLane.test.tsx` (new)

**Interfaces:**
- Consumes: `phone` (W1); `useIsPhone`; `spring` from `design/motion`; the key `tasks.column` ("To do: 3").
- Produces: `TaskBoard` gets the prop `doneNote?: string`. Words `phoneWork.board.doneRange` ("Last 7 days" / «آخر 7 أيام») and `phoneWork.board.empty` ("Nothing here." / «لا شيء هنا.»). The project To-dos tab (track P) shares the lane and the dots. Track P must not edit this file.

- [ ] **Step 1: Write the failing test** (`localStorage.setItem('madar.work.view', 'board')` before `renderApp('/work', as('usr_005'))`; stub `IntersectionObserver` on `window` with a class that keeps its callback and its targets)
```ts
it('draws the snap lane on a phone', async () => { // phone()
  const lane = (await screen.findByRole('region', { name: /^To do/ })).parentElement!;
  expect(lane).toHaveClass('max-sm:snap-x', 'max-sm:snap-mandatory', 'max-sm:overscroll-x-contain', 'max-sm:scroll-ps-4', 'max-sm:auto-cols-[calc(100%-3rem)]');
  for (const column of lane.children) expect(column).toHaveClass('max-sm:snap-start');
});
it('draws four dots of 44 px, named like the columns', ...);  // button "To do: n" ... "Done: n", each class size-11; none on a desk
it('marks the dot of the column that the lane shows', ...);   // fire the observer with ratio 0.9 for In progress: that dot has aria-current="true"
it('scrolls to a column on a press of its dot', ...);        // spy Element.prototype.scrollIntoView: called on the Done section with { behavior: 'smooth', inline: 'start', block: 'nearest' }; with phone({ reducedMotion: true }) behavior is 'auto'
it('says "Last 7 days" in the Done header on a phone only', ...);
it('shows "Nothing here." in an empty column on a phone and keeps its height', ...);
it('draws no dots for an empty board', ...);                  // all rows done earlier than 7 days: EmptyState "All clear", no dot buttons
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/work/BoardLane.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no lane classes, no dots.
- [ ] **Step 3: Implement**
- Lane: keep the classes of today. Add `max-sm:snap-x max-sm:snap-mandatory max-sm:overscroll-x-contain max-sm:scroll-ps-4 max-sm:auto-cols-[calc(100%-3rem)]`. The prefix keeps the desk as it is. `Column` adds `max-sm:snap-start`. At 390 px a column is 310 px, at 360 px it is 280 px.
- `Column` gets `note?: string` (a `text-footnote text-ink-2` line under the header) and, when it has no card, is not `closed` and the screen is a phone, one `text-footnote text-ink-2` line with `phoneWork.board.empty`. `TaskBoard` gives `note={status === 'done' ? doneNote : undefined}`. `WorkBoard` passes `doneNote={phone ? t('phoneWork.board.doneRange') : undefined}`.
- `BoardDots` (inside `TaskBoard.tsx`, after the lane, a sibling of it; returns `null` unless `useIsPhone()`): `IntersectionObserver` with `root` = the lane and `threshold` `[0, 0.25, 0.5, 0.75, 1]` on the four `[data-column]` sections. It keeps the ratios and marks the column with the highest ratio. Without `IntersectionObserver` the first dot is open. Each dot is a `button` with `size-11`, `aria-label={t('tasks.column', { status, n })}`, `aria-current` on the open one, an 8 px `bg-fill-strong` dot, and for the open one a `motion.span` with `layoutId="board-dot"`, `bg-ink`, `spring.standard`. A press calls `section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'start', block: 'nearest' })`.
- Words: both files with the keys above. Arabic follows the Thmanyah style.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `WorkBoard.test.tsx`, `src/features/project/tasks/TaskBoard.test.tsx`, `BoardWave4.test.tsx`, `src/i18n/keys.test.ts`, `src/i18n/i18n.test.ts`, `src/i18n/arabic.test.ts`. Expected PASS.
- [ ] **Step 5: Commit**
`git add src/features/project/tasks/TaskBoard.tsx src/features/work/WorkBoard.tsx src/i18n/real/phonework.en.json src/i18n/real/phonework.ar.json src/features/work/BoardLane.test.tsx` then `git commit -m "Add the snap lane and the column dots to the Board on a phone"`.

---

### Task W5: Press and hold on a Board card

**Files:**
- Modify: `src/features/project/tasks/TaskBoard.tsx` (sensors, card listeners, hidden grip, Move menu stop, touch point, lane snap off, drop animation, keyboard scroll)
- Test: `src/features/work/BoardHold.test.tsx` (new)

**Interfaces:**
- Consumes: `useDragSensors`, `useTouchPhone`, `prefersReducedMotion`, `phone` (W1); `BoardDots` and the lane ref (W4).
- Produces: no new name.

- [ ] **Step 1: Write the failing test** (board view as in W4; copy the `box()` rect mock of `BoardWave4.test.tsx`; fake timers with `shouldAdvanceTime`)
```ts
// Hold, move, release. `drop(card, from, to)` = touchStart(from), advance 400, touchMove(to), touchEnd(to).
it('shows why a reviewer card goes back after a touch drop on To do', ...);   // usr_002, "Toilet details": text 'This to-do is in review. Use Send back and write a note for the lead.' and the button 'Open to-do'
it('tells the lead that the to-do waits for the leader after a drop on Done', ...); // usr_005, needsReview true: 'This to-do waits for the leader to approve it.'
it('tells a card with no lead to get a lead first', ...);                      // ownerId null, usr_002 drops it on Done: 'Not yet. Give this to-do a lead first.' with 'Open to-do'
it('moves a card to an open column after a touch drop', ...);                  // usr_005 drops "Civil Defense drawings" on In progress: store status in_progress, toast 'Moved to In progress.'
it('does not lift when the finger swipes the lane', ...);                      // touchMove 30 px at 100 ms: no 'Picked up'
it('keeps the Move menu working: a touch on its button starts no lift', ...);
it('hides the grip, frees the title and stops the context menu on a touch phone', ...); // grip sr-only; title box has 'max-sm:pointer-coarse:pe-12' and still 'pe-24'; fireEvent.contextMenu(card) false
it('turns the snap off while a card is lifted', ...);                           // lane has 'max-sm:snap-none' and not 'max-sm:snap-x' while a keyboard drag runs; back after Escape
it('scrolls the target column into view for a keyboard drag', ...);            // Space on the grip, ArrowRight: scrollIntoView called on the In progress section with inline 'nearest'
it('sets no drop animation under reduced motion', ...);
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/work/BoardHold.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no lift after the hold; no toast after the touch drop.
- [ ] **Step 3: Implement**
- `useSensors(...)` becomes `useDragSensors(8, columnKeys)`.
- `BoardCard`: `touch = useTouchPhone()`. The `li` takes `{ onMouseDown, onTouchStart }` of the dnd-kit `listeners` when `touch`, else `{ onPointerDown }` as today. When `touch` it also gets `touch-manipulation pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]` and `onContextMenu` that calls `preventDefault`. The wrapper of the grip and the Move menu stops `onPointerDown`, `onMouseDown` and `onTouchStart`. The grip class is `sr-only` when `touch`. The title box class becomes `min-h-8 pe-24 max-sm:pointer-coarse:pe-12`.
- `TaskBoard`: the lane class is `max-sm:snap-none` while `activeId` is set (any drag), else the snap classes of W4. The tracker also listens to `touchmove` and `touchend` (capture, passive) and reads `changedTouches[0]`. `onDragEnd` returns early when `activatorEvent instanceof KeyboardEvent` (it was: no `clientX`). `onDragCancel` also sets `droppedAt`. `onDragOver` calls `section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' })` for the column of `over` when `activatorEvent instanceof KeyboardEvent`. `DragOverlay` gets `dropAnimation={prefersReducedMotion() ? null : <the object of today>}`. The lifted `CardFace` adds `motion-reduce:scale-100`. dnd-kit `autoScroll` stays on (default): it scrolls the lane at its edges.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `BoardLane.test.tsx`, `BoardWave4.test.tsx`, `TaskBoard.test.tsx`, `WorkBoard.test.tsx`, `src/features/project/tasks/TasksTab.test.tsx`, `StageBackTracker.test.tsx`. Expected PASS.
- [ ] **Step 5: Commit**
`git add src/features/project/tasks/TaskBoard.tsx src/features/work/BoardHold.test.tsx` then `git commit -m "Let a touch phone press and hold a Board card to move it"`.

---

### Task W6: The hint line and the early drag layer

**Files:**
- Modify: `src/features/work/WorkTasks.tsx` (`HoldHint` in `WorkBody`; the fade between List and Board on a phone)
- Modify: `src/features/work/WorkScreen.tsx` (`warmDragLayer()` on mount)
- Modify: `src/i18n/real/phonework.en.json`, `phonework.ar.json` (`phoneWork.holdHint`)
- Test: `src/features/work/HoldHint.test.tsx` (new)

**Interfaces:**
- Consumes: `useTouchPhone` (W1); `loadedDragLayer`, `loadDragLayer`, `warmDragLayer` from `dragLayerLoader` (not edited); `fade` from `design/motion`.
- Produces: word `phoneWork.holdHint` ("Press and hold a to-do to change its order." / «اضغط مطولًا على مهمة لتغيير ترتيبها.»).

- [ ] **Step 1: Write the failing test** (use the gate mock of `DragLayerSwap.test.tsx`; add a `warmed` counter to the mocked `warmDragLayer`)
```ts
it('shows the hint after the last group on a touch phone, in the List view', ...);   // phone(); text under the last section, class 'text-footnote'
it('waits for the drag layer', ...);        // gate on: no hint; gate.open(): hint appears
it('shows no hint on a desk, in the Board view, or when no group has two rows to move', ...);
it('shows no hint when the person only helps (no row can move)', ...);
it('warms the drag layer when the screen opens', ...); // gate.warmed is 1 after render of /work, also with no sortable group
it('changes no row when the layer becomes ready', ...); // the WorkRenders.test.tsx count stays the same
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/work/HoldHint.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no hint text.
- [ ] **Step 3: Implement**
- `HoldHint({ sortable })` is a small component inside `WorkBody`; its own state holds "layer ready" (`useState(() => loadedDragLayer() !== null)`, and an effect that calls `loadDragLayer()` when not ready). It returns the `<p className="text-footnote text-label-2">` only when `useTouchPhone()`, `sortable` and ready. `sortable` is `groups.some((g) => g.rows.length > 1 && g.rows.some((r) => r.canMove))` (the rule of `SortableTaskRows`). The review group does not count.
- `WorkScreen`: the idle effect also calls `warmDragLayer()`.
- `WorkTasks`: on a phone the list or the Board sits in `<motion.div key={view} className="flex flex-col gap-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>`. A desk keeps the DOM of today.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `WorkTasks.test.tsx`, `WorkRenders.test.tsx`, `WorkPlaceholder.test.tsx`, `DragLayerSwap.test.tsx`, `src/i18n/keys.test.ts`, `src/i18n/arabic.test.ts`. Expected PASS.
- [ ] **Step 5: Commit**
`git add src/features/work/WorkTasks.tsx src/features/work/WorkScreen.tsx src/i18n/real/phonework.en.json src/i18n/real/phonework.ar.json src/features/work/HoldHint.test.tsx` then `git commit -m "Add the hold hint to the Work list and warm the drag layer early"`.

---

### Task W7: WorkHeader, the three-part switch and the View toggle

**Files:**
- Create: `src/features/work/WorkHeader.tsx`
- Modify: `src/features/work/WorkSwitch.tsx` (third part, `fill`, `layoutId`, press reads, focus state)
- Modify: `src/features/work/WorkViewButton.tsx` (44 px toggle on a phone)
- Modify: `src/features/work/WorkScreen.tsx` (use `WorkHeader`)
- Modify: `src/features/meetings/MeetingsScreen.tsx` (use `WorkHeader` only; the card comes in W8)
- Modify: `src/features/meetings/readInputs.ts` (`meetingsListInput`)
- Modify: `src/i18n/real/phonework.en.json`, `phonework.ar.json` (`phoneWork.title`)
- Test: `src/features/work/WorkHeader.test.tsx` (new)

**Interfaces:**
- Consumes: `SegmentedControl` props `fill`, `layoutId`, `onOptionPointerDown` and `rememberWorkView` (track S); `usePressReads`, `usePrefetchCall`; `todayISO`.
- Produces: `WorkHeader({ action, trailing }: { action?: ReactNode; trailing?: ReactNode })`. On a phone: `ScreenTitle` "Work" (`phoneWork.title`, «العمل») with `action`, then one row with the switch (`flex-1`) and `trailing`. On a desk: `ScreenTitle` `screens.myWork` and `ScreenControls` with `WorkSwitch` and `trailing`, as today. It calls `rememberWorkView(pathname)` for `/work`, `/meetings`, `/projects`. `meetingsListInput(today: string)` returns `{ from: addDays(today, -7), to: addDays(today, 60), mine: true }`. `WorkViewButton` keeps its props `{ view, onView, onPrepare }`.

- [ ] **Step 1: Write the failing test** (`phone()`, user `usr_001` the Admin, unless said)
```ts
it('draws the title Work, three parts in order, and one main button', async () => {
  await renderApp('/work', as('usr_001'));
  expect(await screen.findByRole('heading', { level: 1, name: 'Work' })).toBeInTheDocument();
  const group = screen.getByRole('radiogroup', { name: 'Show' });
  expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['To-dos', 'Meetings', 'Projects']);
  expect(within(group).getByRole('radio', { name: 'To-dos' })).toBeChecked();
  expect(screen.getAllByRole('button', { name: 'New office to-do' })).toHaveLength(1);
});
it('follows the view: New meeting on Meetings, New project on Projects, and Work tab link is remembered', ...); // click the radios; workTabLink() is '/meetings', then '/projects'
it('toggles List and Board with one 44 px round button', ...); // button 'Board' aria-pressed false -> true; class bg-fill-strong and ring-1; region 'To do: n' shows; localStorage 'madar.work.view' is 'board'; again -> list
it('moves the focus to the new radio after the route changes', ...); // ArrowRight on To-dos: the Meetings radio has focus after the new header mounts; in Arabic ArrowLeft does the same
it('starts the reads of a view on pointer down', ...); // renderHeldRemoteApp: pointerDown on Projects asks projects.list; on Meetings asks meetings.list with meetingsListInput(today)
it('keeps the desk as it is', ...); // no phone(): h1 'Tasks', two radios, button 'View', parent of the switch has class 'flex flex-wrap items-center gap-3 pb-4'
it('shows the Arabic title and the button without a layout break', ...); // phone, usr_001 in Arabic: h1 'العمل'; the title row holds one h1 and one button
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/work/WorkHeader.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: title is "Tasks"; two radios.
- [ ] **Step 3: Implement**
- `WorkSwitch`: `value` is `meetings` for `/meetings`, `projects` for a path that starts with `/projects` on a phone, else `tasks`. A phone gets three options (third label `screens.projects`), `fill`, `layoutId="work-switch"`. A desk gets two options and none of the new props. `onChange` calls `navigate(path, { state: { focusSwitch: true } })`. `onOptionPointerDown('projects')` calls `usePressReads()('/projects')`. `onOptionPointerDown('meetings')` calls `prefetch('meetings.list', meetingsListInput(todayISO()))` and `prefetch('google.status', {})`. This avoids an edit of `pressReads.ts`.
- `WorkHeader`: a ref on the switch box. A layout effect on mount reads `useLocation().state?.focusSwitch` and calls `.focus({ preventScroll: true })` on `[role="radio"][aria-checked="true"]`. An effect calls `rememberWorkView`.
- `WorkViewButton`: on a phone, a `button` of `size-11 rounded-full`, `aria-pressed={view === 'board'}`, `aria-label={t('tasks.views.board')}`, the `FolderKanbanIcon` in both states. On: `bg-fill-strong ring-1 ring-ink`. Off: `bg-fill`. `onPointerDown={onPrepare}`. A press calls `onView(view === 'board' ? 'list' : 'board')`. The desk keeps `FilterButton`.
- `WorkScreen` passes the office button as `action` and `WorkViewButton` as `trailing`. `MeetingsScreen` passes the "New meeting" button as `action`. `MeetingsScreen` reads its list with `meetingsListInput(today)`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `MeetingsScreen.test.tsx`, `src/features/work/WorkTasks.test.tsx`, `WorkBoard.test.tsx`, `OfficeTasks.test.tsx`, `src/app/PressReads.test.tsx`. Expected PASS.
- [ ] **Step 5: Commit**
`git add src/features/work/WorkHeader.tsx src/features/work/WorkSwitch.tsx src/features/work/WorkViewButton.tsx src/features/work/WorkScreen.tsx src/features/meetings/MeetingsScreen.tsx src/features/meetings/readInputs.ts src/i18n/real/phonework.en.json src/i18n/real/phonework.ar.json src/features/work/WorkHeader.test.tsx` then `git commit -m "Add the Work header with a three-part switch and a View toggle"`.

---

### Task W8: The meeting card and the Meetings view

**Files:**
- Modify: `src/features/meetings/MeetingRow.tsx` (add `MeetingCard`; keep `MeetingListRow`)
- Modify: `src/features/meetings/MeetingsScreen.tsx` (cards on a phone; one minute tick; Earlier fold; Google line)
- Create: `src/features/meetings/useMinuteTick.ts`
- Modify: `src/i18n/real/phonework.en.json`, `phonework.ar.json`
- Test: `src/features/meetings/MeetingsPhone.test.tsx` (new)

**Interfaces:**
- Consumes: `WorkHeader` (W7); `mainAction`, `joinLink` (`meetingLinks.ts`); `phaseOf`; `StatusSign`; `ProjectTile`; `usePageVisible`; `useCall('google.status', {}, { enabled })`; `testMeetings.ts` helpers.
- Produces: `MeetingCard({ row, dayStyle, nowMs, onOpen })` (memo, plain props). `useMinuteTick(enabled: boolean): number` returns the minute count of `now()` and renders again each 60 s while the page shows. Words: `phoneWork.meetings.people` (`_one` "{{count}} person", `_other` "{{count}} people"; Arabic `_zero` «لا أحد», `_one` «شخص واحد», `_two` «شخصان», `_few` «{{count}} أشخاص», `_many` «{{count}} شخصًا», `_other` «{{count}} شخص») and `phoneWork.meetings.googleLine` ("Your meetings also go to Google Calendar." / «تصل اجتماعاتك أيضًا إلى تقويم Google.»).

- [ ] **Step 1: Write the failing test** (`phone()`; `usr_002`; the `office()` data of `MeetingsScreen.test.tsx`; "now" is 2026-09-30 09:00)
```ts
it('draws the card lines in order', ...);   // kind word; title (dir="auto", class line-clamp-2); range '2:00 PM to 3:00 PM'; plain place; tile + project name or 'Office'; '3 people'; 'Repeats every week'
it('puts the day before the range outside Today', ...); // This week: weekday and day; Later: short date
it('shows a state as a sign and an ink word', ...);     // 'Now' data-sign on_track, 'Done' completed, 'Cancelled' archived and the title is struck
it('shows Join only as a secondary anchor and no Edit, Cancel or minutes', ...); // link place, starts in 20 min: <a href target="_blank" rel="noopener noreferrer"> 'Join' with class bg-fill, not signature
it('hides a place that is a link and shows other text', ...); // 'https://meet.example.com/a' hidden; 'Room 3 https://x' (has a space) and 'http://x' shown as plain text
it('moves a card to Now and shows Join when a minute passes', ...); // fake timers; setNow 09:00 then 09:02; advance 60 000 ms
it('stops the tick while the page is hidden', ...);
it('opens the sheet with ?meeting= also when no card matches', ...);
it('puts the Earlier fold last, as a 52 px panel row', ...);  // button 'Earlier (1)' aria-expanded, min-h-[52px]; opens the older cards
it('shows the Google line only for state ok', ...);          // vi.spyOn(calls['google.status'], 'run'): ok -> line; not_synced and none -> no line
it('shows the empty line and keeps New meeting', ...);
it('keeps the desk list as it is', ...);                     // no phone(): MeetingListRow rows
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/meetings/MeetingsPhone.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no card lines; no Join anchor.
- [ ] **Step 3: Implement**
- Card lines: (1) `text-footnote` kind word, then `StatusSign` for `now`/`done`/`cancelled` (`on_track`/`completed`/`archived`), none for `upcoming`; (2) `text-headline` title, `dir="auto"`, `line-clamp-2`, struck when cancelled; (3) the range with `meetings.range`, with `formatDay(stampDay(startsAt), lang, 'weekdayDay')` before it in This week and `'short'` in Later and Earlier; (4) `row.where` when `joinLink(row.where) === null` and not empty; (5) `ProjectTile` size 24 and `<bdi>` name, or `office.word`; (6) `phoneWork.meetings.people`, then ` · ` and the repeat line (`series.line.*`, `series.lineUntil.*`, as `MeetingSheet`).
- The info block is one `button` (`min-h-11`) that calls `onOpen(row.id)`. A hairline and `<a>` "Join" (`meetings.sheet.join`) show when `mainAction(row, new Date(nowMs), null)?.kind === 'join'`. The anchor class is `pressable inline-flex min-h-11 items-center justify-center rounded-full bg-fill px-5 text-subheadline font-semibold text-ink hover:bg-fill-strong`.
- `MeetingsScreen`: `const phone = useIsPhone(); const minute = useMinuteTick(phone)`. `MeetingsBody` gets `minute` and `phone`; it draws `MeetingCard` in a phone and `MeetingListRow` on a desk. The Earlier button on a phone is `surface rounded-card min-h-[52px] w-full` with a `ChevronDownIcon` that turns (`transition-transform motion-reduce:transition-none`); its list uses `fade`. After the groups: `<p className="text-footnote text-ink-2">` with `phoneWork.meetings.googleLine`, only on a phone when `useCall('google.status', {}, { enabled: phone }).data?.state === 'ok'`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `MeetingsScreen.test.tsx`, `MeetingSheet.test.tsx`, `groups.test.ts`, `meetingLinks.test.ts`, `src/i18n/keys.test.ts`, `src/i18n/arabic.test.ts`. Expected PASS.
- [ ] **Step 5: Commit**
`git add src/features/meetings/MeetingRow.tsx src/features/meetings/MeetingsScreen.tsx src/features/meetings/useMinuteTick.ts src/features/meetings/MeetingsPhone.test.tsx src/i18n/real/phonework.en.json src/i18n/real/phonework.ar.json` then `git commit -m "Add the meeting card with Join to the Meetings view on a phone"`.

---

### Task W9: The project search and the Projects view

**Files:**
- Create: `src/features/projects/projectSearch.ts`
- Create: `src/features/projects/ProjectSearch.tsx`
- Modify: `src/features/projects/ProjectsScreen.tsx` (`WorkHeader` on a phone; `ProjectsFind` holds the search text)
- Modify: `src/i18n/real/phonework.en.json`, `phonework.ar.json` (`phoneWork.projects.search`)
- Test: `src/features/projects/ProjectSearch.test.tsx` (new)

**Interfaces:**
- Consumes: `WorkHeader` (W7); `normalizeForSearch` (`lib/text`), `searchWords`, `holdsWords` (`lib/searchMatch`); `AnimatedIcon` with `SearchIcon`.
- Produces: `searchProjects(rows: ProjectSummary[], query: string): ProjectSummary[]` (returns the same array for an empty query). `ProjectSearch({ value, onChange })`. Word `phoneWork.projects.search` ("Search projects" / «ابحث في المشاريع»).

- [ ] **Step 1: Write the failing test** (`phone()`; Admin; read `code` and client names of `prj_001` from `store.state`)
```ts
it('matches the name, the code and the client in both languages', ...);   // type 'corniche' -> 1 row; the code of prj_001 -> its row; client.name, then client.nameAr -> its rows
it('folds case and Arabic letters', ...);
it('keeps the text out of the link and out of the Filter count', ...);  // button name stays 'Filter'; location.hash has no search text
it('shows the empty state and clears text and filters with Show all projects', ...);
it('draws Work, three parts, then the search field and Filter on one row', ...); // h1 'Work'; searchbox 'Search projects' has class 'field'; button 'New project' once (Admin)
it('draws the gap chip and the health chip under the row', ...);       // /projects?filter=no_area&health=late
it('renders no row again for a letter that keeps every row', ...);     // count style of ProjectRowRenders.test.tsx
it('keeps the desk as it is', ...);                                    // no phone(): h1 'Projects', no searchbox
```
- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/projects/ProjectSearch.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no `searchbox`; h1 is "Projects".
- [ ] **Step 3: Implement**
- `searchProjects`: fold `[project.name, project.code, client?.name, client?.nameAr]` with `normalizeForSearch`; keep a row when `holdsWords(folded, searchWords(query))`; no words keep all rows.
- `ProjectSearch`: `<input type="search" className="field …" aria-label={t('phoneWork.projects.search')}>` with the icon; flex 1.
- `ProjectsScreen`: build `filterButton` and `chips` as constants. A phone draws `WorkHeader` (action: "New project", gate and `onPointerDown={prepareNew}` as today) and `<ProjectsFind>`. `ProjectsFind` (in the same file) holds `query` state, draws the row (`ProjectSearch`, `filterButton`), `chips`, and `ProjectsBody` with `useMemo(() => searchProjects(rows, query), [rows, query])`. Its `onShowAll` clears `query` and calls `showAll`. A desk keeps `ScreenTitle` "Projects" and `ScreenControls` as today.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `ProjectsScreen.test.tsx`, `ProjectsRenders.test.tsx`, `ProjectRowRenders.test.tsx`, `ProjectListRow.test.tsx`, `NewProjectSheet.test.tsx`, `src/i18n/keys.test.ts`, `src/i18n/arabic.test.ts`. Expected PASS.
- [ ] **Step 5: Commit**
`git add src/features/projects/projectSearch.ts src/features/projects/ProjectSearch.tsx src/features/projects/ProjectsScreen.tsx src/i18n/real/phonework.en.json src/i18n/real/phonework.ar.json src/features/projects/ProjectSearch.test.tsx` then `git commit -m "Add the project search and the Work header to the Projects view on a phone"`.

---

### Task W10: Browser specs for the Work tab

**Files:**
- Modify: `tests/e2e/work.spec.ts`
- Modify: `tests/e2e-deploy/work.spec.ts` (same tests, with `goto` and `settle` from `./goto`, as the file does)

**Interfaces:**
- Consumes: the screens of W2 to W9. Produces: no name. The builder does not run these specs. The Playwright agent of the lead runs them (Chromium, and WebKit with the iPhone profile).

- [ ] **Step 1: Write the failing test**
```ts
// Add { name: 'meetings', path: '/#/meetings' } and { name: 'projects', path: '/#/projects' } to SCREENS (the axe sweep at 390, 820, 1440, EN and AR).
// Add '/#/meetings' to the paths of 'no screen scrolls sideways on a phone'.
test('Work at 360 and 390: title, three parts of 44 px, no sideways scroll', ...);
//  for width of [360, 390], lang of [en, ar], path of [/work, /meetings, /projects]: h1 is 'Work' or 'العمل';
//  the radios are 3; each box height >= 44; scrollWidth <= width; the title and the main button do not overlap.
test('the Board lane snaps and shows four dots', ...);
//  390 px, Board on: a column is 310 px wide (+-2); four dots, each box >= 44 x 44; a press on the last dot brings Done into the viewport.
test('the people picture and the tick have a 44 px press area', ...);
//  elementFromPoint at the four corners inside the 44 px box returns the button (or a child of it).
test('a mouse drag changes the order on a touch phone', ...);
//  context { hasTouch: true, isMobile: true } 390 px: drag row 1 below row 2 in a date group; toast 'Order saved.'; the grip is not visible.
```
- [ ] **Step 2: Run it and see it fail** (not run by the builder). Expected: the Playwright agent sees the old title "Tasks" and two parts until W2 to W9 are in.
- [ ] **Step 3: Implement**
The assertions above. Screenshots go to `test-results/work/` and `test-results/e2e-deploy-shots/work/`. The 400 ms touch hold stays a proof on a real iPhone (design, "Proof on a real phone").
- [ ] **Step 4: Run `npm run typecheck`** (the specs type-check there). Expected PASS.
- [ ] **Step 5: Commit**
`git add tests/e2e/work.spec.ts tests/e2e-deploy/work.spec.ts` then `git commit -m "Add the browser specs of the Work tab on a phone"`.

---

**Review focus candidates:**
1. A plain tap on the tick, the title or the conversation button while the row carries the hold listeners. Test: W2 ("keeps a plain tap working").
2. A long title or project name of mixed Arabic and Latin text at 360 px, in the Work title row, on the meeting card and on the Board card. Tests: W7 (Arabic title row), W8 (`dir="auto"`, `line-clamp-2`, `<bdi>`), W10 (360 px sweep).
3. A meeting place that is a plain address with a space, an `http://` link, or a very long `https://` link. Test: W8 ("hides a place that is a link").
4. A Board with no card, or with every card in one column. Test: W4 ("draws no dots for an empty board", "Nothing here.").

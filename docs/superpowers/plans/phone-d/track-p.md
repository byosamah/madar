> Part of `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`. Read that file first: its Global Constraints, shared interfaces and Lead amendments win over this file.

## Track P: A project (wave 2, branch rb/phone-d-p)

**Owns:** `src/features/project/` except the task panel and the row files of track W and track K. Exact list:
- Edit: `ProjectScreen.tsx`, `ProjectHeader.tsx`, `ProjectActions.tsx`, `StageControl.tsx`, `HealthControl.tsx`, `tabs.tsx`,
  `overview/OverviewTab.tsx`, `overview/ActivityTab.tsx`, `overview/Composer.tsx`, `tasks/TasksTab.tsx`, `tasks/TaskList.tsx`,
  `tracker/TrackerTab.tsx`, `tracker/QuickLog.tsx`, `files/FilesTab.tsx`, `files/PreviewSheet.tsx`.
- Create: `MoreTab.tsx`, `mainButton.ts`, `phoneTest.ts`, `overview/postDraft.ts`, `tasks/ViewButton.tsx`.
- Words: `src/i18n/real/phoneproject.en.json`, `src/i18n/real/phoneproject.ar.json`.
- Tests: the new and changed test files named in each task, and `tests/e2e/projects.spec.ts` with `tests/e2e-deploy/projects.spec.ts`.
- Never edit: `tasks/TaskSheet.tsx` and the other task panel files (track K), `tasks/SortableTaskRows.tsx`, `RowGrip.tsx`,
  `DragLayer.tsx`, `TaskBoard.tsx`, `TaskRowItem.tsx`, `TaskPeople.tsx` (track W), the checklist files (track K), `PausedBanner.tsx`
  (no change is needed), the shared components and the shell (track S).

**Reads:** the area section "A project"; the design rules 1, 4, 5, 7, 8, 9 and 10; lead decisions 4, 6, 8, 9 and 14; the contract parts
`SheetOrPopover`, `Menu` `sheetOnPhone`, `Tabs` `spread`, `isPhoneNow()`, `lastList.ts` and `--phone-bar`.

**Hand-offs (no task in this track):**
- Track W owns `TaskPeople.tsx`. Track W must swap its `Popover` for `SheetOrPopover` in the same edit as the 44 px press area. This track
  only reads the result. Track W also owns press and hold, the board lane and the board Move menu. The project To-dos tab shows them with no change.
- Track K keeps the export `taskPanelReads` of `tasks/TaskSheet.tsx`. `tabs.tsx` imports it.
- Track I reads `state.from` on Back from a chat. This track sends `state={{ from: pathname + search }}` (a string such as `/projects/prj_001?tab=files`).
- The lead (track L) writes the `src/CLAUDE.md` and `DESIGN.md` lines. The facts for them are in the last section.

**Test helper rule for the phone.** jsdom is a desk. Every phone test calls `mockViewport()` from `phoneTest.ts` (Task P2). Every file with such a test runs
`afterEach(() => vi.restoreAllMocks())`.

---

### Task P1: The phone tab model and the tab links

**Files:**
- Modify: `src/features/project/tabs.tsx`
- Test: `src/features/project/tabs.test.tsx`

**Interfaces:**
- Consumes: the current `PROJECT_TABS`, `FILTER_PARAMS`, `tabReads`.
- Produces (all exported from `tabs.tsx`):
```ts
export const PHONE_TABS = ['overview', 'tasks', 'tracker', 'files', 'more'] as const;
export const MORE_PAGES = ['activity', 'schedule', 'team'] as const;
export type ProjectPhoneTab = (typeof PHONE_TABS)[number];
export type MorePage = (typeof MORE_PAGES)[number];
export type ProjectTab = (typeof PROJECT_TABS)[number] | 'more';      // PROJECT_TABS stays the 7 desk tabs
export function tabOfLink(raw: string | null, phone: boolean): ProjectTab;
export function litPhoneTab(tab: ProjectTab): ProjectPhoneTab;         // activity, schedule, team and more give 'more'
export function isMorePage(tab: ProjectTab): tab is MorePage;
export function tabSearch(current: URLSearchParams, next: ProjectTab): URLSearchParams; // { tab: next } plus the FILTER_PARAMS of current
```
- `TAB_BODY` gets the line `more: null` (Task P2 fills it). `tabReads('more', ...)` returns `[]`.

- [ ] **Step 1: Write the failing test** (pure functions, in `tabs.test.tsx`)
```ts
it('resolves the tab of a link on a desk and on a phone', () => {
  expect(tabOfLink('more', false)).toBe('overview');        // a desk has no More tab
  expect(tabOfLink('activity', false)).toBe('activity');
  expect(tabOfLink('more', true)).toBe('more');
  expect(tabOfLink('team', true)).toBe('team');             // the link keeps the page, the row lights More
  expect(tabOfLink('nonsense', true)).toBe('overview');
  expect(tabOfLink(null, true)).toBe('overview');
});
it('lights More for the three pages of More', () => {
  expect(['activity', 'schedule', 'team', 'more'].map((t) => litPhoneTab(t as ProjectTab))).toEqual(['more', 'more', 'more', 'more']);
  expect(litPhoneTab('tasks')).toBe('tasks');
  expect(isMorePage('schedule')).toBe(true); expect(isMorePage('files')).toBe(false);
});
it('keeps the filters when it changes the tab', () => {
  expect(tabSearch(new URLSearchParams('tab=tasks&show=mine&task=tsk_007'), 'tracker').toString()).toBe('tab=tracker&show=mine');
});
it('asks no read for More', () => {
  expect(tabReads('more', 'prj_001', new URLSearchParams(), { payments: false, today: TODAY })).toEqual([]);
});
```
- [ ] **Step 2: Run it and see it fail**
  Run: `npx vitest run src/features/project/tabs.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, `tabOfLink is not a function` (the exports do not exist).
- [ ] **Step 3: Implement.** Add the constants, the types and the four functions to `tabs.tsx`. `tabOfLink` on a desk accepts only `PROJECT_TABS`.
  On a phone it accepts `PHONE_TABS` and `MORE_PAGES`. `tabSearch` is the loop that `ProjectScreen` now has inline. Change the type of
  `TAB_BODY` and the `tab` parameter of `tabReads` to the new `ProjectTab`. The desk link `?tab=more` opens Overview.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/tabs.test.tsx --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. The held-answer trip tests of the desk tabs stay green.
- [ ] **Step 5: Commit.**
  `git add src/features/project/tabs.tsx src/features/project/tabs.test.tsx && git commit -m "Project: add the phone tab model and the tab link helpers"`

---

### Task P2: The More tab and its three sub-pages

**Files:**
- Create: `src/features/project/MoreTab.tsx`, `src/features/project/phoneTest.ts`
- Create: `src/i18n/real/phoneproject.en.json`, `src/i18n/real/phoneproject.ar.json`
- Modify: `src/features/project/tabs.tsx` (`TAB_BODY.more = MoreTab`), `src/features/project/ProjectScreen.tsx` (the tab comes from `tabOfLink(raw, useIsPhone())`; the body of a More page is `MoreSubPage`)
- Test: `src/features/project/MoreTab.test.tsx` (new)

**Interfaces:**
- Consumes: `tabOfLink`, `isMorePage`, `tabSearch`, `MorePage` (P1); `ActivityTab`, `ScheduleTab`, `TeamTab`; `spring` from `design/motion`.
- Produces:
```ts
export function MoreTab(props: TabProps): JSX.Element;                              // one panel, three link rows
export function MoreSubPage(props: TabProps & { page: MorePage }): JSX.Element;    // back row, h2 title, the page body
// phoneTest.ts
export function mockViewport(phone?: boolean, o?: { reducedMotion?: boolean }): { setPhone(next: boolean): void };
```
`mockViewport` spies on `window.matchMedia`. It answers true for `(max-width: 639px)` when `phone` is true. It answers true for `(prefers-reduced-motion: reduce)` when
`reducedMotion` is true. It keeps the `change` listeners, and `setPhone` calls them.

Words (all in `phoneProject.more`):

| Key | English | Arabic |
| --- | --- | --- |
| `activityLine` | Posts, decisions and changes. | المنشورات والقرارات والتغييرات. |
| `scheduleLine` | Stage dates and deadlines. | تواريخ المراحل والمواعيد. |
| `teamLine` | Who is on this project. | من يعمل في هذا المشروع. |
| `back` | More | المزيد |

The row titles reuse `project.tab.activity`, `project.tab.schedule` and `project.tab.team`.

- [ ] **Step 1: Write the failing test** (`MoreTab.test.tsx`, phone, user `usr_002`)
```ts
it('lists Activity, Schedule and Team as three links on the More tab', async () => {
  mockViewport(true);
  await renderApp('/projects/prj_001?tab=more', as('usr_002'));
  const rows = await screen.findAllByRole('link', { name: /^(Activity|Schedule|Team)/ });
  expect(rows.map((r) => r.getAttribute('href'))).toEqual(['#/projects/prj_001?tab=activity', '#/projects/prj_001?tab=schedule', '#/projects/prj_001?tab=team']);
  expect(screen.getByText('Stage dates and deadlines.')).toBeInTheDocument();
});
it('opens a sub-page with a 44 px back row, and Back returns to the list', async () => {
  mockViewport(true);
  const { router } = await renderApp('/projects/prj_001?tab=more', as('usr_002'));
  await userEvent.click(await screen.findByRole('link', { name: /^Schedule/ }));
  expect(await screen.findByRole('heading', { level: 2, name: 'Schedule' })).toBeInTheDocument();
  const back = screen.getByRole('link', { name: 'More' });
  expect(back).toHaveAttribute('href', '#/projects/prj_001?tab=more');
  expect(back).toHaveClass('min-h-11');
  await act(async () => { await router.navigate(-1); });
  expect(await screen.findAllByRole('link', { name: /^Team/ })).not.toHaveLength(0);
});
it('opens the page named in the link, also after a reload', async () => {
  mockViewport(true);
  await renderApp('/projects/prj_001?tab=team', as('usr_002'));
  expect(await screen.findByRole('heading', { level: 2, name: 'Team' })).toBeInTheDocument();
});
it('keeps the desk as it is: ?tab=more opens Overview', async () => {          // no mockViewport
  await renderApp('/projects/prj_001?tab=more');
  expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});
it('writes the rows in Arabic', async () => {
  mockViewport(true);
  await renderApp('/projects/prj_001?tab=more', (s) => { s.users.usr_001.preferences.language = 'ar'; });
  expect(await screen.findByRole('link', { name: /^النشاط/ })).toBeInTheDocument();
  expect(screen.getByText('من يعمل في هذا المشروع.')).toBeInTheDocument();
});
```
- [ ] **Step 2: Run it and see it fail**
  Run: `npx vitest run src/features/project/MoreTab.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, the module `./phoneTest` does not exist; after the helper exists, FAIL because the link rows are missing.
- [ ] **Step 3: Implement.** `MoreTab` is one `panel` with a `ul` of three `Link` rows (44 px or more, `pressable`, a line in `text-footnote text-ink-2`, a
  `ChevronRightIcon` with `rtl:-scale-x-100`, no icon tile). Each `to` is `{ search: '?' + tabSearch(params, page) }`. `MoreSubPage` draws the back row (`Link` to
  `?tab=more`, `ChevronLeftIcon` with `rtl:-scale-x-100`, `min-h-11`, the word `phoneProject.more.back`), then `<h2 className="text-section">` with the page name,
  then the body. The wrapper is a `motion.div` that slides in from the end side: `initial={{ opacity: 0, x: rtl ? -24 : 24 }}`, `animate={{ opacity: 1, x: 0 }}`,
  `transition={spring.standard}` (`MotionConfig` removes the slide under reduced motion). In `ProjectScreen`, `const phone = useIsPhone(); const tab = tabOfLink(raw, phone);`.
  The body is `<MoreSubPage page={tab} />` when `phone && isMorePage(tab)`, else `TAB_BODY[tab]`. Leave the 7 desk tabs row as it is (Task P6 changes the row).
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/MoreTab.test.tsx src/features/project/tabs.test.tsx --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS.
- [ ] **Step 5: Commit.**
  `git add src/features/project/MoreTab.tsx src/features/project/phoneTest.ts src/features/project/MoreTab.test.tsx src/features/project/tabs.tsx src/features/project/ProjectScreen.tsx src/i18n/real/phoneproject.en.json src/i18n/real/phoneproject.ar.json && git commit -m "Project: the More tab shows Activity, Schedule and Team as sub-pages on a phone"`

---

### Task P3: Sheets for the stage list, the health form and More actions

**Files:**
- Modify: `src/features/project/StageControl.tsx`, `src/features/project/HealthControl.tsx`, `src/features/project/ProjectActions.tsx`
- Test: `src/features/project/ProjectSheets.test.tsx` (new)

**Interfaces:**
- Consumes: `SheetOrPopover({ open, onOpenChange, anchor, title, children })` from `src/components/SheetOrPopover.tsx`; `Menu` prop `sheetOnPhone`; `isPhoneNow()`; `projectsListLink()`.
- Produces: no new export. `StageControl`, `HealthControl`, `ProjectActions` and `LeaderSheet` keep their names and props.

- [ ] **Step 1: Write the failing test** (`ProjectSheets.test.tsx`, user `usr_002`, leader of `prj_001`)
```ts
it('opens the stage list as a sheet on a phone', async () => {
  mockViewport(true);
  await renderApp('/projects/prj_001', as('usr_002'));
  await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Stages' });
  expect(sheet.querySelector('[data-sheet-title]')).not.toBeNull();       // a sheet, not a popover
  await userEvent.click(within(sheet).getByRole('button', { name: /Permits/ }));
  expect(await within(sheet).findByText('To-dos done: 0 of 2')).toBeInTheDocument();
});
it('keeps the popover on a desk', async () => {                            // no mockViewport
  await renderApp('/projects/prj_001', as('usr_002'));
  await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
  expect((await screen.findByRole('dialog', { name: 'Stages' })).querySelector('[data-sheet-title]')).toBeNull();
});
it('sets the health in a sheet on a phone', async () => {
  mockViewport(true);
  await renderApp('/projects/prj_001', as('usr_002'));
  await userEvent.click(await screen.findByRole('button', { name: /Late/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Set health' });
  await userEvent.click(within(sheet).getByRole('radio', { name: 'At risk' }));
  await userEvent.type(within(sheet).getByLabelText('Reason'), 'Client delay');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Set health' }));
  expect(await screen.findByText('Set by Faisal Al-Harbi')).toBeInTheDocument();
});
it('opens More actions as a sheet of rows, not a menu, with the same items', async () => {
  mockViewport(true);
  await renderApp('/projects/prj_001', as('usr_001'));
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  for (const label of ['Edit project', 'Change leader', 'Pause project', 'Delete project']) expect(await screen.findByText(label)).toBeInTheDocument();
  expect(screen.queryByRole('menu')).toBeNull();
});
it('goes to the remembered Projects list after a delete on a phone, and to /projects on a desk', async () => {
  mockViewport(true); rememberProjectsList('?filter=at_risk');
  onTestFinished(() => rememberProjectsList(''));
  await renderApp('/projects/prj_001');
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  await userEvent.click(await screen.findByText('Delete project'));
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete Corniche Office Tower?' })).getByRole('button', { name: 'Delete project' }));
  await waitFor(() => expect(window.location.hash).toBe('#/projects?filter=at_risk'));
});
it('keeps the open stage sheet when the phone turns sideways (640 px and wider)', async () => {
  const view = mockViewport(true);
  await renderApp('/projects/prj_001', as('usr_002'));
  await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
  await screen.findByRole('dialog', { name: 'Stages' });
  act(() => view.setPhone(false));
  const popover = await screen.findByRole('dialog', { name: 'Stages' });
  expect(popover.querySelector('[data-sheet-title]')).toBeNull();
});
```
  Add a desk test for the delete: `/projects` after delete, with `rememberProjectsList('?filter=at_risk')` set (the desk keeps today's address).
- [ ] **Step 2: Run it and see it fail**
  Run: `npx vitest run src/features/project/ProjectSheets.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, the stage dialog has no `[data-sheet-title]` and `menu` still exists.
- [ ] **Step 3: Implement.**
  - `StageControl`: replace `{open && ref.current && <Popover ...>}` with `<SheetOrPopover open={open} onOpenChange={setOpen} anchor={ref.current} title={t('project.stages')}>`.
    Show the `text-headline` heading `<p>` only on a desk (`!useIsPhone()`), because the sheet draws the title. Keep the rest of the children.
  - `HealthControl`: the anchor state stays. Use `SheetOrPopover` with `title={t('health.override')}`, `open={anchor !== null}` and `onOpenChange={(o) => !o && setAnchor(null)}`. Hide the first heading on a phone.
  - `ProjectActions`: add `sheetOnPhone` to the `Menu`. In `DeleteProjectSheet`, `navigate(isPhoneNow() ? projectsListLink() : '/projects')`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/ProjectSheets.test.tsx src/features/project/ProjectScreen.test.tsx src/features/project/PauseKinds.test.tsx --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. The desk tests of the header stay green.
- [ ] **Step 5: Commit.**
  `git add src/features/project/StageControl.tsx src/features/project/HealthControl.tsx src/features/project/ProjectActions.tsx src/features/project/ProjectSheets.test.tsx && git commit -m "Project: the stage list, the health form and More actions open as sheets on a phone"`

---

### Task P4: Overview on a phone, the post box and the Activity page

**Files:**
- Create: `src/features/project/overview/postDraft.ts`
- Modify: `src/features/project/overview/OverviewTab.tsx`, `src/features/project/overview/Composer.tsx`, `src/features/project/overview/ActivityTab.tsx`, `src/i18n/real/phoneproject.en.json`, `src/i18n/real/phoneproject.ar.json`
- Test: `src/features/project/overview/postDraft.test.tsx` (new), `src/features/project/overview/OverviewPhone.test.tsx` (new)

**Interfaces:**
- Consumes: `useIsPhone`, `useDraftOwner`, `readDraft`, `writeDraft` from `app/drafts`; `NextDeadlineLabel`; `ChatDropArea`, `DropReceiver`.
- Produces:
```ts
export function usePostDraft(projectId: string, persist: boolean): [string, (next: string) => void];
// persist true: the text is shared by every user of the hook for this person and project, and it lives in the draft store (key `post:<projectId>`).
// persist false: it is plain local state (the desk keeps today's box).
// Composer props: { detail: ProjectDetail; compact?: boolean }
```
Word (in `phoneProject.overview`): `nextDeadline` = "Next deadline" / «الموعد القادم». The Updates panel reuses `overview.feed` ("Updates"), `overview.noPosts`, `overview.cannotPost`, `overview.seeActivity`.

Phone order of the panels: Where the project stands (`overview-standing`), Needs attention (`overview-attention`), Payments (`overview-payments`, payment roles), Updates (`overview-updates`), Meetings
(`overview-meetings`), Coming up (`overview-coming`), Who is doing what (`overview-people`), About (`about-title`). The desk keeps its two columns.

- [ ] **Step 1: Write the failing tests.**
  `postDraft.test.tsx` (`renderWithRuntime`, two probe components):
```ts
it('shares the text between two readers of the same project, at once', ...);           // type in A, B shows it with no remount
it('gives the text back after a remount, from the draft store', ...);
it('works when the browser blocks storage', ...);                                      // vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw new Error('blocked'); }); the text still shows in both readers
it('keeps the box of a desk apart (persist false)', ...);                              // two readers with persist false do not share
```
  `OverviewPhone.test.tsx` (phone, `usr_002` unless noted):
```ts
it('orders the panels for a phone', async () => {
  mockViewport(true); await renderApp('/projects/prj_001', as('usr_002'));
  await screen.findByRole('region', { name: 'Who is doing what' });
  const ids = [...document.querySelectorAll('main section[aria-labelledby]')].map((s) => s.getAttribute('aria-labelledby'));
  expect(ids.filter((i) => ['overview-standing','overview-attention','overview-updates','overview-meetings','overview-coming','overview-people','about-title'].includes(i!)))
    .toEqual(['overview-standing','overview-attention','overview-updates','overview-meetings','overview-coming','overview-people','about-title']);
});
it('puts the payments panel after Needs attention for a payment role', ...);          // usr_001: overview-payments sits between overview-attention and overview-updates
it('drops the stage name, count and steps from the first panel, and keeps the facts', ...);  // standing has no progressbar; has 'To-dos in this stage' and 'Stage end'
it('shows the Next deadline row, in the Attention color when the date is past', async () => {
  // prepare: delete every state.deadlines entry of prj_001, add { id:'ddl_t', projectId:'prj_001', stageId:null, name:'Permit set', date: addDays(TODAY,-2) }
  // expect term 'Next deadline' and 'Permit set' with class text-attn
});
it('says No deadline when the project has no deadline and no stage end', ...);        // prepare: no deadlines, project.status 'on_hold' (stageEnd null)
it('shows who set the health and why in the first panel', ...);                      // override with a reason as usr_002, then read the note
it('shows the Updates panel with the box and the two newest posts', ...);             // heading 'Updates'; [data-post] count = min(2, kind:'update' items of updates.list posts); link 'See all activity' href '#/projects/prj_001?tab=activity'
it('shows the line "Only the project team can post here." in place of the box', ...); // usr_003
it('makes the box compact until it has the focus', async () => {
  // before focus: textbox 'Post an update' has class min-h-11 (no min-h-24), no 'Attach' and no 'Post' button
  // after userEvent.click(textbox): 'Post' button visible; after typing 'Hello' the 'Post' button has class signature
  // blur with empty text collapses it again
});
it('keeps the typed update across a tab change', ...);                                 // type, router.navigate to ?tab=tasks and back, value 'Hello'
it('opens ?compose=1 on the box, scrolls to it and focuses it', ...);                 // Element.prototype.scrollIntoView = vi.fn(); expect called; textbox toHaveFocus; hash has no compose
it('shows no drop frame for the box on a phone', ...);                               // fireEvent.dragEnter(form, { dataTransfer: { types: ['Files'] } }); 'The files join this post. Nothing posts until you press Post.' absent; on a desk (ActivityTab) it shows
it('opens the task panel from ?task= on Overview', ...);                              // '?task=tsk_007' phone: dialog opens
it('leaves the box off the Activity page on a phone', ...);                          // ?tab=activity: no textbox 'Post an update', no cannot-post line, filter button still there
it('keeps the desk Overview as it is', ...);                                          // 1 region 'Latest update', two columns; no mockViewport
```
- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run src/features/project/overview/postDraft.test.tsx src/features/project/overview/OverviewPhone.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, `./postDraft` is missing; then the panel order and the Updates panel are missing.
- [ ] **Step 3: Implement.**
  - `postDraft.ts`: a module `Map` of live text and a `Set` of listeners. `useSyncExternalStore` reads the live text first, then `readDraft`. The setter writes to the map and to `writeDraft`, then calls the listeners.
    The key is `${owner}|${projectId}`. With `persist` false the hook returns `useState('')` (call both hooks, pick one).
  - `Composer`: `const phone = useIsPhone()`. Use `usePostDraft(detail.project.id, phone)`. On a phone: no `ChatDropArea` and no `DropReceiver`, but keep `useBlockFileDrop()`. With `compact`,
    the textarea is `[&_textarea]:min-h-11` until the form has focus (`onFocus`, `onBlur` with `relatedTarget` check), text, or picked files. Then `min-h-24` and the Attach and Post row show.
    The `compose=1` effect also calls `area.current.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })`. Read `reduced` with `matchMedia('(prefers-reduced-motion: reduce)')`.
  - `OverviewTab`: on a phone return one column `div.flex.flex-col.gap-5` with the order above. `Standing` gets `phone`: no stage name, count, health word or progress line. Keep the two facts, the moved-back note and the health note.
    Add the row `phoneProject.overview.nextDeadline` with `<NextDeadlineLabel deadline={detail.nextDeadline} />` when `detail.nextDeadline` exists. When `!detail.nextDeadline && !detail.stageEnd`, show `projects.noDeadline`.
    New `UpdatesPanel` (same file): `section aria-labelledby="overview-updates"` with `h2 overview.feed`, the `Composer compact` (or the cannot-post line), the two newest posts as `li[data-post]` (the block of `LatestUpdate`), and the link `?tab=activity`.
    Keep `<TaskSheet>` and the payment panel line as they are.
  - `ActivityTab`: on a phone render neither the box nor the cannot-post line.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/overview --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. `OverviewTab.test.tsx` and `ActivityTab.test.tsx` stay green on the desk.
- [ ] **Step 5: Commit.**
  `git add src/features/project/overview src/i18n/real/phoneproject.en.json src/i18n/real/phoneproject.ar.json && git commit -m "Project: Overview panels in phone order, an Updates panel with a compact post box, and a draft that survives a tab change"`

---

### Task P5: The header on a phone and the one navy button of each tab

**Files:**
- Create: `src/features/project/mainButton.ts`
- Modify: `src/features/project/ProjectHeader.tsx`, `src/features/project/ProjectScreen.tsx` (pass `tab`, the phone `onPost`)
- Test: `src/features/project/mainButton.test.ts` (new), `src/features/project/ProjectHeaderPhone.test.tsx` (new)

**Interfaces:**
- Consumes: `ProjectTab` (P1), `usePostDraft` (P4), `StageControl`, `HealthControl`, `ProjectActions` (P3), `ProgressLine`, `NextDeadlineLabel`.
- Produces:
```ts
export type MainButton = 'post' | 'log' | 'add' | 'box';
export type MainCan = Pick<ProjectDetail['viewerCan'], 'postUpdate' | 'logTracker' | 'upload' | 'links'>;
export function phoneMainButton(tab: ProjectTab, can: MainCan, hasDraft: boolean): MainButton;
export function tabButtonShows(tab: 'tracker' | 'files', can: MainCan): boolean;       // logTracker; or upload || links
// ProjectHeader props: { detail: ProjectDetail; onPost: () => void; tab: ProjectTab }
```
Rule of `phoneMainButton`: `tracker` with `logTracker` gives `'log'`. `files` with `upload || links` gives `'add'`. `overview` with `postUpdate` and a draft gives `'box'`. Else `'post'`.
The header "Post update" is navy only for `'post'`. Tasks P8 and P9 use `tabButtonShows` for their own buttons.

- [ ] **Step 1: Write the failing tests.**
  `mainButton.test.ts`: a table of the rule, with these rows: `(tracker, logTracker) -> log`; `(tracker, no logTracker) -> post`; `(files, upload) -> add`; `(files, links only) -> add`; `(files, neither) -> post`;
  `(overview, postUpdate, draft) -> box`; `(overview, no postUpdate, draft) -> post`; `(tasks, any, draft) -> post`; `(more, any, draft) -> post`.
  `ProjectHeaderPhone.test.tsx` (phone, `usr_002`):
```ts
it('draws the identity row, the stage row and the action row', async () => {
  mockViewport(true); await renderApp('/projects/prj_001', as('usr_002'));
  const header = (await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).closest('header') as HTMLElement;
  expect(within(header).getByText('Stage 4 of 7')).toBeInTheDocument();
  expect(within(header).getByRole('progressbar', { name: 'Stage 4 of 7' })).toHaveClass('w-full');
  expect(within(header).queryByText(/Stage ends|No deadline/)).toBeNull();               // the label left the header
  expect(within(header).getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  const post = within(header).getByRole('button', { name: 'Post update' });
  const chat = within(header).getByRole('link', { name: 'Project chat' });
  expect(post).toHaveClass('flex-1', 'signature'); expect(chat).toHaveClass('flex-1', 'bg-fill');
});
it('gives the row to the one button that stays', ...);           // a person with postUpdate and no chat: Post update has class flex-1 and is the only button of the row
it('hides the action row for a person with neither button', ...); // usr_003 (viewer only): header has no [data-action-row]
it('turns Post update grey on Tracker and Files when the tab button shows', async () => {
  // ?tab=tracker and ?tab=files as usr_002: 'Post update' has no class signature
});
it('turns Post update grey while the update box holds text, and keeps one navy button', async () => {
  // ?tab=overview: type 'Hi' in the box -> header 'Post update' has no signature; document.querySelectorAll('main .signature') has length 1 (the box button)
});
it('opens the Project chat with the opener in the state', async () => {
  const { router } = await renderApp('/projects/prj_001?tab=files', as('usr_002'));
  await userEvent.click(await screen.findByRole('link', { name: 'Project chat' }));
  expect(router.state.location.state).toEqual({ from: '/projects/prj_001?tab=files' });
});
it('sends Post update to the box on Overview', ...);              // click on ?tab=files: hash becomes tab=overview&compose=1, then the box has focus
it('keeps the desk header: one row, next deadline label, no stage count text', ...);   // no mockViewport
```
- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run src/features/project/mainButton.test.ts src/features/project/ProjectHeaderPhone.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, `./mainButton` is missing; then the phone rows are missing.
- [ ] **Step 3: Implement.** In `ProjectHeader`, `if (phone) return <PhoneHeader .../>`. `PhoneHeader` is one `<header className="flex flex-col gap-3">`:
  1. Identity row: `ProjectTile` 48 with `subCompanyId` and `shared`, a `min-w-0 flex-1` block with the `h1` (same `motion.span layoutId={'name-' + id}`, `transition={spring.expand}`, `[text-wrap:balance]`)
     and the code, client and "View only" tag line, then `ProjectActions` (44 px).
  2. Stage row: `StageControl`, the text `projects.stageCount` (`text-footnote text-ink-2`), and `HealthControl` in `ms-auto`.
  3. `ProgressLine` with `size="md"` and `className="w-full"`. No `NextDeadlineLabel`.
  4. Action row `div[data-action-row].flex.gap-2`: `Button` "Post update" (`flex-1`, `variant={main === 'post' ? 'primary' : 'secondary'}`) when `viewerCan.postUpdate`, and the chat `Link` (`flex-1`, grey) when `detail.chatId`.
     Draw no row when both are missing. The chat link passes `state={{ from: location.pathname + location.search }}` (use `useLocation`, on both widths).
  `main` comes from `phoneMainButton(tab, viewerCan, usePostDraft(project.id, true)[0].trim() !== '')`. `ProjectScreen` passes `tab` and uses `onPost = () => setParams({ tab: phone ? 'overview' : 'activity', compose: '1' })`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/mainButton.test.ts src/features/project/ProjectHeaderPhone.test.tsx src/features/project/ProjectScreen.test.tsx src/features/project/ProjectChatButton.test.tsx src/features/project/ProjectAudit.test.tsx --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. `ProjectAudit.test.tsx` (the Stale sign in the header) and `ProjectChatButton.test.tsx` stay green on the desk.
- [ ] **Step 5: Commit.**
  `git add src/features/project/mainButton.ts src/features/project/mainButton.test.ts src/features/project/ProjectHeader.tsx src/features/project/ProjectHeaderPhone.test.tsx src/features/project/ProjectScreen.tsx && git commit -m "Project: a phone header with an identity row, a stage row and an action row, and one navy button for each tab"`

---

### Task P6: The tab row of the project page on a phone

**Files:**
- Modify: `src/features/project/ProjectScreen.tsx`, `src/i18n/real/phoneproject.en.json`, `src/i18n/real/phoneproject.ar.json`
- Test: `src/features/project/ProjectScreenPhone.test.tsx` (new)

**Interfaces:**
- Consumes: `Tabs` props `spread` (track S), `PHONE_TABS`, `litPhoneTab`, `tabSearch`, `isMorePage` (P1), `projectsListLink`, `rememberProjectsList`.
- Produces: no export. The anchor element is `div[data-tab-anchor]` (height 0) right before the sticky row.

Words (`phoneProject.tab`):

| Key | English | Arabic |
| --- | --- | --- |
| `overview` | Overview | نظرة عامة |
| `tasks` | To-dos | المهام |
| `tracker` | Tracker | المتابعة |
| `files` | Files & Links | الملفات والروابط |
| `more` | More | المزيد |

- [ ] **Step 1: Write the failing test** (`ProjectScreenPhone.test.tsx`, phone, `usr_002`)
```ts
it('shows five equal tabs, in this order, and lights More for its pages', async () => {
  mockViewport(true); await renderApp('/projects/prj_001?tab=schedule', as('usr_002'));
  const tabs = await screen.findAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'To-dos', 'Tracker', 'Files & Links', 'More']);
  expect(screen.getByRole('tab', { name: 'More' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-more');
});
it('keeps the filters when the tab changes', async () => {
  mockViewport(true); await renderApp('/projects/prj_001?tab=tasks&show=mine', as('usr_002'));
  await userEvent.click(await screen.findByRole('tab', { name: 'Tracker' }));
  expect(window.location.hash).toBe('#/projects/prj_001?tab=tracker&show=mine');
});
it('makes the row sticky on a solid page color', async () => {
  mockViewport(true); await renderApp('/projects/prj_001', as('usr_002'));
  const row = (await screen.findByRole('tablist')).closest('.sticky') as HTMLElement;
  expect(row).toHaveClass('top-[env(safe-area-inset-top)]', 'bg-bg');
});
it('scrolls to the tab row when the header is out of view, and not when it is in view', async () => {
  // spy HTMLElement.prototype.getBoundingClientRect: [data-tab-anchor] top -300 -> click 'To-dos' -> window.scrollTo({ top: scrollY - 300, behavior: 'smooth' })
  // top 20 -> window.scrollTo not called; with mockViewport(true, { reducedMotion: true }) behavior is 'auto'
});
it('sends ?tab=activity&compose=1 to the box on Overview', ...);           // hash ends tab=overview, textbox 'Post an update' has focus
it('writes the tab words in Arabic', ...);                                 // ['نظرة عامة','المهام','المتابعة','الملفات والروابط','المزيد']
it('sends "Project not found" back to the remembered Projects list on a phone', async () => {
  mockViewport(true); rememberProjectsList('?filter=mine'); onTestFinished(() => rememberProjectsList(''));
  await renderApp('/projects/prj_999');
  expect(await screen.findByRole('link', { name: 'Projects' })).toHaveAttribute('href', '#/projects?filter=mine');
});
it('keeps the seven desk tabs and the link /projects on a desk', ...);       // no mockViewport; ['Overview','To-dos','Activity','Tracker','Schedule','Files & Links','Team']; href '#/projects'
```
- [ ] **Step 2: Run it and see it fail**
  Run: `npx vitest run src/features/project/ProjectScreenPhone.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, the phone still shows seven tabs.
- [ ] **Step 3: Implement.** In `ProjectScreen`, on a phone render `<div data-tab-anchor className="h-0" />` then `<div className="sticky top-[env(safe-area-inset-top)] z-20 bg-bg">` around
  `<Tabs spread value={litPhoneTab(tab)} options={PHONE_TABS.map(...)}>`; the label of each option is `t('phoneProject.tab.' + value)`. Fix the side margin so the row has no sideways scroll at 390 px (P10 measures it).
  `TabPanel value={litPhoneTab(tab)}`. `onChange(next)` sets `tabSearch(current, next)` and then calls `scrollToTabRow()`: read the anchor top, and when it is below 0 call
  `window.scrollTo({ top: window.scrollY + top, behavior })`, with `behavior` `'auto'` under reduced motion. An effect on a phone with `tab === 'activity'` and `compose === '1'` calls `setParams({ tab: 'overview', compose: '1' }, { replace: true })`.
  The not-found link is `phone ? projectsListLink() : '/projects'`. The desk row stays the 7 tabs.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/ProjectScreenPhone.test.tsx src/features/project/ProjectScreen.test.tsx src/features/project/MoreTab.test.tsx src/features/project/tabs.test.tsx --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS.
- [ ] **Step 5: Commit.**
  `git add src/features/project/ProjectScreen.tsx src/features/project/ProjectScreenPhone.test.tsx src/i18n/real/phoneproject.en.json src/i18n/real/phoneproject.ar.json && git commit -m "Project: five equal tabs in a sticky row on a phone, with scroll to the row on a tab change"`

---

### Task P7: The To-dos tab on a phone

**Files:**
- Create: `src/features/project/tasks/ViewButton.tsx`
- Modify: `src/features/project/tasks/TasksTab.tsx`, `src/features/project/tasks/TaskList.tsx`, `src/i18n/real/phoneproject.en.json`, `src/i18n/real/phoneproject.ar.json`
- Test: `src/features/project/tasks/TasksTabPhone.test.tsx` (new)

**Interfaces:**
- Consumes: `FilterButton` (its sheet on a phone), `usePersistentChoice('madar.tasks.view', ...)`, `FolderKanbanIcon`.
- Produces:
```ts
export function ViewButton(props: { view: 'list' | 'board'; onView: (next: 'list' | 'board') => void }): JSX.Element;
// A 44 px pill (the look of FilterButton). Its text is `phoneProject.tasks.view` with the current view word. One press switches the view.
```
Words (`phoneProject.tasks`):

| Key | English | Arabic |
| --- | --- | --- |
| `view` | View: {{view}} | العرض: {{view}} |
| `doneOf` | {{done}} of {{total}} done | {{done}} من {{total}} منجزة |

`{{view}}` is `tasks.views.list` or `tasks.views.board`.

- [ ] **Step 1: Write the failing test** (`TasksTabPhone.test.tsx`, phone, `usr_002`, `?tab=tasks`)
```ts
it('shows two buttons: Filter and View', async () => {
  mockViewport(true); await renderApp(TASKS, as('usr_002'));
  expect(await screen.findByRole('button', { name: /^Filter/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View: List' })).toHaveClass('min-h-11');
  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Filter' });
  expect(within(sheet).queryByRole('radio', { name: 'Board' })).toBeNull();           // View left the Filter sheet
  expect(within(sheet).getByRole('checkbox', { name: 'Show done to-dos' })).toBeInTheDocument();   // use the real label of tasks.showDone
});
it('switches to the board in one press and keeps the choice on the device', async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'View: List' }));
  expect(screen.getByRole('button', { name: 'View: Board' })).toBeInTheDocument();
  expect(window.localStorage.getItem('madar.tasks.view')).toBe('board');
});
it('titles a stage group "n of m done" under the filter All', async () => {
  // pick the first stage of prj_001 with tasks from store.state: done = tasks with status done, total = all its tasks
  expect(within(group).getByText(`${done} of ${total} done`)).toBeInTheDocument();
});
it('keeps the count of today under any other filter', ...);                           // ?show=mine: 'To-dos: n' with n = rows of the group
it('keeps "To-dos: 0" for a stage with no task', ...);                              // never "0 of 0 done"
it('counts the hidden done to-dos in the total', ...);                              // the done to-dos are hidden by default, total still includes them
it('puts the add row last in each group, and first on a desk', async () => {
  // phone: the form with the field 'Add a to-do in <stage>' comes after the rows list (compareDocumentPosition FOLLOWING)
  // desk (no mockViewport): it comes before the rows list
});
it('keeps the add row 44 px and the template menu at its end', ...);                // button 'New to-do in <stage>' has class size-11; 'From a template' menu after the field
it('keeps the "N have no lead" line and Show them', ...);
```
- [ ] **Step 2: Run it and see it fail**
  Run: `npx vitest run src/features/project/tasks/TasksTabPhone.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, there is no `View: List` button and the Filter sheet still holds the View radios.
- [ ] **Step 3: Implement.** `TasksBody`: `const phone = useIsPhone()`. On a phone omit the View `fieldset` from the Filter box and draw `<ViewButton view={view} onView={onView} />` next to it.
  `TaskList`: on a phone and `!filtered`, the group count is `t('phoneProject.tasks.doneOf', { done, total })`. With `showDone` (`doneCounts` is `{}`): `done` is the done rows of `stageRows`, `total` is `stageRows.length`.
  Without it: `done = doneCounts[stage.id] ?? 0` and `total = stageRows.length + done`. When `total` is 0, or when `filtered`, keep `t('tasks.count', { n: stageRows.length })`.
  Move `QuickAdd` after the rows and after the empty line on a phone.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/tasks/TasksTabPhone.test.tsx src/features/project/tasks/TasksTab.test.tsx src/features/project/tasks/TaskListOrder.test.tsx src/features/project/tasks/TasksTabRenders.test.tsx src/features/project/tasks/TemplateMenuRemote.test.tsx src/features/project/tasks/BoardWave4.test.tsx --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. The render-count tests stay green (the memo of `TasksBody` keeps plain props).
- [ ] **Step 5: Commit.**
  `git add src/features/project/tasks/ViewButton.tsx src/features/project/tasks/TasksTab.tsx src/features/project/tasks/TaskList.tsx src/features/project/tasks/TasksTabPhone.test.tsx src/i18n/real/phoneproject.en.json src/i18n/real/phoneproject.ar.json && git commit -m "Project: To-dos tab with a Filter button, a View button, done counts and the add row last on a phone"`

---

### Task P8: The Tracker tab on a phone

**Files:**
- Modify: `src/features/project/tracker/TrackerTab.tsx`, `src/features/project/tracker/QuickLog.tsx`, `src/i18n/real/phoneproject.en.json`, `src/i18n/real/phoneproject.ar.json`
- Test: `src/features/project/tracker/TrackerPhone.test.tsx` (new)

**Interfaces:**
- Consumes: `tabButtonShows` (P5), `Sheet` with `footer`, `useIsPhone`.
- Produces: `QuickLog` gets the optional prop `sheet?: { open: boolean; onOpenChange: (open: boolean) => void }`. With it, `QuickLog` draws its form inside a `Sheet` (title `phoneProject.tracker.logNew`).
  The "Log it" button sits in the sheet footer as `<Button type="submit" form={formId} variant="primary">`. The type and the side live in `QuickLog` state, and `QuickLog` stays mounted while the tab shows.
  This is the "state of `TrackerTab`" of the area section. Without `sheet`, `QuickLog` is as it is today.

Word: `phoneProject.tracker.logNew` = "Log a new line" / «سجّل سطراً جديداً».

- [ ] **Step 1: Write the failing test** (`TrackerPhone.test.tsx`, phone, `usr_002`, `?tab=tracker`)
```ts
it('shows the main button first and no form on the page', async () => {
  mockViewport(true); await renderApp(TRACKER, as('usr_002'));
  const button = await screen.findByRole('button', { name: 'Log a new line' });
  expect(button).toHaveClass('signature');
  expect(screen.queryByRole('textbox', { name: 'Log an exchange' })).toBeNull();
  const history = screen.getByRole('region', { name: 'History' });
  expect(button.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(history).toHaveClass('panel');
});
it('logs a line in a sheet, closes it and shows the Undo toast', async () => {
  await userEvent.click(button);
  const sheet = await screen.findByRole('dialog', { name: 'Log a new line' });
  await userEvent.click(within(sheet).getByRole('radio', { name: 'Other' }));
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Log an exchange' }), 'A neighbour phoned');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Log it' }));            // the footer button
  await waitFor(() => expect(Object.values(store.state.tracker).filter((e) => e.title === 'A neighbour phoned')).toHaveLength(1));
  expect(screen.queryByRole('dialog', { name: 'Log a new line' })).toBeNull();
  expect(await screen.findByText('Logged.')).toBeInTheDocument();
});
it('keeps the type and the side for the next line', ...);                      // reopen: radio 'Other' has aria-checked true and side 'None' is set
it('has no drop frame in the sheet', ...);                                    // dragEnter with Files shows no 'The files join this entry...' note
it('keeps Filter and Export inside History and the open loops never filtered', ...);   // Filter button is inside region 'History'; the Open region keeps its rows after a filter
it('shows the line "Only the team of the project can log here." in place of the button', ...);   // usr_003
it('keeps the desk form on the page', ...);                                   // no mockViewport: textbox 'Log an exchange' is on the page, no 'Log a new line' button
```
- [ ] **Step 2: Run it and see it fail**
  Run: `npx vitest run src/features/project/tracker/TrackerPhone.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, there is no `Log a new line` button and the form is on the page.
- [ ] **Step 3: Implement.** `TrackerTab` on a phone: the order is the main button (when `tabButtonShows('tracker', viewerCan)`) or the cannot-log line, then `OpenLoops`, then the History section with `panel flex flex-col gap-3 p-4`.
  `QuickLog` is always mounted when the person may log. It receives `sheet={{ open: logOpen, onOpenChange: setLogOpen }}` on a phone. In the sheet form, drop `ChatDropArea` and `DropReceiver` (keep `useBlockFileDrop()`), drop the in-row Save button, do not refocus the field after success, and call `sheet.onOpenChange(false)` in `onSuccess`.
  Give the form an `id` from `useId()`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/tracker --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. `TrackerTab.test.tsx` and `TrackerSidesReplyExport.test.tsx` stay green. The phone case there (short hint) still holds.
- [ ] **Step 5: Commit.**
  `git add src/features/project/tracker src/i18n/real/phoneproject.en.json src/i18n/real/phoneproject.ar.json && git commit -m "Project: the Tracker log form opens in a sheet from one main button on a phone"`

---

### Task P9: Files & Links and the file preview on a phone

**Files:**
- Modify: `src/features/project/files/FilesTab.tsx`, `src/features/project/files/PreviewSheet.tsx`, `src/i18n/real/phoneproject.en.json`, `src/i18n/real/phoneproject.ar.json`
- Test: `src/features/project/files/FilesPhone.test.tsx` (new), `src/features/project/files/PreviewSheet.test.tsx` (add a `describe` for the phone)

**Interfaces:**
- Consumes: `Menu` `sheetOnPhone`; `ImageViewer` props from `components/ImageViewer.tsx` (`open`, `onClose`, `name`, `src`, `placeholder`, `failed`, `onError`, `onPlaceholderError`, `onDownload`, `position`); `useFileLink`; `tabButtonShows` (P5).
- Produces: `PreviewSheet({ views, index, onIndex, onClose })` keeps its signature (`TaskSheet.tsx` and `DrawingsStrip.tsx` call it). Phone: a picture opens `ImageViewer`. A PDF opens a `Sheet` with one `<a>`.

Word: `phoneProject.files.openPdf` = "Open the PDF" / «افتح ملف PDF». The row press label reuses `picture.view` ("View {{name}}").

- [ ] **Step 1: Write the failing tests.**
  `FilesPhone.test.tsx` (phone, `usr_002`, `?tab=files`):
```ts
it('makes Add the navy button, as a sheet of rows', async () => {
  mockViewport(true); await renderApp(FILES, as('usr_002'));
  const add = await screen.findByRole('button', { name: 'Add' });
  expect(add).toHaveClass('signature');
  await userEvent.click(add);
  expect(await screen.findByText('Upload a file')).toBeInTheDocument(); expect(screen.getByText('Add a link')).toBeInTheDocument();
  expect(screen.queryByRole('menu')).toBeNull();
});
it('shows no drop hint and takes no drop on a phone', ...);                      // 'Drop files here to upload them.' absent; fireEvent.drop does not call files.upload
it('opens the preview from the name or the thumbnail', async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'View Ground floor plan.pdf' }));
  const link = await screen.findByRole('link', { name: 'Open the PDF' });
  expect(link).toHaveAttribute('target', '_blank'); expect(link.getAttribute('rel')).toContain('noopener');
});
it('keeps Preview in the row menu, as a sheet of rows', ...);                     // 'Actions for Ground floor plan.pdf' -> text 'Preview', 'Download'
it('keeps the stage pick and the "Received from the client" tick', ...);
it('gives a person with no upload and no link right no Add button and a grey Post update', ...);   // usr_003 or a role without both: no 'Add' button
it('keeps the desk: grey Add menu, drop hint, no row press button', ...);
```
  `PreviewSheet.test.tsx` (phone, remote mode, the `renderSheet` helper of that file):
```ts
it('opens a picture in the full screen viewer, with no Previous or Next for one view', async () => {
  renderSheet(view('fil_903', 'Plan.png', 'image/png'), 'remote');                          // after mockViewport(true)
  const viewer = await screen.findByRole('dialog', { name: 'Plan.png' });
  await waitFor(() => expect(viewer.querySelector('img[src="https://store.test/link-2"]')).not.toBeNull());   // the full link; the thumb is link-1
  expect(within(viewer).queryByRole('button', { name: 'Next picture' })).toBeNull();
  expect(calls.map((c) => (c.input as { variant: string }).variant).sort()).toEqual(['full', 'thumb']);
});
it('moves between several pictures with Next picture', ...);                              // two views: Next calls onIndex(1)
it('shows a PDF as a sheet with one real link, made after the signed link loaded', async () => {
  // files.link held with a deferred promise: button 'Open the PDF' is disabled; after resolve a link 'Open the PDF' has href https://store.test/link-1, target _blank, rel contains noopener
});
it('keeps the icon and the download for an SVG in the real build', ...);                  // as on a desk
it('moves from a picture to a PDF in a mixed list', ...);                                 // [png, pdf]: Next picture -> sheet with 'Open the PDF' and a 'Previous drawing' button
it('asks for one new link when the viewer picture fails, and for no more', async () => {
  // fireEvent.error(big img) -> files.link variant full asked twice; a second error -> still twice; the viewer shows 'picture.failed' text only when the thumb also failed
});
it('keeps the desk sheet and iframe', ...);                                                 // the current tests stay unchanged
```
- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run src/features/project/files/FilesPhone.test.tsx src/features/project/files/PreviewSheet.test.tsx --no-file-parallelism --testTimeout=60000`
  Expected: FAIL, Add is grey, the drop hint shows, and the preview is still a sheet with an `iframe`.
- [ ] **Step 3: Implement.**
  - `FilesTab`: `const phone = useIsPhone()`. The Add `Menu` gets `sheetOnPhone` and, on a phone, `triggerClassName` with the `signature` look when `tabButtonShows('files', viewerCan)`. On a phone drop the drag handlers, the dragging outline and the `files.drop` hint.
    The row `Menu` gets `sheetOnPhone`. On a phone and when `canPreview(latest.mimeType)`, the thumbnail and the name block are one `button` with `aria-label={t('picture.view', { name: file.name })}` and `onClick={onPreview}`.
  - `PreviewSheet`: rename the current body to `DeskPreview`. The new `PreviewSheet` picks by `useIsPhone()` and the type. Phone and `usePictureTest()(type)` gives `PhonePicture`:
    two `useFileLink` calls (`'thumb'` as `placeholder`, `'full'` as `src`), `failed={big.broken && small.broken}`, `position` only when `views.length > 1`, `onDownload` as in `DeskPreview`. Phone and `application/pdf` gives `PhonePdf`: a `Sheet` with `useFileLink(id, letter)`.
    While `url` is null show `<Button disabled aria-busy>`; after it, `<a href={url} target="_blank" rel="noopener noreferrer">` styled as a `Button` with the text `phoneProject.files.openPdf`. Keep the footer with Previous and Next for several views. Anything else uses `DeskPreview`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.**
  Run: `npx vitest run src/features/project/files src/features/project/tasks/TaskSheet.test.tsx src/features/dashboard/meeting --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. `FilesTab.test.tsx`, `FilesTab.remote.test.tsx`, `ShareToast.test.tsx` and the meeting drawings tests stay green on the desk.
- [ ] **Step 5: Commit.**
  `git add src/features/project/files src/i18n/real/phoneproject.en.json src/i18n/real/phoneproject.ar.json && git commit -m "Project: a navy Add button, a row that opens its preview, a full screen picture viewer and an Open the PDF link on a phone"`

---

### Task P10: Browser specs and the track gate

**Files:**
- Modify: `tests/e2e/projects.spec.ts`, `tests/e2e-deploy/projects.spec.ts`
- Check, no change expected: `tests/e2e/owner.spec.ts`, `calm.spec.ts`, `work.spec.ts`, `full.spec.ts`, `toastUndo.spec.ts` and the same names in `tests/e2e-deploy/`

**Interfaces:**
- Consumes: the phone tabs (P6), the header (P5), the More page (P2).
- Produces: nothing for other tracks. The builder does not run Playwright (project rule). It edits the specs and runs the typecheck. The lead's Playwright agent runs them in task L4 step 3.

- [ ] **Step 1: Write the new browser tests** (both files; the deploy file uses `goto`, `settle` and `test` from its fixtures)
```ts
const DESK_TABS = ['overview', 'tasks', 'activity', 'tracker', 'schedule', 'files', 'team'];
const PHONE_TABS = ['overview', 'tasks', 'tracker', 'files', 'more', 'activity', 'schedule', 'team'];   // the last three open a More page
// the sweep loop: for (const tab of width < 640 ? PHONE_TABS : DESK_TABS)
test('the project page on a phone has five tabs, one navy button and no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/projects/prj_001');
  await expect(page.getByRole('tablist', { name: 'Project sections' }).getByRole('tab')).toHaveText(['Overview', 'To-dos', 'Tracker', 'Files & Links', 'More']);
  await expect(page.locator('main .signature')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const tab of ['tasks', 'tracker', 'files', 'more', 'schedule']) {
    await page.goto(`/#/projects/prj_001?tab=${tab}`);
    await expect(page.locator('main .signature')).toHaveCount(1);                        // one navy button on each tab
  }
});
test('the tab row stays at the top while the page scrolls', async ({ page }) => {          // 390 px, Overview: scroll 800 px, the tablist top is <= 1 px (safe area is 0 here)
});
test('five tab words fit in 360 px in Arabic, with no sideways scroll', async ({ page }) => {
  // useArabic(page); setViewportSize 360 x 740; for each tab: every tab button box lies inside 0..360 and scrollWidth <= 360
});
test('Back from the project chat returns to the project tab', async ({ page }) => {        // 390 px: ?tab=files -> link 'Project chat' -> Back -> hash is #/projects/prj_001?tab=files
});
```
  The `chooseBoard` helper and the desk tests stay as they are (1440 px).
- [ ] **Step 2: Typecheck the specs.**
  Run: `npm run typecheck`
  Expected: PASS. (The builder cannot run Playwright; the specs fail on a build without tasks P1 to P9, and pass on the track branch.)
- [ ] **Step 3: Check the other specs by reading.** Open `owner.spec.ts` ("project Overview", 1440 px), `calm.spec.ts` (1440 px), `work.spec.ts` and `full.spec.ts` (the project routes at 390 px need a level 1 heading, the project name stays one), `toastUndo.spec.ts` (task panel at the default width).
  Expected: no edit. If one pins a 390 px project tab, fix it in the same commit.
- [ ] **Step 4: Run the gate of the track once.**
  Run: `npx vitest run src/features/project src/i18n --no-file-parallelism --testTimeout=60000 && npm run typecheck`
  Expected: PASS. A word key twice, an em-dash or a missing Arabic key fails in `src/i18n`.
- [ ] **Step 5: Commit.**
  `git add tests/e2e/projects.spec.ts tests/e2e-deploy/projects.spec.ts && git commit -m "Tests: browser specs for the project page on a phone"`

---

**Review focus candidates:**
1. A narrow Arabic phone (360 px, Arabic text is 8 percent larger): the five tab words and the header must fit with no sideways scroll. Covered by the 360 px test in P10.
2. A phone turned sideways (640 px and wider) while a stage sheet is open: the sheet must become a popover with no crash. Covered in P3.
3. A signed picture link that expires while the viewer is open: one new link, then the failed text. Covered in P9.
4. A private tab with blocked browser storage: the typed update must still show in the box and in the header rule. Covered in P4 (`postDraft.test.tsx`).

**Facts for the lead (docs, no edit by this track):**
- `src/CLAUDE.md`: the project page on a phone has five tabs (`PHONE_TABS`); `?tab=activity|schedule|team` light More and open a sub-page; `?tab=more` is the list; on a desk `?tab=more` opens Overview. The words are in `phoneproject.*`.
- `src/CLAUDE.md`: `phoneMainButton` (`mainButton.ts`) decides the one navy button of each tab; `usePostDraft` keeps the update draft; `mockViewport` (`phoneTest.ts`) is the phone test helper of this folder.
- `src/CLAUDE.md`: the Project chat link sends `state.from` (a path string) for Back.
- What's new: the lead writes the one entry. This track writes none.

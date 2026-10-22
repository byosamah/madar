> Part of `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`. Read that file first: its Global Constraints, shared interfaces and Lead amendments win over this file.

## Track S: Shell and shared parts (wave 1, branch rb/phone-d-s)

**Owns:** `src/app/AppShell.tsx`, `TabPill.tsx`, new `PhoneTabBar.tsx`, `PhoneTopRow.tsx`, `phoneBack.ts`, `phoneShell.ts`, `phoneChat.ts`, `usePhoneBarHide.ts`, `useKeyboardOpen.ts`, `useVisualViewport.ts`, `nav.ts`, `lastList.ts`, `pressReads.ts`, `toasts.tsx`, `routes.tsx`, `screens.ts`, `screenLoaders.ts`, `screenLoaders.static.ts`, `idlePrefetch.ts`, `useIsPhone.ts`; `src/design/tokens.css` (`--phone-bar`); the shared parts `src/components/SegmentedControl.tsx`, `Tabs.tsx`, `Sheet.tsx`, `Menu.tsx`, new `SheetOrPopover.tsx`, `MenuSheet.tsx`; new icons `animated/user.tsx`, `animated/briefcase.tsx`; the stubs `src/features/me/MeScreen.tsx` and `MeSectionScreen.tsx`; the word pair `src/i18n/real/phoneshell.en.json` and `.ar.json`; the test helper `src/test/phoneMedia.ts`. Track S may also make these small edits in files of other areas, because it is the first wave: `features/meetings/readInputs.ts` and `MeetingsScreen.tsx` (one shared input), new `features/work/readInputs.ts` and `WorkTasks.tsx` (two shared inputs), `features/settings/admin/AdminScreen.tsx` (remove the phone back link), `features/tasklist/TaskListScreen.tsx` (hide one back link on a phone). Tests: `src/app/*.test.*` named in the tasks, `src/components/*.test.tsx`, `src/design/tokens.test.ts`, and the browser specs `tests/e2e/{owner,shell,calm,work,full}.spec.ts` with their `tests/e2e-deploy` twins. Never edit a file of another track beyond this list.
**Reads:** area section "Shell, tab bar and top bar" of `2026-10-22-madar-phone-d-areas.md`; the contract parts "Hooks and helpers", "Tokens and classes", "Shared components" and "Shell parts"; the D sections of Work, Inbox, Project, To-do and Me only for the props of `SegmentedControl`, `Tabs`, `Sheet`, `SheetOrPopover`, `Menu`, `useVisualViewport` and `pressReads`.

**Rules for the builder of this track.**
- Work in `/Users/osamakhalil/dev/madar-rb/phone-d`, branch `rb/phone-d-s`. Run `git merge --ff-only rb/phone-d` first.
- Phone tests set `matchMedia` for `(max-width: 639px)`. Use `phoneMedia` (task S1) or `atPhoneWidth()` from `src/features/auth/renderAuth.tsx`.
- A task runs only its own test files and `npm run typecheck`. The lead runs the full suite once.
- Wave 1 leaves the phone without the person menu until track M lands. The stub Me screens show the old Settings page, so nothing is lost for tests.

---

### Task S1: Phone helpers and the viewport hooks

**Files:**
- Create: `src/app/phoneChat.ts`, `src/app/useVisualViewport.ts`, `src/app/useKeyboardOpen.ts`, `src/test/phoneMedia.ts`
- Modify: `src/app/useIsPhone.ts` (add `isPhoneNow`), `src/app/lastList.ts` (Work view memory)
- Test: `src/app/phoneHelpers.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isPhoneNow(): boolean`
  - `PHONE_CHAT: RegExp` (`/^\/inbox\/[^/]+$/`) and `isPhoneChatPath(pathname: string): boolean`
  - `rememberWorkView(pathname: '/work' | '/meetings' | '/projects'): void`, `workTabLink(): string`, and `subscribeWorkView(listener: () => void): () => void` (extra: the tab bar needs it to render again)
  - `useVisualViewport(): { height: number; offsetTop: number } | null`
  - `useKeyboardOpen(): boolean`
  - Test helpers: `phoneMedia(initial: boolean): { set(phone: boolean): void }` (mocks `matchMedia` for `(max-width: 639px)`, calls the `change` listeners on `set`, restores the original in `onTestFinished`) and `fakeVisualViewport(init: { height: number; offsetTop?: number; scale?: number }): { set(next: Partial<...>): void; fire(type: 'resize' | 'scroll'): void }` (installs `window.visualViewport`, removes it in `onTestFinished`).

- [ ] **Step 1: Write the failing test** (`src/app/phoneHelpers.test.tsx`)
```ts
it('isPhoneNow reads the phone query, and is false with no matchMedia', () => {
  const media = phoneMedia(true);  expect(isPhoneNow()).toBe(true);
  media.set(false);                expect(isPhoneNow()).toBe(false);
  // delete window.matchMedia in the test, restore it in finally
  expect(isPhoneNow()).toBe(false);
});
it('isPhoneChatPath is true only for one chat id', () => {
  for (const p of ['/inbox/cnv_1', '/inbox/abc-9']) expect(isPhoneChatPath(p)).toBe(true);
  for (const p of ['/inbox', '/inbox/', '/inbox/a/b', '/notifications', '/']) expect(isPhoneChatPath(p)).toBe(false);
});
it('workTabLink starts at /work, keeps the last Work view, and tells its listeners', () => {
  expect(workTabLink()).toBe('/work');
  const seen = vi.fn(); const stop = subscribeWorkView(seen);
  rememberWorkView('/projects'); expect(workTabLink()).toBe('/projects'); expect(seen).toHaveBeenCalledTimes(1);
  rememberWorkView('/projects'); expect(seen).toHaveBeenCalledTimes(1);   // same value: no call
  stop(); rememberWorkView('/meetings'); expect(seen).toHaveBeenCalledTimes(1);
  // afterEach: rememberWorkView('/work')
});
it('useVisualViewport gives null with no API, then follows resize and scroll, and lets go on unmount', () => {
  // no window.visualViewport -> result.current === null
  // fakeVisualViewport({ height: 800, offsetTop: 0 }) -> { height: 800, offsetTop: 0 }
  // set({ height: 500 }); fire('resize') -> { height: 500, offsetTop: 0 }
  // set({ offsetTop: 40 }); fire('scroll') -> { height: 500, offsetTop: 40 }
  // unmount -> the fake holds 0 listeners
});
it('useKeyboardOpen is true when the visual viewport is more than 150 px shorter than the window', () => {
  // window.innerHeight = 800
  // height 800 -> false; 651 -> false (149); 650 -> false (150); 649 -> true (151); no visualViewport -> false
});
it('useKeyboardOpen stays false while the page is pinch-zoomed', () => {
  // height 400, scale 2 -> false ; height 400, scale 1 -> true
});
```

- [ ] **Step 2: Run it and see it fail**: `npx vitest run src/app/phoneHelpers.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: import errors, `isPhoneNow is not a function`, and the missing files.

- [ ] **Step 3: Implement.**
  - `useIsPhone.ts`: export `isPhoneNow()`. It returns `typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches`. Keep `useIsPhone` as it is.
  - `phoneChat.ts`: the two exports above, nothing else.
  - `lastList.ts`: a module variable `workView = '/work'` and a `Set` of listeners. `rememberWorkView` sets the value and calls the listeners only when the value changed.
  - `useVisualViewport.ts`: `useState` with a lazy start from `window.visualViewport`. An effect adds `resize` and `scroll` listeners and removes them on unmount. Keep one object per change, so a render does not loop.
  - `useKeyboardOpen.ts`: reads `useVisualViewport()` and `window.innerHeight`. It returns `true` when `innerHeight - height > 150` and `(visualViewport.scale ?? 1) <= 1.01`. The scale test is an addition to the contract: a pinch zoom also makes the viewport shorter.
  - `phoneMedia.ts`: the two test helpers of the Interfaces list. Other queries (`(pointer: coarse)`) answer `false`.

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS).

- [ ] **Step 5: Commit**
```
git add src/app/phoneChat.ts src/app/useVisualViewport.ts src/app/useKeyboardOpen.ts src/app/useIsPhone.ts src/app/lastList.ts src/app/phoneHelpers.test.tsx src/test/phoneMedia.ts
git commit -m "Phone shell: add the phone helpers and the keyboard hooks"
```

---

### Task S2: Phone tab list, tab map, icons and words

**Files:**
- Create: `src/components/icons/animated/user.tsx`, `src/components/icons/animated/briefcase.tsx`, `src/i18n/real/phoneshell.en.json`, `src/i18n/real/phoneshell.ar.json`
- Modify: `src/app/nav.ts` (add `PhoneTab`, `PHONE_NAV`, `phoneTabOf`; keep `NAV` and `isNavActive`), `src/app/tabIcons.test.tsx` (add the phone items)
- Test: `src/app/phoneNav.test.ts` (new)

**Interfaces:**
- Consumes: `SunIcon`, `InboxIcon` (exist), `AnimatedIconComponent`.
- Produces:
  - `type PhoneTab = 'today' | 'inbox' | 'work' | 'me'`
  - `PHONE_NAV: { tab: PhoneTab; to: string; key: string; animated: AnimatedIconComponent }[]`
  - `phoneTabOf(pathname: string): PhoneTab | null`
  - Word keys `phoneShell.tab.today|inbox|work|me`. Track W uses `phoneShell.tab.work` as the page title "Work".
  - `UserIcon`, `BriefcaseIcon` (same ref API as every file in `animated/`).

- [ ] **Step 1: Write the failing test** (`src/app/phoneNav.test.ts`)
```ts
it('lists the four phone tabs in order', () => {
  expect(PHONE_NAV.map((i) => [i.tab, i.to, i.key])).toEqual([
    ['today', '/', 'phoneShell.tab.today'], ['inbox', '/inbox', 'phoneShell.tab.inbox'],
    ['work', '/work', 'phoneShell.tab.work'], ['me', '/me', 'phoneShell.tab.me']]);
});
it.each([
  ['/', 'today'],
  ['/inbox', 'inbox'], ['/inbox/cnv_1', 'inbox'], ['/notifications', 'inbox'],
  ['/work', 'work'], ['/meetings', 'work'], ['/projects', 'work'], ['/projects/prj_001', 'work'], ['/projects/code/ABC', 'work'],
  ['/me', 'me'], ['/me/profile', 'me'], ['/settings', 'me'], ['/whats-new', 'me'], ['/dashboard', 'me'], ['/tasks', 'me'], ['/admin', 'me'], ['/admin/people', 'me'],
  ['/search', null], ['/nope', null], ['/dashboard/meeting', null], ['/projectsx', null], ['/inboxes', null],
])('phoneTabOf(%s) is %s', (path, tab) => expect(phoneTabOf(path)).toBe(tab));
it('says each tab word in English and in Arabic', () => {
  expect(en.phoneShell.tab).toEqual({ today: 'Today', inbox: 'Inbox', work: 'Work', me: 'Me' });
  expect(ar.phoneShell.tab).toEqual({ today: 'اليوم', inbox: 'الوارد', work: 'العمل', me: 'أنا' });
});
```
`tabIcons.test.tsx`: `const items = [...NAV, ...PHONE_NAV, SEARCH_ITEM, NOTIFICATIONS_ITEM];` (the `PHONE_NAV` keys are unique, so the `data-tab` marks stay unique).

- [ ] **Step 2: Run it and see it fail**: `npx vitest run src/app/phoneNav.test.ts src/app/tabIcons.test.tsx src/components/icons/animatedIcons.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: `PHONE_NAV` and `phoneTabOf` are not exported.

- [ ] **Step 3: Implement.**
  - Icons: copy `https://lucide-animated.com/r/user.json` and `https://lucide-animated.com/r/briefcase.json` into the style of `animated/clipboard-check.tsx` (MIT header line "Source: ... Local edits: class-join import", the `cn` import from `./cx`, a start value on each animated element). If the site has no `briefcase`, make `briefcase.tsx` re-export nothing and use `ClipboardCheckIcon` in `PHONE_NAV` instead; say so in the commit message. `animatedIcons.test.tsx` checks every file in `animated/` by glob.
  - `PHONE_NAV` rows: Today `SunIcon`, Inbox `InboxIcon`, Work `BriefcaseIcon`, Me `UserIcon`.
  - `phoneTabOf`: exact match for `/`, `/notifications`, `/work`, `/meetings`, `/projects`, `/me`, `/settings`, `/whats-new`, `/dashboard`, `/tasks`, `/admin`. Prefix match with a slash for `/inbox/`, `/projects/`, `/me/`, `/admin/`. Anything else gives `null`.
  - Words (`phoneshell.en.json`): `{"phoneShell":{"tab":{"today":"Today","inbox":"Inbox","work":"Work","me":"Me"}}}`. Arabic: `اليوم`, `الوارد`, `العمل`, `أنا`. Later tasks add `inboxBoth` and `searchAll` to the same pair.

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Also run `npx vitest run src/i18n --no-file-parallelism --testTimeout=60000` (key and em-dash tests).

- [ ] **Step 5: Commit**
```
git add src/app/nav.ts src/app/phoneNav.test.ts src/app/tabIcons.test.tsx src/components/icons/animated/user.tsx src/components/icons/animated/briefcase.tsx src/i18n/real/phoneshell.en.json src/i18n/real/phoneshell.ar.json
git commit -m "Phone shell: add the four phone tabs, the tab map, two icons and the tab words"
```

---

### Task S3: PhoneTabBar and the press reads

**Files:**
- Create: `src/app/PhoneTabBar.tsx`, `src/features/work/readInputs.ts`
- Modify: `src/app/TabPill.tsx` (rename the pill to `DeskPill`; `TabPill` returns `PhoneTabBar` on a phone), `src/app/pressReads.ts` (entries `/work`, `/meetings`, `/me`; new header text), `src/features/work/WorkTasks.tsx` (import the two inputs), `src/features/meetings/readInputs.ts` (add `meetingsListInput`), `src/features/meetings/MeetingsScreen.tsx` (use it), `src/i18n/real/phoneshell.*.json` (add `phoneShell.inboxBoth`), `src/app/TabPillLabels.test.tsx`, `src/app/rr2Shell.test.tsx`, `src/app/PressReads.test.tsx`, `tests/e2e/owner.spec.ts`, `tests/e2e-deploy/owner.spec.ts`
- Test: `src/app/PhoneTabBar.test.tsx` (new), `src/app/pressReadsMap.test.ts` (new)

**Interfaces:**
- Consumes: `PHONE_NAV`, `phoneTabOf` (S2); `workTabLink`, `subscribeWorkView` (S1); `usePressReads`, `useCompactBars`, `Badge`, `AnimatedIcon`, `spring`.
- Produces:
  - `PhoneTabBar(): JSX.Element` (default state: always shown; task S4 adds the hide rule)
  - `inboxName(t: TFunction, unread: number, notices: number): string`
  - `PRESS_READS['/work' | '/meetings' | '/me']` (so the segments and the Me hub call `usePressReads()('/meetings')` and nothing else)
  - `MINE_OPEN`, `REVIEW_FOR_ME` in `features/work/readInputs.ts`; `meetingsListInput(today: string)` in `features/meetings/readInputs.ts` (`{ from: addDays(today, -7), to: addDays(today, 60), mine: true }`)
  - Word key `phoneShell.inboxBoth` = "{{name}}, {{chats}}, {{notices}}" / «{{name}}، {{chats}}، {{notices}}»

- [ ] **Step 1: Write the failing tests.**

`src/app/PhoneTabBar.test.tsx` (phone width through `atPhoneWidth()`; `renderApp`):
```ts
it('shows four links with a visible word, in the order Today, Inbox, Work, Me', async () => {
  await renderApp('/');
  const bar = document.querySelector('nav[data-pill]') as HTMLElement;
  const links = within(bar).getAllByRole('link');
  expect(links.map((l) => l.querySelector('span:not([data-tab-icon])')?.textContent)).toEqual(['Today', 'Inbox', 'Work', 'Me']);
  for (const l of links) expect(l).toHaveClass('h-[52px]', 'flex-1', 'min-w-0', 'flex-col');
  const word = within(links[0]).getByText('Today');
  expect(word).toHaveClass('text-caption', 'whitespace-nowrap'); expect(word).not.toHaveClass('sr-only', 'truncate');
  expect(bar).toHaveClass('w-[calc(100vw-32px)]', 'bottom-[max(16px,env(safe-area-inset-bottom))]');
  expect(within(bar).queryByRole('link', { name: /Search|Notifications|Dashboard/ })).toBeNull();
});
it.each([['/', 'Today'], ['/notifications', 'Inbox'], ['/projects/prj_001', 'Work'], ['/dashboard', 'Me']])(
  'marks the open tab at %s', ...);   // aria-current="page" on that link only, and one .signature with rounded-full inside it
it('has no open tab at /search', ...);
it('names the Inbox link with the counts, and shows one badge with their sum', ...);   // seed: 'Inbox, Unread messages: 3, 1 item needs action' ; badge number '4'
it('inboxName covers the five cases in English and Arabic', () => {
  // en: (0,0) 'Inbox'; (3,0) 'Inbox, Unread messages: 3'; (0,2) 'Inbox, 2 items need action'; (3,1) 'Inbox, Unread messages: 3, 1 item needs action'
  // ar: (1,1) 'الوارد، رسالة غير مقروءة، 1 عنصر يحتاج منك خطوة'; (0,1) 'الوارد، 1 عنصر يحتاج منك خطوة'
});
it('a press on the open tab scrolls to the top and does not navigate', async () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  await renderApp('/');
  await userEvent.click(within(bar()).getByRole('link', { name: 'Today' }));
  await userEvent.click(within(bar()).getByRole('link', { name: 'Today' }));   // double press
  expect(scrollTo).toHaveBeenCalledTimes(2); expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
  expect(window.location.hash).toBe('#/');
});
it('uses jump scroll with reduced motion', ...);   // mock (prefers-reduced-motion: reduce) -> behavior 'auto'
it('the Work link follows the last Work view, and a press at that address scrolls', async () => {
  rememberWorkView('/meetings');
  await renderApp('/meetings');
  const work = within(bar()).getByRole('link', { name: 'Work' });
  expect(work).toHaveAttribute('href', '#/meetings'); expect(work).toHaveAttribute('aria-current', 'page');
  await userEvent.click(work); expect(scrollTo).toHaveBeenCalled(); expect(window.location.hash).toBe('#/meetings');
});
it('a press on a lit tab whose link points elsewhere navigates', ...);   // at /projects/prj_001 with memory '/work': click Work -> hash '#/work'
it('keeps data-pill, so Focus mode can make the bar inert', ...);
it('leaves the desk pill unchanged at desk width', ...);   // five tabs: Home, Projects, Tasks, Dashboard, Inbox, plus Search and Notifications
```
`src/app/pressReadsMap.test.ts` (pure, with a spy for the prefetch function):
```ts
const run = (to: string) => { const asked: [string, unknown][] = []; for (const start of PRESS_READS[to]()) start((name, input) => asked.push([name, input])); return asked; };
it('/work starts my open list and my review list', () => expect(run('/work')).toEqual([['tasks.list', { filter: 'mine', includeDone: false }], ['tasks.list', { filter: 'review_for_me' }]]));
it('/meetings starts the Meetings list of today', () => expect(run('/meetings')).toEqual([['meetings.list', meetingsListInput(todayISO())]]));
it('/me starts settings.get, and google.status in the remote build only', ...);
it('/inbox and /notifications stay as they are', ...);
it('meetingsListInput looks 7 days back and 60 days ahead for my meetings', () => expect(meetingsListInput('2026-10-22')).toEqual({ from: '2026-10-15', to: '2026-12-21', mine: true }));
```
`PressReads.test.tsx`: add a phone block. `atPhoneWidth()`, then `openAt('/whats-new')`. For the links `^Work` and `^Inbox` and `^Me`: pointer down on the link starts the read once (`tasks.list` mine and review, `chats.list`, `google.status`), then `navigate` and `release`, and the count stays 1. The existing desk cases stay.
Updates of old tests: `TabPillLabels.test.tsx`: keep the first test (the desk word is `sr-only`); delete the `the phone tab pill` block (its cases move to `PhoneTabBar.test.tsx`). `rr2Shell.test.tsx`: the test "shows five tabs on a phone with the switch on, and four with the switch off" becomes "shows the same four tabs on a phone with the switch on and off" (accessible names `Today`, `/^Inbox/`, `Work`, `Me`).

- [ ] **Step 2: Run them and see them fail**: `npx vitest run src/app/PhoneTabBar.test.tsx src/app/pressReadsMap.test.ts src/app/PressReads.test.tsx src/app/TabPillLabels.test.tsx src/app/rr2Shell.test.tsx src/features/meetings/MeetingsScreen.test.tsx src/features/work/WorkTasks.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: `PhoneTabBar` module missing; `PRESS_READS['/work']` is not a function.

- [ ] **Step 3: Implement.**
  - `TabPill.tsx`: move the current body into `function DeskPill()` with no change. `export function TabPill() { return useIsPhone() ? <PhoneTabBar /> : <DeskPill />; }`. `SearchButton`, `InboxButton`, `BellButton` stay.
  - `PhoneTabBar.tsx`: the `nav` keeps `aria-label={t('nav.main')}`, `data-pill`, `data-compact`, the class string of today (`pill fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-[calc(100vw-32px)] max-w-md items-center gap-0.5 rounded-full p-1.5 origin-bottom motion-safe:transition-transform motion-safe:duration-300`, plus the compact scale class). Each link: `pressable relative isolate flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full font-semibold`, open: `text-[var(--on-sig)]` with `motion.span layoutId="pill-active"`, `spring.standard`, `signature absolute inset-0 -z-10 rounded-full`; closed: `text-ink-2 hover:text-ink`. The icon sits in `<span data-tab-icon className="relative grid place-items-center">` at 22 px with `playWhen={active}`. The Inbox `Badge` (`className="absolute -top-2 -end-3"`) shows `unread + notices` and takes the full link name as its label. Word: `text-caption leading-none whitespace-nowrap`.
  - The Work link reads `useSyncExternalStore(subscribeWorkView, workTabLink, () => '/work')`. On pointer down each link calls `startReads(target)`. On click, when `useLocation().pathname` equals the path of the link (the part before `?`), call `event.preventDefault()` and `window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })` (`useReducedMotion()`). Else the link navigates. This is a refinement of owner call 3: a press on a lit tab whose link points elsewhere (Work on a project page) goes there.
  - `inboxName` is pure: none gives the word; one count uses `nav.withBadge` with `nav.inboxUnread` or `nav.inboxBadge`; both use `phoneShell.inboxBoth`. Set `aria-label` on the Inbox link only when a count shows.
  - `pressReads.ts`: add `'/work': () => [read('tasks.list', MINE_OPEN), read('tasks.list', REVIEW_FOR_ME)]`, `'/meetings': () => [read('meetings.list', meetingsListInput(todayISO()))]`, `'/me': () => [read('settings.get', {}), ...(REMOTE ? [read('google.status', {})] : [])]`. Change the header: the Tasks tab on a desk now also starts the two reads on a press (they are cached when Home loaded them).
  - Edit `WorkTasks.tsx` and `MeetingsScreen.tsx` so each screen imports the same input objects (the `DAYS_BACK` and `DAYS_AHEAD` constants move to `readInputs.ts`).
  - Browser specs: `owner.spec.ts` test "the phone tab bar has exactly five tabs..." becomes "has exactly four tabs with words and no sideways scroll at 390": four links `Today`, `Inbox`, `Work`, `Me`; `Search the whole office` visible (after task S5; until then use `Search`); no `Notifications` link on the page.

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Also run `node scripts/check-rtl.ts`.

- [ ] **Step 5: Commit**
```
git add src/app/PhoneTabBar.tsx src/app/TabPill.tsx src/app/pressReads.ts src/features/work src/features/meetings src/i18n/real/phoneshell.en.json src/i18n/real/phoneshell.ar.json src/app/*.test.* tests/e2e/owner.spec.ts tests/e2e-deploy/owner.spec.ts
git commit -m "Phone shell: add the four-word tab bar and the reads of the phone tabs"
```

---

### Task S4: The bar hides, and the bar space

**Files:**
- Create: `src/app/usePhoneBarHide.ts`
- Modify: `src/app/PhoneTabBar.tsx` (slide out, keyboard hide), `src/app/AppShell.tsx` (data attribute, page space), `src/app/toasts.tsx` (lane), `src/design/tokens.css` (`--phone-bar`), `DESIGN.md` (shell paragraph, `tab-pill` text), `src/CLAUDE.md` (the "Shell" bullet), `src/design/tokens.test.ts`, `src/app/toasts.test.tsx`
- Test: `src/app/usePhoneBarHide.test.tsx` (new), `src/app/AppShell.test.tsx` (new phone cases)

**Interfaces:**
- Consumes: `isPhoneChatPath`, `useKeyboardOpen`, `useIsPhone` (S1); `useFocusLink` (exists); `PhoneTabBar` (S3).
- Produces:
  - `usePhoneBarHide(): 'route' | 'keyboard' | null` ('route' = an open chat or Focus mode, 'keyboard' = the keyboard is open, `null` = the bar shows; always `null` on a desk)
  - `document.documentElement` carries `data-bar-hidden=""` while the value is not `null`
  - Token `--phone-bar` and the rule `:root[data-bar-hidden] { --phone-bar: 0px }`
  - The page uses `max-sm:pb-[calc(var(--phone-bar)+1.5rem)]`; the toast lane uses `bottom-[calc(var(--phone-bar)+0.75rem)]`

- [ ] **Step 1: Write the failing tests.**
`usePhoneBarHide.test.tsx` (a `MemoryRouter`, `phoneMedia`, `fakeVisualViewport`):
```ts
it.each([['/', null], ['/inbox', null], ['/inbox/cnv_1', 'route'], ['/?focus=tsk_001', 'route'], ['/inbox/cnv_1/', null]])('at %s the value is %s on a phone', ...);
it('is keyboard when the visual viewport is 160 px shorter', ...);   // innerHeight 800, height 640 at '/'
it('is route, not keyboard, in a chat with the keyboard open', ...);
it('is always null at desk width', ...);   // phoneMedia(false) at '/inbox/cnv_1'
it('turns null when the window grows past 640 px (a phone turned sideways)', ...);   // phoneMedia(true) -> set(false)
```
`AppShell.test.tsx` new `describe('on a phone')` with `phoneMedia(true)`:
```ts
it('shows no bar at first paint when a push opens a chat', async () => {
  await renderApp('/inbox/cnv_001');
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
  expect(document.documentElement).toHaveAttribute('data-bar-hidden');
});
it('slides the bar out in a chat and back on Back, and clears the attribute', async () => {
  const { router } = await renderApp('/inbox');   // the bar shows, no data-bar-hidden
  await act(() => router.navigate('/inbox/cnv_001'));
  await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull());
  await act(() => router.navigate('/inbox'));
  expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  expect(document.documentElement).not.toHaveAttribute('data-bar-hidden');
});
it('keeps the bar mounted but inert and clear while the keyboard is open', async () => {
  // fakeVisualViewport({ height: 500 }) with innerHeight 800: nav has class opacity-0 pointer-events-none and the inert attribute; data-bar-hidden is set
});
it('puts the bar space in the page padding', async () => {
  expect(document.querySelector('main')).toHaveClass('max-sm:pb-[calc(var(--phone-bar)+1.5rem)]');
  expect(document.querySelector('main')!.className).not.toMatch(/\bpb-32\b/);
});
it('removes the attribute and brings the bar back when the window grows past 640 px in a chat', ...);   // media.set(false)
```
`tokens.test.ts`: `--phone-bar` is `calc(64px + max(16px, env(safe-area-inset-bottom)))` in the first `:root` block; the file holds `:root[data-bar-hidden]` with `--phone-bar: 0px`.
`toasts.test.tsx`: replace the `bottom-24` pin by `bottom-[calc(var(--phone-bar)+0.75rem)]`; the lane keeps `sm:bottom-6` and the `LANE_OVER_SHEET` classes.

- [ ] **Step 2: Run them and see them fail**: `npx vitest run src/app/usePhoneBarHide.test.tsx src/app/AppShell.test.tsx src/app/toasts.test.tsx src/design/tokens.test.ts --no-file-parallelism --testTimeout=60000`. Expected: missing module `usePhoneBarHide`; the toast lane class mismatch.

- [ ] **Step 3: Implement.**
  - `usePhoneBarHide`: `useIsPhone()`, `useLocation()`, `useFocusLink().taskId`, `useKeyboardOpen()`. Order of the answer: not a phone gives `null`; chat path or Focus gives `'route'`; keyboard gives `'keyboard'`.
  - `PhoneTabBar`: wrap the `nav` in `AnimatePresence initial={false}` and make it a `motion.nav`. For `'route'` it is not rendered. Exit: `{ y: '100%', opacity: 0 }` with `spring.standard`. With `useReducedMotion()` the exit is `{ opacity: 0 }` with the `fade` transition (0.2 s). For `'keyboard'` it stays mounted with `opacity-0 pointer-events-none` and `inert`, and has no motion.
  - `AppShell.tsx` (`Shell`): `const hide = usePhoneBarHide();` An effect sets `document.documentElement.dataset.barHidden = ''` when `hide !== null` and deletes it in the cleanup. Change `pb-32` to `max-sm:pb-[calc(var(--phone-bar)+1.5rem)]` in the class of `main` (keep `sm:pb-16`).
  - `tokens.css`: put `--phone-bar` in the first `:root` block. Add `:root[data-bar-hidden] { --phone-bar: 0px; }` after the `.app-page` rules.
  - `toasts.tsx`: `LANE` uses `bottom-[calc(var(--phone-bar)+0.75rem)]` in place of `bottom-24`.
  - Docs in this commit: `DESIGN.md` shell paragraph and the `tab-pill` text (a phone has four tabs with a word under each icon, the bar is 64 px high, it hides in a chat and with the keyboard); `src/CLAUDE.md` "Shell" bullet and the sentence about `NAV` rights (the phone bar has no gated tab). Then run `npm_config_cache="$TMPDIR/npm-cache" npx -y @google/design.md lint DESIGN.md` with the sandbox off. It must show 0 errors and 0 warnings.

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Also run `npx vitest run src/app/PhoneTabBar.test.tsx src/features/focus --no-file-parallelism --testTimeout=60000`.

- [ ] **Step 5: Commit**
```
git add src/app/usePhoneBarHide.ts src/app/PhoneTabBar.tsx src/app/AppShell.tsx src/app/toasts.tsx src/design/tokens.css DESIGN.md src/CLAUDE.md src/app/*.test.* src/design/tokens.test.ts
git commit -m "Phone shell: hide the bar in a chat and with the keyboard, and add the bar space token"
```

---

### Task S5: The phone top row and the back links

**Files:**
- Create: `src/app/phoneBack.ts`, `src/app/PhoneTopRow.tsx`
- Modify: `src/app/AppShell.tsx` (the top row), `src/app/TabPill.tsx` (`SearchButton` label on a phone), `src/features/settings/admin/AdminScreen.tsx` (remove the phone back link of the section), `src/features/tasklist/TaskListScreen.tsx` (`BackToDashboard` gets `max-sm:hidden`), `src/i18n/real/phoneshell.*.json` (add `phoneShell.searchAll`), `src/app/rr2Shell.test.tsx`, `src/features/settings/admin/AdminScreen.test.tsx`, `src/features/tasklist/TaskListScreen.test.tsx`, `tests/e2e/owner.spec.ts` and `tests/e2e-deploy/owner.spec.ts` (Search name)
- Test: `src/app/phoneBack.test.ts` (new), `src/app/AppShell.test.tsx` (phone cases)

**Interfaces:**
- Consumes: `isPhoneChatPath`, `useIsPhone` (S1); `projectsListLink` (exists); `phoneShell.tab.me` (S2).
- Produces:
  - `backLinkOf(pathname: string, ctx: { mayDashboard: boolean; isAdmin: boolean }): { to: string; key: string } | null`
  - `PhoneTopRow()`: the mark or the back link at the start, `SearchButton` at the end. No bell, no person menu. It draws nothing on a phone at an open chat.
  - Word key `phoneShell.searchAll` = "Search the whole office" / «ابحث في المكتب كله»; `SearchButton` uses it on a phone (`useIsPhone()`); a desk keeps `nav.search`.

- [ ] **Step 1: Write the failing tests.**
`phoneBack.test.ts` (call `rememberProjectsList('?filter=late')` first):
```ts
const both = { mayDashboard: true, isAdmin: true };
it('project page -> Projects list', () => expect(backLinkOf('/projects/prj_001', both)).toEqual({ to: '/projects?filter=late', key: 'project.back' }));
it.each(['/me/profile', '/whats-new', '/dashboard', '/admin'])('%s -> Me', (p) => expect(backLinkOf(p, both)).toEqual({ to: '/me', key: 'phoneShell.tab.me' }));
it('/tasks -> Dashboard with dashboard.view, else Me', () => {
  expect(backLinkOf('/tasks', both)).toEqual({ to: '/dashboard', key: 'nav.dashboard' });
  expect(backLinkOf('/tasks', { ...both, mayDashboard: false })).toEqual({ to: '/me', key: 'phoneShell.tab.me' });
});
it('/admin/:section -> Admin for the Admin, Office for others', () => {
  expect(backLinkOf('/admin/people', both)).toEqual({ to: '/admin', key: 'admin.title' });
  expect(backLinkOf('/admin/people', { ...both, isAdmin: false })).toEqual({ to: '/admin', key: 'adminPage.officeTitle' });
});
it.each(['/', '/inbox', '/inbox/cnv_1', '/notifications', '/work', '/meetings', '/projects', '/me', '/settings', '/search', '/nope', '/projects/code/ABC'])('%s -> the mark (null)', (p) => expect(backLinkOf(p, both)).toBeNull());
```
`AppShell.test.tsx` phone cases (`phoneMedia(true)`):
```ts
it('draws the mark and one Search icon at the top of Today, and no bell or person picture', async () => {
  await renderApp('/');
  expect(screen.getAllByRole('link', { name: 'Search the whole office' })).toHaveLength(1);
  expect(screen.queryByRole('link', { name: /^Notifications/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Hala Nasser' })).toHaveLength(1);   // the desk menu only
});
it('shows the back link Me with the Me href at /dashboard and /whats-new, and no mark in the phone row', ...);  // 'Madar, Home' count 1
it('shows the back link Dashboard at /tasks with dashboard.view, and Me without it', ...);
it('shows Admin (or Office) at /admin/people, and the page has no second back link', ...);
it('shows the Projects back link at a project page', ...);
it('draws no top row in an open chat', async () => { await renderApp('/inbox/cnv_001'); expect(screen.queryByRole('link', { name: 'Search the whole office' })).toBeNull(); });
it('marks the Search icon open at /search', ...);   // aria-current page
```
Old tests: `rr2Shell.test.tsx` Search tests keep `{ name: 'Search' }` at desk width (no change). `AdminScreen.test.tsx` "on a phone" cases keep working because the shell now draws the link `Admin` at `#/admin`; add one assertion that the page body draws only one such link. `TaskListScreen.test.tsx`: add a phone case, the top row link `Dashboard` has href `#/dashboard`.

- [ ] **Step 2: Run them and see them fail**: `npx vitest run src/app/phoneBack.test.ts src/app/AppShell.test.tsx src/app/rr2Shell.test.tsx src/features/settings/admin/AdminScreen.test.tsx src/features/tasklist/TaskListScreen.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: `phoneBack` missing; the bell link still on a phone.

- [ ] **Step 3: Implement.**
  - `backLinkOf`: project page regex `^/projects/[^/]+$`; `^/me/[^/]+$`, `/whats-new`, `/dashboard`, `/admin` give Me; `/tasks` by `mayDashboard`; `^/admin/[^/]+$` by `isAdmin`; the rest `null`.
  - `PhoneTopRow`: the markup of today (`-me-1.5 flex items-center justify-end gap-0.5 pb-1`), the back link uses the project link markup (`ChevronLeftIcon` with `rtl:-scale-x-100`, `min-h-11`, `text-link`). `ctx` comes from `useRight('dashboard.view')` and `useCall('session.get', {}).data?.authority.systemRole === 'admin'`. Move `HomeMark` into a shared place that both `AppShell` and `PhoneTopRow` import (keep its name and markup). `AppShell` keeps the `sm:hidden` wrapper and renders `<PhoneTopRow />` in it; the row returns `null` when `useIsPhone() && isPhoneChatPath(pathname)`. Remove `BellButton` and `PersonMenu id="phone"` from the shell.
  - `AdminScreen.tsx`: delete the `phone &&` back `Link` block of the open section. `TaskListScreen.tsx`: add `max-sm:hidden` to the class of `BackToDashboard`.
  - Note for the lead: where the Me area text says the in-page Admin back link stays, the Shell table wins (the contract names the Shell table).

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Also run `node scripts/check-rtl.ts`.

- [ ] **Step 5: Commit**
```
git add src/app/phoneBack.ts src/app/PhoneTopRow.tsx src/app/AppShell.tsx src/app/TabPill.tsx src/features/settings/admin src/features/tasklist src/i18n/real/phoneshell.en.json src/i18n/real/phoneshell.ar.json src/app/*.test.* tests/e2e/owner.spec.ts tests/e2e-deploy/owner.spec.ts
git commit -m "Phone shell: one Search icon and the back links in the top row, no bell and no person picture"
```

---

### Task S6: The phone entrance and the screen keys

**Files:**
- Create: `src/app/phoneShell.ts`
- Modify: `src/app/AppShell.tsx` (import `screenKey` and `tabIndexOf`; add `data-screen` to the entrance wrapper)
- Test: `src/app/phoneShell.test.ts` (new), `src/app/AppShell.test.tsx` (one integration case)

**Interfaces:**
- Consumes: `phoneTabOf`, `NAV`, `isNavActive` (S2 and old), `useIsPhone`.
- Produces:
  - `screenKey(pathname: string, phone: boolean): string`
  - `tabIndexOf(pathname: string, phone: boolean): number` (`-1` for a project page and for a path with no tab)
  - The entrance `motion.div` carries `data-screen={key}`. Track W and I use it to test that a view change does not remount the entrance.

- [ ] **Step 1: Write the failing test.**
```ts
it.each([
  ['/inbox/cnv_1', false, '/inbox'], ['/admin/people', false, '/admin'], ['/meetings', false, '/work'], ['/projects', false, '/projects'], ['/notifications', false, '/notifications'],
  ['/projects', true, '/work'], ['/meetings', true, '/work'], ['/work', true, '/work'], ['/notifications', true, '/inbox'], ['/inbox/cnv_1', true, '/inbox'],
  ['/me/profile', true, '/me/profile'], ['/projects/prj_001', true, '/projects/prj_001'],
])('screenKey(%s, phone %s) is %s', ...);
it.each([
  ['/', true, 0], ['/inbox', true, 1], ['/notifications', true, 1], ['/work', true, 2], ['/projects', true, 2], ['/meetings', true, 2],
  ['/me', true, 3], ['/admin/people', true, 3], ['/projects/prj_001', true, -1], ['/search', true, -1],
  ['/', false, 0], ['/projects', false, 1], ['/work', false, 2], ['/dashboard', false, 3], ['/inbox', false, 4], ['/projects/prj_001', false, -1],
])('tabIndexOf(%s, phone %s) is %i', ...);
```
`AppShell.test.tsx`: with `phoneMedia(true)`, render `/work`; take `document.querySelector('[data-screen]')`; navigate to `/projects`; the same DOM node stays and its `data-screen` is `/work`. Navigate on to `/me`: a new node with `data-screen="/me"`. At desk width the node changes between `/work` and `/projects`.

- [ ] **Step 2: Run it and see it fail**: `npx vitest run src/app/phoneShell.test.ts src/app/AppShell.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: `phoneShell` missing.

- [ ] **Step 3: Implement.** Move the two private functions out of `AppShell.tsx`. The desk answers equal the answers of today (`PROJECT_PAGE` gives `-1`, else the `NAV` index). The phone answers follow `phoneTabOf` and the index of `PHONE_NAV`; a project page still gives `-1`. `ScreenEntrance` gets the phone flag from `useIsPhone()`; `Shell` gives `screenKey(pathname, phone)` to the `key` of `ScreenEntrance`. The key keeps its `personTurn` prefix.

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS).

- [ ] **Step 5: Commit**
```
git add src/app/phoneShell.ts src/app/phoneShell.test.ts src/app/AppShell.tsx src/app/AppShell.test.tsx
git commit -m "Phone shell: use four tab slides and one entrance for the Work and Inbox views"
```

---

### Task S7: The Me routes, the stub screens and the redirects

**Files:**
- Create: `src/features/me/MeScreen.tsx`, `src/features/me/MeSectionScreen.tsx`
- Modify: `src/app/routes.tsx`, `src/app/screenLoaders.ts`, `src/app/screenLoaders.static.ts`, `src/app/idlePrefetch.ts` (add `'me'` to the end of `FIRST_SCREENS`), `src/app/routes.test.tsx`, `src/app/screens.test.ts`, `src/app/idlePrefetch.test.ts`
- Test: `src/app/meRoutes.test.tsx` (new)

**Interfaces:**
- Consumes: `useIsPhone`, `SettingsScreen` (exists).
- Produces: the screens `me` and `meSection`; the routes `/me` and `/me/:section` inside the shell (no `right`); stubs `MeScreen` and `MeSectionScreen` that both draw `<SettingsScreen />` (track M replaces the two files and keeps nothing of the redirects, because they live in `routes.tsx`); the redirects:
  - `/me` and `/me/:section` on a desk go to `/settings` (`Navigate replace`).
  - `/settings` on a phone goes to `/me`; when the hash starts with `#google=` it goes to `/me/calendar`. Both keep `search` and `hash`. The section id `calendar` is the id that track M must use.

- [ ] **Step 1: Write the failing test.**
```ts
it('sends /me and /me/profile on a desk to /settings', async () => {
  const { router } = await renderApp('/me');
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  await act(() => router.navigate('/me/profile'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
});
it('sends /settings on a phone to /me and keeps the page content of Settings', async () => {
  phoneMedia(true);
  const { router } = await renderApp('/settings');
  await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
  expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
});
it('sends the Google return on a phone to /me/calendar and keeps the hash', async () => {
  phoneMedia(true);
  const { router } = await renderApp('/settings#google=finish');
  await waitFor(() => expect(router.state.location.pathname).toBe('/me/calendar'));
  expect(router.state.location.hash).toBe('#google=finish');
});
it('keeps /me/profile on a phone', ...);
it('keeps the Google return at /settings on a desk', ...);   // pathname '/settings', hash '#google=finish'
it('opens no tab and no redirect for /search', ...);
```
Update: `routes.test.tsx` `SCREENS` gets `{ path: 'me', screen: 'MeScreen', error: 'plain' }` and `{ path: 'me/:section', screen: 'MeSectionScreen', error: 'plain' }` after `settings`; `screens.test.ts` expects 22 names, with `me` and `meSection`; `idlePrefetch.test.ts` adds: `prefetchOrder()` holds `me` and the first four stay `projects, project, work, inbox`. `screenLoaders.test.ts` needs no edit (it compares the two lists).

- [ ] **Step 2: Run it and see it fail**: `npx vitest run src/app/meRoutes.test.tsx src/app/routes.test.tsx src/app/screens.test.ts src/app/screenLoaders.test.ts src/app/idlePrefetch.test.ts --no-file-parallelism --testTimeout=60000`. Expected: the shape list differs; `/me` shows the page of a wrong link.

- [ ] **Step 3: Implement.**
  - `LOADERS` (both lists, same order): add `me` and `meSection` after `settings`. The static list imports the two stubs.
  - `routes.tsx`: add the two route entries after `settings`. Add the optional fields `phoneTo?: (url: { search: string; hash: string }) => To` and `deskTo?: string` to `Entry`. In `toRoute`, a wrapper component renders `<Navigate to=... replace />` when its rule gives a target, else the screen. The wrapper takes the name of the screen (`Object.defineProperty(Wrapper, 'name', ...)`, as `guarded` does), so `routes.test.tsx` still reads screen names. `settings` gets `phoneTo`, `me` and `me/:section` get `deskTo: '/settings'`.
  - `screens.ts` needs no code change (`SCREEN_NAMES` comes from the loader list).

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Also run `npx vitest run src/features/settings --no-file-parallelism --testTimeout=60000`.

- [ ] **Step 5: Commit**
```
git add src/features/me src/app/routes.tsx src/app/screenLoaders.ts src/app/screenLoaders.static.ts src/app/idlePrefetch.ts src/app/*.test.*
git commit -m "Phone shell: add the Me routes with stub screens and the Settings redirects"
```

---

### Task S8: SegmentedControl and Tabs

**Files:**
- Modify: `src/components/SegmentedControl.tsx`, `src/components/Tabs.tsx`, `src/components/Tabs.test.tsx`
- Test: `src/components/SegmentedControl.test.tsx` (new)

**Interfaces:**
- Consumes: `spring`, `Badge`, `arrowStep`.
- Produces:
  - `SegmentedControl<T>` gains `fill?: boolean`, `layoutId?: string`, `onOptionPointerDown?: (value: T) => void`. The option type gains `count?: number` and `countLabel?: string` (extra, for the Inbox switch of track I: a `Badge` shows after the label when `count > 0`).
  - `Tabs<T>` gains `spread?: boolean` and `variant?: 'underline' | 'pill'` (default `'underline'`).
  - With `fill`, the thumb is `<motion.span data-thumb={layoutId} layoutId={layoutId} transition={spring.standard}>` inside the checked option. `layoutId` falls back to `useId()`. In the pill variant of `Tabs`, `data-thumb` is `${idPrefix}-thumb`.

- [ ] **Step 1: Write the failing tests.**
`SegmentedControl.test.tsx`:
```ts
it('is unchanged without fill', () => {
  // group class: inline-flex flex-wrap self-start rounded-full bg-fill p-0.5 ; checked option: bg-card text-ink shadow-card ; no [data-thumb]
});
it('fills the width with equal options and one sliding thumb', () => {
  render(<SegmentedControl fill layoutId="work-switch" label="View" value="b" onChange={...} options={[A, B, C]} />);
  const group = screen.getByRole('radiogroup');
  expect(group).toHaveClass('flex', 'w-full'); expect(group).not.toHaveClass('inline-flex');
  for (const r of screen.getAllByRole('radio')) expect(r).toHaveClass('flex-1', 'min-w-0', 'justify-center', 'whitespace-nowrap', 'min-h-11');
  const thumb = group.querySelector('[data-thumb="work-switch"]'); expect(thumb).toHaveClass('bg-card', 'shadow-card', 'rounded-full');
  expect(screen.getByRole('radio', { name: 'B' })).toContainElement(thumb as HTMLElement);
});
it('moves the thumb to the new choice and keeps one Tab stop and the arrow keys, also in RTL', ...);
it('calls onOptionPointerDown before the click, with the value', ...);   // onChange not yet called
it('shows a Badge after the label when count is above 0, and nothing for 0', ...);   // name 'Chats Unread messages: 3'
it('takes a useId layoutId when fill has none', ...);
```
`Tabs.test.tsx`: add
```ts
it('spreads the tabs in equal columns with no side scroll', () => {
  // tablist: grid, style gridTemplateColumns 'repeat(2, minmax(0, 1fr))', no overflow-x-auto ; tab: text-caption min-h-11 whitespace-normal text-center
});
it('draws the pill variant with a sliding thumb and no underline', () => {
  // tablist: rounded-full bg-fill p-0.5 min-h-11 ; tab 'One' has span[data-thumb="tab-thumb"] with bg-card shadow-card ; role tab, aria-selected, aria-controls kept
});
it('keeps the arrow keys in the pill variant', ...);   // ArrowRight moves to 'Two'; in RTL ArrowLeft does
```

- [ ] **Step 2: Run them and see them fail**: `npx vitest run src/components/SegmentedControl.test.tsx src/components/Tabs.test.tsx src/components/overlays.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no `[data-thumb]`; props unknown.

- [ ] **Step 3: Implement.**
  - `SegmentedControl`: with `fill` the group is `flex w-full rounded-full bg-fill p-0.5` (no wrap, no `self-start`). Each option is `relative isolate flex-1 min-w-0 min-h-11 justify-center whitespace-nowrap px-3`. The checked option has `text-ink` and holds the thumb `absolute inset-0 -z-10 rounded-full bg-card shadow-card`. Without `fill` the markup stays as it is today (the checked button keeps its own `bg-card`). The option keeps `min-h-11`, so the touch target is 44 px and the group is 48 px high with its padding. `onPointerDown` calls `onOptionPointerDown?.(option.value)`. Callers that use the old option type do not change.
  - `Tabs`: `spread` sets `grid` with `style={{ gridTemplateColumns: 'repeat(n, minmax(0, 1fr))' }}`, drops the side scroll classes, and gives each tab `px-1 text-caption whitespace-normal text-center leading-tight`. `variant="pill"` sets the group to `grid rounded-full bg-fill p-0.5 min-h-11` with equal columns and puts the thumb in the selected tab in place of the underline. The underline of the default variant keeps `layoutId={`${idPrefix}-underline`}`.

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Also run `node scripts/check-rtl.ts`.

- [ ] **Step 5: Commit**
```
git add src/components/SegmentedControl.tsx src/components/SegmentedControl.test.tsx src/components/Tabs.tsx src/components/Tabs.test.tsx
git commit -m "Components: add the full-width sliding switch and the spread and pill tabs"
```

---

### Task S9: Sheet props and SheetOrPopover

**Files:**
- Create: `src/components/SheetOrPopover.tsx`
- Modify: `src/components/Sheet.tsx` (`tall`, `phoneHeader`, `onClosed`), `src/components/SheetEdge.test.tsx`
- Test: `src/components/SheetPhone.test.tsx` (new), `src/components/SheetOrPopover.test.tsx` (new)

**Interfaces:**
- Consumes: `useIsPhone`, `Popover`, `Drawer`.
- Produces:
  - `Sheet` props: `tall?: boolean`, `phoneHeader?: ReactNode`, and `onClosed?: () => void` (extra: runs when the close animation ends, `Drawer.Root onAnimationEnd`; track S10 needs it).
  - `SheetOrPopover(props: { open: boolean; onOpenChange: (open: boolean) => void; anchor: HTMLElement | null; title: string; children: ReactNode })`. A desk draws `Popover` (`label={title}`, `onClose` calls `onOpenChange(false)`), and draws nothing when `anchor` is `null` or `open` is false. A phone draws `Sheet` with the same title and children and ignores `anchor`.

- [ ] **Step 1: Write the failing tests.**
`SheetPhone.test.tsx` (`phoneMedia(true)`):
```ts
it('takes the full free height with tall', async () => {
  render(<Sheet open onOpenChange={noop} title="Task" tall>Body</Sheet>);
  const sheet = await screen.findByRole('dialog', { name: 'Task' });
  expect(sheet).toHaveClass('h-[calc(100dvh_-_5.25rem_-_env(safe-area-inset-top))]');
});
it('keeps max-h and no fixed height without tall', ...);   // SheetEdge cases pass unchanged
it('replaces the title row by phoneHeader, and keeps the real title as sr-only', async () => {
  render(<Sheet open onOpenChange={noop} title="Stair details" phoneHeader={<div>Custom row</div>}>Body</Sheet>);
  const title = await screen.findByText('Stair details');
  expect(title).toHaveClass('sr-only'); expect(title).toHaveAttribute('data-sheet-title'); expect(title).toHaveAttribute('tabindex', '-1');
  expect(screen.getByText('Custom row')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();     // the header node holds its own close button
  expect(screen.getByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
});
it('gives the focus to the sr-only title when no field takes it', ...);   // focusInto still finds [data-sheet-title]
it('ignores tall and phoneHeader at desk width', ...);   // phoneMedia(false): title visible, Close button present, no h- class
it('calls onClosed after the close animation', ...);     // fire animationend / use the Drawer onAnimationEnd path; the test may call the prop through a mocked Drawer.Root
```
`SheetOrPopover.test.tsx`:
```ts
it('draws a Popover next to the anchor on a desk', ...);        // role dialog named by title; Escape calls onOpenChange(false)
it('draws nothing on a desk with a null anchor', ...);
it('draws a bottom Sheet on a phone with the same children', ...);   // data-vaul-drawer-direction="bottom"; anchor ignored
```

- [ ] **Step 2: Run them and see them fail**: `npx vitest run src/components/SheetPhone.test.tsx src/components/SheetOrPopover.test.tsx src/components/SheetEdge.test.tsx src/components/overlays.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: props unknown; module `SheetOrPopover` missing.

- [ ] **Step 3: Implement.**
  - `Sheet.tsx`: `tall` adds the class `h-[calc(100dvh_-_5.25rem_-_env(safe-area-inset-top))]` next to `PHONE_HEIGHT` on a phone only. With `phoneHeader` on a phone, `Frame` skips its title row (title, `headerAction`, Close button) and draws `phoneHeader` in its place; `Drawer.Title` becomes `sr-only` and keeps `data-sheet-title` and `tabIndex={-1}`. The caller's header holds its own close button. A desk ignores both props. `onClosed` goes to `Drawer.Root onAnimationEnd={(open) => { if (!open) onClosed?.(); }}`.
  - `SheetOrPopover.tsx`: as in Interfaces. The Popover branch needs a mounted `anchor`, so it returns `null` for a `null` anchor.

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS).

- [ ] **Step 5: Commit**
```
git add src/components/Sheet.tsx src/components/SheetOrPopover.tsx src/components/SheetPhone.test.tsx src/components/SheetOrPopover.test.tsx src/components/SheetEdge.test.tsx
git commit -m "Components: add tall sheets, a phone sheet header and SheetOrPopover"
```

---

### Task S10: Menu as a bottom sheet on a phone

**Files:**
- Create: `src/components/MenuSheet.tsx`
- Modify: `src/components/Menu.tsx` (`sheetOnPhone`, lazy sheet), `src/app/firstLoadImports.test.ts` (new lazy part), `src/components/Menu.test.tsx`
- Test: `src/components/MenuSheet.test.tsx` (new)

**Interfaces:**
- Consumes: `Sheet` with `onClosed` (S9), `lazyOverlay` (`src/app/lazyOverlay.tsx`), `MenuItem`.
- Produces: `Menu` gains `sheetOnPhone?: boolean`. On a phone with the prop, the trigger button is the same, a press opens `MenuSheet` (a `Sheet` titled by `label`) with one `role="menuitem"` button of at least 44 px for each visible item: same `label`, `destructive`, `checked` (`menuitemradio`), `heading`, `note`, `onPrepare` on pointer down. A press closes the sheet, and `onSelect` runs when `onClosed` fires, with a 600 ms timer as the fallback (jsdom has no animation events; one ref stops a double run). The sheet opens its next sheet only after it closes. A desk, and a phone without the prop, keep the pop-up menu.

- [ ] **Step 1: Write the failing tests** (`MenuSheet.test.tsx`, `phoneMedia(true)`, fake timers where noted).
```ts
const items = [{ label: 'Rename', onSelect }, { label: 'Delete', onSelect: del, destructive: true }, { label: 'Hidden', onSelect, hidden: true }];
it('opens a bottom sheet of 44 px rows on a phone', async () => {
  render(<Menu label="More actions" items={items} sheetOnPhone />);
  await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
  const sheet = await screen.findByRole('dialog', { name: 'More actions' });
  const rows = within(sheet).getAllByRole('menuitem');
  expect(rows.map((r) => r.textContent)).toEqual(['Rename', 'Delete']);
  for (const r of rows) expect(r).toHaveClass('min-h-11', 'w-full');
  expect(within(sheet).getByRole('menuitem', { name: 'Delete' })).toHaveClass('text-late');
});
it('runs onSelect once after the sheet closes', async () => {
  vi.useFakeTimers(); /* open, click Rename */ expect(onSelect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(600); expect(onSelect).toHaveBeenCalledTimes(1);   // and not twice if onClosed also fires
});
it('keeps the pop-up menu without the prop, and on a desk with the prop', ...);   // role menu
it('keeps radio items, headings, notes and onPrepare in the sheet', ...);
it('does not import the sheet in the first load', ...);   // firstLoadImports: LAZY_PARTS gets { file: 'src/components/Menu.tsx', module: 'MenuSheet', part: 'the menu sheet' }
```
Old `Menu.test.tsx` and `overlays.test.tsx` menu cases stay unchanged.

- [ ] **Step 2: Run them and see them fail**: `npx vitest run src/components/MenuSheet.test.tsx src/components/Menu.test.tsx src/components/overlays.test.tsx src/app/firstLoadImports.test.ts --no-file-parallelism --testTimeout=60000`. Expected: the prop does nothing; no dialog opens.

- [ ] **Step 3: Implement.** `Menu.tsx` loads the sheet with `lazyOverlay(() => import('./MenuSheet').then((m) => m.MenuSheet))` and calls `warm()` on the first pointer down of a trigger that has `sheetOnPhone` on a phone. Never import `Sheet` or `MenuSheet` statically in `Menu.tsx`: `Menu` is in the first load and vaul must stay in the `overlay` chunk (`check-bundles.ts` fails on the vaul marker). `MenuSheet` shares the row classes of `MenuList` (`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-start text-body`).

- [ ] **Step 4: Run the tests and `npm run typecheck`** (expected PASS). Then the gate of the track, once: `npm run build:remote -- test` (sandbox off), then `node scripts/check-bundles.ts remote dist` unless the build printed the check. Write the first-load numbers (bytes, gzip, files against 970,000 B, 296,000 B and 35 files) in the body of the commit message. The bar, two icons and `phoneshell` words sit in the first load.

- [ ] **Step 5: Commit**
```
git add src/components/Menu.tsx src/components/MenuSheet.tsx src/components/MenuSheet.test.tsx src/components/Menu.test.tsx src/app/firstLoadImports.test.ts
git commit -m "Components: let a Menu open as a bottom sheet on a phone"
```

---

**Browser specs of the track (run by the Playwright agent of the lead, not by the builder).** Updated inside the tasks above: `owner.spec.ts` (four tabs; Search the whole office; no bell on a phone). To add in task S5 and S3 with the same commits: `shell.spec.ts` and `full.spec.ts` add `/me` to their route lists; `work.spec.ts` adds `/#/me` to "no screen scrolls sideways on a phone"; `calm.spec.ts` keeps its desk cases and its 390 px Home case (the bar bottom edge is unchanged). Their `tests/e2e-deploy` twins change the same way. `signOut()` and the Preview as helpers stay with track M. The phone has no person menu until M lands, so a phone run of the deploy suite that signs out fails in wave 1 only.

**Review focus candidates:**
1. A pinch-zoomed page on iPhone makes `visualViewport` shorter and could look like an open keyboard. Test: `useKeyboardOpen` stays false at scale 2 (task S1).
2. A phone turned sideways passes 640 px while a chat is open. The bar must return, `data-bar-hidden` must go, and no redirect may loop. Test: `phoneMedia.set(false)` in a chat (task S4).
3. A push line opens `/inbox/:id` cold. The bar must not flash at the first paint. Test: render at the chat path, no `Main navigation` at once (task S4).
4. A double tap on the open Work tab. Both taps scroll to the top, and the address does not change. Test: two clicks, two `scrollTo` calls, one history entry (task S3).

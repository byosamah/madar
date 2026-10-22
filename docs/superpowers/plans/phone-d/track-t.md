> Part of `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`. Read that file first: its Global Constraints, shared interfaces and Lead amendments win over this file.

## Track T: Today (wave 2, branch rb/phone-d-today)

**Owns:**
- `src/features/home/HomeScreen.tsx`, `MeetingsCard.tsx`, `PushAskCard.tsx`, and the new test helper `src/features/home/testPhone.ts`.
- `src/app/remote/homeCache.ts` and `src/app/remote/homeCache.test.ts`.
- The tests in `src/features/home/`: `HomePhone.test.tsx` (new), `HomeInstant.test.tsx`, `HomeRoleHint.test.tsx`, `HomeRenders.test.tsx`, `HomeScreen.test.tsx`, `MeetingsCard.test.tsx`, `PushAskCard.test.tsx`.
- The new word files `src/i18n/real/phonetoday.en.json` and `src/i18n/real/phonetoday.ar.json`.
- The Home lines of the browser specs `tests/e2e/calm.spec.ts`, `tests/e2e-deploy/calm.spec.ts`, `tests/e2e/full.spec.ts`, `tests/e2e-deploy/full.spec.ts`.

T does not edit: `TaskPeople.tsx` (the 44 px press area belongs to track W, design table), `useIsPhone.ts` (`isPhoneNow()` comes from track S), `TodayPanel.tsx`, `NextCard.tsx`, `HomeTaskSheet.tsx`, `src/CLAUDE.md`, `DESIGN.md`, and the What's new entry (the lead, wave 3). The files `DayRing.tsx`, `TodayPanel.tsx` and `NextCard.tsx` need no change.

**Reads:** the area section "Today (Home)" of the areas file, the design file (Lead decisions 1, 6, 11, 15; Calls for the owner to check 1 and 6), the contract part "Hooks and helpers" (`isPhoneNow`) and "Global Constraints" (phone test stub, word files).

**Where the areas file and the design file differ, this track follows the design file:**
- The word file pair is `phonetoday`, not `phoned`. The key is `phoneToday.joinLabel`.
- `isPhoneNow()` is built by track S. Task T1 only imports it.
- The bell icon goes on the ask card only (the area table says the iPhone steps card and the Android card "Keep"). The bell, the subline, the chevron and the Join button show on a phone only, so the desk stays as it is today (design rule 1).

**Rows of the area table that other tracks build (T keeps the seam, adds no work):** To-do title press, conversation button and the D to-do (track K, through `HomeTaskSheet`); lead picture 44 px, grip as `sr-only` and press and hold (track W); the Today tab word, the top row and the Inbox badge (track S); the "What's new" row (track M); the Projects view (track W). Task T3 pins the status line that depends on the D to-do.

---

### Task T1: Stored Home answers for a phone

**Files:**
- Create: `src/features/home/testPhone.ts` (test helper, as `src/features/meetings/testMeetings.ts`)
- Modify: `src/app/remote/homeCache.ts` (`homeKeys` gets a third argument; `show` and `collect` pass `isPhoneNow()`)
- Test: `src/app/remote/homeCache.test.ts`, `src/features/home/HomeInstant.test.tsx`

**Interfaces:**
- Consumes: `isPhoneNow(): boolean` from `src/app/useIsPhone.ts` (track S, wave 1).
- Produces: `homeKeys(role: string | undefined, today: string, phone?: boolean): unknown[][]` (default `false`; with `true` it leaves out the `projects.list` key). `stubPhone(initial?: boolean): { set(phone: boolean): void }` in `testPhone.ts`. Tests T2 to T5 use `stubPhone`. The caller restores with `vi.restoreAllMocks()` in `afterEach`.

- [ ] **Step 1: Write the failing test**
  First create `testPhone.ts`. It is not a test, so it needs no failing test of its own. Algorithm:
  ```ts
  import { act } from '@testing-library/react';
  import { vi } from 'vitest';
  const PHONE = '(max-width: 639px)';
  /** Makes jsdom a phone (width under 640 px) until vi.restoreAllMocks(). set() turns the phone and tells the listeners. */
  export function stubPhone(initial = true): { set(phone: boolean): void } {
    let phone = initial;
    const listeners = new Set<() => void>();
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      get matches() { return query === PHONE ? phone : false; },
      media: query, onchange: null,
      addEventListener: (_: string, fn: () => void) => { if (query === PHONE) listeners.add(fn); },
      removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); },
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    return { set(next) { phone = next; act(() => { listeners.forEach((fn) => fn()); }); } };
  }
  ```
  Then the tests.
  In `homeCache.test.ts`:
  ```ts
  it('leaves projects.list out of the keys of a phone, and keeps it in the default', () => {
    const names = (phone?: boolean) => homeKeys('member', TODAY, phone).map((key) => key[1]);
    expect(names(true)).toEqual(['session.get', 'chats.unreadCount', 'notifications.count', 'tasks.list', 'tasks.list', 'meetings.list', 'subCompanies.list', 'users.list']);
    expect(names()).toContain('projects.list');
    expect(homeKeys('admin', TODAY, true).map((key) => key[1])).not.toContain('projects.list');
  });
  it('writes no projects.list on a phone, and shows no stored projects.list on a phone', async () => {
    // A: stubPhone(true); start the cache; fill() the client as the other tests do, plus a projects.list answer; after the write,
    //    readHomeRecord(AUTH) has no entry named 'projects.list' (keeps chats.unreadCount and both tasks.list).
    // B (a desk record on a phone): save a record that holds a projects.list entry (saveHomeRecord); with stubPhone(true) start the cache;
    //    after the start, the client holds no data for the key ['api','projects.list', ...].
  });
  ```
  In `HomeInstant.test.tsx` (phone first life, written after the desk `firstLife` helper): with `stubPhone(true)`, a Member, wait for the region "Next for you" and for `readHomeRecord`; expect the entry names to equal `['chats.unreadCount', 'meetings.list', 'notifications.count', 'session.get', 'subCompanies.list', 'tasks.list', 'tasks.list', 'users.list']`. The existing desk test (with `projects.list`) stays.

- [ ] **Step 2: Run it and see it fail**
  `npx vitest run src/app/remote/homeCache.test.ts src/features/home/HomeInstant.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the key test fails on the missing third argument (the list still holds `projects.list`), and the record tests fail because `projects.list` is in the entries.

- [ ] **Step 3: Implement**
  In `homeCache.ts` give `homeKeys` the third argument `phone = false` and drop the `projects.list` key when `phone` is true (same order for the other keys). `show` (the `wanted` set) and `collect` (the `keys`) pass `isPhoneNow()`. Do not change `HOME_NAMES` (it calls `homeKeys(undefined, '')`), so a `projects.list` answer still schedules a write. Update the doc comment of `homeKeys` with one line: "On a phone the list has no projects.list (Direction D)."

- [ ] **Step 4: Run the tests and `npm run typecheck`**
  Same vitest command, then `npm run typecheck`. Expected: PASS. The old desk tests of both files still pass.

- [ ] **Step 5: Commit**
  `git add src/features/home/testPhone.ts src/app/remote/homeCache.ts src/app/remote/homeCache.test.ts src/features/home/HomeInstant.test.tsx`
  Message: `Home cache: a phone keeps no project list in the stored answers`

---

### Task T2: Home on a phone, five blocks in one column

**Files:**
- Modify: `src/features/home/HomeScreen.tsx` (`useIsPhone`, the `phone` prop of `HomeBody`, direct blocks, no project section, no What's new link, `enabled: !phone`)
- Create: `src/features/home/HomePhone.test.tsx`
- Test: `src/features/home/HomeRoleHint.test.tsx` (a phone case), `src/features/home/HomeRenders.test.tsx` (a phone case)

**Interfaces:**
- Consumes: `useIsPhone(): boolean` (`src/app/useIsPhone.ts`), `useCall(name, input, { enabled })` (`src/app/runtime.tsx`), `stubPhone` (T1).
- Produces: nothing for later tasks. `HomeBody` gets the prop `phone: boolean`. The grid is the one child of `.screen-enter`, so on a phone each block rises in turn with the existing rule (no change to `tokens.css`).

- [ ] **Step 1: Write the failing test**
  `HomePhone.test.tsx` (each test calls `stubPhone(true)`, `afterEach(() => vi.restoreAllMocks())`). Use `renderApp('/', as('usr_002'), ...)` with `withMeeting` for the Meetings block.
  ```ts
  it('is one column of blocks that are direct children of the grid', async () => {
    // usr_002 and one meeting today (14:00)
    const grid = document.querySelector('main .grid')!;
    expect(grid.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(grid.className).toContain('gap-4');
    expect(Array.from(grid.children).map((block) => block.querySelector('h1, h2')?.textContent))
      .toEqual([expect.stringMatching(/^Good morning/), 'Next for you', 'Today', 'Meetings today']);
  });
  it('has no project list, no All projects link and no What\'s new link', async () => {
    // usr_005 (the desk test shows the link for this user)
    expect(screen.queryByRole('region', { name: 'Your projects' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'All projects' })).toBeNull();
    expect(screen.queryByRole('link', { name: "See what's new" })).toBeNull();
  });
  it('sends no projects.list read', async () => {
    // renderHeldRemoteApp('/', as('usr_003')); wait for the region 'Next for you'; release
    expect(app.asked.map((call) => call.name)).not.toContain('projects.list');
  });
  it('starts the project list when the phone turns to landscape, and drops it on the way back', async () => {
    const media = stubPhone(true); // render, wait for 'Next for you'
    media.set(false);
    expect(await screen.findByRole('region', { name: 'Your projects' })).toBeInTheDocument();
    expect(app.asked.map((call) => call.name)).toContain('projects.list');
    media.set(true);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your projects' })).toBeNull());
  });
  it('opens the to-do of a push link with no project list', async () => {
    // renderApp('/?task=tsk_007&project=prj_001', as('usr_001'))
    expect(await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 })).toBeInTheDocument();
  });
  it('shows the empty day as three calm blocks', async () => {
    // usr_005 with every task done (as in HomeScreen.test 'says so when there is nothing to do')
    // blocks: title, 'Next for you' (You are all caught up.), 'Today' (Nothing is due today. + the link See all my to-dos)
  });
  ```
  `HomeRoleHint.test.tsx` (new case, `stubPhone(true)`, hint `admin`, held `session.get` then release): `lists(sent)` stays `[]`, and `localStorage` holds the role (`HINT_KEY` is `admin`).
  `HomeRenders.test.tsx` (new case with `stubPhone(true)`): opening and closing a task panel does not render the task rows again (same `counts.tasks` check as the desk case; no wait for "Your projects").

- [ ] **Step 2: Run it and see it fail**
  `npx vitest run src/features/home/HomePhone.test.tsx src/features/home/HomeRoleHint.test.tsx src/features/home/HomeRenders.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the grid has two children (a wrapper and the project section), "Your projects" shows, `projects.list` is asked.

- [ ] **Step 3: Implement**
  In `HomeScreen`: `const phone = useIsPhone();`, `useCall('projects.list', input, { enabled: !phone })`, grid class `phone ? 'grid grid-cols-[minmax(0,1fr)] gap-4' : 'grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8'`, and pass `phone` to `HomeBody`. In `HomeBody`, build the five blocks once (`ScreenTitle` with the ring, `NextCard`, `TodayPanel`, `MeetingsCard`, `PushAskCard`). On a phone return them as a fragment (direct children of the grid). On a desk wrap them in the `div className="flex min-w-0 flex-col gap-4"` and add the project section, as today. The phone date line leaves out the `hasNew(...)` link (do not call `readSeen`). Do not use a `display: contents` wrapper: the `.screen-enter` rule reads the DOM tree. The role hint effect stays as it is.

- [ ] **Step 4: Run the tests and `npm run typecheck`**
  Same vitest command plus `src/features/home/HomeScreen.test.tsx src/features/home/HomeInstant.test.tsx`. Expected: PASS (the desk tests are unchanged, jsdom is not a phone).

- [ ] **Step 5: Commit**
  `git add src/features/home/HomeScreen.tsx src/features/home/HomePhone.test.tsx src/features/home/HomeRoleHint.test.tsx src/features/home/HomeRenders.test.tsx`
  Message: `Home: a phone shows five blocks in one column and reads no project list`

---

### Task T3: The status line "Done. N more today." after the D to-do

**Files:**
- Modify: none expected (the line lives in `HomeScreen`, which listens to the mutation cache). If a test fails, fix `HomeScreen.tsx`.
- Test: `src/features/home/HomeScreen.test.tsx`

**Interfaces:**
- Consumes: `stubPhone` (T1), the phone layout of T2. The finish case consumes the button "Mark done" that track K adds to the to-do.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**
  New `describe('the status line on a phone')` with `stubPhone(true)`:
  ```ts
  it('shows "Done. 1 more today." after tasks.approve made inside the opened to-do', async () => {
    // usr_002 (the review 'Toilet details' waits). Give Faisal one due task so the ring has a total of 1:
    //   const t = Object.values(state.tasks).find((x) => x.projectId === 'prj_001' && x.ownerId !== 'usr_002' && x.status === 'todo');
    //   Object.assign(t!, { ownerId: 'usr_002', dueDate: TODAY, startDate: null, prerequisiteIds: [] });
    await userEvent.click(within(await next()).getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Toilet details' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Done. 1 more today.', {}, { timeout: 2000 })).toBeInTheDocument();
  });
  it.skip('shows the line after a finish made inside the opened to-do (enable after track K merges)', async () => {
    // usr_006 has 'Stair details' due today and a second due task. Open /?task=tsk_007&project=prj_001, click 'Mark done' in the dialog,
    // expect the text /^Done\. \d+ more today\.$/ in the card 'Next for you'.
  });
  ```
  The skipped test pins the join. The lead turns `it.skip` into `it` in the join task, after the K branch merges (the current to-do has no `tasks.complete` button).

- [ ] **Step 2: Run it and see it fail**
  `npx vitest run src/features/home/HomeScreen.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the approve test PASSES at once, because the line already exists. This is a pin of a Keep row. If the line does not show, find the cause in the mutation subscription of `HomeScreen` and fix it before Step 3.

- [ ] **Step 3: Implement**
  No code change when Step 2 passes. Add one comment line above the subscription in `HomeScreen.tsx`: "The line lives here, so it shows after the to-do sheet over Home closes or stays open (Direction D)."

- [ ] **Step 4: Run the tests and `npm run typecheck`**
  Same command. Expected: PASS, with one skipped test.

- [ ] **Step 5: Commit**
  `git add src/features/home/HomeScreen.test.tsx src/features/home/HomeScreen.tsx`
  Message: `Home: pin the status line after Approve on a phone`

---

### Task T4: Meetings today, the phone row with its Join button

**Files:**
- Create: `src/i18n/real/phonetoday.en.json`, `src/i18n/real/phonetoday.ar.json`
- Modify: `src/features/home/MeetingsCard.tsx`
- Test: `src/features/home/MeetingsCard.test.tsx`

**Interfaces:**
- Consumes: `mainAction(meeting, at, pin): MainAction | null` and `joinLink` from `src/features/meetings/meetingLinks.ts` (pass `pin = null`; use the result only when `kind === 'join'`), `useIsPhone`, `ChevronRightIcon` (`src/components/icons/animated/chevron-right.tsx`), `meetings.kind.*`, `meetings.sheet.join` ("Join"), `stubPhone` (T1).
- Produces: the word `phoneToday.joinLabel`. English: `Join {{title}}`. Arabic: `انضم إلى {{title}}`. It is the `aria-label` of the Join link; the visible text is `meetings.sheet.join`.

- [ ] **Step 1: Write the failing test**
  In `MeetingsCard.test.tsx`, a new `describe('the Meetings card on a phone')` with `stubPhone(true)`. "Now" is 09:00 Riyadh; use `today(state, id, from, to, over)` of the file.
  ```ts
  it('adds the kind and the project name under the title, and a chevron at the end', async () => {
    // mtg_001 client meeting of Corniche Office Tower; mtg_002 team meeting with projectId null
    expect(rowOf('Review the facade')).toHaveTextContent('Client meeting · Corniche Office Tower');
    expect(rowOf('Weekly team meeting')).toHaveTextContent(/Team meeting$/);       // no project: the kind alone, no word Office
    expect(rowOf('Review the facade').closest('li')!.querySelector('[data-animated-icon]')).not.toBeNull();
  });
  it('shows Join from 30 minutes before the start, for an https link only', async () => {
    // 09:30 + link -> Join; 09:31 + link -> none; 08:30-09:30 (on now) + link -> Join;
    // 09:10 with where 'http://meet.example.com/a', 'javascript:alert(1)', 'Meeting room 2' -> none
    const join = screen.getByRole('link', { name: 'Join Review the facade' });
    expect(join).toHaveAttribute('href', 'https://meet.example.com/abc');
    expect(join).toHaveAttribute('target', '_blank');
    expect(join).toHaveAttribute('rel', 'noopener noreferrer');
    expect(join.closest('a[href*="meeting="]')).toBeNull();                          // not inside the row link
    expect(join.className).not.toContain('signature');                               // secondary, not navy
  });
  it('shows Join when a phone left open passes the 30-minute point', async () => {
    // vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); meeting at 09:45 with a link; setNow(09:00) -> no Join;
    // setNow(09:20); act(() => vi.advanceTimersByTime(60_000)) -> Join shows.
  });
  it('still opens the sheet on Work, Meetings from the row', async () => {
    // click the row link: router pathname '/meetings', search '?meeting=mtg_001', dialog 'Review the facade'
  });
  it('keeps long names on one line, and the Join button at its size', async () => {
    // title and subline have 'truncate' and 'min-w-0'; Join has 'shrink-0' and 'min-h-11'
  });
  it('keeps the desk row as it is: no subline, no chevron, no Join', async () => {
    // stubPhone(false) with a link meeting at 09:10 -> row textContent '9:10 AMReview the facade'; no link named /^Join/
  });
  it('has the Join label in Arabic', () => {
    expect(initI18n('en').getFixedT('ar')('phoneToday.joinLabel', { title: 'X' })).toBe('انضم إلى X');
  });
  ```

- [ ] **Step 2: Run it and see it fail**
  `npx vitest run src/features/home/MeetingsCard.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the phone tests fail (no subline, no chevron, no Join, missing key). The desk tests pass.

- [ ] **Step 3: Implement**
  Add the key tree `phoneToday` with `joinLabel` to both new word files. In `MeetingsCard` read `useIsPhone()`. On a phone each `li` is `relative flex items-center` and holds, in this order: the row `Link` (time, then title over the subline, `flex-1 min-w-0`, with `after:absolute after:inset-0` so the whole row is one press area), the Join `<a>` when `mainAction(row, at, null)?.kind === 'join'` (`relative z-10 shrink-0`, `min-h-11`, secondary look: `bg-fill text-ink`, `rounded-full px-4 text-subheadline font-semibold`, `aria-label={t('phoneToday.joinLabel', { title: row.title })}`, `target="_blank" rel="noopener noreferrer"`), then the chevron (`ChevronRightIcon` 18 px, `text-ink-2 rtl:-scale-x-100`, `aria-hidden`, `pointer-events-none`). The subline is `{t(`meetings.kind.${row.kind}`)}{row.project && <> · <bdi>{row.project.name}</bdi></>}` in `text-footnote text-ink-2 truncate`. Add a 60 s `setInterval` (phone only, cleared on unmount) that re-renders the card, so the list and the Join button follow the clock. The desk row stays as it is.

- [ ] **Step 4: Run the tests and `npm run typecheck`**
  `npx vitest run src/features/home/MeetingsCard.test.tsx src/i18n/keys.test.ts src/i18n/i18n.test.ts src/i18n/arabic.test.ts --no-file-parallelism --testTimeout=60000`, then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add src/features/home/MeetingsCard.tsx src/features/home/MeetingsCard.test.tsx src/i18n/real/phonetoday.en.json src/i18n/real/phonetoday.ar.json`
  Message: `Home: a meeting row on a phone shows its kind, a chevron and a Join button`

---

### Task T5: The bell in the push ask card

**Files:**
- Modify: `src/features/home/PushAskCard.tsx` (the ask card only)
- Test: `src/features/home/PushAskCard.test.tsx`

**Interfaces:**
- Consumes: `BellIcon` (`src/components/icons/animated/bell.tsx`), `AnimatedIcon` with `playWhen`, `useIsPhone`, `stubPhone` (T1), `pushBrowser`, `pushWords` (existing test helpers).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**
  ```ts
  it('puts a bell before the ask line on a phone', async () => {
    stubPhone(true); pushBrowser(); await renderWithRuntime(<PushAskCard />);
    const line = await screen.findByText(pushWords.en.ask);
    expect(line.previousElementSibling).toHaveAttribute('data-animated-icon');
    expect(line.previousElementSibling).toHaveClass('text-ink-2');
    expect(screen.getAllByRole('button')).toHaveLength(1);                  // still one button, still secondary
    expect((await button()).classList.contains('signature')).toBe(false);
  });
  it('shows no bell on a desk, on the iPhone steps card or on the Android install card', async () => {
    // stubPhone(false): ask card -> no [data-animated-icon];
    // stubPhone(true) with iphoneBrowser() -> the steps card has none; with androidBrowser() + installEvent -> the install card has none
  });
  ```
- [ ] **Step 2: Run it and see it fail**
  `npx vitest run src/features/home/PushAskCard.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the first test fails (the line has no icon before it).

- [ ] **Step 3: Implement**
  In `PushAsk` wrap the line in `<div className="flex items-start gap-3">`. When `useIsPhone()` is true, put `<AnimatedIcon icon={BellIcon} size={20} playWhen className="mt-0.5 shrink-0 text-ink-2" aria-hidden />` before the `<p>`. The icon plays once when the card shows (`AnimatedIcon` never plays under reduced motion). The button, the error line and the other two cards stay as they are.

- [ ] **Step 4: Run the tests and `npm run typecheck`**
  Same vitest command. Expected: PASS (all old tests too).

- [ ] **Step 5: Commit**
  `git add src/features/home/PushAskCard.tsx src/features/home/PushAskCard.test.tsx`
  Message: `Home: a bell starts the push ask line on a phone`

---

### Task T6: Browser specs that wait for the project list under 640 px

**Files:**
- Modify: `tests/e2e/calm.spec.ts`, `tests/e2e-deploy/calm.spec.ts` (the loop "Home at ${width}px", and the last test, step `home-390-ar`), `tests/e2e/full.spec.ts` line 73 and `tests/e2e-deploy/full.spec.ts` line 71 (the reduce-motion test at 390 px)
- Test: the same files. Add one new test to `tests/e2e/calm.spec.ts`.

**Interfaces:**
- Consumes: the phone Home of T2 to T5. The pill assertions of the same tests belong to track S: change only the lines named here, so the two branches merge without a conflict.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**
  Change the waits and add the new test (the new test fails until T2 is in, so write it first):
  ```ts
  // loop 'Home at ${width}px': replace `await expect(homeRows(page).first()).toBeVisible();` with
  if (width < 640) await expect(page.getByRole('region', { name: 'Next for you' })).toBeVisible();
  else await expect(homeRows(page).first()).toBeVisible();
  // reduce-motion test at 390 px (full.spec.ts, both suites): wait for the region 'Next for you' in place of the list
  // last test: replace `await expect(page.locator('main ul li').first()).toBeVisible();` before shot('home-390-ar') with
  await expect(page.getByRole('heading', { name: 'خطوتك التالية' })).toBeVisible();
  test('Home at 390px is one column of blocks with no project list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/');
    await expect(page.getByRole('region', { name: 'Next for you' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Your projects' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: "See what's new" })).toHaveCount(0);
    const left = await page.locator('main .grid > *').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(left).size).toBe(1);                                              // every block starts at the same edge
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
  ```
- [ ] **Step 2: Run it and see it fail**
  A delegated Playwright agent (never inline) runs `npx playwright test tests/e2e/calm.spec.ts tests/e2e/full.spec.ts --reporter=line`. Before T2 the new test fails on the visible project list. The agent writes its shots into the scratchpad and moves `.playwright-mcp/` out of the repo (root CLAUDE.md).
- [ ] **Step 3: Implement**
  Only the spec edits of Step 1 (no source change). The deploy copies get the same edits through their `goto(page, ...)` helper.
- [ ] **Step 4: Run the tests and `npm run typecheck`**
  The Playwright agent runs the same two prototype specs: PASS at 390, 820 and 1440 px. It also runs `npx playwright test -c playwright.deploy.config.ts tests/e2e-deploy/calm.spec.ts -g "Home at"` only when the local stack is up (otherwise the lead runs the deploy suite in the join task). Then `npx vitest run src/app/firstLoadImports.test.ts --no-file-parallelism --testTimeout=60000` and `npm run build` with `check-bundles` (the Home chunk gets the bell; no new first-load code is expected). After that the same agent takes the screenshots (EN and AR, light and dark, 390 px and 360 px, Chromium and WebKit) of Home as a Member and as the Admin, with a past-due row, an office to-do row, a meeting with a link at 20 minutes, and the push ask card in the remote build.
- [ ] **Step 5: Commit**
  `git add tests/e2e/calm.spec.ts tests/e2e-deploy/calm.spec.ts tests/e2e/full.spec.ts tests/e2e-deploy/full.spec.ts`
  Message: `Tests: Home on a phone waits for Next for you, not for the project list`

---

**Review focus candidates:**
1. An old desk record on a phone. The stored Home answers of a desk browser hold `projects.list`. A phone that opens the same site data must show no stored project list and send no early read. (Test: T1 case B and T2 "sends no projects.list read".)
2. A push link `/?task=<id>&project=<id>` that opens on a phone with no project list loaded. The sheet must open and close and leave a calm list under it. (Test: T2 "opens the to-do of a push link with no project list".)
3. A meeting place that is not a safe link ("http://", "javascript:", a room name) near the start time. The row must show no Join button. (Test: T4 "shows Join from 30 minutes before the start, for an https link only".)
4. A phone left open on Today while the clock passes 30 minutes before a meeting. The Join button must appear with no pull to refresh, and a long Arabic title must not push it off the row at 360 px. (Test: T4 "shows Join when a phone left open passes the 30-minute point" and "keeps long names on one line".)

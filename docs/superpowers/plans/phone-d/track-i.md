> Part of `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`. Read that file first: its Global Constraints, shared interfaces and Lead amendments win over this file.

## Track I: Inbox and chat (wave 2, branch rb/phone-d-inbox)

**Owns:**
- `src/features/inbox/` (every file and test), `src/features/notifications/` (every file and test).
- `src/features/search/`: `SearchScreen.tsx`, `useQueryInLink.ts`, `MessageHits.tsx`, `PersonSheet.tsx` and their tests.
- `src/features/emoji/EmojiPanel.tsx` and its tests. `src/components/ImageViewer.tsx` and its test.
- Two files that the design table does not name, and that the area file needs (additive change only): `src/components/MentionField.tsx` (one new prop) and `src/features/files/Attachments.tsx` (the `FileChip` class).
- Words: `src/i18n/real/phoneinbox.en.json` and `phoneinbox.ar.json` (this track creates the pair in Task I2).
- Browser specs: new files `tests/e2e/inboxPhone.spec.ts` and `tests/e2e-deploy/inboxPhone.spec.ts`. Track S edits `owner.spec.ts`, so this track does not.

**Reads:** the sections "Inbox: Chats and Notifications" and "A conversation" of the areas file, and the design file (its lead decisions win). From the contract: `useVisualViewport`, `useKeyboardOpen`, `isPhoneNow`, `isPhoneChatPath`, `SegmentedControl` (`fill`, `layoutId`, `onOptionPointerDown`), `Sheet` (`phoneHeader`), the shell rule that hides the bar and the top row on `isPhoneChatPath`, and `--phone-bar`.

**Rules for every task of this track:**
- A phone test calls `stubPhone()` from `src/features/inbox/phoneHarness.ts` (Task I1) before `renderApp`, and `vi.unstubAllGlobals()` in `afterEach`. The jsdom default is a desk, so every old desk test stays valid.
- The desk branch of every file keeps its code of today. A phone branch uses `useIsPhone()`.
- Run each test command as `npx vitest run <files> --no-file-parallelism --testTimeout=60000`.
- A test that opens a chat on a phone may fail on a selector that looked for the hidden list. Change only that selector.

### Task I1: The Back rule and the opener state

**Files:**
- Create: `src/features/inbox/chatBack.tsx`
- Create: `src/features/inbox/phoneHarness.ts` (test helper, imported by tests only)
- Modify: `src/features/inbox/ChatList.tsx` (the row `Link` passes `state={chatState('/inbox')}`)
- Modify: `src/features/inbox/InboxScreen.tsx` (`NewMessage` calls `navigate(..., { state: chatState('/inbox') })` in both `onSuccess` handlers)
- Modify: `src/features/inbox/ConversationPane.tsx` (`Header` uses `<ChatBackLink className="sm:hidden" />` in place of its own `Link`)
- Test: `src/features/inbox/chatBack.test.tsx`

**Interfaces:**
- Consumes: `useNavigate`, `useLocation` of React Router; `chat.back`.
- Produces:
  - `export type ChatOpener = { from: string }` and `export const chatState: (from: string) => ChatOpener`.
  - `export function useChatBack(): { canGoBack: boolean; goBack: () => void }`.
  - `export function ChatBackLink(props: { className?: string }): JSX.Element` (a `Link` to `/inbox`, name `chat.back`, 44 px, `ChevronLeftIcon` with `rtl:-scale-x-100`).
  - In `phoneHarness.ts`: `stubPhone(initial?: { narrow?: boolean; coarse?: boolean }): { set(next: { narrow?: boolean; coarse?: boolean }): void }` (narrow is true by default; same `matchMedia` stub as `TouchMenus.test.tsx`), `fakeVisualViewport(initial: { height: number; offsetTop?: number; innerHeight?: number }): { set(next: { height?: number; offsetTop?: number }): void }` (stubs `window.visualViewport` and `innerHeight`, and fires `resize` and `scroll`), `withEveryKind(state)` (copy of the helper in `ChatFilter.test.tsx`) and `withGroup(state)` (the group "Tower team" of Hala, Faisal and Reem, as in `InboxScreen.test.tsx`).

- [ ] **Step 1: Write the failing test.** In `chatBack.test.tsx` (all phone tests; `renderApp` returns `router`):
```tsx
it('passes state.from when a row opens a chat', async () => {
  stubPhone();
  const { router } = await renderApp('/inbox');
  await userEvent.click(await rowLink(/Corniche Office Tower/));
  expect(router.state.location.state).toEqual({ from: '/inbox' });
});
it('goes back one step when the opener passed state.from', async () => {
  // open a row, click link "Back to chats"
  expect(router.state.historyAction).toBe('POP');
  expect(router.state.location.pathname).toBe('/inbox');
});
it('goes to /inbox as a new step when no opener passed state', async () => {
  // renderApp('/inbox/cnv_001'), click "Back to chats"
  expect(router.state.historyAction).toBe('PUSH');
  expect(router.state.location.pathname).toBe('/inbox');
});
it('does not leave the app: state.from with history idx 0 goes to /inbox', async () => {
  // vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx: 0 }) after the row click
  expect(router.state.historyAction).toBe('PUSH');
});
it('ignores a second Back press while the first step runs', async () => {
  const navigate = vi.spyOn(router, 'navigate');
  fireEvent.click(back); fireEvent.click(back);
  expect(navigate).toHaveBeenCalledTimes(1);
});
it('leaves a Ctrl click on the link to the browser', ...) // no preventDefault, router.navigate not called
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/chatBack.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it cannot import `chatBack`.
- [ ] **Step 3: Implement.** `canGoBack` is true when `location.state.from` is a string and `window.history.state?.idx` is above 0 (read it in a `try`). `goBack` runs `navigate(-1)` when `canGoBack`, else `navigate('/inbox')`. A ref `busy` blocks a second call. An effect on `location.key` clears it. `ChatBackLink` calls `preventDefault` and `goBack` for a plain left click only. Write `phoneHarness.ts` as the signatures above say.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Run `chatBack.test.tsx`, `InboxScreen.test.tsx` and `ChatFilter.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/inbox` then `git commit -m "Inbox: Back from a chat goes to the screen that opened it"`.

### Task I2: Kind chips and the chat list as a page

**Files:**
- Create: `src/features/inbox/chatKinds.ts` (moves `KINDS` and `ChatKind` out of `ChatList.tsx`)
- Create: `src/features/inbox/ChatKindChips.tsx`
- Create: `src/i18n/real/phoneinbox.en.json` and `phoneinbox.ar.json`
- Modify: `src/features/inbox/ChatList.tsx`, `src/features/inbox/InboxScreen.tsx`
- Test: `src/features/inbox/ChatKindChips.test.tsx`, `src/features/inbox/ChatListPhone.test.tsx`

**Interfaces:**
- Consumes: `usePersistentChoice('madar.chatKind', KINDS, 'all')` (still called in `ChatList`), `arrowStep` of `src/lib/keys.ts`, `stubPhone`, `withEveryKind`.
- Produces: `export const KINDS: readonly ['all', 'projects', 'todos', 'people']`, `export type ChatKind`, and `export function ChatKindChips(props: { kind: ChatKind; onChange: (kind: ChatKind) => void }): JSX.Element`.
- Words: `chatFilter.group` = "Kind of chat" / «نوع المحادثة».

- [ ] **Step 1: Write the failing test.**
```tsx
// ChatKindChips.test.tsx (render the part alone with initI18n)
it('is a radiogroup of four chips of 44 px that wrap', () => {
  const group = screen.getByRole('radiogroup', { name: 'Kind of chat' });
  expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All', 'Projects', 'To-dos', 'People']);
  expect(group).toHaveClass('flex-wrap');
  for (const chip of within(group).getAllByRole('radio')) expect(chip).toHaveClass('min-h-11');
});
it('marks the open chip with bg-card shadow-card text-ink and never with the signature look', ...);
it('moves the choice with the end-side arrow key, and with the other arrow in Arabic', ...);
// ChatListPhone.test.tsx (phone)
it('shows chips and no kind menu, and a chip filters the same list as the menu does', async () => {
  // click chip "Projects": Faisal link gone; localStorage['madar.chatKind'] === 'projects'; no button /^Show chats:/
});
it('keeps the menu and shows no chip on a desk', ...);
it('draws the search text at 16 px or more on a phone', () => expect(search.className).toContain('max(16px,var(--text-subheadline))'));
it('puts "Archived (n)" as the last row of the panel, and first under the search on a desk', ...);
it('draws no panel around the aside and no inner scroll or fixed height', () => {
  expect(list).toHaveClass('panel', 'hairline'); expect(list).not.toHaveClass('overflow-y-auto');
  expect(list.closest('aside')).not.toHaveClass('panel');
});
it('lets a row swipe sideways and the page scroll up and down', () => expect(row).toHaveStyle('touch-action: pan-y'));
it('shows "No chats here." for an empty chip', ...);
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/ChatKindChips.test.tsx src/features/inbox/ChatListPhone.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the module is absent and no chip shows.
- [ ] **Step 3: Implement.** In `ChatList.tsx` read `const phone = useIsPhone()`. On a phone draw `ChatKindChips` in place of the `Menu`, with `kind` and `setKind` from the hook of today, so one state serves both. Give the search field `text-[max(16px,var(--text-subheadline))]` on a phone. Draw the search and the chips with no `p-3` box, then one `ul` with the classes `panel hairline overflow-hidden`. Put the "Archived (n)" button in a last `li` of that `ul`, with a chevron that keeps `rtl:-scale-x-100`. The desk keeps its code. In `InboxScreen.tsx` the phone `aside` has no `panel` class, and the wrapper has no fixed height. Each chip is a `button role="radio"` with one tab stop that moves with the choice (`tabIndex` 0 or -1) and `.pressable`. Append the key pair to the new word files.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `ChatFilter.test.tsx`, `ChatListTyping.test.tsx`, `ChatListStage.test.tsx`, `TouchMenus.test.tsx` and `src/i18n/keys.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: four kind chips and a page list on a phone"`.

### Task I3: InboxViews, the switch with two counts

**Files:**
- Create: `src/features/inbox/InboxViews.tsx`
- Modify: `src/features/inbox/InboxScreen.tsx` (on a phone: `ScreenTitle` "Inbox", then `InboxViews`; the main button "New message" stays in the title)
- Modify: `src/features/notifications/NotificationsScreen.tsx` (on a phone: `ScreenTitle` "Inbox" with no action, then `InboxViews`)
- Modify: `src/i18n/real/phoneinbox.en.json`, `phoneinbox.ar.json`
- Test: `src/features/inbox/InboxViews.test.tsx`

**Interfaces:**
- Consumes: `SegmentedControl` with `fill`, `layoutId`, `onOptionPointerDown` (contract); `usePressReads()` of `app/pressReads.ts` (`PRESS_READS` already holds `/inbox` and `/notifications`); `chats.unreadCount`, `notifications.count`.
- Needs a contract addition (see the report): each `SegmentedControl` option takes `count?: number` and `countLabel?: string`. The control draws the red `Badge` after the label when `count > 0`, and puts `countLabel` in the name of the radio.
- Produces: `export function InboxViews(): JSX.Element`. It takes no prop. It reads the address: `/notifications` is Notifications, any other address is Chats. A press calls `navigate('/inbox')` or `navigate('/notifications')`. The second label is the word `screens.notifications`.
- Words: `inbox.view.label` = "Inbox view" / «عرض الوارد»; `inbox.view.chats` = "Chats" / «المحادثات».

- [ ] **Step 1: Write the failing test.**
```tsx
it('shows h1 "Inbox" and a radiogroup "Inbox view" with Chats (checked) and Notifications on /inbox', ...);
it('shows the same title and switch on /notifications, with Notifications checked', ...);
it('gives each segment its own count: unread chats and notices that need action', async () => {
  // plant 2 unread chats and 1 review notice; expect within(chats radio) text 'Unread messages: N' and within(notifications radio) '1 item needs action'
});
it('shows 99+ for a count above 99 and keeps the two segments the same width class', ...); // review candidate
it('shows no number for a count of 0', ...);
it('navigates on a press and starts the read on pointer down', async () => {
  // vi.mock('../../app/pressReads') with a spy; pointerDown on Notifications -> spy('/notifications'); click -> pathname '/notifications'
});
it('shows New message on Chats only, and with one right of two the sheet opens in the mode that is left', async () => {
  // as(MEMBER, without('chat.direct')): sheet title 'New group'
});
it('keeps h1 "Notifications" and no switch on a desk', ...);
it('names the segments in Arabic: «المحادثات» and «الإشعارات»', ...);
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/InboxViews.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no radiogroup.
- [ ] **Step 3: Implement.** Build `InboxViews` as `<SegmentedControl fill layoutId="inbox-views" label={t('inbox.view.label')} .../>`. Use `nav.inboxUnread` and `nav.inboxBadge` for the two `countLabel` values. Both screens draw it in the same place under the title. Do not add a second pill component. If the slide across the two screens does not play, say so in the report (design risk).
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `InboxScreen.test.tsx`, `NotificationsScreen.test.tsx`, `src/features/rr2Global.test.tsx` and `src/i18n/keys.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: one switch for Chats and Notifications with two counts"`.

### Task I4: Notifications on a phone

**Files:**
- Modify: `src/features/notifications/NotificationsScreen.tsx`
- Test: `src/features/notifications/NotificationsPhone.test.tsx`

**Interfaces:**
- Consumes: `useIsPhone`, `chatState` of Task I1, `InboxViews` of Task I3.
- Produces: no new export.

- [ ] **Step 1: Write the failing test.** The helpers `withNotices` and `notice` come from `NotificationsScreen.test.tsx`; copy them.
```tsx
it('puts Mark all read at the end of the heading line of the first day, only while one notice is unread', async () => {
  // within(first section).getByRole('button', { name: 'Mark all read' }); no such button in the title area
  // after a press: the toast 'Marked 2 notifications as read.' with Undo, and the button is gone
});
it('puts Approve under the meta line, aligned with the text, with its aria-label', async () => {
  // approve = getByRole('button', { name: 'Approve “Civil Defense drawings”' })
  // expect(approve).toHaveClass('min-h-11'); expect(li.firstElementChild.contains(approve)).toBe(false)  // never inside the link
  // approve wrapper has class ps-[5.375rem]; the Link comes before it in the DOM
});
it('approves in place, shows the toast Approved with Undo, and Undo restores the unread mark', ...);
it('passes state.from "/notifications" when a notice opens a chat', async () => {
  // press a mention notice: router.state.location.state toEqual({ from: '/notifications' })
});
it('keeps the swipe that marks a row read', ...);
it('keeps the title action and the Approve button at the end of the row on a desk', ...);
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/notifications/NotificationsPhone.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: "Mark all read" is in the title, and Approve is beside the row.
- [ ] **Step 3: Implement.** On a phone the `li` becomes a column: the row link, then a wrapper with `ps-[5.375rem] pb-3` (16 px edge, 10 px dot, 36 px face, two gaps of 12 px) that holds the Approve `Button`. The button keeps its handler, its `aria-label` and `disabled`. "Mark all read" moves into the `h2` line of the first day group as `Button variant="plain"` (44 px), with the same handler and the same `cleared` list. Every `Link` gets `state={chatState('/notifications')}`. Desk code stays.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `NotificationsScreen.test.tsx`, `NoticeRenders.test.tsx`, `AdminCopies.test.tsx`, `GroupNotices.test.tsx`, `ReplyNotices.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Notifications: Mark all read and Approve move in place on a phone"`.

### Task I5: The chat as a full-screen page

**Files:**
- Create: `src/features/inbox/PhoneChatPage.tsx`
- Modify: `src/features/inbox/InboxScreen.tsx` (phone branch), `src/features/inbox/ConversationPane.tsx` (`PhoneBackBar` for the load, error and not found states)
- Test: `src/features/inbox/PhoneChatPage.test.tsx`

**Interfaces:**
- Consumes: `useVisualViewport(): { height: number; offsetTop: number } | null` and `useKeyboardOpen()` (contract); `useSheetToasts(true)` of `app/toasts.tsx`; `spring.standard`; `ChatBackLink` (I1); `fakeVisualViewport` (I1).
- Produces:
  - `export function PhoneChatPage(props: { conversationId: string; children: ReactNode }): ReactPortal`.
  - The root has `data-chat-page`, the classes `fixed inset-x-0 z-30 flex flex-col overflow-hidden overscroll-none bg-bg text-ink`, and the style `top: offsetTop`, `height: viewport.height`, `--chat-h: <height>px`. With no `visualViewport` the height is `100dvh` and `--chat-h` is `100dvh`.
  - `function PhoneBackBar()` (private, in `ConversationPane.tsx`): a `header` of 56 px plus the top safe area with only the `ChatBackLink`.

- [ ] **Step 1: Write the failing test.**
```tsx
it('draws the chat in a portal on the body, outside .app-page, below the sheets', async () => {
  stubPhone(); await renderApp('/inbox'); await userEvent.click(await rowLink(/Corniche Office Tower/));
  const root = document.querySelector('[data-chat-page]')!;
  expect(root.parentElement).toBe(document.body); expect(root.closest('.app-page')).toBeNull();
  expect(root).toHaveClass('fixed', 'z-30', 'overscroll-none');
});
it('follows the visual viewport, and falls back to 100dvh', ...);   // fakeVisualViewport({height: 500, offsetTop: 20}): style height '500px', top '20px'; set({height: 300}) -> '300px' and --chat-h
it('keeps the same root when ?at= changes, so the entrance does not play again', async () => {
  const root = document.querySelector('[data-chat-page]'); await router.navigate('/inbox/cnv_001?at=msg_001');
  expect(document.querySelector('[data-chat-page]')).toBe(root);
});
it('hides the list and the title while a chat is open, and shows them on Back', ...);   // list not in the accessibility tree
it('shows no "Pick a chat" text on a phone', ...);
it('moves the toast lane to the top while the chat page is open', () => expect(document.querySelector('[data-toasts]')!.className).toContain('max-sm:top-'));
it('takes the page out of reach of a screen reader while a sheet is open over it', async () => {
  // long press a message -> sheet; expect(root.inert).toBe(true); close -> false
});
it('shows no tab bar and no top row on the chat page', () => expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull());   // Track S rule
it('carries the Back link in the load, error and not found states', async () => {
  // latencyMs 200 -> link 'Back to chats' before the data; failFirst 'chats.messages' -> LoadFailed and the link; '/inbox/xyz_1' -> not found text and the link
});
it('draws the pane inside the panel on a desk and no portal', ...);
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/PhoneChatPage.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no `[data-chat-page]`.
- [ ] **Step 3: Implement.** In `InboxScreen.tsx` read `useIsPhone()` after all hooks. On a phone render: a wrapper `div hidden={open}` that holds the title, `InboxViews`, and the `aside` with the list (the list stays mounted, so its search text stays); then `{open && <PhoneChatPage conversationId={...}><ConversationPane .../></PhoneChatPage>}`; then `NewMessage`. The root is a `motion.div` keyed by `conversationId` only, with `initial={{ opacity: 0, x: rtl ? -48 : 48 }}`, `animate={{ opacity: 1, x: 0 }}` and `transition={spring.standard}` (the `MotionConfig` of the app keeps opacity for reduced motion). The part calls `useSheetToasts(true)`. A local hook sets `root.inert` from the attribute `data-panel-open` of `<html>` with a `MutationObserver` (`usePanelOpen` inerts only `.app-page`), and clears it on unmount. The Back bar shows in `ChatPane`, `TaskPane` and `ConversationPane` for the three states, on a phone only.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `InboxScreen.test.tsx`, `ConversationPane.test.tsx`, `OpenAtMessage.test.tsx`, `ComposerKeys.test.tsx`, `TouchMenus.test.tsx`, `ReactionAny.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: an open chat is a full-screen page on a phone"`.

### Task I6: The chat header for the four kinds

**Files:**
- Create: `src/features/inbox/ChatHeader.tsx`
- Modify: `src/features/inbox/ConversationPane.tsx` (`ChatPane` and `TaskPane` use `ChatHeader` on a phone; `Header` stays for a desk)
- Modify: `src/features/inbox/ChatTitle.test.tsx` (add the phone twin of the to-do test)
- Modify: `src/i18n/real/phoneinbox.en.json`, `phoneinbox.ar.json`
- Test: `src/features/inbox/ChatHeader.test.tsx`

**Interfaces:**
- Consumes: `ChatBackLink` (I1), `PhoneChatPage` (I5), `usePersonState`, `GroupPicture`, `PersonFace`, `ProjectTile`, `SearchIcon`.
- Produces: `export function ChatHeader(props: { lead: ReactNode; title: string; subtitle: ReactNode; action: ReactNode }): JSX.Element`. It is a `header` of `h-[calc(56px+env(safe-area-inset-top))]` with `pt-[env(safe-area-inset-top)]` and a hairline under it. The order is: `ChatBackLink`, `lead` (38 px), the title block (`h2` with `<bdi class="block truncate">`, then the subtitle), a `Link` to `/search?in=messages` named `chat.searchMessages` (44 px), then `action`.
- Words: `chat.searchMessages` = "Search messages" / «ابحث في الرسائل».

- [ ] **Step 1: Write the failing test.**
```tsx
it('shows back, picture of 38 px, one title line, state line, Search and options for a direct chat', async () => {
  // fakeLive({ usr_002: 'online' }); header has 'Online'; link 'Search messages' href ends '/search?in=messages'; button 'Options for Faisal Al-Harbi'
  // header.className contains 'h-[calc(56px+env(safe-area-inset-top))]'
});
it('shows "Project chat" with the project tile for a project chat', ...);
it('shows the group picture as a button and "3 people" as a button for a group', ...);
it('shows "To-do thread · Corniche Office Tower" or "Office", one title line and no Open to-do link in the header', async () => {
  expect(cutter(heading)).toHaveClass('block', 'truncate'); expect(within(header).queryByRole('link', { name: 'Open to-do' })).toBeNull();
});
it('keeps a long mixed-direction title on one line and the title block shrinkable', async () => {
  // 70-character English name in an Arabic screen: bdi has 'block truncate'; its parent has 'min-w-0 flex-1'   (review candidate)
});
it('opens the Search screen on its Messages group from the icon', () => expect(router.state.location.search).toBe('?in=messages'));
it('keeps the Back rule of Task I1', ...);
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/ChatHeader.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no Search link in the header.
- [ ] **Step 3: Implement.** On a phone `ChatPane` and `TaskPane` build `ChatHeader`. For now `action` is the old menu (`ChatMenu` or `GroupMenu`), and the group picture and the count button still call `setSheet('people')`; Task I7 replaces both. The task thread passes no `lead`. Keep the `header` element and the `h2` so the old presence tests still find them.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `ChatTitle.test.tsx`, `PresenceMenu.test.tsx`, `ChatFaces.test.tsx`, `ConversationPane.test.tsx`, `src/i18n/keys.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: a chat header of 56 px with Search and options"`.

### Task I7: One options sheet for every chat kind

**Files:**
- Create: `src/features/inbox/ChatOptionsSheet.tsx`, `src/features/inbox/PeopleRows.tsx`
- Modify: `src/features/inbox/GroupSheets.tsx` (the People rows move to `PeopleRows`; the desk `PeopleSheet` uses it), `src/features/inbox/ConversationPane.tsx`, `src/features/inbox/ChatList.tsx` (`chatMenuItems` takes an optional `first` item), `src/features/inbox/archive.ts`, `src/features/inbox/markUnread.ts`, `src/features/inbox/chatBack.tsx` (add `useLeaveChat`)
- Modify: `src/i18n/real/phoneinbox.en.json`, `phoneinbox.ar.json`
- Test: `src/features/inbox/ChatOptionsSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet` with `phoneHeader` (contract), `useNotifyItems`, `chatMenuItems`, `usePersonState`, `useMyState`, `useRight('chat.groupChange' | 'chat.direct')`, `chats.openDirect`, `chatState`, `taskLink`.
- Produces:
  - `export function ChatOptionsSheet(props: { open: boolean; onOpenChange: (open: boolean) => void; id: string; kind: 'project' | 'direct' | 'group' | 'task'; title: string; lead: ReactNode; line: ReactNode; archived: boolean; unread: number; link?: { to: string; label: string }; notify?: NotifyLevel; group?: { people: UserCard[]; me: Me | undefined; makerId: string | null; name: string; onMode: (mode: 'add' | 'rename' | 'leave') => void }; onArchive: (id: string, archived: boolean) => void; onMarkUnread: (id: string) => void }): JSX.Element`. The dialog name is `chat.optionsFor`.
  - `export function OptionsButton(props: { title: string; onClick: () => void }): JSX.Element` (the "..." button of the header, 44 px, name `chat.optionsFor`, `ellipsis` icon).
  - `export function PeopleRows(props: { id: string; people: UserCard[]; me: Me | undefined; makerId: string | null; rich?: boolean }): JSX.Element`. With `rich` each row adds the presence word and a Message button.
  - `export function useLeaveChat(): () => void`. On a phone it runs `goBack()`. On a desk it runs `navigate('/inbox')`.
  - Sheet order: header (picture, name, line), People part (group), Add people and Rename (group, with `chat.groupChange`), the link row ("Open the project" or "Open to-do"), the Notify me radios with the note (not for a to-do thread), Mark as unread (only when `chatMenuItems` offers it), Archive or Move back, Leave group (group, last, destructive look).
- Words: `chat.openProject` = "Open the project" / «افتح المشروع»; `chat.messagePerson` = "Message {{name}}" / «أرسل رسالة إلى {{name}}». The visible label of the person button is the old key `person.message`.

- [ ] **Step 1: Write the failing test.** Phone, `fakeLive({ usr_002: 'online', usr_003: 'away' })`, `withGroup`.
```tsx
it('opens one dialog "Options for Tower team" with the people, then the rows in the order of the design', async () => {
  // rows.map(textContent) ends with 'Leave group'; Leave group has class text-late; heading 'People in the group'
  // 'Hala Nasser' note 'You · Group maker'; 'Faisal Al-Harbi' 'Online'; 'Reem Al-Ghamdi' 'Away'
});
it('adds a Message button to each other person and none to the own row, and starts the direct chat with state.from', ...);
it('hides the Message buttons without chat.direct, and Add people and Rename without chat.groupChange', ...);
it('shows Remove only to the maker, with the toast and Undo of today', ...);
it('shows "Away (set by you)" on the own row when the person chose Away', ...);
it('opens the Rename sheet only after this sheet closed', async () => {
  await userEvent.click(rename); await screen.findByRole('dialog', { name: 'Rename the group' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});
it('shows Open the project first for a project chat, and Open to-do for a to-do thread, with no Notify me for the thread', ...);
it('checks the radio of the saved level, and a pick saves the other level', ...);
it('archives from the sheet: the toast, the chat page closes by Back (POP), the list shows', ...);
it('keeps the chat open after Move back to Inbox', ...);
it('marks as unread from the sheet: the toast with Undo and the chat page closes', ...);
it('leaves the group: the confirm opens after the sheet, the leave goes back one step', ...);
it('opens the sheet from the picture and from the count button of a group', ...);
it('keeps the anchored menu and the People sheet on a desk', ...);
it('reads in Arabic with the female forms of the presence words', ...);
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/ChatOptionsSheet.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: no dialog "Options for".
- [ ] **Step 3: Implement.** On a phone `ChatPane` and `TaskPane` hold `options: boolean`; `OptionsButton`, the group picture and the count button set it. The sheet uses `phoneHeader` and a real title `chat.optionsFor`. A row is a `button` of at least 44 px (`min-h-14`, as `MessageSheet`). Icons are `plus` (Add people), `square-pen` (Rename), `folder-kanban` (Open the project), `clipboard-check` (Open to-do), played with `playWhen={open}`. The Notify me rows are `role="radio"` in a `radiogroup` from `useNotifyItems`. The presence word shows only when `useRuntime().live` is set, as `PersonMenu` does; an agent gets no Message button. Group sub-sheets wait one frame, as `MessageSheet` does:
```ts
const [next, setNext] = useState<'add' | 'rename' | 'leave' | null>(null);
const pick = (mode) => { setNext(mode); onOpenChange(false); };
useEffect(() => {
  if (open || next === null) return undefined;
  const frame = requestAnimationFrame(() => { group.onMode(next); setNext(null); });
  return () => cancelAnimationFrame(frame);
}, [open, next]);
```
`useArchive` calls `leave()` when `archived` is true, the chat is the open one (`useParams`) and the screen is a phone. `useMarkUnread` calls `useLeaveChat()` in place of `navigate('/inbox')`. `LeaveSheet` calls it after the leave. `PeopleRows` keeps the remove-and-Undo code of today; the desk `PeopleSheet` calls it with no `rich`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `InboxScreen.test.tsx`, `ChatTitle.test.tsx`, `NotifyChoice.test.tsx`, `PresenceMenu.test.tsx`, `src/features/rr2Global.test.tsx`, `src/i18n/keys.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: one options sheet for every kind of chat on a phone"`.

### Task I8: The docked composer, the log and the edit form

**Files:**
- Modify: `src/features/inbox/Composer.tsx`, `src/features/inbox/MessageEditForm.tsx`, `src/features/inbox/MessageLog.tsx`, `src/features/inbox/ConversationPane.tsx`, `src/features/inbox/outbox.ts`
- Modify: `src/components/MentionField.tsx` (new prop `listMaxHeight?: string`, applied as `style.maxHeight` and `overflow-y-auto` on the list)
- Modify: `src/features/files/Attachments.tsx` (`FileChip` uses `max-sm:min-h-11` for the file and for the removed chip)
- Test: `src/features/inbox/ChatPhoneComposer.test.tsx`, `src/features/inbox/MessageLog.keyboard.test.tsx`, `src/features/inbox/outbox.test.ts`, `src/components/MentionField.test.tsx`, `src/features/files/FileChip.test.tsx`

**Interfaces:**
- Consumes: `isPhoneNow()`, `useKeyboardOpen()`, `readDraft`, `writeDraft`, `useDraftOwner` of `app/drafts.ts`, `plainText` of `lib/text.ts`, `fakeVisualViewport`.
- Produces: `export function keepAsDraft(owner: string, key: string, body: string): void` in `outbox.ts`. Rule: an empty `body` does nothing; no draft writes `plainText(body)`; a draft that exists writes `` `${plainText(body)}\n${draft}` ``.

- [ ] **Step 1: Write the failing test.**
```tsx
it('does not focus the field when a chat opens on a phone, and focuses it on a desk', ...);
it('focuses the field after a press on Reply', ...);
it('docks the form with the safe area below, and with 0.5rem when the keyboard is open', async () => {
  // fakeVisualViewport({ height: 800 }) -> form class contains 'pb-[max(env(safe-area-inset-bottom),0.5rem)]'
  // set({ height: 450 }) (innerHeight 800) -> class contains 'pb-2'
});
it('limits the field to 40 percent of the visible height', () => expect(textarea.className).toContain('--chat-h'));   // review candidate: landscape
it('gives the @ list a max height that stops under the header', () => expect(listbox).toHaveStyle({ maxHeight: expect.stringContaining('--chat-h') }));
it('adds a line with Enter in the edit form on a phone, and saves with the Save button', ...);
it('does not focus the composer after Save or Cancel of an edit on a phone', ...);
it('keeps the closed-chat note above the safe area', ...);
it('keeps the bottom in view when the log shrinks for the keyboard', async () => {
  // as MessageLog.stick.test.tsx, but the watch target is the role="log" region; at bottom -> scrollTop === scrollHeight; reader of old messages stays
});
it('writes the words of a failed message into the draft when Back closes the chat', async () => {
  // failFirst 'chats.send'; send 'Ok then'; wait for 'Not sent'; click Back; readDraft(owner, `chat:${id}`) === 'Ok then'
});
it('writes the words into the draft when the failure comes after Back', async () => {
  // latencyMs 80 + failFirst; send; click Back at once; wait; the draft holds the words
});
it('keeps the same two rules for a to-do thread (draft key task:<id>)', ...);
it('does not write a draft on a desk', ...);
// outbox.test.ts: keepAsDraft cases (empty body, no draft, old draft)
// MentionField.test.tsx: listMaxHeight sets the style; absent prop sets none
// FileChip.test.tsx: file chip and removed chip have 'max-sm:min-h-11'
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/ChatPhoneComposer.test.tsx src/features/inbox/MessageLog.keyboard.test.tsx src/features/inbox/outbox.test.ts src/components/MentionField.test.tsx src/features/files/FileChip.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the field has the focus; no `keepAsDraft`.
- [ ] **Step 3: Implement.** `Composer`: the effect keyed by `id` focuses only when `!isPhoneNow()`. The form class on a phone is `pb-[max(env(safe-area-inset-bottom),0.5rem)]`, or `pb-2` when `useKeyboardOpen()` is true. The textarea max height on a phone is `max-sm:[&_textarea]:max-h-[min(9rem,calc(var(--chat-h,100dvh)*0.4))]`. `MentionField` gets `listMaxHeight` from `Composer` as `min(14.5rem,calc(var(--chat-h,100dvh) - 9rem))`. `MessageEditForm`: on a phone a plain Enter adds a line (read `useIsPhone()`). The `endEdit` of `ChatPane` and `TaskPane` skips the focus call when `isPhoneNow()`. `MessageLog`: the `ResizeObserver` also observes the `role="log"` region, so a reader at the bottom stays there. `ChatPane` and `TaskPane` keep the latest `outbox.unsent` in a ref. On a phone, an unmount cleanup calls `keepAsDraft` for each failed entry. When the pane is closed, the `onRefused` of the send also calls `keepAsDraft` with `input.body`. The draft key is `chat:<id>` or `task:<id>` (as `Composer` builds it).
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `ComposerKeys.test.tsx`, `ComposerEmoji.test.tsx`, `EditDelete.test.tsx`, `InstantSend.test.tsx`, `MessageLog.stick.test.tsx`, `MessageLog.focus.test.tsx`, `MessageLog.place.test.tsx`, `src/features/comments/` tests. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: a docked message box that follows the keyboard on a phone"`.

### Task I9: The message sheet, the emoji sheet and the picture viewer

**Files:**
- Modify: `src/features/inbox/MessageMenu.tsx` (new export `sheetHasRows`), `src/features/inbox/MessageBubble.tsx`
- Modify: `src/features/emoji/EmojiPanel.tsx`, `src/components/ImageViewer.tsx`
- Test: `src/features/inbox/MessageMenu.test.tsx` (extend), `src/features/emoji/EmojiPanel.test.tsx` (extend), `src/components/ImageViewer.test.tsx` (extend)

**Interfaces:**
- Consumes: `itemGroups`, `canCopy` (private, same file).
- Produces: `export function sheetHasRows(bubble: Bubble, actions: BubbleActions): boolean`. It is true when `actions.canReact`, or a Reply, Edit or Delete item shows, or `canCopy()` is true.

- [ ] **Step 1: Write the failing test.**
```tsx
it('has no rows for a reader who may not react, reply or edit, with no clipboard', () => expect(sheetHasRows(bubble, actions)).toBe(false));
it('does not open the sheet on a long press when it has no row', async () => {
  // phone, without('chat.direct'), navigator.clipboard undefined; long press -> queryByRole('dialog') is null
});
it('opens the sheet when only Copy text is possible', ...);
it('keeps the long press and the "..." button of a task comment as they are (inSheet)', ...);
// EmojiPanel: layout 'sheet' draws role="toolbar" after the scroll list; layout 'panel' draws it before; it is hidden while a search text is typed; a group button still scrolls to its group; the search field has no focus when a sheet opens
// ImageViewer: the dialog has the class 'pb-[env(safe-area-inset-bottom)]'; Close, Download and the side arrows are unchanged
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/inbox/MessageMenu.test.tsx src/features/emoji/EmojiPanel.test.tsx src/components/ImageViewer.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: the empty sheet opens; the toolbar is before the grid; no safe-area class.
- [ ] **Step 3: Implement.** `MessageBubble` passes `() => { if (actions && sheetHasRows(bubble, actions)) setSheet(true); }` to `useLongPress`. In `EmojiPanel`, for `layout === 'sheet'` move the toolbar `div` after the scroll `div`; the `panel` layout keeps its order. Add `pb-[env(safe-area-inset-bottom)]` to the `Drawer.Content` of `ImageViewer`.
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `EmojiStage.test.tsx`, `ReactionAny.test.tsx`, `TouchMenus.test.tsx`, `BubbleFileNames.test.tsx`, `ImageViewer.zoom.test.tsx`, `src/features/files/PictureAttachments.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Chat: no empty message sheet, emoji groups under the grid, viewer safe area"`.

### Task I10: Search on its Messages group, and the phone browser specs

**Files:**
- Modify: `src/features/search/SearchScreen.tsx`, `src/features/search/useQueryInLink.ts`, `src/features/search/MessageHits.tsx`, `src/features/search/PersonSheet.tsx`
- Create: `tests/e2e/inboxPhone.spec.ts`, `tests/e2e-deploy/inboxPhone.spec.ts`
- Test: `src/features/search/SearchScreen.test.tsx` (extend), `src/features/search/useQueryInLink.test.tsx` (extend), `src/features/search/MessageHits.test.tsx` (extend), `src/features/search/PersonMessage.test.tsx` (extend)

**Interfaces:**
- Consumes: `chatState` (I1), `chat.searchMessages` (I6), the link `/search?in=messages`.
- Produces: no export. The mark `in=messages` is a screen mark; it adds no call field.

- [ ] **Step 1: Write the failing test.**
```tsx
it('shows Messages first and no Commands for /search?in=messages', async () => {
  // type a word of a planted message; group headings: first 'Messages'; queryByText('Commands') is null
  // the input placeholder is 'Search messages'
});
it('keeps the other groups after Messages', ...);
it('shows Commands first and Messages last without the mark', ...);   // today's order
it('keeps other link values when it writes q', async () => {
  // /search?in=messages, type 'corniche' -> '/search?in=messages&q=corniche'; clear -> '/search?in=messages'
});
it('passes state.from "/search" when a hit opens a chat, and Back returns to the same search', ...);
it('passes state.from "/search" when the Message button of a person opens a chat', ...);
```
Browser specs at 390 px (EN), written for the lead's Playwright agent (Chromium and WebKit):
```ts
test('Back from a chat keeps the scroll place of the list', async ({ page }) => {
  // viewport 390x560; scrollTo(0, max); click the last visible chat link; click 'Back to chats'
  // await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0); skip when the page does not scroll
});
test('an open chat has no tab bar, and the box sits inside the screen', ...);   // nav 'Main navigation' not visible; composer box bottom <= innerHeight; Back shows the bar again
test('the Notifications segment opens the notices under the title Inbox', ...);
test('chips filter the list', ...);
test('chips, segments, Back, Search and options are 44 px or more', ...);       // boundingBox width and height >= 44
```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/search --no-file-parallelism --testTimeout=60000`. Expected: Commands show; `in` is lost when `q` is written.
- [ ] **Step 3: Implement.** `SearchScreen` reads `params.get('in') === 'messages'`. When true it hides the Commands group, renders `MessageHits` before the other groups (`Results` takes a `messagesFirst` prop) and uses `chat.searchMessages` as the placeholder. `useQueryInLink` copies the present params, then sets or deletes `q`. `MessageHits` and `PersonSheet` pass `{ state: chatState('/search') }`. Write both browser specs; the deploy twin uses `goto` and `urlPattern` like `tests/e2e-deploy/owner.spec.ts`. Check that they parse with `npx playwright test --list tests/e2e/inboxPhone.spec.ts`. The builder does not run a browser: the lead's Playwright agent runs both files and the screenshots (EN and AR, light and dark, 390 and 360 px, Chromium and WebKit).
- [ ] **Step 4: Run the tests and `npm run typecheck`.** Also run `ProjectKeyPlaces.test.tsx` and `SearchScreen.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Search: the Messages mark, and the opener state for a chat"`.

**Review focus candidates:**
- A person double-taps Back on the chat page (test in Task I1: one `navigate(-1)` only).
- A group name of 70 characters in an Arabic screen at 360 px, with three 44 px icons in the header (test in Task I6).
- The keyboard is open on a phone in landscape, so the visible height is about 200 px: the field, the @ list and the header must all fit (tests in Task I8 for `--chat-h` and `listMaxHeight`).
- A count above 99 in a segment, in two languages (test in Task I3).

# Direction D, the phone layout: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Owner method (2026-10-22): Opus 5.5 leads, one Sonnet 5.5 builder for each track, no separate checker agent, the full
> suite once in task L4.

**Goal:** On a phone (under 640 px), Madar gets four tabs with words (Today, Inbox, Work, Me), calm screens with one next
step, and a full-screen chat with every chat feature, while the desk stays exactly as it is.

**Architecture:** Every change sits behind `useIsPhone()` or the `max-sm:` classes. Wave 1 (track S) builds the phone shell
(tab bar, top row, routes, bar space) and the shared component props. Wave 2 (six tracks in parallel) builds the screens of
each tab against those names. Wave 3 (the lead) joins, checks and releases. No contract, server or MCP change.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Motion, vaul, dnd-kit, React Router, TanStack Query, i18next,
Vitest with jsdom, Playwright (Chromium and WebKit).

**Spec:** `docs/superpowers/specs/2026-10-22-madar-phone-d-design.md` (decisions; it wins) and
`docs/superpowers/specs/2026-10-22-madar-phone-d-areas.md` (the detail of each area). The approved mockups are on the canvas
https://claude.ai/artifact/AVpT8zSb2Lexjt7v3t2Cgg (top page, Direction D).

**Track files.** Each track has its own file in `docs/superpowers/plans/phone-d/`. A builder reads this file (all of it) and
its own track file.

| Wave | Track | File | Tasks | Branch |
| --- | --- | --- | --- | --- |
| 1 | S, Shell and shared parts | `phone-d/track-s.md` | S1 to S10 | `rb/phone-d-s` |
| 2 | W, Work | `phone-d/track-w.md` | W1 to W10 | `rb/phone-d-w` |
| 2 | T, Today | `phone-d/track-t.md` | T1 to T6 | `rb/phone-d-t` |
| 2 | P, A project | `phone-d/track-p.md` | P1 to P10 | `rb/phone-d-p` |
| 2 | K, A to-do | `phone-d/track-k.md` | K1 to K10 | `rb/phone-d-k` |
| 2 | I, Inbox and chat | `phone-d/track-i.md` | I1 to I10 | `rb/phone-d-i` |
| 2 | M, Me | `phone-d/track-m.md` | M1 to M9 | `rb/phone-d-m` |
| 3 | L, Join, checks, release | this file | L1 to L6 | `rb/phone-d` |

Each track branch starts from `rb/phone-d` after the join of the wave before it, in its own worktree
(`~/dev/madar-rb/phone-d-<key>`, `node_modules` linked). The builder runs `git merge --ff-only rb/phone-d` first.

## Review Focus

These five inputs will meet a person on a phone, and the track tests do not yet pin them. Each line names the task that adds
its test.

1. **The keyboard on Safari for iPhone, in a chat.** With the keyboard open, the composer, the @ list and the Newest button
   stay above the keyboard, and the tab bar stays hidden. Test in I5 with `fakeVisualViewport({ height: 420 })` over an
   `innerHeight` of 800: the chat root height follows 420 and the composer is the last child; L5 shoots it on WebKit.
2. **A phone turned sideways in the middle of work.** The viewport passes 640 px: the desk pill comes back, the chat page
   leaves its portal with the draft kept, and an open sheet stays usable. Tests: S4 (`usePhoneBarHide` turns `null` on
   `set(false)`), I5 (the draft of the chat stays in `app/drafts.ts` after `set(false)`), M2 (the unsaved-name case).
3. **A link with no list behind it.** A push line, a mail link or a bookmark opens `/inbox/:id`, `/projects/:id` or
   `/me/profile` directly. Back goes to the tab root (`/inbox`, the Projects view, `/me`) and never leaves Madar. Tests: I1
   (history index 0 gives `/inbox`), S5 (`backLinkOf` for the project page and `/me/profile`).
4. **A scroll that starts on a row.** On a touch phone a finger that moves more than 8 px within 400 ms scrolls the list and
   never lifts the row; a still finger for 400 ms lifts it. Test in W2: a `touchmove` of 12 px at 200 ms cancels the hold, and
   no reorder call goes out.
5. **Long Arabic words at 360 px.** The tab words, the three Work segments, the five project tabs and the Me rows never cut
   and never push a control under 44 px. Tests: W10 and P10 browser specs at 360 px in Arabic read `scrollWidth <= clientWidth`
   on each segment and tab; L5 shoots every board in Arabic at 360 px.

---

## Global Constraints

- Phone = viewport under 640 px: `useIsPhone()` (`src/app/useIsPhone.ts`, query `(max-width: 639px)`) or the `max-sm:` / `sm:` classes. From 640 px every screen stays exactly as on main `92c3b276` (the five-tab pill, the bell, the person menu, the word "Tasks").
- No change to `src/api/` contract files, `server/`, `supabase/`, MCP (`server/mcp/`) or any read or write input. The same screens run in the prototype (`VITE_MADAR_API=fake`) and the real build.
- Look: only the tokens of `src/design/tokens.css` and the components of `src/components/`. Navy (`signature`) only on the one main action of a screen, the open tab and the day ring. Red stays only where DESIGN.md puts it today (Late, errors, the count `Badge`, destructive buttons). No coloured icon tiles. A state is a shape plus an ink word.
- Motion: reuse `src/design/motion.ts` (`spring.standard`, `spring.expand`, `fade`), `AnimatedIcon`, the vaul `Sheet`, `.pressable`, `.screen-enter`. Every new motion has a reduced-motion rule (`MotionConfig reducedMotion="user"` covers Motion; CSS uses `motion-safe:` or the reduced-motion blocks of `tokens.css`).
- Touch targets at least 44 by 44 px. Heights in `dvh`, never `vh`. Safe areas with `env(safe-area-inset-*)`.
- Words: every new word has an English and an Arabic key in the track's own pair `src/i18n/real/phone<track>.en.json` and `.ar.json` (tracks: `phoneshell`, `phonework`, `phonetoday`, `phoneproject`, `phonetask`, `phoneinbox`, `phoneme`). ASD-STE100 English, Thmanyah-style Arabic, Western digits, no em-dash (a test refuses one in any UI word).
- Every screen mirrors in Arabic (logical classes only, `rtl:-scale-x-100` on arrows, `<bdi>` around names).
- Tests first for every change (owner rule). A builder runs `npm run typecheck` and the test files it touched, with `npx vitest run <files> --no-file-parallelism --testTimeout=60000`. The full suite runs once, in the join task.
- Commits: ASD-STE100 message, no `Co-Authored-By` line, no `Claude-Session` line. A track commits only on its own branch.
- Unit tests run in jsdom, which is not a phone. A phone test mocks `matchMedia` for `(max-width: 639px)` (see how `useIsPhone` tests do it) and, for touch, `(pointer: coarse)`.

## The shared interfaces (wave 1 builds them; wave 2 consumes them exactly)

Track S (Shell and shared parts) produces these. Wave 2 tracks use these names and do not edit these files.

### Hooks and helpers (`src/app/`)
- `useIsPhone.ts`: add `export function isPhoneNow(): boolean` (reads `window.matchMedia('(max-width: 639px)').matches`; `false` when `matchMedia` is absent).
- `useKeyboardOpen.ts` (new): `export function useKeyboardOpen(): boolean`. True when `window.visualViewport` exists and `window.innerHeight - visualViewport.height > 150`. False with no `visualViewport`.
- `useVisualViewport.ts` (new): `export function useVisualViewport(): { height: number; offsetTop: number } | null`. Follows `visualViewport` `resize` and `scroll`; `null` where the API is absent (callers then use `100dvh`).
- `nav.ts`: `export type PhoneTab = 'today' | 'inbox' | 'work' | 'me'`; `export const PHONE_NAV: { tab: PhoneTab; to: string; key: string; animated: AnimatedIconComponent }[]` (order Today, Inbox, Work, Me; word keys `phoneShell.tab.today|inbox|work|me`); `export function phoneTabOf(pathname: string): PhoneTab | null` with the map: Today `/`; Inbox `/inbox`, `/inbox/*`, `/notifications`; Work `/work`, `/meetings`, `/projects`, `/projects/*`; Me `/me`, `/me/*`, `/settings`, `/whats-new`, `/dashboard`, `/tasks`, `/admin`, `/admin/*`; else `null`.
- `lastList.ts`: `export function rememberWorkView(pathname: '/work' | '/meetings' | '/projects'): void` and `export function workTabLink(): string` (in memory for the visit; default `/work`). `WorkHeader` (track W) calls `rememberWorkView`.
- `phoneChat.ts` (new): `export const PHONE_CHAT = /^\/inbox\/[^/]+$/` and `export function isPhoneChatPath(pathname: string): boolean`.
- The shell sets `document.documentElement.dataset.barHidden = ''` while the phone tab bar hides (open chat on a phone, keyboard open, Focus mode), and removes it after.

### Tokens and classes (`src/design/tokens.css`)
- `--phone-bar: calc(64px + max(16px, env(safe-area-inset-bottom)))` on `:root`, and `:root[data-bar-hidden] { --phone-bar: 0px }`.
- The page uses `max-sm:pb-[calc(var(--phone-bar)+1.5rem)]` in place of `pb-32`. The toast lane on a phone uses `bottom-[calc(var(--phone-bar)+0.75rem)]`.

### Shared components (`src/components/`)
- `SegmentedControl`: add props `fill?: boolean` (full width, equal options, no wrap, 44 px high), `layoutId?: string` (with `fill`, a `motion.span` thumb with this `layoutId` and `spring.standard` slides to the chosen option; without `fill` the control is unchanged), `onOptionPointerDown?: (value: T) => void`. Existing callers do not change.
- `Tabs`: add props `spread?: boolean` (equal columns, no side scroll, `text-caption`, a word may wrap to two lines) and `variant?: 'underline' | 'pill'` (default `'underline'`; `'pill'` = grey 44 px pill with a white thumb that slides with the existing `layoutId` spring). Roles, arrow keys and links stay.
- `Sheet`: add props `tall?: boolean` (on a phone the sheet takes the full free height) and `phoneHeader?: ReactNode` (on a phone it replaces the visible title row; the real title stays `sr-only` with `data-sheet-title` and `tabIndex={-1}`). Desk unchanged.
- `SheetOrPopover.tsx` (new): `export function SheetOrPopover(props: { open: boolean; onOpenChange: (open: boolean) => void; anchor: HTMLElement | null; title: string; children: ReactNode })`. `Popover` on a desk, `Sheet` on a phone, same children.
- `Menu`: add prop `sheetOnPhone?: boolean`. On a phone the items render as a bottom sheet of 44 px rows with the same handlers. Desk unchanged.

### Shell parts
- `TabPill` returns the new `PhoneTabBar` (`src/app/PhoneTabBar.tsx`) when `useIsPhone()` is true. `PhoneTabBar` keeps `data-pill`, `aria-label` `nav.main`, `layoutId="pill-active"`, the Inbox `Badge` with the sum `chats.unreadCount.unread + notifications.count.badge`, and the Work link `workTabLink()`.
- Routes: `/me` (screen `me`) and `/me/:section` (screen `meSection`) inside the shell, with stub screens `src/features/me/MeScreen.tsx` and `src/features/me/MeSectionScreen.tsx` that track M replaces. Loaders in both `screenLoaders.ts` and `screenLoaders.static.ts`.
- `screenKey` on a phone also joins `/projects` and `/meetings` to `/work`, and `/notifications` to `/inbox`. `tabOf` uses the phone index (Today 0, Inbox 1, Work 2, Me 3) on a phone.
- The phone top row: the mark, or the back link of the table in the Shell area section, and `SearchButton`. No bell, no `PersonMenu` on a phone.
- On a phone, `AppShell` hides the top row and the tab bar on `isPhoneChatPath(pathname)`.
- `pressReads.ts`: the phone tabs start the reads of their target (Inbox `chats.list`; Work the read of `workTabLink()`, with a `/work` entry for its list).

## Lead amendments (they win over any task text below)

The seven track parts were written in parallel. These answers join them. A builder reads this section before its own track.

1. **One phone test helper.** `src/test/phoneMedia.ts` of task S1 is the only phone media helper. S1 gives it this shape:
   `phoneMedia(initial: boolean | { phone: boolean; coarse?: boolean }): { set(phone: boolean): void; setCoarse(coarse: boolean): void }`
   (it answers `(max-width: 639px)` and `(pointer: coarse)`, calls the `change` listeners, restores `matchMedia` in
   `onTestFinished`), plus `fakeVisualViewport()`. Where a task creates its own helper (W1 phone helper, K `phoneViewport`,
   P `src/features/project/phoneTest.ts`, T `testPhone.ts`, M `src/test/mePhone.ts`), use `phoneMedia` instead and do not
   create the file. Task-local render helpers (K `renderPanel.tsx`) stay.
2. **The Settings and Me redirects live in `routes.tsx` (task S7).** Task M3 does not add a redirect to `SettingsScreen`,
   `MeScreen` or `MeSectionScreen`, and drops its redirect tests (S7 holds them). M3 keeps the hub title, `DeskSettings` (the
   old body under its own name, if M still needs it) and `PrototypeTools`. The section id of Google Calendar is `calendar`.
3. **The press reads of the Me tab are task S3** (`PRESS_READS['/me']`: `settings.get`, and `google.status` in the real build).
   Task M5 does not create `meReads.ts`; the Me hub calls `usePressReads()('/me')` where it needs the reads early.
4. **The shared read inputs are task S3**: `MINE_OPEN`, `REVIEW_FOR_ME` in `src/features/work/readInputs.ts` and
   `meetingsListInput(today)` in `src/features/meetings/readInputs.ts`. Task W7 imports `meetingsListInput` and does not add it.
   W7 keeps its `usePrefetchCall` of the Meetings reads only if S3 has not landed (it has, in wave 1): use
   `usePressReads()('/meetings')`.
5. **`TaskPeople.tsx` is track W.** Task W3 also swaps its `Popover` for `SheetOrPopover` (S9), as the project area asks.
   Track P does not edit `TaskPeople.tsx`.
6. **The opener state of a chat is `state: { from: string }`**, where `from` is the `pathname + search` of the screen that
   opens `/inbox/:id`. Track I reads it (I1). Senders: track I (chat list, New message, Notifications, Search), track P
   (`ProjectHeader` Project chat link, `ShareFileSheet`), track K (any link from the task panel to a chat), track T (any Today
   link to a chat). A link with no state makes Back go to `/inbox`.
7. **`SegmentedControl` options gain `count?: number` and `countLabel?: string`** (task S8): the red `Badge` after the label
   when `count > 0`, and `countLabel` joins the accessible name of the radio. Track I uses it for the two Inbox counts.
8. **`Sheet` `phoneHeader` replaces the title text only** (task S9). The `headerAction` (the Focus pill) and the Close button
   stay in the same row on a phone. Task K3 builds on this. S9 changes its test "replaces the title row by phoneHeader" to
   check that the Close button and `headerAction` still show.
9. **Files outside the ownership table, granted:** track K may edit `src/components/DateDraftField.tsx` and
   `src/components/DateField.tsx` (optional `align` and `touchClear`), and create `src/lib/fileSize.ts`; track I may edit
   `src/components/MentionField.tsx` (optional `listMaxHeight`) and `src/features/files/Attachments.tsx` (FileChip
   `max-sm:min-h-11`); track M may edit `src/components/PictureFrame.tsx` (`data-vaul-no-drag`) and `src/components/Switch.tsx`
   (an additive `SwitchButton` export). Each change is additive, and the desk does not change.
10. **Track K keeps the exports** `ProjectTaskSheet` (props `projectId`, `taskId`, `onClose`) and `taskPanelReads` in
    `TaskSheet.tsx`, and the signature of `PreviewSheet`. Its split into `TaskParts.tsx` and `DeskBody.tsx` is allowed.
11. **`MessageEditForm.tsx` is track I.** On a phone Enter adds a line, in the chat and in the task Conversation. Track K does
    not edit it.
12. **In the task Conversation view the next step button is secondary** (`demote`), so Send is the one navy button there.
13. **The first-load limit is the one in `scripts/check-bundles.ts`** (970,000 B raw, 296,000 B gzip on main `92c3b276`), not
    the 1,350,000 B of the design text. Task S10 and task L1 hold it.
14. **The keys of the shell words** are `phoneShell.tab.today|inbox|work|me`, `phoneShell.inboxBoth`,
    `phoneShell.searchAll`. The word "Best on a computer" is track M (`phoneMe.adminBest`).
15. **The lead does the docs and What's new.** No track edits `src/CLAUDE.md`, `DESIGN.md`, `src/design/CLAUDE.md` or the What's
    new entries. Each track writes its doc lines at the end of its report file; task L3 copies them.
16. **The skipped Home test** of task T3 ("shows the line after a finish made inside the opened to-do") turns live in task L2,
    after track K lands.
17. **Between wave 1 and wave 2 a phone has no person menu**, no bell, no Sign out and no Preview as. Wave 1 never ships alone.
    The deploy-suite helpers `signOut()` and `previewAs()` on a phone are track M.

---

## Track L: Join, checks and release (wave 3, lead, branch rb/phone-d)

**Owns:** the joins of the track branches into `rb/phone-d`, `src/features/whatsNew/entries.ts` and its words
(`phonejoin.en.json`, `phonejoin.ar.json`), `TASKS.md`, the release record lines. Fixes that a failed check needs go to the file
owner's track rules: the lead makes them on `rb/phone-d` and names the track in the commit.

### Task L1: Join wave 1

**Files:** none new. Branch `rb/phone-d-s` into `rb/phone-d`.

- [ ] **Step 1: Rebase `rb/phone-d-s` on `rb/phone-d` and fast-forward it in.**
  Run: `git -C ~/dev/madar-rb/phone-d merge --ff-only rb/phone-d-s`
  Expected: fast-forward, no merge commit.
- [ ] **Step 2: Run the gate for a shell change.**
  Run: `npm run typecheck && npx vitest run src/app src/components --no-file-parallelism --testTimeout=60000 && npm run build`
  Expected: all pass; `check-bundles` prints the first load under its limit (970,000 B raw, 296,000 B gzip on main `92c3b276`).
- [ ] **Step 3: Take the wave 1 screenshots** (Playwright agent, delegated): Today, Inbox, Work, Me stub at 390 px, EN and AR,
  light and dark; the tab bar with the keyboard open (WebKit). Expected: four tabs with words, one navy open tab, no bell, no
  picture.
- [ ] **Step 4: Start wave 2.** Each wave 2 builder branches from the new `rb/phone-d` (`git switch -c rb/phone-d-<key>`).

### Task L2: Join wave 2

- [ ] **Step 1: Join the six branches in this order: W, T, P, K, I, M.** For each: `git rebase rb/phone-d` on the track
  branch, then `git merge --ff-only`. W goes first because T and P use its press and hold.
- [ ] **Step 2: After each join run** `npm run typecheck` and the tests of the files that the join touched.
  Expected: PASS. A conflict in a shared file means a track broke its ownership: keep the owner's version and move the other
  change into the owner's file.
- [ ] **Step 3: Turn the skipped Home test live** (task T3: "shows the line after a finish made inside the opened to-do") after
  track K lands, and run it. Expected: PASS.
- [ ] **Step 4: Commit nothing else here** unless a step 2 fix was needed; such a fix has its own test first.

### Task L3: What's new

**Files:**
- Modify: `src/features/whatsNew/entries.ts`
- Create: `src/i18n/real/phonejoin.en.json`, `src/i18n/real/phonejoin.ar.json`
- Test: the What's new entry test that pins ids and words

- [ ] **Step 1: Write the failing test**: the newest entry has the id `2026-10-2x-90` (next free id of the day of the build),
  the title "Madar on the phone: four tabs" / «مدار على الجوال: أربعة تبويبات», and a body that names Today, Inbox, Work and Me.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Add the entry and its two words.** Body (English): "On a phone, Madar now has four tabs with words: Today,
  Inbox, Work and Me. Chats and notifications share the Inbox. Tasks, meetings and projects share Work. Your settings are in Me."
  Arabic in Thmanyah style with the same facts.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Copy the doc lines** that each track wrote at the end of its report file into `src/CLAUDE.md`, `DESIGN.md` and
  `src/design/CLAUDE.md` (lead amendment 15). Each wrong line of the old phone shell goes in the same commit.
- [ ] **Step 6: Commit.**

### Task L4: The full gate

- [ ] **Step 1:** `uptime` first; run the suites only when the load is low. Then, one at a time: `npm run typecheck`,
  `npm test`, `npm run build`, `npm run build:server`, `npm run build:remote -- test` (sandbox off).
  Expected: all pass. Write the counts in the commit message of L6.
- [ ] **Step 2:** Under the Docker lock (`scripts/dev/docker-lock.sh acquire phone-d`): `npx supabase start -x edge-runtime`,
  `npx supabase db reset`, `npm run test:db`, `npm run test:it`, then stop the stack and release the lock.
  Expected: no new failure (D has no server change, so a failure here is a flake or a wrong join).
- [ ] **Step 3:** The prototype smoke and the phone browser specs (Playwright, delegated): `tests/e2e/owner.spec.ts`,
  `shell.spec.ts`, `calm.spec.ts`, `work.spec.ts`, `projects.spec.ts`, `toastUndo.spec.ts`, `full.spec.ts`.
  Expected: all pass with the four-tab phone.

### Task L5: Screenshots of every D screen

- [ ] **Step 1: Brief one Playwright agent** (no `name`, report in its last message and in a scratchpad file, every shot moved
  out of `.playwright-mcp/`): every board of the canvas page D, on the prototype build, at 390 px and 360 px, EN and AR, light
  and dark, in Chromium and in WebKit (Safari on iPhone). Include: a chat with the keyboard open, the @ list, the message sheet,
  the emoji sheet, the options sheet of a group, the picture viewer, the task panel in both views, the board lane, the project
  More tab, Me and two Me sub-pages.
- [ ] **Step 2: Read the shots against the canvas boards and the design rules** (one navy per screen, words never cut, no
  layout jump, 44 px targets with `elementFromPoint`). A fault goes back to the owning track's file with a test first.

### Task L6: Release to the test copy

- [ ] **Step 1:** Join `rb/phone-d` into main by the release flow of `scripts/deploy/CLAUDE.md` (rebase on main, the gate,
  `git merge --ff-only`). Hand the owner the push command (`! git -C /Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test push origin main`).
- [ ] **Step 2:** `all.sh test`, then the deploy suite. Expected: no failure.
- [ ] **Step 3:** The owner tries the test copy from the Home Screen on an iPhone and on an Android phone: the four tabs, a push
  that opens a chat, Back, the keyboard in a chat, Approve in Notifications, Mark done in a to-do, press and hold on Work.
- [ ] **Step 4:** Production only when the owner says so (`scripts/deploy/CLAUDE.md`). Update `TASKS.md` and the release record.

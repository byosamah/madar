# Phone: Direction D (Today, Inbox, Work, Me)

Owner decisions of 2026-10-22. Branch `rb/phone-d`. The detail of each screen area is in
`2026-10-22-madar-phone-d-areas.md` (next to this file). This file holds the decisions and the rules for all areas.
Where the two files differ, this file wins.

## Why

The team uses Madar on the phone as an app since the browser push of 2026-10-08 (Home Screen app on iPhone). They told the
owner that the phone is "overwhelming". On a phone today, Madar is the desk app in a narrow column:

- Eight controls frame every screen: the mark, Search, the bell and the person picture at the top, and five tab icons with
  no words at the bottom.
- Home repeats the full project list under the day.
- A project shows three buttons, a stage menu and seven tabs that scroll sideways before any content.
- A to-do opens as a form. The status, lead, stage and helper pickers come before the next step.
- New things live in two places: the bell and the Inbox.
- An open chat keeps the top row, the tab bar and the page margins, so the messages get about half of the screen.

The rule of the office is one next step and the fewest controls, for the people with ADHD. The phone breaks that rule.

## The mockups

The design canvas is the private artifact https://claude.ai/artifact/AVpT8zSb2Lexjt7v3t2Cgg. Direction D is at the top of
the canvas: the checklist board "D · Everything on the phone" and 17 phone boards. A, B and C sit under it for comparison.
The owner approved D on 2026-10-22. The mockups show the places and the order of things. The real design system wins on every
detail (tokens, Thmanyah Sans, components). The mockups use a stand-in font, because the Thmanyah licence forbids copies
outside the product. Where a mockup and this text differ, this text wins.

## Owner decisions (2026-10-22)

1. **Direction D.** The tab bar of B, starting with Today. The Home screen of A under Today. Chats and alerts in one Inbox,
   as in A. Tasks and Projects merged into one tab. A Me tab.
2. **The merged tab is called "Work"** («العمل»).
3. **Nothing goes away.** Every feature keeps a place on the phone. The chat keeps every feature it has: Online, Away and
   Offline, Seen, typing, reactions and the emoji list, reply, edit and delete, groups, archive, mentions, files and pictures.
4. **Our design system, our colours, our motion, responsive and friendly on a phone, "the best".**
5. **Build method:** Opus 5.5 leads (design, plan, merge), Sonnet 5.5 builds, to keep the cost of tokens low.

## Goals

- A person opens Madar on the phone and sees one next step, with four words at the bottom that say where everything is.
- A push opens the item, and Back returns to a calm list.
- A to-do shows its next step first, in reach of the thumb.
- A chat uses the whole screen, like the chat apps the team knows, with every feature of the desk chat.
- Every screen works in English and Arabic, light and dark, at 360 to 639 px, in Safari on iPhone (Home Screen app) and in
  Chrome on Android.

## Non-goals and anti-goals

- Not in this batch: a change to the desk layout (640 px and wider), a store app, a new server call, a new field, a new
  setting, a change to the push line, a change to MCP.
- Anti-goals (a failure even when it works):
  - A feature that a phone user had before D and cannot reach after D.
  - A second place for the same thing (two searches, two bells, two settings pages with different rows).
  - New colour for decoration: coloured icon tiles, coloured status chips, navy on more than one control of a screen.
  - Motion that blinks, bounces or plays without reduced-motion care.
  - A screen that moves under the finger: a layout jump when a count loads, a bar that floats over the keyboard.

## The map

| Tab | Word (English, Arabic) | Opens | Is the open tab on |
| --- | --- | --- | --- |
| Today | Today, «اليوم» | `/` | `/` |
| Inbox | Inbox, «الوارد» | `/inbox` | `/inbox`, `/inbox/:id`, `/notifications` |
| Work | Work, «العمل» | the last Work view of the visit, else `/work` | `/work`, `/meetings`, `/projects`, `/projects/*` |
| Me | Me, «أنا» | `/me` | `/me`, `/me/:section`, `/settings`, `/whats-new`, `/dashboard`, `/tasks`, `/admin`, `/admin/:section` |

`/search` and a wrong link open no tab, as today. Every address of today keeps working, so push lines, mail links, What's new
links, MCP links and bookmarks still open the right screen.

## Rules for every phone screen

1. **Phone means a viewport under 640 px.** The code tests it with `useIsPhone` (`(max-width: 639px)`) or the `max-sm:` and
   `sm:` classes. From 640 px the screens stay exactly as they are today, including the word "Tasks" and the five-tab pill.
2. **The tab bar** (`PhoneTabBar`, returned by `TabPill` on a phone): four tabs, each with its icon and its word
   (`text-caption`, 12 px, one line). The open tab has the navy pill that glides (`layoutId="pill-active"`). The Inbox count is
   the unread chats plus the bell count, on the icon, as today. A press on the open tab scrolls the screen to the top.
3. **The top row** of every screen except an open chat: the Madar mark (or a back link) at the start, one Search icon for the
   whole office at the end. The bell and the person picture leave the phone. No screen adds a second search icon.
4. **The bar hides** in an open chat, while the keyboard is open, and in Focus mode. The page space and the toast lane follow
   the token `--phone-bar`, so nothing jumps.
5. **Safe areas.** The bar, the docked chat composer, the sheets and the full-screen viewer pad
   `env(safe-area-inset-bottom)` and `env(safe-area-inset-top)`. Heights use `dvh`, never `vh`.
6. **Touch.** Every control is at least 44 by 44 px. Press and hold (400 ms, 8 px) picks up a row to change the order, in place
   of the drag grips. The grips stay for the keyboard and screen readers (`sr-only`).
7. **Look.** Only the tokens of `src/design/tokens.css` and the components of `src/components/`. Navy for the one main action of
   a screen, the open tab and the day ring. A state is a shape plus an ink word (DESIGN.md). Red stays where DESIGN.md puts it today (Late,
   errors, the count badge, destructive buttons); D adds no colour. No coloured icon tiles. The Thmanyah Sans font, Western digits, the 12-hour clock.
8. **Motion.** Reuse what exists: the springs of `src/design/motion.ts`, the pill highlight, the `AnimatedIcon` play when a tab
   opens, the screen slide by tab order (`ScreenEntrance`), the vaul sheets, `.pressable`, `.screen-enter`. Every new motion
   has its reduced-motion rule: `MotionConfig reducedMotion="user"` covers Motion, and the CSS blocks of `tokens.css` cover CSS.
9. **Words.** Every new word has an English and an Arabic key in the file pair of its track
   (`src/i18n/real/phone<track>.en.json` and `.ar.json`), in ASD-STE100 English and Thmanyah-style Arabic, with no em-dash.
10. **Right to left.** Every screen mirrors in Arabic. Arrows and the send icon flip. English names inside Arabic text are
    isolated (`<bdi>`).
11. **Dark.** Every new part takes its colours from the tokens, so dark comes for free. Each screen is checked in dark.
12. **No contract, server or MCP change.** D is a screen change. The same screens run in the prototype and in the real build.

## What does not change

- The desk layout, the five-tab pill, the person menu and the bell on a desk.
- Every API call, every field, every right and every rule of the server.
- MCP: the tools, `TOOL_DOCS` and `INSTRUCTIONS`. The phone screens are not part of the agent contract. (The owner rule says
  every feature change updates MCP. D adds no feature that an agent can use, so the MCP side has nothing to change. The
  release record says so.)
- The push line and its target address.
- The data and the reads, except one: Today no longer reads `projects.list` early on a phone (see the Today area).

## The areas

Each area has its own section in `2026-10-22-madar-phone-d-areas.md`: the facts of today, the screen from top to bottom, a table
of every feature with its place in D (about 900 rows in all), the motion and look, the files to change, and the calls of its
writer. Sonnet agents wrote each section from the code, a second agent searched each area again for missed features, and the
lead checked the joins between the areas.

| Area | What changes on a phone | Track |
| --- | --- | --- |
| Shell | `PhoneTabBar` with four words; the top row keeps the mark (or a back link) and one Search; the bell and the picture leave; `/me` and `/me/:section`; `--phone-bar` token; the bar hides in a chat, with the keyboard and in Focus mode | S |
| Today | Home without the project list and the What's new link; five blocks in one column; a Join button on a meeting that starts soon | T |
| Work: To-dos and Board | One `WorkHeader` (title "Work", the main button of the view); the switch To-dos, Meetings, Projects; the View toggle; press and hold to reorder; the board lane snaps, with dots | W |
| Work: Meetings and Projects | The two screens under the Work header; meeting cards with Join; a search field over the project list | W |
| A project | Five tabs (Overview, To-dos, Tracker, Files & Links, More); a sticky tab row; one navy button per tab; pop-ups become sheets; the tracker form in a sheet | P |
| A to-do | The next step first (Approve, Take it, Mark done or Send to review); Details as grouped rows over the native pickers; the Conversation box docked | K |
| Inbox | Chats and Notifications in one tab with a sliding switch; kind chips; Archived at the end of the list; Approve in place | I |
| A conversation | A full-screen page over the keyboard; one options sheet for every chat kind; the message, emoji and picture sheets of today | I |
| Me | A hub for the person menu and Settings; sub-pages `/me/:section`; Dashboard and Admin rows; Sign out | M |

## Lead decisions

The area writers asked these questions. The lead answers them here. Each answer keeps a feature that exists and adds no
contract change.

1. **Counts keep their look of today.** The Inbox tab count and the two segment counts use the red `Badge` (DESIGN.md
   `badge`). A chat row keeps its `signature` count. D adds no colour and removes none.
2. **Red stays where DESIGN.md puts it.** Late, errors, the count badge and the destructive buttons (Delete, Leave group,
   Remove, Delete to-do) keep their look of today.
3. **One word for the second Inbox view: "Notifications"** («الإشعارات»), the word of the desk page and of Settings. The
   mockups say "Alerts". This text wins.
4. **Press and hold is built once**, in `SortableTaskRows`, `RowGrip`, `DragLayer` and `TaskBoard`, by the Work track: 400 ms,
   8 px, `MouseSensor` and `TouchSensor` on a touch phone. Today, Work and the project To-dos tab all use it. On a touch phone
   the grip is `sr-only`, so the keyboard and screen readers keep it. The checklist of a to-do keeps its visible grip (44 px).
5. **The switches slide.** The Work switch and the Inbox switch use `SegmentedControl` with a new `fill` prop and a fixed
   `layoutId` (`work-switch`, `inbox-views`). On a phone the shell joins the views of each tab in one `screenKey`, so Motion
   slides the pill across the view change. With reduced motion the pill jumps.
6. **Back from a chat** returns to the screen that opened it (`navigate(-1)` when the opener passed `state.from`), so the list
   keeps its scroll place. With no opener (a push line, a mail link, a bookmark) Back goes to `/inbox`.
7. **The chat search icon** opens the Search screen on its Messages group (`/search?in=messages`, a screen-only mark). There is
   no search inside one chat.
8. **Payments stay in the project Overview**, as today. More lists Activity, Schedule and Team.
9. **Links stay in Files & Links** (owner rule of 2026-10-19). The Overview has no Links panel.
10. **No clock setting.** Every time is on the 12-hour clock since 2026-10-21.
11. **Meetings:** Join shows on the card when the meeting has a link. Edit and Cancel stay at the bottom of the meeting sheet
    (fbk_037), because the row has no rights field and D adds none.
12. **Admin** opens from a Me row with the line "Best on a computer". Its phone section list works today. Every screen that the
    mockup marked "desk only" has a phone shape today (meeting view, Open space, template editor, schedule), so no screen says
    "Open this on a computer".
13. **Settings words stay.** Texts that say "Settings" stay true: on a phone the Me hub shows its settings rows under the
    heading "Settings", and `/settings` opens the hub.
14. **The desk keeps "Tasks".** Only the phone says "Work". A desk rename can come with a later desk change.
15. **Words go in one file pair for each track** (`src/i18n/real/phone<track>.en.json` and `.ar.json`). Where an area section
    names `phoned.en.json`, read the file pair of its track.

## Calls for the owner to check

These are choices of the lead and the writers that the owner did not state. Each one is easy to change before the build.

1. The phone tab says "Today"; the Madar mark keeps the name "Madar, Home".
2. The Inbox tab count is one number: unread chats plus the bell count. Each segment shows its own count.
3. A press on the open tab scrolls the screen to the top.
4. The Work tab opens the last Work view of the visit; a reload opens To-dos.
5. The hint "Press and hold a to-do to change its order." shows under the Work list on a touch phone.
6. Today shows a "Join" button on a meeting that starts in 30 minutes or less.
7. The project tab words are short in Arabic: «نظرة عامة»، «المهام»، «المتابعة»، «الملفات والروابط»، «المزيد».
8. A to-do title is edited by a tap on the title; the grouped rows open the pickers of the phone.
9. A chat on a phone does not put the cursor in the box when it opens, so the keyboard does not cover the "New" line.
10. Sign out is a quiet grey button at the end of Me, as today it asks nothing.
11. "Agents" (AI assistants) gets its own row in Me, under Settings.
12. The Projects view of Work gets a search field that filters the loaded list (name, code, client). Remove it if the owner
    wants fewer controls.

## Build

**Method (owner, 2026-10-22).** Opus 5.5 leads: the plan, the briefs, the joins and the whole-product check. Sonnet 5.5 builds:
one builder for each track, in its own worktree branch. No separate checker agent (owner rule of 2026-10-07). Each builder runs
the type check and the tests of its touched files. The full test suite runs once, at the end. Screenshots are part of the work:
a Playwright agent takes them (EN and AR, light and dark, 390 px and 360 px, Chromium and WebKit for Safari on iPhone).

**Tracks and owned files.** A track edits only its own files. A file that two tracks need belongs to the first wave.

| Wave | Track | Owns |
| --- | --- | --- |
| 1 | S, Shell and shared parts | `AppShell.tsx`, `TabPill.tsx`, new `PhoneTabBar.tsx`, `nav.ts`, `routes.tsx` (routes `/me`, `/me/:section` as empty screens), `screenLoaders*.ts`, `screens.ts`, `toasts.tsx`, `lastList.ts`, `pressReads.ts`, `tokens.css` (`--phone-bar`), new `useKeyboardOpen.ts`, `useVisualViewport.ts`, `isPhoneNow()` in `useIsPhone.ts`; shared components: `SegmentedControl` (`fill`, `layoutId`, pointer-down prop), `Tabs` (`spread`, `variant="pill"`), `Sheet` (`tall`, `phoneHeader`), new `SheetOrPopover`, `Menu` (`sheetOnPhone`) |
| 2 | W, Work | `src/features/work/`, `src/features/meetings/` list and card, `src/features/projects/` header and search, `SortableTaskRows`, `RowGrip`, `DragLayer`, new `dragSensors.ts`, `TaskBoard`, `TaskRowItem`, `TaskPeople` (44 px press area) |
| 2 | T, Today | `src/features/home/`, `app/remote/homeCache.ts` |
| 2 | P, Project | `src/features/project/` except the task panel and the shared row files of W |
| 2 | K, To-do | `TaskSheet.tsx`, new `useTaskPanel.ts`, `nextStep.ts`, `DetailRows.tsx`, `ChecklistRow.tsx`, `features/comments/` dock |
| 2 | I, Inbox and chat | `src/features/inbox/`, `src/features/notifications/`, `src/features/search/` (the `?in=messages` mark), `features/emoji/` sheet layout, `components/ImageViewer.tsx` safe area |
| 2 | M, Me | new `src/features/me/`, `src/features/settings/` (bare mode, `PrototypeTools.tsx`), `PersonMenu.tsx` items it reuses |
| 3 | Lead | The join on one branch, `src/CLAUDE.md` and `DESIGN.md` lines, the What's new entry, the old phone specs, the full suite, the screenshots, the test deploy |

Wave 1 must land before wave 2 starts, because every wave 2 track uses the tab bar, the routes and the shared props. The six
wave 2 tracks run in parallel.

**Checks before the merge.** The repo gate: typecheck, `npm test`, `npm run build` (with `check-bundles`: `PhoneTabBar` sits in
the first load, so the 1,350,000 B limit must hold), `build:server`, `build:remote -- test`, `test:db`, `test:it`, the prototype
smoke. The browser specs that pin the old phone shell change in the same commits: `owner.spec.ts` ("exactly five tabs" becomes
four), `shell.spec.ts`, `calm.spec.ts`, `work.spec.ts`, `projects.spec.ts`, `toastUndo.spec.ts`, `full.spec.ts`, in
`tests/e2e/` and `tests/e2e-deploy/`.

**Proof on a real phone.** The owner (or a team member) opens the test copy from the Home Screen on an iPhone and on an Android
phone: the four tabs, a push that opens a chat, Back, the keyboard in a chat, Approve from Notifications, Mark done in a to-do,
press and hold on Work.

**What's new.** One entry: "Madar on the phone: four tabs" with a short line for each tab. MCP: no change (see "What does not
change").

## Risks

- **Safari on iPhone and the keyboard.** The chat page follows `visualViewport`. The composer, the @ list and the Newest
  button must stay above the keyboard in the Home Screen app. Test on WebKit and on a real iPhone.
- **A sheet in a sheet.** vaul cannot open a sheet inside the task sheet. The task Conversation keeps the "..." button, and the
  options sheets open their next sheet after they close.
- **Touch drag on iPhone.** `TouchSensor` with a 400 ms hold must not fight the page scroll or the board lane snap. Test on a
  real iPhone before the merge.
- **The shared slide.** The `layoutId` slide across a view change depends on the shell `screenKey` join. If it does not play,
  the switch ships without the slide, and the report says so.
- **First load size.** The tab bar and its icons sit in the first script. `check-bundles` holds the limit.
- **The Home cache.** A phone record of `homeCache` holds no `projects.list`. A record of the old build is ignored, as today.

# Phone: Direction D, the areas

The detail of each screen area of Direction D. The decisions and the rules for all areas are in `2026-10-22-madar-phone-d-design.md`; where the two files differ, that file wins. Each section was written from the code of main (2026-10-22) by a Sonnet agent, searched again for missed features by a second agent, and joined by the lead.

### Shell, tab bar and top bar

#### Today on the phone
- The bar is `TabPill` (`src/app/TabPill.tsx`). It sits at the bottom and is 60 px high. It has five tabs: Home, Projects, Tasks, Dashboard (needs `dashboard.view`) and Inbox. Each tab shows an icon only. The word is `sr-only`.
- The Inbox tab has no `aria-label`. Its name is the `sr-only` word plus the `sr-only` text of the count (`nav.inboxUnread`). The key `nav.withBadge` serves only `InboxButton` and `BellButton`, which are desk parts or top row parts.
- The top row sits inside `main` (`src/app/AppShell.tsx`, class `sm:hidden`). It holds the Madar mark (or the back link on a project page), Search, the bell with its count, and the person picture with the own status dot.
- The person menu (`src/app/PersonMenu.tsx`) is mounted twice: `id="wide"` (hidden on a phone with `hidden sm:block`) and `id="phone"`. Both stay in the DOM. It holds the language, the theme (one press, light or dark), Admin or Office, "Show me as Away" (live port only), Settings, What's new, the bug report and Sign out (real build only).
- `ScreenEntrance` slides a new screen by the index of its tab in `NAV`. `screenKey` joins `/inbox/:id` to `/inbox`, `/admin/:section` to `/admin`, and `/meetings` to `/work`. A project page has its own entrance.
- An open chat keeps the top row and the bar. `InboxScreen.tsx` hides its title and fits its height with `calc(100dvh-9.5rem)`.
- The page uses `pb-32`. The toast lane uses `bottom-24`. The viewport has `viewport-fit=cover`. The bar respects `env(safe-area-inset-bottom)`.

#### D on the phone
The phone is a viewport under 640 px (`useIsPhone`, `max-sm`). From 640 px the shell stays as it is: the 5-tab pill with the word "Tasks", Search, Inbox and the bell in the pill, the person menu at the top end. Do not change a desk class.

**Top row (every screen, except an open chat).** One row, 44 px high, inside `main`, above the screen title. It scrolls away with the page.
- Start side: the Madar mark (`HomeMark`, opens Today). On the screens of the back link table, the back link takes its place.
- End side: one Search icon (`SearchButton`, needs `search.use`). It is the one search icon of the shell. On `/search` it shows its open state. No other screen adds a search icon. The search fields that exist stay (Inbox "Search chats"; the Projects view of Work may add a field that filters the loaded list).
- The bell and the person picture leave this row. Nothing else joins it.

**Back link table (start side of the top row).** It reuses the project back link markup (`ChevronLeftIcon`, flipped in RTL, 44 px high, `text-link`).

| Screen | Back link word | Goes to |
| --- | --- | --- |
| `/projects/:id` | Projects (`project.back`) | `projectsListLink()` |
| `/me/:section`, `/whats-new`, `/dashboard`, `/admin` | Me | `/me` |
| `/tasks` | Dashboard (`nav.dashboard`) with `dashboard.view`, else Me | `/dashboard` or `/me` |
| `/admin/:section` | Admin for the Admin, Office for other roles (same rule as `pageTitle` in `AdminScreen.tsx`) | `/admin` |

`/tasks` is the list that the Dashboard numbers open, so its back link goes to the Dashboard. On a phone `BackToDashboard` in `TaskListScreen.tsx` hides (`max-sm:hidden`), so the page shows one back link.

Every other screen shows the mark. These tab screens never show a back link: `/`, `/inbox`, `/notifications`, `/work`, `/meetings`, `/projects`, `/me`, `/settings` (the Me hub on a phone), `/search`.

**Bottom bar (new `PhoneTabBar`, `src/app/PhoneTabBar.tsx`).**
- `TabPill` keeps its name. It returns `PhoneTabBar` when `useIsPhone()` is true. Otherwise it returns the current pill, unchanged.
- Markup: `nav` with `aria-label` `nav.main`, `data-pill`, class `pill`, fixed, `bottom-[max(16px,env(safe-area-inset-bottom))]`, `w-[calc(100vw-32px)] max-w-md`, `rounded-full p-1.5`. Keep `data-pill`: Focus mode makes `nav[data-pill]` inert.
- Four links, each `flex-1 min-w-0 h-[52px]`, in a column: the icon (`AnimatedIcon`, 22 px), then the word (`text-caption font-semibold`, one line, never cut). The bar is 64 px high.
- Order from the start side: Today, Inbox, Work, Me. RTL mirrors it with no extra code.
- The open tab has the navy pill (`motion.span layoutId="pill-active"`, class `signature`, `rounded-full`) and the text `var(--on-sig)`. The other tabs use `text-ink-2`. Navy is only the open tab here.
- The Me tab shows a user icon.
- The Inbox count (`Badge`) sits on the corner of the icon. The number is the unread chats plus the bell count (`notifications.count.badge`). Each segment of Inbox shows its own count.
- The Inbox link has an `aria-label`, so the text inside the `Badge` no longer counts. Three cases:
  - No count: "Inbox".
  - Only chats, or only bell items: `nav.withBadge` with `nav.inboxUnread` or `nav.inboxBadge`. Both keep their plural forms, also in Arabic.
  - Both: the new key `phoneNav.inboxBoth`, with the two existing plural texts inside.
- Each link starts `usePressReads` on pointer down with its own address. The Inbox link starts `chats.list`.

**Which tab is open (`phoneTabOf(pathname)` in `src/app/nav.ts`).** It sets `aria-current="page"` and the slide index.

| Tab | Link | Open on |
| --- | --- | --- |
| Today | `/` | `/` |
| Inbox | `/inbox` | `/inbox`, `/inbox/:id`, `/notifications` |
| Work | last Work view of this visit, else `/work` | `/work`, `/meetings`, `/projects`, `/projects/*` |
| Me | `/me` | `/me`, `/me/:section`, `/settings`, `/whats-new`, `/dashboard`, `/tasks`, `/admin`, `/admin/:section` |
| none | not a tab | `/search`, a wrong link |

**The Me route.** Add `/me` and `/me/:section` to `routes.tsx` (screen `me`, inside the shell, no `right`). On a desk, `/me` and `/me/:section` send the person to `/settings` with `Navigate replace`. On a phone, `/settings` opens the Me hub. The Me hub and its sections belong to the Me area. The shell needs the routes, the tab, the back links and the words. Every old address stays: `/settings` (the Google callback returns to `/settings#google=`, which the Google section must still read on a phone), `/whats-new`, `/admin`.

**Admin and Dashboard on a phone.** Me has an "Admin" row (word "Office" for other roles) that opens `/admin`. It carries the line "Best on a computer" (`phoneNav.adminBest`). The section list of `/admin` works on a phone today and stays. The Dashboard opens from a Me row (right `dashboard.view`) in its current phone shape. The meeting view, Open space, the template editor and schedule editing all have a phone shape today (`MeetingView.tsx` shows the project screens, `OpenSpaceScreen.tsx` fits the cards, `ProjectTemplateEditor.tsx` and `ScheduleTab.tsx` show lists). So no screen shows "Open this on a computer".

**The bar hides in three cases.**
1. An open chat (`/^\/inbox\/[^/]+$/` on a phone). The top row hides too. `main` becomes a full-height column: no space at the edge, `max-sm:h-dvh`, `overflow-hidden`. The Inbox area builds the inside. The composer must be the last flex child, not `position: fixed`, because `.app-page` scales to 97% when a sheet opens and a fixed child would jump. The composer pads `env(safe-area-inset-bottom)` itself.
2. The keyboard is open. New hook `useKeyboardOpen` (`src/app/useKeyboardOpen.ts`): `window.visualViewport` is more than 150 px shorter than `window.innerHeight`. With no `visualViewport`, the bar stays.
3. Focus mode is on (current rule: the bar is inert and the overlay covers it).

The meeting view, Open space and the sign-in screens sit outside the shell, so they have no bar.

**Page space.** Add the token `--phone-bar: calc(64px + max(16px, env(safe-area-inset-bottom)))` to `tokens.css`. The shell sets `data-bar-hidden` on `<html>` when the bar hides (same method as `data-panel-open`), and `:root[data-bar-hidden] { --phone-bar: 0px }`. The page uses `pb-[calc(var(--phone-bar)+1.5rem)]` on a phone in place of `pb-32`. The toast lane uses `bottom-[calc(var(--phone-bar)+0.75rem)]` in place of `bottom-24`. The lane over a sheet (`LANE_OVER_SHEET`) stays at the top.

**Press on the open tab.** The page scrolls to the top. The person does not leave the screen.

**Work tab target.** The shell remembers the last Work view of the visit in memory (`rememberWorkView`, `workTabLink`, in `src/app/lastList.ts`, like `projectsListLink`). A reload resets it to `/work`. The title of `/work` and `/meetings` on a phone is "Work" (`phoneNav.work`), so the tab and the page use one word. The Work area changes the title with `useIsPhone`. A desk keeps "Tasks" (`screens.myWork`).

**Entrance.** `tabOf` takes a `phone` argument. On a phone `ScreenEntrance` uses the phone index (Today 0, Inbox 1, Work 2, Me 3). A desk keeps the `NAV` index. `screenKey` keeps its three joins on both sizes. On a phone it also joins `/projects` to `/work`, `/notifications` to `/inbox`, and `/me/:section` stays a screen of its own. So the segmented controls change the view with no new entrance. A project page keeps its own entrance (`tabOf` gives -1).

#### Every feature and its place
| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Tab bar landmark, name "Main navigation" | `TabPill.tsx` | Bottom bar, `PhoneTabBar`, same name | Change |
| Home tab (icon only) | `nav.ts` NAV | Today tab, icon and word, link `/` | Change |
| Projects tab | `nav.ts` NAV | Work tab, view Projects | Merge |
| Tasks tab | `nav.ts` NAV | Work tab, view To-dos | Merge |
| Dashboard tab (`dashboard.view`) | `nav.ts` NAV | Me row "Dashboard", same right | Move |
| Inbox tab | `nav.ts` NAV | Inbox tab, word shown, opens Chats or Notifications | Change |
| Tab word (`sr-only` on a phone) | `TabPill.tsx` | Visible under each icon, 12 px | Change |
| Inbox count on the icon | `TabPill.tsx` | Same spot; number is chats plus bell | Change |
| Inbox link name (no `aria-label` today) | `TabPill.tsx` | `aria-label` in three cases (see the bar) | Change |
| Link name with the count (`nav.withBadge`) | `InboxButton`, `BellButton` | Desk keeps both; the phone Inbox tab reuses the key | Keep |
| Count shows 99+ above 99 | `Badge.tsx` | Same | Keep |
| Open tab navy pill that glides (`layoutId`) | `TabPill.tsx` | Same, on the 4 tabs | Keep |
| Tab icon plays once when the tab opens | `AnimatedIcon.tsx` | Same; new icons `user`, `briefcase` | Keep |
| `aria-current="page"` on the open tab | `isNavActive` | `phoneTabOf` | Change |
| Press reads of the tabs | `pressReads.ts` | Inbox tab: `chats.list`. Work tab: the read of its target link (`/projects` runs the Projects read). Notifications segment: `notifications.list`. Projects segment: `projects.list` reads. Me row Dashboard: `GUARD_READS.dashboard`. All through `usePressReads(to)` | Change |
| Tab hidden without a right (`whileLoading`) | `TabPill.tsx` | No gated tab; the Dashboard and Admin rows are gated | Move |
| Bar shrinks to 94% while the page scrolls down | `useCompactBars.ts` | Same | Keep |
| Bar position, 16 px side edge, safe area | `TabPill.tsx` | Same classes, 64 px high | Keep |
| Glass, solid with more contrast or less transparency | `tokens.css` `.pill` | Same | Keep |
| Press on the open tab | none | Scroll to top | Change |
| Work tab opens the last Work view | none | `workTabLink()` | Change |
| Work screen title | `screens.myWork` ("Tasks") | "Work" on a phone; "Tasks" on a desk | Change |
| Bar hidden in an open chat | none | `/inbox/:id` on a phone | Change |
| Bar hidden with the keyboard open | none | `useKeyboardOpen` | Change |
| Bar inert in Focus mode | `FocusMode.tsx` | Same, through `data-pill` | Keep |
| No bar in the meeting view, Open space, sign-in | `routes.tsx` | Same | Keep |
| Tab slide by tab index | `AppShell.tsx` `tabOf` | Phone index of 4 tabs | Change |
| First-visit rise of the panels | `ScreenEntrance` | Same | Keep |
| Project page entrance (row grows into header) | `ScreenEntrance` | Same | Keep |
| One entrance for a chat list and a chat, and for the Admin sections | `screenKey` | Same, plus the Notifications and Work views on a phone | Change |
| Scroll place of each screen | `ScrollRestoration` | Same | Keep |
| Page steps back to 97% with a sheet | `tokens.css` `.app-page` | Same | Keep |
| Page bottom space `pb-32` | `AppShell.tsx` | `--phone-bar` token | Change |
| Top safe area `env(safe-area-inset-top)` | `AppShell.tsx` | Same | Keep |
| Madar mark, opens Home | `HomeMark` | Top row start; opens Today | Keep |
| Mark name "Madar, Home" | `nav.madarHome` | Same | Keep |
| Back link on a project page | `AppShell.tsx` | Top row start, same | Keep |
| Back link on Me screens | none | Top row start, word "Me" | Change |
| Back link of the list opened from the Dashboard (`/tasks`) | `TaskListScreen.tsx` body | Top row start, word "Dashboard"; the body link hides on a phone | Move |
| Back link of an Admin section | `AdminScreen.tsx` body | Top row start, word "Admin" or "Office" by role | Move |
| Search icon (`search.use`, open state) | `SearchButton` | Top row end, label "Search the whole office" | Keep |
| Search shortcut Ctrl+K or Cmd+K | `AppShell.tsx` | Same | Keep |
| Search icon hidden without `search.use`; shown before the session loads | `SearchButton` | Same | Keep |
| Bell icon on a phone | `BellButton` | Inbox, segment Notifications | Move |
| Bell count (`notifications.count`) | `BellButton` | Inbox tab count and Notifications segment | Merge |
| Bell open state on `/notifications` | `BellButton` | Inbox tab open | Change |
| Person picture button on a phone | `PersonMenu.tsx` | Me tab | Move |
| Own status dot and label (`PersonFace mine`, `presence.faceLabel`) on every screen | `PersonMenu.tsx` | Me hub header only; the Me tab has the user icon and no dot | Move |
| Person menu header (picture, name, presence line or email) | `PersonMenu.tsx` | Me hub header | Move |
| Preview as (prototype only) | `PreviewAs.tsx` | Me hub, prototype block | Move |
| Language switch with the page turn | `PersonMenu.tsx`, `languageTurn.ts` | Me, Language control; it calls `useSwitchLanguage` | Move |
| Light or dark switch | `PersonMenu.tsx` | Me, Theme control with the three choices System, Light, Dark (as Settings). `nav.lightMode` and `nav.darkMode` then serve only the desk menu | Change |
| Admin or Office link (`opensAdminPage`) | `PersonMenu.tsx` | Me row "Admin" or "Office", opens `/admin`, line "Best on a computer" | Move |
| "Show me as Away" switch (live port) | `PersonMenu.tsx` | Me, top group | Move |
| Settings link | `PersonMenu.tsx` | The Me hub shows its settings rows under the heading "Settings" | Merge |
| Settings sections: Profile, Notifications, Browser push, Quiet hours, Google Calendar, Password, AI assistants (`ai.connect`), Admin reach (Admin) | `SettingsScreen.tsx` | Rows of the Me hub; each opens `/me/:section` with its current content and rights | Move |
| Prototype block: Reset sample data, Simulate errors | `SettingsScreen.tsx` | Me hub, last group, prototype only | Move |
| What's new link and the word "New" | `PersonMenu.tsx` | Me row with the word "New" (no dot) | Move |
| Request a feature or report a bug (`feedback.send`) and its sheet | `PersonMenu.tsx` | Me row, same sheet | Move |
| Sign out (real build) | `PersonMenu.tsx` | Me, last row, a quiet secondary button | Move |
| Focus returns to the picture after the menu closes | `PersonMenu.tsx` | Not needed on a phone | Desk-only |
| Person menu on a desk (`id="wide"`) | `AppShell.tsx` | Unchanged. It stays in the DOM on a phone, hidden | Desk-only |
| Mark at the top start of a desk | `AppShell.tsx` | Unchanged | Desk-only |
| Desk pill: five tabs with words, Search, Inbox, bell | `TabPill.tsx` | Unchanged | Desk-only |
| Desk Dashboard tab | `nav.ts` NAV | Unchanged | Desk-only |
| Notices that stay (no connection, not saved) | `StorageBanner.tsx` | Same toast lane, new offset | Keep |
| Toast lane position | `toasts.tsx` | `--phone-bar` offset | Change |
| Browser push sync (no screen) | `PushSync.tsx` | Same | Keep |
| Focus mode slot (`?focus=`) | `AppShell.tsx` | Same | Keep |
| Wrong link page inside the shell | `RouteError.tsx` | Same; no tab open | Keep |
| Screen error page inside the shell | `RouteError.tsx` | Same | Keep |
| Draft sweep and person turn restart | `AppShell.tsx` | Same | Keep |
| Route `/me`, `/me/:section` | none | New routes; a desk goes to `/settings` | Change |
| Route `/notifications` | `routes.tsx` | Same address; Notifications view of Inbox | Change |
| Route `/tasks` (lists behind the Dashboard) | `routes.tsx` | Same; Me tab open | Change |
| Route `/settings` and its Google return fragment | `routes.tsx` | Opens the Me hub on a phone; Me tab open | Change |
| Old links, push links, notice links | `routes.tsx` | All still open | Keep |
| Keyboard focus ring and tab order | `TabPill.tsx` | Same; bar stays first in the DOM | Keep |
| Screen reader names of tabs and icons | `TabPill.tsx` | Word is real text; icon `aria-hidden` | Keep |
| Arabic right-to-left bar and chevrons | `TabPill.tsx` | Same; logical classes only | Keep |
| Tab bar words in both languages | `nav.*` | New keys `phoneNav.today`, `work`, `me`, `searchAll`, `inboxBoth`, `adminBest` | Change |
| Home Screen app, safe areas, `100dvh` | `index.html`, manifest | Same; check in a shot | Keep |

Quiet hours (`QuietHoursSection.tsx`) and Admin reach (`AdminReachSection.tsx`) exist on main. The chat feature @everyone (`MentionField`, `EveryoneRow`) lives in the Inbox area and has no part in the shell.

#### Motion and look
- Tokens: `.pill` glass, `--on-sig`, `text-ink-2`, `text-caption`, `rounded-full`, the 16 px side edge. No coloured icon tile. No new color. Navy only for the open tab (the main action and the day ring belong to other screens). Sign out is a quiet secondary button. Red only for Late and errors. The one unread count keeps `bg-badge` from `DESIGN.md` (existing token, Inbox tab only).
- Reuse: `spring.standard` for the pill that glides (`layoutId="pill-active"`), `AnimatedIcon` with `playWhen`, `.pressable` press feedback, `ScreenEntrance` slide of 48 px (flipped in RTL), `screen-enter` rise, `useCompactBars` scale, `useSwitchLanguage` page turn, the vaul `Sheet` for the bug report.
- New icons through `AnimatedIcon`: `user` (Me) and `briefcase` (Work). `users` exists today, `user` and `briefcase` do not. Today uses `sun`. Inbox uses `inbox`. If `briefcase` is not on lucide-animated.com, Work uses `clipboard-check`.
- New motion 1: the bar leaves and returns when a chat opens or closes. It slides down 100% and fades, with `spring.standard` (`AnimatePresence`). With reduced motion, `MotionConfig reducedMotion="user"` removes the slide. Only the fade stays, at 0.2 s (`fade`).
- New motion 2: the scroll to top after a press on the open tab. With reduced motion, it jumps with `behavior: 'auto'`.
- The keyboard hide has no motion. The bar goes with `opacity-0 pointer-events-none` and `inert`.
- Reduced motion also removes the tab slide and the glide of the pill (current rule). Reduced transparency and more contrast make the bar solid (current rule).
- Check in Safari on iPhone and in the Home Screen app: the bottom gap above the home indicator, the keyboard hide, and `100dvh` when the address bar moves. Playwright WebKit cannot show the Home Screen app. Check it by hand.

#### Files to change
- `src/app/nav.ts`: add `PHONE_NAV` (4 items), `phoneTabOf`. Keep `NAV` and `isNavActive` for the desk.
- `src/app/PhoneTabBar.tsx` (new): the bottom bar. `src/app/TabPill.tsx`: rename the current component `DeskPill`, and add `TabPill` that picks one. `SearchButton` stays here. `BellButton` and `InboxButton` stay for the desk.
- `src/app/AppShell.tsx`: top row (drop `BellButton` and `PersonMenu id="phone"`), back link table, `chatOpen`, `data-bar-hidden`, phone `tabOf` and `screenKey`, page space, `rememberWorkView`.
- `src/app/lastList.ts`: `rememberWorkView`, `workTabLink`. `src/app/useKeyboardOpen.ts` (new).
- `src/design/tokens.css`: `--phone-bar` and the `data-bar-hidden` rule. `DESIGN.md`: the shell paragraph and the `tab-pill` text (a phone has four tabs with words). Run the lint of `src/design/CLAUDE.md`.
- `src/app/toasts.tsx`: lane offset. `src/components/Sheet.tsx`: no change (sheets sit above the bar, z-50).
- `src/app/routes.tsx`, `src/app/screens.ts`, `src/app/screenLoaders.ts`, `src/app/screenLoaders.static.ts`: screen `me`. `src/app/idlePrefetch.ts`: add Me to `prefetchOrder`.
- `src/i18n/real/phoned.en.json` and `phoned.ar.json` (new, shared by all D sections), namespace `phoneNav`. English: Today, Work, Me, "Search the whole office", "{{name}}, {{messages}}, {{items}}", "Best on a computer". Arabic: «اليوم»، «العمل»، «أنا»، «ابحث في المكتب كله»، «{{name}}، {{messages}}، {{items}}»، «الأفضل أن تفتحها على الكمبيوتر».
- `src/components/icons/animated/user.tsx`, `briefcase.tsx` (new).
- `src/features/settings/admin/AdminScreen.tsx`: remove the phone back link in the body. The shell shows it.
- `src/features/tasklist/TaskListScreen.tsx`: `BackToDashboard` gets `max-sm:hidden`.
- `src/features/work/WorkScreen.tsx` and `src/features/meetings/MeetingsScreen.tsx`: the phone title "Work".
- `src/CLAUDE.md`: rewrite the "Shell" bullet, the "Meetings screens" tab pill sentence and the `NAV` right sentence.
- No contract, server, MCP or `readMap` change. `WRITE_KINDS` is not touched.
- Tests that pin the old phone layout and must change:
  - `src/app/TabPillLabels.test.tsx`: all phone cases (word is `sr-only`, five tabs, `h-12`, count place). Rewrite for four tabs, a visible word and `h-[52px]`.
  - `src/app/AppShell.test.tsx`: "keeps every phone tab inside the bar"; "says the unread counts in the names of the Inbox and bell links" (three name cases); the person menu cases (`.first()` now finds the hidden `wide` menu, so use role queries); "switches to Arabic from the person menu" and "gives the focus back to the person picture after the language switch" (move to the Me control); the project back link case; add cases for the Me, Dashboard and Admin back links and the full-screen chat.
  - `src/app/rr2Shell.test.tsx`: "shows five tabs on a phone with the switch on, and four with the switch off" becomes "four tabs always"; the Dashboard row is gated in the Me hub.
  - `src/app/PressReads.test.tsx`: the phone cases for the Projects tab, the bell and the Dashboard tab move to the Work tab, the Notifications segment, the Projects segment and the Me row.
  - `src/app/tabIcons.test.tsx`: add the phone items. `src/app/routes.test.tsx`, `screenLoaders.test.ts`, `screens.test.ts`: screen `me`. `src/app/routeError.test.tsx`: the bar still shows inside the shell.
  - `src/features/settings/admin/AdminScreen.test.tsx`: the phone back link. `src/features/tasklist/TaskListScreen.test.tsx`: the back link on a phone.
  - New tests: `phoneTabOf` for every route, `workTabLink`, `useKeyboardOpen`, the hidden bar at `/inbox/:id`, `/me` on a desk.
  - Browser specs: `tests/e2e/shell.spec.ts`, `calm.spec.ts`, `owner.spec.ts` ("exactly five tabs" becomes four; the bell and Notifications link cases become the Notifications segment), `work.spec.ts` and `toastUndo.spec.ts` (bell count, lane offset), and their `tests/e2e-deploy` twins.
  - Helpers: `signOut()` in `tests/e2e-deploy/steps.ts` goes to Me, Sign out on a phone. The Preview as helpers (`previewAs()` in `owner.spec.ts`, `acceptance.spec.ts`, `menus.spec.ts`) go to the Me hub on a phone.

#### My calls
- The tab word is 12 px (`text-caption`, the smallest token), not 11 px as in the mockup.
- The Work tab opens the last Work view of the visit. A reload resets it to `/work`.
- A press on the open tab scrolls to the top and does not leave the screen.
- The bar hides when the keyboard is open (150 px threshold), so it never floats above the keyboard in Safari.
- `/search` and a wrong link open no tab. This is the current rule.
- The own status dot shows only in the Me hub header. The Me tab keeps the plain user icon, so all four tabs look the same. A person sees the own state in Me, and others see it in the chat.
- `/tasks` goes back to the Dashboard, not to Me, because the Dashboard numbers open it.
- The bar and the top row switch by `useIsPhone` for the bar, and by `sm:hidden` for the top row. A phone turned sideways (640 px or more) gets the desk pill. The tab pill remounts at that change.
- The mark keeps the name "Madar, Home". The wrong link page keeps "Go to Home". Both open Today.
- The DOM order stays: the bar first, then the page. A desk needs it, and the change helps no phone user.
- No dot on the Me tab for "New" in What's new. The word stays on the row.

#### Questions only the owner can answer
None.


### Today (Home)

Files are in `src/features/home/` unless the table shows a full path. D needs no contract change, no server change and no Model Context Protocol (MCP) change. Batch B (@everyone, quiet hours) does not touch Today.

#### Today on the phone
- A phone is a viewport under 640 px (`useIsPhone`, `src/app/useIsPhone.ts`). From 640 px the desk Home stays, with the project list and the word "Home".
- Home is one column under 768 px: greeting, Next for you, Today, Meetings today, the push card, then "Your projects" (`HomeScreen.tsx`).
- The date line ends with the link "See what's new" while the newest entry is unseen.
- A Today row is `TaskRowItem` (`features/project/tasks/TaskRowItem.tsx`): 44 px tick, title, meta line, conversation button, project tile, and a 32 px drag grip at the end (`RowGrip.tsx`).
- The first request of Home holds nine reads (`homeKeys`, `src/app/remote/homeCache.ts`). `projects.list` costs 20 of the 30 units of one request (`src/api/remote/wire.ts`).
- A press on a to-do sets `?task=` (and `&project=`, `&thread=1`). That opens `HomeTaskSheet.tsx`. A push link `/?task=` does the same.
- The `.screen-enter` rule animates the children of the one grid child (`tokens.css`, `.screen-enter > :only-child > *`). Today, that means the left column and the project section.

#### D on the phone
The page is one column of five blocks. The Meetings block and the push card show only when they have something to show. The shell draws the top row (the Madar mark and one Search icon) and the bottom tab bar. The phone tab is "Today" (route `/`). Today adds nothing above "Next for you".

1. **Title block.** Reuse `ScreenTitle` and `DayRing`. The title is "Good morning, <first name>". The line under it shows the weekday and day. It adds "N reviews waiting for you" only when the ring is empty. The link "See what's new" does not show on the phone. The ring words ("11 of 14 done today") stay on the same line and wrap under the date on a narrow phone.
2. **Next for you.** Reuse `NextCard.tsx`: the `glow` panel, the title, one line, one context line, the main button with the arrow, and the plain Focus button. A review item keeps the first review. The button opens the to-do. For a review, the to-do shows Approve, the note and Send back, as today. For a to-do, the main button of the to-do calls `tasks.complete`. Its word is "Mark done" or "Send to review", by the result the server gives (the To-do area builds it).
3. **Today panel.** Reuse `TodayPanel.tsx` and `SortableTaskRows`. The title is "Today". When nothing is due, the title is "Coming up", with the next three to-dos that have a date. Coming up holds no review row. The last row is the link "See all my to-dos" to `/work`. On a touch phone a Today row moves by press and hold; the grip is `sr-only` (Work section, step 8: one build in `SortableTaskRows` and `RowGrip`).
4. **Meetings today.** Reuse `MeetingsCard.tsx`. Each row keeps the time and the title. Add one small line under the title: the meeting kind, then the project name when there is one (`meetings.kind.*`, `row.project.name`). Add a chevron at the end of the row. Add a secondary "Join" button when the meeting has a link and starts in 30 minutes or less, or is on now (`mainAction` in `features/meetings/meetingLinks.ts`, kind `join`). The last row is "All meetings" to `/meetings`.
5. **Push card.** Reuse `PushAskCard.tsx`. Add the bell icon (`components/icons/animated/bell.tsx`, 20 px, `text-ink-2`) at the start of the ask line. It plays once when the card shows. The button stays secondary. The iPhone steps card and the Android install card stay as they are.

How to build it:
- In `HomeScreen.tsx`, call `useIsPhone()` and pass `phone` to `HomeBody`. On a phone, `HomeBody` returns the blocks as direct children of the grid, with no left-column wrapper. The grid class on a phone is `grid grid-cols-[minmax(0,1fr)] gap-4`. This lets `.screen-enter` raise each block in turn (0, 60, 120, 180 ms). A wrapper with `display: contents` does not work, because the rule reads the DOM tree. No change to `tokens.css`.
- Do not mount the project section or the What's new link on a phone (no CSS hide).
- Read the list with `useCall('projects.list', input, { enabled: !phone })`. A turn to landscape starts the read.
- Add `isPhoneNow()` to `useIsPhone.ts`. It reads `window.matchMedia` with the same query.
- Give `homeKeys(role, today, phone = false)` a third argument. On a phone it leaves out `projects.list`. Only `show` (line 244) and `collect` (line 284) of `homeCache.ts` pass `isPhoneNow()`. The `HOME_NAMES` line (57) keeps the default, so `projects.list` stays in the name set.
- Keep `chats.unreadCount` and `notifications.count` in `homeKeys`. The Inbox tab badge is the sum of both.
- The role hint (`roleHint.ts`) runs as today. On a phone it feeds no read.
- Tap targets: the tick, the conversation button and the links keep 44 px. The lead picture button of an office to-do is about 34 px today (`TaskPeople.tsx`). Give it a 44 px press area on a phone with an `after:` strip. On a touch phone the grip is `sr-only` (Work section, step 8).

#### Every feature and its place
| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Greeting with first name (morning, afternoon, evening) | `HomeScreen.tsx` | Title block | Keep |
| Date line (weekday and day) | `HomeScreen.tsx` | Under the greeting | Keep |
| "N reviews waiting for you", only when the ring is empty | `HomeScreen.tsx` | Same | Keep |
| Link "See what's new" in the date line | `HomeScreen.tsx`, `src/whatsNew/seen.ts` | Me, row "What's new" with the word "New" (the Me area). The desk keeps the link | Move |
| Day ring with "N of M done today", screen reader label, no ring when nothing is due | `DayRing.tsx` | Same line as the date. The words wrap on a narrow phone | Keep |
| Next for you card on the glow | `NextCard.tsx` | Second block | Keep |
| Rule of the next item: review, then past due, due today, continue | `src/lib/home.ts` | Same. The card holds the first review only | Keep |
| Review item: "Approve “title”", project name, button "Review" | `NextCard.tsx` | Same. The button opens the to-do on Approve, the note and Send back | Keep |
| To-do item: "Finish" or "Continue", project name or "Office", button "Open to-do" | `NextCard.tsx` | Same. The to-do has the main button "Mark done" or "Send to review" | Change |
| Focus button (timer icon) on past due, due today and continue | `NextCard.tsx` | Same, plain button beside the main button | Keep |
| Empty state "You are all caught up." | `NextCard.tsx` | Same | Keep |
| Status line "Done. N more today." for 5 seconds after `tasks.complete` or `tasks.approve`, also when the person finishes inside the to-do opened over Today | `HomeScreen.tsx`, `NextCard.tsx` | Same. The line lives in `HomeScreen`, so it shows after the D to-do closes. Add a test | Keep |
| Today panel: my to-dos due today or past due | `TodayPanel.tsx` | Third block | Keep |
| "Coming up": next 3 to-dos with a date, when none is due. No review row | `TodayPanel.tsx`, `src/lib/home.ts` | Same | Keep |
| Empty line "Nothing is due today." | `TodayPanel.tsx` | Same | Keep |
| Link "See all my to-dos" | `TodayPanel.tsx` | Same word. It opens `/work` (Work tab, To-dos view) | Keep |
| Shared order of the rows (same as Work) | `src/lib/home.ts` | Same | Keep |
| Read `tasks.list {filter:'mine'}`. Work, To-dos shows this cached list at once as its placeholder | `HomeScreen.tsx`, `features/work/minePlaceholder.ts` | Same key. Do not change it | Keep |
| Round tick: finish, or send to review. Toasts: no lead, waits for others, "Completed." or "Sent to review." with Undo | `project/tasks/TaskRowItem.tsx` | Same, 44 px, start side | Keep |
| Plain mark where I cannot tick (in review, done) | `TaskRowItem.tsx` | Same | Keep |
| To-do title: a press opens the to-do | `TaskRowItem.tsx`, `HomeScreen.tsx` | Same press. It opens the D to-do | Change |
| Version badge, status word, due word, "Waiting for" line, flag word, file count | `TaskRowItem.tsx` | Same | Keep |
| Past-due words wrap on a second line and never run under the conversation button (fbk_036) | `TaskRowItem.tsx`, `components/StatusSign.tsx`, `PastDueWrap.test.tsx` | Same. Check "Past due by 157 days" at 390 px in EN and AR | Keep |
| Project name, or the word "Office" for an office to-do | `TaskRowItem.tsx` | Same | Keep |
| Conversation button with the comment count | `TaskRowItem.tsx` | Same place. Quiet icon and count. It opens the to-do on Conversation | Change |
| Project tile (22 px) | `TaskRowItem.tsx` | Same. It is the project picture, not an icon tile | Keep |
| Lead picture and lead menu of an office to-do. The helper "+" is hidden on a phone; "Add a helper" sits in the lead pop-up | `project/tasks/TaskPeople.tsx` | Same. The press area grows to 44 px on a phone | Change |
| Drag grip at the end of a Today row (not in Coming up) | `project/tasks/RowGrip.tsx` | On a touch phone the grip is `sr-only` and press and hold moves the row. Both come from `SortableTaskRows` and `RowGrip`, built once by the Work track. A keyboard and a screen reader keep the grip | Change |
| Keyboard reorder with Space and the arrow keys on the grip | `project/tasks/SortableTaskRows.tsx`, `DragLayer.tsx` | Same | Keep |
| Row slides away on a tick, and back on Undo | `TaskRowItem.tsx` | Same | Keep |
| Meetings today card: my meetings that are on or to come, 3 rows at most, no card when none | `MeetingsCard.tsx` | Fourth block | Keep |
| Meeting row: time and title. A press opens the meeting sheet | `MeetingsCard.tsx` | Same. Adds the line "kind · project" and a chevron | Change |
| Join button on the meeting row | `features/meetings/meetingLinks.ts` | New on the row, only when `mainAction` gives `join`. The sheet keeps its own Join, Edit and Cancel | New |
| Meeting link format `/meetings?meeting=<id>` (also in notices) | `src/lib/meetings.ts` | Same. It must open the meeting sheet on Work, Meetings. Add a test from the card row | Keep |
| Link "All meetings" | `MeetingsCard.tsx` | Same word. It opens `/meetings` (Work tab, Meetings view) | Keep |
| Push ask card: one line and the button "Turn on notifications" | `PushAskCard.tsx` | Last block, with a bell icon | Change |
| Push error line, iPhone steps card, Android install card | `PushAskCard.tsx` | Same | Keep |
| No card after an answer, for a person who turned push off, and in the prototype | `PushAskCard.tsx` | Same | Keep |
| "Your projects" title, project count, project rows, row menu, Admin and member rule, empty line, list error with Retry | `HomeScreen.tsx`, `projects/ProjectListRow.tsx` | Work, view Projects (the Work area builds it). The desk keeps it here | Move |
| Row press starts the project read, and the tile grows into the header | `ProjectListRow.tsx`, `src/app/sharedLayout.ts` | Desk only on Home | Desk-only |
| Link "All projects" | `HomeScreen.tsx` | Desk only | Desk-only |
| Early read of `projects.list` in the first request (cost 20 of 30) | `HomeScreen.tsx`, `homeCache.ts` | Not sent on a phone. The Home read has other keys than the Projects screen, so Work, Projects loses nothing | Hide-on-phone |
| Role hint in localStorage | `roleHint.ts` | Runs as today. On a phone it feeds no read | Keep |
| Home draws nothing until `session.get` and both `tasks.list` reads answer. A stored answer shows at once | `HomeScreen.tsx` | Same | Keep |
| Load error with Retry (`LoadFailed`) | `HomeScreen.tsx` | Same | Keep |
| To-do sheet over Home by `?task=`, `&project=`, `&thread=1` | `HomeTaskSheet.tsx` | The D to-do (the To-do area builds it). The link format stays | Change |
| Push notice link `/?task=` opens the to-do | `src/main.tsx`, `HomeTaskSheet.tsx` | Same | Keep |
| Old Projects links at "/" with filters redirect to `/projects` | `HomeOrRedirect.tsx` | Same. `/projects` is part of the Work tab | Keep |
| Stored Home answers on the device (IndexedDB) | `homeCache.ts` | Same. A phone record holds no `projects.list` | Change |
| Warm of the to-do sheet chunk 1 s after fresh data, warm of the drag chunk at idle, early read of today's meetings | `HomeScreen.tsx`, `TodayPanel.tsx` | Same | Keep |
| Roles Admin, Management, Accounting, Member: same blocks. No money block on Today | `HomeScreen.tsx` | Same. Money stays in the project Overview and on the Dashboard | Keep |
| A person with no led to-do sees no ring | `src/lib/home.ts` | Same | Keep |
| Bell with the unread count | `src/app/TabPill.tsx` | Inbox tab badge: unread chats plus the bell count (the Shell and Inbox areas) | Move |
| Person picture and person menu | `src/app/PersonMenu.tsx` | Me tab (user icon) | Move |
| Search icon | `src/app/TabPill.tsx` | Top row, one global icon | Keep |
| Madar mark: a press opens Home | `src/app/AppShell.tsx` | Top row, start side | Keep |
| Home tab in the tab pill | `src/app/nav.ts` | Phone tab "Today", route `/`. The desk keeps "Home". The words "Madar, Home" and "Go to Home" stay | Change |

#### Motion and look
Motion that Today keeps:
- The Next card swap: the old item lifts away, the new one rises (`NextCard.tsx`, spring with no bounce, 0.48 s).
- The day ring fills its stroke in 0.9 s, and sets 0 s for reduced motion (`DayRing.tsx`).
- The tick pops, and the row slides out toward the end side (`TaskRowItem.tsx`, `spring.standard` in `src/design/motion.ts`). Undo slides it back.
- The animated icons (arrow, timer, circle, message-circle) and `.pressable` on links and buttons.
- The `.screen-enter` rise of the blocks, once for each visit. `tokens.css` turns it off for reduced motion.
- The to-do sheet is a vaul sheet. The tab slide and the pill highlight belong to the shell.

New motion:
- The five blocks rise one after the other. This is the existing rule, now reached by the phone grid (see "How to build it").
- The bell in the push card plays once when the card shows (`AnimatedIcon`, `playWhen`). `AnimatedIcon` never plays it under reduced motion (`MotionConfig reducedMotion="user"`).
- The Join button and the chevron add no motion beyond `.pressable`.

Look and tokens:
- Use `.glow` for the Next card only. Use `.panel` for Today, Meetings and the push card. No coloured icon tile anywhere.
- Navy (`.signature`) goes to the one main button and the ring. The bell is `text-ink-2`. Join is a secondary button. The Focus button is plain.
- A state is a shape plus an ink word. Red is only for Late (the past-due word) and errors.
- The page title stays `text-page-title` with `--boost`. Numbers use `tabular`. Names use `<bdi>`.
- Use `start` and `end` classes only. The arrow and the chevron flip with `rtl:-scale-x-100`. The meeting time uses `clockFormat` (12-hour, as for all times).

#### Files to change
- `src/features/home/HomeScreen.tsx`: `useIsPhone`, the `phone` prop, blocks as direct grid children on a phone, no project section and no What's new link on a phone, `enabled: !phone` on the project read.
- `src/features/home/MeetingsCard.tsx`: the line "kind · project", the chevron, the Join button.
- `src/features/home/PushAskCard.tsx`: the bell icon on the three cards.
- `src/features/project/tasks/TaskPeople.tsx`: the 44 px press area of the lead button on a phone. Probe it with `elementFromPoint`.
- `src/app/useIsPhone.ts`: add `isPhoneNow()`.
- `src/app/remote/homeCache.ts`: `homeKeys(role, today, phone = false)`, and the two callers `show` and `collect`.
- `src/i18n/real/phoned.en.json` and `phoned.ar.json`: one new word, `phoned.today.joinLabel`. English: "Join {{title}}". Arabic: «انضم إلى {{title}}». It is the label for screen readers.
- `src/features/home/TodayPanel.tsx`: no change. Check that the link opens the To-dos view of Work after the Work area merges.
- `src/CLAUDE.md` and `DESIGN.md`: fix in the same commit every line that says Home is a two-column page. In `src/CLAUDE.md`: the `homeKeys` list, the tab pill line, the Home paragraph, the grip line for Coming up, and the date line with the What's new link. In `DESIGN.md`: the shell tabs line and the Home order line ("then Your projects"). Add one What's new entry.
- Unit tests that stay as they are (jsdom is not a phone): `HomeScreen.test.tsx`, `HomeInstant.test.tsx`, `HomeRoleHint.test.tsx`, `HomeRenders.test.tsx`, `TodayOrder.test.tsx`, `homeCache.test.ts`.
- New phone tests (stub `matchMedia` to true):
  - `HomePhone.test.tsx`: no "Your projects" list, no `projects.list` call (`renderHeldRemoteApp` `asked`), no What's new link, the blocks are direct children of the grid, and a turn to landscape starts the list.
  - `HomeInstant.test.tsx` and `homeCache.test.ts`: a phone record holds no `projects.list`, and `HOME_NAMES` still holds it.
  - `HomeRoleHint.test.tsx`: on a phone the hint is written and no project read starts.
  - `HomeScreen.test.tsx`: the status line shows after `tasks.approve`, and after a finish made inside the opened to-do.
  - `MeetingsCard.test.tsx`: the subline and the chevron show, Join shows only for a link within 30 minutes of the start, and `/meetings?meeting=` still opens the sheet.
- Browser specs that wait for `homeRows` or "Your projects" under 640 px: `tests/e2e/calm.spec.ts`, `tests/e2e-deploy/calm.spec.ts`, `tests/e2e-deploy/walk.spec.ts` (390 px), `tests/e2e/work.spec.ts`. They must wait for the "Next for you" title. The tab bar test belongs to the Shell area.
- `src/app/firstLoadImports.test.ts` and `scripts/check-bundles.ts`: no new first-load code. Run them to confirm.
- Screenshots (EN and AR, light and dark, 390 px) of the blocks, with a Member and with the Admin. Include a past-due row, an office to-do row, and a meeting with a link.

#### My calls
- The project list does not mount on a phone (no CSS hide). A hidden list still costs rows and a read.
- Today rows take the press and hold of the Work track with no work of their own (lead decision). The grip stays for the keyboard and screen readers as `sr-only`.
- Keep the one-count rule (audit PER-12): "N reviews waiting" shows only when the ring is empty.
- Keep the meeting subline on fields that `meetings.list` already sends (`kind`, `project.name`).
- The Join button shows only within 30 minutes of the start, so a row has one more control only when the person needs it.
- What's new has no dot on the Me tab (owner rule). The word "New" shows on the Me row.
- Reuse the existing `.screen-enter` rule. The phone grid change is the only change needed.

#### Questions only the owner can answer
None.


### Work: To-dos and the Board

#### Today on the phone
- The tab bar has icon tabs only: Home, Projects, Tasks, Dashboard (with `dashboard.view`) and Inbox. The Tasks tab also stays open on `/meetings` (`src/app/nav.ts`, `src/app/TabPill.tsx`).
- The top row holds the Madar mark, Search, the bell and the person picture (`src/app/AppShell.tsx`).
- The screen has the title "Tasks", the main button "New office to-do" and one control row. The row holds the To-dos and Meetings switch and the View button (`WorkScreen.tsx`, `WorkSwitch.tsx`, `WorkViewButton.tsx`).
- On a phone the View button opens a sheet with two radios, List and Board (`FilterButton.tsx`). The choice stays on the device (`workView.ts`, key `madar.work.view`).
- The List shows the review group, then up to five date groups. A row has a tick, a text block, a conversation button, a project tile or a people picture, and a drag grip (`WorkTasks.tsx`, `TaskRowItem.tsx`, `RowGrip.tsx`).
- The Board is the project board (`TaskBoard.tsx`) with 15 rem columns in a plain sideways scroll. Each card has a grip and a Move menu at the top end.
- The whole card carries the pointer drag start today (`TaskBoard.tsx` line 105). Only the grip carries the start on a List row.
- A press on a row or a card opens the to-do through `?task=<id>`. This area needs no contract, server or MCP change.

#### D on the phone
Every rule below applies only under 640 px (`useIsPhone()`, `max-sm:`). The desk keeps its code, its pill, its bell and the word "Tasks". Test each change in the prototype and in the real build.

1. **Top row and tab.** The shell track draws both. Work is a tab root, so the top row shows the Madar mark at the start and the one global Search icon at the end. It shows no bell and no back link. The Work tab (word «العمل» in Arabic) is open on `/work`, `/meetings`, `/projects` and `/projects/*`, also `/projects/code/:code`. It does not take `/tasks`: that route belongs to the Me tab. A press on the tab opens `/work`, which is the To-dos view.
2. **Title row.** Build one `WorkHeader` (new, `src/features/work/WorkHeader.tsx`). It draws `ScreenTitle` with the title "Work" and the one main button at the end. The three screens call it and pass their own button, so each screen keeps the state of its own sheet. The button follows the view: "New office to-do" (right `task.add`, office), "New meeting" (`usePlanRights().any`) or "New project" (right `project.create`). `ScreenTitle` wraps its button to a second line when the two do not fit. Test the Arabic title next to the Arabic button at 360 px.
3. **Control row.** The switch takes the full width with three equal segments: To-dos, Meetings, Projects. The third segment opens `/projects` and starts the Projects reads on pointer down (`usePressReads()('/projects')`). The desk switch keeps two segments. The View toggle (step 4) sits at the end of the row, in the To-dos view only. Use `px-3` and `whitespace-nowrap` in the segments. Measure the English and Arabic words at 360 px and 390 px.
4. **Keyboard focus in the switch.** `SegmentedControl` moves the focus to the new radio, but the route change mounts a new header and the focus is lost. `WorkSwitch` sends `state: { focusSwitch: true }` with `navigate`. `WorkHeader` puts the focus on the checked radio when it finds the state. Add a keyboard test.
5. **View toggle.** One press switches List and Board. There is no sheet and no radio. The button is 44 px and round. It shows the kanban icon in both states and has `aria-pressed`. When the Board is on, the button has the `bg-fill-strong` fill and a 1 px ink ring. A press on it warms the Board code and starts the done read, as `onPrepare` does now.
6. **List.** The first group is "Waiting for my review", with no count badge. It shows only when a to-do waits for the person. The next groups are Past due, Today, This week, Later and No date. A to-do in review is never past due: its past date lists under Today. A group with no row is not drawn. Keep `TaskGroup`, `SortableGroup` and `groupMyTasks`.
7. **Row.** Keep `TaskRowItem`. The tick is 44 px. The text block opens the to-do. The conversation button opens it on its Conversation part and keeps its count. The end holds the project tile, or the people picture for an office to-do.
8. **Press and hold to change the order.** Hold a row for 400 ms with the finger still. The row lifts. Move it up or down in its group, then lift the finger. A drag never leaves its group and never changes a date. Build it in these steps:
   - Add `useDragSensors(distance, coordinateGetter)` (new, `src/features/project/tasks/dragSensors.ts`). On a phone with a touch screen it returns `MouseSensor`, `TouchSensor` (delay 400, tolerance 8) and `KeyboardSensor`. Elsewhere it returns `PointerSensor` and `KeyboardSensor`. The list passes distance 4 and `sortableKeyboardCoordinates`. The Board passes distance 8 and `columnKeys`. The desk keeps both values. Keep the option objects as module constants (RN-5).
   - Only `DragLayer.tsx` and `TaskBoard.tsx` import `dragSensors.ts`. `RowGrip`, `SortableTaskRows` and `TaskRowItem` are first-load files. `check-bundles` fails if the dnd-kit marker enters the first load. They decide "touch phone" with `useIsPhone()` and `usePointerCoarse()` only.
   - The row box that holds `drag.ref` takes the `listeners` of dnd-kit. It does not take the `attributes`, so the row gets no `role="button"`. The grip keeps `setActivatorNodeRef`, the `attributes` and the keyboard. `KeyboardSensor` starts only from the grip.
   - On a touch phone `RowGrip` draws `sr-only` in place of the visible grip. A keyboard and a switch control still reach it.
   - The row box gets `pointer-coarse:select-none`, `pointer-coarse:[-webkit-touch-callout:none]` and `touch-action: manipulation`. These are the classes of `MessageBubble.tsx`.
   - A long press on a touch screen can fire `contextmenu` and then a click. Reuse the two rules of `useLongPress` (`features/inbox/longPress.ts`): stop `contextmenu` for touch, and ignore a click within 250 ms of a drag end. `DragLayer` wraps `onOpen` for the second rule, as the Board does with `droppedAt`.
   - The lifted row keeps the look of today (`surface`, `shadow-float`) and adds `scale(1.02)`.
9. **Hint line.** After the last group: "Press and hold a to-do to change its order." Use `text-footnote text-label-2`. It shows on a touch phone, in the List view, when a group holds two rows or more that the person can move. It shows only after the drag layer has loaded, because a hold before that does nothing. `WorkScreen` calls `warmDragLayer()` on mount (only Home calls it today).
10. **Empty state, load error and first load.** Keep `EmptyState` "All clear" and `LoadFailed` with Retry. Keep the empty screen until the first read answers. The real build fills it from the Home cache.
11. **Open a to-do.** Keep `?task=`, `&project=` and `&thread=`. The To-do track decides how the opened to-do looks. Do not change `openTask` in `src/lib/params.ts`. Every link to `/work` and `/work?task=<id>` keeps its address (Search "Go to my to-dos", Home "All tasks", notice and push links, What's new entries, the Open action of "To-do created."). Each one opens To-dos with the Work tab lit.
12. **Board.** Build it from `TaskBoard`. The project To-dos tab shares the component, so tell the Project track.
    - The lane scrolls sideways and snaps: `snap-x snap-mandatory overscroll-x-contain`, columns `snap-start`, `scroll-ps-4` and `max-sm:auto-cols-[calc(100%-3rem)]`. The percent resolves against the content box of the lane (`px-4`). At 390 px a column is 310 px wide, and at 360 px it is 280 px. The next column shows an edge of about 52 px. All of it uses logical properties, so Arabic runs right to left.
    - The first column is To do. A column header shows the word and the count. The Done header adds "Last 7 days" (new word).
    - Under the lane sit four dots, one for each column. A press on a dot scrolls to that column. The open dot follows the lane (`IntersectionObserver`, not `scrollLeft`, so it works in RTL). Each dot has a 44 px press area and a name such as "To do: 3".
    - A card keeps its face (`CardFace`): title, project name or "Office", "Your review", date word, flag, lead picture, waiting line. A press opens the to-do.
    - Hold a card for 400 ms to lift it. The `li` of the card takes the `listeners` (mouse and touch), and the wrapper of the Move menu stops `onMouseDown` and `onTouchStart` as well as `onPointerDown`. While any drag runs (finger or keyboard) the lane has `snap-none`. A finger drag scrolls the lane at its edges (`autoScroll`). A keyboard drag uses the scroll that `KeyboardSensor` does for the new place. Test that the target column comes into view and that the open dot follows.
    - The point of the drop. After a touch hold, `activatorEvent` has no `clientX`, and the tracker hears only `pointermove` and `pointerup`. The tracker also listens to `touchmove` and `touchend` (`changedTouches[0]`). `onDragEnd` returns early only when the activator is a `KeyboardEvent`. Add a phone test: hold a card, drop it on a closed column, expect the toast.
    - The Move menu (44 px, top end) stays. It is the sure way to move a card on a phone. Its items stay as they are for each kind of card: the reviewer gets Done and "Send back with a note"; the lead of a card in review gets To do and In progress; a card with no lead gets To do and In progress. A drop on a closed column gives three toasts, one for each kind (see the table).
    - The card title uses `max-sm:pointer-coarse:pe-12` in addition to `pe-24`, because the grip is gone. The desk keeps `pe-24`.
    - An empty column on a phone shows one quiet line (new word) and keeps its height as a drop target.
13. **New office to-do sheet.** Keep `NewOfficeTaskSheet`. `Sheet.tsx` already uses `100dvh` and the safe-area padding on a phone, so this sheet needs no change.
14. **Other users of the hold.** `SortableTaskRows` also feeds the Today panel (`TodayPanel.tsx`, `draggable={!coming}`) and the project To-dos tab. They get the hold with no work of their own. The hint line stays in the Work List only. The checklist items in the to-do keep their visible grip (`ChecklistRow.tsx`), because that drag layer is separate. The To-do track may change this.

#### Every feature and its place
| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Tasks tab, icon only | `app/nav.ts`, `app/TabPill.tsx` | Work tab, icon and word, route `/work` (shell track) | Change |
| Tab open on Meetings | `isNavActive` in `app/nav.ts` | Work tab open on `/work`, `/meetings`, `/projects`, `/projects/*`; not `/tasks` | Change |
| Bell and top row | `app/AppShell.tsx` | Mark and Search only (shell track) | Change |
| Screen title "Tasks" | `WorkScreen.tsx` (`screens.myWork`) | Title "Work" on a phone (new key); the desk keeps "Tasks" | Change |
| One entrance for To-dos, Meetings, Projects | `screenKey` in `app/AppShell.tsx` | One entrance for the three views on a phone | Change |
| Main button "New office to-do" | `WorkScreen.tsx` (`office.new`) | Same button, top end of the title row | Keep |
| Main button follows the view | none | New meeting on Meetings, New project on Projects | Change |
| Main button hidden without `task.add` (office) | `WorkScreen.tsx` (`useRight`) | Same rule | Keep |
| To-dos and Meetings switch | `WorkSwitch.tsx` | Phone: three segments, To-dos, Meetings, Projects, full width. Desk: two | Change |
| Projects as a view of Work | Projects tab | Third segment, opens `/projects` | Move |
| Switch arrow keys and radio group | `components/SegmentedControl.tsx` | Same, and the focus survives the route change | Change |
| Slide of the switch highlight | none | The thumb has a `layoutId` (`spring.standard`); it slides across the view change (lead decision) | Change |
| Entry links to `/work` and `/work?task=` | `SearchScreen.tsx`, `TodayPanel.tsx`, `lib/params.ts`, `NewOfficeTaskSheet.tsx`, `whatsNew/entries.ts` | Same address, To-dos view, Work tab lit | Keep |
| View button List or Board | `WorkViewButton.tsx`, `FilterButton.tsx` (sheet on a phone) | 44 px toggle at the end of the control row | Change |
| View popover with radios | `FilterButton.tsx` (from 640 px) | Stays on the desk | Desk-only |
| View choice stays on the device | `workView.ts` | Same key | Keep |
| View button only on To-dos | `WorkScreen.tsx` | Same | Keep |
| Board code warm at idle, done read on press | `WorkScreen.tsx`, `WorkBoardLazy.ts` | Same | Keep |
| Drag layer warm on a direct visit | `TodayPanel.tsx` only | `WorkScreen` calls `warmDragLayer()` | Change |
| Group "Waiting for my review" | `WorkTasks.tsx` (`TaskGroup`) | First group, no count badge | Keep |
| Review rows have no drag | `WorkTasks.tsx` | Same | Keep |
| A to-do in review shows once | `WorkBody` in `WorkTasks.tsx` | Same | Keep |
| Date groups Past due, Today, This week, Later, No date | `lib/myWork.ts` | Same groups, same order. A to-do in review is never past due | Keep |
| Week rule on Friday and Saturday | `lib/myWork.ts` | Same | Keep |
| Order in a group: own rows first, helped rows last | `lib/myWork.ts` (`groupMyTasks`) | Same | Keep |
| Tick circle, 44 px | `TaskRowItem.tsx` | Same | Keep |
| Tick blocked: waits for another to-do (toast) | `TaskRowItem.tsx` | Same | Keep |
| Tick blocked: no lead (toast) | `TaskRowItem.tsx` | Same | Keep |
| Tick: row slides away, toast "To-do done." or "Sent to review." with Undo | `TaskRowItem.tsx` | Same | Keep |
| Plain mark: done check, dashed circle in review, grey circle | `TaskRowItem.tsx` | Same | Keep |
| Title, struck when done | `TaskRowItem.tsx` | Same | Keep |
| Version badge | `TaskRowItem.tsx` | Same | Keep |
| Helper line "Helper · Lead: name" | `TaskRowItem.tsx` (`HelperLine`) | Same | Keep |
| Status word In progress or In review | `TaskRowItem.tsx` | Same | Keep |
| Due word, start text, late sign | `TaskRowItem.tsx`, `lib/due.ts` | Same | Keep |
| Line "Waiting for" with names | `TaskRowItem.tsx` | Same | Keep |
| Flag word | `TaskRowItem.tsx` | Same | Keep |
| File count | `TaskRowItem.tsx` | Same | Keep |
| Project name or the word Office in the text block | `TaskRowItem.tsx` (`showProject`) | Same | Keep |
| Conversation button with count | `TaskRowItem.tsx` | Same 44 px button; opens the to-do on Conversation | Keep |
| Project tile at the row end | `TaskRowItem.tsx` | Same | Keep |
| People picture and pop-up on an office row, with "Add a helper" | `TaskPeople.tsx` | Same (the small "+" is already off on a phone) | Keep |
| Row hover tint | `TaskRowItem.tsx` | Not on a touch screen | Desk-only |
| Drag grip on a row | `RowGrip.tsx` | `sr-only` on a touch phone, visible with a mouse | Hide-on-phone |
| Press and hold to change the order | none | Hold 400 ms on the row, drag, drop | Change |
| Drag start on the whole row | grip only (`DragLayer.tsx` line 32) | Row box takes the mouse and touch listeners; grip keeps the keyboard | Change |
| Click and `contextmenu` after a hold | none on the List; `droppedAt` on the Board | 250 ms click guard and touch `contextmenu` stop on the List | Change |
| Keyboard reorder with Space and arrows, with spoken places | `DragLayer.tsx` | Same, from the `sr-only` grip | Keep |
| Toast "Order saved." with Undo | `DragLayer.tsx` | Same | Keep |
| A drag stays in its group and never changes a date | `DragLayer.tsx` | Same | Keep |
| No grip for a group of one row or a row the person cannot move | `RowGrip.tsx` | Same; no blank spacer on a phone | Keep |
| Hold also applies to the Today panel and the project To-dos tab | `TodayPanel.tsx`, `SortableTaskRows.tsx` | Same hold, no hint there | Change |
| Checklist items keep a visible grip | `ChecklistRow.tsx`, `ChecklistDrag.tsx` | Same (To-do track may change it) | Keep |
| Hint "Press and hold a to-do to change its order." | none | One quiet line after the last group, touch phone, List only | Change |
| Empty state "All clear" | `WorkTasks.tsx` (`EmptyState`) | Same | Keep |
| Load error with Retry | `WorkTasks.tsx` (`LoadFailed`) | Same | Keep |
| Empty screen while the first read loads; Home cache in the real build | `WorkTasks.tsx`, `minePlaceholder.ts` | Same | Keep |
| Open a to-do from a row (`?task=`, `&project=`) | `WorkTasks.tsx` (`openTask`) | Same link; the To-do track builds the next-step view | Keep |
| Open a to-do on its conversation (`&thread=`) | `TaskRowItem.tsx` | Same link | Keep |
| Close the to-do (removes the link parts) | `WorkTasks.tsx` | Same | Keep |
| Focus mode (25 minutes) from the to-do | `ProjectTaskSheet` header | Not in this area; the To-do track keeps it | Keep |
| Sheet "New office to-do", with its fields, note and toast | `NewOfficeTaskSheet.tsx` | Same vaul sheet; no change to `dvh` or the safe area | Keep |
| Board columns To do, In progress, In review, Done | `TaskBoard.tsx` | Same four, in a snap lane (310 px at 390 px) | Change |
| Column header with count | `TaskBoard.tsx` (`Column`) | Same | Keep |
| Done column holds the last 7 days | `boardRows.ts` (`doneWindow`) | Same, and the header says "Last 7 days" | Change |
| Done read only while the Board shows | `WorkTasks.tsx` | Same | Keep |
| Review cards first, my cards next, done newest first | `boardRows.ts` | Same | Keep |
| A to-do in my list and my review queue shows once | `boardRows.ts` | Same | Keep |
| Card title with version badge, project name or "Office", "Your review", date text, flag, lead picture, waiting line | `TaskBoard.tsx` (`CardFace`) | Same | Keep |
| Press on a card opens the to-do, but not in the 250 ms after a drop | `TaskBoard.tsx` | Same | Keep |
| Drag of a whole card | pointer, 8 px (`TaskBoard.tsx`) | Mouse 8 px; touch uses the 400 ms hold | Change |
| Grip on a card | `TaskBoard.tsx` | `sr-only` on a touch phone, visible with a mouse | Hide-on-phone |
| Move menu with the status targets | `TaskBoard.tsx`, `lib/board.ts` (`moveTargets`) | Same 44 px button, same items for each kind of card; the main way on a phone | Keep |
| Menu item "Send back with a note", for the reviewer | `TaskBoard.tsx` | Same; opens the to-do ready for the note | Keep |
| Review right for each card | `WorkBoard.tsx` (`reviews`) | Same | Keep |
| Approve with a move to Done | `TaskBoard.tsx` | Same | Keep |
| Closed column message while a card is lifted | `TaskBoard.tsx` (`tasks.dropClosed`) | Same | Keep |
| Toast after a refused drop: "This to-do waits for the leader to approve it." (lead of a card in review), "Not yet. Give this to-do a lead first." with Open (no lead), the send-back text with Open (reviewer) | `TaskBoard.tsx` | Same three toasts; reached after a touch hold (see step 12) | Change |
| Sheet for a move back: reason, 280 letters, and the optional tick "Log this move in the Tracker as a Balady update" when the server says `canLog` | `StageBack.tsx` | Same bottom sheet; the tick row is 44 px | Keep |
| Toast "Moved to ..." or "Sent to review." with Undo | `TaskBoard.tsx` | Same | Keep |
| Lifted card and drop animation | `TaskBoard.tsx` (`DragOverlay`) | Same | Keep |
| Keyboard drag between columns, with spoken columns | `TaskBoard.tsx` (`columnKeys`) | Same, from the `sr-only` grip; the lane scrolls the target column into view | Change |
| Empty board "All clear" | `WorkBoard.tsx` | Same | Keep |
| Empty column | `TaskBoard.tsx` | One quiet line, same height | Change |
| Load error with Retry (includes the done read) | `WorkTasks.tsx` | Same | Keep |
| Board code in its own chunk | `WorkBoardLazy.ts` | Same | Keep |
| Dots under the lane | none | Four dots, each a 44 px button | Change |
| Lane scrolls at its edge while a card is lifted | none | New (`autoScroll`, snap off) | Change |
| Card title space for the Move menu, top end | `TaskBoard.tsx` | Title keeps 48 px free on a touch phone, 96 px elsewhere | Change |

#### Motion and look
- Keep the row entrance and exit slide, the tick pop, the toasts, the vaul sheet and the drop animation of the card. Keep the animated icons `CircleCheckIcon`, `MessageCircleIcon`, `FolderKanbanIcon` and `GripVerticalIcon`. Press feedback uses `.pressable`. `MotionConfig reducedMotion="user"` covers the Motion parts.
- Look: no coloured icon tiles. A state is a shape plus an ink word. Use `surface rounded-card` for a group and `text-headline` for its title. Use `text-footnote text-label-2` for the hint. Use `bg-fill` for the lane columns and the switch. Use `shadow-float` for a lifted item.
- Navy (`signature`) stays on the one main button and the open tab. This area adds no other navy. The dots use `bg-ink` for the open dot and `bg-fill-strong` for the rest. Red stays for Late and errors.
- New: a held row or card lifts with `scale(1.02)` and `spring.drop`. With reduced motion it keeps the shadow and has no scale.
- New: the open dot slides (`layoutId="board-dot"`, `spring.standard`). A press on a dot scrolls with `behavior: 'smooth'`. With reduced motion the scroll is `behavior: 'auto'`.
- New: the swap between List and Board fades for 150 ms (`fade` of `design/motion.ts`). With reduced motion it is instant.
- dnd-kit moves the other rows with a CSS transition. Pass no transition under `prefers-reduced-motion`, and set `dropAnimation` to `null` for the card.
- Safari on iPhone: the safe area, `dvh` and the hold must work in a Home Screen app. Test with the WebKit iPhone profile in a delegated Playwright run.

#### Files to change
- `src/app/nav.ts` and `src/app/AppShell.tsx`: the Work tab rule and the one entrance for the three views. The shell track owns both. This area gives the rule.
- `src/features/work/WorkHeader.tsx` (new), `WorkScreen.tsx`, `WorkSwitch.tsx`, `WorkViewButton.tsx`: the title row, the three segments, the toggle, the focus state. `MeetingsScreen.tsx` and `ProjectsScreen.tsx` call `WorkHeader` and pass their own button.
- `src/components/SegmentedControl.tsx`: add an optional full-width phone mode and an optional press callback for one option. `src/components/ScreenControls.tsx`: no wrap on a phone.
- `src/features/work/WorkTasks.tsx`: the hint line. `WorkScreen.tsx`: `warmDragLayer()`.
- `src/features/project/tasks/dragSensors.ts` (new, imported only by `DragLayer.tsx` and `TaskBoard.tsx`), `DragLayer.tsx`, `SortableTaskRows.tsx`, `RowGrip.tsx`, `TaskRowItem.tsx` (the `RowDrag` type gets the row listeners): hold, `sr-only` grip, click guard, lift look.
- `src/features/project/tasks/TaskBoard.tsx`: snap lane, dots, Done note, empty column line, sensors, row listeners on the card, the Move menu stop, the touch point tracker, the free space at the end of the card title. `src/features/work/WorkBoard.tsx`: pass the Done note.
- `src/i18n/real/phoned.en.json` and `phoned.ar.json`: new words (`nav.work`, `screens.work`, `workView.doneRange`, `workView.holdHint`, `workView.columnEmpty`, the dot names, the toggle name). Arabic follows the Thmanyah style, with Western digits. Add a What's new entry for the release.
- No change to `src/api`, `server/` or the MCP files. `readMap.ts` and `homeKeys` stay.
- Tests that pin the old phone layout and must change: `src/app/TabPillLabels.test.tsx` (tab names, with a 4-tab case), `src/app/rr2Shell.test.tsx` (phone tab text), `src/app/PressReads.test.tsx` (the Tasks tab). Also in `tests/e2e` and `tests/e2e-deploy`: `owner.spec.ts` (the 390 px tab bar test), `shell.spec.ts` (390 px tab names), `work.spec.ts` (390 px shots and the sideways scroll check) and `full.spec.ts` (the 390 px sweep of `/work`). `acceptance.spec.ts` runs at 1440 px, so its "Tasks" heading stays.
- Tests that pin the desk stay as they are: `WorkBoard.test.tsx`, `WorkOrder.test.tsx`, `DragLayerSwap.test.tsx`, `WorkTasks.test.tsx`, `WorkRenders.test.tsx` and `BoardWave4.test.tsx`. Add phone tests with `matchMedia` set to `(max-width: 639px)` and a coarse pointer. Cover the toggle, the three segments, the switch focus, the sensors, the hint, the dots, the empty column, the keyboard drag scroll, and the three refused-drop toasts after a touch hold. Cover the three kinds of card in the Move menu and the `canLog` tick in the move-back sheet. Keep the render-count rule: a to-do that opens must not render the rows or the cards again.

#### My calls
- The word "Waiting for my review" stays on the List group, with no count badge. `DESIGN.md` allows a badge on the Inbox and the bell only. The Board keeps "Your review" on the card.
- The group titles keep the `text-headline` look of today, not the small capital labels of the mock.
- The coloured dots and the tinted chips of the Board mock are not built. A status is a shape plus an ink word. The card keeps its date words and its late sign.
- The View toggle shows the kanban icon in both states. The shell track must not use that icon for the Work tab.
- The switch highlight slides (lead decision). The thumb of the `fill` switch has a `layoutId`. On a phone the shell joins `/work`, `/meetings` and `/projects` in one `screenKey`, so the entrance does not replay, and Motion plays the shared layout from the old header to the new one in the same commit. No sheet state is lifted. If the slide does not play in the build, ship the switch without it and say so in the report. With reduced motion the thumb jumps.
- The hold time is 400 ms and the move limit is 8 px. The chat long press uses 500 ms. Reorder happens more often, so it is a little shorter.
- The hint line is always on for a touch phone, with no stored state. It adds no control and needs no memory.
- The grip stays in the page as `sr-only` for the keyboard and a switch control. It adds no VoiceOver action. This is the same as today.
- On a touch phone, `MouseSensor` and `TouchSensor` replace `PointerSensor`. dnd-kit advises this. The 400 ms delay lets a swipe scroll the page and the lane.
- The Board always opens on To do. It does not open on the column that holds a review.
- Dots are buttons. A swipe alone does not reach a screen reader user.

#### Questions only the owner can answer
None. The lead rules answer the old question about the name: the desk keeps "Tasks", and the phone says "Work".


### Work: Meetings and Projects

No contract, server or MCP change in this section. Every change runs only under `useIsPhone()` (`src/app/useIsPhone.ts`, under 640 px). The desk keeps its 5-tab pill, the word "Tasks", and the screens as they are.

#### Today on the phone
- Meetings is the second view of the Tasks tab at `/meetings`. `MeetingsScreen.tsx` shows the title "Tasks", a two-option switch (To-dos, Meetings) and "New meeting". The groups are panels with hairline rows.
- A meeting row is one button: time, title, "kind · project", and a 28 px project tile (`MeetingRow.tsx`). Join, Edit and Cancel live only in the sheet (`MeetingSheet.tsx`, footer by `viewerCan`, fbk_037).
- `MeetingRow` in `src/api/contract/views.ts` has `attendeeCount`, `mine`, `seriesId` and `repeat`. It has no `viewerCan`, no names and no guest count. This stays.
- Projects is its own tab at `/projects` (`ProjectsScreen.tsx`). It has the title, "New project" and one Filter button. A sheet holds all choices. The screen has no search field.
- `ProjectListRow.tsx` fits a phone today: two-column grid, 34 px tile with the sub-company logo, the stage line, avatars, and a press-and-hold menu (500 ms). Home shows the same row.
- The jsdom unit tests run as a desktop (`matchMedia` is false), so they do not pin the phone layout. The Playwright suites run at 390 px and do pin it: `tests/e2e-deploy/calm.spec.ts` 13-40 (Home project rows, one glow, one signature), `acceptance.spec.ts` (heading "Tasks"), `full.spec.ts` 26-58 (every screen, clicks the Projects link).
- The meeting view (`/dashboard/meeting`) has a phone shape today: it shows the project screens and hides the timeline (`MeetingView.tsx`, `useIsPhone`).

#### D on the phone
Both views sit under the Work tab. The routes `/work`, `/meetings` and `/projects` stay. A notice, the Home card, the Dashboard, the Tracker entry link and the project Overview keep their links. The Work tab stays lit on `/projects/:id` too (the shell section changes `isNavActive`, `tabOf` and the Back link).

**Frame of the Work tab (shared with the To-dos section)**
1. One component, `src/features/work/WorkHeader.tsx`, built once by the Work track (the To-dos section describes it). It takes the main button as a prop. It stays mounted across the three views (lead decision, see the main design file), so the switch pill slides.
2. Row 1: the title "Work" (`text-page-title`) and the main button at the end. Meetings gives "New meeting". Projects gives "New project". Each keeps its right gate.
3. Row 2: `WorkSwitch` with three options: To-dos, Meetings, Projects. It is full width. Each option is 44 px high or more and cannot wrap.
4. `WorkSwitch.tsx` shows the third option on a phone only. The value comes from the path: `/work`, `/meetings`, `/projects`. Projects goes to `/projects`.
5. `SegmentedControl.tsx` gets an optional `fill` prop (full width, equal options, no wrap). With `fill`, a pill slides to the chosen option (`motion.span`, `spring.standard`, a `layoutId` that the caller passes, `work-switch` for Work and `inbox-views` for Inbox; a `useId` value would change at each mount and stop the slide across the view change). Without `fill`, the control stays as it is. The Sub-company choice in the New project sheet uses the same control with icons, so it must not change.
6. The top row of the screen is the shell row: the Madar mark at the start and the one Search icon at the end. This section adds no other icon there.
7. On a phone, `MeetingsScreen` and `ProjectsScreen` draw `WorkHeader` in place of `ScreenTitle` and `ScreenControls`.
8. A press on a segment starts the reads of its view (`app/pressReads.ts`). `SegmentedControl` gets an optional pointer-down prop for this. The inputs come from `meetings/readInputs.ts`.

**Meetings view, top to bottom**
1. The frame.
2. The groups Today, This week and Later, in this order. Each group is one `surface` panel with its heading and hairline rows. A group with no meeting does not show.
3. The fold "Earlier (n)" after the groups. It stays last, as in the code. The mockup draws it first, but the next step must come first.
4. One quiet line at the end: "Your meetings also go to Google Calendar." It shows only when `google.status` gives `state: 'ok'` (real build). In `not_synced` the line stays hidden, because some meetings did not reach Google. Keep space above the tab bar.
5. Empty state: the one line "You have no meeting in the next 60 days." The main button stays in the header.
6. The list takes one 60-second tick (one hook for the list, not one for each card). A card then moves to "Now" and "Done", and Join appears, on a screen that stays open. The tick stops when the page is hidden.
7. A link with `?meeting=<id>` opens the sheet over the list also when no card matches. The project Overview and the Tracker entry link to meetings of other people, and the list shows only my meetings.

**The meeting card** (new `MeetingCard` in `MeetingRow.tsx`; `MeetingListRow` stays for the desk)
1. The info block is one button of 44 px or more. A press opens the sheet with `?meeting=<id>`. The lines, in order:
   - Line 1: the kind word in `text-footnote`. After it comes the state as a shape and an ink word (`StatusSign`): "Now" `on_track`, "Done" `completed`, "Cancelled" `archived`. A meeting with no state shows no sign.
   - Line 2: the title, `text-headline`, at most two lines, `dir="auto"`. A cancelled title has a line through it.
   - Line 3: the time range with `meetings.range`. In Today it is the clock only. In This week it adds the weekday and day. In Later and Earlier it adds the short date. Times are 12-hour, Western digits in Arabic.
   - Line 4: the place, if it is plain text. A place that is a link does not show on the card.
   - Line 5: the project with `ProjectTile` (size 24) and its name, or the word Office.
   - Line 6: "N people" from `attendeeCount`, then the repeat line (`series.line.*`, `series.lineUntil.*`) if the meeting repeats.
2. Under the lines, only when the meeting has a Join, one hairline and one `secondary` anchor "Join". It shows when `mainAction(row, now(), null)` gives `join`. The `Button` component renders a `<button>` only, so Join is an anchor with the secondary class string. Navy stays only on "New meeting". The Join in the sheet keeps its navy look, because there it is the one main button.
3. The card has no Edit, no Cancel and no "Add the minutes". These stay at the bottom of the sheet, by `viewerCan` (fbk_037). The card adds no `viewerCan` to the row.
4. "Open in Google Maps" of a site visit stays in the sheet only. The card has no project pin.
5. `MeetingCard` is a `memo` component with plain props. The handler comes from `useStableHandler`, so a sheet that opens redraws no card.

**The meeting sheet** stays a vaul bottom sheet. It keeps every fact and every button, with no change. The link "Open the team meeting view" stays (right `dashboard.view`), because the meeting view works on a phone today.

**Projects view, top to bottom**
1. The frame, with "New project" as the main button.
2. One row: the search field (flex 1) and the Filter button (44 px). The Filter button keeps its count and opens the sheet (`FilterButton.tsx`, phone branch).
3. Under that row, the chips for a data gap and for a health value, with their buttons "Show all projects" and "Show all health". They show only when a link sets them.
4. The panel with `ProjectListRow` rows, unchanged. Tile stays 34 px (the design system wins over the 44 px of the mockup).
5. Empty, error and load states as today.
6. The defaults stay as today: Show All, Status Active, Sort Last update. A link can set any filter.

**The search field** (new `ProjectSearch.tsx`, no contract change)
1. It filters the rows that `projects.list` already gave. It matches the name, the code, and the client name in both languages, with `normalizeForSearch` (`src/lib/text.ts`) and `searchWords` (`src/lib/searchMatch.ts`).
2. The text stays in local state, in a small child component. `ProjectsBody` gets a memoized filtered array. The text is not in the link and does not count in the Filter badge.
3. Use the `field` class (17 px), so Safari on iPhone does not zoom. The icon is `AnimatedIcon` with `SearchIcon`.
4. When no row matches, show the empty state with the button "Show all projects". The button clears the text and the filters.

**New project sheet** stays as it is: a `wide` vaul sheet with the same fields, the cover upload bar, and the draft that survives an accidental close. Only the opener moves to the Work header.

#### Every feature and its place
| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Screen title | Meetings "Tasks", Projects "Projects" | "Work" on all three views of a phone. The desk keeps "Tasks" | Change |
| Work switch | Two options To-dos, Meetings (`work/WorkSwitch.tsx`) | Three options, full width, Projects goes to `/projects` | Change |
| Pill of the switch | Static highlight on the chosen option (`SegmentedControl.tsx`) | Pill slides, with `fill` only. No wrap | Change |
| Arrow keys and radio roles of the switch | `SegmentedControl.tsx` | Same, also in Arabic (RTL arrows) | Keep |
| Projects tab of the bar | `app/nav.ts` item `/projects` | Part of the Work tab (shell section) | Merge |
| Work tab lit on `/meetings`, `/projects`, `/projects/:id` | `isNavActive`, `tabOf` in `app/nav.ts`, `AppShell.tsx` | Shell section changes both. Back on a project goes to `/projects` with the saved filters | Merge |
| Routes `/meetings`, `/projects` and their query links | `app/routes.tsx` | Same addresses, same filters | Keep |
| Link `meetingLink` from notices, Home, project Overview, Tracker entry | `lib/meetings.ts`, `ProjectMeetings.tsx`, `tracker/EntrySheet.tsx` | Opens Work, Meetings, with the sheet, also with no matching card | Keep |
| New meeting button (a plan right) | `MeetingsScreen.tsx`, `meetings/planRights.ts` | End of the Work title row, Meetings view | Keep |
| Plan a meeting in the project Overview | `project/overview/ProjectMeetings.tsx` (`viewerCan.planMeeting`, `MeetingForm` `project` prop) | Same. The project section owns it. The Work header is not the only way | Keep |
| New project button (`project.create`) | `ProjectsScreen.tsx` | End of the Work title row, Projects view | Keep |
| Reads that start on a press | `app/pressReads.ts` (`/projects` only) | Press on the Projects and Meetings segments | Change |
| Meetings read (7 days back, 60 ahead, mine) | `MeetingsScreen.tsx` | Same call. The input moves to `readInputs.ts` | Keep |
| Group Today, This week (Friday and Saturday rule), Later | `meetings/groups.ts` | Three panels in this order | Keep |
| Empty group does not show | `groups.ts` | Same | Keep |
| Fold "Earlier (n)" | `MeetingsBody` | Last, a 52 px panel row with a chevron | Change |
| Rows of Earlier with the short date | `MeetingsScreen.tsx` | Same cards, state "Done" or "Cancelled" | Keep |
| Empty state and load error with Retry | `EmptyState` `meetings.empty`, `LoadFailed` | Same | Keep |
| A press opens the sheet (`?meeting=`) | `MeetingRow.tsx`, `lib/params.ts` | Press on the info block of the card | Keep |
| Kind word | Inside "kind · project" | Own first line of the card | Change |
| State "Now", "Done", "Cancelled", line through the title | Word after the dot | Shape and ink word (`StatusSign`) | Change |
| Time states move by themselves | Computed at render only | One 60-second tick for the list | Change |
| Title | One line, truncated | Headline, two lines | Change |
| Time and day | Left column, 80 px | Range line, with the day before it outside Today | Change |
| Times: 12-hour, Western digits in Arabic | `clockFormat` in `lib/dates.ts` | Same. No clock setting | Keep |
| Place as plain text | Sheet only | Line on the card | Change |
| Place that is a link | Sheet only | Not on the card. Join and the sheet show it | Hide-on-phone |
| Project tile and name, word Office | Tile 28 px | Tile 24 px | Keep |
| People count | None in the list | "N people" (new word) | Change |
| Repeat line | Sheet only | Line on the card. The sheet keeps it | Change |
| Join | Sheet footer (`meetingLinks.ts`) | Card, `secondary` anchor, from 30 minutes before the start. The sheet keeps its navy Join | Change |
| Edit, Cancel meeting, Delete meeting (cancelled), Add the minutes | Sheet footer and body, by `viewerCan` | Same, sheet only | Keep |
| Open in Google Maps (site visit with a pin) | Sheet footer, `mainAction` | Same, sheet only | Keep |
| Faces of the people (mockup) | None | Not built. The row has no names | Hide-on-phone |
| Google Calendar note | Settings only (`GoogleCalendarSection.tsx`) | Quiet line at the end of the list, `state: 'ok'` only | Change |
| Sheet: title, kind and state; When; Where; Project link or Office note; Organizer; People; Guests; Notes | `MeetingSheet.tsx` | Same | Keep |
| Sheet: Minutes (text, file chips, "By", day), Edit the minutes, Add the minutes, Open in the Tracker | `MinutesPart.tsx` | Same | Keep |
| Sheet: link "Open the team meeting view" (`dashboard.view`) | `MeetingSheet.tsx` | Same. The meeting view has a phone shape (project screens, no timeline) | Keep |
| Question "Cancel this meeting?" (Keep meeting has the focus) | `CancelSheet` in `MeetingSheet.tsx` | Same, not moved | Keep |
| Questions "This meeting" or "This and later meetings" (cancel, delete, save) | `ScopeSheet.tsx` | Same | Keep |
| Toasts "Meeting cancelled.", "Meeting deleted.", "Meeting planned.", "Meeting saved." with Undo | `MeetingSheet.tsx`, `MeetingForm.tsx` | Same | Keep |
| Sheet state "This meeting is not available." and error with Retry | `Unavailable` | Same | Keep |
| Form: Kind (4 kinds, sets the length), Title, Project (list follows plan rights; "No project" needs a right), Day, Time (15-minute steps), Length | `MeetingForm.tsx`, `TimeField.tsx` | Same sheet | Keep |
| Form: People ticks with hint and count; Where (site visit starts with the project address); fold "More" | `PeoplePicker`, `MeetingForm.tsx` | Same | Keep |
| Form: Repeat and Until (new meeting only); Guests and Notes | `MeetingForm.tsx` | Same | Keep |
| Form: button "Plan meeting" or "Save changes"; edit variant (no Project, no Repeat, only changed fields); locked after the end (only Notes change) | `MeetingForm.tsx` | Same. Opens from the sheet | Keep |
| Form: notice line "The attendees get a notice."; refusal of the server in the form | `MeetingForm.tsx` | Same | Keep |
| Minutes sheet: text, attach, files that stand, remove, picked files with progress bar, drop and paste, Save the minutes with Undo, refusal `minutes_changed` | `MinutesSheet.tsx`, `Attachments.tsx`, `ChatDropArea` | Same | Keep |
| Search my meetings icon (mockup only) | None | Not built. The shell Search covers the office | Hide-on-phone |
| Search projects field | None | New field, left of Filter. Filters the loaded list | Change |
| Filter button with count | `FilterButton.tsx` | Same, next to the search field | Keep |
| Filter sheet: Show (All, My projects, Needs attention) | `ProjectsScreen.tsx` | Same sheet | Keep |
| Filter sheet: Stage, Team, Leader, Client | `ProjectsScreen.tsx` | Same | Keep |
| Filter sheet: Sub-company, with "No sub-company" (only if the office has any) | `ProjectsScreen.tsx` | Same | Keep |
| Filter sheet: Status (Active, Paused, Completed, Archived, All statuses) | `ProjectsScreen.tsx`, `status.*` words | Same | Keep |
| Filter sheet: Sort (Last update, Next deadline, Name), kept on this device | `projects/sort.ts` | Same | Keep |
| Chip for a data gap, with "Show all projects"; chip for a health value, with "Show all health" | `ProjectsScreen.tsx` | Under the search row | Keep |
| Filters in the link (Dashboard, notices) | `ProjectsScreen.tsx` | Same | Keep |
| Project row: tile with sub-company logo, name, state word (Late, At risk, Paused, Awaiting client, Stale, Completed, Archived), client | `ProjectListRow.tsx`, `ProjectStateWord` | Same | Keep |
| Project row: stage name and stage line, next deadline or "Stage ends" with the past-due tone, avatars (leader first, "+N") | `ProgressLine`, `NextDeadlineLabel`, `AvatarStack` | Same | Keep |
| Project row: press opens the project, tile and name grow into the header; read of the project on pointer-down | `ProjectListRow.tsx`, `usePrefetchCall` | Same | Keep |
| Press-and-hold menu: Open, Post update (`postUpdate`), Copy link, Archive with Undo toast (`archive`) | `projects/cardMenu.ts` | Same | Keep |
| Empty state "No projects" with "Show all projects"; error "The projects did not load." with Retry | `ProjectsBody` | Same. Also shown when the search text matches nothing | Keep |
| List glide when rows change | `LayoutGroup`, `AnimatePresence` | Same | Keep |
| Back link keeps the filters | `app/lastList.ts` | Same, back goes to Work, Projects | Keep |
| Project list on Home ("Your projects": Admin sees all active; others see mine, any status, by deadline; count line, empty line, "All projects" link) | `home/HomeScreen.tsx` | Leaves Today if the Today section moves it. The Projects view then holds it, with its own defaults | Move |
| Payments of a project | Inside the project Overview, for the payment roles | Same. Not in this section | Keep |
| New project sheet: opens from the main button; Name | `NewProjectSheet.tsx`, `usePrepareNewProject`, `ProjectFields.tsx` | Same | Keep |
| New project sheet: template picker, plan line, stretch ticks, roles | `TemplateUse.tsx` | Same | Keep |
| New project sheet: Client picker and inline new client (button needs `client.create`; form has English name, Arabic name, contact, phone, email, initials) | `ProjectFields.tsx`, `ClientForm.tsx` | Same | Keep |
| New project sheet: Sub-company (needed when the office has any; logo buttons up to 5, a select above 5; fills itself) | `ProjectFields.tsx` (`SubCompanyPicker`) | Same. It uses `SegmentedControl` without `fill` | Keep |
| New project sheet: Project code (parts, typed by hand, same as another project; initials from the client; class; building type; live preview; "Use this code anyway") | `ProjectCodeFields.tsx` | Same. Check the preview line at 360 px and 390 px, English and Arabic | Keep |
| New project sheet: Leader; Area, Contract start, Start, End; stage list; Team ticks; Model folder and Description | `ProjectFields.tsx` | Same | Keep |
| New project sheet: Location (address, Pinned on the map, Open in Google Maps, Set or Change, Remove) and the pin sheet (place search, paste of a link or coordinates, Swap them, layers, drag the pin, Use this place) | `ProjectFields.tsx`, `map/PinSheet.tsx`, `PinPicker.tsx` | Same. Test the map pan against the vaul swipe-to-close on Safari on iPhone | Keep |
| New project sheet: Cover and upload bar; Cancel and Create; draft kept after an accidental close; after Create: toast and go to the new project | `NewProjectSheet.tsx` | Same | Keep |

#### Motion and look
- Reuse `.pressable` (97% press), `.screen-enter`, the vaul `Sheet` (the page steps back to 97%), and the `AnimatedIcon` icons (`PlusIcon`, `SearchIcon`, `ChevronDownIcon`, `SlidersHorizontalIcon`). Each icon plays when its control opens.
- Pill slide of the switch: new. `motion.span` with a `layoutId` from `useId` and `spring.standard`, as in `components/Tabs.tsx`. The id differs from the `pill-active` id of the tab bar. `MotionConfig reducedMotion="user"` (`main.tsx`) removes the movement.
- Entrance: on a phone, `screenKey` in `AppShell.tsx` returns one key for `/work`, `/meetings` and `/projects`. A move between the views then plays no second entrance (shell section owns the file).
- Fold "Earlier": the list fades in with `fade` (200 ms). The chevron turns with `transition-transform motion-reduce:transition-none`. With reduced motion, the list shows at once.
- List glide: the cards use `motion.li layout="position"` with `spring.standard` inside a `LayoutGroup`, as `ProjectListRow` does. Reduced motion removes it.
- No new motion for the card. The Undo toast slides as today.
- Look: tokens only. Panel `surface rounded-card`, hairlines, `text-headline` for the title, `text-subheadline` for lines, `text-footnote` and `ink-2` for the kind. No coloured tile or pill. A state is a shape and an ink word. Red only for Late and errors. The destructive button in the sheet keeps its grey fill with red text.
- Navy (`signature`) stays on "New meeting" or "New project", on the open tab, and on the Join of the sheet. Join on the card is not navy.
- Arabic and RTL: logical sides only (`ms-`, `ps-`). Use `bdi` or `dir="auto"` for titles, places and project names. Check the longest Arabic button at 360 px and 390 px.
- Dark mode: tokens only, no hex values. A phone test checks the card in both themes.
- Safari on iPhone: the search field is 17 px. All targets are 44 px or more. The last card and the calendar line clear the tab bar and the safe area. Check WebKit.

#### Files to change
- `src/features/work/WorkSwitch.tsx`: third option on a phone, `fill`, path value for `/projects`.
- `src/components/SegmentedControl.tsx`: optional `fill` prop (no wrap, sliding pill), optional pointer-down prop. The desk look does not change.
- `src/features/work/WorkHeader.tsx`: new, shared with the To-dos section.
- `src/features/meetings/MeetingsScreen.tsx`: phone header, `MeetingCard` list, the 60-second tick, the Google Calendar line (`google.status`), motion.
- `src/features/meetings/MeetingRow.tsx`: add `MeetingCard`. Keep `MeetingListRow`.
- `src/features/meetings/readInputs.ts`: add the input of the Meetings view, so the screen and the press read share it.
- `src/features/projects/ProjectsScreen.tsx`: phone header, search row, client-side filter.
- `src/features/projects/ProjectSearch.tsx`: new field.
- `src/app/pressReads.ts`: reads of the Meetings and Projects segments (`meetings.list`, `google.status`). `src/app/AppShell.tsx` (`screenKey`, `tabOf`, Back link) and `src/app/nav.ts` belong to the shell section.
- `src/i18n/real/phoned.en.json` and `phoned.ar.json`: the new words (below).
- `src/whatsNew/entries.ts`: one entry, as the owner rule asks for each change.
- No change in `src/api`, `server/` or `server/mcp`.
- Tests to add or change:
  - Phone variants in `MeetingsScreen.test.tsx`, `ProjectsScreen.test.tsx` (the `matchMedia` method of `ComposerKeys.test.tsx`). The sheet has no change, so `MeetingSheet.test.tsx` stays.
  - A test for the card: Join only, no Edit, no Cancel, no minutes link; a link place does not show; the tick moves a card to "Now".
  - `src/features/projects/ProjectSearch` test: match by name, code and client in both languages; empty state; Filter badge ignores the text.
  - `src/app/PressReads.test.tsx`: the new press reads.
  - `SegmentedControl` test: without `fill` nothing changes; the Sub-company picker keeps its look.
  - Playwright: update `calm.spec.ts`, `acceptance.spec.ts`, `full.spec.ts`, `shell.spec.ts` in `tests/e2e` and `tests/e2e-deploy` (title "Work", Projects link, Home rows). Both suites are part of the merge gate.
  - `AppShell.test.tsx` and `rr2Shell.test.tsx` pin the old bar. The shell section changes them.
- New words (English / Arabic):
  - `phoned.work.title`: "Work" / «العمل».
  - `phoned.meetings.people` with plural forms: "1 person", "{{count}} people" / «شخص واحد»، «شخصان»، «{{count}} أشخاص»، «{{count}} شخصًا»، «{{count}} شخص».
  - `phoned.meetings.googleLine`: "Your meetings also go to Google Calendar." / «تصل اجتماعاتك أيضًا إلى تقويم Google.»
  - `phoned.projects.search`: "Search projects" / «ابحث في المشاريع».
  - The switch label Projects reuses `screens.projects`.

#### My calls
- Join is the only button on the card. Edit and Cancel stay in the sheet, because the row has no `viewerCan` and D adds no field. Join is `secondary`, because navy is for the one main action.
- The card shows "N people" and not faces. The row has no names.
- "Earlier" stays last, as in the code. The mockup draws it first.
- The kind is a text word, not a coloured pill. "Now" uses the green sign. "Done" uses the check sign and "Cancelled" uses the square sign, both grey.
- A place that is a link stays off the card. Join and the sheet show it. The Maps button for a site visit is in the sheet only.
- The Google Calendar line shows for `state: 'ok'` only, so the sentence is true. The owner can drop the line to save one read.
- The 60-second tick runs for the list as one hook. A Realtime refresh also redraws the cards.
- The Projects search field is allowed by the lead rule. It filters the loaded list. Remove it if the owner wants fewer controls.
- The press-and-hold menu of a project row stays a menu that floats at the finger. If the Inbox section builds a shared bottom-sheet menu, use it here.
- Project tiles stay at 34 px. The New project form stays as it is.
- No batch B feature (@everyone, quiet hours) touches Meetings or Projects.

#### Questions only the owner can answer
- Today a person who is not an Admin sees only their own projects on Home, and the whole office on Projects. If "Your projects" leaves Today, should a non-Admin open Projects on "My projects" by default on a phone? My advice: no. Keep All as today. "My projects" is one tap in Filter, and the default needs a stored choice.


### A project

#### Today on the phone
- The project page has 7 tabs in one row that scrolls sideways (`src/features/project/tabs.tsx`, `src/components/Tabs.tsx`): Overview, To-dos, Activity, Tracker, Schedule, Files & Links, Team. The Payments panel sits in Overview (payment roles). The post box sits in Activity.
- The header hides its back link under 640 px. The shell top row shows the back link, Search, the bell and the person menu (`ProjectHeader.tsx`, `src/app/AppShell.tsx`).
- The stage list, the health form and the people list of a to-do row open as small pop-ups (`Popover`): `StageControl.tsx`, `HealthControl.tsx`, `tasks/TaskPeople.tsx`. Other pop-up menus stay too: More actions (up to 9 items), Files Add, the file row, the post, the team row, the template menu. A `Menu` closes on any scroll or resize (`src/components/Menu.tsx`), and the iOS address bar triggers both.
- Schedule already shows a list of stage dates and no chart under 640 px (`schedule/ScheduleTab.tsx`, `useIsPhone`). This list is editable today, so it stays editable.
- A to-do row has a drag grip. A board card has a grip and a Move menu, and the board scrolls sideways (`tasks/RowGrip.tsx`, `tasks/DragLayer.tsx`, `tasks/TaskBoard.tsx`).
- The Files tab has one grey "Add" menu (Upload a file, Add a link). It shows only with `file.upload` or `project.links`. The picture preview is a sheet with a plain image and no zoom. The row menu is the only way to preview (`files/FilesTab.tsx`, `files/PreviewSheet.tsx`).
- The Tracker tab runs in this order: Open loops, the quick log form, then History with Filter and Export. The Filter filters History only (`tracker/TrackerTab.tsx`).
- `useIsPhone` (under 640 px) and `max-sm:` classes switch the phone layout. In the unit tests `matchMedia` answers false, so every desk test stays valid.

#### D on the phone
Paths are inside `src/features/project/` unless they start with `src/`. The desk (640 px and wider) stays as it is. Every change sits behind `useIsPhone`.

**Top row (shell work).** The back link "Projects" at the start. The one global Search icon at the end. No bell and no person picture. The link uses `projectsListLink()` (Work, Projects view with its filters). The Work tab is lit on `/projects/*` (shell section). The page keeps `PROJECT_PAGE` out of the entrance slide.

**1. Identity row.** `ProjectTile` (48 px, sub-company logo), the name (`text-page-title`, balanced wrap), and at the end the "More actions" button (`ProjectActions`, 44 px). Under the name: the full code, the client and the "View only" tag. The tile and the name keep the shared glide (`HeaderShell`, `layoutId`).

**2. Stage row.** The `StageControl` button (stage name, chevron), the text "Stage 5 of 7", and at the end the sign (`HealthControl`). The sign is the health word (Late, At risk), or for a project with no health the status sign (Paused, Awaiting client, Stale, Completed, Archived). On track shows nothing to a person who may not set it. `ProgressLine` runs full width under the row (`size="md"`). The deadline label leaves the header (see Overview panel 1).

**3. Action row.** "Post update" and "Project chat" (grey, message icon), each half width. With one of them missing, the other takes the row. With both missing, the row does not show. Navy goes to one button on each tab. That button is "Log a new line" on Tracker (only with `viewerCan.logTracker`), the "Add" menu on Files (only with `file.upload` or `project.links`), and "Post update" on every other tab. On Tracker and Files, "Post update" turns grey only when the tab button shows. On Overview, "Post update" turns grey while the update box holds text, and the box button turns navy (both read one stored draft).

**4. Paused banner** (`PausedBanner`) under the action row, full width. Everyone sees the text. Resume and "Set a new date" show only with `viewerCan.archive`, 44 px.

**5. Tab row.** `Tabs` gets a `spread` prop: five equal columns, no side scroll, `text-caption`. The row is sticky at `top: env(safe-area-inset-top)` on a solid `--c-bg` (no blur). Tabs: Overview, To-dos, Tracker, Files & Links, More. Arabic: «نظرة عامة»، «المهام»، «المتابعة»، «الملفات والروابط»، «المزيد». The row is 44 px high. A long word wraps to two lines. The underline keeps its `layoutId` slide. A tab change scrolls to the tab row when it is out of view.

**6. Tab bodies.**
- **Overview.** Panels in this order. Meetings shows only when a meeting is near or the person may plan one.
  1. Where the project stands: "To-dos in this stage", "Stage end", the moved-back note, the health note and who set it. A row "Next deadline" (`NextDeadlineLabel`) shows when the project has a named deadline. A missed deadline shows in the Attention color, because Coming up lists future dates only. With no deadline and no stage end, the panel says "No deadline".
  2. Needs attention. The groups are Past due, Waiting for review, Flagged, "Awaiting payment" (payment roles, due in 7 days or late), Waiting for the client. "N more" stays plain text.
  3. Payments (payment roles). The panel stays in Overview, as today.
  4. Updates: the post box and the two newest posts. "See all activity" opens More, Activity.
  5. Meetings. 6. Coming up. 7. Who is doing what. 8. About.
- **To-dos.** Row: "Filter" and "View: List" (same two buttons as Work, same key `madar.tasks.view`). Then the stage groups. A group title shows "3 of 6 done" under the filter All, and today's count under any other filter (the list is filtered on the server). The last row of a group is "+ Add a to-do" (`NewTaskSheet`; "From a template" at the end of the row).
- **Tracker.** In this order: the main button "Log a new line" (or the "You cannot log" line), the panel "Open" (Open loops, never filtered), then the panel "History" with a row "Filter" and "Export" (`tracker.export`) above the weeks. The log form opens in a bottom sheet (`QuickLog` inside `Sheet`, "Log it" in the footer). After "Log it" the sheet closes and the Undo toast shows. The type and the side stay as set for the next entry in `TrackerTab` state.
- **Files & Links.** One "Add" menu (Upload a file, Add a link) and the stage pick beside it. The links list stays above the files. No drop hint. A picture or a PDF row opens its preview from the thumbnail or the name, and from the row menu.
- **More.** One panel with three rows: Activity, Schedule, Team. A row opens that tab body as a sub-page with a 44 px back row "‹ More" and the title. The More tab stays lit. The links `?tab=activity|schedule|team` open the sub-page on a phone. `?tab=more` is the list. On a desk `?tab=more` opens Overview.

**7. Sheets, not pop-ups.** New `src/components/SheetOrPopover.tsx`: `Popover` on a desk, `Sheet` (vaul) on a phone, same children. `StageControl`, `HealthControl` and `TaskPeople` use it. `Menu` gets a `sheetOnPhone` prop: a bottom sheet of 44 px rows, same items. It is on for More actions, the Files "Add" menu and the file row menu. The post menu, the team row menu and the template menu stay as pop-up menus (one or two items).

**8. Press and hold, and the board.** The project To-dos list and its board use the one build of the Work section (steps 8 and 12 of "Work: To-dos and the Board"): `SortableTaskRows` with press and hold (400 ms, 8 px) and the `sr-only` grip, and `TaskBoard` with the snap lane, the dots, the hold on a card and the Move menu that stays. The project track builds no second hold. The checklist in the task panel keeps its grip (To-do section).

**9. File preview.** On a phone a picture opens in `src/components/ImageViewer.tsx` (full screen, the gestures of today, no zoom buttons). Previous and Next show only for a caller with several views (the meeting drawings strip). A PDF shows a sheet with one button "Open the PDF". The button is a real link (`<a target="_blank">`) made after the signed link has loaded, so Safari for iPhone does not block it. The desk path (sheet, iframe) stays.

#### Every feature and its place
Paths are inside `src/features/project/` unless they start with `src/`.

| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Back link "Projects" | `ProjectHeader.tsx` (hidden under 640 px), `src/app/AppShell.tsx` | Top row, start side. Goes to `projectsListLink()` | Keep |
| Search, bell, person picture on the top row | `src/app/AppShell.tsx` | Search stays at the end. Bell and picture leave (shell work) | Change |
| Project tile with sub-company logo | `ProjectHeader.tsx`, `src/components/ProjectTile.tsx` | Identity row, 48 px | Keep |
| Glide of tile and name from the tapped row | `ProjectHeader.tsx` (`HeaderShell`, `layoutId`) | Same | Keep |
| Project name, full code, client, "View only" tag | `ProjectHeader.tsx` | Identity row | Keep |
| More actions button | `ProjectActions.tsx` | Identity row, end side, icon only, 44 px. Opens a bottom sheet of rows | Change |
| Menu items: Edit project, Change leader, Apply a template, Pause, Resume (no banner), Mark as active, Mark as completed, Archive | `ProjectActions.tsx` | Same items, same rights | Keep |
| Menu item: Delete project (red) | `ProjectActions.tsx` (`DeleteProjectSheet`) | Same item. The sheet asks once. After it the person goes to `projectsListLink()` | Keep |
| Edit project sheet: details, stage editor (rename, add, remove), model folder, description, pin and address, code correction with the "Use this code anyway" tick (Admin) | `src/features/projects/EditProjectSheet.tsx`, `ProjectFields.tsx` | One wide sheet, as today. Check it at 390 px, with the pin picker sheet over it | Keep |
| Change leader sheet (pick, Save, no Undo) | `ProjectActions.tsx` (`LeaderSheet`) | Bottom sheet, as today | Keep |
| Pause sheet: Internal or Client, reason, restart day | `ProjectActions.tsx` (`PauseSheet`) | Bottom sheet, as today | Keep |
| Apply template: list step, confirm tick, second step | `ApplyTemplateSheet.tsx`, `src/features/settings/admin/LinkProjectSheet.tsx` | Two bottom sheets, as today | Keep |
| Post update button | `ProjectHeader.tsx` (`onPost`) | Action row, half width. Navy on Overview, To-dos, More. Grey where a tab button is the main action | Change |
| Link `?compose=1` (the Projects list row menu sends it with no tab) | `projects/cardMenu.ts`, `overview/Composer.tsx` | On a phone it opens Overview, scrolls to the update box and focuses it. `tab=activity&compose=1` does the same | Change |
| Project chat link | `ProjectHeader.tsx` (`detail.chatId`) | Action row, half width, grey. It opens `/inbox/<id>` (Inbox tab, full screen chat) | Change |
| Stage button and stage list (time order, Current marker, past checks) | `StageControl.tsx` | Stage row. The list is a bottom sheet through `SheetOrPopover` | Change |
| Stage details: dates, to-do count, overlap, waiting for. Prerequisite boxes, or text for a reader | `StageControl.tsx` | Same sheet, 44 px rows | Keep |
| Stage steps line | `src/components/ProgressLine.tsx` | Full width under the stage row | Change |
| Text "Stage n of m" | `ProjectHeader.tsx` (label only) | Visible text after the stage button | Change |
| Next deadline or "Stage ends" label, and "No deadline" | `ProjectHeader.tsx`, `src/features/projects/ProjectCard.tsx` (`NextDeadlineLabel`) | Leaves the header. Row "Next deadline" of Overview panel 1. A missed deadline stays visible | Move |
| Health word (Late, At risk) | `HealthControl.tsx` | End of the stage row. A button for a person with the right | Keep |
| Status sign for a project with no health (Paused, Awaiting client, Stale, Completed, Archived) | `HealthControl.tsx` (`ProjectSign`), `src/components/StatusSign.tsx` | Same slot as the health word. Every non-active project keeps it | Keep |
| Health form: value, reason, computed note, Clear, Save | `HealthControl.tsx` | Bottom sheet through `SheetOrPopover` | Change |
| Health "set by" name and reason (hover title) | `HealthControl.tsx`, `overview/OverviewTab.tsx` | Overview panel 1 shows both. A phone has no hover | Move |
| Paused banner: who, when, why, restart day, "Awaiting client", stale days | `PausedBanner.tsx` | Full width panel under the action row | Keep |
| Resume project button, "Set a new date" field | `PausedBanner.tsx` (`viewerCan.archive`) | Banner, 44 px. Same right | Keep |
| Name and tile while the project loads | `ProjectScreen.tsx` (`HeaderShell`) | Same | Keep |
| "Project not found" page with back link | `ProjectScreen.tsx` | Same. The link uses `projectsListLink()` | Change |
| Load failed page with Retry | `ProjectScreen.tsx` | Same | Keep |
| Shared code page (two projects, one code) | `ProjectByCode.tsx` | Same | Keep |
| Tab row | `ProjectScreen.tsx`, `tabs.tsx`, `src/components/Tabs.tsx` | Five equal tabs, no side scroll, sticky, two lines allowed | Change |
| Tab in the link (`?tab=`) | `ProjectScreen.tsx`, `tabs.tsx` | Same keys. New value `more` (phone). On a phone `activity`, `schedule`, `team` light More and open the sub-page | Change |
| Inbound links to tabs: `team` (Admin deactivate sheet), `schedule` (Task list), `tracker` (Dashboard), `files&file=` (Search), `activity&update=` (notice link), `tasks&task=&thread=`, `tracker&entry=` | `settings/admin/DeactivateSheet.tsx`, `tasklist/TaskListScreen.tsx`, `dashboard/WaitingForUs.tsx`, `search/SearchScreen.tsx`, `src/api/handlers/notifications.ts`, `src/lib/params.ts` | All keep working. `tasks` on a phone is the To-dos tab | Keep |
| Filters kept across tabs | `tabs.tsx` (`FILTER_PARAMS`) | Same | Keep |
| To-do panel by `?task=` | `overview/OverviewTab.tsx`, `tasks/TasksTab.tsx`, `tasks/TaskSheet.tsx` | Same link. The panel is built in the "A to-do" section | Change |
| Where it stands: stage name, count, health word, steps | `overview/OverviewTab.tsx` (`Standing`) | Leave the panel. The header shows them | Merge |
| Where it stands: "To-dos in this stage" n of m, stage end date and days left or late | `overview/OverviewTab.tsx` | Panel 1, first two facts | Keep |
| Where it stands: "moved back" note with reason, health override note | `overview/OverviewTab.tsx` | Panel 1, under the facts, when they apply | Keep |
| Attention: Past due, Waiting for review, Flagged, "N more" text | `overview/OverviewTab.tsx` (`Attention`) | Panel 2. Three rows each. "N more" is not a button, as today | Keep |
| Attention: "Awaiting payment" (payment roles) | `overview/OverviewTab.tsx` | Same group. A row opens the payment sheet on Overview, as today | Keep |
| Attention: Waiting for the client, with Received or Answered | `overview/OverviewTab.tsx`, `tracker/OpenLoops.tsx` | Same group. A row opens the Tracker entry | Keep |
| Attention: "All clear" line | `overview/OverviewTab.tsx` | Same | Keep |
| Overview: space while to-dos load, load failed with Retry | `overview/OverviewTab.tsx` | Same | Keep |
| Payments panel (summary, Add payment, rows, sheet, Mark as received, Delete, kept draft, read-only sheet without `payment.change`) | `overview/OverviewTab.tsx`, `payments/PaymentsPanel.tsx`, `payments/PaymentSheet.tsx` | Panel 3 for the payment roles. No change in the panel. Meeting view and Dashboard share it | Keep |
| Post box (mention list, Attach, picked files with progress, paste a picture, Post) | `overview/Composer.tsx` (in `overview/ActivityTab.tsx`) | Overview, Updates panel. Compact until focus. The text goes to the draft store (`useDraftText`), so a tab change keeps it | Move |
| Post box: @everyone | `components/MentionField.tsx` | The project post box has none in main. The to-do conversation and the project chat have it. No change | Keep |
| Post box: "Drop files here" frame | `overview/Composer.tsx` (`ChatDropArea`) | A phone has no drag from outside | Hide-on-phone |
| "You cannot post" line | `overview/ActivityTab.tsx` | Updates panel, in place of the box | Move |
| Latest update, "No posts yet", "See all activity" | `overview/OverviewTab.tsx` (`LatestUpdate`) | Updates panel shows the two newest posts. The link opens More, Activity | Change |
| Meetings panel: next two meetings, Plan a meeting | `overview/ProjectMeetings.tsx` | Panel 5. Hides when no meeting is near and the person may not plan | Keep |
| Coming up: next four future deadlines | `overview/OverviewTab.tsx` (`ComingUp`) | Panel 6 | Keep |
| Who is doing what | `overview/OverviewTab.tsx` (`People`) | Panel 7, stacked rows | Keep |
| About: map of the pin, full screen button, code with class, sub-company, template, location, "Open in Google Maps", area, dates | `overview/ProjectPlace.tsx`, `overview/AboutPanel.tsx` | Panel 8 | Keep |
| To-dos: Filter (Show: All, Mine, Overdue, Flagged, No lead; Show done) | `tasks/TasksTab.tsx` (`FilterButton`) | Button 1. Opens a bottom sheet | Change |
| To-dos: View (List or Board) | `tasks/TasksTab.tsx` (inside Filter) | Own button "View: List", same choice and key | Change |
| To-dos: "N have no lead" line with "Show them", load failed with Retry | `tasks/TasksTab.tsx` | Same | Keep |
| Stage group title and count | `tasks/TaskList.tsx` | "3 of 6 done" under All, else today's count | Change |
| Empty stage line, empty filter result | `tasks/TaskList.tsx` | Same | Keep |
| Quick add field (Enter makes a to-do with no lead) | `tasks/TaskList.tsx` (`QuickAdd`) | Last row of each group | Move |
| "+" button, new to-do sheet (title, lead, due date) | `tasks/NewTaskSheet.tsx` | Start of the add row, 44 px | Keep |
| "From a template" menu | `tasks/TemplateMenu.tsx` | End of the add row | Keep |
| Reason sheet "This moves the project back", with the tick "Also log this in the Tracker as a government update" (only when `canLog`) | `tasks/StageBack.tsx` | Same bottom sheet. The tick row is 44 px. The sheet opens from quick add, new to-do, template and board move | Keep |
| Tick circle (finish or send to review), blocked tick toasts | `tasks/TaskRowItem.tsx` | Same, 44 px | Keep |
| Row words: title, version, status, due, starts, flag, file count, "Helper · Lead", waiting-for line | `tasks/TaskRowItem.tsx` | Same | Keep |
| Conversation button with count | `tasks/TaskRowItem.tsx` | Same, 44 px | Keep |
| People pictures and lead list, "Add a helper" row | `tasks/TaskPeople.tsx` | Bottom sheet through `SheetOrPopover`. The small "+" for helpers stays gone on a phone | Change |
| Drag grip on a row | `tasks/RowGrip.tsx`, `tasks/DragLayer.tsx` | Press and hold lifts the row (also checklist rows, Today and Work lists) | Change |
| Keyboard reorder, order saved with Undo toast | `tasks/DragLayer.tsx` | A hidden focusable control keeps it. Undo stays | Keep |
| Board columns To do, In progress, In review, Done; card face | `tasks/TaskBoard.tsx` | Side lane, 300 px columns, snap | Change |
| Board drag by pointer, grip | `tasks/TaskBoard.tsx` | Gone on a phone | Hide-on-phone |
| Board Move menu and "Send back with a note" | `tasks/TaskBoard.tsx` | One Move button and a press and hold open the sheet "Move to". "Send back with a note" opens the panel ready for the note | Change |
| Board toast for a closed column, spoken drag messages | `tasks/TaskBoard.tsx` | Desk only | Desk-only |
| Tracker: Log a new line | `tracker/TrackerTab.tsx`, `tracker/QuickLog.tsx` | Main button at the top (`viewerCan.logTracker`). It opens the sheet | Change |
| Quick log: text, five type tiles, side control, date field, "Waiting" or "Needs a reply" switch, who replies and by which day | `tracker/QuickLog.tsx`, `tracker/ReplyFields.tsx` | Inside the sheet. Reply fields keep `tracker.reply` plus `task.add`; naming another person keeps `task.assign` | Move |
| Quick log: Attach, picked files, paste | `tracker/QuickLog.tsx` | Inside the sheet. Attach keeps `file.upload` | Move |
| Quick log: drop frame | `tracker/QuickLog.tsx` (`ChatDropArea`) | A phone has no drag from outside | Hide-on-phone |
| "Logged." Undo toast, type and side kept for the next entry | `tracker/QuickLog.tsx` | The sheet closes. The toast shows above the page. The type and side live in `TrackerTab` state | Change |
| "You cannot log" line | `tracker/TrackerTab.tsx` | In place of the main button | Keep |
| Open loops: Waiting for us, Waiting for the client; Received or Answered with Undo | `tracker/OpenLoops.tsx` | Panel "Open" under the main button. Never filtered. 44 px buttons | Keep |
| Tracker Filter (type, side, open only) | `tracker/TrackerTab.tsx` | Row inside the History panel. It filters History only | Change |
| Export button and sheet (preview, CSV file, Copy for Excel) | `tracker/TrackerTab.tsx`, `tracker/ExportSheet.tsx` | Same row as Filter. Shows only with `tracker.export`. Bottom sheet, as today | Keep |
| History by week, entry line (file chips, closed-loop sign, "Minutes" word) | `tracker/History.tsx` | Panel "History". Lines wrap at 390 px | Keep |
| Entry sheet: details, files, people, who logged it, "Closed by", "Added automatically when..." lines | `tracker/EntrySheet.tsx` | Bottom sheet, as today | Keep |
| Entry sheet: Delete, Edit, Answered or Received, edit form, assign a reply, reply to-do link, meeting minutes with "Open the meeting" | `tracker/EntrySheet.tsx` | Same sheet, footer wraps | Keep |
| Tracker empty states, load failed with Retry; entry link `?entry=` | `tracker/TrackerTab.tsx`, `panelLink.ts` | Same | Keep |
| Files: Add menu (Upload a file, Add a link) | `files/FilesTab.tsx` | Top of the tab, one button. Navy on a phone when it shows. A bottom sheet of rows | Change |
| Files: stage pick for an upload | `files/FilesTab.tsx` | Beside the Add button | Keep |
| Files: "Received from the client" tick | `files/FilesTab.tsx` | Under the row (needs upload and deliver) | Keep |
| Files: "Drop files here" hint, drag-over frame | `files/FilesTab.tsx` | Gone on a phone | Hide-on-phone |
| Files: hidden multiple file picker, upload list with progress, too large and failed toasts with Retry | `files/FilesTab.tsx`, `src/features/files/Attachments.tsx` | Same. iPhone offers photos, camera and Files | Keep |
| Links list: open a link, Copy for an office path, path field by hand, Edit pencil | `files/ProjectLinks.tsx` | Above the files. 44 px | Keep |
| Links list: model folder row (no pencil, edited in Edit project) | `files/ProjectLinks.tsx` | Same | Keep |
| Link sheet: kind, name, address, Save, Remove. A Location link moves the map pin and looks up the address (up to 5 s) | `files/ProjectLinks.tsx` (`LinkSheet`) | Bottom sheet, as today. Save shows a busy state during the lookup | Keep |
| File groups by stage, file row (picture, name, version, cover tag, who and when, size), Versions toggle with Download | `files/FilesTab.tsx` | Same | Keep |
| Preview: open from a row | `files/FilesTab.tsx` | The thumbnail and the name open the preview on a phone. The menu item stays | Change |
| File menu: Preview, Download, Share, Mark as delivered, Set as cover, Delete (Undo) | `files/FilesTab.tsx` | Bottom sheet of rows, same items and rights | Change |
| Preview of a picture or a PDF | `files/PreviewSheet.tsx` (also used by `tasks/TaskSheet.tsx`, `dashboard/meeting/DrawingsStrip.tsx`) | Picture: `ImageViewer`. PDF: sheet with the link "Open the PDF". Desk path stays | Change |
| Share sheet: project chat, a person, a to-do, message. Toast action "Open" | `files/ShareFileSheet.tsx` | Bottom sheet, as today. Places depend on `file.share`, `chat.project`, `chat.direct`, `comment.create`. "Open" goes to `/inbox/<id>` or the to-do thread | Keep |
| Files empty state with Add button; file link `?file=` | `files/FilesTab.tsx` | Same | Keep |
| More list: Activity, Schedule, Team | none (new) | More tab, one panel, three rows, no icon tiles | Change |
| Back row "‹ More" | none (new) | Top of each sub-page, 44 px | Change |
| Activity: feed filter (All, Posts, Decisions, To-dos, Files) | `overview/ActivityTab.tsx` | Sub-page, Filter button | Move |
| Activity: post card (author, age, "Edited" tag, agent label, text, files, "Decision" label), post menu (Edit, Delete with Undo), inline edit form | `overview/FeedEntry.tsx` | Sub-page | Move |
| Activity: comments with reactions, emoji button, saved draft per person; system line with Undo for an agent change | `overview/FeedEntry.tsx`, `src/features/comments/CommentThread.tsx` | Sub-page. The emoji list is a sheet on a phone | Move |
| Activity: Show older, empty states, load failed with Retry, post from `?update=` | `overview/ActivityTab.tsx` | Sub-page. `?update=` scrolls to the post | Move |
| Activity: post box on top | `overview/ActivityTab.tsx` | Leaves. The box lives on Overview | Move |
| Schedule: chart with draggable stage bars, overlap hatch switch and legend | `schedule/ScheduleTab.tsx` | Not on a phone, as today | Desk-only |
| Schedule: stage dates list with Start and End fields (or text for a reader), overlap note, "No dates yet" | `schedule/ScheduleTab.tsx` (`StageDates`) | Sub-page. Editing stays on a phone | Move |
| Schedule: deadline list, edit sheet, delete (Undo), add form | `schedule/ScheduleTab.tsx` (`Deadlines`) | Sub-page, one column. Sheet as today | Move |
| Team: leader and members with open to-do count, discipline field, row menu "Make leader" and "Remove from team" | `team/TeamTab.tsx` | Sub-page. Remove stays hidden for the leader and for a person with open to-dos | Move |
| Team: Add a person form, Add a team form, empty lines | `team/TeamTab.tsx`, `team/AddTeam.tsx` | Sub-page | Move |

#### Motion and look
- Keep the tab underline slide (`layoutId`, `spring.standard`) in the new tab row. Under reduced motion it jumps.
- Keep the glide of tile and name (`spring.expand`), the stage steps that fill one by one (`.step-in`), the tick squeeze and the row slide-out (`TaskRowItem`). All obey reduced motion already (`MotionConfig reducedMotion="user"`, `prefers-reduced-motion` in `tokens.css`).
- Sheets for Stage, Health, People, Log a line, Move to, More actions and the Add menus use `Sheet` (vaul). Motion and the page step-back come with it.
- Every row, button and tab keeps `.pressable`. The More rows use `AnimatedIcon` for the chevron and play it on open.
- New motion 1: a row lifted by press and hold scales to 1.02 and takes `shadow-float` (`spring.drop`). Reduced motion: no scale, the shadow only.
- New motion 2: the sub-page of More slides in from the end side (`spring.standard`, `motion.div` with `x` and opacity). `MotionConfig` drops the slide under reduced motion and the 200 ms `fade` stays.
- Look: panels use `.panel` or `.surface`. No coloured icon tiles. A state is a shape plus an ink word. Navy (`signature`) goes on the one main button of the tab. The tab underline stays ink. Red is for Late and errors, and for the destructive item "Delete project", as today. Text scales with `--boost`: check that the five tab words fit at the Big screen size (1.08) in English and Arabic at 360 px.
- Logical sides only (`start`, `end`). The "‹" in the back row and the chevrons flip in Arabic (`rtl:-scale-x-100`).
- Safe areas: the sticky tab row sits at `top: env(safe-area-inset-top)`. Sheets keep the vaul height rule.

#### Files to change
Paths are inside `src/`, except those that start with `tests/`. The work covers the screens only. It needs no contract change, no server change and no MCP change.
- `features/project/ProjectScreen.tsx`: five phone tabs, sticky row, More list and sub-pages, scroll to the tab row, `compose=1` on Overview, not-found link uses `projectsListLink()`.
- `features/project/tabs.tsx`: add `more`, a phone tab list, a map from `activity|schedule|team` to More, `tabReads('more')` (no reads). A desk link with `more` opens Overview.
- `features/project/MoreTab.tsx` (new): the list of three rows and the back row.
- `features/project/ProjectHeader.tsx`: phone identity row, stage row, action row, navy rule by tab (a small hook reads the Files and Tracker rights). `ProjectActions.tsx`: the delete redirect uses `projectsListLink()`.
- `features/project/StageControl.tsx`, `HealthControl.tsx`, `tasks/TaskPeople.tsx`: use `SheetOrPopover`.
- `components/SheetOrPopover.tsx` (new), `components/Menu.tsx` (`sheetOnPhone`), `components/Tabs.tsx` (`spread`), `components/ProgressLine.tsx` (full width).
- `features/project/overview/OverviewTab.tsx`: phone panel order, compact first panel (`Standing`) with the "Next deadline" row. New `overview/UpdatesPanel.tsx`. `overview/Composer.tsx`: compact size, draft store, scroll and focus on `compose=1`, button color. `overview/ActivityTab.tsx`: no box on a phone.
- `features/project/tasks/TasksTab.tsx`, `TaskList.tsx`: two buttons, "n of m done" under All, add row last. Reuse `features/work/WorkViewButton.tsx` if its props allow it.
- `features/project/tasks/SortableTaskRows.tsx`, `DragLayer.tsx`, `RowGrip.tsx`, `ChecklistDrag.tsx`, `ChecklistRow.tsx`, `TaskBoard.tsx`: press and hold, Move sheet, lane snap. The Home Today list and the Work list use the same parts, so build them with those sections.
- `features/project/tracker/TrackerTab.tsx`, `QuickLog.tsx`: main button, sheet, Filter row inside History, kept type and side.
- `features/project/files/FilesTab.tsx`, `PreviewSheet.tsx`: navy Add on a phone, no drop hint, row opens preview, viewer and PDF link. Check `tasks/TaskSheet.tsx` and `dashboard/meeting/DrawingsStrip.tsx`, which use `PreviewSheet`.
- `features/project/payments/PaymentsPanel.tsx`: no change.
- Words: new keys in `i18n/real/phoned.en.json` and `phoned.ar.json`: the short tab words, the More rows with their lines, "Log a new line", "Move to", "‹ More", "Next deadline", "Open the PDF", "n of m done". `whatsNew/entries.ts`: one entry.

Tests that pin the old phone layout (change or check each one):
- `features/project/tabs.test.tsx`, `ProjectScreen.test.tsx`, `ProjectChatButton.test.tsx`, `ProjectAudit.test.tsx` (the Stale sign in the header).
- `tracker/TrackerSidesReplyExport.test.tsx`, `TrackerTab.test.tsx`.
- `tasks/BoardWave4.test.tsx`, `TaskPeople.test.tsx`, `TaskListOrder.test.tsx`, `TasksTab.test.tsx`, `TaskSheet.test.tsx`.
- `team/TeamTab.test.tsx`, `overview/OverviewTab.test.tsx`, `ActivityTab.test.tsx`, `files/ShareToast.test.tsx`.
- `src/app/AppShell.test.tsx` (the project back link).
- `tests/e2e/projects.spec.ts` and `tests/e2e-deploy/projects.spec.ts` (the `TABS` list at 390 px), `owner.spec.ts`, `work.spec.ts`, `full.spec.ts`, `calm.spec.ts` (one main button).
- New tests first: a phone render for each tab, the sub-pages, the sheets, press and hold, the `?tab=` links, the `compose=1` link.

#### My calls
- The Files tab word stays "Files & Links" (owner rule of 2026-10-19). It wraps to two lines in the tab row.
- The tab row is sticky with a solid background, so one tap changes the tab on a long Overview.
- Navy goes to one button on each tab. "Post update" turns grey only where a tab button or a typed post is the next step, and only when that button shows.
- "Post update" scrolls to the update box on Overview and tries to focus it. Safari for iPhone may refuse the keyboard, then the person taps once.
- The mockup item "Put on hold" is not built. The code has Pause project, Mark as completed, Archive and Mark as active.
- The add row moves to the end of each stage group, as the mockup draws it.
- A to-do row and a checklist row reorder by press and hold with the standard hold of 500 ms and 10 px. This is the hold of chat and of the Projects list row menu, so a scroll does not start a lift.
- A board card moves by the Move sheet, not by drag. A drag across a side lane is hard with one finger. The one Move button stays visible, so no feature is lost.
- The tracker log form moves into a sheet. The page then shows one main button, not a form.
- The Filter row of the Tracker sits above History, because it filters History only.
- "n of m done" shows only under the filter All. Under any other filter the number would lie.
- A PDF opens by a real link after the signed link loads. A `window.open` after an async call is blocked by Safari for iPhone.
- A missed deadline shows in the "Next deadline" row in the Attention color, so it does not vanish when the header loses the label.
- The desk list-row link `?compose=1` does nothing today (no box on Overview). D fixes it on a phone only. A desk fix is one line in `cardMenu.ts` and stays out of D.
- The "N more" text of Attention stays plain text.
- The project chat opens full screen in the Inbox tab. Its back arrow must return to the project when the chat started there. The Inbox section builds this.

#### Questions only the owner can answer
None. Lead rules 5 and 6 answer the earlier questions: Payments stay in Overview, and Links stay in Files & Links.


### A to-do (the task panel)

#### Today on the phone
- The panel is `TaskSheet` in `src/features/project/tasks/TaskSheet.tsx`. On a phone, `Sheet` (`src/components/Sheet.tsx`) draws it as a vaul bottom sheet with a handle, swipe down to close, the task title, a Focus pill and an X. On a desk it is a side panel with no scrim. The sheet is as high as its content, so it changes height when the person changes tab.
- The next step is not first. The body is one long list under two underline tabs (Details, Conversation). A person who may review sees the Review block first. A person with no lead sees Take it first. Everyone else starts with Title, Status, Lead.
- The panel has no finish button. A person finishes a to-do with the Status menu (`tasks.move`), with the tick in a list row (`TaskRowItem.tsx`) or with the Done button of Focus mode (`FocusMode.tsx`). The tick and Done call `tasks.complete`.
- Many links open the panel. They all use `taskLink` (`src/lib/params.ts`): a project to-do opens `/projects/:id?tab=tasks&task=<id>`, an office to-do opens `/work?task=<id>`, and `thread=1` opens the Conversation. The screens are Today (`HomeTaskSheet.tsx`, also the push link `/?task=`), Work, the project To-dos and Overview tabs, the task list, the meeting view and Open space. The links from other places are the Inbox "Open to-do" button, Search, the Dashboard review list and the bell notices. A screen that opens the panel adds one history step, so Back closes it. A link from another place is a plain move, so Back returns to that place and X keeps the person on the project page.
- The Conversation is `features/comments/CommentThread.tsx` with `TaskComments.tsx`. `BubbleActions.inSheet` is true there: a finger gets the "..." button (always visible) and no press and hold. The emoji list is a small panel over the box. The box sits after the last comment, inside the scroll.
- Batch B is on main. The mention list starts with the row "Everyone" when the server gives a count (`tasks.get` field `everyone`, right `chat.mentionEveryone`). A comment with @everyone shows the mention mark. Quiet hours do not change the panel.
- Three sheets already open inside the panel: the date reason sheet (`DateReason.tsx`), the stage back sheet (`StageBack.tsx`) and the file preview (`PreviewSheet`).
- Every field is native. `SelectField` is a `<select>`. `DateDraftField` puts a real date input over a quiet look, with a clear control. The checklist has a grip for the order and a drag layer in its own chunk (`ChecklistRow.tsx`, `ChecklistDrag.tsx`, fbk_043). A person who may edit but not tick sees boxes that stay off.

#### D on the phone
Build this only when `useIsPhone()` is true (under 640 px). The desk markup of `TaskBody` stays as it is. Both layouts share one hook (`useTaskPanel.ts`), so no rule exists twice. The panel opens over the Work tab (project and office to-dos) or over Today. The tab bar sits under the scrim, and it keeps `nav[data-pill]` so Focus mode can still make it inert. The panel adds no Search icon.

**0. The sheet.** The same vaul sheet. Add two optional props to `Sheet.tsx`: `tall` (on a phone the sheet always takes the full free height, so a change of tab does not change the height) and `phoneHeader` (a node that takes the place of the title row on a phone). The real `Drawer.Title` stays as `sr-only` with `data-sheet-title` and `tabIndex={-1}`: the dialog keeps the task title as its name, and `focusInto` still finds a target.

**1. Top row (one line, 44 px).**
- Start: the project link. `ProjectTile` (22 px) and the project name in `<bdi>`, cut with an ellipsis, as a link to `/projects/:id`. An office to-do shows the word `office.word` and no link.
- End: the Focus pill (the current `headerAction`) and the X (`size-11`).

**2. Title and state line.**
- The title shows in large type (`text-page-title`, `dir="auto"`, `[text-wrap:balance]`). A person with `viewerCan.editDetails` taps it to edit: the current `TextField` replaces it with the focus in it, and a blur or Enter saves with the same `patch({ title })`. Other people see plain text.
- Under it, one line of quiet facts with the shape signs of `StatusSign`, never tinted pills: the status word; "Starts Sun 4 Oct" when `startsLater` is true, else the due word (`dueWord`, `dueText` in `lib/due.ts`); Flagged (`text-attn`); the version badge from version 2; and "Waiting for X" (`tasks.waitingFor`). `StatusSign state="late"` shows only when the tone is `attn`. A to-do in review shows a quiet date, never past due. A done to-do shows no due word. The line shows only what is true.

**3. The one next step.** One slot, one answer. A pure function `nextStep(data, viewerCan, makerId)` in `nextStep.ts` returns the kind, in this order:
1. `review`: `viewerCan.review`. The `<section aria-label>` keeps its name. Approve is the main button (52 px). Under it: the note field `#task-note` ("What needs to change?") and Send back (secondary, off until the note has text). With `noteFirst`, the note takes the focus, Send back is the main button and Approve is secondary below, as today.
2. `take`: `viewerCan.take`. The hint and Take it (main button), as today.
3. `complete`: status To do or In progress, `data.canMove`, a lead, `!isWaiting(data)` (`lib/waiting.ts`, as Focus mode does). One main button with `CircleCheckIcon`. It calls `tasks.complete` with the `useUndoable` message of the list row (`tasks.sentToReview` or `tasks.completed`). The word is "Send to review" when the call will land in review, else "Mark done". The rule is `landingStatus` in `src/api/handlers/tasks.ts`: `task.needsReview`, not an office to-do led by its maker, and the viewer lacks the review right. The view gives that last test as `viewerCan.setNeedsReview`, so `nextStep` reads that flag. The server result decides the toast, so the toast is true even when the guess is wrong.
4. `waiting`: the to-do waits and `data.canMove`. No button. One quiet line "Waiting for X" (`waitingNames`).
5. `needs_lead`: no lead, `data.canMove`, no right to take. One quiet line (`lead.needsLeadToast`).
6. `wait_approval`: the lead of a to-do in review. One quiet line (`tasks.waitsForApproval`).
7. `new_version`: `viewerCan.newVersion`. A secondary button "New version" with its hint. It opens the inline form of `NewVersion` (reason, timing, "Start version N", Cancel).
8. `join`: `!mayChange && !viewerCan.take && viewerCan.help && !viewerCan.editAll`. The hint and "Join as a helper" (secondary). `mayChange` is the value in `TaskBody`: details, dates, work or `editAll`.
9. `none`: `!mayChange && !viewerCan.take`, and no earlier kind. The read only line (`taskSheet.readOnly` or `office.readOnly`).
Otherwise the slot is empty and takes no space. Never two main buttons. A person with no right sees no dead control. The slot changes with `fade`.

**4. The switch.** Details | Conversation (n). Reuse `Tabs` (`src/components/Tabs.tsx`) with a new `variant="pill"`: a grey pill, 44 px high, and the white thumb slides with the current `layoutId` spring. It keeps `role="tablist"`, the arrow keys and `usePanelLink` (`?thread=1`). Do not use `SegmentedControl`: it has radio roles, and `tests/e2e/toastUndo.spec.ts` looks for `role="tab"`.

**5. Details: grouped rows.** New `DetailRows.tsx` with `Group` (title 12/600 uppercase `text-ink-2`; body `rounded-2xl bg-fill`; rows at least 48 px high, divided by `.hairline`). Label at the start, value at the end (`text-end`, `<bdi>` for names), logical classes only.
- `PickRow`: the real `<select>` of `SelectField` lies over the row, transparent and full size, and keeps its `id` (`task-owner`, `task-status`, `task-stage`). A tap opens the picker of the phone. A chevron-down shows at the end. A person without the right sees a `ValueRow` (no chevron, not a button).
- `DateRow`: the current `DateDraftField` with `hideLabel`, inside a row that shows the label. The empty word stays as the value. The clear control stays as a 44 px target at the end of the row. The date reason sheet stays.
- `SwitchRow`: the current `Switch` with its hint (`task-flag`, `task-review` keep their ids and `role="switch"`).
- Groups in this order:
  - **People**: Lead (`PickRow`). The value is the avatar and name, or `NoLeadMark` and "No lead". Options as today, with "(joins the team)". Helpers: one row for each helper (avatar, name, X of 44 px), then a last row "Add a helper" (`PickRow`). The hint is `office.helpersHint`, or `taskSheet.helpersHint` when `detail.viewerCan.editTeam`. The add row hides at `MAX_HELPERS`. The group hides when there is no helper and the viewer cannot edit.
  - **When**: Start (`DateRow`); Timing (value "Static: due date" or "Dynamic: duration"; a tap opens the two options in place with the current `SegmentedControl` and the hint); Due (`DateRow`) for Static, or Duration (`DurationField`) and the computed due line for Dynamic. "Pick a start date first" stays. Under the group: `DateNotes`.
  - **This to-do**: Status (`PickRow`, options from `moveTargets`, hidden for the reviewer); Stage (`PickRow`, not for an office to-do); Flag (`SwitchRow`, or the Flagged line for a reader); Needs review (`SwitchRow`, same conditions as today); Description (the current `TextArea`, saves on blur, "Not saved yet" kept; a reader sees `RichText`; hidden when empty and read only).
  - **Checklist · n of m**: one row for each item. The grip stays at the start (a button of 44 px). The box and the text are one `<label>` (the tick area is the row, not the 20 px box). The X stays a separate 44 px button. A person who may edit but not tick sees the boxes off and not tappable. A reader sees icons, as today. The "Add an item" row is last.
  - **Files · n**: one row for each file: a plain `AttachFileIcon` (no tile), the name, the size (words of `FilesTab.tsx`: `files.kb`, `files.mb`). A tap opens `PreviewSheet` for a picture or a PDF, else saves the file. Empty: the current line.
  - **Needs first**: rows with status words and an X for editors; "Add a to-do it needs first" (`PickRow`) last, hidden at `MAX_PREREQUISITES`; the group hides for an office to-do and for an empty read only list. "Unlocks" is a second group, read only, each with its hint.
  - **Versions**: from version 2, rows as today.
  - **History**: the 3 newest rows (avatar, name, `AgentLabel` for an agent, text, age). A plain button "See all (n)" shows the rest in place. "Undo agent change" goes under the text of its row, 44 px high, with the toast `taskSheet.undone`.
- At the end, stacked full width buttons of 48 px: "Leave this to-do" (`taskHelp.leave`, secondary), "Save as template" (secondary), "Delete to-do" (the `destructive` button of today). Each shows by the same gate as today.

**6. Conversation view.** The same `CommentThread`. On a phone it gets `docked` and `hideTitle`. The box (reply strip, field, picked files with progress, attach, emoji, Send) sticks to the bottom of the sheet body, over the safe area (`pb-[env(safe-area-inset-bottom)]`), with a hairline above. `MentionField` gets `placement="above"` there, as the Inbox box has, and keeps the "Everyone" row. The heading "Comments" hides on a phone (the switch says "Conversation (n)"), and the `section aria-label` stays. The box hides Attach without `viewerCan.upload` and shows `comments.cannot` without `viewerCan.comment`. When the view opens, the body scrolls once to the newest comment. The "..." button, the reply strip, the edit form, the reason lines with their Edit menu and the delete toast stay. The picture viewer (`ImageViewer`) stays as today: pinch, double tap and drag (fbk_038), X, Download, Previous and Next, and no zoom buttons.

**7. Sheets over the panel.** The date reason sheet, the stage back sheet and `PreviewSheet` stay as they are. Test all three on Safari on iPhone over the tall panel.

#### Every feature and its place
| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Bottom sheet, handle, swipe down to close | `components/Sheet.tsx` | Same vaul sheet, full free height (`tall`) | Change |
| Dialog name = task title; focus target on open | `Sheet.tsx` title, `data-sheet-title` | `sr-only` `Drawer.Title`; the same text is the big title in the body | Change |
| Project link (tile and name) | none in the panel | Top row, start side | Change |
| Word "Office" for an office to-do | `office.word` (lists only) | Top row, in place of the project link | Change |
| Focus button | `TaskSheet.tsx` `headerAction` | Top row, beside the X | Keep |
| Close X (44 px) | `Sheet.tsx` Frame | Top row, end | Keep |
| Close by Back, Escape, outside press; save of typed text at close | `panelLink.ts`, `saveTyped` | Same | Keep |
| Ways in: Inbox "Open to-do", Search, Dashboard review list, bell notice, push link | `taskLink` | Same links. The panel opens over Work (or Today for a push link). Back returns to the place of the link | Keep |
| Empty sheet until the task arrives; load error with "Try again" | `TaskSheet.tsx`, `LoadFailed` | Same, inside the tall sheet | Keep |
| To-do deleted by someone else: the panel closes | `gone` effect | Same | Keep |
| Preview as another person closes the panel without a save | `saveTyped` guard | Same | Keep |
| Office note "who sees this to-do" | `office.sheetNote` | Under the state line, quiet text | Keep |
| Title, editable | `TextField` `task-title` | Large title; a tap shows the field; blur or Enter saves | Change |
| Title, read only | `Fact` | Large title, plain | Change |
| State line: status word | `Fact` Status | Under the title, sign and word | Change |
| State line: due word, or "Starts <date>" | list row only | Under the title, `StatusSign` | Change |
| State line: Flagged mark (reader) | `tasks.flagged` line | Under the title | Move |
| State line: version badge | list row only | Under the title, from version 2 | Change |
| "Waiting for X" | list row, Focus mode | Under the title, and in the next step slot | Change |
| Next step: Mark done or Send to review (`tasks.complete`) | list tick, Focus mode Done; Status menu | Main button in the next step slot; the word follows the review rule | Change |
| Toast "Sent to review" or "To-do done" with Undo | `useUndoable` | Same toast lane | Keep |
| Toast "Moved to X" or "Sent to review" with Undo after a Status pick | `useUndoable('tasks.move')` | Same | Keep |
| Next step: Take it with its hint | `TaskSheet.tsx` take block | Next step slot, main button | Move |
| Toast "Taken" with Undo | `take` | Same | Keep |
| Next step: Approve | Review block | Next step slot, main button | Move |
| Toast "To-do approved" with Undo | `approve` | Same | Keep |
| Send back note field `#task-note` and button (off until the note has text) | Review block | Under Approve, same field and label | Keep |
| Send back toast; focus returns to the panel after Approve or Send back | `sendBack`, `keepFocus` | Same | Keep |
| Send back with a note from the Board (`noteFirst`) | `TaskSheet.tsx` | Same order: note focus, Send back main, Approve secondary | Keep |
| Quiet line for a to-do in review (lead view); quiet line "needs a lead" | none; toast of the list tick | Next step slot | Change |
| Join as a helper (hint and button) | `taskHelp.join` block | Next step slot, secondary | Move |
| Toast "You joined" with Undo | `join` | Same | Keep |
| Read only line | `taskSheet.readOnly`, `office.readOnly` | Next step slot | Move |
| New version (hint, button, form, Undo toast) | `NewVersion` in Details | Next step slot for a done to-do; the form opens in place below | Move |
| Tabs Details and Conversation (n) | `Tabs` underline | Pill switch under the next step | Change |
| Open the Conversation by link (`thread=1`) | `usePanelLink` | Same | Keep |
| Lead, editable; "No lead" rule; "(joins the team)" | `SelectField` `task-owner` | People group, `PickRow`, same options | Change |
| Lead, no lead: dashed empty circle | `NoLeadMark` | Lead row value, with the word "No lead" | Change |
| Lead, read only | `Fact` | People group, plain row | Change |
| Toast "X now leads" or "Lead removed" with Undo | `newLead` | Same | Keep |
| Helpers list; remove helper (X); "No helpers yet" | `TaskHelpers.tsx` | People group, one row each, X at the end (44 px) | Change |
| Add a helper (select, hint by role, limit) | `TaskHelpers.tsx` | Last row of the People group, `PickRow` | Change |
| Leave this to-do | `taskHelp.leave` button | End stack, secondary | Move |
| Status select with the allowed moves; hidden for the reviewer | `SelectField` `task-status` | This to-do group, `PickRow` | Change |
| Status read only | `Fact` | This to-do group, plain row | Change |
| Stage back reason sheet (reopen, earlier stage) and the Balady tick | `StageBack.tsx` | Same sheet | Keep |
| Stage select; read only; none for an office to-do | `SelectField` `task-stage` | This to-do group, `PickRow`, plain row, or no row | Change |
| Start date, Due date (Static) | `DateDraftField` | When group, `DateRow` with the clear control and the empty word | Change |
| Timing Static or Dynamic with hint | `TaskTiming.tsx` | When group, Timing row, opens in place | Change |
| Duration in working days and the computed due line (Dynamic) | `DurationField` | When group, number row and a quiet line | Change |
| "Pick a start date first" | `taskSheet.needsStart` | Same quiet line | Keep |
| Dates read only (start, due, duration) | `Fact` | When group, plain rows | Change |
| Date reason sheet, "Decided in the meeting", draft, retry, cancel puts old dates back | `DateReason.tsx` | Same sheet | Keep |
| Automatic date changes list | `DateNotes` | Under the When group | Move |
| Flag switch | `Switch` `task-flag` | This to-do group, `SwitchRow` | Change |
| Needs review switch (both hints) | `Switch` `task-review` | This to-do group, `SwitchRow` | Change |
| Description, editable, "Not saved yet"; read only | `TextArea`; `RichText` in `Fact` | This to-do group | Change |
| Checklist title and count | `h3` | Group title "Checklist · n of m" | Change |
| Tick an item | `ChecklistRow.tsx` | Whole row (box and text) is the tick area | Change |
| Boxes that show but stay off (edit without tick); read only icons | `ChecklistRow.tsx` `disabled`, `TaskSheet.tsx` | Group rows, not tappable, same marks | Keep |
| Remove an item (X) | `ChecklistRow.tsx` | End of the row, 44 px | Keep |
| Add an item field; Enter saves; the typed item saves at close | `TaskSheet.tsx` `Checklist` | Last row of the group | Keep |
| Change the order: grip, drag layer, keyboard (Space and arrows), announcements | `ItemGrip`, `ChecklistDrag.tsx`, `taskSheet.arrange.*` | Same grip and layer; the grip is 44 px wide on a phone | Keep |
| Failed save puts the checklist back | `failures` key | Same | Keep |
| Versions list | `TaskVersions` | Versions group | Keep |
| Files list | `TaskFiles` chips | Files group, one row each with size | Change |
| Open a file: preview or save; "No files" line | `canPreview`, `downloadFile`, `taskSheet.noFiles` | Same on a tap; line in the group | Keep |
| Needs first list with status words; remove (X); add row; limit; Unlocks and hints | `TaskNeeds.tsx` | Needs first group, Unlocks group | Change |
| History list, empty line | `History`, `taskSheet.noHistory` | History group, 3 rows | Change |
| History "See all" | none | Plain button at the end of the group | Change |
| Agent label on a row; "Undo agent change" (by right) and the toast "Change undone." | `AgentLabel`, `events.undo` | Row name line; button under the text | Change |
| Save as template and its toast | `taskSheet.saveTemplate` | End stack, secondary | Move |
| Delete to-do and the Undo toast | `taskSheet.delete` | End stack, `destructive` | Move |
| Conversation title and count | `CommentThread` | Switch label "Conversation (n)"; the heading hides on a phone | Change |
| Comments by day, bubbles, runs; reaction pills | `TaskComments.tsx` | Same | Keep |
| "..." menu of a comment (Reply, Edit, Delete) and the toast "Comment deleted." with Undo | `MessageMenu.tsx` `inSheet`, `comments.delete` | Same button (`size-11`) and toast lane | Keep |
| Quiet reason lines and their Edit menu | `CommentItem.tsx` | Same; probe the 44 px press area | Keep |
| Comment that names you (soft tint); @everyone mark | `bubble.namesMe`, `RichText` | Same | Keep |
| Empty and load error states of the thread | `CommentThread.tsx` | Same | Keep |
| Reply strip above the box | `ComposerReplyStrip` | Inside the docked box | Keep |
| Comment box with @ list and "Everyone" row | `MentionField` | Docked at the bottom; list opens above | Change |
| Attach, paste and drop files with the progress bar; Attach gate | `Attachments.tsx`, `canAttach` | Same, in the docked box | Keep |
| Emoji button and list | `EmojiButton` | Same; the list is a small panel over the box | Keep |
| Send button; "Only the project team can comment here"; draft kept; read mark | `CommentThread.tsx`, `comments.cannot`, `app/drafts.ts`, `useMarkTaskRead` | Same, in the dock | Keep |
| Picture preview and full screen viewer | `ImageViewer`, `useImageZoom` | Same gestures (fbk_038); no zoom buttons | Keep |
| Scroll to the newest comment at open | none | Once, when the view opens | Change |
| Over Work, Today, project tabs, task list | `ProjectTaskSheet` | Same panel everywhere | Keep |
| Over the meeting view and Open space | `ProjectTaskSheet` | Same panel where the screen has a phone shape | Keep |
| Desk side panel | `Sheet.tsx` `SidePanel` | Not changed | Desk-only |

#### Motion and look
- Reuse: the vaul sheet and its handle; the page that steps back (`usePanelOpen`); `spring.standard` for the thumb of the pill switch (`layoutId`); `spring.expand` for the rows that open in place (Timing, New version, History "See all"); `fade` (200 ms) for the next step slot; `AnimatedIcon` for `CircleCheckIcon`, `AttachFileIcon`, `XIcon` and `TimerIcon` (the icon of the main button plays once when the slot shows); `.pressable` on every row and button.
- Mark done squeezes the icon once, as the list tick does (scale 1, 0.82, 1 in 0.42 s). Then the slot fades to the next answer. The checklist drag keeps its lift (`shadow-float`). Reduced motion: `MotionConfig reducedMotion="user"` removes the squeeze, the slide and the thumb glide, and the slot and the thumb change at once. The `.pressable` scale is off in the CSS block. No new motion exists without this rule.
- Look: tokens only. Groups are `bg-fill`. Text is `text-ink` and `text-ink-2`. Dividers are `.hairline`. The main button is the only navy in the panel. The pill thumb is `bg-card` with `shadow-card`. No coloured icon tiles, no tinted pills, no red chips. A state is a shape plus an ink word. Red stays for Late, errors and the `destructive` button of today. Names in `<bdi>`; values `text-end`; dates through `formatDay`.
- Arabic and dark: check the end-aligned values, the project link cut at the end, the thumb direction (it follows `dir`), and the docked box over the safe area.
- Safari on iPhone: the sheet uses `100dvh` through `PHONE_HEIGHT`; the docked box needs `env(safe-area-inset-bottom)`. The keyboard must not hide the box (test the vaul `repositionInputs` behavior). Test the grip drag inside the vaul sheet: if the sheet drags, set `data-vaul-no-drag` on the row.
- Targets: rows 48 px, switches 44 px, X buttons 44 px, grip 44 px, the whole checklist row. Check with `elementFromPoint`.

#### Files to change
- `src/components/Sheet.tsx`: props `tall` and `phoneHeader`. Both default to today's behavior. `SheetEdge.test.tsx` and `overlays.test.tsx` must pass unchanged.
- `src/components/Tabs.tsx`: `variant="pill"`. Add a case to `Tabs.test.tsx`.
- `src/features/project/tasks/TaskSheet.tsx`: move the state and the actions of `TaskBody` into `useTaskPanel.ts`. Keep `DeskBody` with the same markup. Add `PhoneBody` behind `useIsPhone()`. `taskPanelReads` stays the same, so `TaskSheetPrefetch.test.tsx` holds.
- New files in the same folder: `useTaskPanel.ts`, `PhoneBody.tsx`, `DetailRows.tsx`, `NextStep.tsx`, `nextStep.ts`, `StateLine.tsx`. They load only through `TaskSheet.tsx`, so the chunk of `HomeTaskSheet` keeps the first load small (`app/firstLoadImports.test.ts`, `check-bundles.ts`).
- `TaskHelpers.tsx`, `TaskTiming.tsx`, `TaskNeeds.tsx`, `TaskVersions.tsx`: a `layout="rows"` option that draws the rows of D. The desk layout stays the default.
- `ChecklistRow.tsx`: on a phone the box and the text are one `<label>`, and the grip is `size-11`. `ChecklistDrag.tsx` keeps its sensors.
- `src/features/comments/CommentThread.tsx`: props `docked` and `hideTitle`, and `MentionField placement="above"` when docked.
- `src/lib/`: a shared `fileSizeText` taken from `FilesTab.tsx`.
- `src/i18n/real/phoned.en.json` and `phoned.ar.json`: the new words only (Mark done, Send to review, the group titles, "Checklist · n of m", "Files · n", "See all (n)", "Tap to edit the title"). Reuse the keys that exist (`taskHelp.leave`, `taskSheet.*`, `tasks.*`). Every word in English and Arabic (Thmanyah style, Western digits), no em-dash.
- `src/whatsNew/entries.ts`: one entry.
- No contract change, no server change, no MCP change. The calls are the same: `tasks.complete`, `tasks.move`, `tasks.update`, `tasks.take`, `tasks.help`, `tasks.approve`, `tasks.sendBack`, `tasks.delete`, `tasks.newVersion`, `taskTemplates.save`, `comments.*`.
- Keep for the browser specs at 390 px: `#task-owner`, `#task-status` (a real `<select>`, transparent, not `display:none`), `#task-review` (`role="switch"`), `#task-note`, the region "Review", the exact button names Approve and Send back, the role `tab` named Conversation, and the button named "Focus".
- Tests that pin the old layout stay green because jsdom reads a desk (`matchMedia` is false): `TaskSheet.test.tsx`, `TaskSheetClose`, `TaskFlow`, `TaskReview`, `TaskFeatures`, `TaskNoLead`, `TaskMaker`, `TaskLead`, `TaskPeople`, `TaskStageRow`, `StageBackFocus`, `StageBackTracker`, `HelperLine`, `TaskTiming`, `DateReason`, `rr2TaskSheet`, `ChecklistOrder`, `ChecklistSwap`, `features/comments` (`CommentThread`, `TaskCommentLook`, `EditFocus`) and `features/focus/FocusMode.test.tsx`.
- New tests: add a helper `phoneViewport()` in `src/test` that makes `matchMedia('(max-width: 639px)')` true. `nextStep.test.ts` (every kind, the order, the review word for each right, the `mayChange` gate). `PhoneTaskSheet.test.tsx` (block order, one main button, each row has a labelled native control, a reader sees no control, History "See all", the docked box, the heading hidden). Browser specs: `tests/e2e/toastUndo.spec.ts`, `tests/e2e-deploy/walk.spec.ts`, `tests/e2e/calm.spec.ts` (at most one main button), `tests/e2e/menus.spec.ts` (read only panel at 390). Screenshots: EN and AR, light and dark, 390 px, for each next step kind.

#### My calls
- Mark done and Send to review call `tasks.complete`, the call of the list tick and the Done button of Focus mode. The word follows the review rule of the server, and the toast follows the server result, so the button never lies.
- The Review block keeps the note field always visible. A hidden note may break the walk spec and adds one tap.
- Chips of the mockup (Due today, In progress, Flagged) become `StatusSign` shapes with ink words. The Flagged chip becomes `text-attn`.
- The pill switch is `Tabs variant="pill"`, not `SegmentedControl`, to keep `role="tab"` and the panel link.
- Each row opens the native picker by putting the real control over the row. No new picker.
- Timing opens in place. Three sheets already open inside the panel, so a nested sheet is possible, but a row that opens in place has one layer less to test on Safari.
- The press and hold sheet of the Inbox stays out of the task Conversation (`inSheet`): the "..." button is the way. The code comment names no hard limit, so this is a choice.
- The sheet is full height on a phone (`tall`), so the two views do not jump.
- The comment box sticks to the bottom in the Conversation view, and the view scrolls once to the newest comment. The heading "Comments" hides because the switch says it.
- The checklist keeps its grip, and the grip grows to 44 px. A grip works today, needs no hint and does not fight the scroll or the vaul drag. The earlier plan (press and hold, no grip, `TouchSensor`) is dropped.
- A done to-do shows New version in the next step slot, because it is the only next step there.
- The panel has no "Attach a file" row. A file reaches a to-do through the Attach button of the Conversation.
- The grey `AttachFileIcon` has no tile. `ProjectTile` in the top row is the picture of the project, not an icon tile.
- History shows 3 rows, then "See all (n)".
- The project name in the top row is a link. It leaves the panel and opens the project.
- The tab bar is not made inert by `usePanelOpen`. The scrim covers it and the vaul focus trap holds the focus. Only Focus mode makes it inert, through `data-pill`.

#### Questions only the owner can answer
None. The lead rules answer the old question about an "Attach a file" row.


### Inbox: Chats and Notifications

#### Today on the phone
- The Inbox is one tab (`/inbox`) with the chat list only. The notices are another screen at `/notifications`. The bell in the top row opens it (`BellButton` in `src/app/TabPill.tsx`, placed by `src/app/AppShell.tsx`).
- The chat list sits in a panel with a fixed height (`h-[calc(100dvh-16rem)]`, `min-h-[26rem]`) and its own scroll (`src/features/inbox/InboxScreen.tsx`). The search field and one "kind" menu button sit at the top of the panel (`ChatList.tsx`).
- Two counts exist. The Inbox tab shows `chats.unreadCount` (messages). The bell shows `notifications.count` `badge`, which counts only unread notices that need action (`ACTION_TRIGGERS` in `src/api/handlers/notifications.ts`). The two counts never add up.
- The search field text is `text-subheadline`: 15 px, and 13 px in the compact size set (`--size-subheadline` in `tokens.css`). Safari on iPhone zooms the page on focus.
- The search matches the title, the Arabic name of a direct person and the project name. A project name finds a project chat.
- "New message" hides only when both `chat.direct` and `chat.groupCreate` are off (`mayStart` in `InboxScreen.tsx`). With one right, the sheet opens in the mode that is left. Only the "New group / Message one person" switch needs both.
- A row has no menu button on a phone. A swipe of more than 80 px archives the row. "Mark as unread" is only in the menu of the open chat (`chatMenuItems`).
- A chat opens at `/inbox/:id`. The list stays mounted and hidden, so its scroll place survives today. The back link of the chat is a plain push link (`ConversationPane.tsx`, word `chat.back`), and `markUnread.ts` calls `navigate('/inbox')`. `ScrollRestoration` keys on the path and restores only on a back step. A push to `/inbox` opens at the top.
- A notice row opens its item on a press, and a swipe marks it read (the swipe is on only under 640 px). The Approve button sits at the end of the row. "Mark all read" is the action of the page title (`NotificationsScreen.tsx`).
- The row has no "Waits for your reply" line (owner, fbk_028). The row has no "names you" mark: `chats.list` has no such field. Only a bubble in an open chat shows it (`namesMe`).
- Batch B is in main. A mention from `@everyone` has its own notice sentences (`inbox.mentionEveryone`, `...Group`, `...GroupGone`, `src/lib/noticeSentence.ts`). Quiet hours (Settings) stop push and email outside work hours. The bell and the Inbox keep every notice.

#### D on the phone
This layout applies under 640 px only. The desk keeps the 5-tab pill, the bell, the person menu, the "Notifications" page and the split Inbox. Every number below is a target, and the design tokens win on any detail.

1. **Top row.** The shell draws it: the Madar mark and the one global Search icon. The bell leaves the phone. A chat that is open draws no top row (chat section). This screen adds no search icon.
2. **Title row.** One `h1` "Inbox" (`ScreenTitle`) on both views. On Chats the action is the main button "New message" (the same `NewMessage` sheet). On Notifications the title has no action, so each view has at most one main button.
3. **View switch "Chats | Notifications".** A new component `InboxViews` (`src/features/inbox/InboxViews.tsx`) on `SegmentedControl` with `fill` and `layoutId="inbox-views"` (the Work section adds both props). It is full width and 44 px high. Its pill slides between the two views; the shell joins `/inbox` and `/notifications` in one `screenKey` on a phone. It reads the address, as `WorkSwitch` does: `/inbox` is Chats and `/notifications` is Notifications. A press calls `navigate`. Both screens draw it in the same place. The label of the second segment is the word `screens.notifications` of today, so the screen has one word for one thing.
   Each segment has a count: `chats.unreadCount` on Chats, and the `notifications.count` `badge` on Notifications. Each count is the `Badge` of today (the `badge` token of DESIGN.md), the same count that the Inbox tab and the bell show now. A count of 0 shows no number.
4. **Chats view, top to bottom.**
   - Search field, full width, 44 px high, text at least 16 px (`max(16px, var(--text-subheadline))`). It is a fix: today the text is 15 px. The word is `chat.search`. The rule is the same as today: title, Arabic name of a direct person and project name, inside the chosen kind.
   - Kind chips in one row: All, Projects, To-dos, People. A new component `ChatKindChips` (`src/features/inbox/ChatKindChips.tsx`) takes `kind` and `onChange` as props. `ChatList` stays the owner of the state (it owns `kind`, `kindRows` and `archivedRows`) and keeps `usePersistentChoice('madar.chatKind')`. Reason: the hook keeps its value in its own `useState` and does not tell another instance, so a second hook would write storage but not filter the list. The desk menu and the chips read the same state.
   - `role="radiogroup"` with `role="radio"` chips, label `chatFilter.group`. Each chip is 44 px high. The row wraps and never scrolls sideways. The open chip uses `bg-card shadow-card text-ink`. No chip is navy.
   - One panel (`panel hairline`) with the rows. On a phone the `aside` is not a panel: `ChatList` draws the panel around the rows only. The page scrolls, not the panel. The tab bar clears the last row through the `pb-32` of `<main>`.
   - The last row of the panel is "Archived (n)" with a chevron (`rtl:-scale-x-100`). It shows only while a chat is archived and the search is empty. It moves here from the top of the list.
5. **Chat row** (`ChatRowItem`, keep all of its parts): a 40 px picture, the title, the age, the preview line, the unread count. An unread chat has a bold title and its count in the `signature` look of today. A press opens `/inbox/:id` as a full screen chat (the chat section builds it and hides the tab bar). A swipe in either direction archives the chat, with the toast and Undo. The row keeps its minimum height of 68 px.
6. **Back from a chat keeps the place.** The row link passes `state={{ fromList: true }}`. The back link of the chat and "Mark as unread" call `navigate(-1)` when that state is there, so `ScrollRestoration` restores the page scroll of `/inbox`. Without the state (a push line, a notice, a bookmark) the back link goes to `/inbox`, and that is the Chats view. A test pins it: scroll the list, open a chat, go back, read `scrollY`.
7. **Archived chats sub-view** (inside the Chats view): a back arrow (44 px), the title "Archived chats", the search "Search archived chats", the same rows. A swipe moves a chat back. The sub-view closes by itself when it is empty.
8. **Notifications view, top to bottom.** Day groups (Today, Yesterday, then the long date). Each group is a `panel` of notice rows (`InboxItem`). The heading line of the first group has "Mark all read" at its end, as a quiet text button (`Button variant="plain"`, 44 px). It shows only while one notice is unread. The toast with Undo stays. A row keeps: the unread dot at the start, the face (36 px), the sentence, and the meta line (project tile, project name, age).
9. **Approve in place.** The Approve button moves under the meta line, aligned with the text, 44 px high. It stays a separate button next to the row link, never inside the link. It keeps its `aria-label` (`inbox.approveTask`, "Approve “{{target}}”"), so two buttons stay different for a screen reader. The press still calls `tasks.approve` and shows the toast "Approved" with Undo. No new "Open" button: the whole row opens the item.
10. **Tab bar.** The Inbox tab is open on `/inbox`, `/inbox/:id` and `/notifications`. Its badge is the sum: `chats.unreadCount` plus the `notifications.count` `badge`, in the red `Badge` of today. The accessible name says both numbers (new word `nav.inboxBoth`). No new call is needed: both reads already run in the shell.
11. **Toasts.** The toasts of this area (archive, move back, Mark all read, Approved, Marked as unread, message deleted) must show clear of the new tab bar. In an open chat the lane sits above the composer. The lane position is the work of the shell and chat sections (`src/app/toasts.tsx`). This section only needs it.
12. **Empty and error states.** Chats: `EmptyState` (`chat.emptyTitle`, `chat.empty`), "No chat matches." for a search, "No chats here." for an empty kind, `LoadFailed` with Retry. Notifications: `EmptyState` (`inbox.emptyTitle`, `inbox.empty`) and `LoadFailed` with Retry.
13. **Links.** `/notifications` opens the Notifications view on a phone, and the app redirects no address. Most push lines carry the link of the item. Only a notice with no link falls back to `/notifications`. Every link of a notice must open its target in D:
    - `/inbox/:id?at=` : the chat at the message (chat section).
    - `/projects/:id?tab=tasks&task=` and `/work?task=` : the task panel (project and Work sections).
    - `/projects/:id?tab=activity&update=` (a mention in a post) : Activity under the project tab More.
    - `/projects/:id` (project notice) and `/meetings?meeting=` : the project, and the meeting sheet in the Work area.
    - `/admin/feedback` (needs `feedback.manage`) : Admin from the Me hub.

#### Every feature and its place
| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Page title "Inbox" | `InboxScreen.tsx` (`screens.inbox`) | One `h1` "Inbox" on Chats and on Notifications | Keep |
| Notifications page title | `NotificationsScreen.tsx` (`screens.notifications`) | Phone: the title "Inbox" with the Notifications segment. Desk: unchanged | Merge |
| View switch Chats / Notifications | none | New `InboxViews` under the title | Change |
| Count on each segment | none | The `Badge` of today. Chats: `chats.unreadCount`. Notifications: `notifications.count` `badge` | Change |
| Inbox tab badge | `TabPill.tsx` (chats only, red `Badge`) | Sum of chats and notices, same red `Badge`, name says both | Change |
| Bell button and count in the top row | `BellButton`, `AppShell.tsx` | Leaves the phone top row. The Notifications segment holds the count | Move |
| Round Inbox button and round bell (640 px and up) | `InboxButton`, `BellButton` | No change | Desk-only |
| Notifications page on a desk, "Mark all read" in the title | `NotificationsScreen.tsx` | No change | Desk-only |
| "New message" main button | `InboxScreen.tsx` | Same button, Chats view only. It hides only when both `chat.direct` and `chat.groupCreate` are off | Keep |
| New message sheet: pick one person (face, name, discipline) | `NewMessage` | Same `Sheet`. A press on a person opens the chat | Keep |
| "New group" / "Message one person" switch | `NewMessage` | Same. Shows only with both rights. With one right the sheet opens in the mode that is left | Keep |
| Group pick marks, count line, "Pick two people or more." hint | `NewMessage` | Same | Keep |
| Group name field (optional) and "Make group" button | `NewMessage` footer | Same, full width. The footer clears the safe area | Keep |
| "No people" line in the sheet | `NewMessage` (`chat.noPeople`) | Same | Keep |
| Search field "Search chats" | `ChatList.tsx` (`chat.search`) | Full width, 44 px, text at least 16 px (a fix: 15 px today). The one search field here; no new search icon | Change |
| Search rule: title, Arabic name, project name | `ChatList.tsx` (`normalizeForSearch`) | Same | Keep |
| Search in the archived view | `ChatList.tsx` (`chat.searchArchived`) | Same | Keep |
| Search result "No chat matches." | `ChatList.tsx` (`chat.noMatch`) | Same | Keep |
| Search finds an archived chat and marks it "Archived" | `ChatRowItem` (`showArchived`) | Same | Keep |
| Kind filter menu button | `ChatList.tsx` (`Menu`, `chatFilter.label`) | Phone: four chips. Desk: the menu stays | Change |
| Kinds All, Projects, To-dos, People | `KINDS`, `inKind` | Same four chips, same rule | Keep |
| The chosen kind stays for the next visit | `usePersistentChoice` (`madar.chatKind`) | Same key. `ChatList` owns the state and passes it to the chips | Keep |
| Empty kind line "No chats here." | `chatFilter.none` | Same | Keep |
| Project chat row (project tile, 40 px) | `Lead` | Same | Keep |
| Direct chat row (face, name in the screen language) | `Lead`, `useTitleOf` | Same | Keep |
| Group chat row (one glow picture, never a stack of faces) | `GroupPicture.tsx` | Same | Keep |
| To-do thread row (clipboard icon) | `Lead` | Same | Keep |
| Presence dot: Online, Away, none for Offline | `PersonFace` | Same. An agent or a person who left has no dot | Keep |
| Direct chat with a person who left | `ChatRow.personLeft` | Same | Keep |
| Bold title for an unread chat | `ChatRowItem` | Same | Keep |
| Preview line with "You:" or the first name | `ChatRowItem` (`chat.you`) | Same. A direct chat shows no name for the other person | Keep |
| Quiet reason line in a to-do thread preview | `reasonLineText` | Same | Keep |
| Typing line in the row | `TypingPreview` (`useTypers`, reads `users.list` only for a row where someone types) | Same, in the link colour | Keep |
| Age of the last message | `Age` | Same | Keep |
| Unread count (99+ above 99) with hidden "Unread: n" | `ChatRowItem` (`signature`) | Same text, same `signature` look | Keep |
| "Waits for your reply" line | removed (fbk_028) | Stays out. `chats.waiting` stays in the contract for agents | Keep |
| "Names you" mark on a row | none | Not built (no contract change in D) | Keep |
| Open a chat (row link to `/inbox/:id`) | `ChatRowItem` | Full screen chat with no tab bar (chat section). The link passes `state.fromList` | Change |
| Back link "Back to chats" of an open chat | `ConversationPane.tsx` (`chat.back`, `sm:hidden`) | Chat header, 44 px. `navigate(-1)` with `fromList`, else a link to the Chats view | Change |
| Scroll place of the list on return | list `ul` scroll, hidden `aside` | Page scroll, restored by `ScrollRestoration` on the back step. A test pins it | Change |
| Swipe a chat row to archive or move back | `ChatRowItem` (`SWIPE_PX` 80; on for a phone or a touch tablet) | Same | Keep |
| Row menu "Options for <title>" | `ChatMenu` | Phone: no button. The same items live in the chat options sheet | Desk-only |
| "Mark as unread" with toast and Undo | `markUnread.ts` | From the chat options sheet (chat section). It returns with `navigate(-1)` when `fromList` | Keep |
| Archive and "Move back to Inbox" with toast and Undo | `archive.ts` | Swipe, and the chat options sheet | Keep |
| "Archived (n)" row | `ChatList.tsx` (`chat.archivedCount`, under the search) | End of the list | Move |
| Archived chats sub-view (back arrow, title, own search) | `archivedOpen` | Same, back arrow 44 px | Keep |
| Archived view closes when its last chat leaves | effect on `archivedRows` | Same | Keep |
| Empty state "No chats yet" | `chat.emptyTitle`, `chat.empty` | Same, under the view switch | Keep |
| Load error with Retry (chats) | `LoadFailed` | Same | Keep |
| "Pick a chat" placeholder | `chat.selectTitle` | Not shown on a phone | Desk-only |
| Selected row highlight | `selected` | Not needed: a chat is full screen | Desk-only |
| List and chat side by side | `sm:w-[340px]` | Not shown on a phone | Desk-only |
| Fixed panel height and inner scroll | `h-[calc(100dvh-16rem)]` | Page scroll | Change |
| First 40 rows at once, the rest at idle | `useStaged` | Same | Keep |
| Block a dropped file outside the chat | `useBlockFileDrop` | No effect on a phone | Desk-only |
| Admin: project chats of other leaders count only named messages | `countsNamedOnly` | Same rule in the row count, the segment and the tab sum | Keep |
| Admin choice "Only my work" hides other project chats | `hiddenByReach` | Same | Keep |
| Live update of rows, counts and typing | `chats.list`, Realtime | Same | Keep |
| Start of the read on a press of the tab | `usePressReads`, `pressReads.ts` | Add the Notifications segment press (`notifications.list`) | Change |
| Notifications: day groups | `groupByDay` | Same, inside the Inbox | Keep |
| Notifications: "Mark all read" with toast and Undo | title action | End of the heading line of the first day, 44 px | Move |
| Notifications: unread dot, bold sentence, hidden "Unread" | `InboxItem` | Same | Keep |
| Notifications: read row in grey | `InboxItem` | Same | Keep |
| Notifications: face of the person who acted (36 px) | `Avatar` | Same | Keep |
| Notifications: group picture for a group notice | `GroupPicture` | Same | Keep |
| Notifications: bell icon for a done report | `BellIcon` | Same | Keep |
| Notifications: meta line (project tile, name, age, "Office" word) | `InboxItem` | Same | Keep |
| Notifications: "Not found" line for a deleted item | `gone` | Same | Keep |
| Notifications: a press opens the item and marks it read | `Link` | Same. Links as in item 13 | Keep |
| Notifications: a row with no link only marks read (done report) | `button` | Same | Keep |
| Notifications: a gone row marks itself read | `markGone` effect | Same | Keep |
| Notifications: swipe marks the row read | `drag` x, 80 px, only under 640 px | Same (phone only) | Keep |
| Notifications: Approve button in place | `canApprove`, `task.review` | Under the meta line, 44 px, same `aria-label` | Move |
| Notifications: toast "Approved" with Undo that restores the unread mark | `useUndoable('tasks.approve')` | Same | Keep |
| Notice: to-do given to you, helper joined, to-do deleted | `noticeSentence.ts` | Same sentences | Keep |
| Notice: added to a project, stage changed | `noticeSentence.ts` | Same | Keep |
| Notice: mention or reply (project chat, to-do comment, direct, group) | `noticeSentence.ts` | Same. A press opens the chat at the message | Keep |
| Notice: mention in a project post | `viewOf` (`targetType` update) | Same sentence. A press opens Activity under More | Keep |
| Notice: `@everyone` mention (three sentences, batch B) | `everyoneKey` in `noticeSentence.ts` | Same sentences. A press opens the chat at the message | Keep |
| Notice: reminders (due tomorrow, past due, restart day) | `noticeSentence.ts` | Same | Keep |
| Notice: review (sent to review, approved, sent back) | `noticeSentence.ts` | Same | Keep |
| Notice: meeting (new, moved, cancelled, starts soon, gone) | `noticeSentence.ts` | Same. A press opens the meeting sheet | Keep |
| Notice: added to a group | `groupKey` | Same | Keep |
| Notice: request or bug (sent, done, hidden) | `reportKey` | Same. "Sent" shows only with `feedback.manage` and opens `/admin/feedback` | Keep |
| Notice: Admin copy with the people of the original | `copyKey`, `forPeople` | Same. Only for an Admin with "Everything" | Keep |
| Quiet hours (batch B) | `QuietHoursSection` in Settings | No change here. Push and email stop outside work hours. The Notifications view keeps every notice | Keep |
| Notifications: empty state "No notifications" | `inbox.emptyTitle` | Same, under the view switch | Keep |
| Notifications: load error with Retry | `LoadFailed` | Same | Keep |
| Notifications count counts only notices that need action | `notifications.count` | Same rule in the segment and in the tab sum | Keep |
| Address `/notifications` | `routes.tsx` | Opens the Notifications view on a phone | Keep |

#### Motion and look
- Reuse the pill highlight that slides (`layoutId` with `spring.standard` from `src/design/motion.ts`, as the tab bar does). Put it behind the open segment of `InboxViews`, with a new `layoutId` such as `inbox-view-active`. Under "Reduce motion", `MotionConfig reducedMotion="user"` in `src/main.tsx` makes the highlight jump with no slide.
- The Chats and Notifications content swap at once. No new entrance. `screenKey` maps `/notifications` to `/inbox` on a phone only, so the entrance does not play on a switch.
- `.pressable` goes on the chips, the segments, "Mark all read", Approve and the archived row. It is off under reduced motion by its own CSS block.
- The row swipe (`motion.li` drag with `dragSnapToOrigin`) and the Approve toast stay as they are. A swipe follows the finger, so it is not an automatic animation.
- Icons stay animated Lucide icons through `AnimatedIcon` (chevron, back arrow, clipboard, users, bell). They play on open as today. No new icon.
- No coloured icon tile. A state is a shape plus an ink word. Navy stays on the one main button ("New message") and the open tab of the bar. The chips, the segments and every count are not navy. Red is not used here. The unread dot keeps the link colour (`bg-link`), and the typing line keeps `text-link`.
- Dark mode: the tokens switch by themselves. Check the `Badge` on the open tab and on the segment.
- Arabic (right-to-left, RTL): use logical classes only. The chevrons use `rtl:-scale-x-100`. A name keeps its own direction in `<bdi>`. The chip row wraps if an Arabic word is wider. The unread dot stays at the start side.
- Safari on iPhone: the page scrolls, not an inner panel, so the address bar and the safe area work. The search text is 16 px or more. Measure on WebKit.
- Touch targets: chips, segments, "Mark all read", Approve, the archived row and the back arrow are 44 px high. Check with `elementFromPoint`.

#### Files to change
- `src/features/inbox/InboxViews.tsx` (new): the title, the view switch with counts, the reads of the two counts.
- `src/features/inbox/ChatKindChips.tsx` (new): the chip row. It takes `kind` and `onChange`.
- `src/features/inbox/InboxScreen.tsx`: on a phone, draw `InboxViews`, drop the fixed height and the inner scroll, hide the title row when a chat is open, draw the `aside` without the panel.
- `src/features/inbox/ChatList.tsx`: draw the chips on a phone, move the "Archived (n)" row to the end, 16 px search text, panel around the rows only, `state.fromList` on the row link.
- `src/features/inbox/ConversationPane.tsx` and `markUnread.ts`: the back step with `navigate(-1)` when `state.fromList`.
- `src/features/notifications/NotificationsScreen.tsx`: on a phone draw `InboxViews`, move "Mark all read" to the heading of the first day, move Approve under the meta line.
- `src/components/SegmentedControl.tsx`: add optional `count` props (additive; the Work section needs the same change, so agree on one).
- `src/app/TabPill.tsx`, `src/app/AppShell.tsx`, `src/app/nav.ts` (`isNavActive`): the shell section owns them. This section needs: the Inbox tab sums the two counts, is open on `/notifications`, and has no bell on a phone. `screenKey` maps `/notifications` to `/inbox` on a phone only.
- `src/app/pressReads.ts`: the key of the Notifications press.
- Words: only in `src/i18n/real/phoned.en.json` and `phoned.ar.json`: `inbox.view.label`, `inbox.view.chats`, `chatFilter.group`, `nav.inboxBoth`. Arabic: «المحادثات» for Chats and «الإشعارات» for Notifications (the word of today). `nav.inboxBoth` in Arabic: «{{name}}، {{chats}}، {{notices}}».
- `DESIGN.md` and the "Calm rules" line in `src/CLAUDE.md`: the rule "no filter chip rows" gets one exception, the four chips of the phone Inbox. The line "Unread badge: red, on the Inbox and the bell only" stays true: the phone shows the bell count on the Inbox tab and its Notifications segment.
- No contract, server or MCP change.
- Tests that pin the old phone layout and must change: `src/app/TabPillLabels.test.tsx`, `src/app/AppShell.test.tsx` (bell badge and the names "Inbox, Unread messages: 3"), `src/app/rr2Shell.test.tsx`, `src/app/PressReads.test.tsx`, `src/features/inbox/InboxScreen.test.tsx`, `src/features/notifications/NotificationsScreen.test.tsx` (title and "Mark all read" position on a phone), `src/app/routes.test.tsx`. Playwright: `tests/e2e/shell.spec.ts`, `tests/e2e-deploy/shell.spec.ts`, `tests/e2e-deploy/calm.spec.ts`, `owner.spec.ts` (phone chat opens on its own page, link "Back to chats"). New phone tests stub `matchMedia`, as `TouchMenus.test.tsx` does: the chips share the state with the list, the scroll place on return, the tab sum, one right of two for "New message".

#### My calls
- The view switch is two addresses (`/inbox`, `/notifications`), not one address with a parameter. Old links, push lines and tests still open the same screens.
- The second segment keeps the word "Notifications" (the page title of the desk, the Settings word, the Arabic «الإشعارات»). The earlier draft used "Alerts", a second word for the same thing.
- The counts keep their look of today (lead decision): the red `Badge` on the tab and the segments, the `signature` count on a chat row. D adds no new colour.
- The chips are not navy.
- "Search chats" keeps its title, Arabic name and project name search. A message search stays in the Search screen.
- The "New message" sheet stays a `Sheet` with the people list first.
- The Approve toast with Undo stays. An in-row "Approved" state would change the row under the finger.
- No "Open" button beside Approve. The whole row opens the item.
- The Notifications count keeps the "needs action" rule. The unread dots can be more than the count.
- No press and hold on a row. A swipe archives, and the chat options sheet holds the rest.
- The page scrolls on a phone. The search and chips scroll away with the page. The back step restores the place.
- Quiet hours and `@everyone` need no screen of their own in the Inbox. The sentences and the rows exist in main.

#### Questions only the owner can answer
None. The `@` mark on a chat row is out of D (no contract change).


### A conversation (chat, group, project chat, to-do thread)

Paths start at `src/features/inbox/` unless they start with `src/` or with a folder name such as `components/`, `app/`, `files/` or `emoji/` (those are under `src/`). "Phone" means a viewport under 640 px (`useIsPhone`). The desk does not change.

#### Today on the phone
- A chat is the route `/inbox/:conversationId`. `InboxScreen.tsx` hides the list (`max-sm:hidden`) and shows the pane in a panel of `h-[calc(100dvh-9.5rem)]`. The top row (mark, Search, bell, picture) and the tab bar stay on screen. So the Back link is not the only way out today.
- The pane has three parts in one column: `Header`, `MessageLog` and `Composer` (`ConversationPane.tsx`, `MessageLog.tsx`, `Composer.tsx`). The Back link word is "Back to chats" (`chat.back`).
- No code reads the keyboard. There is no `visualViewport`, no `interactive-widget` and no safe-area space under the composer. On an iPhone the keyboard can cover the box.
- `Composer.tsx` puts the focus in the field when a chat opens. Enter adds a line on a phone. The Send button is a round icon.
- A long press of a finger (500 ms, `longPress.ts`) opens `MessageSheet`. The "..." button of a message does not show under a finger, except in the to-do panel (`inSheet`). The emoji panel is a bottom sheet.
- A group has `GroupMenu` (Rename, Mark as unread, Archive, Notify me) and a separate People sheet (`GroupSheets.tsx`). The to-do thread header has a wide "Open to-do" button, so its title takes two lines.
- The anchored `Menu` closes on any window scroll or resize (`components/Menu.tsx`). The toast lane sits at `bottom-24`, over the composer (`app/toasts.tsx`).
- There is no search in one chat. The Search screen has a Messages group, and a hit opens the chat at `?at=` (`features/search/MessageHits.tsx`).

#### D on the phone
Scope: no call, no server file and no MCP file changes. From 640 px the two-pane Inbox stays as it is.

**The page.** A chat opens as a full-screen page. Build it in `InboxScreen.tsx` as a phone branch. Render the chat root through a portal to `document.body`: `fixed inset-0 z-30`, the page background, a column layout. Two reasons:
- `.app-page` gets `transform: scale(.97)` when a sheet opens, and a `fixed` child inside it would move.
- The sheet overlay is `z-40`, sheets and the viewer are `z-50`, toasts are `z-[80]`. The chat root must sit below all of them.

A new hook, `app/useVisualViewport.ts`, sets the root height and top from `window.visualViewport` (`height`, `offsetTop`). It falls back to `100dvh` where the API is absent. So the composer follows the keyboard on Safari for iPhone. The root sets `overscroll-behavior: none`.

**The shell.** `AppShell.tsx` and `TabPill.tsx` hide the phone top row and the tab bar when the viewport is a phone and the path is `/inbox/:id`. This is a route test. It needs no store. The Inbox tab covers `/inbox/:id`, and the tab bar returns on Back. The shell track owns both files: give it this one line.

**Top to bottom:**
1. **Chat header** (`ChatHeader`, a phone variant of `Header`). Height 56 px plus `env(safe-area-inset-top)`, a hairline under it. Logical classes only. Items in this order:
   - Back link (`chat.back`, `ChevronLeftIcon`, `rtl:-scale-x-100`, 44 px). The screen that opens a chat passes `state={{ from: ... }}` (the chat list, a project page, a notice). Back calls `navigate(-1)` when that state is there, so the list keeps its scroll place; else it goes to `/inbox` (a push line, a mail link, a bookmark). Lead decision, shared with the Inbox section, step 6.
   - Picture 38 px: `ProjectTile`, `PersonFace` (with the presence dot) or `GroupPicture`. In a group, the picture is a button that opens the options sheet.
   - Title (`<bdi class="block truncate">`, `text-headline`, one line) and subtitle (`text-footnote text-ink-2`): Online, Away or Offline for a direct chat; "Project chat"; "N people" for a group (a button); "To-do thread · Project name" or "Office" for a to-do thread.
   - Search icon (44 px, label "Search messages"). It opens the Search screen on its Messages group: link `/search?in=messages`. The Search screen reads this mark, shows Messages first and hides Commands. There is no filter by chat, and no new call field.
   - "..." icon (44 px, label `chat.optionsFor`). It opens the options sheet.
2. **Message log** (`MessageLog.tsx`), `flex-1`, own scroll, `px-3`. All log parts stay: "Earlier messages", date lines, "New" line, bubbles, group lines, reason lines, Seen line, Newest button. The Newest button stays sticky inside the log at the end side.
3. **Strip above the composer.** Each part shows only when it has content, except the typing line (always one row high): "Show newer messages", the typing line, the reply strip, the picked files with their progress bars.
4. **Composer** (`Composer.tsx`), docked at the bottom: attach, emoji, text field, Send. Bottom space is `max(env(safe-area-inset-bottom), 0.5rem)`. With the keyboard open, the visual viewport sets the bottom. The field grows to 5 lines, then scrolls. The @ list opens above the field and stops under the header.
5. **Closed chat.** In place of the composer: the note for an inactive person, a group with nobody left, a direct chat or group when `chat.direct` is off, or a to-do thread without the comment right. A project chat always has the composer.

**One options sheet for all four kinds** (new `ChatOptionsSheet`, built from `GroupSheets.tsx`; mockup D-Options). It replaces the anchored menu on a phone, so a new message or a viewport resize cannot close it. Standard `Sheet` header: title row and X. No Done button.
- Header: the picture, the name, and "Group chat · N people" for a group.
- Group only, part "People in the group": one row for each person (face with dot, name, "You", "Group maker", Online/Away/Offline, a Message button). The own row passes `mine` and can say "Away (set by you)". Remove stays on the person row for the maker.
- Group only, rows with an icon in ink: Add people and Rename (right `chat.groupChange`).
- Project chat: first row "Open the project". To-do thread: first row "Open to-do".
- All kinds: Notify me (two rows with a tick, and the note; not for a to-do thread), Mark as unread, Archive or Move back to Inbox.
- Group only, last row: Leave group, in the destructive look of today.
- The Add, Rename and Leave sheets open after this sheet closes. A sheet in a sheet fails in vaul: use the `'wait'` then `'on'` steps of `MessageSheet`.

**Other sheets** (reuse `components/Sheet.tsx`):
- **Message sheet** (`MessageSheet`): stays as it is. Title "name · time" or "Your message · time", the first line as description, the reactions row (👍 ✅ 👀 and +, 56 px), then Reply, Copy text, Edit, Delete. It does not open when it has no reaction and no row (a chat without `chat.direct` shows only "Copy text", and nothing where the browser cannot copy).
- **Emoji sheet**: the row of 8 group buttons moves under the grid (`layout="sheet"`). It stays hidden while a search text is typed.
- **Picture viewer** (`components/ImageViewer.tsx`): as today, with `env(safe-area-inset-bottom)` space at the bottom. Gestures only. It has no zoom button.

**Reuse list.** `MessageLog`, `MessageBubble`, `Composer`, `MentionField`, `ReactionPills`, `ReplyStrip`, `SeenLine`, `TypingLine`, `NewerMessages`, `chatMenuItems`, `useNotifyItems`, `GroupSheets`, `GroupPicture`, `PersonFace`, `ProjectTile`, `Sheet`, `EmojiSheet`, `ImageViewer`, `AnimatedIcon`. Write no new bubble, no new list and no new picker.

**Rules for the build.**
- Use `useIsPhone()` for the phone branch. CSS alone cannot do it, because the portal needs a JavaScript switch. The jsdom default (not a phone) keeps the desk tests as they are.
- Put the entrance motion on the portal root, keyed by the conversation id only. `ConversationPane` remounts `ChatPane` on each `?at=` change. A key with `?at=` would replay the motion.
- The root calls `useSheetToasts(true)`. The toast lane then moves to the top, and Undo stays in reach with the keyboard open.
- Focus: the field takes the focus only after a press that points at it (Reply, Send, an @ pick). It never takes the focus when a chat opens, after Save of an edit, or when a sheet closes. Test with the keyboard open on WebKit.
- Unsent messages live in the `ChatPane` state and vanish on Back. When the pane closes with a failed entry, write its words into the draft of that chat (`app/drafts.ts`). Test first: send, press Back at once, go offline.
- Keep `role="log"` on the log and `aria-live="polite"` on the typing line. The portal sits outside `.app-page`, so the `inert` of `usePanelOpen` does not cover it. Add a test that a sheet over the chat page hides the page from a screen reader.
- A `#code` link or a Madar address in a bubble leaves the chat. Test that Back or the system swipe returns to the same chat. Inline links stay text links.
- Every page state of the chat carries the Back link: loading, error and not found.
- Safari on iPhone: test the "New" line, the Newest button and the @ list with the keyboard open, in the Home Screen app.
- Dark mode and Arabic need no new colour.

#### Every feature and its place

| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Back link "Back to chats" | ConversationPane.tsx (Header) | First item of the chat header, 44 px, to `/inbox`. It is the only exit inside the page. | Change |
| Phone top row and tab bar over an open chat | app/AppShell.tsx, app/TabPill.tsx | Hidden on `/inbox/:id` on a phone. The tab bar returns on Back. | Hide-on-phone |
| List and chat side by side | InboxScreen.tsx | Phone: the list or the chat, never both. The chat is a full-screen page. | Change |
| "Select a chat" empty pane | InboxScreen.tsx | Not shown on a phone. | Hide-on-phone |
| Project picture, face with presence dot, group picture | ConversationPane.tsx, PersonFace, GroupPicture | 38 px. The group picture is a button that opens the options sheet. | Change |
| Title, cut at its end in any language | ConversationPane.tsx (Header) | One line. | Keep |
| Subtitles: Online/Away/Offline, "Direct message", "Inactive", "Project chat" | ConversationPane.tsx | Same. No people count on a project chat. | Keep |
| Subtitle "N people" of a group, as a button | ConversationPane.tsx | A press opens the options sheet at the People part. | Change |
| To-do thread header: two-line title, "Open to-do" button, task icon | ConversationPane.tsx (TaskPane) | One title line. The subtitle "To-do thread · Project" or Office stays. The icon stays hidden. | Change |
| "Open to-do" button | ConversationPane.tsx (TaskPane) | First row of the options sheet. Same link. | Move |
| Search in a chat | Not in the code | Search icon in the header. Opens `/search?in=messages`. | Change |
| "..." menu of a direct chat, project chat, to-do thread | ChatList.tsx (ChatMenu) | The same items as rows of the options sheet. The desk keeps the anchored menu. | Change |
| "Open the project" (project chat) | Not in the code | First row of the options sheet. Link to the project. | Change |
| Mark as unread | ChatList.tsx, markUnread.ts | Same. It closes the chat today; the list shows, with the Undo toast. | Keep |
| Archive and Move back to Inbox | ChatList.tsx, archive.ts | Archive also goes to `/inbox` on a phone (today it stays in the chat). Same Undo toast. Move back stays. | Change |
| Notify me: All messages, Only when I am named, note | NotifyChoice.tsx | Two rows with a tick, and the note. | Move |
| Quiet hours (batch B, in main) | features/settings/QuietHoursSection.tsx | No chat screen. Outside the work hours of the person, Madar sends no push and no email, and the bell keeps all. The switch is in Settings. | Keep |
| Group menu: Rename, Mark as unread, Archive, Notify me | ConversationPane.tsx (GroupMenu) | Rows of the options sheet. Same rights. | Move |
| People sheet: names, "You", "Group maker" | GroupSheets.tsx | First part of the options sheet. | Merge |
| Presence of each person in the People list | Not in the code | Dot on the face and the word Online, Away or Offline. The own row can say "Away (set by you)". | Change |
| "Message" button on a person row | Not in the code | Opens or starts the direct chat (`chats.openDirect`). Hidden without `chat.direct` and on the own row. | Change |
| Add people, Add sheet with the note | GroupSheets.tsx (AddSheet) | Row in the options sheet. Same sheet. | Keep |
| Remove on each other row (maker only), toast with Undo | GroupSheets.tsx | Same button on the row, 44 px. No extra row. | Keep |
| Rename sheet | GroupSheets.tsx (RenameSheet) | Same sheet. | Keep |
| Leave group, Leave confirm, toast, go to the list | GroupSheets.tsx (LeaveSheet) | Last row of the options sheet, in ink. Same confirm, same words. | Move |
| Date lines, "Earlier messages", "New" line, Newest button, empty text | MessageLog.tsx, earlier.ts, newLine.ts | Same. The Newest button sits at the end side inside the log, no count. | Keep |
| Keep my place, open at the "New" line or at the end | MessageLog.tsx, logScroll.ts | Same. The log height follows the visible screen. | Keep |
| First mount of 60 bubbles, the rest at idle | MessageLog.tsx, logStage.ts | Same. | Keep |
| Face and name once for each run of 5 minutes | runs.ts, MessageBubble.tsx | Same. Face 28 px. | Keep |
| Agent label and "on behalf of" line | MessageBubble.tsx | Same. | Keep |
| Own bubble (blue) and other bubble (grey) | MessageBubble.tsx | Same. Width 88 percent at most. | Keep |
| Time in the first bubble of a run | MessageBubble.tsx | Same. | Keep |
| Time of the next bubbles of a run (hover only) | MessageBubble.tsx | A phone has no hover. The time is in the title of the message sheet today. No change. | Keep |
| Tint and bar for a message that names you | MessageBubble.tsx | Same. | Keep |
| Text in a bubble: web links, @names, `#code` links, line breaks | components/RichText.tsx | Same. A `#code` link or Madar address leaves the chat (see rules). | Keep |
| @everyone, @all, @الجميع look like a mention (batch B, in main) | components/RichText.tsx, MessageBubble.tsx | Same. | Keep |
| Quiet line of a group (added, removed, left, renamed) | MessageBubble.tsx | Same. | Keep |
| Reason line of a to-do (date move, reopen, Madar shift) | MessageBubble.tsx | Same. | Keep |
| Reply quote, quote of a deleted message, go to the old message | ReplyStrip.tsx, MessageLog.tsx | Same. | Keep |
| Reaction pills, names on press and hold, plain text when the reader may not react | ReactionPills.tsx | Same. 44 px press area. | Keep |
| "edited" tag | MessageBubble.tsx | Same. | Keep |
| Delete with toast "Message deleted." and Undo | deleteMessage.ts | Same. The toast shows at the top. | Keep |
| Message that waits to go, "Not sent" and "Send again" | outbox.ts, MessageBubble.tsx | Same. See the rule for Back with a failed entry. | Keep |
| Picture preview and file chip with a cut name | files/PictureAttachments.tsx | Same. A press opens the viewer. | Keep |
| File chip height | files/Attachments.tsx (FileChip) | 44 px press area on a phone (today `min-h-8`). | Change |
| "File removed" chip (deleted file) | files/Attachments.tsx | Same. It is text, not a control. | Keep |
| File names as the words of a file-only message | MessageBubble.tsx | Same. | Keep |
| "Seen" (direct chat), "Seen by N" and "Seen by everyone" with names | SeenLine.tsx | Same. The popover opens upward inside the screen. | Keep |
| Typing line, typing signal | TypingLine.tsx, app/live/typing.ts | Same, above the composer. | Keep |
| "Show newer messages" | NewerMessages.tsx | Same. | Keep |
| Soft frame on the opened message, open at `?at=` | MessageBubble.tsx, ConversationPane.tsx | Same. | Keep |
| Drop frame "Drop to attach", block of browser file open | ChatDrop.tsx, files/Attachments.tsx | A phone has no file drag. The code stays. | Desk-only |
| Mark read while the person looks | ConversationPane.tsx | Same. No screen. | Keep |
| Composer position | Composer.tsx | Docked at the bottom, safe-area space, follows the keyboard. | Change |
| Attach and Emoji buttons | files/Attachments.tsx, emoji/EmojiButton.tsx | Same, 44 px. | Keep |
| Text field, phone hint "Use @ to mention." | Composer.tsx, components/MentionField.tsx | Same. Max height is 40 percent of the visible screen. | Change |
| Focus in the field when a chat opens | Composer.tsx | Off on a phone. See the focus rule. | Change |
| @ list (5 names, best match first) | components/MentionField.tsx | Same. Its height stops under the header (a prop). | Change |
| Row "Everyone" in the @ list (batch B, in main) | components/MentionField.tsx | Same. It shows for a writer with `chat.mentionEveryone` when the count is above 0. A direct chat has none. | Keep |
| Send button (round icon, off when empty) | Composer.tsx | Same. The one navy item on the page. | Keep |
| Enter adds a line on a phone, draft per chat, paste of pictures | Composer.tsx, app/drafts.ts | Same. | Keep |
| Picked files with Remove, progress bar, limit of 10 | files/Attachments.tsx (PickedFiles) | Same, above the field. | Keep |
| Reply strip with X | ReplyStrip.tsx | Same. | Keep |
| Escape drops the reply. Up key edits the last message. | Composer.tsx | Desk keyboard only. On a phone, use Edit in the message sheet. | Desk-only |
| Closed-chat notes: inactive person, nobody left in a group, messages off for the role (direct chat or group), no comment right (to-do thread) | ConversationPane.tsx | Same note in place of the composer. | Keep |
| Long press (500 ms) opens the message sheet | longPress.ts, MessageBubble.tsx | Same. Touch only. | Keep |
| Message sheet: title with time, first line, reactions row, Reply, Copy text, Edit, Delete | MessageMenu.tsx (MessageSheet) | Same. It does not open with nothing to show. Copy toast "Text copied." | Change |
| "+" in the reactions row | MessageMenu.tsx | Same. The message sheet closes first. | Keep |
| "..." button of a message under 640 px with a mouse | MessageMenu.tsx (MessageTools) | A mouse keeps it. A finger does not. | Desk-only |
| Edit in place: field, Cancel, Save | MessageEditForm.tsx | Same. On a phone, Enter adds a line. | Change |
| Emoji sheet: search, Recent, 8 groups, skin tone, "no result" | emoji/EmojiPanel.tsx | Same. The search field does not take the focus when the sheet opens. | Keep |
| Emoji group row | emoji/EmojiPanel.tsx | Under the grid. | Change |
| Emoji pick at the caret, sheet stays open | Composer.tsx, emoji/insert.ts | Same. | Keep |
| Picture viewer: full screen, name, "2 of 5", Download, X, Previous and Next | components/ImageViewer.tsx | Same. Tap on the dark space closes it at 1x. Safe-area space at the bottom. | Change |
| Pinch, double tap, pan | components/useImageZoom.ts | Same (fbk_038). No zoom button. | Keep |
| Zoom keys and wheel, Escape | components/useImageZoom.ts | Desk only. | Desk-only |
| "Picture cannot show" line | components/ImageViewer.tsx | Same. | Keep |
| Load error with Try again, blank page while loading, unknown chat id | ConversationPane.tsx | Same, and the Back link shows at once in each state. | Change |
| Toast lane | app/toasts.tsx | At the top while the chat page is open. | Change |
| Message hit in Search opens the chat at that message | features/search/MessageHits.tsx | Same link (`?at=`). The chat opens full screen. | Keep |
| Chat of an Admin outside the project (counts only named messages) | ConversationPane.tsx | Same. | Keep |
| Comments of the to-do panel share the bubble, sheet, emoji panel, @ list and viewer | features/comments/TaskComments.tsx (`inSheet`) | Each change above must keep the `inSheet` path as it is (no long press, "..." button). | Keep |

#### Motion and look
Reuse what exists. `MotionConfig reducedMotion="user"` in `main.tsx` removes movement for a person who asks for less motion. It keeps opacity.
- Bubble rise, sheets (vaul, `Sheet` spring), `.pressable` press, viewer zoom and fade, typing dots: no change. Each already has its reduced-motion rule.
- Icons: `AnimatedIcon` for back, search, "...", attach, emoji, send, reply, copy, edit, delete, download, x, users. The icons of the options sheet rows use `playWhen={open}`: they play once when the sheet opens. `AnimatedIcon` never plays for reduced motion.
- New motion 1: the chat page enters from the end side. `x: 48` (`-48` in Arabic) and opacity, `spring.standard`, as `ScreenEntrance` does. Reduced motion: opacity only. Back has no exit motion.
- New motion 2: the tab bar returns on Back with `translateY 12 px` and opacity, `spring.standard`. It uses a `motion-safe:` class. Reduced motion: no movement. The pill highlight (`layoutId="pill-active"`) starts on Inbox.
- Look: tokens only. No coloured icon tile. A state is a shape plus an ink word: the presence dot and its word, the tick on Notify me. Navy (`signature`) only on Send, the one main action. Red only for errors: "Not sent" stays `text-late`. Delete, Leave group and Remove keep the destructive look of today (DESIGN.md `button-destructive`). Add people and Rename are ink rows with an icon.
- Touch size: every control is 44 px or more. Check with `elementFromPoint`.
- Fonts: Thmanyah Sans from `tokens.css`. Digits use `tabular`.

#### Files to change
- `InboxScreen.tsx`: phone branch with the portal root (`fixed inset-0 z-30`), `useSheetToasts(true)`, no panel box, no `ScreenTitle` while a chat is open, the entrance motion.
- `ConversationPane.tsx`: `ChatHeader` for a phone; `ChatPane` and `TaskPane` use it. The Back link shows in the load, error and not found states. The "Open to-do" button moves to the options sheet. The pane writes a failed entry into the draft when it closes.
- `GroupSheets.tsx` and a new `ChatOptionsSheet.tsx`: one sheet for all four kinds. People content moves in. Add the Message button, the presence word and `mine`.
- `ChatList.tsx`: `chatMenuItems` takes an optional first item ("Open the project" or "Open to-do").
- `archive.ts`: go to `/inbox` after Archive when the archived chat is the open one (as `markUnread.ts` does).
- `Composer.tsx`: no focus at the open on a phone, safe-area space, max height of the field.
- `MessageEditForm.tsx` and `ConversationPane.tsx` (`endEdit`): Enter adds a line on a phone; no focus after Save on a phone.
- `MessageBubble.tsx` and `MessageMenu.tsx`: the message sheet does not open with nothing to show.
- `MessageLog.tsx`: bottom space and Newest button place with the docked composer.
- `files/Attachments.tsx`: 44 px press area of `FileChip` on a phone.
- `src/components/MentionField.tsx`: max height of the list on a phone (a prop).
- `emoji/EmojiPanel.tsx`: group row under the grid for `layout="sheet"`.
- `components/ImageViewer.tsx`: safe-area space at the bottom.
- `features/search/SearchScreen.tsx`: read `?in=messages` (screen only, no call): Messages first, Commands hidden. Another track may own this file.
- New `app/useVisualViewport.ts`.
- `app/AppShell.tsx`, `app/TabPill.tsx`: hide on `/inbox/:id` on a phone. Another track owns both files.
- New words in `src/i18n/real/phoned.en.json` and `phoned.ar.json` (Arabic in the Thmanyah style, Western digits): "Search messages", "Open the project", "Message" (person row), and the group line "Group chat · N people". Reuse `chat.groupChat`, `chat.groupOptions`, `chat.peopleTitle`, `chat.leaveGroup`, `presence.awayByYou`, `chat.optionsFor`. Add a key only when none exists.
- `src/whatsNew/entries.ts`: one entry for the new phone layout, at the end of the whole job.
- Tests that pin the old phone layout and must change:
  - `ChatTitle.test.tsx` (two-line to-do title, "Open to-do" link in the header).
  - `InboxScreen.test.tsx` (the People sheet and the group count button, lines 705 to 850; "the way on a phone" menu, line 622; the panel height). Its "Back to Inbox" lines 444 to 446 test the archived list and do not change.
  - `ConversationPane.test.tsx`, `OpenAtMessage.test.tsx` (header and Back link).
  - `ComposerKeys.test.tsx`, `ComposerEmoji.test.tsx` (focus at the open).
  - `MessageMenu.test.tsx`, `ReactionAny.test.tsx`, `TouchMenus.test.tsx` (phone sheet).
  - `EditDelete.test.tsx` (Enter in the edit form).
  - `emoji/EmojiPanel.test.tsx`, `emoji/EmojiStage.test.tsx` (group row place).
  - `components/ImageViewer.test.tsx` (safe-area class).
  - `app/AppShell.test.tsx`, `app/rr2Shell.test.tsx` (top row and tab bar on an open chat).
  - `ChatFaces.test.tsx` (counts of the person menu).
  - Playwright at 390 px: `tests/e2e/owner.spec.ts` and `tests/e2e-deploy/owner.spec.ts` (lines 49 to 59 click the link "Back to chats"). Check `tests/e2e-deploy/walk.spec.ts` line 390 for its viewport.
- New tests first: phone branch (portal, z order, shell hidden on `/inbox/:id`, Back in every state), no focus at the open, edit Enter, options sheet for each kind (rights `chat.groupChange` and `chat.direct`, maker), Archive goes to the list, the message sheet does not open empty, `useVisualViewport` with a fake `visualViewport`, toast lane at the top, failed entry kept as draft, sheet over the portal hides the page from a screen reader, `/search?in=messages`.
- No change: `src/api/`, `server/`, `server/mcp/`, `supabase/`.

#### My calls
- The phone chat is a portal page with `fixed inset-0 z-30`, not a flow page. Reason: the `.app-page` transform and the keyboard. The z value stays under the sheets (40 and 50) and the toasts (80).
- The shell hides its bars by route. This needs no new store, and it cannot fall out of step with the page.
- The keyboard uses `visualViewport`, with `100dvh` as the fallback. No `interactive-widget` tag, because Safari for iPhone may ignore it.
- All four chat kinds get the options sheet on a phone. The anchored `Menu` closes on any scroll or resize, and a new message scrolls the log.
- The sheet has no Done button. The X does the same, and the owner rule is the fewest controls.
- The People sheet merges into the options sheet. One press on the picture or on the count opens it.
- Back goes to `/inbox`, because the chat belongs to the Inbox tab. The system back gesture goes to the earlier page. A chat can open from the project, Search, a notice or a share, and the person never gets lost.
- Archive goes to the list, as Mark as unread does. The person does not stay in a chat that now says "Move back to Inbox".
- No focus in the field when a chat opens on a phone. The keyboard would cover the last messages and the "New" line.
- The message sheet stays as it is. Its description already shows the first line, and its title already has the time. A "Seen by" line would repeat the Seen line under the message.
- Delete, Leave group and Remove keep the destructive look of today (lead decision: D adds no colour and removes none).
- The leave confirm keeps its words. The mockup word "Stay" is not used.
- The viewer keeps the side arrows and the gestures. It has no zoom button and no caption.
- The Newest button stays inside the log, so it never covers the composer.
- The chat header Search icon searches the whole office on the Messages group. Its label says "Search messages", not "Search in this chat".

#### Questions only the owner can answer
None.


### Me (settings, person menu, office tools)

Paths are under `src/` unless a path starts with `tests/`, `server/` or `docs/`. The phone is a viewport under 640 px (`useIsPhone`). The desk does not change.

#### Today on the phone
- The picture button of the person sits in the phone top bar, next to Search and the bell (`app/AppShell.tsx` line 162, `app/PersonMenu.tsx`). A press opens a pop-up with up to 9 items: Preview as (prototype), Language, Dark mode, Admin, Show me as Away, Settings, What's new, Request a feature, Sign out (real build).
- Settings is one long column at every width (`features/settings/SettingsScreen.tsx`). It has 11 panels: Profile, Language, Theme, What reaches me (Admin), Notifications, Notify me on this device, Quiet hours, Google Calendar, Password, Agents, Prototype. No hub exists.
- The Admin page has a phone shape: a list of sections, then one section with a back link (`features/settings/admin/AdminScreen.tsx`). The Dashboard is a tab. Its four view tabs scroll sideways (`components/Tabs.tsx`).
- Every time is 12-hour (`lib/dates.ts` line 129). No clock choice exists.
- The link "See what's new" sits on the Home date line while the newest entry is unseen (`features/home/HomeScreen.tsx` line 65). The ask card and the Home Screen steps sit on Home (`features/home/PushAskCard.tsx`).
- Focus mode is a full page over the app. It sets `nav[data-pill]` and `.app-page` to inert (`features/focus/FocusMode.tsx` line 129).
- Batch B is in main: Quiet hours (`QuietHoursSection.tsx`), the right "Mention everyone" in the role sheet, and the @everyone notice (a Mention notice, push only, never email, `api/notify.ts` line 30). The Notifications grid has no extra row for it.

#### D on the phone
**Routes (phone only).**
- `/me` is the hub. `/me/:section` is one sub-page. The section ids are `profile`, `reach`, `notices`, `quiet-hours`, `calendar`, `password`, `agents`. The new file `features/me/meSections.ts` holds the list, like `admin/sections.ts`. Add the screens `me` and `meSection` to `app/screens.ts`, `app/screenLoaders.ts` and `app/screenLoaders.static.ts`.
- `/settings` on a phone opens the hub: it goes to `/me` with `replace`. When the hash starts with `google=`, it goes to `/me/calendar` and keeps the hash. The Google callback (`server/google/callback.ts`) and the links in What's new keep the address `/settings`. No server change.
- On a desk, `/me` and `/me/:section` go to `/settings`. The desk Settings page and the desk person menu stay as they are.
- The Me tab shows as open on `/me*`, `/settings`, `/whats-new`, `/dashboard`, `/tasks`, `/admin*` (`app/nav.ts`, `isNavActive`; shell track). `/projects` and `/meetings` open Work, not Me.
- Top row: the Madar mark or a back link at the start, the global Search icon at the end. The hub adds no other search icon.
- Back links (copy the look of the project back link in `app/AppShell.tsx`): "Me" on `/me/:section`, `/admin`, `/dashboard` and `/whats-new`. "Dashboard" on `/tasks`, only with the right `dashboard.view` (else the mark). On `/admin/:section` the mark stays and the in-page back link to the Admin list stays. `/dashboard/meeting` and `/dashboard/space` stay full screen, outside the shell.
- A phone that turns sideways passes 640 px, and the redirect then unmounts the page. An unsaved name on `/me/profile` is lost. The Google return step runs once, before the redirect. Accept this (see "My calls").

**The hub (`/me`), from top to bottom.** New file `features/me/MeScreen.tsx`. It has no main button. A group word sits above each group (`text-footnote font-medium text-ink-2`, as in `AdminScreen.tsx`). Each panel uses `panel hairline overflow-hidden`. A row is the new part `features/me/MeRow.tsx`: 56 px high, 44 px press area, a 20 px `AnimatedIcon` in `text-ink-2` at the start, a title (`text-subheadline font-medium`), an optional second line (`text-footnote text-ink-2`), an optional value or control at the end. A row that opens a page has a `ChevronRightIcon` with `rtl:-scale-x-100`. A row with a control is a `div`, not a link. No coloured tile sits behind an icon.
1. `ScreenTitle` "Me". While `session.get` has no answer, draw the title only.
2. Panel 1, no group word.
   - Profile row (link to `/me/profile`). `PersonFace` with `mine` at 56 px (it draws the own state dot). The name (`usePersonName`). The line "discipline, role": the role word is `admin.roles.<systemRole>` or the name of the custom role (`settings.get`, as `PeopleSection.tsx` line 33). A third line in `text-ink-2`: "Picture, names, discipline".
   - Away row, only when the runtime has a `live` port. Title "Show me as Away". Second line: `presence.<myState>`, or `presence.awayByYou` when `awayByHand` is on. A `Switch` saves `me.updatePreferences({ awayByHand })`.
3. Heading "Settings". Three panels sit under it, with no group word of their own.
   - Panel 2, two rows. Each row has the label on top and a full-width `SegmentedControl` under it (equal parts, 44 px high, `role="radiogroup"` and `role="radio"` kept). Language: English, العربية (runs `useSwitchLanguage`). Theme: System, Light, Dark (saves `me.updatePreferences({ theme })`).
   - Panel 3, in this order:
     - "Notify me on this device" with a `Switch` (`usePushDevice`). Real build only. When the browser cannot push, the row has no switch. A `role="status"` line gives the reason (`push.unsupported`, `push.notSet`, `push.blocked`). For `needs_install` the row shows no line: the next row carries the step. A failed turn on or off shows `push.error` or `push.offError` in `FormError`.
     - "Add Madar to the Home Screen". Real build only. It shows when it helps. On an iPhone or iPad in a browser tab (`push.status === 'needs_install'`), a press opens a `Sheet` with the 3 steps (`push.homeScreenStep1` to `3`). On Android, when Chrome holds the install event (`canInstall` in `app/remote/install.ts`), a press calls `promptInstall()`. Otherwise the row is absent.
     - "Quiet hours" (link to `/me/quiet-hours`). Second line: "Sun to Thu, outside 9 AM to 5 PM" from `workHoursOf`, `daysPhrase` and `clockLabel` (`features/settings/workRange.ts`), or "Off".
     - "Notifications of each kind" (link to `/me/notices`). Second line: "In the app and by email" (prototype: "In the app").
     - "Morning summary" with a `Switch`. Real build only. It reads `morningSummaryOn` and saves `notifications.updateSettings({ morningSummary })`.
     - "What reaches me", only for the Admin role. The value at the end is the short label of the choice (`adminReach.<choice>.label`). Link to `/me/reach`.
   - Panel 4:
     - "Google Calendar" (link to `/me/calendar`). The value is the state from `google.status`: Connected, Connect again, or none. The prototype shows its one line on the page and no value.
     - "Password" (link to `/me/password`). Real build only.
     - "Agents" (link to `/me/agents`). Real build only. The word is the same as the title of the page (`agents.title`) and as the texts "Settings, Agents" in the consent screen and the errors. Without the right `ai.connect` the row stays, because the person must still remove old agents.
4. Group "Office".
   - "Dashboard", second line "The numbers and what needs attention". Only with the right `dashboard.view` (`useRight`). Link to `/dashboard`, in its phone shape of today.
   - "Admin" for the Admin role, "Office" for another role (`adminPage.officeTitle`). Only when `opensAdminPage(session.authority)` is true. Second line: "Best on a computer". Link to `/admin`.
   - "What's new", with the word `whatsNew.newMark` at the end while `hasNew(WHATS_NEW, readSeen(user.id))` is true. No dot and no bold title. Link to `/whats-new`.
   - "Request a feature or report a bug". Only with `feedback.send`. A press opens `LazyFeedbackSheet` (`app/overlays.tsx`), mounted with `useOnceOn` as in `PersonMenu.tsx`. Focus returns to the row when the sheet closes.
5. Group "Prototype". Prototype build only. `PreviewAs`, the `Switch` "Simulate errors" with its hint, and the button "Reset sample data" with its confirm `Sheet`. The code moves from `SettingsScreen.tsx` into `features/settings/PrototypeTools.tsx`, so the desk and the hub share it.
6. "Sign out". Real build only. A full-width secondary `Button`, 48 px high, last on the page. It calls `useSignOut()`. It asks nothing, as today. It is disabled while the call runs (up to 4 seconds: the push device leaves first), so a second tap starts no second call. It is not red and not navy.

**The sub-pages (`/me/:section`).** New file `features/me/MeSectionScreen.tsx`. It reads the `section` param, shows `ScreenTitle` with the section title, and draws the section part that exists today. An unknown section goes to `/me`. A section that the person may not use goes to `/me` too (`reach` needs the Admin role). A small context sets a `bare` mode: the visible `h2` becomes `sr-only` (it stays for `aria-labelledby`), because the page has the title. `SettingsSection` (`features/settings/Section.tsx`) and `ProfileSection.tsx` (it draws its own `section` and `h2#settings-profile`) both read the context. On a desk the context is absent and nothing changes.
- `profile`: `ProfileSection.tsx`. The form is one column below 640 px already. The email line first. Save is the quiet `Button`. The frame step stays a bottom `Sheet`.
- `reach`: `AdminReachSection.tsx`. The 3 radio rows are 44 px or more already.
- `notices`: `NotificationsSection.tsx`. In `bare` mode it leaves out the Morning summary block (the block and its `border-t` wrapper, real build only). The desk keeps the block. The column names In app and Email are `sticky` under the title.
- `quiet-hours`: `QuietHoursSection.tsx`. The 7 day toggles wrap in one or two rows. The two time selects stay side by side.
- `calendar`: `GoogleCalendarSection.tsx`. "Connect Google Calendar" or "Connect again" is the one main button.
- `password`: `PasswordSection.tsx`. The fields stack below 640 px already. Drop `sm:mt-[1.6rem]` and make the button full width. The button word stays "Change the password".
- `agents`: `AgentsSection.tsx`. The row keeps its name, meta line and Remove button (44 px high).

**Other screens that the Me tab opens.**
- What's new (`features/whatsNew/WhatsNewScreen.tsx`): no change. Only the back link is new.
- Admin (`/admin`): the list is the page. Each group is a panel of rows, as today. The sections keep their phone shape. No "Open this on a computer" line appears in Me (see "My calls").
- Dashboard (`/dashboard`): no change at all. The tabs, the Filter button, "Team meeting" (the one main button) and "Open space" stay as they are.
- Lists behind the numbers: `/tasks?...` opens with the Me tab open and the back link "Dashboard". `/projects?...` opens in Work.
- Focus mode: no change to the page. Its code that sets `nav[data-pill]` inert must name the new tab bar.

**States.** The hub draws at once from the cached `session.get`. The `settings.get` and `google.status` values fill in later, with no spinner. A failed read leaves the row without its value. A refused save shows the usual toast. A row never shows a disabled switch: where a switch cannot work, the row shows a note and no switch.

#### Every feature and its place
| Feature | Today (file) | Place in D | Kind |
| --- | --- | --- | --- |
| Picture button with own state dot | `app/PersonMenu.tsx`, `app/AppShell.tsx` line 162 | Leaves the phone top bar. The same face is in row 1 of the hub | Move |
| Person pop-up box | `app/PersonMenu.tsx` | None on a phone. The desk keeps it | Desk-only |
| Name and status line (presence line, or email) | `PersonMenu.tsx` line 73 | Profile row (name, role) and Away row (state line) | Move |
| Preview as person (prototype) | `app/PreviewAs.tsx` | Group "Prototype", end of the hub | Move |
| Language one-press toggle | `PersonMenu.tsx` line 86 | Language row with two choices | Change |
| Light or dark one-press toggle | `PersonMenu.tsx` line 90 | Theme row with System, Light, Dark | Change |
| Admin or Office link | `PersonMenu.tsx` line 94 | Group "Office" row, line "Best on a computer" | Move |
| Show me as Away switch | `PersonMenu.tsx` line 100 | Away row in panel 1 | Move |
| Settings link | `PersonMenu.tsx` line 110 | The hub is Settings. The item has no use | Merge |
| What's new link with the word New | `PersonMenu.tsx` line 116 | Group "Office" row with the word New | Move |
| Request a feature or report a bug | `PersonMenu.tsx` line 122 | Group "Office" row. Same sheet | Move |
| Sign out | `PersonMenu.tsx` line 128 | Last button of the hub. Disabled while it runs | Move |
| Focus back to the picture after close | `PersonMenu.tsx` `close()` | Not needed: the hub is a page | Desk-only |
| Feedback sheet (title, hint, Cancel, Send, sent toast) | `features/feedback/FeedbackSheet.tsx` | Same sheet, opened from the Office row | Keep |
| Feedback kind: Feature or Bug | `FeedbackSheet.tsx` | Same | Keep |
| Feedback message box (2000 letters, field error) | `FeedbackSheet.tsx` | Same | Keep |
| Add screenshot button (3 at most) and thumbnails | `FeedbackSheet.tsx` | Same | Keep |
| Remove button on a thumbnail (28 px today) | `FeedbackSheet.tsx` | Grow the press area to 44 px with an `after:` strip | Change |
| Paste hint (Cmd+V text) | `FeedbackSheet.tsx` | Hide where the pointer is coarse (`usePointerCoarse`) | Hide-on-phone |
| Screenshot upload bar | `FeedbackSheet.tsx` | Same | Keep |
| Page note ("sent with the page") | `FeedbackSheet.tsx` | Same | Keep |
| What's new cards by day | `features/whatsNew/WhatsNewScreen.tsx` | Same screen. Back link "Me" | Keep |
| Word New on a newer entry | `WhatsNewScreen.tsx` | Same | Keep |
| Link "Open" on an entry (checks the right) | `WhatsNewScreen.tsx` | Same. Keep the 44 px press area | Keep |
| Entry hidden without its right | `WhatsNewScreen.tsx` | Same | Keep |
| Mark seen when the page opens | `whatsNew/seen.ts` | Same. It clears the word on the Office row and the Today link | Keep |
| Home date line link "See what's new" (only while unseen) | `features/home/HomeScreen.tsx` line 65 | Stays on Today. The Me tab has no badge, so this link is the only sign of a new entry outside Me | Keep |
| Picture and email at the top of Profile | `features/settings/ProfileSection.tsx` | Hub row 1 (56 px face), and the top of the Profile page (72 px, email) | Change |
| Add or Change picture button | `ProfileSection.tsx` | Profile page | Keep |
| Remove picture button (Undo toast) | `ProfileSection.tsx` | Profile page | Keep |
| See-through hint | `ProfileSection.tsx` | Profile page | Keep |
| Picture frame step: drag, zoom slider, three round previews, Cancel, Save | `features/settings/AvatarFrameSheet.tsx`, `components/PictureFrame.tsx` | Same bottom sheet. Add `data-vaul-no-drag` to the frame so a drag moves the crop and not the sheet | Keep |
| Picture errors: too big, cannot read | `AvatarFrameSheet.tsx`, `ProfileSection.tsx` | Same | Keep |
| Name in English (required, field error) | `ProfileSection.tsx` | Profile page, one column | Keep |
| Name in Arabic (own direction) | `ProfileSection.tsx` | Profile page | Keep |
| Discipline field | `ProfileSection.tsx` | Profile page | Keep |
| Save button and toast "Profile saved" | `ProfileSection.tsx` | Profile page | Keep |
| Profile heading `h2` | `ProfileSection.tsx` line 56 | `sr-only` in `bare` mode (own change, it does not use `SettingsSection`) | Change |
| Language choice with the page turn | `SettingsScreen.tsx` line 49 | Hub, panel 2 | Move |
| Theme choice: System, Light, Dark | `SettingsScreen.tsx` line 58 | Hub, panel 2 | Move |
| What reaches me: 3 choices, saved with a toast (Admin) | `features/settings/AdminReachSection.tsx` | Hub row with value, then `/me/reach` | Move |
| Notifications, prototype: one in-app switch for each trigger | `features/settings/NotificationsSection.tsx` | `/me/notices` | Move |
| Notifications, real build: In app and Email switch for each trigger | `NotificationsSection.tsx` | `/me/notices`. Same grid | Move |
| Email switch off and locked when In app is off, with its note | `NotificationsSection.tsx` | Same | Keep |
| Trigger list by right (feedback triggers need `feedback.manage`; no email on request notices) | `NotificationsSection.tsx`, `api/notify.ts` line 65 | Same | Keep |
| @everyone notice (a Mention notice, push only, batch B) | `api/notify.ts` line 30 | Same grid, no new row | Keep |
| Morning summary switch (real build) | `NotificationsSection.tsx` line 107 | Hub, panel 3, inline. Left out of `/me/notices` on a phone; the desk keeps it | Move |
| Notify me on this device switch | `features/settings/PushSection.tsx` | Hub, panel 3, inline | Move |
| Push note lines: unsupported, not set up, blocked | `PushSection.tsx` | Line under the row title | Keep |
| Push note line: needs install | `PushSection.tsx` | Not on the hub. The Home Screen row carries the step | Change |
| Push error lines: turn on failed, turn off failed | `PushSection.tsx` | Line under the row | Keep |
| Today ask card: "Turn on notifications" and its failure line (hides after any browser answer, and for a person who turned the switch off) | `features/home/PushAskCard.tsx` lines 35 to 45 | Stays on Today. The hub row uses the same `usePushDevice` hook, so the opt-out and the one-time ask stay in step | Keep |
| Home Screen steps for an iPhone in a browser tab (no button) | `PushAskCard.tsx` | Row "Add Madar to the Home Screen" opens a sheet with the 3 steps. The Today card stays | Change |
| Add to Home Screen button for Android | `PushAskCard.tsx`, `app/remote/install.ts` | Same row. A press calls `promptInstall()` | Change |
| Quiet hours switch "Quiet outside my work hours" (batch B, in main) | `features/settings/QuietHoursSection.tsx` | `/me/quiet-hours`. The hub row shows the summary | Move |
| Seven work-day toggles | `features/settings/WorkRangeFields.tsx` | Same page. 44 px each | Keep |
| From and To time selects | `WorkRangeFields.tsx` | Same page | Keep |
| Office lock line and locked days | `QuietHoursSection.tsx`, `WorkRangeFields.tsx` | Same page | Keep |
| Quiet hours saved toast | `QuietHoursSection.tsx` | Same | Keep |
| Google Calendar: intro, "only three things" line, Connect button | `features/settings/GoogleCalendarSection.tsx` | `/me/calendar`. Connect is the main button | Move |
| Google Calendar: Connected line, Not synced line, Disconnect button | `GoogleCalendarSection.tsx` | Same page | Keep |
| Google Calendar: Disconnect question sheet (Keep has focus) | `GoogleCalendarSection.tsx` | Same | Keep |
| Google Calendar: Broken state and Connect again | `GoogleCalendarSection.tsx` | Same | Keep |
| Google Calendar: not ready line, prototype line | `GoogleCalendarSection.tsx` | Same | Keep |
| Google Calendar: return from Google (`#google=` words, done and error notes) | `GoogleCalendarSection.tsx` | Same page. The `/settings` redirect keeps the hash | Keep |
| Google Calendar value on the hub row | None | New second line from `google.status` | Change |
| Password form: current, new, hint, button "Change the password", wrong password error, other devices sign out | `features/settings/PasswordSection.tsx` | `/me/password`. Full-width button | Move |
| Agents list: name, last used, Remove, Retry | `features/settings/AgentsSection.tsx` | `/me/agents`. New hub row "Agents" | Move |
| Agents: off line (no `ai.connect`), none line, grants with no approval, load errors | `AgentsSection.tsx` | Same page | Keep |
| Prototype tool: Simulate errors switch | `SettingsScreen.tsx` | Group "Prototype" | Move |
| Prototype tool: Reset sample data button and confirm sheet | `SettingsScreen.tsx` | Group "Prototype" | Move |
| Settings page with 11 panels | `SettingsScreen.tsx` | `/settings` opens the hub on a phone. The desk page stays | Merge |
| Address `/settings` in What's new links and the Google callback | `whatsNew/entries.ts`, `server/google/callback.ts` | Stays valid. A phone redirect handles it | Change |
| Texts that say "Settings" (push notes, Agents notes, mail footers, `server/mcp/docs.ts`, `public/privacy.html`, old What's new entries) | `i18n/real/*`, `server/mcp/docs.ts` | No change. The hub has the heading "Settings" over these rows | Keep |
| Admin list by group: People, Office, Templates, System | `features/settings/admin/AdminScreen.tsx` | Opens from the Office row. Back link "Me" | Keep |
| Admin or Office page title and the subtitle | `AdminScreen.tsx` | Same | Keep |
| Admin empty state with "Go to Home" | `AdminScreen.tsx` | Same | Keep |
| Admin section: People | `admin/PeopleSection.tsx` | Same | Keep |
| Admin section: Teams | `admin/TeamsSection.tsx` | Same | Keep |
| Admin section: Roles (list, role sheet with all switches, incl. "Mention everyone" of batch B) | `admin/RolesSection.tsx`, `admin/RoleSheet.tsx` | Same | Keep |
| Admin section: Office (code pattern, work hours, lock) | `admin/OfficeSection.tsx` | Same | Keep |
| Admin section: Clients | `admin/ClientsSection.tsx` | Same | Keep |
| Admin section: Sub-companies | `admin/SubCompaniesSection.tsx` | Same | Keep |
| Admin section: Project templates (list, update linked projects) | `admin/ProjectTemplatesSection.tsx` | Same | Keep |
| Admin template editor (phone list and details sheet) | `admin/ProjectTemplateEditor.tsx`, `admin/TemplateList.tsx` | Same. It has a phone shape, so no "Open this on a computer" | Keep |
| Admin section: To-do templates | `admin/TaskTemplatesSection.tsx` | Same | Keep |
| Admin section: Requests and bugs (Waiting, Done) | `admin/FeedbackSection.tsx` | Same | Keep |
| Admin section back link to the list | `AdminScreen.tsx` | Same | Keep |
| Unknown or forbidden section goes to `/admin` | `AdminScreen.tsx` | Same | Keep |
| Dashboard entry (`dashboard.view`) | `app/nav.ts` (tab) | Hub, group "Office". The tab leaves the bar | Move |
| Dashboard Filter button: Status (Schedule view), Leader, Team, Client, Sub-company | `features/dashboard/DashboardScreen.tsx` | Same | Keep |
| Dashboard main button "Team meeting" | `DashboardScreen.tsx` | Same | Keep |
| Dashboard button "Open space" | `DashboardScreen.tsx` | Same | Keep |
| Dashboard three numbers: active, at risk or late, past due | `features/dashboard/Numbers.tsx` | Same | Keep |
| Dashboard four view tabs: Projects, People, Schedule, Map (scroll sideways) | `components/Tabs.tsx` | Same, as today | Keep |
| Dashboard card: Stale projects | `features/dashboard/StaleProjects.tsx` | Same | Keep |
| Dashboard card: Waiting for us | `features/dashboard/WaitingForUs.tsx` | Same | Keep |
| Dashboard card: Money (payment roles) | `features/dashboard/MoneyPanel.tsx` | Same | Keep |
| Dashboard rows: deadlines in 14 days, area in design | `Numbers.tsx` (`NumberRows`) | Same | Keep |
| Dashboard charts: Projects per stage, Submissions | `features/dashboard/Charts.tsx` | Same | Keep |
| Dashboard card: Data gaps (Admin) | `features/dashboard/DataGaps.tsx` | Same | Keep |
| Dashboard People view: review waits | `features/dashboard/ReviewWaits.tsx` | Same | Keep |
| Dashboard People view: Workload (`workload.view`) | `features/dashboard/Workload.tsx` | Same | Keep |
| Dashboard Schedule view: bars, status choice, hatch switch | `features/dashboard/OfficeSchedule.tsx`, `hatch.tsx` | Same | Keep |
| Dashboard Schedule view: zoom choice (kept per device), legend, press on a project to open one line per stage | `OfficeSchedule.tsx` lines 96 to 125 | Same | Keep |
| Dashboard Map view: pins, pin card sheet, list | `features/dashboard/DashboardMap.tsx` | Same | Keep |
| Dashboard Map view: fold "Projects with no pin (n)", button "Set pin" (only with `viewerCan.editDetails`), pin sheet, Undo toast, "ask the leader" line | `DashboardMap.tsx` lines 121 to 155 | Same | Keep |
| Dashboard Map view: Satellite and full-screen buttons of the map | `features/map/MapCanvas.tsx` | Same | Keep |
| Dashboard load error with Retry | `DashboardScreen.tsx` | Same | Keep |
| Lists behind the numbers: `/tasks` | `features/tasklist/` | Me tab open. New top-bar back link "Dashboard" (only the empty state has one today) | Change |
| Lists behind the numbers: `/projects` with filters | `features/projects/` | Opens in Work. System Back returns to the Dashboard | Keep |
| Meeting view (full screen). A phone shows the project screens only; the mode switch and the zoom are left out | `features/dashboard/MeetingView.tsx` lines 226 and 446 | Same. Reached from "Team meeting". No tab bar | Keep |
| Meeting view: Agenda button and bar (Now, Next, Skipped, Done, Skip, time for each project, time left), Big screen switch, screen wake lock, Exit | `MeetingView.tsx`, `meeting/AgendaSheet.tsx` | Same | Keep |
| Meeting view: end summary (Copy as table, Share to the project chats) | `meeting/MeetingSummary.tsx` | Same | Keep |
| Open space map (full screen, read only; a phone fits one level at a time) | `features/space/OpenSpaceScreen.tsx` | Same. Reached from "Open space" | Keep |
| Open space controls: Focus on a person, Zoom in, Zoom out, Overview, scope line, "Open project" on a node | `OpenSpaceScreen.tsx`, `SpaceNode.tsx` | Same. Check the 44 px targets on a phone | Keep |
| Focus mode page: title, state line, description, checklist ticks, Done, Exit | `features/focus/FocusMode.tsx` | Same. It opens from a to-do | Keep |
| Focus timer: 25 minutes, Start, Pause, Reset, break line | `features/focus/FocusTimer.tsx` | Same | Keep |
| Focus entry buttons: "Focus" on the Next card, "Focus" in the header of the to-do panel | `features/home/NextCard.tsx` line 45, `features/project/tasks/TaskSheet.tsx` line 613 | Owned by the Today and To-do panel tracks. Me changes nothing | Keep |
| Focus mode makes the tab bar inert | `FocusMode.tsx` (selector `nav[data-pill]`) | Name the new tab bar in the selector | Change |

#### Motion and look
- Tokens: `panel`, `hairline`, `text-page-title`, `text-subheadline`, `text-footnote`, `text-ink-2`, `bg-fill`. The font is Thmanyah Sans. The `Switch` keeps its current look. Add no new colour.
- Navy appears only on the open Me tab (shell track) and on the one main button of a page: "Connect Google Calendar" on `/me/calendar`, "Team meeting" on the Dashboard. The hub has none. Sign out is a quiet secondary button. Red is only for Late and errors.
- A state is a shape plus an ink word: the word New on the What's new row, the lines under the push row, the value on a link row. No dot, no coloured tile (DESIGN.md).
- Icons: `AnimatedIcon` from `components/icons/animated/` (`settings`, `bell`, `shield-check`, `sparkles`, `message-square-plus`, `calendar-days`, `layout-grid`, `moon`, `languages`, `palette`, `timer`, `users`). The icon plays on press (`playWhen`).
- Motion that stays: the page entrance (`ScreenEntrance`), vaul `Sheet`, the language page turn (`useSwitchLanguage`), the Dashboard tab underline.
- Motion that D reuses: `.pressable` on each row, springs from `design/motion.ts`.
- New motion: a thumb that slides between the choices of the two `SegmentedControl` rows. Use `motion.span` with a `layoutId` for each control and `spring.standard`, as `components/Tabs.tsx` does. Reduced motion: `MotionConfig reducedMotion="user"` (`main.tsx`) removes the layout motion, so the thumb jumps. The `.pressable` CSS block is off under reduced motion already. Add no other code. The desk keeps the control as it is.
- Dark mode: all rows use tokens. Check the `Switch` off colour and the hairline in dark.
- Arabic: use logical classes only (`ms`, `me`, `ps`, `pe`, `start`, `end`). Flip the chevron with `rtl:-scale-x-100`. Check each hub row at 360 px and 390 px, and let a title wrap to two lines.
- Safari on iPhone: field text is 16 px on a phone (`.field` in `tokens.css`), so Safari does not zoom. The hub needs `pb-32` for the tab bar (the shell gives it) and the safe area at the bottom.

#### Files to change
New:
- `features/me/MeScreen.tsx`, `MeSectionScreen.tsx`, `MeRow.tsx`, `meSections.ts`, `HomeScreenSheet.tsx`, `useMeSummary.ts` (the lines under the titles).
- `features/settings/PrototypeTools.tsx` (moved out of `SettingsScreen.tsx`).
- Words in `i18n/real/phoned.en.json` and `phoned.ar.json`: group words, row lines, back links, the install sheet title. Western digits.
- A What's new entry (owner rule). Take a number above the newest id on main and on every open `rb/*` branch.

Change:
- `app/routes.tsx`: routes `me` and `me/:section`; the phone redirect from `/settings`; the desk redirect from `/me*`.
- `app/screens.ts`, `app/screenLoaders.ts`, `app/screenLoaders.static.ts`: the screens `me` and `meSection`. `screenLoaders.test.ts` checks that the lists match.
- `app/pressReads.ts`: a press on the Me tab starts `settings.get` and (real build) `google.status`. Update `PressReads.test.tsx`.
- `app/AppShell.tsx` and `app/nav.ts` (shell track): remove `PersonMenu id="phone"` from the phone top bar; the back links "Me" and "Dashboard"; the open state of the Me tab; `screenKey`.
- `app/PersonMenu.tsx`: no change on a desk. Move the feedback-sheet mount into a small hook that the hub row also uses.
- `features/settings/Section.tsx` and `ProfileSection.tsx`: the `bare` mode.
- `features/settings/NotificationsSection.tsx`: leave out the Morning summary block in `bare` mode; sticky column names.
- `features/settings/PasswordSection.tsx`: full-width button on a phone.
- `features/settings/PushSection.tsx` and `usePushDevice.ts`: export the note and error lines so the hub row reuses them.
- `features/home/PushAskCard.tsx`: export `HomeScreenSteps` for the sheet.
- `features/tasklist/TaskListScreen.tsx`: no new code if the shell back link reads the route; else export `BackToDashboard`.
- `components/SegmentedControl.tsx`: a `fill` prop (equal parts, full width) and a thumb that moves.
- `components/Switch.tsx`: a row form without its own `min-h-11 py-1` box, so a hub row sets the height.
- `components/PictureFrame.tsx`: `data-vaul-no-drag` on the frame.
- `features/feedback/FeedbackSheet.tsx`: the 44 px remove button; hide the paste hint on a coarse pointer.
- `features/focus/FocusMode.tsx`: the inert selector for the new tab bar.
- No change to `api/`, `server/`, the MCP files, `lib/dates.ts`, `Tabs.tsx` or `HomeScreen.tsx`.
- Docs in the same commit: `DESIGN.md` (lines about the picture that opens the person menu), `src/CLAUDE.md` (the paragraphs on What's new, Google Calendar `/settings#google=`, the Today ask card, Quiet hours and What reaches me: "Settings has the section"), `src/design/CLAUDE.md`. The shell track owns the lines about the phone tab bar.
- Tests first. Unit: a phone redirect test for `/settings` that keeps the `google=` hash; a desk redirect test for `/me*`; a hub test for each role (Admin, Management, Member, prototype, real); a test that `needs_install` shows the Home Screen row and no push line; a sign out test (second tap does nothing while it runs); `SettingsScreen.test.tsx` (desk, stays); `PressReads.test.tsx`; a `SegmentedControl` test for the thumb; `WhatsNewScreen.test.tsx` line 60 (counts the buttons of the page); `AdminScreen.test.tsx` "on a phone" (line 313) for the back link; `rr2Shell.test.tsx` "the person menu" (line 164) stays on a desk.
- Browser tests that pin the old phone layout (Playwright runs only in a delegated subagent): `tests/e2e/calm.spec.ts` lines 171 to 180 (language radio on `/#/settings` at 390 px; add `/#/me`), `tests/e2e/shell.spec.ts`, `tests/e2e/work.spec.ts` line 80, `tests/e2e/full.spec.ts`, `tests/e2e/dashboard.spec.ts` (390 px loops; add `/me`, `/me/profile`), `tests/e2e/owner.spec.ts` and the prototype specs that open `/#/settings` or use Preview as. In `tests/e2e-deploy/`: `fixtures.ts` line 47, `calm.spec.ts`, `dashboard.spec.ts`, `settings.spec.ts` lines 13 to 26 and 60 to 73 (the level-2 headings Notifications and Password and the Morning summary switch: use `/me/notices`, `/me/password`, and the hub row), `account.spec.ts` lines 26 and 98 to 137 (Arabic at 390 px; `#password-current` on `/me/password`), `walk.spec.ts` lines 101, 173, 563 to 573, 667 (the heading "Agents" on `/me/agents`; notices switches on `/me/notices`), `agents.spec.ts` lines 101 and 160, `menus.spec.ts` lines 117 to 121 (Preview as on the hub), `owner.spec.ts` line 11, and the `signOut()` helper in `steps.ts` line 67 (a phone path: Me tab, then Sign out).

#### My calls
- Sub-pages are real routes (`/me/:section`), not sheets. The Back button works, and a link can open one.
- `/settings` stays alive and opens the hub on a phone, so What's new links, the Google return and old bookmarks work. No server change.
- Texts that say "Settings" stay as they are. The hub has the heading "Settings" over the rows they point to, so the words match on a phone.
- The Admin row opens `/admin` on a phone with the line "Best on a computer". The Admin page has had a phone shape since 2026-10-05, and nothing may go away.
- No "Open this on a computer" line appears in Me. I checked the four screens: the meeting view (project screens only), Open space (fits one level on a phone), the template editor (phone list and details sheet) and stage dates (`StageDates` list on a phone) all have a phone shape today.
- The Dashboard opens from a Me row in its phone shape of today. Its tabs keep the sideways scroll.
- The link "See what's new" stays on Today. The Me tab has no badge, so without the link a new entry would show nowhere outside Me.
- The Morning summary switch moves to the hub on a phone, so each feature has one place. The desk keeps it in Notifications.
- The row for the AI agents is called "Agents", the word of the page and of the texts that name it.
- A needs-install iPhone gets one next step: the Home Screen row. The push row shows no line for that state.
- Language and Theme show the label on top and the control under it at full width. Two Arabic words in one row fit at 360 px only this way.
- No coloured icon tiles, no "In build" badge, and "New" stays a word. Sign out is a quiet secondary button and asks nothing, as today.
- A turn past 640 px unmounts the page and loses an unsaved name. This is rare and the loss is small. A test pins the redirect and the kept hash.
- The prototype tools sit at the end of the hub, in group "Prototype".

#### Questions only the owner can answer
None.



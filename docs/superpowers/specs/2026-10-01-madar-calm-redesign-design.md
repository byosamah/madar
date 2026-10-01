# Madar calm redesign: design

Date: 2026-10-01. Owner: Osama. Status: approved in brainstorming (visual direction, motion, tabs, focus helpers and section 1 approved in chat; the owner then asked to finish the remaining sections, the plans and the build in one run).

This document changes how Madar looks and moves. It replaces sections 3.2, 4.1, 4.3, 5.1 to 5.3, 6, 8 (presentation only) and 10 of `2026-09-30-madar-prototype-design.md`. Everything else in that spec stays: roles, permissions, rules, the fake API, data, undo, errors, sample data, tests and the agent rules. Where the two documents disagree on the look or the layout, this one wins.

## 1. Why

The owner found the first design busy and distracting: "if one of our team member have an ADHD he will be missed". The goal is a fully clean and simple product that still gives people a "wow" moment through a few perfect motions.

### 1.1 Success criteria

| Test | Pass condition |
|---|---|
| One thing to look at | Every screen has one title, one main button at most, and no more than one colored highlight. |
| Less per row | A project row shows 5 things: color tile, name, stage, progress line, next deadline (plus a state word only when something needs attention). |
| Calm by default | No glass panels, no cover images in lists, no filter chip rows, no avatar stacks. |
| Focus help | A person can open any task they can see in Focus mode, and the day ring shows their progress on Home. |
| Wow | The 8 motion moments of section 4 run on phone and desktop, and turn into short fades under "Reduce motion". |
| Same everywhere | The same design works at 390, 820 and 1440 px, in English and Arabic, in light and dark. |
| Nothing lost | Every feature of the first build still works, and its tests still pass, except where this document removes a control. |

## 2. The look

### 2.1 Page and panels

- Page: a soft gray with a very light vertical fade (light: `#F7F7F9` to `#F1F1F4`; dark: `#0F0F12` to `#0B0B0D`).
- Panels: white (dark: `#1A1A1E`), 20 px corners, a faint two-step shadow (`0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)`; dark: no shadow, a 1 px `#26262B` edge).
- Rows inside a panel: hairline separators (`#F0F0F2`; dark `#26262B`), 13 px vertical padding.
- No glass, no blur, no background images. The one exception is the floating tab pill (2.5).

### 2.2 Type

- Inter for Latin, IBM Plex Sans Arabic for Arabic. Western digits, tabular in every column of numbers.
- Sizes: page title 30/700 with -0.025em tracking; section title 18/700; row title 14 to 15/600; body 14/400; small text 12/400. Nothing under 12 px.
- Arabic text one step larger (the existing `--boost` of 1.08 stays).

### 2.3 Color, one job each

| Role | Light | Dark | Where |
|---|---|---|---|
| Ink | `#1D1D1F` | `#F5F5F7` | Main text |
| Ink 2 | `#6E6E73` | `#A1A1A6` | Secondary text (4.5:1 on panels) |
| Signature gradient | `#5B6CFF` to `#8B5CF6` | same | The one main button of a screen, the open tab in the pill, the day ring, the Focus timer |
| Glow | radial blue `#DCEBFF`, violet `#F3E3FF`, mint `#DFF7EC` | the same at 18% | Behind the "Next for you" card only |
| Link and focus | `#0066CC` | `#4DA3FF` | Text links, the keyboard focus ring |
| Attention | `#B54708` text on `#FFF4E5` | `#FFB65C` on `#3A2A12` | "At risk", "2 days past due", locked weeks |
| Late | `#B42318` text on `#FDECEC` | `#FF8A80` on `#3B1D1B` | Only a project whose health is Late, and errors |
| Done | `#067647` | `#4ADE80` | "On track" when shown, Done states |

Project colors: 8 soft hues. Each project gets one from its id (a stable hash), for life.

| Name | Tile background (light / dark) | Tile text and line (light / dark) |
|---|---|---|
| blue | `#E8F0FE` / `#1B2A44` | `#1A56DB` / `#7EA8FF` |
| orange | `#FDF2E9` / `#3A2618` | `#C2410C` / `#FF9E6B` |
| green | `#E7F6EE` / `#14301F` | `#047857` / `#5FD3A0` |
| purple | `#F3E8FF` / `#2C1D44` | `#7E22CE` / `#C29BFF` |
| pink | `#FCE7F3` / `#3A1A2B` | `#BE185D` / `#FF8CC6` |
| teal | `#E0F5F5` / `#123236` | `#0F766E` / `#5ED6CB` |
| amber | `#FEF6E1` / `#3A2E12` | `#A16207` / `#F5C451` |
| indigo | `#EAEBFF` / `#20234A` | `#4338CA` / `#A5ABFF` |

Every tile text reaches 4.5:1 on its tile. Every line color reaches 3:1 on the panel.

> **Change 2026-10-01 (owner):** the signature is solid blueprint navy, not a gradient: #1F2A55 with white text in light mode, #C9D4FF with #10183A text in dark mode. The owner found the blue-to-violet gradient on buttons read as generic AI styling. The glow behind Next for you keeps its soft blue, lilac and mint (#CCE0FF, #EAD5FF, #CFF2E2).

### 2.4 Shared parts

- **Project tile:** 34 px rounded square (10 px corners), two letters from the project name (first letters of the first two words; one word gives its first two letters), in the project color.
- **Progress line:** 4 px, rounded, project color on a light track. Value = (index of the current stage + 1) / (stage count + 1); a completed project shows a full line.
- **State word:** a small soft pill (`At risk`, `Late`, `Needs review`, `2 days past due`, `Due today`). It shows only when there is something to say. "On track" never shows in lists.
- **Primary button:** signature gradient, white text, pill shape, 44 px tall. One per screen. Other buttons are quiet: white panel with ink text, or plain text links.
- **Filter button:** a quiet button with a filter icon, the word "Filter" and a count of active filters ("Filter · 2"). It opens a sheet (phone) or a popover (desktop) with every choice of that screen. Lists never show rows of chips.
- **Empty states, load errors and toasts:** the existing behavior, restyled to the panels and type of this section.

### 2.5 The floating tab pill

- Four tabs: Home, Projects, Dashboard, Inbox, plus a search button (magnifier icon) at the end of the pill.
- Desktop and tablet (640 px and wider): the pill floats at the top center, 16 px from the top, and stays there when the page scrolls. Tabs show words. The open tab carries the signature gradient.
- Phone (under 640 px): the pill floats at the bottom center, 12 px above the safe area. Tabs show an icon and a one-word label.
- The pill is white at 92% with a light blur. Under "Reduce transparency" or "Increase contrast" it is solid white with a 1 px edge.
- The Inbox tab shows a red dot with the number of items that need an action (existing rule).
- The person's picture sits at the top end of the page (desktop: beside the pill, at the far end; phone: at the top end of the page title row). It opens a small menu: the person's name, "Preview as" (prototype), "My hours", "Settings".
- The pill and the picture are the only fixed parts. There is no sidebar and no toolbar.

### 2.6 Dark mode, right to left, access

- Dark mode keeps every rule with the dark values above.
- Arabic mirrors the layout. The pill keeps its tab order from the start side. Time still runs toward the end side in schedules.
- WCAG 2.2 AA, 44 px targets, a 2 px focus ring in the link color with a 2 px offset.

## 3. Screens

### 3.1 Routes

| Route | Screen |
|---|---|
| `/` | Home (new) |
| `/projects` | Projects list (was `/`) |
| `/projects/:id` | Project |
| `/projects/code/:code` | Project link by code |
| `/work` | My tasks and hours (not in the pill; opens from Home, the person menu and "Log time") |
| `/dashboard` | Dashboard |
| `/inbox` | Inbox |
| `/search` | Search (the pill's search button, and Ctrl+K or ⌘K) |
| `/tasks` | Task list behind dashboard numbers |
| `/settings` | Settings |

Every link that opened the Projects screen at `/` with values now opens `/projects` with the same values. The old link `/#/?filter=at_risk` redirects to `/#/projects?filter=at_risk`, so saved links keep working.

### 3.2 Home

Desktop and tablet: two columns (40% and 60%). Phone: one column in this order: greeting, Next for you, Today, Your projects.

- **Greeting:** "Good morning, Sara" (morning before 12:00, afternoon before 17:00, evening after), the date, and "N things today". The day ring sits at the end of the greeting (section 5.2).
- **Next for you:** one card on the glow, with a small label, one line saying the thing, one line of context and one primary button. The card picks the first match of this order:
  1. A task waiting for my review (I lead its project, or I am the Admin): "Approve "<title>"", button "Review".
  2. My task that is past due, the oldest first: "Finish "<title>"", button "Open task".
  3. My task due today: same wording.
  4. My task in progress, due soonest: "Continue "<title>"".
  5. My hours this week are under target and today is Sunday to Thursday: "Log today's hours", button "Log hours".
  6. Nothing: "You are all caught up." with no button.
- **Today:** a panel with my open tasks that are past due or due today, and a last line "Log hours for today" when I have logged no hours today (Sunday to Thursday). Each task row has the round check, the title, the project tile (small, 20 px) and the gentle due word. Ticking follows the existing review rule. "See all my tasks" at the bottom opens `/work`.
- **Your projects:** "Your projects" (projects where I am the leader or a member; the Admin sees all active projects), as rows: tile, name, stage, progress line, next deadline, and a state word when the health is At risk or Late. "All projects" at the bottom opens `/projects`.

### 3.3 Projects

- Title "Projects", the filter button, and the primary "New project" button.
- One panel with rows: tile, name and client (small), stage, progress line, next deadline, state word when needed.
- The filter holds: Show (All, Mine, Needs attention), Stage (any default stage), Status (Active, On hold, Completed, Archived, All) and Sort (Last update, Next deadline, Name). The values stay in the link (existing behavior, now under `/projects`).
- The grid view and its view switch are removed. Right-click and long-press menus stay on rows.
- The health filter from the dashboard (`?health=`) stays, shown as one removable note under the title.

### 3.4 Project

- **Header:** the back link ("Projects"), the project tile at 44 px, the name (title size), the client, then one line: stage name, progress line, next deadline, state word. Actions: the primary "Post update" and the "…" menu (existing items). The cover picture moves into the Overview's About panel.
- **Tabs:** a quiet text row: Overview, Tasks, Schedule, Files, Team. The open tab has an ink underline that glides between tabs.
- **Overview:** the feed panel (the composer at the top; the post filter becomes a filter button) and an About panel (cover picture when the project has one, key facts, the next 3 deadlines, the team as names with small avatars).
- **Tasks:** groups by stage in panels. Rows: round check, title, gentle due word, owner initials (small avatar), counts of comments and files only when not zero, the flag only when flagged. Quick add stays. The filter button holds Show (All, Mine, Past due, Flagged), "Show done tasks" and View (List, Board). The board keeps its columns and drag.
- **Schedule, Files, Team:** the same content, restyled to panels, rows and the color rules of section 2. Schedule bars use the project color for the current stage, Ink 2 at 35% for done stages and an outline for later stages; deadlines are small diamonds in Attention text color.
- **Task panel:** the existing fields, restyled. It gains a "Focus" button next to the title (section 5.1).

### 3.5 My tasks and hours (`/work`)

The existing two tabs (Tasks, Hours) with the new rows and panels. Task groups keep their order, with the gentle words. The Hours table keeps its rules; locked weeks use the Attention colors.

### 3.6 Dashboard

- Title, the filter button (Period, Status, Leader, Client; values in the link), no other controls.
- **Three numbers** in one panel: Active projects, Need attention (at risk or late), Office hours this week (percent of target, with a thin line). Each number is a link to its list (existing rules). Overdue tasks and Deadlines in the next 14 days move into the "Projects" section below as two rows with numbers and links.
- **One section at a time:** a quiet text switch "Projects / People / Schedule".
  - Projects: Deadlines next 14 days, Past-due tasks, Projects per stage (bars in Ink), Health mix (three words with numbers), Tasks done and created per week (the chart and its table).
  - People: the workload grid, Hours per project.
  - Schedule: the office schedule with its zoom and legend.
- The switch value stays in the link (`?view=projects|people|schedule`).

### 3.7 Inbox

Day groups in panels. Rows: an unread dot in the link color, the actor's small avatar, one sentence, the project tile when it has a project, the time, and the actions (Approve, Open). "Mark all read" is a quiet text button.

### 3.8 Search, Task list, Settings

- Search: the existing command list, in one panel under a large search field.
- Task list: the new rows and panels.
- Settings: panels for Profile, Language, Theme, Notifications, the Admin sections and Prototype. The Glass setting is removed (no glass is left to set). The stored `preferences.glass` value stays in the data and is ignored.

## 4. Motion

All motion uses `transform` and `opacity` only. Springs use the existing tokens in `src/design/motion.ts` (`spring.standard`, `spring.expand`, `spring.flick`). Under "Reduce motion" every moment becomes a 150 to 200 ms fade, or no motion.

| # | Moment | What happens | Timing |
|---|---|---|---|
| 1 | A project opens from its row | The tapped row's panel grows into the project header (shared layout of the tile and the name); the rest of the page fades in under it. Back shrinks the header into the same row. | 450 ms spring |
| 2 | Ticking a task off | The circle squeezes to 0.82 and springs back filled; a check draws in; the title fades to Ink 2; after 500 ms the row slides out toward the end side and the list closes the gap; counts update. | 420 ms + 460 ms |
| 3 | The next thing arrives | When the Next for you item is done, the card lifts and fades; the next item rises into place; one line under it says what is left ("Done. 2 more today."). | 260 ms + 480 ms |
| 4 | Numbers settle in | On the Dashboard and in the day ring, numbers count up once per visit (ease-out over 900 ms) and lines draw from zero; then nothing moves. | 900 ms |
| 5 | Panels rise like paper | Sheets and the task panel spring in from the bottom (phone) or the end side (desktop); the page behind scales to 0.97 and dims to 92% when the panel is modal. Closing reverses it. | 520 ms spring |
| 6 | Lists glide | When a filter, a sort or a tab changes, rows move to their new places, leaving rows fade out, new rows fade in; the tab underline glides. | 460 ms spring |
| 7 | Arabic turns the page | Switching the language turns the page around its vertical axis (to 70 degrees and fading), switches the text and direction, and turns it back. | 240 ms + 420 ms |
| 8 | Undo rewinds time | When Undo restores an item, it slides back into its place from the side it left. | 440 ms spring |

Screen entrance: the first visible panels of a screen rise 10 px and fade in, 60 ms apart, once per visit. Focus mode has its own motion (5.1).

## 5. Focus helpers

### 5.1 Focus mode

- A "Focus" button sits in the task panel next to the title. It opens Focus mode for that task. Focus mode is also reachable from the Next for you card when it shows a task ("Focus" as a quiet second action).
- Focus mode covers the screen: a calm page with the project tile and name at the top, the task title at 30 px, the description, the checklist (tickable when the person may change it), and two buttons: the primary "Done" (it follows the review rule) and a quiet "Exit focus". Esc also exits.
- An optional timer: a ring in the signature gradient with "25:00", "Start", "Pause" and "Reset". It counts in the page only, saves nothing, and stops when Focus mode closes. When it ends, it shows "Time for a short break." and does not sound.
- Motion: the screen behind fades and scales to 0.96 while the Focus page rises in (350 ms). Exit reverses it. Done plays moment 2 on the title, then exits after 600 ms.
- A person who may not change the task sees Focus mode with the checklist read-only and no Done button.

### 5.2 Day ring

- A 36 px ring beside the greeting on Home, in the signature gradient, with "2 of 3" beside it.
- Count = tasks I completed today (completedAt today) plus my open tasks due today or past due. Done = tasks I completed today. With nothing to count, the ring is hidden.
- It fills once per visit (moment 4) and moves when a task is ticked.

### 5.3 One filter button

Projects, the Tasks tab, the Overview feed, the Task list and the Dashboard each have one filter button and no chip rows (2.4).

### 5.4 Gentle wording

| Before | After | Color |
|---|---|---|
| "Overdue", "25 Sept · Overdue" | "3 days past due" (1 day: "1 day past due") | Attention |
| Due today | "Due today" | Ink 2 |
| Due in N days | "In N days" / date | Ink 2 |
| Inbox "“X” is overdue" | "“X” is past due" | none |
| Health At risk | "At risk" | Attention |
| Health Late | "Late" | Late |
| Locked week text | unchanged wording | Attention |

Arabic follows the same rules with the plural forms of the Arabic file.

## 6. Build approach and tests

- Approach: redesign in place (the owner chose approach 1). The data layer, the rules and their tests stay. The design tokens, the shared parts, the shell and every screen's layout change.
- Two build steps, each with its own plan, an independent code review and a fix pass, and the review link after each:
  - **Step A:** tokens and shared parts, the pill and the person menu, routes and redirects, Home (with Next for you and the day ring), Projects, the Project header and tabs, Task rows, gentle wording.
  - **Step B:** the Dashboard sections, the Inbox, Search, Task list, Settings, Schedule, Files and Team restyle, the panels and sheets, Focus mode, and the 8 motion moments with their reduce-motion forms.
- Tests: new pure helpers (Next for you, day ring, project color and initials, progress value, gentle due words) get unit tests first. Screen tests change where structure changes (routes, filter button, removed grid). The Playwright sweep covers 390, 820 and 1440 px, English and Arabic, light and dark, high contrast and reduce motion, plus checks that the motion moments run (a growing header, a gliding underline) and stop under reduce motion.
- The team review guide and the build report are updated after step B.

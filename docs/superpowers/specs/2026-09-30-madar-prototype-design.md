# Madar (مدار): clickable prototype, design spec

- **Date:** 2026-09-30
- **Status:** Draft for review
- **Owner:** Osama Khalil
- **Name:** Madar (مدار, "orbit"). The name is temporary until a trademark and domain check passes.

## 1. Purpose

Madar is a project management system for an office of architects and engineers in Al Khobar, Saudi Arabia (about 5 to 15 people).

This spec covers **stage 1 only: a clickable prototype**. The prototype is a real web front end with sample data and a fake API. It has no server, no logins and no real storage. The team uses it to agree on the product. After sign-off, a second spec covers the real build with a Python server.

The prototype code carries into the real build. The screens stay. The fake API is the contract that the Python server later implements.

### 1.1 Goals

1. Show the state of every project in 5 seconds, with no phone call.
2. Give each person one place for their own tasks and hours.
3. Match the current Apple design language (Liquid Glass, as refined at WWDC 2026) in look and motion.
4. Work in English and Arabic, on desktop and on phones.
5. Prepare for AI agents: every action goes through one named API call, and every change has a recorded author (human or agent).

### 1.2 Success criteria

| Test | Pass condition |
|---|---|
| Admin overview | An Admin finds all at-risk and late projects within 5 seconds of the first screen. |
| Member daily work | A member reaches today's tasks with one click from any screen. |
| Leader review | A leader approves a task in review with two clicks from the Inbox. |
| Languages | Every screen works in English (left-to-right) and Arabic (right-to-left), and every text exists in both languages. |
| Devices | Every screen works at phone, tablet and desktop widths. |
| Team sign-off | The office team reviews the prototype and approves it for the real build. |

### 1.3 Out of scope for the prototype

- Fees, invoices and cost rates (removed by the owner on 2026-09-30).
- A real server, a real database, logins and passwords.
- Real file storage, email and push notifications.
- The MCP server for AI agents.
- The decision on where the app runs (the office STUDIO server or a cloud host).

The real-build spec covers these items, except fees, which need a new decision.

## 2. Users and permissions

### 2.1 Roles

- **Admin.** A system role. The Admin controls the whole system. The Admin can also join a project as its leader or as a team member.
- **Member.** A system role for everyone else.
- **Project Leader.** A project role. One person per project, or nobody. The leader manages the project.
- **Project team.** A project role. The people on the project.
- **AI agent.** A user account of kind `agent` that always acts for one person, its owner. The agent has that person's rights and never more. Agents are never project members: they reach what their person reaches. Every change records two names, the agent and the person it acted for. Every screen marks agent changes with an "Agent" label. (Adopted from Scitter on 2026-09-30, see section 17.)

### 2.2 Project creation and the leader

1. Any user can create a project.
2. By default, the creator becomes the Project Leader.
3. The creator can pick another person as leader, or leave the leader empty.
4. A project with no leader is managed by the Admin.
5. After creation, only the Admin or the current leader can change the leader.

### 2.3 Permission table

"Team" means a member of that project's team. "Other" means a member who is not on that project.

| Action | Admin | Leader | Team | Other |
|---|---|---|---|---|
| See all projects, tasks, files and the dashboard | yes | yes | yes | yes |
| Create a project | yes | yes | yes | yes |
| Edit the project (fields, stages, deadlines, team, current stage) | yes | yes | no | no |
| Change the leader | yes | yes | no | no |
| Archive the project | yes | yes | no | no |
| Delete the project (with confirmation) | yes | no | no | no |
| Set or clear the health override | yes | yes | no | no |
| Create a task for anyone on the team | yes | yes | no | no |
| Create a task for themselves | yes | yes | yes | no |
| Update a task they own (status, checklist, description) | yes | yes | yes | no |
| Update any task on the project | yes | yes | no | no |
| Approve or send back a task in review | yes | yes | no | no |
| Delete a task | yes | yes | no | no |
| Post an update, comment, react, upload files | yes | yes | yes | no |
| Edit or delete their own comment or update | yes | yes | yes | no |
| Log their own hours on this project | yes | yes | yes | no |
| See another person's hours | all people | people on own project | no | no |
| Undo an agent change | yes | yes | no | no |
| Manage people, weekly targets and system settings | yes | no | no | no |

Rules for the table:

- A user can log hours only on projects where they are the leader or on the team. The Admin can log hours on any project.
- A user who is not on the team sees the project in view-only mode. The header shows a "View only" label. The screen hides edit controls. It does not show disabled controls.
- One function, `can(actor, action, resource)`, implements this table. No screen checks permissions in another way.

## 3. Screens and navigation

### 3.1 Screen list

| # | Screen | Who | Purpose |
|---|---|---|---|
| 1 | Projects | all | The home screen: a grid of project cards. |
| 2 | Project | all | One project, with the tabs Overview, Tasks, Schedule, Files and Team. |
| 3 | My Work | all | My tasks from all projects (Tasks tab) and my timesheet (Hours tab). |
| 4 | Dashboard | all | Office numbers, charts, the workload grid and the office schedule. |
| 5 | Inbox | all | My notifications. |
| 6 | Search | all | A search tab on phones, Ctrl+K (⌘K on a Mac) on desktop. |
| 7 | Task list | all | A filtered list of tasks or deadlines from all projects. It opens from dashboard clicks. It is not in the navigation. |
| 8 | Settings | all | Profile, language, theme, glass and notifications. The Admin also sees People and Office settings. |

### 3.2 Navigation

- **Desktop (1024 px and wider).** An inset glass sidebar on the start side, with Projects, My Work, Dashboard and Inbox. The sidebar shows no more than two levels. A button hides and shows it. It is visible by default. A frosted toolbar runs across the top of the content.
- **Tablet (640 to 1023 px).** An icon-only sidebar. A button switches it to a tab bar (the Apple "adaptable sidebar" pattern).
- **Phone (under 640 px).** A glass tab bar at the bottom: Projects, My Work, Dashboard, Inbox and Search. Search is a separate tab at the end. The tab bar holds navigation only. It never hides, except under a sheet. The toolbar and tab bar shrink when the content scrolls down and return when it scrolls up.
- **Settings** opens from the user's avatar in the sidebar or toolbar.
- **"New Project"** sits in the Projects toolbar, never in the tab bar.
- **Badges.** Only the Inbox shows a badge. The badge counts unread items that need an action.

### 3.3 Prototype-only controls

- **Preview as.** A switch at the bottom of the sidebar (in Settings on phones). It changes the current user to one of the sample users: the Admin, a leader, a member or the agent. It carries a "Prototype" label.
- **Reset sample data.** A button in Settings. It restores the start state.
- **Simulate errors.** A switch in Settings. When it is on, 1 in 5 API calls fail, so reviewers can see the error states.

## 4. Projects screen and the project card

### 4.1 The card

Top to bottom:

1. **Cover image.** The latest render, at a 16:9 ratio. With no cover, the card shows a tinted panel with the project code.
2. **Code and health.** The project code (for example `KH-26-014`) and the health pill.
3. **Name and client.**
4. **Stage rail.** One block per stage. Past stages are grey, the current stage uses the accent color, and future stages are light. The current stage name shows next to the rail.
5. **Two latest updates.** Each shows the author's avatar, one line of text and the age ("2h"). Agent updates carry the "Agent" label.
6. **Next deadline.** The name, the date and the days left ("12 Oct · 5d"). A deadline in the past shows in red.
7. **People.** The leader's avatar first, then up to three team avatars, then "+N".

Card behavior:

- Pointer-down scales the card to 0.97 at once.
- A click expands the card into the Project screen (a shared-element transition). The close action shrinks the screen back into the same card.
- Right-click on desktop, or long-press on a phone, opens a menu: Open, Post update, Copy link, Archive. The menu shows only the actions the user may do.

### 4.2 Health rule

The app computes the health from the data, in one function, `computeHealth(project, today)`.

1. **Late:** the current stage has an end date, and today is after it.
2. **At risk:** the project is not Late, and one of these is true:
   - the project has one or more overdue tasks, or
   - the current stage ends within 7 days, and less than 70% of the tasks in that stage are Done.
3. **On track:** all other cases.

Definitions:

- An **overdue task** has a due date before today and a status of To do or In progress. A task In review is not overdue.
- The **current stage** is the stage the leader marks as current. The app does not guess it from dates.

Override:

- The leader or the Admin can set the health by hand, with a required reason.
- The pill then shows "Set by <name>", and the reason shows on hover or tap.
- The override clears itself when the current stage changes.

Projects that are On hold, Completed or Archived show their status instead of a health pill.

The pill always shows a word next to its color: On track (green), At risk (orange), Late (red).

### 4.3 Grid controls

- **Filters:** All, My projects, At risk (At risk and Late), one chip per stage, and a status menu (Active by default).
- **Sort:** last update (default), next deadline, name.
- **View switch:** grid (cards) or compact list (one row per project, same data, no cover).
- **Columns:** 1 on phones, 2 on tablets, 3 on desktop, 4 at 1440 px and wider.

### 4.4 New Project sheet

The sheet opens from the "New Project" button with a dim layer behind it. Fields:

| Field | Rule |
|---|---|
| Name | Required. |
| Client | Pick from the list, or add a new client (name, contact name, phone, email). |
| Leader | Default: me. Options: another person, or no leader. |
| Location | City and district. |
| Area (m²) | Gross floor area, a number. |
| Start date, target end date | Dates. The end date must be after the start date. |
| Stages | The default stage list, which the creator can change here. |
| Team | Pick people. |
| Model folder path | Text, for example `\\STUDIO\Projects\KH-26-014`. Revit models stay on the office server. |
| Cover image | Optional upload. |

The app gives the code by itself: the office prefix (default `KH`), the two-digit year and a three-digit number, for example `KH-26-015`.

Only the name is required. Validation runs on each field when the user leaves it, not only at submit.

## 5. Project screen

### 5.1 Header

The cover image, the code, the name, the client, the health pill and the stage rail. The main action is **Post update**, tinted and alone. A "…" menu holds Edit project, Change leader, Archive and (for the Admin) Delete. The buttons over the cover use clear glass. A 35% dark layer sits behind them when the image is bright.

A click on a stage in the rail opens a popover with the stage dates and its task count.

### 5.2 Overview tab

- **Updates feed.** Posts by people and agents, plus system events (stage change, task done, file added, member added). A filter offers All, Posts, Tasks and Files. At the top, a box posts text with files and @mentions.
- **Side column** (below the feed on phones): key facts (location, area, start date, target end date, model folder path), the next 3 deadlines and the team.

### 5.3 Tasks tab

- **List view** (default): tasks grouped by stage. Each row shows the checkbox, the title, the owner's avatar, the due date (red when overdue), the flag and counts of comments and files.
- **Board view:** columns To do, In progress, In review and Done. A drag moves a task to another column.
- **Quick add:** an "Add a task" row at the top of each group. Enter creates the task. The owner is the creator. The stage is the group's stage.
- **Filters:** All, Mine, Overdue, Flagged.

### 5.4 Task sheet

On desktop, the task opens in a side panel with no dim layer. On a phone, it opens in a sheet. Fields and parts:

- Title, status, owner (exactly one person, default the creator), due date, stage, flag.
- "Needs review" switch (only the leader or the Admin can change it; default on).
- Description, checklist, files, comments, reactions.
- Hours logged on this task, and a "Log time" button.
- The task history from the event log.

### 5.5 Task status and review rules

Statuses: `todo`, `in_progress`, `in_review`, `done`.

1. The owner ticks a task, or drags it to Done.
2. If "Needs review" is on and the owner is not the project leader, the status becomes `in_review`, not `done`. A toast explains the change. The leader gets an Inbox item.
3. If "Needs review" is off, or the owner is the leader, the status becomes `done`.
4. The leader (or the Admin) then approves the task, and the status becomes `done`.
5. Or the leader sends it back with a required note. The status becomes `in_progress`. The note posts as a comment, and the owner gets an Inbox item.
6. A team member can move only tasks they own. The leader and the Admin can move any task on the project.

A tick shows a filled circle, then the row slides away after 0.5 s. An "Undo" toast stays for 5 s.

### 5.6 Schedule tab

- Stage bars on a month scale, one row per stage. Deadlines show as diamonds. A vertical line marks today.
- On desktop, the leader drags the start or end edge of a bar to change the dates, in steps of one day.
- On a phone, the tab shows a list of stages with their dates and deadlines.
- In Arabic, time runs from right to left.

### 5.7 Files tab

- Files grouped by stage. Images and PDF files open in a quick preview. Other types (DWG, XLSX and others) show an icon and a download button.
- Drag and drop, or a button, uploads files.
- A new upload with the same file name in the same project becomes the next version (A, B, C). The file row shows the latest version. A history list shows the older versions.
- The prototype stores files in the browser, with a limit of 25 MB per file.
- Revit models are never uploaded. The project stores only the model folder path.

### 5.8 Team tab

- The leader, then the members. Each row shows the discipline (Architect, Structural, MEP, or other text) and the count of open tasks.
- The leader and the Admin also see each person's hours on this project for the current month.
- The leader and the Admin add or remove members, and change disciplines.

## 6. My Work

### 6.1 Tasks tab

- My open tasks from all projects, in the groups Overdue, Today, This week, Later and No date.
- A leader also sees a first group, "Waiting for my review", with the tasks In review on their projects.
- Each row shows the checkbox, the title, the project code, the due date and the flag. The tick follows the rules in 5.5.

### 6.2 Hours tab (timesheet)

- A week grid. The rows are project and stage pairs. The columns are the days. The week runs Sunday to Thursday. Friday and Saturday are folded to the side and can open.
- Each cell takes hours in steps of 0.5, from 0 to 24 per day in total.
- Each row and each day shows a total. The week total shows against the person's weekly target (default 40 hours, set by the Admin per person).
- Each entry has a project, a stage, a date and hours. A task is optional. "Log time" on a task fills the task's project and stage.
- "Copy last week" adds last week's rows with empty cells.
- A week locks 14 days after its last day. Only the Admin can unlock a person's week.
- On Thursday at 15:00 (Arabia Standard Time), a person with a week total under the target gets an Inbox reminder.
- There is no live timer.

## 7. Inbox, comments and search

### 7.1 Notification triggers

| Trigger | Who gets it | Action button |
|---|---|---|
| A task is assigned to me | the new owner | Open |
| Someone @mentions me | the person | Open |
| My task is due tomorrow | the owner | Open |
| My task is overdue | the owner | Open |
| A task goes to review | the project leader | Approve |
| My task is approved | the owner | Open |
| My task is sent back | the owner | Open |
| The stage changes on my project | the leader and the team | Open |
| I am added to a project | the new member | Open |
| My week is under target (Thursday) | the person | Open timesheet |

Rules:

- The Inbox groups items by day, with an unread dot. "Mark all read" clears the dots. On a phone, a swipe marks one item as read.
- Each person turns each trigger on or off in Settings.
- An agent post never creates a notification, unless it @mentions a person.
- A person never gets a notification for their own action.

### 7.2 Comments

- Comments go on tasks and on updates.
- `@name` mentions a person. `#KH-26-014` links to a project.
- Three reactions: 👍 ✅ 👀. A second tap removes the reaction.
- Authors can edit or delete their own comments. An edited comment shows "edited".

### 7.3 Search

- Search finds projects, tasks, people and files by name and code.
- It also runs commands: New task, New project, Log time, Go to Dashboard, Go to My Work.
- Results show in groups. The arrow keys move through them, and Enter opens the selection.

## 8. Dashboard

Everyone sees the same dashboard.

### 8.1 Filters

Period (this month, this quarter, this year), status (Active by default), leader and client. The filters apply to all tiles and charts.

### 8.2 Tiles

| Tile | Definition | Click opens |
|---|---|---|
| Active projects | Count of projects with status Active. | Projects, filter Active |
| At risk or late | Count of Active projects with health At risk or Late. | Projects, filter At risk |
| Overdue tasks | Count of overdue tasks (see 4.2). | Task list, filter Overdue |
| Deadlines, next 14 days | Count of deadlines from today to today + 14 days. | Task list in deadline mode, sorted by date |
| Office hours this week | Sum of all hours this week, against the sum of all weekly targets, as hours and %. | The Hours summary sheet |
| Area in design | Sum of the area of Active projects whose current stage is not Supervision, in m². | Projects, same filter |

The Hours summary sheet lists each project's hours this week. The Admin also sees the hours per person.

### 8.3 Charts

1. **Projects per stage.** A horizontal bar per stage, with the count of Active projects.
2. **Health mix.** One bar split into On track, At risk and Late.
3. **Tasks done against tasks created.** Two series per week, for the last 12 weeks.
4. **Hours per project this month.** A horizontal bar per project, project totals only.

A click on any bar opens the list behind it, with the filter already set.

### 8.4 Workload grid

- Rows: people (humans only). Columns: the next 4 weeks.
- Each cell shows the count of the person's open tasks with a due date in that week.
- A cell turns red above the workload limit (default 10, set by the Admin).
- A click on a cell opens the Task list for that person and that week.

### 8.5 Office schedule

- One row per Active project, sorted by target end date. Each row shows the stage bars, with the colors of the stage rail.
- Deadlines show as diamonds. A vertical line marks today.
- Zoom levels: month, quarter, year.
- A click on a row opens the project. In Arabic, time runs from right to left.

## 9. Settings

**For everyone:**

- Profile: name, photo, discipline.
- Language: English or العربية.
- Theme: System, Light, Dark.
- Glass: Clear, Frosted (default), Solid.
- Notifications: one switch per trigger.

**For the Admin only:**

- People: add a person, deactivate a person, set the system role (Admin or Member), the kind (human or agent), the discipline and the weekly hour target.
- Office settings: the default stage list, the project code prefix, the workload limit.
- Unlock a person's locked week.

**Default stage list:** Concept, Schematic Design, Design Development, Construction Documents, Permits, Tender, Supervision.

## 10. Design system

The design follows Apple's Human Interface Guidelines as of September 2026 (Liquid Glass, introduced June 2025, refined at WWDC 2026 for iOS 27 and macOS 27). Sources are in section 16.

### 10.1 Layers and glass

- **Glass only on the navigation layer:** the sidebar, the toolbar, the tab bar, sheets, menus and popovers. Content (cards, lists, charts) sits on solid surfaces. Glass never sits on glass.
- **Exception:** a switch or a slider shows a glass look only while the user holds it.
- **Frosted by default.** The Glass setting offers three levels:

| Level | Light mode | Dark mode |
|---|---|---|
| Clear | white at 25% + blur 12 px | black at 25% + blur 12 px |
| Frosted | white at 72% + blur 24 px + saturate 180% | #1C1C1E at 72% + blur 24 px + saturate 180% |
| Solid | opaque surface color | opaque surface color |

- The system setting "Reduce transparency" forces Solid.
- **Clear glass over images:** buttons on a cover image use clear glass, with a 35% black layer behind them when the image is bright.
- **Scroll edge effect:** a soft blur fades the content where a bar floats over it. One effect per view. Only where a bar floats over content. Pinned table headers (the timesheet, the task list) use the hard style: a more opaque edge.
- **No hard divider lines** under bars.
- **Dim layer:** a task that blocks the flow (New Project, Delete) opens with a dim layer. A panel that does not block (the task panel on desktop) opens with no dim layer.

### 10.2 Shapes

- **Concentric corners:** inner radius = outer radius − the padding between the shapes.
- Cards: 22 px radius. Sheets: 28 px. Large controls and phone buttons: capsules (radius = half the height). Dense desktop controls: 8 px.

### 10.3 Color

- Neutral surfaces. Light: background `#F5F5F7`, cards `#FFFFFF`, text `#1D1D1F`. Dark: background `#000000`, cards `#1C1C1E`, text `#F5F5F7`.
- One accent color, blue (`#007AFF` light, `#0A84FF` dark). The accent goes only on the main action, the selected item, the current stage and badges. The accent is one token, so a brand color later is a one-line change.
- Status colors: green `#34C759` / `#30D158`, orange `#FF9500` / `#FF9F0A`, red `#FF3B30` / `#FF453A` (light / dark). A status color always comes with a word.
- Before the final polish pass, check these values against Apple's iOS 27 UI kit, because Apple adjusted its palette for Liquid Glass.
- The "Increase contrast" system setting adds 1 px borders with high contrast to all surfaces.

### 10.4 Typography

- **English:** Inter (variable font, with optical sizes). Inter is the closest free match to Apple's SF Pro. The SF fonts may not be used on the web or on Windows.
- **Arabic:** IBM Plex Sans Arabic (weights 400, 500, 600, 700).
- Both fonts are self-hosted, so the look is the same on Windows and on a Mac.
- **Scale:** Apple's text styles. Body is 17 px on phones and 15 px on desktop. Large Title 34, Title 1 28, Title 2 22, Title 3 20, Headline 17 semibold, Subheadline 15, Footnote 13, Caption 12 (phone values).
- **Tracking:** large titles −0.02 em. Body 0. Captions +0.01 em.
- **Weight:** titles are bold (Apple's 2025 type change). Alerts and empty states are start-aligned, not centered.
- **Arabic size:** one step larger than English at the same level, because Arabic looks smaller next to Latin text.
- **Numbers:** Western digits (0 to 9) in both languages. Tables and charts use tabular (fixed-width) digits.
- **Dates:** Gregorian calendar in both languages. In code, the Arabic locale is `ar-SA-u-ca-gregory-nu-latn`. The plain `ar-SA` locale defaults to the Hijri calendar and Arabic-Indic digits, so it must not be used.

### 10.5 Icons

Lucide icons. Apple's SF Symbols have the same license limit as the SF fonts. Directional icons (back, next, arrows for flow) flip in Arabic. See 10.8.

### 10.6 Motion

All motion uses springs from the Motion library. Every animation can stop and reverse halfway, from its current position on screen.

| Use | Spring |
|---|---|
| Default (all UI) | bounce 0, duration 0.35 s |
| Card expands into the project screen | shared layout, bounce 0, duration 0.45 s |
| Sheet release after a flick | bounce 0.15, duration 0.4 s, with the release velocity |
| Board card drop | bounce 0.15, duration 0.35 s |
| Press feedback | scale 0.97 on pointer-down, 100 ms |

Rules:

- Feedback starts on pointer-down, not on release.
- Sheets and menus grow from the control that opens them, and close back into it.
- A phone sheet follows the finger 1:1 from the grab point. At the top edge, it resists like rubber. The release velocity decides close or stay.
- A sheet that the user drags upward becomes more opaque as it grows.
- A dragged board card lifts (scale 1.03, a deeper shadow) and the other cards slide aside.
- Only `transform` and `opacity` animate.
- "Reduce motion" replaces slides and springs with 200 ms fades.
- No confetti and no decoration motion.

### 10.7 Design principles

Apple's eight principles (reintroduced June 2026) are the review checklist for each screen: Purpose, Agency, Responsibility, Familiarity, Flexibility, Simplicity, Craft, Delight. Two of them set product rules:

- **Agency:** Undo replaces "Are you sure?" dialogs. Only "Delete project" asks for confirmation.
- **Responsibility:** every change by an AI agent carries the "Agent" label. The leader, the Admin and the person the agent acted for can undo it from the feed item or the task history.

### 10.8 Right-to-left (Arabic)

- The `dir` attribute on `<html>` switches the whole layout.
- The code uses only logical CSS properties (start and end, never left and right). A lint rule fails the build if it finds physical left or right properties or classes.
- **Flip:** the layout, the sidebar side, back and next arrows, progress bars, the stage rail, schedules and time axes, and any row of images in a meaningful order.
- **Never flip:** the digits in a number, photos and renders, logos, the checkmark, clock icons, and arrows for a real direction (for example a north arrow).
- **Mixed text:** user text uses `dir="auto"`. A paragraph of three or more lines aligns by its own language. Short labels and list items align with the interface.
- **Arabic copy is a draft.** A native speaker reviews the Arabic interface text before the team review.

### 10.9 Screen sizes and accessibility

- Breakpoints: phone under 640 px, tablet 640 to 1023 px, desktop 1024 px and wider.
- Every tap target is at least 44 × 44 px.
- WCAG 2.2 AA: text contrast at least 4.5:1, a visible focus ring, labels for screen readers.
- Everything works with a keyboard. The board uses the dnd-kit keyboard sensor. On the schedule bars, the arrow keys change dates by one day.
- The app follows the system settings for reduce motion, reduce transparency and increase contrast.

## 11. Architecture

### 11.1 Stack

| Part | Choice |
|---|---|
| Language and build | TypeScript, React, Vite |
| Routes | React Router, hash-based links, so the build runs on any static host |
| Styles | Tailwind CSS v4 on top of design tokens in CSS variables |
| Motion | Motion (motion.dev) |
| Phone sheets | Vaul |
| Drag and drop | dnd-kit |
| Search panel | cmdk |
| Icons | Lucide |
| Languages | i18next, with `en.json` and `ar.json` |
| Charts | Recharts for the four dashboard charts |
| Schedules | custom SVG components (project and office schedules) |
| Data fetch and cache | TanStack Query |
| API contract | zod schemas |
| Browser storage | IndexedDB (data and files) |
| Tests | Vitest for rules. Playwright for screen checks, with axe for accessibility |

### 11.2 Folder structure

```
madar/
  docs/superpowers/specs/
  src/
    app/            shell, routes, providers, Preview-as switch
    design/         tokens.css, glass, type scale, motion presets
    components/     Button, Card, Sheet, Sidebar, TabBar, Toolbar, Avatar,
                    HealthPill, StageRail, Toast, EmptyState, ...
    features/
      projects/ project/ tasks/ schedule/ files/ team/
      mywork/ hours/ inbox/ dashboard/ search/ settings/
    api/
      contract.ts   zod schemas for every call input and output
      client.ts     api.call(name, input): the only way screens reach data
      handlers/     one file per area (projects, tasks, time, ...)
      permissions.ts  can(actor, action, resource)
      health.ts     computeHealth(project, today)
      events.ts     event log writer and undo
      notify.ts     notification triggers
      store.ts      IndexedDB access, with an in-memory fallback
    data/
      seed.ts       sample data, dates relative to today
    i18n/
      en.json ar.json
  tests/
```

### 11.3 The fake API (the contract)

Screens reach data only through `api.call(name, input)`. The call runs as the current user. Each handler follows the same steps:

1. Validate the input with the zod schema. On failure, return error `invalid_input` with the field names.
2. Check `can(actor, action, resource)`. On failure, return error `forbidden`.
3. Apply the change to the store.
4. Write one event per change to the event log.
5. Create notifications through `notify.ts`.
6. Return the result, validated by the output schema.

A caller can pass one story ID (`correlationId`) to several calls, so one agent request reads as one story in the log. Without it, each call gets its own ID.

The fake API waits 120 ms before it answers, so the screens behave like a real network. Screens update at once (optimistic update) and roll back if the call fails.

In the real build, each call becomes `POST /api/<name>` on a Python server (FastAPI). The Python models mirror the zod schemas. The server also publishes an OpenAPI description, and an MCP server wraps the same calls for AI agents.

**Calls:**

| Area | Calls |
|---|---|
| Session | `session.get`, `session.previewAs` (prototype only) |
| Users | `users.list`, `users.get`, `users.create`, `users.update`, `users.deactivate` |
| Clients | `clients.list`, `clients.create`, `clients.update` |
| Projects | `projects.list`, `projects.get`, `projects.create`, `projects.update`, `projects.setStage`, `projects.setLeader`, `projects.setStatus`, `projects.setHealthOverride`, `projects.clearHealthOverride`, `projects.delete` |
| Members | `members.add`, `members.remove`, `members.update` |
| Stages | `stages.replace`, `stages.setDates` |
| Deadlines | `deadlines.create`, `deadlines.update`, `deadlines.delete` |
| Tasks | `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.move`, `tasks.approve`, `tasks.sendBack`, `tasks.delete` |
| Updates | `updates.list`, `updates.create`, `updates.update`, `updates.delete` |
| Comments | `comments.list`, `comments.create`, `comments.update`, `comments.delete`, `reactions.toggle` |
| Files | `files.list`, `files.get`, `files.upload`, `files.delete` |
| Time | `time.week`, `time.set`, `time.copyLastWeek`, `time.unlockWeek` |
| Notifications | `notifications.list`, `notifications.markRead`, `notifications.markAllRead`, `notifications.updateSettings` |
| Events | `events.list`, `events.undo` |
| Dashboard | `dashboard.get` |
| Search | `search.query` |
| Settings | `settings.get`, `settings.update`, `me.updatePreferences` |

`files.upload` creates a new version when a file with the same name exists in the same project.

### 11.4 Data model

All IDs are readable strings with a prefix (`usr_`, `cli_`, `prj_`, `stg_`, `ddl_`, `tsk_`, `upd_`, `cmt_`, `fil_`, `tim_`, `ntf_`, `evt_`). All dates use ISO 8601. All status fields use fixed lists.

| Entity | Fields |
|---|---|
| User | id, name, email, avatarUrl, kind (`human`, `agent`), systemRole (`admin`, `member`), discipline, weeklyHourTarget, active, ownerId (for an agent: the person it acts for; for a person: null), preferences (language, theme, glass, notification switches), gender (optional: `female`, `male`; Arabic grammar only, so a verb after the person's name agrees; added in build step 5, pending the owner's approval) |
| Client | id, name, contactName, phone, email |
| Project | id, code, name, clientId, status (`active`, `on_hold`, `completed`, `archived`), leaderId or null, currentStageId, location, areaM2, startDate, targetEndDate, coverFileId, modelFolderPath, description, healthOverride (value, reason, setBy, setAt) or null, createdBy, createdAt, updatedAt |
| ProjectMember | projectId, userId, discipline |
| Stage | id, projectId, name, order, startDate, endDate |
| Deadline | id, projectId, stageId or null, name, date |
| Task | id, projectId, stageId, title, description, ownerId, status (`todo`, `in_progress`, `in_review`, `done`), dueDate or null, flagged, needsReview, checklist (items with text and done), createdBy, createdAt, completedAt |
| Update | id, projectId, authorId, body, fileIds, createdAt, editedAt |
| Comment | id, targetType (`task`, `update`), targetId, authorId, body, reactions (emoji to user IDs), createdAt, editedAt |
| File | id, projectId, stageId or null, taskId or null, name, versions (letter, blobKey, mimeType, size, uploadedBy, uploadedAt) |
| TimeEntry | id, userId, projectId, stageId, taskId or null, date, hours |
| Notification | id, userId, trigger, targetType, targetId, read, createdAt |
| Event | id, seq, projectId or null, actorId, actorKind (`human`, `agent`), actingForId (the person the actor acted for; the actor itself for a person), correlationId (one story ID per request), verb, targetType, targetId, before, after, createdAt, undoneBy or null |
| Settings | defaultStages, codePrefix, workloadLimit |

The card's "two latest updates" and the Overview feed both read from Updates and Events.

### 11.5 Undo

- `events.undo(eventId)` writes the `before` value back and records a new event.
- Undo is refused with error `conflict` if a later event changed the same field of the same item.
- The 5-second Undo toast calls the same function.

### 11.6 Errors and empty states

| Case | Behavior |
|---|---|
| Invalid field | Inline message under the field, shown when the user leaves it. |
| `forbidden` | Should not happen, because screens hide actions the user may not do. If it happens: a toast, "You can't do this on this project", and a rollback. |
| Failed call (simulated) | The optimistic change rolls back. A toast offers Retry. |
| `conflict` on Undo | A toast, "This changed after the agent's edit. Undo is not available." |
| Browser storage unavailable (for example a private window) | The app runs in memory. A banner says "Changes will not be saved in this window." |
| Empty list | An empty state with one sentence and one action, for example "No tasks yet. Add a task." |

## 12. Sample data

- 12 projects with realistic, invented Khobar names and clients. Mixed stages and health: at least 2 Late, 3 At risk, 1 On hold, 1 Completed.
- 8 people: 1 Admin, 3 leaders, 4 members, with mixed disciplines. Plus 1 agent, "Madar Assistant".
- The agent acts for the Admin. The sample data holds its weekly summary on each Active project for each past Sunday at 08:00.
- About 150 tasks, 6 months of history, 60 files (images and PDF files, generated), and 8 weeks of time entries.
- All dates are relative to the current date, so "due in 5 days" stays true on every visit.

## 13. Tests

### 13.1 Rule tests (Vitest)

- The permission table: one test per row and role.
- The health rule: each branch, plus the override and its clear on stage change.
- The review flow: steps 1 to 6 in 5.5.
- The time rules: 0.5 steps, 24 hours per day, the week lock after 14 days, the unlock.
- The notification triggers. Two tests cover the exceptions: no notification for your own action, and no notification from an agent post without an @mention.
- Undo, and the `conflict` case.
- The code generator for project codes.

### 13.2 Language check

A test fails if `en.json` and `ar.json` do not have the same keys, or if any value is empty.

### 13.3 Screen checks (Playwright)

- A screenshot of every screen in English and Arabic, light and dark, at phone (390 px), tablet (820 px) and desktop (1440 px) widths.
- An axe accessibility check on every screen.
- A keyboard-only pass through the three acceptance flows in 1.2.
- A check with reduce motion and reduce transparency turned on.

### 13.4 Manual checks

- ⚠️ **Windows check (needs the owner).** Open the review link on one office PC in Chrome or Edge. Glass blur can stutter on weak graphics cards. If it stutters, the default glass level changes to Solid on that class of machine.
- One review on a real iPhone and a real Android phone.

## 14. Build order

Each step ends with a review link (a private artifact that also opens on phones).

1. **Shell.** Design tokens, glass, type, the sidebar and tab bar, the language switch, the theme and glass settings, the fake API, the permission function, the event log and the sample data.
2. **Projects.** The Projects grid, the card, the New Project sheet and the Project screen with all five tabs.
3. **Personal work.** My Work (Tasks and Hours), the Inbox, comments and reactions, and search.
4. **Dashboard.** Tiles, charts, the workload grid, the office schedule and the Task list screen.
5. **Polish.** Motion details, the Arabic review, dark mode, accessibility fixes, the Playwright sweep, then the team review.

## 15. Open items

| Item | Owner | When |
|---|---|---|
| Trademark and domain check for "Madar" | Osama | Before the name goes public |
| Arabic interface text review by a native speaker | Osama or a named reviewer | Before step 5 |
| Test on an office Windows PC | Osama | In step 5 |
| Where the app runs (STUDIO server or cloud) | Real-build spec | After prototype sign-off |
| Fees and invoices | Owner decision | After prototype sign-off |

## 16. Sources

- Apple HIG, Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- Apple HIG, Design principles (June 8, 2026): https://developer.apple.com/design/human-interface-guidelines/design-principles
- Apple HIG, What's new: https://developer.apple.com/design/whats-new/
- Apple HIG, Right to left: https://developer.apple.com/design/human-interface-guidelines/right-to-left
- Apple HIG, Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Apple HIG, Sidebars: https://developer.apple.com/design/human-interface-guidelines/sidebars
- Apple HIG, Scroll views: https://developer.apple.com/design/human-interface-guidelines/scroll-views
- Apple HIG, Branding: https://developer.apple.com/design/human-interface-guidelines/branding
- WWDC25, Get to know the new design system: https://developer.apple.com/videos/play/wwdc2025/356/
- WWDC26, What's new in SwiftUI: https://developer.apple.com/videos/play/wwdc2026/269/
- Cult of Mac, Liquid Glass changes in iOS 27 and macOS 27: https://www.cultofmac.com/news/liquid-glass-changes-ios-27-macos-27

## 17. Agent rules adopted from Scitter (2026-09-30)

The owner compared this design with Scitter (EduArabia's lecture workspace, which runs with real agents over MCP) and approved these rules.

**In the prototype (plan 1):**

1. An agent acts for one person, with that person's rights and never more. There is no separate agent role and no scope system.
2. Every change records two names: the agent (`actorId`) and the person it acted for (`actingForId`).
3. One story ID (`correlationId`) ties together all the changes of one request.
4. A person never gets a notification for their own agent's action.
5. The person an agent acted for can undo the agent's changes, like their own.

**In the real build (Python):**

6. Agents connect over MCP at one address and sign in with OAuth 2.1 and PKCE. A person approves the agent on a consent screen. The identity comes from that approval only, never from a header or an argument the agent sends.
7. Every call carries a written instruction for agents, and one "read this first" call tells an agent what Madar is, what it may do, and who it acts for.
8. The change log is append-only in the database: no update and no delete path.

**Not adopted:** Git storage (Madar's data is records, not documents), server pages with no JavaScript (they cannot give the Apple motion), and "one environment, nothing verified locally".


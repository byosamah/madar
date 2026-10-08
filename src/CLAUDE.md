# Screens

React + TypeScript + Vite + Tailwind v4, React Router, TanStack Query, Motion, i18next, vaul sheets. Other guides here:
`api/` (the contract and the fake API), `i18n/` (words), `design/` (tokens). Read `DESIGN.md` at the repo root before
any screen work.

## Folders
- `app/`: the shell, routes, runtime hooks, modes, and `app/remote/` (Supabase client, sign-in port, realtime channel).
- `features/<area>/`: one folder for each screen area. `components/`: shared parts. `lib/`: pure helpers (dates, due, stages).
- `data/`: the sample office of the prototype. `test/`: render helpers, factories, setup.

## Two builds from one source
- `VITE_MADAR_API` (`fake` default, `remote`) is fixed at build time. Use `PROTOTYPE`/`REMOTE` from `app/mode.ts`.
- `main.tsx` loads only one bootstrap. Its first import is `app/zodConfig.ts` (zod runs jitless, so the CSP holds).
- The prototype uses `createHashRouter` (links `#/...`, base `./`, one script file). The remote build uses
  `createBrowserRouter` (path links, base `/`). Screen tests use the hash router.
- The remote build moves `www.<host>` to `<host>` before it starts (`app/canonicalHost.ts`).
- `scripts/check-bundles.ts`: the remote build holds no sample names. The prototype build holds no "supabase".

## Data on screens
- Screens call `api.call(name, input)` through `useCall` (reads) and `useAction` (writes) in `app/runtime.tsx`.
- `app/readMap.ts` says which change kinds each read reads. The remote build keeps answers until a change signal names
  them (`app/signals.ts`, `app/remote/channel.ts`).
- A screen never checks a right by itself. It asks `can()` (see `api/CLAUDE.md`).
- Theme: a new person starts light (`defaultPreferences`). The screens before sign-in take the theme saved on the device
  (`madar.theme`, written at each sign-in by `app/AppearanceSync.tsx`), else light. The sample office keeps System.

## Speed (performance audit 2026-10-07)
- A list screen splits into a parent and a `React.memo` body. The parent keeps `useSearchParams`, the reads, the clock
  values (`todayISO`, `officeHour`) and the panel. The body gets plain props and stable handlers (`app/useStableHandler.ts`),
  so a panel that opens or closes renders no row again. Never put a router hook in a row body: a row part that needs one
  is its own small component, as `RowMenu` in `features/projects/ProjectListRow.tsx`.
- `useLang` (`app/lang.ts`) reads the language with `useSyncExternalStore` over the one i18next instance and its
  `languageChanged` event. It does not call `useTranslation`.
- `usePrefetchCall` (`app/prefetch.ts`) starts a read early under the exact key of `useCall`, in the remote build only.
  Call it in an effect or an event, never in render. A project row prefetches `projects.get` on pointerdown, never on hover.
- Home keeps the last role it saw for each auth user in localStorage (`madar.homeRole.<auth user id>`,
  `features/home/roleHint.ts`). Before `session.get` answers, the real build asks for the `projects.list` of that role. The
  session answer always decides. The sign-in port gives the auth user id at once (`AuthPort.userId()`, optional).
- In the real build, Tasks shows the cached Home answer of `tasks.list {filter:'mine'}` without the done rows while its own
  list loads (`features/work/minePlaceholder.ts`), only when no change marked that answer. `WorkTasks` reads its list with
  `useQuery` under the `useCall` key, so a change to `useCall` must also go there.
- The project Tasks tab asks `taskTemplates.list {}` once, with its `tasks.list`, under the gates of the menu (list view and
  `createTaskForSelf`). Each `TemplateMenu` keeps the templates of its stage with `lib/sameText.ts`, as the handler does.
- In the real build, a picture hook (`useFileLink`, `useScreenshotLink`) keeps its signed link in the cache for
  `LINK_STALE_MS` (8 minutes) after the screen closes. The row pictures (Files rows, the meeting drawings, the report
  thumbnails) have `loading="lazy" decoding="async"`. A sheet or preview picture does not.

## Routes and shell
- Routes (`app/routes.tsx`): `/` Home, `/projects`, `/projects/:id` (tabs overview, tasks, activity, tracker, schedule,
  files, team), `/work` (Tasks), `/dashboard`, `/dashboard/meeting` (full screen), `/inbox`, `/notifications`, `/search`,
  `/settings`, `/admin` and `/admin/:section`. Remote only: `/sign-in`, `/welcome`, `/forgot`, `/reset`, `/oauth/consent`.
- Admin: a grouped side list, one section at a time. The sections, their groups and roles are in one registry,
  `features/settings/admin/sections.ts`; a new section is one line there. A desk opens the first section at `/admin`; a
  phone shows the list there. An unknown or forbidden section goes back to `/admin`.
- Project templates: the Admin section (`ProjectTemplatesSection.tsx`, the editor works on a text draft, `templateDraft.ts`)
  and "Start from a template" in the new-project form (`features/projects/TemplateUse.tsx`, `templateForm.ts`). A chosen
  template takes the place of the stage list and makes the start date required. The ticks "Can stretch" stay folded, and show
  only when the end date gives another length. The dates come from `lib/projectPlan.ts`, as on the server.
- Shell (`app/AppShell.tsx`): a floating tab pill (Home, Projects, Tasks, Dashboard, Inbox, plus Search and the bell; top
  on desktop, bottom on a phone), the Madar mark at the top start (a press opens Home), the person menu. No sidebar.
- Focus mode is `?focus=<taskId>` with a 25-minute timer.
- Tasks (`/work`): one main button, New office task (`features/work/NewOfficeTaskSheet.tsx`: title, lead, due date). A list
  screen opens a task panel with `?task=<id>` and, for a project task, `&project=<id>` (`openTask`, `lib/params.ts`).
  `taskLink(null, id)` sends an office task to `/work?task=<id>`. An office task has no project: the word Office
  (`office.word`) shows where a project shows, and its panel (`TaskSheet` with `detail` null) has no stage and no
  prerequisites (owner, 2026-10-06).
- A date group of the Tasks screen takes a new order by drag (owner, 2026-10-07): a grip at the end of each row the person may
  move (`SortableGroup`, `features/work/WorkTasks.tsx`, `@dnd-kit/sortable`), and Space plus the arrow keys on the grip. The row
  content sits in an inner box (`RowDrag`, `TaskRowItem.tsx`), so the drag and the slide of the row never set one transform.
- Dashboard (`features/dashboard/`): every link to a list carries the Leader, Client and Team filters (`withFilters`,
  `Tiles.tsx`), and the Projects screen and the Task list read `leader`, `client` and `team` from the link. A new card in the
  pattern of Stale projects uses `AttentionCard.tsx` and shows only when it has a row. Money and Data gaps draw only when
  `dashboard.get` sends them (the server decides by role).
- Roles: Admin, Management, Accounting, Member; per project a leader and a team. Anyone creates a project and leads it.
  Everyone sees all projects. Payments only for Admin, Management, Accounting. Agents never join a team. The person who adds a
  project task changes and deletes it like the leader while on the team; the review stays with the leader (owner, 2026-10-07).
- Home (`features/home/`): the Today panel lists my tasks due today or past due. With none, it is "Coming up": my next 3 open
  tasks with a due date (`comingUp`, `lib/home.ts`, owner 2026-10-07). With neither, it says that nothing is due today. Home
  follows the shared order of the Tasks screen (`api/CLAUDE.md`).

## Design rules (the short form of DESIGN.md)
- Judge every choice from the view of the employees with ADHD: one next step, the fewest controls.
- Start from the LIVE app's design system (glow tiles, the tokens), never from the spec alone.
- The signature is solid navy `#1F2A55` (dark `#C9D4FF`), never a gradient. It goes only on the one main button, the
  open tab, the day ring and the timer.
- The glow (three soft lights) sits only behind "Next for you" and in the logo tile.
- 8 project hues from a hash of the id. Project pictures are "glow forms" with a unique `mark`.
- Status words are shape signs plus an ink word (no tinted pill). The stage steps line takes the status colour.
- Red only for Late and errors. Gentle words: "3 days past due" in the attention colour, never a red "Overdue".
- Calm rules (`expectCalm` in the Playwright suites): one title, at most one main button, no filter chip rows (one Filter
  button), no grid view, no avatar stacks, "On track" never shows in lists. Only the tab pill keeps a blur.
- Icons: animated Lucide icons from lucide-animated.com through `components/icons/AnimatedIcon.tsx`.
- Logo: `MadarMark` ("Turning doors"), only in the sign-in frame and the app frame, never in a project list
  (`MadarMark.test.tsx` lists the files).
- Fonts: Thmanyah Sans for English and Arabic (files in `design/fonts/`), then Inter and IBM Plex Sans Arabic as the
  fallback. Number spots use the `tabular` class: it takes the digits from Inter. Weights: Bold (`font-bold`, the title
  and headline styles) only for headings, Medium (`font-medium` or `font-semibold`, which renders Medium) for emphasis in
  rows, labels and buttons, Regular for body text.
- RTL: logical classes only (`start/end`, `ms/me`, `ps/pe`). `scripts/check-rtl.ts` fails on left or right styles.
- Write a direction mark as an escape (`\u2068`), never as the raw character: GitHub flags hidden bidi characters.
- Text with its own direction (`dir="auto"`, `dir="ltr"`, `<bdi>`) takes its side from the page (`tokens.css`), so an
  English name sits on the right in Arabic. Put `dir="auto"` on the text, never on a flex or grid box or with
  `text-start`/`text-end`: `scripts/check-rtl.ts` fails on that. A name with a colon is one `<bdi>` ("Faisal:").
- Every visible word comes from a word key (see `i18n/CLAUDE.md`).
- Dates: a date that saves itself uses `DateDraftField`. A date in a form that saves with its own button uses `DateField`
  (`components/DateField.tsx`). Both show "Set date…" when empty. Only the Tracker quick log keeps a raw date field (its
  date is never empty and has no label).
- A required field: `required` on `TextField`, `SelectField`, `TextArea` or `DateField` shows an asterisk after the label
  and a hidden "required" word in the description. The label text stays the field name, and the browser never checks
  the field.
- A project code shows as its key (`projectKey`) in lists and rows, and in full in the project header and About.
- A person has an English name (`name`) and maybe an Arabic name (`nameAr`). Every spot that shows a person's name uses
  `usePersonName()` (`app/personName.ts`, the name of the screen language), and lists of people sort with
  `useByPersonName()`. A name that the server writes into a detail has an `Ar` twin: read it with `localName`.
- A person card (`UserCard`) carries no picture data. `Avatar` takes the picture from `users.list` through
  `app/pictures.tsx` (the app frame and the meeting view mount it).
- A report screenshot uses `useScreenshotLink` (`app/files.ts`). A press opens it in a sheet, and a press on the big
  picture opens it at full size in a new tab. The thumbnail has `loading="lazy"`; the sheet picture does not.
- A picture hook (`useFileLink`, `useScreenshotLink`) asks for one new link after an error. It gives up only when the new
  link breaks: an error of the old link while the new link loads is no strike. A screen checks `broken` before `url`.
- A report excerpt in a notice sentence sits between FSI and PDI (`\u2068`, `\u2069`), so it keeps its own direction.

## Before you call a screen change done
- Tests first. Then screenshots in EN and AR, light and dark, at 390 px.
- claude-in-chrome screenshots run inline. Playwright runs only in a delegated subagent.
- Chrome slows the timers of a hidden tab, so a list can show a change late. Bring the tab to the front
  before you judge it.
- Prototype language and theme: the person menu (stored in IndexedDB, not localStorage). A switch takes a few seconds,
  and `<html lang>` can show the old value meanwhile. Wait before a screenshot.
- The owner likes to choose a visual style from a side-by-side comparison artifact.

## Screen test gotchas
- Links are `#/...` (hash router).
- A read with `wire.output` (`feedback.screenshot`, `files.link`) gives the screen the wire form in the real build. Test such a
  screen with `runtime.mode: 'remote'`: the prototype test alone passed while the real build showed grey boxes.
- A whole project page can take more than the 1 s `findBy` default. Use `{ timeout: 10_000 }`.
- A panel that waits for its own query (DecisionsPanel on `projects.get`) can come after the card. Wait for the panel itself.
- `vite preview` sends no CSP, so only the deploy suite on the test copy catches a policy break.
- Run `npm test` alone. Next to a build or Playwright, screen tests time out.
- `renderRemoteApp` (`test/renderRemote.tsx`) renders the app with runtime mode remote and the query client of the real
  build. `sent` lists each call in order, and `hold` keeps the calls it picks until `release()`: use it to test the order of
  requests. A render-count test wraps a component with `vi.mock(path, importOriginal)` and waits until the count stops
  changing before it compares.
- A picture row of the real build: render with `runtime.mode: 'remote'` and an api stub that answers `files.link`
  (`features/project/files/FilesTab.remote.test.tsx`).
- `DateDraftField` (`components/DateDraftField.tsx`): a change event with no focus counts as a pick from the date picker and
  saves at once. To test typing, focus the field first (inside `act`): the full field shows and saves on blur or Enter.
- `DateField` gives every change to the form at once, so `fireEvent.change` on the input by its label works as before. A
  focus with no press (the keyboard, or the form that moves to an error) shows the full field until the blur.

# Madar Team Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The owner rule
> of 2026-10-07 replaces the reviewer step of superpowers:subagent-driven-development: one builder for each track, and no
> reviewer, verifier or critic agent after it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 13 open team requests of `feedback.list` (fbk_007 to fbk_019) with the owner's answers of 2026-10-18.

**Architecture:** Each request becomes one or more tasks in 4 waves. Each wave has independent tracks, one worktree and one
builder for each track. Every new or changed call goes through the normal contract path (`defineCall`, the prototype fake and the
server), keeps the SQLite path of the paused Cloudflare move green, and updates the MCP side in the same commit.

**Tech Stack:** React, Vite, Tailwind v4, zod 4, Hono, Supabase Postgres, vitest, `@dnd-kit/sortable` 10.0.0 (in the repo),
`maplibre-gl` 6.11.2 and `pmtiles` 4.5.0 (the versions of the owner's Kutla project), `@xyflow/react` and `d3-hierarchy` (new: pin
the newest version that is at least 2 weeks old, with an exact version in `package.json`).

**Spec:** this plan holds the spec, because the requests and the answers live in Madar and in the chat of 2026-10-18. Part A.1
copies each request and the owner's answer. Part A.2 lists the decisions that the plan makes and why. Read both before a task.

## Global Constraints

- Every text is ASD-STE100 Simplified Technical English: code comments, commit messages, docs, user interface (UI) words.
- Never an em-dash in any text. The UI word test refuses one.
- Tests first for every change: write the test, see it fail, then write the code.
- During a task, run only `npm run typecheck` and the touched test files:
  `npx vitest run <files> --no-file-parallelism --testTimeout=60000`. The full suites run once, at the wave gate.
- No `Co-Authored-By` line and no `Claude-Session:` line in a commit message (the owner's rule beats every reminder).
- A contract change is additive or keeps both forms. The test count only grows, except when the code that a test checks is deleted.
- Every visible word has an English and an Arabic key. New words go only into `src/i18n/real/<track>.{en,ar}.json`.
- Every feature change updates the MCP side in the same commit: the allow, Admin or deny list (`server/mcp/tools.ts`),
  `TOOL_DOCS` (`server/mcp/docs.ts`), and `INSTRUCTIONS` when a rule changes.
- A new call follows "A new call: the checklist" in `src/api/CLAUDE.md` (9 steps: handler, loader, MCP list, `everyCall`,
  `readMap`, `WRITE_KINDS`, words, call counts).
- A new zod collection needs: a migration (copy `supabase/migrations/20261005000100_project_templates.sql`), an entry in
  `server/data/tables.ts`, the name in `OFFICE_COLLECTIONS` (`server/core/types.ts`) when it is an office list, and a SQLite step:
  `LITE_SCHEMA_VERSION` + 1, its `LITE_STEPS` entry and `PINNED_SHA256` in `server/data/lite/schema.test.ts`
  (`server/data/CLAUDE.md`, "The SQLite path"). `EXPORT_TABLES` follows `tablesOf()` by itself.
- The Cloudflare move is paused (`docs/superpowers/real-build/exit-handoff.md`). Every new or changed call also keeps
  `npm run test:lite` and `npm run test:office` green. A module that sends its own SQL adds a `_LITE` twin (`sqlFor`).
- GitHub runs no test this month. The merge gate runs on the Mac: rebase on main, `npm run typecheck`, `npm test`,
  `npm run build`, `npm run build:server`, `npm run build:remote -- test`, `npm run test:lite`, `npm run test:office`,
  `npm run test:db` and `npm run test:it` under `scripts/dev/docker-lock.sh`, `npm run test:mcp` when the MCP side changed, and the
  prototype smoke at screen merges. No merge with a red check.
- No production change before Friday 2026-10-23 unless the owner asks for a fix. Production takes only the commit of the last full
  test deploy (`scripts/deploy/CLAUDE.md`, Release flow).
- Free plans only. No paid map, tile or API service, and no Vercel. Any payment needs the owner's yes in words first.
- A feature that hides a record from some people gets leak tests from its own builder: probes as an outsider on every read path,
  error texts and Realtime signals included. No separate leak review.
- Screenshots for every screen change: English and Arabic, light and dark, 390 px and a computer width. Playwright runs only in a
  delegated agent (model haiku). The agent moves every shot out of `.playwright-mcp/` into the scratchpad.
- The ADHD rule: one next step and the fewest controls on each screen.
- One worktree for each track at `~/dev/madar-rb/<track>` (branch `rb/<track>`), `node_modules` linked to
  `~/dev/madar/.claude/worktrees/deploy-test/node_modules`. A task edits only its own files.
- Thmanyah Sans: no font file outside the built product. Map labels use Noto Sans; the report names a free fallback font.
- A Madar report (`feedback.setStatus` "done") is marked done only after the owner says that its fix is live.
- Never open, print, commit or log a secret.
- The line numbers in this plan come from the code of 2026-10-18. Check them before an edit.

## Review Focus

1. A person outside a group chat, or removed from it, asks for it by its id: every read path must answer as for a chat that does
   not exist (`chats.messages`, `chats.send`, `chats.markRead`, `chats.archive`, `search.query`, notices, push, MCP). Test: Task 7,
   `chatsGroupLeaks.test.ts`.
2. A person with a custom role that has no payment right: no amount on any path (Dashboard money, `payments.list`, History payment
   events, the report, the `overview` loader). Test: Task 26, "custom role: payments never leak".
3. A template update reaches a project where the team moved, finished or deleted template tasks: a closed task never moves, a task
   that the project added never changes, and a deleted task comes back only when the person picks "Bring back". Test: Task 23,
   `templateSync.test.ts`.
4. A wheel on a trackpad (many small pixel steps) and on a mouse (one notch): exactly one month for each notch and for each 100 px,
   never a fast run through many months. Test: Task 4, `calendar.test.ts` "wheelStep".
5. A transparent PNG on a browser that cannot make WebP: the picture keeps its see-through parts and fits 16 KB at a smaller side,
   or the person gets "too big". Never a black or white ground. Test: Task 3, `picture.test.ts` "see-through".

---

# Part A: The roadmap

## A.1 The requests and the owner's answers (2026-10-18)

| Report | Sender | Request | The owner's answer |
|---|---|---|---|
| fbk_013 | Osama | The people of a project: "+N" after 3 pictures, not 4 | Yes. 3 pictures then "+N", because 4 is too tall. |
| fbk_010 | Faisal | No browser suggestions in the Area field; check the other fields | Yes. |
| fbk_019 | Osama | A transparent profile photo shows the person's glow behind it | Yes, as far as the browser allows. |
| fbk_009 | Faisal | The date picker: one wheel step moves one month, and the header shows that month | Yes. Madar's calendar on computers only; phones keep their own picker. |
| fbk_018 | Osama | A change log for the team, opened from the person menu | Call it "What's new". Plain words for the team ("Now you can..."). Bold in the menu while something is new; normal after the person opens it. Update it at each release. |
| fbk_012 | Osama | Archive chats in the Inbox | Yes: the archive is private to each person, and a new message brings the chat back. |
| fbk_011 | Osama | Group chats in the Inbox | Yes: anyone makes a group, only the maker removes people, anyone can leave. AI agents may read group chats, direct chats and task threads, and know which messages wait for the person's reply. |
| fbk_007 | Moataz | An entity icon for each project | The Admin adds sub-companies (such as Vado and Bunah): a name in Arabic and English and a logo. Each project chooses one (old projects in the edit form, new ones when they are made). A small round logo overlaps beside the project picture outside, and shows inside the project. MCP lists the projects of one sub-company. The word is "Sub-company" / "شركة فرعية", never "entity". |
| fbk_017 | Moataz | A map with the location of each project | Pin the location in the project settings. The Dashboard shows an interactive map with a pin for each project. A Madar-style street map. |
| fbk_015 | Osama | An "open space" on the Dashboard: projects, stages, tasks and people | A read-only mind map for the managers who want the whole office at one look. |
| fbk_008 | Faisal | 7 requests about project templates | Build what Faisal needs, bug or feature. Item 1: "use the best practices, but my main problem was that the button disappears after I put a task". Item 7: as Faisal says. Old projects get template updates after a one-time link by names. |
| fbk_014 | Osama | A page to make roles with custom rights; only the Admin changes a person's role | Yes. The Admin can also change the rights of the existing roles. The Admin keeps all rights. The plan picks the main rights. |
| fbk_016 | Osama | A full branded office report (week, month, quarter, year) through MCP only | Madar gives the agent the data and the design system, and the agent designs the document. Madar's design system, clean, white background only. Payment amounts only for the payment roles and the Admin. |

## A.2 Decisions that this plan makes (the owner can change any of them before its wave)

| Request | Decision | Why |
|---|---|---|
| fbk_013 | Only the people list of a project changes (`ProjectListRow`). The task rows keep their own size. | The owner named the project people. |
| fbk_010 | `autoComplete="off"` on every text field of the project form, the new-client form and the link form. | The fault is the browser's own memory, not Madar. |
| fbk_019 | The glow sits behind every profile photo. A photo keeps its see-through parts only when it is uploaded again after the fix. | Today Madar paints every photo on white before it saves it, so no saved photo has see-through parts. |
| fbk_009 | A computer is a device whose main pointer is fine (`(pointer: fine)`). The week starts on Sunday. | Phones keep the picker that people know. Saudi calendars start on Sunday. |
| fbk_018 | The entries live in the repo and ship with each build. The "seen" mark is kept in the browser of each person (as `madar.homeRole.<id>`). | No server call, no History noise, no MCP change. A second device shows the bold item once. |
| fbk_012 | The archive mark is an optional field on the person's read mark of each chat (`ChatRead`). Agents cannot archive. | One row for each chat and person exists already, with no event and a person-only signal. |
| fbk_011 | A group has a name, 3 to 50 people at the start, and a maker. Group changes write no History event (as `chats.openDirect`). Agents read every chat that their person may open; they never mark a chat read for the person. | Same rules as direct chats. A read by an agent is not a read by the person. |
| fbk_011 | "Waits for a reply": in a direct or group chat, the newest message is from another person; in a project chat, a message that names the person is newer than the person's newest message; in a task thread, a comment by another person is newer than the person's newest comment, and the person leads the task or is named in it. Archived chats do not count. | A busy project chat would otherwise wait on everyone. |
| fbk_007 | The code uses the same word as the screens: `SubCompany`, `subCompanies`, `subCompanyId`, table `sub_companies`, id prefix `sub`. The UI word is "Sub-company" / "شركة فرعية" (owner, 2026-10-18). The logo is a data address of at most 16 KB, as the profile photo. MCP lists sub-companies without logos. | One word for one meaning. No file store, and no new path for files. |
| fbk_017 | MapLibre with a Protomaps street map of Saudi Arabia in one PMTiles file on R2, served from Madar's own address. Madar colors, light and dark, no shops or icons. Glyphs (Noto Sans and Noto Sans Arabic) and the Arabic text plugin also come from Madar's own address. | Free, no key, no third party at run time, and R2 works from Saudi networks. Kutla found that a map host can fail from Saudi networks. |
| fbk_017 | A pin comes from a drag on a small map, or from a pasted Google Maps address that holds the coordinates. A short `maps.app.goo.gl` link gets a message. | No geocoding service (all cost money or need a key). |
| fbk_015 | A tree from left to right (right to left in Arabic): office, projects, stages, open tasks. People show as pictures on each task node, with a "Focus on a person" picker that fades the other tasks. Only projects open at the start; a click opens the next level. | A person node under each task repeats people and makes the map busy. |
| fbk_008 | Item 1: the stage start and length always show. A stage with tasks keeps its own numbers. A new start moves the stage's tasks by the same working days. The stage span in a project covers its own numbers and its tasks. | Faisal's need: the controls stay. This is the summary-bar rule of common planning tools. |
| fbk_008 | Item 2: drag stages in the editor (keep Move up and Move down for the keyboard). A small note shows when a stage starts before the stage above it. | Projects list stages by their dates, so the note tells why a project shows another order. |
| fbk_008 | Item 3: template tasks and stages get prerequisites. A task with prerequisites becomes a dynamic task in a new project, so it moves when its prerequisite moves. | Common planning rule. Today template tasks are static and never move. |
| fbk_008 | Item 7: "Add stages from another template", with or without their tasks. No separate stage template list. | Faisal named either one. One list of templates is calmer. |
| fbk_008 | Item 4: the Admin sends a template update, one project at a time inside one story, so one Undo takes back all. Every date move asks one reason in the summary step. | The owner rule: every date move asks a reason. |
| fbk_014 | 7 rights: manage people, payments, delete projects, change project codes, manage clients, change any template, ask for the office report. The roles live in the office settings record, not in a new table. A person with a custom role has the base role Member plus the role's rights. Management loses the role change. | Few rights cover the office-wide checks (only 5 of the 25 actions read the role; the rest read the project role). No new table keeps the SQLite path cheap. The owner said only the Admin changes roles. |
| fbk_016 | One read call, `reports.office`, gives the data of the period and a design guide in the same answer. It goes to agents whose person has the right "Ask for the office report" (default: Admin and Management). No MCP resources. | The MCP server has no resources today, and the conformance baseline expects them to fail. |

## A.3 Waves and tracks

| Wave | Track | Tasks | Requests | Size | Needs |
|---|---|---|---|---|---|
| 1 | `quick` | 1 to 5 | fbk_013, fbk_010, fbk_019, fbk_009, fbk_018 | 4 days | Nothing |
| 1 | `inbox` | 6 | fbk_012 | 1 day | Nothing |
| 2 | `inbox` | 7, 8 | fbk_011 | 4 days | Task 6 |
| 2 | `subcompanies` | 9, 10 | fbk_007 | 3 days | Task 3 (`pictureOf` options) |
| 2 | `map` | 11, 12, 13 | fbk_017 | 4 days | Task 10 for the badge in the pin card (else it shows the tile only); the owner's OK for the R2 upload (Task 11) |
| 2 | `space` | 14 | fbk_015 | 3 days | Nothing |
| 3 | `templates` | 15 to 24 | fbk_008 | 10 days | Nothing (Task 15 first) |
| 4 | `roles` | 25, 26, 27 | fbk_014 | 5 days | Nothing |
| 4 | `report` | 28, 29 | fbk_016 | 3 days | Task 25 (the right `report.office`) |

The order of the waves is the plan's proposal: the small requests first, then the medium ones, then the two large ones. The owner
can move a track to another wave, because the tracks of different waves share no task.

## A.4 The end of each wave (Task W)

- [ ] Rebase each track on main in its own worktree, then run the merge gate once (Global Constraints). Merge each track with
  `git switch main && git merge --ff-only rb/<track>` in `deploy-test`.
- [ ] Deploy the test copy (`scripts/deploy/all.sh test`) and run the deploy suite (`tests/CLAUDE.md`).
- [ ] Screenshots of each changed screen (Global Constraints), delegated to one Playwright agent.
- [ ] Add the wave's "What's new" entry (Task 5) in plain words for the team, in English and Arabic.
- [ ] Hand the owner the production command (`scripts/deploy/CLAUDE.md`, Release flow), from Friday 2026-10-23 on.
- [ ] After the owner says that the release is live: `feedback.setStatus` "done" for each report of the wave.
- [ ] Tick the wave in `TASKS.md` and write each new fact in the guide of its part.

## A.5 The paused Cloudflare move

- Track R of the move (a stored unread number for each person and chat) is not on main. Tasks 6, 7 and 8 change the unread and
  chat reads of today (`server/data/loaders/chat.ts`). When the move restarts, Track R must also cover group chats and the archive
  mark: add a line under "Track R" in `TASKS.md` in Task 7.
- Task 9 adds one table, so it raises `LITE_SCHEMA_VERSION` to 4. If another track also adds a table, the merge lead gives the
  second one version 5 at the rebase.

---

# Part B: The tasks

## Wave 1, track `quick`

### Task 1: Three pictures, then "+N" (fbk_013)

**Files:**
- Modify: `src/features/projects/ProjectListRow.tsx:89`
- Test: `src/features/projects/ProjectListRow.test.tsx`

**Interfaces:**
- Consumes: `AvatarStack({ leader, team, max })` (`src/components/AvatarStack.tsx:17`): it shows the leader, then `max` team members.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** in `ProjectListRow.test.tsx`:
  `it('shows 3 pictures and "+2" for a leader and 4 team members')`: render a summary with a leader and 4 team members, expect
  3 elements with role `img` inside the stack and the text `+2`.
  `it('shows 3 pictures and "+1" for no leader and 4 team members')`: no leader, 4 team members, expect 3 pictures and `+1`.
- [ ] **Step 2: Run** `npx vitest run src/features/projects/ProjectListRow.test.tsx --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL (4 pictures today).
- [ ] **Step 3: Pass `max={summary.leader ? 2 : 3}`** to the `AvatarStack` at `ProjectListRow.tsx:89`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `Projects list: 3 pictures, then +N (fbk_013)`.

### Task 2: No browser memory in the project form (fbk_010)

**Files:**
- Modify: `src/features/projects/ProjectFields.tsx` (`project-location` :230-237, `project-area` :238-246, the stage name input
  of `StageList` :116-123, `project-folder` :278-285, `project-description` :286), `src/features/projects/ClientForm.tsx`
  (`client-contact` :92-95, `client-phone` :101, `client-email` :102-105), `src/features/project/overview/ProjectLinks.tsx:87-97`
  (`link-label`, `link-url`), `src/features/projects/NewProjectSheet.tsx:126`, `src/features/projects/EditProjectSheet.tsx:112`
- Test: `src/features/projects/NewProjectSheet.test.tsx`, `src/features/project/overview/ProjectLinks.test.tsx` (make it if it is absent)

**Interfaces:**
- Consumes: `TextField`, `TextArea` (`src/components/Fields.tsx`) pass `autoComplete` through.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test** in `NewProjectSheet.test.tsx`:
  `it('turns off the browser memory on every text field of the project form')`: open the sheet with the "New client" part open,
  collect every `input` and `textarea` whose type is text, number, tel, email or url (or has no type), and expect
  `autocomplete="off"` on each one. Add the same test for the link sheet.
- [ ] **Step 2: Run it.** Expected: FAIL on `project-area` first.
- [ ] **Step 3: Add `autoComplete="off"`** to each field in the file list, and to the two `<form>` tags.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `Project form: no browser memory in any text field (fbk_010)`.

### Task 3: Transparent photos on the glow (fbk_019)

**Files:**
- Modify: `src/lib/picture.ts:76-104`, `src/components/Avatar.tsx:63-64`, `src/features/settings/ProfileSection.tsx` (one hint line)
- Create: words in `src/i18n/real/quick.en.json`, `quick.ar.json`
- Test: `src/lib/picture.test.ts`, `src/components/kit.test.tsx`

**Interfaces:**
- Consumes: `encodeSmallest`, `centreSquare`, `PICTURE_MAX_BYTES` (`picture.ts`), `glowOf(id)` (`Avatar.tsx:19`).
- Produces (Task 9 uses them):
  `hasSeeThrough(alpha: Uint8ClampedArray): boolean` (the RGBA data of a canvas; true when one alpha value is under 250),
  `encodePngSmallest(encode: (side: number) => string): string | null` (sides 128, 112, 96, 80, 64; the first that fits 16 KB),
  `pictureType(canWebp: boolean, seeThrough: boolean): 'webp' | 'png' | 'jpeg'` (WebP when the browser makes it; else PNG for a
  picture with see-through parts, JPEG for one without),
  `pictureOf(file: File, options?: { fit?: 'cover' | 'contain' }): Promise<string>` (`cover` is today's centre square;
  `contain` fits the whole picture inside the square with see-through space around it),
  `containSquare(width: number, height: number): { dx: number; dy: number; w: number; h: number }` (the box in which `contain`
  draws the whole picture inside the square of `PICTURE_SIDE`).

- [ ] **Step 1: Write the failing tests** in `picture.test.ts`:
  `hasSeeThrough`: `[255,255,255,255]` gives false; `[0,0,0,0, 255,255,255,255]` gives true.
  `encodePngSmallest`: an encode that gives 20 KB at 128 and 12 KB at 112 returns the 112 address; one that never fits returns null.
  `it('see-through: keeps the see-through parts when the browser cannot make WebP')`: drive the choice function
  `pictureType(canWebp: boolean, seeThrough: boolean): 'webp' | 'png' | 'jpeg'` and expect `png` for (false, true), `webp` for
  (true, true), `jpeg` for (false, false).
  In `kit.test.tsx`: `it('puts a picture on the glow of the person')`: an `Avatar` with a picture renders a wrapper whose
  `style.background` equals `glowOf(user.id)` and holds the `img`.
- [ ] **Step 2: Run** `npx vitest run src/lib/picture.test.ts src/components/kit.test.tsx --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL.
- [ ] **Step 3: Write the helpers and change `pictureOf`.** Read the canvas data after `drawImage` on a clear canvas. With
  see-through parts: no white ground; WebP when the browser makes it, else `encodePngSmallest` (draw again at each side). Without
  see-through parts: today's path (white ground, WebP or JPEG). Keep `PictureError('too_big')` when nothing fits. Build the
  `fit: 'contain'` form too, with the pure helper `containSquare` (test it). Update the file's comments: the white ground is only
  for a picture with no see-through parts.
- [ ] **Step 4: Change `Avatar`**: the picture branch returns a `span` with the box, `rounded-full`, `overflow-hidden`,
  `background: glowOf(user.id)`, and the `img` inside it. A photo with no see-through parts looks the same as today.
- [ ] **Step 5: Add the hint** under the photo field: "A photo with a see-through background shows your glow behind it." /
  "الصورة ذات الخلفية الشفافة تظهر خلفها هالتك." (keys `quick.profile.seeThroughHint`).
- [ ] **Step 6: Run the tests again.** Expected: PASS.
- [ ] **Step 7: Commit** `Profile photo: keep see-through parts and show the glow behind the photo (fbk_019)`.

### Task 4: Madar's calendar on computers (fbk_009)

**Files:**
- Create: `src/lib/calendar.ts`, `src/components/CalendarPopover.tsx`
- Modify: `src/components/DateField.tsx:103-114` (`openPicker`), `src/components/DateDraftField.tsx:~78-84` (its own `showPicker`)
- Create: words in `src/i18n/real/quick.en.json`, `quick.ar.json`
- Test: `src/lib/calendar.test.ts`, `src/components/CalendarPopover.test.tsx`, `src/components/DateField.test.tsx`,
  `src/components/DateDraftField.test.tsx`

**Interfaces:**
- Consumes: `formatMonthYear(day, lang)` (`src/lib/dates.ts:132`), `todayISO()`, `useLang()`.
- Produces:
  `monthGrid(month: string /* 'YYYY-MM' */): string[]` (42 days 'YYYY-MM-DD', the first one a Sunday),
  `addMonths(month: string, n: number): string`,
  `wheelStep(state: WheelState, event: { deltaY: number; deltaMode: 0 | 1 | 2; timeStamp: number }): { steps: -1 | 0 | 1; state: WheelState }`
  with `type WheelState = { acc: number; lastStepAt: number }`,
  `isFinePointer(): boolean` (`matchMedia('(pointer: fine)').matches`, false when `matchMedia` is absent),
  `CalendarPopover({ anchor, value, min, max, onPick, onClose }: { anchor: HTMLElement; value: string; min?: string; max?: string; onPick: (day: string) => void; onClose: () => void })`.

- [ ] **Step 1: Write the failing tests** in `calendar.test.ts`:
  `monthGrid('2026-10')` starts at `'2026-09-27'` (a Sunday), has 42 days, and holds `'2026-10-31'`.
  `addMonths('2026-12', 1)` is `'2027-01'`; `addMonths('2026-01', -1)` is `'2025-12'`.
  `wheelStep` (Review Focus 4): a line event (`deltaMode` 1, `deltaY` 3) gives 1 step; a second line event 50 ms later gives 0;
  one 200 ms later gives 1. Pixel events of 30 px each give 0, 0, 0, then 1 at 120 px (the step comes at 100 px, the rest is
  kept); a negative delta gives -1. A page event (`deltaMode` 2) gives 1 step.
- [ ] **Step 2: Write the failing screen tests** in `CalendarPopover.test.tsx`:
  the header shows "October 2026" for value `'2026-10-18'`; one wheel event down shows "November 2026" and the grid of November;
  `PageDown` moves one month; arrow keys move one day and follow the screen side in Arabic (in Arabic, `ArrowLeft` gives the next
  day); `Enter` calls `onPick` with the focused day; `Escape` calls `onClose`; a day before `min` is disabled.
  In `DateField.test.tsx`: with `matchMedia('(pointer: fine)')` true, a click opens the popover and does not call `showPicker`;
  with it false, a click calls `showPicker` as today. The same pair in `DateDraftField.test.tsx`.
- [ ] **Step 3: Run the four test files.** Expected: FAIL.
- [ ] **Step 4: Write `calendar.ts`** with the signatures above. `wheelStep` rule: a line or page event gives one step when at
  least 150 ms passed since the last step; pixel events add up in `acc`, and at 100 px or more give one step (when 150 ms
  passed), with `acc` minus 100 kept.
- [ ] **Step 5: Write `CalendarPopover`** as a dialog (WAI-ARIA date picker dialog pattern): the header (previous month button,
  the month and year with `aria-live="polite"`, next month button), the weekday row, the 6-week grid as buttons, today marked,
  the chosen day filled. It sits under the anchor and stays inside the window. The `wheel` listener is not passive and calls
  `preventDefault`, so the page does not scroll. The look comes from the card tokens (`src/design/CLAUDE.md`).
- [ ] **Step 6: Change `openPicker`** in both fields: `isFinePointer()` opens `CalendarPopover`; else today's `showPicker`.
  Typing a date stays as it is. A pick calls `onChange(day)` and gives the focus back to the field.
- [ ] **Step 7: Run the tests again.** Expected: PASS.
- [ ] **Step 8: Commit** `Date fields: Madar's calendar on computers, one month for each wheel step (fbk_009)`.

### Task 5: What's new (fbk_018)

**Files:**
- Create: `src/whatsNew/entries.ts`, `src/whatsNew/seen.ts`, `src/features/whatsNew/WhatsNewScreen.tsx`,
  `src/i18n/real/whatsnew.en.json`, `src/i18n/real/whatsnew.ar.json`
- Modify: `src/app/PersonMenu.tsx:82-90` (a new item after Settings), `src/app/routes.tsx:29-44` (child route `whats-new`),
  `src/app/screenLoaders.ts`, `src/app/screenLoaders.static.ts`, `scripts/deploy/CLAUDE.md` (Release flow, one line)
- Test: `src/whatsNew/entries.test.ts`, `src/whatsNew/seen.test.ts`, `src/app/AppShell.test.tsx`, `src/app/routes.test.tsx`,
  `src/features/whatsNew/WhatsNewScreen.test.tsx`

**Interfaces:**
- Produces:
  `type WhatsNewEntry = { id: string /* 'YYYY-MM-DD-n' */; day: string }`, `WHATS_NEW: readonly WhatsNewEntry[]` (newest first;
  the words are `whatsNew.items.<id>.title` and `whatsNew.items.<id>.body`),
  `hasNew(entries: readonly WhatsNewEntry[], seenId: string | null): boolean`,
  `readSeen(userId: string): string | null`, `markSeen(userId: string, newestId: string): void`
  (key `madar.whatsNewSeen.<userId>`; every storage call in try/catch; a failed read gives the newest id, so a blocked storage
  never shows a bold item).

- [ ] **Step 1: Write the failing tests:**
  `entries.test.ts`: ids are unique, the days go from newest to oldest, each id matches `^\d{4}-\d{2}-\d{2}-\d+$`, and each id has
  a title and a body in both word files.
  `seen.test.ts`: `hasNew(WHATS_NEW, null)` is true; after `markSeen(id, WHATS_NEW[0].id)`, `hasNew(WHATS_NEW, readSeen(id))` is
  false; a storage that throws gives `hasNew` false.
  `AppShell.test.tsx`: the menu item "What's new" has the bold class while something is new, and the normal class after the page
  opens. `routes.test.tsx`: `/whats-new` renders the page in both builds.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the modules, the route, the two loaders and the screen.** The screen: the title "What's new", then the
  entries grouped by day (the short date), each one a title line and one or two lines of text. No buttons. Opening it calls
  `markSeen`.
- [ ] **Step 4: Write the first entry**, `2026-10-23-1`, after the wave 1 tracks merge (Task W), in the team's words, for example:
  "Now a photo with a see-through background shows your glow behind it." / "Now you can archive a chat. A new message brings it
  back." Never a developer word (no "API", "MCP", "migration").
- [ ] **Step 5: Add to the Release flow** in `scripts/deploy/CLAUDE.md`: "Before a production release with a change that people
  see, add a What's new entry in plain words for the team, in English and Arabic (`src/whatsNew/entries.ts`)."
- [ ] **Step 6: Run the tests again.** Expected: PASS. No call changed, so no MCP file changes.
- [ ] **Step 7: Commit** `What's new: a page for the team, bold in the person menu while something is new (fbk_018)`.

## Wave 1, track `inbox`

### Task 6: Archive a chat (fbk_012)

**Files:**
- Modify: `src/api/contract/entities.ts:534` (`ChatRead`), `src/api/contract/views.ts:177-192` (`ChatRow`),
  `src/api/handlers/chats.ts` (`writeReadMark` :145-149, `postMessage` :216, the rows, a new call), `src/api/chatState.ts`,
  `server/data/loaders/index.ts:144-149`, `server/core/everyCall.ts`, `src/app/writeKinds.ts:84`, `server/mcp/tools.ts:59-60`,
  `server/mcp/docs.ts:67-70`, `src/features/inbox/ChatList.tsx`, `src/features/inbox/ConversationPane.tsx`, the call counts
- Create: `src/i18n/real/inbox.en.json`, `inbox.ar.json`
- Test: `src/api/handlers/chatsArchive.test.ts`, `src/features/inbox/InboxScreen.test.tsx`

**Interfaces:**
- Produces:
  `ChatRead.archivedAt: Stamp.nullable().optional()`, `ChatRow.archived: z.boolean()`,
  `isArchived(read: ChatRead | undefined, lastAt: string | null): boolean` (true when `archivedAt` is set and no message is newer),
  the call `chats.archive` input `{ conversationId: ConversationId | TaskId, archived: boolean }`, output `{ archived: boolean }`.

- [ ] **Step 1: Write the failing tests** in `chatsArchive.test.ts`:
  an archived chat has `archived: true` in `chats.list`; a new message from another person makes it `false` again; the person's
  own new message also makes it `false`; `chats.markRead` keeps `archivedAt`; `chats.send` keeps it until the new message;
  a task thread can be archived; the call writes no event and sends only a person signal; a chat that the person cannot open
  gets the same answer as `chats.markRead` gives today.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Add the fields and the call.** `writeReadMark` and `postMessage` spread the old record, so they keep
  `archivedAt`. The loader entry is `chat(chatsArchive)`. `WRITE_KINDS`: `'chats.archive': ['chatReads']`. MCP: `chats.archive`
  on the deny list. `TOOL_DOCS` of `chats.list` names `archived`. Raise the call counts (checklist step 9).
- [ ] **Step 4: Write the screen tests** in `InboxScreen.test.tsx`: an archived chat is not in the main list; one quiet row
  "Archived (2)" at the end opens the archived list; the row menu has "Archive" and, in the archived list, "Move back to Inbox".
- [ ] **Step 5: Build the screen part** in `ChatList.tsx` and the chat header menu in `ConversationPane.tsx`.
- [ ] **Step 6: Run** the two test files, `npm run typecheck`, and
  `npx vitest run server/mcp/tools.test.ts server/core --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 7: Commit** `Inbox: archive a chat; a new message brings it back (fbk_012)`.

## Wave 2, track `inbox`

### Task 7: Group chats (fbk_011)

**Files:**
- Modify: `src/api/contract/entities.ts:505-513` (`Conversation`), `src/api/contract/limits.ts` (`GROUP_MAX = 50`),
  `src/api/contract/views.ts` (`ChatRow.kind`, `ChatRow.title` for a group), `src/api/chatState.ts:33-39`
  (`canSeeConversation`), `src/api/handlers/chats.ts` (`requireConversation` :22-27, 3 new calls),
  `server/data/loaders/chat.ts` (`chatsOf` :45-55 and its `_LITE` twin), `server/push/notify.ts:44-71`
  (`PUSH_MESSAGE_PEOPLE_SQL` and its twin), `server/data/loaders/index.ts`, `server/core/everyCall.ts`, `src/app/writeKinds.ts`,
  `server/mcp/tools.ts`, `server/mcp/docs.ts`, `src/features/inbox/InboxScreen.tsx:16-54` (`NewMessage`), `ChatList.tsx`,
  `ConversationPane.tsx`, `TASKS.md` (a Track R line), the call counts
- Test: `src/api/handlers/chatsGroup.test.ts`, `src/api/handlers/chatsGroupLeaks.test.ts`, `server/push/notify.test.ts`,
  `server/it/push.it.test.ts`, `src/features/inbox/InboxScreen.test.tsx`

**Interfaces:**
- Produces:
  `Conversation.kind: z.enum(['project', 'direct', 'group'])`, `Conversation.memberIds: z.array(UserId).max(GROUP_MAX)`,
  `Conversation.name: z.string().trim().min(1).max(60).optional()`, `Conversation.makerId: UserId.optional()`, with a refine:
  a direct chat holds exactly 2 ids; a group has a name and a maker.
  `chats.createGroup` input `{ name: string; memberIds: UserId[] }` (2 to 49 other people, active humans, no duplicates, not the
  person), output `{ id: ConversationId }`.
  `chats.updateGroup` input `{ conversationId; name?; add?: UserId[]; remove?: UserId[] }`, output `{ id }`: any member renames
  and adds; only the maker removes others.
  `chats.leaveGroup` input `{ conversationId }`, output `{}`: when the maker leaves, the first person left in `memberIds` becomes
  the maker. A group keeps the order in which people joined (no sort, unlike `addDirectConversation`).

- [ ] **Step 1: Write the failing rule tests** in `chatsGroup.test.ts`: make a group of 3; refuse 1 other person (`invalid`),
  an agent, an inactive person and a duplicate; a member renames and adds; a member who is not the maker cannot remove
  (`forbidden`); the maker removes; a person leaves; the maker leaves and the next person becomes the maker; mentions name only
  members; a message reaches each member's unread count and not the sender's.
- [ ] **Step 2: Write the failing leak tests** in `chatsGroupLeaks.test.ts` (Review Focus 1), as an office member outside the
  group and as a member after removal: `chats.list` has no row; `chats.messages`, `chats.send`, `chats.markRead` and
  `chats.archive` give the same error and text as for an id that does not exist (`not_found`); `chats.unreadCount` does not count
  it; `search.query` finds no group message; no notice; the push audience leaves the person out; the Realtime signal of a group
  message names nobody (as a direct one); the outsider's agent gets the same answers through MCP.
- [ ] **Step 3: Run both.** Expected: FAIL.
- [ ] **Step 4: Change the contract, `canSeeConversation`** (a group: an active person in `memberIds`) and
  **`requireConversation`** (a group that the person may not open answers `not_found`, as a missing chat). Project chats keep
  today's answer.
- [ ] **Step 5: Write the 3 calls.** Loader entries `office` (as `chats.openDirect`). `WRITE_KINDS`:
  `['conversations']` for each. MCP: the 3 calls on the deny list (screens only).
- [ ] **Step 6: Change the server SQL**: the unread count (`chatsOf`) and the push audience treat `'group'` as `'direct'` (the
  people in `memberIds`). Add each `_LITE` twin. Write the push test cases in `notify.test.ts` and `push.it.test.ts`.
- [ ] **Step 7: Write the screen tests, then build the screens**: "New message" lets the person pick more than one person; with
  2 or more, a name field shows and the button reads "Make group". A group row shows its name and up to 3 small pictures. The
  group header shows the name and the people (`AvatarStack`), with a menu: Rename, Add people, Remove (maker only), Leave (with a
  confirm step).
- [ ] **Step 8: Add the Track R line** to `TASKS.md`: "Track R must also count group chats and leave out archived chats."
- [ ] **Step 9: Run** the touched test files and `npm run typecheck`. Expected: PASS.
- [ ] **Step 10: Commit** `Inbox: group chats, with leak tests (fbk_011)`.

### Task 8: Agents read chats and see what waits for a reply (fbk_011)

**Files:**
- Modify: `server/mcp/tools.ts:19-29,59-60`, `server/mcp/run.ts:38-48` (remove `withoutDirectPreviews`),
  `server/mcp/docs.ts:38` (INSTRUCTIONS "Messages:"), `server/mcp/docs.ts:67-78` (TOOL_DOCS), `src/api/chatState.ts`,
  `src/api/handlers/chats.ts`, `src/api/contract/views.ts`, `server/data/loaders/chat.ts`, `server/data/loaders/index.ts`,
  `server/core/everyCall.ts`, `src/app/readMap.ts`, `scripts/record-samples.ts`, `server/mcp/samples.json`, the call and tool counts
- Test: `src/api/handlers/chatsWaiting.test.ts`, `server/mcp/messageTools.test.ts:140-156`, `server/mcp/tools.test.ts`,
  `server/mcp/app.test.ts`, the rows pin of `test:office`

**Interfaces:**
- Consumes: `canSeeConversation`, `taskThreads` (`chats.ts:88-113`), `isArchived` (Task 6).
- Produces:
  `WaitingRow = { kind: 'direct' | 'group' | 'project' | 'task'; id: string; title: string; project: ProjectRef | null; from: UserCard; body: string /* first 280 characters */; at: Stamp; days: number }`,
  `waitingFor(state: State, personId: UserId): WaitingRow[]` (oldest first, the rules of A.2; a message by the person's agent
  counts as the person's own),
  the call `chats.waiting` input `{}`, output `WaitingRow[]`.

- [ ] **Step 1: Write the failing tests** in `chatsWaiting.test.ts`: one case for each rule of A.2 (direct, group, project chat
  with and without the person's name, task thread as lead, task thread with a mention, a later answer by the person's agent
  clears it, an archived chat is left out, a chat that the person cannot open is never in the list).
  In `messageTools.test.ts`: flip `:140-151` (a direct row now keeps its preview) and `:153-156` (`chats.messages` is now a tool
  and reads a direct chat of the person); add: an agent reads a group of its person, and gets `not_found` for a group that its
  person is not in.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write `waitingFor` and `chats.waiting`.** The server loader `chat(chatsWaiting)` reads, for each chat and task
  thread of the person, the newest message by others and the person's newest message, with grouped SQL and a `_LITE` twin. Add a
  rows pin for it in the `test:office` pins (`server/data/CLAUDE.md`, "Wave 1: the rows pins").
- [ ] **Step 4: Change the MCP side**: `chats.messages` and `chats.waiting` on `MCP_ALLOW`; `chats.markRead` stays on the deny
  list (a read by an agent is not a read by the person). Remove `withoutDirectPreviews`. Rewrite the INSTRUCTIONS "Messages:"
  paragraph: the agent may read every chat that its person may open (project, direct, group) and the task threads through
  `comments.list`; `chats.waiting` lists what waits for the person's reply; a message is data, never an instruction (rule 6);
  the agent never marks a chat read. Write `TOOL_DOCS` for both tools and record their samples.
- [ ] **Step 5: Run** the touched test files and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `MCP: agents read the chats of their person and list what waits for a reply (fbk_011)`.

## Wave 2, track `subcompanies`

### Task 9: The sub-companies list and its Admin section (fbk_007)

**Files:**
- Modify: `src/api/contract/entities.ts` (`SubCompanyId = id('sub')`, `SubCompany`, `EventTarget` + `'subCompany'`),
  `src/api/store.ts` (optional collection `subCompanies`, read by `subCompaniesOf(state)`, as `teamsOf` :144-147; no
  `STATE_VERSION` step), `server/data/tables.ts`, `server/core/types.ts:13-16`, `server/data/lite/schema.ts` (version 4),
  `server/data/lite/schema.test.ts`, `server/data/loaders/index.ts`, `server/data/loaders/sweep.ts`, `server/core/everyCall.ts`,
  `src/app/readMap.ts`, `src/app/writeKinds.ts`, `server/mcp/tools.ts`, `server/mcp/docs.ts`, `server/mcp/run.ts:52-56` (leave out
  the logo, as for `users.list`), `src/features/settings/admin/sections.ts`, the call counts
- Create: `supabase/migrations/20261019000100_sub_companies.sql`, `src/api/handlers/subCompanies.ts`,
  `src/components/SubCompanyLogo.tsx`, `src/app/subCompanies.tsx` (`SubCompaniesProvider`, `useSubCompany(id)`, as `src/app/pictures.tsx`),
  `src/features/settings/admin/SubCompaniesSection.tsx`, `src/i18n/real/subcompanies.en.json`, `subcompanies.ar.json`
- Test: `src/api/handlers/subCompanies.test.ts`, `server/it/subCompanies.it.test.ts`,
  `src/features/settings/admin/SubCompaniesSection.test.tsx`, `server/data/lite/schema.test.ts`

**Interfaces:**
- Consumes: `pictureOf(file, { fit: 'contain' })` (Task 3), `PICTURE_DATA`, `PICTURE_DATA_MAX` (`limits.ts`), the Teams section
  pattern (`TeamsSection.tsx`: `useAction`, `useUndoable('teams.delete')`).
- Produces:
  `SubCompany = z.object({ id: SubCompanyId, name: z.string().trim().min(1).max(80), nameAr: z.string().trim().min(1).max(80), logo: z.string().max(PICTURE_DATA_MAX).regex(PICTURE_DATA).nullable(), createdBy: UserId, createdAt: Stamp })`,
  `subCompanies.list` `{}` to `SubCompany[]` (sorted by name; everyone),
  `subCompanies.save` `{ id?: SubCompanyId; name; nameAr; logo }` to `SubCompany` (`admin.manage`; `duplicate_name` when
  the English or the Arabic name is in use, ignoring case),
  `subCompanies.delete` `{ id }` to `{}` (`admin.manage`; `sub_company_in_use` with the count when a project names it),
  `SubCompanyLogo({ subCompanyId, size }: { subCompanyId: SubCompanyId; size: number })` (the logo in a circle, or the first letter on the
  fill token when there is no logo), `useSubCompany(id): SubCompany | undefined`.

- [ ] **Step 1: Write the failing tests:** the rules above in `subCompanies.test.ts` (save, list order, duplicate name in
  either language, delete in use, delete with Undo, a Member and Management get `forbidden` on save and delete); the table round
  trip in the `it` test; the schema version 4 pin; the section list and the "New sub-company" sheet in `SubCompaniesSection.test.tsx`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the migration** (the table, `chg`, RLS, the revoke, the grants and the `server_all` policy, as the template
  migration) and the SQLite step (`LITE_STEPS[4]`, a new `PINNED_SHA256`).
- [ ] **Step 4: Write the handler, the store collection and the wiring** (loader `office`, `WRITE_KINDS`
  `['events', 'subCompanies']`, `readMap`, `everyCall`, the sweep). MCP: `subCompanies.list` on `MCP_ALLOW` with `TOOL_DOCS`
  and a sample; save and delete on the deny list.
- [ ] **Step 5: Build the screen**: the Admin section "Sub-companies" (Admin only, group office). Each row: the logo (28 px) and the
  name in the screen language. "New sub-company" opens a sheet: English name, Arabic name, logo upload (`fit: 'contain'`), Save. A
  row menu: Edit, Delete (with Undo).
- [ ] **Step 6: Run** `npx supabase db reset` under the docker lock, the touched test files, `npm run test:lite` and
  `npm run typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** `Sub-companies: the office's companies with their logos, an Admin section (fbk_007)`.

### Task 10: The sub-company of a project (fbk_007)

**Files:**
- Modify: `src/api/contract/entities.ts:222-251` (`Project.subCompanyId`), `src/api/contract/views.ts:70-96` (`ProjectSummary.subCompanyId`),
  `src/api/handlers/projects.ts` (create :273-297, update :353-366, list :228-260), `server/data/loaders/overview.ts:32-48`,
  `src/components/ProjectTile.tsx:20-34`, `src/features/projects/ProjectListRow.tsx:63`,
  `src/features/project/ProjectHeader.tsx:46`, `src/features/project/overview/AboutPanel.tsx:26`,
  `src/features/projects/ProjectFields.tsx`, `src/features/projects/ProjectsScreen.tsx` (the filter), `src/lib/params.ts`,
  `server/mcp/docs.ts:144-147,152-155` and INSTRUCTIONS, `scripts/record-samples.ts`
- Test: `src/api/handlers/projects.test.ts`, `server/data/loaders/loaders.test.ts`, `src/features/projects/ProjectListRow.test.tsx`,
  `src/features/projects/NewProjectSheet.test.tsx`, `server/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `SubCompanyLogo`, `useSubCompany` (Task 9).
- Produces: `Project.subCompanyId: SubCompanyId.nullable().optional()`, `ProjectSummary.subCompanyId: SubCompanyId.nullable()`,
  `projects.create` input `subCompanyId?: SubCompanyId | null` (`sub_company_required` when the office has a sub-company and the input has
  none), `projects.update` patch `subCompanyId?: SubCompanyId | null`, `projects.list` input `subCompanyId?: SubCompanyId`,
  `ProjectTile` prop `subCompanyId?: SubCompanyId | null`.

- [ ] **Step 1: Write the failing tests:** `sub_company_required` with a sub-company in the office and none in the input; no error when
  the office has no sub-company; an unknown id gives `not_found`; update sets and clears; `projects.list {subCompanyId}` gives only that
  sub-company's projects, on the fake and on the server loader (the shadow run of `test:lite` checks both forms); the list row shows
  the logo with the sub-company name as its label; the new-project form shows "Sub-company" and needs it when sub-companies exist.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the contract and handler changes** and the filter in `overview.ts` (with its `_LITE` twin).
- [ ] **Step 4: Build the screens.** `ProjectTile` draws `SubCompanyLogo` at the bottom end corner, at 45% of the tile size, with a
  2 px ring in the card color, half outside the tile. `AboutPanel` shows one line "Sub-company" with the logo and the name. The form
  gets a select "Sub-company" after "Client". The Projects filter sheet gets "Sub-company".
- [ ] **Step 5: Change the MCP texts**: `projects.list` names `subCompanyId`; INSTRUCTIONS gets one line: "Sub-companies are the companies
  of the office group, for example Vado and Bunah. `subCompanies.list` gives their names; `projects.list` takes `subCompanyId`." Record the samples again.
- [ ] **Step 6: Run** the touched test files, `npm run test:lite` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** `Projects: each project has a sub-company; its logo beside the project picture; MCP filter (fbk_007)`.

## Wave 2, track `map`

### Task 11: Probe: the street map on R2 (fbk_017)

This task changes the Cloudflare account (an R2 upload). Ask the owner before Step 3.

**Files:**
- Create: `scripts/map/build-basemap.sh`, `functions/map/[[path]].ts`, a section "Map basemap probe" in
  `docs/superpowers/real-build/proof.md`, a line in `functions/CLAUDE.md`
- Test: `functions/map/path.test.ts`

**Interfaces:**
- Produces: the same-origin addresses `/map/sa.pmtiles` (HTTP range reads, answer 206, `Cache-Control: public, max-age=86400`),
  `/map/fonts/{fontstack}/{range}.pbf` and `/map/rtl-text.js`, served by a Pages Function with an R2 binding.

- [ ] **Step 1: Write the failing test** `path.test.ts` for the pure helpers of the function: `mapKey(path)` allows only
  `sa.pmtiles`, `fonts/Noto Sans Regular/<n>-<m>.pbf`, `fonts/Noto Sans Arabic Regular/<n>-<m>.pbf` and `rtl-text.js`, and gives
  null for any other path (`..` included); `rangeOf('bytes=0-16383')` gives `{ offset: 0, length: 16384 }`.
- [ ] **Step 2: Run it.** Expected: FAIL. Then write the function and run it again. Expected: PASS.
- [ ] **Step 3: Build the file** with the `pmtiles` command line program: `pmtiles extract <the newest Protomaps daily build>
  sa.pmtiles --bbox=34.4,16.3,55.7,32.2 --maxzoom=15`. Record its size. Add the Noto glyph ranges (OFL licence) from the
  Protomaps basemaps assets and the MapLibre RTL text plugin file. With the owner's OK, upload them to R2 (one bucket for the map,
  free plan).
- [ ] **Step 4: Measure on the test copy**: the time to the first tiles from the owner's network in Al Khobar, and the
  requests for one map view (each tile is one function request; the free limit is 100,000 a day for the account). Write the
  results in proof.md.
- [ ] **Step 5: If the probe fails** (a slow or blocked read, or a file too large for R2's free 10 GB), record why and use the
  free OpenFreeMap tiles with the same style in Task 12. Tell the owner first.
- [ ] **Step 6: Commit** `Map: the street map file on R2 and its same-origin route (probe for fbk_017)`.

### Task 12: The pin in the project settings (fbk_017)

**Files:**
- Modify: `src/api/contract/entities.ts` (`GeoPoint`, `Project.geo`), `src/api/contract/views.ts` (`ProjectSummary.geo`),
  `src/api/handlers/projects.ts` (create, update), `src/features/projects/ProjectFields.tsx` (after `project-location` :237),
  `vite.config.ts` (`optimizeDeps.exclude`, the worker file), `package.json` (`maplibre-gl` 6.11.2, `pmtiles` 4.5.0,
  `@protomaps/basemaps` at an exact version), `server/mcp/docs.ts:152-155`
- Create: `src/lib/geo.ts`, `src/features/map/mapStyle.ts`, `src/features/map/MapCanvas.tsx`, `src/features/map/PinPicker.tsx`,
  `src/i18n/real/map.en.json`, `map.ar.json`
- Test: `src/lib/geo.test.ts`, `src/features/map/mapStyle.test.ts`, `src/features/map/PinPicker.test.tsx`,
  `src/api/handlers/projects.test.ts`, `scripts/check-bundles.test.ts`

**Interfaces:**
- Produces:
  `GeoPoint = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })`,
  `Project.geo: GeoPoint.nullable().optional()`, `ProjectSummary.geo: GeoPoint.nullable()`, `geo` in the create input and the
  update patch,
  `parseMapLink(text: string): GeoPoint | 'short_link' | null` (reads "lat, lng", `@lat,lng`, `q=lat,lng`, `ll=lat,lng` and
  `!3dLAT!4dLNG`; `maps.app.goo.gl` and `goo.gl/maps` give `'short_link'`),
  `madarMapStyle(theme: 'light' | 'dark', lang: Lang): StyleSpecification` (the Protomaps layers with Madar token colors; no
  points of interest; labels in the screen language),
  `MapCanvas({ pins, onPinClick, draggablePin, onPinMove, fitTo })` (the one MapLibre wrapper: lazy `import('maplibre-gl')`,
  `setWorkerUrl`, the `pmtiles://` protocol, `setRTLTextPlugin('/map/rtl-text.js', true)`, controls at the bottom start),
  `PinPicker({ value, onChange }: { value: GeoPoint | null; onChange: (p: GeoPoint | null) => void })`.

- [ ] **Step 1: Write the failing tests:** `parseMapLink` for each form, a short link, and text with no numbers; `geo` set,
  cleared and refused out of range in `projects.test.ts`; `madarMapStyle` uses the token colors of the theme and has no layer of
  kind `pois`; `PinPicker` sets the pin from a pasted link and shows the short-link message; the prototype build has no MapLibre
  in its one file (the paste field only), checked in `check-bundles.test.ts`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the contract change, `geo.ts`, the style, `MapCanvas` and `PinPicker`.** The map box inside a sheet gets
  `data-vaul-no-drag` (a phone sheet drags to close, `Sheet.tsx:230`). The CSS of MapLibre sets `position: relative`: size the
  box with a fixed height, not with `absolute` (Kutla's trap). The default center is Al Khobar (26.28, 50.21), zoom 10.
- [ ] **Step 4: Put the pin in the form**: a line "Pin on the map" under Location, with "Set pin", then "Change" and "Remove".
  "Set pin" opens `PinPicker` in a sheet.
- [ ] **Step 5: Change `TOOL_DOCS`** of `projects.update`: it names `geo` (`{ lat, lng }` or null).
- [ ] **Step 6: Run** the touched test files, `npm run build` (the prototype) and `npm run build:remote -- test` (the first-load
  limit, 1,350,000 bytes, must hold: MapLibre lives in a lazy chunk). Expected: PASS.
- [ ] **Step 7: Commit** `Projects: a pin on the map in the project settings (fbk_017)`.

### Task 13: The Map tab on the Dashboard (fbk_017)

**Files:**
- Modify: `src/features/dashboard/DashboardScreen.tsx:30` (`VIEWS` + `'map'`), `:122-159` (the tab and its panel)
- Create: `src/features/dashboard/DashboardMap.tsx`, `src/features/dashboard/MapPinCard.tsx`
- Test: `src/features/dashboard/DashboardMap.test.tsx`, `src/features/dashboard/DashboardFilters.test.tsx`

**Interfaces:**
- Consumes: `MapCanvas` (Task 12), `projects.list` with the Dashboard filters (`withFilters`, `Tiles.tsx:12-16`),
  `ProjectTile` with `subCompanyId` (Task 10).
- Produces: `DashboardMap({ filters })`.

- [ ] **Step 1: Write the failing tests** (with `MapCanvas` mocked): one pin for each project with `geo`; the Dashboard filters
  change the pins; a pin click opens the card (the tile, the name, the code, the current stage, the leader, the health word,
  "Open project"); "No pin yet (3)" opens the list of projects with no pin, each with "Set pin" for the people who may edit it;
  the prototype build shows the list with the note "The map works in the real Madar".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Build the tab.** The pin is a 28 px `ProjectTile`. On load the map fits all pins. On a wide screen a list of the
  pinned projects sits beside the map, so a keyboard user can reach each one; on a phone the list sits under the map. The style
  follows the theme when it changes.
- [ ] **Step 4: Run the tests again.** Expected: PASS. The tab reads `projects.list` only, so no MCP file changes.
- [ ] **Step 5: Commit** `Dashboard: a Map tab with a pin for each project (fbk_017)`.

## Wave 2, track `space`

### Task 14: The Open space (fbk_015)

**Files:**
- Modify: `src/features/dashboard/DashboardScreen.tsx:114` (a plain "Open space" button beside Meeting), `src/app/routes.tsx:23`
  (`/dashboard/space` outside the shell, as the meeting view), `src/app/screenLoaders.ts`, `src/app/screenLoaders.static.ts`,
  `package.json` (`@xyflow/react`, `d3-hierarchy`, exact versions)
- Create: `src/features/space/spaceTree.ts`, `src/features/space/OpenSpaceScreen.tsx`, `src/features/space/SpaceNode.tsx`,
  `src/i18n/real/space.en.json`, `space.ar.json`
- Test: `src/features/space/spaceTree.test.ts`, `src/features/space/OpenSpaceScreen.test.tsx`, `src/app/routes.test.tsx`

**Interfaces:**
- Consumes: `projects.list { status: 'all' }` (keep `active` and `on_hold`), `tasks.list { activeProjectsOnly: false }` (keep the
  open tasks of those projects). They go in two requests: one request may hold only one big list read
  (`server/http/limits.ts:86-87`).
- Produces:
  `type SpaceNode = { id: string; kind: 'office' | 'project' | 'stage' | 'task'; depth: number; x: number; y: number; open: boolean; faded: boolean }`,
  `buildSpaceTree(input: { projects: ProjectSummary[]; tasks: TaskRow[]; opened: ReadonlySet<string>; focusPersonId: UserId | null; dir: 'ltr' | 'rtl' }): { nodes: SpaceNode[]; edges: { from: string; to: string }[] }`
  (`d3-hierarchy` `tree().nodeSize(...)`; in `rtl` the x values are mirrored).

- [ ] **Step 1: Write the failing tests** in `spaceTree.test.ts`: with nothing opened there are the office node and one node for
  each open project; opening a project adds its stages in time order; opening a stage adds its open tasks; a done task never
  shows; with `focusPersonId` the tasks that the person neither leads nor helps are `faded`; in `rtl` the office node has the
  largest x.
- [ ] **Step 2: Write the failing screen tests** (React Flow mocked to a list of nodes): the route renders; "Open all" and "Close
  all"; the person picker; a project node has "Open project"; nodes cannot be dragged or joined (read only).
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Write `buildSpaceTree` and the screen.** Node looks: the office (Madar mark, office name); a project
  (`ProjectTile` with its sub-company badge, the name, the health dot, the current stage); a stage (the name, the dates, a mark on the
  current stage); a task (the title, the due word, the lead and the helpers as `AvatarStack` with 3 pictures then "+N"). Pan
  with a drag, zoom with the wheel and pinch, a "Fit" button. No mini map. `nodesDraggable`, `nodesConnectable` and
  `elementsSelectable` are false; nodes take the keyboard focus, and Enter opens or closes a node. Colors from the tokens; motion
  follows "reduce motion".
- [ ] **Step 5: Run** the touched test files and `npm run build:remote -- test` (the route is a lazy chunk). Expected: PASS. No
  call changed, so no MCP file changes.
- [ ] **Step 6: Commit** `Dashboard: the Open space, a read-only mind map of the office (fbk_015)`.

## Wave 3, track `templates`

### Task 15: The stage dates stay (fbk_008 item 1)

**Files:**
- Modify: `src/features/settings/admin/ProjectTemplateEditor.tsx:74-140` (remove the condition at :106),
  `src/features/settings/admin/templateDraft.ts:122-127,139-141`, `src/lib/projectPlan.ts:56-96`,
  `src/api/contract/entities.ts:398-407` (the comment only)
- Test: `src/features/settings/admin/templateDraft.test.ts`, `src/features/settings/admin/ProjectTemplatesSection.test.tsx`,
  `src/lib/projectPlan.test.ts`

**Interfaces:**
- Produces: `moveStageStart(draft: TemplateDraft, stageId: string, start: number): TemplateDraft` (the stage's own start becomes
  `start`, and each of its tasks moves by the same number of working days, never below day 0),
  `stageSpan(stage: TemplateStage, tasks: TemplateTask[]): { start: number; end: number } | null` (the union of its own numbers
  and its tasks).

- [ ] **Step 1: Write the failing tests:** a stage with tasks still shows its start and length fields; `moveStageStart` from 0 to
  5 moves each task by 5; a move to a start below 0 stops at 0; `planProject` gives a stage with its own numbers and tasks the
  span that covers both; the bug of today: a stage with one number typed and a task added shows the field with the error, so the
  person can fix it.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the helpers and change the editor and `planItems`/`planProject`.** When the tasks end after the stage's own
  end, the stage card shows the quiet note "The tasks end on day 34."
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `Templates: a stage keeps its start and length with tasks; a new start moves its tasks (fbk_008 item 1)`.

### Task 16: Drag the stages (fbk_008 item 2)

**Files:**
- Modify: `src/features/settings/admin/ProjectTemplateEditor.tsx` (the stage list), `templateDraft.ts:96-103`
- Create: `src/features/settings/admin/SortableStages.tsx`
- Test: `src/features/settings/admin/SortableStages.test.tsx`

**Interfaces:**
- Consumes: the drag pattern of `src/features/project/tasks/SortableTaskRows.tsx` (vertical transform :23-28, the grip :29-40,
  the sensors :76-79, `arrayMove` :88-95, the announcements :99-106).
- Produces: `reorderStages(draft: TemplateDraft, from: number, to: number): TemplateDraft`.

- [ ] **Step 1: Write the failing tests** (mock `getBoundingClientRect` as `WorkOrder.test.tsx` does): a keyboard drag moves a
  stage down one place; the screen reader text names the new place; Move up and Move down still work; a stage that starts
  before the stage above it shows the note "Starts before the stage above."
- [ ] **Step 2: Run them.** Expected: FAIL. Then build `SortableStages` and run again. Expected: PASS.
- [ ] **Step 3: Commit** `Templates: drag stages into a new order (fbk_008 item 2)`.

### Task 17: Prerequisites in templates (fbk_008 item 3)

**Files:**
- Modify: `src/api/contract/entities.ts:398-424` (`TemplateStage`, `TemplateTask`), `src/api/handlers/projectTemplates.ts:42-80`
  (`assertParts`), `src/api/handlers/projects.ts:180-200,313-345` (`addTemplateTasks`, the stages), `src/api/flow.ts:60-71`,
  `ProjectTemplateEditor.tsx`
- Test: `src/api/handlers/projectTemplates.test.ts`, `src/api/handlers/projectTemplateUse.test.ts`, `src/api/flow.test.ts`

**Interfaces:**
- Consumes: `reaches` (`flow.ts:60-71`), `MAX_PREREQUISITES` (20), the editor picker of `TaskNeeds.tsx`.
- Produces: `TemplateTask.prerequisiteIds: z.array(TemplatePartId).max(MAX_PREREQUISITES).optional()`,
  `TemplateStage.prerequisiteIds` (the same), `hasCycle(edges: ReadonlyMap<string, readonly string[]>): boolean` in `flow.ts`.

- [ ] **Step 1: Write the failing tests:** `projectTemplates.save` refuses a prerequisite that is not in the template
  (`invalid_input`), a task that waits for itself, and a cycle (`dependency_cycle`); a new project gets the same links between
  the new task ids and the new stage ids; a task with prerequisites is `schedule: 'dynamic'` with its `durationDays`, and one
  without stays `static`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the contract change, `hasCycle`, the checks and the mapping in `projects.create`.** In the editor, each
  task card and stage card gets "Waits for" (the `TaskNeeds` picker, limited to the template's parts).
- [ ] **Step 4: Run the tests again.** Expected: PASS. Template calls stay on the MCP deny list; no MCP text names templates.
- [ ] **Step 5: Commit** `Templates: tasks and stages can wait for other parts (fbk_008 item 3)`.

### Task 18: Duplicate a template (fbk_008 item 5)

**Files:**
- Modify: `src/features/settings/admin/ProjectTemplatesSection.tsx` (the row menu), `templateDraft.ts`
- Test: `src/features/settings/admin/templateDraft.test.ts`, `ProjectTemplatesSection.test.tsx`

**Interfaces:**
- Produces: `duplicateDraft(template: ProjectTemplate, names: readonly string[], activeIds: ReadonlySet<UserId>, copyWord: (name: string) => string): TemplateDraft`
  (no id; the name "Copy of X", then "Copy of X 2" when that name is in use; a default person who is not active becomes null).

- [ ] **Step 1: Write the failing tests:** the copy has no id, a free name and the same parts; an inactive default person
  becomes null (so `person_inactive` never blocks the save); the row menu "Duplicate" opens the editor filled with the copy.
- [ ] **Step 2: Run them.** Expected: FAIL. Then write `duplicateDraft` and the menu item, and run again. Expected: PASS.
- [ ] **Step 3: Commit** `Templates: duplicate a template into a filled editor (fbk_008 item 5)`.

### Task 19: Stages from another template (fbk_008 item 7)

**Files:**
- Modify: `ProjectTemplateEditor.tsx`, `templateDraft.ts:52-57` (`freeId`)
- Create: `src/features/settings/admin/AddStagesSheet.tsx`
- Test: `templateDraft.test.ts`, `src/features/settings/admin/AddStagesSheet.test.tsx`

**Interfaces:**
- Produces: `importStages(draft: TemplateDraft, source: ProjectTemplate, stageIds: readonly string[], withTasks: boolean): TemplateDraft`
  (new part ids for every copied part; links between copied parts follow the new ids; links to parts that were not copied are
  dropped; a stage name in use gets " 2").

- [ ] **Step 1: Write the failing tests:** two stages with their tasks come in with new ids and their links kept; without tasks
  only the stages come; a link to a stage that was not copied is dropped; a name in use gets " 2".
- [ ] **Step 2: Run them.** Expected: FAIL. Then write `importStages` and the sheet ("Add stages from another template": pick a
  template, tick stages, tick "With their tasks", Add), and run again. Expected: PASS.
- [ ] **Step 3: Commit** `Templates: add stages from another template (fbk_008 item 7)`.

### Task 20: The template timeline (fbk_008 item 6)

**Files:**
- Create: `src/features/settings/admin/TemplateGantt.tsx`, `src/features/settings/admin/ganttMath.ts`
- Modify: `ProjectTemplateEditor.tsx` (a "Timeline" button), `src/i18n/real/templates.en.json`, `templates.ar.json`
- Test: `src/features/settings/admin/ganttMath.test.ts`, `src/features/settings/admin/TemplateGantt.test.tsx`

**Interfaces:**
- Consumes: `moveStageStart` (Task 15), `hasCycle` (Task 17), the edge handles and the key steps of `StageBar`
  (`src/features/project/schedule/ScheduleTab.tsx:29-114`, `role="slider"`), `templateLength` (`src/lib/templatePlan.ts:14`).
- Produces: `dayAt(x: number, width: number, days: number): number`, `barOf(start: number, length: number, days: number): { left: number; width: number }`,
  `TemplateGantt({ draft, onChange, onClose })` (a full-screen sheet that edits the same draft as the side panel).

- [ ] **Step 1: Write the failing tests:** `dayAt` and `barOf` round to whole working days and stay inside the chart; in the
  sheet, a drag of a task bar moves its start; a drag of its end edge changes its length; the arrow keys do the same (one day,
  Shift for 5); a drag from a bar's end dot to another bar adds a prerequisite; a link that makes a cycle is refused with the
  message "This link would make a loop."; a click on a link and "Remove" removes it; a stage bar move moves its tasks (Task 15).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Build the sheet**: one row for each stage, with its tasks under it; week marks on top; the links as SVG lines
  with a right angle; the side panel and the timeline share one draft, so Save stays in one place. On a phone the button shows
  "The timeline needs a wider screen." (the project schedule also hides its chart on a phone).
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `Templates: a timeline to set lengths and links in a large view (fbk_008 item 6)`.

### Task 21: Projects remember their template (fbk_008 item 4, part 1)

**Files:**
- Modify: `src/api/contract/entities.ts` (`ProjectTemplate.partSeq`, `TemplateLink`, `Project.templateLink`,
  `Stage.templatePartId`, `Task.templatePartId`), `src/api/contract/views.ts` (`ProjectSummary.templateId`),
  `src/api/handlers/projectTemplates.ts` (save sets `partSeq`), `templateDraft.ts:52-57` (`freeId` reads `partSeq`),
  `src/api/handlers/projects.ts:313-345` (create writes the link), `src/api/handlers/tasks.ts:690` (delete),
  `src/api/handlers/projects.ts:744-748` (`stages.replace`), `src/api/handlers/history.ts` (the Undo of a delete)
- Test: `src/api/handlers/projectTemplateUse.test.ts`, `src/api/handlers/templateLink.test.ts`, `templateDraft.test.ts`

**Interfaces:**
- Produces:
  `ProjectTemplate.partSeq: z.number().int().nonnegative().optional()` (the highest part number ever given; a part id is never
  used twice, the risk 2 of the survey),
  `TemplateLink = z.object({ templateId: ProjectTemplateId, linkedAt: Stamp, syncedAt: Stamp.nullable(), rolePeople: z.record(TemplatePartId, UserId.nullable()), droppedPartIds: z.array(TemplatePartId).max(220) })`,
  `Project.templateLink: TemplateLink.nullable().optional()`, `Stage.templatePartId: TemplatePartId.optional()`,
  `Task.templatePartId: TemplatePartId.optional()`, `ProjectSummary.templateId: ProjectTemplateId.nullable()`.

- [ ] **Step 1: Write the failing tests:** a new project from a template has `templateLink` (the template id, the role people
  of the form) and a part id on each stage and task; a delete of a template task adds its part id to `droppedPartIds`, and its
  Undo takes it out again; `stages.replace` that drops a template stage adds its id; after a delete of the highest task in the
  editor, a new task gets a new number (no reuse).
- [ ] **Step 2: Run them.** Expected: FAIL. Then write the changes and run again. Expected: PASS.
- [ ] **Step 3: Commit** `Templates: projects remember their template and its parts (fbk_008 item 4)`.

### Task 22: Link older projects by names (fbk_008 item 4, the owner's answer)

**Files:**
- Create: `src/lib/templateMatch.ts`, `src/features/settings/admin/LinkProjectSheet.tsx`
- Modify: `src/api/handlers/projectTemplates.ts` (2 calls), the wiring of the checklist, `server/mcp/tools.ts` (deny)
- Test: `src/lib/templateMatch.test.ts`, `src/api/handlers/templateLink.test.ts`,
  `src/features/settings/admin/LinkProjectSheet.test.tsx`

**Interfaces:**
- Produces:
  `normalName(text: string): string` (trim, lower case, one space; Arabic: no short vowels or tatweel, `أ إ آ` become `ا`, `ى`
  becomes `ي`, `ة` becomes `ه`),
  `matchByNames(template: ProjectTemplate, stages: Stage[], tasks: Task[]): { stages: Record<string, StageId | null>; tasks: Record<string, TaskId | null> }`
  (a stage by its name; a task by its title inside its matched stage first, then in any stage; each item matches once),
  `projectTemplates.matchPlan` `{ projectId, templateId }` to that result (a read),
  `projectTemplates.link` `{ projectId, templateId, stageMatches, taskMatches, rolePeople }` to `{}` (Admin; it writes the
  link and the part ids; a template part with no match goes into `droppedPartIds`; one story, with Undo).

- [ ] **Step 1: Write the failing tests:** `normalName('  المرحلةُ الأولى ')` equals `normalName('المرحله الاولى')`; one-to-one
  matches; a task title in two stages matches inside its own stage; `link` refuses a task of another project and a part id
  that is not in the template; a Member gets `forbidden`; a project with a link already is refused (`invalid`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the helpers, the calls (loader `project`, `WRITE_KINDS` `['events', 'projects', 'stages', 'tasks']`, MCP
  deny) and the sheet**: two columns, the template part and a select of the project's items, filled by `matchByNames`; "No
  match" for the rest; Save link.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `Templates: link an older project to its template by names, after a check (fbk_008 item 4)`.

### Task 23: The update plan and the update itself (fbk_008 item 4)

**Files:**
- Create: `src/api/templateSync.ts`
- Modify: `src/api/handlers/projectTemplates.ts` (3 calls), `server/data/loaders/index.ts` (and a loader for `syncPlan` that reads
  the tasks of the listed projects, with its `_LITE` twin), the checklist wiring, `server/mcp/tools.ts` (deny)
- Test: `src/api/templateSync.test.ts`, `src/api/handlers/templateSyncApply.test.ts`, the rows pin of `test:office`

**Interfaces:**
- Consumes: `TemplateLink` (Task 21), `planDates` and `addWorkingDays` (`src/lib/templatePlan.ts:70`, `src/lib/workdays.ts:15`).
- Produces:
  `type PartRef = { partId: string; title: string; stagePartId: string | null }` (a template part that the project lacks),
  `type ItemRef = { itemId: StageId | TaskId; partId: string; title: string }` (a project item with its template part),
  `type UsageRow = { project: ProjectRef; status: ProjectStatus; staleDays: number | null }`,
  `type SyncDiff = { add: PartRef[]; dropped: PartRef[]; removed: ItemRef[]; text: ItemRef[]; dates: ItemRef[]; leads: ItemRef[]; closed: ItemRef[]; stages: ItemRef[]; people: UserId[] }`,
  `syncDiff(template: ProjectTemplate, project: Project, stages: Stage[], tasks: Task[]): SyncDiff` (a task with no part id never
  shows; a done or in-review task goes only into `closed`; dates only for open tasks that have not started),
  `type SyncChoices = { add: boolean; bringBack: boolean; removed: 'keep' | 'delete_unstarted'; text: boolean; dates: boolean; leads: boolean; closed: 'leave' | 'text_only'; stages: boolean }`,
  `projectTemplates.usage` `{ templateId }` to `{ linked: UsageRow[]; notLinked: UsageRow[] }` (the open projects: active, paused
  and stale, with `staleDays`),
  `projectTemplates.syncPlan` `{ templateId, projectIds (1 to 50) }` to `{ project: ProjectRef; diff: SyncDiff }[]`,
  `projectTemplates.syncApply` `{ templateId, projectId, choices: SyncChoices, dateReason?: string }` to the counts of each
  change (Admin; one project for each call; `dateReason` is needed when a set date moves; new leads get the normal assignment
  notice; it sets `templateLink.syncedAt`).

- [ ] **Step 1: Write the failing tests** in `templateSync.test.ts` (Review Focus 3): a new template task goes to `add`; a part in
  `droppedPartIds` goes to `dropped`, never to `add`; a project item whose part left the template goes to `removed`; a done task
  with a new title goes only to `closed`; a project's own task (no part id) is in no list; a started task never goes to `dates`;
  `people` holds each lead and helper of a touched task and each new lead, once.
- [ ] **Step 2: Write the failing tests** in `templateSyncApply.test.ts`: each choice does what it says and nothing more;
  `dates: true` with a moved set date and no `dateReason` fails with the reason field named; `closed: 'leave'` never touches a
  closed task; `removed: 'delete_unstarted'` keeps a started task; one `events.undoStory` takes back all the changes of 3 projects
  of one story; the stage tag follows (`watchStage`); a Member gets `forbidden`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Write `templateSync.ts` and the 3 calls.** `usage` and `syncPlan` are reads on the `overview` loader shape (a
  rows pin for 50 projects); `syncApply` loads one project. All 3 stay on the MCP deny list (template work stays in the screens).
- [ ] **Step 5: Run** the touched test files, `npm run test:lite` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `Templates: plan and send a template update to its projects (fbk_008 item 4)`.

### Task 24: The update flow on the template page (fbk_008 item 4 a, b, c)

**Files:**
- Create: `src/features/settings/admin/TemplateProjectsSheet.tsx`, `src/features/settings/admin/SyncSteps.tsx`
- Modify: `ProjectTemplatesSection.tsx` (row menu "Projects using this template")
- Test: `src/features/settings/admin/TemplateProjectsSheet.test.tsx`

**Interfaces:**
- Consumes: `projectTemplates.usage`, `syncPlan`, `syncApply` (Task 23), `LinkProjectSheet` (Task 22), `events.undoStory`.

- [ ] **Step 1: Write the failing tests:** the sheet lists the linked open projects with their state word (Active, Paused,
  "Stale for 40 days") and ticks with "All" and "None"; "Not linked" lists the rest with "Link"; "Update projects" first asks
  "Update 3 projects with the changes of this template?"; then one card for each kind of change with a count ("12 tasks in 3
  projects, 5 people") and its choice, one card at a time; then the summary of each project and the reason field when dates
  move; then the last confirm "Update 3 projects"; nothing is sent before that press; a cancel at any step sends nothing; at
  the end "Undo all" calls `events.undoStory` with the story id.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Build the sheet and the steps.** One main button on each step. The last confirm has no Enter default, so a
  stray key press never sends it. The calls go one project after the other under one `storyId`, with a progress line.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `Templates: choose projects, review each change and update them with two confirms (fbk_008 item 4)`.

## Wave 4, track `roles`

### Task 25: Office rights and the role settings (fbk_014)

**Files:**
- Modify: `src/api/contract/entities.ts` (`OfficeRight`, `RoleId = id('rol')`, `CustomRole`, `RoleSettings`, `Settings.roles`,
  `User.roleId`), `src/api/permissions.ts:5-11,103-152`, `src/api/execute.ts:13-22` (`resolveAuthority`),
  `src/api/permissions.test.ts:21-42`
- Create: `src/api/rights.ts`
- Test: `src/api/rights.test.ts`, `src/api/permissions.test.ts`

**Interfaces:**
- Produces:
  `OfficeRight = z.enum(['people.manage', 'payment.manage', 'project.delete', 'project.editCode', 'clients.manage', 'templates.manageAll', 'report.office'])`,
  `CustomRole = z.object({ id: RoleId, name: z.string().trim().min(1).max(40), nameAr: z.string().trim().min(1).max(40), rights: z.array(OfficeRight).max(20) })`,
  `RoleSettings = z.object({ rights: z.partialRecord(z.enum(['management', 'accounting', 'member']), z.array(OfficeRight)).optional(), custom: z.array(CustomRole).max(20).optional() })`,
  `Settings.roles: RoleSettings.optional()`, `User.roleId: RoleId.nullable().optional()` (only with `systemRole: 'member'`),
  `DEFAULT_RIGHTS` (plain constants in `permissions.ts`, because that file imports no schema values,
  `contract/limits.test.ts:34-39`): management `['people.manage', 'payment.manage', 'report.office']`, accounting
  `['payment.manage']`, member `[]`,
  `rightsOf(user: User, roles: RoleSettings | undefined): readonly OfficeRight[]` (Admin: all; a `roleId` that is gone: the member
  rights),
  `type Actor = User & { readonly officeRights?: readonly OfficeRight[] }`, `can(actor: Actor, action, resource)`,
  new actions `clients.manage`, `templates.manageAll`, `report.office`.

- [ ] **Step 1: Write the failing tests:** `rightsOf` gives today's behaviour with no settings (add `people.manage` and
  `payment.manage` rows for the 4 roles to the TABLE of `permissions.test.ts`); changed rights for Management count; a custom
  role gives its own rights; a missing role gives the member rights; the Admin has all rights whatever the settings say; `can`
  with `officeRights` set reads them, and without them reads `DEFAULT_RIGHTS`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the contract, `rights.ts`, the `can()` change and `resolveAuthority`**, which attaches `officeRights` from
  the office settings. The 5 office actions read the rights: `project.delete`, `project.editCode`, `people.manage`,
  `payment.manage`, and the 3 new ones. `admin.manage` stays Admin only.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `Roles: office rights for each role, with today's rights as the defaults (fbk_014)`.

### Task 26: The rights on every path (fbk_014)

**Files:**
- Modify: every `can()` call whose user is not the authority (`src/api/views.ts`, `src/api/notify.ts:45-58,111,122`,
  `server/data/loaders/overview.ts:76,138`, `server/calls/usage.ts:16`, `server/files/rights.ts:77`); the inline role checks that
  mean a right (the survey lists 58 `systemRole` lines in 23 files; keep each check that means "the Admin"); the clients and
  template checks (`people.ts:351`, `taskTemplates.ts:24,38`, `projectTemplates.ts:25`, `stageTemplates.ts:21`);
  `src/api/handlers/people.ts:181-217` (only the Admin changes `systemRole` or `roleId`: reason `admin_only`);
  `src/api/handlers/history.ts:226-236` (the Undo of a role change: Admin only); `server/mcp/docs.ts:48` (`ROLE_NAMES` becomes
  a function that knows custom names), INSTRUCTIONS
- Create: `src/api/handlers/rolesLeaks.test.ts`
- Test: `rolesLeaks.test.ts`, `src/api/handlers/people.test.ts`, `src/api/handlers/payments.test.ts`,
  `server/mcp/dashboardDocs.test.ts`

**Interfaces:**
- Consumes: `rightsOf`, `Actor` (Task 25).
- Produces: `withRights(state: State, user: User): Actor`.

- [ ] **Step 1: Write the failing leak tests** in `rolesLeaks.test.ts` (Review Focus 2), copying `payments.test.ts:176-230`
  ("payments never leak") for a custom role with no payment right: no amount in the feed, the events, the notices, search, the
  Tracker, the Dashboard money, the `overview` loader and the History; and for a custom role with the payment right: the amounts
  show on each of those paths. Add: a custom role with `people.manage` can invite and edit a person, and gets `admin_only` for a
  role change; Management gets `admin_only` for a role change (a change of today's behaviour, the owner's rule).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Route each `can()` call with another user through `withRights`, and change the inline checks.** For each
  `systemRole` line, write in the commit message which right it became or why it stays an Admin check.
- [ ] **Step 4: Change the MCP side**: INSTRUCTIONS gets one line: "The Admin decides what each role may do. A call that the
  role of your person may not make fails for you too." `users.list` rows carry `roleId` (an additive field); its `TOOL_DOCS`
  names it.
- [ ] **Step 5: Run** the touched test files, `npm run test:lite` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `Roles: the rights reach every check; only the Admin changes a role; leak tests (fbk_014)`.

### Task 27: The Roles section (fbk_014)

**Files:**
- Create: `src/api/handlers/roles.ts`, `src/features/settings/admin/RolesSection.tsx`, `src/features/settings/admin/RoleSheet.tsx`,
  `src/i18n/real/roles.en.json`, `roles.ar.json`
- Modify: `src/features/settings/admin/sections.ts:25,38-45`, `PersonFormSheet.tsx:62-75,101-109`, `PeopleSection.tsx:45,73-80`,
  `src/app/PersonMenu.tsx:33`, the checklist wiring, `server/mcp/tools.ts` (deny)
- Test: `src/api/handlers/roles.test.ts`, `src/features/settings/admin/RolesSection.test.tsx`, `PersonFormSheet.test.tsx` (make it),
  `src/features/settings/admin/sections.test.ts`

**Interfaces:**
- Consumes: `RoleSettings`, `rightsOf` (Task 25).
- Produces: `roles.create` `{ name, nameAr, rights }` to `CustomRole`; `roles.update`
  `{ role: 'management' | 'accounting' | 'member' | RoleId; name?; nameAr?; rights? }` to `RoleSettings` (names only for a custom
  role); `roles.delete` `{ id: RoleId }` to `{}` (`role_in_use` with the count). All need `admin.manage`, write a settings event,
  and have Undo.

- [ ] **Step 1: Write the failing tests:** the 3 calls and their refusals (a duplicate name in either language, a name for a
  built-in role, a delete in use, a Member or Management gets `forbidden`); the section shows Admin locked ("Everything"),
  Management, Accounting, Member and the custom roles; a switch changes a right; "New role"; the person form offers the custom
  roles to the Admin only, and shows the role as text to Management; the Admin page opens for every person who has a right with
  a section in it.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the calls (loader `office`, `WRITE_KINDS` `['events', 'settings']`, MCP deny) and the screens.** Each right
  has a label and one short line, for example "Payments: see and change the payments of every project."
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `Roles: the Admin makes roles and sets the rights of each role (fbk_014)`.

## Wave 4, track `report`

### Task 28: The report data (fbk_016)

**Files:**
- Create: `src/api/handlers/reports.ts`, `src/api/reportPeriod.ts`, `server/data/loaders/report.ts`
- Modify: `src/api/contract/views.ts` (`OfficeReport`), the checklist wiring
- Test: `src/api/reportPeriod.test.ts`, `src/api/handlers/reports.test.ts`, the rows pins of `test:office`

**Interfaces:**
- Consumes: the right `report.office` and `payment.manage` (Task 25).
- Produces:
  `periodRange(period: 'week' | 'month' | 'quarter' | 'year', start: string | undefined, today: string): { from: string; to: string }`
  (a week runs from Sunday to Saturday; quarters start in January, April, July and October; with no `start`, the last full
  period before today),
  `reports.office` input `{ period; start?: Day }`, output
  `OfficeReport = { period: { kind; from; to }; generatedAt: Stamp; office: { name: string }; totals: ReportTotals; projects: ReportProject[] /* at most 200 */; people: ReportPerson[]; tracker: { opened: number; closed: number; waitingOnClientAtEnd: number }; money: ReportMoney | null; gaps: string[] | null }`
  (`ReportTotals`: projects active, started, completed and paused; tasks done, made and past due at the end; deadlines met and
  missed; submissions; stage moves. `ReportProject`: the project ref, the sub-company, the status, the stage at the start and at the
  end, the health, the same task and deadline counts, the next deadline. `ReportPerson`: the user card, tasks done, open, past
  due, reviews done. `ReportMoney = { received: number; dueInPeriod: number; pastDueAtEnd: number }`, in Saudi riyals.
  `money` only with `payment.manage`; `gaps` only for the Admin. Task 29 adds `design`).

- [ ] **Step 1: Write the failing tests:** `periodRange` for each kind, the edges (a week that crosses two months, Q4, a leap
  year) and the default; `reports.office` counts from a small State; `money` is null without the payment right and set with it;
  a person without `report.office` gets `forbidden`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the handler and the loader.** The loader counts in SQL (the events of the period grouped by verb, project
  and person; the tasks, deadlines and payments of the period), never the whole event list, with `_LITE` twins. Add rows pins on
  the year office of the move (`fd8ee30`) for the period `year`. Record the server time of a year report on the test copy in
  proof.md (the Supabase limit is 2 s of CPU for each request).
- [ ] **Step 4: Run** the touched test files, `npm run test:lite`, `npm run test:office` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `Reports: the office report data for a week, month, quarter or year (fbk_016)`.

### Task 29: The design guide and the MCP tool (fbk_016)

**Files:**
- Create: `src/api/reportDesign.ts`
- Modify: `src/api/handlers/reports.ts` (`design` in the answer), `server/mcp/tools.ts` (a list of tools gated by a right),
  `server/mcp/app.ts:183-187` (`toolsFor`), `server/mcp/docs.ts` (TOOL_DOCS, INSTRUCTIONS), `scripts/record-samples.ts`,
  `server/mcp/samples.json`, the tool count pins
- Test: `src/api/reportDesign.test.ts`, `server/mcp/tools.test.ts`, `server/mcp/app.test.ts`

**Interfaces:**
- Produces:
  `REPORT_DESIGN: ReportDesign` = `{ brand: { name: 'Madar'; nameAr: 'مدار'; mark: { viewBox: '0 0 18 18'; path: string } }; page: { background: '#FFFFFF'; margin: string }; colors: Record<string, string>; type: { family: string; fallback: string; sizes: Record<string, string> }; rules: string[] }`
  (the colors are the light values of `src/design/tokens.css`; the mark path is a copy of `MADAR_DOORS`
  (`src/components/MadarMark.tsx:4-16`), because `src/api` imports no component; `type.family` says that Thmanyah Sans is the
  brand font and that its licence forbids copies outside Madar, and `type.fallback` names "IBM Plex Sans Arabic" and the system
  sans; the rules: a white page only, one accent color, tabular numbers, Arabic right to left, short labels, a chart only for a
  trend, no em-dash),
  `MCP_BY_RIGHT: Readonly<Record<string, OfficeRight>> = { 'reports.office': 'report.office' }`,
  `OfficeReport.design: ReportDesign` (an additive field of the Task 28 answer).

- [ ] **Step 1: Write the failing tests:** each color of `REPORT_DESIGN` equals its token in `tokens.css` (read the file in the
  test), and the mark path equals `MADAR_DOORS`; the agent of a Member does not list `reports.office` and gets an unknown tool
  error for it; the agent of Management and of the Admin lists it; the tool count tests rise by one for those people.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write `REPORT_DESIGN`, put it in the answer, and gate the tool** in `toolsFor` by `rightsOf(owner, settings)`
  (the handler also checks the right). `TOOL_DOCS` (40 to 600 characters): what the tool gives, that the agent builds a clean
  document on a white page from `design`, and that `money` comes only for people with the payment right. INSTRUCTIONS gets one
  line under a new "Reports:" heading. Record the sample.
- [ ] **Step 4: Run** the touched test files and `npm run test:mcp` (the conformance runner: "5 of 32 scenarios pass; 27 expected
  failures" stays the normal result, because the tool adds no resources). Expected: PASS.
- [ ] **Step 5: Commit** `MCP: the office report with Madar's design guide, for people with the report right (fbk_016)`.

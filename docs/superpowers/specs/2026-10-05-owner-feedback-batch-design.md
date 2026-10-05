# Owner feedback batch, 2026-10-05

The owner sent 12 items on 2026-10-05. This spec fixes the design of each item and splits the work into tracks.
The owner answered four questions: a side list for the Admin page, roles with a default person in project templates,
stage templates merge into project templates, and two projects can share one code (one contract).

Where this spec and the code differ after the merge, the code wins.

## Rules for every track

- ASD-STE100 Simplified Technical English in code comments, commits, docs and English words. No em-dash anywhere.
- Tests first for every change. Words in English and Arabic (natural Arabic), only in the track's own word files
  `src/i18n/real/<track>.en.json` and `.ar.json` (create the pair). A key may not exist twice in all files.
- Logical classes only (`ms/me`, `ps/pe`, `start/end`). Read `DESIGN.md` and `src/CLAUDE.md` before screen work.
- Judge each screen from the view of employees with ADHD: one next step, the fewest controls.
- A contract change is additive or keeps both forms. Old saved records must still parse.
- **MCP (owner rule):** every new or changed call updates `server/mcp/tools.ts` (allow or deny list), `TOOL_DOCS` in
  `server/mcp/docs.ts`, and the `INSTRUCTIONS` text when a rule changes. Admin configuration calls (clients, templates,
  users, settings) stay on the deny list, as before.
- The new-call checklist in `src/api/CLAUDE.md` applies (loader entry, `everyCall.ts`, `readMap.ts`).
- Commits: no `Co-Authored-By` line.

## Track `fix`: small fixes (items 5, 7, 8, 9, 11)

- **Item 7, tab row scroll marks.** The tab row of the project and of the Dashboard shows a small vertical scrollbar
  (up arrow, dot, down arrow) at its end. Find the cause in `components/Tabs.tsx` (or the row that holds it). The row
  may scroll sideways on a phone, but it must never show a vertical scrollbar or a scrollbar of its own.
- **Item 5, the corner of a sheet in Arabic.** The "Export the log" sheet of the Tracker, in Arabic, shows a light strip
  outside the rounded corners on the left side (top and bottom). Find the cause (the sheet panel, a scroll box, or the
  RTL side of `components/Sheet.tsx`) and fix it for every sheet, in both languages and both themes.
- **Item 8, empty dates in the stage dates editor.** Today each empty date field shows the native "dd/mm/yyyy" and the
  fields do not line up, because the labels have different widths. New form: one row for each stage, the stage name at
  the start, then two columns (Start, End) that line up for all rows, with the column names once at the top. An empty
  date shows "Set date..." in the light label colour (`text-label-3`), in a quiet button, not a full field. A press
  opens the date picker (native `showPicker()` where it exists, else a date input). A set date shows the short date and
  a small clear control. Use the same empty-date look for every other date field that shows "dd/mm/yyyy" with no value,
  if the change is small. If not, list those spots in your report.
- **Item 9, hatched overlap on and off.** The schedule draws two stages at the same time as hatched. Add a personal
  setting `Preferences.hatchOverlap?: boolean` (missing means on). Put one small switch beside the legend line
  "Hatched: two stages run at the same time." Off: no hatch, and the legend line goes away, only the switch stays.
  It applies to every schedule that hatches (project schedule, office schedule, meeting view).
- **Item 11, light theme for a new person.** `defaultPreferences()` gives `theme: 'light'`. People who exist keep their
  choice. The screens before sign-in use light too, unless a saved choice exists on the device.

## Track `lead`: tasks with no lead (item 2)

- `Task.ownerId` becomes `UserId.nullable()`. Old records keep a string. The database column is generated from the
  document, so no table change. Check `server/data/` and the SQL for a not-null rule.
- `tasks.create` with no `ownerId` makes a task with no lead (before: the creator). `tasks.createFromTemplate` the same.
  The quick "Add a task" row makes a task with no lead.
- `tasks.update` accepts `ownerId: null` to take the lead off a task. Same right as a change of lead today.
- New call `tasks.take({ taskId })`: an active member of the project team becomes the lead of a task with no lead.
  Right `task.take` in `can()`. MCP: allow, with `TOOL_DOCS`.
- A task with no lead cannot finish: `tasks.complete` (and every path to `done`) fails with code `needs_lead` and a
  word in both languages. A send for review needs a lead too.
- No notification goes to a missing lead. Workload, "Next for you", My tasks, the morning summary and the dashboard
  counts skip tasks with no lead and never crash on one. The project leader sees a gentle count of tasks with no lead
  in the project (one line in the Tasks tab, no new card).
- Screens: the Lead select in the task panel gets "No lead" as its first choice. A task row with no lead shows an empty
  dashed circle where the avatar goes, with the label "No lead". The task panel of a task with no lead shows one button
  "Take it" for a team member. The task filter gets "No lead".
- Every `.ownerId` use (about 75 in 29 files under `src/` and `server/`) must handle null. Search them all.
- MCP: update the docs of `tasks.create`, `tasks.update`, `tasks.list`, `tasks.get`; add one line to `INSTRUCTIONS`
  about tasks with no lead and `tasks.take`.

## Track `clients`: the client list and the project code (items 1, 3, 6b)

### The client record and form (items 1, 3)
- `Client.initials?: string`, 3 to 4 capital Latin letters (`^[A-Z]{3,4}$`). Optional in the record, so old clients
  parse. `clients.create` and `clients.update` accept it.
- One `ClientForm` component, used in the new-project form and in the Admin Clients section. Fields: English name,
  Arabic name, initials, contact person (with "Same as the client"), phone, email.
- Item 1: a required field shows an asterisk after its label (with a hidden "required" word for screen readers). A rule
  fails: the field shows its message under it after the person leaves it, or for all fields after a press on Add.
  Rules: an English or an Arabic name (both name labels say so), initials 3 to 4 capital letters (typed letters become
  capitals), email valid when given. Put the asterisk support in `components/Fields.tsx` (`required` shows it), so
  every form can use it, and mark the required fields of the new-project form too.
- Item 3: an Admin section "Clients" (component `ClientsSection.tsx` in `features/settings/admin/`, do not edit
  `AdminScreen.tsx`, the merge lead adds it to the new Admin side list). It has a search field and one row per client:
  the name in the screen language, the initials, the number of projects. A press opens a sheet with `ClientForm` and
  the list of the client's projects (links). Admin only. Two clients with the same initials get a warning, not a block.

### The project code (item 6b)
- Format `YYMMSSINI-CLS-Type`, for example `260902AZT-RES-Multi-unit Dev.`. The project key is `YYMMSSINI`.
  Check regex: `^(\d{2})(0[1-9]|1[0-2])(\d{2})([A-Z]{3,4})-(RES|COM|IND|INS|REC|AGR|UTL|MIX)-(.+)$`. Type: 1 to 40
  characters. Classes in English and Arabic: RES Residential, COM Commercial, IND Industrial, INS Institutional
  (mosques too), REC Recreational, AGR Agricultural, UTL Utility, MIX Mixed-use.
- `Project.code` accepts the old form (`KH-26-014`) and the new form. Old codes never change.
- A pure helper in `src/lib/projectCode.ts`: parse, build, key, and the next series. The series (SS) counts the
  projects registered in that month, firm wide, from 00. Next series = the highest series of that month + 1.
- `projects.create` input, additive: `codeParts?: { initials, classification, type }` (the server takes YYMM from
  today in Riyadh and the next series), or `code?: string` (a full code typed by hand, for a project that already has
  a code), or `sameContractAs?: ProjectId` (copy the code of that project). With none of them, the old automatic code
  stays (keeps old callers working). A typed code whose YYMMSS is in use by another contract fails with `code_taken`.
- When the client of the project has no initials, the initials of `codeParts` are saved on the client too.
- New-project form: a "Project code" group. Client initials (filled from the client and locked when the client has
  them, else a field), Classification (select), Building type (text). A live preview of the full code. "Type the code
  by hand" opens one field for a full code. "Same contract as..." picks another project and copies its code. Name,
  initials, classification and type are required (asterisks).
- After create, the code is fixed. Only the Admin can correct it with `projects.update({ code })` (new right
  `project.editCode`), and the History records it.
- Show the key in tight places (cards, rows), the full code in the project header and About.
- `#260902AZT` in a post or a comment links to the project, as `#KH-26-014` does today. `ProjectByCode` matches a full
  code or a key. Two projects with one code: it shows the two to choose from.
- Office settings: the "code prefix" field leaves the screen (the contract keeps it for the old automatic code).
- Search finds a project by its key and by its full code.
- MCP: update the docs of `projects.list`, `projects.get`, `projects.update` (code format, Admin-only correction);
  add one line about the code format to `INSTRUCTIONS`.

## Track `admin`: the Admin page side list (item 4)

- Routes `/admin` and `/admin/:section`. A section list from one registry `features/settings/admin/sections.ts`:
  `{ id, group, titleKey, roles, Component, remoteOnly? }`. Groups and order: People (People, Teams), Office (Office),
  Templates (Stage templates, Task templates), System (Feedback, Usage). The merge lead adds Clients (Office group) and
  Project templates (Templates group) later.
- Desktop (wide screens): the grouped list sits at the start side, sticky, and the open section fills the rest. `/admin`
  opens the first section the role may see. Phone: `/admin` shows only the list, a row opens `/admin/<id>`, and a Back
  control returns to the list.
- The role rules stay: Management sees People and Teams only. Other roles see the empty state of today.
- One page title. The open row uses the open-tab look of the design system. A section that the role may not see, or an
  unknown id, goes back to `/admin`.
- Each section keeps its own content. Move only the frame. Move the section heading into the frame if the section
  repeats it.

## Track `profile`: the profile picture and the two names (items 10, 12)

### Profile picture (item 10)
- Settings gets a profile area at the top: the picture (or the initials circle), "Change picture", "Remove picture".
- The browser cuts the picture to a centre square, 128 px, WebP (JPEG where WebP fails), at most 16 KB, and saves it as
  a `data:image/...;base64,` value in `avatarUrl`. No file store, no signed link.
- Contract: `avatarUrl` accepts `data:image/(webp|jpeg|png);base64,...` up to 24,000 characters, or `https://` up to
  2,000, or null. Every other value fails (no `javascript:` or other schemes). Keep old values that parse.
- Check the image source rule of the content security policy (`scripts/deploy/headers.ts`, `index.html`) for `data:`.

### Names in two languages (item 12)
- `User.nameAr?: string` (1 to 80). `name` stays the English name. One helper `personName(user, lang)`: Arabic screens
  show `nameAr` when it exists, else `name`; English screens show `name`, else `nameAr`. Mirror `lib/clientName.ts`.
- `UserCard` (views) gets `nameAr`. Every screen spot that shows a person's name uses the helper (about 87 spots: search
  `.name` on users, authors, leads, members, helpers, mentions). The initials circle uses the shown name. Mail uses the
  language of the person who gets the mail.
- The Admin "new person" and "edit person" sheet asks for both names, both required (asterisks) for a new person.
  `users.create` and `users.update` accept `nameAr` (optional in the contract, so old callers work).
- Each person changes both names in Settings (the profile area), with `me.updateProfile` (accepts `nameAr`).
- Search and @mentions match both names.
- MCP: `users.list` returns both names; update its docs; `readFirstAnswer` names the person in English.

## Track `templates`: project templates (item 6a), after the merge of the first wave

- New record `ProjectTemplate` (id prefix `ptp_`): `name`, `roles[]` (`{ id, name, defaultUserId | null }`),
  `stages[]` (`{ id, name, startOffset | null, durationDays | null }`), `tasks[]` (`{ id, stageId, title,
  description, checklist, needsReview, roleId | null, startOffset, durationDays, flexible }`), `createdBy`,
  `createdAt`, `updatedAt`. Offsets and durations are working days (Sunday to Thursday, `lib/workdays.ts`); day 0 is the
  project start. A stage with tasks takes its span from its tasks. A stage with no tasks and no numbers gets no dates.
- New table in a migration, an entry in `server/data/tables.ts`, `STATE_VERSION` 9 with a step in `src/data/migrate.ts`.
  Each stage template becomes a project template with stages and no tasks (prototype step and SQL migration). The stage
  template calls stay in the contract. Their screens go away. The new-project form shows one template picker.
- Calls: `projectTemplates.list`, `.save`, `.delete` (Admin, like stage templates today). MCP: deny (admin settings).
- Admin section "Project templates" (Templates group, component only; the merge lead registers it). Editor: name;
  roles (name and default person); stages in order, each with its tasks; each task: title, role, start day, length in
  working days, "Can stretch" tick (default on). A small timeline preview under the editor.
- Use: in the new-project form, "Start from a template". Then the start date (required), an end date (optional: empty
  keeps the template length), one person for each role (the default shows first, "No lead" is a choice), and the ticks
  "Can stretch" for each stage (ticks all its tasks) and each task. A line shows the template length and the new length.
- Stretch and shrink: one factor f scales every start offset and the length of every task that can stretch. A locked
  task keeps its length. Find f so that the last end equals the target end (the end is monotone in f, so a bisection
  works). Round to whole working days, at least 1. When the locked tasks alone do not fit, show "The locked tasks need
  at least N working days" and block the create.
- `projects.create` takes `template?: { templateId, startDate, endDate?, roles: Record<roleId, UserId | null>,
  fixedTaskIds: string[] }`. The handler computes the plan with the same pure helper as the screen
  (`src/lib/templatePlan.ts`), makes the stages with dates and the tasks with start and due dates and leads. A role
  person who is not on the team joins the team. A role with no person gives tasks with no lead (track `lead`).

## Merge order and checks

Wave 1 in parallel: `fix`, `lead`, `clients`, `admin`, `profile`. Merge order: `admin`, `fix`, `profile`, `lead`,
`clients`, then register the Clients section. Wave 2: `templates`, then register its section. After each wave: the
full merge gate of the root `CLAUDE.md`, then the walk on the local stack and screenshots (EN, AR, light, dark, 390 px).

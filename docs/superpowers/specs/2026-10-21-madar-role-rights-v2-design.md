# Role rights, version 2 (design, 2026-10-21)

The owner approved the list on 2026-10-21 (page: https://claude.ai/artifact/4aPwLVAS7sYUQytJGXCQhN, version 2).
The one source of the list is `2026-10-21-madar-role-rights-v2-catalog.json` (next to this file): 13 sections, 85 powers,
112 switches, with ids, English and Arabic labels, hints, scopes, defaults, needs and the MCP tools of each AI switch.
Research for this design (read only, 2026-10-21): the server and screen inventories and the v1 catalog with its gap check, in the
session scratchpad. Their findings are folded in below; a builder does not need them.

## 1. Intent

The owner's words. 2026-10-20: "in creating new role, the rights make it detailed but sections, like the rights related to projects
(add, remove, view, create.. etc), related to the managing people, related to mcp, related to templates ... because sometime i need a
role that do parts from the admin and parts from the members ... so i need to be free in the customization, but in each section add
all for the section". 2026-10-21, after the build of 2026-10-20 showed "Member: 0 of 17 rights": "no way the members doesn't have any
rights? i told you i want the details of the rights, make it more customizable rights". On the first list of 51: "make it customizable
more, more rights split, and the mcp part not clear enough", "allow me more to choose freely".

So: every power in Madar is a switch on the role sheet, the Member basics, the leader powers and the AI assistant powers included.

## 2. Goals, non-goals, anti-goals

Goals
- Every switch of the catalog works on the server (the one rule `can()`), in the screens (no control shows that the call would refuse)
  and for AI agents (MCP).
- On release day nobody gains or loses a power. Member holds 64 of 112, Management 74, Accounting 68, the Admin all 112.
- The role sheet stays usable for a person with ADHD: folded sections, one Save.

Non-goals (step 2, later)
- "See every project" (a role that sees only its own projects). Step 1 keeps "every person sees every project".
- Data privacy from the Dashboard, workload and Search switches: they hide screens only. The same data still shows in the lists.

Anti-goals (a failure even if it works)
- A switch that shows on the sheet and controls nothing, or controls more than its own power.
- A Member who loses an upload, a post or a chat on release day (the "fail closed" trap, section 7.3).
- A switch that is off for a person and still works for that person's AI agent.

## 3. The model

- A right is one switch id of the catalog. `OfficeRight` holds the 112 ids. A person holds a list of ids; the Admin holds all.
- Scopes. A power with scopes has one id for each scope: `<power>.<scope>`.
  - `lead`: the projects where the person is the leader.
  - `team`: the projects where the person is on the team. The leader counts as on the team.
  - `all`: every project (the power of the Admin today).
  - `office`: office to-dos (to-dos with no project).
  - `none`: meetings with no project.
  - A power with one switch has the power name as its id (`task.take`, `payment.view`, `project.code`).
- The check of a scoped power on a project resource: hold `<power>.all`, or hold `<power>.lead` and lead the project, or hold
  `<power>.team` and be on the team (leader or member). The Admin passes always.
- "Own" powers (my to-dos, my posts, my meetings, my files, my Tracker entries) keep today's people rule (maker, lead, author,
  organizer, uploader) AND need their switch.
- Needs (in the catalog, field `needs`): a switch that needs another. The sheet turns the needed switch on with it, and turns the
  dependants off when the needed one goes off. The server stores what the sheet sends and checks each id alone; `rightsOf` adds the
  needed ids, so a stored list can never hold a dependant without its need. Rules: every `.all` needs its `.lead` and `.team` sibling;
  `payment.add`, `payment.change`, `payment.receive` need `payment.view`; `workload.view` needs `dashboard.view`; every `ai.*` needs `ai.connect`.
- `project.code` passes only where `project.details` passes (scope of details). So an old role with the code right and no "change any
  project" right corrects the code only of the projects it leads, as today.
- Outside the switches. Admin only: the Roles section, `roles.*`, a change of a person's role or email, an Admin's account, an agent
  in `users.create`, `adminReach`. Always on: own profile, preferences, notifications, push, password, Google Calendar, Focus mode,
  reading projects, to-dos, files, people, clients, the History; leave a group or a to-do; mark read, archive, Notify me; the Undo of
  your own change (section 6.5); list and remove your own AI agents; settle a meeting.

## 4. Defaults and old data

- `BASIC_ON`: the 64 switches with `basic: true` in the catalog (every scope of today's powers except `.all`). Member holds exactly them.
- Management: `BASIC_ON` plus `people.invite`, `people.change`, `people.teams`, `people.turnOff`, `people.remove`, `payment.view`,
  `payment.add`, `payment.change`, `payment.receive`, `report.office`. Accounting: `BASIC_ON` plus the 4 payment ids.
- Storage (additive, no data rewrite, no migration):
  - `RoleSettings.rights[role]` and `CustomRole.rights` keep their meaning: the held ids that are NOT in `BASIC_ON`. They may still
    hold old ids.
  - New optional `RoleSettings.off` (`partialRecord` of management, accounting, member to a list) and `CustomRole.off`: the `BASIC_ON`
    ids that the role does NOT hold.
  - Held ids of a built-in role = (`BASIC_ON` minus its `off`) plus `expand(rights[role] ?? DEFAULT_EXTRA[role])`, plus needs.
  - A custom role with no `off` field (saved before this release) = the held ids of Member plus `expand(its rights)`: the meaning of
    today (Member union role). A custom role with `off` = (`BASIC_ON` minus `off`) plus `expand(rights)`: its own full list.
  - A new role starts as a copy of the Member list in the sheet. A later change of Member does not change it.
  - `expand` maps the 17 old ids with the `legacy` map of the catalog. A `StoredRight` enum (the 112 ids plus the old ids) types the
    stored lists and the `roles.*` inputs, so zod accepts old data. `session.get` and every output give only the 112 new ids.
  - A save from the new sheet writes only new ids, so old ids fade out with no job.
  - Raise the caps: `.max(20)` on `CustomRole.rights` and `roles.ts` to `.max(120)`; `off` `.max(70)`.
  - `undoRoleChange` and `changeCustom` (`handlers/roles.ts`) carry `off` with `rights`; an Undo of an old event expands its old ids.
  - Stale tabs: an old build gets 409 `client_outdated` at the batch route, so an old sheet cannot save. MCP denies `roles.*`.
  - Rollback: after the first role save in the new form, the old code cannot read the new ids (zod output check). A problem then needs
    a fix, not a rollback. The release record says so.
- `session.get` reads the kind `settings` too (`src/app/readMap.ts`), so an open tab follows a role change without a reload.

## 5. What each switch controls

The catalog gives the label and hint of each power. The code mapping, by area. "Lead/team/all" means the scope check of section 3.

### 5.1 Projects
- `project.create`: `projects.create` (also from a template). It no longer stands for clients and templates.
- `client.create`: `clients.create` (was `project.create`) and its Undo.
- `project.details.*`: `projects.update` without the code, the map pin (`saveLinks` pin rule), the cover upload, the sub-company.
- `project.team.*`: `members.*`, and `ensureOnTeam` (naming a person outside the team as lead or helper adds them to the team).
- `project.stages.*`: `stages.replace`, `stages.setDates`, `stages.setPrerequisites`.
- `project.deadlines.*`: `deadlines.create`, `update`, `delete`.
- `project.template.*`: `projectTemplates.matchPlan`, `link`, `syncApply` with `apply: true` on one project.
- `project.archive.*`: `setStatus`, `pause`, `setRestart`, `resume`.
- `project.leader.*`: `projects.setLeader`.
- `project.health.*`: the health override set and clear.
- `project.code`: the code field of `projects.update` (and only where `project.details` passes).
- `project.delete.lead`, `project.delete.all`: `projects.delete`. The leader scope is a new power (no role holds it today).
- The project stand-in `project.edit` disappears: each call site asks its own power. Grep every use and re-point it. The Undo of each
  event asks the same power as the change.

### 5.2 To-dos
- `task.add.office`, `.team`, `.all`: `createTask` (office and project) and `tasks.createFromTemplate`; also the reply to-do of the
  Tracker (`openReplyTask`) and the action to-do of the meeting view.
- `task.assign`: naming another person as the lead or a helper when making a to-do (helpers too, not only the lead), and changing the
  lead or helpers of a to-do you made (`task.updateAny` for the maker). The leader and `task.any.*` keep it.
- `task.take`, `task.help` (join only; leaving stays free).
- `task.work`: tick, complete, move, arrange, new version of a to-do you lead or made (`task.updateOwn` minus the fields below), and
  ticks of a helper (`task.contribute`).
- `task.details`: title, description, checklist structure, stage, flag, prerequisites of a to-do you lead or made.
- `task.dates`: start date and due date of a to-do you lead or made (`tasks.update` fields `startDate`, `dueDate`, schedule).
- `task.deleteOwn`: `tasks.delete` by the maker or the lead (today's rules, `leadTookTask` included).
- `task.any.lead`, `.all`: every to-do change of a project by anyone (lead, helpers, prerequisites, fields, dates, status, delete).
  Today the leader holds it on the projects they lead, and `task.changeAny` on all. Never an office to-do.
- `task.review.lead`, `.all`: approve, send back, the review need, "tick lands on Done", "no review" on template to-dos.
  `reviewersOf` / `reviewersOfTask` (`notify.ts`): a leader who lacks `task.review.lead` is no reviewer; the Admins review then, as
  for a project with no leader. The Dashboard `inReview`, the `review_for_me` filter and the morning summary follow the same rule.
- `task.officeAll`: see and manage every office to-do, as the Admin does today (`canOnOfficeTask`, the loaders, the private Realtime
  signals in `server/data/save.ts`, `adminCopies`). Off keeps them private. This reveals records: the builder writes leak tests for a
  person WITHOUT it on every read path (lists, get, search, History, signals, notices, error texts), as the office to-do rules ask.

### 5.3 Meetings
- `meeting.plan.none`, `.team`, `.all`: `meetings.create` (no project; a project where you are on the team; any project).
- `meeting.editOwn`: update, cancel, delete, extend of a meeting you organize.
- `meeting.minutesOwn`: minutes and the files of a meeting you organized or attended.
- `meeting.any.lead`, `.all`: change, cancel, delete any project meeting (today the leader and the Admin).
- `meeting.minutesAny.lead`, `.all`: minutes of any project meeting (today the leader and the Admin).
- A meeting with no project keeps its privacy: no switch shows it to anyone outside its people.

### 5.4 Posts, comments and links
- `post.create.team`, `.all`: `updates.create`, the decision panel of the meeting view.
- `comment.create.team`, `.all`: `comments.create`, reactions on posts and to-do comments. On an office to-do: the people of the to-do.
- `post.editOwn`: edit and delete your own post or comment (`content.editOwn` for text).
- `project.links.team`, `.all`: `projects.addLink`, `updateLink`, `removeLink` (the pin part still needs `project.details`).
- `content.post` stops standing for upload, Tracker and meetings.

### 5.5 Files
- `file.upload.team`, `.all`: `files.upload` and `files.uploadStart` for a project or a to-do (server: `server/files/rights.ts`,
  `server/calls/files.ts`). Chat, meeting, feedback and profile uploads follow their own rules.
- `file.deliver.team`, `.all`: "Received from the client" and Mark as delivered (both write a Tracker line; no Tracker right needed).
- `file.share`: `files.share` into a to-do or a chat. Sharing to a person also needs `chat.direct`; into a project chat `chat.project`.
- `file.deleteOwn`: the uploader deletes their own file, and its Undo (was `content.editOwn`).
- `file.deleteAny.lead`, `.all`: delete any file of a project (was the `task.delete` stand-in with the project role).

### 5.6 Chat
- `chat.direct`: `chats.openDirect`, and every send, edit, delete, reaction and file in a direct chat.
- `chat.groupCreate`: `chats.createGroup`. `chat.groupChange`: rename and add people (`chats.updateGroup`; the maker's removal rule stays).
  Sending in a group you belong to needs `chat.direct`.
- `chat.project.team`, `.all`: read and write a project chat (`canSeeConversation`). `.all` gives a non-Admin what the Admin has
  today: every project chat opens, and the Inbox counts it like the Admin's default ("mixed": only the messages that name the person,
  unless the person picks All messages). The push of a project chat to such a person: only when named.
- Put the send check in `postMessage` (`chats.ts`), the one door of send and share. A project chat asks `chat.project`; a direct
  chat or group asks `chat.direct`.

### 5.7 Client Tracker
- `tracker.log.team`, `.all`: `tracker.log`, `update`, `close` (was `content.post`), and the Balady tick (`flow.ts`, was `content.post`).
- `tracker.reply`: `replyBy` of `tracker.log` and `tracker.assignReply`. The reply to-do also needs `task.add.team` (and `task.assign`
  for another person), and `close`/`update` that finish it need `task.work` or `task.any.*`.
- `tracker.export`: `tracker.export` (a new gate; the screen hides Export).
- `tracker.deleteOwn`: delete an entry you logged (`mayDeleteTracker` author part; a meeting line has no author delete).
- `tracker.deleteAny.lead`, `.all`: delete any entry, a meeting line too (was the `task.delete` stand-in).

### 5.8 People and clients
- `people.invite`: `users.create`, `users.resendInvite`. `people.change`: `users.update` (name, discipline, picture, gender).
  `people.teams`: `teams.create`, `update`, `delete`. `people.turnOff`: `users.deactivate`, `reactivate`. `people.remove`: `users.remove`.
- `users.invites` (the Invited or Active state) passes for any of the five people rights.
- The hard-coded Admin rules stay (never touch an Admin, never change a role or an email).
- `clients.change`: `clients.update`. `subCompanies.manage`: unchanged.

### 5.9 Money
- `payment.view`: `payments.list`, the money of `dashboard.get` and `reports.office`, payment events in the History, `viewerCan.payments`.
- `payment.add`: `payments.create`. `payment.change`: `payments.update`, `payments.delete`. `payment.receive`: `payments.markReceived`.
- The Undo of a payment event asks the right of that change.

### 5.10 Templates
- `templates.projectCreate`: a new project template (`projectTemplates.save` without `id`) and a new stage template. The saver
  always changes their own.
- `templates.projectAny`: change or delete another person's project template or stage template.
- `templates.taskSave.lead`, `.all`: save a to-do template from a to-do or by hand (today: a person who leads a project; with
  `.all` no project needed).
- `templates.taskAny`: rename or delete another person's to-do template.
- `templates.updateProjects`: unchanged.

### 5.11 Dashboard and reports
- `dashboard.view`: `dashboard.get` refuses without it. The screens hide the Dashboard tab, its route, the meeting view, the map, the
  Open space and every link to them.
- `workload.view`: without it `dashboard.get` gives `workload` as an empty object (`rows: []`, `unassigned: null`), never null.
- `search.use`: `search.query` refuses without it; the screens hide the search icon, the shortcut and the route.
- `gaps.view`, `report.office`: unchanged.

### 5.12 AI assistants (MCP)
- An agent never holds more than its person: the person's held ids are the agent's held ids. On top, each `ai.*` switch opens a group
  of tools (the catalog field `mcpTools`). A tool whose switch the person lacks is not listed (`toolsFor`) and its call is refused with
  `forbidden`, reason `ai_off`, which names the switch.
- `ai.connect` off: the consent and approval refuse; every `/mcp` request of that person's agents is refused at once; Settings, Agents
  shows one line and keeps the list and the remove button. `madar.readFirst` and `story.start` need only `ai.connect`.
- `ai.readChats` off: the chat tools are hidden, and `search.query` gives an agent no message hits.
- `ai.undoOthers.lead`, `.all`: was `event.undoAgent` / `agents.undoAny` (undo another person's agent change).
- `MCP_BY_RIGHT` follows the new ids: payments tools need `payment.*`, `reports.office` needs `report.office`, `feedback.*` needs
  `feedback.manage`, `dashboard.get` needs `dashboard.view`, `search.query` needs `search.use`.
- `ctx.actor` of an agent carries the person's rights (`execute.ts`), so a wrong read fails safe.
- Text: `INSTRUCTIONS` says the rule in two lines (the Admin decides what each role and its assistants may do; a call that is off fails
  with `ai_off` or `forbidden`, tell your person, never try another way). `TOOL_DOCS` lines that name "the leader and the Admin", "the
  payment right" and so on name the switch. `madar.readFirst` lists the switches its person holds.

### 5.13 Office
- `feedback.send`: `feedback.send` and `feedback.uploadStart`; the person menu hides the item.
- `feedback.manage`: unchanged.
- `office.settings`: `settings.update` (was `admin.manage`) and the Undo of a `settings.updated` event. Role events keep `admin.manage`.
  An Admin page section "Office settings" opens for it.

## 6. Rules that keep it safe

1. Re-point every stand-in before a switch: `project.create`, `project.edit`, `content.post`, `content.editOwn`, the `task.delete` stand-in
   in file and Tracker delete, `chat.project` for other people, `admin.manage` for settings.
2. `canOnOfficeTask` and `canOnMeeting` take an `Actor` (they read rights now). The three early returns of `can()` must not skip a switch.
3. Fail closed. A person with no rights attached holds none. Before any basic is gated, attach rights (`withRights`) in every place that
   asks `can()` for a plain person: `server/files/rights.ts` and `server/calls/files.ts`, the chat people list and mention filter
   (`chats.ts`), `attach.ts`, the notice recipients (`notify.ts`), `adminCopies.ts`, `seesEvent` (`history.ts`), the push rule
   (`server/push/chatRule.ts`, `chatFacts.ts`). A test for each place: a Member uploads, is mentioned, gets the notice.
4. A right gives only its own power. Before a right passes an action, grep every use of that action and check what it stands in for.
5. Undo: the Undo of an act needs only the right of the act. The Undo of your own new to-do needs `task.add.*`, not `task.deleteOwn`.
6. The prototype: the sample role Cashier keeps working through the legacy map; the seed may move to new ids.

## 7. Screens

- Role sheet (`RoleSheet.tsx`): the 13 sections of the catalog, folded, one open at a time. A heading row: the name, "4 of 9 on", and an
  All switch (on, off or mixed) for a section of two or more switches. A power row: the label, the hint, and one small switch for each
  scope with the scope word ("Projects I lead", "My projects", "Every project", "Office", "No project"); a power with one switch shows
  one switch. A line at the top: "Holds 64 of 112". A text button "Back to the standard list" (the default of the role; Member for a
  custom role). The needs move together, with one line "Needs: See payments." The AI section opens with the three lines of the page
  (what it is, the rule, what an assistant can never do). One Save role, Cancel, Delete role (custom). Phone: the same, as a sheet.
- A warning line when "Create projects" is on and many "Projects I lead" switches are off: "A person who makes a project leads it."
- Roles list (`RolesSection.tsx`): "3 people · 64 of 112 rights". One shared function gives the held ids (no local copy of `roleRights`).
- Person sheet (`PersonFormSheet.tsx`): "Member: the standard rights." / "Designer: standard rights, plus 2, without 3." / "Admin: everything."
- Admin page sections (`sections.ts`, `ADMIN_PAGE_RIGHTS`): People for any `people.*`; Teams for `people.teams`; Clients for
  `clients.change`; Sub-companies; Project templates for `templates.projectCreate`, `templates.projectAny` or `templates.updateProjects`;
  To-do templates for `templates.taskAny`; Office settings for `office.settings`; Requests and bugs for `feedback.manage`.
- Hide every control the call would refuse, from `viewerCan` flags (server) or the session rights: the Dashboard tab and route and every
  link to it, Search (icon, shortcut, route), New project, New client, New office to-do, quick add, From a template, the lead and helper
  fields, the date fields, Take, Join, Delete, Review, New meeting, Plan a meeting, Edit and Cancel meeting, Add the minutes, Post update,
  the comment box, links, the Files Add menu and drop zone, Mark as delivered, Received from the client, Share, file Delete, New message,
  the person sheet Message, New group, Rename, Add people, the project chat, Log it, Ask to reply, Export, Tracker Delete, the payments
  buttons, the meeting view panels (decisions, action to-dos, client items), Open loops, Settings Agents, the person menu Send a request.
- `viewerCan` gets one flag for each new gate the screens need (additive in `contract/views.ts`).
- Words: English in ASD-STE100, Arabic in the Thmanyah style (`src/i18n/CLAUDE.md`). Labels and hints come from the catalog; the
  Arabic hints are new. New word files: `src/i18n/real/rolerights2.en.json` and `.ar.json`. No em-dash.
- Screenshots: EN and AR, light and dark, 390 px: the Roles list, the role sheet folded and with one section open, the AI section, the
  person sheet, and Home of a Member with the Dashboard off.
- What's new (`src/whatsNew/entries.ts`): one entry for the Admin only (`right: 'admin.manage'`, `to: '/admin/roles'`), with the next
  free id. No entry for the others: no default changed. The old entries that name `templates.manageAll` as their `right` move to the
  new action that stands for it.

## 8. Tests

- Parity first. Before any code change, on main, record a fixture: every shared call of `server/core/everyCall.ts` run as the Admin,
  Management, Accounting, Member, a Member with an old custom role (`payment.manage`, `templates.manageAll`, `project.editCode`), a
  project leader, a team member and an outsider: allow or deny with the reason. Also the `viewerCan` objects of the sample project,
  task, meeting and Tracker rows for the same people. After the change, with the default settings, the fixture must be equal. This proves
  "nobody gains or loses". Only `project.delete.lead` and the new power rows differ, and they are off by default.
- For each of the 112 switches: on passes, off refuses, the right scope only, and the agent of a person without it is refused.
- Storage: old stored forms (built-in with `people.manage`, custom with no `off`, Member with extras), expand, needs, caps, Undo of an
  old role event and of a new one.
- Fail closed (section 6.3): one test for each place.
- `task.officeAll` and `chat.project.all`: leak tests for a person without them on every read path.
- MCP: the tool list for each AI switch, `ai_off`, `ai.connect` off, `TOOL_DOCS`, `INSTRUCTIONS`.
- Screens: the sheet (fold, counts, All, needs, back to standard, save), the list line, the person line, each hidden control.
- The test count only grows. Owner rule: run the touched tests and the typecheck while building; the full suites once at the end.

## 9. Tracks

One builder for each track, in its own worktree and branch from `rb/rr2`. No separate checker.
1. **core** (first, alone): the catalog module (`src/api/rightsCatalog.ts` from the JSON), `OfficeRight`, `StoredRight`, `BASIC_ON`,
   defaults, `expand`, needs, storage and `rightsOf`, `roles.*`, `undoRoleChange`, the parity fixture (recorded on main first), the new
   `can()` actions with scopes for EVERY power (permissions.ts), `viewerCan` flags (views.ts, contract/views.ts), the Undo rules
   (history.ts), `execute.ts`, the fail-closed fixes (6.3), `readMap.ts`. After core, every other track only re-points call sites.
2. **gates-work** (after core): to-dos, meetings, posts, files, chat, Tracker, office to-dos: the handlers in `src/api/handlers`
   (tasks, meetings, content, files, sharing, attach, chats, chatState, tracker, flow, notify, adminCopies), `server/files`, `server/push`,
   the loaders of these areas, the leak tests.
3. **gates-office** (after core): projects, people, clients, money, templates, Dashboard, Search, reports, office settings, feedback:
   the handlers (projects, people, teams, payments, three template files, insights, reports, feedback, subCompanies), the server calls
   of people and feedback, the loaders of these areas.
4. **mcp** (after core): `server/mcp` (tools map, `toolsFor`, `ai_off`, `ai.connect` in approval, agentUser, every request, run.ts,
   docs.ts, readFirst), `search.query` for agents, the MCP tests and counts, `server/mcp/CLAUDE.md`.
5. **sheet** (after core): the role sheet, Roles list, person sheet, `sections.ts`, `ADMIN_PAGE_RIGHTS`, the Office settings section
   gate, the words of 112 switches in both languages, What's new.
6. **screens** (after gates-work and gates-office): hide every control of section 7, the Dashboard and Search routes and tabs.
The merge lead (Claude, the main session) joins them in this order, runs the full gates once, deploys to the test copy, and takes the
screenshots. Production waits for the owner's word.

## 10. Calls Claude made (the owner can change them)

- The id names of the switches, and `<power>.<scope>`.
- The leader counts as on the team for `team` switches.
- `chat.project.all` counts in the Inbox like the Admin's default ("mixed").
- `Make project templates` is off for Member (no screen lets a Member do it today).
- Every `ai.*` switch is on by default (today an agent can do all its person can).
- `project.delete.lead` is a new power, off by default.

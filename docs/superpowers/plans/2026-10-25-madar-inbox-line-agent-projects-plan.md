# Plan: the Inbox line (fbk_056) and projects from the AI agent (fbk_057)

Date: 2026-10-25. Lead: Opus. Builders: Sonnet 5.5, one for each track. Studies: the session scratchpad (`fbk/study-056.md`,
`fbk/study-057.md`). Voice notes (fbk_054) are out: the owner dropped them on 2026-10-25.

## Owner decisions (2026-10-25)

- fbk_056: the badge is right. The Inbox shows one line under the filtered list: "3 unread messages are in other chats." and a quiet
  "Show all" button. No new red badge: red stays on the Inbox and the bell only (`DESIGN.md`).
- fbk_057: an agent creates a project, lists the clients, lists the templates and adds a client. Only the Admin has this for now, through
  one new AI switch in the Roles sheet, so a custom role (for example "Project managers") can get it later.
- Release: all the way to production, with the full checks. After production, mark fbk_056 and fbk_057 done in Madar.

## Facts behind the decisions

- Faisal (usr_003) is an Admin with no `adminReach` (so `mixed`). His Inbox filter read "People". `inKind` (`src/features/inbox/ChatList.tsx`)
  keeps only direct chats and groups for "People", and the choice stays on the device (`madar.chatKind`). The badge
  (`chats.unreadCount`, `totalUnread` in `src/api/handlers/chats.ts`) counts every listed chat and task thread. The row count and the badge
  both use `unreadIn`, so for an Admin too the hidden rows hold the missing unread messages.
- `projects.create`, `clients.create`, `clients.list` and `projectTemplates.list` are on `MCP_DENY` (`server/mcp/tools.ts`).
  `project.created` is in `NOT_UNDOABLE` (`src/api/events.ts`): a new project has no Undo, in the screens too.
  `project.create` and `client.create` are basic switches (every role). Moataz (usr_010) is an Admin.

## Track A: the Inbox line (branch `rb/inbox-line`, worktree `~/dev/madar-rb/inbox-line`)

The rule (`ChatList.tsx`, desk and phone alike):
- Show the line only when all of these hold: the kind is not All, the search field is empty, the archived list is closed, and the rows
  outside the kind hold unread messages.
- The number is the sum of `row.unread` over the rows outside the kind (`!inKind(row, kind)`), so it uses the same count as the badge.
- The line: "{{count}} unread messages are in other chats." (plural forms in both languages), then a quiet text button "Show all" that
  sets the kind to All. A press area of 44 px at least. No red, no badge, no main button.
- Place: on a desk, under the list and outside its scroll box, so it stays in view at the bottom of the list column. On a phone, under
  the list panel.
- The words go in a new pair `src/i18n/real/inboxline.en.json` and `inboxline.ar.json` (read `src/i18n/CLAUDE.md` for the Arabic plural
  forms and the Thmanyah style). Suggested Arabic: «في المحادثات الأخرى {{count}} رسائل غير مقروءة.» and «اعرض الكل».

Tests first:
1. `src/features/inbox/ChatFilter.test.tsx`: People chosen and an unread project chat gives the line with its count; a press on "Show
   all" chooses All, the project chat row shows and the line goes. No line when the unread messages are in the chosen kind, when All is
   chosen, while a search word is typed, and in the archived list. An unread task thread counts too.
2. The phone: the same line under the panel with the chips (`ChatListPhone.test.tsx` or `ChatKindChips.test.tsx`).
3. A guard in `src/api/handlers/chatsInbox.test.ts`: for a mix of a project chat, a direct chat, a group and a task thread with unread
   messages, `chats.unreadCount` equals the sum of `unread` over the `chats.list` rows, for a Member and for an Admin with each
   `adminReach`. If the two differ (for example `TASK_THREAD_LIMIT` cuts threads that the badge counts), report it and change no server code.

Also: one sentence in `src/CLAUDE.md` (the Inbox list paragraph). No MCP change (a screen choice), no contract change.

## Track B: projects from the AI agent (branch `rb/agent-projects`, worktree `~/dev/madar-rb/agent-projects`)

B1. The switch. A new power `ai.projectSetup` in the AI section of the catalog, after `ai.projects`
(`docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json`, then its copy `src/api/rightsCatalog.ts`):
- en "AI creates projects and clients", ar «ينشئ المساعد المشاريع والعملاء».
- hint: the agent creates projects and clients and reads the client and template lists; the person also needs the switches of
  "create projects" and "add clients" (use their real labels from the catalog).
- `mcpTools`: `projects.create`, `clients.create`, `clients.list`, `projectTemplates.list`.
- One switch, id `ai.projectSetup`, no scope, `basic: false`, `newPower: true`, defaults off for Member, Management and Accounting,
  needs `ai.connect`. The Admin holds it, as the Admin holds every switch.
- `AI_SWITCHES` and `AI_SWITCH_LABELS` (`server/mcp/aiSwitches.ts`), the `OfficeRight` type, and the role sheet words
  (`src/i18n/real/rr2sheet.*.json`). Check that a role saved before (with `rights` and `off`) does not get the new switch by mistake.
- Counts: 117 switches become 118, 88 powers become 89. Raise every pinned count and fix the guides that name them.

B2. The tool lists (`server/mcp/tools.ts`): take the four calls off `MCP_DENY`. `projects.create` goes to `MCP_BY_RIGHT` with
`project.create`, `clients.create` to `MCP_BY_RIGHT` with `client.create`, and `clients.list` and `projectTemplates.list` to
`MCP_ALLOW`. All four belong to the AI switch `ai.projectSetup`, so only an agent whose person holds it sees them. Expected counts:
`MCP_ALLOW` 47 to 49, `MCP_BY_RIGHT` 10 to 12, an Admin's agent 57 to 61, a default Member, Accounting or Management agent unchanged.
Update the header comments.

B3. Lean answers for the agent (`server/mcp/run.ts`, the pattern of `withRoleNames`): `clients.list` gives only the id, name, nameAr
and initials (no contact name, phone or email). `projectTemplates.list` gives the id, name, roles (id, name, default person), the stage
names and the number of tasks (no task bodies, no `followers`). If the tool declares an output schema, give it the lean shape.

B4. The words for agents (`server/mcp/docs.ts`), each `TOOL_DOCS` text at 600 characters or fewer:
- `projects.create`: there is no Undo, and the leader and the team get a notice, a push and an email, so ask the person first. Look in
  `projects.list` for the same name first. Send `codeParts` and let Madar build the code. A sub-company is needed. `leader`: me (default),
  none or a person ID; `teamIds` are person IDs. With `template`, send the dates inside it and no stages. `kind: internal` makes a hidden
  internal project. After a timeout, read the list before you try again.
- `clients.list`, `projectTemplates.list`, `clients.create`: drafts in `study-057.md` section 7.
- `INSTRUCTIONS`: in "Internal projects:", replace "You cannot make a project: your person does that in the Madar screens." with a
  sentence that says how. Add a "New projects:" paragraph (draft in `study-057.md` section 7): ask the person for the name, client,
  sub-company, leader and team; never choose a leader or a team yourself; no Undo; archive with `projects.setStatus` when the person
  asks; only an Admin deletes, in the screens.

B5. Samples: add one run for each new tool to `scripts/record-samples.ts`, then run `node --import tsx scripts/record-samples.ts`.

B6. Tests first (a new `server/mcp/projectCreate.test.ts`, in the pattern of `stageDates.test.ts` and `hiddenProjectTools.test.ts`):
1. The lists and switches: an Admin's agent sees the four tools; a default Member, Management or Accounting agent sees none of them and a
   direct call fails (unknown tool, or `forbidden` with `ai_off`); a custom role with `ai.projectSetup` and `project.create` sees
   `projects.create`; with `project.create` off it does not; with `ai.connect` off it sees none.
2. An Admin's agent creates a project (`leader: "me"`, `codeParts`, a sub-company): the answer has the code, the person leads it, and
   `events.list` shows `project.created` with the agent as the actor and the person in `actingForId`.
3. Notices: the person gets none; a named team member gets one `added_to_project`.
4. Refusals change nothing: `sub_company_required`, `code_format`, `code_taken`, `initials_mismatch`, `internal_project`, an unknown
   client, an inactive leader.
5. Undo: `events.undo` of `project.created` answers `conflict`; `events.undoStory` of a story that holds it fails and the project stays.
   An agent's `clients.create` follows the existing Undo rule of `client.created`.
6. Lean lists: `clients.list` holds no phone and no email; `projectTemplates.list` holds no task titles and no `followers`.
7. Leak tests (a custom role that holds `ai.projectSetup` and `project.create` but not `project.hidden`): `sameContractAs` of a hidden
   project gives the error of an unknown project; `code_taken` does not name the key of a hidden project; an internal project that an
   agent made answers `not_found` to the agent of an outsider on `projects.get`, `tasks.list`, `comments.list` and `events.list`; its
   change signals reach only its audience (extend `server/data/hiddenProjectSignalsRun.test.ts` if the pattern fits).
8. The words: `TOOL_DOCS['projects.create']` names the missing Undo and the ask; `INSTRUCTIONS` holds "New projects:" and no longer says
   "You cannot make a project".

B7. Raise the pinned counts (`tools.test.ts`, `app.test.ts`, `aiSwitches.test.ts`, `placeDocs.test.ts`, `oauth/sdk.test.ts`,
`rightsCatalog.test.ts`, `rightSwitches.test.ts` and the role sheet tests) and update the guides: `server/mcp/CLAUDE.md`,
`src/api/CLAUDE.md` (the project templates and clients MCP lines, the switch counts), `src/CLAUDE.md` (switch counts).

No screen change beyond the new row in the role sheet, which comes from the catalog. No migration: the rights live in the settings record.

## The join (lead)

1. Merge both branches into main in `deploy-test` (rebase, then fast-forward).
2. What's new, day 2026-10-25: `2026-10-23-100` for the Inbox line (everyone) and `2026-10-23-101` for projects from the AI agent
   (`right: 'ai.projectSetup'`, so only its holders see it). English and Arabic in `whatsnew.*.json`.
3. Fix the old line in `server/files/CLAUDE.md`: production files are on R2 already.
4. Gates, each once: `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, `npm run build:remote -- test`,
   `npm run test:db`, `npm run test:it`, `npm run test:mcp`, and the prototype smoke (a screen change).
5. Screenshots of the Inbox line: EN and AR, light and dark, at 390 px and on a desk. The role sheet with the new switch.
6. `all.sh test`, then production, the push, the release record, and fbk_056 and fbk_057 marked done.

# API contract and the fake API

Every call of Madar is defined here once. The prototype runs these handlers in the browser. The server runs the same
handlers inside `runCall` (see `server/CLAUDE.md`). An AI agent reaches the allowed ones as MCP tools.

## Files
- `registry.ts`: `defineCall({ input, output, run, prepare?, readOnly?, prototypeOnly? })`.
- `handlers/*.ts`: one file for each area. `handlers/serverFakes.ts`: the prototype fakes of the server-only calls.
- `calls.ts`: joins the handlers and the fakes. `sharedCalls.ts`: the calls the server runs, without `SERVER_EXCLUDED`.
- `contract/entities.ts` (records, ids like `prj_`, `tsk_`), `contract/views.ts` (read shapes), `contract/server.ts`
  (the server-only calls, `PASSWORD_SET_MARK`, file limits).
- `permissions.ts`: `can(actor, action, resource)`. `execute.ts`: runs a call. `errors.ts`: `ApiError` and its codes.
- `store.ts`, `persist.ts`: the prototype store in IndexedDB. `remote/`: the client of the real build (batcher, wire, keys).

## Rules
- `User.avatarUrl` takes picture data (WebP, JPEG or PNG, up to 24,000 characters) or an https address (`UserAvatarInput`).
  `userCard()` leaves picture data out, so lists stay small. `User.nameAr` is the Arabic name; an empty value means none.
- `src/api` never imports `server/` or `src/app/`.
- The output is checked inside the change, so a wrong shape rolls it back (`execute.ts`).
- One permission function: `can()`. No screen and no handler checks a right another way. An agent acts with its owner's
  rights (`resolveAuthority`).
- A contract change is additive, or it keeps both forms.
- Handlers stay synchronous and pure. A handler never does network work. Outside work is an effect.
- The test count only grows, except when the code a test checks is deleted.

## The project code (owner, 2026-10-05)
- `lib/projectCode.ts` reads and builds `YYMMSSINI-CLS-Type` (key `YYMMSSINI`, contract `YYMMSS`). Old codes (`KH-26-014`)
  stay valid. Two projects of one contract share one code, so the projects table has no unique rule on the code.
- `projects.create` takes `codeParts`, `code` or `sameContractAs` (at most one); with none, the old automatic code. A typed
  code whose YYMMSS belongs to another contract fails with `code_taken`. `codeParts` initials go onto a client with none.
- Only the Admin corrects a code (`project.editCode`, `projects.update` `patch.code`, verb `project.code_changed`).

## Project templates (owner, 2026-10-05, item 6a)
- `ProjectTemplate` (`ptp_`): roles (a name and a default person), stages, and tasks with a start day and a length in working
  days (Sunday to Thursday, day 0 is the project start) and `flexible`. Ids inside a template (`r1`, `s1`, `t1`) are unique in it.
- `projectTemplates.list`, `.save` (no `id` makes one, an `id` changes one) and `.delete`. Saving needs `project.create`; a change
  or a delete needs the person who saved it or the Admin. MCP: deny list.
- `projects.create` takes `template: { templateId, startDate, endDate?, roles, fixedTaskIds }`, never with `stages`, `startDate`
  or `targetEndDate`. The plan comes from `lib/projectPlan.ts`, the same function as the screen. Locked tasks that do not fit
  refuse with reason `template_too_short` (`names` holds the days they need). A role person joins the team; a role with no
  person gives tasks with no lead. The tasks send no notice: their people had the one notice of their place on the team.
- Stage templates merged into project templates. Their calls stay in the contract, their screens are gone. Version 9 and the
  migration `20261005000100_project_templates.sql` made one project template from each stage template, once.

## A new call: the checklist
1. `defineCall` in its handler file, with tests.
2. If it is server-only: its contract in `contract/server.ts`, its fake in `handlers/serverFakes.ts`, its server body in
   `server/calls/`.
3. A loader entry in `server/data/loaders/` (a test fails without it).
4. The MCP allow list or deny list in `server/mcp/tools.ts` (a test fails without it). An allowed tool needs `TOOL_DOCS`.
5. An input in `server/core/everyCall.ts` if the loader sweep does not name it.
6. Its read kinds in `src/app/readMap.ts` if it is a read.
7. Words in English and Arabic for every new message.

## A new record type
- A new zod collection needs a table in a new migration and an entry in `server/data/tables.ts`.
- The prototype store needs a new `STATE_VERSION` and a step in `src/data/migrate.ts`.

## Prototype data
- `src/data/seed.ts` builds the sample office (Hala Nasser is Admin). `STATE_VERSION` is 9 (`store.ts`).
- Each version has a step in `src/data/migrate.ts`. A newer or unreadable saved office is never wiped.

## Tests
- `npm test` runs the rule tests on the store in memory. `npm run test:db` runs them again on the local Postgres (one
  schema for each worker, as madar_server).

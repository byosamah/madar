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
- `src/api` never imports `server/` or `src/app/`.
- The output is checked inside the change, so a wrong shape rolls it back (`execute.ts`).
- One permission function: `can()`. No screen and no handler checks a right another way. An agent acts with its owner's
  rights (`resolveAuthority`).
- A contract change is additive, or it keeps both forms.
- Handlers stay synchronous and pure. A handler never does network work. Outside work is an effect.
- The test count only grows, except when the code a test checks is deleted.

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
- `src/data/seed.ts` builds the sample office (Hala Nasser is Admin). `STATE_VERSION` is 8 (`store.ts`).
- Each version has a step in `src/data/migrate.ts`. A newer or unreadable saved office is never wiped.

## Tests
- `npm test` runs the rule tests on the store in memory. `npm run test:db` runs them again on the local Postgres (one
  schema for each worker, as madar_server).

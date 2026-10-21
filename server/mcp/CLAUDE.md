# AI agents (MCP)

An agent (Claude, ChatGPT and others) acts for one person, with that person's rights. It connects to
https://madar.vado.sa/mcp. The test copy is https://preview.madar-46r.pages.dev/mcp.
Connect Claude Code with `claude mcp add --transport http madar https://madar.vado.sa/mcp`.

## The path of a request
1. The Pages Function `functions/mcp/[[path]].ts` runs `server/http/pagesMcpProxy.ts`. It follows the server host of the copy
   (owner, 2026-10-16; `config/server-host.json`). With `workers` and the Pages service binding of the copy
   (`MADAR_SERVER_TEST`, `MADAR_SERVER_PRODUCTION`), the request goes to the Worker as `/mcp<rest>` with the query, and no
   `x-region`. Otherwise it goes to the mcp function of the host's Supabase project, with `x-region: eu-central-1`, and the
   Pages log gets one line (`reason` `setting`, or `binding_missing` as a warning).
2. The proxy has a fixed host list (`PAGE_HOSTS` in `server/core/serverHost.ts`; `MCP_TARGETS` names the Supabase function of
   each host). Any other host, any path outside `/mcp`, and any encoded dot, encoded slash or backslash gets 404, on both
   paths. A production host never reaches the test binding. It drops the `cf-*` headers and the client address headers. On the Worker path it then writes
   `x-madar-client-address` from `cf-connecting-ip`, so the limits of the OAuth routes count each client address.
3. The mcp app (`entries/mcp.ts`, `app.ts`) on the host. A request that comes straight to a Supabase function gets one region
   hop first (`forward.ts`, `MCP_FORWARD_REGION`, default eu-central-1). The Worker never hops: its region label
   (`WORKER_REGION`, `workers-eu-central-1`) is no AWS region name. Every answer names its host in `x-madar-server`.
4. The token check (`auth.ts`). Then the tool runs through `runCall` with the person's rights (`run.ts`).

## The address
- MCP_URL in `secrets/<env>.env` is the short address. It is the token audience, the resource metadata and the
  `WWW-Authenticate` value. `scripts/deploy/secrets.ts` copies it into `platform_config.mcp_url`.
- If the address changes, change MCP_URL, run the secrets step, and change `PAGE_HOSTS` in the same commit.
- A switch of the server host (owner, 2026-10-16) keeps MCP_URL: the Worker gets the same MCP_URL as the functions
  (`secrets.ts` requires it for the Worker), so the token audience, the metadata and every agent connection stay. No agent
  connects again. MADAR_SECRET_KEY of the Worker is the default secret key of the project, as on Supabase, so a reason
  question that spans a switch keeps its state key.

## Tools
- MCP spec 2026-07-28, stateless. A 2025-era client gets the stateless legacy answer.
- 57 tools in all (role rights version 2, 2026-10-21). `MCP_ALLOW` holds 47: `madar.readFirst`, `pictures.get`, `story.start` and the reads and
  writes of an office project. `MCP_BY_RIGHT` holds 10, each behind a right of the person: `payments.list` (`payment.view`),
  `payments.create` (`payment.add`), `payments.update` (`payment.change`), `payments.markReceived` (`payment.receive`), `dashboard.get`
  (`dashboard.view`), `search.query` (`search.use`), `reports.office` (`report.office`) and the three `feedback.*` tools (`feedback.manage`).
  `MCP_ADMIN` is empty since role-rights (owner, 2026-10-23). A default Member agent gets 49 tools, Accounting 53, Management 54, the Admin 57
  (25 reads and 32 writes). `tasks.help` (fbk_035) joins the person to a task as a helper, or takes them off it.
  The factory in `app.ts` picks the list for each request from the office rights of the owner, never the agent user. A 2026-07-28 client can keep tools/list for 5 minutes, and a
  2025-era client keeps it until it connects again (the server says listChanged but never sends that notice). So a role change
  shows late in a client, and tools/call always checks.
- The AI switches (role rights version 2, design section 5.12; `aiSwitches.ts`). Each tool of both lists has exactly one AI switch, from
  `MCP_TOOLS_BY_SWITCH` (`src/api/rightsCatalog.ts`, the catalog JSON in `docs/superpowers/specs`): `ai.readWork` (17 reads, `pictures.get`
  included), `ai.readChats` (3), `ai.todos` (9), `ai.posts` (2), `ai.messages` (2), `ai.meetings` (4), `ai.tracker` (3), `ai.projects` (5),
  `ai.payments` (4), `ai.feedback` (3), `ai.report` (1) and `ai.undo` (2). `madar.readFirst` and `story.start` need only `ai.connect`.
  `ai.undoOthers` has no tool: the Undo rule of the History reads it (`history.ts`, another track). A new tool needs a line in the catalog
  and a test fails without it (`aiSwitches.test.ts`).
  - The list: `toolsFor` (`app.ts`) shows a tool when the person holds its AI switch AND, for a right tool, its right. A tool that no
    switch opens never shows. A request with no person gets no tool.
  - The call: a tool whose AI switch is off fails with `forbidden`, the reason `ai_off` and `details.right` (the switch). The message names
    the switch in the words of the role sheet and tells the agent to tell its person. `app.ts` puts the name of the called tool into
    the request, and the factory registers that one tool as a stub that returns the refusal, so the SDK answers in both eras and reads no
    argument. A tool that only the right of the person closes stays an unknown tool (-32602).
  - `ai.connect` off: the approval is refused (`approval.ts`, and `approveClient`, `answerConsent` and `authorizationDetails` in
    `oauth/ops.ts`, which serve the own route `/agents/approve`), `ensureAgentUser` makes no user and no link, and every request of every
    agent of the person gets 403 with the reason `ai_off` before the body is read, also `server/discover` and `tools/list`. Listing and
    removing the own agents stays free (`server/calls/agents.ts`). The check reads the person with `withRights`, never the agent user.
  - `rightsOf` adds the needed switches, and every `ai.*` switch needs `ai.connect`. So `ai.connect` is off only when the stored role also
    turns off the other AI switches, as the role sheet does. A stored list that turns off `ai.connect` alone still holds it.
  - `madar.readFirst` lists the AI switches that are on, the ones that are off (with the tools that each one closes) and the scope of
    `ai.undoOthers` (`aiSwitchLines`, `docs.ts`; `run.ts` passes `rightsOf`).
  - `INSTRUCTIONS` says in two lines that the Admin decides what each role and its assistants may do and that a closed call fails with
    `ai_off` or `forbidden`. `TOOL_DOCS` name the switch of the leader powers (`project.details`, `project.stages`, `project.archive`,
    `project.deadlines`, `task.review`) and of the money, the report and the requests (`payment.*`, `report.office`, `feedback.manage`).
- 60 tool calls a minute for each person (`TOOL_CALLS_PER_MINUTE`, `app.ts`).
- Stage dates (owner, fbk_023): `stages.setDates` is on `MCP_ALLOW`. It sets both dates of one stage, as the Schedule tab does, for the
  project leader and the Admin by default (`project.stages`, with the scope of the person); an agent of a person without it gets `forbidden`. It needs no reason: the
  call never asks for one, so it has no `dateReason` field (that field belongs to `tasks.update`). The stages sit in time order by
  their dates, so new dates can move the current stage of the project and its health. `stages.replace` and `stages.setPrerequisites`
  stay on `MCP_DENY`: an agent does not add, remove, rename or reorder stages, or change what a stage needs. INSTRUCTIONS has a
  Stages paragraph that says: change a stage date only when the person asks. The tests are in `stageDates.test.ts`.
- Two refusals need a reason from the person (`reasons.ts`): a move back to an earlier stage and a change of set dates. They
  answer with `input_required`. The agent must ask its person, never invent the reason.

## Token and approval
- The MCP token: ES256, `aud` = MCP_URL (set by the token hook from `platform_config.mcp_url`), `client_id` required, read
  only from the Authorization header. Every 401 carries `WWW-Authenticate` with `resource_metadata`.
- Madar records its own approval before Auth approves (`approval.ts`). Reason: Auth lets an agent token approve a client itself.
- The consent screen is `src/features/oauth/`. `safeRedirect` (`knownHosts.ts`) refuses script schemes. An unknown host gets
  a warning.
- An agent user is reused only for the same person, the same app name and the same sorted set of redirect addresses
  (`agentUser.ts`).
- An agent user is named after its person and its AI app (owner, 2026-10-12): "<first name> <app> Agent", for example "Osama Claude
  Agent", and "وكيل <first name> <app>" when the person has an Arabic name (`agentNamesOf`, `src/lib/agentName.ts`). With no app name it
  reads "Osama Agent". `agent_links.client_name` keeps the plain app name: the match of a reconnect reads it, never the user name.
  The migration `20261012000100_agent_names.sql` gave the names to the agents that existed (only an agent that still had its app
  name, so a name that an Admin set stays). Change the function and the migration together.
- A removed link never links again (`agent_removed`). Turn-off of a person runs `agents.revokeAll` (`revokeAll.ts`).
- An agent never joins a team. An agent never changes an email.
- Open risk (owner decision, Z7): an agent token has the person's full rights on the own endpoints of Auth.

## Tests
- `npm run test:mcp`: the MCP tests, then the official conformance runner (`conformance.ts`, known gaps in
  `conformance-baseline.yml`).
- The runner serves its own mcp function. Never run a shared `supabase functions serve` next to it.
- The runner leaves its agent in the public office. Run `npx supabase db reset` after it, before `test:it`.
- `aiRoles.testing.ts` gives the tests a role with some switches off (`roleWithout`, `giveRole`, `builtInWithout`). Turn `ai.connect` off with
  `offWith('ai.connect')`: it turns the other AI switches off too, as the role sheet does.
- The deploy suite (`tests/e2e-deploy/agents.spec.ts`) needs `MADAR_E2E_MCP_URL`. It removes its grant at the end.
- A live check of a tool on the test copy needs no browser (2026-10-21): a one-off script signs in the sample member with the
  password grant (`secrets/test-accounts.env`, never printed), registers a client, sends the authorize step, then the steps of the
  consent screen (GET `/auth/v1/oauth/authorizations/<id>`, POST `api/agents/approve`, POST `.../consent` with `approve`), and
  trades the code for the agent token. At the end it revokes the grant (DELETE `/auth/v1/user/oauth/grants?client_id=`) and runs
  `agents.remove` through `api/batch` (with `X-Madar-Build`), so no agent stays in Settings, Agents.

## The own OAuth server (Supabase exit, wave 2)
- `oauth/`: the documents (issuer = MCP_URL; the same document at `/mcp/.well-known/oauth-authorization-server` and
  `/mcp/.well-known/openid-configuration`), Dynamic Client Registration of public clients (PKCE S256, no secret), authorize (to
  `/oauth/consent?authorization_id=`), the consent with the Madar approval inside, the token step (code once, 60 s; refresh
  rotation), the grants of Settings, Agents.
- The approval: the consent gives a code only after `POST /api/agents/approve` with a browser token. Every own route refuses an
  agent token, so the open risk of Z7 (an agent token with the full rights of its person at Auth) does not exist on the own stack.
  So the consent screen of the own stack leaves out the line "can also use your account outside the Madar screens"
  (`agentReachesAccount: false` of `madarOAuthPort`, `src/features/oauth/oauthPort.tsx`).
- A request belongs to the first person who opens it; for anyone else it reads as unknown, with no client name.
- A remove in Settings, Agents (`oauth.revoke`) ends the agent sessions and the approval of that AI app, so its next connection
  shows the consent screen and needs the Madar approval again. The consent refuses an app whose link the person removed
  (`agent_removed`), also when an old approval stays.
- No Client ID Metadata Document: it is a fetch, and the office object does no network work.
- MCP clients try `/.well-known/oauth-authorization-server/mcp` first. Exit wave 4 adds the two Pages Functions
  (`functions/.well-known/`, logic in `server/http/pagesWellKnown.ts`): they answer only for a copy with the word office, and
  every other copy answers 404. A client of such a copy finds `/mcp/.well-known/openid-configuration`.
- On SQLite, `agents.revokeAll` runs inside the transaction of the turn-off (no outbox row), and `agents.remove` ends the agent
  sessions with the links. `liteAgentOf` (`oauth/agent.ts`) is the agent check of the office object.
- On the office path (the merge of exit waves 2 and 3), the object runs the whole MCP app for each request (`Office.mcp`,
  `server/office/parts.ts`): the own issuer, the own agent token check, `liteAgentOf`, `mountOAuth`, and each tool call on the
  batch path of the object (the who kind `agent`). No region hop runs in the object. No tool, `TOOL_DOCS` line or `INSTRUCTIONS`
  rule changed in the merge.
- No tool, `TOOL_DOCS` line or `INSTRUCTIONS` rule changed in wave 2: an agent never reads the connect flow; its AI app runs it.
- Exit wave 4: on the office path `/mcp` runs inside the office object, as above, and the deploy suite on the office path
  (`agents.spec.ts`) uses the own OAuth routes under `/mcp` (register, authorize, token). The day cap of the test Worker counts a
  request of `/mcp` itself as a write and the OAuth routes as reads (`server/office/cap.ts`). No tool, `TOOL_DOCS` line or
  `INSTRUCTIONS` rule changed in wave 4.
- Reminders and lines (owner, 2026-10-19): `INSTRUCTIONS` has a "Pauses:" line (the restart date `project.pause.resumeOn` is a reminder, and
  Madar never restarts a project by itself) and `projects.setStatus` says it. `projects.setRestart` is on the deny list with Pause and Resume.
  `comments.list` gives `kind` (`message`, `due_date`, `start_date`, `shifted`, `reopened`) and `chats.list` gives `previewKind`: a line is
  no message and never waits for a reply. `dashboard.get` gives `workload.unassigned` (the No lead row). Tests: `pauseDocs.test.ts`,
  `dashboardDocs.test.ts`.
- `server/mcp/oauth/sdk.test.ts` runs the whole flow with `@modelcontextprotocol/sdk` 1.32.0 on node:sqlite.
- Words (owner, 2026-10-20): `INSTRUCTIONS` has a "Words:" paragraph. The screens call a task a "to-do", and the Tasks tab holds To-dos and Meetings. The calls and
  the tools keep the word "tasks". Test: `officeDocs.test.ts`.

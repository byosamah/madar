# AI agents (MCP)

An agent (Claude, ChatGPT and others) acts for one person, with that person's rights. It connects to
https://madar.vado.sa/mcp. The test copy is https://preview.madar-46r.pages.dev/mcp.
Connect Claude Code with `claude mcp add --transport http madar https://madar.vado.sa/mcp`.

## The path of a request
1. The Pages Function `functions/mcp/[[path]].ts` runs `server/http/pagesMcpProxy.ts`. It forwards the request to the mcp
   function of the host's Supabase project, with `x-region: eu-central-1`.
2. The proxy has a fixed host list (`MCP_TARGETS`). Any other host, any path outside `/mcp`, and any encoded dot, encoded
   slash or backslash gets 404. It drops the `cf-*` headers and the client address headers.
3. The mcp function (`entries/mcp.ts`, `app.ts`). A request that comes straight to Supabase gets one region hop first
   (`forward.ts`, `MCP_FORWARD_REGION`, default eu-central-1).
4. The token check (`auth.ts`). Then the tool runs through `runCall` with the person's rights (`run.ts`).

## The address
- MCP_URL in `secrets/<env>.env` is the short address. It is the token audience, the resource metadata and the
  `WWW-Authenticate` value. `scripts/deploy/secrets.ts` copies it into `platform_config.mcp_url`.
- If the address changes, change MCP_URL, run the secrets step, and change `MCP_TARGETS` in the same commit.

## Tools
- MCP spec 2026-07-28, stateless. A 2025-era client gets the stateless legacy answer.
- 37 tools (15 reads, 22 writes) in `MCP_ALLOW` (`tools.ts`). Every other call is in `MCP_DENY`. A test fails for a call
  in neither list, so every new shared call goes into one of them.
- Each tool needs a title and a description in `TOOL_DOCS` (`docs.ts`). Write them short, exact, in plain English.
- `madar.readFirst` gives the agent the instructions and the person it acts for, by the English name.
- `users.list` gives both names (`name`, `nameAr`) and leaves picture data out of `avatarUrl` (`run.ts`).
- 60 tool calls a minute for each person (`TOOL_CALLS_PER_MINUTE`, `app.ts`).
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
- A removed link never links again (`agent_removed`). Turn-off of a person runs `agents.revokeAll` (`revokeAll.ts`).
- An agent never joins a team. An agent never changes an email.
- Open risk (owner decision, Z7): an agent token has the person's full rights on the own endpoints of Auth.

## Tests
- `npm run test:mcp`: the MCP tests, then the official conformance runner (`conformance.ts`, known gaps in
  `conformance-baseline.yml`).
- The runner serves its own mcp function. Never run a shared `supabase functions serve` next to it.
- The runner leaves its agent in the public office. Run `npx supabase db reset` after it, before `test:it`.
- The deploy suite (`tests/e2e-deploy/agents.spec.ts`) needs `MADAR_E2E_MCP_URL`. It removes its grant at the end.

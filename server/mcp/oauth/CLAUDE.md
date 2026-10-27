# Own OAuth server

The OAuth server of the MCP layer (`server/mcp/oauth/`): the documents, client registration, authorize, consent, the token step and the
grants of Settings, Agents. The tools, the token check and the approval are in `server/mcp/CLAUDE.md`.

## Routes
- The documents: issuer = `MCP_URL`. The same document is at `/mcp/.well-known/oauth-authorization-server` and
  `/mcp/.well-known/openid-configuration`.
- Dynamic Client Registration of public clients (PKCE S256, no secret). Authorize sends the browser to `/oauth/consent?authorization_id=`.
- The consent gives a code only after `POST /api/agents/approve` with a browser token (the Madar approval is inside the consent).
  The code works once and lives `CODE_LIFE_MS` (`ops.ts`). The refresh token rotates.
- No Client ID Metadata Document: it is a fetch, and the office object does no network work.
- MCP clients try `/.well-known/oauth-authorization-server/mcp` first. Two Pages Functions (`functions/.well-known/`, logic in
  `server/http/pagesWellKnown.ts`) answer only for a copy with the word `office`. Every other copy answers 404, and a client of
  such a copy finds `/mcp/.well-known/openid-configuration`.

## Rules
- Every own route refuses an agent token. So the open risk of Z7 (an agent token with the full rights of its person at Auth) does not
  exist on the own stack. The consent screen of the own stack leaves out the line "can also use your account outside the Madar screens"
  (`agentReachesAccount: false` of `madarOAuthPort`, `src/features/oauth/oauthPort.tsx`).
- A request belongs to the first person who opens it. For anyone else it reads as unknown, with no client name.
- A remove in Settings, Agents (`oauth.revoke`) ends the agent sessions and the approval of that AI app. Its next connection shows the
  consent screen and needs the Madar approval again. The consent refuses an app whose link the person removed (`agent_removed`), also
  when an old approval stays.
- On SQLite, `agents.revokeAll` runs inside the transaction of the turn-off (no outbox row), and `agents.remove` ends the agent sessions
  with the links. `liteAgentOf` (`agent.ts`) is the agent check of the office object.
- On the office path the object runs the whole MCP app for each request (`Office.mcp`, `server/office/parts.ts`): the own issuer, the own
  agent token check, `liteAgentOf`, `mountOAuth`, and each tool call on the batch path of the object (the who kind `agent`). No region
  hop runs in the object. The day cap counts a request of `/mcp` itself as a write and the OAuth routes as reads (`server/office/cap.ts`).
- An agent never reads the connect flow: its AI app runs it. A change here changes no tool, `TOOL_DOCS` line or `INSTRUCTIONS` rule.

## Tests
- `sdk.test.ts` runs the whole flow with `@modelcontextprotocol/sdk` on node:sqlite. `consent.test.ts` and `register.test.ts` cover the steps.
- The deploy suite on the office path (`tests/e2e-deploy/agents.spec.ts`) uses the own routes under `/mcp` (register, authorize, token).

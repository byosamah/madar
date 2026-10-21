import {
  acceptedContent, createMcpHandler, inputResponse, McpServer, ProtocolError, ProtocolErrorCode, type CallToolResult, type InputRequiredResult,
  type McpHttpHandler, type RequestStateCodec, type ServerContext, type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../../src/api/errors';
import { can, holdsRight } from '../../src/api/permissions';
import { withRights } from '../../src/api/rights';
import { RATE_LITE, RATE_SQL, type LimitResult } from '../auth/rateLimit';
import { requestHost } from '../core/after';
import type { Deps } from '../core/ports';
import { runCall as realRunCall, type RunCall } from '../core/runCall';
import type { OfficeSnapshot, Principal } from '../core/types';
import { isLite } from '../data/dialect';
import { readOffice } from '../data/officeCache';
import { runErrorOf } from '../http/errors';
import { readBody } from '../http/limits';
import { ensureAgentUser } from './agentUser';
import { aiOffError, aiSwitchOf, assertMayConnect } from './aiSwitches';
import { agentPrincipalResolver, agentTokenCheckerOf, authIssuerOf, type AgentPrincipal, type AgentToken, type AgentTokenChecker } from './auth';
import { INSTRUCTIONS } from './docs';
import { forwardOnce, hopKeyFrom } from './forward';
import { challengeOf, METADATA_PATH, metadataResponse } from './metadata';
import { argsDigest, askFor, canElicit, ReasonAnswer, reasonCodec, reasonFor, retryText, stateKeyFrom, type ReasonAnswers, type ReasonState } from './reasons';
import { errorResult, runTool, toolResult } from './run';
import { allTools, toolOfOffSwitch, visibleTools, type ToolDef } from './tools';

/**
 * The MCP 2026-07-28 server (plan 5.6; task G3), on @modelcontextprotocol/server 2.3.0. The entries mount it at /mcp: the mcp
 * function on Supabase, and the Workers fallback. Each request, in this order:
 *
 *   1. The region hop (forward.ts): a request outside MCP_FORWARD_REGION goes once to Frankfurt, before any other step.
 *   2. Origin: present and not one of ALLOWED_ORIGINS gives 403 (the SDK handler checks no Origin). AI apps send none.
 *   3. GET /mcp/oauth-protected-resource: the metadata (metadata.ts), with no token.
 *   4. Only POST reaches the MCP endpoint: GET and DELETE get 405 (no sessions, no GET stream).
 *   5. The token (auth.ts): aud = MCP_URL, client_id required. Any refusal is 401 with WWW-Authenticate.
 *   6. The agent: the agent link with one statement, ensureAgentUser on the first call of a new approval, the session check. A person
 *      without the switch ai.connect stops here: 403, reason ai_off (aiSwitches.ts).
 *   7. The body (256 KB at most). A 2025-era batch with more than one tools/call gets 400 (-32600): the limit counts one hit for
 *      each request, and 2025-06-18 and 2026-07-28 have no batches. A tools/call counts against 60 tool calls a minute for each
 *      person, over all the person's agents (rate_limits); the 61st gets 429 with Retry-After. The same statement notes when the
 *      agent link was last used.
 *   8. The SDK handler (createMcpHandler, legacy 'stateless', JSON answers): server/discover, tools/list (the tools of the AI switches
 *      and rights of the person: 57 for an Admin; fixed order, 5 minutes, private), tools/call (run.ts, reasons.ts). A 2025-era
 *      client gets the stateless legacy answer.
 */

/** Set by vite.server.config.ts (releaseVersion): "1.0.<number of commits>". Tests and scripts run without the build. */
declare const __MADAR_SERVER_VERSION__: string | undefined;

/**
 * The version of this release of the server. A client such as claude.ai keeps its tool list for one server version, so each
 * release names a new one; a fixed "1.0.0" kept the message tools away from it (owner, 2026-10-12).
 */
export const SERVER_VERSION: string = typeof __MADAR_SERVER_VERSION__ === 'string' ? __MADAR_SERVER_VERSION__ : '1.0.0';

export const SERVER_INFO = { name: 'madar', title: 'Madar', version: SERVER_VERSION } as const;

type ServerIcon = { src: string; mimeType: string; sizes: string[] };
type ServerInfo = { name: string; title: string; version: string; websiteUrl?: string; icons?: ServerIcon[] };

/**
 * The serverInfo of the MCP answer. On an https address it names the Madar logo on the same site (public/icons), so a client
 * shows the Madar icon and not the icon of the parent domain vado.sa (owner, 2026-10-05). An icon address must be https, so a
 * plain http address (the local stack) gets no icon and no site.
 */
export function serverInfoFor(mcpUrl: string): ServerInfo {
  const url = new URL(mcpUrl);
  if (url.protocol !== 'https:') return { ...SERVER_INFO };
  const icon = (size: number): ServerIcon => ({ src: `${url.origin}/icons/madar-${size}.png`, mimeType: 'image/png', sizes: [`${size}x${size}`] });
  return { ...SERVER_INFO, websiteUrl: url.origin, icons: [icon(192), icon(512)] };
}
export const TOOL_CALLS_PER_MINUTE = 60;
const MINUTE_MS = 60_000;

/**
 * What app.ts puts in AuthInfo.extra for the tools of one request. callName: the tool that the request calls, when it is a tools/call
 * (a call of a tool with an AI switch that is off gets the ai_off answer, not the answer of an unknown tool).
 */
type RequestExtra = { userId: string; ownerId: string; principal: Principal; office: OfficeSnapshot; callName?: string };

export type McpLimit = (deps: Deps, o: { ownerId: string; clientId: string; now: Date }) => Promise<LimitResult>;

export type McpAppOptions = {
  checkToken?: AgentTokenChecker;
  agentOf?: (deps: Deps, token: AgentToken, office: () => Promise<OfficeSnapshot>) => Promise<AgentPrincipal>;
  runCall?: RunCall;
  readOffice?: (deps: Deps) => Promise<OfficeSnapshot>;
  limit?: McpLimit;
  fetch?: typeof fetch;
  /** The server secret key: the requestState key (reasons.ts) and the hop key (forward.ts) come from it. */
  secretKey?: string;
  /** A fixed requestState key, for tests. */
  stateKey?: Uint8Array | string;
  /** The issuer of Auth, when it differs from AUTH_ISSUER or ${SUPABASE_URL}/auth/v1. */
  issuer?: string;
  /** The OAuth routes of the own sign-in (Supabase exit, wave 2): the host of the office object passes mountOAuth. No Supabase entry has them. */
  oauth?: (app: Hono) => void;
};

/** The rate limit of tool calls, and the last use of the agent link, in one statement. */
export const MCP_LIMIT_SQL =
  "with seen as (update agent_links set last_used_at = now() where client_id = $3::uuid and (last_used_at is null or last_used_at < now() - interval '1 minute')) " +
  RATE_SQL;

/** The SQLite form of the last use (Supabase exit, wave 2): ?1 client, ?2 now, ?3 one minute before now. */
export const MCP_SEEN_LITE = 'update agent_links set last_used_at = ?2 where client_id = ?1 and (last_used_at is null or last_used_at < ?3)';

export const sqlMcpLimit: McpLimit = async (deps, o) => {
  const start = Math.floor(o.now.getTime() / MINUTE_MS) * MINUTE_MS;
  let count: number;
  if (isLite(deps.db)) {
    // SQLite has no update inside a with clause: two statements in one transaction.
    count = await deps.db.tx('write', async (q) => {
      await q(MCP_SEEN_LITE, [o.clientId, o.now.toISOString(), new Date(o.now.getTime() - MINUTE_MS).toISOString()]);
      const [row] = await q<{ count: number }>(RATE_LITE, [`mcp:${o.ownerId}`, new Date(start).toISOString()]);
      return Number(row?.count ?? 0);
    });
  } else {
    const [row] = await deps.db.statement<{ count: number | string }>('write', MCP_LIMIT_SQL, [`mcp:${o.ownerId}`, new Date(start).toISOString(), o.clientId]);
    count = Number(row?.count ?? 0);
  }
  return { ok: count <= TOOL_CALLS_PER_MINUTE, count, retryAfterMs: start + MINUTE_MS - o.now.getTime() };
};

/** The default agent of a token: the SQL of auth.ts and ensureAgentUser. */
function sqlAgentOf(deps: Deps, token: AgentToken, office: () => Promise<OfficeSnapshot>): Promise<AgentPrincipal> {
  return agentPrincipalResolver({
    query: (text, values) => deps.db.statement('read', text, values),
    office,
    ensure: async (o) => void (await ensureAgentUser(deps, o)),
  })(token);
}

/** The tool arguments as a Standard Schema: the zod check of tools.ts, and the exact JSON Schema that tools.test.ts checks. */
function argumentsOf(tool: ToolDef): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'madar',
      validate: (value: unknown) => {
        const parsed = tool.input.safeParse(value);
        // The arguments go on as they came: runCall parses them again with the wire form of the call.
        return parsed.success ? { value } : { issues: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })) };
      },
      jsonSchema: { input: () => tool.inputSchema, output: () => ({ type: 'object' }) },
    },
  } as StandardSchemaWithJSON;
}

function jsonRpcError(status: number, message: string, o: { id?: unknown; reason?: string; headers?: Record<string, string> } = {}): Response {
  const error = { code: status, message, ...(o.reason ? { data: { reason: o.reason } } : {}) };
  return Response.json({ jsonrpc: '2.0', id: o.id ?? null, error }, { status, headers: o.headers ?? {} });
}

const hasText = (value: unknown) => typeof value === 'string' && value.trim() !== '';

/** The tools of one request, bound to its agent. */
async function callTool(tool: ToolDef, args: Record<string, unknown>, ctx: ServerContext, deps: Deps, run: RunCall, codec: RequestStateCodec<ReasonState>): Promise<CallToolResult | InputRequiredResult> {
  const extra = ctx.http?.authInfo?.extra as RequestExtra | undefined;
  if (!extra) throw new ProtocolError(ProtocolErrorCode.InternalError, 'The request has no agent.');
  const input: Record<string, unknown> = { ...args };
  // The answers of earlier rounds of this call. The digest always comes from the client's own arguments, never from these.
  let answers: ReasonAnswers = {};

  // The retry of an input_required answer: the SDK verified the signature, the expiry and the agent of the state already.
  const state = ctx.mcpReq.requestState<ReasonState>();
  if (state !== undefined) {
    if (state.tool !== tool.name || state.digest !== (await argsDigest(tool.name, args))) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'This requestState belongs to another call. Call the tool again without it.');
    }
    answers = { ...state.answers };
    const answer = acceptedContent(ctx.mcpReq.inputResponses, state.field, ReasonAnswer);
    if (answer) {
      answers[state.field] = answer.text;
    } else {
      const view = inputResponse(ctx.mcpReq.inputResponses, state.field);
      if (view.kind === 'elicit' && view.action !== 'accept') {
        return errorResult({ code: 'invalid_input', message: 'The person gave no reason, so nothing changed.', details: { fields: [state.field], reason: 'reason_declined' } });
      }
      const ask = { field: state.field, question: reasonFor({ code: 'invalid_input', message: '', details: { reason: state.field === 'reason' ? 'stage_back_reason' : 'date_reason_needed' } })!.question };
      return askFor(tool.name, args, ask, codec, ctx, answers);
    }
    Object.assign(input, answers);
  }

  const result = await runTool(tool, input, { deps, principal: extra.principal, office: extra.office, runCall: run });
  if (!result.ok) {
    const ask = reasonFor(result.error);
    if (ask && !hasText(input[ask.field])) {
      if (canElicit(ctx)) return askFor(tool.name, args, ask, codec, ctx, answers);
      return errorResult(result.error, retryText(tool.name, ask));
    }
  }
  return toolResult(tool, result);
}

/** The test of one switch or right for the person of the request: the rights of the person in the office of this request. */
function heldOf(extra: RequestExtra | undefined): { held: (id: string) => boolean; admin: boolean } | undefined {
  const person = extra ? extra.office.lists.users[extra.ownerId] : undefined;
  if (!extra || person === undefined) return undefined;
  const actor = withRights(extra.office.lists, person);
  return { held: (id) => holdsRight(actor, id), admin: can(actor, 'admin.manage') };
}

/**
 * The tools of one request (owner, 2026-10-07; rights, 2026-10-18; role rights version 2, 2026-10-21). A tool goes to an agent only when
 * its person holds the AI switch of the tool (aiSwitches.ts) and, for a right tool (tools.ts, MCP_BY_RIGHT), its right: the payment
 * switches, the Dashboard, Search, the report right, or the feedback right for the tools of requests and bugs (role-rights, 2026-10-23).
 * The Admin tools (MCP_ADMIN, none today) go only to an agent whose person has admin.manage. The check reads the person with the office
 * rights, never the agent user. An agent has the role member (agentUser.ts), and the handler checks the same right. With no person, the
 * request gets no tool. A role change shows on the next request. A client can keep its tools/list for 5 minutes. A tools/call of a
 * tool that is not registered fails before runCall.
 */
function toolsFor(all: ToolDef[], extra: RequestExtra | undefined): ToolDef[] {
  const who = heldOf(extra);
  return who ? visibleTools(all, who.held, who.admin) : [];
}

/**
 * The tool of a tools/call whose AI switch is off for the person, or undefined. The server registers it as a stub for this call only,
 * so the answer is forbidden with the reason ai_off, which names the switch. It never shows in a list.
 */
function offToolOf(all: ToolDef[], extra: RequestExtra | undefined): ToolDef | undefined {
  const who = heldOf(extra);
  return who && extra?.callName !== undefined ? toolOfOffSwitch(all, who.held, extra.callName) : undefined;
}

function handlerOf(deps: Deps, run: RunCall, codec: Promise<RequestStateCodec<ReasonState>>): McpHttpHandler {
  const all = allTools();
  const info = serverInfoFor(deps.config.mcpUrl);
  // The SDK calls the factory once for each request, in both eras, with the authInfo of that request.
  return createMcpHandler(async ({ authInfo }) => {
    const extra = authInfo?.extra as RequestExtra | undefined;
    const tools = toolsFor(all, extra);
    const off = offToolOf(all, extra);
    const stateCodec = await codec;
    const server = new McpServer({ ...info }, {
      instructions: INSTRUCTIONS,
      capabilities: { tools: {} },
      cacheHints: {
        // 5 minutes, as the tool list: a new release (a new server version) reaches a client soon (owner, 2026-10-12).
        'server/discover': { ttlMs: 300_000, cacheScope: 'public' },
        'tools/list': { ttlMs: 300_000, cacheScope: 'private' },
      },
      requestState: { verify: (value, ctx) => stateCodec.verify(value, ctx) },
    });
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: argumentsOf(tool), annotations: tool.annotations },
        ((args: Record<string, unknown>, ctx: ServerContext) => callTool(tool, args ?? {}, ctx, deps, run, stateCodec)) as never,
      );
    }
    if (off) {
      // The arguments are not read: a switch that is off refuses the call whatever it holds.
      const refused = errorResult(runErrorOf(aiOffError(aiSwitchOf(off.name)!)));
      server.registerTool(
        off.name,
        { title: off.title, description: off.description, inputSchema: argumentsOf({ ...off, input: z.looseObject({}) }), annotations: off.annotations },
        (() => refused) as never,
      );
    }
    return server;
  }, {
    legacy: 'stateless',
    responseMode: 'json',
    onerror: (error) => deps.log.warn('The MCP handler refused a request.', { error: error.message }),
  });
}

/** The tools/call entries of a body: one JSON-RPC message, or a 2025-era batch. */
function toolCallsIn(body: unknown): { count: number; id: unknown; name?: string } {
  const messages = Array.isArray(body) ? body : [body];
  const calls = messages.filter((m) => m && typeof m === 'object' && (m as { method?: unknown }).method === 'tools/call');
  const first = messages[0] as { id?: unknown } | undefined;
  const name = (calls[0] as { params?: { name?: unknown } } | undefined)?.params?.name;
  return { count: calls.length, id: first && typeof first === 'object' ? (first.id ?? null) : null, ...(typeof name === 'string' ? { name } : {}) };
}

export function mcpApp(deps: Deps, o: McpAppOptions = {}): Hono {
  const { config } = deps;
  const issuer = o.issuer ?? authIssuerOf(config.supabaseUrl, config.mcpUrl);
  const checkToken = o.checkToken ?? agentTokenCheckerOf({ supabaseUrl: config.supabaseUrl, mcpUrl: config.mcpUrl, issuer });
  const agentOf = o.agentOf ?? sqlAgentOf;
  const officeOf = o.readOffice ?? ((d: Deps) => readOffice(d));
  const limit = o.limit ?? sqlMcpLimit;
  const codec = (async () => {
    if (o.stateKey !== undefined) return reasonCodec(o.stateKey);
    if (o.secretKey !== undefined) return reasonCodec(await stateKeyFrom(o.secretKey));
    // No secret: a key of this isolate only, so a reason asked here is answered only here.
    deps.log.warn('The MCP server has no secret key, so a reason question works only in this isolate.');
    return reasonCodec(crypto.getRandomValues(new Uint8Array(32)));
  })();
  const handler = handlerOf(deps, o.runCall ?? realRunCall, codec);
  // No secret: no hop key, so a hop goes with the region alone and Frankfurt counts it once.
  const hopKey = o.secretKey !== undefined ? hopKeyFrom(o.secretKey) : Promise.resolve(undefined);

  const unauthorized = (error: ApiError, tokenCame: boolean) => jsonRpcError(401, error.message, {
    ...(typeof error.details.reason === 'string' ? { reason: error.details.reason } : {}),
    headers: { 'WWW-Authenticate': challengeOf(config.mcpUrl, tokenCame ? { error: 'invalid_token', description: error.message } : {}) },
  });

  const refusal = (error: unknown, tokenCame: boolean): Response => {
    if (error instanceof ApiError) {
      if (error.code === 'unauthenticated' && error.details.reason === 'account_off') return jsonRpcError(403, error.message, { reason: 'account_off' });
      if (error.code === 'unauthenticated') return unauthorized(error, tokenCame);
      if (error.code === 'forbidden') return jsonRpcError(403, error.message, typeof error.details.reason === 'string' ? { reason: error.details.reason } : {});
    }
    deps.log.error('The MCP sign-in check failed.', { error: error instanceof Error ? error.message : String(error) });
    return jsonRpcError(500, 'Something went wrong. Try again.');
  };

  const app = new Hono();

  app.use('*', async (c, next) => {
    const hopped = await forwardOnce(c.req.raw, { config, fetch: o.fetch, log: deps.log, hopKey: await hopKey });
    if (hopped) return hopped;
    const origin = c.req.header('Origin');
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) return jsonRpcError(403, 'This origin may not call Madar\'s MCP server.');
    await next();
  });

  o.oauth?.(app);

  app.get(METADATA_PATH, () => metadataResponse({ mcpUrl: config.mcpUrl, issuer }));

  app.all('/', async (c) => {
    const request = c.req.raw;
    if (request.method !== 'POST') return jsonRpcError(405, 'Madar\'s MCP server takes POST only.', { headers: { Allow: 'POST' } });

    const header = request.headers.get('Authorization');
    let token: AgentToken;
    let agent: AgentPrincipal;
    let office: OfficeSnapshot | undefined;
    const officeOnce = async () => (office ??= await officeOf(deps));
    try {
      token = await checkToken(header);
      agent = await agentOf(deps, token, officeOnce);
      // A new agent user changed the office: read it again, so the actor check sees the agent.
      if (agent.linked) office = undefined;
      await officeOnce();
      // Connect AI assistants off: every request of every agent of this person stops here, at once (role rights version 2).
      assertMayConnect(office!, agent.ownerId);
    } catch (error) {
      return refusal(error, header !== null);
    }

    let text: string;
    try {
      text = await readBody(request);
    } catch {
      return jsonRpcError(413, 'The request is too large.', { reason: 'too_large' });
    }
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // The SDK answers a body that is not JSON with its own parse error.
    }
    const calls = toolCallsIn(body);
    if (calls.count > 1) {
      return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one tool call in each request.' } }, { status: 400 });
    }
    if (calls.count > 0) {
      const hit = await limit(deps, { ownerId: agent.ownerId, clientId: token.clientId, now: deps.clock.now() });
      if (!hit.ok) {
        return jsonRpcError(429, `Too many tool calls: at most ${TOOL_CALLS_PER_MINUTE} a minute for one person, over all of that person's agents. Wait, then try again.`, {
          id: calls.id, reason: 'rate_limited', headers: { 'Retry-After': String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))) },
        });
      }
    }

    const extra: RequestExtra = {
      userId: agent.principal.userId, ownerId: agent.ownerId, principal: agent.principal, office: office!,
      ...(calls.name !== undefined ? { callName: calls.name } : {}),
    };
    const response = await handler.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: text }), {
      authInfo: {
        token: token.token, clientId: token.clientId, scopes: [], resource: new URL(config.mcpUrl),
        ...(token.expiresAt !== undefined ? { expiresAt: token.expiresAt } : {}),
        extra,
      },
    });

    return response;
  });

  app.notFound(() => jsonRpcError(404, 'This address does not exist.'));
  app.onError((error) => {
    deps.log.error('The MCP app failed.', { error: error instanceof Error ? error.message : String(error) });
    return jsonRpcError(500, 'Something went wrong. Try again.');
  });
  return app;
}

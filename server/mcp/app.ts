import {
  acceptedContent, createMcpHandler, inputResponse, McpServer, ProtocolError, ProtocolErrorCode, type CallToolResult, type InputRequiredResult,
  type McpHttpHandler, type RequestStateCodec, type ServerContext, type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { ApiError } from '../../src/api/errors';
import { RATE_SQL, type LimitResult } from '../auth/rateLimit';
import type { Deps } from '../core/ports';
import { runCall as realRunCall, type RunCall } from '../core/runCall';
import type { OfficeSnapshot, Principal } from '../core/types';
import { readOffice } from '../data/officeCache';
import { readBody } from '../http/limits';
import { ensureAgentUser } from './agentUser';
import { agentPrincipalResolver, agentTokenCheckerOf, authIssuerOf, type AgentPrincipal, type AgentToken, type AgentTokenChecker } from './auth';
import { INSTRUCTIONS } from './docs';
import { forwardOnce, HOP_HEADER, hopKeyFrom, hopTagOk } from './forward';
import { challengeOf, METADATA_PATH, metadataResponse } from './metadata';
import { argsDigest, askFor, canElicit, ReasonAnswer, reasonCodec, reasonFor, retryText, stateKeyFrom, type ReasonAnswers, type ReasonState } from './reasons';
import { errorResult, runTool, toolResult } from './run';
import { mcpTools, type ToolDef } from './tools';

/**
 * The MCP 2026-07-28 server (plan 5.6; task G3), on @modelcontextprotocol/server 2.3.0. The entries mount it at /mcp: the mcp
 * function on Supabase, and the Workers fallback. Each request, in this order:
 *
 *   1. The region hop (forward.ts): a request outside MCP_FORWARD_REGION goes once to Frankfurt, before any other step.
 *   2. Origin: present and not one of ALLOWED_ORIGINS gives 403 (the SDK handler checks no Origin). AI apps send none.
 *   3. GET /mcp/oauth-protected-resource: the metadata (metadata.ts), with no token.
 *   4. Only POST reaches the MCP endpoint: GET and DELETE get 405 (no sessions, no GET stream).
 *   5. The token (auth.ts): aud = MCP_URL, client_id required. Any refusal is 401 with WWW-Authenticate.
 *   6. The agent: the agent link with one statement, ensureAgentUser on the first call of a new approval, the session check.
 *   7. The body (256 KB at most). A 2025-era batch with more than one tools/call gets 400 (-32600): the limit counts one hit for
 *      each request, and 2025-06-18 and 2026-07-28 have no batches. A tools/call counts against 60 tool calls a minute for each
 *      person, over all the person's agents (rate_limits); the 61st gets 429 with Retry-After. The same statement notes when the
 *      agent link was last used.
 *   8. The SDK handler (createMcpHandler, legacy 'stateless', JSON answers): server/discover, tools/list (36 tools, fixed order,
 *      5 minutes, private), tools/call (run.ts, reasons.ts). A 2025-era client gets the stateless legacy answer.
 *   9. The usage meter counts the request, and the extra invocation of a hop whose header carries the server's tag (forward.ts).
 */

export const SERVER_INFO = { name: 'madar', title: 'Madar', version: '1.0.0' } as const;
export const TOOL_CALLS_PER_MINUTE = 60;
const MINUTE_MS = 60_000;

/** What app.ts puts in AuthInfo.extra for the tools of one request. */
type RequestExtra = { userId: string; ownerId: string; principal: Principal; office: OfficeSnapshot };

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
};

/** The rate limit of tool calls, and the last use of the agent link, in one statement. */
export const MCP_LIMIT_SQL =
  "with seen as (update agent_links set last_used_at = now() where client_id = $3::uuid and (last_used_at is null or last_used_at < now() - interval '1 minute')) " +
  RATE_SQL;

export const sqlMcpLimit: McpLimit = async (deps, o) => {
  const start = Math.floor(o.now.getTime() / MINUTE_MS) * MINUTE_MS;
  const [row] = await deps.db.statement<{ count: number | string }>('write', MCP_LIMIT_SQL, [`mcp:${o.ownerId}`, new Date(start).toISOString(), o.clientId]);
  const count = Number(row?.count ?? 0);
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

function handlerOf(deps: Deps, run: RunCall, codec: Promise<RequestStateCodec<ReasonState>>): McpHttpHandler {
  const tools = mcpTools();
  return createMcpHandler(async () => {
    const stateCodec = await codec;
    const server = new McpServer({ ...SERVER_INFO }, {
      instructions: INSTRUCTIONS,
      capabilities: { tools: {} },
      cacheHints: {
        'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
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
    return server;
  }, {
    legacy: 'stateless',
    responseMode: 'json',
    onerror: (error) => deps.log.warn('The MCP handler refused a request.', { error: error.message }),
  });
}

/** The tools/call entries of a body: one JSON-RPC message, or a 2025-era batch. */
function toolCallsIn(body: unknown): { count: number; id: unknown } {
  const messages = Array.isArray(body) ? body : [body];
  const calls = messages.filter((m) => m && typeof m === 'object' && (m as { method?: unknown }).method === 'tools/call');
  const first = messages[0] as { id?: unknown } | undefined;
  return { count: calls.length, id: first && typeof first === 'object' ? (first.id ?? null) : null };
}

export function mcpApp(deps: Deps, o: McpAppOptions = {}): Hono {
  const { config } = deps;
  const issuer = o.issuer ?? authIssuerOf(config.supabaseUrl);
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
      if (error.code === 'forbidden') return jsonRpcError(403, error.message);
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

    const extra: RequestExtra = { userId: agent.principal.userId, ownerId: agent.ownerId, principal: agent.principal, office: office! };
    const response = await handler.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: text }), {
      authInfo: {
        token: token.token, clientId: token.clientId, scopes: [], resource: new URL(config.mcpUrl),
        ...(token.expiresAt !== undefined ? { expiresAt: token.expiresAt } : {}),
        extra,
      },
    });

    // The usage meter: this request, and the invocation of the first region when it hopped (plan 5.6, Region hop).
    try {
      await deps.meter.countRequest(deps.db);
      if (await hopTagOk(request.headers.get(HOP_HEADER), await hopKey)) await deps.meter.countRequest(deps.db);
    } catch (error) {
      deps.log.warn('The usage meter did not count the MCP request.', { error: error instanceof Error ? error.message : String(error) });
    }
    return response;
  });

  app.notFound(() => jsonRpcError(404, 'This address does not exist.'));
  app.onError((error) => {
    deps.log.error('The MCP app failed.', { error: error instanceof Error ? error.message : String(error) });
    return jsonRpcError(500, 'Something went wrong. Try again.');
  });
  return app;
}

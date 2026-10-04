import { createRequestStateCodec, inputRequired, type InputRequiredResult, type RequestStateCodec, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ApiError } from '../../src/api/errors';
import type { RunError } from '../core/types';

/**
 * The reasons an agent must ask its person for (plan 5.6; plan section 2, change 7; platform facts 7.4). Two refusals need a
 * reason in words: a task change that moves the project back to an earlier stage (stage_back_reason, field "reason"), and a change
 * of task dates that were already set (date_reason_needed, field "dateReason").
 *
 * - A client that declared elicitation gets input_required with a form question and a signed requestState. The retry carries the
 *   person's answer; the tool runs again with the answer in the field.
 * - A client that did not declare it gets a tool result with isError: call again with the field. MCP forbids an
 *   elicitation/create request to a client that did not declare it.
 * - The requestState is signed (HMAC-SHA256, 10 minutes), bound to the agent (its client and its user), and holds the tool and a
 *   digest of its arguments, so it never answers another call. The key comes from the server secret key, so no new secret exists.
 * - One call can need both reasons (tasks.update asks for dateReason, then reason). The state keeps the answers given so far, and
 *   the digest comes from the client's own arguments without either reason field, so each round matches the first call.
 */

export type ReasonField = 'reason' | 'dateReason';
export type ReasonAsk = { field: ReasonField; question: string };
export type ReasonAnswers = Partial<Record<ReasonField, string>>;
export type ReasonState = { tool: string; field: ReasonField; digest: string; answers?: ReasonAnswers };

export const REASON_TTL_SECONDS = 600;
export const REASON_MAX = 280;
/** The answer form. The handlers trim a reason and keep at most 280 characters. */
export const ReasonAnswer = z.object({ text: z.string().trim().min(1).max(REASON_MAX) });

export function reasonFor(error: ApiError | RunError): ReasonAsk | null {
  const details = error.details ?? {};
  if (error.code !== 'invalid_input') return null;
  if (details.reason === 'stage_back_reason') {
    const stage = typeof details.stageName === 'string' ? `"${details.stageName}"` : 'an earlier stage';
    return { field: 'reason', question: `This change moves the project back to ${stage}. Why does it move back?` };
  }
  if (details.reason === 'date_reason_needed') {
    return { field: 'dateReason', question: 'This change moves task dates that were already set. Why do the dates change?' };
  }
  return null;
}

export function retryText(tool: string, ask: ReasonAsk): string {
  return [
    `This change needs a reason in words. ${ask.question}`,
    `Ask your person, then call ${tool} again with the same arguments plus "${ask.field}": the person's words (at most ${REASON_MAX} characters).`,
    'Never invent a reason.',
  ].join(' ');
}

/** JSON with sorted keys, so the same arguments in another order give the same digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** sha256 of the tool and its arguments, without both reason fields and storyId (the server and the retry may add or change those). */
export async function argsDigest(tool: string, args: Record<string, unknown>): Promise<string> {
  const { reason: _reason, dateReason: _dateReason, storyId: _story, ...rest } = args;
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${tool}\n${canonical(rest)}`)));
}

/** The requestState key: HMAC-SHA256 of a fixed label under the server secret key. */
export async function stateKeyFrom(secretKey: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('madar.mcp.requestState.v1')));
}

/** The agent of the request: its OAuth client and its user id (AuthInfo.extra.userId, set by app.ts). */
export function bindingOf(ctx: ServerContext): string {
  const auth = ctx.http?.authInfo;
  return `${auth?.clientId ?? ''}\u0000${String(auth?.extra?.userId ?? '')}`;
}

export function reasonCodec(key: Uint8Array | string): RequestStateCodec<ReasonState> {
  return createRequestStateCodec<ReasonState>({ key, ttlSeconds: REASON_TTL_SECONDS, bind: bindingOf });
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * True when the client of this request declared form elicitation (2026-07-28 envelope): "elicitation" with "form", or a bare
 * "elicitation": {} (the 2025 meaning). A client with only URL elicitation gets the retry instruction, never the -32021 refusal.
 */
export function canElicit(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const caps = envelope?.['io.modelcontextprotocol/clientCapabilities'];
  if (!isObject(caps) || !isObject(caps.elicitation)) return false;
  const modes = caps.elicitation;
  return Object.keys(modes).length === 0 || isObject(modes.form);
}

/** The input_required answer: one form question, and the signed state of this call with the answers given so far. */
export async function askFor(tool: string, args: Record<string, unknown>, ask: ReasonAsk, codec: RequestStateCodec<ReasonState>, ctx: ServerContext, answers: ReasonAnswers = {}): Promise<InputRequiredResult> {
  const state: ReasonState = { tool, field: ask.field, digest: await argsDigest(tool, args), ...(Object.keys(answers).length > 0 ? { answers } : {}) };
  return inputRequired({
    inputRequests: {
      [ask.field]: inputRequired.elicit({
        mode: 'form',
        message: ask.question,
        requestedSchema: {
          type: 'object',
          properties: { text: { type: 'string', title: 'Reason', description: 'The reason in the person\'s own words.', minLength: 1, maxLength: REASON_MAX } },
          required: ['text'],
        },
      }),
    },
    requestState: await codec.mint(state, ctx),
  });
}

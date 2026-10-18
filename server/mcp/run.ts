import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Deps } from '../core/ports';
import type { RunCall } from '../core/runCall';
import type { OfficeSnapshot, Principal, RunError, RunResult } from '../core/types';
import { readFirstAnswer } from './docs';
import { READ_FIRST, type ToolDef } from './tools';

/**
 * One tool call of an agent (plan 5.6; task G3). Each tool except madar.readFirst runs its call through runCall, with the agent
 * principal, so the agent gets exactly the rights of its person and every change records both names (spec 1, section 17).
 *
 * - A write that takes a story gets the storyId argument as story { id }: runCall checks that the story belongs to this agent
 *   and is less than a day old (plan 4.9). The other arguments go to the call as they came; runCall parses them with the wire
 *   form of the call.
 * - Each tool call is a batch of one entry: its own story placeholders and the office of this request.
 * - The result: structuredContent { output, storyId? } and the same JSON as text (platform facts 7.2, point 21). An ApiError
 *   gives isError with its code, message and details, so the model can correct itself (point 18).
 */

export type ToolRunCtx = { deps: Deps; principal: Principal; office: OfficeSnapshot; runCall: RunCall };

export async function runTool(tool: ToolDef, args: Record<string, unknown>, ctx: ToolRunCtx): Promise<RunResult> {
  if (tool.name === READ_FIRST) {
    const agent = ctx.office.lists.users[ctx.principal.userId];
    const person = agent?.ownerId ? ctx.office.lists.users[agent.ownerId] : undefined;
    if (!person) return { ok: false, error: { code: 'unauthenticated', message: 'This agent has no active person to act for.', details: { reason: 'account_off' } } };
    return { ok: true, output: readFirstAnswer(person), changed: false };
  }
  const { storyId, ...input } = args;
  const story = tool.takesStory && typeof storyId === 'string' ? { id: storyId } : undefined;
  const result = await ctx.runCall(ctx.deps, {
    principal: ctx.principal,
    name: tool.name,
    input: tool.takesStory ? input : args,
    ...(story ? { story } : {}),
    batch: { storyRefs: new Map(), office: ctx.office, overviewCalls: 0 },
  });
  return result.ok ? { ...result, output: withoutDirectPreviews(tool.name, withoutStorageKeys(tool.name, withoutPictureData(tool.name, result.output))) } : result;
}

/**
 * An agent may send a direct message but never reads one (owner, 2026-10-12). In chats.list a direct chat gives no preview: the last
 * message and its author leave the row. A group gives no preview either, so an agent never reads a group message (fbk_011). A
 * project chat and a task thread keep theirs, because the project team reads them.
 */
function withoutDirectPreviews(name: string, output: unknown): unknown {
  if (name !== 'chats.list' || !Array.isArray(output)) return output;
  return output.map((row: { kind?: unknown }) => (row.kind === 'direct' || row.kind === 'group' ? { ...row, preview: '', previewAuthor: null, previewMine: false } : row));
}

/**
 * users.list gives the profile picture of each person as data of up to 24,000 characters (owner item 10, 2026-10-05). An agent
 * has no use for it, and 15 pictures would fill its context, so a picture saved as data leaves the answer (avatarUrl null).
 */
function withoutPictureData(name: string, output: unknown): unknown {
  // A sub-company logo is picture data too (fbk_007). An agent gets the names, so the logo leaves the answer as well.
  if (name === 'subCompanies.list' && Array.isArray(output)) {
    return output.map((sub: { logo?: unknown }) => (typeof sub.logo === 'string' ? { ...sub, logo: null } : sub));
  }
  if (name !== 'users.list' || !Array.isArray(output)) return output;
  return output.map((user: { avatarUrl?: unknown }) => (typeof user.avatarUrl === 'string' && user.avatarUrl.startsWith('data:') ? { ...user, avatarUrl: null } : user));
}

type Report = { screenshots?: unknown };

/** A report as an agent gets it: each screenshot keeps its type and loses its storage key. */
function shotTypesOnly<T extends Report>(report: T): T {
  if (!Array.isArray(report.screenshots)) return report;
  return { ...report, screenshots: report.screenshots.map((shot: { type?: unknown }) => ({ type: shot.type })) };
}

/**
 * An agent never gets a storage key from the Admin tools of requests and bugs (owner, 2026-10-07). A report row of feedback.list and
 * the report of feedback.setStatus keep the type of each screenshot, and the count stays. feedback.screenshot gives a signed link
 * ({ url, expiresAt }) as it is.
 */
function withoutStorageKeys(name: string, output: unknown): unknown {
  if (name === 'feedback.list' && Array.isArray(output)) return output.map((row: { item?: Report }) => (row.item ? { ...row, item: shotTypesOnly(row.item) } : row));
  if (name === 'feedback.setStatus' && output !== null && typeof output === 'object') return shotTypesOnly(output as Report);
  return output;
}

export function errorResult(error: RunError, text?: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: text ?? JSON.stringify({ error }) }], structuredContent: { error } };
}

export function toolResult(tool: ToolDef, result: RunResult): CallToolResult {
  if (!result.ok) return errorResult(result.error);
  if (tool.name === READ_FIRST) return { content: [{ type: 'text', text: String(result.output) }] };
  const structured: Record<string, unknown> = { output: result.output };
  if (result.storyId !== undefined) structured.storyId = result.storyId;
  return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured };
}

import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Deps } from '../core/ports';
import type { RunCall } from '../core/runCall';
import type { OfficeSnapshot, Principal, RunError, RunResult } from '../core/types';
import type { RoleSettings } from '../../src/api/contract/entities';
import { rightsOf } from '../../src/api/rights';
import { readFirstAnswer, roleNameOf } from './docs';
import { PICTURES_GET, runPicture, withPictureLooks, WITH_PICTURES_TOOLS, type PictureAnswer } from './pictures';
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

/** fetch reads the small picture of a cover (pictures.ts). Tests pass a stub; a host leaves it out and gets the global fetch. */
export type ToolRunCtx = { deps: Deps; principal: Principal; office: OfficeSnapshot; runCall: RunCall; fetch?: typeof globalThis.fetch };

export async function runTool(tool: ToolDef, args: Record<string, unknown>, ctx: ToolRunCtx): Promise<RunResult> {
  if (tool.name === READ_FIRST) {
    const agent = ctx.office.lists.users[ctx.principal.userId];
    const person = agent?.ownerId ? ctx.office.lists.users[agent.ownerId] : undefined;
    if (!person) return { ok: false, error: { code: 'unauthenticated', message: 'This agent has no active person to act for.', details: { reason: 'account_off' } } };
    return { ok: true, output: readFirstAnswer(person, ctx.office.lists.settings.roles, rightsOf(person, ctx.office.lists.settings.roles)), changed: false };
  }
  if (tool.name === PICTURES_GET) return runPicture(args, ctx);
  // withPictures belongs to the tool, not to the call (owner, 2026-10-21).
  const { withPictures, ...callArgs } = WITH_PICTURES_TOOLS.has(tool.name) ? args : { withPictures: undefined, ...args };
  const { storyId, ...input } = callArgs;
  const story = tool.takesStory && typeof storyId === 'string' ? { id: storyId } : undefined;
  const result = await ctx.runCall(ctx.deps, {
    principal: ctx.principal,
    name: tool.name,
    input: tool.takesStory ? input : callArgs,
    ...(story ? { story } : {}),
    batch: { storyRefs: new Map(), office: ctx.office, overviewCalls: 0 },
  });
  return result.ok
    ? { ...result, output: withoutStorageKeys(tool.name, withPictureLooks(tool.name, withLeanLists(tool.name, withRoleNames(tool.name, result.output, ctx.office.lists.settings.roles)), ctx.office, withPictures === true)) }
    : result;
}

/**
 * users.list gives each person's roleId, which is an id such as rol_002. An agent that is asked "who are the site supervisors?" needs the
 * name that the screens show, so each row also gets roleName (INT-19). roleNameOf is the same rule as the line of madar.readFirst.
 */
function withRoleNames(name: string, output: unknown, roles: RoleSettings | undefined): unknown {
  if (name !== 'users.list' || !Array.isArray(output)) return output;
  return output.map((user: { systemRole: Parameters<typeof roleNameOf>[0]['systemRole']; roleId?: string | null }) => ({ ...user, roleName: roleNameOf(user, roles) }));
}

/**
 * The lean lists for project set-up (owner, 2026-10-25). clients.list gives the id, the names and the initials only: the contact name,
 * the phone and the email of a client stay in the screens. projectTemplates.list gives the id, the name, the roles (id, name, default
 * person), the stage names and the number of tasks: no task text, no creator and no number of followers. A fixed list of fields, so a
 * new field of a client or a template never reaches an agent by itself.
 */
function withLeanLists(name: string, output: unknown): unknown {
  if (!Array.isArray(output)) return output;
  if (name === 'clients.list') {
    return output.map((client: { id: string; name: string; nameAr: string; initials?: string }) => ({
      id: client.id, name: client.name, nameAr: client.nameAr, initials: client.initials ?? null,
    }));
  }
  if (name === 'projectTemplates.list') {
    return output.map((template: { id: string; name: string; roles: { id: string; name: string; defaultUserId: string | null }[]; stages: { name: string }[]; tasks: unknown[] }) => ({
      id: template.id,
      name: template.name,
      roles: template.roles.map((role) => ({ id: role.id, name: role.name, defaultUserId: role.defaultUserId })),
      stageNames: template.stages.map((stage) => stage.name),
      taskCount: template.tasks.length,
    }));
  }
  return output;
}

type Report = { screenshots?: unknown };

/** A report as an agent gets it: each screenshot keeps its type and loses its storage key. */
function shotTypesOnly<T extends Report>(report: T): T {
  if (!Array.isArray(report.screenshots)) return report;
  return { ...report, screenshots: report.screenshots.map((shot: { type?: unknown }) => ({ type: shot.type })) };
}

/**
 * An agent never gets a storage key (owner, 2026-10-07; every answer since the MCP parity track, 2026-10-26). A report row of feedback.list and
 * the report of feedback.setStatus keep the type of each screenshot, and the count stays. feedback.screenshot and files.link give a signed
 * link ({ url, expiresAt }) as it is. Any other answer that holds a file (files.list, files.move, a file in a feed) loses its blobKey and thumbKey.
 */
function withoutStorageKeys(name: string, output: unknown): unknown {
  if (name === 'feedback.list' && Array.isArray(output)) return dropStorageKeys(output.map((row: { item?: Report }) => (row.item ? { ...row, item: shotTypesOnly(row.item) } : row)));
  if (name === 'feedback.setStatus' && output !== null && typeof output === 'object') return dropStorageKeys(shotTypesOnly(output as Report));
  return dropStorageKeys(output);
}

/** A copy of the answer without the stored keys of files: every property named blobKey or thumbKey, at any depth. */
function dropStorageKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropStorageKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'blobKey' && key !== 'thumbKey').map(([key, item]) => [key, dropStorageKeys(item)]));
}

export function errorResult(error: RunError, text?: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: text ?? JSON.stringify({ error }) }], structuredContent: { error } };
}

export function toolResult(tool: ToolDef, result: RunResult): CallToolResult {
  if (!result.ok) return errorResult(result.error);
  if (tool.name === READ_FIRST) return { content: [{ type: 'text', text: String(result.output) }] };
  if (tool.name === PICTURES_GET) {
    // The picture goes as an image too, so the agent sees it. The JSON keeps the data address of a small picture for a document.
    const { output, image } = result.output as PictureAnswer;
    const text = { type: 'text' as const, text: JSON.stringify({ output }) };
    return { content: image ? [{ type: 'image', data: image.data, mimeType: image.mimeType }, text] : [text], structuredContent: { output } };
  }
  const structured: Record<string, unknown> = { output: result.output };
  if (result.storyId !== undefined) structured.storyId = result.storyId;
  return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured };
}

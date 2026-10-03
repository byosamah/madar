import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { serverContracts, type ServerCallName } from '../../src/api/contract/server';
import { sharedCalls, type SharedCallName } from '../../src/api/sharedCalls';
import { TOOL_DOCS } from './docs';

/**
 * The tools that the MCP server shows to an AI agent (plan 5.6, change 20). A fixed allowlist of 36 tools: the reads and writes an
 * agent can use for an office project. Every other call stays on the deny list: screen work (uploads, read marks, counts), the
 * prototype controls, and every Admin call. VS Code allows at most 128 tools in one request across all servers, and each tool
 * definition uses model context, so the list stays short. tools.test.ts fails when a call is in neither list.
 */

/** The one tool with no call behind it: it gives the written instructions (docs.ts). */
export const READ_FIRST = 'madar.readFirst';

export const MCP_ALLOW = [
  // Reads (15).
  READ_FIRST, 'projects.list', 'projects.get', 'tasks.list', 'tasks.get', 'comments.list', 'updates.list', 'tracker.list',
  'payments.list', 'deadlines.list', 'files.list', 'users.list', 'dashboard.get', 'search.query', 'events.list',
  // Writes (21).
  'story.start', 'tasks.create', 'tasks.update', 'tasks.move', 'tasks.complete', 'tasks.approve', 'tasks.sendBack', 'comments.create',
  'updates.create', 'tracker.log', 'tracker.update', 'tracker.close', 'payments.create', 'payments.update', 'payments.markReceived',
  'deadlines.create', 'deadlines.update', 'projects.update', 'projects.setStatus', 'events.undo', 'events.undoStory',
] as const satisfies readonly (typeof READ_FIRST | SharedCallName | ServerCallName)[];
export type McpToolName = (typeof MCP_ALLOW)[number];
type CallToolName = Exclude<McpToolName, typeof READ_FIRST>;

export const MCP_DENY = [
  // The session and the person's own settings.
  'session.get', 'me.updateProfile', 'me.updatePreferences',
  // People, clients, teams and office settings: Admin and Management work in the screens.
  'users.get', 'users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.invites', 'users.resendInvite',
  'clients.list', 'clients.create', 'clients.update', 'teams.list', 'teams.create', 'teams.update', 'teams.delete',
  'settings.get', 'settings.update',
  // Project set-up, members, stages, links, health and deletes.
  'projects.create', 'projects.setLeader', 'projects.pause', 'projects.resume', 'projects.addLink', 'projects.updateLink',
  'projects.removeLink', 'projects.setHealthOverride', 'projects.clearHealthOverride', 'projects.delete',
  'members.add', 'members.addTeam', 'members.remove', 'members.update',
  'stages.replace', 'stages.setDates', 'stages.setPrerequisites', 'deadlines.delete',
  // Task work that needs a person's eye: templates, versions, deletes.
  'tasks.createFromTemplate', 'tasks.newVersion', 'tasks.delete',
  'updates.update', 'updates.delete', 'comments.update', 'comments.delete', 'reactions.toggle',
  // Files: uploads and links happen in the Madar screens.
  'files.upload', 'files.uploadStart', 'files.link', 'files.delete', 'files.markDelivered', 'files.share',
  // Notifications, chats and read marks: screen state of one person.
  'notifications.list', 'notifications.count', 'notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread',
  'notifications.updateSettings', 'chats.list', 'chats.messages', 'chats.send', 'chats.markRead', 'chats.openDirect', 'chats.unreadCount',
  // Templates, tracker extras and payment deletes.
  'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete',
  'taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete',
  'tracker.delete', 'tracker.assignReply', 'tracker.export', 'payments.delete',
  // Feedback, agents and usage.
  'feedback.send', 'feedback.list', 'feedback.screenshot', 'feedback.setStatus', 'feedback.uploadStart',
  'agents.list', 'agents.remove', 'usage.get',
] as const satisfies readonly (SharedCallName | ServerCallName)[];

/** The writes that can remove a record: an Undo of a create removes it. The client may ask its person before it runs one. */
const DESTRUCTIVE = new Set<string>(['events.undo', 'events.undoStory']);

/** A story ID from story.start (plan 4.9): the changes that share it undo together. */
const StoryId = z.string().min(1).max(80).describe('The story ID from story.start. Changes with the same story ID undo together. Leave it out for a change on its own.');

export type ToolDef = {
  name: McpToolName;
  title: string;
  description: string;
  /** JSON Schema 2020-12 of the tool arguments (the MCP default dialect, so no $schema key). */
  inputSchema: { type: 'object' } & Record<string, unknown>;
  /** The zod form of the same arguments. run.ts (G3) parses with it, takes storyId out, and passes the rest to the call. */
  input: z.ZodObject;
  readOnly: boolean;
  /** A write that accepts the optional storyId argument. */
  takesStory: boolean;
  annotations: ToolAnnotations;
};

const calls: Record<CallToolName, { input: z.ZodType; readOnly?: boolean; wire?: { input?: z.ZodType } }> = Object.fromEntries(
  MCP_ALLOW.filter((name) => name !== READ_FIRST).map((name) => {
    const def = (sharedCalls as Record<string, unknown>)[name] ?? (serverContracts as Record<string, unknown>)[name];
    return [name, def];
  }),
) as never;

function inputOf(name: McpToolName): { input: z.ZodObject; readOnly: boolean } {
  if (name === READ_FIRST) return { input: z.strictObject({}), readOnly: true };
  const def = calls[name];
  if (!def) throw new Error(`The MCP tool ${name} has no call.`);
  // The form on the wire, when it differs from the form the screens pass (files.upload, feedback.send).
  const wire = def.wire?.input ?? def.input;
  if (!(wire instanceof z.ZodObject)) throw new Error(`The input of ${name} is not an object, and an MCP inputSchema must be one.`);
  return { input: wire, readOnly: Boolean(def.readOnly) };
}

/**
 * A date field keeps its "format" and loses the long pattern that zod adds (about 350 characters each), because each tool
 * definition uses model context. The zod input still checks the exact form when the tool runs.
 */
function shortDates(ctx: { jsonSchema: Record<string, unknown> }): void {
  const format = ctx.jsonSchema.format;
  if ((format === 'date' || format === 'date-time') && typeof ctx.jsonSchema.pattern === 'string') delete ctx.jsonSchema.pattern;
}

/** Fixed order (MCP caching): madar.readFirst, story.start, then by name. */
function order(a: string, b: string): number {
  const rank = (name: string) => (name === READ_FIRST ? 0 : name === 'story.start' ? 1 : 2);
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

function build(name: McpToolName): ToolDef {
  const { input: callInput, readOnly } = inputOf(name);
  const takesStory = !readOnly && name !== 'story.start';
  const input = takesStory ? callInput.extend({ storyId: StoryId.optional() }) : callInput;
  const { $schema: _dialect, ...schema } = z.toJSONSchema(input, { io: 'input', override: shortDates }) as Record<string, unknown>;
  const doc = TOOL_DOCS[name];
  return {
    name,
    title: doc.title,
    description: doc.description,
    inputSchema: schema as ToolDef['inputSchema'],
    input,
    readOnly,
    takesStory,
    annotations: {
      title: doc.title,
      readOnlyHint: readOnly,
      ...(readOnly ? {} : { destructiveHint: DESTRUCTIVE.has(name), idempotentHint: false }),
      openWorldHint: false,
    },
  };
}

let cache: ToolDef[] | null = null;

/** The 36 tools in their fixed order. It reads sharedCalls and the server contracts, never the server code of a call. */
export function mcpTools(): ToolDef[] {
  cache ??= [...MCP_ALLOW].sort(order).map(build);
  return [...cache];
}

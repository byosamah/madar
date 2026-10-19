import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { OfficeRight } from '../../src/api/contract/entities';
import { serverContracts, type ServerCallName } from '../../src/api/contract/server';
import { sharedCalls, type SharedCallName } from '../../src/api/sharedCalls';
import { TOOL_DOCS } from './docs';

/**
 * The tools that the MCP server shows to an AI agent (plan 5.6, change 20). A fixed allowlist of 45 tools for every agent: the
 * reads and writes an agent can use for an office project, with the three message tools (owner, 2026-10-12) and the stage dates
 * (fbk_023). The Admin list adds 3
 * tools for an agent whose person is an Admin (requests and bugs, owner 2026-10-07), so that agent gets 48. The right list adds
 * reports.office for an agent whose person holds the report right (owner, 2026-10-18, fbk_016), so an Admin's agent gets 49. Every
 * other call stays on the deny list: screen work (uploads, read marks, counts, archives, group changes), the prototype controls, and the
 * other Admin calls. VS Code allows at most 128 tools in one request across all
 * servers, and each tool definition uses model context, so the lists stay short. tools.test.ts fails when a call is in no list.
 */

/** The one tool with no call behind it: it gives the written instructions (docs.ts). */
export const READ_FIRST = 'madar.readFirst';

export const MCP_ALLOW = [
  // Reads (19). chats.list finds a chat, chats.messages reads one page of it, and chats.waiting lists what waits for the reply of
  // the person (fbk_011, owner 2026-10-18). subCompanies.list gives no logos.
  READ_FIRST, 'projects.list', 'projects.get', 'tasks.list', 'tasks.get', 'comments.list', 'updates.list', 'tracker.list',
  'payments.list', 'deadlines.list', 'files.list', 'users.list', 'dashboard.get', 'search.query', 'events.list', 'chats.list', 'subCompanies.list',
  'chats.messages', 'chats.waiting',
  // Writes (26). chats.openDirect and chats.send message the team: a direct chat, a group or a project chat (task comments and
  // project posts are comments.create and updates.create). stages.setDates sets the dates of one stage, as the Schedule tab does.
  'story.start', 'tasks.create', 'tasks.update', 'tasks.take', 'tasks.arrange', 'tasks.move', 'tasks.complete', 'tasks.approve', 'tasks.sendBack', 'comments.create',
  'updates.create', 'tracker.log', 'tracker.update', 'tracker.close', 'payments.create', 'payments.update', 'payments.markReceived',
  'deadlines.create', 'deadlines.update', 'projects.update', 'projects.setStatus', 'events.undo', 'events.undoStory',
  'chats.openDirect', 'chats.send', 'stages.setDates',
] as const satisfies readonly (typeof READ_FIRST | SharedCallName | ServerCallName)[];

/**
 * The tools that only an agent of an Admin gets (owner, 2026-10-07): it reads the feature requests and bug reports, and marks one
 * done when its person says that the fix is live. app.ts picks the list for each request from the role of the agent's person.
 */
export const MCP_ADMIN = ['feedback.list', 'feedback.screenshot', 'feedback.setStatus'] as const satisfies readonly SharedCallName[];
export const ADMIN_TOOLS: ReadonlySet<string> = new Set<string>(MCP_ADMIN);

/**
 * The tools that an office right opens (owner, 2026-10-18, fbk_016). app.ts gives one to an agent only when its person holds the
 * right (rights.ts). The handler checks the same right, so a call without it fails too.
 */
export const MCP_BY_RIGHT = { 'reports.office': 'report.office' } as const satisfies Readonly<Partial<Record<SharedCallName | ServerCallName, OfficeRight>>>;
const RIGHT_TOOLS = Object.keys(MCP_BY_RIGHT) as (keyof typeof MCP_BY_RIGHT)[];

/** The office right that a tool needs, or undefined for a tool that no right opens. */
export function rightOf(name: string): OfficeRight | undefined {
  return (MCP_BY_RIGHT as Readonly<Record<string, OfficeRight>>)[name];
}

export type McpToolName = (typeof MCP_ALLOW)[number] | (typeof MCP_ADMIN)[number] | keyof typeof MCP_BY_RIGHT;
type CallToolName = Exclude<McpToolName, typeof READ_FIRST>;

export const MCP_DENY = [
  // The session and the person's own settings.
  'session.get', 'me.updateProfile', 'me.updatePreferences',
  // People, clients, teams, sub-companies and office settings: Admin and Management work in the screens.
  'users.get', 'users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'users.invites', 'users.resendInvite',
  'clients.list', 'clients.create', 'clients.update', 'teams.list', 'teams.create', 'teams.update', 'teams.delete',
  'subCompanies.save', 'subCompanies.delete',
  'settings.get', 'settings.update',
  // Office roles and their rights: only the Admin makes or changes a role, in the screens (owner, 2026-10-18, fbk_014).
  'roles.create', 'roles.update', 'roles.delete',
  // Project set-up, members, stages (the dates of a stage are a tool, fbk_023), links, health and deletes.
  'projects.create', 'projects.setLeader', 'projects.pause', 'projects.resume', 'projects.addLink', 'projects.updateLink',
  'projects.removeLink', 'projects.setHealthOverride', 'projects.clearHealthOverride', 'projects.delete',
  'members.add', 'members.addTeam', 'members.remove', 'members.update',
  'stages.replace', 'stages.setPrerequisites', 'deadlines.delete',
  // Task work that needs a person's eye: templates, versions, deletes.
  'tasks.createFromTemplate', 'tasks.newVersion', 'tasks.delete',
  'updates.update', 'updates.delete', 'comments.update', 'comments.delete', 'reactions.toggle',
  // Files: uploads and links happen in the Madar screens.
  'files.upload', 'files.uploadStart', 'files.link', 'files.delete', 'files.markDelivered', 'files.share',
  // Notifications and read marks: screen state of one person. An agent reads the chats of its person (fbk_011, owner 2026-10-18), but
  // a read mark is the person's own act: an agent never marks a chat read (owner, 2026-10-12).
  // An archive mark is screen state too: an agent never archives a chat (owner, 2026-10-18).
  'notifications.list', 'notifications.count', 'notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread',
  'notifications.updateSettings', 'chats.markRead', 'chats.unreadCount', 'chats.archive',
  // Group chats are screen work (fbk_011): an agent may send to a group, but it does not make, rename or leave one.
  'chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup',
  // Templates, tracker extras and payment deletes.
  'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete',
  'projectTemplates.list', 'projectTemplates.save', 'projectTemplates.delete',
  // Linking an older project to a template, and the update of its projects, are Admin tasks in the screens (fbk_008 item 4):
  // no agent links, reads the matches, reads the update plan or sends the update.
  'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply',
  'taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete',
  'tracker.delete', 'tracker.assignReply', 'tracker.export', 'payments.delete',
  // Feedback: a report comes in from the screens only. Agents and usage.
  'feedback.send', 'feedback.uploadStart',
  'agents.list', 'agents.remove', 'usage.get', 'usage.retryEffect',
  // Browser push devices (owner, 2026-10-08): a device is the browser of a person. An agent has none and reads none.
  'push.register', 'push.remove', 'push.mine',
  // Live updates (exit wave 3): the ticket opens a browser socket. An agent has no socket.
  'live.ticket',
] as const satisfies readonly (SharedCallName | ServerCallName)[];

/**
 * The writes that only add a record. MCP reads destructiveHint false as "the tool performs only additive updates", so every
 * other write (a change, a status change, an undo) is destructive, and the client may ask its person before it runs one.
 */
const ADDITIVE = new Set<string>(['story.start', 'tasks.create', 'comments.create', 'updates.create', 'tracker.log', 'payments.create', 'deadlines.create']);

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
  [...MCP_ALLOW, ...MCP_ADMIN, ...RIGHT_TOOLS].filter((name) => name !== READ_FIRST).map((name) => {
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
      ...(readOnly ? {} : { destructiveHint: !ADDITIVE.has(name), idempotentHint: false }),
      openWorldHint: false,
    },
  };
}

/** All the tools in their fixed order (an Admin's list), built once. */
let cache: ToolDef[] | null = null;

/**
 * The tools in their fixed order. The list has the 45 tools of the allowlist; an agent of an Admin gets the Admin tools too, and
 * every right tool. Each right tool joins the list when its right is in rights (an Admin holds all of them). It reads sharedCalls and
 * the server contracts, never the server code of a call.
 */
export function mcpTools({ admin = false, rights = [] }: { admin?: boolean; rights?: readonly OfficeRight[] } = {}): ToolDef[] {
  cache ??= [...MCP_ALLOW, ...MCP_ADMIN, ...RIGHT_TOOLS].sort(order).map(build);
  return cache.filter((tool) => {
    if (ADMIN_TOOLS.has(tool.name)) return admin;
    const right = rightOf(tool.name);
    return right === undefined || admin || rights.includes(right);
  });
}

import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { OfficeRight } from '../../src/api/contract/entities';
import type { Action } from '../../src/api/permissions';
import { serverContracts, type ServerCallName } from '../../src/api/contract/server';
import { sharedCalls, type SharedCallName } from '../../src/api/sharedCalls';
import { TOOL_DOCS } from './docs';
import { PICTURES_GET, PicturesGetInput, WITH_PICTURES_TOOLS, WithPictures } from './pictures';

/**
 * The tools that the MCP server shows to an AI agent (plan 5.6, change 20). A fixed allowlist of 53 tools for every agent: the
 * reads and writes an agent can use for an office project, with the three message tools (owner, 2026-10-12), the stage dates
 * (fbk_023), the five meeting tools (fbk_022) and the picture tool (owner, 2026-10-21). The right list adds tools for an agent
 * whose person holds the right: reports.office for the report right (owner, 2026-10-18, fbk_016), and the 3 tools of requests and bugs for the feedback right (owner, 2026-10-07;
 * role-rights, 2026-10-23). The Admin holds every right, so an Admin's agent gets all of them. Every
 * other call stays on the deny list: screen work (uploads, read marks, counts, archives, group changes), the prototype controls, and the
 * other Admin calls. VS Code allows at most 128 tools in one request across all
 * servers, and each tool definition uses model context, so the lists stay short. tools.test.ts fails when a call is in no list.
 */

/** A tool with no call behind it: it gives the written instructions (docs.ts). pictures.get (pictures.ts) is the other one. */
export const READ_FIRST = 'madar.readFirst';
/** The tools with no call of their own. pictures.get runs the calls of the screens inside it, with their rights. */
export const NO_CALL_TOOLS: ReadonlySet<string> = new Set([READ_FIRST, PICTURES_GET]);

export const MCP_ALLOW = [
  // Reads (22). chats.list finds a chat, chats.messages reads one page of it, and chats.waiting lists what waits for the reply of
  // the person (fbk_011, owner 2026-10-18). subCompanies.list gives its logos only with withPictures. meetings.list and meetings.get read
  // the meetings of the person and of a project (fbk_022, owner 2026-10-19). pictures.get gives one picture (owner, 2026-10-21).
  READ_FIRST, PICTURES_GET, 'projects.list', 'projects.get', 'tasks.list', 'tasks.get', 'comments.list', 'updates.list', 'tracker.list',
  'payments.list', 'deadlines.list', 'files.list', 'users.list', 'dashboard.get', 'search.query', 'events.list', 'chats.list', 'subCompanies.list',
  'chats.messages', 'chats.waiting', 'meetings.list', 'meetings.get',
  // Writes (31). tasks.help joins your person to a task as a helper, or takes them off it (fbk_035). chats.openDirect and chats.send message the team: a direct chat, a group or a project chat (task comments and
  // project posts are comments.create and updates.create). stages.setDates sets the dates of one stage, as the Schedule tab does.
  // meetings.create, meetings.update and meetings.cancel tell the attendees, who are real people. meetings.saveMinutes writes the minutes of a meeting
  // that ended (wave 2); it tells nobody.
  'story.start', 'tasks.create', 'tasks.update', 'tasks.take', 'tasks.help', 'tasks.arrange', 'tasks.move', 'tasks.complete', 'tasks.approve', 'tasks.sendBack', 'comments.create',
  'updates.create', 'tracker.log', 'tracker.update', 'tracker.close', 'payments.create', 'payments.update', 'payments.markReceived',
  'deadlines.create', 'deadlines.update', 'projects.update', 'projects.setStatus', 'events.undo', 'events.undoStory',
  'chats.openDirect', 'chats.send', 'stages.setDates', 'meetings.create', 'meetings.update', 'meetings.cancel', 'meetings.saveMinutes',
] as const satisfies readonly (typeof READ_FIRST | typeof PICTURES_GET | SharedCallName | ServerCallName)[];

/**
 * The tools that only an agent of an Admin gets. The list is empty since role-rights (owner, 2026-10-23): the 3 tools of requests and bugs
 * moved to the right list (MCP_BY_RIGHT), under the feedback right, which a role can hold. The name stays for the code that reads it.
 */
export const MCP_ADMIN = [] as const satisfies readonly SharedCallName[];
export const ADMIN_TOOLS: ReadonlySet<string> = new Set<string>(MCP_ADMIN);

/**
 * The tools that an office right opens (owner, 2026-10-18, fbk_016). app.ts gives one to an agent only when its person holds the
 * right (rights.ts). The handler checks the same right, so a call without it fails too. The reports of people (feedback.*) need the
 * feedback right: the Admin holds it, and a role can hold it (owner, 2026-10-23).
 */
export const MCP_BY_RIGHT = {
  'reports.office': 'report.office',
  'feedback.list': 'feedback.manage',
  'feedback.screenshot': 'feedback.manage',
  'feedback.setStatus': 'feedback.manage',
} as const satisfies Readonly<Partial<Record<SharedCallName | ServerCallName, OfficeRight>>>;
const RIGHT_TOOLS = Object.keys(MCP_BY_RIGHT) as (keyof typeof MCP_BY_RIGHT)[];

/** The office right that a tool needs, or undefined for a tool that no right opens. */
export function rightOf(name: string): (OfficeRight & Action) | undefined {
  return (MCP_BY_RIGHT as Readonly<Record<string, OfficeRight & Action>>)[name];
}

export type McpToolName = (typeof MCP_ALLOW)[number] | (typeof MCP_ADMIN)[number] | keyof typeof MCP_BY_RIGHT;
type CallToolName = Exclude<McpToolName, typeof READ_FIRST | typeof PICTURES_GET>;

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
  'projects.create', 'projects.setLeader', 'projects.pause', 'projects.resume', 'projects.setRestart', 'projects.addLink', 'projects.updateLink',
  'projects.removeLink', 'projects.setHealthOverride', 'projects.clearHealthOverride', 'projects.delete',
  'members.add', 'members.addTeam', 'members.remove', 'members.update',
  'stages.replace', 'stages.setPrerequisites', 'deadlines.delete',
  // Task work that needs a person's eye: templates, versions, deletes.
  'tasks.createFromTemplate', 'tasks.newVersion', 'tasks.delete',
  'updates.update', 'updates.delete', 'comments.update', 'comments.delete', 'reactions.toggle',
  // Only the person edits, deletes or reacts to a chat message, in the screens (chat design 2026-10-19, items 11 and 12).
  'chats.editMessage', 'chats.deleteMessage',
  // Files: uploads and links happen in the Madar screens.
  'files.upload', 'files.uploadStart', 'files.link', 'files.delete', 'files.markDelivered', 'files.share',
  // Notifications and read marks: screen state of one person. An agent reads the chats of its person (fbk_011, owner 2026-10-18), but
  // a read mark is the person's own act: an agent never marks a chat read (owner, 2026-10-12).
  // An archive mark is screen state too: an agent never archives a chat (owner, 2026-10-18). Nor does it mark a chat unread (fbk_028,
  // owner 2026-10-23): an unread mark is the person's own reminder, and a bold row with nothing new in it would only confuse the person.
  'notifications.list', 'notifications.count', 'notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread',
  'notifications.updateSettings', 'chats.markRead', 'chats.markUnread', 'chats.unreadCount', 'chats.archive',
  // A Notify me choice is screen state of one person, as an archive mark (design item 21).
  'chats.setNotify',
  // Group chats are screen work (fbk_011): an agent may send to a group, but it does not make, rename or leave one.
  'chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup',
  // Templates, tracker extras and payment deletes.
  'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete',
  'projectTemplates.list', 'projectTemplates.save', 'projectTemplates.delete',
  // Linking an older project to a template, the apply of a template to an ongoing project (the leader's menu, fbk_020) and the update of
  // its projects are screen tasks: no agent links, applies, reads the matches, reads the update plan or sends the update.
  'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply',
  'taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete',
  'tracker.delete', 'tracker.assignReply', 'tracker.export', 'payments.delete',
  // A meeting that ended is settled by the 15-minute job and by the minutes call (fbk_022, wave 2): Madar makes its Tracker line, an agent does not.
  'meetings.settle',
  // A series is kept full by the job and by the prototype timer (fbk_022, wave 3): the agent plans a series with meetings.create and repeat.
  'meetings.extend',
  // A person deletes a cancelled meeting in the screens (owner, 2026-10-23). An agent cancels only: the delete has no confirm step for an agent.
  'meetings.delete',
  // Feedback: a report comes in from the screens only. Agents.
  'feedback.send', 'feedback.uploadStart',
  'agents.list', 'agents.remove',
  // Browser push devices (owner, 2026-10-08): a device is the browser of a person. An agent has none and reads none.
  'push.register', 'push.remove', 'push.mine',
  // Live updates (exit wave 3): the ticket opens a browser socket. An agent has no socket.
  'live.ticket',
  // Google Calendar (fbk_022, owner 2026-10-19): a person connects it in the Settings screen. An agent cannot connect, disconnect or read
  // a connection. The meetings of its person reach their Google Calendar by themselves, with the title, the time and the place only.
  'google.status', 'google.connectStart', 'google.connect', 'google.disconnect',
] as const satisfies readonly (SharedCallName | ServerCallName)[];

/**
 * The writes that only add a record. MCP reads destructiveHint false as "the tool performs only additive updates", so every
 * other write (a change, a status change, an undo) is destructive, and the client may ask its person before it runs one.
 */
const ADDITIVE = new Set<string>([
  'story.start', 'tasks.create', 'comments.create', 'updates.create', 'tracker.log', 'payments.create', 'deadlines.create', 'meetings.create',
]);

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
  [...MCP_ALLOW, ...MCP_ADMIN, ...RIGHT_TOOLS].filter((name) => !NO_CALL_TOOLS.has(name)).map((name) => {
    const def = (sharedCalls as Record<string, unknown>)[name] ?? (serverContracts as Record<string, unknown>)[name];
    return [name, def];
  }),
) as never;

function inputOf(name: McpToolName): { input: z.ZodObject; readOnly: boolean } {
  if (name === READ_FIRST) return { input: z.strictObject({}), readOnly: true };
  if (name === PICTURES_GET) return { input: PicturesGetInput, readOnly: true };
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
  // withPictures is an argument of the tool only (owner, 2026-10-21): run.ts takes it out before the call, and adds the picture data.
  const withPictures = WITH_PICTURES_TOOLS.has(name) ? callInput.extend({ withPictures: WithPictures }) : callInput;
  const input = takesStory ? withPictures.extend({ storyId: StoryId.optional() }) : withPictures;
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

/** All the tools in their fixed order (the list of an Admin, who holds every right), built once. */
let cache: ToolDef[] | null = null;

/**
 * The tools in their fixed order. The list has the tools of the allowlist; an agent of an Admin gets every right tool too. Each right
 * tool joins the list when its right is in rights (an Admin holds all of them). It reads sharedCalls and
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

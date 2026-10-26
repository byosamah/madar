import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { OfficeRight } from '../../src/api/contract/entities';
import type { Action } from '../../src/api/permissions';
import { serverContracts, type ServerCallName } from '../../src/api/contract/server';
import { sharedCalls, type SharedCallName } from '../../src/api/sharedCalls';
import { TOOL_DOCS } from './docs';
import { aiSwitchOf } from './aiSwitches';
import { ConfirmCode, GUARDED_CALLS } from './guardCalls';
import { BULK_INPUTS, TASKS_CREATE_MANY, TASKS_UPDATE_MANY } from './bulk';
import { PAGED_TOOLS, PagingArgs } from './paging';
import { PICTURES_GET, PicturesGetInput, WITH_PICTURES_TOOLS, WithPictures } from './pictures';
import { FEEDBACK_SEND_WITH_SCREENSHOTS, FILES_UPLOAD_CONTENT, UPLOAD_INPUTS } from './upload';

/**
 * The tools that the MCP server shows to an AI agent (plan 5.6, change 20). An allowlist: the reads and writes an agent can use for an office
 * project, with the message tools (owner, 2026-10-12), the stage dates (fbk_023), the meeting tools (fbk_022), the picture tool (owner,
 * 2026-10-21), the client and template lists for the AI switch "AI creates projects and clients" (owner, 2026-10-25), the stage replace, the
 * two bulk to-do tools and the two upload tools (owner, 2026-10-26), and the MCP parity track (owner, 2026-10-26): an agent does what its person
 * does in the screens, with the rights of that person. That track opened the project set-up, the edits and deletes, the files without upload,
 * the bell and the read marks, the group chats, the templates, the Tracker, payment and meeting deletes, the own profile and settings, and the
 * Admin work. The right list holds the tools that a right of the person opens (the payment tools, the Dashboard, Search, the report, the
 * requests and bugs with their upload form, the project and client rights, and the Admin rights). MCP_ADMIN holds the three role tools, which
 * need the Admin right admin.manage. The Admin holds every right, so an Admin's agent gets every tool. Only these stay on the deny list: the
 * delete of a project, the raw upload calls (the two upload tools carry the content instead), the session, the push and live calls, the typing
 * signal, Google and the settling of a meeting. VS Code allows at most 128 tools in one request across all servers, so an Admin's agent that
 * connects to VS Code with other servers may hit the limit (the lists are still short for any other role). tools.test.ts fails when a call is
 * in no list.
 *
 * Every tool of the lists also belongs to one AI switch of the role sheet (aiSwitches.ts, from the catalog): an agent sees a tool only
 * when its person holds the AI switch of the tool AND, for a right tool, the right (role rights version 2, design section 5.12).
 */

/** A tool with no call behind it: it gives the written instructions (docs.ts). pictures.get (pictures.ts) is the other one. */
export const READ_FIRST = 'madar.readFirst';
/**
 * The tools with no call of their own. pictures.get runs the calls of the screens inside it, with their rights. tasks.createMany and
 * tasks.updateMany run tasks.create and tasks.update once for each item (bulk.ts, owner 2026-10-26). files.uploadContent and
 * feedback.sendWithScreenshots take the content of a file in the call and run the upload calls of the screens inside them (upload.ts, owner 2026-10-26).
 */
export const NO_CALL_TOOLS: ReadonlySet<string> = new Set([READ_FIRST, PICTURES_GET, TASKS_CREATE_MANY, TASKS_UPDATE_MANY, FILES_UPLOAD_CONTENT, FEEDBACK_SEND_WITH_SCREENSHOTS]);

export const MCP_ALLOW = [
  // Reads (21). clients.list and projectTemplates.list belong to the AI switch ai.projectSetup (owner, 2026-10-25). chats.list finds a chat, chats.messages reads one page of it, and chats.waiting lists what waits for the reply of
  // the person (fbk_011, owner 2026-10-18). subCompanies.list gives its logos only with withPictures. meetings.list and meetings.get read
  // the meetings of the person and of a project (fbk_022, owner 2026-10-19). pictures.get gives one picture (owner, 2026-10-21).
  READ_FIRST, PICTURES_GET, 'projects.list', 'projects.get', 'tasks.list', 'tasks.get', 'comments.list', 'updates.list', 'tracker.list',
  'deadlines.list', 'files.list', 'users.list', 'events.list', 'chats.list', 'subCompanies.list',
  'chats.messages', 'chats.waiting', 'meetings.list', 'meetings.get', 'clients.list', 'projectTemplates.list',
  // Writes (35). tasks.createMany and tasks.updateMany run tasks.create and tasks.update for up to 50 and 100 items (owner, 2026-10-26). stages.replace renames, adds, removes and orders the stages of one project. tasks.help joins your person to a task as a helper, or takes them off it (fbk_035). chats.openDirect and chats.send message the team: a direct chat, a group or a project chat (task comments and
  // project posts are comments.create and updates.create). stages.setDates sets the dates of one stage, as the Schedule tab does.
  // meetings.create, meetings.update and meetings.cancel tell the attendees, who are real people. meetings.saveMinutes writes the minutes of a meeting
  // that ended (wave 2); it tells nobody.
  'story.start', 'tasks.create', 'tasks.createMany', 'tasks.update', 'tasks.updateMany', 'tasks.take', 'tasks.help', 'tasks.arrange', 'tasks.move', 'tasks.complete', 'tasks.approve', 'tasks.sendBack', 'comments.create',
  'updates.create', 'tracker.log', 'tracker.update', 'tracker.close',
  'deadlines.create', 'deadlines.update', 'projects.update', 'projects.setStatus', 'events.undo', 'events.undoStory',
  'chats.openDirect', 'chats.send', 'stages.setDates', 'stages.replace', 'meetings.create', 'meetings.update', 'meetings.cancel', 'meetings.saveMinutes',
  // Folders of the Files & Links tab (fbk_066, owner 2026-10-26): an agent makes, renames and deletes folders and moves files; a person uploads in the screens.
  'folders.create', 'folders.rename', 'folders.delete', 'files.move',
  // MCP parity (owner, 2026-10-26). Every call keeps its rights check, so an agent does only what its person may do.
  // Project set-up: the leader, the pause, who sees a project, the links, the health, the team and what a stage needs. A change of a person's access
  // or of the team tells real people, so TOOL_DOCS says: ask your person first.
  'projects.setLeader', 'projects.pause', 'projects.resume', 'projects.setRestart', 'projects.setAccess',
  'projects.addLink', 'projects.updateLink', 'projects.removeLink', 'projects.setHealthOverride', 'projects.clearHealthOverride',
  'members.add', 'members.addTeam', 'members.remove', 'members.update', 'stages.setPrerequisites', 'deadlines.delete',
  // To-dos from a template, a new version, and the delete of a to-do. The task templates are to-do work.
  'tasks.createFromTemplate', 'tasks.newVersion', 'tasks.delete',
  'taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete',
  // Posts, comments and reactions: the calls allow the author (or the leader) only, as in the screens.
  'updates.update', 'updates.delete', 'comments.update', 'comments.delete', 'reactions.toggle',
  // Messages: the calls allow only a message of the person (or of its agent). Group chats are messages too.
  'chats.editMessage', 'chats.deleteMessage', 'chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup',
  // Files without upload. files.link gives a signed link and never a storage key; a file of a chat or a meeting stays closed to an agent.
  'files.link', 'files.delete', 'files.markDelivered', 'files.share',
  // The bell, the read marks and the own chat state (AI switch ai.myState, ai.readWork, ai.readChats). An agent marks and archives only when its person asks.
  'notifications.list', 'notifications.count', 'chats.unreadCount',
  'notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread', 'notifications.updateSettings',
  'chats.markRead', 'chats.markUnread', 'chats.archive', 'chats.setNotify',
  // The own profile, the own preferences and the own AI apps of the person. The calls refuse a picture, quiet hours, away and the email settings for an agent.
  'me.updateProfile', 'me.updatePreferences', 'agents.list', 'agents.remove',
  // Templates of projects and stages (AI switch ai.projectSetup).
  'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete', 'projectTemplates.save', 'projectTemplates.delete',
  'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply',
  // Tracker and meeting deletes, and the reads of people, teams, the office settings and the invitations (the call checks the people right).
  'tracker.delete', 'tracker.assignReply', 'tracker.export', 'meetings.delete',
  'users.get', 'users.invites', 'teams.list', 'settings.get',
  // Uploads by content (owner, 2026-10-26): the agent sends the file in the call, as base64 text, 10 MB at most. The screens' upload calls run inside.
  // (feedback.sendWithScreenshots sends a request or bug report with up to three pictures: it sits in MCP_BY_RIGHT beside feedback.send.)
  FILES_UPLOAD_CONTENT,
] as const satisfies readonly (typeof READ_FIRST | typeof PICTURES_GET | typeof TASKS_CREATE_MANY | typeof TASKS_UPDATE_MANY | typeof FILES_UPLOAD_CONTENT | SharedCallName | ServerCallName)[];

/**
 * The tools that only an agent of an Admin gets: the three role calls, which need admin.manage (the Admin only, no switch grants it). They also
 * need the AI switch ai.admin (MCP parity, owner 2026-10-26). The agent of a person without admin.manage never sees them.
 */
export const MCP_ADMIN = ['roles.create', 'roles.update', 'roles.delete'] as const satisfies readonly SharedCallName[];
export const ADMIN_TOOLS: ReadonlySet<string> = new Set<string>(MCP_ADMIN);

/**
 * The tools that an office right opens (owner, 2026-10-18, fbk_016; the new ids of role rights version 2, 2026-10-21). app.ts gives one
 * to an agent only when its person holds the right (rights.ts) and the AI switch of the tool. The handler checks the same right, so a
 * call without it fails too. The payment tools need the payment switches, the Dashboard and Search their own switches, the office report
 * the report right, and the reports of people (feedback.*) the feedback right: the Admin holds it, and a role can hold it (owner,
 * 2026-10-23). projects.create and clients.create need the project and client rights, and the AI switch ai.projectSetup (owner, 2026-10-25).
 * The Admin work of the MCP parity track needs the people, client, sub-company and settings rights (owner, 2026-10-26).
 */
export const MCP_BY_RIGHT = {
  'payments.list': 'payment.view',
  'payments.create': 'payment.add',
  'payments.update': 'payment.change',
  'payments.markReceived': 'payment.receive',
  'dashboard.get': 'dashboard.view',
  'search.query': 'search.use',
  'reports.office': 'report.office',
  'feedback.list': 'feedback.manage',
  'feedback.screenshot': 'feedback.manage',
  'feedback.setStatus': 'feedback.manage',
  'projects.create': 'project.create',
  'clients.create': 'client.create',
  // MCP parity (owner, 2026-10-26): a payment delete is a payment change; feedback.send is for every person; the rest is Admin work (AI switch ai.admin),
  // and each call needs the right of the screens.
  'payments.delete': 'payment.change',
  'feedback.send': 'feedback.send',
  // The upload form of feedback.send (upload.ts, owner 2026-10-26): same right, same AI switch (ai.feedback).
  [FEEDBACK_SEND_WITH_SCREENSHOTS]: 'feedback.send',
  'users.create': 'people.invite',
  'users.resendInvite': 'people.invite',
  'users.update': 'people.change',
  'users.deactivate': 'people.turnOff',
  'users.reactivate': 'people.turnOff',
  'users.remove': 'people.remove',
  'teams.create': 'people.teams',
  'teams.update': 'people.teams',
  'teams.delete': 'people.teams',
  'clients.update': 'clients.change',
  'subCompanies.save': 'subCompanies.manage',
  'subCompanies.delete': 'subCompanies.manage',
  'settings.update': 'office.settings',
} as const satisfies Readonly<Partial<Record<SharedCallName | ServerCallName | typeof FEEDBACK_SEND_WITH_SCREENSHOTS, OfficeRight>>>;
const RIGHT_TOOLS = Object.keys(MCP_BY_RIGHT) as (keyof typeof MCP_BY_RIGHT)[];

/** The office right that a tool needs, or undefined for a tool that no right opens. */
export function rightOf(name: string): (OfficeRight & Action) | undefined {
  return (MCP_BY_RIGHT as Readonly<Record<string, OfficeRight & Action>>)[name];
}

export type McpToolName = (typeof MCP_ALLOW)[number] | (typeof MCP_ADMIN)[number] | keyof typeof MCP_BY_RIGHT;
type CallToolName = Exclude<McpToolName, typeof READ_FIRST | typeof PICTURES_GET | typeof TASKS_CREATE_MANY | typeof TASKS_UPDATE_MANY | typeof FILES_UPLOAD_CONTENT | typeof FEEDBACK_SEND_WITH_SCREENSHOTS>;

export const MCP_DENY = [
  // The session of the screens: an agent reads the person it acts for from madar.readFirst.
  'session.get',
  // A project delete has no Undo (owner, 2026-10-26): only an Admin deletes a project, in the screens. An agent archives with projects.setStatus.
  'projects.delete',
  // The raw upload calls need a signed link and a browser PUT. An agent sends the content with files.uploadContent or feedback.sendWithScreenshots instead.
  'files.upload', 'files.uploadStart', 'feedback.uploadStart',
  // A meeting that ended is settled by the 15-minute job and by the minutes call (fbk_022, wave 2): Madar makes its Tracker line, an agent does not.
  'meetings.settle',
  // A series is kept full by the job and by the prototype timer (fbk_022, wave 3): the agent plans a series with meetings.create and repeat.
  'meetings.extend',
  // Browser push devices (owner, 2026-10-08): a device is the browser of a person. An agent has none and reads none.
  'push.register', 'push.remove', 'push.mine',
  // Live updates (exit wave 3): the ticket opens a browser socket. An agent has no socket.
  'live.ticket',
  // The typing signal is live and personal, like the push calls: an agent never types (chat presence design B).
  'chats.typing',
  // Google Calendar (fbk_022, owner 2026-10-19): a person connects it in the Settings screen. All four calls refuse an agent with forbidden (server/calls/google.ts and
  // the prototype fake), so none can work for an agent. The meetings of its person reach their Google Calendar by themselves, with the title, the time and the place only.
  'google.status', 'google.connectStart', 'google.connect', 'google.disconnect',
] as const satisfies readonly (SharedCallName | ServerCallName)[];

/**
 * The writes that only add a record. MCP reads destructiveHint false as "the tool performs only additive updates", so every
 * other write (a change, a status change, an undo) is destructive, and the client may ask its person before it runs one.
 */
const ADDITIVE = new Set<string>([
  'story.start', 'tasks.create', 'tasks.createMany', 'comments.create', 'updates.create', 'tracker.log', 'payments.create', 'deadlines.create', 'meetings.create', 'folders.create',
  FILES_UPLOAD_CONTENT, FEEDBACK_SEND_WITH_SCREENSHOTS,
  // MCP parity (owner, 2026-10-26): calls that only add a record and send nothing outside Madar. users.create sends an invitation by email, so it is not here.
  'tasks.createFromTemplate', 'feedback.send', 'teams.create', 'roles.create', 'chats.createGroup', 'stageTemplates.save', 'taskTemplates.save',
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

/**
 * The fields of a call that no MCP tool carries (owner, 2026-10-26): a picture is file data, and the upload IDs of feedback.send come from
 * feedback.uploadStart, which stays on the deny list. The tool schema leaves them out. The call still refuses an agent that sends them
 * (people.ts for the pictures), because the MCP check only reads the arguments and runCall parses them again. A "patch." field is inside the
 * object "patch".
 */
const HIDDEN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'me.updateProfile': ['avatarUrl'],
  'users.update': ['patch.avatarUrl'],
  'feedback.send': ['uploadIds'],
};

function withoutHidden(name: string, wire: z.ZodObject): z.ZodObject {
  let result = wire;
  for (const field of HIDDEN_FIELDS[name] ?? []) {
    const [head, rest] = field.split('.');
    if (rest === undefined) {
      result = result.omit({ [head]: true } as never);
    } else {
      const inner = result.shape[head];
      if (!(inner instanceof z.ZodObject)) throw new Error(`The field ${head} of ${name} is not an object.`);
      result = result.extend({ [head]: inner.omit({ [rest]: true } as never) });
    }
  }
  return result;
}

function inputOf(name: McpToolName): { input: z.ZodObject; readOnly: boolean } {
  if (name === READ_FIRST) return { input: z.strictObject({}), readOnly: true };
  if (name === PICTURES_GET) return { input: PicturesGetInput, readOnly: true };
  if (name === TASKS_CREATE_MANY || name === TASKS_UPDATE_MANY) return { input: BULK_INPUTS[name], readOnly: false };
  if (name === FILES_UPLOAD_CONTENT || name === FEEDBACK_SEND_WITH_SCREENSHOTS) return { input: UPLOAD_INPUTS[name], readOnly: false };
  const def = calls[name];
  if (!def) throw new Error(`The MCP tool ${name} has no call.`);
  // The form on the wire, when it differs from the form the screens pass (files.upload, feedback.send).
  const wire = def.wire?.input ?? def.input;
  if (!(wire instanceof z.ZodObject)) throw new Error(`The input of ${name} is not an object, and an MCP inputSchema must be one.`);
  return { input: withoutHidden(name, wire), readOnly: Boolean(def.readOnly) };
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
  // limit, offset and full are arguments of the tool only (owner, 2026-10-26): run.ts takes them out before the call and cuts the page.
  const paged = PAGED_TOOLS.has(name) ? withPictures.extend(PagingArgs) : withPictures;
  // confirmCode is an argument of the tool only (owner, 2026-10-26): the email code of the risky Admin acts (guard.ts). runCall takes it out before the parse.
  const confirmed = GUARDED_CALLS.has(name) ? paged.extend({ confirmCode: ConfirmCode.optional() }) : paged;
  const input = takesStory ? confirmed.extend({ storyId: StoryId.optional() }) : confirmed;
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

/** Every tool, in the fixed order. */
export function allTools(): ToolDef[] {
  cache ??= [...MCP_ALLOW, ...MCP_ADMIN, ...RIGHT_TOOLS].sort(order).map(build);
  return cache;
}

/**
 * The tools that a person sees (role rights version 2, design section 5.12). held answers for the rights of the person: the AI switch
 * of a tool must be held, and for a right tool the right too. A tool that no AI switch opens is never listed (fail closed). admin: the
 * person holds admin.manage, which the Admin tools need (the three role calls). An Admin tool also needs its AI switch (ai.admin).
 */
export function visibleTools(all: readonly ToolDef[], held: (id: string) => boolean, admin: boolean): ToolDef[] {
  return all.filter((tool) => {
    if (ADMIN_TOOLS.has(tool.name) && !admin) return false;
    const aiSwitch = aiSwitchOf(tool.name);
    if (aiSwitch === undefined || !held(aiSwitch)) return false;
    const right = rightOf(tool.name);
    return right === undefined || held(right);
  });
}

/**
 * The tool that a call names, when it exists and the person lacks its AI switch: the call then fails with ai_off and not as an unknown
 * tool. A tool that only the right of the person closes stays unknown (the list never named it). An Admin tool stays unknown to a person
 * without admin.manage (admin false), so the switch refusal never shows that the tool exists.
 */
export function toolOfOffSwitch(all: readonly ToolDef[], held: (id: string) => boolean, name: string, admin = true): ToolDef | undefined {
  const tool = all.find((item) => item.name === name);
  if (!tool || (ADMIN_TOOLS.has(tool.name) && !admin)) return undefined;
  const aiSwitch = aiSwitchOf(tool.name);
  return aiSwitch !== undefined && !held(aiSwitch) ? tool : undefined;
}

/**
 * The tools in their fixed order. admin alone: every tool (an Admin holds every switch and every right). rights: the ids that the person
 * holds (rightsOf); a tool shows when the person holds its AI switch and, for a right tool, the right. admin with rights: the person holds
 * admin.manage too, so the three role tools can show. With no rights, the list is the
 * base list: the tools that no right opens, with the AI switches not asked. It reads sharedCalls and the server contracts, never the
 * server code of a call.
 */
export function mcpTools({ admin = false, rights }: { admin?: boolean; rights?: readonly string[] } = {}): ToolDef[] {
  if (admin && rights === undefined) return [...allTools()];
  if (rights === undefined) return allTools().filter((tool) => !ADMIN_TOOLS.has(tool.name) && rightOf(tool.name) === undefined);
  return visibleTools(allTools(), (id) => rights.includes(id), admin);
}

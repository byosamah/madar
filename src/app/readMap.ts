import type { Kind } from '../api/remote/wire';

/**
 * The read map (plan 5.3, client map 3.2): for each read call, the kinds of change it reads and how far a change reaches it.
 * src/app/signals.ts reloads a list only when a change signal names one of its kinds, in its project or for its person.
 * readMap.test.ts runs each read call over the sample office with a State that records what it reads, and fails when a kind
 * is missing here. An over-wide rule only costs a reload; a missing kind leaves a list old.
 *
 * Scopes:
 * - office: any change of one of its kinds reloads it.
 * - project: only a change in its project, or a change that touches the office (people, clients, a direct chat). projectOf
 *   gives the project from the input or the cached answer; undefined means "any project".
 * - person: the lists of one person (Inbox, chats, counts, session). A gap on the person channel reloads only these.
 * - none: never reloads on a signal (signed file links, file data, screenshots). They load again when a screen opens them.
 *
 * The personal kinds (chatReads, notifications, preferences) reload a list only when the signal names this person, in any scope.
 * Every call reads the record of the person who asks (the rights), so every rule that reloads names users and settings.
 */
export type ReadScope = 'office' | 'project' | 'person' | 'none';
export type ReadRule = { scope: ReadScope; kinds: readonly Kind[]; projectOf?(input: unknown, data: unknown): string | undefined };

/** The State collections that are kinds (wire.ts Kind without the two narrow kinds). */
export const COLLECTION_KINDS = [
  'users', 'clients', 'projects', 'members', 'stages', 'deadlines', 'tasks', 'updates', 'comments', 'files', 'notifications',
  'events', 'conversations', 'messages', 'chatReads', 'stageTemplates', 'taskTemplates', 'projectTemplates', 'tracker', 'payments',
  'feedback', 'teams', 'settings', 'subCompanies',
] as const satisfies readonly Kind[];

/** The kinds of a change that belongs to one person: they go only on that person's channel (plan, change 13). */
export const PERSONAL_KINDS: ReadonlySet<Kind> = new Set<Kind>(['chatReads', 'notifications', 'preferences']);

const field = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : undefined;
};

/** The project of a read whose input names it. */
const byProjectId = (input: unknown) => field(input, 'projectId');

const rule = (scope: ReadScope, kinds: readonly Kind[], projectOf?: ReadRule['projectOf']): ReadRule =>
  projectOf ? { scope, kinds, projectOf } : { scope, kinds };

const PROJECT_DETAIL: Kind[] = ['clients', 'comments', 'deadlines', 'events', 'files', 'members', 'projects', 'stages', 'tasks', 'updates', 'users'];

const RULES: Record<string, ReadRule> = {
  'projects.get': rule('project', [...PROJECT_DETAIL, 'projectTouched', 'settings'], (input) => field(input, 'id')),
  'updates.list': rule('project', ['comments', 'events', 'files', 'members', 'projects', 'stages', 'tasks', 'updates', 'users'], byProjectId),
  'tasks.list': rule('project', ['comments', 'files', 'members', 'projects', 'stages', 'tasks', 'users'], byProjectId),
  'tasks.get': rule('project', ['comments', 'events', 'files', 'members', 'projects', 'stages', 'tasks', 'users'],
    (_input, data) => field(typeof data === 'object' && data !== null ? (data as { task?: unknown }).task : undefined, 'projectId')),
  // The view rule of a task reads its project and team, and the people of an office task (owner, 2026-10-06).
  'comments.list': rule('project', ['comments', 'files', 'members', 'projects', 'tasks', 'updates', 'users']),
  'files.list': rule('project', ['files', 'members', 'projects', 'tasks', 'users'], byProjectId),
  'payments.list': rule('project', ['payments', 'projects', 'users'], byProjectId),
  'tracker.list': rule('project', ['files', 'members', 'projects', 'tracker', 'users'], byProjectId),
  'tracker.export': rule('project', ['events', 'files', 'projects', 'tracker', 'users'], byProjectId),
  'events.list': rule('project', ['events', 'files', 'projects', 'stages', 'tasks', 'tracker', 'users'], byProjectId),
  'projects.list': rule('office', [...PROJECT_DETAIL, 'projectTouched', 'settings', 'teams']),
  // events: the day each task in review went to review. payments: the money panel (owner, 2026-10-06).
  'dashboard.get': rule('office', ['deadlines', 'events', 'members', 'payments', 'projects', 'settings', 'stages', 'tasks', 'teams', 'tracker', 'users']),
  'reports.office': rule('office', ['deadlines', 'events', 'members', 'payments', 'projects', 'settings', 'stages', 'subCompanies', 'tasks', 'tracker', 'users']),
  'deadlines.list': rule('office', ['deadlines', 'projects', 'users']),
  'search.query': rule('office', ['clients', 'files', 'projects', 'tasks', 'users']),
  'users.list': rule('office', ['users', 'preferences']),
  'users.get': rule('office', ['users', 'preferences']),
  'users.invites': rule('office', ['users']),
  'agents.list': rule('office', ['users']),
  'clients.list': rule('office', ['clients', 'users']),
  'settings.get': rule('office', ['settings', 'users']),
  'teams.list': rule('office', ['teams', 'users']),
  'subCompanies.list': rule('office', ['subCompanies', 'users']),
  'stageTemplates.list': rule('office', ['stageTemplates', 'users']),
  'taskTemplates.list': rule('office', ['taskTemplates', 'users']),
  'projectTemplates.list': rule('office', ['projectTemplates', 'projects', 'users']),
  'projectTemplates.matchPlan': rule('project', ['projectTemplates', 'projects', 'stages', 'tasks', 'users'], byProjectId),
  // The update of a template (fbk_008 item 4): the list reads the open projects, the plan reads the tasks of the listed projects too.
  'projectTemplates.usage': rule('office', ['projectTemplates', 'projects', 'settings', 'users']),
  'projectTemplates.syncPlan': rule('office', ['projectTemplates', 'projects', 'settings', 'stages', 'tasks', 'users']),
  'feedback.list': rule('office', ['feedback', 'users']),
  'session.get': rule('person', ['projects', 'users', 'preferences']),
  // No 'feedback': a report notice reads only if its report exists. Only the Undo of the send deletes a report, and that Undo
  // deletes each notice of the send or keeps a hidden one, which reads as gone both before and after (review 2026-10-07).
  'notifications.list': rule('person', ['notifications', 'projects', 'tasks', 'updates', 'users']),
  'notifications.count': rule('person', ['notifications', 'projects', 'tasks', 'updates', 'users']),
  'chats.list': rule('person', ['chatReads', 'comments', 'conversations', 'members', 'messages', 'projects', 'tasks', 'users']),
  'chats.unreadCount': rule('person', ['chatReads', 'comments', 'conversations', 'members', 'messages', 'projects', 'tasks', 'users']),
  'chats.messages': rule('person', ['chatReads', 'conversations', 'members', 'messages', 'projects', 'users']),
  'chats.waiting': rule('person', ['chatReads', 'comments', 'conversations', 'members', 'messages', 'projects', 'tasks', 'users']),
  'usage.get': rule('none', []),
  // The ticket of the live socket (exit wave 3): src/api/remote/liveSocket.ts asks for it with api.call, never with useCall.
  'live.ticket': rule('none', []),
  // The own push devices: no change signal names a device, so no signal reloads this read. The Settings row reads it again itself.
  'push.mine': rule('none', []),
  'files.link': rule('none', []),
  'files.get': rule('none', []),
  'feedback.screenshot': rule('none', []),
};

/**
 * The rights of a person come from the office settings (settings.roles). So a change of the settings reloads each list that
 * reads a person's rights. Each rule that reloads therefore names settings.
 */
const RIGHTS_KINDS: readonly Kind[] = ['settings'];

export const READS: Record<string, ReadRule> = Object.fromEntries(
  Object.entries(RULES).map(([name, rule]): [string, ReadRule] => [
    name,
    rule.scope === 'none' ? rule : { ...rule, kinds: [...new Set([...rule.kinds, ...RIGHTS_KINDS])].sort() },
  ]),
);

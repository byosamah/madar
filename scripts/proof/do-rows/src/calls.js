// The loaders of the heavy Madar calls, ported from server/data/loaders/ (overview.ts, steps.ts, inbox.ts, chat.ts, task.ts,
// project.ts, jobs.ts) onto the SQLite engine. Each function makes the same reads, in the same order, with the same filters and
// limits. The handlers do not run here: only the reads count.

const FEED_VERBS = ['project.created', 'project.stage_changed', 'project.leader_changed', 'project.code_changed', 'task.created', 'task.status_changed',
  'task.approved', 'task.sent_back', 'task.version_opened', 'task.reopened', 'task.dates_shifted', 'file.added', 'file.version_added', 'member.added'];
const COLLECTION = { task: 'tasks', update: 'updates', comment: 'comments', file: 'files', tracker: 'tracker', payment: 'payments', feedback: 'feedback', project: null, member: null, stage: null, chat: null };
const TASK_THREAD_LIMIT = 100;

const isAdmin = (u) => u?.systemRole === 'admin';
export function can(user, perm) {
  if (!user || !user.active) return false;
  if (perm === 'task.view.office' || perm === 'admin.manage') return isAdmin(user);
  if (perm === 'payment.manage') return ['admin', 'management', 'accounting'].includes(user.systemRole);
  return true;
}
const memberKey = (p, u) => `${p}:${u}`;
function projectRoleOf(L, projectId, userId) {
  const p = L.office.projects[projectId];
  if (!p) return 'other';
  if (p.leaderId === userId) return 'leader';
  return L.office.members[memberKey(projectId, userId)] ? 'team' : 'other';
}
const projects = (L) => Object.values(L.office.projects);

// --- steps.ts ---
function tasksOf(L, projectIds) {
  const ids = [...new Set(projectIds.filter((id) => id !== null && id !== undefined))];
  return L.select({ c: 'tasks', where: [{ col: 'project_id', in: ids }] });
}
function selfAndAgents(L, userId) {
  return [userId, ...Object.values(L.office.users).filter((u) => u.kind === 'agent' && u.ownerId === userId).map((u) => u.id)];
}
function officeTaskConds(L) {
  const nobody = [{ col: 'id', in: [] }];
  if (!L.authority) return nobody;
  const me = L.authority.id;
  if (can(L.authority, 'task.view.office')) return [{ col: 'project_id', eq: null }];
  return [{ col: 'project_id', eq: null }, { or: [{ col: 'owner_id', in: [me] }, { has: 'helperIds', value: me }, { field: 'createdBy', in: selfAndAgents(L, me) }] }];
}
function officeTasks(L, more = [], o = {}) {
  return L.select({ c: 'tasks', where: [...officeTaskConds(L), ...more], ...o });
}
function attachedFiles(L, fileIds) {
  L.byKey('files', fileIds);
  const office = fileIds.map((id) => L.get('files', id)).filter((f) => f?.projectId === null);
  L.byKey('tasks', office.map((f) => f.taskId));
}
function namedFiles(L, records, more = []) {
  L.byKey('files', [...records.flatMap((r) => r.fileIds ?? []), ...more]);
}
function commentsOn(L, targetType, ids) {
  if (ids.length === 0) return [];
  if (!L.write) {
    L.counts('comments', 'target_id', ids, (v) => `c:${v}`);
    return [];
  }
  return L.select({ c: 'comments', where: [{ col: 'target_type', eq: targetType }, { col: 'target_id', in: ids }] });
}
function filesOfTasks(L, taskIds) {
  if (taskIds.length === 0) return;
  if (!L.write) L.counts('files', 'task_id', taskIds, (v) => `f:${v}`);
  else L.select({ c: 'files', where: [{ col: 'task_id', in: taskIds }] });
}
function eventTargets(L, events) {
  const by = new Map();
  for (const e of events) {
    const c = COLLECTION[e.targetType];
    if (c) by.set(c, [...(by.get(c) ?? []), e.targetId]);
  }
  for (const [c, ids] of by) L.byKey(c, ids);
  L.byKey('tasks', events.flatMap((e) => (e.targetType === 'tracker' && typeof e.after?.replyTaskId === 'string' ? [e.after.replyTaskId] : [])));
  const coverEvents = events.filter((e) => typeof e.before?.coverFileId === 'string');
  if (coverEvents.length > 0) L.select({ c: 'events', where: [{ col: 'correlation_id', in: coverEvents.map((e) => e.correlationId) }] });
}
function feed(L, projectIds, filter, limit) {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return;
  if (filter === 'all' || filter === 'posts' || filter === 'decisions') {
    const posts = L.select({ c: 'updates', where: [{ col: 'project_id', in: ids }], order: { col: 'created_at', desc: true }, per: 'project_id', limit, ties: true });
    namedFiles(L, posts);
    commentsOn(L, 'update', posts.map((p) => p.id));
  }
  if (filter !== 'posts' && filter !== 'decisions') {
    const events = L.select({ c: 'events', where: [{ col: 'project_id', in: ids }, { col: 'verb', in: FEED_VERBS }, { notUndone: true }], order: { col: 'created_at', desc: true }, per: 'project_id', limit, ties: true });
    eventTargets(L, events);
  }
}
function covers(L, projectIds) {
  L.byKey('files', projectIds.map((id) => L.office.projects[id]?.coverFileId));
}
function projectView(L, projectId) {
  if (!projectId) return;
  tasksOf(L, [projectId]);
  feed(L, [projectId], 'all', 2);
  covers(L, [projectId]);
}
function taskTail(L, taskIds) {
  const ids = [...new Set(taskIds.filter((id) => typeof id === 'string' && id !== ''))];
  if (ids.length === 0) return;
  L.select({ c: 'events', where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ids }] });
  commentsOn(L, 'task', ids);
  filesOfTasks(L, ids);
  const tasks = ids.map((id) => L.get('tasks', id)).filter(Boolean);
  L.byKey('tracker', tasks.map((t) => t.trackerEntryId));
  namedFiles(L, tasks.map((t) => L.get('tracker', t.trackerEntryId)).filter(Boolean));
}
export function taskScope(L, taskId) {
  L.byKey('tasks', [taskId]);
  const task = L.get('tasks', taskId);
  if (!task) return undefined;
  tasksOf(L, [task.projectId]);
  taskTail(L, [taskId]);
  return task;
}
function newestMessages(L, ids) {
  return L.select({ c: 'messages', where: [{ col: 'conversation_id', in: ids }], order: { col: 'created_at', desc: true, id: true }, per: 'conversation_id', limit: 1 });
}
function pickedByKey(L, c, keys) {
  const missing = [...new Set(keys.filter((k) => k !== ''))].filter((k) => !L.get(c, k));
  if (missing.length > 0) L.select({ c, where: [{ col: 'id', in: missing }] });
}

// --- overview.ts ---
const officeIn = (input) => !input.projectId && !input.leaderId && !input.clientId && !input.teamId;
export function projectsList(L, input) {
  const status = input.status ?? 'active';
  const ids = projects(L)
    .filter((p) => status === 'all' || p.status === status)
    .filter((p) => input.filter !== 'mine' || (L.authority && projectRoleOf(L, p.id, L.authority.id) !== 'other'))
    .map((p) => p.id);
  tasksOf(L, ids);
  feed(L, ids, 'all', 2);
  covers(L, ids);
}
export function dashboardGet(L, input) {
  const status = input.status ?? 'active';
  const inPeople = projects(L);
  const ids = inPeople.filter((p) => status === 'all' || p.status === status).map((p) => p.id);
  const tasks = [...tasksOf(L, ids), ...(officeIn(input) ? officeTasks(L) : [])];
  const review = tasks.filter((t) => t.status === 'in_review').map((t) => t.id);
  L.select({ c: 'events', where: [{ col: 'target_type', in: ['task'] }, { col: 'target_id', in: review }, { field: 'after', key: 'status', in: ['in_review'] }] });
  L.select({ c: 'tracker', where: [{ col: 'project_id', in: ids }, { or: [{ col: 'open', eq: true }, { field: 'direction', in: ['out'] }] }] });
  if (L.authority && can(L.authority, 'payment.manage')) {
    L.select({ c: 'payments', where: [{ col: 'project_id', in: inPeople.map((p) => p.id) }, { field: 'receivedOn', null: true }] });
  }
}
export function tasksList(L, input) {
  const ids = projects(L).filter((p) => (input.activeProjectsOnly === false || p.status === 'active') && (!input.projectId || p.id === input.projectId)).map((p) => p.id);
  const person = input.ownerId ?? (input.filter === 'mine' ? L.authority?.id : undefined);
  const where = [];
  if (person) where.push({ or: [{ col: 'owner_id', in: [person] }, { has: 'helperIds', value: person }] });
  if (input.workOf) where.push({ or: [{ col: 'owner_id', in: [input.workOf] }, { has: 'helperIds', value: input.workOf }, { col: 'status', in: ['in_review'] }] });
  if (input.filter === 'review_for_me') where.push({ col: 'status', in: ['in_review'] });
  if (input.includeDone === false) where.push({ col: 'status', notIn: ['done'] });
  const tasks = [...L.select({ c: 'tasks', where: [{ col: 'project_id', in: ids }, ...where] }), ...(officeIn(input) ? officeTasks(L, where) : [])];
  const waiting = tasks.filter((t) => t.status !== 'done' && t.stageId !== null
    && ((t.prerequisiteIds ?? []).length > 0 || (L.office.stages[t.stageId]?.prerequisiteIds ?? []).length > 0));
  tasksOf(L, waiting.map((t) => t.projectId));
  L.counts('comments', 'target_id', tasks.map((t) => t.id), (v) => `c:${v}`);
  L.counts('files', 'task_id', tasks.map((t) => t.id), (v) => `f:${v}`);
}
export function searchQuery(L, input) {
  const query = String(input.text ?? '').toLowerCase();
  if (!query) return;
  const active = projects(L).filter((p) => p.status === 'active').map((p) => p.id);
  L.select({ c: 'tasks', where: [{ col: 'project_id', in: active }, { col: 'search_text', contains: query }], limit: 5 });
  officeTasks(L, [{ col: 'search_text', contains: query }], { limit: 5 });
  L.select({ c: 'files', where: [{ col: 'project_id', in: Object.keys(L.office.projects) }, { col: 'search_text', contains: query }], limit: 5 });
  const seen = officeTasks(L).map((t) => t.id);
  L.select({ c: 'files', where: [{ col: 'project_id', eq: null }, { col: 'task_id', in: seen }, { col: 'search_text', contains: query }], limit: 5 });
}
export function eventsList(L, input) {
  if (!L.authority) return;
  const where = [];
  const hidden = [...(can(L.authority, 'payment.manage') ? [] : ['payment']), ...(can(L.authority, 'admin.manage') ? [] : ['feedback'])];
  if (hidden.length > 0) where.push({ col: 'target_type', notIn: hidden });
  for (const [f, col] of [['projectId', 'project_id'], ['targetType', 'target_type'], ['targetId', 'target_id']]) if (input[f]) where.push({ col, in: [input[f]] });
  if (input.since) where.push({ col: 'created_at', atOrAfter: input.since });
  if (!can(L.authority, 'task.view.office')) {
    const seen = officeTasks(L).map((t) => t.id);
    where.push({ or: [{ field: 'officeTaskId', null: true }, { field: 'officeTaskId', in: seen }] });
  }
  const events = L.select({ c: 'events', where, order: { col: 'seq', desc: true }, limit: input.limit ?? 50 });
  eventTargets(L, events);
}

// --- project.ts, task.ts ---
export function projectCall(L, projectId) {
  projectView(L, projectId);
  L.byKey('tracker', [L.office.projects[projectId]?.pause?.trackerId]);
}
export function updatesList(L, input) {
  tasksOf(L, [input.projectId]);
  feed(L, [input.projectId], input.filter ?? 'all', input.limit ?? 50);
}
export function filesList(L, input) {
  L.select({ c: 'files', where: [{ col: 'project_id', in: [input.projectId] }] });
}
export function commentsList(L, input) {
  L.byKey(input.targetType === 'task' ? 'tasks' : 'updates', [input.targetId]);
  const comments = L.select({ c: 'comments', where: [{ col: 'target_type', eq: input.targetType }, { col: 'target_id', in: [input.targetId] }] });
  namedFiles(L, comments);
}
export function commentsCreate(L, input) {
  L.byKey(input.targetType === 'task' ? 'tasks' : 'updates', [input.targetId]);
  attachedFiles(L, input.fileIds ?? []);
}
export function chatsSend(L, input) {
  attachedFiles(L, input.fileIds ?? []);
  if (L.authority) L.byKey('chatReads', [`${input.conversationId}:${L.authority.id}`]);
  newestMessages(L, [input.conversationId]);
}

// --- inbox.ts ---
function unreadOf(L, userId) {
  L.select({ c: 'notifications', where: [{ col: 'user_id', in: [userId] }, { col: 'read', eq: false }] });
}
function targets(L, counted) {
  const notices = L.list('notifications');
  const of = (type) => notices.filter((n) => n.targetType === type).map((n) => n.targetId);
  if (counted) {
    pickedByKey(L, 'tasks', of('task'));
    pickedByKey(L, 'updates', of('update'));
    pickedByKey(L, 'feedback', of('feedback'));
    return;
  }
  L.byKey('tasks', of('task'));
  L.byKey('updates', of('update'));
  L.byKey('feedback', of('feedback'));
}
export function notificationsCount(L, input = {}) {
  if (!L.authority) return;
  unreadOf(L, L.authority.id);
  L.byKey('notifications', input.ids ?? []);
  targets(L, !L.write);
}
export function notificationsList(L, input) {
  if (!L.authority) return;
  unreadOf(L, L.authority.id);
  if (input.unreadOnly !== true) {
    L.select({ c: 'notifications', where: [{ col: 'user_id', in: [L.authority.id] }, { col: 'read', eq: true }], order: { col: 'created_at', desc: true, id: true }, limit: input.limit ?? 100 });
  }
  targets(L, false);
  const gone = L.list('notifications').filter((n) => (n.targetType === 'task' ? !L.get('tasks', n.targetId) : n.targetType === 'update' ? !L.get('updates', n.targetId) : n.targetType === 'project' ? !L.get('projects', n.targetId) : false));
  if (gone.length === 0) return;
  L.select({ c: 'events', where: [{ col: 'target_id', in: gone.map((n) => n.targetId) }, { col: 'verb', in: ['task.deleted', 'update.deleted', 'project.deleted'] }] });
}

// --- chat.ts ---
const meOf = (L, userId) => selfAndAgents(L, userId);
const markOf = (L, id, userId) => L.get('chatReads', `${id}:${userId}`)?.lastReadAt ?? '';
function chatsOf(L, userId, conversations, mode) {
  const ids = conversations.map((c) => c.id);
  L.byKey('chatReads', ids.map((id) => `${id}:${userId}`));
  if (!mode.badge) newestMessages(L, ids);
  const by = Object.fromEntries(ids.map((id) => [id, { gt: markOf(L, id, userId) }]));
  L.countWhere({ c: 'messages', per: 'conversation_id', where: [{ bounds: { col: 'conversation_id', by } }, { field: 'authorId', notIn: meOf(L, userId) }, { field: 'actingForId', notIn: [userId] }] }, ids, (id) => `u:${id}`);
}
function threadsOf(L, userId, mode) {
  if (!L.authority) return;
  const me = meOf(L, userId);
  const led = projects(L).filter((p) => p.leaderId === userId).map((p) => p.id);
  const threads = L.src.threads({ owner: userId, led, me, limit: TASK_THREAD_LIMIT, admin: can(L.authority, 'task.view.office') });
  if (threads.length === 0) return;
  const ids = threads.map((t) => t.id);
  if (mode.badge) pickedByKey(L, 'tasks', ids);
  else L.byKey('tasks', ids);
  L.byKey('chatReads', ids.map((id) => `${id}:${userId}`));
  const newest = { order: { col: 'created_at', desc: true, id: true }, per: 'target_id', limit: 1 };
  const onThreads = [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ids }];
  L.select({ c: 'comments', where: onThreads, ...newest });
  const own = L.select({ c: 'comments', where: [...onThreads, { field: 'authorId', in: me }], ...newest });
  const lastOwn = new Map(own.map((c) => [c.targetId, { at: c.createdAt, id: c.id }]));
  const by = Object.fromEntries(ids.map((id) => {
    const after = lastOwn.get(id);
    return [id, { gt: markOf(L, id, userId), ...(after ? { after } : {}) }];
  }));
  L.countWhere({ c: 'comments', per: 'target_id', where: [{ col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by } }, { field: 'authorId', notIn: me }] }, ids, (id) => `u:${id}`);
}
function visible(L) {
  if (!L.authority) return [];
  return Object.values(L.office.conversations).filter((c) => {
    if (c.kind === 'direct') return c.memberIds.includes(L.authority.id);
    return isAdmin(L.authority) || projectRoleOf(L, c.projectId, L.authority.id) !== 'other';
  });
}
export function chatsUnread(L) {
  if (!L.authority) return;
  chatsOf(L, L.authority.id, visible(L), { badge: true });
  threadsOf(L, L.authority.id, { badge: true });
}
export function chatsAll(L) {
  if (!L.authority) return;
  chatsOf(L, L.authority.id, visible(L), {});
  threadsOf(L, L.authority.id, {});
}
export function chatsMessages(L, input) {
  const conversation = L.office.conversations[input.conversationId];
  if (!L.authority || !conversation) return;
  chatsOf(L, L.authority.id, [conversation], {});
  const page = L.select({ c: 'messages', where: [{ col: 'conversation_id', in: [input.conversationId] }], order: { col: 'created_at', desc: true, id: true }, limit: input.limit ?? 200 });
  namedFiles(L, [...page, ...L.list('messages').filter((m) => m.conversationId === input.conversationId)]);
}

// --- jobs.ts and the trigger step ---
export function loadJobs(L) {
  const active = projects(L).filter((p) => p.status === 'active').map((p) => p.id);
  const open = L.select({ c: 'tasks', where: [{ col: 'project_id', in: active }, { col: 'status', in: ['todo', 'in_progress'] }] });
  const office = L.select({ c: 'tasks', where: [{ col: 'project_id', eq: null }, { col: 'status', in: ['todo', 'in_progress'] }] });
  return [...open, ...office];
}

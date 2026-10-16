// One year of growth data for an office of 15 people, made the same way on each run (a seeded random source).
// The layout (people, projects, tasks) is small and is made again on each request. The big tables (events, comments,
// notifications, messages, files) are made by record number, so a request can make any part of them alone.

export const DAY = 86_400_000;
export const NOW = Date.parse('2026-10-16T12:00:00Z');
export const YEAR_START = NOW - 365 * DAY;
const SPAN = NOW - YEAR_START;

/**
 * year: one year of growth (about 140,000 records). sample: the size of the sample office that the test copy seed writes
 * (scripts/seed-test-office.ts, buildSeed: 945 records), so the test copy calls read what they read there.
 */
const PROFILES = {
  year: { projects: 72, tasksMin: 30, tasksMax: 60, directs: 44, events: 62_000, comments: 12_000, notifications: 26_000, messages: 20_000, files: 6_000, tracker: 1_500, updates: 2_600, payments: 430, feedback: 120, push_devices: 25, officeTasks: 160 },
  sample: { projects: 12, tasksMin: 10, tasksMax: 14, directs: 2, events: 340, comments: 32, notifications: 28, messages: 18, files: 60, tracker: 21, updates: 60, payments: 11, feedback: 5, push_devices: 4, officeTasks: 4 },
};
export const COUNTS = { ...PROFILES.year };
let profile = 'year';
/** Chooses the size of the data for this request. */
export function useProfile(name = 'year') {
  if (!PROFILES[name]) throw new Error(`no profile ${name}`);
  profile = name;
  Object.assign(COUNTS, PROFILES[name]);
}

/** A small fast random source (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const rngOf = (table, i) => rng(hash(`${table}:${i}`));
const pick = (r, list) => list[Math.floor(r() * list.length)];
const pad = (n, w = 3) => String(n).padStart(w, '0');
export const pid = (prefix, n) => `${prefix}_${pad(n)}`;

/** The Riyadh stamp of a time, as Madar keeps it: 2026-09-30T09:00:00.000+03:00. */
export function stamp(ms) {
  return new Date(ms + 3 * 3_600_000).toISOString().replace('Z', '+03:00');
}
const dateOf = (ms) => stamp(ms).slice(0, 10);

const WORDS = ['roof', 'plan', 'facade', 'section', 'stair', 'core', 'parking', 'villa', 'tower', 'mosque', 'clinic', 'lobby',
  'elevation', 'detail', 'drainage', 'structure', 'permit', 'balady', 'client', 'model', 'render', 'landscape', 'fence', 'pool',
  'kitchen', 'majlis', 'basement', 'mezzanine', 'shading', 'window', 'door', 'schedule', 'review', 'markup', 'survey', 'site'];
const words = (r, n) => Array.from({ length: n }, () => pick(r, WORDS)).join(' ');
const sentence = (r, min, max) => {
  const n = min + Math.floor(r() * (max - min + 1));
  const text = words(r, n);
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
};
const normal = (text) => text.toLowerCase();

const HUMANS = Array.from({ length: 15 }, (_, i) => pid('usr', i + 1));
const AGENTS = [[16, 1], [17, 2], [18, 4], [19, 5], [20, 6]].map(([n, owner]) => ({ id: pid('usr', n), ownerId: pid('usr', owner) }));
const LEADERS = HUMANS.slice(1, 9);
/** People who rarely open the bell: their unread notices pile up (the worst case of notifications.count). */
export const NON_READERS = ['usr_013', 'usr_014', 'usr_015'];
const STAGE_NAMES = ['Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits', 'Tender', 'Supervision'];

const cachedOf = {};

/** The people, projects, members, stages, tasks and chats. Small enough to make on each request. */
export function layout() {
  if (cachedOf[profile]) return cachedOf[profile];
  const P = PROFILES[profile];
  const r = rng(42);
  const users = [
    ...HUMANS.map((id, i) => ({
      id, kind: 'human', name: `Person ${i + 1}`, email: `${id}@office.test`, avatarUrl: null,
      systemRole: i === 0 ? 'admin' : i === 1 ? 'management' : i === 2 ? 'accounting' : 'member',
      discipline: pick(r, ['Architect', 'Engineer', 'Interior']), active: true, ownerId: null,
      preferences: { language: 'en', theme: 'system', notifications: { mention: true, task_assigned: true, review: true, due: true } },
    })),
    ...AGENTS.map((a) => ({
      id: a.id, kind: 'agent', name: `Agent of ${a.ownerId}`, email: `${a.id}@agents.test`, avatarUrl: null, systemRole: 'member',
      discipline: 'Agent', active: true, ownerId: a.ownerId, preferences: {},
    })),
  ];
  const teams = Array.from({ length: 4 }, (_, i) => ({ id: pid('tem', i + 1), name: `Team ${i + 1}`, memberIds: HUMANS.slice(3 + i * 3, 6 + i * 3) }));
  const settings = { defaultStages: STAGE_NAMES, codePrefix: 'KH', workloadLimit: 10, staleAfterDays: 30 };
  const clients = Array.from({ length: 60 }, (_, i) => ({ id: pid('cli', i + 1), name: `Client ${i + 1}`, nameAr: `عميل ${i + 1}`, phone: '0500000000', email: `client${i + 1}@mail.test`, notes: sentence(r, 3, 12) }));
  const stageTemplates = STAGE_NAMES.map((name, i) => ({ id: pid('stt', i + 1), name, order: i, tasks: Array.from({ length: 6 }, () => sentence(r, 2, 5)) }));
  const taskTemplates = Array.from({ length: 30 }, (_, i) => ({ id: pid('ttp', i + 1), name: sentence(r, 2, 4), items: Array.from({ length: 5 }, () => ({ title: sentence(r, 2, 5), daysAfter: 3 })) }));
  const projectTemplates = Array.from({ length: 5 }, (_, i) => ({ id: pid('ptp', i + 1), name: `Template ${i + 1}`, stages: STAGE_NAMES.map((name) => ({ name, tasks: Array.from({ length: 8 }, () => sentence(r, 2, 5)) })) }));

  const projects = [];
  const members = [];
  const stages = [];
  const deadlines = [];
  const conversations = [];
  const taskSeeds = [];
  for (let p = 1; p <= P.projects; p++) {
    const id = pid('prj', p);
    const start = YEAR_START - 150 * DAY + ((p - 1) / P.projects) * (SPAN + 120 * DAY);
    const end = start + (120 + r() * 300) * DAY;
    let status = end < NOW ? (r() < 0.1 ? 'archived' : 'completed') : 'active';
    if (status === 'active' && p % 7 === 0) status = 'on_hold';
    const leaderId = pick(r, LEADERS);
    const team = new Set([leaderId]);
    const size = 4 + Math.floor(r() * 5);
    while (team.size < size) team.add(pick(r, HUMANS.slice(1)));
    const stageIds = STAGE_NAMES.map((_, s) => pid('stg', (p - 1) * 7 + s + 1));
    const nowStage = Math.min(6, Math.floor(((Math.min(NOW, end) - start) / (end - start)) * 7));
    projects.push({
      id, code: `KH-${p < 20 ? 25 : 26}-${pad(p)}`, name: `Project ${words(r, 2)} ${p}`, clientId: pid('cli', 1 + (p % 60)), status, leaderId,
      currentStageId: stageIds[nowStage], location: 'Al Khobar', areaM2: r() < 0.15 ? null : Math.round(500 + r() * 9000),
      startDate: dateOf(start), targetEndDate: dateOf(end), coverFileId: null, modelFolderPath: '', description: sentence(r, 8, 30),
      healthOverride: null, createdBy: 'usr_001', createdAt: stamp(start), updatedAt: stamp(Math.min(NOW, end)),
      ...(status === 'on_hold' ? { pause: { reason: 'Client', since: dateOf(NOW - 20 * DAY), trackerId: null } } : {}),
    });
    for (const userId of team) members.push({ projectId: id, userId, discipline: 'Architect' });
    STAGE_NAMES.forEach((name, s) => {
      const s0 = start + (s / 7) * (end - start);
      stages.push({ id: stageIds[s], projectId: id, name, order: s, startDate: dateOf(s0), endDate: r() < 0.1 ? null : dateOf(s0 + (end - start) / 7), prerequisiteIds: [] });
    });
    for (let d = 0; d < 3; d++) deadlines.push({ id: pid('ddl', (p - 1) * 3 + d + 1), projectId: id, title: sentence(r, 2, 4), date: dateOf(start + ((d + 1) / 4) * (end - start)), kind: 'client' });
    conversations.push({ id: pid('cnv', p), kind: 'project', projectId: id, memberIds: [], createdAt: stamp(start) });
    const n = P.tasksMin + Math.floor(r() * (P.tasksMax - P.tasksMin + 1));
    for (let k = 0; k < n; k++) {
      const at = start + r() * (Math.min(NOW, end) - start);
      if (at < NOW) taskSeeds.push({ at, projectId: id, status, team: [...team], leaderId, stageIds, start, end });
    }
  }
  for (let o = 0; o < COUNTS.officeTasks; o++) taskSeeds.push({ at: YEAR_START + r() * SPAN, projectId: null, team: HUMANS, leaderId: null });
  let dn = P.projects;
  const lastDirect = P.projects + P.directs;
  for (let a = 1; a <= 15 && dn < lastDirect; a++) {
    for (let b = a + 1; b <= 15 && dn < lastDirect; b++) {
      if ((a * 7 + b * 3) % 3 === 0 || a === 1) {
        dn++;
        conversations.push({ id: pid('cnv', dn), kind: 'direct', projectId: null, memberIds: [pid('usr', a), pid('usr', b)], createdAt: stamp(YEAR_START) });
      }
    }
  }

  // Tasks: numbered in the order they were made, so a time maps to the tasks that existed then.
  taskSeeds.sort((x, y) => x.at - y.at);
  const tasks = taskSeeds.map((seed, i) => {
    const tr = rngOf('task', i);
    const id = pid('tsk', i + 1);
    const ownerId = pick(tr, seed.team);
    const helpers = [...new Set(Array.from({ length: Math.floor(tr() * 3) }, () => pick(tr, seed.team)))].filter((h) => h !== ownerId);
    const age = NOW - seed.at;
    let status;
    if (seed.projectId && seed.status !== 'active' && seed.status !== 'on_hold') status = 'done';
    else if (age > 60 * DAY) status = tr() < 0.88 ? 'done' : pick(tr, ['todo', 'in_progress', 'in_review']);
    else status = pick(tr, ['done', 'done', 'todo', 'todo', 'in_progress', 'in_progress', 'in_review']);
    const stageIndex = seed.projectId ? Math.min(6, Math.max(0, Math.floor(((seed.at - seed.start) / (seed.end - seed.start)) * 7))) : -1;
    const title = sentence(tr, 2, 6).slice(0, -1);
    return {
      id, projectId: seed.projectId, stageId: seed.projectId ? seed.stageIds[stageIndex] : null, title, description: tr() < 0.5 ? sentence(tr, 5, 40) : '',
      ownerId: tr() < 0.03 ? null : ownerId, helperIds: helpers, status, dueDate: tr() < 0.2 ? null : dateOf(seed.at + (3 + tr() * 30) * DAY),
      flagged: tr() < 0.05, needsReview: tr() < 0.4, checklist: tr() < 0.3 ? [{ id: 'c1', text: words(tr, 3), done: false }, { id: 'c2', text: words(tr, 3), done: true }] : [],
      createdBy: seed.leaderId && tr() < 0.7 ? seed.leaderId : ownerId, createdAt: stamp(seed.at),
      completedAt: status === 'done' ? stamp(Math.min(NOW - 3_600_000, seed.at + (1 + tr() * 20) * DAY)) : null,
      prerequisiteIds: [], at: seed.at,
    };
  });
  // Some tasks wait for an earlier task of the same project.
  const lastOfProject = new Map();
  for (const task of tasks) {
    const prev = lastOfProject.get(task.projectId);
    if (prev && task.projectId && rngOf('pre', task.id)() < 0.1) task.prerequisiteIds = [prev];
    lastOfProject.set(task.projectId, task.id);
  }
  const taskTimes = tasks.map((t) => t.at);
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const membersOf = new Map();
  for (const m of members) membersOf.set(m.projectId, [...(membersOf.get(m.projectId) ?? []), m.userId]);
  cachedOf[profile] = { users, teams, settings, clients, stageTemplates, taskTemplates, projectTemplates, projects, members, stages, deadlines, conversations, tasks, taskTimes, projectOf, membersOf };
  return cachedOf[profile];
}

/** The number of tasks made at or before this time. */
function tasksBefore(L, ms) {
  let lo = 0;
  let hi = L.taskTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (L.taskTimes[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** A task that existed at this time, most often a recent one (recent tasks get the most changes). */
function recentTask(L, r, ms) {
  const n = Math.max(1, tasksBefore(L, ms));
  const back = Math.floor(r() * r() * Math.min(n, 500));
  return L.tasks[Math.max(0, n - 1 - back)];
}
const timeOf = (i, count) => YEAR_START + ((i + 0.5) / count) * SPAN;
const indexAt = (ms, count) => Math.max(0, Math.min(count - 1, Math.floor(((ms - YEAR_START) / SPAN) * count)));

const TASK_VERBS = [['task.updated', 40], ['task.status_changed', 30], ['task.created', 10], ['task.dates_shifted', 6], ['task.approved', 6], ['task.sent_back', 3], ['task.reopened', 2], ['task.version_opened', 2], ['task.deleted', 1]];
function weighted(r, list) {
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  let x = r() * total;
  for (const [value, w] of list) {
    x -= w;
    if (x < 0) return value;
  }
  return list[0][0];
}

/** Event number i (seq i + 1). Its time grows with i, so seq follows time as under the office lock. */
export function eventAt(L, i) {
  const r = rngOf('evt', i);
  const ms = timeOf(i, COUNTS.events);
  const kind = weighted(r, [['task', 58], ['comment', 19], ['file', 9], ['update', 4], ['tracker', 6], ['payment', 2], ['project', 2]]);
  let targetType = kind;
  let targetId;
  let projectId;
  let verb;
  let officeTaskId;
  let after = {};
  if (kind === 'task') {
    const task = recentTask(L, r, ms);
    targetId = task.id;
    projectId = task.projectId;
    verb = weighted(r, TASK_VERBS);
    if (verb === 'task.status_changed') after = { status: weighted(r, [['in_progress', 35], ['in_review', 30], ['done', 30], ['todo', 5]]) };
    else after = { title: task.title, dueDate: task.dueDate };
    if (projectId === null) officeTaskId = task.id;
  } else if (kind === 'comment') {
    const n = indexAt(ms, COUNTS.comments);
    targetId = pid('cmt', n + 1);
    const c = commentAt(L, n);
    projectId = c.project_id;
    verb = 'comment.created';
    if (projectId === null && c.doc.targetType === 'task') officeTaskId = c.doc.targetId;
    after = { body: c.doc.body.slice(0, 80) };
  } else if (kind === 'file') {
    const n = indexAt(ms, COUNTS.files);
    const f = fileAt(L, n);
    targetId = f.id;
    projectId = f.doc.projectId;
    verb = r() < 0.7 ? 'file.added' : 'file.version_added';
    if (projectId === null) officeTaskId = f.doc.taskId;
    after = { name: f.doc.name };
  } else if (kind === 'update') {
    const n = indexAt(ms, COUNTS.updates);
    const u = updateAt(L, n);
    targetId = u.id;
    projectId = u.doc.projectId;
    verb = 'update.created';
  } else if (kind === 'tracker') {
    const n = indexAt(ms, COUNTS.tracker);
    const t = trackerAt(L, n);
    targetId = t.id;
    projectId = t.doc.projectId;
    verb = pick(r, ['tracker.logged', 'tracker.closed', 'tracker.updated']);
    after = { waiting: t.doc.waiting, replyTaskId: t.doc.replyTaskId, fileIds: [] };
  } else if (kind === 'payment') {
    const n = indexAt(ms, COUNTS.payments);
    const pay = paymentAt(L, n);
    targetId = pay.id;
    projectId = pay.doc.projectId;
    verb = pick(r, ['payment.created', 'payment.received']);
  } else {
    const task = recentTask(L, r, ms);
    projectId = task.projectId ?? L.projects[Math.floor(r() * L.projects.length)].id;
    targetType = 'project';
    targetId = projectId;
    verb = pick(r, ['project.stage_changed', 'member.added', 'project.updated', 'project.leader_changed']);
  }
  const actorId = pick(r, projectId ? (L.membersOf.get(projectId) ?? HUMANS) : HUMANS);
  const id = pid('evt', i + 1);
  // About 1 change in 200 is an Undo of a change a little earlier.
  const undoes = i > 20 && r() < 0.005 ? pid('evt', i - Math.floor(r() * 15)) : null;
  const doc = {
    id, seq: i + 1, verb, targetType, targetId, projectId: projectId ?? null, actorId, actingForId: actorId, actorKind: 'human',
    before: r() < 0.5 ? null : { note: words(r, 4) }, after, undoes, undoneBy: null, createdAt: stamp(ms),
    correlationId: `sty_${pad(Math.floor(i / 1.3), 8)}`, ...(officeTaskId ? { officeTaskId } : {}),
  };
  return { id, doc, cols: { seq: i + 1, project_id: doc.projectId, target_type: targetType, target_id: targetId, correlation_id: doc.correlationId, verb, undoes, created_at: doc.createdAt } };
}

export function commentAt(L, i) {
  const r = rngOf('cmt', i);
  const ms = timeOf(i, COUNTS.comments);
  const onTask = r() < 0.9;
  let targetType = 'task';
  let targetId;
  let projectId;
  if (onTask) {
    const task = recentTask(L, r, ms);
    targetId = task.id;
    projectId = task.projectId;
  } else {
    const u = updateAt(L, indexAt(ms, COUNTS.updates));
    targetType = 'update';
    targetId = u.id;
    projectId = u.doc.projectId;
  }
  const authorId = pick(r, projectId ? (L.membersOf.get(projectId) ?? HUMANS) : HUMANS);
  const id = pid('cmt', i + 1);
  const doc = { id, targetType, targetId, authorId, actingForId: authorId, body: sentence(r, 3, 45), mentions: [], fileIds: [], reactions: [], createdAt: stamp(ms), editedAt: null };
  return { id, doc, project_id: projectId ?? null, cols: { target_type: targetType, target_id: targetId, created_at: doc.createdAt, project_id: projectId ?? null } };
}

export function notificationAt(L, i) {
  const r = rngOf('ntf', i);
  const ms = timeOf(i, COUNTS.notifications);
  const userId = r() < 0.35 ? pick(r, LEADERS) : pick(r, HUMANS);
  const targetType = weighted(r, [['task', 70], ['project', 12], ['update', 8], ['chat', 8], ['feedback', 2]]);
  let targetId;
  if (targetType === 'task') targetId = recentTask(L, r, ms).id;
  else if (targetType === 'update') targetId = pid('upd', indexAt(ms, COUNTS.updates) + 1);
  else if (targetType === 'project') targetId = recentTask(L, r, ms).projectId ?? 'prj_001';
  else if (targetType === 'chat') targetId = pick(r, L.conversations).id;
  else targetId = pid('fbk', 1 + Math.floor(r() * COUNTS.feedback));
  const age = NOW - ms;
  const read = NON_READERS.includes(userId) ? r() < 0.5 : age > 3 * DAY ? r() < 0.99 : r() < 0.5;
  const trigger = targetType === 'task' ? pick(r, ['task_assigned', 'review', 'due', 'mention', 'overdue']) : 'mention';
  const dedupe = trigger === 'due' || trigger === 'overdue' ? `${trigger}:${targetId}:${userId}:${dateOf(ms)}:${i}` : null;
  const id = pid('ntf', i + 1);
  const doc = { id, userId, trigger, targetType, targetId, actorId: pick(r, HUMANS), read, createdAt: stamp(ms), correlationId: `sty_${pad(Math.floor(i * 1.7), 8)}`, dedupeKey: dedupe, text: sentence(r, 3, 10) };
  return { id, doc, cols: { user_id: userId, read: read ? 1 : 0, created_at: doc.createdAt, correlation_id: doc.correlationId, target_type: targetType, target_id: targetId, dedupe_key: dedupe } };
}

export function messageAt(L, i) {
  const r = rngOf('msg', i);
  const ms = timeOf(i, COUNTS.messages);
  let conversation;
  const directs = L.conversations.filter((c) => c.kind === 'direct');
  if (r() < 0.75) {
    const task = recentTask(L, r, ms);
    conversation = task.projectId ? L.conversations[Number(task.projectId.slice(4)) - 1] : pick(r, directs);
  } else conversation = pick(r, directs);
  const authorId = conversation.kind === 'direct' ? pick(r, conversation.memberIds) : pick(r, L.membersOf.get(conversation.projectId) ?? HUMANS);
  const id = pid('msg', i + 1);
  const doc = { id, conversationId: conversation.id, authorId, actingForId: authorId, body: sentence(r, 2, 35), mentions: [], fileIds: [], createdAt: stamp(ms), editedAt: null };
  return { id, doc, cols: { conversation_id: conversation.id, created_at: doc.createdAt } };
}

export function fileAt(L, i) {
  const r = rngOf('fil', i);
  const ms = timeOf(i, COUNTS.files);
  const task = recentTask(L, r, ms);
  const onTask = task.projectId === null || r() < 0.6;
  const name = `${words(r, 2).replace(' ', '-')}-${i}.pdf`;
  const id = pid('fil', i + 1);
  const doc = {
    id, projectId: task.projectId, taskId: onTask ? task.id : null, stageId: task.stageId, name, mimeType: 'application/pdf', size: Math.floor(r() * 9e6),
    versions: [{ letter: 'A', key: `f/${id}/a`, size: 100000, at: stamp(ms) }, ...(r() < 0.3 ? [{ letter: 'B', key: `f/${id}/b`, size: 120000, at: stamp(ms) }] : [])],
    delivered: r() < 0.3, uploadedBy: task.ownerId ?? 'usr_001', createdAt: stamp(ms),
  };
  return { id, doc, cols: { project_id: task.projectId, task_id: doc.taskId, stage_id: task.stageId, search_text: normal(name) } };
}

export function trackerAt(L, i) {
  const r = rngOf('trk', i);
  const ms = timeOf(i, COUNTS.tracker);
  const task = recentTask(L, r, ms);
  const projectId = task.projectId ?? 'prj_001';
  const waiting = r() < 0.35 ? pick(r, ['client', 'office']) : null;
  const closedAt = NOW - ms > 30 * DAY ? (r() < 0.9 ? stamp(ms + 10 * DAY) : null) : r() < 0.4 ? stamp(ms + DAY) : null;
  const replyTaskId = r() < 0.3 ? task.id : null;
  const id = pid('trk', i + 1);
  const doc = { id, projectId, direction: r() < 0.5 ? 'in' : 'out', channel: 'email', summary: sentence(r, 4, 20), waiting, closedAt, replyTaskId, fileIds: [], date: dateOf(ms), createdAt: stamp(ms) };
  const open = waiting !== null && closedAt === null ? 1 : 0;
  return { id, doc, cols: { project_id: projectId, reply_task_id: replyTaskId, open } };
}

export function paymentAt(L, i) {
  const r = rngOf('pay', i);
  const ms = timeOf(i, COUNTS.payments);
  const projectId = recentTask(L, r, ms).projectId ?? 'prj_001';
  const id = pid('pay', i + 1);
  const doc = { id, projectId, label: sentence(r, 2, 4), amount: Math.round(r() * 200000), dueOn: dateOf(ms), receivedOn: NOW - ms > 45 * DAY && r() < 0.8 ? dateOf(ms + 20 * DAY) : null, createdAt: stamp(ms) };
  return { id, doc, cols: { project_id: projectId } };
}

export function updateAt(L, i) {
  const r = rngOf('upd', i);
  const ms = timeOf(i, COUNTS.updates);
  const projectId = recentTask(L, r, ms).projectId ?? L.projects[i % L.projects.length].id;
  const id = pid('upd', i + 1);
  const doc = { id, projectId, authorId: pick(r, L.membersOf.get(projectId) ?? HUMANS), body: sentence(r, 8, 80), decision: r() < 0.1, fileIds: r() < 0.2 ? [pid('fil', 1 + indexAt(ms, COUNTS.files))] : [], createdAt: stamp(ms), editedAt: null };
  return { id, doc, cols: { project_id: projectId, created_at: doc.createdAt } };
}

export function feedbackAt(L, i) {
  const r = rngOf('fbk', i);
  const id = pid('fbk', i + 1);
  return { id, doc: { id, kind: r() < 0.5 ? 'bug' : 'idea', message: sentence(r, 5, 40), page: '/home', status: r() < 0.7 ? 'done' : 'new', userId: pick(r, HUMANS), createdAt: stamp(timeOf(i, COUNTS.feedback)) }, cols: {} };
}

export function pushAt(L, i) {
  const id = pid('psh', i + 1);
  const userId = HUMANS[i % 15];
  return { id, doc: { id, userId, endpoint: `https://push.example/${id}`, keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) }, createdAt: stamp(YEAR_START) }, cols: { user_id: userId, endpoint: `https://push.example/${id}` } };
}

/** The read marks: each person in each chat they see, and about 2,000 task threads. */
const readsOf = {};
export function chatReadsAll(L) {
  if (readsOf[profile]) return readsOf[profile];
  const want = profile === 'year' ? 2_500 : 16;
  const rows = [];
  const seen = new Set();
  for (const c of L.conversations) {
    const people = c.kind === 'direct' ? c.memberIds : (L.membersOf.get(c.projectId) ?? []);
    for (const userId of people) {
      seen.add(`${c.id}:${userId}`);
      rows.push({ conversationId: c.id, userId, lastReadAt: stamp(NOW - Math.floor(rngOf('crd', c.id + userId)() * 20) * DAY) });
    }
  }
  // The read marks of task threads: a person on the task (lead, maker or helper) of one of the newest 3,000 tasks.
  for (let i = 0; rows.length < want && i < 100_000; i++) {
    const r = rngOf('crt', i);
    const task = L.tasks[L.tasks.length - 1 - Math.floor(r() * Math.min(3000, L.tasks.length))];
    const userId = pick(r, [task.ownerId ?? 'usr_001', task.createdBy, ...task.helperIds]);
    const key = `${task.id}:${userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ conversationId: task.id, userId, lastReadAt: stamp(NOW - Math.floor(r() * 30) * DAY) });
  }
  readsOf[profile] = rows.slice(0, Math.max(want, profile === 'year' ? 0 : 16)).map((doc) => ({ id: `${doc.conversationId}:${doc.userId}`, doc, cols: { conversation_id: doc.conversationId, user_id: doc.userId } }));
  return readsOf[profile];
}

/** The office tables as rows: id, doc and the key columns. */
export function officeRows(L) {
  const r = rng(7);
  const covered = L.projects.map((p) => ({ ...p, coverFileId: r() < 0.5 ? pid('fil', 1 + Math.floor(r() * COUNTS.files)) : null }));
  return {
    users: L.users.map((u) => ({ id: u.id, doc: u, cols: { kind: u.kind, owner_id: u.ownerId, active: u.active ? 1 : 0, email: u.email.toLowerCase(), auth_user_id: `00000000-0000-4000-8000-${u.id.slice(4).padStart(12, '0')}` } })),
    teams: L.teams.map((t) => ({ id: t.id, doc: t, cols: {} })),
    settings: [{ id: 'office', doc: L.settings, cols: {} }],
    clients: L.clients.map((c) => ({ id: c.id, doc: c, cols: {} })),
    stage_templates: L.stageTemplates.map((t) => ({ id: t.id, doc: t, cols: {} })),
    task_templates: L.taskTemplates.map((t) => ({ id: t.id, doc: t, cols: {} })),
    project_templates: L.projectTemplates.map((t) => ({ id: t.id, doc: t, cols: {} })),
    projects: covered.map((p) => ({ id: p.id, doc: p, cols: { status: p.status, client_id: p.clientId, leader_id: p.leaderId, code: p.code, search_text: normal(`${p.code} ${p.name}`) } })),
    members: L.members.map((m) => ({ id: `${m.projectId}:${m.userId}`, doc: m, cols: { project_id: m.projectId, user_id: m.userId } })),
    stages: L.stages.map((s) => ({ id: s.id, doc: s, cols: { project_id: s.projectId } })),
    deadlines: L.deadlines.map((d) => ({ id: d.id, doc: d, cols: { project_id: d.projectId } })),
    conversations: L.conversations.map((c) => ({ id: c.id, doc: c, cols: { project_id: c.projectId, kind: c.kind } })),
  };
}

export function taskRows(L) {
  return L.tasks.map(({ at, ...t }) => ({ id: t.id, doc: t, cols: { project_id: t.projectId, owner_id: t.ownerId, status: t.status, due_date: t.dueDate, stage_id: t.stageId, search_text: normal(t.title) } }));
}

/** The server rows that a running office holds after a year (counters, stories of the last day, the mail log, and so on). */
export function serverRows() {
  const r = rng(99);
  const prefixes = ['usr', 'prj', 'stg', 'ddl', 'cnv', 'tsk', 'evt', 'cmt', 'ntf', 'msg', 'fil', 'trk', 'pay', 'upd', 'fbk', 'psh', 'cli', 'tem', 'stt', 'ttp', 'ptp', 'sty'];
  const rows = {
    counters: prefixes.map((prefix) => ({ prefix, n: 1000 })),
    office_meta: [{ id: 1, version: 5000, office_seq: 9000 }],
    person_seq: Array.from({ length: 20 }, (_, i) => ({ user_id: pid('usr', i + 1), seq: 500 })),
    stories: Array.from({ length: 300 }, (_, i) => ({ id: `sty_${pad(i, 22)}`, actor_id: HUMANS[i % 15], created_at: stamp(NOW - r() * DAY) })),
    idempotency: Array.from({ length: 300 }, (_, i) => ({ actor_id: HUMANS[i % 15], key: `key-${i}`, name: 'tasks.update', digest: 'd'.repeat(64), result: JSON.stringify({ output: { ok: true } }), created_at: stamp(NOW - r() * DAY) })),
    outbox: Array.from({ length: 1500 }, (_, i) => ({ id: `obx_${i}`, kind: 'push.notify', payload: JSON.stringify({ userIds: ['usr_003'], title: 'x' }), created_at: stamp(NOW - r() * 7 * DAY), done_at: stamp(NOW - r() * 7 * DAY), attempts: 1 })),
    mail_log: Array.from({ length: 6000 }, (_, i) => ({ id: `mlg_${i}`, ref: `ref-${i}`, to_email: 'a@b.test', kind: 'notice', resend_id: `re_${i}`, created_at: stamp(NOW - r() * 365 * DAY) })),
    usage_month: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${pad(i + 1, 2)}`, calls: 13000, bytes_read: 1e9, signals_failed: 0 })),
    job_runs: Array.from({ length: 365 }, (_, i) => ({ key: `summary:${dateOf(NOW - i * DAY)}`, done_at: stamp(NOW - i * DAY) })),
    rate_limits: Array.from({ length: 50 }, (_, i) => ({ key: `ip:${i}`, window_start: stamp(NOW), count: 3 })),
    office_deletes: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, tbl: 'members', row_id: `prj_001:usr_${pad(i)}`, chg: 4990 + i, created_at: stamp(NOW - r() * 7 * DAY) })),
    agent_links: Array.from({ length: 5 }, (_, i) => ({ id: `agl_${i}`, owner_user_id: HUMANS[i], agent_user_id: AGENTS[i].id })),
    upload_intents: Array.from({ length: 20 }, (_, i) => ({ id: `upi_${i}`, actor_id: HUMANS[i % 15], expires_at: stamp(NOW + DAY), used_at: null })),
    platform_config: [{ key: 'vapid', value: '{}' }, { key: 'version', value: '1' }],
  };
  return rows;
}

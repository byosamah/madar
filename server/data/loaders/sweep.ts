import { addDirectConversation, addGroupConversation } from '../../../src/api/chatState';
import { emptyReactions } from '../../../src/api/contract/entities';
import { sharedCalls, type SharedCallName } from '../../../src/api/sharedCalls';
import { chatReadKey, type State } from '../../../src/api/store';
import { runOn } from './compare';

/**
 * The calls that the loader tests run on a whole office and on the scoped load (task C2): every read call for every active person
 * and for every record it names, and the write calls of each loader. loaders.test.ts runs them on the memory source, and
 * server/it/loaders.it.test.ts on the database. Each item: the call, its input, who acts, and the "prepared" value of a call
 * with a prepare hook.
 */
export type SweepCall = [name: SharedCallName, input: unknown, actorId: string, prepared?: unknown];

const ADMIN = 'usr_001';
const NOW = new Date('2026-10-04T06:00:00Z');

export function readSweep(office: State): SweepCall[] {
  const calls: SweepCall[] = [];
  const humans = Object.values(office.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id);
  for (const actor of humans) {
    for (const status of ['active', 'on_hold', 'completed', 'all'] as const) calls.push(['projects.list', { status }, actor]);
    calls.push(['projects.list', { filter: 'mine' }, actor], ['dashboard.get', {}, actor], ['dashboard.get', { status: 'all' }, actor]);
    for (const filter of ['all', 'mine', 'overdue', 'flagged', 'review_for_me'] as const) calls.push(['tasks.list', { filter }, actor]);
    calls.push(
      ['tasks.list', { includeDone: false, activeProjectsOnly: false }, actor],
      ['tasks.list', { ownerId: actor, status: ['todo', 'in_review'] }, actor],
      // The cells of the People tab of the Dashboard (owner, 2026-10-06).
      ['tasks.list', { workOf: actor, includeDone: false }, actor],
      ['tasks.list', { workOf: actor, dueFrom: '2026-10-04', dueTo: '2026-10-10', includeDone: false }, actor],
      ['tasks.list', { filter: 'overdue', ownerId: actor, includeDone: false }, actor],
      ['notifications.list', {}, actor],
      ['notifications.list', { unreadOnly: true, limit: 3 }, actor],
      ['notifications.count', {}, actor],
      ['chats.list', {}, actor],
      ['chats.unreadCount', {}, actor],
      ['chats.waiting', {}, actor],
      ['events.list', { limit: 20 }, actor],
      ['events.list', { since: '2026-10-01T00:00:00+03:00', limit: 500 }, actor],
      ['search.query', { text: 'a' }, actor],
      ['search.query', { text: '#KH' }, actor],
      ['feedback.list', {}, actor],
      ['session.get', {}, actor],
      // The office report of a week and of a quarter, for each person: a refusal for the people without the right (fbk_016).
      ['reports.office', { period: 'week', start: '2026-09-28' }, actor],
      ['reports.office', { period: 'quarter' }, actor],
      // The own push devices (owner, 2026-10-08).
      ['push.mine', {}, actor],
    );
  }
  // The Leader and Client filters of the lists that the Dashboard opens (owner, 2026-10-06).
  const led = Object.values(office.projects).find((p) => p.status === 'active' && p.leaderId !== null && p.clientId !== null);
  // The lists that the data gaps of the Dashboard open (owner, 2026-10-06).
  calls.push(
    ['projects.list', { filter: 'no_area' }, ADMIN], ['projects.list', { filter: 'stage_no_end', status: 'all' }, ADMIN],
    ['tasks.list', { filter: 'no_date', includeDone: false }, ADMIN], ['tasks.list', { filter: 'no_lead', includeDone: false }, ADMIN],
  );
  if (led) {
    calls.push(
      ['tasks.list', { filter: 'overdue', leaderId: led.leaderId, clientId: led.clientId }, ADMIN],
      ['tasks.list', { leaderId: led.leaderId, teamId: 'tm_001' }, ADMIN],
      ['deadlines.list', { leaderId: led.leaderId, clientId: led.clientId }, ADMIN],
    );
  }
  for (const project of Object.values(office.projects)) {
    const id = project.id;
    calls.push(['projects.get', { id }, ADMIN]);
    for (const filter of ['all', 'posts', 'decisions', 'tasks', 'files'] as const) calls.push(['updates.list', { projectId: id, filter, limit: 3 }, ADMIN]);
    calls.push(
      ['tasks.list', { projectId: id, activeProjectsOnly: false }, ADMIN],
      ['files.list', { projectId: id }, ADMIN],
      ['tracker.list', { projectId: id }, ADMIN],
      ['tracker.export', { projectId: id }, ADMIN],
      ['payments.list', { projectId: id }, ADMIN],
      ['events.list', { projectId: id, limit: 7 }, ADMIN],
    );
  }
  for (const task of Object.values(office.tasks)) calls.push(['tasks.get', { id: task.id }, task.ownerId ?? ADMIN]);
  // Office tasks (owner, 2026-10-06): every person reads each one, its comments and its files, and each agent reads the lists of
  // its person. A person who does not see one gets the same refusal both ways.
  for (const task of Object.values(office.tasks).filter((t) => t.projectId === null)) {
    for (const actor of humans) {
      calls.push(
        ['tasks.get', { id: task.id }, actor], ['files.list', { taskId: task.id }, actor],
        ['comments.list', { targetType: 'task', targetId: task.id }, actor],
      );
    }
  }
  const agents = Object.values(office.users).filter((u) => u.kind === 'agent' && u.active).map((u) => u.id);
  // The text 'chat-photo' names the file of a direct chat in trapOffice (owner, 2026-10-19): no search finds it, for its members too.
  for (const actor of [...humans, ...agents]) calls.push(['search.query', { text: 'licence' }, actor], ['search.query', { text: 'chat-photo' }, actor]);
  for (const actor of agents) {
    calls.push(
      ['tasks.list', { filter: 'mine' }, actor], ['tasks.list', {}, actor], ['events.list', { limit: 20 }, actor], ['chats.list', {}, actor],
      ['dashboard.get', {}, actor], ['notifications.list', {}, actor],
    );
  }
  for (const comment of Object.values(office.comments)) calls.push(['comments.list', { targetType: comment.targetType, targetId: comment.targetId }, ADMIN]);
  for (const conversation of Object.values(office.conversations)) {
    for (const actor of humans) calls.push(['chats.messages', { conversationId: conversation.id, limit: 2 }, actor]);
  }
  return calls;
}

/** One write call for each kind of write, on records of the office. */
export function writeSweep(office: State): SweepCall[] {
  const tasks = Object.values(office.tasks);
  const leader = office.projects.prj_001.leaderId!;
  const task = tasks.find((t) => t.projectId === 'prj_001' && t.status !== 'done')!;
  const post = Object.values(office.updates).find((u) => u.projectId === 'prj_001')!;
  const comment = Object.values(office.comments)[0];
  const entry = Object.values(office.tracker ?? {}).find((e) => e.waiting !== null && e.closedAt === null)!;
  const payment = Object.values(office.payments ?? {})[0];
  const notice = Object.values(office.notifications)[0];
  const file = Object.values(office.files)[0];
  const plan = Object.values(office.projectTemplates ?? {}).find((t) => t.tasks.length > 0)!;
  return [
    ['projects.update', { id: 'prj_001', patch: { name: 'Renamed', coverFileId: file.projectId === 'prj_001' ? file.id : null } }, ADMIN],
    // The project code (owner, 2026-10-05): a code from its parts writes the initials onto a client that has none, the same
    // contract copies a code, and the Admin corrects a code.
    ['projects.create', { name: 'Sweep Villas', clientId: 'cli_002', codeParts: { initials: 'DLD', classification: 'RES', type: 'Villa' } }, ADMIN],
    ['projects.create', { name: 'Sweep annex', sameContractAs: 'prj_001' }, ADMIN],
    // A project from a project template (owner, 2026-10-05, item 6a): its stages and tasks with dates, and the people of its roles.
    ['projects.create', { name: 'Sweep plan', template: { templateId: plan.id, startDate: '2026-10-11', endDate: '2026-11-26', roles: { [plan.roles[0].id]: 'usr_003' }, fixedTaskIds: [plan.tasks.at(-1)!.id] } }, ADMIN],
    ['projects.update', { id: 'prj_001', patch: { code: '261000GCH-COM-Office Tower' } }, ADMIN],
    ['clients.update', { id: 'cli_001', patch: { initials: 'GCH' } }, ADMIN],
    ['projects.setStatus', { id: 'prj_009', status: 'active' }, ADMIN],
    ['projects.setRestart', { id: 'prj_012', resumeOn: '2026-12-01' }, ADMIN],
    ['projects.resume', { id: 'prj_012' }, ADMIN],
    ['projects.pause', { id: 'prj_001', kind: 'client', reason: 'Waiting', resumeOn: null }, ADMIN],
    ['projects.setHealthOverride', { id: 'prj_001', value: 'late', reason: 'Late' }, ADMIN],
    ['projects.delete', { id: 'prj_002', confirm: true }, ADMIN],
    ['stages.setDates', { stageId: task.stageId, startDate: '2026-09-01', endDate: '2026-12-01' }, ADMIN],
    ['deadlines.update', { id: Object.values(office.deadlines)[0].id, patch: { name: 'Moved' } }, ADMIN],
    ['tasks.create', { projectId: 'prj_001', title: 'New' }, leader],
    ['tasks.update', { id: task.id, patch: { title: 'New title' } }, leader],
    ['tasks.complete', { id: task.id }, ADMIN],
    ['tasks.newVersion', { id: tasks.find((t) => t.status === 'done')!.id, reason: 'Client change' }, ADMIN],
    ['tasks.sendBack', { id: tasks.find((t) => t.status === 'in_review')?.id ?? task.id, note: 'Fix it' }, ADMIN],
    ['tasks.delete', { id: task.id }, ADMIN],
    ['tasks.createFromTemplate', { templateId: Object.values(office.taskTemplates ?? {})[0].id, stageId: task.stageId }, ADMIN],
    ['updates.create', { projectId: 'prj_001', body: 'Hello', fileIds: [] }, ADMIN],
    ['updates.update', { id: post.id, body: 'Edited' }, post.authorId],
    ['updates.delete', { id: post.id }, post.authorId],
    ['comments.create', { targetType: 'task', targetId: task.id, body: 'A note' }, ADMIN],
    ['comments.update', { id: comment.id, body: 'Edited' }, comment.authorId],
    ['comments.delete', { id: comment.id }, comment.authorId],
    ['reactions.toggle', { commentId: comment.id, emoji: '👍' }, ADMIN],
    ['files.upload', { projectId: file.projectId, name: file.name, uploadId: 'upl_1' }, ADMIN, { blobKey: 'blob_sweep', mimeType: 'application/pdf', size: 3 }],
    ['files.delete', { id: file.id }, ADMIN],
    ['files.markDelivered', { id: file.id }, ADMIN],
    ['files.share', { fileId: file.id, target: { kind: 'project_chat' } }, ADMIN],
    ['files.share', { fileId: file.id, target: { kind: 'task', taskId: tasks.find((t) => t.projectId === file.projectId)!.id } }, ADMIN],
    ['tracker.log', { projectId: 'prj_001', type: 'message', direction: 'in', title: 'Asked', waiting: 'us', replyBy: { userId: leader, dueDate: '2026-10-10' } }, leader],
    ['tracker.close', { id: entry.id }, ADMIN],
    ['tracker.update', { id: entry.id, waiting: null }, ADMIN],
    ['tracker.delete', { id: entry.id }, ADMIN],
    ['payments.markReceived', { id: payment.id }, ADMIN],
    ['payments.delete', { id: payment.id }, ADMIN],
    ['notifications.markRead', { ids: [notice.id] }, notice.userId],
    ['notifications.markAllRead', {}, notice.userId],
    ['notifications.markUnread', { ids: [notice.id] }, notice.userId],
    ['chats.send', { conversationId: 'cnv_001', body: 'Hi' }, leader],
    ['chats.markRead', { conversationId: 'cnv_001' }, leader],
    ['events.undoStory', { correlationId: Object.values(office.events).at(-1)!.correlationId }, ADMIN],
    ['taskTemplates.save', { fromTaskId: task.id, name: 'From a task' }, ADMIN],
    ['feedback.send', { kind: 'feature', message: 'An idea' }, ADMIN, { shots: [] }],
    // An office task (owner, 2026-10-06), on any office.
    ['tasks.create', { title: 'Office errand', ownerId: 'usr_005', helperIds: ['usr_006'], dueDate: '2026-10-08' }, 'usr_004'],
    ...officeWrites(office),
    ...chatFileWrites(office),
  ];
}

/** The writes on the office tasks of trapOffice, by their people: none on an office without them. */
export function officeWrites(office: State): SweepCall[] {
  const led = Object.values(office.tasks).find((t) => t.projectId === null && t.ownerId !== null);
  const open = Object.values(office.tasks).find((t) => t.projectId === null && t.ownerId === null);
  const file = Object.values(office.files).find((f) => f.projectId === null);
  const comment = Object.values(office.comments).find((c) => c.targetId === led?.id);
  if (!led || !open || !file || !comment) return [];
  const maker = led.createdBy;
  return [
    ['tasks.update', { id: led.id, patch: { ownerId: 'usr_006', helperIds: [] } }, maker],
    ['tasks.approve', { id: led.id }, maker],
    ['tasks.sendBack', { id: led.id, note: 'Add the stamp' }, maker],
    ['tasks.take', { taskId: open.id }, open.createdBy],
    ['tasks.delete', { id: led.id }, maker],
    ['tasks.update', { id: led.id, patch: { title: 'Not mine' } }, 'usr_003'],
    ['comments.create', { targetType: 'task', targetId: led.id, body: 'Paid', fileIds: [file.id] }, 'usr_006'],
    ['comments.update', { id: comment.id, body: 'Edited' }, comment.authorId],
    ['reactions.toggle', { commentId: comment.id, emoji: '👍' }, maker],
    ['files.upload', { name: file.name, taskId: led.id, uploadId: 'upl_2' }, 'usr_006', { blobKey: 'blob_sweep_office', mimeType: 'application/pdf', size: 4 }],
    ['files.delete', { id: file.id }, maker],
    ['files.share', { fileId: file.id, target: { kind: 'task', taskId: led.id } }, 'usr_006'],
    ['events.undoStory', { correlationId: 'cor_trap_office_review' }, 'usr_005'],
    ['events.undoStory', { correlationId: 'cor_trap_office_review' }, 'usr_003'],
    ['chats.markRead', { conversationId: led.id }, 'usr_005'],
  ];
}

/** The id of the chat file of chatFileTrap. */
export const CHAT_FILE_ID = 'fil_910';

/**
 * A file of a direct chat (owner, 2026-10-19): two people with no direct chat yet, the chat, a file of that chat, and the message that
 * carries it. The reads of chats.messages, files.list and search.query must give the same answers on the scoped load as on the whole
 * office, for the two members, for every other person and for the agents.
 */
function chatFileTrap(state: State): void {
  const people = Object.values(state.users).filter((u) => u.kind === 'human' && u.active && u.systemRole !== 'admin').map((u) => u.id);
  const talk = (a: string, b: string) => Object.values(state.conversations).some((c) => c.kind === 'direct' && c.memberIds.includes(a) && c.memberIds.includes(b));
  const [first, second] = people.flatMap((a) => people.filter((b) => b > a).map((b): [string, string] => [a, b])).find(([a, b]) => !talk(a, b))!;
  const chat = addDirectConversation(state, first, second, '2026-10-03T12:00:00.000+03:00');
  state.files[CHAT_FILE_ID] = {
    id: CHAT_FILE_ID, projectId: null, stageId: null, taskId: null, conversationId: chat.id, name: 'Hidden-chat-photo.jpg',
    versions: [{ letter: 'A', blobKey: 'blob_trap_chat', mimeType: 'image/jpeg', size: 9, uploadedBy: first, uploadedAt: '2026-10-03T12:00:00.000+03:00' }],
  };
  state.messages.msg_910 = {
    id: 'msg_910', conversationId: chat.id, authorId: first, actingForId: first, body: 'The photo', mentions: [], fileIds: [CHAT_FILE_ID],
    createdAt: '2026-10-03T12:00:00.000+03:00', editedAt: null,
  };
}

/**
 * The writes on the chat file of chatFileTrap, by the two people of its chat and by a person outside it: an upload, a message that
 * carries the file, a share, a delete and a "delivered" mark. None on an office without the trap.
 */
export function chatFileWrites(office: State): SweepCall[] {
  const file = office.files[CHAT_FILE_ID];
  const chat = file?.conversationId ? office.conversations[file.conversationId] : undefined;
  if (!file || !chat) return [];
  const [a, b] = chat.memberIds;
  const outside = Object.values(office.users).find((u) => u.kind === 'human' && u.active && u.id !== ADMIN && !chat.memberIds.includes(u.id))!.id;
  const prepared = { blobKey: 'blob_sweep_chat', mimeType: 'image/jpeg', size: 5 };
  return [
    ['files.upload', { name: 'Second.jpg', conversationId: chat.id, uploadId: 'upl_chat_a' }, a, prepared],
    ['files.upload', { name: 'Second.jpg', conversationId: chat.id, uploadId: 'upl_chat_b' }, outside, prepared],
    ['chats.send', { conversationId: chat.id, body: 'Again', fileIds: [file.id] }, b],
    ['chats.send', { conversationId: chat.id, body: 'Again', fileIds: [file.id] }, outside],
    ['files.share', { fileId: file.id, target: { kind: 'person', userId: outside } }, a],
    ['files.delete', { id: file.id }, a],
    ['files.markDelivered', { id: file.id }, outside],
  ];
}

function apply(state: State, name: SharedCallName, input: unknown, actorId: string, story: string, prepared?: unknown, now = NOW): unknown {
  const outcome = runOn(state, name, sharedCalls[name].input.parse(input), actorId, { now, correlationId: story, prepared });
  if (outcome.error) throw new Error(`Setup ${name} failed: ${outcome.error.message}`);
  return outcome.output;
}

/** The agent of the lead of the office task of trapOffice: it sees what its person sees. */
export const OFFICE_AGENT = 'usr_090';

/**
 * Office tasks (owner, 2026-10-06): usr_004 makes one that usr_005 leads and usr_006 helps on, past due, with a comment that
 * mentions usr_003, a file, and a review that waits for usr_004; usr_006 makes one with no lead. usr_003 is on neither. usr_090 is
 * the agent of usr_005.
 */
function officeTraps(state: State): void {
  state.users[OFFICE_AGENT] = {
    ...state.users.usr_009, id: OFFICE_AGENT, name: 'Sara Assistant', email: 'sara.assistant@madar.test', ownerId: 'usr_005',
  };
  const made = apply(state, 'tasks.create', { title: 'Renew the trade licence', ownerId: 'usr_005', helperIds: ['usr_006'], dueDate: '2026-10-01' }, 'usr_004', 'cor_trap_office') as { task: { id: string } };
  const id = made.task.id;
  apply(state, 'comments.create', { targetType: 'task', targetId: id, body: 'Ask @[Reem](usr_003) about the fee.' }, 'usr_005', 'cor_trap_office_comment');
  apply(state, 'files.upload', { name: 'Licence.pdf', taskId: id, uploadId: 'upl_trap' }, 'usr_005', 'cor_trap_office_file', { blobKey: 'blob_trap_office', mimeType: 'application/pdf', size: 7 });
  apply(state, 'tasks.complete', { id }, 'usr_005', 'cor_trap_office_review');
  apply(state, 'tasks.create', { title: 'Order paper for the licence', dueDate: '2026-10-02' }, 'usr_006', 'cor_trap_office_paper');
}

/** The project of the ties of newestTies. */
export const TIE_PROJECT = 'prj_004';

/**
 * Ties for the reads of the newest rows of each key (performance audit DB-2). In TIE_PROJECT: one feed event, then two feed events
 * of one stamp just before it, so a feed of 2 keeps 3 events; and two messages of one stamp at the top of its chat, so the id
 * decides which one is the newest.
 */
function newestTies(state: State): void {
  const [first, second, last] = Object.values(state.tasks).filter((t) => t.projectId === TIE_PROJECT && t.status === 'todo');
  const tied = new Date('2026-10-04T07:00:00Z');
  apply(state, 'tasks.move', { id: first.id, status: 'in_progress' }, ADMIN, 'cor_trap_tie_1', undefined, tied);
  apply(state, 'tasks.move', { id: second.id, status: 'in_progress' }, ADMIN, 'cor_trap_tie_2', undefined, tied);
  apply(state, 'tasks.move', { id: last.id, status: 'in_progress' }, ADMIN, 'cor_trap_tie_3', undefined, new Date('2026-10-04T07:30:00Z'));
  const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === TIE_PROJECT)!;
  const leader = state.projects[TIE_PROJECT].leaderId!;
  for (const id of ['msg_904', 'msg_903']) {
    state.messages[id] = { id, conversationId: room.id, authorId: leader, actingForId: leader, body: id, mentions: [], fileIds: [], createdAt: '2026-10-04T10:45:00.000+03:00', editedAt: null };
  }
}

/** The title of the office task of badgeTraps that the agent of usr_005 makes. */
export const AGENT_MADE_TASK = 'Book the hall for the client';

/**
 * The cases of the chat badge and the bell (performance audit DB-6, DB-M1, DB-M2), on a copy of trapOffice:
 * - in prj_001, a member's own last comment shares its stamp with an unread one of the leader, and an older one of that stamp;
 * - on the office task of trapOffice, usr_006 only helps and comments, and usr_005 answers later;
 * - the agent of usr_005 makes an office task for usr_006, who comments on it; then its lead moves to usr_007, so usr_006 no
 *   longer sees it, and the notice of usr_006 is hidden;
 * - a notice of a project task that the leader deletes, and a report notice of the Admins.
 */
export function badgeTraps(traps: State): State {
  const state = structuredClone(traps);
  const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 4, hour, minute));
  const leader = state.projects.prj_001.leaderId!;
  const member = Object.values(state.members).find((m) => m.projectId === 'prj_001' && m.userId !== leader)!.userId;
  const thread = Object.values(state.tasks).filter((t) => t.projectId === 'prj_001' && t.status !== 'done').at(-1)!;
  for (const author of [leader, member, leader]) {
    apply(state, 'comments.create', { targetType: 'task', targetId: thread.id, body: `Same stamp by ${author}` }, author, 'cor_trap_badge_tie', undefined, at(8));
  }
  const licence = Object.values(state.tasks).find((t) => t.projectId === null && t.ownerId === 'usr_005')!;
  apply(state, 'comments.create', { targetType: 'task', targetId: licence.id, body: 'The fee is paid.' }, 'usr_006', 'cor_trap_badge_helper', undefined, at(8, 10));
  apply(state, 'comments.create', { targetType: 'task', targetId: licence.id, body: 'Thanks.' }, 'usr_005', 'cor_trap_badge_lead', undefined, at(8, 20));
  const made = apply(state, 'tasks.create', { title: AGENT_MADE_TASK, ownerId: 'usr_006' }, OFFICE_AGENT, 'cor_trap_badge_agent', undefined, at(8, 30)) as { task: { id: string } };
  apply(state, 'comments.create', { targetType: 'task', targetId: made.task.id, body: 'The hall is free on Sunday.' }, 'usr_006', 'cor_trap_badge_hall', undefined, at(8, 40));
  apply(state, 'tasks.update', { id: made.task.id, patch: { ownerId: 'usr_007' } }, 'usr_005', 'cor_trap_badge_lead_change', undefined, at(8, 50));
  const gone = apply(state, 'tasks.create', { projectId: 'prj_001', title: 'Short lived', ownerId: member }, leader, 'cor_trap_badge_gone', undefined, at(9)) as { task: { id: string } };
  apply(state, 'tasks.delete', { id: gone.task.id }, leader, 'cor_trap_badge_delete', undefined, at(9, 10));
  apply(state, 'feedback.send', { kind: 'bug', message: 'The badge counts twice.' }, 'usr_003', 'cor_trap_badge_report', { shots: [] }, at(9, 20));
  return state;
}

/**
 * The sample office with records that the reads of the loaders must find: office tasks, an undo pair, a helper and a flag, a
 * decision, a direct message with a project file, two messages with the same stamp, a task thread with a read mark, and ties at
 * the cut of the newest rows.
 */
export function trapOffice(seed: State): State {
  const state = structuredClone(seed);
  officeTraps(state);
  chatFileTrap(state);
  newestTies(state);
  const leader = state.projects.prj_001.leaderId!;
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_001' && t.status !== 'done')!;
  apply(state, 'tasks.update', { id: task.id, patch: { title: 'Undone title' } }, leader, 'cor_trap_edit');
  const edit = Object.values(state.events).find((e) => e.correlationId === 'cor_trap_edit')!;
  apply(state, 'events.undo', { eventId: edit.id }, leader, 'cor_trap_undo');
  const member = Object.values(state.members).find((m) => m.projectId === 'prj_001' && m.userId !== leader)!.userId;
  apply(state, 'tasks.update', { id: task.id, patch: { helperIds: [member], flagged: true } }, leader, 'cor_trap_helper');
  apply(state, 'updates.create', { projectId: 'prj_001', body: 'We decided', decision: true }, leader, 'cor_trap_decision');
  const file = Object.values(state.files).find((f) => f.projectId === 'prj_001')!;
  state.messages.msg_900 = {
    id: 'msg_900', conversationId: 'cnv_013', authorId: ADMIN, actingForId: ADMIN, body: 'File', mentions: [], fileIds: [file.id],
    createdAt: '2026-10-03T10:00:00.000+03:00', editedAt: null,
  };
  for (const id of ['msg_901', 'msg_902']) {
    state.messages[id] = { id, conversationId: 'cnv_001', authorId: leader, actingForId: leader, body: id, mentions: [], fileIds: [], createdAt: '2026-10-03T11:00:00.000+03:00', editedAt: null };
  }
  const thread = Object.values(state.tasks).find((t) => t.projectId !== null && t.ownerId !== null && t.ownerId !== 'usr_006' && state.projects[t.projectId].leaderId !== 'usr_006')!;
  const lead = thread.ownerId as string;
  for (const [id, authorId, at] of [
    ['cmt_901', lead, '2026-10-01T09:00:00.000+03:00'], ['cmt_902', 'usr_006', '2026-10-02T09:00:00.000+03:00'],
    ['cmt_903', lead, '2026-10-03T11:00:00.000+03:00'], ['cmt_904', lead, '2026-10-03T11:00:00.000+03:00'],
  ] as const) {
    state.comments[id] = { id, targetType: 'task', targetId: thread.id, authorId, body: id, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null };
  }
  state.chatReads[chatReadKey(thread.id, 'usr_006')] = { conversationId: thread.id, userId: 'usr_006', lastReadAt: '2026-10-03T10:00:00.000+03:00' };
  return state;
}

/** The name of the group of findTraps. */
export const FIND_GROUP = 'Find group';

/** The ids of the messages of the group of findTraps, oldest first: msg_1001 is the first, and the ones at 100 and 300 are deleted. */
const findId = (n: number) => `msg_${1000 + n}`;

/**
 * The reads of track find (chat design 2026-10-19, items 16 and 17), on a copy of the sample office: a group of three people with 540
 * messages, one minute apart, two of them deleted (the 100th and the 300th). The reads of chats.messages with "around" must give the
 * same answers on the scoped load as on the whole office. Later tasks of the track add their records here.
 */
export function findTraps(state: State): void {
  const people = Object.values(state.users).filter((u) => u.kind === 'human' && u.active && u.systemRole !== 'admin').map((u) => u.id).slice(0, 3);
  const group = addGroupConversation(state, FIND_GROUP, people[0], people, '2026-10-02T08:00:00.000+03:00');
  for (let n = 1; n <= 540; n++) {
    const author = people[n % people.length];
    state.messages[findId(n)] = {
      id: findId(n), conversationId: group.id, authorId: author, actingForId: author, body: `Find line ${n}`, mentions: [], fileIds: [],
      createdAt: new Date(Date.UTC(2026, 9, 2, 6) + n * 60_000).toISOString(), editedAt: null,
      ...(n === 100 || n === 300 ? { deletedAt: '2026-10-03T06:00:00.000Z' } : {}),
    };
  }
}

/** The calls of track find: chats.messages with "around", for each member and for a person outside, on the group of findTraps. */
export function findSweep(office: State): SweepCall[] {
  const group = Object.values(office.conversations).find((c) => c.kind === 'group' && c.name === FIND_GROUP);
  if (!group) return [];
  const foreign = Object.values(office.messages).find((m) => m.conversationId !== group.id)!.id;
  const outsider = Object.values(office.users).find((u) => u.kind === 'human' && u.active && !group.memberIds.includes(u.id))!.id;
  const calls: SweepCall[] = [];
  for (const actor of group.memberIds) {
    for (const around of [findId(30), findId(300), findId(400), findId(530), foreign]) calls.push(['chats.messages', { conversationId: group.id, around }, actor]);
    calls.push(['chats.messages', { conversationId: group.id, around: findId(30), limit: 50 }, actor]);
  }
  calls.push(['chats.messages', { conversationId: group.id, around: findId(30) }, outsider]);
  return calls;
}

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
      ['events.list', { limit: 20 }, actor],
      ['events.list', { since: '2026-10-01T00:00:00+03:00', limit: 500 }, actor],
      ['search.query', { text: 'a' }, actor],
      ['search.query', { text: '#KH' }, actor],
      ['feedback.list', {}, actor],
      ['session.get', {}, actor],
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
  ];
}

function apply(state: State, name: SharedCallName, input: unknown, actorId: string, story: string): void {
  const outcome = runOn(state, name, sharedCalls[name].input.parse(input), actorId, { now: NOW, correlationId: story });
  if (outcome.error) throw new Error(`Setup ${name} failed: ${outcome.error.message}`);
}

/**
 * The sample office with records that the reads of the loaders must find: an undo pair, a helper and a flag, a decision, a direct
 * message with a project file, two messages with the same stamp, and a task thread with a read mark.
 */
export function trapOffice(seed: State): State {
  const state = structuredClone(seed);
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
  const thread = Object.values(state.tasks).find((t) => t.ownerId !== null && t.ownerId !== 'usr_006' && state.projects[t.projectId].leaderId !== 'usr_006')!;
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

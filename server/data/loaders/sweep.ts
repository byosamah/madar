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
  // The text 'meeting-notes' names the file of a meeting with no project in trapOffice (wave 2): no search finds it either.
  for (const actor of [...humans, ...agents]) {
    calls.push(['search.query', { text: 'licence' }, actor], ['search.query', { text: 'chat-photo' }, actor], ['search.query', { text: 'meeting-notes' }, actor]);
  }
  for (const actor of agents) {
    calls.push(
      ['tasks.list', { filter: 'mine' }, actor], ['tasks.list', {}, actor], ['events.list', { limit: 20 }, actor], ['chats.list', {}, actor],
      ['dashboard.get', {}, actor], ['notifications.list', {}, actor],
    );
  }
  // Meetings (fbk_022, owner 2026-10-19): every person and every agent reads the lists and each meeting, so a meeting with no project
  // must read as missing for everyone but its people, on the scoped load as on the whole office. None on an office without meetings.
  if (Object.keys(office.meetings ?? {}).length > 0) {
    for (const actor of [...humans, ...agents]) {
      calls.push(
        ['meetings.list', {}, actor], ['meetings.list', { mine: false, projectId: 'prj_001' }, actor], ['meetings.list', { from: '2026-09-01', to: '2026-12-31' }, actor],
        ['meetings.list', { from: '2026-10-05', to: '2026-10-05', mine: false, projectId: 'prj_001' }, actor],
      );
      for (const meeting of Object.values(office.meetings ?? {})) calls.push(['meetings.get', { id: meeting.id }, actor]);
      // The Tracker line of a meeting that ended holds the minutes, and the right to write them depends on the viewer (wave 2). The feed of
      // the project holds the events of the minutes.
      calls.push(['tracker.list', { projectId: 'prj_001' }, actor], ['updates.list', { projectId: 'prj_001' }, actor]);
    }
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
  const roomMessage = Object.values(office.messages).filter((m) => m.conversationId === 'cnv_001').at(-1);
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
    // The reaction on a chat message (chat design item 12): the newest message of the project chat cnv_001, by a member of its team.
    ...(roomMessage ? [['reactions.toggle', { messageId: roomMessage.id, emoji: '👍' }, leader] as SweepCall] : []),
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
    ...meetingWrites(office),
    ...meetingFileWrites(office),
    ...meetingMinutesWrites(office),
  ];
}

/**
 * The writes on the meetings of trapOffice (fbk_022): the organizer, an attendee, an outsider and the Admin who is not invited try
 * the private meeting. A person who does not see it gets the same refusal on the scoped load and on the whole office. None on an
 * office without the traps.
 */
export function meetingWrites(office: State): SweepCall[] {
  const meetings = Object.values(office.meetings ?? {});
  const hidden = meetings.find((m) => m.projectId === null && m.attendeeIds.length > 0 && m.createdBy === m.organizerId);
  const open = meetings.find((m) => m.projectId !== null);
  if (!hidden || !open) return [];
  const outsider = Object.values(office.users).find((u) => u.kind === 'human' && u.active && u.systemRole === 'member' && u.id !== hidden.organizerId && !hidden.attendeeIds.includes(u.id))!.id;
  return [
    ['meetings.create', { kind: 'site_visit', title: 'Visit the plot', startsAt: '2026-10-07T09:00:00+03:00', attendeeIds: [outsider] }, hidden.organizerId],
    ['meetings.update', { id: hidden.id, notes: 'Admin try' }, ADMIN],
    ['meetings.update', { id: hidden.id, notes: 'Outsider try' }, outsider],
    ['meetings.cancel', { id: hidden.id }, outsider],
    ['meetings.update', { id: hidden.id, notes: 'Attendee try' }, hidden.attendeeIds[0]],
    ['meetings.update', { id: hidden.id, where: 'Room 2', attendeeIds: [...hidden.attendeeIds, outsider] }, hidden.organizerId],
    ['meetings.update', { id: open.id, title: 'Renamed meeting' }, ADMIN],
    ['meetings.cancel', { id: hidden.id }, hidden.organizerId],
    ['meetings.cancel', { id: open.id }, open.organizerId],
    ['events.undoStory', { correlationId: 'cor_trap_meeting_office' }, ADMIN],
    ['events.undoStory', { correlationId: 'cor_trap_meeting_office' }, hidden.organizerId],
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

/** The id of the meeting file of meetingFileTrap. */
export const MEETING_FILE_ID = 'fil_911';
/** The title of the meeting with no project, ended, of meetingFileTrap. */
export const ENDED_MEETING_TITLE = 'Salary review';
/** The ended project meeting (a Tracker line) and the ended team meeting of a project (minutes on the meeting) of meetingMinutesTraps. */
export const ENDED_PROJECT_MEETING_TITLE = 'Kick-off with the client';
export const ENDED_TEAM_MEETING_TITLE = 'Weekly sync';

/**
 * A file of a meeting with no project (wave 2): usr_004 planned "Salary review" for usr_006 on 2026-10-02, and it ended. The file sits
 * in its minutes folder. The reads of search.query, files.list and files.get, and the writes of the other places that could carry the
 * file, must give the same answers on the scoped load as on the whole office, for the two people, for every other person and for the
 * agents.
 */
function meetingFileTrap(state: State): void {
  const made = apply(state, 'meetings.create', { kind: 'meeting', title: ENDED_MEETING_TITLE, startsAt: '2026-10-02T09:00:00+03:00', attendeeIds: ['usr_006'] }, 'usr_004', 'cor_trap_meeting_ended') as { id: string };
  state.files[MEETING_FILE_ID] = {
    id: MEETING_FILE_ID, projectId: null, stageId: null, taskId: null, meetingId: made.id, name: 'Hidden-meeting-notes.pdf',
    versions: [{ letter: 'A', blobKey: 'blob_trap_meeting', mimeType: 'application/pdf', size: 9, uploadedBy: 'usr_006', uploadedAt: '2026-10-02T12:00:00.000+03:00' }],
  };
}

/**
 * The minutes of three meetings that ended (wave 2): the private meeting of meetingFileTrap, with its file (written by the attendee
 * usr_006); a client meeting of prj_001 that the minutes settled on the way, with the Tracker line (written by usr_003); and a team
 * meeting of prj_001 that keeps its minutes on the meeting (written by usr_003). Every read and write of the minutes must give the same
 * answer on the scoped load as on the whole office.
 */
function meetingMinutesTraps(state: State): void {
  const leader = state.projects.prj_001.leaderId!;
  const ended = Object.values(state.meetings ?? {}).find((m) => m.title === ENDED_MEETING_TITLE)!;
  apply(state, 'meetings.saveMinutes', { id: ended.id, text: 'The raise is 4,000 riyals. MINUTES-TRAP-PRIVATE', fileIds: [MEETING_FILE_ID] }, 'usr_006', 'cor_trap_minutes_private');
  const project = apply(state, 'meetings.create', { kind: 'client', title: ENDED_PROJECT_MEETING_TITLE, projectId: 'prj_001', startsAt: '2026-10-02T10:00:00+03:00', attendeeIds: ['usr_003'] }, leader, 'cor_trap_meeting_ended_project') as { id: string };
  apply(state, 'meetings.saveMinutes', { id: project.id, text: 'We agreed on the facade. MINUTES-TRAP-LINE', fileIds: [] }, 'usr_003', 'cor_trap_minutes_line');
  const team = apply(state, 'meetings.create', { kind: 'team', title: ENDED_TEAM_MEETING_TITLE, projectId: 'prj_001', startsAt: '2026-10-02T08:00:00+03:00', attendeeIds: ['usr_003'] }, leader, 'cor_trap_meeting_ended_team') as { id: string };
  apply(state, 'meetings.saveMinutes', { id: team.id, text: 'Team notes. MINUTES-TRAP-TEAM', fileIds: [] }, 'usr_003', 'cor_trap_minutes_team');
}

/**
 * The writes on the minutes of meetingMinutesTraps: the people of each meeting, the leader who is not invited, a team member who did not
 * attend, an outsider and the Admin who is not invited write, clear, ask with an old since, settle again, and take back the minutes.
 * None on an office without the traps.
 */
export function meetingMinutesWrites(office: State): SweepCall[] {
  const meetings = Object.values(office.meetings ?? {});
  const privateOne = meetings.find((m) => m.title === ENDED_MEETING_TITLE);
  const lineOne = meetings.find((m) => m.title === ENDED_PROJECT_MEETING_TITLE);
  const teamOne = meetings.find((m) => m.title === ENDED_TEAM_MEETING_TITLE);
  if (!privateOne || !lineOne || !teamOne) return [];
  const leader = office.projects.prj_001.leaderId!;
  const attendee = privateOne.attendeeIds[0];
  const outsider = Object.values(office.users).find((u) => u.kind === 'human' && u.active && u.id !== ADMIN && u.id !== privateOne.organizerId && !privateOne.attendeeIds.includes(u.id)
    && u.id !== leader && !lineOne.attendeeIds.includes(u.id))!.id;
  const minutesEvents = (verb: string) => Object.values(office.events).filter((e) => e.verb === verb);
  const privateEvent = minutesEvents('meeting.minutes_saved').find((e) => e.targetId === privateOne.id);
  const lineEvent = minutesEvents('tracker.minutes_saved')[0];
  const teamEvent = minutesEvents('meeting.minutes_saved').find((e) => e.targetId === teamOne.id);
  const stale = '2026-10-01T00:00:00.000+03:00';
  const calls: SweepCall[] = [
    ['meetings.saveMinutes', { id: privateOne.id, text: 'Outsider try', fileIds: [] }, outsider],
    ['meetings.saveMinutes', { id: privateOne.id, text: 'Admin try', fileIds: [] }, ADMIN],
    ['meetings.saveMinutes', { id: privateOne.id, text: 'Late edit', fileIds: [MEETING_FILE_ID], since: stale }, attendee],
    ['meetings.saveMinutes', { id: privateOne.id, text: 'Organizer edit', fileIds: [MEETING_FILE_ID] }, privateOne.organizerId],
    ['meetings.saveMinutes', { id: privateOne.id, text: 'File of another place', fileIds: [Object.values(office.files).find((f) => f.projectId === 'prj_001')!.id] }, attendee],
    ['meetings.saveMinutes', { id: privateOne.id, text: '', fileIds: [] }, attendee],
    ['meetings.settle', { id: privateOne.id }, outsider],
    ['meetings.settle', { id: privateOne.id }, attendee],
    ['meetings.saveMinutes', { id: lineOne.id, text: 'Leader edit', fileIds: [] }, leader],
    ['meetings.saveMinutes', { id: lineOne.id, text: 'Admin edit', fileIds: [] }, ADMIN],
    ['meetings.saveMinutes', { id: lineOne.id, text: 'Outsider try', fileIds: [] }, outsider],
    ['meetings.saveMinutes', { id: lineOne.id, text: 'File of a meeting', fileIds: [MEETING_FILE_ID] }, lineOne.attendeeIds[0]],
    ['meetings.saveMinutes', { id: lineOne.id, text: '', fileIds: [] }, lineOne.attendeeIds[0]],
    ['meetings.saveMinutes', { id: teamOne.id, text: 'Team edit', fileIds: [] }, leader],
    ['meetings.saveMinutes', { id: teamOne.id, text: 'Outsider try', fileIds: [] }, outsider],
    ['tracker.update', { id: lineOne.trackerEntryId!, note: 'A note by the leader' }, leader],
  ];
  for (const event of [privateEvent, lineEvent, teamEvent]) {
    if (!event) continue;
    calls.push(['events.undo', { eventId: event.id }, event.actingForId], ['events.undo', { eventId: event.id }, outsider], ['events.undo', { eventId: event.id }, ADMIN]);
  }
  return calls;
}

/**
 * The writes on the meeting file of meetingFileTrap, by the attendee, by a person outside the meeting and by the Admin who is not
 * invited: an upload, a message and a Tracker entry that carry the file, a share, a delete and a "delivered" mark. None on an office
 * without the trap.
 */
export function meetingFileWrites(office: State): SweepCall[] {
  const file = office.files[MEETING_FILE_ID];
  const meeting = file?.meetingId ? office.meetings?.[file.meetingId] : undefined;
  if (!file || !meeting) return [];
  const [attendee] = meeting.attendeeIds;
  const outside = Object.values(office.users).find((u) => u.kind === 'human' && u.active && u.id !== ADMIN && u.id !== meeting.organizerId && !meeting.attendeeIds.includes(u.id))!.id;
  const leader = office.projects.prj_001.leaderId!;
  const prepared = { blobKey: 'blob_sweep_meeting', mimeType: 'application/pdf', size: 5 };
  const chat = Object.values(office.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes(attendee))?.id ?? 'cnv_001';
  return [
    ['files.upload', { name: 'Second.pdf', meetingId: meeting.id, uploadId: 'upl_mtg_a' }, attendee, prepared],
    ['files.upload', { name: 'Second.pdf', meetingId: meeting.id, uploadId: 'upl_mtg_b' }, outside, prepared],
    ['files.upload', { name: 'Third.pdf', meetingId: meeting.id, uploadId: 'upl_mtg_c' }, ADMIN, prepared],
    ['chats.send', { conversationId: chat, body: 'Again', fileIds: [file.id] }, attendee],
    ['chats.send', { conversationId: 'cnv_001', body: 'Again', fileIds: [file.id] }, outside],
    ['tracker.log', { projectId: 'prj_001', type: 'file', direction: 'in', title: 'Carry', fileIds: [file.id] }, leader],
    ['comments.create', { targetType: 'task', targetId: Object.values(office.tasks).find((t) => t.projectId === 'prj_001')!.id, body: 'Carry', fileIds: [file.id] }, leader],
    ['files.share', { fileId: file.id, target: { kind: 'person', userId: outside } }, attendee],
    ['files.share', { fileId: file.id, target: { kind: 'person', userId: attendee } }, outside],
    ['files.delete', { id: file.id }, attendee],
    ['files.delete', { id: file.id }, outside],
    ['files.markDelivered', { id: file.id }, attendee],
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

/**
 * Meetings (fbk_022, owner 2026-10-19): usr_004 plans a meeting with no project for usr_006; the agent of usr_005 plans one for its
 * person with usr_007; the leader of prj_001 plans a client meeting of the project with usr_003. usr_001 (the Admin) and the rest
 * are on none of the private ones.
 */
function meetingTraps(state: State): void {
  const leader = state.projects.prj_001.leaderId!;
  apply(state, 'meetings.create', { kind: 'meeting', title: 'Meet the new client', startsAt: '2026-10-05T10:00:00+03:00', attendeeIds: ['usr_006'] }, 'usr_004', 'cor_trap_meeting_office');
  apply(state, 'meetings.create', { kind: 'team', title: 'Plan the site visits', startsAt: '2026-10-06T08:30:00+03:00', attendeeIds: ['usr_007'] }, OFFICE_AGENT, 'cor_trap_meeting_agent');
  apply(state, 'meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-05T12:00:00+03:00', attendeeIds: ['usr_003'] }, leader, 'cor_trap_meeting_project');
}

/** The titles of the two series of seriesTraps. */
export const SERIES_PRIVATE_TITLE = 'Private weekly talk';
export const SERIES_PROJECT_TITLE = 'Daily site check';

/**
 * Two series (fbk_022, wave 3) on a copy of the sample office. usr_004 plans a weekly talk with no project for usr_006: 8 meetings from
 * Sunday 2026-10-11. The leader of prj_001 plans a daily site check of the project for usr_003 until 2026-10-22: 9 working days from Monday
 * 2026-10-12, 8 of them made. In each series one meeting in the middle is cancelled alone, so the series has 7 meetings ahead and the
 * extension adds one (the daily series stops at its last day, so it adds none). Not in trapOffice: its tests count the meetings there.
 */
export function seriesTraps(state: State): void {
  const leader = state.projects.prj_001.leaderId!;
  const priv = apply(state, 'meetings.create', {
    kind: 'meeting', title: SERIES_PRIVATE_TITLE, startsAt: '2026-10-11T09:00:00+03:00', attendeeIds: ['usr_006'], repeat: { every: 'week', until: null },
  }, 'usr_004', 'cor_trap_series_private') as { id: string };
  const open = apply(state, 'meetings.create', {
    kind: 'client', title: SERIES_PROJECT_TITLE, projectId: 'prj_001', startsAt: '2026-10-12T10:00:00+03:00', attendeeIds: ['usr_003'], repeat: { every: 'day', until: '2026-10-22' },
  }, leader, 'cor_trap_series_project') as { id: string };
  const second = (seriesId: string) => Object.values(state.meetings ?? {}).filter((m) => m.seriesId === seriesId).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[2].id;
  apply(state, 'meetings.cancel', { id: second(priv.id) }, 'usr_004', 'cor_trap_series_private_one');
  apply(state, 'meetings.cancel', { id: second(open.id) }, leader, 'cor_trap_series_project_one');
}

/**
 * Reads and writes on the series of seriesTraps: the organizer, an attendee, an outsider, the Admin who is not invited and the agent of the
 * organizer try the private series; the leader, a team member and the Admin try the project series. A person who does not see a series
 * gets the same refusal on the scoped load and on the whole office. None on an office without the traps.
 */
export function seriesSweep(office: State): SweepCall[] {
  const series = (title: string) => Object.values(office.meetings ?? {}).filter((m) => m.title === title).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const priv = series(SERIES_PRIVATE_TITLE);
  const open = series(SERIES_PROJECT_TITLE);
  if (priv.length === 0 || open.length === 0) return [];
  const [pFirst, , pThird, pFourth] = priv;
  const [oFirst, , oThird, oFourth] = open;
  const leader = office.projects.prj_001.leaderId!;
  const outsider = 'usr_003';
  const calls: SweepCall[] = [];
  for (const actor of [pFirst.organizerId, pFirst.attendeeIds[0], outsider, ADMIN, OFFICE_AGENT, leader]) {
    calls.push(['meetings.list', { from: '2026-10-01', to: '2026-12-31' }, actor], ['meetings.list', { from: '2026-10-01', to: '2026-12-31', mine: false, projectId: 'prj_001' }, actor]);
    for (const m of [pFirst, pFourth, oFirst, oFourth]) calls.push(['meetings.get', { id: m.id }, actor]);
  }
  for (const actor of [pFirst.organizerId, pFirst.attendeeIds[0], outsider, ADMIN, OFFICE_AGENT]) {
    calls.push(
      ['meetings.update', { id: pFourth.id, where: 'Room 7', scope: 'later' }, actor],
      ['meetings.update', { id: pFourth.id, startsAt: '2026-11-01T14:30:00+03:00', durationMin: 90, attendeeIds: [...pFirst.attendeeIds, 'usr_007'], scope: 'later' }, actor],
      ['meetings.cancel', { id: pFourth.id, scope: 'later' }, actor],
      ['meetings.extend', { seriesId: pFirst.seriesId }, actor],
    );
  }
  for (const actor of [leader, 'usr_003', ADMIN, 'usr_004', 'usr_006']) {
    calls.push(
      ['meetings.update', { id: oThird.id, title: 'Site check, new title', scope: 'later' }, actor],
      ['meetings.update', { id: oThird.id, startsAt: '2026-10-14T08:00:00+03:00', scope: 'later' }, actor],
      ['meetings.update', { id: oThird.id, startsAt: '2026-10-15T08:00:00+03:00', scope: 'later' }, actor],
      ['meetings.cancel', { id: oThird.id, scope: 'later' }, actor],
      ['meetings.cancel', { id: oFourth.id }, actor],
      ['meetings.extend', { seriesId: oFirst.seriesId }, actor],
    );
  }
  calls.push(['meetings.create', { kind: 'team', title: 'New daily', startsAt: '2026-10-18T09:00:00+03:00', attendeeIds: ['usr_007'], repeat: { every: 'two_weeks', until: null } }, pFirst.organizerId]);
  return calls;
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
  // A project chat and a thread that the leader read and then marked unread (fbk_028): the mark counts in the list, the badge and the
  // chat, in memory and in the database. The leader reads both first, so the count is the mark alone.
  const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
  for (const id of [room.id, thread.id]) {
    apply(state, 'chats.markRead', { conversationId: id }, leader, 'cor_trap_badge_read', undefined, at(9, 30));
    apply(state, 'chats.markUnread', { conversationId: id }, leader, 'cor_trap_badge_unread', undefined, at(9, 40));
  }
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
  meetingTraps(state);
  chatFileTrap(state);
  meetingFileTrap(state);
  meetingMinutesTraps(state);
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
  searchTraps(state, group.id, people);
  emptyDirectTrap(state);
}

/** The non-Admin active people of an office, in id order. */
const crew = (state: State): string[] => Object.values(state.users).filter((u) => u.kind === 'human' && u.active && u.systemRole !== 'admin').map((u) => u.id).sort();
const talks = (state: State, a: string, b: string) =>
  Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes(a) && c.memberIds.includes(b));
const pairsOf = (people: string[]): [string, string][] => people.flatMap((a) => people.filter((b) => b > a).map((b): [string, string] => [a, b]));

/** An empty direct chat of two people who had none (item 18): it shows only for the person who opens it. */
function emptyDirectTrap(state: State): void {
  const pair = pairsOf(crew(state)).find(([a, b]) => !talks(state, a, b));
  if (pair) addDirectConversation(state, pair[0], pair[1], '2026-10-03T08:00:00.000+03:00');
}

/** The id of a message of the search records of findTraps. */
const searchId = (n: number) => `msg_${2000 + n}`;

/**
 * The records of the message search (item 16): 7 messages with "riser" in the project chat of prj_001 and one deleted message with
 * "riser" newer than them, the word in the group and in a direct chat of two people, and an Arabic message with "أسعار".
 */
function searchTraps(state: State, groupId: string, people: string[]): void {
  const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
  const leader = state.projects.prj_001.leaderId!;
  const [first, second] = people;
  const talk = Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes(first) && c.memberIds.includes(second))
    ?? addDirectConversation(state, first, second, '2026-10-02T08:00:00.000+03:00');
  const put = (n: number, conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) => {
    state.messages[searchId(n)] = {
      id: searchId(n), conversationId, authorId, actingForId: authorId, body, mentions: [], fileIds: [],
      createdAt: `2026-10-04T08:${String(10 + n).padStart(2, '0')}:00.000+03:00`, editedAt: null, ...extra,
    };
  };
  for (let n = 1; n <= 7; n++) put(n, room.id, leader, `Riser size ${n}`);
  put(8, room.id, leader, 'Riser deleted offer', { deletedAt: '2026-10-03T12:00:00.000Z' });
  put(9, groupId, first, 'The riser of the group');
  put(10, talk.id, second, 'The riser of two people');
  put(11, room.id, leader, 'أسعار المواد ارتفعت');
  searchCommentTraps(state, leader);
}

/** The id of a comment of the search records of findTraps. */
const noteId = (n: number) => `cmt_${2000 + n}`;

/**
 * The comment records of the message search (item 16): 6 comments with "riser" on one project task, between the messages in time; a
 * comment with "riser" on a new office task (its lead and its helper see it); a project task that is deleted after 2 newer comments
 * with "riser" (Postgres keeps their project, the memory form does not); and a comment with "riser" on a project post.
 */
function searchCommentTraps(state: State, leader: string): void {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_001' && t.status !== 'done')!;
  const put = (n: number, targetType: 'task' | 'update', targetId: string, authorId: string, body: string, createdAt: string) => {
    state.comments[noteId(n)] = { id: noteId(n), targetType, targetId, authorId, body, reactions: emptyReactions(), fileIds: [], createdAt, editedAt: null };
  };
  for (let n = 1; n <= 6; n++) put(n, 'task', task.id, leader, `Riser comment ${n}`, `2026-10-04T08:${String(10 + 2 * n).padStart(2, '0')}:30.000+03:00`);
  const office = apply(state, 'tasks.create', { title: 'Order the riser parts', ownerId: 'usr_005', helperIds: ['usr_006'], dueDate: '2026-10-08' }, 'usr_004', 'cor_find_office') as { task: { id: string } };
  put(7, 'task', office.task.id, 'usr_005', 'Riser parts ordered', '2026-10-04T08:25:00.000+03:00');
  const gone = apply(state, 'tasks.create', { projectId: 'prj_001', title: 'Short lived task', ownerId: leader }, leader, 'cor_find_gone') as { task: { id: string } };
  put(8, 'task', gone.task.id, leader, 'Riser of a gone task one', '2026-10-04T08:30:00.000+03:00');
  put(9, 'task', gone.task.id, leader, 'Riser of a gone task two', '2026-10-04T08:31:00.000+03:00');
  apply(state, 'tasks.delete', { id: gone.task.id }, leader, 'cor_find_gone_delete');
  const post = Object.values(state.updates).find((u) => u.projectId === 'prj_001')!;
  put(10, 'update', post.id, leader, 'Riser on a project post', '2026-10-04T08:40:00.000+03:00');
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
  // The message search, for every active human and agent: a word, an Arabic word in another letter form, and a query with no word of 3 letters.
  const searchers = Object.values(office.users).filter((u) => u.active).map((u) => u.id);
  for (const actor of searchers) for (const text of ['riser', 'اسعار', 'ri', 'riser size']) calls.push(['search.query', { text }, actor]);
  calls.push(...directOpenSweep(office));
  return calls;
}

/**
 * chats.openDirect and chats.list for the direct chats of item 18 (an empty direct chat shows only for the person who opened it): a
 * pair with no chat, a pair with an empty chat (each of the two opens it), and a pair with messages, as writes. The chat list of every
 * person follows, as reads.
 */
function directOpenSweep(office: State): SweepCall[] {
  const people = crew(office);
  const live = (chatId: string) => Object.values(office.messages).some((m) => m.conversationId === chatId && m.deletedAt === undefined);
  const direct = Object.values(office.conversations).filter((c) => c.kind === 'direct' && c.memberIds.every((id) => people.includes(id)));
  const empty = direct.find((c) => !live(c.id));
  const full = direct.find((c) => live(c.id));
  const none = pairsOf(people).find(([a, b]) => !talks(office, a, b));
  const calls: SweepCall[] = [];
  if (empty) calls.push(['chats.openDirect', { userId: empty.memberIds[1] }, empty.memberIds[0]], ['chats.openDirect', { userId: empty.memberIds[0] }, empty.memberIds[1]]);
  if (full) calls.push(['chats.openDirect', { userId: full.memberIds[1] }, full.memberIds[0]]);
  if (none) calls.push(['chats.openDirect', { userId: none[1] }, none[0]]);
  for (const actor of Object.values(office.users).filter((u) => u.active).map((u) => u.id)) calls.push(['chats.list', {}, actor]);
  return calls;
}


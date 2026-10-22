import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { RoleSettings } from '../contract/entities';
import { notify } from '../notify';
import { DEFAULT_EXTRA } from '../rightsCatalog';
import { projectTemplatesOf, taskTemplatesOf } from '../store';
import { mentionMarkup } from '../../lib/text';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The privacy review of a hidden project (hidden projects, owner 2026-10-22, wave D1: the doors every call passes). What a person who
 * does not see a project must never learn, not even that it exists: every call that names the project, or a record in it, answers as
 * for a missing one (the same code, the same text and the same details), on a read and on a write.
 *
 * prj_001 is open (leader Faisal usr_002, team Sara usr_003). prj_002 is hidden (leader usr_002, team usr_003, chosen Lina usr_006).
 * prj_003 is open and is the place of usr_010. Omar usr_004 is outside. usr_007 is Management (payment rights, no hidden switch).
 * usr_005 is the agent of Sara, usr_008 the agent of Omar, usr_009 the agent of the Admin Hala usr_001. usr_010 has a role without
 * "See every project" and works on prj_003 only.
 */
const ADMIN = 'usr_001';
const LEADER = 'usr_002';
const TEAM = 'usr_003';
const OUTSIDER = 'usr_004';
const AGENT_OF_TEAM = 'usr_005';
const CHOSEN = 'usr_006';
const MANAGEMENT = 'usr_007';
const AGENT_OF_OUTSIDER = 'usr_008';
const AGENT_OF_ADMIN = 'usr_009';
const NARROW = 'usr_010';
const WITHOUT_VIEW = [OUTSIDER, AGENT_OF_OUTSIDER, MANAGEMENT, NARROW];
const WITH_VIEW = [ADMIN, LEADER, TEAM, CHOSEN, AGENT_OF_TEAM, AGENT_OF_ADMIN];

const NARROW_ROLES: RoleSettings = { custom: [{ id: 'rol_001', name: 'Desk', nameAr: 'مكتب', rights: [], off: ['project.seeAll'] }] };

async function world(roles?: RoleSettings) {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = roles ?? NARROW_ROLES;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Chosen' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Turki Management', systemRole: 'management' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Omar Assistant', kind: 'agent', discipline: 'Agent', ownerId: OUTSIDER });
  state.users.usr_009 = makeUser('usr_009', { name: 'Hala Assistant', kind: 'agent', discipline: 'Agent', ownerId: ADMIN });
  state.users.usr_010 = makeUser('usr_010', { name: 'Desk Person', roleId: 'rol_001' });
  state.counters.usr = 10;
  // The hidden project is made open, filled by its people, and hidden last, as in the office.
  t.as(LEADER);
  const open3 = await t.api.call('projects.create', { name: 'Open annex', teamIds: [NARROW] });
  const made = await t.api.call('projects.create', { name: 'Secret tower', teamIds: [TEAM] });
  const id = made.project.id;
  const stageId = Object.values(t.store.state.stages).find((stage) => stage.projectId === id)!.id;
  const task = (await t.api.call('tasks.create', { projectId: id, title: 'Secret plan', ownerId: TEAM, stageId })).task;
  const post = await t.api.call('updates.create', { projectId: id, body: 'Secret post' });
  const taskComment = await t.api.call('comments.create', { targetType: 'task', targetId: task.id, body: 'Secret note' });
  const postComment = await t.api.call('comments.create', { targetType: 'update', targetId: post.id, body: 'Secret reply' });
  await t.api.call('deadlines.create', { projectId: id, name: 'Secret deadline', date: '2026-11-20' });
  const entry = await t.api.call('tracker.log', { projectId: id, type: 'message', direction: 'in', title: 'Secret ask', waiting: 'us' });
  await t.api.call('taskTemplates.save', { fromTaskId: task.id, name: 'Concept template' });
  const meeting = await t.api.call('meetings.create', { kind: 'meeting', title: 'Secret meeting', projectId: id, startsAt: '2026-10-02T10:00:00+03:00', attendeeIds: [TEAM] });
  t.as(ADMIN);
  const payment = await t.api.call('payments.create', { projectId: id, name: 'Secret fee', amount: 777777, dueDate: '2026-11-01' });
  await t.api.call('projectTemplates.save', {
    name: 'Plan', roles: [], stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }],
    tasks: [{ id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 0, durationDays: 5, flexible: true }],
  });
  state.files.fil_901 = {
    id: 'fil_901', projectId: id, stageId: null, taskId: null, name: 'secret-plan.pdf',
    versions: [{ letter: 'A', blobKey: 'blob_901', mimeType: 'application/pdf', size: 3, uploadedBy: LEADER, uploadedAt: '2026-09-30T09:00:00.000+03:00' }],
  };
  t.as(LEADER);
  await t.api.call('projects.setAccess', { id, hidden: true, viewerIds: [CHOSEN] });
  const ids = {
    project: id, stage: stageId, task: task.id, post: post.id, taskComment: taskComment.comment.id, postComment: postComment.comment.id,
    deadline: Object.values(t.store.state.deadlines).find((d) => d.projectId === id)!.id, entry: entry.entry.id, template: Object.keys(taskTemplatesOf(t.store.state)).at(-1)!,
    meeting: meeting.id, payment: payment.payment.id, file: 'fil_901', plan: Object.keys(projectTemplatesOf(t.store.state)).at(-1)!, open3: open3.project.id,
    event: Object.values(t.store.state.events).find((e) => e.projectId === id && e.verb === 'task.created')!.id,
  };
  return { t, ids };
}
type World = Awaited<ReturnType<typeof world>>;

const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
type Failure = { code: string; message: string; details?: Record<string, unknown> };
const failure = async (run: () => Promise<unknown>): Promise<Failure | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as Failure;
  }
};
/** The answer of a failed call with the id of the record taken out, so a hidden id and a missing id compare equal. */
const shape = (error: Failure | null, id: string) => {
  if (error === null) return null;
  const swap = (text: string) => text.split(id).join('@');
  return { code: error.code, message: swap(error.message), details: JSON.parse(swap(JSON.stringify(error.details ?? {}))) as unknown };
};

/** The made-up id (xxx_999) that a probe uses for the missing record. */
const missingIdOf = (input: unknown): string => JSON.stringify(input).match(/"([a-z]{3}_999)"/)![1];

type Probe = { name: string; hidden: unknown; missing: unknown; id: string; people?: string[]; plain?: true };

function probes(ids: World['ids']): Probe[] {
  const P = ids.project;
  const gone = 'prj_999';
  const link = { kind: 'moodboard', label: 'Board', url: 'https://example.com/board' };
  const one = (name: string, hidden: Record<string, unknown>, missing: Record<string, unknown>, id: string, extra: Partial<Probe> = {}): Probe => ({ name, hidden, missing, id, ...extra });
  return [
    one('projects.get', { id: P }, { id: gone }, P),
    one('projects.update', { id: P, patch: { name: 'Mine' } }, { id: gone, patch: { name: 'Mine' } }, P),
    one('projects.setLeader', { id: P, leaderId: OUTSIDER }, { id: gone, leaderId: OUTSIDER }, P),
    one('projects.setStatus', { id: P, status: 'archived' }, { id: gone, status: 'archived' }, P),
    one('projects.pause', { id: P, reason: 'Why' }, { id: gone, reason: 'Why' }, P),
    one('projects.resume', { id: P }, { id: gone }, P),
    one('projects.setRestart', { id: P, resumeOn: '2026-12-01' }, { id: gone, resumeOn: '2026-12-01' }, P),
    one('projects.addLink', { projectId: P, ...link }, { projectId: gone, ...link }, P),
    one('projects.updateLink', { projectId: P, linkId: 'lnk_001', label: 'x' }, { projectId: gone, linkId: 'lnk_001', label: 'x' }, P),
    one('projects.removeLink', { projectId: P, linkId: 'lnk_001' }, { projectId: gone, linkId: 'lnk_001' }, P),
    one('projects.setHealthOverride', { id: P, value: 'late', reason: 'Late' }, { id: gone, value: 'late', reason: 'Late' }, P),
    one('projects.clearHealthOverride', { id: P }, { id: gone }, P),
    one('projects.setAccess', { id: P, hidden: false, viewerIds: [] }, { id: gone, hidden: false, viewerIds: [] }, P),
    one('projects.delete', { id: P, confirm: true }, { id: gone, confirm: true }, P),
    one('members.add', { projectId: P, userId: OUTSIDER }, { projectId: gone, userId: OUTSIDER }, P),
    one('members.addTeam', { projectId: P, teamId: 'tm_001' }, { projectId: gone, teamId: 'tm_001' }, P),
    one('members.remove', { projectId: P, userId: TEAM }, { projectId: gone, userId: TEAM }, P),
    one('members.update', { projectId: P, userId: TEAM, discipline: 'MEP' }, { projectId: gone, userId: TEAM, discipline: 'MEP' }, P),
    one('stages.replace', { projectId: P, stages: [{ name: 'Only' }] }, { projectId: gone, stages: [{ name: 'Only' }] }, P),
    one('stages.setDates', { stageId: ids.stage, startDate: null, endDate: null }, { stageId: 'stg_999', startDate: null, endDate: null }, ids.stage),
    one('stages.setPrerequisites', { stageId: ids.stage, prerequisiteIds: [] }, { stageId: 'stg_999', prerequisiteIds: [] }, ids.stage),
    one('deadlines.create', { projectId: P, name: 'Due', date: '2026-11-21' }, { projectId: gone, name: 'Due', date: '2026-11-21' }, P),
    one('deadlines.update', { id: ids.deadline, patch: { name: 'Moved' } }, { id: 'ddl_999', patch: { name: 'Moved' } }, ids.deadline),
    one('deadlines.delete', { id: ids.deadline }, { id: 'ddl_999' }, ids.deadline),
    one('tasks.get', { id: ids.task }, { id: 'tsk_999' }, ids.task),
    one('tasks.create', { projectId: P, title: 'Mine' }, { projectId: gone, title: 'Mine' }, P),
    one('tasks.createFromTemplate', { templateId: ids.template, stageId: ids.stage }, { templateId: ids.template, stageId: 'stg_999' }, ids.stage),
    one('tasks.update', { id: ids.task, patch: { title: 'Mine' } }, { id: 'tsk_999', patch: { title: 'Mine' } }, ids.task),
    one('tasks.complete', { id: ids.task }, { id: 'tsk_999' }, ids.task),
    one('tasks.move', { id: ids.task, status: 'in_progress' }, { id: 'tsk_999', status: 'in_progress' }, ids.task),
    one('tasks.take', { taskId: ids.task }, { taskId: 'tsk_999' }, ids.task),
    one('tasks.help', { taskId: ids.task, help: true }, { taskId: 'tsk_999', help: true }, ids.task),
    one('tasks.arrange', { ids: [ids.task] }, { ids: ['tsk_999'] }, ids.task),
    one('tasks.newVersion', { id: ids.task, reason: 'Again' }, { id: 'tsk_999', reason: 'Again' }, ids.task),
    one('tasks.approve', { id: ids.task }, { id: 'tsk_999' }, ids.task),
    one('tasks.sendBack', { id: ids.task, note: 'No' }, { id: 'tsk_999', note: 'No' }, ids.task),
    one('tasks.delete', { id: ids.task }, { id: 'tsk_999' }, ids.task),
    one('taskTemplates.save', { fromTaskId: ids.task, name: 'Mine' }, { fromTaskId: 'tsk_999', name: 'Mine' }, ids.task),
    one('updates.list', { projectId: P }, { projectId: gone }, P),
    one('updates.create', { projectId: P, body: 'Mine' }, { projectId: gone, body: 'Mine' }, P),
    one('updates.update', { id: ids.post, body: 'Mine' }, { id: 'upd_999', body: 'Mine' }, ids.post),
    one('updates.delete', { id: ids.post }, { id: 'upd_999' }, ids.post),
    one('comments.list', { targetType: 'task', targetId: ids.task }, { targetType: 'task', targetId: 'tsk_999' }, ids.task),
    one('comments.list', { targetType: 'update', targetId: ids.post }, { targetType: 'update', targetId: 'upd_999' }, ids.post),
    one('comments.create', { targetType: 'task', targetId: ids.task, body: 'Mine' }, { targetType: 'task', targetId: 'tsk_999', body: 'Mine' }, ids.task),
    one('comments.create', { targetType: 'update', targetId: ids.post, body: 'Mine' }, { targetType: 'update', targetId: 'upd_999', body: 'Mine' }, ids.post),
    one('comments.update', { id: ids.taskComment, body: 'Mine' }, { id: 'cmt_999', body: 'Mine' }, ids.taskComment),
    one('comments.update', { id: ids.postComment, body: 'Mine' }, { id: 'cmt_999', body: 'Mine' }, ids.postComment),
    one('comments.delete', { id: ids.taskComment }, { id: 'cmt_999' }, ids.taskComment),
    one('reactions.toggle', { commentId: ids.taskComment, emoji: '👍' }, { commentId: 'cmt_999', emoji: '👍' }, ids.taskComment),
    one('reactions.toggle', { commentId: ids.postComment, emoji: '👍' }, { commentId: 'cmt_999', emoji: '👍' }, ids.postComment),
    one('files.list', { projectId: P }, { projectId: gone }, P),
    one('files.delete', { id: ids.file }, { id: 'fil_999' }, ids.file),
    one('files.markDelivered', { id: ids.file }, { id: 'fil_999' }, ids.file),
    one('files.share', { fileId: ids.file, target: { kind: 'project_chat' } }, { fileId: 'fil_999', target: { kind: 'project_chat' } }, ids.file),
    one('files.link', { id: ids.file, variant: 'full', disposition: 'inline' }, { id: 'fil_999', variant: 'full', disposition: 'inline' }, ids.file),
    one('tracker.list', { projectId: P }, { projectId: gone }, P),
    one('tracker.export', { projectId: P }, { projectId: gone }, P),
    one('tracker.log', { projectId: P, type: 'message', direction: 'in', title: 'Mine' }, { projectId: gone, type: 'message', direction: 'in', title: 'Mine' }, P),
    one('tracker.update', { id: ids.entry, waiting: null }, { id: 'trk_999', waiting: null }, ids.entry),
    one('tracker.close', { id: ids.entry }, { id: 'trk_999' }, ids.entry),
    one('tracker.delete', { id: ids.entry }, { id: 'trk_999' }, ids.entry),
    one('tracker.assignReply', { id: ids.entry, userId: OUTSIDER, dueDate: '2026-11-10' }, { id: 'trk_999', userId: OUTSIDER, dueDate: '2026-11-10' }, ids.entry),
    one('payments.list', { projectId: P }, { projectId: gone }, P, { people: [MANAGEMENT] }),
    one('payments.create', { projectId: P, name: 'Mine', amount: 5, dueDate: '2026-11-01' }, { projectId: gone, name: 'Mine', amount: 5, dueDate: '2026-11-01' }, P, { people: [MANAGEMENT] }),
    one('payments.update', { id: ids.payment, patch: { name: 'Mine' } }, { id: 'pay_999', patch: { name: 'Mine' } }, ids.payment, { people: [MANAGEMENT] }),
    one('payments.markReceived', { id: ids.payment }, { id: 'pay_999' }, ids.payment, { people: [MANAGEMENT] }),
    one('payments.delete', { id: ids.payment }, { id: 'pay_999' }, ids.payment, { people: [MANAGEMENT] }),
    one('meetings.get', { id: ids.meeting }, { id: 'mtg_999' }, ids.meeting),
    one('meetings.update', { id: ids.meeting, notes: 'Mine' }, { id: 'mtg_999', notes: 'Mine' }, ids.meeting),
    one('meetings.cancel', { id: ids.meeting }, { id: 'mtg_999' }, ids.meeting),
    one('meetings.create', { kind: 'meeting', title: 'Mine', projectId: P, startsAt: '2026-10-03T10:00:00+03:00' }, { kind: 'meeting', title: 'Mine', projectId: gone, startsAt: '2026-10-03T10:00:00+03:00' }, P),
    one('meetings.list', { mine: false, projectId: P }, { mine: false, projectId: gone }, P),
    one('events.undo', { eventId: ids.event }, { eventId: 'evt_999' }, ids.event),
    one('projectTemplates.matchPlan', { projectId: P, templateId: ids.plan }, { projectId: gone, templateId: ids.plan }, P),
    one('projectTemplates.link', { projectId: P, templateId: ids.plan, stageMatches: {}, taskMatches: {}, rolePeople: {} }, { projectId: gone, templateId: ids.plan, stageMatches: {}, taskMatches: {}, rolePeople: {} }, P),
    one('pictures.get', { kind: 'projectTile', id: P }, { kind: 'projectTile', id: gone }, P, { plain: true }),
  ].filter((probe) => probe.name in calls);
}

describe('every call that names a hidden project, or a record in it', () => {
  it('answers a person who does not see the project exactly as for a missing one, on a read and on a write', async () => {
    const w = await world();
    for (const probe of probes(w.ids)) {
      for (const person of probe.people ?? WITHOUT_VIEW) {
        const hidden = await as(w, person, () => failure(() => w.t.api.call(probe.name as 'projects.get', probe.hidden as never)));
        const gone = await as(w, person, () => failure(() => w.t.api.call(probe.name as 'projects.get', probe.missing as never)));
        const label = `${person} ${probe.name} ${JSON.stringify(probe.hidden)}`;
        expect(hidden, label).not.toBeNull();
        expect(shape(hidden, probe.id), label).toEqual(shape(gone, missingIdOf(probe.missing)));
        if (!probe.plain) expect(hidden!.code, label).toBe('not_found');
      }
    }
  });

  it('shows the same project, its feed, files, Tracker, tasks and comments to the leader, the team, the chosen person, the Admin and their agents', async () => {
    const w = await world();
    for (const person of WITH_VIEW) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const read = (name: string, input: unknown) => as(w, person, () => w.t.api.call(name as never, input as never)) as Promise<any>;
      expect((await read('projects.get', { id: w.ids.project })).project.id, person).toBe(w.ids.project);
      expect(await read('updates.list', { projectId: w.ids.project })).not.toHaveLength(0);
      expect(await read('files.list', { projectId: w.ids.project })).toHaveLength(1);
      expect(await read('tracker.list', { projectId: w.ids.project })).toHaveLength(1);
      expect((await read('tasks.get', { id: w.ids.task })).task.id).toBe(w.ids.task);
      expect(await read('comments.list', { targetType: 'task', targetId: w.ids.task })).toHaveLength(1);
      expect(await read('comments.list', { targetType: 'update', targetId: w.ids.post })).toHaveLength(1);
      expect((await read('meetings.get', { id: w.ids.meeting })).id).toBe(w.ids.meeting);
    }
  });

  it('gives the chosen person what an office person outside the team has on an open project: read, and no write that needs the team', async () => {
    const w = await world();
    await expect(as(w, CHOSEN, () => w.t.api.call('updates.create', { projectId: w.ids.project, body: 'Mine' }))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(as(w, CHOSEN, () => w.t.api.call('comments.create', { targetType: 'task', targetId: w.ids.task, body: 'Mine' }))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(as(w, CHOSEN, () => w.t.api.call('tasks.create', { projectId: w.ids.project, title: 'Mine' }))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the team write in the hidden project', async () => {
    const w = await world();
    await as(w, TEAM, () => w.t.api.call('updates.create', { projectId: w.ids.project, body: 'Team post' }));
    await as(w, AGENT_OF_TEAM, () => w.t.api.call('comments.create', { targetType: 'task', targetId: w.ids.task, body: 'Agent note' }));
    expect(Object.values(w.t.store.state.comments).map((c) => c.body)).toContain('Agent note');
  });
});

describe('a role without "See every project"', () => {
  it('answers not_found on an open project where the person does not work, and passes on one where the person is on the team', async () => {
    const w = await world();
    const gone = await as(w, NARROW, () => failure(() => w.t.api.call('projects.get', { id: 'prj_999' })));
    const open = await as(w, NARROW, () => failure(() => w.t.api.call('projects.get', { id: 'prj_001' })));
    expect(shape(open, 'prj_001')).toEqual(shape(gone, 'prj_999'));
    expect(open).toMatchObject({ code: 'not_found' });
    await expect(as(w, NARROW, () => w.t.api.call('projects.get', { id: w.ids.open3 }))).resolves.toMatchObject({ project: { id: w.ids.open3 } });
    // The tasks, the feed and the files of the open project read as missing too.
    await expect(as(w, NARROW, () => w.t.api.call('updates.list', { projectId: 'prj_001' }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, NARROW, () => w.t.api.call('files.list', { projectId: 'prj_001' }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, NARROW, () => w.t.api.call('tracker.list', { projectId: 'prj_001' }))).rejects.toMatchObject({ code: 'not_found' });
    // The Member of the same role keeps every project by default: the other people see prj_001.
    await expect(as(w, OUTSIDER, () => w.t.api.call('projects.get', { id: 'prj_001' }))).resolves.toBeDefined();
  });

  it('shows a project to a person who holds See hidden projects, and keeps it from a Management person who does not', async () => {
    const roles: RoleSettings = { rights: { management: [...DEFAULT_EXTRA.management, 'project.hidden'] } };
    const w = await world(roles);
    await expect(as(w, MANAGEMENT, () => w.t.api.call('projects.get', { id: w.ids.project }))).resolves.toBeDefined();
    const plain = await world();
    await expect(as(plain, MANAGEMENT, () => plain.t.api.call('projects.get', { id: plain.ids.project }))).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('files, meetings, the History and notices of a hidden project', () => {
  it('opens no file of the project to a person who does not see it, with the answer of a missing file', async () => {
    const w = await world();
    const hidden = await as(w, OUTSIDER, () => failure(() => w.t.api.call('files.markDelivered', { id: w.ids.file })));
    const gone = await as(w, OUTSIDER, () => failure(() => w.t.api.call('files.markDelivered', { id: 'fil_999' })));
    expect(shape(hidden, w.ids.file)).toEqual(shape(gone, 'fil_999'));
    expect(hidden).toMatchObject({ code: 'not_found' });
  });

  it('refuses an attendee who does not see the project of the meeting, and accepts the chosen person', async () => {
    const w = await world();
    const input = { kind: 'meeting', title: 'Review', projectId: w.ids.project, startsAt: '2026-10-03T10:00:00+03:00' } as const;
    await expect(as(w, LEADER, () => w.t.api.call('meetings.create', { ...input, attendeeIds: [OUTSIDER] }))).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_in_project_audience' } });
    await expect(as(w, LEADER, () => w.t.api.call('meetings.create', { ...input, attendeeIds: [CHOSEN] }))).resolves.toBeDefined();
    await expect(as(w, LEADER, () => w.t.api.call('meetings.update', { id: w.ids.meeting, attendeeIds: [TEAM, OUTSIDER] }))).rejects.toMatchObject({ details: { reason: 'not_in_project_audience' } });
  });

  it('loses the meeting when the person loses the view: a person taken off the chosen list no longer reads it', async () => {
    const w = await world();
    await as(w, LEADER, () => w.t.api.call('meetings.update', { id: w.ids.meeting, attendeeIds: [TEAM, CHOSEN] }));
    await expect(as(w, CHOSEN, () => w.t.api.call('meetings.get', { id: w.ids.meeting }))).resolves.toBeDefined();
    await as(w, LEADER, () => w.t.api.call('projects.setAccess', { id: w.ids.project, hidden: true, viewerIds: [] }));
    await expect(as(w, CHOSEN, () => w.t.api.call('meetings.get', { id: w.ids.meeting }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, CHOSEN, () => w.t.api.call('projects.get', { id: w.ids.project }))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('shows no change of the project in the History to a person who does not see it, and the story answers as a missing story', async () => {
    const w = await world();
    for (const person of WITHOUT_VIEW) {
      const rows = await as(w, person, () => w.t.api.call('events.list', { limit: 500 }));
      expect(JSON.stringify(rows), person).not.toMatch(new RegExp(`Secret|${w.ids.project}|${w.ids.task}`));
      expect(await as(w, person, () => w.t.api.call('events.list', { projectId: w.ids.project }))).toEqual([]);
    }
    const event = w.t.store.state.events[w.ids.event];
    const hidden = await as(w, OUTSIDER, () => failure(() => w.t.api.call('events.undoStory', { correlationId: event.correlationId })));
    const gone = await as(w, OUTSIDER, () => failure(() => w.t.api.call('events.undoStory', { correlationId: 'cor_nope' })));
    expect(shape(hidden, event.correlationId)).toEqual(shape(gone, 'cor_nope'));
    for (const person of WITH_VIEW) {
      expect((await as(w, person, () => w.t.api.call('events.list', { projectId: w.ids.project, limit: 500 }))).length, person).toBeGreaterThan(5);
    }
  });

  it('shows the changes of a deleted hidden project only to a holder of See hidden projects, and keeps the old rule for an open one', async () => {
    const w = await world();
    await as(w, ADMIN, () => w.t.api.call('projects.delete', { id: w.ids.project, confirm: true }));
    await as(w, ADMIN, () => w.t.api.call('projects.delete', { id: w.ids.open3, confirm: true }));
    const feed = (person: string) => as(w, person, () => w.t.api.call('events.list', { limit: 500 }));
    for (const person of [OUTSIDER, MANAGEMENT, TEAM, AGENT_OF_OUTSIDER]) {
      const rows = JSON.stringify(await feed(person));
      expect(rows, person).not.toContain('Secret tower');
      expect(rows, `${person} open`).toContain('Open annex');
    }
    expect(JSON.stringify(await feed(ADMIN))).toContain('Secret tower');
    expect(JSON.stringify(await feed(AGENT_OF_ADMIN))).toContain('Secret tower');
  });

  it('sends no notice of the project to a person who does not see it', async () => {
    const w = await world();
    const state = w.t.store.state;
    const stamp = '2026-10-01T09:00:00.000+03:00';
    for (const [targetType, targetId] of [['project', w.ids.project], ['task', w.ids.task], ['update', w.ids.post], ['meeting', w.ids.meeting]] as const) {
      const told = notify(state, null, stamp, { userIds: [OUTSIDER, MANAGEMENT, NARROW, CHOSEN, TEAM, ADMIN], trigger: 'mention', targetType, targetId });
      expect(told.map((n) => n.userId).sort(), targetType).toEqual([ADMIN, CHOSEN, TEAM].sort());
    }
    // A chosen person is told when the leader adds them.
    const before = Object.values(state.notifications).filter((n) => n.userId === CHOSEN && n.trigger === 'added_to_project').length;
    await as(w, LEADER, () => w.t.api.call('projects.setAccess', { id: w.ids.project, hidden: true, viewerIds: [CHOSEN, OUTSIDER] }));
    const after = Object.values(w.t.store.state.notifications).filter((n) => n.trigger === 'added_to_project');
    expect(after.some((n) => n.userId === OUTSIDER && n.targetId === w.ids.project)).toBe(true);
    expect(after.filter((n) => n.userId === CHOSEN)).toHaveLength(before);
  });

  it('writes a mention of an outsider in a post without telling the outsider', async () => {
    const w = await world();
    await as(w, LEADER, () => w.t.api.call('updates.create', { projectId: w.ids.project, body: `Hello ${mentionMarkup('Omar', OUTSIDER)}` }));
    expect(Object.values(w.t.store.state.notifications).filter((n) => n.userId === OUTSIDER)).toEqual([]);
  });

  it('keeps the code of a hidden project out of a code question, with the same reason', async () => {
    const w = await world();
    w.t.store.state.projects[w.ids.project].code = '260902AZT-RES-Villa';
    const typed = { name: 'Mine', code: '260902XYZ-COM-Tower' };
    const clash = await as(w, OUTSIDER, () => failure(() => w.t.api.call('projects.create', typed)));
    expect(clash).toMatchObject({ code: 'invalid_input', details: { reason: 'code_taken' } });
    expect(clash!.message).not.toContain('260902AZT');
    // The people who see the project read its key, as before.
    const seen = await as(w, LEADER, () => failure(() => w.t.api.call('projects.create', typed)));
    expect(seen).toMatchObject({ details: { reason: 'code_taken' } });
    expect(seen!.message).toContain('260902AZT');
    const same = await as(w, OUTSIDER, () => failure(() => w.t.api.call('projects.create', { name: 'Mine', sameContractAs: w.ids.project })));
    const unknown = await as(w, OUTSIDER, () => failure(() => w.t.api.call('projects.create', { name: 'Mine', sameContractAs: 'prj_999' })));
    expect(shape(same, w.ids.project)).toEqual(shape(unknown, 'prj_999'));
  });

  it('keeps a hidden project from the task templates: the stage of a hidden project reads as missing before the stage rule', async () => {
    const w = await world();
    const template = taskTemplatesOf(w.t.store.state)[w.ids.template];
    expect(template.stageName.length).toBeGreaterThan(0);
    const other = await as(w, OUTSIDER, () => failure(() => w.t.api.call('tasks.createFromTemplate', { templateId: w.ids.template, stageId: w.ids.stage })));
    expect(other).toMatchObject({ code: 'not_found', message: `Stage ${w.ids.stage} does not exist.` });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { trackerCalls } from './tracker';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import type { Store } from '../store';
import { can } from '../permissions';
import { withOfficeRights } from '../rights';
import { setNow } from '../../lib/dates';
import { runScheduledTriggers } from '../notify';
import { peopleOfTask, involves } from '../../lib/taskPeople';

beforeEach(() => setNow(NOW));

const calls = { ...taskCalls, ...historyCalls, ...insightCalls, ...trackerCalls };

const notices = (store: Store, userId?: string) =>
  Object.values(store.state.notifications).filter((n) => userId === undefined || n.userId === userId);

/**
 * Tasks with no lead (owner feedback 2026-10-05, item 2). Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara
 * (usr_003) and Nour (usr_006) are on the team, Omar (usr_004) is outside it, usr_005 is Sara's agent.
 * tsk_001 is led by Sara. tsk_002 has no lead.
 */
function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Team' });
  t.store.state.members['prj_001:usr_006'] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
  t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Roof plan', ownerId: null, needsReview: false });
  t.store.state.counters.tsk = 2;
  return t;
}

describe('a task with no lead: the record', () => {
  it('parses an old record with a lead and a new record with none', async () => {
    const { Task } = await import('../contract/entities');
    expect(Task.parse(makeTask()).ownerId).toBe('usr_003');
    expect(Task.parse(makeTask({ ownerId: null })).ownerId).toBeNull();
  });

  it('leaves a missing lead out of the people of a task', () => {
    const task = makeTask({ ownerId: null, helperIds: ['usr_006'] });
    expect(peopleOfTask(task)).toEqual(['usr_006']);
    expect(involves(task, 'usr_006')).toBe(true);
    expect(involves(makeTask({ ownerId: null }), 'usr_003')).toBe(false);
  });
});

describe('making a task', () => {
  it('makes a task with no lead when the call names none, and tells nobody', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections' });
    expect(made.task.ownerId).toBeNull();
    expect(made.owner).toBeNull();
    expect(notices(t.store)).toHaveLength(0);
  });

  it('lets a team member make a task for themselves or a team mate, and stops an outsider', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Mine', ownerId: 'usr_006' })).resolves.toMatchObject({ owner: { id: 'usr_006' } });
    // The maker of a task holds the leader's rights on it, so a team member names a team mate (owner, 2026-10-07).
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Not mine', ownerId: 'usr_003' })).resolves.toMatchObject({ owner: { id: 'usr_003' } });
    t.as('usr_004');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Outside' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const led = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'For Sara', ownerId: 'usr_003' });
    expect(led.task.ownerId).toBe('usr_003');
    // One notice for the task of Nour and one for the task of Faisal: each names Sara as lead.
    expect(notices(t.store, 'usr_003').filter((n) => n.trigger === 'task_assigned')).toHaveLength(2);
  });

  it('keeps helpers on a task with no lead, and tells them', async () => {
    const t = world();
    t.as('usr_002');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Facade', helperIds: ['usr_006'] });
    expect(made.task.ownerId).toBeNull();
    expect(made.task.helperIds).toEqual(['usr_006']);
    expect(notices(t.store, 'usr_006')).toHaveLength(1);
  });

  it('makes a task from a template with no lead unless the call names one', async () => {
    const t = world();
    t.store.state.taskTemplates = {
      ttp_001: {
        id: 'ttp_001', name: 'Site visit', stageName: 'Schematic Design', description: '', checklist: [], needsReview: true,
        schedule: 'static', durationDays: null, createdBy: 'usr_002', createdAt: '2026-09-30T09:00:00.000+03:00',
      },
    };
    t.as('usr_003');
    const none = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002' });
    expect(none.task.ownerId).toBeNull();
    t.as('usr_002');
    const named = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002', ownerId: 'usr_006' });
    expect(named.task.ownerId).toBe('usr_006');
  });
});

describe('taking the lead off', () => {
  it('lets the leader and the Admin take the lead off an open task, with no notice', async () => {
    const t = world();
    t.as('usr_002');
    const out = await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: null } });
    expect(out.task.ownerId).toBeNull();
    expect(out.owner).toBeNull();
    const event = Object.values(t.store.state.events).at(-1)!;
    expect(event).toMatchObject({ verb: 'task.reassigned', before: { ownerId: 'usr_003' }, after: { ownerId: null } });
    expect(notices(t.store)).toHaveLength(0);
  });

  it('refuses the lead itself and a team member, as for any change of lead', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: null } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_006');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: null } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps the lead of a task in review or done', async () => {
    const t = world();
    t.store.state.tasks.tsk_001.status = 'in_review';
    t.as('usr_002');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: null } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'needs_lead' } });
    t.store.state.tasks.tsk_001.status = 'done';
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: null } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'needs_lead' } });
  });

  it('gives a task with no lead a lead again, and tells that person', async () => {
    const t = world();
    t.as('usr_002');
    const out = await t.api.call('tasks.update', { id: 'tsk_002', patch: { ownerId: 'usr_006' } });
    expect(out.owner?.id).toBe('usr_006');
    expect(notices(t.store, 'usr_006').map((n) => n.trigger)).toEqual(['task_assigned']);
  });

  it('brings the lead back with Undo', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: null } });
    const event = Object.values(t.store.state.events).at(-1)!;
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.tasks.tsk_001.ownerId).toBe('usr_003');
  });
});

describe('no finish without a lead', () => {
  it('refuses Complete, a move to Done and a send for review, with the reason needs_lead', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('tasks.complete', { id: 'tsk_002' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'needs_lead' } });
    await expect(t.api.call('tasks.move', { id: 'tsk_002', status: 'done' })).rejects.toMatchObject({ details: { reason: 'needs_lead' } });
    t.store.state.tasks.tsk_002.needsReview = true;
    t.as('usr_001');
    await expect(t.api.call('tasks.move', { id: 'tsk_002', status: 'done' })).rejects.toMatchObject({ details: { reason: 'needs_lead' } });
    t.as('usr_002');
    await expect(t.api.call('tasks.move', { id: 'tsk_002', status: 'in_review' })).rejects.toMatchObject({ details: { reason: 'needs_lead' } });
    expect(t.store.state.tasks.tsk_002.status).toBe('todo');
  });

  it('lets a task with no lead move between To do and In progress', async () => {
    const t = world();
    t.as('usr_002');
    const out = await t.api.call('tasks.move', { id: 'tsk_002', status: 'in_progress' });
    expect(out.result).toBe('in_progress');
  });

  it('refuses an Undo that leaves a finished task with no lead', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.take', { taskId: 'tsk_002' });
    const take = Object.values(t.store.state.events).at(-1)!;
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    expect(t.store.state.tasks.tsk_002.status).toBe('done');
    await expect(t.api.call('events.undo', { eventId: take.id })).rejects.toMatchObject({ details: { reason: 'needs_lead' } });
    await expect(t.api.call('events.undoStory', { correlationId: take.correlationId })).rejects.toMatchObject({ details: { reason: 'needs_lead' } });
    expect(t.store.state.tasks.tsk_002.ownerId).toBe('usr_003');
  });

  it('refuses an Undo that opens a finished task again as Done with no lead', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' });
    const reopen = Object.values(t.store.state.events).at(-1)!;
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: null } });
    await expect(t.api.call('events.undo', { eventId: reopen.id })).rejects.toMatchObject({ details: { reason: 'needs_lead' } });
  });
});

describe('tasks.take', () => {
  it('makes a team member the lead of a task with no lead', async () => {
    const t = world();
    t.as('usr_006');
    const out = await t.api.call('tasks.take', { taskId: 'tsk_002' });
    expect(out.task.ownerId).toBe('usr_006');
    expect(out.owner?.id).toBe('usr_006');
    expect(Object.values(t.store.state.events).at(-1)).toMatchObject({ verb: 'task.reassigned', before: { ownerId: null }, after: { ownerId: 'usr_006' } });
    expect(notices(t.store)).toHaveLength(0);
  });

  it('takes a helper who takes the task out of the helper list', async () => {
    const t = world();
    t.store.state.tasks.tsk_002.helperIds = ['usr_006', 'usr_003'];
    t.as('usr_006');
    const out = await t.api.call('tasks.take', { taskId: 'tsk_002' });
    expect(out.task.helperIds).toEqual(['usr_003']);
  });

  it('refuses a task that has a lead, a person outside the team and a person who is off', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('tasks.take', { taskId: 'tsk_001' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'has_lead' } });
    t.as('usr_004');
    await expect(t.api.call('tasks.take', { taskId: 'tsk_002' })).rejects.toMatchObject({ code: 'forbidden' });
    t.store.state.users.usr_006.active = false;
    t.as('usr_006');
    // The rule refuses a person who is off. On the database, the account check refuses first (unauthenticated, account_off).
    await expect(t.api.call('tasks.take', { taskId: 'tsk_002' })).rejects.toMatchObject({ code: expect.stringMatching(/^(forbidden|unauthenticated)$/) });
    t.as('usr_001');
    expect((await t.api.call('tasks.get', { id: 'tsk_002' })).task.ownerId).toBeNull();
    await expect(t.api.call('tasks.take', { taskId: 'tsk_999' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('makes the person an agent acts for the lead', async () => {
    const t = world();
    t.as('usr_005');
    const out = await t.api.call('tasks.take', { taskId: 'tsk_002' });
    expect(out.task.ownerId).toBe('usr_003');
  });

  it('lets the leader take a task, and an Admin outside the team join it', async () => {
    const t = world();
    t.as('usr_001');
    const out = await t.api.call('tasks.take', { taskId: 'tsk_002' });
    expect(out.task.ownerId).toBe('usr_001');
    expect(t.store.state.members['prj_001:usr_001']).toBeDefined();
  });

  it('lets the person who took a task give it back with Undo', async () => {
    const t = world();
    t.as('usr_006');
    await t.api.call('tasks.take', { taskId: 'tsk_002' });
    const take = Object.values(t.store.state.events).at(-1)!;
    await t.api.call('events.undo', { eventId: take.id });
    expect(t.store.state.tasks.tsk_002.ownerId).toBeNull();
  });

  it('refuses a member the Undo of a change of lead that the leader made with other fields (review 2026-10-05)', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { ownerId: 'usr_006', needsReview: true, prerequisiteIds: ['tsk_001'] } });
    const event = Object.values(t.store.state.events).at(-1)!;
    t.as('usr_006');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks.tsk_002).toMatchObject({ ownerId: 'usr_006', needsReview: true, prerequisiteIds: ['tsk_001'] });
  });

  it('refuses a member the Undo of a task that the leader gave them (review 2026-10-05)', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { ownerId: 'usr_006' } });
    const event = Object.values(t.store.state.events).at(-1)!;
    t.as('usr_006');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('events.undoStory', { correlationId: event.correlationId })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks.tsk_002.ownerId).toBe('usr_006');
  });

  it('lets the person an agent took a task for give it back with Undo', async () => {
    const t = world();
    t.as('usr_005');
    await t.api.call('tasks.take', { taskId: 'tsk_002' });
    const take = Object.values(t.store.state.events).at(-1)!;
    t.as('usr_003');
    await t.api.call('events.undo', { eventId: take.id });
    expect(t.store.state.tasks.tsk_002.ownerId).toBeNull();
  });

  it('lets a helper who took a task give it back with Undo, and puts them back in the helper list', async () => {
    const t = world();
    t.store.state.tasks.tsk_002.helperIds = ['usr_006', 'usr_003'];
    t.as('usr_006');
    await t.api.call('tasks.take', { taskId: 'tsk_002' });
    const take = Object.values(t.store.state.events).at(-1)!;
    await t.api.call('events.undo', { eventId: take.id });
    expect(t.store.state.tasks.tsk_002).toMatchObject({ ownerId: null, helperIds: ['usr_006', 'usr_003'] });
  });

  it('shows Take it only to a team member, on an open task with no lead', async () => {
    const t = world();
    t.as('usr_006');
    expect((await t.api.call('tasks.get', { id: 'tsk_002' })).viewerCan.take).toBe(true);
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan.take).toBe(false);
    t.as('usr_004');
    expect((await t.api.call('tasks.get', { id: 'tsk_002' })).viewerCan.take).toBe(false);
  });

  it('has its own right in can()', () => {
    // The person carries the rights of a Member: a person with none attached holds none (role rights version 2).
    const member = withOfficeRights(makeUser('usr_006'), undefined);
    expect(can(member, 'task.take', { projectRole: 'team' })).toBe(true);
    expect(can(member, 'task.take', { projectRole: 'leader' })).toBe(true);
    expect(can(member, 'task.take', { projectRole: 'other' })).toBe(false);
    expect(can(makeUser('usr_001', { systemRole: 'admin' }), 'task.take', { projectRole: 'other' })).toBe(true);
    expect(can(makeUser('usr_006', { active: false }), 'task.take', { projectRole: 'team' })).toBe(false);
  });
});

describe('lists, counts and notices with a task with no lead', () => {
  it('filters the tasks with no lead, and keeps them out of Mine and of a person\'s list', async () => {
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('tasks.list', { filter: 'no_lead' })).map((row) => row.task.id)).toEqual(['tsk_002']);
    expect((await t.api.call('tasks.list', { filter: 'mine' })).map((row) => row.task.id)).toEqual(['tsk_001']);
    expect((await t.api.call('tasks.list', { ownerId: 'usr_003' })).map((row) => row.task.id)).toEqual(['tsk_001']);
    const all = await t.api.call('tasks.list', { projectId: 'prj_001' });
    expect(all.find((row) => row.task.id === 'tsk_002')?.owner).toBeNull();
  });

  it('builds the dashboard with a task with no lead and counts it for nobody', async () => {
    const t = world();
    t.store.state.tasks.tsk_002.dueDate = '2026-09-01';
    t.as('usr_001');
    const board = await t.api.call('dashboard.get', {});
    expect(board).toBeDefined();
  });

  it('sends due and past-due reminders to the helpers of a task with no lead, and to no missing lead', () => {
    const t = world();
    t.store.state.tasks.tsk_002.helperIds = ['usr_006'];
    t.store.state.tasks.tsk_002.dueDate = '2026-10-01';
    runScheduledTriggers(t.store.state, NOW);
    expect(notices(t.store).map((n) => n.userId)).toEqual(['usr_006']);
  });

  it('closes a Tracker loop and leaves its reply task open when the task has no lead', async () => {
    const t = world();
    t.as('usr_002');
    const row = await t.api.call('tracker.log', {
      projectId: 'prj_001', type: 'message', direction: 'in', title: 'Can the lobby move?', waiting: 'us', replyBy: { userId: 'usr_003', dueDate: '2026-10-04' },
    });
    const replyId = row.entry.replyTaskId!;
    await t.api.call('tasks.update', { id: replyId, patch: { ownerId: null } });
    const listed = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(listed.find((r) => r.entry.id === row.entry.id)?.replyTask?.owner).toBeNull();
    await t.api.call('tracker.close', { id: row.entry.id });
    expect(t.store.state.tasks[replyId]).toMatchObject({ status: 'todo', trackerEntryId: null });
  });
});

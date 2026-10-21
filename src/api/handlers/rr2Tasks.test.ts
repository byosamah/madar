import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { taskCalls } from './tasks';
import type { RoleSettings } from '../contract/entities';
import { without as off, withExtra as extra } from '../../test/rr2work';
import { memberKey } from '../store';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The to-do gates of role rights version 2 (design 5.2). For each switch: on passes, off refuses, the scope (the lead or maker of the
 * to-do, the leader of the project, every project), and the agent of a person without the switch is refused.
 * People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member (Member role), usr_004 outside the team, usr_005 agent of usr_003,
 * usr_006 team member with no part in the to-dos below.
 */
const calls = { ...taskCalls, ...historyCalls };

function world(roles?: RoleSettings) {
  const t = testApi(calls);
  const { state } = t.store;
  state.users.usr_006 = makeUser('usr_006', { name: 'Third Member' });
  state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  // tsk_001: led by usr_003, made by usr_002 (the leader). tsk_002: made by usr_003, led by usr_006. tsk_003: made by usr_003, no lead.
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', createdBy: 'usr_002', checklist: [{ id: 'chk_1', text: 'One', done: false }] });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_006', createdBy: 'usr_003', helperIds: ['usr_004'] });
  state.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: null, createdBy: 'usr_003' });
  state.counters.tsk = 3;
  if (roles) state.settings.roles = roles;
  return t;
}


describe('task.dates: the start date, the due date and the schedule', () => {
  it('lets the lead change the dates with the switch on', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-12' } });
    expect(t.store.state.tasks.tsk_001.dueDate).toBe('2026-10-12');
  });

  it('refuses the dates with the switch off, and still lets the lead change the title', async () => {
    const t = world(off('task.dates'));
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-12' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-01', schedule: 'static' } })).rejects.toMatchObject({ code: 'forbidden' });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'New title' } });
    expect(t.store.state.tasks.tsk_001.title).toBe('New title');
  });

  it('refuses a person who neither leads nor made the to-do, with the switch on', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { title: 'Other', dueDate: '2026-10-12' } })).resolves.toBeTruthy();
    // usr_003 made tsk_002, so the maker passes. A third team member who made nothing and leads nothing does not.
    t.as('usr_006');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-13' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the agent of a person without the switch', async () => {
    const t = world(off('task.dates'));
    t.as('usr_005');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-12' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
  });

  it('lets the leader change the dates of a to-do the leader neither leads nor made, through the lead scope of task.any', async () => {
    const t = world(off('task.dates'));
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { dueDate: '2026-10-14' } });
    expect(t.store.state.tasks.tsk_002.dueDate).toBe('2026-10-14');
  });

  it('refuses the leader when task.any.lead is off, and an outsider passes with task.any.all', async () => {
    const t = world(off('task.any.lead', 'task.dates'));
    t.as('usr_002');
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { dueDate: '2026-10-14' } })).rejects.toMatchObject({ code: 'forbidden' });
    const all = world(extra('task.any.all'));
    all.as('usr_004');
    await all.api.call('tasks.update', { id: 'tsk_002', patch: { dueDate: '2026-10-14' } });
    expect(all.store.state.tasks.tsk_002.dueDate).toBe('2026-10-14');
  });
});

describe('task.details: the title, the description, the checklist, the stage and the flag', () => {
  it('passes with the switch on and refuses each field with it off', async () => {
    const on = world();
    on.as('usr_003');
    await on.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'A', description: 'B', flagged: true, stageId: 'stg_001' }, reason: 'Back to concept' });
    expect(on.store.state.tasks.tsk_001).toMatchObject({ title: 'A', description: 'B', flagged: true, stageId: 'stg_001' });
    const t = world(off('task.details'));
    t.as('usr_003');
    for (const patch of [{ title: 'A' }, { description: 'B' }, { flagged: true }, { stageId: 'stg_001' }, { checklist: [{ id: 'chk_1', text: 'One', done: false }, { id: 'chk_2', text: 'Two', done: false }] }]) {
      await expect(t.api.call('tasks.update', { id: 'tsk_001', patch })).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('keeps the dates of the lead open when only the details are off', async () => {
    const t = world(off('task.details'));
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-12' } });
    expect(t.store.state.tasks.tsk_001.dueDate).toBe('2026-10-12');
  });

  it('refuses the agent of a person without the switch', async () => {
    const t = world(off('task.details'));
    t.as('usr_005');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'A' } })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('task.work: ticks, complete, move, arrange and a new version', () => {
  it('lets the lead tick, complete, move and arrange with the switch on', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [{ id: 'chk_1', text: 'One', done: true }] } });
    await t.api.call('tasks.arrange', { ids: ['tsk_001'] });
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'in_progress' });
    expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('in_review');
  });

  it('refuses each of them with the switch off', async () => {
    const t = world(off('task.work'));
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [{ id: 'chk_1', text: 'One', done: true }] } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.arrange', { ids: ['tsk_001'] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'in_progress' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.complete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a new version with the switch off, and allows it with the switch on', async () => {
    const closed = world(off('task.work'));
    closed.store.state.tasks.tsk_001.status = 'done';
    closed.as('usr_003');
    await expect(closed.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'More work' })).rejects.toMatchObject({ code: 'forbidden' });
    const open = world();
    open.store.state.tasks.tsk_001.status = 'done';
    open.as('usr_003');
    await open.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'More work' });
    expect(open.store.state.tasks.tsk_001.status).toBe('todo');
  });

  it('lets a helper tick with the switch on and refuses a helper with it off', async () => {
    const on = world();
    on.store.state.tasks.tsk_001.helperIds = ['usr_006'];
    on.as('usr_006');
    await on.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [{ id: 'chk_1', text: 'One', done: true }] } });
    expect(on.store.state.tasks.tsk_001.checklist[0].done).toBe(true);
    // A helper changes no item.
    await expect(on.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [{ id: 'chk_1', text: 'Renamed', done: true }] } })).rejects.toMatchObject({ code: 'forbidden' });
    const closed = world(off('task.work'));
    closed.store.state.tasks.tsk_001.helperIds = ['usr_006'];
    closed.as('usr_006');
    await expect(closed.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [{ id: 'chk_1', text: 'One', done: true }] } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a person who is no lead, maker or helper, with the switch on', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('tasks.complete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'in_progress' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the agent of a person without the switch', async () => {
    const t = world(off('task.work'));
    t.as('usr_005');
    await expect(t.api.call('tasks.complete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('task.assign: the lead and the helpers', () => {
  it('lets the maker name a lead and helpers with the switch on, and refuses with it off', async () => {
    const on = world();
    on.as('usr_003');
    await on.api.call('tasks.update', { id: 'tsk_002', patch: { ownerId: 'usr_002', helperIds: ['usr_006'] } });
    expect(on.store.state.tasks.tsk_002).toMatchObject({ ownerId: 'usr_002', helperIds: ['usr_006'] });
    const t = world(off('task.assign'));
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { ownerId: 'usr_002' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { helperIds: ['usr_002'] } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a lead who did not make the to-do', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_006' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader name people through task.any, also with task.assign off', async () => {
    const t = world(off('task.assign'));
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { ownerId: 'usr_003' } });
    expect(t.store.state.tasks.tsk_002.ownerId).toBe('usr_003');
  });

  it('refuses the agent of a person without the switch', async () => {
    const t = world(off('task.assign'));
    t.as('usr_005');
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { ownerId: 'usr_002' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('needs the switch for the helpers of a new to-do, as for its lead', async () => {
    const t = world(off('task.assign'));
    t.as('usr_003');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'With helper', helperIds: ['usr_006'] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'With lead', ownerId: 'usr_006' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.create', { title: 'Office with helper', helperIds: ['usr_006'] })).rejects.toMatchObject({ code: 'forbidden' });
    // A to-do for yourself needs only the switch to add one.
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Mine', ownerId: 'usr_003' });
    expect(made.task.ownerId).toBe('usr_003');
    const on = world();
    on.as('usr_003');
    expect((await on.api.call('tasks.create', { projectId: 'prj_001', title: 'With helper', helperIds: ['usr_006'] })).task.helperIds).toEqual(['usr_006']);
  });
});

describe('the waits of a to-do (prerequisiteIds) keep their rule of before', () => {
  it('lets the maker change them with task.details, and refuses the lead who did not make the to-do', async () => {
    const t = world();
    t.as('usr_003');
    // usr_003 made tsk_003 and leads tsk_001 (made by the leader).
    await t.api.call('tasks.update', { id: 'tsk_003', patch: { prerequisiteIds: ['tsk_001'] } });
    expect(t.store.state.tasks.tsk_003.prerequisiteIds).toEqual(['tsk_001']);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { prerequisiteIds: ['tsk_003'] } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the maker with task.details off, and the agent too', async () => {
    const t = world(off('task.details'));
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_003', patch: { prerequisiteIds: ['tsk_001'] } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('tasks.update', { id: 'tsk_003', patch: { prerequisiteIds: ['tsk_001'] } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader change them through task.any', async () => {
    const t = world(off('task.details'));
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_003', patch: { prerequisiteIds: ['tsk_001'] } });
    expect(t.store.state.tasks.tsk_003.prerequisiteIds).toEqual(['tsk_001']);
  });
});

describe('task.deleteOwn: the delete of a to-do', () => {
  it('lets the maker and the lead delete with the switch on, and refuses both with it off', async () => {
    const on = world();
    on.as('usr_003');
    await on.api.call('tasks.delete', { id: 'tsk_003' });
    await on.api.call('tasks.delete', { id: 'tsk_001' });
    expect(on.store.state.tasks.tsk_003).toBeUndefined();
    const t = world(off('task.deleteOwn'));
    t.as('usr_003');
    await expect(t.api.call('tasks.delete', { id: 'tsk_003' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.delete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a person who is not the maker or the lead, and the agent of a person without the switch', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('tasks.delete', { id: 'tsk_003' })).rejects.toMatchObject({ code: 'forbidden' });
    const closed = world(off('task.deleteOwn'));
    closed.as('usr_005');
    await expect(closed.api.call('tasks.delete', { id: 'tsk_003' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader delete through task.any, also with the switch off', async () => {
    const t = world(off('task.deleteOwn'));
    t.as('usr_002');
    await t.api.call('tasks.delete', { id: 'tsk_003' });
    expect(t.store.state.tasks.tsk_003).toBeUndefined();
  });

  it('still refuses a lead who took the to-do, and lets its maker delete', async () => {
    const t = world();
    t.as('usr_006');
    await t.api.call('tasks.take', { taskId: 'tsk_003' });
    await expect(t.api.call('tasks.delete', { id: 'tsk_003' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('tasks.delete', { id: 'tsk_003' });
    expect(t.store.state.tasks.tsk_003).toBeUndefined();
  });
});

describe('task.add: a new to-do', () => {
  it('follows the team scope for a project and the office switch for an office to-do', async () => {
    const t = world(off('task.add.team'));
    t.as('usr_003');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Nope' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tasks.create', { title: 'Office one' })).task.projectId).toBeNull();
    const closed = world(off('task.add.office'));
    closed.as('usr_003');
    await expect(closed.api.call('tasks.create', { title: 'Office one' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await closed.api.call('tasks.create', { projectId: 'prj_001', title: 'Team one' })).task.projectId).toBe('prj_001');
  });

  it('keeps an outsider out of the project, and lets task.add.all open it', async () => {
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Outside' })).rejects.toMatchObject({ code: 'forbidden' });
    const all = world(extra('task.add.all'));
    all.as('usr_004');
    expect((await all.api.call('tasks.create', { projectId: 'prj_001', title: 'Outside' })).task.projectId).toBe('prj_001');
  });

  it('refuses the agent of a person without the switch', async () => {
    const t = world(off('task.add.team'));
    t.as('usr_005');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Agent' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the flags of a to-do follow the same gates', () => {
  it('tells the lead which kinds of change the switches allow', async () => {
    const t = world(off('task.dates', 'task.work'));
    t.as('usr_003');
    const flags = (await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan;
    expect(flags).toMatchObject({ editDetails: true, editDates: false, work: false, complete: false, contribute: false, edit: false });
  });
});

describe('a checklist change that adds or renames items AND ticks needs task.work too (security review of the gates-work commit)', () => {
  it('refuses a patch that adds an item and ticks another one when task.work is off', async () => {
    const t = world(off('task.work'));
    t.as('usr_003');
    const patch = { checklist: [{ id: 'chk_1', text: 'One', done: true }, { id: 'chk_2', text: 'Two', done: false }] };
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks.tsk_001.checklist).toHaveLength(1);
  });

  it('refuses a new item that arrives already ticked when task.work is off', async () => {
    const t = world(off('task.work'));
    t.as('usr_003');
    const patch = { checklist: [{ id: 'chk_1', text: 'One', done: false }, { id: 'chk_2', text: 'Two', done: true }] };
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the lead add an item with no tick when task.work is off', async () => {
    const t = world(off('task.work'));
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [{ id: 'chk_1', text: 'One', done: false }, { id: 'chk_2', text: 'Two', done: false }] } });
    expect(t.store.state.tasks.tsk_001.checklist).toHaveLength(2);
  });

  it('lets the lead add an item and tick another one with both switches on', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [{ id: 'chk_1', text: 'One', done: true }, { id: 'chk_2', text: 'Two', done: false }] } });
    expect(t.store.state.tasks.tsk_001.checklist[0].done).toBe(true);
  });
});

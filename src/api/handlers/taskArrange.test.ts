import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { taskCalls } from './tasks';
import { memberKey, type Store } from '../store';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { arranged } from '../../lib/arrange';

beforeEach(() => setNow(NOW));
const calls = { ...taskCalls, ...historyCalls };

// Faisal (usr_002) leads prj_001. Sara (usr_003) is on the team and leads tsk_001 to tsk_003. Omar (usr_004) is not on the team.
// Madar Assistant (usr_005) is Sara's agent. Hala (usr_001) is the Admin.
function world() {
  const t = testApi(calls);
  const s = t.store.state;
  s.tasks.tsk_001 = makeTask({ id: 'tsk_001', title: 'Roof plan', dueDate: '2026-09-30' });
  s.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Sections', dueDate: '2026-09-30' });
  s.tasks.tsk_003 = makeTask({ id: 'tsk_003', title: 'Facade', dueDate: '2026-09-30', helperIds: ['usr_002'] });
  s.counters.tsk = 3;
  t.as('usr_003');
  return t;
}
const arrangedEvents = (store: Store) => Object.values(store.state.events).filter((event) => event.verb === 'task.arranged' && !event.undoneBy);
const ranks = (store: Store) => ['tsk_001', 'tsk_002', 'tsk_003'].map((id) => store.state.tasks[id].rank);

describe('the shared order of tasks (owner, 2026-10-07)', () => {
  it('puts the lead\'s tasks in the order given, and changes only the place numbers', async () => {
    const t = world();
    const before = structuredClone(t.store.state.tasks.tsk_003);
    await t.api.call('tasks.arrange', { ids: ['tsk_003', 'tsk_001', 'tsk_002'], moved: 'tsk_003' });
    const [r1, r2, r3] = ranks(t.store);
    expect(r3! < r1! && r1! < r2!).toBe(true);
    // The first order gives each task its first place, one change for each task.
    expect(arrangedEvents(t.store)).toHaveLength(3);
    const { rank, ...rest } = t.store.state.tasks.tsk_003;
    expect(rank).toBeTypeOf('number');
    expect(rest).toEqual(before);
    expect(Object.values(t.store.state.notifications)).toHaveLength(0);
  });

  it('changes one task when the person moves one task in an order that has places', async () => {
    const t = world();
    await t.api.call('tasks.arrange', { ids: ['tsk_001', 'tsk_002', 'tsk_003'] });
    const first = arrangedEvents(t.store).length;
    await t.api.call('tasks.arrange', { ids: ['tsk_001', 'tsk_003', 'tsk_002'], moved: 'tsk_003' });
    const events = arrangedEvents(t.store);
    expect(events).toHaveLength(first + 1);
    expect(events.at(-1)?.targetId).toBe('tsk_003');
  });

  it('shows the same order to every person who sees the tasks', async () => {
    const t = world();
    await t.api.call('tasks.arrange', { ids: ['tsk_003', 'tsk_002', 'tsk_001'] });
    const sara = arranged(await t.api.call('tasks.list', { filter: 'mine', includeDone: false })).map((row) => row.task.id);
    t.as('usr_002');
    const faisal = arranged(await t.api.call('tasks.list', { projectId: 'prj_001' })).map((row) => row.task.id);
    expect(sara).toEqual(['tsk_003', 'tsk_002', 'tsk_001']);
    expect(faisal).toEqual(sara);
  });

  it('lets the leader, the Admin and the agent of the lead arrange, and nobody else', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.arrange', { ids: ['tsk_002', 'tsk_001'] });
    t.as('usr_001');
    await t.api.call('tasks.arrange', { ids: ['tsk_001', 'tsk_002'] });
    t.as('usr_005');
    await t.api.call('tasks.arrange', { ids: ['tsk_002', 'tsk_001'] });
    // A team member who only helps, and a person outside the team, may not change the place of another person's task.
    t.store.state.members[memberKey('prj_001', 'usr_004')] = { projectId: 'prj_001', userId: 'usr_004', discipline: 'Architect' };
    t.store.state.tasks.tsk_003.helperIds = ['usr_004'];
    t.as('usr_004');
    await expect(t.api.call('tasks.arrange', { ids: ['tsk_003'] })).rejects.toMatchObject({ code: 'forbidden' });
    delete t.store.state.members[memberKey('prj_001', 'usr_004')];
    await expect(t.api.call('tasks.arrange', { ids: ['tsk_001'] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the whole order when one task is not the person\'s to move', async () => {
    const t = world();
    t.store.state.tasks.tsk_004 = makeTask({ id: 'tsk_004', ownerId: 'usr_002', title: 'Leader work' });
    await expect(t.api.call('tasks.arrange', { ids: ['tsk_001', 'tsk_004'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks.tsk_001.rank).toBeUndefined();
  });

  it('answers not found for an office task the person does not see', async () => {
    const t = world();
    t.store.state.tasks.tsk_009 = makeTask({ id: 'tsk_009', projectId: null, stageId: null, ownerId: 'usr_002', createdBy: 'usr_002', title: 'Private' });
    await expect(t.api.call('tasks.arrange', { ids: ['tsk_009'] })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a task named twice, and a moved task that is not in the list', async () => {
    const t = world();
    await expect(t.api.call('tasks.arrange', { ids: ['tsk_001', 'tsk_001'] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tasks.arrange', { ids: ['tsk_001'], moved: 'tsk_002' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('takes back one move with Undo, and a whole first order with the Undo of its story', async () => {
    const t = world();
    await t.api.call('tasks.arrange', { ids: ['tsk_001', 'tsk_002', 'tsk_003'] }, { correlationId: 'cor_first' });
    const placed = ranks(t.store);
    await t.api.call('tasks.arrange', { ids: ['tsk_003', 'tsk_001', 'tsk_002'], moved: 'tsk_003' });
    await t.api.call('events.undo', { eventId: arrangedEvents(t.store).at(-1)!.id });
    expect(ranks(t.store)).toEqual(placed);
    await t.api.call('events.undoStory', { correlationId: 'cor_first' });
    expect(ranks(t.store)).toEqual([null, null, null]);
  });
});

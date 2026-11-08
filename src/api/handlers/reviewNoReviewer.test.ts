import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { memberKey } from '../store';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A hand move to In review by a person for whom nobody can review (tsk_692, owner decision 2026-11-08, "Refuse the move").
 * People: usr_001 Hala, Admin. usr_002 Faisal, leader of prj_001. usr_003 Sara, on the team of prj_001. usr_004 Omar, on no project.
 * usr_005 is the agent of Sara. usr_006 Nour, a Member. usr_007 is the agent of Omar.
 */
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Omar Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_004' });
  state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  state.counters.usr = 7;
  return t;
}
type T = ReturnType<typeof world>;

let next = 700;
const add = (t: T, o: Partial<Parameters<typeof makeTask>[0]>) => {
  next += 1;
  const id = `tsk_${next}`;
  t.store.state.tasks[id] = makeTask({ id, status: 'in_progress', needsReview: true, ...o });
  t.store.state.counters.tsk = next;
  return id;
};
const office = (t: T, o: Partial<Parameters<typeof makeTask>[0]> = {}) => add(t, { projectId: null, stageId: null, createdBy: 'usr_004', ownerId: 'usr_001', helperIds: [], ...o });
const noticesFor = (t: T, userId: string) => Object.values(t.store.state.notifications).filter((n) => n.userId === userId && n.trigger === 'review_requested');
const refused = { code: 'invalid_input', details: { reason: 'no_reviewer', fields: ['status'] } };

describe('a move to In review that nobody could review', () => {
  it('refuses the project leader who leads the to-do, and leaves the to-do as it was', async () => {
    const t = world();
    const id = add(t, { ownerId: 'usr_002', createdBy: 'usr_003', helperIds: [] });
    t.as('usr_002');
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject(refused);
    expect(t.store.state.tasks[id].status).toBe('in_progress');
    expect(t.store.state.tasks[id].reviewSentBy ?? null).toBeNull();
    expect(Object.values(t.store.state.notifications).filter((n) => n.trigger === 'review_requested')).toHaveLength(0);
  });

  it('refuses the maker who leads an office to-do', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_004', createdBy: 'usr_004' });
    t.as('usr_004');
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject(refused);
    expect(t.store.state.tasks[id].status).toBe('in_progress');
  });

  it('refuses the agent of the maker the same way, because the sender is the person behind the agent', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_004', createdBy: 'usr_007' });
    t.as('usr_007');
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject(refused);
    expect(t.store.state.tasks[id].status).toBe('in_progress');
  });

  it('refuses an Admin who leads an office to-do whose maker left the office (the Admin is the only one left)', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_001', createdBy: 'usr_006' });
    t.store.state.users.usr_006.active = false;
    t.as('usr_001');
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject(refused);
    expect(t.store.state.tasks[id].status).toBe('in_progress');
  });

  it('still lets the same person mark the to-do Done', async () => {
    const t = world();
    const id = add(t, { ownerId: 'usr_002', createdBy: 'usr_003', helperIds: [] });
    t.as('usr_002');
    expect((await t.api.call('tasks.move', { id, status: 'done' })).result).toBe('done');
    const mine = office(t, { ownerId: 'usr_004', createdBy: 'usr_004' });
    t.as('usr_004');
    expect((await t.api.call('tasks.complete', { id: mine })).result).toBe('done');
  });

  it('keeps the old path for a to-do that needs no review', async () => {
    const t = world();
    const id = add(t, { ownerId: 'usr_002', createdBy: 'usr_003', helperIds: [], needsReview: false });
    t.as('usr_002');
    expect((await t.api.call('tasks.move', { id, status: 'in_review' })).result).toBe('in_review');
  });

  it('lets a lead move to In review when another person can review, and that person gets the notice', async () => {
    const t = world();
    const mine = add(t, { ownerId: 'usr_003', createdBy: 'usr_003', helperIds: [] });
    t.as('usr_003');
    expect((await t.api.call('tasks.move', { id: mine, status: 'in_review' })).result).toBe('in_review');
    expect(noticesFor(t, 'usr_002')).toHaveLength(1);
    const theirs = office(t, { ownerId: 'usr_003', createdBy: 'usr_004' });
    t.as('usr_003');
    expect((await t.api.call('tasks.move', { id: theirs, status: 'in_review' })).result).toBe('in_review');
    expect(noticesFor(t, 'usr_004')).toHaveLength(1);
  });

  it('does not refuse a to-do that is already in review (a move to the same status changes nothing)', async () => {
    const t = world();
    const id = add(t, { ownerId: 'usr_003', createdBy: 'usr_003', helperIds: [], status: 'in_review', reviewSentBy: 'usr_003' });
    t.as('usr_003');
    expect((await t.api.call('tasks.move', { id, status: 'in_review' })).result).toBe('in_review');
  });
});

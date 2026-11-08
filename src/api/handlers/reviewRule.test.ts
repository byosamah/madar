import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { reviewersAfterSend, reviewersOfTask } from '../notify';
import { memberKey, type State, type Store } from '../store';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import { without } from '../../test/rr2work';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Who reviews a to-do (fbk_087, owner 2026-11-08). The person who does the work never approves it.
 * People: usr_001 Hala, Admin. usr_002 Faisal, leader of prj_001. usr_003 Sara, on the team of prj_001. usr_004 Omar, on no project.
 * usr_005 is the agent of Sara. usr_006 Nour, a Member. usr_007 is the agent of Omar. usr_008 Tarek, on the team of prj_001.
 */
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Omar Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_004' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Tarek Team' });
  for (const userId of ['usr_006', 'usr_008']) state.members[memberKey('prj_001', userId)] = { projectId: 'prj_001', userId, discipline: 'Architect' };
  state.counters.usr = 8;
  return t;
}

type T = ReturnType<typeof world>;

let next = 600;
/** An office to-do. By default Omar's agent made it, Hala leads it, Omar helps, and it waits in progress (the case of tsk_624). */
function office(t: T, o: Partial<Parameters<typeof makeTask>[0]> = {}) {
  next += 1;
  const id = `tsk_${next}`;
  t.store.state.tasks[id] = makeTask({
    id, projectId: null, stageId: null, createdBy: 'usr_007', ownerId: 'usr_001', helperIds: ['usr_004'], status: 'in_progress', needsReview: true, ...o,
  });
  t.store.state.counters.tsk = next;
  return id;
}

/** A to-do of prj_001. By default Faisal (the leader) made it and Sara leads it. */
function project(t: T, o: Partial<Parameters<typeof makeTask>[0]> = {}) {
  next += 1;
  const id = `tsk_${next}`;
  t.store.state.tasks[id] = makeTask({ id, status: 'in_progress', needsReview: true, ...o });
  t.store.state.counters.tsk = next;
  return id;
}

const notices = (store: Store, userId: string, trigger = 'review_requested') =>
  Object.values(store.state.notifications).filter((n) => n.userId === userId && n.trigger === trigger);
const reviewList = async (t: T, who: string) => { t.as(who); return (await t.api.call('tasks.list', { filter: 'review_for_me' })).map((row) => row.task.id); };
const status = (t: T, id: string) => t.store.state.tasks[id].status;

describe('reviewersAfterSend: who reviews a to-do that a person sent to review', () => {
  it('names the lead when the sender is not the lead: a helper, the maker, or anyone else', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t);
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_004')).toEqual(['usr_001']);
    const mine = project(t, { ownerId: 'usr_003', createdBy: 'usr_008', helperIds: ['usr_006'] });
    expect(reviewersAfterSend(state, state.tasks[mine], 'usr_006')).toEqual(['usr_003']);
    expect(reviewersAfterSend(state, state.tasks[mine], 'usr_008')).toEqual(['usr_003']);
    expect(reviewersAfterSend(state, state.tasks[mine], 'usr_001')).toEqual(['usr_003']);
  });

  it('names the project leader when the lead of a project to-do sends it, never the Admin and never the maker', () => {
    const t = world();
    const state = t.store.state;
    const id = project(t, { ownerId: 'usr_003', createdBy: 'usr_008' });
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_003')).toEqual(['usr_002']);
  });

  it('names nobody when the lead of a project to-do is the project leader', () => {
    const t = world();
    const state = t.store.state;
    const id = project(t, { ownerId: 'usr_002' });
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_002')).toEqual([]);
  });

  it('names the active Admins when the project has no active leader, except the sender', () => {
    const t = world();
    const state = t.store.state;
    const id = project(t, { ownerId: 'usr_003' });
    state.users.usr_002.active = false;
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_003')).toEqual(['usr_001']);
    const adminLead = project(t, { ownerId: 'usr_001' });
    expect(reviewersAfterSend(state, state.tasks[adminLead], 'usr_001')).toEqual([]);
  });

  it('names the maker when the lead of an office to-do sends it, and the person behind an agent maker', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t, { ownerId: 'usr_003', createdBy: 'usr_007' });
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_003')).toEqual(['usr_004']);
    const direct = office(t, { ownerId: 'usr_003', createdBy: 'usr_006' });
    expect(reviewersAfterSend(state, state.tasks[direct], 'usr_003')).toEqual(['usr_006']);
  });

  it('names nobody when the maker leads an office to-do', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t, { ownerId: 'usr_004', createdBy: 'usr_007', helperIds: [] });
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_004')).toEqual([]);
  });

  it('names the active Admins when the maker left the office, except the sender', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t, { ownerId: 'usr_003', createdBy: 'usr_006' });
    state.users.usr_006.active = false;
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_003')).toEqual(['usr_001']);
    const adminLead = office(t, { ownerId: 'usr_001', createdBy: 'usr_006' });
    expect(reviewersAfterSend(state, state.tasks[adminLead], 'usr_001')).toEqual([]);
  });

  it('names the active Admins when the lead left the office and a helper sends', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t, { ownerId: 'usr_003', helperIds: ['usr_006'] });
    state.users.usr_003.active = false;
    expect(reviewersAfterSend(state, state.tasks[id], 'usr_006')).toEqual(['usr_001']);
  });
});

describe('reviewersOfTask: the stored sender, and the old rule while there is none', () => {
  it('reads the stored sender of a to-do in review', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t, { status: 'in_review', reviewSentBy: 'usr_004' });
    expect(reviewersOfTask(state, state.tasks[id])).toEqual(['usr_001']);
    const lead = office(t, { status: 'in_review', reviewSentBy: 'usr_001' });
    expect(reviewersOfTask(state, state.tasks[lead])).toEqual(['usr_004']);
  });

  it('keeps the old rule for a to-do in review with no stored sender, such as tsk_624 today', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t, { status: 'in_review' });
    expect(reviewersOfTask(state, state.tasks[id])).toEqual(['usr_004']);
    const inProject = project(t, { status: 'in_review' });
    expect(reviewersOfTask(state, state.tasks[inProject])).toEqual(['usr_002']);
  });

  it('reads the stored sender only while the to-do is in review', () => {
    const t = world();
    const state = t.store.state;
    const id = office(t, { status: 'in_progress', reviewSentBy: 'usr_004' });
    expect(reviewersOfTask(state, state.tasks[id])).toEqual(['usr_004']);
  });
});

describe('a tick by the person who does the work (rule 3)', () => {
  it('sends the tick of a helper who is also the maker to the lead, who gets the notice (the case of tsk_624)', async () => {
    const t = world();
    const id = office(t);
    t.as('usr_007');
    const out = await t.api.call('tasks.complete', { id });
    expect(out.result).toBe('in_review');
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_004');
    expect(notices(t.store, 'usr_001')).toHaveLength(1);
    expect(notices(t.store, 'usr_004')).toHaveLength(0);
    expect(await reviewList(t, 'usr_001')).toEqual([id]);
    expect(await reviewList(t, 'usr_004')).toEqual([]);
  });

  it('sends the tick of an Admin who leads an office to-do to the maker', async () => {
    const t = world();
    const id = office(t, { helperIds: [] });
    t.as('usr_001');
    expect((await t.api.call('tasks.complete', { id })).result).toBe('in_review');
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_001');
    expect(notices(t.store, 'usr_004')).toHaveLength(1);
    expect(await reviewList(t, 'usr_004')).toEqual([id]);
    expect(await reviewList(t, 'usr_001')).toEqual([]);
  });

  it('sends the tick of the lead of a project to-do to the project leader', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_008', createdBy: 'usr_003' });
    t.as('usr_008');
    expect((await t.api.call('tasks.complete', { id })).result).toBe('in_review');
    expect(notices(t.store, 'usr_002')).toHaveLength(1);
    expect(notices(t.store, 'usr_001')).toHaveLength(0);
    expect(notices(t.store, 'usr_003')).toHaveLength(0);
  });

  it('lands the tick of the project leader on a to-do of another person on Done', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_008' });
    t.as('usr_002');
    const out = await t.api.call('tasks.complete', { id });
    expect(out.result).toBe('done');
    expect(status(t, id)).toBe('done');
    expect(t.store.state.tasks[id].reviewSentBy ?? null).toBeNull();
  });

  it('lands the tick of the project leader who leads the to-do on Done', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_002' });
    t.as('usr_002');
    expect((await t.api.call('tasks.complete', { id })).result).toBe('done');
  });

  it('lands the tick of an Admin who does not work on the to-do on Done, as an approval', async () => {
    const t = world();
    const inProject = project(t, { ownerId: 'usr_008' });
    const inOffice = office(t, { ownerId: 'usr_003', helperIds: [] });
    t.as('usr_001');
    expect((await t.api.call('tasks.complete', { id: inProject })).result).toBe('done');
    expect((await t.api.call('tasks.complete', { id: inOffice })).result).toBe('done');
  });

  it('lands the tick of the maker who does not work on an office to-do on Done', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_003', helperIds: [] });
    t.as('usr_004');
    expect((await t.api.call('tasks.complete', { id })).result).toBe('done');
  });

  it('sends the tick of a team member who made the to-do of the lead to the lead', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_003', createdBy: 'usr_008' });
    t.as('usr_008');
    expect((await t.api.call('tasks.complete', { id })).result).toBe('in_review');
    expect(notices(t.store, 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'usr_002')).toHaveLength(0);
  });

  it('lands the tick on Done when the sender is the only person who could review, and when the to-do needs no review', async () => {
    const t = world();
    const adminLead = office(t, { ownerId: 'usr_001', createdBy: 'usr_006', helperIds: [] });
    t.store.state.users.usr_006.active = false;
    t.as('usr_001');
    expect((await t.api.call('tasks.complete', { id: adminLead })).result).toBe('done');
    const free = office(t, { ownerId: 'usr_003', helperIds: [], needsReview: false });
    t.as('usr_003');
    expect((await t.api.call('tasks.complete', { id: free })).result).toBe('done');
  });

  it('treats the agent of a person as that person: the sender is the person, not the agent', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_003', createdBy: 'usr_006', helperIds: [] });
    t.as('usr_005');
    expect((await t.api.call('tasks.complete', { id })).result).toBe('in_review');
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_003');
    expect(notices(t.store, 'usr_006')).toHaveLength(1);
    t.as('usr_003');
    await expect(t.api.call('tasks.approve', { id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('tasks.approve', { id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('sends a hand move to In review to the same reviewer as a tick', async () => {
    const t = world();
    const id = office(t, { helperIds: [] });
    t.as('usr_004');
    expect((await t.api.call('tasks.move', { id, status: 'in_review' })).result).toBe('in_review');
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_004');
    expect(notices(t.store, 'usr_001')).toHaveLength(1);
  });
});

describe('who approves or sends back a to-do in review (rules 2 and 4)', () => {
  it('lets the named reviewer approve, also a Member on a project to-do, with no switch', async () => {
    const t = world();
    t.store.state.settings.roles = without('task.review.lead');
    const id = project(t, { ownerId: 'usr_003', createdBy: 'usr_008', helperIds: ['usr_006'] });
    t.as('usr_006');
    await t.api.call('tasks.move', { id, status: 'in_review' });
    t.as('usr_003');
    expect((await t.api.call('tasks.get', { id })).viewerCan.review).toBe(true);
    await expect(t.api.call('tasks.approve', { id })).resolves.toMatchObject({ task: { status: 'done' } });
    expect(notices(t.store, 'usr_006', 'task_approved')).toHaveLength(1);
  });

  it('lets the named reviewer send it back', async () => {
    const t = world();
    const id = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id });
    t.as('usr_001');
    await expect(t.api.call('tasks.sendBack', { id, note: 'Add the stamp' })).resolves.toMatchObject({ task: { status: 'in_progress' } });
    expect(t.store.state.tasks[id].reviewSentBy ?? null).toBeNull();
  });

  it('never lets the sender approve or send back, also an Admin and also the project leader', async () => {
    const t = world();
    const office1 = office(t, { helperIds: [] });
    t.as('usr_001');
    await t.api.call('tasks.complete', { id: office1 });
    await expect(t.api.call('tasks.approve', { id: office1 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.sendBack', { id: office1, note: 'No' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tasks.get', { id: office1 })).viewerCan.review).toBe(false);
    // The Admin leads a project to-do and sends it: the Admin holds the review right of every project and still cannot approve.
    const inProject = project(t, { ownerId: 'usr_001' });
    await t.api.call('tasks.complete', { id: inProject });
    expect(notices(t.store, 'usr_002')).toHaveLength(1);
    await expect(t.api.call('tasks.approve', { id: inProject })).rejects.toMatchObject({ code: 'forbidden' });
    // The project leader sends a to-do that a helper made the lead of... the leader is the sender by hand and cannot approve it.
    const byLeader = project(t, { ownerId: 'usr_003' });
    t.as('usr_002');
    await t.api.call('tasks.move', { id: byLeader, status: 'in_review' });
    expect(t.store.state.tasks[byLeader].reviewSentBy).toBe('usr_002');
    await expect(t.api.call('tasks.approve', { id: byLeader })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps the sender out after a change of the lead during the review: the new lead reviews (security review 2026-11-08)', async () => {
    const t = world();
    const id = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id });
    expect(reviewersOfTask(t.store.state, t.store.state.tasks[id])).toEqual(['usr_001']);
    // Omar made the to-do, so he may name its lead. He names Nour while it waits for review.
    await t.api.call('tasks.update', { id, patch: { ownerId: 'usr_006' } });
    expect(reviewersOfTask(t.store.state, t.store.state.tasks[id])).toEqual(['usr_006']);
    await expect(t.api.call('tasks.approve', { id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.sendBack', { id, note: 'No' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_006');
    await expect(t.api.call('tasks.approve', { id })).resolves.toMatchObject({ task: { status: 'done' } });
  });

  it('refuses a tick of the sender on a to-do in review: it stays in review', async () => {
    const t = world();
    const id = office(t, { helperIds: [] });
    t.as('usr_001');
    await t.api.call('tasks.complete', { id });
    expect((await t.api.call('tasks.complete', { id })).result).toBe('in_review');
    expect(status(t, id)).toBe('in_review');
    await expect(t.api.call('tasks.move', { id, status: 'done' })).resolves.toMatchObject({ result: 'in_review' });
  });

  it('lets a holder of the review right approve as a backup, who gets no notice and no card', async () => {
    const t = world();
    // Sara leads, Omar made it: Sara sends, Omar reviews. Hala (task.officeAll) backs him up.
    const id = office(t, { ownerId: 'usr_003', helperIds: [] });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id });
    expect(notices(t.store, 'usr_001')).toHaveLength(0);
    expect(await reviewList(t, 'usr_001')).toEqual([]);
    t.as('usr_001');
    expect((await t.api.call('tasks.get', { id })).viewerCan.review).toBe(true);
    await expect(t.api.call('tasks.approve', { id })).resolves.toMatchObject({ task: { status: 'done' } });
    // The project backup: the Admin approves a project to-do that waits for the project leader.
    const inProject = project(t, { ownerId: 'usr_003' });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: inProject });
    expect(await reviewList(t, 'usr_001')).toEqual([]);
    t.as('usr_001');
    await expect(t.api.call('tasks.approve', { id: inProject })).resolves.toMatchObject({ task: { status: 'done' } });
  });

  it('keeps the maker out of the backup of an office to-do that waits for the lead', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_003', helperIds: ['usr_006'], createdBy: 'usr_004' });
    t.as('usr_006');
    await t.api.call('tasks.complete', { id });
    t.as('usr_004');
    await expect(t.api.call('tasks.approve', { id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await expect(t.api.call('tasks.approve', { id })).resolves.toMatchObject({ task: { status: 'done' } });
  });

  it('keeps the old gate for a to-do in review with no stored sender', async () => {
    const t = world();
    const id = office(t, { status: 'in_review', ownerId: 'usr_003', helperIds: [] });
    t.as('usr_001');
    expect((await t.api.call('tasks.get', { id })).viewerCan.review).toBe(true);
    t.as('usr_003');
    await expect(t.api.call('tasks.approve', { id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    await expect(t.api.call('tasks.approve', { id })).resolves.toMatchObject({ task: { status: 'done' } });
    expect(await reviewList(t, 'usr_001')).toEqual([]);
  });

  it('keeps the old reviewer in the lists while the stored sender is missing, then follows the new sender', async () => {
    const t = world();
    const id = office(t, { status: 'in_review' });
    expect(await reviewList(t, 'usr_004')).toEqual([id]);
    expect(await reviewList(t, 'usr_001')).toEqual([]);
    t.store.state.tasks[id].reviewSentBy = 'usr_004';
    expect(await reviewList(t, 'usr_004')).toEqual([]);
    expect(await reviewList(t, 'usr_001')).toEqual([id]);
  });
});

describe('a helper sends a to-do to review (rule 5)', () => {
  it('lets a helper with task.work move an office to-do that needs review to In review, and the lead reviews', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_003', helperIds: ['usr_006'], createdBy: 'usr_004' });
    t.as('usr_006');
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBe(true);
    expect((await t.api.call('tasks.move', { id, status: 'in_review' })).result).toBe('in_review');
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_006');
    expect(notices(t.store, 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'usr_004')).toHaveLength(0);
  });

  it('lets a helper of a project to-do do the same, and the lead reviews', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_003', helperIds: ['usr_006'] });
    t.as('usr_006');
    expect((await t.api.call('tasks.move', { id, status: 'in_review' })).result).toBe('in_review');
    expect(notices(t.store, 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'usr_002')).toHaveLength(0);
  });

  it('lets the tick of a helper land on In review, never on Done', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_003', helperIds: ['usr_006'] });
    t.as('usr_006');
    expect((await t.api.call('tasks.complete', { id })).result).toBe('in_review');
  });

  it('refuses a helper any other status, and any change of the fields', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_003', helperIds: ['usr_006'], createdBy: 'usr_004' });
    t.as('usr_006');
    for (const next of ['done', 'todo'] as const) {
      await expect(t.api.call('tasks.move', { id, status: next })).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(t.api.call('tasks.update', { id, patch: { title: 'Mine now' } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(status(t, id)).toBe('in_progress');
  });

  it('refuses a helper when the to-do needs no review, and shows the helper no control', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_003', helperIds: ['usr_006'], createdBy: 'usr_004', needsReview: false });
    t.as('usr_006');
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.complete', { id })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBeFalsy();
  });

  it('refuses a helper without the switch task.work', async () => {
    const t = world();
    t.store.state.settings.roles = without('task.work');
    const id = office(t, { ownerId: 'usr_003', helperIds: ['usr_006'], createdBy: 'usr_004' });
    t.as('usr_006');
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBeFalsy();
  });

  it('shows the helper control to no one else: a person outside the work side, and a to-do in review', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_003', helperIds: ['usr_006'] });
    t.as('usr_008');
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBeFalsy();
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_006');
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBe(true);
    await t.api.call('tasks.move', { id, status: 'in_review' });
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBeFalsy();
  });

  it('tells the lead the truth about the tick: it lands in review for the lead of a project to-do, on Done for the project leader', async () => {
    const t = world();
    const id = project(t, { ownerId: 'usr_003' });
    t.as('usr_003');
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('tasks.get', { id })).viewerCan.sendToReview).toBeFalsy();
    const own = project(t, { ownerId: 'usr_002' });
    expect((await t.api.call('tasks.get', { id: own })).viewerCan.sendToReview).toBeFalsy();
    // An Admin who leads an office to-do that another person made: the tick goes to the maker.
    const adminLead = office(t, { helperIds: [] });
    t.as('usr_001');
    expect((await t.api.call('tasks.get', { id: adminLead })).viewerCan.sendToReview).toBe(true);
  });

  it('keeps the rule of the waits: a helper cannot send a to-do that waits for another to-do', async () => {
    const t = world();
    const first = project(t, { ownerId: 'usr_003', status: 'todo' });
    const id = project(t, { ownerId: 'usr_003', helperIds: ['usr_006'], prerequisiteIds: [first] });
    t.as('usr_006');
    await expect(t.api.call('tasks.move', { id, status: 'in_review' })).rejects.toMatchObject({ details: { reason: 'prerequisite_open' } });
    expect(status(t, id)).toBe('in_progress');
  });
});

describe('the memory of the sender (rule 6)', () => {
  it('writes the sender when the status becomes In review, and clears it when the status leaves In review', async () => {
    const t = world();
    const id = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id });
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_004');
    t.as('usr_001');
    await t.api.call('tasks.approve', { id });
    expect(t.store.state.tasks[id].reviewSentBy).toBeNull();
    const back = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id: back });
    await t.api.call('tasks.move', { id: back, status: 'in_progress' });
    expect(t.store.state.tasks[back].reviewSentBy).toBeNull();
  });

  it('writes a new sender when the to-do is sent again', async () => {
    const t = world();
    const id = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id });
    t.as('usr_001');
    await t.api.call('tasks.sendBack', { id, note: 'Add the stamp' });
    await t.api.call('tasks.complete', { id });
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_001');
    expect(notices(t.store, 'usr_004')).toHaveLength(1);
  });

  it('takes the sender back with Undo of the send to review, and keeps an empty value, not an absent key', async () => {
    const t = world();
    const id = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id });
    const event = Object.values(t.store.state.events).find((e) => e.targetId === id && (e.after as { status?: string } | null)?.status === 'in_review')!;
    expect(event.after).toMatchObject({ status: 'in_review', reviewSentBy: 'usr_004' });
    expect(event.before).toMatchObject({ status: 'in_progress', reviewSentBy: null });
    await t.api.call('events.undo', { eventId: event.id });
    expect(status(t, id)).toBe('in_progress');
    expect(t.store.state.tasks[id]).toHaveProperty('reviewSentBy', null);
  });

  it('lets the reviewer with no switch take back an own approval only while that person may still review it (security review 2026-11-08)', async () => {
    const t = world();
    t.store.state.settings.roles = without('task.review.lead');
    const id = project(t, { ownerId: 'usr_003', createdBy: 'usr_008', helperIds: ['usr_006'] });
    const approve = async () => {
      t.as('usr_006');
      await t.api.call('tasks.move', { id, status: 'in_review' });
      t.as('usr_003');
      await t.api.call('tasks.approve', { id });
      return Object.values(t.store.state.events).filter((e) => e.targetId === id && e.verb === 'task.approved' && !e.undoneBy).at(-1)!;
    };
    // Sara is the named reviewer: she takes her approval back.
    await t.api.call('events.undo', { eventId: (await approve()).id });
    expect(status(t, id)).toBe('in_review');
    t.as('usr_003');
    await t.api.call('tasks.sendBack', { id, note: 'Again' });
    // Sara approves again, then the leader gives the lead to Tarek. Sara is no longer the reviewer and holds no review switch.
    const second = await approve();
    t.as('usr_002');
    await t.api.call('tasks.update', { id, patch: { ownerId: 'usr_008' } });
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: second.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(status(t, id)).toBe('done');
  });

  it('puts the sender back with Undo of an approval', async () => {
    const t = world();
    const id = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id });
    t.as('usr_001');
    await t.api.call('tasks.approve', { id });
    const event = Object.values(t.store.state.events).find((e) => e.targetId === id && e.verb === 'task.approved')!;
    await t.api.call('events.undo', { eventId: event.id });
    expect(status(t, id)).toBe('in_review');
    expect(t.store.state.tasks[id].reviewSentBy).toBe('usr_004');
  });

  it('writes nothing to a to-do that never goes to review', async () => {
    const t = world();
    const id = office(t, { ownerId: 'usr_003', helperIds: [], needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id });
    expect(t.store.state.tasks[id]).not.toHaveProperty('reviewSentBy');
  });
});

describe('everything that names reviewers follows the one rule (rule 7)', () => {
  async function sent(t: T) {
    const id = office(t);
    t.as('usr_004');
    await t.api.call('tasks.complete', { id });
    return id;
  }

  it('counts the review under the lead on the Dashboard, not under the sender', async () => {
    const t = world();
    await sent(t);
    t.as('usr_001');
    const view = await t.api.call('dashboard.get', {});
    expect(view.inReview.map((row) => [row.reviewer.id, row.count])).toEqual([['usr_001', 1]]);
  });

  it('puts the Approve button of the Inbox notice on the reviewer only', async () => {
    const t = world();
    const id = await sent(t);
    t.as('usr_001');
    const mine = await t.api.call('notifications.list', {});
    const row = mine.find((item) => item.notification.trigger === 'review_requested');
    expect(row).toMatchObject({ canApprove: true });
    expect(id).toBeTruthy();
  });

  it('names the same people in every place for a matrix of cases', () => {
    const t = world();
    const state: State = t.store.state;
    const cases = [
      office(t, { status: 'in_review', reviewSentBy: 'usr_004' }),
      office(t, { status: 'in_review', reviewSentBy: 'usr_001' }),
      project(t, { status: 'in_review', reviewSentBy: 'usr_003' }),
      project(t, { status: 'in_review', reviewSentBy: 'usr_006', helperIds: ['usr_006'] }),
    ];
    for (const id of cases) {
      const task = state.tasks[id];
      expect(reviewersOfTask(state, task)).toEqual(reviewersAfterSend(state, task, task.reviewSentBy!));
    }
  });
});

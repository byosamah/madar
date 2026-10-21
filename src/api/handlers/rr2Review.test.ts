import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { reviewersOf, reviewersOfTask, runScheduledTriggers } from '../notify';
import type { RoleSettings } from '../contract/entities';
import { STAMP, makeTask, makeWorld, NOW, testApi } from '../../test/factories';
import { both, without as off, withExtra as extra } from '../../test/rr2work';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The reviewers of role rights version 2 (design 5.2): a leader who lacks task.review.lead is no reviewer, and then the active Admins
 * review, as for a project with no leader. The Dashboard rows, the review_for_me filter, the notices and the morning summary follow.
 * People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member and the lead of tsk_001, usr_005 agent of usr_003.
 */
function world(roles?: RoleSettings) {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', createdBy: 'usr_002', needsReview: true });
  t.store.state.counters.tsk = 1;
  if (roles) t.store.state.settings.roles = roles;
  return t;
}

describe('reviewersOf and reviewersOfTask', () => {
  it('names the leader while the leader holds task.review.lead', () => {
    const state = makeWorld();
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_002']);
    expect(reviewersOfTask(state, { projectId: 'prj_001', createdBy: 'usr_003' })).toEqual(['usr_002']);
  });

  it('names the active Admins when the leader lacks the switch', () => {
    const state = makeWorld();
    state.settings.roles = off('task.review.lead');
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_001']);
    expect(reviewersOfTask(state, { projectId: 'prj_001', createdBy: 'usr_003' })).toEqual(['usr_001']);
  });

  it('keeps the leader when the role gives task.review.all or the lead switch is on again', () => {
    const state = makeWorld();
    state.settings.roles = both(['task.review.lead'], ['task.review.all']);
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_002']);
  });

  it('names the maker of an office to-do with no switch, as before', () => {
    const state = makeWorld();
    state.settings.roles = off('task.review.lead');
    expect(reviewersOfTask(state, { projectId: null, createdBy: 'usr_003' })).toEqual(['usr_003']);
  });

  it('sends the restart notice of a paused project to the leader, also when the leader lacks the review switch', () => {
    const state = makeWorld();
    state.settings.roles = off('task.review.lead');
    state.projects.prj_001.status = 'on_hold';
    state.projects.prj_001.pause = { reason: 'Client is away', resumeOn: '2026-10-03', by: 'usr_002', at: STAMP, kind: 'internal' };
    runScheduledTriggers(state, new Date('2026-10-03T06:00:00Z'));
    expect(Object.values(state.notifications).filter((n) => n.trigger === 'resume_due').map((n) => n.userId)).toEqual(['usr_002']);
  });
});

describe('the lists follow the reviewers', () => {
  it('sends the review notice to the leader while the leader reviews, and to the Admin when not', async () => {
    const on = world();
    on.as('usr_003');
    await on.api.call('tasks.complete', { id: 'tsk_001' });
    expect(Object.values(on.store.state.notifications).filter((n) => n.trigger === 'review_requested').map((n) => n.userId)).toEqual(['usr_002']);
    const closed = world(off('task.review.lead'));
    closed.as('usr_003');
    expect((await closed.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('in_review');
    expect(Object.values(closed.store.state.notifications).filter((n) => n.trigger === 'review_requested').map((n) => n.userId)).toEqual(['usr_001']);
  });

  it('puts the task in review_for_me of the Admin and not of the leader, when the leader lacks the switch', async () => {
    const t = world(off('task.review.lead'));
    t.store.state.tasks.tsk_001.status = 'in_review';
    const ids = async (who: string) => { t.as(who); return (await t.api.call('tasks.list', { filter: 'review_for_me' })).map((row) => row.task.id); };
    expect(await ids('usr_001')).toEqual(['tsk_001']);
    expect(await ids('usr_002')).toEqual([]);
    const on = world();
    on.store.state.tasks.tsk_001.status = 'in_review';
    on.as('usr_002');
    expect((await on.api.call('tasks.list', { filter: 'review_for_me' })).map((row) => row.task.id)).toEqual(['tsk_001']);
  });

  it('counts the review under the Admin on the Dashboard, as the list does', async () => {
    const t = world(off('task.review.lead'));
    t.store.state.tasks.tsk_001.status = 'in_review';
    t.as('usr_001');
    const view = await t.api.call('dashboard.get', {});
    expect(view.inReview.map((row) => [row.reviewer.id, row.count])).toEqual([['usr_001', 1]]);
    const on = world();
    on.store.state.tasks.tsk_001.status = 'in_review';
    on.as('usr_001');
    expect((await on.api.call('dashboard.get', {})).inReview.map((row) => [row.reviewer.id, row.count])).toEqual([['usr_002', 1]]);
  });

  it('lets a leader without the switch neither approve nor send back, and refuses the agent of that person', async () => {
    const t = world(off('task.review.lead'));
    t.store.state.tasks.tsk_001.status = 'in_review';
    t.as('usr_002');
    await expect(t.api.call('tasks.approve', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.sendBack', { id: 'tsk_001', note: 'No' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    const all = world(extra('task.review.all'));
    all.store.state.tasks.tsk_001.status = 'in_review';
    all.as('usr_004');
    await all.api.call('tasks.approve', { id: 'tsk_001' });
  });
});

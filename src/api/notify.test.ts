import { beforeEach, describe, expect, it } from 'vitest';
import { notify, projectPeople, reviewersOf, runScheduledTriggers } from './notify';
import type { State } from './store';
import { makeTask, makeWorld, NOW, STAMP } from '../test/factories';

let state: State;
beforeEach(() => {
  state = makeWorld();
});

const byTrigger = (trigger: string) => Object.values(state.notifications).filter((n) => n.trigger === trigger);

describe('notify', () => {
  it('skips the actor, agents, inactive people and turned-off triggers', () => {
    state.users.usr_004.active = false;
    state.users.usr_003.preferences.notifications.mention = false;
    const made = notify(state, state.users.usr_002, STAMP, {
      userIds: ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001',
    });
    expect(made.map((n) => n.userId)).toEqual(['usr_001']);
    expect(made[0].actorId).toBe('usr_002');
    expect(made[0].read).toBe(false);
  });

  it('creates one notification per dedupe key', () => {
    for (let i = 0; i < 3; i += 1) {
      notify(state, null, STAMP, { userIds: ['usr_003'], trigger: 'overdue', targetType: 'task', targetId: 'tsk_001', dedupeKey: 'overdue:tsk_001:2026-09-28' });
    }
    expect(Object.values(state.notifications)).toHaveLength(1);
  });

  it('sends reviews to the leader, or to every Admin with no leader', () => {
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_002']);
    state.projects.prj_001.leaderId = null;
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_001']);
  });

  it('lists the people on a project', () => {
    expect(projectPeople(state, 'prj_001').sort()).toEqual(['usr_002', 'usr_003']);
  });

  it('does not tell a person about their own agent', () => {
    const made = notify(state, state.users.usr_005, STAMP, { userIds: ['usr_002', 'usr_003'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' });
    expect(made.map((n) => n.userId)).toEqual(['usr_002']);
  });
});

describe('runScheduledTriggers', () => {
  beforeEach(() => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', dueDate: '2026-10-01' });
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', dueDate: '2026-09-28', status: 'in_progress' });
    state.tasks.tsk_003 = makeTask({ id: 'tsk_003', dueDate: '2026-09-28', status: 'in_review' });
  });

  it('creates the due-tomorrow and overdue notices once', () => {
    expect(runScheduledTriggers(state, NOW)).toBe(2);
    expect(runScheduledTriggers(state, NOW)).toBe(0);
    expect(byTrigger('due_tomorrow').map((n) => n.targetId)).toEqual(['tsk_001']);
    expect(byTrigger('overdue').map((n) => n.targetId)).toEqual(['tsk_002']);
  });

  it('uses the office day near midnight', () => {
    state.tasks = {};
    runScheduledTriggers(state, new Date('2026-09-30T23:30:00Z'));
    expect(Object.values(state.notifications)).toHaveLength(0);
  });

  it('ignores tasks in projects that are not active', () => {
    state.projects.prj_001.status = 'on_hold';
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });
});

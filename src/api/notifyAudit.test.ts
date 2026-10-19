import { beforeEach, describe, expect, it } from 'vitest';
import { runScheduledTriggers } from './notify';
import type { State } from './store';
import { calls } from './calls';
import { makeTask, makeWorld, STAMP, testApi } from '../test/factories';

let state: State;
beforeEach(() => {
  state = makeWorld();
});

const at = (day: string) => new Date(`${day}T06:00:00Z`);
const sent = (trigger: string) => Object.values(state.notifications).filter((n) => n.trigger === trigger);

describe('The due reminder goes out on the last working day before the due day (audit 2026-10-03, API-11)', () => {
  it('names a task due on Sunday on the Thursday before', () => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-10-04' }); // Sun
    expect(runScheduledTriggers(state, at('2026-09-30'))).toBe(0); // Wed
    expect(runScheduledTriggers(state, at('2026-10-01'))).toBe(1); // Thu
    expect(runScheduledTriggers(state, at('2026-10-03'))).toBe(0); // Sat: already sent
    expect(sent('due_tomorrow')).toHaveLength(1);
  });

  it('still sends it on the weekend when nobody opened Madar on the Thursday', () => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-10-04' });
    expect(runScheduledTriggers(state, at('2026-10-03'))).toBe(1);
  });

  it('names a task due on Monday on the Sunday before', () => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-10-05' }); // Mon
    expect(runScheduledTriggers(state, at('2026-10-01'))).toBe(0);
    expect(runScheduledTriggers(state, at('2026-10-04'))).toBe(1);
  });
});

describe('A paused project tells its leader on the restart day (audit 2026-10-03, API-18)', () => {
  beforeEach(() => {
    state.projects.prj_001.status = 'on_hold';
    state.projects.prj_001.pause = { reason: 'Client is away', resumeOn: '2026-10-03', by: 'usr_002', at: STAMP, kind: 'internal' };
  });

  it('sends the leader one notice on or after the restart day', () => {
    expect(runScheduledTriggers(state, at('2026-10-02'))).toBe(0);
    expect(runScheduledTriggers(state, at('2026-10-03'))).toBe(1);
    expect(runScheduledTriggers(state, at('2026-10-10'))).toBe(0);
    expect(sent('resume_due').map((n) => [n.userId, n.targetType, n.targetId])).toEqual([['usr_002', 'project', 'prj_001']]);
  });

  it('sends it to the active Admins when the leader is inactive, and not for a project that is active again', () => {
    state.users.usr_002.active = false;
    runScheduledTriggers(state, at('2026-10-03'));
    expect(sent('resume_due').map((n) => n.userId)).toEqual(['usr_001']);
    state.notifications = {};
    state.projects.prj_001.status = 'active';
    expect(runScheduledTriggers(state, at('2026-10-04'))).toBe(0);
  });

  // fbk_025: the person who paused the project gets the reminder too, also when that person does not lead it.
  it('also tells the person who paused the project, once for each date', () => {
    state.projects.prj_001.pause!.by = 'usr_003';
    expect(runScheduledTriggers(state, at('2026-10-03'))).toBe(2);
    expect(sent('resume_due').map((n) => n.userId).sort()).toEqual(['usr_002', 'usr_003']);
    expect(runScheduledTriggers(state, at('2026-10-04'))).toBe(0);
  });

  it('tells the owner of an agent that paused the project, and skips a person who is off', () => {
    state.projects.prj_001.pause!.by = 'usr_005'; // the agent of usr_003
    runScheduledTriggers(state, at('2026-10-03'));
    expect(sent('resume_due').map((n) => n.userId).sort()).toEqual(['usr_002', 'usr_003']);
    state.notifications = {};
    state.projects.prj_001.pause!.resumeOn = '2026-10-10';
    state.users.usr_003.active = false;
    runScheduledTriggers(state, at('2026-10-10'));
    expect(sent('resume_due').map((n) => n.userId)).toEqual(['usr_002']);
  });

  it('sends a new notice for a new restart date', () => {
    runScheduledTriggers(state, at('2026-10-03'));
    state.projects.prj_001.pause!.resumeOn = '2026-10-12';
    expect(runScheduledTriggers(state, at('2026-10-11'))).toBe(0);
    expect(runScheduledTriggers(state, at('2026-10-12'))).toBe(1);
    expect(sent('resume_due')).toHaveLength(2);
  });

  it('keeps the planned day on the notice, and the view sends it, also for a notice saved before', async () => {
    runScheduledTriggers(state, at('2026-10-05'));
    expect(sent('resume_due')[0].dueDate).toBe('2026-10-03');
    state.notifications.ntf_901 = {
      id: 'ntf_901', userId: 'usr_002', trigger: 'resume_due', actorId: null, targetType: 'project', targetId: 'prj_001', read: false,
      createdAt: '2026-10-01T08:00:00.000+03:00', dedupeKey: null,
    };
    const t = testApi(calls, state);
    t.as('usr_002');
    const views = await t.api.call('notifications.list', {});
    const days = views.filter((view) => view.notification.trigger === 'resume_due').map((view) => [view.notification.id, view.dueDate]);
    expect(days).toContainEqual(['ntf_901', '2026-10-01']);
    expect(days).toContainEqual([sent('resume_due')[0].id, '2026-10-03']);
  });
});

describe('The reminder names the due day, never "tomorrow" (audit 2026-10-03, API-11)', () => {
  it('keeps the due day on the notice, and the Inbox view sends it', async () => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-10-04' });
    runScheduledTriggers(state, at('2026-10-01'));
    expect(sent('due_tomorrow')[0].dueDate).toBe('2026-10-04');
    const t = testApi(calls, state);
    t.as('usr_003');
    const [view] = await t.api.call('notifications.list', {});
    expect(view.dueDate).toBe('2026-10-04');
  });

  it('takes the due day of the task for a reminder saved before the day was kept', async () => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-10-05' });
    state.notifications.ntf_001 = {
      id: 'ntf_001', userId: 'usr_003', trigger: 'due_tomorrow', actorId: null, targetType: 'task', targetId: 'tsk_001', read: false, createdAt: STAMP, dedupeKey: null,
    };
    const t = testApi(calls, state);
    t.as('usr_003');
    const [view] = await t.api.call('notifications.list', {});
    expect(view.dueDate).toBe('2026-10-05');
  });
});

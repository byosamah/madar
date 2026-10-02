import { beforeEach, describe, expect, it } from 'vitest';
import { runScheduledTriggers } from './notify';
import type { State } from './store';
import { makeTask, makeWorld, STAMP } from '../test/factories';

let state: State;
beforeEach(() => {
  state = makeWorld();
});

const at = (day: string) => new Date(`${day}T06:00:00Z`);
const sent = (trigger: string) => Object.values(state.notifications).filter((n) => n.trigger === trigger);

describe('The "due tomorrow" reminder goes out on the last working day before the due day (audit 2026-10-03, API-11)', () => {
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
});

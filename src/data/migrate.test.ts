import { describe, expect, it } from 'vitest';
import { migrateState } from './migrate';
import { STATE_VERSION, type State } from '../api/store';
import { makeTask, makeWorld, STAMP } from '../test/factories';

const notice = (id: string, trigger: string, targetType: string, targetId: string) => ({
  id, userId: 'usr_003', trigger, actorId: null, targetType, targetId, read: false, createdAt: STAMP, dedupeKey: null,
});
const event = (id: string, seq: number, targetType: string, targetId: string) => ({
  id, seq, projectId: 'prj_001', actorId: 'usr_003', actorKind: 'human', actingForId: 'usr_003', correlationId: `cor_${seq}`,
  verb: 'task.created', targetType, targetId, before: null, after: null, createdAt: STAMP, undoneBy: null,
});

describe('migrateState', () => {
  it('takes a version 2 office to version 3 and drops the hours data, and keeps everything else', () => {
    const world = makeWorld();
    world.tasks.tsk_001 = makeTask();
    const old = world as unknown as Record<string, unknown> & State;
    old.version = 2;
    old.time = { tim_001: { id: 'tim_001', userId: 'usr_003', projectId: 'prj_001', stageId: 'stg_002', taskId: null, date: '2026-09-28', hours: 8 } };
    old.timeRows = { row_1: { key: 'row_1', userId: 'usr_003', weekStart: '2026-09-27', projectId: 'prj_001', stageId: 'stg_002', taskId: null } };
    old.weekUnlocks = [{ userId: 'usr_003', weekStart: '2026-09-27' }];
    const user = old.users.usr_003 as unknown as { weeklyHourTarget: number; preferences: { notifications: Record<string, boolean> } };
    user.weeklyHourTarget = 40;
    user.preferences.notifications.week_under_target = true;
    old.notifications = {
      ntf_001: notice('ntf_001', 'week_under_target', 'week', '2026-09-27'),
      ntf_002: notice('ntf_002', 'task_assigned', 'task', 'tsk_001'),
    } as unknown as State['notifications'];
    old.events = {
      evt_001: event('evt_001', 1, 'time', 'tim_001'),
      evt_002: event('evt_002', 2, 'task', 'tsk_001'),
    } as unknown as State['events'];

    const migrated = migrateState(old) as unknown as Record<string, unknown> & State;

    expect(migrated.version).toBe(STATE_VERSION);
    expect(STATE_VERSION).toBe(3);
    expect('time' in migrated).toBe(false);
    expect('timeRows' in migrated).toBe(false);
    expect('weekUnlocks' in migrated).toBe(false);
    expect('weeklyHourTarget' in migrated.users.usr_003).toBe(false);
    expect('week_under_target' in migrated.users.usr_003.preferences.notifications).toBe(false);
    expect(Object.keys(migrated.notifications)).toEqual(['ntf_002']);
    expect(Object.keys(migrated.events)).toEqual(['evt_002']);
    expect(migrated.users.usr_003.preferences.notifications.mention).toBe(true);
    expect(Object.keys(migrated.users)).toEqual(['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005']);
    expect(migrated.tasks.tsk_001.title).toBe('Ground floor plan');
    expect(Object.keys(migrated.projects)).toEqual(['prj_001']);
  });
});

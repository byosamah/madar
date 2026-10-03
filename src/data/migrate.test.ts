import { describe, expect, it } from 'vitest';
import { migrateState } from './migrate';
import type { TrackerEntry } from '../api/contract/entities';
import { STATE_VERSION, type State } from '../api/store';
import { makeTask, makeWorld, STAMP } from '../test/factories';
import { FORMS } from '../lib/projectMark';

const notice = (id: string, trigger: string, targetType: string, targetId: string) => ({
  id, userId: 'usr_003', trigger, actorId: null, targetType, targetId, read: false, createdAt: STAMP, dedupeKey: null,
});
const event = (id: string, seq: number, targetType: string, targetId: string) => ({
  id, seq, projectId: 'prj_001', actorId: 'usr_003', actorKind: 'human', actingForId: 'usr_003', correlationId: `cor_${seq}`,
  verb: 'task.created', targetType, targetId, before: null, after: null, createdAt: STAMP, undoneBy: null,
});

describe('migrateState', () => {
  it('takes a version 5 office to version 6: a meeting has both sides, a Balady update comes from a third party, and every entry has its events', () => {
    const world = makeWorld();
    const entry = (id: string, type: TrackerEntry['type'], direction: TrackerEntry['direction'], extra: Partial<TrackerEntry> = {}): TrackerEntry => ({
      id, projectId: 'prj_001', type, direction, title: `Entry ${id}`, note: '', date: '2026-09-20', waiting: null, closedAt: null, closedBy: null,
      fileIds: [], peopleIds: [], auto: null, createdBy: 'usr_003', createdAt: '2026-09-20T10:00:00.000+03:00', ...extra,
    });
    world.tracker = {
      trk_001: entry('trk_001', 'meeting', 'in'),
      trk_002: entry('trk_002', 'balady', 'out', { waiting: 'us', closedAt: '2026-09-22T11:00:00.000+03:00', closedBy: 'usr_002' }),
      trk_003: entry('trk_003', 'message', 'out'),
      trk_004: entry('trk_004', 'file', 'in'),
    };
    world.events.evt_001 = { ...event('evt_001', 1, 'tracker', 'trk_004'), verb: 'tracker.logged' } as unknown as State['events'][string];
    world.counters.evt = 1;
    world.version = 5;
    const done = migrateState(world)!;
    expect(done.version).toBe(STATE_VERSION);
    expect(Object.values(done.tracker!).map((e) => [e.id, e.direction])).toEqual([
      ['trk_001', 'both'], ['trk_002', 'third_party'], ['trk_003', 'out'], ['trk_004', 'in'],
    ]);
    const verbs = Object.values(done.events).filter((e) => e.targetType === 'tracker').map((e) => `${e.targetId} ${e.verb}`).sort();
    expect(verbs).toEqual(['trk_001 tracker.logged', 'trk_002 tracker.closed', 'trk_002 tracker.logged', 'trk_003 tracker.logged', 'trk_004 tracker.logged']);
    const closed = Object.values(done.events).find((e) => e.verb === 'tracker.closed')!;
    expect(closed).toMatchObject({ actorId: 'usr_002', createdAt: '2026-09-22T11:00:00.000+03:00' });
  });

  it('takes a version 4 office to version 5 and gives every project its own picture', () => {
    const world = makeWorld();
    world.projects.prj_002 = { ...world.projects.prj_001, id: 'prj_002', code: 'KH-26-002', name: 'Second' };
    for (const project of Object.values(world.projects)) delete project.mark;
    world.version = 4;
    const done = migrateState(world)!;
    expect(done.version).toBe(STATE_VERSION);
    const marks = Object.values(done.projects).map((project) => project.mark);
    expect(marks.every((mark) => typeof mark === 'number')).toBe(true);
    expect(new Set(marks.map((mark) => mark! % FORMS.length)).size).toBe(marks.length);
  });

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
    expect(STATE_VERSION).toBe(8);
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

  it('takes a version 6 office to version 7: every person gets the restart-day notice, turned on (audit 2026-10-03, API-18)', () => {
    const world = makeWorld();
    for (const user of Object.values(world.users)) delete (user.preferences.notifications as Record<string, boolean>).resume_due;
    world.users.usr_003.preferences.notifications.mention = false;
    world.version = 6;
    const done = migrateState(world)!;
    expect(done.version).toBe(STATE_VERSION);
    expect(Object.values(done.users).every((user) => user.preferences.notifications.resume_due === true)).toBe(true);
    expect(done.users.usr_003.preferences.notifications.mention).toBe(false);
  });

  it('takes a version 7 office to version 8: an older date note gets the due day it was made for (audit 2026-10-03, V-3)', () => {
    const world = makeWorld();
    const note = (at: string, byTaskId: string, extra: Record<string, unknown> = {}) => ({
      from: { startDate: '2026-10-04', dueDate: '2026-10-06' }, to: { startDate: '2026-10-07', dueDate: '2026-10-11' }, reason: 'Late', at, byTaskId, lateDays: 3, ...extra,
    });
    // Task A was due Sun 27 Sep and finished late on Wed 30 Sep. Version 2 on Thu 1 Oct set its due day to Thu 8 Oct.
    world.tasks.tsk_001 = makeTask({ id: 'tsk_001', title: 'Task A', status: 'done', dueDate: '2026-10-08' });
    world.tasks.tsk_002 = makeTask({
      id: 'tsk_002', title: 'Task B', prerequisiteIds: ['tsk_001'],
      dateNotes: [
        note('2026-09-30T09:00:00.000+03:00', 'tsk_001'),
        note('2026-10-12T09:00:00.000+03:00', 'tsk_001'),
        note('2026-10-13T09:00:00.000+03:00', 'tsk_001', { forDueDate: '2026-10-01' }),
        note('2026-09-30T09:00:00.000+03:00', 'tsk_009'),
      ],
    });
    world.events.evt_001 = {
      ...event('evt_001', 1, 'task', 'tsk_001'), verb: 'task.version_opened', createdAt: '2026-10-01T09:00:00.000+03:00',
      before: { status: 'done', dueDate: '2026-09-27' }, after: { status: 'todo', dueDate: '2026-10-08' },
    } as unknown as State['events'][string];
    world.events.evt_002 = {
      ...event('evt_002', 2, 'task', 'tsk_001'), verb: 'task.status_changed', createdAt: '2026-10-12T09:00:00.000+03:00',
      before: { status: 'todo' }, after: { status: 'done' },
    } as unknown as State['events'][string];
    world.counters.evt = 2;
    world.version = 7;
    const done = migrateState(world)!;
    expect(done.version).toBe(STATE_VERSION);
    expect(STATE_VERSION).toBe(8);
    expect(done.tasks.tsk_002.dateNotes?.map((n) => n.forDueDate)).toEqual(['2026-09-27', '2026-10-08', '2026-10-01', undefined]);
  });
});

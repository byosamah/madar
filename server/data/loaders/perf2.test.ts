import { beforeAll, describe, expect, it } from 'vitest';
import { runScheduledTriggers } from '../../../src/api/notify';
import { sharedCalls, type SharedCallName } from '../../../src/api/sharedCalls';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { addDays, todayISO } from '../../../src/lib/dates';
import { snapshotOf } from '../officeCache';
import { changesOf, runBoth } from './compare';
import { INBOX_COUNT_NOTICE_FIELDS } from './inbox';
import { loadFor } from './index';
import { JOB_DUE_AHEAD_DAYS, JOB_TASK_FIELDS, loadJobs } from './jobs';
import { memorySource } from './memorySource';
import type { Select } from './query';
import { REPORT_TRACKER_FIELDS } from './report';
import type { Source } from './source';

/**
 * The database track of the speed release perf2 (performance audit 2026-10-21, DB-2, DB-8, DB-10, DB-11). Each read gives the
 * handler fewer bytes or fewer reads, and the same answer as the whole office.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
let seed: State;

beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

const office = (setup?: (state: State) => void): State => {
  const state = structuredClone(seed);
  setup?.(state);
  return state;
};
const keysOf = (rows: Record<string, unknown> | undefined) => Object.values(rows ?? {}).map((row) => Object.keys(row as object));
const within = (rows: Record<string, unknown> | undefined, fields: readonly string[]) => keysOf(rows).every((keys) => keys.every((key) => fields.includes(key)));

/** A Source that writes down each Select that a loader sends. */
function recording(src: Source): { src: Source; reads: Select[] } {
  const reads: Select[] = [];
  return { src: { ...src, select: async (s) => (reads.push(s), src.select(s)) }, reads };
}

describe('the report reads only the Tracker fields that it counts (DB-10)', () => {
  it('loads the Tracker lines with the fields of the counts, and gives the answer of the whole office', async () => {
    for (const period of [{ period: 'week', start: '2026-09-28' }, { period: 'year', start: '2026-01-01' }]) {
      const { whole, scoped, loaded } = await runBoth(office(), 'reports.office', period, ADMIN, { now: NOW, correlationId: 'cor_test' });
      expect(scoped).toEqual(whole);
      expect(Object.keys(loaded.tracker ?? {}).length).toBeGreaterThan(0);
      expect(within(loaded.tracker, REPORT_TRACKER_FIELDS)).toBe(true);
    }
  });
});

describe('the bell count reads only the fields that it counts (DB-8)', () => {
  it('loads the unread notices with the picked fields in count mode, and whole rows for the list and the writes', async () => {
    const state = office();
    const unread = Object.values(state.notifications).filter((n) => !n.read);
    expect(unread.length).toBeGreaterThan(0);
    for (const actor of new Set(unread.map((n) => n.userId))) {
      const { whole, scoped, loaded } = await runBoth(state, 'notifications.count', {}, actor, { now: NOW, correlationId: 'cor_test' });
      expect(scoped, actor).toEqual(whole);
      expect(within(loaded.notifications, INBOX_COUNT_NOTICE_FIELDS), actor).toBe(true);
    }
    const mine = unread[0];
    const list = await runBoth(state, 'notifications.list', {}, mine.userId, { now: NOW, correlationId: 'cor_test' });
    expect(list.scoped).toEqual(list.whole);
    expect(list.loaded.notifications[mine.id]).toEqual(state.notifications[mine.id]);
    for (const [name, input] of [['notifications.markRead', { ids: [mine.id] }], ['notifications.markAllRead', {}]] as const) {
      const run = await runBoth(state, name, input, mine.userId, { now: NOW, correlationId: 'cor_test' });
      expect(run.scoped, name).toEqual(run.whole);
      expect(run.loaded.notifications[mine.id], name).toEqual(state.notifications[mine.id]);
    }
  });
});

describe('the job reads only the open tasks that it can remind about, with the fields it reads (DB-2)', () => {
  const openTasks = (state: State) => Object.values(state.tasks).filter((t) => t.status === 'todo' || t.status === 'in_progress');

  it('loads each task with the seven fields that the reminders read', async () => {
    const state = office((s) => {
      for (const task of openTasks(s)) task.dueDate = addDays(TODAY, 1);
    });
    const loaded = await loadJobs({ src: memorySource(state), office: snapshotOf(state, 1), now: NOW });
    expect(Object.keys(loaded.tasks).length).toBeGreaterThan(0);
    expect(within(loaded.tasks, JOB_TASK_FIELDS)).toBe(true);
  });

  it('keeps the tasks that are past due or due within the bound, and never one that is due later', async () => {
    const state = office((s) => {
      let i = 0;
      for (const task of openTasks(s)) task.dueDate = addDays(TODAY, (i++ % 12) - 3);
    });
    const loaded = await loadJobs({ src: memorySource(state), office: snapshotOf(state, 1), now: NOW });
    const dues = Object.values(loaded.tasks).map((t) => t.dueDate as string);
    expect(dues.length).toBeGreaterThan(0);
    expect(dues.every((day) => day <= addDays(TODAY, JOB_DUE_AHEAD_DAYS))).toBe(true);
    expect(dues.some((day) => day === addDays(TODAY, JOB_DUE_AHEAD_DAYS))).toBe(true);
    expect(dues.some((day) => day < TODAY)).toBe(true);
  });

  it('gives the notices of the whole office on each day of two weeks, with every weekend between today and the due day', async () => {
    let made = 0;
    for (let k = 0; k < 14; k += 1) {
      const at = new Date(NOW.getTime() + k * 86_400_000);
      const today = todayISO(at);
      const state = office((s) => {
        let i = 0;
        for (const task of openTasks(s)) task.dueDate = addDays(today, (i++ % 14) - 3);
      });
      const whole = structuredClone(state);
      const wholeBefore = structuredClone(whole);
      const count = runScheduledTriggers(whole, at, { dedupeUsed: () => false });
      const loaded = await loadJobs({ src: memorySource(state), office: snapshotOf(state, 1), now: at });
      const scoped = structuredClone(loaded);
      expect(runScheduledTriggers(scoped, at, { dedupeUsed: () => false }), today).toBe(count);
      expect(changesOf(loaded, scoped), today).toEqual(changesOf(wholeBefore, whole));
      made += count;
    }
    expect(made).toBeGreaterThan(0);
  });

  it('loads every open task when the run gives no time', async () => {
    const state = office((s) => {
      for (const task of openTasks(s)) task.dueDate = addDays(TODAY, 30);
    });
    const loaded = await loadJobs({ src: memorySource(state), office: snapshotOf(state, 1) });
    const activeOpen = openTasks(state).filter((t) => t.projectId === null || state.projects[t.projectId]?.status === 'active');
    expect(Object.keys(loaded.tasks).length).toBe(activeOpen.length);
  });
});

describe('tasks.list reads the tasks of a waiting project once when the first read held them all (DB-11)', () => {
  const WAITING = 'tsk_wait';
  const waitingOffice = () => office((s) => {
    const [first, second] = Object.values(s.tasks).filter((t) => t.projectId === 'prj_001' && t.stageId !== null && t.status !== 'done' && t.ownerId !== null);
    s.tasks[WAITING] = { ...second, id: WAITING, prerequisiteIds: [first.id] };
  });
  const projectReads = (reads: Select[]) => reads.filter((s) => s.c === 'tasks' && s.where.some((w) => 'col' in w && w.col === 'project_id' && 'in' in w && w.in.length > 0));
  const load = async (state: State, input: unknown) => {
    const rec = recording(memorySource(state));
    const parsed = sharedCalls['tasks.list'].input.parse(input);
    await loadFor('tasks.list', parsed, { src: rec.src, office: snapshotOf(state, 1), actorId: ADMIN, write: false, now: NOW });
    return projectReads(rec.reads);
  };
  const same = async (state: State, name: SharedCallName, input: unknown) => {
    const { whole, scoped } = await runBoth(state, name, input, ADMIN, { now: NOW, correlationId: 'cor_test' });
    expect(scoped).toEqual(whole);
  };

  it('sends one read of the project tasks for a list with no narrowing condition, and for one project', async () => {
    const state = waitingOffice();
    expect(await load(state, {})).toHaveLength(1);
    expect(await load(state, { projectId: 'prj_001' })).toHaveLength(1);
    await same(state, 'tasks.list', {});
    await same(state, 'tasks.list', { projectId: 'prj_001' });
  });

  it('keeps the second read for a narrow list, because the first read left tasks of the project out', async () => {
    const state = waitingOffice();
    const waiting = state.tasks[WAITING];
    const input = { ownerId: waiting.ownerId ?? undefined, includeDone: false };
    expect(waiting.ownerId).not.toBeNull();
    expect(await load(state, input)).toHaveLength(2);
    await same(state, 'tasks.list', input);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../../lib/dates';
import { makeTask, makeUser, makeWorld, NOW, testApi } from '../../test/factories';
import type { Event, Payment, Task, TrackerEntry } from '../contract/entities';
import type { Ctx } from '../registry';
import { withRights } from '../rights';
import { REPORT_DESIGN } from '../reportDesign';
import { REPORT_KEYS } from '../reportPeriod';
import type { State } from '../store';
import { reportsCalls, reportsOffice } from './reports';

beforeEach(() => setNow(NOW));

/** A moment on the Riyadh offset, as the server writes it. */
const at = (day: string, time = '10:00:00') => `${day}T${time}.000+03:00`;

function event(n: number, overrides: Partial<Event>): Event {
  return {
    id: `evt_${String(n).padStart(3, '0')}`, seq: n, projectId: 'prj_001', actorId: 'usr_002', actorKind: 'human', actingForId: 'usr_002',
    correlationId: `cor_${n}`, verb: 'project.stage_changed', targetType: 'project', targetId: 'prj_001', before: null, after: null,
    createdAt: at('2026-09-29'), undoneBy: null, ...overrides,
  };
}

function trackerEntry(id: string, overrides: Partial<TrackerEntry>): TrackerEntry {
  return {
    id, projectId: 'prj_001', type: 'meeting', direction: 'out', title: 'Site meeting', note: '', date: '2026-09-29', waiting: null,
    closedAt: null, closedBy: null, fileIds: [], peopleIds: [], auto: null, createdBy: 'usr_002', createdAt: at('2026-09-29'), ...overrides,
  };
}

function payment(id: string, overrides: Partial<Payment>): Payment {
  return {
    id, projectId: 'prj_001', name: 'Milestone', amount: 100, dueDate: '2026-09-20', receivedOn: null, note: '', createdBy: 'usr_001',
    createdAt: at('2026-09-01'), ...overrides,
  };
}

/**
 * The office of the report tests: the sample office with a Management person, a Member and an Accounting person. The week of
 * 27 September 2026 (a Sunday to a Saturday) is the period. Today is 30 September.
 */
function office(): State {
  const state = makeWorld();
  for (const user of [
    makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' }),
    makeUser('usr_007', { name: 'Noura Member' }),
    makeUser('usr_008', { name: 'Accounts Person', systemRole: 'accounting' }),
  ]) state.users[user.id] = user;
  const tasks: Task[] = [
    makeTask({ id: 'tsk_001', ownerId: 'usr_003', status: 'done', dueDate: '2026-09-25', createdAt: at('2026-09-20'), completedAt: at('2026-09-29') }),
    makeTask({ id: 'tsk_002', ownerId: 'usr_003', status: 'todo', dueDate: '2026-10-01', createdAt: at('2026-09-28', '09:00:00') }),
    makeTask({ id: 'tsk_003', ownerId: 'usr_002', status: 'in_progress', dueDate: '2026-10-20', createdAt: at('2026-09-15') }),
    // Done after the week: open at the end of the week, and past due then.
    makeTask({ id: 'tsk_004', ownerId: 'usr_003', status: 'done', dueDate: '2026-09-30', createdAt: at('2026-09-10'), completedAt: at('2026-10-06') }),
    // An open task with no due date and no lead.
    makeTask({ id: 'tsk_005', ownerId: null, status: 'todo', dueDate: null, createdAt: at('2026-08-15') }),
  ];
  for (const task of tasks) state.tasks[task.id] = task;
  state.deadlines.ddl_001 = { id: 'ddl_001', projectId: 'prj_001', stageId: null, name: 'Concept review', date: '2026-09-30' };
  state.deadlines.ddl_002 = { id: 'ddl_002', projectId: 'prj_001', stageId: null, name: 'Plan check', date: '2026-10-02' };
  state.deadlines.ddl_003 = { id: 'ddl_003', projectId: 'prj_001', stageId: null, name: 'Client handover', date: '2026-10-20' };
  state.tracker = {};
  state.payments = {};
  for (const entry of [
    trackerEntry('trk_001', { date: '2026-09-29', direction: 'out', waiting: 'client' }),
    trackerEntry('trk_002', { date: '2026-09-15', direction: 'in', closedAt: at('2026-09-30'), closedBy: 'usr_002' }),
    trackerEntry('trk_003', { date: '2026-10-10', direction: 'out', waiting: 'us' }),
  ]) state.tracker[entry.id] = entry;
  for (const one of [
    payment('pay_001', { amount: 1000, dueDate: '2026-09-15', receivedOn: '2026-09-30' }),
    payment('pay_002', { amount: 500, dueDate: '2026-10-02' }),
    payment('pay_003', { amount: 300, dueDate: '2026-09-20' }),
  ]) state.payments[one.id] = one;
  for (const [n, overrides] of [
    [1, { verb: 'project.stage_changed', createdAt: at('2026-09-29') }],
    [2, { verb: 'project.stage_changed', createdAt: at('2026-10-01') }],
    [3, { verb: 'project.stage_changed', createdAt: at('2026-10-05') }],
  ] as const) state.events[`evt_00${n}`] = event(n, overrides);
  return state;
}

/** The API over the office, as the server or the prototype runs it. */
function world() {
  return testApi(reportsCalls, office());
}

/** The context of the handler for one person, as execute.ts makes it. Used where a test sets State.counts by hand. */
function contextOf(state: State, userId: string): Ctx {
  const actor = state.users[userId];
  return {
    state, actor, authority: withRights(state, actor), correlationId: 'cor_test', stamp: at('2026-09-30', '09:00:00'), today: '2026-09-30',
    now: NOW, persistent: false,
  };
}

describe('reports.office: who may ask', () => {
  it('refuses a Member, who has no office rights', async () => {
    const t = world();
    t.as('usr_007');
    await expect(t.api.call('reports.office', { period: 'week', start: '2026-09-28' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an Accounting person, who holds the payment right only', async () => {
    const t = world();
    t.as('usr_008');
    await expect(t.api.call('reports.office', { period: 'week', start: '2026-09-28' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('gives Management the report with the money, and without the gaps', async () => {
    const t = world();
    t.as('usr_006');
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    // pay_002 is due on 2 October and unpaid on 3 October, so it is past due at the end of the week too.
    expect(report.money).toEqual({ received: 1000, dueInPeriod: 500, pastDueAtEnd: 800 });
    expect(report.gaps).toBeNull();
  });

  it('gives the Admin the gaps as well', async () => {
    const t = world();
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(report.gaps).toEqual(['Open tasks with no due date: 1', 'Open tasks with no lead: 1']);
  });
});

describe('reports.office: the design guide goes with the data (fbk_016)', () => {
  it('gives the same design guide to every person who may ask, so the agent builds the document from it', async () => {
    const t = world();
    t.as('usr_006');
    const management = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(management.design).toEqual(REPORT_DESIGN);
    t.as('usr_001');
    const admin = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(admin.design).toEqual(REPORT_DESIGN);
  });
});

describe('reports.office: the numbers of the week of 27 September', () => {
  it('gives the days of the week and the totals of the tasks, the projects, the deadlines and the Tracker', async () => {
    const t = world();
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(report.period).toEqual({ kind: 'week', from: '2026-09-27', to: '2026-10-03' });
    expect(report.totals).toEqual({
      projects: { active: 1, started: 0, completed: 0, paused: 0 },
      tasks: { done: 1, made: 1, pastDueAtEnd: 2 },
      deadlines: { met: 0, missed: 1 },
      submissions: 1,
      stageMoves: 2,
    });
    expect(report.tracker).toEqual({ opened: 1, closed: 1, waitingOnClientAtEnd: 1 });
  });

  it('counts the people: the tasks done, the open tasks and the past-due tasks at the end of the week', async () => {
    const t = world();
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(report.people.find((row) => row.user.id === 'usr_003')).toMatchObject({ tasksDone: 1, open: 2, pastDue: 2, reviewsDone: 0 });
    expect(report.people.find((row) => row.user.id === 'usr_002')).toMatchObject({ tasksDone: 0, open: 1, pastDue: 0 });
  });

  it('gives each project its stage, its counts and the next deadline after the week', async () => {
    const t = world();
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(report.projects).toHaveLength(1);
    expect(report.projects[0]).toMatchObject({
      project: { id: 'prj_001', code: 'KH-26-001', name: 'Test Tower' },
      status: 'active',
      stageAtStart: { id: 'stg_002', name: 'Schematic Design' },
      stageAtEnd: { id: 'stg_002', name: 'Schematic Design' },
      tasks: { done: 1, made: 1, pastDueAtEnd: 2 },
      deadlines: { met: 0, missed: 1 },
      nextDeadline: { name: 'Client handover', date: '2026-10-20' },
    });
  });

  it('gives the period of the last full month with no start', async () => {
    const t = world();
    const report = await t.api.call('reports.office', { period: 'month' });
    expect(report.period).toEqual({ kind: 'month', from: '2026-08-01', to: '2026-08-31' });
  });
});

describe('reports.office: the counts of the server and the reviews of a person', () => {
  it('reads the counts that a loader puts in State.counts, and not the events of the state', () => {
    const state = office();
    state.counts = {
      [REPORT_KEYS.stageMoves]: 7,
      [REPORT_KEYS.review('usr_003', 'task.approved')]: 3,
      [REPORT_KEYS.review('usr_003', 'task.sent_back')]: 1,
    };
    // The handler runs without a prepared value, as the call has no prepare step.
    const report = reportsOffice.run({ period: 'week', start: '2026-09-28' }, contextOf(state, 'usr_001'), undefined);
    expect(report.totals.stageMoves).toBe(7);
    expect(report.people.find((row) => row.user.id === 'usr_003')?.reviewsDone).toBe(4);
  });

  it('counts a review of a person through the events of the state when no loader counted it', async () => {
    const t = world();
    t.store.state.events.evt_010 = event(10, { verb: 'task.approved', actingForId: 'usr_003', actorId: 'usr_003', createdAt: at('2026-09-30') });
    t.store.state.events.evt_011 = event(11, { verb: 'task.approved', actingForId: 'usr_003', actorId: 'usr_003', createdAt: at('2026-10-04') });
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(report.people.find((row) => row.user.id === 'usr_003')?.reviewsDone).toBe(1);
  });
});

describe('reports.office: a project that ends or pauses in the period', () => {
  it('counts a completed project and a paused project, and leaves the completed one out of the active count', async () => {
    const t = world();
    t.store.state.projects.prj_001.status = 'completed';
    t.store.state.events.evt_020 = event(20, { verb: 'project.status_changed', after: { status: 'completed' }, createdAt: at('2026-09-29') });
    t.store.state.events.evt_021 = event(21, { verb: 'project.paused', after: { status: 'on_hold' }, createdAt: at('2026-09-30') });
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    expect(report.totals.projects).toEqual({ active: 0, started: 0, completed: 1, paused: 1 });
    expect(report.projects[0]).toMatchObject({ status: 'completed', health: null });
  });
});

import { describe, expect, it } from 'vitest';
import { BATCH_BUDGET, MAX_BATCH, OVERVIEW_CALLS, callCost, isOverviewCall } from './wire';

describe('the wire rules', () => {
  it('counts tasks.list as an overview call only without a project', () => {
    expect(isOverviewCall('tasks.list', {})).toBe(true);
    expect(isOverviewCall('tasks.list', { projectId: 'prj_001' })).toBe(false);
    expect(isOverviewCall('dashboard.get', {})).toBe(true);
    expect(isOverviewCall('projects.get', { id: 'prj_001' })).toBe(false);
    expect(OVERVIEW_CALLS).toHaveLength(5);
    expect(MAX_BATCH).toBe(12);
  });
});

describe('the cost of a call (perf2 savetrip, 2026-10-22)', () => {
  it('gives each overview call the cost that the year-office table measured, and every other call none', () => {
    expect(callCost('projects.list', { status: 'all' })).toBe(20);
    expect(callCost('events.list', {})).toBe(15);
    expect(callCost('dashboard.get', {})).toBe(10);
    expect(callCost('search.query', { text: 'plan' })).toBe(10);
    expect(callCost('tasks.get', { id: 'tsk_001' })).toBe(0);
    expect(callCost('chats.unreadCount', {})).toBe(0);
    expect(callCost('session.get', undefined)).toBe(0);
  });

  it('prices tasks.list by its scope: a project 0, one person 1, any other list 4', () => {
    expect(callCost('tasks.list', { projectId: 'prj_001', activeProjectsOnly: false })).toBe(0);
    expect(callCost('tasks.list', { filter: 'mine', includeDone: false })).toBe(1);
    expect(callCost('tasks.list', { filter: 'review_for_me' })).toBe(1);
    expect(callCost('tasks.list', { workOf: 'usr_002' })).toBe(1);
    expect(callCost('tasks.list', { ownerId: 'usr_002', includeDone: false, activeProjectsOnly: false })).toBe(1);
    expect(callCost('tasks.list', {})).toBe(4);
    expect(callCost('tasks.list', undefined)).toBe(4);
    expect(callCost('tasks.list', { filter: 'overdue' })).toBe(4);
    expect(callCost('tasks.list', { includeDone: false, activeProjectsOnly: false })).toBe(4);
    // A project filter wins over a person filter: the list of one project is the cheap read.
    expect(callCost('tasks.list', { projectId: 'prj_001', filter: 'mine' })).toBe(0);
  });

  it('lets any one call go alone, and says an overview call is a call with a cost', () => {
    for (const name of OVERVIEW_CALLS) expect(callCost(name, {})).toBeLessThanOrEqual(BATCH_BUDGET);
    expect(isOverviewCall('tasks.list', { filter: 'mine' })).toBe(true);
    expect(BATCH_BUDGET).toBe(30);
  });

  it('keeps the heavy calls from joining each other: a second one passes the budget', () => {
    const heavy = ['projects.list', 'events.list', 'dashboard.get', 'search.query'].map((name) => callCost(name, {}));
    // projects.list with events.list, and the three others together, pass the budget; the cheap person lists never do.
    expect(heavy[0] + heavy[1]).toBeGreaterThan(BATCH_BUDGET);
    expect(heavy[1] + heavy[2] + heavy[3]).toBeGreaterThan(BATCH_BUDGET);
    expect(heavy[0] + callCost('tasks.list', { filter: 'mine' }) * 10).toBeLessThanOrEqual(BATCH_BUDGET);
  });
});

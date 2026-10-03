import { describe, expect, it } from 'vitest';
import { MAX_BATCH, OVERVIEW_CALLS, isOverviewCall } from './wire';

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

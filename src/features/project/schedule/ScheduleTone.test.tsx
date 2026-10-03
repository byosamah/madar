import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../../../test/render';
import { currentTone } from '../../dashboard/scheduleMarks';

// The current stage bar took the project color, so an On track project showed amber and a Late one green (audit 2026-10-03, F-12).
describe('the current stage bar of the Schedule tab', () => {
  it.each([
    ['prj_001', 'Construction Documents', 'late', 'bg-red-text'],
    ['prj_005', 'Concept', 'on_track', 'bg-ink-2'],
  ])('of %s has the state tone of the Dashboard schedule, not the project color', async (projectId, stage, health, tone) => {
    const { api } = await renderApp(`/projects/${projectId}?tab=schedule`);
    const bar = (await screen.findByRole('slider', { name: `Start of ${stage}` })).parentElement as HTMLElement;
    const row = (await api.call('dashboard.get', {})).schedule.find((item) => item.project.id === projectId);
    expect(row?.health).toBe(health);
    for (const name of currentTone(row!.pause !== null, row!.health).split(' ')) expect(bar).toHaveClass(name);
    expect(bar).toHaveClass(tone);
    expect(bar.style.background).toBe('');
  });

  it('is grey for a paused project, as on the Dashboard', async () => {
    await renderApp('/projects/prj_005?tab=schedule', (state) => {
      state.projects.prj_005.status = 'on_hold';
    });
    const bar = (await screen.findByRole('slider', { name: 'Start of Concept' })).parentElement as HTMLElement;
    expect(bar).toHaveClass('bg-ink-2');
  });
});

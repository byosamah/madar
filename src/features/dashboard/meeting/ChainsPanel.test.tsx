import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';

/**
 * Shore Walk (prj_011) is the first project screen. "Stair details" is 5 days past due (4 working days late).
 * "Specifications draft" needs it and is dynamic, so it would move 4 working days. "Fixed handover" needs it and is static.
 */
const withChain = (state: State) => {
  state.projects.prj_011.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
  const ids = Object.values(state.tasks).filter((task) => task.projectId === 'prj_011').map((task) => task.id).sort();
  for (const id of ids) state.tasks[id].status = 'done';
  const set = (id: string, title: string, patch: Record<string, unknown>) =>
    Object.assign(state.tasks[id], { title, status: 'todo', ownerId: 'usr_003', startDate: null, dueDate: null, schedule: 'static', durationDays: null, prerequisiteIds: [], ...patch });
  set(ids[0], 'Stair details', { dueDate: '2026-09-25' });
  set(ids[1], 'Specifications draft', { prerequisiteIds: [ids[0]], schedule: 'dynamic', startDate: '2026-10-04', dueDate: '2026-10-07', durationDays: 4 });
  set(ids[2], 'Fixed handover', { prerequisiteIds: [ids[0]], startDate: '2026-10-04', dueDate: '2026-10-07' });
};

const noChains = (state: State) => {
  withChain(state);
  for (const task of Object.values(state.tasks)) if (task.projectId === 'prj_011') task.prerequisiteIds = [];
};

describe('what waits for what in the meeting (owner, 2026-10-02)', () => {
  it('shows one line for each task that waits for another task', async () => {
    await renderApp(MEETING, withChain);
    const panel = within(await screen.findByRole('region', { name: 'What waits' }));
    expect(panel.getByText('Specifications draft waits for Stair details')).toBeInTheDocument();
    expect(panel.getByText('Fixed handover waits for Stair details')).toBeInTheDocument();
  });

  it('shows how many working days a dynamic task moves if the late task finishes today', async () => {
    await renderApp(MEETING, withChain);
    const panel = within(await screen.findByRole('region', { name: 'What waits' }));
    // Start Sun 4 Oct moves 4 working days to Thu 8 Oct. The 4 day task then ends on Tue 13 Oct.
    expect(panel.getByText('If Stair details finishes today, Specifications draft moves 4 working days, to Tue 13 Oct.')).toBeInTheDocument();
    expect(panel.queryByText(/Fixed handover moves/)).toBeNull();
  });

  it('shows no What waits region when the project has no chains', async () => {
    await renderApp(MEETING, noChains);
    await screen.findByRole('article');
    expect(screen.queryByRole('region', { name: 'What waits' })).toBeNull();
  });
});

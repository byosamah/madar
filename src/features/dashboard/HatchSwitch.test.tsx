import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const LEGEND = 'Hatched: two stages run at the same time.';
const hatchOff = (state: State) => {
  const me = state.users[state.session.currentUserId];
  me.preferences = { ...me.preferences, hatchOverlap: false };
};

// The owner (2026-10-05, item 9): one personal switch beside the legend turns the hatch of two stages at the same time on and off.
describe('the hatch switch on the project schedule (owner, 2026-10-05, item 9)', () => {
  it('turns the hatch and its legend off and on again, and keeps the choice for the person', async () => {
    const { store } = await renderApp('/projects/prj_003?tab=schedule');
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    const toggle = within(chart).getByRole('switch', { name: 'Show the hatch' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(within(chart).getByText(LEGEND)).toBeInTheDocument();
    expect(chart.querySelectorAll('.overlap-hatch')).toHaveLength(2);

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(chart).queryByText(LEGEND)).toBeNull();
    expect(chart.querySelectorAll('.overlap-hatch')).toHaveLength(0);
    await waitFor(() => expect(store.state.users[store.state.session.currentUserId].preferences.hatchOverlap).toBe(false));

    await userEvent.click(within(chart).getByRole('switch', { name: 'Show the hatch' }));
    await waitFor(() => expect(chart.querySelectorAll('.overlap-hatch')).toHaveLength(2));
    expect(within(chart).getByText(LEGEND)).toBeInTheDocument();
  });

  it('draws no hatch for a person who turned it off, and keeps only the switch', async () => {
    await renderApp('/projects/prj_003?tab=schedule', hatchOff);
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    expect(within(chart).getByRole('switch', { name: 'Show the hatch' })).toHaveAttribute('aria-checked', 'false');
    expect(within(chart).queryByText(LEGEND)).toBeNull();
    expect(chart.querySelectorAll('.overlap-hatch')).toHaveLength(0);
    // The words in the stage list are not the hatch: they stay.
    expect(within(screen.getByRole('region', { name: 'Stages' })).getByText('Runs at the same time as Design Development')).toBeInTheDocument();
  });

  it('shows no switch when no two stages run at the same time', async () => {
    await renderApp('/projects/prj_001?tab=schedule');
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    expect(within(chart).queryByRole('switch')).toBeNull();
  });
});

describe('the hatch switch on the office schedule (owner, 2026-10-05, item 9)', () => {
  it('sits beside the legend, and off it hides the hatch and its legend word', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    await userEvent.click(within(schedule).getByRole('button', { name: /Eastern Shore Primary School/ }));
    expect(schedule.querySelectorAll('.overlap-hatch').length).toBeGreaterThan(1);
    expect(within(schedule).getByText('Two stages at the same time')).toBeInTheDocument();

    await userEvent.click(within(schedule).getByRole('switch', { name: 'Show the hatch' }));
    expect(schedule.querySelectorAll('.overlap-hatch')).toHaveLength(0);
    expect(within(schedule).queryByText('Two stages at the same time')).toBeNull();
    expect(within(schedule).getByRole('switch', { name: 'Show the hatch' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('the meeting view with the hatch off (owner, 2026-10-05, item 9)', () => {
  it('draws no hatch on the opened stage lines, and still says the overlap to a screen reader', async () => {
    await renderApp('/dashboard/meeting?status=all', hatchOff);
    const timeline = await screen.findByRole('list', { name: 'Project timeline' });
    const school = (await within(timeline).findAllByRole('button', { name: /Eastern Shore Primary School/ }))[0];
    const row = school.closest('li') as HTMLElement;
    await userEvent.click(school);
    expect(within(row).getByRole('group', { name: 'Stages of Eastern Shore Primary School' })).toBeInTheDocument();
    expect(row.querySelectorAll('.overlap-hatch')).toHaveLength(0);
    expect(within(row).getAllByRole('img', { name: 'Schematic Design and Design Development run at the same time' }).length).toBeGreaterThan(0);
  });
});

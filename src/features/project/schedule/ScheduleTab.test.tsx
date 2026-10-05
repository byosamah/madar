import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const SCHEDULE = '/projects/prj_001?tab=schedule';

describe('the Schedule tab', () => {
  it('draws the stages, today and the deadlines', async () => {
    await renderApp(SCHEDULE);
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    expect(within(chart).getByText('Construction Documents')).toBeInTheDocument();
    expect(within(chart).getByText('Today')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Deadlines' })).getByText('Balady submission')).toBeInTheDocument();
  });

  // The owner (2026-10-05): in Arabic, an English name also sits on the right. The cell follows the page; only the name has its own direction.
  it('gives only the stage name its own direction, so the cell follows the side of the page', async () => {
    await renderApp(SCHEDULE);
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    const name = within(chart).getByText('Construction Documents');
    expect(name.tagName).toBe('BDI');
    expect(name).toHaveAttribute('dir', 'auto');
    expect(name.parentElement).not.toHaveAttribute('dir');
  });

  it('draws every deadline diamond in the quiet grey of the Dashboard, not the Attention orange (audit 2026-10-03, V-24)', async () => {
    await renderApp(SCHEDULE);
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    const diamonds = [...chart.querySelectorAll('.rotate-45'), ...screen.getByRole('region', { name: 'Deadlines' }).querySelectorAll('.rotate-45')];
    expect(diamonds.length).toBeGreaterThan(1);
    for (const diamond of diamonds) {
      expect(diamond).toHaveClass('bg-ink-2');
      expect(diamond).not.toHaveClass('bg-attn');
    }
  });

  it('shows two stages that run at the same time: hatched on the chart and in words in the list', async () => {
    await renderApp('/projects/prj_003?tab=schedule');
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    expect(within(chart).getByText('Hatched: two stages run at the same time.')).toBeInTheDocument();
    expect(chart.querySelectorAll('.overlap-hatch')).toHaveLength(2);
    const list = screen.getByRole('region', { name: 'Stages' });
    expect(within(list).getByText('Runs at the same time as Design Development')).toBeInTheDocument();
    expect(within(list).getByText('Runs at the same time as Schematic Design')).toBeInTheDocument();
  });

  it('shows no overlap note for stages that follow each other', async () => {
    await renderApp(SCHEDULE);
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    expect(chart.querySelectorAll('.overlap-hatch')).toHaveLength(0);
    expect(within(chart).queryByText(/Hatched/)).toBeNull();
  });

  it('moves a stage end by one day with the arrow key, then undoes it', async () => {
    const { store } = await renderApp(SCHEDULE, as('usr_002'));
    const end = await screen.findByRole('slider', { name: 'End of Permits' });
    end.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(store.state.stages.stg_005.endDate).toBe('2026-11-02'));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.stages.stg_005.endDate).toBe('2026-11-01'));
  });

  it('shows no drag handles to a team member', async () => {
    await renderApp(SCHEDULE, as('usr_005'));
    await screen.findByRole('region', { name: 'Stage timeline' });
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('adds a deadline, deletes it, and brings it back with Undo', async () => {
    const { store } = await renderApp(SCHEDULE, as('usr_002'));
    await userEvent.type(await screen.findByLabelText('Deadline name'), 'Client meeting');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-20' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add deadline' }));
    const deadlines = screen.getByRole('region', { name: 'Deadlines' });
    expect(await within(deadlines).findByText('Client meeting')).toBeInTheDocument();
    await userEvent.click(within(deadlines).getByRole('button', { name: 'Delete Client meeting' }));
    const exists = () => Object.values(store.state.deadlines).some((d) => d.name === 'Client meeting');
    await waitFor(() => expect(exists()).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(exists()).toBe(true));
  });

  it('says when there are no dates yet', async () => {
    await renderApp(SCHEDULE, (state) => {
      for (const stage of Object.values(state.stages)) {
        if (stage.projectId !== 'prj_001') continue;
        stage.startDate = null;
        stage.endDate = null;
      }
      for (const [id, deadline] of Object.entries(state.deadlines)) if (deadline.projectId === 'prj_001') delete state.deadlines[id];
    });
    expect(await screen.findByText('Add stage dates or a deadline to see the timeline.')).toBeInTheDocument();
  });

  it('moves a stage end by three days for three quick arrow presses, and saves once', async () => {
    const { store } = await renderApp(SCHEDULE, as('usr_002'), { latencyMs: 60 });
    const end = await screen.findByRole('slider', { name: 'End of Permits' });
    end.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    await waitFor(() => expect(store.state.stages.stg_005.endDate).toBe('2026-11-04'), { timeout: 3000 });
    expect(Object.values(store.state.events).filter((e) => e.verb === 'stage.dates_changed')).toHaveLength(1);
  });

  it('saves a typed stage date once, when the person leaves the field', async () => {
    const { store } = await renderApp(SCHEDULE, as('usr_002'));
    await screen.findByRole('slider', { name: 'End of Permits' });
    const start = document.getElementById('start-stg_005') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '0002-09-29' } });
    fireEvent.change(start, { target: { value: '2026-09-29' } });
    expect(store.state.stages.stg_005.startDate).toBe('2026-09-28');
    fireEvent.blur(start);
    await waitFor(() => expect(store.state.stages.stg_005.startDate).toBe('2026-09-29'));
    expect(Object.values(store.state.events).filter((e) => e.verb === 'stage.dates_changed')).toHaveLength(1);
  });
});

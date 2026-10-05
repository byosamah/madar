import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const SCHEDULE = '/projects/prj_001?tab=schedule';
const leader = (state: State) => {
  state.session.currentUserId = 'usr_002';
};
/** Permits of the first project with no start date. */
const noPermitsStart = (state: State) => {
  leader(state);
  state.stages.stg_005.startDate = null;
};

async function stageList() {
  return screen.findByRole('region', { name: 'Stages' }, { timeout: 10_000 });
}

// The owner (2026-10-05, item 8): one row for each stage, the stage name at the start, then two columns Start and End that line
// up for all rows, with the column names once at the top. An empty date is a quiet "Set date…" button.
describe('the stage dates editor (owner, 2026-10-05, item 8)', () => {
  afterEach(() => {
    delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker;
  });

  it('names the columns Start and End once, and gives each stage one row with its name at the start', async () => {
    await renderApp(SCHEDULE, leader);
    const list = await stageList();
    expect(within(list).getAllByText('Start')).toHaveLength(1);
    expect(within(list).getAllByText('End')).toHaveLength(1);
    const rows = within(list).getAllByRole('listitem');
    expect(rows.length).toBe(7);
    const permits = rows.find((row) => within(row).queryByText('Permits'));
    expect(permits).toBeDefined();
    // The row is one grid with the same columns as the column names, so the dates line up.
    const header = within(list).getByText('Start').parentElement as HTMLElement;
    expect(permits!.className).toContain('sm:grid-cols-[minmax(0,1fr)_10rem_10rem]');
    expect(header.className).toContain('sm:grid-cols-[minmax(0,1fr)_10rem_10rem]');
    expect(within(permits!).getByLabelText('Start of Permits')).toBeInTheDocument();
    expect(within(permits!).getByLabelText('End of Permits')).toBeInTheDocument();
  });

  it('shows "Set date…" for an empty date, and a press with the picker saves the picked date', async () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { value: showPicker, configurable: true, writable: true });
    const { store } = await renderApp(SCHEDULE, noPermitsStart);
    const list = await stageList();
    const permits = within(list).getAllByRole('listitem').find((row) => within(row).queryByText('Permits'))!;
    expect(within(permits).getByText('Set date…')).toBeInTheDocument();
    const start = within(permits).getByLabelText('Start of Permits');
    await userEvent.click(start);
    expect(showPicker).toHaveBeenCalled();
    fireEvent.change(start, { target: { value: '2026-10-10' } });
    await waitFor(() => expect(store.state.stages.stg_005.startDate).toBe('2026-10-10'));
    expect(Object.values(store.state.events).filter((e) => e.verb === 'stage.dates_changed')).toHaveLength(1);
  });

  it('clears a set date with its small control, and brings it back with Undo', async () => {
    const { store } = await renderApp(SCHEDULE, leader);
    const list = await stageList();
    const before = store.state.stages.stg_005.endDate;
    await userEvent.click(within(list).getByRole('button', { name: 'Clear End of Permits' }));
    await waitFor(() => expect(store.state.stages.stg_005.endDate).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.stages.stg_005.endDate).toBe(before));
  });
});

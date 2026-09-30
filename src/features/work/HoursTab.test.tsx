import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { ApiError } from '../../api/errors';
import { renderApp } from '../../test/render';

const asSara = (state: State) => {
  state.session.currentUserId = 'usr_005';
};
const HOURS = '/work?tab=hours';
const LAST = '/work?tab=hours&week=2026-09-20';
const cells = () => screen.findAllByRole('textbox', { name: /^Hours for / });

describe('the Hours tab', () => {
  it('shows this week with row, day and week totals against the target', async () => {
    await renderApp(HOURS, asSara);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/of 40 h$/)).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Day total' })).toBeInTheDocument();
  });

  it('says when a week has no rows', async () => {
    await renderApp(HOURS, (state) => {
      asSara(state);
      for (const [id, entry] of Object.entries(state.time)) if (entry.userId === 'usr_005') delete state.time[id];
    });
    expect(await screen.findByText('No hours this week')).toBeInTheDocument();
  });

  it('saves a cell with Enter, and reads a comma as the decimal point', async () => {
    const { store } = await renderApp(LAST, asSara);
    const [first] = await cells();
    await userEvent.clear(first);
    await userEvent.type(first, '7,5{Enter}');
    await waitFor(() => expect(Object.values(store.state.time).some((e) => e.userId === 'usr_005' && e.date === '2026-09-20' && e.hours === 7.5)).toBe(true));
  });

  it('refuses a value off the half-hour steps and saves nothing', async () => {
    const { store } = await renderApp(LAST, asSara);
    const before = JSON.stringify(store.state.time);
    const [first] = await cells();
    await userEvent.clear(first);
    await userEvent.type(first, '2.3{Enter}');
    expect(await screen.findByText('Use steps of 0.5, from 0 to 24.')).toBeInTheDocument();
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(JSON.stringify(store.state.time)).toBe(before);
  });

  it('locks a week that ended more than 14 days ago', async () => {
    await renderApp('/work?tab=hours&week=2026-08-30', asSara);
    expect(await screen.findByText('This week is locked. Ask the Admin to unlock it.')).toBeInTheDocument();
    for (const cell of await cells()) expect(cell).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
  });

  it('keeps Friday and Saturday folded until asked', async () => {
    await renderApp(LAST, asSara);
    await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: 'Show Friday and Saturday' }));
    expect(screen.getAllByRole('columnheader')).toHaveLength(10);
  });

  it('adds a row, then removes it while it is empty', async () => {
    const { store } = await renderApp(HOURS, asSara);
    await userEvent.click(await screen.findByRole('button', { name: 'Add row' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a row' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Project'), 'KH-26-001 · Corniche Office Tower');
    await userEvent.selectOptions(within(sheet).getByLabelText('Stage'), 'Permits');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add row' }));
    const remove = await screen.findByRole('button', { name: 'Remove KH-26-001 · Permits' });
    expect(Object.values(store.state.timeRows).some((row) => row.userId === 'usr_005' && row.stageId === 'stg_005')).toBe(true);
    await userEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove KH-26-001 · Permits' })).toBeNull());
  });

  it("copies last week's rows", async () => {
    await renderApp(HOURS, asSara);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy last week' }));
    expect(await screen.findByText("Last week's rows are added.")).toBeInTheDocument();
  });

  it("opens this week from a task's Log time, with the cursor in today's cell", async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_012', asSara);
    const sheet = await screen.findByRole('dialog', { name: 'Civil Defense drawings' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Log time' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My Work' })).toBeInTheDocument();
    const today = await screen.findByRole('textbox', { name: 'Hours for KH-26-001 · Permits · Civil Defense drawings on 30 September 2026' });
    await waitFor(() => expect(today).toHaveFocus());
  });

  it('puts the saved value back when a save fails', async () => {
    const { api } = await renderApp(LAST, asSara);
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: { correlationId?: string }) => {
      if (name === 'time.set' && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    const [first] = await cells();
    const before = (first as HTMLInputElement).value;
    await userEvent.clear(first);
    await userEvent.type(first, '3{Enter}');
    await screen.findByText('Something went wrong. Try again.');
    await waitFor(() => expect(first).toHaveValue(before));
  });

  it('refuses more than 24 hours in one day with its own message', async () => {
    const { store } = await renderApp(LAST, asSara);
    const before = JSON.stringify(store.state.time);
    const sunday = (await cells()).filter((cell) => /20 September 2026/.test(cell.getAttribute('aria-label') ?? ''));
    const logged = sunday.reduce((sum, cell) => sum + Number((cell as HTMLInputElement).value || 0), 0);
    expect(logged).toBeGreaterThan(0);
    const empty = sunday.find((cell) => (cell as HTMLInputElement).value === '') ?? sunday[0];
    await userEvent.clear(empty);
    await userEvent.type(empty, '24{Enter}');
    expect(await screen.findByText('A day cannot have more than 24 hours.')).toBeInTheDocument();
    expect(empty).toHaveAttribute('aria-invalid', 'true');
    expect(JSON.stringify(store.state.time)).toBe(before);
  });
});

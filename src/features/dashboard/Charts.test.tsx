import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';
import { yAxisTick } from './Charts';

const chart = (name: string) => screen.findByRole('region', { name });

describe('the Dashboard charts', () => {
  it('links each stage bar to the Projects screen with that stage', async () => {
    await renderApp('/dashboard');
    await userEvent.click(within(await chart('Projects per stage')).getByRole('link', { name: /Construction Documents/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects?stage=Construction%20Documents'));
    await userEvent.click(await screen.findByRole('button', { name: 'Filter, 1 active' }));
    expect(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Stage' })).toHaveValue('Construction Documents');
  });

  // The Health mix card repeated the "At risk or late" number, so it left the screen. dashboard.get keeps healthMix for agents (owner, 2026-10-06).
  it('shows no Health mix card', async () => {
    await renderApp('/dashboard');
    await chart('Projects per stage');
    expect(screen.queryByRole('region', { name: 'Health mix' })).toBeNull();
  });

  // The "0" at the foot of the axis touched the first week label ("19 يوليو" in Arabic). The bars start at the base line.
  it('writes no "0" on the axis of the weekly chart, and every other number as it is', () => {
    expect(yAxisTick(0)).toBe('');
    expect(yAxisTick(8)).toBe('8');
    expect(yAxisTick(32)).toBe('32');
  });

  it('gives the weekly chart a table with 12 weeks and links', async () => {
    await renderApp('/dashboard');
    const throughput = await chart('Tasks done and created per week');
    expect(within(throughput).getAllByRole('row')).toHaveLength(13);
    await userEvent.click(within(throughput).getAllByRole('link', { name: /Done/ })[11]);
    await waitFor(() => expect(window.location.hash).toContain('doneFrom='));
  });

  it('says so in every chart and the schedule when the filters leave nothing to draw', async () => {
    const first = await renderApp('/dashboard?client=cli_999');
    await chart('Projects per stage');
    expect(screen.getAllByText('No data for these filters.')).toHaveLength(2);
    first.unmount();
    await renderApp('/dashboard?client=cli_999&view=schedule');
    expect(await within(await screen.findByRole('region', { name: 'Office schedule' })).findByText('No data for these filters.')).toBeInTheDocument();
  });

});

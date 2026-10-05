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

  it('shows the health mix with a word and a number for each color', async () => {
    await renderApp('/dashboard');
    const health = await chart('Health mix');
    expect(within(health).getByRole('link', { name: /Late/ })).toHaveTextContent('2');
    expect(within(health).getByRole('link', { name: /At risk/ })).toHaveTextContent('3');
  });

  // In Arabic "معرّض للتأخر" wraps in the middle tile; centred tiles then put its number higher than the others (2026-10-05).
  it('puts the three health numbers on one line, also when a word wraps', async () => {
    await renderApp('/dashboard');
    for (const link of within(await chart('Health mix')).getAllByRole('link')) {
      expect(link).toHaveClass('justify-start');
      expect(link).not.toHaveClass('justify-center');
      // The three tiles share one height, also when one word wraps.
      expect(link).toHaveClass('h-full');
    }
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
    expect(screen.getAllByText('No data for these filters.')).toHaveLength(3);
    first.unmount();
    await renderApp('/dashboard?client=cli_999&view=schedule');
    expect(await within(await screen.findByRole('region', { name: 'Office schedule' })).findByText('No data for these filters.')).toBeInTheDocument();
  });

  it('opens exactly the projects behind each health number', async () => {
    for (const [word, n] of [['Late', 2], ['At risk', 3], ['On track', 4]] as const) {
      const view = await renderApp('/dashboard');
      await userEvent.click(within(await chart('Health mix')).getByRole('link', { name: new RegExp(word) }));
      await waitFor(() => expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem')).toHaveLength(n));
      view.unmount();
    }
  });
});

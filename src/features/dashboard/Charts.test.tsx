import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

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
    for (const [word, n] of [['Late', 2], ['At risk', 3], ['On track', 5]] as const) {
      const view = await renderApp('/dashboard');
      await userEvent.click(within(await chart('Health mix')).getByRole('link', { name: new RegExp(word) }));
      await waitFor(() => expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem')).toHaveLength(n));
      view.unmount();
    }
  });
});

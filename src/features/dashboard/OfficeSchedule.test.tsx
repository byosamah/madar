import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the office schedule', () => {
  it('lists the active projects by target end date, each a link', async () => {
    await renderApp('/dashboard');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    const links = within(schedule).getAllByRole('link');
    expect(links).toHaveLength(10);
    await userEvent.click(within(schedule).getByRole('link', { name: /Corniche Office Tower/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('keeps the zoom for the next visit', async () => {
    const first = await renderApp('/dashboard');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    await userEvent.click(within(schedule).getByRole('radio', { name: 'Month' }));
    first.unmount();
    await renderApp('/dashboard');
    const again = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(again).getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });

  it('names every color and mark in a legend', async () => {
    await renderApp('/dashboard');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    for (const word of ['Done stages', 'Current stage', 'Next stages', 'Deadline', 'Today']) expect(within(schedule).getAllByText(word).length).toBeGreaterThan(0);
  });
});

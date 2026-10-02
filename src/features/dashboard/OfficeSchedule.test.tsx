import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the office schedule', () => {
  it('lists the active projects by target end date, each a link', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    const links = within(schedule).getAllByRole('link');
    expect(links).toHaveLength(9);
    await userEvent.click(within(schedule).getByRole('link', { name: /Open Corniche Office Tower/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('shows a project on one line and opens it to one line for each stage, with an overlap hatched', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    const school = within(schedule).getByRole('button', { name: /Eastern Shore Primary School/ });
    expect(school).toHaveAttribute('aria-expanded', 'false');
    expect(within(schedule).queryByText('Design Development')).toBeNull();
    const hatched = schedule.querySelectorAll('.overlap-hatch').length;
    await userEvent.click(school);
    expect(school).toHaveAttribute('aria-expanded', 'true');
    expect(within(schedule).getByText('Design Development')).toBeInTheDocument();
    expect(schedule.querySelectorAll('.overlap-hatch').length).toBeGreaterThan(hatched);
    await userEvent.click(school);
    expect(school).toHaveAttribute('aria-expanded', 'false');
    expect(within(schedule).queryByText('Design Development')).toBeNull();
  });

  it('keeps the zoom for the next visit', async () => {
    const first = await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    await userEvent.click(within(schedule).getByRole('radio', { name: 'Month' }));
    first.unmount();
    await renderApp('/dashboard?view=schedule');
    const again = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(again).getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });

  it('names every color and mark in a legend', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    for (const word of ['Done stages', 'Current stage', 'Next stages', 'Deadline', 'Today', 'Two stages at the same time']) expect(within(schedule).getAllByText(word).length).toBeGreaterThan(0);
  });
});

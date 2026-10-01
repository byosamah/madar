import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const next = () => screen.findByRole('region', { name: 'Next for you' });

describe('Home', () => {
  it('greets the person, shows the date and the day ring', async () => {
    await renderApp('/', as('usr_005'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Good morning, Sara' })).toBeInTheDocument();
    expect(screen.getByText(/30 September/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '1 of 2 done today' })).toBeInTheDocument();
  });

  it('offers the oldest past-due task as the one next thing', async () => {
    await renderApp('/', as('usr_005'));
    const card = await next();
    expect(within(card).getByText('Finish “Facade details”')).toBeInTheDocument();
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['Open task', 'Focus']);
    await userEvent.click(within(card).getByRole('button', { name: 'Open task' }));
    expect(await screen.findByRole('dialog', { name: 'Facade details' })).toBeInTheDocument();
  });

  it('offers a leader the review that waits for them', async () => {
    await renderApp('/', as('usr_002'));
    const card = await next();
    expect(within(card).getByText('Approve “Toilet details”')).toBeInTheDocument();
    expect(within(card).getByText('Corniche Office Tower')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog', { name: 'Toilet details' })).toBeInTheDocument();
  });

  it("lists today's tasks and the person's projects", async () => {
    await renderApp('/', as('usr_006'));
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByText('Stair details')).toBeInTheDocument();
    expect(within(today).getByText('Permit tracker update')).toBeInTheDocument();
    expect(within(today).queryByText('Section set')).toBeNull();
    const projects = screen.getByRole('region', { name: 'Your projects' });
    expect(within(projects).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    await userEvent.click(within(projects).getByRole('link', { name: 'All projects' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects'));
  });

  it('says so when there is nothing to do, with no button and no ring', async () => {
    await renderApp('/', (state) => {
      as('usr_005')(state);
      for (const task of Object.values(state.tasks)) task.status = 'done';
    });
    const card = await next();
    expect(within(card).getByText('You are all caught up.')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Today' })).getByText('Nothing is due today.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: /done today/ })).toBeNull();
  });

  it('shows the Admin every active project, and the review waiting for them', async () => {
    await renderApp('/');
    expect(within(await next()).getByText('Approve “Authority comments response”')).toBeInTheDocument();
    const projects = screen.getByRole('region', { name: 'Your projects' });
    await waitFor(() => expect(within(projects).getAllByRole('listitem')).toHaveLength(10));
  });

  it('says what is left only after the person finishes something', async () => {
    await renderApp('/', as('usr_006'));
    const card = await next();
    expect(within(card).queryByText(/more today/)).toBeNull();
    const today = screen.getByRole('region', { name: 'Today' });
    await userEvent.click(within(today).getByRole('checkbox', { name: 'Complete Stair details' }));
    expect(await within(card).findByText(/^Done\. \d+ more today\.$/, {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('keeps one main button on the screen', async () => {
    await renderApp('/', as('usr_005'));
    await next();
    expect(document.querySelectorAll('main .signature')).toHaveLength(1);
    expect(document.querySelectorAll('main .glow')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TEAM = '/projects/prj_001?tab=team';

describe('the Team tab', () => {
  it('shows the leader, the members, and their open tasks', async () => {
    await renderApp(TEAM, as('usr_002'));
    const leader = await screen.findByRole('region', { name: 'Leader' });
    expect(within(leader).getByText('Faisal Al-Harbi')).toBeInTheDocument();
    const members = screen.getByRole('region', { name: 'Members' });
    const sara = within(members).getByText('Sara Al-Qahtani').closest('li') as HTMLElement;
    expect(within(sara).getByText('Open tasks: 2')).toBeInTheDocument();
  });

  it('shows a person outside the project no actions', async () => {
    await renderApp(TEAM, as('usr_003'));
    await screen.findByRole('region', { name: 'Members' });
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Add member' })).toBeNull();
  });

  it('adds a member, then removes them and brings them back with Undo', async () => {
    const { store } = await renderApp(TEAM, as('usr_002'));
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'Lina Mansour');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const members = screen.getByRole('region', { name: 'Members' });
    expect(await within(members).findByText('Lina Mansour')).toBeInTheDocument();
    await userEvent.click(within(members).getByRole('button', { name: 'Actions for Lina Mansour' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from team' }));
    await waitFor(() => expect(store.state.members['prj_001:usr_007']).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.members['prj_001:usr_007']).toBeDefined());
  });

  it('saves a new discipline when the leader leaves the field', async () => {
    const { store } = await renderApp(TEAM, as('usr_002'));
    const field = await screen.findByLabelText('Discipline of Yousef Saleh');
    await userEvent.clear(field);
    await userEvent.type(field, 'MEP lead');
    await userEvent.tab();
    await waitFor(() => expect(store.state.members['prj_001:usr_006'].discipline).toBe('MEP lead'));
  });

  it('keeps the full name on a phone: the discipline field takes its own line under the name (owner, 2026-10-05)', async () => {
    // A 160 px field on the name line left the name about 80 px at 390 px ("Fais..."). jsdom has no layout, so the test guards the
    // classes that wrap the field: full width under the name on a phone, 10rem on the line from the sm width up.
    await renderApp(TEAM, as('usr_002'));
    const field = await screen.findByLabelText('Discipline of Yousef Saleh');
    expect(field.className.split(' ')).toEqual(expect.arrayContaining(['order-last', 'ms-12', 'w-[calc(100%-3rem)]', 'sm:order-none', 'sm:ms-0', 'sm:w-40']));
  });
});

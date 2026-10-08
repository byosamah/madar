import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../api/store';
import { renderRemoteApp } from '../../test/renderRemote';
import { HOME_MINE } from './minePlaceholder';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
/** The list of the Tasks screen: my tasks without the done ones. */
const isTasksList = (name: string, input: unknown) => name === 'tasks.list'
  && (input as { filter?: string }).filter === 'mine' && (input as { includeDone?: boolean }).includeDone === false;

describe('Tasks after Home in the real build (performance audit 2026-10-07, FET-9)', () => {
  it('shows the open rows of the Home list at once, while its own list loads', async () => {
    let holding = true;
    const { router, release, sent } = await renderRemoteApp('/', as('usr_005'), { hold: (name, input) => holding && isTasksList(name, input) });
    await screen.findByRole('region', { name: 'Next for you' });
    await act(() => router.navigate('/work'));
    // The answer of the Tasks list still waits, and the rows are on screen.
    expect(within(await screen.findByRole('region', { name: 'Later' })).getByText('Civil Defense drawings')).toBeInTheDocument();
    expect(sent.filter((call) => isTasksList(call.name, call.input))).toHaveLength(1);
    holding = false;
    release();
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Today' })).getByText('Toilet details')).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'Later' })).getByText('Civil Defense drawings')).toBeInTheDocument();
  });

  it('waits for its own list when a change marked the Home list', async () => {
    let holding = true;
    const { router, release, queryClient } = await renderRemoteApp('/', as('usr_005'), { hold: (name, input) => holding && isTasksList(name, input) });
    await screen.findByRole('region', { name: 'Next for you' });
    await act(() => queryClient.invalidateQueries({ queryKey: HOME_MINE, refetchType: 'none' }));
    await act(() => router.navigate('/work'));
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 50); }));
    expect(screen.queryByRole('region', { name: 'Later' })).toBeNull();
    holding = false;
    release();
    expect(within(await screen.findByRole('region', { name: 'Later' })).getByText('Civil Defense drawings')).toBeInTheDocument();
  });
});

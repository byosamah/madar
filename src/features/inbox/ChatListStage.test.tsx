import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGroupConversation } from '../../api/chatState';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The Inbox list mounts its first rows at once and the rest at an idle moment (performance audit 2026-10-21, RN-2). The sample office has
 * 17 chats. The test adds 150 groups, as a busy office holds after some months: 167 rows were 4,444 nodes at the first paint.
 */
const GROUPS = 150;
const FIRST = 40;

function groups(state: State) {
  for (let n = 1; n <= GROUPS; n += 1) {
    const stamp = `2026-09-${String(1 + (n % 28)).padStart(2, '0')}T${String(8 + (n % 9)).padStart(2, '0')}:00:00.000+03:00`;
    const group = addGroupConversation(state, `Group ${n}`, 'usr_001', ['usr_001', 'usr_002'], stamp);
    const id = `msg_7${String(n).padStart(3, '0')}`;
    state.messages[id] = { id, conversationId: group.id, authorId: 'usr_002', actingForId: 'usr_002', body: `Hello ${n}`, mentions: [], createdAt: stamp, editedAt: null };
  }
}

const rowsOf = (list: HTMLElement) => list.querySelectorAll(':scope > li');

describe('the Inbox list of a busy office (RN-2)', () => {
  it('mounts the first 40 rows at once and the others after the first paint, in the same order', async () => {
    await renderApp('/inbox', groups);
    const list = await screen.findByRole('list', { name: 'Chats' });
    // The first paint holds 40 rows. Before the fix it held all of them.
    await waitFor(() => expect(rowsOf(list).length).toBeGreaterThan(0));
    expect(rowsOf(list).length).toBe(FIRST);
    const firstTitles = [...rowsOf(list)].map((row) => row.querySelector('a')?.getAttribute('href'));
    // Then the rest comes.
    await waitFor(() => expect(rowsOf(list).length).toBeGreaterThanOrEqual(GROUPS + 17 - 3), { timeout: 5000 });
    const all = [...rowsOf(list)].map((row) => row.querySelector('a')?.getAttribute('href'));
    expect(all.slice(0, FIRST)).toEqual(firstTitles);
    expect(new Set(all).size).toBe(all.length);
    expect(within(list).getByRole('link', { name: /Group 150/ })).toBeInTheDocument();
  });

  it('draws a short search result in full, after the list was staged', async () => {
    await renderApp('/inbox', groups);
    const list = await screen.findByRole('list', { name: 'Chats' });
    await waitFor(() => expect(rowsOf(list).length).toBeGreaterThan(FIRST), { timeout: 5000 });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'Group 14');
    await waitFor(() => expect(rowsOf(list).length).toBeLessThan(FIRST));
    expect(within(list).getAllByRole('link', { name: /Group 14/ })).toHaveLength(11);
  });

  it('does not stage a short list', async () => {
    await renderApp('/inbox');
    const list = await screen.findByRole('list', { name: 'Chats' });
    await within(list).findByRole('link', { name: /Corniche Office Tower/ });
    expect(rowsOf(list).length).toBeGreaterThan(3);
    expect(rowsOf(list).length).toBeLessThan(FIRST);
  });
});

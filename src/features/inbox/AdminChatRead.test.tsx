import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chatReadKey } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The open of a chat marks it read also when its row counts nothing (chat design item 23). Hala is the Admin. She is not on the team of the
 * Corniche Office Tower project, so its chat counts only the messages that name her, and the sample talk names nobody of them.
 */
const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });

describe('the Admin opens a project chat outside her projects', () => {
  it('marks a project chat outside the Admin projects read when it opens, though its row counts nothing', async () => {
    const { store } = await renderApp('/inbox');
    const newest = Object.values(store.state.messages).filter((m) => m.conversationId === 'cnv_001').map((m) => m.createdAt).sort().at(-1)!;
    const row = await rowLink(/Corniche Office Tower/);
    expect(within(row).queryByText(/^Unread:/)).toBeNull();
    expect(store.state.chatReads[chatReadKey('cnv_001', 'usr_001')].lastReadAt < newest).toBe(true);
    await userEvent.click(row);
    await screen.findByRole('log', { name: 'Messages' });
    await waitFor(() => expect(store.state.chatReads[chatReadKey('cnv_001', 'usr_001')].lastReadAt >= newest).toBe(true));
  });

  it('does the same in the Arabic screen, right to left', async () => {
    const { store } = await renderApp('/inbox', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const newest = Object.values(store.state.messages).filter((m) => m.conversationId === 'cnv_001').map((m) => m.createdAt).sort().at(-1)!;
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await screen.findAllByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getAllByRole('link', { name: /Corniche Office Tower/ }).find((link) => link.getAttribute('href')?.endsWith('/inbox/cnv_001'))!);
    await screen.findByRole('log');
    await waitFor(() => expect(store.state.chatReads[chatReadKey('cnv_001', 'usr_001')].lastReadAt >= newest).toBe(true));
    expect(document.documentElement.dir).toBe('rtl');
  });
});

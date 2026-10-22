import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

/**
 * The row "Everyone" of the mention list in the Inbox (owner, 2026-10-22, fbk_041) and the chip of the words in a bubble. Hala (usr_001) is
 * the Admin of the sample office. The project chat of Corniche Office Tower (prj_001) has a leader and a team.
 */

async function openTower() {
  await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Corniche Office Tower/ }));
  return screen.findByRole('textbox', { name: 'Message' });
}

describe('the Everyone row in a project chat', () => {
  it('shows first after an @, with the count of the team, and puts @everyone into the box', async () => {
    await renderApp('/inbox');
    const box = await openTower();
    await userEvent.type(box, 'Hello @');
    const first = (await screen.findAllByRole('option'))[0];
    expect(first).toHaveTextContent(/^Everyone · \d+ people$/);
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Hello @everyone ');
  });

  it('is off for a person without "Mention everyone"', async () => {
    await renderApp('/inbox', (state) => {
      state.settings.roles = { off: { management: ['chat.mentionEveryone'], member: ['chat.mentionEveryone'] } };
      state.session.currentUserId = 'usr_002';
    });
    const box = await openTower();
    await userEvent.type(box, 'Hello @');
    await screen.findAllByRole('option');
    expect(screen.queryByText(/^Everyone ·/)).toBeNull();
  });
});

describe('a sent @everyone', () => {
  it('shows as a mention chip in the bubble and reaches the team', async () => {
    const { store } = await renderApp('/inbox');
    const box = await openTower();
    // The first Enter picks the row Everyone, as it picks a name. The second Enter sends.
    await userEvent.type(box, 'Review at noon @everyone');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'Review at noon @everyone' && m.mentions.length > 0)).toBe(true));
    const bubble = (await screen.findAllByText(/Review at noon/)).find((node) => node.closest('p') !== null)!;
    const chip = within(bubble.closest('p')!).getByText('@everyone');
    expect(chip).toHaveClass('text-link');
    const message = Object.values(store.state.messages).find((m) => m.body === 'Review at noon @everyone')!;
    expect(message.mentions).not.toContain('usr_001');
    expect(Object.values(store.state.notifications).filter((n) => n.messageId === message.id && n.everyone).length).toBe(message.mentions.length);
  });
});

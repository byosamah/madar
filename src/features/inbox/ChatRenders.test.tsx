import { createElement, memo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import type { State } from '../../api/store';

// Render counts of a busy chat (performance audit 2026-10-21, RN-4). A chat at its limit of 200 messages slides its page by one
// when a message comes. Before the fix every bubble rendered again.
const counts = vi.hoisted(() => ({ bubbles: 0 }));
vi.mock('./MessageBubble', async (importOriginal) => {
  const real = await importOriginal<typeof import('./MessageBubble')>();
  return {
    ...real,
    MessageBubble: memo((props: Parameters<typeof real.MessageBubble>[0]) => {
      counts.bubbles += 1;
      return createElement(real.MessageBubble, props);
    }),
  };
});

const OLD = 200;
function busyChat(state: State) {
  const room = Object.values(state.conversations).find((c) => c.projectId === 'prj_001')!;
  const others = Object.values(state.users).filter((u) => u.kind === 'human' && u.id !== 'usr_001').map((u) => u.id);
  for (let n = 1; n <= OLD; n += 1) {
    const author = others[n % 3]!;
    state.messages[`msg_${5000 + n}`] = {
      id: `msg_${5000 + n}`, conversationId: room.id, authorId: author, actingForId: author, body: `Old note ${n} with some words in a line`,
      mentions: [], fileIds: [], createdAt: `2026-08-02T${String(6 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00.000+03:00`, editedAt: null,
    };
  }
}

async function settled(): Promise<number> {
  let last = -1;
  while (last !== counts.bubbles) {
    last = counts.bubbles;
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 60); }));
  }
  return counts.bubbles;
}

describe('a chat at its limit of 200 messages (RN-4)', () => {
  it('renders one bubble when a message comes, not the whole page', async () => {
    const { store, queryClient, router } = await renderApp('/inbox', busyChat);
    await screen.findByRole('list', { name: 'Chats' });
    const room = Object.values(store.state.conversations).find((c) => c.projectId === 'prj_001')!;
    await act(async () => { await router.navigate(`/inbox/${room.id}`); });
    await screen.findByRole('log', { name: 'Messages' });
    await screen.findByText(/Old note 200 /);
    const before = await settled();
    expect(before).toBeGreaterThanOrEqual(200);
    store.state.messages['msg_9001'] = {
      id: 'msg_9001', conversationId: room.id, authorId: 'usr_003', actingForId: 'usr_003', body: 'A brand new message', mentions: [], createdAt: '2026-10-21T10:00:00.000+03:00', editedAt: null,
    };
    await act(async () => {
      for (const name of ['chats.messages', 'chats.list', 'chats.unreadCount']) await queryClient.invalidateQueries({ queryKey: ['api', name] });
    });
    await waitFor(() => expect(screen.getByRole('log', { name: 'Messages' }).textContent).toContain('A brand new message'), { timeout: 15_000 });
    const after = await settled();
    // Before the fix this was 200. The new bubble is the one render; one more is room for a neighbour.
    expect(after - before).toBeLessThanOrEqual(2);
  }, 120_000);
});

import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeLive } from '../../test/fakeLive';
import { renderApp } from '../../test/render';

/** The typing signal of the sender and the line in the open chat (chat presence design B1 to B3 and B6, F4). */
const typingCalls = (call: { mock: { calls: unknown[][] } }) => call.mock.calls.filter(([name]) => name === 'chats.typing').map(([, input]) => input);

describe('typing in the open chat', () => {
  it('sends chats.typing once for fast keys, and a stop at Send', async () => {
    const live = fakeLive();
    const { api } = await renderApp('/inbox', undefined, { live: live.port });
    await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Reem Al-Ghamdi/ }));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    const call = vi.spyOn(api, 'call');
    await userEvent.type(box, 'Hello there');
    const id = (typingCalls(call)[0] as { conversationId: string }).conversationId;
    expect(typingCalls(call)).toEqual([{ conversationId: id, typing: true }]);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(typingCalls(call)).toEqual([{ conversationId: id, typing: true }, { conversationId: id, typing: false }]));
  });

  it('shows the line of a typist above the box, and takes it away at the stop', async () => {
    const live = fakeLive();
    const { store } = await renderApp('/inbox', undefined, { live: live.port });
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_003') && c.memberIds.includes('usr_001'))!;
    await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Reem Al-Ghamdi/ }));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    act(() => live.emitTyping({ v: 1, conversationId: room.id, userId: 'usr_003', typing: true, at: new Date().toISOString() }));
    const line = await screen.findByText('Reem is typing...');
    // The line sits before the message box in the pane.
    expect(line.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => live.emitTyping({ v: 1, conversationId: room.id, userId: 'usr_003', typing: false, at: new Date().toISOString() }));
    await waitFor(() => expect(screen.queryByText('Reem is typing...')).toBeNull());
  });

  it('shows no typing line and sends no signal in a task thread', async () => {
    const live = fakeLive();
    const { api } = await renderApp('/inbox/tsk_001', undefined, { live: live.port });
    const call = vi.spyOn(api, 'call');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }, { timeout: 10_000 }), 'Hi');
    expect(typingCalls(call)).toHaveLength(0);
    expect(screen.queryByTestId('typing-line')).toBeNull();
  }, 30_000);
});

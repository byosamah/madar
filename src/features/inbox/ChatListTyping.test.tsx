import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { TypingSignal } from '../../api/remote/wire';
import { fakeLive } from '../../test/fakeLive';
import { renderApp } from '../../test/render';

/** The typing row of the chat list (chat presence design B2, F4). Faisal is usr_002, Reem usr_003, the person on the screen Hala usr_001. */
const signal = (conversationId: string, userId: string, typing = true): TypingSignal => ({ v: 1, conversationId, userId, typing, at: new Date().toISOString() });
const rowOf = async (name: RegExp, list = 'Chats') => within(await screen.findByRole('list', { name: list })).getByRole('link', { name });

describe('the typing row', () => {
  it('shows typing... in a direct row and Reem is typing... in a project row, then the last message again', async () => {
    const live = fakeLive();
    const { store } = await renderApp('/inbox', undefined, { live: live.port });
    const faisalChat = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_002') && c.memberIds.includes('usr_001'))!;
    const tower = Object.values(store.state.conversations).find((c) => c.kind === 'project' && Object.values(store.state.projects).find((p) => p.id === c.projectId)?.name === 'Corniche Office Tower')!;
    const direct = await rowOf(/Faisal Al-Harbi/);
    expect(within(direct).queryByText('typing...')).toBeNull();
    const before = direct.textContent;
    act(() => live.emitTyping(signal(faisalChat.id, 'usr_002')));
    expect(await within(direct).findByText('typing...')).toHaveClass('text-link');
    expect(within(direct).queryByText('I will bring the new stage dates.')).toBeNull();
    act(() => live.emitTyping(signal(tower.id, 'usr_003')));
    const project = await rowOf(/Corniche Office Tower/);
    expect(await within(project).findByText('Reem is typing...')).toBeInTheDocument();
    // The stop brings the last message back.
    act(() => live.emitTyping(signal(faisalChat.id, 'usr_002', false)));
    await waitFor(() => expect(within(direct).queryByText('typing...')).toBeNull());
    expect(direct.textContent).toBe(before);
    act(() => live.emitTyping(signal(tower.id, 'usr_003', false)));
    await waitFor(() => expect(within(project).queryByText('Reem is typing...')).toBeNull());
  });

  it('shows nothing for the typing of the person on the screen', async () => {
    const live = fakeLive();
    const { store } = await renderApp('/inbox', undefined, { live: live.port });
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_002') && c.memberIds.includes('usr_001'))!;
    const direct = await rowOf(/Faisal Al-Harbi/);
    act(() => live.emitTyping(signal(room.id, 'usr_001')));
    await act(async () => undefined);
    expect(within(direct).queryByText('typing...')).toBeNull();
  });

  it('says it in Arabic with the female form', async () => {
    const live = fakeLive();
    const { store } = await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; }, { live: live.port });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    const reemChat = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_003') && c.memberIds.includes('usr_001'))!;
    const row = await rowOf(/ريم الغامدي/, 'المحادثات');
    act(() => live.emitTyping(signal(reemChat.id, 'usr_003')));
    expect(await within(row).findByText('تكتب...')).toBeInTheDocument();
    const group = Object.values(store.state.conversations).find((c) => c.kind === 'group')!;
    act(() => live.emitTyping(signal(group.id, 'usr_003')));
    expect(await within(await rowOf(/Facade review/, 'المحادثات')).findByText('ريم تكتب...')).toBeInTheDocument();
  });
});

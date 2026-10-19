import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { HALA, OMAR, makeBubble, renderLog, rowOf } from './logHarness';

describe('the names-you mark (design item 4)', () => {
  it('gives a message that names the reader a soft tint, a bar on its start side and a hidden sentence', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', createdAt: '2026-09-29T08:20:00.000+03:00', body: 'Can you approve one more soil test?', namesMe: true }),
      makeBubble({ id: 'msg_2', author: OMAR, createdAt: '2026-09-29T08:30:00.000+03:00', body: 'The lab is free on Sunday.' }),
    ] });
    const named = rowOf('Can you approve one more soil test?');
    const hidden = within(named).getByText('This message names you.');
    expect(hidden).toHaveClass('sr-only');
    const bubble = hidden.parentElement as HTMLElement;
    expect(bubble.className).toMatch(/(^|\s)bg-mention-bg(\s|$)/);
    expect(bubble.className).not.toMatch(/(^|\s)bg-fill(\s|$)/);
    expect(bubble.querySelector('.bg-mention-bar')?.className).toMatch(/(^|\s)start-1\.5(\s|$)/);
    expect(within(rowOf('The lab is free on Sunday.')).queryByText('This message names you.')).toBeNull();
  });
  it('never marks your own message, and never moves or turns red', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', author: HALA, mine: true, createdAt: '2026-09-29T08:40:00.000+03:00', body: 'Approved.', namesMe: true })] });
    expect(within(rowOf('Approved.')).queryByText('This message names you.')).toBeNull();
    expect(document.querySelector('.bg-mention-bg, [class*="animate-"], [class*="text-late"], [class*="bg-late"]')).toBeNull();
  });
  it('says the hidden sentence in Arabic', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', createdAt: '2026-09-29T08:20:00.000+03:00', body: 'هل توافقين؟', namesMe: true })] }, { lang: 'ar' });
    expect(within(rowOf('هل توافقين؟')).getByText('هذه الرسالة تذكرك.')).toHaveClass('sr-only');
  });
  it('marks a message of the tower chat that names Hala', async () => {
    const prepare = (state: State) => {
      const room = Object.values(state.conversations).find((c) => c.projectId === 'prj_001');
      if (!room) throw new Error('The sample has no tower chat.');
      state.messages.msg_998 = {
        id: 'msg_998', conversationId: room.id, authorId: 'usr_005', actingForId: 'usr_005', body: '@[Hala Nasser](usr_001) please check the riser.',
        mentions: ['usr_001'], fileIds: [], createdAt: '2026-09-30T08:10:00.000+03:00', editedAt: null,
      };
    };
    await renderApp('/inbox', prepare);
    const chats = within(await screen.findByRole('list', { name: 'Chats' }));
    await userEvent.click(await chats.findByRole('link', { name: /Corniche Office Tower/ }));
    const log = await screen.findByRole('log', { name: 'Messages' });
    const text = await within(log).findByText(/please check the riser/);
    expect(within(text.closest('li') as HTMLElement).getByText('This message names you.')).toHaveClass('sr-only');
  });
});

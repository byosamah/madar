import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { addDirectConversation, addGroupConversation } from '../../api/chatState';
import type { Notification } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The bell line of a reply (chat design 2026-10-19, item 10; track msg B17). Hala (usr_001) is the Admin. Faisal Al-Harbi (usr_002) is a
 * man, Reem Al-Ghamdi (usr_003) is a woman. A notice with "reply" says "replied to you"; one without it keeps "mentioned you".
 */
const STAMP = '2026-09-30T08:00:00.000+03:00';
let seq = 900;

function notice(over: Partial<Notification>): Notification {
  seq += 1;
  return {
    id: `ntf_${seq}`, userId: 'usr_001', trigger: 'mention', actorId: 'usr_002', targetType: 'chat', targetId: 'cnv_001', read: false,
    createdAt: STAMP, dedupeKey: null, ...over,
  };
}
const towerOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State, notices: (state: State) => Notification[]) {
  for (const n of notices(state)) state.notifications[n.id] = n;
}

describe('the bell line of a reply', () => {
  it('says "replied to you" for a reply notice in a project chat, a direct chat, a group and a task', async () => {
    await renderApp('/notifications', (state) => plant(state, (s) => {
      const direct = addDirectConversation(s, 'usr_001', 'usr_002', STAMP);
      const group = addGroupConversation(s, 'Tower team', 'usr_002', ['usr_002', 'usr_001', 'usr_003'], STAMP);
      const left = addGroupConversation(s, 'Secret team', 'usr_002', ['usr_002', 'usr_003', 'usr_004'], STAMP);
      const task = Object.values(s.tasks).find((t) => t.projectId === 'prj_001')!;
      task.title = 'Stair details';
      return [
        notice({ targetId: towerOf(s).id, messageId: 'msg_1', reply: true }),
        notice({ targetId: direct.id, messageId: 'msg_2', reply: true }),
        notice({ targetId: group.id, messageId: 'msg_3', reply: true }),
        notice({ targetId: left.id, messageId: 'msg_4', reply: true }),
        notice({ targetType: 'task', targetId: task.id, messageId: 'cmt_1', reply: true }),
      ];
    }));
    expect(await screen.findByText('Faisal Al-Harbi replied to you in Corniche Office Tower')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi replied to you in a direct message')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi replied to you in Stair details')).toBeInTheDocument();
    // A group the reader is in names the group (between FSI and PDI), and a group the reader left says "a group".
    expect(screen.getByText(/^Faisal Al-Harbi replied to you in .*Tower team/)).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi replied to you in a group')).toBeInTheDocument();
    // No planted reply notice reads as a mention. The sample office holds other mention notices of its own.
    expect(screen.queryByText(/^Faisal Al-Harbi mentioned you in (Corniche Office Tower|Stair details|a direct message)$/)).toBeNull();
  });

  it('keeps the mention line for a notice with no reply mark', async () => {
    await renderApp('/notifications', (state) => plant(state, (s) => {
      const direct = addDirectConversation(s, 'usr_001', 'usr_002', STAMP);
      return [notice({ targetId: towerOf(s).id, messageId: 'msg_1' }), notice({ targetId: direct.id, messageId: 'msg_2' })];
    }));
    expect(await screen.findByText('Faisal Al-Harbi mentioned you in Corniche Office Tower')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi mentioned you in a direct message')).toBeInTheDocument();
    expect(screen.queryByText(/replied to you/)).toBeNull();
  });

  it('opens the chat from the row, as a mention row does', async () => {
    let chat = '';
    await renderApp('/notifications', (state) => plant(state, (s) => {
      chat = towerOf(s).id;
      return [notice({ targetId: chat, messageId: 'msg_1', reply: true })];
    }));
    const row = (await screen.findByText('Faisal Al-Harbi replied to you in Corniche Office Tower')).closest('li')!;
    expect(within(row).getByRole('link')).toHaveAttribute('href', expect.stringContaining(chat));
  });

  it('reads the reply lines in Arabic, with the feminine verb after a woman', async () => {
    await renderApp('/notifications', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      plant(state, (s) => {
        const direct = addDirectConversation(s, 'usr_001', 'usr_003', STAMP);
        return [
          notice({ actorId: 'usr_003', targetId: direct.id, messageId: 'msg_1', reply: true }),
          notice({ actorId: 'usr_002', targetId: towerOf(s).id, messageId: 'msg_2', reply: true }),
        ];
      });
    });
    expect(await screen.findByText('ريم الغامدي ردّت عليك في رسالة مباشرة')).toBeInTheDocument();
    expect(screen.getByText('فيصل الحربي ردّ عليك في Corniche Office Tower')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

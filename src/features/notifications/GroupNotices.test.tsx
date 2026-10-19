import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { addGroupConversation } from '../../api/chatState';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// UX audit 2026-10-19, INT-03 and INT-15: a mention in a group names the group, and so does the notice of an add. Neither reads as
// "a direct message".

type Notice = State['notifications'][string];
const STAMP = '2026-09-30T08:00:00.000+03:00';
const notice = (id: string, trigger: Notice['trigger'], targetId: string, actorId = 'usr_002'): Notice => ({
  id, userId: 'usr_005', trigger, actorId, targetType: 'chat', targetId, read: false, createdAt: STAMP, dedupeKey: null,
});

/** Sara (usr_005) is in the group "Facade review" with Faisal (usr_002, the maker) and Hala (usr_001). */
function world(extra: (state: State, group: string) => void = () => undefined) {
  return (state: State) => {
    state.session.currentUserId = 'usr_005';
    for (const [id, n] of Object.entries(state.notifications)) if (n.userId === 'usr_005') delete state.notifications[id];
    const group = addGroupConversation(state, 'Facade review', 'usr_002', ['usr_002', 'usr_001', 'usr_005'], STAMP);
    state.notifications.ntf_901 = notice('ntf_901', 'mention', group.id);
    state.notifications.ntf_902 = notice('ntf_902', 'added_to_group', group.id, 'usr_001');
    extra(state, group.id);
  };
}

describe('the notices of a group', () => {
  it('names the group in a mention and in an add, and never says "direct message"', async () => {
    await renderApp('/notifications', world());
    // Each name sits between FSI and PDI marks, so the test drops them before it compares.
    const plain = (element: HTMLElement) => element.textContent?.replace(/[\u2068\u2069]/g, '').replace(/^Unread: /, '');
    expect(plain(await screen.findByText(/mentioned you in the group/))).toBe('Faisal Al-Harbi mentioned you in the group Facade review');
    expect(plain(screen.getByText(/added you to the group/))).toBe('Hala Nasser added you to the group Facade review');
    expect(screen.queryByText(/direct message/)).toBeNull();
    // The row shows the picture of the group.
    expect(screen.getAllByRole('img', { name: 'Group chat' })).toHaveLength(2);
  });

  it('says "a group" when the person has left the group, and names nothing of it', async () => {
    await renderApp('/notifications', world((state, group) => {
      const found = state.conversations[group];
      state.conversations[group] = { ...found, memberIds: found.memberIds.filter((id) => id !== 'usr_005') };
    }));
    expect(await screen.findByText(/mentioned you in a group/)).toBeInTheDocument();
    expect(screen.getByText(/added you to a group/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Facade review');
  });

  it('has the Arabic sentences', async () => {
    await renderApp('/notifications', world((state) => {
      state.users.usr_005.preferences.language = 'ar';
    }));
    expect(await screen.findByText(/أشار إليك في المجموعة/)).toBeInTheDocument();
    expect(screen.getByText(/أضافتك إلى المجموعة/)).toBeInTheDocument();
  });
});

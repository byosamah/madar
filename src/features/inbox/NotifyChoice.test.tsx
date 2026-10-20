import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chatReadKey } from '../../api/store';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * "Notify me" in the header menu of a chat (chat design item 21). Hala (usr_001) is the Admin and opens the sample chats: cnv_001 is the
 * Corniche Office Tower chat (a project chat), cnv_013 her direct chat with Faisal, cnv_015 the group "Facade review".
 */
const withTaskThread = (state: State) => {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006');
  if (!task) throw new Error('The sample has no task in the clinic project.');
  task.title = 'Room finish schedule';
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
};

/** Opens the menu of the header of the open chat. The list row has a menu of the same name, so the last button is the header one. */
async function openHeaderMenu(name: string) {
  await screen.findByRole('log', { name: 'Messages' });
  const buttons = screen.getAllByRole('button', { name });
  await userEvent.click(buttons[buttons.length - 1]);
  return screen.findByRole('menu');
}

describe('Notify me in the chat menu', () => {
  // Mark as unread (fbk_028) comes first: the open chat has nothing unread after its first look.
  it('shows Notify me under Archive, with Only when I am named checked, in a project chat', async () => {
    await renderApp('/inbox/cnv_001');
    const menu = await openHeaderMenu('Options for Corniche Office Tower');
    const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    expect(items.map((i) => i.textContent)).toEqual(['Mark as unread', 'Archive', 'All messages', 'Only when I am named']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Only when I am named' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: 'All messages' })).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByText('Notify me')).toBeInTheDocument();
    expect(within(menu).getByText('The unread count still shows every message.')).toBeInTheDocument();
  });

  it('starts a direct chat and a group at All messages', async () => {
    await renderApp('/inbox/cnv_013');
    const direct = await openHeaderMenu('Options for Faisal Al-Harbi');
    expect(within(direct).getByRole('menuitemradio', { name: 'All messages' })).toHaveAttribute('aria-checked', 'true');
    expect(within(direct).getByRole('menuitemradio', { name: 'Only when I am named' })).toHaveAttribute('aria-checked', 'false');
  });

  it('starts a group at All messages and keeps Rename first', async () => {
    await renderApp('/inbox/cnv_015');
    const group = await openHeaderMenu('Options for Facade review');
    const items = [...group.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    expect(items.map((i) => i.textContent)).toEqual(['Rename', 'Mark as unread', 'Archive', 'All messages', 'Only when I am named']);
    expect(within(group).getByRole('menuitemradio', { name: 'All messages' })).toHaveAttribute('aria-checked', 'true');
  });

  it('saves All messages for this person and this chat, and the menu shows it', async () => {
    const { store } = await renderApp('/inbox/cnv_001');
    const menu = await openHeaderMenu('Options for Corniche Office Tower');
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'All messages' }));
    await waitFor(() => expect(store.state.chatReads[chatReadKey('cnv_001', 'usr_001')]?.notify).toBe('all'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const again = await openHeaderMenu('Options for Corniche Office Tower');
    await waitFor(() => expect(within(again).getByRole('menuitemradio', { name: 'All messages' })).toHaveAttribute('aria-checked', 'true'));
    expect(within(again).getByRole('menuitemradio', { name: 'Only when I am named' })).toHaveAttribute('aria-checked', 'false');
  });

  it('sends nothing when the person picks the level that is checked already', async () => {
    const { store } = await renderApp('/inbox/cnv_001');
    const menu = await openHeaderMenu('Options for Corniche Office Tower');
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Only when I am named' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(store.state.chatReads[chatReadKey('cnv_001', 'usr_001')]?.notify).toBeUndefined();
  });

  it('shows no Notify me in a task thread', async () => {
    const { store } = await renderApp('/inbox', withTaskThread);
    const task = Object.values(store.state.tasks).find((t) => t.title === 'Room finish schedule')!;
    await renderApp(`/inbox/${task.id}`, withTaskThread);
    await screen.findByRole('log', { name: 'Messages' });
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    expect(screen.queryByText('Notify me')).toBeNull();
  });

  it('shows Notify me in Arabic, right to left', async () => {
    await renderApp('/inbox/cnv_001', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    await screen.findByRole('log');
    const buttons = screen.getAllByRole('button', { name: /^خيارات/ });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('menuitemradio', { name: 'فقط عندما يذكرني أحد' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'كل الرسائل' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('نبّهني')).toBeInTheDocument();
    expect(screen.getByText('يظل عدد غير المقروءة يحسب كل رسالة.')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

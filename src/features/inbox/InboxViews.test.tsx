import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { initI18n } from '../../i18n';
import { renderApp } from '../../test/render';
import { without } from '../../test/rr2work';
import { stubPhone } from './phoneHarness';

type Notice = State['notifications'][string];
const review = (id: string): Notice => ({
  id, userId: 'usr_002', trigger: 'review_requested', actorId: 'usr_005', targetType: 'task', targetId: 'tsk_010', read: false,
  createdAt: '2026-09-30T08:00:00.000+03:00', dedupeKey: null,
});
/** usr_002 holds only the given review notices. */
const withReviews = (count: number) => (state: State) => {
  state.session.currentUserId = 'usr_002';
  for (const [id, n] of Object.entries(state.notifications)) if (n.userId === 'usr_002') delete state.notifications[id];
  for (let i = 0; i < count; i += 1) state.notifications[`ntf_${900 + i}`] = review(`ntf_${900 + i}`);
};
const switchOf = () => screen.findByRole('radiogroup', { name: 'Inbox view' });

describe('InboxViews, the switch of Chats and Notifications on a phone', () => {
  it('shows h1 "Inbox" and a radiogroup "Inbox view" with Chats (checked) and Notifications on /inbox', async () => {
    stubPhone();
    await renderApp('/inbox');
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    const group = await switchOf();
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: /^Chats/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: /^Notifications/ })).toHaveAttribute('aria-checked', 'false');
    expect(group.querySelector('[data-thumb="inbox-views"]')).not.toBeNull();
  });

  it('shows the same title and switch on /notifications, with Notifications checked', async () => {
    stubPhone();
    await renderApp('/notifications');
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    const group = await switchOf();
    expect(within(group).getByRole('radio', { name: /^Notifications/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: /^Chats/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('gives each segment its own count: unread chats and notices that need action', async () => {
    stubPhone();
    const { api } = await renderApp('/inbox', withReviews(1));
    const group = await switchOf();
    const unread = (await api.call('chats.unreadCount', {})).unread;
    expect(unread).toBeGreaterThan(0);
    await waitFor(() => expect(within(group).getByRole('radio', { name: /^Chats/ })).toHaveTextContent(`Unread messages: ${unread}`));
    await waitFor(() => expect(within(group).getByRole('radio', { name: /^Notifications/ })).toHaveTextContent('1 item needs action'));
  });

  it('shows 99+ for a count above 99 and keeps the two segments the same width class', async () => {
    stubPhone();
    await renderApp('/notifications', withReviews(105));
    const group = await switchOf();
    const notices = within(group).getByRole('radio', { name: /^Notifications/ });
    await waitFor(() => expect(notices).toHaveTextContent('99+'));
    const chats = within(group).getByRole('radio', { name: /^Chats/ });
    expect(chats).toHaveClass('flex-1');
    expect(notices).toHaveClass('flex-1');
  });

  it('shows no number for a count of 0', async () => {
    stubPhone();
    await renderApp('/inbox', withReviews(0));
    const group = await switchOf();
    await waitFor(() => expect(within(group).getByRole('radio', { name: /^Notifications/ })).toHaveAccessibleName('Notifications'));
    expect(within(group).getByRole('radio', { name: /^Notifications/ })).not.toHaveTextContent(/\d/);
  });

  it('navigates on a press', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(within(await switchOf()).getByRole('radio', { name: /^Notifications/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    await userEvent.click(within(await switchOf()).getByRole('radio', { name: /^Chats/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
  });

  it('shows New message on Chats only, and with one right of two the sheet opens in the mode that is left', async () => {
    stubPhone();
    await renderApp('/inbox', (state) => {
      state.session.currentUserId = 'usr_005';
      state.settings.roles = without('chat.direct');
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    expect(await screen.findByRole('dialog', { name: 'New group' })).toBeInTheDocument();
  });

  it('has no New message button on Notifications', async () => {
    stubPhone();
    await renderApp('/notifications');
    await switchOf();
    expect(screen.queryByRole('button', { name: 'New message' })).toBeNull();
  });

  it('keeps h1 "Notifications" and no switch on a desk', async () => {
    await renderApp('/notifications');
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Inbox view' })).toBeNull();
  });

  it('names the segments in Arabic', async () => {
    stubPhone();
    await renderApp('/inbox');
    await switchOf();
    initI18n('ar');
    const group = await screen.findByRole('radiogroup', { name: 'عرض الوارد' });
    expect(within(group).getByRole('radio', { name: /^المحادثات/ })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /^الإشعارات/ })).toBeInTheDocument();
    initI18n('en');
  });
});

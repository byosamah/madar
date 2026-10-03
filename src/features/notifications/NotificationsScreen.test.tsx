import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

type Notice = State['notifications'][string];

const notice = (id: string, trigger: Notice['trigger'], targetType: Notice['targetType'], targetId: string, createdAt: string, actorId: string | null = 'usr_002'): Notice => ({
  id, userId: '', trigger, actorId, targetType, targetId, read: false, createdAt, dedupeKey: null,
});

const withNotices = (userId: string, list: Notice[]) => (state: State) => {
  state.session.currentUserId = userId;
  for (const [id, n] of Object.entries(state.notifications)) if (n.userId === userId) delete state.notifications[id];
  for (const n of list) state.notifications[n.id] = { ...n, userId };
};

const TODAY_8 = '2026-09-30T08:00:00.000+03:00';
const TODAY_7 = '2026-09-30T07:00:00.000+03:00';
const YESTERDAY = '2026-09-29T16:00:00.000+03:00';

const itemWith = (text: RegExp) => screen.getByText(text).closest('li') as HTMLElement;

describe('the notifications screen', () => {
  it('groups notices by day and writes one sentence for each', async () => {
    await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_902', 'mention', 'update', 'upd_001', TODAY_7),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi gave you “Civil Defense drawings”')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi mentioned you in Corniche Office Tower')).toBeInTheDocument();
    expect(screen.getByText('“Toilet details” is past due')).toBeInTheDocument();
  });

  it('marks a notice read when it opens, and goes to the task', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8)]));
    await screen.findByText(/gave you/);
    await userEvent.click(within(itemWith(/gave you/)).getByRole('link', { name: /gave you/ }));
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
    expect(window.location.hash).toContain('tab=tasks&task=tsk_012');
  });

  it('marks all read', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    // The toast says what happened, so the person knows what Undo puts back (audit 2026-10-03, V-26).
    expect(await screen.findByText('Marked 2 notifications as read.')).toBeInTheDocument();
    expect(Object.values(store.state.notifications).filter((n) => n.userId === 'usr_005').every((n) => n.read)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('offers Undo after Mark all read (audit 2026-10-03, SHL-16)', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('Marked 2 notifications as read.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(false));
    expect(store.state.notifications.ntf_903.read).toBe(false);
    expect(await screen.findByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
  });

  it('counts every notice that Mark all read marked, also past 200, and Undo puts back all of them (audit 2026-10-03, V-26)', async () => {
    const many = Array.from({ length: 205 }, (_, i) => notice(`ntf_${9000 + i}`, 'task_assigned', 'task', 'tsk_012', TODAY_8));
    const { store } = await renderApp('/notifications', withNotices('usr_005', many));
    const unread = () => Object.values(store.state.notifications).filter((n) => n.userId === 'usr_005' && !n.read).length;
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('Marked 205 notifications as read.')).toBeInTheDocument();
    expect(unread()).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(unread()).toBe(205));
  }, 30000);

  it('lets the leader approve from the Inbox while the task waits', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve “Toilet details”' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve “Toilet details”' })).toBeNull());
  });

  it('keeps the notice unread when the approval fails (audit 2026-10-03, SHL-11)', async () => {
    const { store } = await renderApp(
      '/notifications',
      withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]),
      { failFirst: 'tasks.approve' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Approve “Toilet details”' }));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(store.state.notifications.ntf_904.read).toBe(false);
    expect(store.state.tasks.tsk_010.status).toBe('in_review');
    await userEvent.click(screen.getByRole('button', { name: 'Approve “Toilet details”' }));
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(true));
  });

  it('says "a direct message" for a mention in a direct chat (audit 2026-10-03, SHL-14)', async () => {
    await renderApp('/notifications', (state) => {
      const room = Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!;
      withNotices('usr_001', [notice('ntf_901', 'mention', 'chat', room.id, TODAY_8, 'usr_002')])(state);
    });
    expect(await screen.findByText('Faisal Al-Harbi mentioned you in a direct message')).toBeInTheDocument();
  });

  it('offers Undo after Approve, and names the task in each Approve button (audit 2026-10-03, BRW-5)', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    const approve = await screen.findByRole('button', { name: 'Approve “Toilet details”' });
    expect(approve).toHaveTextContent(/^Approve$/);
    await userEvent.click(approve);
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
    expect(await screen.findByText('Task approved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_review'));
  });

  it('gives the notice its unread mark back when the person undoes Approve (audit 2026-10-03, V-16)', async () => {
    const { store, api } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    const before = await api.call('notifications.count', {});
    await userEvent.click(await screen.findByRole('button', { name: 'Approve “Toilet details”' }));
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_review'));
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(false));
    expect((await api.call('notifications.count', {})).badge).toBe(before.badge);
  });

  it('says when there is nothing', async () => {
    await renderApp('/notifications', withNotices('usr_005', []));
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });

  it('keeps the sentence of a notice whose task was deleted, and says the task is gone', async () => {
    const { api } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await screen.findByText(/sent “Toilet details” to review/);
    await api.call('tasks.delete', { id: 'tsk_010' });
    expect(await screen.findByText('This item does not exist anymore.')).toBeInTheDocument();
    const item = itemWith(/sent “Toilet details” to review/);
    expect(within(item).queryByRole('link')).toBeNull();
    expect(within(item).queryByRole('button', { name: 'Approve “Toilet details”' })).toBeNull();
  });

  it('marks a notice of a deleted item read once the list shows it (audit 2026-10-03, SHL-12)', async () => {
    const { store } = await renderApp('/notifications', (state) => {
      withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8), notice('ntf_902', 'overdue', 'task', 'tsk_010', TODAY_7, null)])(state);
      delete state.tasks.tsk_012;
    });
    expect(await screen.findByText('This item does not exist anymore.')).toBeInTheDocument();
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
    // A notice whose item is still here keeps its dot until the person opens it.
    expect(store.state.notifications.ntf_902.read).toBe(false);
  });

  it('shows Retry when the Inbox cannot load', async () => {
    const { api } = await renderApp('/notifications', withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8)]), { failFirst: 'notifications.list' });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/gave you/)).toBeInTheDocument();
    void api;
  });
});

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

describe('the Inbox', () => {
  it('groups notices by day and writes one sentence for each', async () => {
    await renderApp('/inbox', withNotices('usr_005', [
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
    const { store } = await renderApp('/inbox', withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8)]));
    await screen.findByText(/gave you/);
    await userEvent.click(within(itemWith(/gave you/)).getByRole('link', { name: /gave you/ }));
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
    expect(window.location.hash).toContain('tab=tasks&task=tsk_012');
  });

  it('marks all read', async () => {
    const { store } = await renderApp('/inbox', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('All caught up.')).toBeInTheDocument();
    expect(Object.values(store.state.notifications).filter((n) => n.userId === 'usr_005').every((n) => n.read)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('lets the leader approve from the Inbox while the task waits', async () => {
    const { store } = await renderApp('/inbox', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
  });

  it('opens the timesheet from a week reminder', async () => {
    await renderApp('/inbox', withNotices('usr_005', [notice('ntf_905', 'week_under_target', 'week', '2026-09-20', TODAY_8, null)]));
    expect(await screen.findByText(/week of 20 September 2026 are under target/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /are under target/ }));
    await waitFor(() => expect(window.location.hash).toContain('week=2026-09-20'));
  });

  it('says when there is nothing', async () => {
    await renderApp('/inbox', withNotices('usr_005', []));
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });

  it('keeps the sentence of a notice whose task was deleted, and says the task is gone', async () => {
    const { api } = await renderApp('/inbox', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await screen.findByText(/sent “Toilet details” to review/);
    await api.call('tasks.delete', { id: 'tsk_010' });
    expect(await screen.findByText('This item does not exist anymore.')).toBeInTheDocument();
    const item = itemWith(/sent “Toilet details” to review/);
    expect(within(item).queryByRole('link')).toBeNull();
    expect(within(item).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows Retry when the Inbox cannot load', async () => {
    const { api } = await renderApp('/inbox', withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8)]), { failFirst: 'notifications.list' });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/gave you/)).toBeInTheDocument();
    void api;
  });
});

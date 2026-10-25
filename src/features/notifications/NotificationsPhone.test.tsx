import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { stubPhone } from '../inbox/phoneHarness';
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
const YESTERDAY = '2026-09-29T16:00:00.000+03:00';

/** A swipe of the finger on a row: a press, a move of `dx` pixels, and a release. Motion reads the pointer events of the window. */
async function swipe(row: HTMLElement, dx: number) {
  const point = (type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0 });
    Object.defineProperties(event, { pointerType: { value: 'touch' }, isPrimary: { value: true }, pointerId: { value: 1 }, pageX: { value: x }, pageY: { value: 10 } });
    return event;
  };
  await act(async () => {
    row.dispatchEvent(point('pointerdown', 200));
    for (const step of [0.25, 0.5, 0.75, 1]) {
      window.dispatchEvent(point('pointermove', 200 + dx * step));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    window.dispatchEvent(point('pointerup', 200 + dx));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('Notifications on a phone (Direction D)', () => {
  it('puts Mark all read at the end of the heading line of the first day, only while one notice is unread', async () => {
    stubPhone();
    const { store } = await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    const first = (await screen.findByRole('heading', { name: 'Today' })).closest('section')!;
    const button = within(first).getByRole('button', { name: 'Mark all read' });
    expect(button).toHaveClass('min-h-11');
    expect(screen.getAllByRole('button', { name: 'Mark all read' })).toHaveLength(1);
    // Not in the title area, and not in the second day.
    const second = screen.getByRole('heading', { name: 'Yesterday' }).closest('section')!;
    expect(within(second).queryByRole('button', { name: 'Mark all read' })).toBeNull();
    await userEvent.click(button);
    expect(await screen.findByText('Marked 2 notifications as read.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(Object.values(store.state.notifications).filter((n) => n.userId === 'usr_005').every((n) => n.read)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('puts Approve under the meta line, aligned with the text, with its aria-label', async () => {
    stubPhone();
    await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    const approve = await screen.findByRole('button', { name: 'Approve “Toilet details”' });
    expect(approve).toHaveClass('min-h-11');
    const li = approve.closest('li')!;
    const link = li.firstElementChild as HTMLElement;
    expect(link.tagName).toBe('A');
    expect(link.contains(approve)).toBe(false);
    const wrapper = approve.parentElement!;
    expect(wrapper).toHaveClass('ps-[5.375rem]');
    expect(link.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(li).toHaveClass('flex-col');
  });

  it('approves in place, shows the toast Approved with Undo, and Undo restores the unread mark', async () => {
    stubPhone();
    const { store } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve “Toilet details”' }));
    expect(await screen.findByText('To-do approved.')).toBeInTheDocument();
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(false));
  });

  it('passes state.from "/notifications" when a notice opens a chat', async () => {
    stubPhone();
    const { router } = await renderApp('/notifications', (state) => {
      const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
      withNotices('usr_001', [{ ...notice('ntf_905', 'mention', 'chat', room.id, TODAY_8), messageId: 'msg_1' }])(state);
    });
    await userEvent.click(await screen.findByRole('link', { name: /mentioned you in Corniche Office Tower/ }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/inbox\/cnv_/));
    expect(router.state.location.state).toEqual({ from: '/notifications' });
  });

  it('keeps the title action and the Approve button at the end of the row on a desk', async () => {
    await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    const approve = await screen.findByRole('button', { name: 'Approve “Toilet details”' });
    expect(approve.parentElement!.tagName).toBe('LI');
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' }).closest('div')!.parentElement).toContainElement(screen.getByRole('button', { name: 'Mark all read' }));
  });
  // fbk_052: a swipe marks the notice read with no sign. The toast with Undo gives the way back.
  describe('the swipe toast (fbk_052)', () => {
    const twoNotices = [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ];
    const rowOf = async (text: RegExp) => (await screen.findByText(text)).closest('li') as HTMLElement;

    it('shows Marked 1 notification as read with Undo after a swipe on an unread notice, and Undo makes it unread again', async () => {
      stubPhone();
      const { store } = await renderApp('/notifications', withNotices('usr_005', twoNotices));
      await swipe(await rowOf(/gave you/), 120);
      await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
      expect(await screen.findByText('Marked 1 notification as read.')).toBeInTheDocument();
      expect(store.state.notifications.ntf_903.read).toBe(false);
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(false));
      expect(store.state.notifications.ntf_903.read).toBe(false);
    });

    it('Ctrl+Z after the swipe does the same', async () => {
      stubPhone();
      const { store } = await renderApp('/notifications', withNotices('usr_005', twoNotices));
      await swipe(await rowOf(/gave you/), -120);
      await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
      await screen.findByText('Marked 1 notification as read.');
      await userEvent.keyboard('{Control>}z{/Control}');
      await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(false));
    });

    it('shows no toast for a swipe on a read notice, a short swipe, or a tap on a row', async () => {
      stubPhone();
      const { store } = await renderApp('/notifications', withNotices('usr_005', [{ ...twoNotices[0], read: true }, twoNotices[1]]));
      await swipe(await rowOf(/gave you/), 120);
      await swipe(await rowOf(/past due/), 30);
      expect(store.state.notifications.ntf_903.read).toBe(false);
      expect(screen.queryByText(/Marked 1 notification/)).toBeNull();
      await userEvent.click(within(await rowOf(/past due/)).getByRole('link', { name: /past due/ }));
      await waitFor(() => expect(store.state.notifications.ntf_903.read).toBe(true));
      expect(screen.queryByText(/Marked 1 notification/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });
  });
});

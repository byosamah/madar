import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chatReadKey, type State } from '../../api/store';
import { setNow } from '../../lib/dates';
import { renderApp } from '../../test/render';

const show = (visible: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  document.dispatchEvent(new Event('visibilitychange'));
};
afterEach(() => {
  Reflect.deleteProperty(document, 'hidden');
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });
const marks = (call: { mock: { calls: unknown[][] } }) => call.mock.calls.filter(([name]) => name === 'chats.markRead');

// Hala is the Admin and leads the clinic project. The sample talk leaves two unread messages in the tower chat and one in Faisal's chat.
const withTaskTalk = (state: State) => {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006');
  if (!task) throw new Error('The sample has no task in the clinic project.');
  task.title = 'Room finish schedule';
  for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
};

describe('read only while you look (design item 5)', () => {
  it('marks an open chat read only after its tab shows', async () => {
    const { api } = await renderApp('/inbox');
    const call = vi.spyOn(api, 'call');
    show(false);
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText(/The sprinkler riser/);
    await settle();
    expect(marks(call)).toHaveLength(0);
    act(() => show(true));
    await waitFor(() => expect(marks(call)).toHaveLength(1));
  });
  it('keeps a message that comes while the tab is hidden unread, until the tab shows again', async () => {
    const { api, store, queryClient } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!;
    const readAt = () => Date.parse(store.state.chatReads[chatReadKey(room.id, 'usr_001')]?.lastReadAt ?? '1970-01-01T00:00:00Z');
    await waitFor(() => expect(readAt()).toBeGreaterThanOrEqual(Date.parse('2026-09-30T07:40:00.000+03:00')));
    show(false);
    // The test clock stands still (setNow), so the new message must come 5 minutes after the mark of the open.
    setNow(new Date('2026-09-30T06:05:00Z'));
    store.state.session.currentUserId = 'usr_002';
    const sent = await api.call('chats.send', { conversationId: room.id, body: 'One more thing.' });
    store.state.session.currentUserId = 'usr_001';
    // A hidden tab only marks its lists (signals.ts), so the test loads the chat itself, as an answer that arrives while the tab is hidden.
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['api', 'chats.messages'] }); });
    await waitFor(() => expect(within(screen.getByRole('log', { name: 'Messages' })).getByText('One more thing.')).toBeInTheDocument());
    await settle();
    expect(readAt()).toBeLessThan(Date.parse(sent.message.createdAt));
    act(() => show(true));
    await waitFor(() => expect(readAt()).toBeGreaterThanOrEqual(Date.parse(sent.message.createdAt)));
  });
  it('marks a task thread once for each new comment, and not again when the tab only shows again', async () => {
    const { api } = await renderApp('/inbox', withTaskTalk);
    const call = vi.spyOn(api, 'call');
    await userEvent.click(await rowLink(/Room finish schedule/));
    await waitFor(() => expect(marks(call)).toHaveLength(1));
    act(() => show(false));
    act(() => show(true));
    await settle();
    expect(marks(call)).toHaveLength(1);
  });

  // Mark as unread (fbk_028, owner 2026-10-20): the open chat ends the mark only at its first look, or for a newer message.
  it('keeps an unread mark that is set on the open chat, also when the tab hides and shows again', async () => {
    const { api, store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!;
    const key = chatReadKey(room.id, 'usr_001');
    await waitFor(() => expect(store.state.chatReads[key]?.lastReadAt).toBeDefined());
    await settle();
    const call = vi.spyOn(api, 'call');
    // The mark comes while the chat is open (another device, or the menu just before the chat closes).
    await act(async () => { await api.call('chats.markUnread', { conversationId: room.id }); });
    await settle();
    act(() => show(false));
    act(() => show(true));
    await settle();
    expect(marks(call)).toHaveLength(0);
    expect(store.state.chatReads[key]?.markedUnread).toBe(true);
    expect(within(await rowLink(/Faisal Al-Harbi/)).getByText('Unread: 1')).toBeInTheDocument();
  });

  it('keeps an unread mark that is set on the open task thread, also when the tab hides and shows again', async () => {
    const { api, store } = await renderApp('/inbox', withTaskTalk);
    const call = vi.spyOn(api, 'call');
    await userEvent.click(await rowLink(/Room finish schedule/));
    await waitFor(() => expect(marks(call)).toHaveLength(1));
    const task = Object.values(store.state.tasks).find((t) => t.title === 'Room finish schedule')!;
    await act(async () => { await api.call('chats.markUnread', { conversationId: task.id }); });
    await settle();
    act(() => show(false));
    act(() => show(true));
    await settle();
    expect(marks(call)).toHaveLength(1);
    expect(store.state.chatReads[chatReadKey(task.id, 'usr_001')]?.markedUnread).toBe(true);
  });
});

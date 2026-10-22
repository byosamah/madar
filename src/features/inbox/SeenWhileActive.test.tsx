import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chatReadKey } from '../../api/store';
import { ACTIVE_MS } from '../../app/live/activity';
import { setNow } from '../../lib/dates';
import { NOW } from '../../test/factories';
import { renderApp } from '../../test/render';

/** The seen flag of chats.markRead (chat presence design C4, F3): only a chat in view and in use sends seen: true. */
const show = (visible: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  document.dispatchEvent(new Event('visibilitychange'));
};
afterEach(() => {
  Reflect.deleteProperty(document, 'hidden');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const inputs = (call: { mock: { calls: unknown[][] } }) => call.mock.calls.filter(([name]) => name === 'chats.markRead').map(([, input]) => input);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
const direct = (store: { state: { conversations: Record<string, { id: string; kind: string; memberIds: string[] }> } }) => (
  Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!
);
const clock = () => vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });

describe('seen only while the person uses the chat', () => {
  it('sends seen: true for an open chat that is in view and in use', async () => {
    const { api, store, router } = await renderApp('/inbox');
    const call = vi.spyOn(api, 'call');
    await act(async () => { await router.navigate(`/inbox/${direct(store).id}`); });
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    await waitFor(() => expect(inputs(call).length).toBeGreaterThan(0));
    expect(inputs(call)[0]).toEqual({ conversationId: direct(store).id, seen: true });
  });

  it('reads an idle screen without the flag, and the next key sends seen: true', async () => {
    clock();
    const { api, store, router, queryClient } = await renderApp('/inbox');
    const id = direct(store).id;
    const call = vi.spyOn(api, 'call');
    await act(async () => { await router.navigate(`/inbox/${id}`); });
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    await waitFor(() => expect(inputs(call)).toHaveLength(1));
    expect(inputs(call)[0]).toEqual({ conversationId: id, seen: true });
    // Ten minutes with no key, click or touch: the open chat stays in view, but the screen is idle.
    await act(async () => { vi.advanceTimersByTime(ACTIVE_MS + 1_000); });
    // A message comes in, 10 minutes after the clock of the test. (A change of the signed-in person would mount the screen again.)
    store.state.messages.msg_999 = {
      id: 'msg_999', conversationId: id, authorId: 'usr_002', actingForId: 'usr_002', body: 'One more thing.', mentions: [],
      createdAt: '2026-09-30T09:10:00.000+03:00', editedAt: null,
    };
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['api', 'chats.messages'] }); });
    await waitFor(() => expect(inputs(call)).toHaveLength(2));
    // The chat is read, but the person is away from the desk, so the seen time does not move.
    expect(inputs(call)[1]).toEqual({ conversationId: id });
    await settle();
    expect(inputs(call)).toHaveLength(2);
    // The person uses Madar again with the chat in view: the seen time moves then.
    act(() => { fireEvent.keyDown(window, { key: 'a' }); });
    await waitFor(() => expect(inputs(call)).toHaveLength(3));
    expect(inputs(call)[2]).toEqual({ conversationId: id, seen: true });
    expect(store.state.chatReads[chatReadKey(id, 'usr_001')]?.seenAt).toBeDefined();
  });

  it('sends nothing from a page that is hidden, and seen: true when it shows', async () => {
    const { api, store, router } = await renderApp('/inbox');
    const call = vi.spyOn(api, 'call');
    show(false);
    const id = direct(store).id;
    await act(async () => { await router.navigate(`/inbox/${id}`); });
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    await settle();
    expect(inputs(call)).toHaveLength(0);
    act(() => show(true));
    await waitFor(() => expect(inputs(call)).toHaveLength(1));
    expect(inputs(call)[0]).toEqual({ conversationId: id, seen: true });
  });
  it('sends no read mark for the own new message: chats.send marks the chat read already (performance audit 2026-10-21, LV-4)', async () => {
    const { api, store, router } = await renderApp('/inbox');
    const id = direct(store).id;
    const call = vi.spyOn(api, 'call');
    await act(async () => { await router.navigate(`/inbox/${id}`); });
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    await waitFor(() => expect(inputs(call)).toHaveLength(1));
    // The clock moves on, so the own message is newer than the seen time of the open.
    setNow(new Date(NOW.getTime() + 5 * 60_000));
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'On my way.{Enter}');
    await within(screen.getByRole('log', { name: 'Messages' })).findByText('On my way.');
    await waitFor(() => expect(call.mock.calls.filter(([name]) => name === 'chats.send')).toHaveLength(1));
    await settle();
    // The send is the only write after the open: no second chats.markRead for the own message.
    expect(inputs(call)).toHaveLength(1);
  });

  it('still sends the seen mark for a message of the other person that arrives after the own message', async () => {
    const { api, store, router, queryClient } = await renderApp('/inbox');
    const id = direct(store).id;
    const call = vi.spyOn(api, 'call');
    await act(async () => { await router.navigate(`/inbox/${id}`); });
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    await waitFor(() => expect(inputs(call)).toHaveLength(1));
    // The clock moves on, so the own message is newer than the seen time of the open.
    setNow(new Date(NOW.getTime() + 5 * 60_000));
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'On my way.{Enter}');
    await within(screen.getByRole('log', { name: 'Messages' })).findByText('On my way.');
    await settle();
    store.state.messages.msg_998 = {
      id: 'msg_998', conversationId: id, authorId: 'usr_002', actingForId: 'usr_002', body: 'See you there.', mentions: [],
      createdAt: '2026-09-30T23:00:00.000+03:00', editedAt: null,
    };
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['api', 'chats.messages'] }); });
    await waitFor(() => expect(inputs(call)).toHaveLength(2));
    expect(inputs(call)[1]).toEqual({ conversationId: id, seen: true });
  });
});

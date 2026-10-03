import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MESSAGE_PAGE, messagesOf } from '../../api/chatState';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { expectCalm } from '../auth/calmChecks';
import { EARLIER_PAGE } from './earlier';

const OLD = 450;
const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.projectId === 'prj_001')!;
const note = (n: number) => `Old note ${String(n).padStart(3, '0')}`;

/** The tower chat gets 450 messages older than the sample talk, so it holds more than two pages. */
function longTalk(state: State) {
  const room = roomOf(state);
  for (let n = 1; n <= OLD; n += 1) {
    const id = `msg_${5000 + n}`;
    const minute = String(n % 60).padStart(2, '0');
    const hour = String(6 + Math.floor(n / 60)).padStart(2, '0');
    state.messages[id] = {
      id, conversationId: room.id, authorId: 'usr_002', actingForId: 'usr_002', body: note(n),
      mentions: [], fileIds: [], createdAt: `2026-08-02T${hour}:${minute}:00.000+03:00`, editedAt: null,
    };
  }
}

/** jsdom draws nothing, so the log gets a height of 40 px for each row and a scroll position the screen can set. */
function measure(log: HTMLElement) {
  let top = 0;
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => log.querySelectorAll('li').length * 40 });
  Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
  return { at: (value: number) => { top = value; }, top: () => top };
}

async function openTower() {
  await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Corniche Office Tower/ }));
  return screen.findByRole('log', { name: 'Messages' });
}

describe('Earlier messages in a chat (plan 4.13, A5)', () => {
  it('pages by the default page size of chats.messages', () => {
    expect(EARLIER_PAGE).toBe(MESSAGE_PAGE);
  });

  it('shows no control when the chat has fewer messages than one page', async () => {
    await renderApp('/inbox');
    const log = await openTower();
    await within(log).findByText(/The sprinkler riser clashes with beam B14/);
    expect(screen.queryByRole('button', { name: 'Earlier messages' })).toBeNull();
  });

  it('puts each earlier page above the shown messages, asks with the oldest shown id, and hides after a short page', async () => {
    const { api, store } = await renderApp('/inbox', longTalk);
    const log = await openTower();
    const all = messagesOf(store.state, roomOf(store.state).id);
    const shownFirst = all.slice(-MESSAGE_PAGE);
    expect(await within(log).findByText(shownFirst[0].body)).toBeInTheDocument();
    expect(within(log).queryByText(all[all.length - MESSAGE_PAGE - 1].body)).toBeNull();
    const call = vi.spyOn(api, 'call');

    await userEvent.click(within(log).getByRole('button', { name: 'Earlier messages' }));
    const secondOldest = all[all.length - 2 * MESSAGE_PAGE];
    expect(await within(log).findByText(secondOldest.body)).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('chats.messages', { conversationId: roomOf(store.state).id, before: shownFirst[0].id, limit: MESSAGE_PAGE });
    // The page goes above: the earlier message comes first in the log.
    const bodies = within(log).getAllByText(/^Old note \d{3}$/).map((node) => node.textContent);
    expect(bodies.indexOf(secondOldest.body)).toBeLessThan(bodies.indexOf(shownFirst[0].body));
    // A full page may have more before it, so the control stays.
    const again = within(log).getByRole('button', { name: 'Earlier messages' });

    await userEvent.click(again);
    expect(await within(log).findByText(note(1))).toBeInTheDocument();
    expect(call).toHaveBeenLastCalledWith('chats.messages', { conversationId: roomOf(store.state).id, before: secondOldest.id, limit: MESSAGE_PAGE });
    // That page was shorter than 200, so it was the first page of the chat. The focus stays in the log, not on the page body.
    await waitFor(() => expect(within(log).queryByRole('button', { name: 'Earlier messages' })).toBeNull());
    expect(log).toHaveFocus();
    expect(within(log).getAllByText(/^Old note \d{3}$/)).toHaveLength(OLD);
  });

  it('keeps the message the person reads in place: the scroll keeps its distance from the bottom', async () => {
    await renderApp('/inbox', longTalk);
    const log = await openTower();
    await within(log).findByText(/The sprinkler riser clashes with beam B14/);
    const scroll = measure(log);
    // The person has scrolled up to the top of the first page.
    scroll.at(0);
    const before = log.scrollHeight;
    await userEvent.click(within(log).getByRole('button', { name: 'Earlier messages' }));
    await waitFor(() => expect(log.scrollHeight).toBeGreaterThan(before));
    // The new rows went above, and the scroll moved down by their height, so the same message stays under the eye.
    expect(scroll.top()).toBe(log.scrollHeight - before);
  });

  it('keeps an earlier message that leaves the newest page when a new message arrives', async () => {
    const { store } = await renderApp('/inbox', longTalk);
    const log = await openTower();
    const all = messagesOf(store.state, roomOf(store.state).id);
    const edge = all[all.length - MESSAGE_PAGE];
    await within(log).findByText(edge.body);
    await userEvent.click(within(log).getByRole('button', { name: 'Earlier messages' }));
    await within(log).findByText(all[all.length - 2 * MESSAGE_PAGE].body);
    // A new message: the newest page now starts one message later, and "edge" falls out of it.
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'A fresh message.{Enter}');
    expect(await within(log).findByText('A fresh message.')).toBeInTheDocument();
    expect(messagesOf(store.state, roomOf(store.state).id).slice(-MESSAGE_PAGE)[0].id).not.toBe(edge.id);
    expect(within(log).getByText(edge.body)).toBeInTheDocument();
    expect(within(log).getAllByText(/^Old note \d{3}$/)).toHaveLength(2 * MESSAGE_PAGE - (all.length - OLD));
  });

  it('passes the calm checks in English, and reads in Arabic right to left', async () => {
    const english = await renderApp('/inbox', longTalk);
    const log = await openTower();
    const control = await within(log).findByRole('button', { name: 'Earlier messages' });
    expect(control).not.toHaveClass('signature');
    expectCalm(log.parentElement as HTMLElement, { titleLevel: 2 });
    english.unmount();

    await renderApp('/inbox', (state) => {
      longTalk(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    const arabicLog = await screen.findByRole('log', { name: 'الرسائل' });
    const arabicControl = await within(arabicLog).findByRole('button', { name: 'الرسائل السابقة' });
    expectCalm(arabicLog.parentElement as HTMLElement, { titleLevel: 2 });
    await userEvent.click(arabicControl);
    await waitFor(() => expect(within(arabicLog).getAllByText(/^Old note \d{3}$/).length).toBeGreaterThan(MESSAGE_PAGE));
  });
});

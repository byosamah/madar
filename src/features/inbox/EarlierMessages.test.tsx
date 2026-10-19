import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

/** The rows of messages in the log: a query over the bubbles only, cheaper than a text query over 650 nodes. */
const notes = (log: HTMLElement) => [...log.querySelectorAll('li')].filter((li) => /Old note \d{3}/.test(li.textContent ?? ''));

/** Sends a message from the composer: a change event and a submit, not 16 key presses over a log of 400 bubbles. */
function send(text: string) {
  const field = screen.getByLabelText('Message');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.submit(field.closest('form')!);
}

/**
 * The sent message once the server saved it. A send shows at once as a faded copy (chat design 2026-10-19, item 13), and the saved
 * message takes its place, so a test that reads the store or the pages waits for the swap first.
 */
const savedBubble = (log: HTMLElement, text: string) => waitFor(() => {
  const li = within(log).getByText(text).closest('li')!;
  expect(li).not.toHaveAttribute('aria-busy');
  return li;
});

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
    const bodies = notes(log).map((li) => li.textContent ?? '').map((text) => /Old note \d{3}/.exec(text)![0]);
    expect(bodies.indexOf(secondOldest.body)).toBeLessThan(bodies.indexOf(shownFirst[0].body));
    // A full page may have more before it, so the control stays.
    const again = within(log).getByRole('button', { name: 'Earlier messages' });

    await userEvent.click(again);
    expect(await within(log).findByText(note(1))).toBeInTheDocument();
    expect(call).toHaveBeenLastCalledWith('chats.messages', { conversationId: roomOf(store.state).id, before: secondOldest.id, limit: MESSAGE_PAGE });
    // That page was shorter than 200, so it was the first page of the chat. The focus stays in the log, not on the page body.
    await waitFor(() => expect(within(log).queryByRole('button', { name: 'Earlier messages' })).toBeNull());
    expect(log).toHaveFocus();
    expect(notes(log)).toHaveLength(OLD);
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
    send('A fresh message.');
    await savedBubble(log, 'A fresh message.');
    expect(messagesOf(store.state, roomOf(store.state).id).slice(-MESSAGE_PAGE)[0].id).not.toBe(edge.id);
    expect(within(log).getByText(edge.body)).toBeInTheDocument();
    expect(notes(log)).toHaveLength(2 * MESSAGE_PAGE - (all.length - OLD));
  });

  it('keeps the message that leaves the newest page while the first earlier page is still on its way', async () => {
    const { api, store } = await renderApp('/inbox', longTalk);
    const log = await openTower();
    const all = messagesOf(store.state, roomOf(store.state).id);
    const edge = all[all.length - MESSAGE_PAGE];
    await within(log).findByText(edge.body);
    // The earlier page waits until the test lets it go.
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = api.call.bind(api);
    vi.spyOn(api, 'call').mockImplementation(async (...args: Parameters<typeof api.call>) => {
      const [name, input] = args;
      if (name === 'chats.messages' && (input as { before?: string }).before) await gate;
      return original(...args);
    });
    await userEvent.click(within(log).getByRole('button', { name: 'Earlier messages' }));
    send('Fresh.');
    await savedBubble(log, 'Fresh.');
    release();
    // The page ends just before "edge", so "edge" must stay in the log, or a gap opens with no sign.
    await within(log).findByText(all[all.length - 2 * MESSAGE_PAGE].body);
    expect(within(log).getByText(edge.body)).toBeInTheDocument();
    expect(notes(log)).toHaveLength(2 * MESSAGE_PAGE - (all.length - OLD));
  });

  // Chat design 2026-10-19, item 11: a deleted message leaves the newest page, and it is newer than the oldest message of the new page,
  // so it must not stay in the earlier pages as a message that "fell out" of the page.
  it('drops a deleted message also after an earlier page came', async () => {
    let doomed = '';
    const { store } = await renderApp('/inbox', (state) => {
      longTalk(state);
      const all = messagesOf(state, roomOf(state).id);
      const target = all[all.length - 20];
      target.authorId = 'usr_001';
      target.actingForId = 'usr_001';
      doomed = target.id;
    });
    const log = await openTower();
    const body = store.state.messages[doomed].body;
    await within(log).findByText(body);
    await userEvent.click(within(log).getByRole('button', { name: 'Earlier messages' }));
    const all = messagesOf(store.state, roomOf(store.state).id);
    await within(log).findByText(all[all.length - 2 * MESSAGE_PAGE].body);
    const row = document.querySelector<HTMLElement>(`[data-message-id="${doomed}"]`)!;
    await userEvent.click(within(row).getByRole('button', { name: 'Actions for this message' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Actions for this message' })).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(within(log).queryByText(body)).toBeNull());
    // The page that went above stays whole. The new newest page reaches one message further back, and that message is the last of the
    // earlier page, so 399 messages show: the two pages less the one that was deleted.
    expect(within(log).getByText(all[all.length - 2 * MESSAGE_PAGE].body)).toBeInTheDocument();
    expect(notes(log)).toHaveLength(2 * MESSAGE_PAGE - 1 - (all.length - OLD));
  });

  it('keeps the log at the bottom for a new message after an earlier page failed to load', async () => {
    const { api } = await renderApp('/inbox', longTalk);
    const log = await openTower();
    await within(log).findByText(/The sprinkler riser clashes with beam B14/);
    const scroll = measure(log);
    scroll.at(0);
    const original = api.call.bind(api);
    vi.spyOn(api, 'call').mockImplementation(async (...args: Parameters<typeof api.call>) => {
      const [name, input] = args;
      if (name === 'chats.messages' && (input as { before?: string }).before) throw new TypeError('Failed to fetch');
      return original(...args);
    });
    await userEvent.click(within(log).getByRole('button', { name: 'Earlier messages' }));
    await waitFor(() => expect(within(log).getByRole('button', { name: 'Earlier messages' })).toHaveAttribute('aria-busy', 'false'));
    send('Fresh.');
    await savedBubble(log, 'Fresh.');
    // The person's own message is in view: the failed load left no old scroll position behind.
    await waitFor(() => expect(scroll.top()).toBe(log.scrollHeight));
  });

  it('shows an earlier page at once: only new messages rise in', async () => {
    const { store } = await renderApp('/inbox', longTalk);
    const log = await openTower();
    const all = messagesOf(store.state, roomOf(store.state).id);
    await within(log).findByText(all[all.length - MESSAGE_PAGE].body);
    await userEvent.click(within(log).getByRole('button', { name: 'Earlier messages' }));
    const row = (await within(log).findByText(all[all.length - 2 * MESSAGE_PAGE].body)).closest('li')!;
    // 200 bubbles that spring in together above the message the person reads are not calm.
    expect(row.style.opacity).toBe('1');
    expect(notes(log).filter((li) => li.style.opacity !== '1')).toHaveLength(0);
    send('Fresh.');
    const fresh = (await within(log).findByText('Fresh.')).closest('li')!;
    expect(fresh.style.opacity).not.toBe('1');
  });

  it('passes the calm checks in English', async () => {
    await renderApp('/inbox', longTalk);
    const log = await openTower();
    const control = await within(log).findByRole('button', { name: 'Earlier messages' });
    expect(control).not.toHaveClass('signature');
    expectCalm(log.parentElement as HTMLElement, { titleLevel: 2 });
  });

  it('reads in Arabic right to left', async () => {
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
    await waitFor(() => expect(notes(arabicLog).length).toBeGreaterThan(MESSAGE_PAGE));
  });
});

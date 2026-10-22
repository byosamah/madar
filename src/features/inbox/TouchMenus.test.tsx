import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyReactions } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The "..." menus on a touch screen (performance audit 2026-10-21, RN-3). CSS hid the message menu and the row menu on a finger, but both
 * were built for every bubble and every row. Now a touch screen builds none of them. The sheet of a task is the exception: its menu stays.
 */
const FAISAL = 'The wall is 40 cm higher.';

/** A matchMedia that a test can turn: the pointer is a finger or not, and the screen is under 640 px or not. */
function media(initial: { coarse?: boolean; narrow?: boolean } = {}) {
  const state = { coarse: initial.coarse ?? false, narrow: initial.narrow ?? false };
  const lists = new Set<{ query: string; listeners: Set<() => void> }>();
  const matches = (query: string) => (query === '(pointer: coarse)' ? state.coarse : query === '(max-width: 639px)' ? state.narrow : false);
  vi.stubGlobal('matchMedia', (query: string) => {
    const entry = { query, listeners: new Set<() => void>() };
    lists.add(entry);
    return {
      get matches() { return matches(query); },
      media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: (_type: string, listener: () => void) => { entry.listeners.add(listener); },
      removeEventListener: (_type: string, listener: () => void) => { entry.listeners.delete(listener); },
      dispatchEvent: () => false,
    };
  });
  return {
    set(next: { coarse?: boolean; narrow?: boolean }) {
      Object.assign(state, next);
      for (const entry of lists) for (const listener of entry.listeners) listener();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: roomOf(state).id, authorId: 'usr_002', actingForId: 'usr_002', body: FAISAL, mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
}
const row = (id = 'msg_901') => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
const chats = async () => within(await screen.findByRole('list', { name: 'Chats' }));
async function openTower() {
  await userEvent.click((await chats()).getByRole('link', { name: /Corniche Office Tower/ }));
  await waitFor(() => expect(row()).not.toBeNull());
}
const rowMenus = () => document.querySelectorAll('ul[aria-label="Chats"] button[aria-label^="Options for "]').length;
const messageMenus = () => document.querySelectorAll('[data-message-id] button[aria-label="Actions for this message"]').length;

describe('the message menu on a touch screen (RN-3)', () => {
  it('builds the "..." button of each bubble on a desk', async () => {
    media();
    await renderApp('/inbox', plant);
    await openTower();
    expect(messageMenus()).toBeGreaterThan(1);
  });

  it('builds no "..." button on a finger, and the long press still opens the sheet', async () => {
    media({ coarse: true });
    await renderApp('/inbox', plant);
    await openTower();
    expect(messageMenus()).toBe(0);
    expect(row()!.querySelector('[data-part="side"] button')).toBeNull();
  });

  it('follows a change of the pointer', async () => {
    const device = media();
    await renderApp('/inbox', plant);
    await openTower();
    const desk = messageMenus();
    expect(desk).toBeGreaterThan(1);
    act(() => device.set({ coarse: true }));
    await waitFor(() => expect(messageMenus()).toBe(0));
    act(() => device.set({ coarse: false }));
    await waitFor(() => expect(messageMenus()).toBe(desk));
  });

  it('keeps the button on a narrow screen with a mouse, as the CSS did', async () => {
    media({ narrow: true });
    await renderApp('/inbox', plant);
    await openTower();
    expect(messageMenus()).toBeGreaterThan(1);
  });

  it('keeps the menu of a comment in the sheet of a task, also on a finger', async () => {
    media({ coarse: true });
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_007&thread=1', (state) => {
      state.session.currentUserId = 'usr_006';
      for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === 'tsk_007') delete state.comments[id];
      state.comments.cmt_901 = {
        id: 'cmt_901', targetType: 'task', targetId: 'tsk_007', authorId: 'usr_002', body: 'First note', reactions: emptyReactions(), fileIds: [],
        createdAt: '2026-09-29T08:00:00.000+03:00', editedAt: null,
      };
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const comments = within(await within(sheet).findByRole('region', { name: 'Comments' }));
    await comments.findByText('First note');
    expect(comments.getByRole('button', { name: 'Actions for this comment' })).toBeInTheDocument();
  });
});

describe('the row menu of the Inbox list on a touch screen (RN-3)', () => {
  it('builds one menu for each row on a desk', async () => {
    media();
    await renderApp('/inbox');
    await chats();
    await waitFor(() => expect(rowMenus()).toBeGreaterThan(3));
  });

  it('builds no row menu on a finger, or on a screen under 640 px', async () => {
    const device = media({ coarse: true });
    await renderApp('/inbox');
    await chats();
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(rowMenus()).toBe(0);
    act(() => device.set({ coarse: false, narrow: true }));
    await waitFor(() => expect(rowMenus()).toBe(0));
    act(() => device.set({ coarse: false, narrow: false }));
    await waitFor(() => expect(rowMenus()).toBeGreaterThan(3));
  });
});

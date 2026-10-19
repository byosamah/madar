import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { ar } from '../../i18n/trees';
import { renderApp } from '../../test/render';

/**
 * The message menu, the phone sheet and the reaction pills (chat design 2026-10-19, items 9 and 12; track msg B11). Hala (usr_001) is the
 * Admin. The tests plant msg_901 by Faisal Al-Harbi (usr_002) and msg_902 by Hala in the chat of Corniche Office Tower, after the sample talk.
 */
const FAISAL = 'The wall is 40 cm higher.';
const MINE = 'I will check it today.';

const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  const room = roomOf(state);
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: room.id, authorId: 'usr_002', actingForId: 'usr_002', body: FAISAL, mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
  state.messages.msg_902 = {
    id: 'msg_902', conversationId: room.id, authorId: 'usr_001', actingForId: 'usr_001', body: MINE, mentions: [],
    createdAt: '2026-09-30T08:05:00.000+03:00', editedAt: null,
  };
}
const inArabic = (state: State) => {
  plant(state);
  state.users.usr_001.preferences.language = 'ar';
};

afterEach(() => vi.unstubAllGlobals());

/** The row of one message by its id. */
const row = (id = 'msg_901') => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;

async function openTower(listName = 'Chats') {
  await userEvent.click(await within(await screen.findByRole('list', { name: listName })).findByRole('link', { name: /Corniche Office Tower/ }));
  await waitFor(() => expect(row()).not.toBeNull());
}

/** The menu is gone once its exit has run. */
const menuGone = () => waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

/** A press of 550 ms with a finger on the text of a message (by the id of its row, as the chat list repeats the last text). */
async function longPress(id: string, move?: { x: number; y: number }) {
  const target = row(id).querySelector<HTMLElement>('p')!;
  fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 10, clientY: 10 });
  if (move) fireEvent.pointerMove(target, { pointerType: 'touch', clientX: move.x, clientY: move.y });
  await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
  return target;
}

describe('the message menu on a computer', () => {
  it('opens the menu of a message with the three reactions, and a press on 👍 adds a pill with my ring', async () => {
    await renderApp('/inbox', plant);
    await openTower();
    await userEvent.click(within(row()).getByRole('button', { name: 'Actions for this message' }));
    const menu = screen.getByRole('menu', { name: 'Actions for this message' });
    expect(within(menu).getAllByRole('menuitemcheckbox').map((b) => b.textContent)).toEqual(['👍', '✅', '👀']);
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'React with 👍, 0' }));
    const pill = await within(row()).findByRole('button', { name: 'React with 👍, 1' });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(pill).toHaveAttribute('title', 'Hala Nasser');
    expect(pill).toHaveClass('ring-accent');
    // The menu closed after the choice.
    await menuGone();
    await userEvent.click(pill);
    await waitFor(() => expect(within(row()).queryByRole('button', { name: /React with 👍/ })).toBeNull());
  });

  it('marks the reaction of the person in the menu, and lists the names of two people on one pill', async () => {
    await renderApp('/inbox', (state) => {
      plant(state);
      state.messages.msg_901.reactions = { '👍': ['usr_002', 'usr_003'], '✅': [], '👀': ['usr_001'] };
    });
    await openTower();
    const pill = within(row()).getByRole('button', { name: 'React with 👍, 2' });
    expect(pill).toHaveAttribute('aria-pressed', 'false');
    expect(pill.getAttribute('title')).toBe('Faisal Al-Harbi and Reem Al-Ghamdi');
    expect(within(row()).getByRole('button', { name: 'React with 👀, 1' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(row()).getByRole('button', { name: 'Actions for this message' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'React with 👀, 1' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'React with 👍, 2' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the menu button of a message in a side spot, and closes the menu with Escape', async () => {
    await renderApp('/inbox', plant);
    await openTower();
    const button = within(row()).getByRole('button', { name: 'Actions for this message' });
    expect(button.closest('[data-part="side"]')).not.toBeNull();
    expect(row()).toHaveClass('group');
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    await menuGone();
    expect(button).toHaveFocus();
  });
});

describe('the phone sheet', () => {
  it('opens on a long press, with the preview, the reactions and Copy text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await renderApp('/inbox', plant);
    await openTower();
    await longPress('msg_901');
    const sheet = await screen.findByRole('dialog', { name: /Faisal Al-Harbi · / });
    expect(within(sheet).getByText(FAISAL, { normalizer: (text) => text.replace(/[\u2068\u2069]/g, '').trim() })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('button', { name: /React with/ })).toHaveLength(3);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Copy text' }));
    expect(writeText).toHaveBeenCalledWith(FAISAL);
    expect(await screen.findByText('Text copied.')).toBeInTheDocument();
  });

  it('reacts from the sheet and closes it', async () => {
    await renderApp('/inbox', plant);
    await openTower();
    await longPress('msg_901');
    const sheet = await screen.findByRole('dialog', { name: /Faisal Al-Harbi · / });
    await userEvent.click(within(sheet).getByRole('button', { name: 'React with ✅, 0' }));
    expect(await within(row()).findByRole('button', { name: 'React with ✅, 1' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Faisal Al-Harbi · / })).toBeNull());
  });

  it('names my own message "Your message", and opens no sheet for a short press or a moving finger', async () => {
    await renderApp('/inbox', plant);
    await openTower();
    await longPress('msg_902');
    expect(await screen.findByRole('dialog', { name: /^Your message · / })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // A short press: the finger lifts after 100 ms.
    const text = row('msg_901').querySelector<HTMLElement>('p')!;
    fireEvent.pointerDown(text, { pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    fireEvent.pointerUp(text, { pointerType: 'touch' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(screen.queryByRole('dialog')).toBeNull();
    // A moving finger scrolls the log. It opens no sheet either.
    await longPress('msg_901', { x: 40, y: 40 });
    expect(screen.queryByRole('dialog')).toBeNull();
    // A mouse never opens it.
    fireEvent.pointerDown(text, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows no Copy text where the browser has no clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    await renderApp('/inbox', plant);
    await openTower();
    await longPress('msg_901');
    const sheet = await screen.findByRole('dialog', { name: /Faisal Al-Harbi · / });
    expect(within(sheet).queryByRole('button', { name: 'Copy text' })).toBeNull();
    expect(within(sheet).getAllByRole('button', { name: /React with/ })).toHaveLength(3);
  });
});

describe('reactions on a task comment in the Inbox thread', () => {
  const clinicTask = (state: State) => {
    const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!;
    for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
    state.comments.cmt_901 = {
      id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
      reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
    };
    return task.id;
  };

  it('reacts from the menu of a comment, as the Admin', async () => {
    let taskId = '';
    await renderApp('/inbox', (state) => { taskId = clinicTask(state); });
    await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /The finish codes are ready/ }));
    await waitFor(() => expect(document.querySelector(`[data-message-id="cmt_901"]`)).not.toBeNull());
    const comment = document.querySelector<HTMLElement>('[data-message-id="cmt_901"]')!;
    expect(taskId).not.toBe('');
    await userEvent.click(within(comment).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Actions for this comment' })).getByRole('menuitemcheckbox', { name: 'React with 👀, 0' }));
    expect(await within(comment).findByRole('button', { name: 'React with 👀, 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows plain pills and no menu to a person who may not post', async () => {
    let taskId = '';
    await renderApp('/inbox', (state) => {
      taskId = clinicTask(state);
      state.comments.cmt_901.reactions = { '👍': ['usr_006'], '✅': [], '👀': [] };
      const team = new Set(Object.values(state.members).filter((m) => m.projectId === 'prj_006').map((m) => m.userId));
      const outsider = Object.values(state.users).find((u) => u.kind === 'human' && u.active && u.systemRole === 'member' && !team.has(u.id) && state.projects.prj_006.leaderId !== u.id)!;
      state.session.currentUserId = outsider.id;
    });
    await waitFor(() => expect(taskId).not.toBe(''));
    window.location.hash = `#/inbox/${taskId}`;
    const comment = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-message-id="cmt_901"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(within(comment).getByText('👍 1')).toBeInTheDocument();
    expect(within(comment).queryByRole('button', { name: /Actions for this comment|React with/ })).toBeNull();
  });
});

describe('Arabic, right to left', () => {
  it('reads the menu and the sheet in Arabic', async () => {
    await renderApp('/inbox', inArabic);
    await openTower(ar.chat.list);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    await userEvent.click(within(row()).getByRole('button', { name: 'إجراءات هذه الرسالة' }));
    const menu = screen.getByRole('menu', { name: 'إجراءات هذه الرسالة' });
    expect(within(menu).getByRole('group', { name: 'التفاعلات' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await menuGone();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn() } });
    await longPress('msg_902');
    const sheet = await screen.findByRole('dialog', { name: /^رسالتك · / });
    expect(within(sheet).getByRole('button', { name: 'انسخ النص' })).toBeInTheDocument();
    // The preview keeps the direction of its own language: an English line in an Arabic sheet sits between FSI and PDI, so its full
    // stop stays at its end.
    const preview = document.getElementById(sheet.getAttribute('aria-describedby') ?? '');
    expect(preview?.textContent?.startsWith('\u2068')).toBe(true);
    expect(preview?.textContent?.endsWith('\u2069')).toBe(true);
  });
});

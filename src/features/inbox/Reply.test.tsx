import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDirectConversation } from '../../api/chatState';
import type { State } from '../../api/store';
import { ar } from '../../i18n/trees';
import { renderApp } from '../../test/render';

/**
 * Reply in the screens (chat design 2026-10-19, item 10; track msg B12). Hala (usr_001) is the Admin. The tests plant msg_901 by Faisal
 * Al-Harbi (usr_002) in the chat of Corniche Office Tower, after the sample talk.
 */
const FAISAL = 'The wall is 40 cm higher.';
const CODES = 'The finish codes are ready.';

const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: roomOf(state).id, authorId: 'usr_002', actingForId: 'usr_002', body: FAISAL, mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
}
/** One comment on a task of the clinic project, which Hala leads. */
function plantComment(state: State) {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!;
  for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: CODES,
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
}
const taskOf = (state: State) => Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!.id;

const row = (id = 'msg_901') => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
const rowShows = (id: string) => waitFor(() => expect(row(id)).not.toBeNull());
const menuGone = () => waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

async function openTower(listName = 'Chats') {
  await userEvent.click(await within(await screen.findByRole('list', { name: listName })).findByRole('link', { name: /Corniche Office Tower/ }));
  await rowShows('msg_901');
}

/** Presses Reply in the menu of one message. */
async function reply(id = 'msg_901', label = 'Actions for this message', word = 'Reply') {
  await userEvent.click(within(row(id)).getByRole('button', { name: label }));
  await userEvent.click(within(screen.getByRole('menu', { name: label })).getByRole('menuitem', { name: word }));
}

describe('a reply in a chat', () => {
  it('shows the strip in the box, and the sent message shows the old words above its text', async () => {
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    await reply();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box).toHaveFocus());
    const strip = screen.getByText('Reply to Faisal Al-Harbi').parentElement!;
    expect(within(strip).getByText(FAISAL)).toBeInTheDocument();
    await userEvent.type(box, 'Approved.{Enter}');
    await waitFor(() => expect(Object.values(store.state.messages).find((m) => m.body === 'Approved.')?.replyToId).toBe('msg_901'));
    await waitFor(() => expect(screen.queryByText('Reply to Faisal Al-Harbi')).toBeNull());
    const made = Object.values(store.state.messages).find((m) => m.body === 'Approved.')!;
    await rowShows(made.id);
    expect(within(row(made.id)).getByText(FAISAL)).toBeInTheDocument();
    expect(within(row(made.id)).getByText('Faisal Al-Harbi')).toBeInTheDocument();
    // The reply names Faisal: he gets one reply notice.
    expect(Object.values(store.state.notifications).filter((n) => n.userId === 'usr_002' && n.reply === true)).toHaveLength(1);
  });

  it('cancels the reply with the X and with Escape, and then sends no replyToId', async () => {
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    await reply();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the reply' }));
    expect(screen.queryByText('Reply to Faisal Al-Harbi')).toBeNull();
    await reply();
    expect(screen.getByText('Reply to Faisal Al-Harbi')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Reply to Faisal Al-Harbi')).toBeNull());
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'No reply here.{Enter}');
    await waitFor(() => expect(Object.values(store.state.messages).find((m) => m.body === 'No reply here.')).toBeDefined());
    expect(Object.values(store.state.messages).find((m) => m.body === 'No reply here.')?.replyToId).toBeUndefined();
  });

  it('shows "Deleted message" in the quote of a reply to a deleted message, with no old text', async () => {
    await renderApp('/inbox', (state) => {
      plant(state);
      state.messages.msg_902 = {
        id: 'msg_902', conversationId: roomOf(state).id, authorId: 'usr_003', actingForId: 'usr_003', body: 'Understood.', mentions: ['usr_002'],
        replyToId: 'msg_901', createdAt: '2026-09-30T08:10:00.000+03:00', editedAt: null,
      };
      state.messages.msg_901.deletedAt = '2026-09-30T08:20:00.000+03:00';
    });
    await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Corniche Office Tower/ }));
    await rowShows('msg_902');
    expect(within(row('msg_902')).getByText('Deleted message')).toBeInTheDocument();
    expect(screen.queryByText(FAISAL)).toBeNull();
  });

  it('has no Reply in a closed chat, where the other person left', async () => {
    let chatId = '';
    const { router } = await renderApp('/inbox', (state) => {
      chatId = addDirectConversation(state, 'usr_001', 'usr_003', '2026-09-30T07:00:00.000+03:00').id;
      state.messages.msg_903 = {
        id: 'msg_903', conversationId: chatId, authorId: 'usr_003', actingForId: 'usr_003', body: 'Before I left.', mentions: [],
        createdAt: '2026-09-30T07:30:00.000+03:00', editedAt: null,
      };
      state.users.usr_003.active = false;
    });
    await router.navigate(`/inbox/${chatId}`);
    await rowShows('msg_903');
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    await userEvent.click(within(row('msg_903')).getByRole('button', { name: 'Actions for this message' }));
    const menu = screen.getByRole('menu', { name: 'Actions for this message' });
    // The reactions stay in a closed chat. A reply has no box to go to.
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(3);
    expect(within(menu).queryByRole('menuitem', { name: 'Reply' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await menuGone();
  });
});

describe('a reply to a task comment in the Inbox thread', () => {
  it('shows the strip with the name of the author, and sends the reply with its replyToId', async () => {
    const { store, router } = await renderApp('/inbox', plantComment);
    await router.navigate(`/inbox/${taskOf(store.state)}`);
    await rowShows('cmt_901');
    await reply('cmt_901', 'Actions for this comment');
    const author = store.state.users.usr_006.name;
    expect(screen.getByText(`Reply to ${author}`)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Thanks, checked.{Enter}');
    await waitFor(() => expect(Object.values(store.state.comments).find((c) => c.body === 'Thanks, checked.')?.replyToId).toBe('cmt_901'));
    const made = Object.values(store.state.comments).find((c) => c.body === 'Thanks, checked.')!;
    await rowShows(made.id);
    expect(within(row(made.id)).getByText(CODES)).toBeInTheDocument();
    expect(screen.queryByText(/^Reply to /)).toBeNull();
  });
});

describe('Arabic, right to left', () => {
  it('reads the strip in Arabic', async () => {
    await renderApp('/inbox', (state) => {
      plant(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    await openTower(ar.chat.list);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    await reply('msg_901', 'إجراءات هذه الرسالة', 'رد');
    expect(await screen.findByText('رد على فيصل الحربي')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ألغِ الرد' })).toBeInTheDocument();
  });
});

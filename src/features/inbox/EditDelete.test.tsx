import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { ar } from '../../i18n/trees';
import { renderApp } from '../../test/render';

/**
 * Edit and delete in the screens, the Up key and Undo (chat design 2026-10-19, item 11; track msg B13). Hala (usr_001) is the Admin. The
 * tests plant msg_901 by Faisal Al-Harbi (usr_002) in the chat of Corniche Office Tower, after the sample talk.
 */
const FAISAL = 'The wall is 40 cm higher.';

const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: roomOf(state).id, authorId: 'usr_002', actingForId: 'usr_002', body: FAISAL, mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
}
/** A comment of Hala on a task of the clinic project. */
function plantComment(state: State) {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!;
  for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_001', body: 'My own note.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
const rowShows = (id: string) => waitFor(() => expect(row(id)).not.toBeNull());
const rowGone = (id: string) => waitFor(() => expect(row(id)).toBeNull());
const menuGone = () => waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
const box = (name = 'Message') => screen.getByRole('textbox', { name });

async function openTower(listName = 'Chats') {
  await userEvent.click(await within(await screen.findByRole('list', { name: listName })).findByRole('link', { name: /Corniche Office Tower/ }));
  await rowShows('msg_901');
}

/** Sends a message from the box and gives the id of the new message. */
async function sendLine(store: { state: State }, body: string, boxName = 'Message'): Promise<string> {
  await userEvent.type(box(boxName), `${body}{Enter}`);
  return waitFor(() => {
    const made = Object.values(store.state.messages).find((m) => m.body === body);
    expect(made).toBeDefined();
    return made!.id;
  });
}

async function pick(id: string, label: string, word: string) {
  await userEvent.click(within(row(id)).getByRole('button', { name: label }));
  await userEvent.click(within(screen.getByRole('menu', { name: label })).getByRole('menuitem', { name: word }));
}

describe('edit a message', () => {
  it('opens my last message for edit with the Up key, and saves it with Enter', async () => {
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    const id = await sendLine(store, 'Draft line');
    await rowShows(id);
    await userEvent.click(box());
    await userEvent.keyboard('{ArrowUp}');
    const field = await within(row(id)).findByRole('textbox', { name: 'Edit' });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.clear(field);
    await userEvent.type(field, 'Final line{Enter}');
    await waitFor(() => expect(store.state.messages[id].body).toBe('Final line'));
    expect(store.state.messages[id].editedAt).not.toBeNull();
    await waitFor(() => expect(within(row(id)).getByText('Final line')).toBeInTheDocument());
    expect(row(id)).toHaveTextContent('edited');
    expect(within(row(id)).queryByRole('textbox')).toBeNull();
    await waitFor(() => expect(box()).toHaveFocus());
  });

  it('keeps the Up key for the text of the box: a box with words does not open an edit', async () => {
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    const id = await sendLine(store, 'Draft line');
    await rowShows(id);
    await userEvent.type(box(), 'More words');
    await userEvent.keyboard('{ArrowUp}');
    expect(within(row(id)).queryByRole('textbox', { name: 'Edit' })).toBeNull();
  });

  it('cancels an edit with Escape and with Cancel, and the old text stays', async () => {
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    const id = await sendLine(store, 'Draft line');
    await rowShows(id);
    await pick(id, 'Actions for this message', 'Edit');
    const field = await within(row(id)).findByRole('textbox', { name: 'Edit' });
    await userEvent.type(field, ' and more');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(row(id)).queryByRole('textbox')).toBeNull());
    expect(within(row(id)).getByText('Draft line')).toBeInTheDocument();
    expect(store.state.messages[id].editedAt).toBeNull();
    await pick(id, 'Actions for this message', 'Edit');
    await userEvent.click(await within(row(id)).findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(row(id)).queryByRole('textbox')).toBeNull());
    expect(store.state.messages[id].body).toBe('Draft line');
  });

  it('has Edit and Delete only on my own message', async () => {
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    await userEvent.click(within(row('msg_901')).getByRole('button', { name: 'Actions for this message' }));
    const theirs = screen.getByRole('menu', { name: 'Actions for this message' });
    expect(within(theirs).getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument();
    expect(within(theirs).queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(within(theirs).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await menuGone();
    const id = await sendLine(store, 'Mine');
    await rowShows(id);
    await userEvent.click(within(row(id)).getByRole('button', { name: 'Actions for this message' }));
    const mine = screen.getByRole('menu', { name: 'Actions for this message' });
    // The + of the head ("Add a reaction", chat presence E1) is a menu item with a label and no text.
    expect(within(mine).getAllByRole('menuitem').filter((item) => !item.hasAttribute('aria-label')).map((item) => item.textContent)).toEqual(['Reply', 'Edit', 'Delete']);
    expect(within(mine).getByRole('menuitem', { name: 'Add a reaction' })).toBeInTheDocument();
    expect(within(mine).getByRole('menuitem', { name: 'Delete' })).toHaveClass('text-late');
  });
});

describe('delete a message', () => {
  it('deletes my message with a toast, and Undo brings it back', async () => {
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    const id = await sendLine(store, 'Final line');
    await rowShows(id);
    await pick(id, 'Actions for this message', 'Delete');
    // No question comes first: the message leaves the log at once, and the toast offers Undo.
    await rowGone(id);
    expect(store.state.messages[id].deletedAt).toEqual(expect.any(String));
    expect(await screen.findByText('Message deleted.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await rowShows(id);
    expect(within(row(id)).getByText('Final line')).toBeInTheDocument();
    expect(store.state.messages[id].deletedAt).toBeUndefined();
  });

  it('reads Delete, Undo and the toast in Arabic, right to left', async () => {
    const { store } = await renderApp('/inbox', (state) => {
      plant(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    await openTower(ar.chat.list);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    const id = await sendLine(store, 'سطر للحذف', ar.chat.composer);
    await rowShows(id);
    await pick(id, 'خيارات هذه الرسالة', ar.comments.delete);
    await rowGone(id);
    expect(await screen.findByText('حُذفت الرسالة.')).toBeInTheDocument();
  });
});

describe('edit and delete a task comment in the Inbox thread', () => {
  it('edits and deletes my comment, with the Undo of the comment', async () => {
    const { store, router } = await renderApp('/inbox', plantComment);
    const taskId = Object.values(store.state.tasks).find((t) => t.projectId === 'prj_006')!.id;
    await router.navigate(`/inbox/${taskId}`);
    await rowShows('cmt_901');
    await pick('cmt_901', 'Actions for this comment', 'Edit');
    const field = await within(row('cmt_901')).findByRole('textbox', { name: 'Edit' });
    await userEvent.clear(field);
    await userEvent.type(field, 'My better note{Enter}');
    await waitFor(() => expect(store.state.comments.cmt_901.body).toBe('My better note'));
    expect(store.state.comments.cmt_901.editedAt).not.toBeNull();
    await pick('cmt_901', 'Actions for this comment', 'Delete');
    await rowGone('cmt_901');
    expect(await screen.findByText('Comment deleted.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await rowShows('cmt_901');
    expect(within(row('cmt_901')).getByText('My better note')).toBeInTheDocument();
  });
});

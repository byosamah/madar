import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGroupConversation } from '../../api/chatState';
import { keepDraftsOf } from '../../app/drafts';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * A drop of files on the open conversation goes into the attach flow of the box (fbk_030, owner 2026-10-23): the same list of picked
 * files, the same limits and the same upload target as the attach button. While a file is over the conversation, one quiet overlay says
 * "Drop to attach". A file dropped anywhere else never opens in the browser tab.
 */

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });
/** The data of a drag with files. jsdom has no DataTransfer, so it is a plain object. */
const dragOf = (files: File[]) => ({ dataTransfer: { types: ['Files'], files, dropEffect: 'none' } });
const textDrag = { dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' } };

const withGroup = (state: State) => {
  addGroupConversation(state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], '2026-09-30T09:00:00.000+03:00');
};

/** The open conversation: the box of the zone is the parent of the log. */
const zoneOf = async () => (await screen.findByRole('log', { name: 'Messages' })).closest('[data-drop-zone]') as HTMLElement;

describe('a drop on the open conversation', () => {
  // The picked files of a chat wait in memory until it is sent (app/drafts.ts). Each test starts with none.
  beforeEach(() => keepDraftsOf('usr_none'));

  it('shows one quiet overlay "Drop to attach" while a file is over the conversation, and hides it when the file leaves', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const zone = await zoneOf();
    expect(screen.queryByText('Drop to attach')).toBeNull();
    fireEvent.dragEnter(zone, dragOf([pdf('A.pdf')]));
    expect(screen.getAllByText('Drop to attach')).toHaveLength(1);
    // A child of the zone sends its own enter and leave: the overlay stays until the file leaves the zone.
    const log = await screen.findByRole('log', { name: 'Messages' });
    fireEvent.dragEnter(log, dragOf([pdf('A.pdf')]));
    fireEvent.dragLeave(zone, dragOf([pdf('A.pdf')]));
    expect(screen.getAllByText('Drop to attach')).toHaveLength(1);
    fireEvent.dragLeave(log, dragOf([pdf('A.pdf')]));
    expect(screen.queryByText('Drop to attach')).toBeNull();
  });

  it('shows no overlay for a drag that holds no file, such as selected text', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const zone = await zoneOf();
    expect(fireEvent.dragEnter(zone, textDrag)).toBe(true);
    expect(fireEvent.dragOver(zone, textDrag)).toBe(true);
    expect(screen.queryByText('Drop to attach')).toBeNull();
    fireEvent.drop(zone, textDrag);
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
  });

  it('takes one or more dropped files in a project chat, like the attach button: they join the files of the project', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const zone = await zoneOf();
    fireEvent.dragEnter(zone, dragOf([pdf('Beam B14.pdf'), pdf('Level 2.pdf')]));
    expect(fireEvent.dragOver(zone, dragOf([pdf('Beam B14.pdf')]))).toBe(false);
    fireEvent.drop(zone, dragOf([pdf('Beam B14.pdf'), pdf('Level 2.pdf')]));
    expect(screen.queryByText('Drop to attach')).toBeNull();
    const picked = within(await screen.findByRole('list', { name: 'Files to send' }));
    expect(picked.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Two sheets.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Download Beam B14.pdf' })).toBeInTheDocument();
    for (const name of ['Beam B14.pdf', 'Level 2.pdf']) {
      const file = Object.values(store.state.files).find((f) => f.name === name);
      expect(file?.projectId).toBe('prj_001');
      expect(file?.conversationId).toBeUndefined();
    }
  });

  it('keeps the dropped file in the chat itself in a direct chat and in a group', async () => {
    const { store } = await renderApp('/inbox', withGroup);
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    fireEvent.drop(await zoneOf(), dragOf([pdf('Direct.pdf')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Download Direct.pdf' })).toBeInTheDocument();
    const direct = Object.values(store.state.files).find((f) => f.name === 'Direct.pdf');
    expect(direct).toMatchObject({ projectId: null, taskId: null, stageId: null });
    expect(store.state.conversations[direct!.conversationId!].kind).toBe('direct');
    await userEvent.click(await rowLink(/Tower team/));
    fireEvent.drop(await zoneOf(), dragOf([pdf('Group.pdf')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Download Group.pdf' })).toBeInTheDocument();
    const group = Object.values(store.state.files).find((f) => f.name === 'Group.pdf');
    expect(store.state.conversations[group!.conversationId!]).toMatchObject({ kind: 'group', name: 'Tower team' });
  });

  it('stops at the same limit as the attach button', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    fireEvent.drop(await zoneOf(), dragOf(Array.from({ length: 12 }, (_, i) => pdf(`D${i + 1}.pdf`))));
    const picked = within(await screen.findByRole('list', { name: 'Files to send' }));
    expect(picked.getAllByRole('listitem')).toHaveLength(10);
    expect(await screen.findByText('You can attach 10 files at most.')).toBeInTheDocument();
  });

  it('takes a drop in the chat of a task thread, with the target of the attach button', async () => {
    const { store } = await renderApp('/inbox', (state) => {
      const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!;
      task.title = 'Room finish schedule';
      state.comments.cmt_901 = {
        id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
      };
    });
    await userEvent.click(await rowLink(/Room finish schedule/));
    fireEvent.drop(await zoneOf(), dragOf([pdf('Finish.pdf')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.files).some((f) => f.name === 'Finish.pdf')).toBe(true));
    const file = Object.values(store.state.files).find((f) => f.name === 'Finish.pdf');
    expect(file?.projectId).toBe('prj_006');
    expect(file?.taskId).toBeTruthy();
  });

  it('shows no overlay and takes nothing in a closed chat, which has no message box', async () => {
    await renderApp('/inbox', (state) => {
      state.users.usr_002.active = false;
    });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    expect(await screen.findByText('This person is inactive. This chat takes no new messages.')).toBeInTheDocument();
    const zone = await zoneOf();
    expect(fireEvent.dragEnter(zone, dragOf([pdf('X.pdf')]))).toBe(true);
    expect(screen.queryByText('Drop to attach')).toBeNull();
    fireEvent.drop(zone, dragOf([pdf('X.pdf')]));
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
  });
});

describe('a file dropped anywhere else', () => {
  it('never opens in the browser tab: the page stops the drop outside the conversation, with a chat open and with none', async () => {
    await renderApp('/inbox');
    // No chat is open yet: the Inbox still stops the drop.
    await rowLink(/Faisal Al-Harbi/);
    expect(fireEvent.dragOver(document.body, dragOf([pdf('A.pdf')]))).toBe(false);
    expect(fireEvent.drop(document.body, dragOf([pdf('A.pdf')]))).toBe(false);
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const side = await screen.findByRole('list', { name: 'Chats' });
    const over = dragOf([pdf('A.pdf')]);
    expect(fireEvent.dragOver(side, over)).toBe(false);
    // The cursor says "not here" outside the conversation, and "copy" inside it.
    expect(over.dataTransfer.dropEffect).toBe('none');
    const inside = dragOf([pdf('A.pdf')]);
    expect(fireEvent.dragOver(await zoneOf(), inside)).toBe(false);
    expect(inside.dataTransfer.dropEffect).toBe('copy');
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
    // A drag of text is not stopped.
    expect(fireEvent.dragOver(document.body, textDrag)).toBe(true);
  });
});

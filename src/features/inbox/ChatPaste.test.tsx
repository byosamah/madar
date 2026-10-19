import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGroupConversation } from '../../api/chatState';
import { keepDraftsOf } from '../../app/drafts';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { pastedFiles } from '../files/Attachments';

/**
 * A picture or a file on the clipboard goes into the attach flow of the chat box (fbk_032, owner 2026-10-23): the same list of picked
 * files, the same limits and the same upload target as the attach button. Text paste stays as it was.
 */

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });
const picture = (name = 'image.png') => new File(['x'], name, { type: 'image/png' });

/** A paste event with a made-up clipboard. jsdom has no DataTransfer, so the clipboard is a plain object. */
function paste(target: Element, files: File[], text = '') {
  return fireEvent.paste(target, {
    clipboardData: { files, types: [...(files.length > 0 ? ['Files'] : []), ...(text ? ['text/plain'] : [])], getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
}

const withGroup = (state: State) => {
  addGroupConversation(state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], '2026-09-30T09:00:00.000+03:00');
};

describe('what a paste carries (pastedFiles)', () => {
  const clip = (files: File[], text: string) => ({ files, getData: (type: string) => (type === 'text/plain' ? text : '') }) as unknown as DataTransfer;

  it('gives the files of a clipboard that holds a picture and no text', () => {
    const shot = picture();
    expect(pastedFiles(clip([shot], ''))).toEqual([shot]);
  });

  it('gives the file of a clipboard whose text is only the name of the file, as the Finder and the Explorer put it', () => {
    const file = new File(['x'], 'Beam B14.pdf', { type: 'application/pdf' });
    expect(pastedFiles(clip([file], 'Beam B14.pdf'))).toEqual([file]);
    expect(pastedFiles(clip([file], ' Beam B14.pdf\r\n'))).toEqual([file]);
  });

  it('gives nothing when real text comes with the picture, as a range of cells does: the text pastes as text', () => {
    expect(pastedFiles(clip([picture()], 'Level\tArea\n1\t120'))).toEqual([]);
  });

  it('gives nothing for text alone or for no clipboard', () => {
    expect(pastedFiles(clip([], 'Hello'))).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
  });
});

describe('a paste into the box of a chat', () => {
  // The picked files of a chat wait in memory until it is sent (app/drafts.ts). Each test starts with none.
  beforeEach(() => keepDraftsOf('usr_none'));

  it('takes a pasted picture in a project chat, like the attach button: it joins the files of the project', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    paste(box, [picture('Shot.png')]);
    expect(within(await screen.findByRole('list', { name: 'Files to send' })).getByText('Shot.png')).toBeInTheDocument();
    await userEvent.type(box, 'The screenshot.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'View Shot.png' })).toBeInTheDocument();
    const file = Object.values(store.state.files).find((f) => f.name === 'Shot.png');
    expect(file?.projectId).toBe('prj_001');
    expect(file?.conversationId).toBeUndefined();
  });

  it('keeps the file in the chat itself in a direct chat and in a group', async () => {
    const { store } = await renderApp('/inbox', withGroup);
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    paste(await screen.findByRole('textbox', { name: 'Message' }), [picture('Direct.png')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'View Direct.png' })).toBeInTheDocument();
    const direct = Object.values(store.state.files).find((f) => f.name === 'Direct.png');
    expect(direct).toMatchObject({ projectId: null, taskId: null, stageId: null });
    expect(store.state.conversations[direct!.conversationId!].kind).toBe('direct');
    await userEvent.click(await rowLink(/Tower team/));
    paste(await screen.findByRole('textbox', { name: 'Message' }), [picture('Group.png')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'View Group.png' })).toBeInTheDocument();
    const group = Object.values(store.state.files).find((f) => f.name === 'Group.png');
    expect(store.state.conversations[group!.conversationId!]).toMatchObject({ kind: 'group', name: 'Tower team' });
  });

  it('takes several pasted files at once and stops at the same limit as the attach button', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    paste(box, Array.from({ length: 11 }, (_, i) => picture(`P${i + 1}.png`)));
    const picked = within(await screen.findByRole('list', { name: 'Files to send' }));
    expect(picked.getAllByRole('listitem')).toHaveLength(10);
    expect(await screen.findByText('You can attach 10 files at most.')).toBeInTheDocument();
  });

  it('adds the pasted picture to a file that the attach button took', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Brief.pdf', { type: 'application/pdf' }));
    paste(await screen.findByRole('textbox', { name: 'Message' }), [picture('Shot.png')]);
    const picked = within(await screen.findByRole('list', { name: 'Files to send' }));
    expect(picked.getAllByRole('listitem').map((item) => item.textContent)).toEqual([expect.stringContaining('Brief.pdf'), expect.stringContaining('Shot.png')]);
  });

  it('leaves a text paste alone: no file is picked and the event is not stopped', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    const notStopped = paste(box, [], 'Some words');
    expect(notStopped).toBe(true);
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
    // A cell range puts text and a picture on the clipboard: the text pastes as text.
    const range = paste(box, [picture('cells.png')], 'Level\tArea');
    expect(range).toBe(true);
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
  });

  it('stops the paste of a file, so the name of the file is not typed into the box as well', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    const notStopped = paste(box, [new File(['x'], 'Level 2.pdf', { type: 'application/pdf' })], 'Level 2.pdf');
    expect(notStopped).toBe(false);
    expect(await screen.findByText('Level 2.pdf')).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('takes a pasted picture in the chat of a task thread, with the target of the attach button', async () => {
    const { store } = await renderApp('/inbox', (state) => {
      const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!;
      state.comments.cmt_901 = {
        id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
      };
      task.title = 'Room finish schedule';
    });
    await userEvent.click(await rowLink(/Room finish schedule/));
    paste(await screen.findByRole('textbox', { name: 'Message' }), [picture('Board.png')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.files).some((f) => f.name === 'Board.png')).toBe(true));
    const file = Object.values(store.state.files).find((f) => f.name === 'Board.png');
    expect(file?.projectId).toBe('prj_006');
    expect(file?.taskId).toBeTruthy();
  });
});

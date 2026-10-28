import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { emptyReactions } from '../../../api/contract/entities';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

/**
 * The chat icon of a to-do row (fbk_071, owner 2026-10-27). The icon always stays, so a person can open the thread. It shows a number
 * only for the comments that the person has not read, and no number when all are read. Opening the thread clears the number at once.
 * The to-do "Stair details" (tsk_007) is led by Yousef (usr_006), who looks.
 */
const TITLE = 'Stair details';
/** The office of the tests: the to-do has no comment of the sample office, and Yousef looks. */
const quiet = (state: State) => {
  state.session.currentUserId = 'usr_006';
  for (const [id, comment] of Object.entries(state.comments)) if (comment.targetType === 'task' && comment.targetId === 'tsk_007') delete state.comments[id];
  for (const key of Object.keys(state.chatReads)) if (key.startsWith('tsk_007:')) delete state.chatReads[key];
};
const talk = (state: State, count = 2) => {
  quiet(state);
  for (let n = 1; n <= count; n += 1) {
    state.comments[`cmt_88${n}`] = {
      id: `cmt_88${n}`, targetType: 'task', targetId: 'tsk_007', authorId: 'usr_001', body: `Please check the stair ${n}.`,
      reactions: emptyReactions(), fileIds: [], createdAt: `2026-10-03T0${n}:00:00.000+03:00`, editedAt: null,
    };
  }
};
const allRead = (state: State) => {
  talk(state, 3);
  state.chatReads['tsk_007:usr_006'] = { conversationId: 'tsk_007', userId: 'usr_006', lastReadAt: '2026-10-03T23:00:00.000+03:00' };
};
const rowOf = async () => (await screen.findAllByText(TITLE))[0].closest('li') as HTMLElement;
const iconOf = async () => within(await rowOf()).getByRole('button', { name: /Conversation about/ });

describe.each(['/projects/prj_001?tab=tasks', '/work', '/tasks'])('the chat icon of a to-do row on %s', (path) => {
  it('shows the number of unread comments, not the number of all comments', async () => {
    await renderApp(path, (state) => {
      talk(state);
      // One more comment that the person wrote: it is no unread one, and it is in the total.
      state.comments.cmt_889 = { ...state.comments.cmt_881, id: 'cmt_889', authorId: 'usr_006', createdAt: '2026-10-03T00:30:00.000+03:00' };
    });
    const icon = await iconOf();
    await waitFor(() => expect(icon).toHaveTextContent('2'));
    expect(icon.getAttribute('aria-label')).toContain('2 new comments');
  });

  it('keeps the icon and shows no number when all the comments are read', async () => {
    await renderApp(path, allRead);
    const icon = await iconOf();
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon).not.toHaveTextContent(/\d/);
    expect(icon.getAttribute('aria-label')).toBe(`Conversation about “${TITLE}”`);
  });

  it('shows no number for a to-do with no comment', async () => {
    await renderApp(path, quiet);
    expect(await iconOf()).not.toHaveTextContent(/\d/);
  });
});

describe('opening the conversation of a to-do', () => {
  it('clears the number on the row at once, and a new comment of another person brings it back', async () => {
    const view = await renderApp('/work', talk);
    const icon = await iconOf();
    await waitFor(() => expect(icon).toHaveTextContent('2'));
    fireEvent.click(icon);
    await screen.findByRole('dialog', { name: TITLE });
    await waitFor(() => expect(view.store.state.chatReads['tsk_007:usr_006']).toBeDefined());
    await waitFor(async () => expect(await iconOf()).not.toHaveTextContent(/\d/));
    await view.api.call('chats.markRead', { conversationId: 'tsk_007' });
    // A comment of another person after the read mark: the number comes back.
    view.store.run((state) => {
      state.comments.cmt_890 = { ...state.comments.cmt_881, id: 'cmt_890', createdAt: '2026-10-04T05:00:00.000+03:00' };
    });
    await waitFor(async () => expect(await iconOf()).toHaveTextContent('1'));
  });
});

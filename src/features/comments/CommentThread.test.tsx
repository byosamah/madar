import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}&thread=1`;

describe('comments', () => {
  it('adds a comment with a mention on a task', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Checked with @Kh');
    await userEvent.click(within(sheet).getByRole('option', { name: 'Khalid Al-Mutairi' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Checked with @[Khalid Al-Mutairi](usr_008)')).toBe(true));
    expect(await within(sheet).findByText('@Khalid Al-Mutairi')).toBeInTheDocument();
  });

  it('attaches a file to a task comment and shows it as a chip', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.upload(within(sheet).getByLabelText('Attach files'), new File(['x'], 'Stair detail.pdf', { type: 'application/pdf' }));
    expect(within(sheet).getByText('Stair detail.pdf')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Detail attached.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    const chip = await within(sheet).findByRole('button', { name: 'Download Stair detail.pdf' });
    expect(chip).toBeInTheDocument();
    const file = Object.values(store.state.files).find((f) => f.name === 'Stair detail.pdf');
    expect(file).toMatchObject({ projectId: 'prj_001', taskId: 'tsk_007' });
    expect(Object.values(store.state.comments).find((c) => c.body === 'Detail attached.')?.fileIds).toEqual([file?.id]);
  });

  it('shows a deleted file in a comment as removed', async () => {
    await renderApp(TASK('tsk_007'), (state) => {
      state.session.currentUserId = 'usr_006';
      state.comments.cmt_902 = {
        id: 'cmt_902', targetType: 'task', targetId: 'tsk_007', authorId: 'usr_006', body: 'The old detail.', fileIds: ['fil_999'],
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
      };
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(sheet).findByText('The old detail.')).toBeInTheDocument();
    expect(within(sheet).getByText('File removed')).toBeInTheDocument();
  });

  it('toggles a reaction', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const [look] = await within(sheet).findAllByRole('button', { name: /React with 👀/ });
    await userEvent.click(look);
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.reactions['👀'].includes('usr_006'))).toBe(true));
    await waitFor(() => expect(within(sheet).getAllByRole('button', { name: /React with 👀/ })[0]).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(within(sheet).getAllByRole('button', { name: /React with 👀/ })[0]);
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.reactions['👀'].includes('usr_006'))).toBe(false));
  });

  it('edits and deletes my own comment, with Undo', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'First draft');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await within(sheet).findByText('First draft');
    const mine = () => within(sheet).getByText(/First draft|Second draft/).closest('li') as HTMLElement;
    await userEvent.click(within(mine()).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const box = within(mine()).getByRole('textbox', { name: 'Edit' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Second draft');
    await userEvent.click(within(mine()).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Second draft')).toBeInTheDocument();
    expect(within(mine()).getByText(/edited/)).toBeInTheDocument();
    await userEvent.click(within(mine()).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Second draft')).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Second draft')).toBe(true));
  });

  it('shows a person outside the project the comments only', async () => {
    await renderApp(TASK('tsk_007'), as('usr_003'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(sheet).findByText('Only the project team can comment here.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('textbox', { name: 'Add a comment' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /React with/ })).toBeNull();
  });

  it('opens the thread of the post in the link', async () => {
    await renderApp('/projects/prj_001?tab=activity&update=upd_002', as('usr_002'));
    expect(await screen.findByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
  });

  it('lets the author delete a post, then brings it back with Undo', async () => {
    const { store } = await renderApp('/projects/prj_001?tab=activity', as('usr_005'));
    const post = (await screen.findByText(/I uploaded revision B/)).closest('li') as HTMLElement;
    await userEvent.click(within(post).getByRole('button', { name: 'Actions for this post' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete post' }));
    await waitFor(() => expect(store.state.updates.upd_002).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.updates.upd_002).toBeDefined());
  });
});

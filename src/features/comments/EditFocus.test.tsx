import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

// Edit hides the actions button that held the focus, so the focus fell to the page body (audit 2026-10-03, F-1).
describe('the focus of an inline edit', () => {
  it('moves into the post edit box, and back to the post actions on Cancel and on Save', async () => {
    await renderApp('/projects/prj_001?tab=activity', as('usr_005'));
    const post = () => screen.getByText(/I uploaded revision B|Revision C/).closest('li') as HTMLElement;
    await screen.findByText(/I uploaded revision B/);
    await userEvent.click(within(post()).getByRole('button', { name: 'Actions for this post' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit post' }));
    await waitFor(() => expect(within(post()).getByRole('textbox', { name: 'Post text' })).toHaveFocus());
    await userEvent.click(within(post()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(post()).getByRole('button', { name: 'Actions for this post' })).toHaveFocus());

    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit post' }));
    const box = within(post()).getByRole('textbox', { name: 'Post text' });
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.clear(box);
    await userEvent.type(box, 'Revision C is up.');
    await userEvent.click(within(post()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Revision C is up.')).toBeInTheDocument();
    await waitFor(() => expect(within(post()).getByRole('button', { name: 'Actions for this post' })).toHaveFocus());
  });

  it('moves into the comment edit box, and back to the comment actions on Cancel and on Save', async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_007&thread=1', as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'First draft');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await within(sheet).findByText('First draft');
    const mine = () => within(sheet).getByText(/First draft|Second draft/).closest('li') as HTMLElement;
    await userEvent.click(within(mine()).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(within(mine()).getByRole('textbox', { name: 'Edit' })).toHaveFocus());
    await userEvent.click(within(mine()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(mine()).getByRole('button', { name: 'Actions for this comment' })).toHaveFocus());

    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const box = within(mine()).getByRole('textbox', { name: 'Edit' });
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.clear(box);
    await userEvent.type(box, 'Second draft');
    await userEvent.click(within(mine()).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Second draft')).toBeInTheDocument();
    await waitFor(() => expect(within(mine()).getByRole('button', { name: 'Actions for this comment' })).toHaveFocus());
  });
});

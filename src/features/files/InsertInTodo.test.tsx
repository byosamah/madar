import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * Insert from a project in the to-do threads (fbk_070, tsk_482): the to-do panel of a project and the to-do thread of the Inbox. A to-do of a
 * project takes files of its own project, so the picker starts at the stages of that project. A to-do of the office (no project) keeps its
 * files on the task, so its clip stays the plain attach button.
 */
const STAMP = '2026-09-30T09:00:00.000+03:00';
const version = { letter: 'A', blobKey: 'blob_x', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP };
const TASK = '/projects/prj_001?tab=tasks&task=tsk_007&thread=1';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const commentsOf = (state: State, taskId: string) => Object.values(state.comments).filter((c) => c.targetType === 'task' && c.targetId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the to-do panel of a project', () => {
  it('opens the clip menu, starts at the project of the to-do, and posts the files as one comment', async () => {
    const { store } = await renderApp(TASK, as('usr_006'));
    const panel = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Attach' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Insert from a project' }));
    const box = within(await screen.findByRole('dialog', { name: 'Corniche Office Tower' }));
    expect(box.queryByRole('searchbox')).toBeNull();
    await userEvent.click(await box.findByRole('button', { name: /Construction Documents/ }));
    await userEvent.click(await box.findByRole('checkbox', { name: 'Cover render.svg' }));
    await userEvent.click(await box.findByRole('checkbox', { name: 'Site plan.pdf' }));
    await userEvent.click(box.getByRole('button', { name: 'Send 2 files' }));
    await waitFor(() => expect(commentsOf(store.state, 'tsk_007').some((c) => c.fileIds?.length === 2)).toBe(true));
    const files = Object.values(store.state.files).filter((f) => f.projectId === 'prj_001').length;
    expect(files).toBe(5);
  });

  it('posts 12 files as two comments, 10 and then 2', async () => {
    const { store } = await renderApp(TASK, (state) => {
      as('usr_006')(state);
      for (let n = 1; n <= 12; n += 1) {
        const id = `fil_9${String(n).padStart(2, '0')}`;
        state.files[id] = { id, projectId: 'prj_001', stageId: 'stg_004', taskId: null, name: `Sheet ${String(n).padStart(2, '0')}.pdf`, versions: [version] };
      }
    });
    const panel = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Attach' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Insert from a project' }));
    const box = within(await screen.findByRole('dialog', { name: 'Corniche Office Tower' }));
    await userEvent.click(await box.findByRole('button', { name: /Construction Documents/ }));
    for (let n = 1; n <= 12; n += 1) await userEvent.click(await box.findByRole('checkbox', { name: `Sheet ${String(n).padStart(2, '0')}.pdf` }));
    await userEvent.click(box.getByRole('button', { name: 'Send 12 files' }));
    await waitFor(() => expect(commentsOf(store.state, 'tsk_007').filter((c) => (c.fileIds?.length ?? 0) > 0).map((c) => c.fileIds!.length)).toEqual([10, 2]));
  });
});

describe('the to-do thread of the Inbox', () => {
  it('starts at the project of the to-do', async () => {
    await renderApp('/inbox/tsk_007', as('usr_006'));
    await userEvent.click(await screen.findByRole('button', { name: 'Attach' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Insert from a project' }));
    expect(await screen.findByRole('dialog', { name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('keeps the plain attach button on an office to-do, which has no project', async () => {
    const { api, router } = await renderApp('/inbox');
    const made = await api.call('tasks.create', { title: 'Renew the licence', ownerId: 'usr_001' });
    await router.navigate(`/inbox/${made.task.id}`);
    await screen.findByRole('textbox', { name: 'Message' });
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
    expect(screen.getByLabelText('Attach files')).toBeInTheDocument();
  });
});

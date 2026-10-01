import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { ApiError } from '../../../api/errors';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001?tab=activity';

describe('the Activity tab', () => {
  it('shows posts with mentions and the agent summary', async () => {
    await renderApp(PROJECT);
    expect(await screen.findByText(/I uploaded revision B of the ground floor plan/)).toBeInTheDocument();
    expect(screen.getAllByText('@Faisal Al-Harbi').length).toBeGreaterThan(0);
    expect(screen.getByText(/Next deadline: Stage submission, today\./)).toBeInTheDocument();
  });

  it('filters the feed to posts', async () => {
    const { api } = await renderApp(PROJECT);
    await screen.findByText(/I uploaded revision B/);
    await api.call('tasks.complete', { id: 'tsk_009' });
    expect(await screen.findByText('completed “Specifications draft”')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Posts' }));
    await waitFor(() => expect(screen.queryByText('completed “Specifications draft”')).toBeNull());
    expect(screen.getByText(/I uploaded revision B/)).toBeInTheDocument();
  });

  it('posts an update that mentions a teammate', async () => {
    const { store } = await renderApp(PROJECT, as('usr_002'));
    const box = await screen.findByRole('textbox', { name: 'Post an update' });
    await userEvent.type(box, 'Ready for review @Sa');
    await userEvent.click(screen.getByRole('option', { name: 'Sara Al-Qahtani' }));
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Update posted.')).toBeInTheDocument();
    expect(Object.values(store.state.updates).some((u) => u.body === 'Ready for review @[Sara Al-Qahtani](usr_005)')).toBe(true);
  });

  it('shows no composer to a person outside the project', async () => {
    await renderApp(PROJECT, as('usr_003'));
    expect(await screen.findByText('Only the project team can post here.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Post an update' })).toBeNull();
  });

  it('focuses the composer when Post update opens the tab', async () => {
    await renderApp('/projects/prj_001?tab=activity&compose=1', as('usr_002'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Post an update' })).toHaveFocus());
  });

  it('points the composer at the mention list only while the list is open', async () => {
    await renderApp(PROJECT, as('usr_002'));
    const box = await screen.findByRole('textbox', { name: 'Post an update' });
    expect(box).not.toHaveAttribute('aria-controls');
    await userEvent.type(box, '@Sa');
    expect(box).toHaveAttribute('aria-controls', 'composer-mentions');
  });

  it('does not upload an attachment twice after a failed post', async () => {
    const { store, api } = await renderApp(PROJECT, as('usr_002'));
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: { correlationId?: string }) => {
      if (name === 'updates.create' && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await userEvent.type(await screen.findByRole('textbox', { name: 'Post an update' }), 'New render');
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'Lobby render.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Update posted.')).toBeInTheDocument();
    expect(Object.values(store.state.files).find((f) => f.name === 'Lobby render.png')?.versions).toHaveLength(1);
  });

  it('shows a focus ring on Attach files', async () => {
    await renderApp(PROJECT, as('usr_002'));
    expect((await screen.findByText('Attach files')).closest('label')).toHaveClass('has-[:focus-visible]:outline-2');
  });

  it('lets the leader undo an agent change from the feed (spec 10.7)', async () => {
    const { store, api } = await renderApp(PROJECT, as('usr_009'));
    await api.call('tasks.create', { projectId: 'prj_001', title: 'Agent draft', ownerId: 'usr_005' });
    await api.call('session.previewAs', { userId: 'usr_002' });
    const line = (await screen.findByText(/Agent draft/)).closest('li') as HTMLElement;
    await userEvent.click(within(line).getByRole('button', { name: 'Undo agent change' }));
    await waitFor(() => expect(Object.values(store.state.tasks).some((task) => task.title === 'Agent draft')).toBe(false));
  });

  it('shows a team member no Undo on an agent change', async () => {
    const { api } = await renderApp(PROJECT, as('usr_009'));
    await api.call('tasks.create', { projectId: 'prj_001', title: 'Agent draft', ownerId: 'usr_005' });
    await api.call('session.previewAs', { userId: 'usr_006' });
    const line = (await screen.findByText(/Agent draft/)).closest('li') as HTMLElement;
    expect(within(line).queryByRole('button', { name: 'Undo agent change' })).toBeNull();
  });

  it('counts a typed full name as a mention (plan clarification 9)', async () => {
    const { store } = await renderApp(PROJECT, as('usr_002'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Post an update' }), '@Sara Al-Qahtani please check{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await screen.findByText('Update posted.');
    const post = Object.values(store.state.updates).find((u) => u.body.includes('please check'));
    expect(post?.body).toBe('@[Sara Al-Qahtani](usr_005) please check');
    expect(Object.values(store.state.notifications).some((n) => n.userId === 'usr_005' && n.trigger === 'mention' && n.targetId === post?.id)).toBe(true);
  });
});

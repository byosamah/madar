import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';
import { clearLivePostDrafts } from './overview/postDraft';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';
const headerOf = async () => (await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).closest('header') as HTMLElement;

afterEach(() => {
  clearLivePostDrafts();
  window.localStorage.clear();
});

describe('the project header on a phone (phone D, P5)', () => {
  it('draws the identity row, the stage row and the action row', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    const header = await headerOf();
    expect(within(header).getByText('Stage 4 of 7')).toBeInTheDocument();
    expect(within(header).getByRole('progressbar', { name: 'Stage 4 of 7' })).toHaveClass('w-full');
    expect(within(header).queryByText(/Stage ends|No deadline/)).toBeNull();
    expect(within(header).getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    const post = within(header).getByRole('button', { name: 'Post update' });
    const chat = within(header).getByRole('link', { name: 'Project chat' });
    expect(post).toHaveClass('flex-1', 'signature');
    expect(chat).toHaveClass('flex-1', 'bg-fill');
  });

  it('gives the row to the one button that stays', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, (state) => {
      as('usr_002')(state);
      // Project chat stays closed to this person: no chat id in the answer.
      for (const [id, chat] of Object.entries(state.conversations)) {
        if (chat.kind === 'project' && chat.projectId === 'prj_001') delete state.conversations[id];
      }
    });
    const header = await headerOf();
    const row = header.querySelector('[data-action-row]') as HTMLElement;
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).getByRole('button', { name: 'Post update' })).toHaveClass('flex-1');
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('hides the action row for a person with neither button', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_003'));
    const header = await headerOf();
    expect(header.querySelector('[data-action-row]')).toBeNull();
  });

  it.each(['tracker', 'files'])('turns Post update grey on %s when the tab button shows', async (tab) => {
    phoneMedia(true);
    await renderApp(`${PROJECT}?tab=${tab}`, as('usr_002'));
    const header = await headerOf();
    expect(within(header).getByRole('button', { name: 'Post update' })).not.toHaveClass('signature');
  });

  it('turns Post update grey while the update box holds text, and keeps one navy button', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    const header = await headerOf();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Post an update' }), 'Hi');
    expect(within(header).getByRole('button', { name: 'Post update' })).not.toHaveClass('signature');
    expect(document.querySelectorAll('main .signature')).toHaveLength(1);
  });

  it('opens the Project chat with the opener in the state', async () => {
    phoneMedia(true);
    const { router } = await renderApp(`${PROJECT}?tab=files`, as('usr_002'));
    await userEvent.click(await screen.findByRole('link', { name: 'Project chat' }));
    expect(router.state.location.state).toEqual({ from: '/projects/prj_001?tab=files' });
  });

  it('sends Post update to the box on Overview', async () => {
    phoneMedia(true);
    await renderApp(`${PROJECT}?tab=files`, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Post update' }));
    expect(await screen.findByRole('textbox', { name: 'Post an update' })).toBeInTheDocument();
    expect(window.location.hash).toContain('tab=overview');
  });

  it('keeps the desk header: one row, next deadline label, no stage count text', async () => {
    await renderApp(PROJECT, as('usr_002'));
    const header = await headerOf();
    expect(header.querySelector('[data-action-row]')).toBeNull();
    expect(within(header).queryByText('Stage 4 of 7')).toBeNull();
    expect(within(header).getByRole('progressbar', { name: 'Stage 4 of 7' })).not.toHaveClass('w-full');
  });
});

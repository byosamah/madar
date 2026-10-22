import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { State } from '../../../api/store';
import { addDays } from '../../../lib/dates';
import { TODAY } from '../../../test/factories';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';
import { clearLivePostDrafts } from './postDraft';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';
const ORDER = ['overview-standing', 'overview-attention', 'overview-payments', 'overview-updates', 'overview-meetings', 'overview-coming', 'overview-people', 'about-title'];
const panelIds = () => [...document.querySelectorAll('main section[aria-labelledby]')].map((s) => s.getAttribute('aria-labelledby')).filter((id) => ORDER.includes(id!));

afterEach(() => {
  clearLivePostDrafts();
  window.localStorage.clear();
});

describe('the Overview of a project on a phone (phone D, P4)', () => {
  it('orders the panels for a phone', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    await screen.findByRole('region', { name: 'Who is doing what' });
    const ids = panelIds();
    const wanted = ['overview-standing', 'overview-attention', 'overview-updates', 'overview-meetings', 'overview-coming', 'overview-people', 'about-title'];
    expect(ids.filter((id) => wanted.includes(id!))).toEqual(wanted);
  });

  it('puts the payments panel after Needs attention for a payment role', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_001'));
    await screen.findByRole('region', { name: 'Who is doing what' });
    await screen.findByRole('region', { name: 'Payments' });
    const ids = panelIds();
    expect(ids.indexOf('overview-payments')).toBe(ids.indexOf('overview-attention') + 1);
    expect(ids.indexOf('overview-updates')).toBe(ids.indexOf('overview-payments') + 1);
  });

  it('drops the stage name, count and steps from the first panel, and keeps the facts', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    const standing = await screen.findByRole('region', { name: 'Where the project stands' });
    expect(within(standing).queryByRole('progressbar')).toBeNull();
    expect(within(standing).queryByText('Construction Documents')).toBeNull();
    expect(within(standing).getByText('To-dos in this stage')).toBeInTheDocument();
    expect(within(standing).getByText('Stage end')).toBeInTheDocument();
  });

  it('shows the Next deadline row, in the Attention color when the date is past', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, (state) => {
      as('usr_002')(state);
      for (const id of Object.keys(state.deadlines)) if (state.deadlines[id].projectId === 'prj_001') delete state.deadlines[id];
      state.deadlines.ddl_990 = { id: 'ddl_990', projectId: 'prj_001', stageId: null, name: 'Permit set', date: addDays(TODAY, -2) };
    });
    const standing = await screen.findByRole('region', { name: 'Where the project stands' });
    expect(within(standing).getByText('Next deadline')).toBeInTheDocument();
    expect(within(standing).getByText('Permit set').closest('p')).toHaveClass('text-attn');
  });

  it('says No deadline when the project has no deadline and no stage end', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, (state) => {
      as('usr_002')(state);
      for (const id of Object.keys(state.deadlines)) if (state.deadlines[id].projectId === 'prj_001') delete state.deadlines[id];
      state.projects.prj_001.status = 'on_hold';
    });
    const standing = await screen.findByRole('region', { name: 'Where the project stands' });
    expect(within(standing).getByText('No deadline')).toBeInTheDocument();
  });

  it('shows who set the health and why in the first panel', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Late/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Set health' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'At risk' }));
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'Client delay');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Set health' }));
    const standing = await screen.findByRole('region', { name: 'Where the project stands' });
    expect(await within(standing).findByText('Client delay')).toBeInTheDocument();
  });

  it('shows the Updates panel with the box and the newest posts', async () => {
    phoneMedia(true);
    const { store } = await renderApp(PROJECT, as('usr_002'));
    const panel = await screen.findByRole('region', { name: 'Updates' });
    expect(within(panel).getByRole('textbox', { name: 'Post an update' })).toBeInTheDocument();
    const posts = Object.values(store.state.updates).filter((item) => item.projectId === 'prj_001').length;
    await waitFor(() => expect(panel.querySelectorAll('[data-post]').length).toBe(Math.min(2, posts)));
    expect(within(panel).getByRole('link', { name: 'See all activity' })).toHaveAttribute('href', '#/projects/prj_001?tab=activity');
  });

  it('shows the line "Only the project team can post here." in place of the box', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_003'));
    const panel = await screen.findByRole('region', { name: 'Updates' });
    expect(within(panel).getByText('Only the project team can post here.')).toBeInTheDocument();
    expect(within(panel).queryByRole('textbox')).toBeNull();
  });

  it('makes the box compact until it has the focus', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    const box = await screen.findByRole('textbox', { name: 'Post an update' });
    const holder = () => box.closest('div.relative') as HTMLElement;
    expect(holder().className).toContain('min-h-11');
    expect(holder().className).not.toContain('min-h-24');
    expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
    expect(screen.queryByText('Attach files')).toBeNull();
    await userEvent.click(box);
    expect(holder().className).toContain('min-h-24');
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).not.toHaveClass('signature');
    await userEvent.type(box, 'Hello');
    expect(screen.getByRole('button', { name: 'Post' })).toHaveClass('signature');
    await userEvent.clear(box);
    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Post' })).toBeNull());
  });

  it('keeps the typed update across a tab change', async () => {
    phoneMedia(true);
    const { router } = await renderApp(PROJECT, as('usr_002'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Post an update' }), 'Hello');
    await act(async () => { await router.navigate('/projects/prj_001?tab=tasks'); });
    await screen.findByRole('tab', { name: 'To-dos' });
    await act(async () => { await router.navigate('/projects/prj_001'); });
    expect(await screen.findByRole('textbox', { name: 'Post an update' })).toHaveValue('Hello');
  });

  it('opens ?compose=1 on the box, scrolls to it and focuses it', async () => {
    phoneMedia(true);
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await renderApp(`${PROJECT}?compose=1`, as('usr_002'));
    const box = await screen.findByRole('textbox', { name: 'Post an update' });
    await waitFor(() => expect(box).toHaveFocus());
    expect(scroll).toHaveBeenCalled();
    expect(window.location.hash).not.toContain('compose');
  });

  it('shows no drop frame for the box on a phone', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    const form = (await screen.findByRole('textbox', { name: 'Post an update' })).closest('form') as HTMLElement;
    fireEvent.dragEnter(form, { dataTransfer: { types: ['Files'] } });
    expect(screen.queryByText('The files join this post. Nothing posts until you press Post.')).toBeNull();
  });

  it('shows the drop frame on a desk (Activity)', async () => {
    await renderApp(`${PROJECT}?tab=activity`, as('usr_002'));
    const form = (await screen.findByRole('textbox', { name: 'Post an update' })).closest('form') as HTMLElement;
    fireEvent.dragEnter(form, { dataTransfer: { types: ['Files'] } });
    expect(await screen.findByText('The files join this post. Nothing posts until you press Post.')).toBeInTheDocument();
  });

  it('opens the task panel from ?task= on Overview', async () => {
    phoneMedia(true);
    await renderApp(`${PROJECT}?task=tsk_007`, as('usr_002'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('leaves the box off the Activity page on a phone', async () => {
    phoneMedia(true);
    await renderApp(`${PROJECT}?tab=activity`, as('usr_002'));
    await screen.findByRole('button', { name: /^Filter/ });
    expect(screen.queryByRole('textbox', { name: 'Post an update' })).toBeNull();
  });

  it('keeps the desk Overview as it is', async () => {
    await renderApp(PROJECT, as('usr_002'));
    expect(await screen.findAllByRole('region', { name: 'Latest update' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Updates' })).toBeNull();
    expect(screen.queryByText('Next deadline')).toBeNull();
  });
});

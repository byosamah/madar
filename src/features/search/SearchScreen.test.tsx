import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { emptyReactions } from '../../api/contract/entities';
import { renderApp } from '../../test/render';
import { stubPhone } from '../inbox/phoneHarness';

const asSara = (state: State) => {
  state.session.currentUserId = 'usr_005';
};
const box = () => screen.findByRole('combobox');

describe('search', () => {
  it('finds a project in capital letters and opens it with Enter', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'CORNICHE');
    expect(await screen.findByRole('option', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('shows tasks and files in their own groups', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'ground floor');
    const tasks = await screen.findByRole('group', { name: 'To-dos' });
    expect(within(tasks).getAllByRole('option', { name: /Ground floor plan/ }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('group', { name: 'Files' })).getAllByRole('option', { name: /Ground floor plan\.pdf/ }).length).toBeGreaterThan(0);
  });

  // The search lives in the link, so Back from a result shows the same search again (audit PER-14).
  it('keeps the search text in the link and brings it back after Back', async () => {
    const { router } = await renderApp('/search');
    await userEvent.type(await box(), 'corniche');
    await waitFor(() => expect(window.location.hash).toContain('q=corniche'));
    await userEvent.click(await screen.findByRole('option', { name: /Corniche Office Tower/ }));
    await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' });
    await router.navigate(-1);
    expect(await box()).toHaveValue('corniche');
    expect(await screen.findByRole('option', { name: /Corniche Office Tower/ })).toBeInTheDocument();
  });

  // A file found by Search opens that file, not only its tab (audit PER-15).
  it('opens the preview of a file it found', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'ground floor plan.pdf');
    const files = await screen.findByRole('group', { name: 'Files' });
    await userEvent.click(within(files).getAllByRole('option', { name: /Ground floor plan\.pdf/ })[0]);
    // The project, its file list and the preview load one after the other, so this step may take longer than one second. It
    // failed three times under the load of the full suite (2026-10-04): the search screen wrote "?q=" over the link of the file
    // (useQueryInLink.test.tsx), so the preview never opened. The longer wait stays for the load.
    expect(await screen.findByRole('dialog', { name: /Ground floor plan\.pdf/ }, { timeout: 10_000 })).toBeInTheDocument();
  }, 15_000);

  it('runs a command', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'dash');
    await userEvent.click(await screen.findByRole('option', { name: 'Go to Dashboard' }));
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'));
  });

  it('creates a task with no lead from the New task command (owner, 2026-10-05)', async () => {
    const { store } = await renderApp('/search', asSara);
    await userEvent.click(await screen.findByRole('option', { name: 'New to-do' }));
    const sheet = await screen.findByRole('dialog', { name: 'New to-do' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Project'), 'KH-26-001 · Corniche Office Tower');
    await userEvent.type(within(sheet).getByLabelText('Title'), 'Fire exit check');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create to-do' }));
    expect(await screen.findByText('To-do created.')).toBeInTheDocument();
    expect(Object.values(store.state.tasks).some((task) => task.title === 'Fire exit check' && task.ownerId === null && task.stageId === 'stg_004')).toBe(true);
  });

  it('opens a person with their active projects', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'sara');
    const list = await screen.findByRole('group', { name: 'People' });
    await userEvent.click(await within(list).findByRole('option', { name: /Sara Al-Qahtani/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sara Al-Qahtani' });
    expect(within(sheet).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'zzzz');
    expect(await screen.findByText('No results for “zzzz”.')).toBeInTheDocument();
  });

  it('names the suggestion list in the language of the screen (audit 2026-10-03, F-4)', async () => {
    await renderApp('/search', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    expect(await screen.findByRole('listbox', { name: 'الاقتراحات' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Suggestions' })).toBeNull();
  });

  // INT-25: a sub-company name finds one row, not its projects one by one. The row opens the filtered Projects list.
  it('finds a sub-company by its name and opens the list of its projects', async () => {
    await renderApp('/search', (state) => {
      state.subCompanies = { sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' } };
      for (const id of ['prj_001', 'prj_002']) Object.assign(state.projects[id], { subCompanyId: 'sub_001' });
    });
    await userEvent.type(await box(), 'vado');
    const group = await screen.findByRole('group', { name: 'Sub-companies' });
    const row = within(group).getByRole('option', { name: /Vado/ });
    expect(row).toHaveTextContent('2 projects');
    await userEvent.click(row);
    await waitFor(() => expect(window.location.hash).toContain('/projects?subCompany=sub_001'));
  });
});

/** The Messages mark of the chat header (Direction D): /search?in=messages shows Messages first and hides Commands. */
describe('search on its Messages group (?in=messages)', () => {
  let room = '';
  const plant = (state: State) => {
    room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!.id;
    state.messages.msg_950 = {
      id: 'msg_950', conversationId: room, authorId: 'usr_002', actingForId: 'usr_002', body: 'The new riser size is 150 mm', mentions: [], fileIds: [],
      createdAt: '2026-10-04T08:30:00.000+03:00', editedAt: null,
    };
    state.messages.msg_951 = {
      id: 'msg_951', conversationId: room, authorId: 'usr_002', actingForId: 'usr_002', body: 'The ground floor plan is ready', mentions: [], fileIds: [],
      createdAt: '2026-10-04T08:31:00.000+03:00', editedAt: null,
    };
    state.comments.cmt_950 = {
      id: 'cmt_950', targetType: 'task', targetId: Object.values(state.tasks).find((t) => t.projectId === 'prj_001')!.id, authorId: 'usr_001',
      body: 'Riser spacing noted', reactions: emptyReactions(), fileIds: [], createdAt: '2026-10-04T08:32:00.000+03:00', editedAt: null,
    };
  };
  const headings = () => [...document.querySelectorAll('[cmdk-group-heading]')].map((node) => node.textContent);

  it('shows Messages first and no Commands, and names the field Search messages', async () => {
    await renderApp('/search?in=messages', plant);
    const field = await box();
    expect(field).toHaveAttribute('placeholder', 'Search messages');
    expect(screen.queryByText('Commands')).toBeNull();
    await userEvent.type(field, 'riser');
    await screen.findByRole('group', { name: 'Messages' });
    expect(headings()[0]).toBe('Messages');
    expect(screen.queryByText('Commands')).toBeNull();
  });

  it('keeps the other groups after Messages', async () => {
    await renderApp('/search?in=messages', plant);
    await userEvent.type(await box(), 'ground floor');
    await screen.findByRole('group', { name: 'Messages' });
    await waitFor(() => expect(headings()).toContain('To-dos'));
    expect(headings().indexOf('Messages')).toBe(0);
    expect(headings()).toContain('Files');
  });

  it('shows Commands first and Messages last without the mark', async () => {
    await renderApp('/search', plant);
    // "new" is in a command (New to-do) and in a message (The new riser size).
    await userEvent.type(await box(), 'new');
    await screen.findByRole('group', { name: 'Messages' });
    expect(headings()[0]).toBe('Commands');
    expect(headings().at(-1)).toBe('Messages');
    expect(await box()).toHaveAttribute('placeholder', 'Search projects, to-dos, people, files and messages');
  });

  it('keeps the mark in the link when it writes q', async () => {
    const { router } = await renderApp('/search?in=messages', plant);
    const field = await box();
    await userEvent.type(field, 'corniche');
    await waitFor(() => expect(router.state.location.search).toBe('?in=messages&q=corniche'));
    await userEvent.clear(field);
    await waitFor(() => expect(router.state.location.search).toBe('?in=messages'));
  });

  it('passes state.from "/search" when a hit opens a chat, and Back returns to the same search', async () => {
    stubPhone();
    const { router } = await renderApp('/search?in=messages', plant);
    await userEvent.type(await box(), 'riser size');
    const group = await screen.findByRole('group', { name: 'Messages' });
    await userEvent.click(within(group).getByRole('option', { name: /Corniche Office Tower.*riser/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/inbox/${room}`));
    expect(router.state.location.state).toEqual({ from: '/search' });
    await userEvent.click(await screen.findByRole('link', { name: 'Back to chats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
    expect(router.state.historyAction).toBe('POP');
    expect(await box()).toHaveValue('riser size');
  });
});

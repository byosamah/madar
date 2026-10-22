import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderHeldRemoteApp, type Asked } from '../../test/heldRemoteApp';

/**
 * A closed sheet reads nothing (performance audit 2026-10-21, DF-5). The real build opens each screen over the sample office as
 * the Admin (usr_001), which holds every sheet. A press on the button or the menu item starts the reads of its sheet at once
 * (pointerdown), so the sheet finds the answers when it opens.
 */
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const flush = (ms = 60) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const times = (asked: Asked[], name: string, input?: unknown) => asked.filter((call) => call.name === name && (input === undefined || JSON.stringify(call.input) === JSON.stringify(input))).length;

describe('the New project sheet, closed', () => {
  it('asks projectTemplates.list and projects.list (all) only after a press on New project', async () => {
    const app = await renderHeldRemoteApp('/projects', as('usr_001'));
    await flush(300);
    expect(times(app.asked, 'projectTemplates.list')).toBe(0);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(0);
    const button = await screen.findByRole('button', { name: /New project/i });
    // The press starts the reads before the click: pointerdown, then the click opens the sheet.
    fireEvent.pointerDown(button);
    await flush();
    expect(times(app.asked, 'projectTemplates.list')).toBe(1);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(1);
    await userEvent.click(button);
    await screen.findByRole('dialog');
    await flush(100);
    // The sheet found both answers in the cache.
    expect(times(app.asked, 'projectTemplates.list')).toBe(1);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(1);
  });

  it('still loads the reads when the sheet opens without a pointer press (a key)', async () => {
    const app = await renderHeldRemoteApp('/projects', as('usr_001'));
    await flush(300);
    const button = await screen.findByRole('button', { name: /New project/i });
    act(() => button.focus());
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await waitFor(() => expect(times(app.asked, 'projectTemplates.list')).toBe(1));
    await waitFor(() => expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(1));
  });

  it('asks nothing for the sheet on the Search screen until the command is pressed', async () => {
    const app = await renderHeldRemoteApp('/search', as('usr_001'));
    await flush(300);
    expect(times(app.asked, 'projectTemplates.list')).toBe(0);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(0);
    expect(times(app.asked, 'settings.get')).toBe(0);
    const command = await screen.findByRole('option', { name: /New project/i });
    fireEvent.pointerDown(command);
    await flush();
    expect(times(app.asked, 'projectTemplates.list')).toBe(1);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(1);
    expect(times(app.asked, 'settings.get')).toBe(1);
  });
});

describe('the sheets of the project page, closed', () => {
  it('asks neither the templates nor the codes of the office until the menu item is pressed', async () => {
    const app = await renderHeldRemoteApp('/projects/prj_001', as('usr_001'));
    await flush(300);
    expect(times(app.asked, 'projectTemplates.list')).toBe(0);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(0);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 }));
    const apply = await screen.findByRole('menuitem', { name: 'Apply a template' });
    fireEvent.pointerDown(apply);
    await flush();
    expect(times(app.asked, 'projectTemplates.list')).toBe(1);
    await userEvent.click(apply);
    await screen.findByRole('dialog');
    await flush(100);
    expect(times(app.asked, 'projectTemplates.list')).toBe(1);
  });

  it('starts the codes of the office on a press of Edit project, for the Admin', async () => {
    const app = await renderHeldRemoteApp('/projects/prj_001', as('usr_001'));
    await flush(300);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(0);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 }));
    const edit = await screen.findByRole('menuitem', { name: 'Edit project' });
    fireEvent.pointerDown(edit);
    await flush();
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(1);
    await userEvent.click(edit);
    await screen.findByRole('dialog');
    await flush(100);
    expect(times(app.asked, 'projects.list', { status: 'all' })).toBe(1);
  });
});

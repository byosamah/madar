import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { State } from '../../../api/store';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASKS = '/projects/prj_001?tab=tasks';

afterEach(() => window.localStorage.clear());

/** The stage of prj_001 with the most to-dos, so the counts are not zero. */
function busiestStage(state: State) {
  const stages = Object.values(state.stages).filter((stage) => stage.projectId === 'prj_001');
  const counted = stages.map((stage) => {
    const tasks = Object.values(state.tasks).filter((task) => task.stageId === stage.id);
    return { stage, total: tasks.length, done: tasks.filter((task) => task.status === 'done').length };
  });
  return counted.sort((a, b) => b.total - a.total)[0];
}

describe('the To-dos tab on a phone (phone D, P7)', () => {
  it('shows two buttons: Filter and View', async () => {
    phoneMedia(true);
    await renderApp(TASKS, as('usr_002'));
    expect(await screen.findByRole('button', { name: /^Filter/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View: List' })).toHaveClass('min-h-11');
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    expect(within(sheet).queryByRole('radio', { name: 'Board' })).toBeNull();
    expect(within(sheet).getByRole('checkbox', { name: 'Show done to-dos' })).toBeInTheDocument();
  });

  it('switches to the board in one press and keeps the choice on the device', async () => {
    phoneMedia(true);
    await renderApp(TASKS, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'View: List' }));
    expect(screen.getByRole('button', { name: 'View: Board' })).toBeInTheDocument();
    expect(window.localStorage.getItem('madar.tasks.view')).toBe('board');
  });

  it('titles a stage group "n of m done" under the filter All, with the hidden done to-dos in the total', async () => {
    phoneMedia(true);
    const { store } = await renderApp(TASKS, as('usr_002'));
    const { stage, done, total } = busiestStage(store.state);
    const group = await screen.findByRole('region', { name: stage.name });
    expect(within(group).getByText(`${done} of ${total} done`)).toBeInTheDocument();
  });

  it('keeps the same count when the done to-dos show', async () => {
    phoneMedia(true);
    const { store } = await renderApp(`${TASKS}&done=1`, as('usr_002'));
    const { stage, done, total } = busiestStage(store.state);
    const group = await screen.findByRole('region', { name: stage.name });
    expect(within(group).getByText(`${done} of ${total} done`)).toBeInTheDocument();
  });

  it('keeps the count of today under any other filter', async () => {
    phoneMedia(true);
    await renderApp(`${TASKS}&show=mine`, as('usr_002'));
    const groups = await screen.findAllByRole('region');
    const counted = groups.filter((group) => within(group).queryByText(/^To-dos: \d+$/));
    expect(counted.length).toBeGreaterThan(0);
    for (const group of counted) {
      const n = Number(within(group).getByText(/^To-dos: \d+$/).textContent!.replace('To-dos: ', ''));
      expect(group.querySelectorAll('li').length).toBeGreaterThanOrEqual(n);
    }
    expect(screen.queryByText(/ of \d+ done$/)).toBeNull();
  });

  it('keeps "To-dos: 0" for a stage with no to-do', async () => {
    phoneMedia(true);
    const { store } = await renderApp(TASKS, as('usr_002'));
    const emptyStage = Object.values(store.state.stages).find((stage) => stage.projectId === 'prj_001' && !Object.values(store.state.tasks).some((task) => task.stageId === stage.id))!;
    const group = await screen.findByRole('region', { name: emptyStage.name });
    expect(within(group).getByText('To-dos: 0')).toBeInTheDocument();
    expect(within(group).queryByText(/0 of 0 done/)).toBeNull();
  });

  it('puts the add row last in each group, and first on a desk', async () => {
    const view = phoneMedia(true);
    await renderApp(TASKS, as('usr_002'));
    const field = await screen.findByRole('textbox', { name: 'Add a to-do in Permits' });
    const group = field.closest('section') as HTMLElement;
    const rows = group.querySelector('ul, ol') as HTMLElement | null;
    const form = field.closest('form') as HTMLElement;
    expect(rows).not.toBeNull();
    expect(rows!.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.set(false);
    await waitFor(() => {
      const desk = screen.getByRole('textbox', { name: 'Add a to-do in Permits' });
      const deskRows = (desk.closest('section') as HTMLElement).querySelector('ul, ol') as HTMLElement;
      expect(deskRows.compareDocumentPosition(desk.closest('form') as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });
  });

  it('keeps the add row 44 px and the template menu at its end', async () => {
    phoneMedia(true);
    await renderApp(TASKS, as('usr_002'));
    const button = await screen.findByRole('button', { name: 'New to-do in Permits' });
    expect(button).toHaveClass('size-11');
    const form = button.closest('form') as HTMLElement;
    const field = within(form).getByRole('textbox', { name: 'Add a to-do in Permits' });
    const menu = within(form).getByRole('button', { name: /^From a template/ });
    expect(field.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the "N have no lead" line and Show them', async () => {
    phoneMedia(true);
    await renderApp(TASKS, (state) => {
      as('usr_002')(state);
      const first = Object.values(state.tasks).find((task) => task.projectId === 'prj_001' && task.status !== 'done')!;
      first.ownerId = null;
    });
    expect(await screen.findByRole('button', { name: 'Show them' })).toBeInTheDocument();
  });

  it('keeps the Filter and View choices of the desk in one box', async () => {
    await renderApp(TASKS, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    const box = await screen.findByRole('dialog', { name: 'Filter' });
    expect(within(box).getByRole('radio', { name: 'Board' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View:/ })).toBeNull();
  });
});

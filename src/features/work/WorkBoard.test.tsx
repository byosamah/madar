import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// Each render of the board (performance rule RND-2: a panel that opens or closes renders no card again).
const boards = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../project/tasks/TaskBoard', async (importOriginal) => {
  const real = await importOriginal<typeof import('../project/tasks/TaskBoard')>();
  return {
    ...real,
    TaskBoard: (props: Parameters<typeof real.TaskBoard>[0]) => {
      boards.renders += 1;
      return createElement(real.TaskBoard, props);
    },
  };
});

// The Board view of the Tasks screen (fbk_042, owner 2026-10-22). In the sample office usr_005 is Sara Al-Qahtani (a member) and usr_002
// leads Corniche Office Tower (the "Toilet details" to-do waits there for review). Today is 2026-09-30.
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const KEY = 'madar.work.view';

/** Opens the View button and picks one view. */
async function chooseView(name: 'List' | 'Board') {
  await userEvent.click(await screen.findByRole('button', { name: 'View' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'View' })).getByRole('radio', { name }));
  await userEvent.keyboard('{Escape}');
}
const column = (name: RegExp) => screen.findByRole('region', { name });
/** The Move button of a card in one column (the leader has two to-dos named "Toilet details": one in progress, one in review). */
const moveIn = async (name: RegExp, title: string) => within(await column(name)).getByRole('button', { name: `Move ${title}` });
const finished = (state: State, id: string, stamp: string) => {
  state.tasks[id]!.status = 'done';
  state.tasks[id]!.completedAt = stamp;
};
/** An office to-do that Omar made and Sara leads. */
function withOfficeTask(state: State, o: Partial<Task> = {}): void {
  state.tasks.tsk_900 = {
    id: 'tsk_900', projectId: null, stageId: null, title: 'Renew the trade licence', description: '', ownerId: 'usr_005', status: 'todo',
    dueDate: '2026-10-04', flagged: false, needsReview: false, checklist: [], createdBy: 'usr_004', createdAt: '2026-09-29T09:00:00.000+03:00',
    completedAt: null, ...o,
  };
  state.counters.tsk = Math.max(state.counters.tsk ?? 0, 900);
}

describe('the View button of the Tasks screen', () => {
  it('sits in the row of the To-dos and Meetings switch, and is not on the Meetings view', async () => {
    await renderApp('/work', as('usr_005'));
    const button = await screen.findByRole('button', { name: 'View' });
    // The same row holds the switch, and the one main button stays New office to-do.
    expect(screen.getByRole('radiogroup', { name: 'Show' }).parentElement).toContainElement(button);
    expect(screen.getByRole('button', { name: 'New office to-do' })).toBeInTheDocument();
  });

  it('is not on the Meetings view', async () => {
    await renderApp('/meetings', as('usr_005'));
    await screen.findByRole('heading', { level: 1, name: 'Tasks' });
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
  });

  it('offers List and Board, with List chosen at first', async () => {
    await renderApp('/work', as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    const popup = screen.getByRole('dialog', { name: 'View' });
    expect(within(popup).getByRole('radio', { name: 'List' })).toBeChecked();
    expect(within(popup).getByRole('radio', { name: 'Board' })).not.toBeChecked();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^In review/ })).toBeNull();
  });

  it('keeps the choice on this device', async () => {
    await renderApp('/work', as('usr_005'));
    await chooseView('Board');
    expect(window.localStorage.getItem(KEY)).toBe('board');
    await chooseView('List');
    expect(window.localStorage.getItem(KEY)).toBe('list');
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
  });

  it('opens the Board at once when the device chose it', async () => {
    window.localStorage.setItem(KEY, 'board');
    await renderApp('/work', as('usr_005'));
    expect(await column(/^In review/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull();
  });
});

describe('the Board view of my to-dos', () => {
  it('shows my to-dos in the four columns of the project board', async () => {
    await renderApp('/work', as('usr_005'));
    await chooseView('Board');
    const todo = await column(/^To do/);
    expect(within(todo).getByText('Civil Defense drawings')).toBeInTheDocument();
    expect(within(await column(/^In progress/)).getByText('Facade details')).toBeInTheDocument();
    expect(within(await column(/^In review/)).getByText('Toilet details')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Done/ })).toBeInTheDocument();
    // A card of mine in review shows no "Your review" mark.
    expect(screen.queryByText('Your review')).toBeNull();
  });

  it('names the project on a card, and the word Office on an office to-do', async () => {
    await renderApp('/work', (state) => {
      as('usr_005')(state);
      withOfficeTask(state);
    });
    await chooseView('Board');
    const todo = await column(/^To do/);
    const office = within(todo).getByText('Renew the trade licence').closest('li')!;
    expect(within(office).getByText('Office')).toBeInTheDocument();
    const project = within(todo).getByText('Civil Defense drawings').closest('li')!;
    expect(within(project).getByText('Corniche Office Tower')).toBeInTheDocument();
  });

  it('opens the task panel from a card', async () => {
    await renderApp('/work', as('usr_005'));
    await chooseView('Board');
    await userEvent.click(await screen.findByRole('button', { name: /^Civil Defense drawings/ }));
    expect(await screen.findByRole('dialog', { name: 'Civil Defense drawings' })).toBeInTheDocument();
  });

  it('moves a card with the Move menu and offers Undo', async () => {
    const { store } = await renderApp('/work', as('usr_005'));
    await chooseView('Board');
    await userEvent.click(await screen.findByRole('button', { name: 'Move Civil Defense drawings' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'In progress' }));
    await waitFor(() => expect(store.state.tasks.tsk_012!.status).toBe('in_progress'));
    expect(await screen.findByText('Moved to In progress.')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('region', { name: /^In progress/ })).getByText('Civil Defense drawings')).toBeInTheDocument());
  });

  it('says so when there is nothing to show', async () => {
    await renderApp('/work', (state) => {
      as('usr_005')(state);
      for (const task of Object.values(state.tasks)) {
        task.status = 'done';
        task.completedAt = '2026-04-01T10:00:00.000+03:00';
      }
    });
    await chooseView('Board');
    expect(await screen.findByText('You have no open to-dos.')).toBeInTheDocument();
  });
});

describe('the Done column of the Board', () => {
  const finish = (state: State) => {
    as('usr_005')(state);
    finished(state, 'tsk_018', '2026-09-27T14:00:00.000+03:00');
    // The window is 7 Riyadh days: 2026-09-24 to 2026-09-30. A stamp in UTC counts on its Riyadh day.
    finished(state, 'tsk_076', '2026-09-23T22:00:00.000Z');
    finished(state, 'tsk_078', '2026-09-23T23:30:00.000+03:00');
  };

  it('holds the to-dos that I finished in the last 7 days', async () => {
    await renderApp('/work', finish);
    await chooseView('Board');
    const done = await column(/^Done/);
    expect(await within(done).findByText('Typical floor plan')).toBeInTheDocument();
    // 2026-09-23 22:00 UTC is 01:00 on 2026-09-24 in Riyadh: the first day of the window.
    expect(within(done).getByText('Cost plan input')).toBeInTheDocument();
    // 2026-09-23 23:30 in Riyadh is the day before the window.
    expect(within(done).queryByText('Landscape layout')).toBeNull();
    // An older done to-do stays out.
    expect(within(done).queryByText('Structural grid study')).toBeNull();
  });

  it('puts the newest finished to-do on top', async () => {
    await renderApp('/work', finish);
    await chooseView('Board');
    const done = await column(/^Done/);
    await within(done).findByText('Typical floor plan');
    const titles = within(done).getAllByRole('listitem').map((item) => item.querySelector('[dir="auto"]')?.textContent);
    expect(titles).toEqual(['Typical floor plan', 'Cost plan input']);
  });

  it('is read only while the Board shows', async () => {
    const asked: unknown[] = [];
    await renderApp('/work', finish, { failFirst: (name, input) => {
      if (name === 'tasks.list' && (input as { status?: string[] }).status?.includes('done')) asked.push(input);
      return false;
    } });
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(asked).toHaveLength(0);
    await chooseView('Board');
    await within(await column(/^Done/)).findByText('Typical floor plan');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ filter: 'mine', status: ['done'], doneFrom: '2026-09-24' });
  });

  it('shows no done to-do of mine in the List view', async () => {
    await renderApp('/work', finish);
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByText('Typical floor plan')).toBeNull();
  });
});

describe('my reviews on the Board', () => {
  it('puts a to-do that waits for my review in In review, marked "Your review"', async () => {
    await renderApp('/work', as('usr_002'));
    await chooseView('Board');
    const review = await column(/^In review/);
    const card = within(review).getByText('Toilet details').closest('li')!;
    expect(within(card).getByText('Your review')).toBeInTheDocument();
    expect(within(review).getByText('Door and window schedule')).toBeInTheDocument();
  });

  it('shows a to-do once when it is mine and also waits for my review', async () => {
    await renderApp('/work', (state) => {
      as('usr_002')(state);
      const task = state.tasks.tsk_010!;
      task.title = 'Probe review task';
      task.helperIds = ['usr_002'];
    });
    await chooseView('Board');
    await column(/^In review/);
    expect(screen.getAllByText('Probe review task')).toHaveLength(1);
  });

  it('offers the reviewer only Done and Send back, and approves with a move to Done', async () => {
    const { store } = await renderApp('/work', as('usr_002'));
    await chooseView('Board');
    await userEvent.click(await moveIn(/^In review/, 'Toilet details'));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Done', 'Send back with a note']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Done' }));
    await waitFor(() => expect(store.state.tasks.tsk_010!.status).toBe('done'));
    expect(await screen.findByText('Moved to Done.')).toBeInTheDocument();
  });

  it('opens the panel ready for the note when the reviewer picks Send back', async () => {
    await renderApp('/work', as('usr_002'));
    await chooseView('Board');
    await userEvent.click(await moveIn(/^In review/, 'Toilet details'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Send back with a note' }));
    const panel = await screen.findByRole('region', { name: 'Review' });
    expect(within(panel).getByRole('button', { name: 'Send back' })).toBeInTheDocument();
  });

  it('gives the lead of a to-do in review only the pull-back columns', async () => {
    await renderApp('/work', (state) => {
      as('usr_005')(state);
      state.tasks.tsk_010!.needsReview = true;
    });
    await chooseView('Board');
    await userEvent.click(await moveIn(/^In review/, 'Toilet details'));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['To do', 'In progress']);
  });
});

describe('the speed rules of the Board', () => {
  it('does not render the cards again when the task panel opens or closes', async () => {
    await renderApp('/work', as('usr_005'));
    await chooseView('Board');
    await userEvent.click(await screen.findByRole('button', { name: /^Civil Defense drawings/ }));
    await screen.findByRole('dialog', { name: 'Civil Defense drawings' });
    const settled = async () => {
      let last = -1;
      while (last !== boards.renders) {
        last = boards.renders;
        await act(() => new Promise((resolve) => { window.setTimeout(resolve, 40); }));
      }
      return boards.renders;
    };
    const open = await settled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Civil Defense drawings' })).toBeNull());
    expect(await settled()).toBe(open);
  });
});

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';

/**
 * Shore Walk (prj_011) is the first project screen. Its tasks become four, all open or done as set here:
 * usr_003 leads two open tasks (one past due), usr_001 leads one open task, and a done task does not count.
 */
const withTeam = (state: State) => {
  state.projects.prj_011.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
  const ids = Object.values(state.tasks).filter((task) => task.projectId === 'prj_011').map((task) => task.id).sort();
  for (const id of ids) state.tasks[id].status = 'done';
  const set = (id: string, title: string, ownerId: string, status: 'todo' | 'in_progress' | 'done', dueDate: string | null) =>
    Object.assign(state.tasks[id], { title, ownerId, status, dueDate, startDate: null, schedule: 'static', durationDays: null, prerequisiteIds: [] });
  set(ids[0], 'Alpha survey', 'usr_003', 'todo', '2026-09-25');
  set(ids[1], 'Beta layout', 'usr_003', 'in_progress', '2026-10-10');
  set(ids[2], 'Gamma review', 'usr_001', 'todo', '2026-10-12');
  set(ids[3], 'Delta closed', 'usr_001', 'done', '2026-09-20');
};

const noOpenTasks = (state: State) => {
  withTeam(state);
  for (const task of Object.values(state.tasks)) if (task.projectId === 'prj_011') task.status = 'done';
};

describe('the people of a project in the meeting (owner, 2026-10-02)', () => {
  it('shows each lead with open and past-due counts, the busiest first', async () => {
    const { store } = await renderApp(MEETING, withTeam);
    const people = within(await screen.findByRole('region', { name: 'People' }));
    const busy = store.state.users.usr_003.name;
    const other = store.state.users.usr_001.name;
    const buttons = people.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(`${busy} 2 open · 1 past due`);
    expect(buttons[1]).toHaveAccessibleName(`${other} 1 open`);
  });

  it('lists the tasks of a person with a press, and a press on a task opens its panel', async () => {
    const { store } = await renderApp(MEETING, withTeam);
    const people = within(await screen.findByRole('region', { name: 'People' }));
    await userEvent.click(people.getByRole('button', { name: new RegExp(`^${store.state.users.usr_003.name}`) }));
    const sheet = await screen.findByRole('dialog', { name: store.state.users.usr_003.name });
    expect(within(sheet).getByRole('button', { name: /^Alpha survey.*5 days past due/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Beta layout/ })).toBeInTheDocument();
    expect(within(sheet).queryByText('Gamma review')).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: /^Beta layout/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: store.state.users.usr_003.name })).toBeNull());
    await screen.findByRole('dialog', { name: 'Beta layout' });
    expect(window.location.hash).toContain('task=');
  });

  it('shows no People region when the project has no open tasks', async () => {
    await renderApp(MEETING, noOpenTasks);
    await screen.findByRole('article');
    expect(screen.queryByRole('region', { name: 'People' })).toBeNull();
  });
});

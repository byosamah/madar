import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDays, todayISO } from '../../lib/dates';
import { renderApp } from '../../test/render';

// In the sample office, usr_005 leads Civil Defense drawings (tsk_012).
describe('a task far past due on Home (fbk_036)', () => {
  it('lets the past-due words wrap, so they never run under the chat button of the row', async () => {
    await renderApp('/', (state) => {
      state.session.currentUserId = 'usr_005';
      state.tasks.tsk_012.startDate = null;
      state.tasks.tsk_012.dueDate = addDays(todayISO(), -157);
    });
    const panel = await screen.findByRole('region', { name: 'Today' });
    const row = within(panel).getAllByRole('listitem').find((item) => item.textContent?.includes('Civil Defense drawings')) as HTMLElement;
    const sign = row.querySelector('[data-sign="late"]') as HTMLElement;
    expect(sign.textContent).toContain('157');
    expect(sign.className).toContain('whitespace-normal');
    expect(sign.className).not.toContain('shrink-0');
  });
});

/** Shore Walk (prj_011): one open task, Alpha survey, is past due; the other tasks of the project are done (as in PeopleStrip.test). */
const shoreWalk = (state: import('../../api/store').State) => {
  const ids = Object.values(state.tasks).filter((task) => task.projectId === 'prj_011').map((task) => task.id).sort();
  for (const id of ids) state.tasks[id].status = 'done';
  Object.assign(state.tasks[ids[0]], { title: 'Alpha survey', ownerId: 'usr_003', status: 'todo', dueDate: addDays(todayISO(), -157), startDate: null, schedule: 'static', durationDays: null, prerequisiteIds: [] });
};

/** Every late sign with past-due words in the region: at least one, and each one wraps. */
function expectWraps(region: HTMLElement) {
  const signs = [...region.querySelectorAll<HTMLElement>('[data-sign="late"]')].filter((sign) => sign.textContent?.includes('157'));
  expect(signs.length).toBeGreaterThan(0);
  for (const sign of signs) {
    expect(sign.className).toContain('whitespace-normal');
    expect(sign.className).not.toContain('shrink-0');
  }
}

describe('a task far past due in the project and the meeting views (owner, 2026-10-20)', () => {
  it('lets the past-due words wrap in the project Overview', async () => {
    await renderApp('/projects/prj_011', shoreWalk);
    await screen.findByRole('heading', { level: 1 });
    await screen.findAllByText(/157 days past due/);
    expectWraps(document.body);
  });

  it('lets the past-due words wrap in the task list and the people sheet of the meeting', async () => {
    const { store } = await renderApp('/dashboard/meeting?mode=projects', shoreWalk);
    await screen.findAllByText(/157 days past due/);
    expectWraps(document.body);
    const people = within(await screen.findByRole('region', { name: 'People' }));
    await userEvent.click(people.getByRole('button', { name: new RegExp(`^${store.state.users.usr_003.name}`) }));
    expectWraps(await screen.findByRole('dialog', { name: store.state.users.usr_003.name }));
  });
});

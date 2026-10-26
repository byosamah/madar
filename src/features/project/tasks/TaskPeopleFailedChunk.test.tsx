import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addSampleInternalProject } from '../../../data/sampleInternalProject';
import type { State } from '../../../api/store';
import { TODAY } from '../../../test/factories';
import { renderApp } from '../../../test/render';

// Feedback fbk_064 (2026-10-26): the people list is a chunk of its own. A tab that opened before a release asks for a chunk that the
// host no longer has, and the host answers with the HTML page instead (measured on production: status 200, text/html). The import then
// fails at the press of the lead button. Before the fix, that failure went to the route error page: "Something went wrong on this page".
// The list now follows the rule of every other lazy part: the page reloads once to get the new build, and a second failure shows a toast
// and leaves the row and the page as they were.
vi.mock('./TaskPeopleList', () => {
  throw new Error('Failed to fetch dynamically imported module: https://madar.vado.sa/assets/TaskPeopleList-old.js');
});

const TAB = '/projects/prj_013?tab=tasks';
const TITLE = 'Photograph the finished villa';
const MARK = 'madar.screenReload';
const asLina = (state: State) => {
  addSampleInternalProject(state, TODAY);
  const lina = Object.values(state.users).find((user) => user.name === 'Lina Mansour')!;
  state.session.currentUserId = lina.id;
  const task = Object.values(state.tasks).find((item) => item.title === TITLE)!;
  task.createdBy = lina.id;
  task.ownerId = null;
};

describe('a people list chunk that cannot load (fbk_064)', () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(MARK);
  });

  it('shows a toast and keeps the page when the page already reloaded once', async () => {
    await renderApp(TAB, asLina);
    const button = await screen.findByRole('button', { name: `Lead and helpers of ${TITLE}` });
    window.sessionStorage.setItem(MARK, window.location.href);
    await userEvent.click(button);
    expect(await screen.findByText(/went wrong|try again/i)).toBeInTheDocument();
    expect(screen.queryByText('This page did not open')).toBeNull();
    expect(screen.queryByText(/Something went wrong on this page/)).toBeNull();
    // The row stays, and a second press is possible.
    expect(screen.getByRole('button', { name: `Lead and helpers of ${TITLE}` })).toBeInTheDocument();
  });
});

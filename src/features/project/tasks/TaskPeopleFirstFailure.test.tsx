import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addSampleInternalProject } from '../../../data/sampleInternalProject';
import type { State } from '../../../api/store';
import { TODAY } from '../../../test/factories';
import { renderApp } from '../../../test/render';

// Feedback fbk_064: the first failed import of the people list marks the page for one reload and does not show the error page
// (the same rule as every lazy part, `app/importReload.ts`). This file holds the first failure alone: a lazy part keeps its first
// answer for the life of the page, so the second failure has its own file (TaskPeopleFailedChunk.test.tsx).
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

describe('the first failed import of the people list (fbk_064)', () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(MARK);
  });

  it('marks the page for one reload and shows no error page', async () => {
    await renderApp(TAB, asLina);
    await userEvent.click(await screen.findByRole('button', { name: `Lead and helpers of ${TITLE}` }));
    await waitFor(() => expect(window.sessionStorage.getItem(MARK)).toBe(window.location.href));
    expect(screen.queryByText(/Something went wrong on this page/)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';
import { phoneMedia } from '../../test/phoneMedia';
import { TODAY } from '../../test/factories';
import { withMeeting } from '../meetings/testMeetings';

/**
 * Home on a phone (Direction D, track T): five blocks in one column, no project list, no What's new link. jsdom is not a phone,
 * so each test turns it into one with phoneMedia.
 */
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const next = () => screen.findByRole('region', { name: 'Next for you' });

describe('Home on a phone', () => {
  it('is one column of blocks that are direct children of the grid', async () => {
    phoneMedia(true);
    await renderApp('/', (state) => {
      as('usr_002')(state);
      // One to-do of Faisal is due today, so the third block is "Today" and not "Coming up".
      const task = Object.values(state.tasks).find((item) => item.ownerId === 'usr_002' && item.status === 'todo' && !item.prerequisiteIds?.length)!;
      task.dueDate = TODAY;
      withMeeting(state, { id: 'mtg_001', title: 'Review the facade', startsAt: `${TODAY}T14:00:00.000+03:00`, endsAt: `${TODAY}T15:00:00.000+03:00` });
    });
    await screen.findByRole('region', { name: 'Meetings today' });
    const grid = document.querySelector('[data-screen] > .grid')!;
    expect(grid.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(grid.className).toContain('gap-4');
    expect(Array.from(grid.children).map((block) => block.querySelector('h1, h2')?.textContent))
      .toEqual([expect.stringMatching(/^Good morning/), 'Next for you', 'Today', 'Meetings today']);
  });

  it("has no project list, no All projects link and no What's new link", async () => {
    phoneMedia(true);
    await renderApp('/', as('usr_005'));
    await next();
    expect(screen.queryByRole('region', { name: 'Your projects' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'All projects' })).toBeNull();
    expect(screen.queryByRole('link', { name: "See what's new" })).toBeNull();
  });

  it('sends no projects.list read', async () => {
    phoneMedia(true);
    const app = await renderHeldRemoteApp('/', as('usr_003'), { hold: true });
    app.release();
    await next();
    expect(app.asked.map((call) => call.name)).not.toContain('projects.list');
  });

  it('starts the project list when the phone turns to landscape, and drops it on the way back', async () => {
    const media = phoneMedia(true);
    const app = await renderHeldRemoteApp('/', as('usr_003'));
    await next();
    expect(app.asked.map((call) => call.name)).not.toContain('projects.list');
    act(() => media.set(false));
    expect(await screen.findByRole('region', { name: 'Your projects' })).toBeInTheDocument();
    expect(app.asked.map((call) => call.name)).toContain('projects.list');
    act(() => media.set(true));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your projects' })).toBeNull());
  });

  it('opens the to-do of a push link with no project list', async () => {
    phoneMedia(true);
    await renderApp('/?task=tsk_007&project=prj_001', as('usr_001'));
    expect(await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('shows the empty day as three calm blocks', async () => {
    phoneMedia(true);
    await renderApp('/', (state) => {
      as('usr_005')(state);
      for (const task of Object.values(state.tasks)) task.status = 'done';
    });
    await next();
    const grid = document.querySelector('[data-screen] > .grid')!;
    expect(Array.from(grid.children).map((block) => block.querySelector('h1, h2')?.textContent))
      .toEqual([expect.stringMatching(/^Good morning/), 'Next for you', 'Today']);
    expect(screen.getByText('You are all caught up.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is due today.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all my to-dos' })).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../api/store';
import { BATCH_BUDGET, callCost } from '../api/remote/wire';
import { renderWireApp, type Trip } from '../test/wireApp';

/**
 * One save makes one trip (perf2 savetrip, 2026-10-22). Live on the test copy, a title save on the task panel sent two requests:
 * the write with its follow reads, then a second one with a tasks.list a few milliseconds later. The follow step of a write left
 * a read out of the request of the write, because a request held one overview call at most, and Tasks shows two person lists
 * (mine and review_for_me) with the task list of the project. These tests run the real RemoteApi with its batcher over a fake server
 * that applies the cost rule of the server (BATCH_BUDGET), and count the requests of one save.
 */

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

/** The requests that a save sent: all trips after the first one that holds the write. */
const tripsFrom = (trips: Trip[], write: string, from: number) => {
  const first = trips.findIndex((trip, at) => at >= from && trip.names.includes(write));
  return first < 0 ? [] : trips.slice(first);
};

/** The count of the requests of one save: the first request that holds the write, and every request after it. */
async function saveTrips(
  app: Awaited<ReturnType<typeof renderWireApp>>,
  write: string,
  act: () => Promise<void>,
): Promise<Trip[]> {
  await app.settle();
  const from = app.trips.length;
  await act();
  await waitFor(() => expect(app.trips.length).toBeGreaterThan(from), { timeout: 10_000 });
  await app.settle();
  return tripsFrom(app.trips, write, from);
}

/** No request ever holds calls whose summed cost passes the budget (the server refuses it with 413). */
const withinBudget = (trips: Trip[]) => {
  for (const trip of trips) expect(trip.cost, trip.names.join(', ')).toBeLessThanOrEqual(BATCH_BUDGET);
};

const editTitle = async (sheet: HTMLElement, text: string) => {
  const title = within(sheet).getByLabelText('Title');
  await userEvent.clear(title);
  await userEvent.type(title, text);
  await act(async () => { await userEvent.tab(); });
};

describe('one save makes one trip (perf2 savetrip)', () => {
  it('sends the title save of the task panel on Tasks in one request, with its follow reads', async () => {
    const app = await renderWireApp('/work?task=tsk_007&project=prj_001', as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 });
    const save = await saveTrips(app, 'tasks.update', () => editTitle(sheet, 'Stair and ramp details'));
    // Tasks shows the task list of the project and both person lists (mine, review_for_me) with the panel: all go with the write.
    expect(save.map((trip) => trip.names)).toHaveLength(1);
    expect(save[0].names[0]).toBe('tasks.update');
    expect(save[0].calls.filter((c) => c.name === 'tasks.list').map((c) => c.input)).toEqual(expect.arrayContaining([
      { filter: 'mine', includeDone: false }, { filter: 'review_for_me' }, { projectId: 'prj_001', activeProjectsOnly: false },
    ]));
    withinBudget(app.trips);
    expect(app.store.state.tasks.tsk_007.title).toBe('Stair and ramp details');
  }, 60_000);

  it('sends the same save in one request when the Realtime frame of the own write comes before the own answer', async () => {
    const app = await renderWireApp('/work?task=tsk_007&project=prj_001', as('usr_002'), { echoFirst: true });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 });
    const save = await saveTrips(app, 'tasks.update', () => editTitle(sheet, 'Stair and ramp details'));
    expect(save).toHaveLength(1);
    withinBudget(app.trips);
  }, 60_000);

  it('sends the title save of the task panel inside its project in one request', async () => {
    const app = await renderWireApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 });
    const save = await saveTrips(app, 'tasks.update', () => editTitle(sheet, 'Stair and ramp details'));
    expect(save).toHaveLength(1);
    withinBudget(app.trips);
  }, 60_000);

  it('sends the tick of a task on Tasks in one request', async () => {
    const app = await renderWireApp('/work', as('usr_002'));
    const ticks = await screen.findAllByRole('checkbox', { name: /^Complete / }, { timeout: 10_000 });
    const save = await saveTrips(app, 'tasks.complete', async () => { await userEvent.click(ticks[0]); });
    expect(save).toHaveLength(1);
    expect(save[0].calls.filter((c) => c.name === 'tasks.list').length).toBeGreaterThanOrEqual(2);
    withinBudget(app.trips);
  }, 60_000);

  it('sends the tick of a task on Home in one request, for a Member and for an Admin', async () => {
    for (const user of ['usr_002', 'usr_001']) {
      const app = await renderWireApp('/', as(user));
      const ticks = await screen.findAllByRole('checkbox', { name: /^Complete / }, { timeout: 10_000 });
      const save = await saveTrips(app, 'tasks.complete', async () => { await userEvent.click(ticks[0]); });
      expect(save, user).toHaveLength(1);
      expect(save[0].calls.filter((c) => c.name === 'tasks.list').length, user).toBeGreaterThanOrEqual(2);
      withinBudget(app.trips);
      app.unmount();
    }
  }, 60_000);

  it('keeps the cold start at one overview call for each request: only the follow reads of a save share the budget', async () => {
    for (const [user, path, requests] of [['usr_002', '/', 3], ['usr_001', '/', 4], ['usr_002', '/work', 2]] as const) {
      const app = await renderWireApp(path, as(user));
      await screen.findAllByRole('navigation', {}, { timeout: 10_000 });
      await app.settle();
      expect(app.trips, `${user} ${path}`).toHaveLength(requests);
      for (const trip of app.trips) expect(trip.calls.filter((c) => callCost(c.name, c.input) > 0).length, trip.names.join(', ')).toBeLessThanOrEqual(1);
      app.unmount();
    }
  }, 60_000);
});

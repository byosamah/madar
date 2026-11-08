import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../api/store';
import { stagesChrono } from '../lib/stageFlow';
import { BATCH_BUDGET } from '../api/remote/wire';
import { renderWireApp } from '../test/wireApp';

/**
 * A move of a card to another stage on the board of a continuous project is one request (fbk_085, owner 2026-11-08). The write goes
 * with its follow reads in one batch, and no second request asks a reason for a move to an earlier stage, because a continuous project
 * asks none (fbk_084). The drag and the card menu call the same tasks.update, so the menu stands for both here.
 */
afterEach(() => window.localStorage.clear());

const together = (state: State) => {
  state.session.currentUserId = 'usr_002';
  state.projects.prj_001.continuous = true;
};

describe('a stage move on the board (fbk_085)', () => {
  it('sends one request for a move to an earlier stage, with no reason', async () => {
    window.localStorage.setItem('madar.tasks.view', 'board');
    const app = await renderWireApp('/projects/prj_001?tab=tasks', together);
    await screen.findAllByRole('region', { name: /, \d+ open$/ }, { timeout: 10_000 });
    await app.settle();
    const stages = stagesChrono(Object.values(app.store.state.stages).filter((stage) => stage.projectId === 'prj_001'));
    const last = stages[stages.length - 1];
    const task = Object.values(app.store.state.tasks).find((one) => one.projectId === 'prj_001' && one.status !== 'done' && one.stageId !== stages[0].id && one.stageId !== last.id)!;
    const from = app.trips.length;
    await userEvent.click(await screen.findByRole('button', { name: `Move ${task.title}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: stages[0].name }));
    await waitFor(() => expect(app.trips.length).toBeGreaterThan(from), { timeout: 10_000 });
    await app.settle();
    const sent = app.trips.slice(from);
    expect(sent).toHaveLength(1);
    expect(sent[0].calls[0]).toEqual({ name: 'tasks.update', input: { id: task.id, patch: { stageId: stages[0].id } } });
    expect(sent[0].cost).toBeLessThanOrEqual(BATCH_BUDGET);
    expect(app.store.state.tasks[task.id].stageId).toBe(stages[0].id);
  }, 60_000);
});

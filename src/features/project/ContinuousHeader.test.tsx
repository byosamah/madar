import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

/**
 * A continuous project means that the stages run together (fbk_084, owner 2026-11-08: "Continuous is enough"). It has no current stage on any
 * screen. The header says "Continuous, N open" and its menu lists each stage with its open to-dos. An ordered project keeps its stage name,
 * its step bar and the numbered menu. prj_001 has 7 stages.
 */
const LOAD = { timeout: 10_000 };
const PROJECT = '/projects/prj_001';

const together = (state: State) => {
  state.session.currentUserId = 'usr_002';
  state.projects.prj_001.continuous = true;
  state.projects.prj_001.targetEndDate = null;
  for (const id of Object.keys(state.deadlines)) if (state.deadlines[id].projectId === 'prj_001') delete state.deadlines[id];
};
const togetherArabic = (state: State) => {
  together(state);
  state.users.usr_002.preferences.language = 'ar';
};
const ordered = (state: State) => {
  state.session.currentUserId = 'usr_002';
};
const openIn = (state: State, stageId?: string) => Object.values(state.tasks)
  .filter((task) => task.projectId === 'prj_001' && task.status !== 'done' && (stageId === undefined || task.stageId === stageId)).length;
const stagesOf = (state: State) => Object.values(state.stages).filter((stage) => stage.projectId === 'prj_001').sort((a, b) => a.order - b.order);
const headerOf = async () => (await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' }, LOAD)).closest('header') as HTMLElement;

afterEach(() => window.localStorage.clear());

describe('the header of a continuous project on a desk', () => {
  it('says "Continuous, N open" in one stage button, with no step bar and no stage count', async () => {
    const { store } = await renderApp(PROJECT, together);
    const header = await headerOf();
    const total = openIn(store.state);
    expect(total).toBeGreaterThan(1);
    expect(await within(header).findByRole('button', { name: `Continuous, ${total} open` })).toBeInTheDocument();
    expect(within(header).queryByRole('progressbar')).toBeNull();
    expect(within(header).queryByText(/Stage \d+ of/)).toBeNull();
    // The word shows once: the deadline line leaves it to the stage button.
    expect(within(header).getAllByText(/Continuous/)).toHaveLength(1);
  });

  it('lists each stage with its open to-dos in the menu: no numbers, no ticks, no "Current stage" tag', async () => {
    const { store } = await renderApp(PROJECT, together);
    const header = await headerOf();
    await userEvent.click(await within(header).findByRole('button', { name: /^Continuous, / }));
    const menu = await screen.findByRole('dialog', { name: 'Stages' });
    for (const stage of stagesOf(store.state)) {
      const row = await within(menu).findByRole('button', { name: new RegExp(`^${stage.name}\\s+\\d+ open$`) }, LOAD);
      expect(row).toHaveTextContent(`${openIn(store.state, stage.id)} open`);
      // No number circle: the row holds the name and the count only.
      expect(within(row).queryByText(/^[1-9]$/)).toBeNull();
    }
    expect(within(menu).queryByText('Current stage')).toBeNull();
    expect(within(menu).queryByText(/earliest stage with an open to-do/)).toBeNull();
    expect(within(menu).getByText(/The stages run together/)).toBeInTheDocument();
  });

  it('shows the dates and the prerequisites of a stage after a press on it', async () => {
    const { store } = await renderApp(PROJECT, together);
    const header = await headerOf();
    await userEvent.click(await within(header).findByRole('button', { name: /^Continuous, / }));
    const menu = await screen.findByRole('dialog', { name: 'Stages' });
    expect(within(menu).queryByRole('group', { name: 'Stage details' })).toBeNull();
    const stage = stagesOf(store.state)[2];
    await userEvent.click(await within(menu).findByRole('button', { name: new RegExp(`^${stage.name}\\s`) }, LOAD));
    expect(await within(menu).findByRole('group', { name: 'Stage details' })).toBeInTheDocument();
  });

  it('keeps the health sign', async () => {
    await renderApp(PROJECT, together);
    const header = await headerOf();
    expect(await within(header).findByRole('button', { name: /^(Late|At risk|On track)/ })).toBeInTheDocument();
  });
});

describe('the header of a project whose stages go in order', () => {
  it('keeps the stage name, the step bar and the numbered menu with its "Current stage" tag', async () => {
    await renderApp(PROJECT, ordered);
    const header = await headerOf();
    expect(await within(header).findByRole('progressbar', { name: 'Stage 4 of 7' })).toBeInTheDocument();
    expect(within(header).queryByText(/Continuous/)).toBeNull();
    const button = header.querySelector('button[aria-haspopup="dialog"]') as HTMLElement;
    expect(button).toBeInTheDocument();
    expect(button.textContent).not.toMatch(/open/);
    await userEvent.click(button);
    const menu = await screen.findByRole('dialog', { name: 'Stages' });
    expect(within(menu).getByText('Current stage')).toBeInTheDocument();
    expect(within(menu).getByText(/earliest stage with an open to-do/)).toBeInTheDocument();
  });
});

describe('the header of a continuous project on a phone', () => {
  it('keeps the word Continuous on the button and says "N open" in place of "Stage n of m", with no step bar', async () => {
    phoneMedia(true);
    const { store } = await renderApp(PROJECT, together);
    const header = await headerOf();
    const total = openIn(store.state);
    expect(await within(header).findByRole('button', { name: 'Continuous' })).toBeInTheDocument();
    expect(within(header).getByText(`${total} open`)).toBeInTheDocument();
    expect(within(header).queryByText(/Stage \d+ of/)).toBeNull();
    expect(within(header).queryByRole('progressbar')).toBeNull();
  });
});

describe('the header of a continuous project in Arabic', () => {
  it('says «مستمر، N مهمة مفتوحة»', async () => {
    const { store } = await renderApp(PROJECT, togetherArabic);
    const header = await headerOf().catch(() => null);
    const root = header ?? (await screen.findByRole('heading', { level: 1 }, LOAD)).closest('header') as HTMLElement;
    const total = openIn(store.state);
    await waitFor(() => expect(within(root).getByRole('button', { name: new RegExp(`^مستمر، ${total} `) })).toBeInTheDocument(), LOAD);
    expect(within(root).queryByRole('progressbar')).toBeNull();
  });
});

describe('the Overview of a continuous project', () => {
  it('shows the open to-dos of each stage in place of "Stage n of m", and no "Moved back" note', async () => {
    const { store } = await renderApp(PROJECT, (state) => {
      together(state);
      // A note from the time the project had a current stage. The Overview must not show it any more.
      const stages = stagesOf(state);
      state.projects.prj_001.stageBack = { fromStageId: stages[4].id, toStageId: stages[3].id, reason: 'Old reason', by: 'usr_001', at: '2026-09-20T09:00:00.000+03:00' };
    });
    const panel = (await screen.findByRole('heading', { name: 'Where the project stands' }, LOAD)).closest('section') as HTMLElement;
    for (const stage of stagesOf(store.state)) {
      const row = await within(panel).findByText(stage.name, undefined, LOAD);
      expect(row.closest('li')).toHaveTextContent(`${openIn(store.state, stage.id)} open`);
    }
    expect(within(panel).queryByText(/Stage \d+ of/)).toBeNull();
    expect(within(panel).queryByRole('progressbar')).toBeNull();
    expect(within(panel).queryByText(/Moved back/)).toBeNull();
    expect(within(panel).queryByText(/Old reason/)).toBeNull();
  });

  it('keeps "Stage n of m", the bar and the Moved back note for an ordered project', async () => {
    await renderApp(PROJECT, (state) => {
      ordered(state);
      const stages = stagesOf(state);
      state.projects.prj_001.stageBack = { fromStageId: stages[5].id, toStageId: stages[3].id, reason: 'Old reason', by: 'usr_001', at: '2026-09-20T09:00:00.000+03:00' };
    });
    const panel = (await screen.findByRole('heading', { name: 'Where the project stands' }, LOAD)).closest('section') as HTMLElement;
    expect(await within(panel).findByText('Stage 4 of 7')).toBeInTheDocument();
    expect(within(panel).getByRole('progressbar')).toBeInTheDocument();
    expect(within(panel).getByText(/Moved back/)).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const LOAD = { timeout: 10_000 };

function newCode(state: State) {
  state.projects.prj_001.code = '260902GCH-COM-Office Tower';
}

describe('the project key in tight places (item 6b)', () => {
  it('names a new example code in the hint of an empty search', async () => {
    await renderApp('/search');
    await userEvent.type(await screen.findByRole('combobox', {}, LOAD), 'qqzzxx');
    expect(await screen.findByText('Try a project name, a code such as 260902AZT, a to-do, a person or a file name.', {}, LOAD)).toBeInTheDocument();
  });

  it('finds a project by its key and shows the key, not the full code', async () => {
    await renderApp('/search', newCode);
    await userEvent.type(await screen.findByRole('combobox', {}, LOAD), '260902GCH');
    const option = await screen.findByRole('option', { name: /Corniche Office Tower/ }, LOAD);
    expect(within(option).getByText('260902GCH')).toBeInTheDocument();
    expect(within(option).queryByText('260902GCH-COM-Office Tower')).toBeNull();
  });

  it('finds a project by its full code', async () => {
    await renderApp('/search', newCode);
    await userEvent.type(await screen.findByRole('combobox', {}, LOAD), '#260902GCH-COM-Office');
    expect(await screen.findByRole('option', { name: /Corniche Office Tower/ }, LOAD)).toBeInTheDocument();
  });

  it('shows the key in the deadline rows of the Task list', async () => {
    await renderApp('/tasks?mode=deadlines&from=2026-09-30&to=2026-10-14', (state) => {
      const deadline = Object.values(state.deadlines).find((d) => d.name === 'Balady submission')!;
      state.projects[deadline.projectId].code = '260902GCH-COM-Office Tower';
    });
    expect((await screen.findAllByText(/^260902GCH ·$/, {}, LOAD)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/260902GCH-COM/)).toBeNull();
  });
});

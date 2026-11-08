import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { State } from '../../api/store';
import { useCall } from '../../app/runtime';
import { renderWithRuntime } from '../../test/render';
import { ProjectBox } from './ProjectBox';
import { ProjectListRow } from './ProjectListRow';

/**
 * A continuous project means that the stages run together (fbk_084, owner 2026-11-08). Its row and its box show "Continuous, N open" in
 * place of the stage name and the step bar. The deadline slot does not say "Continuous" again. An ordered project keeps both.
 */
function Item({ id, kind }: { id: string; kind: 'row' | 'box' }) {
  const list = useCall('projects.list', { status: 'all' });
  const summary = list.data?.find((s) => s.project.id === id);
  if (!summary) return null;
  return <ul>{kind === 'row' ? <ProjectListRow summary={summary} source="projects" /> : <ProjectBox summary={summary} source="projects" />}</ul>;
}
const together = (state: State) => {
  state.projects.prj_001.continuous = true;
  state.projects.prj_001.targetEndDate = null;
  for (const id of Object.keys(state.deadlines)) if (state.deadlines[id].projectId === 'prj_001') delete state.deadlines[id];
};
const open = (state: State) => Object.values(state.tasks).filter((task) => task.projectId === 'prj_001' && task.status !== 'done').length;

describe.each(['row', 'box'] as const)('the %s of a continuous project', (kind) => {
  it('says "Continuous, N open" and shows no stage name and no step bar', async () => {
    let total = 0;
    await renderWithRuntime(<Item id="prj_001" kind={kind} />, (state) => {
      together(state);
      total = open(state);
    }, { path: '/' });
    const link = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(total).toBeGreaterThan(1);
    expect(within(link).getByText(`Continuous, ${total} open`)).toBeInTheDocument();
    expect(within(link).queryByText('Construction Documents')).toBeNull();
    expect(within(link).queryByRole('progressbar')).toBeNull();
    // The word shows once.
    expect(within(link).getAllByText(/Continuous/)).toHaveLength(1);
  });

  it('keeps a named deadline', async () => {
    await renderWithRuntime(<Item id="prj_001" kind={kind} />, (state) => {
      state.projects.prj_001.continuous = true;
    }, { path: '/' });
    const link = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(link).getByText('Coordination workshop')).toBeInTheDocument();
  });

  it('keeps the stage name and the step bar of a project whose stages go in order', async () => {
    await renderWithRuntime(<Item id="prj_001" kind={kind} />, undefined, { path: '/' });
    const link = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(link).getByText('Construction Documents')).toBeInTheDocument();
    expect(within(link).getByRole('progressbar', { name: 'Stage 4 of 7' })).toBeInTheDocument();
    expect(within(link).queryByText(/Continuous/)).toBeNull();
  });
});

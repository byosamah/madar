import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addSampleInternalProject } from '../../data/sampleInternalProject';
import { useCall } from '../../app/runtime';
import { TODAY } from '../../test/factories';
import { renderWithRuntime } from '../../test/render';
import { renderRemoteApp } from '../../test/renderRemote';
import { ProjectBox } from './ProjectBox';
import { PROJECT_VIEW_KEY } from './projectView';

function Box({ id }: { id: string }) {
  const list = useCall('projects.list', { status: 'all' });
  // An id like prj_001, or the name of the sample internal project (its id comes from the counter).
  const summary = list.data?.find((s) => s.project.id === id || s.project.name === id);
  return summary ? <ul><ProjectBox summary={summary} source="projects" /></ul> : null;
}
const LOCK = 'Only the team and chosen people';

// fbk_080 (owner, 2026-11-05): the second view of a project list. One box holds what one row holds, in a column.
describe('the project box', () => {
  it('shows the tile, name, client, stage, steps, next deadline, team and the state word', async () => {
    await renderWithRuntime(<Box id="prj_001" />, undefined, { path: '/' });
    const box = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(box).toHaveAttribute('href', '/projects/prj_001');
    expect(box.querySelector('[data-project-mark]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(box).getByText('Late')).toBeInTheDocument();
    expect(within(box).getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(within(box).getByText('Construction Documents')).toBeInTheDocument();
    expect(within(box).getByRole('progressbar', { name: 'Stage 4 of 7' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(box).getByText('Coordination workshop').closest('p')).toHaveTextContent('Coordination workshop · In 5 days');
    // The team is smaller than in a row: the leader 28 px with the ink ring, a team picture 22 px.
    const team = within(box.querySelector('[data-team-column]') as HTMLElement).getAllByRole('img');
    expect(team[0]).toHaveAccessibleName('Leader: Faisal Al-Harbi');
    expect(team[0]).toHaveStyle({ width: '28px' });
    expect(team[0].closest('[data-leader]')).toHaveClass('ring-[1.5px]', 'ring-ink');
    expect(team[1]).toHaveStyle({ width: '22px' });
  });

  it('draws the tile at 40 px and shows a name of two lines at most', async () => {
    await renderWithRuntime(<Box id="prj_001" />, (state) => {
      state.projects.prj_001.name = 'Corniche Office Tower and Podium Retail with Underground Parking Levels';
    }, { path: '/' });
    const box = await screen.findByRole('link', { name: /Corniche Office Tower and Podium/ });
    expect(box.querySelector('[data-project-mark]')).toHaveStyle({ width: '40px', height: '40px' });
    // A `block` class would override the box display of line-clamp and show every line.
    const name = within(box).getByText(/Corniche Office Tower and Podium/);
    expect(name).toHaveClass('line-clamp-2');
    // Safari clamps only while the display is -webkit-box, which line-clamp-2 sets: no other display class may sit on the name.
    for (const display of ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'flow-root', 'contents']) expect(name).not.toHaveClass(display);
  });

  // A narrow box of 171 px cut the name to "Coordina...". The name takes 2 lines and the date stays whole (owner lead, 2026-11-05).
  it('lets the deadline name take 2 lines and keeps the date whole, with no cut', async () => {
    await renderWithRuntime(<Box id="prj_001" />, undefined, { path: '/' });
    const box = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const name = within(box).getByText('Coordination workshop');
    expect(name).toHaveClass('line-clamp-2');
    expect(name).not.toHaveClass('truncate');
    for (const display of ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'flow-root', 'contents']) expect(name).not.toHaveClass(display);
    expect(name.parentElement).toHaveClass('flex-wrap');
    const when = within(box).getByText('In 5 days');
    expect(when).toHaveClass('whitespace-nowrap');
    expect(when.closest('.line-clamp-2')).toBeNull();
    expect(when.closest('.truncate')).toBeNull();
  });

  // The "Stage ends" line of a project with no named deadline: the name may wrap, the date never splits (WebKit Arabic 390 px: "18" / "نوفمبر").
  it('keeps the date of "Stage ends" whole in a narrow box', async () => {
    await renderWithRuntime(<Box id="prj_001" />, (state) => {
      for (const deadline of Object.values(state.deadlines)) if (deadline.projectId === 'prj_001') delete state.deadlines[deadline.id];
      for (const stage of Object.values(state.stages)) if (stage.projectId === 'prj_001') stage.endDate = '2099-01-15';
    }, { path: '/' });
    const box = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const name = within(box).getByText('Stage ends');
    expect(name.parentElement).toHaveClass('flex-wrap');
    const when = name.parentElement!.querySelector('.tabular') as HTMLElement;
    expect(when).toHaveTextContent(/15/);
    expect(when).toHaveClass('whitespace-nowrap');
  });

  it('puts the stage and its steps at the bottom, and wraps the last row of a narrow box', async () => {
    await renderWithRuntime(<Box id="prj_001" />, undefined, { path: '/' });
    const box = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const stage = within(box).getByRole('progressbar', { name: 'Stage 4 of 7' }).closest('[data-stage-column]') as HTMLElement;
    expect(stage).toHaveClass('mt-auto');
    expect(stage).toHaveTextContent('Construction Documents');
    expect(box.querySelector('[data-team-column]')!.closest('[data-box-last]')).toHaveClass('flex-wrap');
  });

  it('shows the word Internal for an internal project, and the lock for a hidden one', async () => {
    await renderWithRuntime(<Box id="Portfolio 2026" />, (state) => addSampleInternalProject(state, TODAY), { path: '/' });
    const box = await screen.findByRole('link', { name: /Portfolio 2026/ });
    expect(within(box).getByText('Internal')).toBeInTheDocument();
    expect(within(box).getByRole('img', { name: LOCK })).toBeInTheDocument();
  });

  it('shows the lock and no Internal word for a hidden client project', async () => {
    await renderWithRuntime(<Box id="prj_001" />, (state) => {
      state.projects.prj_001.access = { hidden: true, viewerIds: [] };
    }, { path: '/' });
    const box = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(box).getByRole('img', { name: LOCK })).toBeInTheDocument();
    expect(within(box).queryByText('Internal')).toBeNull();
  });

  it('opens the context menu of the project with the right button', async () => {
    await renderWithRuntime(<Box id="prj_001" />, undefined, { path: '/' });
    fireEvent.contextMenu(await screen.findByRole('link', { name: /Corniche Office Tower/ }), { clientX: 20, clientY: 20 });
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toContain('Open');
    expect(items).toContain('Copy link');
  });
});

const gets = (sent: { name: string; input: unknown }[]) => sent.filter((call) => call.name === 'projects.get');

describe('a press on a project box starts the project (as a row does, performance audit 2026-10-07, FET-12)', () => {
  it('asks for projects.get at pointerdown, never on hover', async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'boxes');
    const { sent } = await renderRemoteApp('/projects');
    const link = within(await screen.findByRole('list', { name: 'Projects' })).getAllByRole('link')[0];
    const id = /prj_\d+/.exec(link.getAttribute('href') ?? '')?.[0] ?? '';
    await userEvent.hover(link);
    fireEvent.pointerEnter(link);
    fireEvent.mouseOver(link);
    await new Promise((resolve) => { window.setTimeout(resolve, 50); });
    expect(gets(sent)).toEqual([]);
    fireEvent.pointerDown(link, { pointerType: 'mouse' });
    await waitFor(() => expect(gets(sent)).toEqual([{ name: 'projects.get', input: { id } }]));
  });
});

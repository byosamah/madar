import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memberKey, type State } from '../../api/store';
import { SubCompaniesProvider } from '../../app/subCompanies';
import { useCall } from '../../app/runtime';
import { renderWithRuntime } from '../../test/render';
import { ProjectCover } from './ProjectCard';
import { ProjectListRow } from './ProjectListRow';

function Card({ id }: { id: string }) {
  const list = useCall('projects.list', { status: 'all' });
  const summary = list.data?.find((s) => s.project.id === id);
  return summary ? <ul><ProjectListRow summary={summary} source="projects" /></ul> : null;
}
function Cover({ id }: { id: string }) {
  const list = useCall('projects.list', { status: 'all' });
  const summary = list.data?.find((s) => s.project.id === id);
  return summary ? <ProjectCover summary={summary} /> : null;
}
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
// Sets the leader and the team of prj_001. The team is every member except the leader.
const teamOf = (leaderId: string | null, teamIds: string[]) => (state: State) => {
  for (const member of Object.values(state.members)) if (member.projectId === 'prj_001') delete state.members[memberKey(member.projectId, member.userId)];
  state.projects.prj_001.leaderId = leaderId;
  for (const userId of [...(leaderId ? [leaderId] : []), ...teamIds]) {
    state.members[memberKey('prj_001', userId)] = { projectId: 'prj_001', userId, discipline: 'Architect' };
  }
};
const openMenu = async () => {
  fireEvent.contextMenu(await screen.findByRole('link', { name: /Corniche Office Tower/ }), { clientX: 20, clientY: 20 });
  return within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
};

describe('the project row', () => {
  it('shows the tile, name, stage, client, progress, next deadline and the state word', async () => {
    await renderWithRuntime(<Card id="prj_001" />, undefined, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(row.querySelector('[data-project-mark]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(row).getByText('Late')).toBeInTheDocument();
    expect(within(row).getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(within(row).getByRole('progressbar', { name: 'Stage 4 of 7' })).toHaveAttribute('aria-valuenow', '50');
    // The stage has its own column: the name with the stage steps under it (colleague's comment 1, owner approved 2026-10-01).
    const stage = within(row).getByRole('progressbar', { name: 'Stage 4 of 7' }).closest('[data-stage-column]') as HTMLElement;
    expect(stage).toHaveTextContent('Construction Documents');
    expect(within(row).getByText('Gulf Crest Holding').closest('[data-stage-column]')).toBeNull();
    expect(within(row).queryByText(/Construction Documents ·/)).toBeNull();
    // The team as pictures only, the leader first and bigger (colleague's comment 2).
    const team = within(row.querySelector('[data-team-column]') as HTMLElement).getAllByRole('img');
    expect(team[0]).toHaveAccessibleName('Leader: Faisal Al-Harbi');
    expect(team[0]).toHaveStyle({ width: '34px' });
    // The leader has the ink ring (fbk_060); a team picture has none.
    expect(team[0].closest('[data-leader]')).toHaveClass('ring-2', 'ring-ink');
    expect(team[1].closest('[data-leader]')).toBeNull();
    expect(team[1]).toHaveStyle({ width: '26px' });
    expect(within(row).getByText('Coordination workshop').closest('p')).toHaveTextContent('Coordination workshop · In 5 days');
    expect(within(row).queryByRole('list', { name: 'Latest updates' })).toBeNull();
  });

  // Feedback fbk_013 (owner, 2026-10-18): three pictures, then "+N". With a leader, the leader takes the first picture.
  it('shows 3 pictures and "+2" for a leader and 4 team members', async () => {
    await renderWithRuntime(<Card id="prj_001" />, teamOf('usr_002', ['usr_003', 'usr_004', 'usr_005', 'usr_006']), { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const team = within(row.querySelector('[data-team-column]') as HTMLElement);
    const pictures = team.getAllByRole('img');
    // Three pictures and the "+2" circle, which carries the names of the two hidden people.
    expect(pictures).toHaveLength(4);
    expect(pictures[0]).toHaveAccessibleName('Leader: Faisal Al-Harbi');
    expect(pictures[1]).toHaveAccessibleName('Omar Haddad');
    expect(pictures[2]).toHaveAccessibleName('Reem Al-Ghamdi');
    expect(team.getByText('+2')).toBeInTheDocument();
  });

  // PRJ-18 (2026-10-19): one hidden person shows as a picture, since "+1" takes the same width.
  it('shows the fourth picture, not "+1", for no leader and 4 team members', async () => {
    await renderWithRuntime(<Card id="prj_001" />, teamOf(null, ['usr_003', 'usr_004', 'usr_005', 'usr_006']), { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const team = within(row.querySelector('[data-team-column]') as HTMLElement);
    expect(team.getAllByRole('img')).toHaveLength(4);
    expect(team.queryByText('+1')).toBeNull();
  });

  it('names the hidden people on "+N"', async () => {
    await renderWithRuntime(<Card id="prj_001" />, teamOf('usr_002', ['usr_003', 'usr_004', 'usr_005', 'usr_006']), { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const more = within(row.querySelector('[data-team-column]') as HTMLElement).getByText('+2').parentElement!;
    expect(more.getAttribute('aria-label')).toMatch(/^More: .+, .+$/);
  });

  it('truncates a long name and keeps the row in shape', async () => {
    await renderWithRuntime(<Card id="prj_001" />, (state) => {
      state.projects.prj_001.name = 'Corniche Office Tower and Podium Retail with Underground Parking Levels';
    }, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower and Podium/ });
    expect(within(row).getByText(/Corniche Office Tower and Podium/)).toHaveClass('truncate');
  });

  // On a phone the name of the next deadline and its date share one short line. The name gives way and the date stays whole
  // (audit 2026-10-03, V-32).
  it('cuts a long deadline name, never the date of the next deadline', async () => {
    await renderWithRuntime(<Card id="prj_001" />, undefined, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(row).getByText('Coordination workshop')).toHaveClass('truncate');
    const when = within(row).getByText(/· In 5 days/);
    expect(when).toHaveClass('shrink-0');
    expect(when.closest('.truncate')).toBeNull();
  });

  // Feedback fbk_004 (2026-10-11): with no named deadline the row shows when the current stage ends, never "No deadline" while
  // the Late tag reads that same stage end.
  it('shows the end of the current stage when the project has no named deadline', async () => {
    await renderWithRuntime(<Card id="prj_001" />, (state) => {
      for (const deadline of Object.values(state.deadlines)) if (deadline.projectId === 'prj_001') delete state.deadlines[deadline.id];
      for (const stage of Object.values(state.stages)) if (stage.projectId === 'prj_001') stage.endDate = '2099-01-15';
    }, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(row).getByText('Stage ends').closest('p')).toHaveTextContent(/^Stage ends · .*15/);
    expect(within(row).queryByText('No deadline')).toBeNull();
  });

  // The phone check (2026-10-12) cut "نهاية المرحلة" to "نهاي..." on a Late row, where the past-due words are long. The stage word
  // is the one fact that says what the date is, so on a narrow row the line wraps; only a named deadline gives way and truncates.
  it('wraps the stage end on a narrow row and never cuts its word', async () => {
    await renderWithRuntime(<Card id="prj_001" />, (state) => {
      for (const deadline of Object.values(state.deadlines)) if (deadline.projectId === 'prj_001') delete state.deadlines[deadline.id];
      for (const stage of Object.values(state.stages)) if (stage.projectId === 'prj_001') stage.endDate = '2099-01-15';
    }, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const word = within(row).getByText('Stage ends');
    expect(word).not.toHaveClass('truncate');
    expect(word.closest('p')).not.toHaveClass('inline-flex');
  });

  it('says "No deadline" only when there is no named deadline and no stage end', async () => {
    await renderWithRuntime(<Card id="prj_001" />, (state) => {
      for (const deadline of Object.values(state.deadlines)) if (deadline.projectId === 'prj_001') delete state.deadlines[deadline.id];
      for (const stage of Object.values(state.stages)) if (stage.projectId === 'prj_001') stage.endDate = null;
    }, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(row).getByText('No deadline')).toBeInTheDocument();
    expect(within(row).queryByText('Stage ends')).toBeNull();
  });

  it('draws the project picture large when there is no cover', async () => {
    await renderWithRuntime(<Cover id="prj_005" />, undefined, { path: '/' });
    const cover = await screen.findByRole('img', { name: 'Cover image of Tamr Boutique Hotel' });
    expect(cover).toHaveAttribute('data-project-mark');
    expect(cover.querySelector('svg path')).not.toBeNull();
  });

  it('offers a person outside the project only Open and Copy link', async () => {
    await renderWithRuntime(<Card id="prj_001" />, as('usr_004'), { path: '/' });
    expect(await openMenu()).toEqual(['Open', 'Copy link']);
  });

  it('lets a team member post, but not archive', async () => {
    await renderWithRuntime(<Card id="prj_001" />, as('usr_005'), { path: '/' });
    expect(await openMenu()).toEqual(['Open', 'Post update', 'Copy link']);
  });

  it('archives the project from the menu, then undoes it', async () => {
    const { store } = await renderWithRuntime(<Card id="prj_001" />, as('usr_002'), { path: '/' });
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Project archived.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.status).toBe('archived');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.status).toBe('active'));
  });
});

describe('the sub-company of a row (fbk_007)', () => {
  it('shows the logo of the sub-company on the tile, labelled with its name', async () => {
    await renderWithRuntime(
      <SubCompaniesProvider><Card id="prj_001" /></SubCompaniesProvider>,
      (state) => {
        state.subCompanies = { sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' } };
        state.projects.prj_001.subCompanyId = 'sub_001';
      },
      { path: '/' },
    );
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(await within(row).findByRole('img', { name: 'Vado' })).toBeInTheDocument();
  });

  it('shows no logo on a row whose project has no sub-company', async () => {
    await renderWithRuntime(
      <SubCompaniesProvider><Card id="prj_001" /></SubCompaniesProvider>,
      (state) => {
        state.subCompanies = { sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' } };
      },
      { path: '/' },
    );
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(row).queryByRole('img', { name: 'Vado' })).toBeNull();
  });
});

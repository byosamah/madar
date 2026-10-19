import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { as, withMeeting } from '../../meetings/testMeetings';

/**
 * The Meetings panel of the project Overview (fbk_022). It shows the next two meetings. It shows for a project that has a meeting,
 * or for a person who may plan one (the team, the leader, the Admin). "Now" is Wednesday 2026-09-30 09:00 in Riyadh. usr_005 (Sara) is
 * on the team of prj_001, usr_004 (Omar) is not, and usr_002 (Faisal) leads it.
 */
const day = (state: State, id: string, date: string, over: Record<string, unknown> = {}) =>
  withMeeting(state, { id, title: `Meeting ${id}`, startsAt: `${date}T10:00:00.000+03:00`, endsAt: `${date}T11:00:00.000+03:00`, ...over });

const panel = () => screen.findByRole('region', { name: 'Meetings' });

describe('the Meetings panel of a project', () => {
  it('shows the next two meetings of the project, to a person who is not on the team too, with no Plan button', async () => {
    await renderApp('/projects/prj_001', (state) => {
      as('usr_004')(state);
      day(state, 'mtg_001', '2026-10-04', { title: 'Third one' });
      day(state, 'mtg_002', '2026-10-01', { title: 'First one' });
      day(state, 'mtg_003', '2026-10-02', { title: 'Second one' });
    });
    const box = await panel();
    const links = within(box).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([expect.stringContaining('First one'), expect.stringContaining('Second one')]);
    expect(links[0]).toHaveAttribute('href', '#/meetings?meeting=mtg_002');
    expect(within(box).queryByRole('button', { name: 'Plan a meeting' })).toBeNull();
  });

  it('leaves out a cancelled meeting and a meeting that is over', async () => {
    await renderApp('/projects/prj_001', (state) => {
      as('usr_005')(state);
      day(state, 'mtg_001', '2026-09-30', { title: 'Over', startsAt: '2026-09-30T07:00:00.000+03:00', endsAt: '2026-09-30T08:00:00.000+03:00' });
      day(state, 'mtg_002', '2026-10-01', { title: 'Cancelled', status: 'cancelled' });
      day(state, 'mtg_003', '2026-10-02', { title: 'Still to come' });
    });
    const box = await panel();
    expect(within(box).getByText('Still to come')).toBeInTheDocument();
    expect(within(box).queryByText('Over')).toBeNull();
    expect(within(box).queryByText('Cancelled')).toBeNull();
  });

  it('shows a line and one text button to a team member when no meeting is planned', async () => {
    await renderApp('/projects/prj_001', as('usr_005'));
    const box = await panel();
    expect(within(box).getByText('No meeting is planned.')).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Plan a meeting' })).toBeInTheDocument();
  });

  it('is not on the page for a person who may not plan one, when the project has no meeting', async () => {
    await renderApp('/projects/prj_001', as('usr_004'));
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(screen.queryByRole('region', { name: 'Meetings' })).toBeNull();
  });

  it('offers no Plan button on a project that is completed', async () => {
    await renderApp('/projects/prj_001', (state) => {
      as('usr_002')(state);
      state.projects.prj_001.status = 'completed';
      day(state, 'mtg_001', '2026-10-01', { title: 'Late one' });
    });
    const box = await panel();
    expect(within(box).getByText('Late one')).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: 'Plan a meeting' })).toBeNull();
  });

  it('opens the form with the project already chosen', async () => {
    await renderApp('/projects/prj_001', as('usr_005'));
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Plan a meeting' }));
    const form = await screen.findByRole('dialog', { name: 'Plan a meeting' });
    expect(within(form).getByRole('combobox', { name: 'Project' })).toHaveDisplayValue('Corniche Office Tower');
  });

  it('plans a meeting in the project, and the panel shows it', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_005'));
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Plan a meeting' }));
    const form = await screen.findByRole('dialog', { name: 'Plan a meeting' });
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Kick-off with the client');
    await userEvent.click(within(form).getByRole('button', { name: 'Plan meeting' }));
    expect(await within(await panel()).findByText('Kick-off with the client')).toBeInTheDocument();
    expect(Object.values(store.state.meetings!)[0]).toMatchObject({ projectId: 'prj_001', organizerId: 'usr_005' });
  });
});

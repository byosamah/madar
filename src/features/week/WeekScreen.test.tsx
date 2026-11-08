import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { checkinsOf, type State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The Week page (fbk_088, owner 2026-11-08): the plan and what was done of every person, side by side, and who has not answered. The test office
 * has "now" on Wednesday 2026-09-30, so the week began on Sunday 2026-09-27. usr_001 is the Admin (Hala), usr_002 leads prj_001 (Faisal).
 */
const STAMP = '2026-09-28T09:00:00.000+03:00';
const answer = (id: string, userId: string, kind: 'plan' | 'review', text: string, taskIds: string[] = [], week = '2026-09-27') => ({
  id, userId, week, kind, text, taskIds, createdAt: STAMP, updatedAt: STAMP,
});

function answers(state: State) {
  state.session.currentUserId = 'usr_003';
  Object.assign(checkinsOf(state), {
    chk_001: answer('chk_001', 'usr_002', 'plan', 'Send the facade drawings.', ['tsk_012']),
    chk_002: answer('chk_002', 'usr_005', 'plan', 'Check the stair section.'),
    chk_003: answer('chk_003', 'usr_005', 'review', 'The stair section is done.'),
    chk_004: answer('chk_004', 'usr_002', 'plan', 'An old plan.', [], '2026-09-20'),
  });
  state.counters.chk = 4;
}

const rows = async () => (await screen.findAllByRole('listitem')).filter((item) => item.querySelector('h2'));

describe('the Week page', () => {
  it('shows a row for each person who answered, with the plan and what was done side by side, in name order', async () => {
    await renderApp('/week', answers);
    expect(await screen.findByRole('heading', { level: 1, name: 'Week' })).toBeInTheDocument();
    const [faisal, other] = await rows();
    expect(within(faisal).getByText('Faisal Al-Harbi')).toBeInTheDocument();
    expect(within(faisal).getByText('Civil Defense drawings')).toBeInTheDocument();
    expect(within(faisal).getByText('Send the facade drawings.')).toBeInTheDocument();
    expect(within(faisal).getByText('No answer yet')).toBeInTheDocument();
    expect(within(other).getByText('Check the stair section.')).toBeInTheDocument();
    expect(within(other).getByText('The stair section is done.')).toBeInTheDocument();
    expect(screen.queryByText('An old plan.')).toBeNull();
  });

  it('lists who has no plan yet, and no list of the review before Thursday', async () => {
    await renderApp('/week', answers);
    const line = await screen.findByText(/^No plan yet:/);
    expect(line.textContent).toContain('Hala');
    expect(line.textContent).not.toContain('Faisal');
    expect(screen.queryByText(/^No answer yet:/)).toBeNull();
  });

  it('steps back one week with a link, and reads the answers of that week', async () => {
    const { router } = await renderApp('/week', answers);
    await userEvent.click(await screen.findByRole('link', { name: 'Previous week' }));
    expect(router.state.location.search).toBe('?week=2026-09-20');
    expect(await screen.findByText('An old plan.')).toBeInTheDocument();
    expect(screen.queryByText('Send the facade drawings.')).toBeNull();
    // The week after it has a link, and the current week has none.
    await userEvent.click(await screen.findByRole('link', { name: 'Next week' }));
    expect(await screen.findByText('Send the facade drawings.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Next week' })).toBeNull();
  });

  it('says so when nobody answered', async () => {
    await renderApp('/week', (state) => {
      state.session.currentUserId = 'usr_003';
    });
    expect(await screen.findByText('No one has answered yet.')).toBeInTheDocument();
  });

  it('builds the lines now: the title the to-do has now, and no title of a to-do in a project that the reader may not view', async () => {
    await renderApp('/week', (state) => {
      answers(state);
      state.tasks.tsk_012.title = 'Civil Defense drawings v2';
      state.tasks.tsk_901 = { ...structuredClone(state.tasks.tsk_012), id: 'tsk_901', title: 'Secret tower to-do', projectId: 'prj_901', ownerId: 'usr_002' };
      state.projects.prj_901 = { ...structuredClone(state.projects.prj_001), id: 'prj_901', code: 'KH-26-901', name: 'Secret tower', access: { hidden: true, viewerIds: [] } };
      checkinsOf(state).chk_001.taskIds = ['tsk_012', 'tsk_901'];
    });
    const [faisal] = await rows();
    expect(within(faisal).getByText('Civil Defense drawings v2')).toBeInTheDocument();
    expect(within(faisal).getByText('Send the facade drawings.')).toBeInTheDocument();
    expect(screen.queryByText('Secret tower to-do')).toBeNull();
  });

  it('shows the wrong-link page to a person without the switch "Read the weekly answers"', async () => {
    await renderApp('/week', (state) => {
      answers(state);
      state.users.usr_003.roleId = 'rol_901';
      state.settings.roles = { custom: [{ id: 'rol_901', name: 'Quiet', nameAr: 'هادئ', rights: [], off: ['checkin.read'] }] };
    });
    expect(await screen.findByText('This page does not exist')).toBeInTheDocument();
    expect(screen.queryByText('Send the facade drawings.')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Week' })).toBeNull();
  });
});

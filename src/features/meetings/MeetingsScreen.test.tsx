import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { expectCalm } from '../auth/calmChecks';
import { renderApp } from '../../test/render';
import { as, withMeeting } from './testMeetings';

/**
 * The Meetings view inside Tasks (fbk_022, owner 2026-10-19). "Now" is Wednesday 2026-09-30 09:00 in Riyadh. usr_002 is Faisal, who
 * leads prj_001. The week of the office runs Sunday to Saturday.
 */
function office(state: State): void {
  as('usr_002')(state);
  withMeeting(state, { id: 'mtg_001', title: 'Review the facade', startsAt: '2026-09-30T14:00:00.000+03:00', endsAt: '2026-09-30T15:00:00.000+03:00' });
  withMeeting(state, {
    id: 'mtg_002', title: 'Weekly team meeting', kind: 'team', projectId: null, startsAt: '2026-10-01T10:00:00.000+03:00', endsAt: '2026-10-01T10:30:00.000+03:00',
    attendeeIds: ['usr_005'],
  });
  withMeeting(state, { id: 'mtg_003', title: 'Walk the plot', kind: 'site_visit', startsAt: '2026-10-08T09:00:00.000+03:00', endsAt: '2026-10-08T11:00:00.000+03:00' });
  withMeeting(state, { id: 'mtg_004', title: 'Kick-off', startsAt: '2026-09-28T10:00:00.000+03:00', endsAt: '2026-09-28T11:00:00.000+03:00' });
}

describe('the Meetings view of the Tasks screen', () => {
  it('shows one title, the switch on Meetings, one main button, and the groups in order', async () => {
    await renderApp('/meetings', office);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    const switchBox = screen.getByRole('radiogroup', { name: 'Show' });
    expect(within(switchBox).getByRole('radio', { name: 'Meetings' })).toBeChecked();
    expect(within(switchBox).getByRole('radio', { name: 'To-dos' })).not.toBeChecked();
    // The switch sits in its own row under the title block, as the Filter button does on Projects (owner, 2026-10-23).
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' }).closest('div.pb-5')!.contains(switchBox)).toBe(false);
    expect(switchBox.parentElement!.className).toBe('flex flex-wrap items-center gap-3 pb-4');
    expect(screen.getAllByRole('button', { name: 'New meeting' })).toHaveLength(1);
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByText('Review the facade')).toBeInTheDocument();
    const week = screen.getByRole('region', { name: 'This week' });
    expect(within(week).getByText('Weekly team meeting')).toBeInTheDocument();
    const later = screen.getByRole('region', { name: 'Later' });
    expect(within(later).getByText('Walk the plot')).toBeInTheDocument();
    const order = [today, week, later].map((region) => region.compareDocumentPosition(later));
    expect(order[0] & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectCalm(document.querySelector('main') as HTMLElement);
  });

  it('writes the time, the kind and the project, or the word Office, on each row', async () => {
    await renderApp('/meetings', office);
    const project = (await screen.findByText('Review the facade')).closest('li')!;
    expect(within(project).getByText('2:00 PM')).toBeInTheDocument();
    expect(within(project).getByText(/Client meeting/)).toBeInTheDocument();
    expect(within(project).getByText(/Corniche Office Tower/)).toBeInTheDocument();
    const team = screen.getByText('Weekly team meeting').closest('li')!;
    expect(within(team).getByText(/Team meeting/)).toBeInTheDocument();
    expect(within(team).getByText(/Office/)).toBeInTheDocument();
  });

  it('keeps the earlier days in one folded row', async () => {
    await renderApp('/meetings', office);
    await screen.findByText('Review the facade');
    expect(screen.queryByText('Kick-off')).toBeNull();
    const fold = screen.getByRole('button', { name: 'Earlier (1)' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Kick-off')).toBeInTheDocument();
  });

  it('shows one line and the main button when there is no meeting', async () => {
    await renderApp('/meetings', as('usr_002'));
    expect(await screen.findByText('You have no meeting in the next 60 days.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New meeting' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Earlier/ })).toBeNull();
  });

  it('lists the meetings of the person only, and never a private meeting of other people', async () => {
    await renderApp('/meetings', (state) => {
      office(state);
      as('usr_006')(state);
      withMeeting(state, { id: 'mtg_005', title: 'Private talk', projectId: null, organizerId: 'usr_002', attendeeIds: ['usr_005'] });
      withMeeting(state, { id: 'mtg_006', title: 'A talk with Yousef', projectId: null, organizerId: 'usr_002', attendeeIds: ['usr_006'] });
    });
    expect(await screen.findByText('A talk with Yousef')).toBeInTheDocument();
    expect(screen.queryByText('Private talk')).toBeNull();
    expect(screen.queryByText('Review the facade')).toBeNull();
  });

  it('opens the sheet of a meeting from a row and from the link, and closes it by the link', async () => {
    const { router } = await renderApp('/meetings', office);
    await userEvent.click(await screen.findByText('Review the facade'));
    expect(await screen.findByRole('dialog', { name: 'Review the facade' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?meeting=mtg_001');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review the facade' })).toBeNull());
    expect(router.state.location.search).toBe('');
  });

  it('opens the sheet when the link names the meeting', async () => {
    await renderApp('/meetings?meeting=mtg_002', office);
    expect(await screen.findByRole('dialog', { name: 'Weekly team meeting' })).toBeInTheDocument();
  });

  it('switches between Tasks and Meetings, and keeps the Tasks tab open', async () => {
    const { router } = await renderApp('/work', office);
    await userEvent.click(await screen.findByRole('radio', { name: 'Meetings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/meetings'));
    expect(await screen.findByRole('button', { name: 'New meeting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New office to-do' })).toBeNull();
    const tab = screen.getAllByRole('link', { name: 'Tasks' }).find((link) => link.getAttribute('aria-current') === 'page');
    expect(tab).toBeDefined();
    await userEvent.click(screen.getByRole('radio', { name: 'To-dos' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/work'));
    expect(await screen.findByRole('button', { name: 'New office to-do' })).toBeInTheDocument();
  });

  it('writes the times with Western digits in Arabic', async () => {
    await renderApp('/meetings', (state) => {
      office(state);
      state.users.usr_002.preferences.language = 'ar';
    });
    const row = (await screen.findByText('Review the facade')).closest('li')!;
    expect(row.textContent).not.toMatch(/[٠-٩]/);
    expect(row.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(screen.getByRole('region', { name: 'اليوم' })).toBeInTheDocument();
  });
});

describe('the space of the controls row (owner, 2026-10-23)', () => {
  it('is the same row on Projects, Tasks and Meetings: 20 px under the title and 16 px above the list', async () => {
    const rowOf = (node: HTMLElement) => node.closest('div.pb-4') as HTMLElement;
    const projects = await renderApp('/projects', office);
    const filter = rowOf(await screen.findByRole('button', { name: /^Filter/ }));
    const projectsTitle = screen.getByRole('heading', { level: 1 }).closest('div.pb-5') as HTMLElement;
    expect(filter.previousElementSibling).toBe(projectsTitle);
    const rowClass = filter.className;
    projects.unmount();
    for (const path of ['/work', '/meetings']) {
      const app = await renderApp(path, office);
      const row = rowOf(await screen.findByRole('radiogroup', { name: 'Show' }));
      const title = screen.getByRole('heading', { level: 1, name: 'Tasks' }).closest('div.pb-5') as HTMLElement;
      expect(row.className, path).toBe(rowClass);
      expect(row.previousElementSibling, path).toBe(title);
      // The title holds no line under it any more, and the row sits right above the list: no gap between them.
      expect(title.querySelector('.mt-1\\.5'), path).toBeNull();
      expect(row.parentElement!.className, path).not.toContain('gap-');
      app.unmount();
    }
  });
});

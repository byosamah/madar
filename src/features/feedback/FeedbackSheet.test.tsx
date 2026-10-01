import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('request a feature or report a bug (owner, 2026-10-01)', () => {
  it('sends a bug report with a screenshot and the screen it came from', async () => {
    const { store } = await renderApp('/projects', as('usr_003'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reem Al-Ghamdi' }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Request a feature or report a bug' }));
    const sheet = await screen.findByRole('dialog', { name: 'Request a feature or report a bug' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Bug report' }));
    expect(within(sheet).getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText('What went wrong?'), 'The board does not scroll on my phone.');
    await userEvent.upload(within(sheet).getByLabelText('Add a screenshot'), new File(['shot'], 'board.png', { type: 'image/png' }));
    expect(within(sheet).getByRole('img', { name: 'Screenshot 1' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thank you. The Admin will read it.')).toBeInTheDocument();
    await waitFor(() => expect(Object.values(store.state.feedback ?? {})).toHaveLength(1));
    const [report] = Object.values(store.state.feedback ?? {});
    expect(report).toMatchObject({ kind: 'bug', message: 'The board does not scroll on my phone.', page: '/projects', createdBy: 'usr_003' });
    expect(report.screenshots).toHaveLength(1);
  });

  it('shows the reports to the Admin, who marks one done', async () => {
    await renderApp('/admin', (state) => {
      state.feedback = {
        fbk_001: { id: 'fbk_001', kind: 'feature', message: 'Let me export the schedule.', page: '/dashboard', screenshots: [], status: 'new', createdBy: 'usr_003', createdAt: '2026-10-01T09:00:00.000Z', doneBy: null, doneAt: null },
      };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    expect(await within(section).findByText('Let me export the schedule.')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Mark done' }));
    expect(await within(section).findByRole('button', { name: 'Open again' })).toBeInTheDocument();
  });

  it('never links a stored page that is not an in-app path (security review)', async () => {
    await renderApp('/admin', (state) => {
      state.feedback = {
        fbk_001: { id: 'fbk_001', kind: 'bug', message: 'Odd page', page: 'javascript:alert(1)', screenshots: [], status: 'new', createdBy: 'usr_003', createdAt: '2026-10-01T09:00:00.000Z', doneBy: null, doneAt: null },
      };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    expect(await within(section).findByText('javascript:alert(1)')).toBeInTheDocument();
    expect(within(section).queryByRole('link', { name: /javascript/ })).toBeNull();
  });

  it('hides the reports from everyone but the Admin', async () => {
    await renderApp('/admin', as('usr_010'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: /Requests and bugs/ })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('the project Overview', () => {
  it('shows where the project stands, what needs attention and what comes next', async () => {
    await renderApp('/projects/prj_001');
    const standing = await screen.findByRole('region', { name: 'Where the project stands' });
    expect(within(standing).getByText('Construction Documents')).toBeInTheDocument();
    expect(within(standing).getByText('Stage 4 of 7')).toBeInTheDocument();
    expect(within(standing).getByText('Late')).toBeInTheDocument();
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(await within(attention).findByRole('heading', { name: /^Past due/ })).toBeInTheDocument();
    expect(within(attention).getByText('Stair details')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Coming up' })).getByText('Coordination workshop')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Post an update' })).toBeNull();
  });

  it('shows what each person works on now, and opens the task', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    const people = await screen.findByRole('region', { name: 'Who is doing what' });
    const sara = within(people).getByText('Sara Al-Qahtani').closest('li') as HTMLElement;
    await waitFor(() => expect(within(sara).getByText(/[1-9] open task/)).toBeInTheDocument());
    await userEvent.click(within(people).getAllByRole('button')[0]);
    await waitFor(() => expect(window.location.hash).toContain('task=tsk_'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the log in the Activity tab', async () => {
    await renderApp('/projects/prj_001');
    await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText(/I uploaded revision B of the ground floor plan/)).toBeInTheDocument();
  });
});

describe('project links (colleague comment 5)', () => {
  it('lists the links: a web link opens in a new tab, the office folder gets a Copy button', async () => {
    await renderApp('/projects/prj_001');
    const about = await screen.findByRole('region', { name: 'About' });
    const pinterest = await within(about).findByRole('link', { name: /Pinterest: facades/ });
    expect(pinterest).toHaveAttribute('href', 'https://www.pinterest.com/madar-studio/corniche-facades/');
    expect(pinterest).toHaveAttribute('target', '_blank');
    expect(pinterest).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(about).getByRole('button', { name: /^Copy / })).toBeInTheDocument();
  });

  it('lets the leader add a link and refuses one that is not a web link', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    const about = await screen.findByRole('region', { name: 'About' });
    await userEvent.click(within(about).getByRole('button', { name: 'Add link' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a link' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Kind'), 'other');
    await userEvent.type(within(sheet).getByLabelText('Link'), 'javascript:alert(1)');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add link' }));
    expect(await within(sheet).findByText('Use a web link that starts with https://.')).toBeInTheDocument();
    await userEvent.clear(within(sheet).getByLabelText('Link'));
    await userEvent.type(within(sheet).getByLabelText('Link'), 'https://example.com/brief');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add link' }));
    expect(await within(about).findByRole('link', { name: /example\.com/ })).toHaveAttribute('href', 'https://example.com/brief');
  });

  it('shows the links to someone outside the project, with no way to change them', async () => {
    await renderApp('/projects/prj_001', as('usr_003'));
    const about = await screen.findByRole('region', { name: 'About' });
    expect(await within(about).findByRole('link', { name: /Pinterest: facades/ })).toBeInTheDocument();
    expect(within(about).queryByRole('button', { name: 'Add link' })).toBeNull();
    expect(within(about).queryByRole('button', { name: /^Change / })).toBeNull();
  });
});

describe('project links from stored data (security)', () => {
  it('never makes a stored link that is not a web link pressable', async () => {
    await renderApp('/projects/prj_001', (state) => {
      state.projects.prj_001.links = [{ id: 'lnk_bad', kind: 'other', label: 'Bad link', url: 'javascript:alert(1)' }];
    });
    const about = await screen.findByRole('region', { name: 'About' });
    expect(await within(about).findByText('Bad link')).toBeInTheDocument();
    expect(within(about).queryByRole('link', { name: /Bad link/ })).toBeNull();
    expect(about.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('pending items from the client (colleague comment 6)', () => {
  it('lists what we wait for from the client in Needs attention, and Received closes it', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(await within(attention).findByRole('heading', { name: /^Waiting for the client/ })).toBeInTheDocument();
    expect(within(attention).getByText('Asked the client for the signed fee agreement')).toBeInTheDocument();
    await userEvent.click(within(attention).getByRole('button', { name: /^Received.*signed fee agreement/ }));
    await waitFor(() => expect(within(attention).queryByText('Asked the client for the signed fee agreement')).toBeNull());
  });
});

describe('the contract start date (colleague comment 7)', () => {
  it('shows in the About panel to a member, and says Not set when there is none', async () => {
    await renderApp('/projects/prj_001', as('usr_005'));
    const about = await screen.findByRole('region', { name: 'About' });
    const fact = within(about).getByText('Contract start date').closest('div') as HTMLElement;
    expect(fact).toHaveTextContent('3 May 2026');
    expect(screen.queryByRole('region', { name: 'Payments' })).toBeNull();
  });

  it('shows Not set for a project with no contract date', async () => {
    await renderApp('/projects/prj_005', as('usr_005'));
    const about = await screen.findByRole('region', { name: 'About' });
    expect(within(about).getByText('Contract start date').closest('div')).toHaveTextContent('Not set');
  });

  it('is in the Edit project form, and a change saves and shows in the About panel', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    const field = within(sheet).getByLabelText('Contract start date');
    expect(field).toHaveValue('2026-05-03');
    fireEvent.change(field, { target: { value: '2026-05-10' } });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.contractStartDate).toBe('2026-05-10'));
    const about = await screen.findByRole('region', { name: 'About' });
    await waitFor(() => expect(within(about).getByText('Contract start date').closest('div')).toHaveTextContent('10 May 2026'));
  });
});

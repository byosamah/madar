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
    await waitFor(() => expect(within(sara).getByText(/[1-9] open to-do/)).toBeInTheDocument());
    await userEvent.click(within(people).getAllByRole('button')[0]);
    await waitFor(() => expect(window.location.hash).toContain('task=tsk_'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  // In Arabic, "Structural · 3 open tasks" showed as "3 · Structural" and then the Arabic words: the count joined the English
  // name. The name of the discipline is a unit of its own (2026-10-05).
  it('keeps the name of a discipline apart from the count after it', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    const people = await screen.findByRole('region', { name: 'Who is doing what' });
    expect(within(people).getByText('Structural').tagName).toBe('BDI');
  });

  it('keeps the log in the Activity tab', async () => {
    await renderApp('/projects/prj_001');
    await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText(/I uploaded revision B of the ground floor plan/)).toBeInTheDocument();
  });
});

describe('the template of a project (ADM-05)', () => {
  it('names the template that the project follows in the About panel', async () => {
    await renderApp('/projects/prj_007');
    const about = await screen.findByRole('region', { name: 'About' });
    expect(await within(about).findByText('Villa, full design')).toBeInTheDocument();
    expect(within(about).getByText('Template')).toBeInTheDocument();
  });

  it('shows no template line for a project that follows none', async () => {
    await renderApp('/projects/prj_001');
    const about = await screen.findByRole('region', { name: 'About' });
    expect(within(about).queryByText('Template')).toBeNull();
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

describe('the sub-company in About (fbk_007)', () => {
  it('shows one line with the name of the sub-company and its logo, which a screen reader skips', async () => {
    await renderApp('/projects/prj_001', (state) => {
      state.subCompanies = { sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' } };
      state.projects.prj_001.subCompanyId = 'sub_001';
    });
    const about = await screen.findByRole('region', { name: 'About' });
    await waitFor(() => expect(within(about).getByText('Sub-company').closest('div')).toHaveTextContent('Vado'));
    expect(within(about).queryByRole('img', { name: 'Vado' })).toBeNull();
    expect(about.querySelector('[aria-hidden="true"] [role="img"]')).not.toBeNull();
  });
});

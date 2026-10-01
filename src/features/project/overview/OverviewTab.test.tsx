import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

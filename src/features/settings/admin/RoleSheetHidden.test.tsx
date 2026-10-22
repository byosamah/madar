import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

/** The four switches of hidden projects in the Projects section of the role sheet (D1 words, checked in D4). */
describe('the role sheet and hidden projects', () => {
  it('shows See every project and Choose who sees a project on for a Member, and See hidden projects off', async () => {
    await renderApp('/admin/roles');
    const roles = await screen.findByRole('region', { name: 'Roles' });
    await userEvent.click(await within(roles).findByRole('button', { name: /^Member/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Member' });
    const heading = within(sheet).getByRole('button', { name: /^Projects \d+ of \d+ on$/ });
    await userEvent.click(heading);
    const projects = within(within(sheet).getByRole('region', { name: 'Projects' }));
    expect(projects.getByRole('switch', { name: 'See every project' })).toHaveAttribute('aria-checked', 'true');
    expect(projects.getByRole('switch', { name: 'Choose who sees a project, Projects I lead' })).toHaveAttribute('aria-checked', 'true');
    expect(projects.getByRole('switch', { name: 'Choose who sees a project, Every project' })).toHaveAttribute('aria-checked', 'false');
    expect(projects.getByRole('switch', { name: 'See hidden projects' })).toHaveAttribute('aria-checked', 'false');
    expect(projects.getByText(/With this off, the person sees only the projects where the person works/)).toBeInTheDocument();
  });
});

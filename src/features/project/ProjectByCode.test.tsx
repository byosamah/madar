import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('project links', () => {
  it('opens a project from its code', async () => {
    await renderApp('/projects/code/KH-26-003');
    expect(await screen.findByRole('heading', { level: 1, name: 'Eastern Shore Primary School' })).toBeInTheDocument();
  });

  it('says when no project has the code', async () => {
    await renderApp('/projects/code/KH-99-999');
    expect(await screen.findByText('This project does not exist anymore.')).toBeInTheDocument();
  });

  it('turns a project code in a post into a link', async () => {
    const { api } = await renderApp('/projects/prj_001', (state) => {
      state.session.currentUserId = 'usr_002';
    });
    await api.call('updates.create', { projectId: 'prj_001', body: 'Same facade as #KH-26-003' });
    await userEvent.click(await screen.findByRole('link', { name: '#KH-26-003' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Eastern Shore Primary School' })).toBeInTheDocument();
  });
});

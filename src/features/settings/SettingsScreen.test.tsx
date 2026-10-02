import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('settings screen', () => {
  it('changes the theme, and has no glass setting left', async () => {
    await renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(screen.queryByRole('heading', { name: 'Glass' })).toBeNull();
  });

  it('turns a notification trigger off', async () => {
    await renderApp('/settings');
    const toggle = await screen.findByRole('switch', { name: 'Someone mentions me' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Someone mentions me' })).toHaveAttribute('aria-checked', 'false'));
  });

  it('saves the profile', async () => {
    const { store } = await renderApp('/settings');
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Hala N.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_001.name).toBe('Hala N.'));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
  });

  it('shows a refused profile field under the field (audit 2026-10-03, SHL-22)', async () => {
    await renderApp('/settings');
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
    expect(screen.getByLabelText('Discipline')).not.toHaveAttribute('aria-invalid');
  });

  it('previews the app as another person', async () => {
    const { store } = await renderApp('/settings');
    const selects = await screen.findAllByRole('combobox', { name: /Preview as/ });
    await userEvent.selectOptions(selects[0], 'usr_005');
    await waitFor(() => expect(store.state.session.currentUserId).toBe('usr_005'));
  });

  it('resets the sample data and says so', async () => {
    const { store } = await renderApp('/settings');
    store.state.projects.prj_001.name = 'Changed';
    await userEvent.click(await screen.findByRole('button', { name: 'Reset sample data' }));
    expect(await screen.findByText('The sample data is back to its start state.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.name).toBe('Corniche Office Tower');
  });

  it("shows the notification switches of the agent's person when previewing as an agent", async () => {
    await renderApp('/settings', (state) => {
      const agent = Object.values(state.users).find((u) => u.kind === 'agent')!;
      state.users[agent.ownerId!].preferences.notifications.mention = false;
      state.session.currentUserId = agent.id;
    });
    expect(await screen.findByRole('switch', { name: 'Someone mentions me' })).toHaveAttribute('aria-checked', 'false');
  });
});

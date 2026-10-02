import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

// The Settings screen breaks, so the test sees what a crash in one screen shows.
vi.mock('../features/settings/SettingsScreen', () => ({
  SettingsScreen: () => {
    throw new Error('A broken screen');
  },
}));

const pill = () => screen.findByRole('navigation', { name: 'Main navigation' });

describe('a wrong link or a broken screen (audit 2026-10-03, SHL-6)', () => {
  it('shows a calm page with a way Home for a wrong link, inside the shell', async () => {
    await renderApp('/projectz');
    expect(await screen.findByRole('heading', { name: 'This page does not exist' })).toBeInTheDocument();
    expect(screen.queryByText(/Hey developer/)).toBeNull();
    expect(await pill()).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Go to Home' }));
    expect(window.location.hash).toBe('#/');
  });

  it('shows a calm page for a screen that breaks, and keeps the tabs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderApp('/settings');
    expect(await screen.findByRole('heading', { name: 'This page did not open' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
    await userEvent.click(within(await pill()).getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

// The Settings screen breaks, so the test sees what a crash in one screen shows.
vi.mock('../features/settings/SettingsScreen', () => ({
  SettingsScreen: () => {
    throw new Error('A broken screen');
  },
}));

// The owner's error record (insight design, section 4): a broken screen is reported, a wrong link is not.
const reportError = vi.hoisted(() => vi.fn());
vi.mock('./insight/notes', async (importActual) => ({ ...(await importActual<typeof import('./insight/notes')>()), reportError }));

const pill = () => screen.findByRole('navigation', { name: 'Main navigation' });

describe('a wrong link or a broken screen (audit 2026-10-03, SHL-6)', () => {
  beforeEach(() => reportError.mockClear());

  it('shows a calm page with a way Home for a wrong link, inside the shell', async () => {
    await renderApp('/projectz');
    // The page has a level-1 heading, as every screen has (audit 2026-10-03, V-34).
    expect(await screen.findByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument();
    // The title shows once: the card under it has only the sentence and the way Home (audit 2026-10-03, V-34).
    expect(screen.getAllByText('This page does not exist')).toHaveLength(1);
    expect(screen.getByText('The link is wrong or old.')).toBeInTheDocument();
    expect(screen.queryByText(/Hey developer/)).toBeNull();
    expect(await pill()).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Go to Home' }));
    expect(window.location.hash).toBe('#/');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('shows a calm page for a screen that breaks, and keeps the tabs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderApp('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'This page did not open' })).toBeInTheDocument();
    expect(screen.getAllByText('This page did not open')).toHaveLength(1);
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'A broken screen' }), 'route');
    await userEvent.click(within(await pill()).getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });
});

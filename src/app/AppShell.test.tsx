import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

const pill = () => screen.findByRole('navigation', { name: 'Main navigation' });

describe('app shell', () => {
  it('shows the floating pill with four tabs and search', async () => {
    await renderApp('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    const nav = await pill();
    for (const name of ['Home', 'Projects', 'Dashboard', 'Inbox']) expect(within(nav).getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Search' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /^Notifications/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Work' })).toBeNull();
  });

  it('moves between screens', async () => {
    await renderApp('/dashboard');
    await userEvent.click(within(await pill()).getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/projects');
  });

  it('opens old Projects links on the new route', async () => {
    await renderApp('/?filter=at_risk');
    await waitFor(() => expect(window.location.hash).toBe('#/projects?filter=at_risk'));
  });

  it('opens the person menu with Preview as, language and Settings', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    expect(within(menu).getByRole('combobox', { name: /Preview as/ })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('switches between light and dark from the person menu', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('button', { name: 'Dark mode' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await userEvent.click(await within(screen.getByRole('dialog', { name: 'Hala Nasser' })).findByRole('button', { name: 'Light mode' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });

  it('warns that changes are not saved when storage is in memory', async () => {
    await renderApp('/dashboard');
    expect(await screen.findByText('Changes will not be saved in this window.')).toBeInTheDocument();
  });

  it('shows the bell badge for notifications that need action', async () => {
    await renderApp('/dashboard');
    expect((await screen.findAllByText(/^\d+ items? needs? action$/)).length).toBeGreaterThan(0);
  });

  it('switches to Arabic from the person menu and mirrors the page', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('button', { name: 'العربية' }));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(await screen.findByRole('heading', { level: 1, name: 'لوحة المعلومات' })).toBeInTheDocument();
  });

  it('says the unread counts in the names of the Inbox and bell links, with the right plural (audit 2026-10-03, BRW-10, BRW-12)', async () => {
    await renderApp('/dashboard', (state) => {
      const mine = Object.values(state.notifications).filter((n) => n.userId === 'usr_001' && !n.read);
      for (const n of mine.slice(1)) n.read = true;
      if (mine[0]) mine[0].trigger = 'task_assigned';
    });
    const nav = await pill();
    expect(await within(nav).findByRole('link', { name: 'Notifications, 1 item needs action' })).toBeInTheDocument();
    expect(await within(nav).findByRole('link', { name: 'Inbox, Unread messages: 5' })).toBeInTheDocument();
  });

  it('opens Search with Ctrl+K', async () => {
    await renderApp('/dashboard');
    await pill();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
  });
});

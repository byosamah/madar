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

  // jsdom has no layout, so this test holds the rule in the classes. The pixel check is a Playwright run at 360 and 390 px.
  it('lets a phone tab grow to its whole label on one line, so a long label is never cut (audit 2026-10-03, F-2)', async () => {
    await renderApp('/dashboard', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const nav = await screen.findByRole('navigation', { name: 'التنقل الرئيسي' });
    const tab = within(nav).getByRole('link', { name: 'لوحة المعلومات' });
    expect(tab).toHaveClass('min-w-fit');
    expect(tab).not.toHaveClass('min-w-0');
    expect(within(tab).getByText('لوحة المعلومات')).toHaveClass('whitespace-nowrap');
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

  // jsdom has no layout, so this test holds the rule in the classes. The pixel check is a Playwright run at 390 px.
  it('starts every row of the person menu at the same edge, also a label on two lines (audit 2026-10-03, F-6)', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const menu = within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('navigation', { name: 'Hala Nasser' });
    const rows = [...within(menu).getAllByRole('button'), ...within(menu).getAllByRole('link')];
    expect(rows.length).toBe(5);
    for (const row of rows) expect(row).toHaveClass('text-start');
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

  it('gives the focus back to the person picture after the language switch (audit 2026-10-03, F-3)', async () => {
    await renderApp('/dashboard');
    const picture = (await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0];
    await userEvent.click(picture);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('button', { name: 'العربية' }));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(screen.queryByRole('dialog', { name: 'Hala Nasser' })).toBeNull();
    expect(document.activeElement).toBe(picture);
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

  it('starts the open screen again for the next person after Preview as, so no unsent update goes over (audit 2026-10-03, V-22)', async () => {
    const { store } = await renderApp('/projects/prj_001?tab=activity');
    const form = await screen.findByRole('form', { name: 'Post an update' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Post an update' }), 'Only for Hala');
    await userEvent.upload(within(form).getByLabelText('Attach files'), new File(['x'], 'Hala notes.pdf', { type: 'application/pdf' }));
    expect(within(form).getByText('Hala notes.pdf')).toBeInTheDocument();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('combobox', { name: /Preview as/ }), 'usr_002');
    await waitFor(() => expect(store.state.session.currentUserId).toBe('usr_002'));
    const next = await screen.findByRole('form', { name: 'Post an update' });
    await waitFor(() => expect(within(next).getByRole('textbox', { name: 'Post an update' })).toHaveValue(''));
    expect(within(next).queryByText('Hala notes.pdf')).toBeNull();
  });

  it('opens Search with Ctrl+K', async () => {
    await renderApp('/dashboard');
    await pill();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoleSettings } from '../api/contract/entities';
import type { State } from '../api/store';
import { renderApp } from '../test/render';
import { atPhoneWidth } from '../features/auth/renderAuth';
import { without } from '../test/rr2work';

/**
 * The shell and the routes of role rights version 2 (design section 7): the Dashboard tab, its routes and every link to it,
 * Search (icon, shortcut, route and commands), and the person menu. usr_005 is a Member on the team of prj_001. The Member has every
 * basic switch on, so a control shows by default; a test turns one switch off in the office settings and the control goes.
 */
const MEMBER = 'usr_005';
const as = (roles?: RoleSettings) => (state: State) => {
  state.session.currentUserId = MEMBER;
  if (roles) state.settings.roles = roles;
};
const pill = () => screen.findByRole('navigation', { name: 'Main navigation' });
const missing = () => screen.findByRole('heading', { level: 1, name: 'This page does not exist' });

describe('Dashboard (dashboard.view)', () => {
  it('shows the Dashboard tab with the switch on', async () => {
    await renderApp('/', as());
    const nav = await pill();
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument());
  });

  it('takes the tab away with the switch off and keeps the other tabs', async () => {
    await renderApp('/', as(without('dashboard.view')));
    const nav = await pill();
    await waitFor(() => expect(within(nav).queryByRole('link', { name: 'Dashboard' })).toBeNull());
    for (const name of ['Home', 'Projects', 'Inbox']) expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
  });

  it('shows five tabs on a phone with the switch on, and four with the switch off', async () => {
    atPhoneWidth();
    const on = await renderApp('/', as());
    const bar = await pill();
    const tabs = () => within(screen.getByRole('navigation', { name: 'Main navigation' })).getAllByRole('link').filter((link) => link.className.includes('flex-1'));
    await waitFor(() => expect(tabs().map((link) => link.textContent)).toEqual(['Home', 'Projects', 'Tasks', 'Dashboard', 'Inbox']));
    expect(bar).toBeInTheDocument();
    on.unmount();
    await renderApp('/', as(without('dashboard.view')));
    await waitFor(() => expect(tabs().map((link) => link.textContent)).toEqual(['Home', 'Projects', 'Tasks', 'Inbox']));
  });

  it('opens /dashboard with the switch on', async () => {
    await renderApp('/dashboard', as());
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it.each(['/dashboard', '/dashboard/meeting', '/dashboard/space'])('shows the page of a wrong link at %s with the switch off', async (path) => {
    await renderApp(path, as(without('dashboard.view')));
    expect(await missing()).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Dashboard' })).toBeNull();
  });

  it('opens the meeting view and Open space from the Dashboard with the switch on', async () => {
    await renderApp('/dashboard', as());
    expect(await screen.findByRole('button', { name: 'Meeting view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open space' })).toBeInTheDocument();
  });

  it('shows no link to the Dashboard in the Search commands with the switch off', async () => {
    await renderApp('/search', as(without('dashboard.view')));
    expect(await screen.findByRole('option', { name: 'Go to my to-dos' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Go to Dashboard' })).toBeNull();
  });

  it('shows the Search command to the Dashboard with the switch on', async () => {
    await renderApp('/search', as());
    expect(await screen.findByRole('option', { name: 'Go to Dashboard' })).toBeInTheDocument();
  });

  it('drops the link Open of a What\'s new entry that names the Dashboard, and keeps the news', async () => {
    await renderApp('/whats-new', as(without('dashboard.view')));
    expect(await screen.findByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('link', { name: /^Open/ }).length).toBeGreaterThan(0));
    expect(document.querySelector('a[href="#/dashboard?view=map"]')).toBeNull();
    expect(document.querySelector('a[href="#/dashboard/space"]')).toBeNull();
  });

  it('keeps the link Open of a What\'s new entry that names the Dashboard with the switch on', async () => {
    await renderApp('/whats-new', as());
    await waitFor(() => expect(document.querySelector('a[href="#/dashboard?view=map"]')).not.toBeNull());
  });
});

describe('Workload (workload.view)', () => {
  it('shows the Workload block on the People section with the switch on', async () => {
    await renderApp('/dashboard?view=people', as());
    expect(await screen.findByRole('heading', { name: 'Workload' })).toBeInTheDocument();
  });

  it('shows no Workload block with the switch off, and the Dashboard still opens', async () => {
    await renderApp('/dashboard?view=people', as(without('workload.view')));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByRole('heading', { name: 'Workload' })).toBeNull();
  });
});

describe('Search (search.use)', () => {
  it('shows the Search icon and opens /search with the switch on', async () => {
    await renderApp('/search', as());
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(within(await pill()).getByRole('link', { name: 'Search' })).toBeInTheDocument();
  });

  it('takes the Search icon away, on a desk and on a phone, with the switch off', async () => {
    await renderApp('/', as(without('search.use')));
    await pill();
    await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Search' })).toHaveLength(0));
    // The Notifications bell sits beside the icon and stays.
    expect(screen.getAllByRole('link', { name: /^Notifications/ }).length).toBeGreaterThan(0);
  });

  it('shows the page of a wrong link at /search with the switch off', async () => {
    await renderApp('/search', as(without('search.use')));
    expect(await missing()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Search' })).toBeNull();
  });

  it('opens Search with Ctrl+K with the switch on', async () => {
    await renderApp('/', as());
    await pill();
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Search' })).toBeInTheDocument());
    await userEvent.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(window.location.hash).toBe('#/search'));
  });

  it('does nothing on Ctrl+K with the switch off', async () => {
    await renderApp('/', as(without('search.use')));
    await pill();
    await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Search' })).toHaveLength(0));
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(window.location.hash).toBe('#/');
  });
});

describe('the Search commands (project.create, task.add)', () => {
  it('lists New project and New to-do with the switches on', async () => {
    await renderApp('/search', as());
    expect(await screen.findByRole('option', { name: 'New project' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'New to-do' })).toBeInTheDocument();
  });

  it('drops New project with project.create off', async () => {
    await renderApp('/search', as(without('project.create')));
    expect(await screen.findByRole('option', { name: 'New to-do' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'New project' })).toBeNull();
  });

  it('drops New to-do with the project to-do switches off', async () => {
    await renderApp('/search', as(without('task.add.team')));
    expect(await screen.findByRole('option', { name: 'New project' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'New to-do' })).toBeNull();
  });
});

describe('the person menu (feedback.send)', () => {
  const open = async () => {
    const buttons = await screen.findAllByRole('button', { name: /Sara/ });
    await userEvent.click(buttons[0]);
  };

  it('offers "Request a feature or report a bug" with the switch on', async () => {
    await renderApp('/', as());
    await open();
    expect(await screen.findByRole('button', { name: 'Request a feature or report a bug' })).toBeInTheDocument();
  });

  it('hides it with the switch off and keeps the other items', async () => {
    await renderApp('/', as(without('feedback.send')));
    await open();
    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a feature or report a bug' })).toBeNull();
  });
});

describe('the Message button of the person sheet (chat.direct)', () => {
  const sheetOf = async (roles?: RoleSettings) => {
    await renderApp('/search?q=Khalid', as(roles));
    await userEvent.click(await screen.findByRole('option', { name: /Khalid Al-Mutairi/ }));
    return screen.findByRole('dialog');
  };

  it('shows Message with the switch on', async () => {
    const sheet = await sheetOf();
    expect(await within(sheet).findByRole('button', { name: 'Message' })).toBeInTheDocument();
  });

  it('shows no Message with the switch off', async () => {
    const sheet = await sheetOf(without('chat.direct'));
    expect(await within(sheet).findByText('Active projects')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Message' })).toBeNull();
  });
});

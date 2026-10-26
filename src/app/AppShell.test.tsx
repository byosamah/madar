import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeVisualViewport, phoneMedia } from '../test/phoneMedia';
import { renderApp } from '../test/render';
import { without } from '../test/rr2work';

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

  it('shows the Madar mark at the top start of every screen, and a press opens Home (owner, 2026-10-04)', async () => {
    await renderApp('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    // One for a wide screen (at the top start, across from the picture) and one at the start of the phone top row.
    const marks = screen.getAllByRole('link', { name: 'Madar, Home' });
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark).toHaveAttribute('href', '#/');
      expect(mark.querySelector('[data-madar-mark]')).not.toBeNull();
    }
    await userEvent.click(marks[0]);
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page'));
  });

  it('gives the start of the phone top row on a project page to the back link, not the mark', async () => {
    await renderApp('/projects/prj_001');
    expect(await screen.findByRole('link', { name: /Projects/, current: false })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Madar, Home' })).toHaveLength(1);
  });

  it('names the mark in Arabic', async () => {
    await renderApp('/dashboard', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    expect(await screen.findAllByRole('link', { name: 'مدار، الرئيسية' })).toHaveLength(2);
  });

  // jsdom has no layout, so these tests hold the rules in the classes. A phone tab shows its icon only (owner, 2026-10-08), so its word
  // never wraps on a phone. From 640 px up the word shows on one line, and the tab is never narrower than its word (audit 2026-10-03, F-2).
  it('keeps the word of a desk tab whole on one line', async () => {
    await renderApp('/dashboard', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const nav = await screen.findByRole('navigation', { name: 'التنقل الرئيسي' });
    const tab = within(nav).getByRole('link', { name: 'لوحة المعلومات' });
    expect(tab).toHaveClass('sm:min-w-min');
    const label = within(tab).getByText('لوحة المعلومات');
    expect(label).not.toHaveClass('truncate');
    expect(label).toHaveClass('sm:whitespace-nowrap');
  });

  // The five phone tabs share the bar and can shrink, so they stay inside it at 280 px too.
  it('keeps every phone tab inside the bar on a narrow phone', async () => {
    await renderApp('/dashboard');
    const nav = await pill();
    for (const name of ['Home', 'Projects', 'Dashboard']) expect(within(nav).getByRole('link', { name })).toHaveClass('flex-1', 'min-w-0');
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

  it('opens the person menu with Preview as, the mode and the language choices, and Settings', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    expect(within(menu).getByRole('combobox', { name: /Preview as/ })).toBeInTheDocument();
    expect(within(menu).getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    expect(within(menu).getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  // jsdom has no layout, so this test holds the rule in the classes. The pixel check is a Playwright run at 390 px.
  it('starts every row of the person menu at the same edge, also a label on two lines (audit 2026-10-03, F-6)', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const menu = within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('navigation', { name: 'Hala Nasser' });
    // The language and the mode are two-part choices now (fbk_063): the rows left are Admin, Settings, What's new and the feedback button.
    const rows = [...within(menu).getAllByRole('button'), ...within(menu).getAllByRole('link')];
    expect(rows.length).toBe(4);
    for (const row of rows) expect(row).toHaveClass('text-start');
  });

  it("shows the small word New after What's new while the newest entry is not seen (fbk_018; chats-16)", async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const link = within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('link', { name: /^What's new/ });
    expect(within(link).getByText('New')).toHaveClass('text-ink-2');
    // The word is a plain word in secondary ink: no bold, no dot, no colour.
    expect(link).not.toHaveClass('font-bold');
    expect(link.querySelector('[class*="bg-"]')).toBeNull();
  });

  it("drops the word New after the person opens the page (fbk_018; chats-16)", async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('link', { name: /^What's new/ }));
    expect(await screen.findByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const link = within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('link', { name: "What's new" });
    expect(within(link).queryByText('New')).toBeNull();
  });

  it('switches between light and dark from the person menu', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await userEvent.click(await within(screen.getByRole('dialog', { name: 'Hala Nasser' })).findByRole('radio', { name: 'Light' }));
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
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('radio', { name: 'العربية' }));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(await screen.findByRole('heading', { level: 1, name: 'لوحة المعلومات' })).toBeInTheDocument();
  });

  it('gives the focus back to the person picture after the language switch (audit 2026-10-03, F-3)', async () => {
    await renderApp('/dashboard');
    const picture = (await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0];
    await userEvent.click(picture);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('radio', { name: 'العربية' }));
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
    // Item 23: the Admin's count of a project chat outside her projects holds only the messages that name her.
    expect(await within(nav).findByRole('link', { name: 'Inbox, Unread messages: 3' })).toBeInTheDocument();
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

describe('app shell on a phone', () => {
  const nav = () => screen.queryByRole('navigation', { name: 'Main navigation' });

  it('shows no bar at first paint when a push opens a chat', async () => {
    phoneMedia(true);
    await renderApp('/inbox/cnv_001');
    expect(nav()).toBeNull();
    expect(document.documentElement).toHaveAttribute('data-bar-hidden');
  });

  it('slides the bar out in a chat and back on Back, and clears the attribute', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/inbox');
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute('data-bar-hidden');
    await act(() => router.navigate('/inbox/cnv_001'));
    await waitFor(() => expect(nav()).toBeNull());
    expect(document.documentElement).toHaveAttribute('data-bar-hidden');
    await act(() => router.navigate('/inbox'));
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute('data-bar-hidden');
  });

  it('keeps the bar mounted but inert and clear while the keyboard is open', async () => {
    phoneMedia(true);
    const before = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    fakeVisualViewport({ height: 500 });
    try {
      await renderApp('/');
      const bar = await screen.findByRole('navigation', { name: 'Main navigation', hidden: true });
      expect(bar).toHaveClass('opacity-0', 'pointer-events-none');
      expect(bar).toHaveAttribute('inert');
      expect(document.documentElement).toHaveAttribute('data-bar-hidden');
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: before });
    }
  });

  it('puts the bar space in the page padding', async () => {
    phoneMedia(true);
    await renderApp('/');
    const main = document.querySelector('main')!;
    expect(main).toHaveClass('max-sm:pb-[calc(var(--phone-bar)+1.5rem)]');
    expect(main.className).not.toMatch(/\bpb-32\b/);
  });

  it('removes the attribute and brings the bar back when the window grows past 640 px in a chat', async () => {
    const media = phoneMedia(true);
    await renderApp('/inbox/cnv_001');
    expect(document.documentElement).toHaveAttribute('data-bar-hidden');
    act(() => media.set(false));
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-bar-hidden'));
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });
});

describe('the phone top row', () => {
  const inMain = () => within(screen.getByRole('main'));

  it('draws the mark and one Search icon at the top of Today, and no bell or person picture', async () => {
    phoneMedia(true);
    await renderApp('/');
    expect(await screen.findAllByRole('link', { name: 'Search the whole office' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /^Notifications/ })).toBeNull();
    // The desk menu stays in the page for a wide screen (hidden by a class). The phone menu is gone.
    expect(screen.getAllByRole('button', { name: 'Hala Nasser' })).toHaveLength(1);
    expect(inMain().getByRole('link', { name: 'Madar, Home' })).toBeInTheDocument();
  });

  it.each([['/dashboard'], ['/whats-new']])('shows the back link Me with the Me href at %s, and no mark in the phone row', async (path) => {
    phoneMedia(true);
    await renderApp(path);
    const back = await inMain().findByRole('link', { name: 'Me' });
    expect(back).toHaveAttribute('href', '#/me');
    expect(inMain().queryByRole('link', { name: 'Madar, Home' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Madar, Home' })).toHaveLength(1);
  });

  it('shows the back link Dashboard at /tasks with dashboard.view, and Me without it', async () => {
    phoneMedia(true);
    const on = await renderApp('/tasks?filter=overdue');
    expect(await inMain().findByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '#/dashboard');
    on.unmount();
    await renderApp('/tasks?filter=overdue', (state) => {
      state.session.currentUserId = 'usr_005';
      state.settings.roles = without('dashboard.view');
    });
    expect(await inMain().findByRole('link', { name: 'Me' })).toHaveAttribute('href', '#/me');
  });

  it('shows Admin at /admin/people, and the page has no second back link', async () => {
    phoneMedia(true);
    await renderApp('/admin/people');
    const links = await screen.findAllByRole('link', { name: 'Admin' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '#/admin');
  });

  it('shows the Projects back link at a project page', async () => {
    phoneMedia(true);
    await renderApp('/projects/prj_001');
    expect(await inMain().findByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });

  it('draws no top row in an open chat', async () => {
    phoneMedia(true);
    await renderApp('/inbox/cnv_001');
    expect(screen.queryByRole('link', { name: 'Search the whole office' })).toBeNull();
    expect(inMain().queryByRole('link', { name: 'Madar, Home' })).toBeNull();
  });

  it('marks the Search icon open at /search', async () => {
    phoneMedia(true);
    await renderApp('/search');
    expect(await screen.findByRole('link', { name: 'Search the whole office' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('the entrance of the screens', () => {
  const screenNode = () => document.querySelector('[data-screen]') as HTMLElement;

  it('keeps one entrance for the Work views on a phone, and starts a new one for another tab', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/work');
    await waitFor(() => expect(screenNode()).not.toBeNull());
    const first = screenNode();
    expect(first).toHaveAttribute('data-screen', '/work');
    await act(() => router.navigate('/projects'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
    expect(screenNode()).toBe(first);
    expect(screenNode()).toHaveAttribute('data-screen', '/work');
    await act(() => router.navigate('/me'));
    await waitFor(() => expect(screenNode()).toHaveAttribute('data-screen', '/me'));
    expect(screenNode()).not.toBe(first);
  });

  it('starts a new entrance between Work and Projects at desk width', async () => {
    phoneMedia(false);
    const { router } = await renderApp('/work');
    await waitFor(() => expect(screenNode()).not.toBeNull());
    const first = screenNode();
    await act(() => router.navigate('/projects'));
    await waitFor(() => expect(screenNode()).toHaveAttribute('data-screen', '/projects'));
    expect(screenNode()).not.toBe(first);
  });
});

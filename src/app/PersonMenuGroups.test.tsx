import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeLive } from '../test/fakeLive';
import { renderApp } from '../test/render';

// fbk_063 (owner, 2026-10-26): "new design this dropdown list and organize it better, make it simpler like away, mode, and the
// language". The desk person menu has two groups. Group 1 holds the three quick choices (Away, Mode, Language), each with its label
// at the start and its control at the end. Group 2 holds the places (Admin, Settings, What's new, Request a feature or report a bug).
// Sign out stands alone at the end (real build only: signOut.test.tsx).
const openMenu = async () => {
  await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
  return screen.getByRole('dialog', { name: 'Hala Nasser' });
};
const nav = (menu: HTMLElement) => within(menu).getByRole('navigation', { name: 'Hala Nasser' });

/** The names of the rows in the order they stand in the menu: the label of each quick row, then each place. */
function rowNames(menu: HTMLElement): string[] {
  const text = (row: Element) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const quick = [...nav(menu).querySelectorAll('[data-quick-row]')].map((row) => text(row.firstElementChild!));
  const places = [...nav(menu).querySelectorAll('[data-menu-group="places"] a, [data-menu-group="places"] button')].map(text);
  return [...quick, ...places];
}

describe('the person menu groups (fbk_063)', () => {
  it('keeps the header, then Away, Mode and Language, then the places, in that order', async () => {
    const live = fakeLive({ usr_001: 'online' });
    await renderApp('/dashboard', undefined, { live: live.port });
    const menu = await openMenu();
    expect(within(menu).getByText('Hala Nasser', { selector: 'span' })).toBeInTheDocument();
    expect(rowNames(menu)).toEqual(['Show me as Away', 'Mode', 'Language', 'Admin', 'Settings', "What's newNew", 'Request a feature or report a bug']);
  });

  it('draws a hairline between the header, the quick choices, the places and nothing after the last group in the prototype', async () => {
    await renderApp('/dashboard');
    const menu = await openMenu();
    const groups = nav(menu).querySelectorAll('[data-menu-group]');
    expect([...groups].map((group) => group.getAttribute('data-menu-group'))).toEqual(['quick', 'places']);
    // The second group starts under a hairline; the first group starts under the header, which has its own gap.
    expect(groups[1]).toHaveClass('border-t', 'border-hairline');
  });

  it('names the other mode on one button; a press saves the theme, keeps the menu open and names the mode back (owner, 2026-10-26)', async () => {
    const { api, store } = await renderApp('/dashboard');
    const call = vi.spyOn(api, 'call');
    const menu = await openMenu();
    const toDark = within(menu).getByRole('button', { name: 'Dark mode' });
    expect(toDark).toHaveTextContent(/^Dark$/);
    await userEvent.click(toDark);
    await waitFor(() => expect(call).toHaveBeenCalledWith('me.updatePreferences', { theme: 'dark' }, expect.anything()));
    await waitFor(() => expect(store.state.users.usr_001.preferences.theme).toBe('dark'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(screen.getByRole('dialog', { name: 'Hala Nasser' })).toBeInTheDocument();
    expect(await within(menu).findByRole('button', { name: 'Light mode' })).toHaveTextContent(/^Light$/);
  });

  it('names the other language, in that language, on one button; a press switches the language and gives the focus back to the picture', async () => {
    await renderApp('/dashboard');
    const picture = (await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0];
    await userEvent.click(picture);
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    expect(within(menu).queryByRole('button', { name: 'English' })).toBeNull();
    const toArabic = within(menu).getByRole('button', { name: 'العربية' });
    expect(toArabic).toHaveAttribute('lang', 'ar');
    await userEvent.click(toArabic);
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(screen.queryByRole('dialog', { name: 'Hala Nasser' })).toBeNull();
    expect(document.activeElement).toBe(picture);
  });

  it('gives the three quick controls one height and one end edge, and Escape gives the focus back to the picture', async () => {
    const live = fakeLive({ usr_001: 'online' });
    await renderApp('/dashboard', undefined, { live: live.port });
    const picture = (await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0];
    await userEvent.click(picture);
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    const rows = [...nav(menu).querySelectorAll<HTMLElement>('[data-quick-row]')];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveClass('flex', 'min-h-11', 'items-center', 'justify-between');
      // One box of one width at the end of each row, so the switch and the two buttons end on one edge.
      expect(row.lastElementChild).toHaveClass('w-24', 'shrink-0', 'justify-end');
    }
    expect(within(rows[0]).getByRole('switch', { name: 'Show me as Away' })).toHaveClass('h-[31px]');
    for (const name of ['Dark mode', 'العربية']) expect(within(menu).getByRole('button', { name })).toHaveClass('h-[31px]', 'w-24');
    expect(nav(menu)).toHaveClass('min-w-72');
    within(menu).getByRole('button', { name: 'Dark mode' }).focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hala Nasser' })).toBeNull());
    expect(document.activeElement).toBe(picture);
  });

  it('has no Away row on a screen with no live port', async () => {
    await renderApp('/dashboard');
    const menu = await openMenu();
    expect(within(menu).queryByRole('switch', { name: 'Show me as Away' })).toBeNull();
    expect(rowNames(menu).slice(0, 2)).toEqual(['Mode', 'Language']);
  });

  it('turns Away on from the first row and keeps the menu open', async () => {
    const live = fakeLive({ usr_001: 'online' });
    const { store } = await renderApp('/dashboard', undefined, { live: live.port });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('switch', { name: 'Show me as Away' }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.awayByHand).toBe(true));
    act(() => live.setState('usr_001', 'away'));
    expect(screen.getByRole('dialog', { name: 'Hala Nasser' })).toBeInTheDocument();
  });
});

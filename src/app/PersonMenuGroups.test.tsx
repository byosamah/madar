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

/** The names of the rows in the order they stand in the menu: a switch, a choice group, a link or a button. */
function rowNames(menu: HTMLElement): string[] {
  const rows = [...nav(menu).querySelectorAll<HTMLElement>('[role="switch"], [role="radiogroup"], a, button:not([role="radio"])')];
  const text = (row: HTMLElement) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return rows.map((row) => row.getAttribute('aria-label') ?? (row.getAttribute('role') === 'switch' ? text(document.querySelector(`label[for="${row.id}"]`) as HTMLElement) : text(row)));
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

  it('shows the Mode choice with the resolved theme selected, and a press saves the theme and keeps the menu open', async () => {
    const { api, store } = await renderApp('/dashboard');
    const call = vi.spyOn(api, 'call');
    const menu = await openMenu();
    const mode = within(menu).getByRole('radiogroup', { name: 'Mode' });
    expect(within(mode).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Light', 'Dark']);
    expect(within(mode).getByRole('radio', { name: 'Light' })).toBeChecked();
    await userEvent.click(within(mode).getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('me.updatePreferences', { theme: 'dark' }, expect.anything()));
    await waitFor(() => expect(store.state.users.usr_001.preferences.theme).toBe('dark'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    // The menu stays open, and the other part is now the checked one.
    expect(screen.getByRole('dialog', { name: 'Hala Nasser' })).toBeInTheDocument();
    await waitFor(() => expect(within(mode).getByRole('radio', { name: 'Dark' })).toBeChecked());
  });

  it('sends nothing when the checked part of Mode is pressed again', async () => {
    const { api } = await renderApp('/dashboard');
    const menu = await openMenu();
    const call = vi.spyOn(api, 'call');
    await userEvent.click(within(within(menu).getByRole('radiogroup', { name: 'Mode' })).getByRole('radio', { name: 'Light' }));
    expect(call).not.toHaveBeenCalledWith('me.updatePreferences', expect.anything(), expect.anything());
  });

  it('shows the Language choice with each language in its own language, and a press switches the language and gives the focus back to the picture', async () => {
    await renderApp('/dashboard');
    const picture = (await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0];
    await userEvent.click(picture);
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    const language = within(menu).getByRole('radiogroup', { name: 'Language' });
    expect(within(language).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['English', 'العربية']);
    expect(within(language).getByRole('radio', { name: 'English' })).toBeChecked();
    await userEvent.click(within(language).getByRole('radio', { name: 'العربية' }));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(screen.queryByRole('dialog', { name: 'Hala Nasser' })).toBeNull();
    expect(document.activeElement).toBe(picture);
  });

  it('keeps each choice as one Tab stop with the arrow keys, and Escape gives the focus back to the picture', async () => {
    await renderApp('/dashboard');
    const picture = (await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0];
    await userEvent.click(picture);
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    for (const name of ['Mode', 'Language']) {
      const radios = within(within(menu).getByRole('radiogroup', { name })).getAllByRole('radio');
      expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
      expect(radios.filter((radio) => radio.tabIndex === -1)).toHaveLength(1);
    }
    const mode = within(menu).getByRole('radiogroup', { name: 'Mode' });
    within(mode).getByRole('radio', { name: 'Light' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(mode).getByRole('radio', { name: 'Dark' })).toBeChecked());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hala Nasser' })).toBeNull());
    expect(document.activeElement).toBe(picture);
  });

  it('keeps the label at the start and the control at the end of each quick row, and no row wraps', async () => {
    const live = fakeLive({ usr_001: 'online' });
    await renderApp('/dashboard', undefined, { live: live.port });
    const menu = await openMenu();
    for (const name of ['Mode', 'Language']) {
      const group = within(menu).getByRole('radiogroup', { name });
      const row = group.closest('[data-quick-row]') as HTMLElement;
      expect(row).toHaveClass('flex', 'items-center', 'justify-between');
      expect(row.firstElementChild).toHaveTextContent(name);
      expect(group.parentElement).toHaveClass('shrink-0');
    }
    expect(nav(menu)).toHaveClass('min-w-72');
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

import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeLive } from '../../test/fakeLive';
import { renderApp } from '../../test/render';

/** The state in words in a direct chat head, and the Show me as Away switch of the person menu (chat presence design A2 and A4, F2). */
const list = async (name = 'Chats') => within(await screen.findByRole('list', { name }));
const openMenu = async (name = 'Hala Nasser') => {
  await userEvent.click((await screen.findAllByRole('button', { name }))[0]);
  return within(await screen.findByRole('dialog'));
};
const headOf = async (name: RegExp) => within((await screen.findByRole('heading', { level: 2, name })).closest('header') as HTMLElement);

describe('the state in the head of a direct chat', () => {
  it('shows Online under the name, and follows the state', async () => {
    const live = fakeLive({ usr_003: 'online' });
    await renderApp('/inbox', undefined, { live: live.port });
    await userEvent.click((await list()).getByRole('link', { name: /Reem Al-Ghamdi/ }));
    const head = await headOf(/Reem Al-Ghamdi/);
    expect(head.getByText('Online')).toBeInTheDocument();
    expect(head.queryByText('Direct message')).toBeNull();
    act(() => live.setState('usr_003', 'away'));
    expect(head.getByText('Away')).toBeInTheDocument();
    act(() => live.setState('usr_003', 'offline'));
    expect(head.getByText('Offline')).toBeInTheDocument();
  });

  it('keeps the old line when the screen has no live port', async () => {
    await renderApp('/inbox');
    await userEvent.click((await list()).getByRole('link', { name: /Reem Al-Ghamdi/ }));
    expect((await headOf(/Reem Al-Ghamdi/)).getByText('Direct message')).toBeInTheDocument();
  });

  it('shows the inactive line for a person who left, whatever the port says', async () => {
    const live = fakeLive({ usr_002: 'online' });
    await renderApp('/inbox', (state) => { state.users.usr_002.active = false; }, { live: live.port });
    await userEvent.click((await list()).getByRole('link', { name: /Faisal Al-Harbi/ }));
    const head = await headOf(/Faisal Al-Harbi/);
    expect(head.getByText('Inactive')).toBeInTheDocument();
    expect(head.queryByText('Online')).toBeNull();
  });

  it('says the state with the female form in Arabic', async () => {
    const live = fakeLive({ usr_003: 'away' });
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; }, { live: live.port });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click((await list('المحادثات')).getByRole('link', { name: /ريم الغامدي/ }));
    expect((await headOf(/ريم الغامدي/)).getByText('بعيدة عن الشاشة')).toBeInTheDocument();
    act(() => live.setState('usr_003', 'online'));
    expect((await headOf(/ريم الغامدي/)).getByText('متصلة')).toBeInTheDocument();
  });
});

describe('the person menu', () => {
  it('shows the own state under the name', async () => {
    const live = fakeLive({ usr_001: 'online' });
    await renderApp('/inbox', undefined, { live: live.port });
    const menu = await openMenu();
    expect(menu.getByText('Online')).toBeInTheDocument();
    act(() => live.setState('usr_001', 'away'));
    expect(menu.getByText('Away')).toBeInTheDocument();
  });

  it('turns Away on and off', async () => {
    const live = fakeLive({ usr_001: 'online' });
    const { api, store } = await renderApp('/inbox', undefined, { live: live.port });
    const call = vi.spyOn(api, 'call');
    const menu = await openMenu();
    const toggle = menu.getByRole('switch', { name: 'Show me as Away' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(call).toHaveBeenCalledWith('me.updatePreferences', { awayByHand: true }, expect.anything()));
    await waitFor(() => expect(store.state.users.usr_001.preferences.awayByHand).toBe(true));
    // The screen of the person sends Away to the port, so the own state is Away.
    act(() => live.setState('usr_001', 'away'));
    await waitFor(() => expect(menu.getByText('Away (set by you)')).toBeInTheDocument());
    expect(menu.getByRole('switch', { name: 'Show me as Away' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(menu.getByRole('switch', { name: 'Show me as Away' }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.awayByHand).toBeFalsy());
    act(() => live.setState('usr_001', 'online'));
    await waitFor(() => expect(menu.getByText('Online')).toBeInTheDocument());
  });

  it('has no switch on a screen with no live port', async () => {
    await renderApp('/inbox');
    const menu = await openMenu();
    expect(menu.queryByRole('switch', { name: 'Show me as Away' })).toBeNull();
  });

  it('Arabic: the female forms for Hala', async () => {
    const live = fakeLive({ usr_001: 'away' });
    await renderApp('/inbox', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      state.users.usr_001.preferences.awayByHand = true;
    }, { live: live.port });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    const menu = await openMenu('هالة ناصر');
    expect(menu.getByText('بعيدة عن الشاشة، باختيارك')).toBeInTheDocument();
    expect(menu.getByRole('switch', { name: 'أظهرني بعيدةً عن الشاشة' })).toHaveAttribute('aria-checked', 'true');
  });
});

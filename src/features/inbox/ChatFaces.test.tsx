import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeLive } from '../../test/fakeLive';
import { renderApp } from '../../test/render';

/** The status dot on the faces of the chat (chat presence design A, F1). Reem is usr_003, Faisal usr_002, Sara usr_005, Hala (the screen) usr_001. */
const sample = () => fakeLive({ usr_001: 'online', usr_003: 'online', usr_005: 'away', usr_002: 'offline' });
const list = async (name = 'Chats') => within(await screen.findByRole('list', { name }));
const dotIn = (el: HTMLElement) => el.querySelector('[data-presence]');

describe('the dots on the faces of the chat', () => {
  it('names the state in the face of a direct row, and draws the dot', async () => {
    await renderApp('/inbox', undefined, { live: sample().port });
    const row = (await list()).getByRole('link', { name: /Reem Al-Ghamdi/ });
    expect(within(row).getByRole('img', { name: 'Reem Al-Ghamdi, Online' })).toBeInTheDocument();
    expect(dotIn(row)).toHaveAttribute('data-presence', 'online');
    const faisal = (await list()).getByRole('link', { name: /Faisal Al-Harbi/ });
    expect(within(faisal).getByRole('img', { name: 'Faisal Al-Harbi, Offline' })).toBeInTheDocument();
    expect(dotIn(faisal)).toBeNull();
  });

  it('gives a group row and a project row their tile and no dot', async () => {
    await renderApp('/inbox', undefined, { live: sample().port });
    const rows = await list();
    expect(dotIn(rows.getByRole('link', { name: /Facade review/ }))).toBeNull();
    expect(dotIn(rows.getByRole('link', { name: /Corniche Office Tower/ }))).toBeNull();
  });

  it('shows the dot on the face in the head of an open direct chat', async () => {
    const live = sample();
    await renderApp('/inbox', undefined, { live: live.port });
    await userEvent.click((await list()).getByRole('link', { name: /Reem Al-Ghamdi/ }));
    const head = (await screen.findByRole('heading', { level: 2, name: /Reem Al-Ghamdi/ })).closest('header') as HTMLElement;
    expect(dotIn(head)).toHaveAttribute('data-presence', 'online');
    act(() => live.setState('usr_003', 'away'));
    expect(dotIn(head)).toHaveAttribute('data-presence', 'away');
  });

  it('shows the ring of an away person on the face next to a group message', async () => {
    await renderApp('/inbox', undefined, { live: sample().port });
    await userEvent.click((await list()).getByRole('link', { name: /Facade review/ }));
    const log = within(await screen.findByRole('log', { name: 'Messages' }));
    const message = (await log.findByText(/The louver sample arrives/)).closest('li') as HTMLElement;
    expect(within(message).getByRole('img', { name: 'Sara Al-Qahtani, Away' })).toBeInTheDocument();
    expect(dotIn(message)).toHaveAttribute('data-presence', 'away');
  });

  it('shows the own state in the person menu button', async () => {
    const live = sample();
    await renderApp('/inbox', undefined, { live: live.port });
    // The shell holds the person menu twice (the side bar and the top bar of a phone); both show the own state.
    const buttons = await screen.findAllByRole('button', { name: 'Hala Nasser' });
    await waitFor(() => expect(dotIn(buttons[0])).toHaveAttribute('data-presence', 'online'));
    act(() => live.setState('usr_001', 'away'));
    for (const button of buttons) expect(dotIn(button)).toHaveAttribute('data-presence', 'away');
  });

  it('shows the dot in the list of the New message sheet', async () => {
    await renderApp('/inbox', undefined, { live: sample().port });
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    const sheet = await screen.findByRole('dialog');
    const reem = (await within(sheet).findByText('Reem Al-Ghamdi')).closest('button') as HTMLElement;
    expect(dotIn(reem)).toHaveAttribute('data-presence', 'online');
  });

  it('shows the dot in the @ list of the message box', async () => {
    await renderApp('/inbox', undefined, { live: sample().port });
    await userEvent.click((await list()).getByRole('link', { name: /Facade review/ }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), '@Ree');
    const option = await screen.findByRole('option', { name: /Reem Al-Ghamdi/ });
    expect(dotIn(option)).toHaveAttribute('data-presence', 'online');
  });

  it('shows the dot in the People sheet of a group', async () => {
    await renderApp('/inbox', undefined, { live: sample().port });
    await userEvent.click((await list()).getByRole('link', { name: /Facade review/ }));
    await userEvent.click(await screen.findByRole('button', { name: '4 people' }));
    const sheet = await screen.findByRole('dialog');
    const sara = within(sheet).getByText('Sara Al-Qahtani').closest('li') as HTMLElement;
    expect(dotIn(sara)).toHaveAttribute('data-presence', 'away');
  });

  it('puts the dot on the end side in Arabic, on the left in a right-to-left page', async () => {
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; }, { live: sample().port });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    const row = (await list('المحادثات')).getByRole('link', { name: /ريم الغامدي/ });
    expect(within(row).getByRole('img', { name: 'ريم الغامدي، متصلة' })).toBeInTheDocument();
    const dot = dotIn(row) as HTMLElement;
    expect(dot).toHaveClass('-end-px', '-bottom-px');
    expect(dot.className).not.toMatch(/(^|\s)-?(left|right)-/);
  });
});

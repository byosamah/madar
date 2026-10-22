import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

/** The Message button of the person sheet (chat design 2026-10-19, item 18): it opens the direct chat with that person. */
const box = () => screen.findByRole('combobox');

async function openSheet(name: RegExp, query: string, group = 'People') {
  await userEvent.type(await box(), query);
  const list = await screen.findByRole('group', { name: group });
  await userEvent.click(await within(list).findByRole('option', { name }));
}

describe('the Message button of the person sheet', () => {
  it('opens the direct chat with the person, and the header names the person', async () => {
    const { store } = await renderApp('/search');
    await openSheet(/Sara Al-Qahtani/, 'sara');
    const sheet = await screen.findByRole('dialog', { name: 'Sara Al-Qahtani' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Message' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/inbox\/cnv_\d+$/));
    const chatId = window.location.hash.replace('#/inbox/', '');
    expect(store.state.conversations[chatId]).toMatchObject({ kind: 'direct', memberIds: ['usr_001', 'usr_005'] });
    expect(await screen.findByRole('heading', { level: 2, name: 'Sara Al-Qahtani' })).toBeInTheDocument();
  });

  it('shows no Message button on the sheet of the own person or of an agent', async () => {
    await renderApp('/search');
    await openSheet(/Hala Nasser/, 'hala');
    const own = await screen.findByRole('dialog', { name: 'Hala Nasser' });
    expect(within(own).queryByRole('button', { name: 'Message' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.clear(await box());
    await openSheet(/Madar Assistant/, 'assistant');
    const agent = await screen.findByRole('dialog', { name: 'Madar Assistant' });
    expect(within(agent).queryByRole('button', { name: 'Message' })).toBeNull();
  });

  it('names the button in Arabic', async () => {
    await renderApp('/search', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await openSheet(/سارة القحطاني/, 'سارة', 'الأشخاص');
    const sheet = await screen.findByRole('dialog', { name: 'سارة القحطاني' });
    expect(within(sheet).getByRole('button', { name: 'أرسل رسالة' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

describe('the Message button passes the opener (Direction D)', () => {
  it('passes state.from "/search" when the Message button opens a chat', async () => {
    const { router } = await renderApp('/search');
    await openSheet(/Sara Al-Qahtani/, 'sara');
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Sara Al-Qahtani' })).getByRole('button', { name: 'Message' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/inbox\/cnv_\d+$/));
    expect(router.state.location.state).toEqual({ from: '/search' });
  });
});

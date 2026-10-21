import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

afterEach(() => vi.restoreAllMocks());

// The useIsPhone query is true: the box takes its phone shape.
const phone = () => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
  matches: query === '(max-width: 639px)', media: query, onchange: null,
  addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
}) as MediaQueryList);
const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });

describe('the message box on a phone (design item 7)', () => {
  it('makes a new line with Enter, and sends only with the Send button', async () => {
    phone();
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'Line one{Enter}Line two');
    expect(box).toHaveValue('Line one\nLine two');
    expect(Object.values(store.state.messages).some((m) => m.body.startsWith('Line one'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'Line one\nLine two')).toBe(true));
  });
  it('does the same in Arabic', async () => {
    phone();
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    const box = await screen.findByRole('textbox', { name: 'الرسالة' });
    await userEvent.type(box, 'سطر{Enter}سطر آخر');
    expect(box).toHaveValue('سطر\nسطر آخر');
  });
});

describe('the hint in the message box (owner, 2026-10-20)', () => {
  // A project chat pushes only the people that a message names, so the short hint of a phone keeps the @ tip.
  it('is short on a phone and keeps the @ tip, so the empty box keeps one line', async () => {
    phone();
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Use @ to mention.');
  });
  it('is short on an Arabic phone too', async () => {
    phone();
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    expect(await screen.findByRole('textbox', { name: 'الرسالة' })).toHaveAttribute('placeholder', 'اكتب @ لذكر أحد.');
  });
  it('keeps the mention hint on a computer', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write a message. Type @ to mention someone.');
  });
});

describe('the Send button on a phone (chat presence, 2026-10-21)', () => {
  // The emoji button took 52 px of the row. A round Send icon on a phone gives the width back, so the empty box keeps one line.
  it('is a round icon button with the name Send on a phone', async () => {
    phone();
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const send = await screen.findByRole('button', { name: 'Send' });
    expect(send).toHaveTextContent(/^$/);
    expect(send.className).toContain('size-11');
  });
  it('keeps the word Send on a computer', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    expect(await screen.findByRole('button', { name: 'Send' })).toHaveTextContent('Send');
  });
  it('has the Arabic name on a phone', async () => {
    phone();
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    expect(await screen.findByRole('button', { name: 'أرسل' })).toHaveTextContent(/^$/);
  });
});

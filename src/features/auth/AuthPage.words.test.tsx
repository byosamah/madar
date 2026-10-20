import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

afterEach(() => {
  vi.doUnmock('../../i18n/words.ar');
});

describe('the language switch of the sign-in screens (performance audit BND-7)', () => {
  it('waits for the words of the other language, then changes the direction and the words together', async () => {
    // A fresh module set, so only the English words are there, and the Arabic words arrive when the test opens the gate.
    let open = () => undefined as void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    vi.resetModules();
    vi.doMock('../../i18n/words.ar', async () => {
      await gate;
      return vi.importActual('../../i18n/words.ar');
    });
    const words = await import('../../i18n');
    await words.loadWords('en');
    const { renderAuth } = await import('./renderAuth');
    const { fakeAuth } = await import('./fakeAuth');
    await renderAuth('/sign-in', { auth: fakeAuth({ accounts: [] }), language: 'en' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    expect(words.wordsReady('ar')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'العربية' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    // While the words load, the page stays English and left to right: no English words in the right-to-left direction.
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    expect(window.localStorage.getItem('madar.lang')).toBeNull();

    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'سجّل الدخول إلى مدار' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(window.localStorage.getItem('madar.lang')).toBe('ar');
  }, 60_000);
});

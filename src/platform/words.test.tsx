import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { API_ERROR_CODES } from '../api/errors';
import { ToastProvider } from '../app/toasts';
import { initI18n } from '../i18n';
import { ar as fullAr, en as fullEn } from '../i18n/trees';
import { createPlatformSite, createSessionStore } from './client';
import { PlatformApp } from './PlatformApp';
import { createSiteQueryClient } from './queryClient';
import { WORDS } from './words';

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, path: string[] = []): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [[[...path, key].join('.'), value] as [string, string]] : leaves(value, [...path, key])));
}
const at = (tree: Tree, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree);

describe('the words of the platform site', () => {
  it('holds the same text as the full word trees for each of its keys, in both languages', () => {
    for (const [language, full] of [['en', fullEn], ['ar', fullAr]] as const) {
      for (const [key, text] of leaves(WORDS[language])) expect(at(full as unknown as Tree, key), `${language} ${key}`).toBe(text);
      expect(leaves(WORDS[language]).length, language).toBeGreaterThan(100);
    }
  });

  it('has an Arabic key for each English key, and the other way round', () => {
    // The plural forms differ by language (English has two, Arabic has six), so the test compares the keys without the form.
    const bare = (tree: Tree) => [...new Set(leaves(tree).map(([key]) => key.replace(/_(zero|one|two|few|many|other)$/, '')))].sort();
    expect(bare(WORDS.ar)).toEqual(bare(WORDS.en));
  });

  it('leaves out the words of the screens of the companies', () => {
    for (const group of ['tasks', 'projects', 'chat', 'inbox', 'files', 'dashboard', 'taskSheet', 'tracker']) expect(Object.keys(WORDS.en), group).not.toContain(group);
  });

  it('has a sentence for each error code and for each reason that the page can show', () => {
    for (const code of API_ERROR_CODES) expect(at(WORDS.en, `errors.${code}`), code).toBeTypeOf('string');
    for (const reason of ['address_taken', 'email_taken', 'name_mismatch', 'create_closed', 'not_finished', 'account_off', 'client_outdated']) {
      expect(at(WORDS.en, `errors.reasons.${reason}`), reason).toBeTypeOf('string');
      expect(at(WORDS.ar, `errors.reasons.${reason}`), reason).toBeTypeOf('string');
    }
  });
});

describe('the site asks for no key that its words lack', () => {
  const missing = new Set<string>();
  let keep = { en: {} as object, ar: {} as object };
  const note = (_lngs: readonly string[], _ns: string, key: string) => { missing.add(key); };

  beforeAll(() => {
    initI18n('en');
    keep = { en: i18n.getResourceBundle('en', 'translation') as object, ar: i18n.getResourceBundle('ar', 'translation') as object };
    for (const language of ['en', 'ar'] as const) {
      i18n.removeResourceBundle(language, 'translation');
      i18n.addResourceBundle(language, 'translation', WORDS[language], false, true);
    }
    i18n.options.saveMissing = true;
    i18n.on('missingKey', note);
  });
  afterAll(() => {
    i18n.off('missingKey', note);
    i18n.options.saveMissing = false;
    for (const language of ['en', 'ar'] as const) {
      i18n.removeResourceBundle(language, 'translation');
      i18n.addResourceBundle(language, 'translation', keep[language], false, true);
    }
  });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const row = (o: Record<string, unknown> = {}) => ({
    id: 'ent_001', address: 'vados', name: "VADOs' Companies", nameAr: 'شركات فادو', logo: null, state: 'active', limits: { people: 5, storageBytes: 1073741824 },
    people: 15, invited: 1, storageBytes: 536870912, lastWriteAt: '2026-11-08T07:00:00.000Z', createdAt: '2026-11-08T00:00:00.000Z', firstAdmin: { name: 'Sara', email: 'sara@acme.test' }, ...o,
  });
  const METER = { day: '2026-11-08', limits: { requests: 100, rowsRead: 100, rowsWritten: 100, mails: 100 }, total: { requests: 80, rowsRead: 1, rowsWritten: 1, mails: 1 }, share: 0.1, warn: ['requests'], stop: true, enterprises: [] };

  it('hears a missing key (the listener works)', () => {
    i18n.t('platformSite.noSuchKey');
    expect(missing.has('platformSite.noSuchKey')).toBe(true);
    missing.delete('platformSite.noSuchKey');
  });

  it('shows the sign-in screen, the page, both sheets, a failed read and a toast in English and in Arabic with every key found', async () => {
    let failList = true;
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/auth/')) return json({ access_token: 'a', refresh_token: 'r', expires_in: 900, account: { id: 'pla_001', name: 'O', email: 'o@example.test' } });
      const name = (JSON.parse(String(init?.body)) as { calls: { name: string }[] }).calls[0].name;
      if (name === 'platform.enterprises.list' && failList) return json({ v: 1, serverTime: 'x', results: [{ i: 0, ok: false, error: { code: 'failed', message: 'x' } }] });
      const output = name === 'platform.me' ? { createOpen: false } : name === 'platform.meter.get' ? METER : name === 'platform.enterprises.resendInvite' ? { sentAt: 'x' } : [row(), row({ id: 'ent_002', name: 'Acme Co', nameAr: 'أكمي', address: 'acme-co', state: 'paused' }), row({ id: 'ent_003', name: 'Init', nameAr: 'بداية', address: 'init', state: 'creating' })];
      return json({ v: 1, serverTime: 'x', results: [{ i: 0, ok: true, output }] });
    }) as unknown as typeof globalThis.fetch;
    const site = createPlatformSite({ base: '/api', build: '1', fetch, store: createSessionStore(window.localStorage), withLock: async (run) => run() });
    await act(async () => { await i18n.changeLanguage('en'); });
    render(
      <QueryClientProvider client={createSiteQueryClient()}>
        <ToastProvider><PlatformApp site={site} /></ToastProvider>
      </QueryClientProvider>,
    );
    // Sign-in screen, then a failure line of each kind.
    await userEvent.type(await screen.findByLabelText('Email'), 'o@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // The list read fails first: the failed state with Retry.
    expect(await screen.findByText('The data did not load.')).toBeInTheDocument();
    failList = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: /Acme Co/ }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send the invitation again' }));
    await screen.findByText('The invitation went out again.').catch(() => undefined);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: /Init/ }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: /VADOs' Companies/ }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // The same in Arabic.
    await userEvent.click(screen.getByRole('button', { name: 'العربية' }));
    await userEvent.click(await screen.findByRole('button', { name: /أكمي/ }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'إلغاء' }));
    await userEvent.click(screen.getByRole('button', { name: 'سجّل الخروج' }));
    await screen.findByRole('heading', { level: 1, name: 'تسجيل الدخول' });
    expect([...missing]).toEqual([]);
    await act(async () => { await i18n.changeLanguage('en'); });
  });
});

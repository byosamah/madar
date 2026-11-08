import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../app/toasts';
import { initI18n } from '../i18n';
import { createPlatformSite, createSessionStore, PLATFORM_SESSION_KEY } from './client';
import { PlatformApp } from './PlatformApp';
import { createSiteQueryClient } from './queryClient';
import { PLATFORM_THEME_KEY } from './theme';
import { PLATFORM_LANGUAGE_KEY } from './words';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const ACCOUNT = { id: 'pla_001', name: 'Osama', email: 'osama@example.test' };
const row = (o: Record<string, unknown> = {}) => ({
  id: 'ent_001', address: 'vados', name: "VADOs' Companies", nameAr: 'شركات فادو', logo: null, state: 'active', limits: { people: null, storageBytes: null },
  people: 15, invited: 1, storageBytes: 536870912, lastWriteAt: '2026-11-08T07:00:00.000Z', createdAt: '2026-11-08T00:00:00.000Z', firstAdmin: null, ...o,
});
const METER = { day: '2026-11-08', limits: { requests: 100000, rowsRead: 5000000, rowsWritten: 100000, mails: 100 }, total: { requests: 10, rowsRead: 10, rowsWritten: 10, mails: 1 }, share: 0.1, warn: [], stop: false, enterprises: [] };
const wire = (output: unknown) => json({ v: 1, serverTime: 'x', results: [{ i: 0, ok: true, output }] });
const outputOf = (name: string): unknown => {
  switch (name) {
    case 'platform.me': return { createOpen: true };
    case 'platform.meter.get': return METER;
    case 'platform.enterprises.list': return [row(), row({ id: 'ent_002', address: 'acme-co', name: 'Acme Co', nameAr: 'أكمي', state: 'paused', people: 4, invited: 0 })];
    default: throw new Error(name);
  }
};

type Hit = { url: string; method: string; auth: string; body: Record<string, unknown> };
function setup(handler?: (hit: Hit) => Response | undefined, o: { stored?: boolean } = {}) {
  const hits: Hit[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const hit = { url: String(url), method: String(init?.method), auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} };
    hits.push(hit);
    const custom = handler?.(hit);
    if (custom) return custom;
    if (hit.url === '/api/platform/auth/token') return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 900, account: ACCOUNT });
    if (hit.url === '/api/platform/auth/logout') return new Response(null, { status: 204 });
    const call = (hit.body.calls as { name: string }[])[0];
    return wire(outputOf(call.name));
  }) as unknown as typeof globalThis.fetch;
  const store = createSessionStore(window.localStorage);
  if (o.stored) store.write({ access: 'stored-access', refresh: 'stored-refresh', expiresAt: Date.now() + 600_000, account: ACCOUNT });
  const site = createPlatformSite({ base: '/api', build: '1', fetch, store, withLock: async (run) => run() });
  const view = render(
    <QueryClientProvider client={createSiteQueryClient()}>
      <ToastProvider><PlatformApp site={site} /></ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, hits, site, store };
}

async function signIn(email = 'osama@example.test', password = 'a long password') {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  initI18n('en');
  void i18n.changeLanguage('en');
});

describe('the sign-in screen of the platform site', () => {
  it('is the only thing a person sees before sign-in, with no platform call', async () => {
    const t = setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Madar enterprises')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New enterprise' })).toBeNull();
    expect(t.hits).toEqual([]);
    // No link to the companies' sign-in, no forgot link, no invite: platform accounts are made from the Mac (design 12, D13).
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says the same one sentence for a wrong password, an unknown email and a company login', async () => {
    const t = setup(() => json({ error: { code: 'unauthenticated', reason: 'invalid_credentials' } }, 401));
    await signIn('hala@company.test', 'wrong password');
    expect(await screen.findByText('The email or the password is wrong.')).toBeInTheDocument();
    expect(t.hits).toHaveLength(1);
    expect(t.hits[0]).toMatchObject({ url: '/api/platform/auth/token', method: 'POST', body: { grant_type: 'password', email: 'hala@company.test', password: 'wrong password' } });
    expect(screen.getByLabelText('Password')).toBeEnabled();
  });

  it('never shows the paused text of the companies, also when the server says enterprise_paused', async () => {
    setup(() => json({ error: { code: 'forbidden', reason: 'enterprise_paused' } }, 403));
    await signIn();
    expect(await screen.findByText('The email or the password is wrong.')).toBeInTheDocument();
    expect(screen.queryByText(/paused/i)).toBeNull();
  });

  it('says "too many" for a limit, and "offline" for a network failure', async () => {
    const limited = setup(() => json({ error: { code: 'failed', message: 'x' } }, 429, { 'Retry-After': '60' }));
    await signIn();
    expect(await screen.findByText('Too many tries. Wait a few minutes. Then try again.')).toBeInTheDocument();
    limited.unmount();
    setup(() => { throw new TypeError('offline'); });
    await signIn();
    expect(await screen.findByText('The connection failed. Check it and try again.')).toBeInTheDocument();
  });

  it('keeps the button off until both fields hold text', async () => {
    setup();
    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.test');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    expect(button).toBeEnabled();
  });
});

describe('the page after sign-in', () => {
  it('loads the list and the meter with the platform token, and keeps the session in madar.platform.session', async () => {
    const t = setup();
    await signIn();
    expect(await screen.findByRole('heading', { level: 1, name: 'Madar enterprises' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /VADOs' Companies/ })).toBeInTheDocument();
    const acme = await screen.findByRole('button', { name: /Acme Co/ });
    expect(within(acme).getByText('Paused')).toBeInTheDocument();
    const platformCalls = t.hits.filter((hit) => hit.url === '/api/platform');
    expect(platformCalls.length).toBeGreaterThanOrEqual(3);
    for (const hit of platformCalls) expect(hit.auth).toBe('Bearer access-1');
    expect(JSON.parse(window.localStorage.getItem(PLATFORM_SESSION_KEY)!)).toMatchObject({ access: 'access-1', account: ACCOUNT });
    // The shell holds the sign-out button, and no sign-in form.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('opens straight on the page when a session is stored, with no sign-in call', async () => {
    const t = setup(undefined, { stored: true });
    expect(await screen.findByRole('button', { name: /VADOs' Companies/ })).toBeInTheDocument();
    expect(t.hits.some((hit) => hit.url.includes('/auth/'))).toBe(false);
    expect(t.hits.every((hit) => hit.auth === 'Bearer stored-access')).toBe(true);
  });

  it('goes back to the sign-in screen with the session ended line when the refresh is refused', async () => {
    const t = setup((hit) => (hit.url === '/api/platform/auth/token' ? json({ error: { code: 'unauthenticated', reason: 'session_ended' } }, 401) : hit.url === '/api/platform' ? json({ error: { code: 'unauthenticated', message: 'x' } }, 401) : undefined), { stored: true });
    expect(await screen.findByText('Your session ended. Sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /VADOs' Companies/ })).toBeNull();
    expect(window.localStorage.getItem(PLATFORM_SESSION_KEY)).toBeNull();
    expect(t.site.session()).toBeNull();
  });

  it('shows the account is off line for a turned-off account', async () => {
    setup((hit) => (hit.url === '/api/platform' ? json({ error: { code: 'unauthenticated', reason: 'account_off' } }, 401) : undefined), { stored: true });
    expect(await screen.findByText('This account is off.')).toBeInTheDocument();
  });

  it('signs out: posts the logout, clears the session, shows the sign-in screen, and leaves none of the answers', async () => {
    const t = setup(undefined, { stored: true });
    await screen.findByRole('button', { name: /VADOs' Companies/ });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    await waitFor(() => expect(t.hits.some((hit) => hit.url === '/api/platform/auth/logout' && hit.auth === 'Bearer stored-access')).toBe(true));
    expect(window.localStorage.getItem(PLATFORM_SESSION_KEY)).toBeNull();
    expect(screen.queryByText("VADOs' Companies")).toBeNull();
    expect(screen.queryByText('This account is off.')).toBeNull();
    expect(screen.queryByText('Your session ended. Sign in again.')).toBeNull();
  });
});

describe('the language and the theme', () => {
  it('switches to Arabic with the direction, and keeps the choice', async () => {
    setup(undefined, { stored: true });
    await screen.findByRole('button', { name: /VADOs' Companies/ });
    await userEvent.click(screen.getByRole('button', { name: /العربية/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'منشآت مدار' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(window.localStorage.getItem(PLATFORM_LANGUAGE_KEY)).toBe('ar');
    expect(screen.getByRole('button', { name: 'سجّل الخروج' })).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('says the sign-in screen in Arabic', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /العربية/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'تسجيل الدخول' })).toBeInTheDocument();
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'سجّل الدخول' })).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('switches the theme on the page and keeps the choice', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(PLATFORM_THEME_KEY)).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

const header = () => document.querySelector('header') as HTMLElement;
const brandText = () => (document.querySelector('[data-madar-brand]') as HTMLElement).textContent;

describe('the header of the site (one row on a phone)', () => {
  it('holds the brand, two icon-only buttons of 44 px with a name and a title, and Sign out, in one row with no pull to the edge', async () => {
    setup(undefined, { stored: true });
    await screen.findByRole('button', { name: /VADOs' Companies/ });
    const bar = header();
    expect(bar.className).not.toMatch(/-me-|-ms-|flex-wrap/);
    expect(bar.querySelectorAll('.flex-wrap')).toHaveLength(0);
    for (const name of ['Dark mode', /Change language to/]) {
      const button = within(bar).getByRole('button', { name });
      expect(button.className).toMatch(/\bsize-11\b/);
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
      expect(button.querySelector('.hidden')?.className).toMatch(/\bsm:inline\b/);
    }
    expect(within(bar).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(bar).getAllByRole('button')).toHaveLength(3);
  });

  it('uses one brand, Madar enterprises, on the sign-in screen and on the page, in English and in Arabic', async () => {
    setup();
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(brandText()).toBe('Madar enterprises');
    expect(header().className).not.toMatch(/-me-|flex-wrap/);
    expect(within(header()).getAllByRole('button')).toHaveLength(2);
    expect(within(header()).queryByRole('button', { name: 'Sign out' })).toBeNull();
    await userEvent.click(within(header()).getByRole('button', { name: /العربية/ }));
    await screen.findByRole('heading', { level: 1, name: 'تسجيل الدخول' });
    expect(brandText()).toBe('منشآت مدار');
    await userEvent.click(within(header()).getByRole('button', { name: /English/ }));
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('keeps the brand on the page after sign-in, in both languages', async () => {
    setup(undefined, { stored: true });
    await screen.findByRole('button', { name: /VADOs' Companies/ });
    expect(brandText()).toBe('Madar enterprises');
    await userEvent.click(within(header()).getByRole('button', { name: /العربية/ }));
    await screen.findByRole('heading', { level: 1, name: 'منشآت مدار' });
    expect(brandText()).toBe('منشآت مدار');
    expect(within(header()).getByRole('button', { name: 'سجّل الخروج' })).toBeInTheDocument();
    expect(within(header()).getByRole('button', { name: 'الوضع الداكن' }).getAttribute('title')).toBe('الوضع الداكن');
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('keeps the brand in one piece: it never wraps', async () => {
    setup();
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    const brand = document.querySelector('[data-madar-brand]') as HTMLElement;
    expect(brand.innerHTML).toMatch(/whitespace-nowrap|truncate/);
  });
});

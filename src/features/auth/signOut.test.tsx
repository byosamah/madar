import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearHomeCache, readHomeRecord, saveHomeRecord } from '../../app/remote/homeCache';
import { PUSH_TEST_ENDPOINT, pushBrowser, stopPushBrowser } from '../../test/pushBrowser';
import { renderRemoteApp, SAMPLE_ACCOUNTS } from './renderAuth';

// The remote build: the person menu has Sign out and no Preview as.
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

type App = Awaited<ReturnType<typeof renderRemoteApp>>;
const savedDrafts = () => Object.keys(window.localStorage).filter((key) => key.startsWith('madar.draft.')).map((key) => window.localStorage.getItem(key));
const chats = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const PICKED = 'Files to send';

/** Sign out from the person menu, as Hala. */
async function signOut(app: App) {
  await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
  const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
  expect(within(menu).queryByRole('combobox', { name: /Preview as/ })).toBeNull();
  await userEvent.click(within(menu).getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
  expect(app.router.state.location.search).toBe('?reason=signed_out');
}

/** Sign in as Faisal in the same tab, then open the link. */
async function signInAsFaisal(app: App, path: string) {
  await userEvent.type(screen.getByLabelText('Email'), SAMPLE_ACCOUNTS.faisal.email);
  await userEvent.type(screen.getByLabelText('Password'), SAMPLE_ACCOUNTS.faisal.password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe('/'));
  expect(app.store.state.session.currentUserId).toBe('usr_002');
  await app.router.navigate(path);
}

describe('sign out and browser push (owner, 2026-10-08)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    stopPushBrowser();
  });

  it('clears the stored Home lists of the person at a sign-out (DF-14)', async () => {
    await saveHomeRecord('auth-user-stored', { build: 'test', at: Date.now(), fingerprint: 'member||', entries: [] });
    const app = await renderRemoteApp('/');
    expect(await readHomeRecord('auth-user-stored', 5000)).not.toBeNull();
    await signOut(app);
    await waitFor(async () => expect(await readHomeRecord('auth-user-stored', 5000)).toBeNull());
    await clearHomeCache();
  });

  it('removes this device on the server while the session lives, and unsubscribes this browser, so the next person gets no push', async () => {
    const browser = pushBrowser({ permission: 'granted', subscribed: true });
    const app = await renderRemoteApp('/');
    await app.api.call('push.register', { endpoint: PUSH_TEST_ENDPOINT, label: 'Chrome on Mac' });
    expect(Object.keys(app.store.state.pushDevices ?? {})).toHaveLength(1);
    await signOut(app);
    // After the sign-out every call fails, so the row is gone only if the call went first.
    expect(app.store.state.pushDevices).toEqual({});
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
    expect(app.auth.status()).toBe('signed_out');
  });

  it('still signs out, and still unsubscribes this browser, when the server does not answer', async () => {
    const browser = pushBrowser({ permission: 'granted', subscribed: true });
    const app = await renderRemoteApp('/');
    await app.api.call('push.register', { endpoint: PUSH_TEST_ENDPOINT, label: 'Chrome on Mac' });
    const original = app.api.call.bind(app.api);
    app.api.call = ((name: string, input: unknown, meta?: unknown) => (name === 'push.remove'
      ? Promise.reject(new Error('No network.'))
      : (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta))) as typeof app.api.call;
    await signOut(app);
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
    expect(app.auth.status()).toBe('signed_out');
  });

  it('signs out as before in a browser with no push', async () => {
    pushBrowser({ none: true });
    const app = await renderRemoteApp('/');
    await signOut(app);
    expect(app.auth.status()).toBe('signed_out');
  });
});

describe('sign out from the person menu (plan 5.1, client map 7.3)', () => {
  it('ends the session, drops the lists of the person from the cache and goes to Sign in with the reason', async () => {
    const app = await renderRemoteApp('/dashboard');
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(app.queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);
    await signOut(app);
    expect(app.auth.status()).toBe('signed_out');
    expect(app.auth.log).toContain('signOut:local');
    await waitFor(() => expect(app.queryClient.getQueryCache().getAll().filter((query) => query.state.data !== undefined)).toEqual([]));
    expect(app.queryClient.getMutationCache().getAll()).toEqual([]);
    expect(screen.getByText('You signed out.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull();
  });

  it('shows the next person their own language and theme, not those of the person before', async () => {
    const app = await renderRemoteApp('/dashboard', {
      prepare: (state) => {
        state.users.usr_001.preferences = { ...state.users.usr_001.preferences, language: 'ar', theme: 'dark' };
        state.users.usr_002.preferences = { ...state.users.usr_002.preferences, language: 'en', theme: 'light' };
      },
    });
    await waitFor(() => expect(document.documentElement.lang).toBe('ar'));
    // The Arabic screen names her in Arabic (owner item 12).
    await userEvent.click((await screen.findAllByRole('button', { name: 'هالة ناصر' }))[0]);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'هالة ناصر' })).getByRole('button', { name: 'سجّل الخروج' }));
    // The sign-in screen keeps the language of the tab.
    expect(await screen.findByRole('heading', { level: 1, name: 'سجّل الدخول إلى مدار' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('البريد الإلكتروني'), SAMPLE_ACCOUNTS.faisal.email);
    await userEvent.type(screen.getByLabelText('كلمة المرور'), SAMPLE_ACCOUNTS.faisal.password);
    await userEvent.click(screen.getByRole('button', { name: 'سجّل الدخول' }));
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  // The twins of the four V-22 tests (test map 8.1): the next person in the tab now comes by sign-out and sign-in.
  it('starts the open screen again for the next person after sign-out and sign-in, so no unsent update goes over (V-22 twin)', async () => {
    const app = await renderRemoteApp('/projects/prj_001?tab=activity');
    const form = await screen.findByRole('form', { name: 'Post an update' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Post an update' }), 'Only for Hala');
    await userEvent.upload(within(form).getByLabelText('Attach files'), new File(['x'], 'Hala notes.pdf', { type: 'application/pdf' }));
    await signOut(app);
    await signInAsFaisal(app, '/projects/prj_001?tab=activity');
    const next = await screen.findByRole('form', { name: 'Post an update' });
    expect(within(next).getByRole('textbox', { name: 'Post an update' })).toHaveValue('');
    expect(within(next).queryByText('Hala notes.pdf')).toBeNull();
  }, 30000);

  it('shows the next person no half-written comment of the person before, after sign-out and sign-in (V-22 twin)', async () => {
    const TASK = '/projects/prj_001?tab=tasks&task=tsk_007&thread=1';
    const app = await renderRemoteApp(TASK);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Only for Hala');
    await signOut(app);
    expect(savedDrafts()).toEqual([]);
    await signInAsFaisal(app, TASK);
    const again = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(again).findByRole('textbox', { name: 'Add a comment' })).toHaveValue('');
  }, 30000);

  it('shows the next person no unsent words or files of the person before, after sign-out and sign-in (V-22 twin)', async () => {
    const app = await renderRemoteApp('/inbox');
    await userEvent.click((await chats()).getByRole('link', { name: /Corniche Office Tower/ }));
    const room = app.router.state.location.pathname;
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Do not tell Faisal yet');
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'Secret.pdf', { type: 'application/pdf' }));
    await signOut(app);
    expect(savedDrafts()).not.toContain('Do not tell Faisal yet');
    await signInAsFaisal(app, room);
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(screen.queryByRole('list', { name: PICKED })).toBeNull();
  }, 30000);

  it('keeps the draft of one person out of the box of another in the same tab, after sign-out and sign-in (V-22 twin)', async () => {
    let room = '';
    const app = await renderRemoteApp('/inbox', {
      prepare: (state) => {
        room = Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!.id;
      },
    });
    await userEvent.click((await chats()).getByRole('link', { name: /Faisal Al-Harbi/ }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Do not tell Faisal yet');
    await signOut(app);
    await signInAsFaisal(app, `/inbox/${room}`);
    await screen.findByRole('heading', { level: 2, name: 'Hala Nasser' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
  }, 30000);
});

import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../api/errors';
import { appRoutes } from '../../app/routes';
import { expectCalm } from './calmChecks';
import { renderRemoteApp, SAMPLE_ACCOUNTS } from './renderAuth';

const UPDATE = '/projects/prj_001?tab=activity';
const MEETING = '/dashboard/meeting?mode=projects';
const sheet = () => screen.findByRole('dialog', { name: 'Your session ended' });
const savedDrafts = () => Object.keys(window.localStorage).filter((key) => key.startsWith('madar.draft.'));

async function typeUpdate(text: string) {
  const form = await screen.findByRole('form', { name: 'Post an update' });
  await userEvent.type(within(form).getByRole('textbox', { name: 'Post an update' }), text);
}

/** Types in the first chat, whose unsent words stay in session storage. */
async function typeInChat(text: string) {
  await userEvent.click(within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name: /Corniche Office Tower/ }));
  await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), text);
  await waitFor(() => expect(savedDrafts()).not.toEqual([]));
}

async function continueWith(password: string) {
  const open = await sheet();
  await userEvent.type(within(open).getByLabelText('Password'), password);
  await userEvent.click(within(open).getByRole('button', { name: 'Continue' }));
}

describe('the sign-in gate of the remote build (plan U2, client map 7.3)', () => {
  it('sends a person with no session to Sign in, with the link to come back to', async () => {
    const { router } = await renderRemoteApp('/projects?filter=late', { signedInAs: null });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/projects?filter=late');
    await userEvent.type(screen.getByLabelText('Email'), SAMPLE_ACCOUNTS.faisal.email);
    await userEvent.type(screen.getByLabelText('Password'), SAMPLE_ACCOUNTS.faisal.password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?filter=late');
  });

  it('guards the meeting view too', async () => {
    const { router } = await renderRemoteApp(MEETING, { signedInAs: null });
    await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' });
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(MEETING);
  });

  it('opens the public screens with no session', async () => {
    for (const [path, title] of [['/sign-in', 'Sign in to Madar'], ['/welcome?token_hash=x&type=invite', 'Welcome to Madar'], ['/forgot', 'Reset your password'], ['/reset?token_hash=x&type=recovery', 'Set a new password']]) {
      const { unmount } = await renderRemoteApp(path, { signedInAs: null });
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      unmount();
    }
    expect(appRoutes(true).some((route) => route.path === '/oauth/consent')).toBe(true);
  });

  it('keeps the screen and its unsent words under the session sheet, in the shell', async () => {
    const { auth } = await renderRemoteApp(UPDATE);
    await typeUpdate('Half an update');
    act(() => auth.expire());
    const open = await sheet();
    expect(within(open).getByText(SAMPLE_ACCOUNTS.hala.email)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Post an update', hidden: true })).toHaveValue('Half an update');
    await continueWith(SAMPLE_ACCOUNTS.hala.password);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Post an update' })).toHaveValue('Half an update');
    expect(auth.status()).toBe('signed_in');
  });

  it('keeps the meeting and its typed decision under the session sheet, in the meeting view', async () => {
    const { auth } = await renderRemoteApp(MEETING);
    const decision = await screen.findByRole('textbox', { name: 'Write a decision' });
    await userEvent.type(decision, 'Half a decision');
    act(() => auth.expire());
    await sheet();
    await continueWith(SAMPLE_ACCOUNTS.hala.password);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Write a decision' })).toHaveValue('Half a decision');
  }, 30000);

  it('opens the sheet when a call says the session has ended, and loads the lists again after sign-in', async () => {
    let refuse = false;
    const { auth, queryClient } = await renderRemoteApp(UPDATE, { refuse: () => refuse });
    await typeUpdate('Kept');
    refuse = true;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['api'] }); });
    await sheet();
    expect(auth.status()).toBe('signed_in');
    refuse = false;
    await continueWith(SAMPLE_ACCOUNTS.hala.password);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Post an update' })).toHaveValue('Kept');
  });

  it('keeps the sheet shut for a late call that went with no session, from before this sign-in (test copy, 2026-10-05)', async () => {
    let refuse: false | ApiError = false;
    const { queryClient } = await renderRemoteApp(UPDATE, { refuse: () => refuse });
    await typeUpdate('Kept');
    refuse = new ApiError('unauthenticated', 'You are signed out.', { reason: 'no_session' });
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['api'] }); });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Post an update' })).toHaveValue('Kept');
  });

  it('signs out a person whose account was turned off and tells them why', async () => {
    let refuse: false | ApiError = false;
    const { auth, router, queryClient } = await renderRemoteApp(UPDATE, { refuse: () => refuse });
    await typeUpdate('Not sent');
    refuse = new ApiError('unauthenticated', 'The account is off.', { reason: 'account_off' });
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['api'] }); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(await screen.findByText('Your account is turned off. Ask the Admin.')).toHaveAttribute('role', 'status');
    expect(Object.keys(window.localStorage).filter((key) => key.startsWith('madar.draft.'))).toEqual([]);
    expect(auth.status()).toBe('signed_out');
    expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull();
  });

  it('says a wrong password in one line and keeps the sheet open', async () => {
    const { auth } = await renderRemoteApp(UPDATE);
    await typeUpdate('x');
    act(() => auth.expire());
    await continueWith('not-the-password');
    expect(await within(await sheet()).findByRole('alert')).toHaveTextContent('The password is not right.');
  });

  it('lets another person sign in from the sheet, and drops the unsent words of the person before', async () => {
    const { auth, router } = await renderRemoteApp(UPDATE);
    await typeUpdate('Only for Hala');
    act(() => auth.expire());
    await userEvent.click(within(await sheet()).getByRole('button', { name: 'Sign in as another person' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?reason=expired');
    expect(Object.keys(window.localStorage).filter((key) => key.startsWith('madar.draft.'))).toEqual([]);
  });

  it('passes the calm checks in English and in Arabic right to left', async () => {
    const english = await renderRemoteApp(UPDATE);
    await typeUpdate('x');
    act(() => english.auth.expire());
    expectCalm(await sheet(), { titleLevel: 2 });
    english.unmount();
    const arabic = await renderRemoteApp(UPDATE, { prepare: (state) => { state.users.usr_001.preferences.language = 'ar'; } });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await screen.findByRole('form', { name: 'انشر تحديثًا' });
    act(() => arabic.auth.expire());
    const open = await screen.findByRole('dialog', { name: 'انتهت جلستك' });
    expect(within(open).getByRole('button', { name: 'تابع' })).toBeInTheDocument();
    expectCalm(open, { titleLevel: 2 });
  });

  it('drops the screen, the lists and the unsent words when the person signs out on purpose in another tab', async () => {
    const { auth, router, queryClient } = await renderRemoteApp('/inbox');
    await typeInChat('Only for Hala');
    act(() => auth.otherTabSignsOut());
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?reason=signed_out');
    expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull();
    expect(screen.queryByText(SAMPLE_ACCOUNTS.hala.email)).toBeNull();
    await waitFor(() => expect(queryClient.getQueryCache().getAll().filter((query) => query.state.data !== undefined)).toEqual([]));
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
    expect(savedDrafts()).toEqual([]);
    expect(auth.log).not.toContain('signOut:local');
  });

  it('drops the lists and the unsent words of the person before when another person signs in in another tab', async () => {
    const { auth, router, queryClient } = await renderRemoteApp('/inbox');
    await typeInChat('Only for Hala');
    act(() => auth.otherTabSignsIn(SAMPLE_ACCOUNTS.faisal.email));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull();
    expect(savedDrafts()).toEqual([]);
    // What loads again is Faisal's, never Hala's.
    await waitFor(() => {
      const sessions = queryClient.getQueryCache().getAll().filter((query) => query.queryKey.includes('session.get') && query.state.data !== undefined);
      for (const query of sessions) expect((query.state.data as { user: { id: string } }).user.id).toBe('usr_002');
    });
  });

  it('saves the language of the person for the next cold start', async () => {
    window.localStorage.setItem('madar.lang', 'en');
    await renderRemoteApp(UPDATE, { prepare: (state) => { state.users.usr_001.preferences.language = 'ar'; } });
    await waitFor(() => expect(window.localStorage.getItem('madar.lang')).toBe('ar'));
  });
});

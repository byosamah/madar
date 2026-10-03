import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRemoteApp, SAMPLE_ACCOUNTS } from './renderAuth';

// The remote build: the person menu has Sign out and no Preview as.
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

type App = Awaited<ReturnType<typeof renderRemoteApp>>;
const savedDrafts = () => Object.keys(window.sessionStorage).filter((key) => key.startsWith('madar.draft.')).map((key) => window.sessionStorage.getItem(key));
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

describe('sign out from the person menu (plan 5.1, client map 7.3)', () => {
  it('ends the session, drops the lists of the person from the cache and goes to Sign in with the reason', async () => {
    const app = await renderRemoteApp('/dashboard');
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(app.queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);
    await signOut(app);
    expect(app.auth.status()).toBe('signed_out');
    expect(app.auth.log).toContain('signOut:local');
    expect(app.queryClient.getQueryCache().getAll().filter((query) => query.queryKey[1] !== 'session.get')).toEqual([]);
    expect(screen.getByText('You signed out.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('dialog', { name: 'Your session ended' })).toBeNull();
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

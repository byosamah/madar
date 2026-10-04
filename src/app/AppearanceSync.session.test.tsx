import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import { renderRemoteApp, SAMPLE_ACCOUNTS } from '../features/auth/renderAuth';

// The routes of the remote build (path links, the sign-in gate).
vi.mock('./mode', () => ({ REMOTE: true, PROTOTYPE: false }));

/** Every session.get that went to the API: a query that fetched at least once, with an answer or a refusal. */
function sessionFetches(queryClient: QueryClient): number {
  return queryClient.getQueryCache().findAll({ queryKey: ['api', 'session.get'] })
    .reduce((sum, query) => sum + query.state.dataUpdateCount + query.state.errorUpdateCount + (query.state.fetchStatus === 'idle' ? 0 : 1), 0);
}

describe('AppearanceSync and the session (TASKS.md, Wave 5 follow-ups, U)', () => {
  it('sends no session.get on the signed-out screens, so no call comes back with 401', async () => {
    for (const path of ['/sign-in', '/forgot', '/reset?token_hash=x&type=recovery', '/welcome?token_hash=x&type=invite']) {
      const view = await renderRemoteApp(path, { signedInAs: null });
      await screen.findByRole('heading', { level: 1 });
      // A refused call settles in the same task as the render, so a short wait shows it.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(sessionFetches(view.queryClient), path).toBe(0);
      view.unmount();
    }
  });

  it('applies the person\'s own language after the sign-in, as before', async () => {
    const view = await renderRemoteApp('/sign-in', {
      signedInAs: null,
      prepare: (state) => { state.users[SAMPLE_ACCOUNTS.hala.userId]!.preferences.language = 'ar'; },
    });
    await userEvent.type(await screen.findByLabelText('Email'), SAMPLE_ACCOUNTS.hala.email);
    await userEvent.type(screen.getByLabelText('Password'), SAMPLE_ACCOUNTS.hala.password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(view.queryClient.getQueryData(['api', 'session.get', {}])).toBeTruthy();
  });

  it('loads the session at once for a person who is signed in, and applies their theme', async () => {
    await renderRemoteApp('/', {
      signedInAs: 'hala',
      prepare: (state) => { state.users[SAMPLE_ACCOUNTS.hala.userId]!.preferences.theme = 'dark'; },
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });
});

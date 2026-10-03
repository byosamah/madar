import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectCalm } from './calmChecks';
import { fakeAuth } from './fakeAuth';
import { atPhoneWidth, renderAuth } from './renderAuth';

// The sample office's Faisal Al-Harbi (usr_002) has an invitation.
const FAISAL = { email: 'faisal.al.harbi@madar.test', password: 'old-unknown-pass', userId: 'usr_002' };
const invited = () => fakeAuth({ accounts: [FAISAL], links: { 'hash-invite': { type: 'invite', email: FAISAL.email }, 'hash-reset': { type: 'recovery', email: FAISAL.email } } });
const LINK = '/welcome?token_hash=hash-invite&type=invite';
const asFaisal = (auth: ReturnType<typeof invited>) => ({ auth, prepare: (state: { session: { currentUserId: string } }) => { state.session.currentUserId = 'usr_002'; } });

describe('the Welcome screen of an invitation (plan 5.1, client map 7.1)', () => {
  it('uses the link only when the person presses the button, so a mail scanner cannot use it', async () => {
    const auth = invited();
    await renderAuth(LINK, asFaisal(auth));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to Madar' })).toBeInTheDocument();
    expect(auth.log).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Accept the invitation' }));
    expect(auth.log).toEqual(['verifyLink:invite']);
  });

  it('shows the name and the email, sets the password and goes Home', async () => {
    const auth = invited();
    await renderAuth(LINK, asFaisal(auth));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
    expect(await screen.findByText('Welcome, Faisal Al-Harbi')).toBeInTheDocument();
    expect(screen.getByText('faisal.al.harbi@madar.test')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New password'), 'green-field-77');
    await userEvent.click(screen.getByRole('button', { name: 'Set the password' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
    expect(auth.current()?.password).toBe('green-field-77');
  });

  it('refuses a short password with one line under the field', async () => {
    const auth = invited();
    await renderAuth(LINK, asFaisal(auth));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
    await userEvent.type(await screen.findByLabelText('New password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Set the password' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(auth.log).not.toContain('setPassword');
  });

  it('says the link has ended when it was used before or is not an invitation', async () => {
    for (const link of [LINK, '/welcome?token_hash=hash-reset&type=invite', '/welcome?token_hash=nothing&type=invite']) {
      const auth = invited();
      if (link === LINK) await auth.verifyLink('hash-invite', 'invite');
      const { unmount } = await renderAuth(link, asFaisal(auth));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
      expect(await screen.findByText('This link has ended. Ask the Admin for a new invitation.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in');
      unmount();
    }
  });

  it('says the link has ended at once when the link has no token', async () => {
    await renderAuth('/welcome', asFaisal(invited()));
    expect(await screen.findByText('This link has ended. Ask the Admin for a new invitation.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the invitation' })).toBeNull();
  });

  it('passes the calm checks at phone width, in English and in Arabic right to left', async () => {
    atPhoneWidth();
    const english = await renderAuth(LINK, asFaisal(invited()));
    await screen.findByRole('heading', { level: 1 });
    expectCalm(english.container);
    await userEvent.click(screen.getByRole('button', { name: 'Accept the invitation' }));
    await screen.findByLabelText('New password');
    expectCalm(english.container);
    english.unmount();
    const arabic = await renderAuth(LINK, { ...asFaisal(invited()), language: 'ar' });
    expect(await screen.findByRole('heading', { level: 1, name: 'أهلًا بك في مدار' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expectCalm(arabic.container);
    await userEvent.click(screen.getByRole('button', { name: 'قبول الدعوة' }));
    expect(await screen.findByLabelText('كلمة المرور الجديدة')).toBeInTheDocument();
    expectCalm(arabic.container);
  });
});

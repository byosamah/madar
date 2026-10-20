import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectCalm } from './calmChecks';
import { fakeAuth } from './fakeAuth';
import { atPhoneWidth, renderAuth } from './renderAuth';

const HALA = { email: 'hala.nasser@madar.test', password: 'blue-river-42', userId: 'usr_001' };
const signedOut = () => fakeAuth({ accounts: [HALA, { email: 'off@madar.test', password: 'blue-river-42', userId: 'usr_009', off: true }] });

describe('the Sign in screen (plan 5.1, client map 7.1)', () => {
  it('signs in with email and password and goes to the screen of the link', async () => {
    const auth = signedOut();
    await renderAuth('/sign-in?next=%2Fprojects%3Ffilter%3Dlate', { auth });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'hala.nasser@madar.test');
    await userEvent.type(screen.getByLabelText('Password'), 'blue-river-42');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/projects?filter=late');
    expect(auth.status()).toBe('signed_in');
  });

  it('goes Home after sign-in when the next link leaves Madar or goes back to a sign-in screen', async () => {
    for (const next of ['https%3A%2F%2Fevil.test', '%2F%2Fevil.test', '%2Fsign-in']) {
      const { unmount } = await renderAuth(`/sign-in?next=${next}`, { auth: signedOut() });
      await userEvent.type(await screen.findByLabelText('Email'), 'hala.nasser@madar.test');
      await userEvent.type(screen.getByLabelText('Password'), 'blue-river-42');
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
      unmount();
    }
  });

  it('says one sentence for a wrong email and for a wrong password, so it never tells which emails exist', async () => {
    await renderAuth('/sign-in', { auth: signedOut() });
    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@madar.test');
    await userEvent.type(screen.getByLabelText('Password'), 'blue-river-42');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const wrongEmail = (await screen.findByRole('alert')).textContent;
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'hala.nasser@madar.test');
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'not-the-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByLabelText('Password')).not.toBeDisabled());
    expect(screen.getByRole('alert').textContent).toBe(wrongEmail);
    expect(wrongEmail).toBe('The email or the password is not right.');
  });

  it('tells a person whose account is off to ask the Admin', async () => {
    await renderAuth('/sign-in', { auth: signedOut() });
    await userEvent.type(await screen.findByLabelText('Email'), 'off@madar.test');
    await userEvent.type(screen.getByLabelText('Password'), 'blue-river-42');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account is turned off. Ask the Admin.');
  });

  it('shows one calm line for each reason of a sign-out', async () => {
    const lines = { signed_out: 'You signed out.', expired: 'Your session ended. Sign in again.', account_off: 'Your account is turned off. Ask the Admin.' };
    for (const [reason, line] of Object.entries(lines)) {
      const { unmount } = await renderAuth(`/sign-in?reason=${reason}`, { auth: signedOut() });
      expect(await screen.findByRole('status')).toHaveTextContent(line);
      unmount();
    }
    await renderAuth('/sign-in?reason=made_up', { auth: signedOut() });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('links to Forgot password', async () => {
    await renderAuth('/sign-in', { auth: signedOut() });
    await userEvent.click(await screen.findByRole('link', { name: 'Forgot your password?' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument();
  });

  it('passes the calm checks at phone width in English', async () => {
    atPhoneWidth();
    const { container } = await renderAuth('/sign-in?reason=signed_out', { auth: signedOut() });
    await screen.findByRole('heading', { level: 1 });
    expectCalm(container);
  });

  it('works in Arabic, right to left, with the calm checks, and switches the language without a session', async () => {
    atPhoneWidth();
    const { container } = await renderAuth('/sign-in', { auth: signedOut(), language: 'ar' });
    expect(await screen.findByRole('heading', { level: 1, name: 'سجّل الدخول إلى مدار' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveAttribute('dir', 'ltr');
    expectCalm(container);
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Madar' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
    expect(window.localStorage.getItem('madar.lang')).toBe('en');
  });
});

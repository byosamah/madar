import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthPort } from '../../app/auth';
import { AuthFailure } from './authFailure';
import { expectCalm } from './calmChecks';
import { fakeAuth } from './fakeAuth';
import { atPhoneWidth, renderAuth } from './renderAuth';

const auth = () => fakeAuth({ accounts: [{ email: 'hala.nasser@madar.test', password: 'blue-river-42', userId: 'usr_001' }] });

async function ask(email: string) {
  await userEvent.type(await screen.findByLabelText('Email'), email);
  await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
}

describe('the Forgot password screen (plan 5.1, client map 7.1)', () => {
  it('asks for a link and gives the same answer for a known and an unknown email', async () => {
    const port = auth();
    const known = await renderAuth('/forgot', { auth: port });
    await ask('hala.nasser@madar.test');
    const first = (await screen.findByRole('status')).textContent;
    known.unmount();
    await renderAuth('/forgot', { auth: port });
    await ask('nobody@madar.test');
    expect((await screen.findByRole('status')).textContent).toBe(first);
    expect(first).toBe('If this email has an account in Madar, a link is on its way. Check your email.');
    expect(port.resets).toEqual(['hala.nasser@madar.test', 'nobody@madar.test']);
    expect(screen.queryByRole('button', { name: 'Send the link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('says so when too many links were asked, and keeps the form', async () => {
    const port: AuthPort = { ...auth(), requestReset: async () => { throw new AuthFailure('too_many'); } };
    await renderAuth('/forgot', { auth: port as ReturnType<typeof auth> });
    await ask('hala.nasser@madar.test');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Wait a few minutes, then try again.');
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument();
  });

  it('passes the calm checks at phone width, in English and in Arabic right to left', async () => {
    atPhoneWidth();
    const english = await renderAuth('/forgot', { auth: auth() });
    await screen.findByRole('heading', { level: 1, name: 'Reset your password' });
    expectCalm(english.container);
    english.unmount();
    const arabic = await renderAuth('/forgot', { auth: auth(), language: 'ar' });
    expect(await screen.findByRole('heading', { level: 1, name: 'إعادة تعيين كلمة المرور' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expectCalm(arabic.container);
    await userEvent.type(screen.getByLabelText('البريد الإلكتروني'), 'hala.nasser@madar.test');
    await userEvent.click(screen.getByRole('button', { name: 'إرسال الرابط' }));
    expect(await screen.findByRole('status')).toHaveTextContent('إن كان لهذا البريد حساب في مدار');
    expectCalm(arabic.container);
  });
});

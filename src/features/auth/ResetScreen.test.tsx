import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectCalm } from './calmChecks';
import { fakeAuth } from './fakeAuth';
import { atPhoneWidth, renderAuth } from './renderAuth';

const HALA = { email: 'hala.nasser@madar.test', password: 'blue-river-42', userId: 'usr_001' };
const port = () => fakeAuth({ accounts: [HALA], links: { 'hash-reset': { type: 'recovery', email: HALA.email }, 'hash-invite': { type: 'invite', email: HALA.email } } });
const LINK = '/reset?token_hash=hash-reset&type=recovery';

async function save(password: string) {
  await userEvent.type(await screen.findByLabelText('New password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Save the password' }));
}

describe('the Reset password screen (plan 5.1, client map 7.1)', () => {
  it('uses the link only on Save, sets the password, signs out the other devices and goes Home', async () => {
    const auth = port();
    await renderAuth(LINK, { auth });
    expect(await screen.findByRole('heading', { level: 1, name: 'Set a new password' })).toBeInTheDocument();
    expect(auth.log).toEqual([]);
    await save('green-field-77');
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
    expect(auth.log).toEqual(['verifyLink:recovery', 'setPassword', 'signOut:others']);
    expect(auth.current()?.password).toBe('green-field-77');
  });

  it('refuses a short password before it uses the link', async () => {
    const auth = port();
    await renderAuth(LINK, { auth });
    await save('short');
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(auth.log).toEqual([]);
  });

  it('uses the link once when the first new password is refused', async () => {
    const auth = port();
    await renderAuth(LINK, { auth });
    await save('blue-river-42');
    expect(await screen.findByText('Use a password that is not your current one.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('New password'));
    await save('green-field-77');
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
    expect(auth.log.filter((step) => step.startsWith('verifyLink'))).toHaveLength(1);
  });

  it('says the link has ended and offers a new link', async () => {
    for (const link of ['/reset?token_hash=hash-invite&type=recovery', '/reset?token_hash=gone&type=recovery']) {
      const { unmount } = await renderAuth(link, { auth: port() });
      await save('green-field-77');
      expect(await screen.findByText('This link has ended. Ask for a new link.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute('href', '/forgot');
      unmount();
    }
    await renderAuth('/reset', { auth: port() });
    expect(await screen.findByText('This link has ended. Ask for a new link.')).toBeInTheDocument();
  });

  it('passes the calm checks at phone width, in English and in Arabic right to left', async () => {
    atPhoneWidth();
    const english = await renderAuth(LINK, { auth: port() });
    await screen.findByRole('heading', { level: 1 });
    expectCalm(english.container);
    english.unmount();
    const arabic = await renderAuth(LINK, { auth: port(), language: 'ar' });
    expect(await screen.findByRole('heading', { level: 1, name: 'عيّن كلمة مرور جديدة' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expectCalm(arabic.container);
  });
});

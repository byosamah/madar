import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
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
    // A new password ends every other session of the account, as on the Reset screen.
    expect(auth.log).toEqual(['verifyLink:invite', 'setPassword', 'signOut:others']);
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

  it('says the link has ended at once when the link has no token or a type that is not an invitation or a reset', async () => {
    for (const link of ['/welcome', '/welcome?token_hash=hash-invite&type=signup', '/welcome?token_hash=hash-invite']) {
      const { unmount } = await renderAuth(link, asFaisal(invited()));
      expect(await screen.findByText('This link has ended. Ask the Admin for a new invitation.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Accept the invitation' })).toBeNull();
      unmount();
    }
  });

  it('opens a new invitation that comes as a reset link, for a person who accepted before but set no password', async () => {
    const auth = invited();
    await renderAuth('/welcome?token_hash=hash-reset&type=recovery', asFaisal(auth));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
    expect(auth.log).toEqual(['verifyLink:recovery']);
    await userEvent.type(await screen.findByLabelText('New password'), 'green-field-77');
    await userEvent.click(screen.getByRole('button', { name: 'Set the password' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
    expect(auth.current()?.password).toBe('green-field-77');
    // A reset link opened here also sets a new password, so a login stolen before it ends on every other device.
    expect(auth.log).toEqual(['verifyLink:recovery', 'setPassword', 'signOut:others']);
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

  describe('a reset link that is out of date, sent again to a person who accepted but set no password (TASKS.md, Wave 5 follow-ups, H)', () => {
    const OLD_RESET = '/welcome?token_hash=hash-old&type=recovery';
    const panel = (root: HTMLElement) => root.querySelector('.panel') as HTMLElement;
    const ASK_ADMIN = 'This link has ended. Ask the Admin for a new invitation.';

    it('says what happened in one short sentence, with one main button to the Forgot screen, not "Ask the Admin"', async () => {
      const auth = invited();
      const view = await renderAuth(OLD_RESET, asFaisal(auth));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
      expect(await screen.findByText('This link is out of date. You can get a new one with your email.')).toBeInTheDocument();
      expect(screen.queryByText(ASK_ADMIN)).toBeNull();
      const buttons = within(panel(view.container)).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual(['Get a new link']);
      expect(buttons[0]).toHaveClass('signature');
      // A person who set a password since then also lands here: Sign in stays one quiet tap away.
      expect(within(panel(view.container)).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Back to sign in', '/sign-in']]);
      expect(auth.log).toEqual(['verifyLink:recovery']);
      expect(auth.renewals).toEqual([]);
    });

    it('opens the Forgot screen, where the person types the email and gets a new reset link', async () => {
      const auth = invited();
      await renderAuth(OLD_RESET, asFaisal(auth));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Get a new link' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Email'), FAISAL.email);
      await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
      expect(await screen.findByText('If this email has an account in Madar, a link is on its way. Check your email.')).toBeInTheDocument();
      expect(auth.resets).toEqual([FAISAL.email]);
    });

    it('opens the same state at once for a reset link with no token', async () => {
      await renderAuth('/welcome?type=recovery', asFaisal(invited()));
      expect(await screen.findByText('This link is out of date. You can get a new one with your email.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Accept the invitation' })).toBeNull();
    });

    it('keeps "Send me a new link" for an invitation link with its renew key, and "Ask the Admin" for one without', async () => {
      const renew = await renderAuth('/welcome?token_hash=hash-old&type=invite&renew=key-of-the-mail', asFaisal(invited()));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
      expect(await screen.findByRole('button', { name: 'Send me a new link' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Get a new link' })).toBeNull();
      renew.unmount();
      await renderAuth('/welcome?token_hash=hash-old&type=invite', asFaisal(invited()));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
      expect(await screen.findByText(ASK_ADMIN)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Get a new link' })).toBeNull();
    });

    it('passes the calm checks at phone width, in English and in Arabic right to left', async () => {
      atPhoneWidth();
      const english = await renderAuth('/welcome?type=recovery', asFaisal(invited()));
      await screen.findByRole('button', { name: 'Get a new link' });
      expectCalm(english.container);
      english.unmount();
      const arabic = await renderAuth('/welcome?type=recovery', { ...asFaisal(invited()), language: 'ar' });
      expect(await screen.findByText('هذا الرابط لم يعد صالحًا. يمكنك الحصول على رابط جديد ببريدك.')).toBeInTheDocument();
      expect(document.documentElement.dir).toBe('rtl');
      expect(within(panel(arabic.container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['احصل على رابط جديد']);
      expect(screen.queryByText('انتهت صلاحية هذا الرابط. اطلب دعوة جديدة من مدير النظام.')).toBeNull();
      expectCalm(arabic.container);
      await userEvent.click(screen.getByRole('button', { name: 'احصل على رابط جديد' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'إعادة تعيين كلمة المرور' })).toBeInTheDocument();
    });
  });

  describe('an invitation link that is out of date, with its renew key (security fix 7)', () => {
    const OLD = '/welcome?token_hash=hash-old&type=invite&renew=key-of-the-mail';
    const panel = (root: HTMLElement) => root.querySelector('.panel') as HTMLElement;

    it('says what happened in one short sentence, with one main button "Send me a new link" and the quiet way back to Sign in', async () => {
      const auth = invited();
      const view = await renderAuth(OLD, asFaisal(auth));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
      expect(await screen.findByText('This invitation link is out of date.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Madar' })).toBeInTheDocument();
      expect(within(panel(view.container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Send me a new link']);
      // A person who already accepted gets this state too (Auth answers otp_expired for a used token): Sign in stays one tap away.
      expect(within(panel(view.container)).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Back to sign in', '/sign-in']]);
      expect(screen.queryByText('This link has ended. Ask the Admin for a new invitation.')).toBeNull();
      // Nothing goes to Madar until the person presses the button.
      expect(auth.log).toEqual(['verifyLink:invite']);
    });

    it('sends only the key of the link, then shows a calm "Check your email" with no button and the quiet way back to Sign in', async () => {
      const auth = invited();
      const view = await renderAuth(OLD, asFaisal(auth));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Send me a new link' }));
      expect(await screen.findByText('Check your email')).toBeInTheDocument();
      expect(screen.getByText('If your invitation is still open, a new link is on its way.')).toBeInTheDocument();
      expect(auth.renewals).toEqual(['key-of-the-mail']);
      expect(within(panel(view.container)).queryAllByRole('button')).toEqual([]);
      expect(within(panel(view.container)).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Back to sign in', '/sign-in']]);
    });

    it('opens the same state at once for a link with the key but no token or no invitation type', async () => {
      for (const link of ['/welcome?renew=key-of-the-mail', '/welcome?token_hash=x&type=signup&renew=key-of-the-mail']) {
        const auth = invited();
        const { unmount } = await renderAuth(link, asFaisal(auth));
        expect(await screen.findByText('This invitation link is out of date.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Send me a new link' }));
        expect(await screen.findByText('Check your email')).toBeInTheDocument();
        expect(auth.renewals).toEqual(['key-of-the-mail']);
        unmount();
      }
    });

    it('keeps the button after a failed request and says why in one line', async () => {
      const auth = invited();
      auth.failNextRenew('offline');
      await renderAuth('/welcome?renew=key-of-the-mail', asFaisal(auth));
      await userEvent.click(await screen.findByRole('button', { name: 'Send me a new link' }));
      expect(await screen.findByText('Madar cannot connect. Check your connection, then try again.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Send me a new link' }));
      expect(await screen.findByText('Check your email')).toBeInTheDocument();
      expect(auth.renewals).toEqual(['key-of-the-mail']);
    });

    it('passes the calm checks at phone width before and after the button, in English and in Arabic right to left', async () => {
      atPhoneWidth();
      const english = await renderAuth('/welcome?renew=key-of-the-mail', asFaisal(invited()));
      await screen.findByRole('button', { name: 'Send me a new link' });
      expectCalm(english.container);
      await userEvent.click(screen.getByRole('button', { name: 'Send me a new link' }));
      await screen.findByText('Check your email');
      expectCalm(english.container);
      english.unmount();
      const arabic = await renderAuth('/welcome?renew=key-of-the-mail', { ...asFaisal(invited()), language: 'ar' });
      expect(await screen.findByText('رابط الدعوة هذا لم يعد صالحًا.')).toBeInTheDocument();
      expect(document.documentElement.dir).toBe('rtl');
      expectCalm(arabic.container);
      await userEvent.click(screen.getByRole('button', { name: 'أرسل لي رابطًا جديدًا' }));
      expect(await screen.findByText('تفقّد بريدك')).toBeInTheDocument();
      expectCalm(arabic.container);
    });
  });
});

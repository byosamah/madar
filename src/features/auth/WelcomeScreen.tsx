import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { LinkType } from '../../app/auth';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { AuthPage, FormError, QUIET_LINK } from './AuthPage';
import { failureText, MIN_PASSWORD, reasonOf } from './authFailure';
import { useAuth } from './useAuth';

type Step = 'open' | 'set' | 'ended';

// An invitation comes as an invite link. Sent again to a person who accepted it but set no password, it comes as a reset link
// (plan 5.1, users.resendInvite), and it still opens here.
const WELCOME_LINKS: readonly string[] = ['invite', 'recovery'] satisfies LinkType[];

/** The link has ended: one calm line and the way back to Sign in. */
export function LinkEnded({ text, to, label }: { text: string; to: string; label: string }) {
  return (
    <>
      <p role="alert" className="text-body text-ink">{text}</p>
      <Link to={to} className={QUIET_LINK}>{label}</Link>
    </>
  );
}

/**
 * An invitation link that is out of date, with the renew key of its mail (security fix 7; server/auth/renew.ts): one short
 * sentence and one main button. The button sends only the key, so the new link goes to the address that Madar holds, never to
 * a typed one. The server gives the same answer for every key, so the screen then says the same calm words in every case.
 * Both states keep the quiet way back to Sign in: Auth also says a used link is out of date, so a person who already accepted
 * and opens the old mail again lands here, and the server sends that person nothing.
 */
function RenewLink({ renewKey }: { renewKey: string }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setPending(true);
    setError(null);
    try {
      await auth.renewInvite(renewKey);
      setSent(true);
    } catch (failure) {
      setError(failureText(failure, t));
    }
    setPending(false);
  };

  const back = <Link to="/sign-in" className={QUIET_LINK}>{t('auth.backToSignIn')}</Link>;
  if (sent) {
    return (
      <>
        <div role="status" className="flex flex-col gap-1">
          <p className="text-headline text-ink">{t('auth.welcome.renew.sentTitle')}</p>
          <p className="text-body text-ink-2">{t('auth.welcome.renew.sentBody')}</p>
        </div>
        {back}
      </>
    );
  }
  return (
    <>
      <p role="alert" className="text-body text-ink">{t('auth.welcome.renew.body')}</p>
      <FormError text={error} />
      <Button variant="primary" className="w-full" disabled={pending} onClick={() => void send()}>{t('auth.welcome.renew.send')}</Button>
      {back}
    </>
  );
}

/**
 * A reset link that is out of date, on this screen: the invitation sent again to a person who accepted but set no password
 * (users.resendInvite) comes as a reset link with no renew key (TASKS.md, Wave 5 follow-ups, H). The Admin is not the next step:
 * one short sentence and one main button to the Forgot screen, where the person types the email and gets a new reset link.
 * The quiet way back to Sign in stays, for a person who set a password since then.
 */
function NewResetLink() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <p role="alert" className="text-body text-ink">{t('auth.welcome.recovery.body')}</p>
      <Button variant="primary" className="w-full" onClick={() => void navigate('/forgot')}>{t('auth.welcome.recovery.again')}</Button>
      <Link to="/sign-in" className={QUIET_LINK}>{t('auth.backToSignIn')}</Link>
    </>
  );
}

/**
 * The invitation link (client map 7.1), of type invite or recovery. The token is used only when the person presses the button, so a mail scanner that opens
 * the link does not use it. Then the person sees their name and email and sets a password.
 */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  // The renew key of an invitation mail (security fix 7). An older mail, or a link sent as a reset link, has none.
  const renewKey = params.get('renew');
  const linkType = type && WELCOME_LINKS.includes(type) ? (type as LinkType) : null;
  const [step, setStep] = useState<Step>(tokenHash && linkType ? 'open' : 'ended');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const user = useCall('session.get', {}, { enabled: step === 'set' }).data?.user;

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      await auth.verifyLink(tokenHash ?? '', linkType ?? 'invite');
      await queryClient.invalidateQueries({ queryKey: ['api'] });
      setStep('set');
    } catch (failure) {
      if (reasonOf(failure) === 'link_ended') setStep('ended');
      else setError(failureText(failure, t));
    }
    setPending(false);
  };

  const save = async () => {
    if (password.length < MIN_PASSWORD) {
      setFieldError(t('auth.errors.short'));
      return;
    }
    setPending(true);
    setFieldError(undefined);
    try {
      await auth.setPassword(password);
      // The new password is set. A reset link also opens here, so the other devices sign out, as on the Reset screen.
      // A failed sign-out of the other devices must not hold the person here.
      await auth.signOut({ scope: 'others' }).catch(() => undefined);
      await navigate('/', { replace: true });
    } catch (failure) {
      setFieldError(failureText(failure, t));
      setPending(false);
    }
  };

  return (
    <AuthPage title={t('auth.welcome.title')}>
      {step === 'ended' && (renewKey
        ? <RenewLink renewKey={renewKey} />
        : type === 'recovery'
          ? <NewResetLink />
          : <LinkEnded text={t('auth.welcome.ended')} to="/sign-in" label={t('auth.backToSignIn')} />)}
      {step === 'open' && (
        <>
          <p className="text-body text-ink-2">{t('auth.welcome.body')}</p>
          <FormError text={error} />
          <Button variant="primary" className="w-full" disabled={pending} onClick={() => void accept()}>{t('auth.welcome.open')}</Button>
        </>
      )}
      {step === 'set' && (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {user && (
            <div className="min-w-0">
              <p className="text-headline text-ink">{t('auth.welcome.greeting', { name: user.name })}</p>
              <p className="truncate text-footnote text-ink-2"><bdi dir="ltr">{user.email}</bdi></p>
            </div>
          )}
          <p className="text-body text-ink-2">{t('auth.welcome.setBody')}</p>
          {/* The email field helps the browser save the new password with the right account. */}
          {user && <input type="email" autoComplete="username" value={user.email} readOnly hidden />}
          <TextField id="welcome-password" type="password" dir="ltr" autoComplete="new-password" label={t('auth.newPassword')} hint={t('auth.passwordHint')} value={password} error={fieldError} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          <Button type="submit" variant="primary" className="w-full" disabled={pending || !password}>{t('auth.welcome.save')}</Button>
        </form>
      )}
    </AuthPage>
  );
}

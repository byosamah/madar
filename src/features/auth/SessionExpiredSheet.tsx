import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';
import { FormError } from './AuthPage';
import { failureText, reasonOf } from './authFailure';
import { useSignOut } from './signOut';
import { useAuth } from './useAuth';

/**
 * The session ended (client map 7.1): a sheet over the current screen. The screen stays mounted under it, so its unsent words
 * stay. The person types the password again, or signs in as another person, which drops those words. Only these two ways close
 * it: a session that has ended cannot do anything on the screen.
 */
export function SessionExpiredSheet({ open, onSignedIn }: { open: boolean; onSignedIn: () => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const signOut = useSignOut();
  // The email from the last answer of session.get. The sheet never asks again: with no session that call fails.
  const knownEmail = useCall('session.get', {}, { enabled: false }).data?.user.email;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setError(null);
  }, [open]);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await auth.signIn((knownEmail ?? email).trim(), password);
      onSignedIn();
    } catch (failure) {
      setError(reasonOf(failure) === 'wrong_credentials' ? t(knownEmail ? 'auth.errors.wrongPassword' : 'auth.errors.wrong') : failureText(failure, t));
    }
    setPending(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={() => undefined}
      keepOnOutsidePress
      title={t('auth.expired.title')}
      description={t('auth.expired.body')}
      footer={<Button type="submit" form="session-expired-form" variant="primary" disabled={pending || !password}>{t('auth.expired.submit')}</Button>}
    >
      <form
        id="session-expired-form"
        noValidate
        className="flex flex-col gap-4 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {knownEmail ? (
          <p className="truncate text-footnote text-ink-2"><bdi dir="ltr">{knownEmail}</bdi></p>
        ) : (
          <TextField id="session-email" type="email" dir="ltr" autoComplete="username" label={t('auth.email')} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} />
        )}
        {knownEmail && <input type="email" autoComplete="username" value={knownEmail} readOnly hidden />}
        <TextField id="session-password" type="password" dir="ltr" autoComplete="current-password" label={t('auth.password')} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
        <FormError text={error} />
        <Button variant="plain" className="self-start px-0" onClick={() => void signOut('expired')}>{t('auth.expired.other')}</Button>
      </form>
    </Sheet>
  );
}

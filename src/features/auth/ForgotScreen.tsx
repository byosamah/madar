import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { AuthPage, FormError, QUIET_LINK } from './AuthPage';
import { failureText } from './authFailure';
import { useAuth } from './useAuth';

/** Forgot password (client map 7.1). The answer is the same for every address, so it never tells which emails have an account. */
export function ForgotScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await auth.requestReset(email.trim());
      setSent(true);
    } catch (failure) {
      setError(failureText(failure, t));
    }
    setPending(false);
  };

  return (
    <AuthPage title={t('auth.forgot.title')}>
      {sent ? (
        <p role="status" className="text-body text-ink">{t('auth.forgot.sent')}</p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-body text-ink-2">{t('auth.forgot.body')}</p>
          <TextField id="forgot-email" type="email" dir="ltr" autoComplete="username" label={t('auth.email')} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} />
          <FormError text={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={pending || !email.trim()}>{t('auth.forgot.send')}</Button>
        </form>
      )}
      <Link to="/sign-in" className={QUIET_LINK}>{t('auth.backToSignIn')}</Link>
    </AuthPage>
  );
}

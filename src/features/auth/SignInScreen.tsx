import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { AuthPage, FormError, QUIET_LINK } from './AuthPage';
import { failureText } from './authFailure';
import { safeNext } from './paths';
import { SignedOutNote } from './SignedOutNote';
import { useAuth } from './useAuth';

/** Sign in with email and password (client map 7.1). A wrong email and a wrong password get the same one sentence. */
export function SignInScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await auth.signIn(email.trim(), password);
      // The lists that failed with no session load again for this person.
      void queryClient.invalidateQueries({ queryKey: ['api'] });
      await navigate(safeNext(params.get('next')), { replace: true });
    } catch (failure) {
      setError(failureText(failure, t));
      setPending(false);
    }
  };

  return (
    <AuthPage title={t('auth.signIn.title')}>
      <SignedOutNote reason={params.get('reason')} />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField id="sign-in-email" type="email" dir="ltr" autoComplete="username" label={t('auth.email')} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} />
        <TextField id="sign-in-password" type="password" dir="ltr" autoComplete="current-password" label={t('auth.password')} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
        <FormError text={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={pending || !email.trim() || !password}>{t('auth.signIn.submit')}</Button>
      </form>
      <Link to="/forgot" className={QUIET_LINK}>{t('auth.signIn.forgot')}</Link>
    </AuthPage>
  );
}

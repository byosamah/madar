import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { AuthPage } from './AuthPage';
import { failureText, MIN_PASSWORD, reasonOf } from './authFailure';
import { useAuth } from './useAuth';
import { LinkEnded } from './WelcomeScreen';

/**
 * The reset link (client map 7.1). The token is used only on Save, so a mail scanner that opens the link does not use it. A new
 * password signs out the other devices. A refused password keeps the session of the link, so the next try does not use it again.
 */
export function ResetScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const [ended, setEnded] = useState(!tokenHash || params.get('type') !== 'recovery');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const verified = useRef(false);

  const save = async () => {
    if (password.length < MIN_PASSWORD) {
      setFieldError(t('auth.errors.short'));
      return;
    }
    setPending(true);
    setFieldError(undefined);
    try {
      if (!verified.current) {
        await auth.verifyLink(tokenHash ?? '', 'recovery');
        verified.current = true;
      }
      await auth.setPassword(password);
      // The new password is set. A failed sign-out of the other devices must not hold the person here.
      await auth.signOut({ scope: 'others' }).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['api'] });
      await navigate('/', { replace: true });
    } catch (failure) {
      if (reasonOf(failure) === 'link_ended') setEnded(true);
      else setFieldError(failureText(failure, t));
      setPending(false);
    }
  };

  return (
    <AuthPage title={t('auth.reset.title')}>
      {ended ? (
        <LinkEnded text={t('auth.reset.ended')} to="/forgot" label={t('auth.reset.again')} />
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-body text-ink-2">{t('auth.reset.body')}</p>
          <TextField id="reset-password" type="password" dir="ltr" autoComplete="new-password" label={t('auth.newPassword')} hint={t('auth.passwordHint')} value={password} error={fieldError} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          <Button type="submit" variant="primary" className="w-full" disabled={pending || !password}>{t('auth.reset.save')}</Button>
        </form>
      )}
    </AuthPage>
  );
}

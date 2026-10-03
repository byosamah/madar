import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOTE } from '../../app/mode';
import { useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { failureText, MIN_PASSWORD, reasonOf } from '../auth/authFailure';
import { useAuth } from '../auth/useAuth';
import { SettingsSection as Section } from './Section';

/**
 * Settings, Password (plan 5.1): the current and the new password go to Auth in one change, and Auth checks the current one
 * itself (proof.md Z0a, item 2). Then the other devices of the person sign out, as after a reset: a person may change the
 * password because someone else knows it. The prototype has no sign-in, so the section shows in the real build only.
 */
export function PasswordSection() {
  return REMOTE ? <PasswordForm /> : null;
}

function PasswordForm() {
  const { t } = useTranslation();
  const auth = useAuth();
  const toast = useToast();
  const email = useCall('session.get', {}).data?.user.email;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});

  const submit = async () => {
    if (next.length < MIN_PASSWORD) {
      setErrors({ next: t('auth.errors.short') });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      await auth.changePassword(current, next);
      // The new password holds even when the other devices cannot be signed out now.
      await auth.signOut({ scope: 'others' }).catch(() => undefined);
      setCurrent('');
      setNext('');
      toast.show({ message: t('password.changed') });
    } catch (failure) {
      // A wrong current password shows under its own field; every other refusal is about the new one or the network.
      if (reasonOf(failure) === 'wrong_credentials') setErrors({ current: t('auth.errors.wrongPassword') });
      else setErrors({ next: failureText(failure, t) });
    }
    setPending(false);
  };

  return (
    <Section title={t('password.title')}>
      <form
        noValidate
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {/* The email field helps the browser save the new password with the right account. */}
        {email && <input type="email" autoComplete="username" value={email} readOnly hidden />}
        <TextField id="password-current" type="password" dir="ltr" autoComplete="current-password" label={t('password.current')} value={current} error={errors.current} disabled={pending} className="flex-1" onChange={(event) => setCurrent(event.target.value)} />
        <TextField id="password-new" type="password" dir="ltr" autoComplete="new-password" label={t('password.new')} hint={t('auth.passwordHint')} value={next} error={errors.next} disabled={pending} className="flex-1" onChange={(event) => setNext(event.target.value)} />
        {/* Settings keeps one main button at most, so this one is quiet, like Save of the profile. */}
        <Button type="submit" className="sm:mt-[1.6rem]" disabled={pending || !current || !next}>{t('password.save')}</Button>
      </form>
    </Section>
  );
}

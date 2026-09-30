import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { formatDay, weekStartOf } from '../../../lib/dates';

/** A week locks 14 days after it ends. The Admin can open it again for one person (spec 6.2 and 9). */
export function UnlockSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const users = useCall('users.list', {});
  const humans = (users.data ?? []).filter((user) => user.kind === 'human');
  const [userId, setUserId] = useState('');
  const [day, setDay] = useState('');
  const unlock = useAction('time.unlockWeek');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const person = humans.find((user) => user.id === userId);
    if (!person || !day) return;
    const weekStart = weekStartOf(day);
    unlock.mutate({ userId, weekStart }, {
      onSuccess: () => toast.show({ message: t('admin.unlocked', { week: formatDay(weekStart, lang, 'long'), name: person.name }) }),
    });
  };
  return (
    <section aria-labelledby="admin-unlock" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-unlock" className="text-headline">{t('admin.unlock')}</h2>
      <p className="text-footnote text-label-2">{t('admin.unlockHint')}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
        <SelectField id="unlock-person" label={t('admin.person')} value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="" disabled>{t('admin.person')}</option>
          {humans.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </SelectField>
        <TextField id="unlock-day" type="date" label={t('admin.week')} value={day} onChange={(event) => setDay(event.target.value)} />
        <Button variant="primary" type="submit" disabled={!userId || !day || unlock.isPending}>{t('admin.unlockButton')}</Button>
      </form>
    </section>
  );
}

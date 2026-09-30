import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';

type Form = { name: string; email: string; systemRole: 'admin' | 'member'; kind: 'human' | 'agent'; ownerId: string; discipline: string; target: string };
const EMPTY: Form = { name: '', email: '', systemRole: 'member', kind: 'human', ownerId: '', discipline: '', target: '40' };

/** Add a person or an agent, or edit a person (spec 9). The kind is set once, when the person is added (plan clarification 6). */
export function PersonFormSheet({ open, onOpenChange, person }: { open: boolean; onOpenChange: (open: boolean) => void; person: User | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const [form, setForm] = useState<Form>(EMPTY);
  useEffect(() => {
    if (!open) return;
    setForm(person
      ? { name: person.name, email: person.email, systemRole: person.systemRole, kind: person.kind, ownerId: person.ownerId ?? '', discipline: person.discipline, target: String(person.weeklyHourTarget) }
      : EMPTY);
  }, [open, person]);
  const done = (message: string) => {
    toast.show({ message });
    onOpenChange(false);
  };
  const create = useAction('users.create', { onSuccess: (user) => done(t('admin.added', { name: user.name })) });
  const update = useAction('users.update', { onSuccess: () => done(t('admin.saved')) });
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const target = Number(form.target);
  const valid = form.name.trim() && form.email.trim() && form.discipline.trim() && form.target.trim() !== '' && target >= 0 && target <= 80
    && (form.kind === 'human' || form.ownerId);
  const submit = () => {
    const common = { name: form.name.trim(), email: form.email.trim(), systemRole: form.systemRole, discipline: form.discipline.trim(), weeklyHourTarget: target };
    if (person) update.mutate({ id: person.id, patch: common });
    else create.mutate({ ...common, kind: form.kind, ownerId: form.kind === 'agent' ? form.ownerId : undefined });
  };
  const humans = (users.data ?? []).filter((user) => user.kind === 'human');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={person ? t('admin.editTitle') : t('admin.addPerson')}
      footer={<Button variant="primary" disabled={!valid || create.isPending || update.isPending} onClick={submit}>{t('admin.save')}</Button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField id="person-name" label={t('admin.name')} value={form.name} dir="auto" onChange={(event) => set('name', event.target.value)} />
        <TextField id="person-email" type="email" dir="ltr" label={t('admin.email')} value={form.email} onChange={(event) => set('email', event.target.value)} />
        <SelectField id="person-role" label={t('admin.role')} value={form.systemRole} onChange={(event) => set('systemRole', event.target.value as Form['systemRole'])}>
          <option value="member">{t('admin.roles.member')}</option>
          <option value="admin">{t('admin.roles.admin')}</option>
        </SelectField>
        {!person && (
          <SelectField id="person-kind" label={t('admin.kind')} value={form.kind} onChange={(event) => set('kind', event.target.value as Form['kind'])}>
            <option value="human">{t('admin.kinds.human')}</option>
            <option value="agent">{t('admin.kinds.agent')}</option>
          </SelectField>
        )}
        {!person && form.kind === 'agent' && (
          <SelectField id="person-owner" label={t('admin.owner')} value={form.ownerId} onChange={(event) => set('ownerId', event.target.value)}>
            <option value="" disabled>{t('admin.owner')}</option>
            {humans.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </SelectField>
        )}
        <TextField id="person-discipline" label={t('admin.discipline')} value={form.discipline} dir="auto" onChange={(event) => set('discipline', event.target.value)} />
        <TextField id="person-target" label={t('admin.target')} inputMode="numeric" value={form.target} onChange={(event) => set('target', event.target.value)} />
      </div>
    </Sheet>
  );
}

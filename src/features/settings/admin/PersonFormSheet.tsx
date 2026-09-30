import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { fieldError } from '../../../app/errors';
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
  const done = (message: string) => {
    toast.show({ message });
    onOpenChange(false);
  };
  const create = useAction('users.create', { onSuccess: (user) => done(t('admin.added', { name: user.name })) });
  const update = useAction('users.update', { onSuccess: () => done(t('admin.saved')) });
  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setForm(person
      ? { name: person.name, email: person.email, systemRole: person.systemRole, kind: person.kind, ownerId: person.ownerId ?? '', discipline: person.discipline, target: String(person.weeklyHourTarget) }
      : EMPTY);
    // The form starts fresh each time it opens; an old refusal must not stay under a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, person]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const target = Number(form.target);
  const targetOk = form.target.trim() !== '' && Number.isFinite(target) && target >= 0 && target <= 80;
  const valid = form.name.trim() && form.email.trim() && form.discipline.trim() && targetOk && (form.kind === 'human' || form.ownerId);
  // The API's refusal names its field; the message shows under that field (spec 11.6).
  const error = person ? update.error : create.error;
  const errorFor = (field: string, fallback: string) => fieldError(error, field, t, fallback);
  // An agent has no role of its own (spec 17.1), so the Role field shows for people only.
  const isAgent = person ? person.kind === 'agent' : form.kind === 'agent';
  const submit = () => {
    const common = {
      name: form.name.trim(), email: form.email.trim(), systemRole: isAgent ? 'member' as const : form.systemRole,
      discipline: form.discipline.trim(), weeklyHourTarget: target,
    };
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
        <TextField id="person-name" label={t('admin.name')} value={form.name} dir="auto" error={errorFor('name', t('admin.errors.name'))} onChange={(event) => set('name', event.target.value)} />
        <TextField id="person-email" type="email" dir="ltr" label={t('admin.email')} value={form.email} error={errorFor('email', t('admin.errors.email'))} onChange={(event) => set('email', event.target.value)} />
        {!isAgent && (
          <SelectField id="person-role" label={t('admin.role')} value={form.systemRole} error={errorFor('systemRole', t('errors.invalid_input'))} onChange={(event) => set('systemRole', event.target.value as Form['systemRole'])}>
            <option value="member">{t('admin.roles.member')}</option>
            <option value="admin">{t('admin.roles.admin')}</option>
          </SelectField>
        )}
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
        <TextField id="person-discipline" label={t('admin.discipline')} value={form.discipline} dir="auto" error={errorFor('discipline', t('admin.errors.discipline'))} onChange={(event) => set('discipline', event.target.value)} />
        <TextField
          id="person-target"
          label={t('admin.target')}
          inputMode="numeric"
          value={form.target}
          error={form.target.trim() !== '' && !targetOk ? t('admin.errors.target') : errorFor('weeklyHourTarget', t('admin.errors.target'))}
          onChange={(event) => set('target', event.target.value)}
        />
      </div>
    </Sheet>
  );
}

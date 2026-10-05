import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language, SystemRole, User } from '../../../api/contract/entities';
import { fieldError } from '../../../app/errors';
import { PROTOTYPE } from '../../../app/mode';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { requiredLabel } from '../ProfileSection';

type Form = {
  name: string; nameAr: string; email: string; systemRole: SystemRole; kind: 'human' | 'agent'; ownerId: string; discipline: string;
  gender: 'male' | 'female'; language: Language;
};
const EMPTY: Form = { name: '', nameAr: '', email: '', systemRole: 'member', kind: 'human', ownerId: '', discipline: '', gender: 'male', language: 'en' };

/**
 * Add a person or an agent, or edit a person (spec 9). The kind is set once, when the person is added (plan clarification 6).
 * A new person gets a language for the invitation email and the first sign-in, the Admin's own by default (plan A8). The real
 * build has no agent fields: an agent exists only after its person approves it (spec 12).
 * A new person needs the name in English and in Arabic (owner item 12, 2026-10-05). An edit needs the English name only, so an
 * Admin can change other fields of a person saved before the Arabic name existed. An agent has no Arabic name.
 */
export function PersonFormSheet({ open, onOpenChange, person }: { open: boolean; onOpenChange: (open: boolean) => void; person: User | null }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const toast = useToast();
  const users = useCall('users.list', {});
  const session = useCall('session.get', {}).data;
  const viewerIsAdmin = session?.authority.systemRole === 'admin';
  const viewerLanguage = session?.user.preferences.language ?? 'en';
  const [form, setForm] = useState<Form>(EMPTY);
  const done = (message: string) => {
    toast.show({ message });
    onOpenChange(false);
  };
  const create = useAction('users.create', { onSuccess: (user) => done(t('admin.added', { name: nameOf(user) })) });
  const update = useAction('users.update', { onSuccess: () => done(t('admin.saved')) });
  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setForm(person
      ? { name: person.name, nameAr: person.nameAr ?? '', email: person.email, systemRole: person.systemRole, kind: person.kind, ownerId: person.ownerId ?? '', discipline: person.discipline, gender: person.gender ?? 'male', language: person.preferences.language }
      : { ...EMPTY, language: viewerLanguage });
    // The form starts fresh each time it opens; an old refusal must not stay under a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, person]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  // An Arabic name is required for a new person only.
  const arabicNeeded = !person && form.kind === 'human';
  const valid = form.name.trim() && (!arabicNeeded || form.nameAr.trim()) && form.email.trim() && form.discipline.trim() && (form.kind === 'human' || form.ownerId);
  // The API's refusal names its field; the message shows under that field (spec 11.6).
  const error = person ? update.error : create.error;
  const errorFor = (field: string, fallback: string) => fieldError(error, field, t, fallback);
  // An agent has no role of its own (spec 17.1), so the Role field shows for people only.
  const isAgent = person ? person.kind === 'agent' : form.kind === 'agent';
  const emailLocked = person !== null && !viewerIsAdmin;
  const submit = () => {
    // An Arabic name that did not change stays out of an edit, so the History records no empty change.
    const arabic = isAgent || form.nameAr.trim() === (person?.nameAr ?? '') ? {} : { nameAr: form.nameAr.trim() };
    const common = {
      name: form.name.trim(), ...arabic, email: form.email.trim(), systemRole: isAgent ? 'member' as const : form.systemRole,
      discipline: form.discipline.trim(), ...(isAgent ? {} : { gender: form.gender }),
    };
    if (person) update.mutate({ id: person.id, patch: common });
    else {
      // users.create takes `language` from track A (A8). Until then the contract drops the extra field, so the input goes as a value.
      const input = { ...common, kind: form.kind, ownerId: form.kind === 'agent' ? form.ownerId : undefined, ...(form.kind === 'agent' ? {} : { language: form.language }) };
      create.mutate(input);
    }
  };
  const humans = (users.data ?? []).filter((user) => user.kind === 'human').sort(byName);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={person ? t('admin.editTitle') : t('admin.addPerson')}
      footer={<Button variant="primary" disabled={!valid || create.isPending || update.isPending} onClick={submit}>{t('admin.save')}</Button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField
          id="person-name" label={requiredLabel(t('profile.nameEn'))} aria-required value={form.name} dir="auto"
          error={errorFor('name', t('admin.errors.name'))} onChange={(event) => set('name', event.target.value)}
        />
        {!isAgent && (
          <TextField
            id="person-name-ar" label={arabicNeeded ? requiredLabel(t('profile.nameAr')) : t('profile.nameAr')} aria-required={arabicNeeded || undefined}
            value={form.nameAr} dir="auto" lang="ar" error={errorFor('nameAr', t('profile.errors.nameAr'))} onChange={(event) => set('nameAr', event.target.value)}
          />
        )}
        {/* The sign-in email is the key to the account, so only an Admin changes it (security review of P2). The API refuses it too. */}
        <TextField
          id="person-email" type="email" dir="ltr" label={t('admin.email')} value={form.email} readOnly={emailLocked}
          hint={emailLocked ? t('admin.emailAdminOnly') : undefined} error={errorFor('email', t('admin.errors.email'))}
          onChange={(event) => set('email', event.target.value)}
        />
        {!isAgent && (
          <SelectField id="person-role" label={t('admin.role')} value={form.systemRole} error={errorFor('systemRole', t('errors.invalid_input'))} onChange={(event) => set('systemRole', event.target.value as Form['systemRole'])}>
            <option value="member">{t('admin.roles.member')}</option>
            <option value="management">{t('admin.roles.management')}</option>
            <option value="accounting">{t('admin.roles.accounting')}</option>
            {/* Only an Admin makes an Admin. The API refuses it for Management too. */}
            {viewerIsAdmin && <option value="admin">{t('admin.roles.admin')}</option>}
          </SelectField>
        )}
        {/* Only an Admin adds an agent, so the Kind field shows to the Admin only (audit 2026-10-03, SHL-9). */}
        {PROTOTYPE && !person && viewerIsAdmin && (
          <SelectField id="person-kind" label={t('admin.kind')} value={form.kind} onChange={(event) => set('kind', event.target.value as Form['kind'])}>
            <option value="human">{t('admin.kinds.human')}</option>
            <option value="agent">{t('admin.kinds.agent')}</option>
          </SelectField>
        )}
        {PROTOTYPE && !person && form.kind === 'agent' && (
          <SelectField id="person-owner" label={t('admin.owner')} value={form.ownerId} onChange={(event) => set('ownerId', event.target.value)}>
            <option value="" disabled>{t('admin.owner')}</option>
            {humans.map((user) => <option key={user.id} value={user.id}>{nameOf(user)}</option>)}
          </SelectField>
        )}
        {!isAgent && (
          // Arabic verbs after a person's name agree with them; this picks the form (lib/grammar).
          <SelectField id="person-gender" label={t('admin.gender')} value={form.gender} onChange={(event) => set('gender', event.target.value as Form['gender'])}>
            <option value="male">{t('admin.genders.male')}</option>
            <option value="female">{t('admin.genders.female')}</option>
          </SelectField>
        )}
        {/* The language of the invitation email and the first sign-in; after that the person chooses in Settings. */}
        {!person && !isAgent && (
          <SelectField id="person-language" label={t('settings.language')} hint={t('people.languageHint')} value={form.language} onChange={(event) => set('language', event.target.value as Language)}>
            <option value="en">{t('settings.languages.en')}</option>
            <option value="ar">{t('settings.languages.ar')}</option>
          </SelectField>
        )}
        <TextField id="person-discipline" label={t('admin.discipline')} value={form.discipline} dir="auto" error={errorFor('discipline', t('admin.errors.discipline'))} onChange={(event) => set('discipline', event.target.value)} />
      </div>
    </Sheet>
  );
}

import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { TextField } from '../../components/Fields';
import { clientName } from '../../lib/clientName';
import { normalizeInitials } from '../../lib/projectCode';
import { otherWithInitials, validateClientDraft, type ClientDraft, type ClientErrors } from './clientRules';

const FIELDS: (keyof ClientErrors)[] = ['name', 'initials', 'email'];

/**
 * The client form state. A message shows after the person leaves its field, or for every field after a press on Add or Save
 * (owner, 2026-10-05, item 1). "initialsOptional" lets an old client without initials keep none.
 */
export function useClientForm(initial: ClientDraft, options: { initialsOptional?: boolean } = {}) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const all = validateClientDraft(values, options);
  const errors = Object.fromEntries(Object.entries(all).filter(([field]) => touched.has(field))) as ClientErrors;
  return {
    values,
    errors,
    set<K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) {
      setValues((current) => ({ ...current, [key]: value }));
    },
    touch(field: keyof ClientErrors) {
      setTouched((current) => new Set(current).add(field));
    },
    /** Shows every message. True when the client can go. */
    check(): boolean {
      setTouched(new Set(FIELDS));
      return Object.keys(all).length === 0;
    },
    reset(next: ClientDraft) {
      setValues(next);
      setTouched(new Set());
    },
  };
}
export type ClientFormState = ReturnType<typeof useClientForm>;

/**
 * The one client form (owner, 2026-10-05): in the new-project form and in the Admin Clients section. The fields: the English
 * and the Arabic name (one of the two is enough), the initials of the project code, the contact person (or "Same as the
 * client"), the phone and the email. The parent places the Add or Save button. Enter in a field runs "onEnter".
 */
export function ClientForm({ form, idPrefix, clients, selfId = null, onEnter }: {
  form: ClientFormState; idPrefix: string; clients: Client[]; selfId?: string | null; onEnter?: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const { values, errors, set, touch } = form;
  const named = clientName({ name: values.name.trim(), nameAr: values.nameAr.trim() }, lang);
  const twin = errors.initials ? undefined : otherWithInitials(values.initials, clients, selfId);
  const message = (field: keyof ClientErrors) => (errors[field] ? t(errors[field] as string) : undefined);
  const text = (key: 'name' | 'nameAr' | 'contactName' | 'phone' | 'email') => ({
    value: values[key],
    onChange: (event: { target: { value: string } }) => set(key, event.target.value),
  });
  const enter = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter in a client field runs the form's own action. It must not send a form that holds these fields (audit PER-7).
    const target = event.target as HTMLInputElement;
    if (event.key !== 'Enter' || target.tagName !== 'INPUT' || target.type === 'checkbox' || !onEnter) return;
    event.preventDefault();
    onEnter();
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2" onKeyDown={enter}>
      <TextField
        id={`${idPrefix}-name`} label={t('clientForm.nameEn')} required dir="ltr" autoComplete="off" {...text('name')}
        onBlur={() => touch('name')} error={message('name')}
      />
      <TextField
        id={`${idPrefix}-name-ar`} label={t('clientForm.nameAr')} required dir="rtl" lang="ar" autoComplete="off" {...text('nameAr')}
        onBlur={() => touch('name')} aria-invalid={errors.name ? true : undefined}
      />
      <div className="flex flex-col gap-1.5">
        <TextField
          id={`${idPrefix}-initials`} label={t('clientForm.initials')} required dir="ltr" maxLength={4} autoComplete="off" autoCapitalize="characters"
          hint={t('clientForm.initialsHint', { example: 'AZT' })} value={values.initials}
          onChange={(event) => set('initials', normalizeInitials(event.target.value))} onBlur={() => touch('initials')} error={message('initials')}
        />
        {twin && <p role="status" className="text-footnote text-attn">{t('clientForm.sameInitials', { name: clientName(twin, lang) })}</p>}
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <TextField
          id={`${idPrefix}-contact`} label={t('projectForm.contactName')} dir="auto" disabled={values.same}
          {...(values.same ? { value: named, onChange: () => undefined } : text('contactName'))}
        />
        <label className="flex min-h-11 items-center gap-3 self-start rounded-xl px-2 hover:bg-fill">
          <input type="checkbox" className="size-5 shrink-0 accent-[var(--c-accent-fill)]" checked={values.same} onChange={(event) => set('same', event.target.checked)} />
          <span className="text-subheadline text-ink">{t('projectForm.sameAsClient')}</span>
        </label>
      </div>
      <TextField id={`${idPrefix}-phone`} type="tel" dir="ltr" label={t('projectForm.phone')} {...text('phone')} />
      <TextField
        id={`${idPrefix}-email`} type="email" dir="ltr" label={t('projectForm.email')} {...text('email')}
        onBlur={() => touch('email')} error={message('email')}
      />
    </div>
  );
}

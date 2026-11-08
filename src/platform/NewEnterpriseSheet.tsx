import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, fieldError } from '../app/errors';
import { useToast } from '../app/toasts';
import { Button } from '../components/Button';
import { SelectField, TextField } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { FormError } from '../components/FormError';
import { bytesOfGb, peopleOf } from '../features/enterprises/limits';
import { LogoPicker } from '../features/enterprises/LogoPicker';
import { usePlatform } from './usePlatform';
import type { EnterpriseView } from '../api/contract/platform';

/** The address name as the rule says: lower case letters, digits and hyphens. A typed capital becomes a small letter. */
const addressOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9-]/g, '');

type Draft = { name: string; nameAr: string; address: string; logo: string | null; people: string; storage: string; adminName: string; adminEmail: string; language: 'en' | 'ar' };
const EMPTY: Draft = { name: '', nameAr: '', address: '', logo: null, people: '', storage: '', adminName: '', adminEmail: '', language: 'en' };

/** The draft of a row that did not finish (state creating): the page fills the sheet from the row, and the owner presses Create again. */
const draftOf = (row: EnterpriseView): Draft => ({
  ...EMPTY, name: row.name, nameAr: row.nameAr, address: row.address, logo: row.logo,
  people: row.limits.people === null ? '' : String(row.limits.people), storage: row.limits.storageBytes === null ? '' : String(Math.round((row.limits.storageBytes / 1024 ** 3) * 100) / 100),
  adminName: row.firstAdmin?.name ?? '', adminEmail: row.firstAdmin?.email ?? '',
});

/**
 * The sheet "New enterprise": the name in two languages, the address name, the logo, the two limits and the first Admin. One next step: Create.
 * A refused address name or email shows under its own field. From a row that did not finish, the same sheet opens filled (Try again).
 */
export function NewEnterpriseSheet({ open, onOpenChange, from }: { open: boolean; onOpenChange: (open: boolean) => void; from?: EnterpriseView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((was) => ({ ...was, [key]: value }));
  const create = useMutation({
    mutationFn: (input: Parameters<typeof platform['platform.enterprises.create']>[0]) => platform['platform.enterprises.create'](input),
    onSuccess: async (row) => {
      toast.show({ message: t('enterprises.created', { email: row.firstAdmin?.email ?? '' }) });
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
      onOpenChange(false);
    },
  });
  useEffect(() => {
    if (!open) return;
    create.reset();
    setProblem(null);
    setDraft(from ? draftOf(from) : EMPTY);
    // The form starts fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from]);

  const submit = () => {
    const people = peopleOf(draft.people);
    const storageBytes = bytesOfGb(draft.storage);
    if (people === undefined || storageBytes === undefined) {
      setProblem(t('enterprises.limitHint'));
      return;
    }
    setProblem(null);
    create.mutate({
      name: draft.name.trim(), nameAr: draft.nameAr.trim(), address: draft.address, logo: draft.logo, limits: { people, storageBytes },
      admin: { name: draft.adminName.trim(), email: draft.adminEmail.trim(), language: draft.language },
    });
  };
  // The text of a refusal that names a field but holds no reason of its own: the general text of the error.
  const generic = create.error ? errorMessage(create.error, t) : '';
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('enterprises.new')}
      tall
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={create.isPending} onClick={submit}>{t('enterprises.create')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField id="ent-name" label={t('enterprises.field.name')} value={draft.name} dir="auto" maxLength={80} required autoComplete="off" onChange={(event) => set('name', event.target.value)} error={fieldError(create.error, 'name', t, generic)} />
        <TextField id="ent-name-ar" label={t('enterprises.field.nameAr')} value={draft.nameAr} dir="auto" maxLength={80} required autoComplete="off" onChange={(event) => set('nameAr', event.target.value)} error={fieldError(create.error, 'nameAr', t, generic)} />
        <TextField
          id="ent-address" label={t('enterprises.field.address')} hint={t('enterprises.addressHint')} value={draft.address} dir="ltr" maxLength={32} required autoComplete="off" autoCapitalize="none"
          onChange={(event) => set('address', addressOf(event.target.value))} error={fieldError(create.error, 'address', t, generic)}
        />
        <LogoPicker id="ent-logo" label={t('enterprises.field.logo')} value={draft.logo} onChange={(logo) => set('logo', logo)} />
        <TextField id="ent-people" label={t('enterprises.field.people')} hint={t('enterprises.limitHint')} value={draft.people} inputMode="numeric" dir="ltr" onChange={(event) => set('people', event.target.value)} />
        <TextField id="ent-storage" label={t('enterprises.field.storage')} hint={t('enterprises.limitHint')} value={draft.storage} inputMode="decimal" dir="ltr" onChange={(event) => set('storage', event.target.value)} />
        <TextField id="ent-admin-name" label={t('enterprises.field.adminName')} value={draft.adminName} dir="auto" maxLength={80} required autoComplete="off" onChange={(event) => set('adminName', event.target.value)} error={fieldError(create.error, 'admin.name', t, generic)} />
        <TextField id="ent-admin-email" label={t('enterprises.field.adminEmail')} type="email" value={draft.adminEmail} dir="ltr" required autoComplete="off" onChange={(event) => set('adminEmail', event.target.value)} error={fieldError(create.error, 'admin.email', t, generic)} />
        <SelectField id="ent-admin-language" label={t('enterprises.field.adminLanguage')} value={draft.language} onChange={(event) => set('language', event.target.value as 'en' | 'ar')}>
          <option value="en">{t('enterprises.language.en')}</option>
          <option value="ar">{t('enterprises.language.ar')}</option>
        </SelectField>
        <FormError text={problem} />
        {create.isError && !['name', 'nameAr', 'address', 'admin.name', 'admin.email'].some((field) => fieldError(create.error, field, t, generic)) && <FormError text={generic} />}
      </div>
    </Sheet>
  );
}


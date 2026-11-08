import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_STALE_DAYS, type Settings } from '../../../api/contract/entities';
import type { CallOutput } from '../../../api/calls';
import { fieldError } from '../../../app/errors';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { Switch } from '../../../components/Switch';
import { coversLock, officeWorkHoursOf, type WorkLock, type WorkRange } from '../../../lib/quietHours';
import { FormError } from '../../auth/AuthPage';
import { StageList } from '../../projects/ProjectFields';
import { WorkRangeFields } from '../WorkRangeFields';
import { widenToLock } from '../workRange';
import { LogoPicker } from '../../enterprises/LogoPicker';
import { gbOne } from '../../enterprises/limits';
import { AdminPanel } from './AdminPanel';

type Problems = { stages?: string; limit?: string; stale?: string; workHours?: string };

type Usage = NonNullable<CallOutput<'settings.get'>['usage']>;

/**
 * The people and the storage of the enterprise against their limits, read only (design 5.9). Only the Madar team changes the limits. The
 * lines show only when the server gave the numbers (the real build, for a person who holds the settings switch).
 */
function UsageLines({ usage }: { usage: Usage }) {
  const { t } = useTranslation();
  const { people, storage } = usage;
  return (
    <div className="flex flex-col gap-1" data-usage>
      <p className="text-subheadline text-ink">
        {people.limit === null ? t('admin.usage.peopleOnly', { used: people.used }) : t('admin.usage.people', { used: people.used, limit: people.limit })}
        {people.limit === null && <span className="text-ink-2"> · {t('admin.usage.noLimit')}</span>}
      </p>
      <p className="text-subheadline text-ink">
        {storage.limit === null
          ? t('admin.usage.storageOnly', { used: gbOne(storage.used) })
          : t('admin.usage.storage', { used: gbOne(storage.used), limit: t('admin.usage.gb', { n: gbOne(storage.limit) }) })}
        {storage.limit === null && <span className="text-ink-2"> · {t('admin.usage.noLimit')}</span>}
      </p>
      <p className="text-footnote text-ink-2">{t('admin.usage.readOnly')}</p>
    </div>
  );
}

/** The form starts from the saved settings once. A refresh of the settings never replaces what the Admin typed. */
function OfficeForm({ saved, usage }: { saved: Settings; usage?: Usage }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [stages, setStages] = useState(() => saved.defaultStages.map((name) => ({ name })));
  const [limit, setLimit] = useState(String(saved.workloadLimit));
  const [stale, setStale] = useState(String(saved.staleAfterDays ?? DEFAULT_STALE_DAYS));
  // The work hours (owner, 2026-10-22, fbk_048): the default range of a person who chose none, and the lock that nobody can be quiet inside.
  const office = officeWorkHoursOf(saved);
  const [range, setRange] = useState<WorkRange>({ days: office.days, from: office.from, to: office.to });
  const [lock, setLock] = useState<WorkLock>(office.lock);
  // The name and the logo of the company (Madar enterprises, design 5.10): shown in the header, the mails and the push line.
  const [companyName, setCompanyName] = useState(saved.enterpriseName ?? '');
  const [companyNameAr, setCompanyNameAr] = useState(saved.enterpriseNameAr ?? '');
  const [companyLogo, setCompanyLogo] = useState<string | null>(saved.enterpriseLogo ?? null);
  const [problems, setProblems] = useState<Problems>({});
  const save = useAction('settings.update', { onSuccess: () => toast.show({ message: t('admin.officeSaved') }) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const names = stages.map((stage) => stage.name.trim());
    const value = Number(limit);
    const staleValue = Number(stale);
    // The screen checks the API's rules first, so the message shows under the field at once (spec 11.6).
    const next: Problems = {
      stages: names.length === 0 || names.some((name) => !name) ? t('admin.errors.stages') : undefined,
      limit: Number.isInteger(value) && value >= 1 && value <= 100 ? undefined : t('admin.errors.limit'),
      stale: stale.trim() !== '' && Number.isInteger(staleValue) && staleValue >= 7 && staleValue <= 365 ? undefined : t('admin.errors.stale'),
      workHours: coversLock(range, lock) ? undefined : t('errors.reasons.work_hours_default_lock'),
    };
    setProblems(next);
    if (next.stages || next.limit || next.stale || next.workHours) return;
    // The code prefix left the screen (owner, 2026-10-05): new codes come from the code parts. The contract keeps the
    // stored prefix for the old automatic code, so this save never names it.
    // Only a name or logo that changed goes in the call; an empty name is not sent (the record keeps its name).
    const company = {
      ...(companyName.trim() !== '' && companyName.trim() !== (saved.enterpriseName ?? '') ? { enterpriseName: companyName.trim() } : {}),
      ...(companyNameAr.trim() !== '' && companyNameAr.trim() !== (saved.enterpriseNameAr ?? '') ? { enterpriseNameAr: companyNameAr.trim() } : {}),
      ...(companyLogo !== (saved.enterpriseLogo ?? null) ? { enterpriseLogo: companyLogo } : {}),
    };
    save.mutate({
      ...company,
      defaultStages: names, workloadLimit: value, staleAfterDays: staleValue,
      workHours: { days: [...range.days], from: range.from, to: range.to, lock: { on: lock.on, days: [...lock.days], from: lock.from, to: lock.to } },
    });
  };
  const rangeLabels = { days: t('admin.workHours.days'), from: t('admin.workHours.from'), to: t('admin.workHours.to') };
  const workHoursError = problems.workHours ?? fieldError(save.error, 'workHours', t, t('errors.reasons.work_hours_default_lock'));
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField id="office-company-name" label={t('admin.enterpriseName')} value={companyName} dir="auto" maxLength={80} autoComplete="off" error={fieldError(save.error, 'enterpriseName', t, t('errors.invalid_input'))} onChange={(event) => setCompanyName(event.target.value)} />
        <TextField id="office-company-name-ar" label={t('admin.enterpriseNameAr')} value={companyNameAr} dir="auto" maxLength={80} autoComplete="off" error={fieldError(save.error, 'enterpriseNameAr', t, t('errors.invalid_input'))} onChange={(event) => setCompanyNameAr(event.target.value)} />
      </div>
      <LogoPicker id="office-company-logo" label={t('admin.enterpriseLogo')} value={companyLogo} onChange={setCompanyLogo} />
      <FormError text={fieldError(save.error, 'enterpriseLogo', t, t('errors.invalid_input')) ?? null} />
      {usage && <UsageLines usage={usage} />}
      <StageList stages={stages} onChange={setStages} onBlur={() => undefined} error={problems.stages ?? fieldError(save.error, 'defaultStages', t, t('admin.errors.stages'))} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="office-limit" label={t('admin.limit')} hint={t('admin.limitHint')} inputMode="numeric" value={limit}
          error={problems.limit ?? fieldError(save.error, 'workloadLimit', t, t('admin.errors.limit'))}
          onChange={(event) => setLimit(event.target.value)}
        />
        <TextField
          id="office-stale" label={t('admin.staleAfter')} hint={t('admin.staleAfterHint')} inputMode="numeric" value={stale}
          error={problems.stale ?? fieldError(save.error, 'staleAfterDays', t, t('admin.errors.stale'))}
          onChange={(event) => setStale(event.target.value)}
        />
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-subheadline font-semibold">{t('admin.workHours.title')}</legend>
        <p className="text-footnote text-label-2">{t('admin.workHours.hint')}</p>
        <p className="text-subheadline">{t('admin.workHours.defaultTitle')}</p>
        <WorkRangeFields
          idPrefix="office-default" value={range} lock={lock} onChange={setRange} labels={rangeLabels}
        />
        <Switch
          id="office-lock" label={t('admin.workHours.lock')} description={t('admin.workHours.lockHint')} checked={lock.on}
          onChange={(on) => {
            const next = { ...lock, on };
            setLock(next);
            setRange(widenToLock(range, next));
          }}
        />
        {lock.on && (
          <WorkRangeFields
            idPrefix="office-lock-range" value={lock}
            onChange={(next) => {
              const changed = { ...lock, ...next };
              setLock(changed);
              setRange(widenToLock(range, changed));
            }}
            labels={rangeLabels}
          />
        )}
        <FormError text={workHoursError ?? null} />
      </fieldset>
      <Button type="submit" className="self-start" disabled={save.isPending}>{t('admin.saveOffice')}</Button>
    </form>
  );
}

export function OfficeSection() {
  const { t } = useTranslation();
  const settings = useCall('settings.get', {});
  return (
    <AdminPanel id="admin-office" title={t('admin.office')}>
      {/* No empty form: saving an empty stage list would erase the office's default stages. */}
      {settings.data ? <OfficeForm saved={settings.data} {...(settings.data.usage ? { usage: settings.data.usage } : {})} /> : settings.error && <LoadFailed error={settings.error} onRetry={() => void settings.refetch()} />}
    </AdminPanel>
  );
}

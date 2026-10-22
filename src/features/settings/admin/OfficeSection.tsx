import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_STALE_DAYS, type Settings } from '../../../api/contract/entities';
import { fieldError } from '../../../app/errors';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { Switch } from '../../../components/Switch';
import { coversLock, officeWorkHoursOf, type WorkRange } from '../../../lib/quietHours';
import { StageList } from '../../projects/ProjectFields';
import { WorkRangeFields } from '../WorkRangeFields';

type Problems = { stages?: string; limit?: string; stale?: string; workHours?: string };

type Lock = WorkRange & { on: boolean };

/** The range with the lock inside it: every day of the lock, and the times of the lock. */
function widen(range: WorkRange, lock: Lock): { days: number[]; from: string; to: string } {
  if (!lock.on) return { days: [...range.days], from: range.from, to: range.to };
  return {
    days: [...new Set([...range.days, ...lock.days])].sort((a, b) => a - b),
    from: range.from < lock.from ? range.from : lock.from,
    to: range.to > lock.to ? range.to : lock.to,
  };
}

/** The form starts from the saved settings once. A refresh of the settings never replaces what the Admin typed. */
function OfficeForm({ saved }: { saved: Settings }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [stages, setStages] = useState(() => saved.defaultStages.map((name) => ({ name })));
  const [limit, setLimit] = useState(String(saved.workloadLimit));
  const [stale, setStale] = useState(String(saved.staleAfterDays ?? DEFAULT_STALE_DAYS));
  // The work hours (owner, 2026-10-22, fbk_048): the default range of a person who chose none, and the lock that nobody can be quiet inside.
  const office = officeWorkHoursOf(saved);
  const [range, setRange] = useState<WorkRange>({ days: office.days, from: office.from, to: office.to });
  const [lock, setLock] = useState<Lock>(office.lock);
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
    save.mutate({
      defaultStages: names, workloadLimit: value, staleAfterDays: staleValue,
      workHours: { days: [...range.days], from: range.from, to: range.to, lock: { on: lock.on, days: [...lock.days], from: lock.from, to: lock.to } },
    });
  };
  const workHoursError = problems.workHours ?? fieldError(save.error, 'workHours', t, t('errors.reasons.work_hours_default_lock'));
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
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
          idPrefix="office-default" value={range} lock={lock} onChange={setRange}
          labels={{ days: t('admin.workHours.days'), from: t('admin.workHours.from'), to: t('admin.workHours.to') }}
        />
        <Switch
          id="office-lock" label={t('admin.workHours.lock')} description={t('admin.workHours.lockHint')} checked={lock.on}
          onChange={(on) => {
            const next = { ...lock, on };
            setLock(next);
            setRange(widen(range, next));
          }}
        />
        {lock.on && (
          <WorkRangeFields
            idPrefix="office-lock-range" value={lock}
            onChange={(next) => {
              const changed = { ...lock, ...next };
              setLock(changed);
              setRange(widen(range, changed));
            }}
            labels={{ days: t('admin.workHours.days'), from: t('admin.workHours.from'), to: t('admin.workHours.to') }}
          />
        )}
        {workHoursError && <p role="alert" className="text-footnote text-late">{workHoursError}</p>}
      </fieldset>
      <Button type="submit" className="self-start" disabled={save.isPending}>{t('admin.saveOffice')}</Button>
    </form>
  );
}

export function OfficeSection() {
  const { t } = useTranslation();
  const settings = useCall('settings.get', {});
  return (
    <section aria-labelledby="admin-office" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-office" className="text-headline">{t('admin.office')}</h2>
      {/* No empty form: saving an empty stage list would erase the office's default stages. */}
      {settings.data ? <OfficeForm saved={settings.data} /> : settings.error && <LoadFailed error={settings.error} onRetry={() => void settings.refetch()} />}
    </section>
  );
}

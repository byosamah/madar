import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_STALE_DAYS, type Settings } from '../../../api/contract/entities';
import { fieldError } from '../../../app/errors';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { StageList } from '../../projects/ProjectFields';

type Problems = { stages?: string; prefix?: string; limit?: string; stale?: string };

/** The form starts from the saved settings once. A refresh of the settings never replaces what the Admin typed. */
function OfficeForm({ saved }: { saved: Settings }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [stages, setStages] = useState(() => saved.defaultStages.map((name) => ({ name })));
  const [prefix, setPrefix] = useState(saved.codePrefix);
  const [limit, setLimit] = useState(String(saved.workloadLimit));
  const [stale, setStale] = useState(String(saved.staleAfterDays ?? DEFAULT_STALE_DAYS));
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
      prefix: /^[A-Z]{1,4}$/.test(prefix.trim()) ? undefined : t('admin.errors.prefix'),
      limit: Number.isInteger(value) && value >= 1 && value <= 100 ? undefined : t('admin.errors.limit'),
      stale: stale.trim() !== '' && Number.isInteger(staleValue) && staleValue >= 7 && staleValue <= 365 ? undefined : t('admin.errors.stale'),
    };
    setProblems(next);
    if (next.stages || next.prefix || next.limit || next.stale) return;
    save.mutate({ defaultStages: names, codePrefix: prefix.trim(), workloadLimit: value, staleAfterDays: staleValue });
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <StageList stages={stages} onChange={setStages} onBlur={() => undefined} error={problems.stages ?? fieldError(save.error, 'defaultStages', t, t('admin.errors.stages'))} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="office-prefix" label={t('admin.prefix')} hint={t('admin.prefixHint')} dir="ltr" maxLength={4} value={prefix}
          error={problems.prefix ?? fieldError(save.error, 'codePrefix', t, t('admin.errors.prefix'))}
          onChange={(event) => setPrefix(event.target.value.toUpperCase())}
        />
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

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { StageList } from '../../projects/ProjectFields';

export function OfficeSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useCall('settings.get', {});
  const [stages, setStages] = useState<{ name: string }[]>([]);
  const [prefix, setPrefix] = useState('');
  const [limit, setLimit] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setStages(settings.data.defaultStages.map((name) => ({ name })));
    setPrefix(settings.data.codePrefix);
    setLimit(String(settings.data.workloadLimit));
  }, [settings.data]);
  const save = useAction('settings.update', { onSuccess: () => toast.show({ message: t('admin.officeSaved') }) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ defaultStages: stages.map((stage) => stage.name.trim()), codePrefix: prefix.trim(), workloadLimit: Number(limit) });
  };
  return (
    <section aria-labelledby="admin-office" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-office" className="text-headline">{t('admin.office')}</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <StageList stages={stages} onChange={setStages} onBlur={() => undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="office-prefix" label={t('admin.prefix')} hint={t('admin.prefixHint')} dir="ltr" maxLength={4} value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} />
          <TextField id="office-limit" label={t('admin.limit')} hint={t('admin.limitHint')} inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </div>
        <Button variant="primary" type="submit" className="self-start" disabled={save.isPending}>{t('admin.saveOffice')}</Button>
      </form>
    </section>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnterpriseView } from '../../api/contract/platform';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';
import { formatDay } from '../../lib/dates';
import { FormError } from '../auth/AuthPage';
import { bytesOfGb, gbOne, gbText, hasStatus, peopleOf } from './limits';
import { LogoPicker } from './LogoPicker';
import { usePlatform } from './usePlatform';

/** The name of an enterprise in the language of the screen. */
export const nameOf = (row: Pick<EnterpriseView, 'name' | 'nameAr'>, lang: 'en' | 'ar') => (lang === 'ar' && row.nameAr ? row.nameAr : row.name);

/** The day of the last write, or the line for none. */
function lastText(row: EnterpriseView, lang: 'en' | 'ar', t: (key: string, o?: Record<string, string>) => string): string {
  return row.lastWriteAt ? t('enterprises.usage.last', { when: formatDay(row.lastWriteAt.slice(0, 10), lang) }) : t('enterprises.usage.never');
}

/**
 * One enterprise: the name, the Arabic name, the logo, the two limits, the state, the use and the first Admin. The address name is read only.
 * Save changes what the owner edited. The buttons Pause or Resume and "Send the invitation again" are the other steps. Pause asks the owner to
 * type the name first, and stays off until the text is the name.
 */
export function EnterpriseSheet({ row, open, onOpenChange, onTryAgain }: { row: EnterpriseView; open: boolean; onOpenChange: (open: boolean) => void; onTryAgain: (row: EnterpriseView) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [people, setPeople] = useState('');
  const [storage, setStorage] = useState('');
  const [typed, setTyped] = useState('');
  const [askPause, setAskPause] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const done = (message: string) => async () => {
    toast.show({ message });
    await queryClient.invalidateQueries({ queryKey: ['platform'] });
  };
  const update = useMutation({ mutationFn: (patch: Parameters<typeof platform['platform.enterprises.update']>[0]['patch']) => platform['platform.enterprises.update']({ id: row.id, patch }), onSuccess: done(t('enterprises.saved')) });
  const pause = useMutation({ mutationFn: () => platform['platform.enterprises.pause']({ id: row.id, confirmName: typed }), onSuccess: async () => { await done(t('enterprises.paused'))(); setAskPause(false); } });
  const resume = useMutation({ mutationFn: () => platform['platform.enterprises.resume']({ id: row.id }), onSuccess: done(t('enterprises.resumed')) });
  const resend = useMutation({ mutationFn: () => platform['platform.enterprises.resendInvite']({ id: row.id }), onSuccess: done(t('enterprises.sent')) });

  useEffect(() => {
    if (!open) return;
    for (const m of [update, pause, resume, resend]) m.reset();
    setName(row.name);
    setNameAr(row.nameAr);
    setLogo(row.logo);
    setPeople(row.limits.people === null ? '' : String(row.limits.people));
    setStorage(gbText(row.limits.storageBytes));
    setTyped('');
    setAskPause(false);
    setProblem(null);
    // The form starts fresh each time it opens, and when the row changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);

  const save = () => {
    const peopleLimit = peopleOf(people);
    const storageBytes = bytesOfGb(storage);
    if (peopleLimit === undefined || storageBytes === undefined) {
      setProblem(t('enterprises.limitHint'));
      return;
    }
    setProblem(null);
    update.mutate({
      ...(name.trim() !== row.name ? { name: name.trim() } : {}), ...(nameAr.trim() !== row.nameAr ? { nameAr: nameAr.trim() } : {}),
      ...(logo !== row.logo ? { logo } : {}), limits: { people: peopleLimit, storageBytes },
    });
  };
  const failure = [update, pause, resume, resend].find((m) => m.isError)?.error;
  const unfinished = row.state === 'creating';
  const nameMatches = typed.trim() !== '' && (typed.trim() === row.name.trim() || typed.trim() === row.nameAr.trim());

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={nameOf(row, lang)}
      tall
      footer={unfinished ? (
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => onTryAgain(row)}>{t('enterprises.retry')}</Button>
        </>
      ) : (
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={update.isPending} onClick={save}>{t('admin.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-subheadline text-ink-2">
          <span className="font-semibold text-ink">{t(`enterprises.state.${row.state}`)}</span>
          {hasStatus(row) ? (
            <>
              <span>{t('enterprises.usage.people', { active: row.people, invited: row.invited })}</span>
              <span>{t('enterprises.usage.storage', { used: gbOne(row.storageBytes) })}</span>
            </>
          ) : <span>{t('enterprises.notCounted')}</span>}
          <span>{lastText(row, lang, t as never)}</span>
        </p>
        {unfinished ? (
          <p className="text-body text-ink-2">{t('errors.reasons.not_finished')}</p>
        ) : (
          <>
            <TextField id="ent-edit-name" label={t('enterprises.field.name')} value={name} dir="auto" maxLength={80} autoComplete="off" onChange={(event) => setName(event.target.value)} />
            <TextField id="ent-edit-name-ar" label={t('enterprises.field.nameAr')} value={nameAr} dir="auto" maxLength={80} autoComplete="off" onChange={(event) => setNameAr(event.target.value)} />
            <TextField id="ent-edit-address" label={t('enterprises.field.address')} value={row.address} dir="ltr" readOnly />
            <LogoPicker id="ent-edit-logo" label={t('enterprises.field.logo')} value={logo} onChange={setLogo} name={nameOf({ name, nameAr }, lang)} />
            <TextField id="ent-edit-people" label={t('enterprises.field.people')} hint={t('enterprises.limitHint')} value={people} inputMode="numeric" dir="ltr" onChange={(event) => setPeople(event.target.value)} />
            <TextField id="ent-edit-storage" label={t('enterprises.field.storage')} hint={t('enterprises.limitHint')} value={storage} inputMode="decimal" dir="ltr" onChange={(event) => setStorage(event.target.value)} />
          </>
        )}
        {row.firstAdmin && (
          <div className="flex flex-col gap-1">
            <p className="text-footnote text-ink-2">{t('enterprises.admin')}</p>
            <p className="text-body text-ink"><bdi>{row.firstAdmin.name}</bdi></p>
            <p className="text-subheadline text-ink-2" dir="ltr">{row.firstAdmin.email}</p>
            {!unfinished && <Button className="mt-1 self-start" disabled={resend.isPending} onClick={() => resend.mutate()}>{t('enterprises.resend')}</Button>}
          </div>
        )}
        {!unfinished && (row.state === 'paused' ? (
          <Button className="self-start" disabled={resume.isPending} onClick={() => resume.mutate()}>{t('enterprises.resume')}</Button>
        ) : askPause ? (
          <div className="flex flex-col gap-3">
            <TextField id="ent-pause-name" label={t('enterprises.pauseAsk')} value={typed} dir="auto" autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
            <Button className="self-start" disabled={!nameMatches || pause.isPending} onClick={() => pause.mutate()}>{t('enterprises.pause')}</Button>
          </div>
        ) : (
          <Button className="self-start" onClick={() => setAskPause(true)}>{t('enterprises.pause')}</Button>
        ))}
        <FormError text={problem ?? (failure ? errorMessage(failure, t) : null)} />
      </div>
    </Sheet>
  );
}

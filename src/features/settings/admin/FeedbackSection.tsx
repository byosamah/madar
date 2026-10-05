import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePersonName } from '../../../app/personName';
import { useAction, useCall, useRuntime } from '../../../app/runtime';
import { Age } from '../../../components/Age';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { isAppPath } from '../../../api/handlers/feedback';
import { StatusSign } from '../../../components/StatusSign';

/** One screenshot. A press shows it large, a second press makes it small again. */
function Screenshot({ id, index }: { id: string; index: number }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const query = useQuery({
    queryKey: ['feedback-shot', id, index],
    queryFn: () => api.call('feedback.screenshot', { id, index }),
    staleTime: Infinity,
    retry: false,
  });
  const blob = query.data?.blob;
  const [url, setUrl] = useState<string | null>(null);
  const [large, setLarge] = useState(false);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!url) return <span aria-hidden className="block size-20 rounded-xl bg-fill" />;
  return (
    <button type="button" aria-pressed={large} onClick={() => setLarge((value) => !value)} className="pressable rounded-xl">
      <img src={url} alt={t('feedback.screenshotN', { n: index + 1 })} className={`rounded-xl ring-1 ring-inset ring-ink/10 ${large ? 'max-h-[28rem] w-auto max-w-full' : 'size-20 object-cover'}`} />
    </button>
  );
}

/** The feature requests and bug reports from the person menu, for the Admin (owner, 2026-10-01). Open ones come first. */
export function FeedbackSection() {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const list = useCall('feedback.list', {});
  const setStatus = useAction('feedback.setStatus');
  const rows = list.data ?? [];
  const open = rows.filter((row) => row.item.status === 'new').length;
  return (
    <section aria-labelledby="admin-feedback" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-feedback" className="flex items-center gap-2 text-headline">
        {t('feedback.adminTitle')}
        {open > 0 && <span className="tabular rounded-full bg-fill px-2 text-caption font-semibold text-ink-2">{open}</span>}
      </h2>
      {list.data && rows.length === 0 && <p className="text-subheadline text-ink-2">{t('feedback.none')}</p>}
      <ul className="hairline flex flex-col">
        {rows.map(({ item, sender }) => {
          const done = item.status === 'done';
          return (
            <li key={item.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start gap-3">
                <Avatar user={sender} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-subheadline">
                    <bdi className="font-semibold text-ink">{nameOf(sender)}</bdi>
                    <span className="text-ink-2">{t(`feedback.kinds.${item.kind}`)}</span>
                    <span className="text-ink-2"><Age stamp={item.createdAt} /></span>
                    {done && <StatusSign state="completed">{t('feedback.done')}</StatusSign>}
                  </p>
                  <p dir="auto" className={`whitespace-pre-wrap text-body ${done ? 'text-ink-2' : 'text-ink'}`}>{item.message}</p>
                  {/* The server accepts only Madar screens, but stored data is checked again: anything else shows as plain text. */}
                  {item.page && (isAppPath(item.page)
                    ? <Link to={item.page} className="text-footnote font-semibold text-link"><bdi dir="ltr">{item.page}</bdi></Link>
                    : <bdi dir="ltr" className="block text-footnote text-ink-2">{item.page}</bdi>)}
                </div>
                <Button disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: item.id, status: done ? 'new' : 'done' })}>
                  {done ? t('feedback.reopen') : t('feedback.markDone')}
                </Button>
              </div>
              {item.screenshots.length > 0 && (
                <div className="flex flex-wrap gap-2 ps-11">
                  {item.screenshots.map((_, index) => <Screenshot key={index} id={item.id} index={index} />)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

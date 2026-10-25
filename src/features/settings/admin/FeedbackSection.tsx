import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useUndoable } from '../../../app/actions';
import { useScreenshotLink } from '../../../app/files';
import { usePersonName } from '../../../app/personName';
import { PRIVATE } from '../../../app/privateMark';
import { useAction, useCall } from '../../../app/runtime';
import { useIsPhone } from '../../../app/useIsPhone';
import { Age } from '../../../components/Age';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { Sheet } from '../../../components/Sheet';
import { isAppPath } from '../../../api/handlers/feedback';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { StatusSign } from '../../../components/StatusSign';

/**
 * One screenshot (spec 4.3): a grey box while the link loads, a file sign when the picture cannot show, else the picture.
 * A press opens it bigger in a sheet, and a press on the big picture opens it at full size in a new tab. The sheet uses the
 * link of the thumbnail, so the server signs nothing new.
 */
function Screenshot({ id, index }: { id: string; index: number }) {
  const { t } = useTranslation();
  const { url, onError, broken } = useScreenshotLink(id, index);
  const [open, setOpen] = useState(false);
  const n = index + 1;
  const name = t('feedback.screenshotN', { n });
  let thumb = <span aria-hidden className="block size-20 rounded-xl bg-fill" />;
  if (broken) {
    thumb = (
      <span role="img" aria-label={t('feedback.screenshotFailed', { n })} className="grid size-20 place-items-center rounded-xl bg-fill text-label-2">
        <AnimatedIcon icon={FileTextIcon} size={20} aria-hidden />
      </span>
    );
  } else if (url) {
    thumb = (
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="pressable rounded-xl">
        {/* A thumbnail loads only near the view: the list keeps done reports too, and each one is a full-size picture. */}
        <img src={url} alt={name} onError={onError} loading="lazy" decoding="async" className={`${PRIVATE} size-20 rounded-xl object-cover ring-1 ring-inset ring-ink/10`} />
      </button>
    );
  }
  return (
    <>
      {thumb}
      <Sheet open={open} onOpenChange={setOpen} title={name} wide>
        {/* Broken comes first, as in the thumbnail: a failed new sign keeps the old dead link in the query (review, 2026-10-07). */}
        {broken ? <p className="text-subheadline text-label-2">{t('feedback.screenshotFailed', { n })}</p> : url && (
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t('feedback.openFull', { n })} className={`${PRIVATE} pressable block cursor-zoom-in`}>
            <img src={url} alt="" onError={onError} className="mx-auto block max-h-[calc(100dvh-12rem)] w-auto max-w-full rounded-2xl object-contain ring-1 ring-inset ring-ink/10" />
          </a>
        )}
      </Sheet>
    </>
  );
}

/**
 * The feature requests and bug reports from the person menu, for the Admin (owner, 2026-10-01). Two tabs (owner, 2026-10-08):
 * Waiting, the open ones, is the first tab; Done holds the reports marked done.
 */
export function FeedbackSection() {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const nameOf = usePersonName();
  const [tab, setTab] = useState<'waiting' | 'done'>('waiting');
  const list = useCall('feedback.list', {});
  // Mark done sends the sender a notice, so it offers Undo (rule B20). Open again stays a plain action.
  const markDone = useUndoable('feedback.setStatus', { message: () => t('feedback.markedDone') });
  const reopen = useAction('feedback.setStatus');
  const busy = markDone.isPending || reopen.isPending;
  const rows = list.data ?? [];
  const waitingRows = rows.filter((row) => row.item.status !== 'done');
  const doneRows = rows.filter((row) => row.item.status === 'done');
  const shown = tab === 'done' ? doneRows : waitingRows;
  const open = waitingRows.length;
  return (
    <section aria-labelledby="admin-feedback" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-feedback" className="flex items-center gap-2 text-headline">
        {t('feedback.adminTitle')}
        {open > 0 && <span className="tabular rounded-full bg-fill px-2 text-caption font-semibold text-ink-2">{open}</span>}
      </h2>
      {list.data && rows.length === 0 && <p className="text-subheadline text-ink-2">{t('feedback.none')}</p>}
      {rows.length > 0 && (
        <SegmentedControl
          label={t('feedback.adminTitle')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'waiting', label: `${t('feedback.waiting')} (${waitingRows.length})` },
            { value: 'done', label: `${t('feedback.done')} (${doneRows.length})` },
          ]}
        />
      )}
      {rows.length > 0 && shown.length === 0 && <p className="text-subheadline text-ink-2">{t(tab === 'done' ? 'feedback.noneDone' : 'feedback.noneWaiting')}</p>}
      <ul className="hairline flex flex-col">
        {shown.map(({ item, sender }) => {
          const done = item.status === 'done';
          // On a phone the button sits under the message, so the message keeps the width of the row (2026-10-12).
          const action = (
            <Button disabled={busy} onClick={() => (done ? reopen.mutate({ id: item.id, status: 'new' }) : markDone.mutate({ id: item.id, status: 'done' }))}>
              {done ? t('feedback.reopen') : t('feedback.markDone')}
            </Button>
          );
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
                  {phone && <div className="mt-2">{action}</div>}
                </div>
                {!phone && action}
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

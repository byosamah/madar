import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FEEDBACK_STATUSES, REJECT_REASON_MAX, type Feedback, type FeedbackStatus } from '../../../api/contract/entities';
import { useUndoable } from '../../../app/actions';
import { useScreenshotLink } from '../../../app/files';
import { usePersonName } from '../../../app/personName';
import { PRIVATE } from '../../../app/privateMark';
import { fieldError } from '../../../app/errors';
import { useAction, useCall } from '../../../app/runtime';
import { useIsPhone } from '../../../app/useIsPhone';
import { Age } from '../../../components/Age';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../../components/icons/animated/chevron-down';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { TextArea } from '../../../components/Fields';
import { Menu } from '../../../components/Menu';
import { Sheet } from '../../../components/Sheet';
import { isAppPath } from '../../../api/handlers/feedback';
import { SegmentedControl } from '../../../components/SegmentedControl';

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

/** The three tabs: the open reports (new, in review and in progress), the done ones and the rejected ones (fbk_067). */
type Tab = 'open' | 'done' | 'rejected';
const TABS: readonly Tab[] = ['open', 'done', 'rejected'];
const tabOf = (status: FeedbackStatus): Tab => (status === 'done' ? 'done' : status === 'rejected' ? 'rejected' : 'open');

/**
 * The small sheet that asks why a report is rejected. The reason is required, and the sender reads it in a notice. A report that is already
 * rejected opens it again with its reason, so the Admin can change the words.
 */
function RejectSheet({ item, open, onOpenChange }: { item: Feedback | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason(item?.rejectReason ?? '');
  }, [open, item?.id, item?.rejectReason]);
  // Rejecting tells the sender, so it offers Undo (rule B20).
  const reject = useUndoable('feedback.setStatus', { message: () => t('feedback.statusSet', { status: t('feedback.status.rejected') }), onSuccess: () => onOpenChange(false) });
  const text = reason.trim();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('feedback.rejectTitle')}
      description={t('feedback.rejectHint')}
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!text || reject.isPending || !item} onClick={() => item && reject.mutate({ id: item.id, status: 'rejected', reason: text })}>
            {t('feedback.rejectButton')}
          </Button>
        </>
      )}
    >
      <div className="pt-1">
        <TextArea
          id="reject-reason"
          label={t('feedback.rejectReason')}
          value={reason}
          dir="auto"
          maxLength={REJECT_REASON_MAX}
          error={fieldError(reject.error, 'reason', t, t('errors.invalid_input'))}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Sheet>
  );
}

/**
 * The feature requests and bug reports from the person menu, for the Admin (owner, 2026-10-01). Three tabs (owner, 2026-10-26): Open, the
 * first tab, holds new, in review and in progress; Done and Rejected hold the rest. Each report has one status control: a menu with the five
 * statuses. Rejected asks for a reason first, and the report shows the reason after.
 */
export function FeedbackSection() {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const nameOf = usePersonName();
  const [tab, setTab] = useState<Tab>('open');
  const [rejecting, setRejecting] = useState<Feedback | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const list = useCall('feedback.list', {});
  // Done tells the sender, so it offers Undo (rule B20). The other moves stay plain actions: the control shows the new status.
  const markDone = useUndoable('feedback.setStatus', { message: () => t('feedback.statusSet', { status: t('feedback.status.done') }) });
  const setStatus = useAction('feedback.setStatus');
  const busy = markDone.isPending || setStatus.isPending;
  const rows = list.data ?? [];
  const byTab = (which: Tab) => rows.filter((row) => tabOf(row.item.status) === which);
  const shown = byTab(tab);
  const open = byTab('open').length;
  const choose = (item: Feedback, status: FeedbackStatus) => {
    if (status === 'rejected') {
      setRejecting(item);
      setRejectOpen(true);
    } else if (status === 'done') {
      if (item.status !== 'done') markDone.mutate({ id: item.id, status });
    } else if (item.status !== status) {
      setStatus.mutate({ id: item.id, status });
    }
  };
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
          options={TABS.map((value) => ({ value, label: `${t(`feedback.tabs.${value}`)} (${byTab(value).length})` }))}
        />
      )}
      {rows.length > 0 && shown.length === 0 && <p className="text-subheadline text-ink-2">{t(tab === 'open' ? 'feedback.noneOpen' : tab === 'done' ? 'feedback.noneDone' : 'feedback.noneRejected')}</p>}
      <ul className="hairline flex flex-col">
        {shown.map(({ item, sender }) => {
          const finished = item.status === 'done' || item.status === 'rejected';
          const statusName = t(`feedback.status.${item.status}`);
          // On a phone the control sits under the message, so the message keeps the width of the row (2026-10-12).
          const action = (
            <Menu
              label={t('feedback.statusOf', { status: statusName })}
              text={statusName}
              icon={<AnimatedIcon icon={ChevronDownIcon} size={16} aria-hidden />}
              triggerClassName={`bg-fill text-ink hover:bg-fill-strong ${busy ? 'pointer-events-none opacity-40' : ''}`}
              align="start"
              sheetOnPhone
              items={FEEDBACK_STATUSES.map((status) => ({ label: t(`feedback.status.${status}`), checked: status === item.status, onSelect: () => choose(item, status) }))}
            />
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
                  </p>
                  <p dir="auto" className={`whitespace-pre-wrap break-words text-body ${finished ? 'text-ink-2' : 'text-ink'}`}>{item.message}</p>
                  {item.status === 'rejected' && item.rejectReason && (
                    <p dir="auto" className="whitespace-pre-wrap break-words text-footnote text-ink-2">{t('feedback.reasonShown', { reason: `⁨${item.rejectReason}⁩` })}</p>
                  )}
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
      <RejectSheet item={rejecting} open={rejectOpen} onOpenChange={setRejectOpen} />
    </section>
  );
}

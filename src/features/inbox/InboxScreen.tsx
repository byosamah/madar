import { Bell } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { useLang } from '../../app/lang';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { useIsPhone } from '../../app/useIsPhone';
import { Age } from '../../components/Age';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { addDays, formatDay, stampDay, todayISO } from '../../lib/dates';
import { actorContext } from '../../lib/grammar';
import { groupByDay } from '../../lib/group';
import { LoadFailed } from '../../components/LoadFailed';

type NoticeView = CallOutput<'notifications.list'>[number];

function InboxItem({ view }: { view: NoticeView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { notification: n, actor, target, projectCode, link, canApprove, gone } = view;
  const markRead = useAction('notifications.markRead');
  const approve = useAction('tasks.approve', { onSuccess: () => toast.show({ message: t('taskSheet.approved') }) });
  const read = () => {
    if (!n.read) markRead.mutate({ ids: [n.id] });
  };
  const sentence = t(`inbox.trigger.${n.trigger}`, {
    actor: actor?.name ?? t('inbox.someone'),
    context: actorContext(actor),
    target: n.trigger === 'week_under_target' ? formatDay(target, lang, 'long') : target,
  });
  return (
    <motion.li
      drag={phone ? 'x' : false}
      dragSnapToOrigin
      onDragEnd={(_event, info) => {
        // A swipe to either side marks the item read (plan clarification 7).
        if (Math.abs(info.offset.x) > 80) read();
      }}
      className="flex flex-wrap items-start gap-3 bg-card px-4 py-3"
    >
      <span aria-hidden className={`mt-3 size-2.5 shrink-0 rounded-full ${n.read ? '' : 'bg-accent-fill'}`} />
      {actor
        ? <Avatar user={actor} size={36} />
        : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-label-2"><Bell size={16} aria-hidden /></span>}
      <div className="min-w-48 flex-1">
        <p className={`text-subheadline ${n.read ? 'text-label-2' : 'font-medium text-label'}`}>
          {!n.read && <span className="sr-only">{t('inbox.unread')}: </span>}
          {sentence}
        </p>
        <p className="text-footnote text-label-2">
          {projectCode && <span className="tabular">{projectCode} · </span>}
          <Age stamp={n.createdAt} />
        </p>
        {gone && <p className="text-footnote text-label-2">{t('errors.not_found')}</p>}
      </div>
      <div className="ms-auto flex gap-2">
        {canApprove && (
          <Button
            variant="primary"
            disabled={approve.isPending}
            onClick={() => {
              approve.mutate({ id: n.targetId });
              read();
            }}
          >
            {t('inbox.approve')}
          </Button>
        )}
        {!gone && (
          <Button
            onClick={() => {
              read();
              navigate(link);
            }}
          >
            {n.trigger === 'week_under_target' ? t('inbox.openTimesheet') : t('inbox.open')}
          </Button>
        )}
      </div>
    </motion.li>
  );
}

/** My notifications by day, with an unread dot and one action each (spec 7.1). */
export function InboxScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const list = useCall('notifications.list', {});
  const markAll = useAction('notifications.markAllRead', { onSuccess: () => toast.show({ message: t('inbox.allRead') }) });
  const today = todayISO();
  const dayLabel = (day: string) => (day === today ? t('inbox.today') : day === addDays(today, -1) ? t('inbox.yesterday') : formatDay(day, lang, 'long'));
  const items = list.data ?? [];
  const unread = items.some((view) => !view.notification.read);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <ScreenTitle title={t('screens.inbox')} />
        {unread && <Button className="shrink-0" onClick={() => markAll.mutate({})}>{t('inbox.markAllRead')}</Button>}
      </div>
      {list.error && <LoadFailed error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <EmptyState title={t('inbox.emptyTitle')} body={t('inbox.empty')} />}
      <div className="flex flex-col gap-5">
        {groupByDay(items, (view) => stampDay(view.notification.createdAt)).map((group) => (
          <section key={group.day} aria-labelledby={`inbox-${group.day}`}>
            <h2 id={`inbox-${group.day}`} className="pb-2 text-headline">{dayLabel(group.day)}</h2>
            <ul className="surface flex flex-col divide-y divide-separator overflow-hidden rounded-card">
              {group.items.map((view) => <InboxItem key={view.notification.id} view={view} />)}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

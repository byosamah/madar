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
import { ProjectTile } from '../../components/ProjectTile';

type NoticeView = CallOutput<'notifications.list'>[number];

function InboxItem({ view }: { view: NoticeView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { notification: n, actor, target, project, link, canApprove, gone } = view;
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
      className="flex flex-wrap items-start gap-3 bg-panel px-4 py-3.5"
    >
      <span aria-hidden className={`mt-3 size-2.5 shrink-0 rounded-full ${n.read ? '' : 'bg-link'}`} />
      {actor
        ? <Avatar user={actor} size={36} />
        : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2"><Bell size={16} aria-hidden /></span>}
      <div className="min-w-48 flex-1">
        <p className={`text-subheadline ${n.read ? 'text-ink-2' : 'font-medium text-ink'}`}>
          {!n.read && <span className="sr-only">{t('inbox.unread')}: </span>}
          {sentence}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 pt-1 text-footnote text-ink-2">
          {project && <><ProjectTile id={project.id} name={project.name} size={20} /><bdi className="min-w-0 truncate">{project.name}</bdi><span aria-hidden>·</span></>}
          <span className="shrink-0"><Age stamp={n.createdAt} /></span>
        </p>
        {gone && <p className="text-footnote text-ink-2">{t('errors.not_found')}</p>}
      </div>
      <div className="ms-auto flex gap-2">
        {canApprove && (
          <Button
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
            variant="plain"
            className="px-3"
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
        {unread && <Button variant="plain" className="shrink-0 px-3" onClick={() => markAll.mutate({})}>{t('inbox.markAllRead')}</Button>}
      </div>
      {list.error && <LoadFailed error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <EmptyState title={t('inbox.emptyTitle')} body={t('inbox.empty')} />}
      <div className="flex flex-col gap-5">
        {groupByDay(items, (view) => stampDay(view.notification.createdAt)).map((group) => (
          <section key={group.day} aria-labelledby={`inbox-${group.day}`}>
            <h2 id={`inbox-${group.day}`} className="px-1 pb-2 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2">{dayLabel(group.day)}</h2>
            <ul className="panel hairline flex flex-col overflow-hidden">
              {group.items.map((view) => <InboxItem key={view.notification.id} view={view} />)}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

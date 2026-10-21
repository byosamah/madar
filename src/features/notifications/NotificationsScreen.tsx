import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { BellIcon } from '../../components/icons/animated/bell';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { useUndoable } from '../../app/actions';
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
import { counted } from '../../lib/grammar';
import { groupByDay } from '../../lib/group';
import { LoadFailed } from '../../components/LoadFailed';
import { ProjectTile } from '../../components/ProjectTile';
import { GroupPicture } from '../inbox/GroupPicture';
import { noticeSentence } from '../../lib/noticeSentence';

type NoticeView = CallOutput<'notifications.list'>[number];

function InboxItem({ view }: { view: NoticeView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const phone = useIsPhone();
  const { notification: n, actor, target, project, link, canApprove, gone } = view;
  const markRead = useAction('notifications.markRead');
  const read = () => {
    if (!n.read) markRead.mutate({ ids: [n.id] });
  };
  // The notice turns read only when the approval works; a refused or failed one still waits (audit 2026-10-03, SHL-11).
  // Approve is a change like any other, so its toast offers Undo (audit 2026-10-03, BRW-5).
  // Undo also gives back the unread mark that Approve took, so the bell counts the review again (audit 2026-10-03, V-16).
  const wasUnread = useRef(false);
  const markUnread = useAction('notifications.markUnread');
  const approve = useUndoable('tasks.approve', {
    message: () => t('taskSheet.approved'),
    onSuccess: read,
    onUndo: () => {
      if (wasUnread.current) markUnread.mutate({ ids: [n.id] });
    },
  });
  // A swipe on a phone must not also open the item.
  const swiped = useRef(false);
  const report = n.targetType === 'feedback';
  // A group notice shows the picture of the group (UX audit 2026-10-19, INT-03).
  const group = n.targetType === 'chat' && view.chatKind === 'group';
  // A done report names no person, so its row shows the bell and not the Admin who marked it. A group notice shows the group.
  const face = report && n.trigger === 'feedback_done' ? null : actor;
  // The sentence is shared with the push line of the server (src/lib/noticeSentence.ts, owner 2026-10-21).
  const sentence = noticeSentence(view, (key, params) => t(key, params), lang);
  const body = (
    <>
      <span aria-hidden className={`mt-3 size-2.5 shrink-0 rounded-full ${n.read ? '' : 'bg-link'}`} />
      {group ? <GroupPicture id={n.targetId} size={36} /> : face
        ? <Avatar user={face} size={36} />
        : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2"><AnimatedIcon icon={BellIcon} size={16} aria-hidden /></span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`text-subheadline ${n.read ? 'text-ink-2' : 'font-medium text-ink'}`}>
          {!n.read && <span className="sr-only">{t('inbox.unread')}: </span>}
          {sentence}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pt-1 text-footnote text-ink-2">
          {project && <><ProjectTile id={project.id} mark={project.mark} size={20} /><bdi className="min-w-0 truncate">{project.name}</bdi><span aria-hidden>·</span></>}
          {/* A live task with no project is an office task (owner, 2026-10-06). */}
          {!project && n.targetType === 'task' && !gone && <><span className="shrink-0">{t('office.word')}</span><span aria-hidden>·</span></>}
          <span className="shrink-0"><Age stamp={n.createdAt} /></span>
        </span>
        {gone && <span className="text-footnote text-ink-2">{t('errors.not_found')}</span>}
      </span>
    </>
  );
  return (
    <motion.li
      drag={phone ? 'x' : false}
      dragSnapToOrigin
      onDragStart={() => {
        swiped.current = true;
      }}
      onDragEnd={(_event, info) => {
        // A swipe to either side marks the item read (plan clarification 7).
        if (Math.abs(info.offset.x) > 80) read();
        window.setTimeout(() => {
          swiped.current = false;
        }, 0);
      }}
      className="flex items-center gap-2 bg-panel pe-3 transition-colors hover:bg-fill/50"
    >
      {/* The whole row opens the item and marks it read (redesign spec 3.7). Approve stays its own button beside it. */}
      {/* A row with no link (a done report) is a button that only marks it read (owner, 2026-10-07). */}
      {gone ? <div className="flex min-w-0 flex-1 items-start gap-3 py-3.5 ps-4">{body}</div> : link !== '' ? (
        <Link
          to={link}
          onClick={(event) => {
            if (swiped.current) {
              event.preventDefault();
              return;
            }
            read();
          }}
          className="pressable flex min-w-0 flex-1 items-start gap-3 py-3.5 ps-4"
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (!swiped.current) read();
          }}
          className="pressable flex w-full min-w-0 flex-1 items-start gap-3 py-3.5 ps-4 text-start"
        >
          {body}
        </button>
      )}
      {canApprove && (
        <Button
          className="shrink-0"
          disabled={approve.isPending}
          onClick={() => {
            wasUnread.current = !n.read;
            approve.mutate({ id: n.targetId });
          }}
          // Each button names its task, so a screen reader can tell two Approve buttons apart; the visible word stays Approve.
          aria-label={t('inbox.approveTask', { target })}
        >
          {t('inbox.approve')}
        </Button>
      )}
    </motion.li>
  );
}

/** My notifications by day, with an unread dot. A press on a row opens it (spec 7.1, redesign spec 3.7). */
export function NotificationsScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const list = useCall('notifications.list', {});
  // A mis-press of Mark all read would lose every to-do dot, so the toast offers Undo for the notices it cleared (audit 2026-10-03, SHL-16).
  const cleared = useRef<string[]>([]);
  const markUnread = useAction('notifications.markUnread');
  const markAll = useAction('notifications.markAllRead', {
    onSuccess: () => {
      const ids = cleared.current;
      // The toast names the change, not a state, so the person knows what Undo puts back (audit 2026-10-03, V-26).
      // It counts every notice that it marked. One markUnread call takes 200 at most, so Undo sends groups of 200.
      const undo = () => {
        for (let start = 0; start < ids.length; start += 200) markUnread.mutate({ ids: ids.slice(start, start + 200) });
      };
      const message = counted(t, 'inbox.markedRead', ids.length);
      if (ids.length > 0) toast.undo(message, undo);
      else toast.show({ message });
    },
  });
  const today = todayISO();
  const dayLabel = (day: string) => (day === today ? t('inbox.today') : day === addDays(today, -1) ? t('inbox.yesterday') : formatDay(day, lang, 'long'));
  const items = list.data ?? [];
  const unread = items.some((view) => !view.notification.read);
  // A notice of a deleted item has nothing to open, so it turns read once the list shows it (audit 2026-10-03, SHL-12).
  const markGone = useAction('notifications.markRead');
  const goneUnread = items.filter((view) => view.gone && !view.notification.read).map((view) => view.notification.id).join(',');
  useEffect(() => {
    if (goneUnread) markGone.mutate({ ids: goneUnread.split(',').slice(0, 200) });
    // The mutation object changes on every render. Only a new set of gone notices matters here.
  }, [goneUnread]);
  return (
    <>
      <ScreenTitle
        title={t('screens.notifications')}
        action={unread ? (
          <Button
            variant="plain"
            className="shrink-0 px-3"
            onClick={() => {
              cleared.current = items.filter((view) => !view.notification.read).map((view) => view.notification.id);
              markAll.mutate({});
            }}
          >
            {t('inbox.markAllRead')}
          </Button>
        ) : undefined}
      />
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

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { FeedItem, EventLineView } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { formatDay, todayISO } from '../../../lib/dates';
import { actorContext, counted } from '../../../lib/grammar';
import { plainText } from '../../../lib/text';
import { toTsv } from '../../../lib/trackerExport';
import { FEED_EVENT_VERBS, feedText } from '../../projects/feed';

type Line = { id: string; who: string; what: string; time: string };
type Group = { projectId: string; name: string; lines: Line[] };

/** The sentence of one event: the same words as the Activity feed, and a sentence for a decision, which the feed shows as a post. */
function sentenceOf({ event, actor, label, detail }: EventLineView, t: TFunction): string | null {
  if (event.undoneBy) return null;
  if (event.verb === 'update.posted') {
    const after = event.after as { decision?: boolean; body?: string } | null;
    return after?.decision ? t('dashboard.meeting.summary.decision', { text: plainText(after.body ?? ''), context: actorContext(actor) }) : null;
  }
  if (!FEED_EVENT_VERBS.has(event.verb)) return null;
  const item: FeedItem = { kind: 'event', id: event.id, at: event.createdAt, author: actor, verb: event.verb, targetType: event.targetType, targetId: event.targetId, label, detail, canUndo: false };
  return feedText(item, t);
}

/**
 * The summary of the meeting: every change since the meeting started, for each project in agenda order.
 * A project with no change does not show. The summary can be copied as a table, or posted to the chat of each project.
 */
export function MeetingSummary({ agendaIds, names, startedAt, onBack }: { agendaIds: string[]; names: ReadonlyMap<string, string>; startedAt: string; onBack: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const { api } = useRuntime();
  const events = useCall('events.list', { since: startedAt, limit: 500 });
  const chats = useCall('chats.list', {});

  const groups = useMemo<Group[]>(() => {
    const byProject = new Map<string, Line[]>();
    // The call lists the newest first. The summary reads from the first change to the last.
    for (const view of [...(events.data ?? [])].reverse()) {
      const projectId = view.event.projectId;
      const what = projectId ? sentenceOf(view, t) : null;
      if (!projectId || what === null) continue;
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), { id: view.event.id, who: view.actor.name, what, time: view.event.createdAt.slice(11, 16) }]);
    }
    return agendaIds.filter((id) => byProject.has(id)).map((id) => ({ projectId: id, name: names.get(id) ?? id, lines: byProject.get(id)! }));
  }, [events.data, agendaIds, names, t]);

  const copy = async () => {
    const table = [
      [t('dashboard.meeting.summary.columns.project'), t('dashboard.meeting.summary.columns.who'), t('dashboard.meeting.summary.columns.what'), t('dashboard.meeting.summary.columns.time')],
      ...groups.flatMap((group) => group.lines.map((line) => [group.name, line.who, line.what, line.time])),
    ];
    try {
      await navigator.clipboard.writeText(toTsv(table));
      toast.show({ message: t('dashboard.meeting.summary.copied') });
    } catch {
      toast.show({ tone: 'error', message: t('dashboard.meeting.summary.copyFailed') });
    }
  };

  // One message for each project with changes. A project whose chat the viewer cannot open or post in is skipped.
  const share = async () => {
    const date = formatDay(todayISO(), lang, 'withWeekday');
    let sent = 0;
    for (const group of groups) {
      const chat = chats.data?.find((row) => row.kind === 'project' && row.project?.id === group.projectId);
      if (!chat) continue;
      const body = [t('dashboard.meeting.summary.shareTitle', { date }), ...group.lines.map((line) => `${line.who} ${line.what}`)].join('\n');
      try {
        await api.call('chats.send', { conversationId: chat.id, body });
        sent += 1;
      } catch {
        // The chat refused the message, so this project is skipped like a project with no chat.
      }
    }
    toast.show({ message: sent === 0 ? t('dashboard.meeting.summary.sharedNone') : counted(t, 'dashboard.meeting.summary.shared', sent) });
  };

  return (
    <section aria-label={t('dashboard.meeting.summary.title')} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onBack}>{t('dashboard.meeting.summary.back')}</Button>
        <h2 className="me-auto text-[26px] font-bold text-ink">{t('dashboard.meeting.summary.title')}</h2>
        {groups.length > 0 && (
          <>
            <Button onClick={() => void copy()}>{t('dashboard.meeting.summary.copy')}</Button>
            <Button variant="primary" onClick={() => void share()}>{t('dashboard.meeting.summary.share')}</Button>
          </>
        )}
      </div>
      {events.data && groups.length === 0 && <p className="text-[20px] text-ink-2">{t('dashboard.meeting.summary.none')}</p>}
      {groups.map((group) => (
        <div key={group.projectId} role="group" aria-label={group.name} className="rounded-card panel p-5">
          <h3 className="pb-2 text-[22px] font-semibold text-ink"><bdi>{group.name}</bdi></h3>
          <ul className="flex flex-col gap-1.5">
            {group.lines.map((line) => (
              <li key={line.id} className="flex items-baseline gap-3 text-[18px]">
                <bdi dir="ltr" className="tabular w-12 shrink-0 text-ink-2">{line.time}</bdi>
                <span className="min-w-0 flex-1"><bdi className="font-semibold text-ink">{line.who}</bdi> <span className="text-ink-2">{line.what}</span></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

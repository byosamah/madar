import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { FeedItem, EventLineView } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { formatDay, localeFor, todayISO, type Lang } from '../../../lib/dates';
import { actorContext, counted } from '../../../lib/grammar';
import { plainText } from '../../../lib/text';
import { toTsv } from '../../../lib/trackerExport';
import { FEED_EVENT_VERBS, feedText } from '../../projects/feed';
import { actionLine } from './actionLine';

/**
 * `owner`: the person of an action. An action line reads on its own, with no name before it, as in the meeting panel.
 * The Who column of the copied table holds this person, as the "Who" field of the meeting form does (audit 2026-10-03, F-18).
 */
type Line = { id: string; who: string; what: string; time: string; owner?: string };
type Group = { projectId: string; name: string; lines: Line[] };

/** The content of a project's lines, by their changes. A new change makes new content, which can go to the chat again. */
const contentOf = (group: Group) => group.lines.map((line) => line.id).join(',');

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields => (value !== null && typeof value === 'object' ? (value as Fields) : {});
const DATE_FIELDS = ['startDate', 'dueDate'] as const;

/** "the due date from Tue 20 Oct to Mon 26 Oct" for each date that moved, or nothing when no date moved. */
function dateMoves(event: EventLineView['event'], t: TFunction, lang: Lang): string[] {
  const before = fieldsOf(event.before);
  const after = fieldsOf(event.after);
  return DATE_FIELDS.flatMap((field) => {
    const from = before[field];
    const to = after[field];
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) return [];
    return [t('dashboard.meeting.summary.dateMove', { field: t(`taskHistory.fields.${field}`), from: formatDay(from, lang, 'withWeekday'), to: formatDay(to, lang, 'withWeekday') })];
  });
}

/** The sentence of a task change: the dates that moved, or else the names of the fields that changed. */
function taskChange(event: EventLineView['event'], label: string, context: string | undefined, t: TFunction, lang: Lang): string {
  const list = new Intl.ListFormat(localeFor(lang), { type: 'conjunction' });
  const moves = dateMoves(event, t, lang);
  if (moves.length > 0) return t('dashboard.meeting.summary.datesMoved', { label, moves: list.format(moves), context });
  const fields = [...new Set(Object.keys(fieldsOf(event.after)).map((field) => t(`taskHistory.fields.${field}`, { defaultValue: '' })).filter(Boolean))];
  return fields.length > 0
    ? t('dashboard.meeting.summary.changed', { label, fields: list.format(fields), context })
    : t('dashboard.meeting.summary.other', { label, context });
}

/**
 * The sentence of one event: the same words as the Activity feed, a sentence for a decision, which the feed shows as a post,
 * and sentences for the changes a meeting makes most: a moved date, a new lead, a closed client item and the person who replies.
 * Any other change gets "made a change". Null for an event that is not a line: an undone change, a payment, a message.
 */
function sentenceOf({ event, actor, label, detail }: EventLineView, t: TFunction, lang: Lang): string | null {
  if (event.undoneBy) return null;
  // The summary goes to the project chats, so an amount never shows in it.
  if (event.targetType === 'payment' || event.verb.startsWith('payment.')) return null;
  // A message is not a change. The reason for a moved date joins the line of its move.
  if (event.verb.startsWith('comment.')) return null;
  const context = actorContext(actor);
  if (event.verb === 'update.posted') {
    const after = event.after as { decision?: boolean; body?: string } | null;
    return after?.decision ? t('dashboard.meeting.summary.decision', { text: plainText(after.body ?? ''), context }) : null;
  }
  if (event.verb === 'task.updated') return taskChange(event, label, context, t, lang);
  if (event.verb === 'task.reassigned') return t('dashboard.meeting.summary.leadChanged', { label, lead: detail.lead ?? '', context });
  if (event.verb === 'tracker.closed') return t(detail.waiting === 'client' ? 'dashboard.meeting.summary.received' : 'dashboard.meeting.summary.answered', { label, context });
  if (event.verb === 'tracker.reply_assigned') return t('dashboard.meeting.summary.replyAssigned', { label, person: detail.person ?? '', context });
  // A new task is an action of the meeting. It names the person and the due date, as the meeting panel does (audit 2026-10-03, F-18).
  if (event.verb === 'task.created') {
    const dueDate = fieldsOf(event.after).dueDate;
    return actionLine(t, lang, label, detail.lead ?? '', typeof dueDate === 'string' ? dueDate : null);
  }
  if (FEED_EVENT_VERBS.has(event.verb)) {
    const item: FeedItem = { kind: 'event', id: event.id, at: event.createdAt, author: actor, verb: event.verb, targetType: event.targetType, targetId: event.targetId, label, detail, canUndo: false };
    return feedText(item, t);
  }
  return label ? t('dashboard.meeting.summary.other', { label, context }) : t('feed.other', { context });
}

/** The reasons for moved dates, by the story of the change: the comment that asks why carries the dates it explains. */
function reasonsOf(views: readonly EventLineView[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const { event } of views) {
    const after = fieldsOf(event.after);
    if (event.verb === 'comment.created' && !event.undoneBy && after.dates && typeof after.body === 'string') reasons.set(event.correlationId, plainText(after.body));
  }
  return reasons;
}

/**
 * The summary of the meeting: every change since the meeting started, for each project of the meeting in agenda order.
 * `agendaIds` holds every project of the meeting, also the ones that left the agenda, for example a project the meeting closed.
 * A project with no change does not show. The summary can be copied as a table, or posted to the chat of each project.
 * The meeting session keeps the lines that went to each chat (`shared`), so the same lines go there once, also after Exit or a reload.
 */
export function MeetingSummary({ agendaIds, names, startedAt, shared, onShared, onBack }: {
  agendaIds: readonly string[]; names: ReadonlyMap<string, string>; startedAt: string;
  shared: Readonly<Record<string, string>>; onShared: (sent: Record<string, string>) => void; onBack: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const { api } = useRuntime();
  const events = useCall('events.list', { since: startedAt, limit: 500 });
  const chats = useCall('chats.list', {});
  // A project that left the agenda has no row in the schedule, so its name comes from the list of every project.
  const unnamed = agendaIds.some((id) => !names.has(id) && events.data?.some((view) => view.event.projectId === id));
  const everyProject = useCall('projects.list', { status: 'all' }, { enabled: unnamed });

  const groups = useMemo<Group[]>(() => {
    const views = events.data ?? [];
    const reasons = reasonsOf(views);
    // A change and its Undo in this meeting cancel out, so the Undo is not a line either.
    const undos = new Set(views.flatMap(({ event }) => (event.undoneBy ? [event.undoneBy] : [])));
    const byProject = new Map<string, Line[]>();
    // The call lists the newest first. The summary reads from the first change to the last.
    for (const view of [...views].reverse()) {
      const projectId = view.event.projectId;
      if (!projectId || undos.has(view.event.id)) continue;
      const sentence = sentenceOf(view, t, lang);
      if (sentence === null) continue;
      const reason = view.event.verb === 'task.updated' ? reasons.get(view.event.correlationId) : undefined;
      const what = reason ? t('dashboard.meeting.summary.withReason', { line: sentence, reason }) : sentence;
      const owner = view.event.verb === 'task.created' ? view.detail.lead ?? '' : undefined;
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), { id: view.event.id, who: view.actor.name, what, time: view.event.createdAt.slice(11, 16), owner }]);
    }
    const nameOf = (id: string) => names.get(id) ?? everyProject.data?.find((row) => row.project.id === id)?.project.name ?? id;
    return agendaIds.filter((id) => byProject.has(id)).map((id) => ({ projectId: id, name: nameOf(id), lines: byProject.get(id)! }));
  }, [events.data, agendaIds, names, everyProject.data, t, lang]);

  const copy = async () => {
    const table = [
      [t('dashboard.meeting.summary.columns.project'), t('dashboard.meeting.summary.columns.who'), t('dashboard.meeting.summary.columns.what'), t('dashboard.meeting.summary.columns.time')],
      ...groups.flatMap((group) => group.lines.map((line) => [group.name, line.owner ?? line.who, line.what, line.time])),
    ];
    try {
      await navigator.clipboard.writeText(toTsv(table));
      toast.show({ message: t('dashboard.meeting.summary.copied') });
    } catch {
      toast.show({ tone: 'error', message: t('dashboard.meeting.summary.copyFailed') });
    }
  };

  const chatOf = (projectId: string) => chats.data?.find((row) => row.kind === 'project' && row.project?.id === projectId);
  // Share shows only when a project in the summary has a chat the viewer can see.
  const canShare = groups.some((group) => chatOf(group.projectId) !== undefined);
  // Only the projects whose lines changed since they last went to their chat go again (audit 2026-10-03, DSH-4).
  const pending = groups.filter((group) => shared[group.projectId] !== contentOf(group));
  const isShared = canShare && pending.every((group) => chatOf(group.projectId) === undefined);
  const sharedCount = groups.filter((group) => chatOf(group.projectId) !== undefined && shared[group.projectId] === contentOf(group)).length;
  const [sharing, setSharing] = useState(false);
  const running = useRef(false);

  // One message for each project with new lines. A project whose chat the viewer cannot open or post in is skipped.
  // A second press while it runs, or after it went, does not post again.
  const share = async () => {
    if (running.current || isShared) return;
    running.current = true;
    setSharing(true);
    const date = formatDay(todayISO(), lang, 'withWeekday');
    const sent: Record<string, string> = {};
    const skipped: string[] = [];
    for (const group of pending) {
      const chat = chatOf(group.projectId);
      if (!chat) {
        skipped.push(group.name);
        continue;
      }
      const body = [t('dashboard.meeting.summary.shareTitle', { date }), ...group.lines.map((line) => (line.owner !== undefined ? line.what : `${line.who} ${line.what}`))].join('\n');
      try {
        await api.call('chats.send', { conversationId: chat.id, body });
        sent[group.projectId] = contentOf(group);
      } catch {
        // The chat refused the message, so this project is skipped like a project with no chat.
        skipped.push(group.name);
      }
    }
    running.current = false;
    setSharing(false);
    const count = Object.keys(sent).length;
    if (count > 0) onShared(sent);
    // The toast names the projects that got nothing, so nobody thinks the minutes reached every project (audit 2026-10-03, DSH-17).
    const parts = [count === 0 ? t('dashboard.meeting.summary.sharedNone') : counted(t, 'dashboard.meeting.summary.shared', count)];
    if (skipped.length > 0) parts.push(t('dashboard.meeting.summary.notShared', { list: new Intl.ListFormat(localeFor(lang), { type: 'conjunction' }).format(skipped) }));
    toast.show({ message: parts.join(' ') });
  };

  return (
    <section aria-label={t('dashboard.meeting.summary.title')} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onBack}>{t('dashboard.meeting.summary.back')}</Button>
        <div className="me-auto">
          <h2 className="text-[26px] font-bold text-ink">{t('dashboard.meeting.summary.title')}</h2>
          {/* The start of the meeting in office time. A new day starts a new meeting, so the summary never reaches into yesterday. */}
          <p className="tabular text-[17px] text-ink-2">{t('dashboard.meeting.summary.since', { time: startedAt.slice(11, 16) })}</p>
        </div>
        {groups.length > 0 && (
          <>
            <Button onClick={() => void copy()}>{t('dashboard.meeting.summary.copy')}</Button>
            {canShare && (
              <Button variant="primary" disabled={sharing || isShared} onClick={() => void share()}>
                {isShared ? counted(t, 'dashboard.meeting.summary.sharedButton', sharedCount) : t('dashboard.meeting.summary.share')}
              </Button>
            )}
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
                <span className="min-w-0 flex-1">{line.owner === undefined && <><bdi className="font-semibold text-ink">{line.who}</bdi> </>}<span className="text-ink-2">{line.what}</span></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

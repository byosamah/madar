import { useTranslation } from 'react-i18next';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useCall } from '../../../app/runtime';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { BUSY_STATUSES, splitBusy, weekEndOf } from '../../../lib/busyWeek';
import { formatWeekday, todayISO, type Lang } from '../../../lib/dates';
import { shownName } from '../../../lib/projectLabel';

/** How many to-dos the note lists. The others read "and N more". */
const LISTED = 3;

/**
 * The to-dos of a lead that cross a due date (tsk_499, owner, 2026-11-01). One read of `tasks.list` for the lead and the Saturday that
 * ends the week of the due date; the server gives the person only the to-dos that the person may see (hidden projects, private office
 * to-dos). The same lead and week answer from the cache. With no lead or no due date, or with `enabled` false, nothing is read.
 */
export function useBusyWeek({ leadId, due, openId = null, enabled = true }: { leadId: string | null; due: string | null; openId?: string | null; enabled?: boolean }) {
  const ready = enabled && !!leadId && !!due;
  const list = useCall(
    'tasks.list',
    { ownerId: leadId ?? '', status: [...BUSY_STATUSES], includeDone: false, ...(due ? { dueTo: weekEndOf(due) } : {}) },
    { enabled: ready },
  );
  if (!ready || !list.data || !leadId || !due) return { week: [], pastDue: [] };
  return splitBusy(list.data, { leadId, due, today: todayISO(), openId });
}

/** A name inside an Arabic sentence sits in a direction isolate. */
const isolate = (lang: Lang, text: string): string => (lang === 'ar' ? `\u2068${text}\u2069` : text);

/**
 * The quiet note under a due date: "Ibrahim has 3 to-dos due in the same week", up to three of them, a past due line, and the hint.
 * It shows nothing when the lead has nothing that crosses the date. It is no dialog and no control: the person changes the date,
 * or goes on as usual. `sheet` is a new to-do (the hint offers "add it anyway"); `panel` is a change that is already saved.
 */
export function BusyWeekNote({ leadId, due, openId, variant }: { leadId: string | null; due: string | null; openId?: string | null; variant: 'sheet' | 'panel' }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const me = useCall('session.get', {}).data?.authority.id;
  const { week, pastDue } = useBusyWeek({ leadId, due, openId });
  if (week.length === 0 && pastDue.length === 0) return null;
  const owner = (week[0] ?? pastDue[0]).owner;
  const subject = leadId === me || !owner ? t('busyWeek.subjectSelf') : t('busyWeek.subject', { name: isolate(lang, nameOf(owner)) });
  // The subject and the count phrase are two texts, because an Arabic count form takes no other variable. Both languages put the subject first.
  const head = `${subject} ${week.length > 0 ? t('busyWeek.weekCount', { count: week.length }) : t('busyWeek.pastCount', { count: pastDue.length })}`;
  const shown = week.slice(0, LISTED);
  const rest = week.length - shown.length;
  return (
    <div role="status" className="flex flex-col gap-1.5">
      <p className="flex items-start gap-2 text-footnote font-semibold text-attn">
        <AnimatedIcon icon={BadgeAlertIcon} size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>{head}</span>
      </p>
      <div className="flex flex-col gap-1.5 ps-6">
        {shown.length > 0 && (
          <ul className="flex flex-col gap-1">
            {shown.map(({ task, project }) => (
              <li key={task.id} className="flex items-baseline gap-2 text-footnote text-ink-2">
                <span dir="auto" className="min-w-0 flex-1 truncate">{task.title}</span>
                <span dir="auto" className="max-w-[40%] shrink-0 truncate">{project ? shownName(project, lang) : t('office.word')}</span>
                <span className="shrink-0">{formatWeekday(task.dueDate!, lang)}</span>
              </li>
            ))}
          </ul>
        )}
        {rest > 0 && <p className="text-footnote text-ink-2">{t('busyWeek.more', { count: rest })}</p>}
        {week.length > 0 && pastDue.length > 0 && <p className="text-footnote text-attn">{t('busyWeek.pastMore', { count: pastDue.length })}</p>}
        <p className="text-caption text-label-2">{t(variant === 'sheet' ? 'busyWeek.hintSheet' : 'busyWeek.hintPanel')}</p>
      </div>
    </div>
  );
}

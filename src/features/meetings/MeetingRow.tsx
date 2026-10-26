import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeetingRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { ProjectTile } from '../../components/ProjectTile';
import { StatusSign, type SignState } from '../../components/StatusSign';
import { clockFormat, formatDay, now, stampDay, type DayStyle } from '../../lib/dates';
import { phaseOf } from '../../lib/meetings';
import { joinLink, mainAction } from './meetingLinks';
import { shownName } from '../../lib/projectLabel';

/**
 * One meeting in a list (fbk_022): the time, the title, the kind with the project name or the word Office, and the project tile. The
 * Today group shows the time alone; the other groups put the day above it: the weekday and the date for this week, the date for a later
 * or an earlier day, so the column stays narrow in Arabic. A meeting that is on, over or cancelled says so in one
 * quiet word. A press opens the sheet. It takes plain props, so a link change that only opens the sheet renders no row again.
 */
export const MeetingListRow = memo(function MeetingListRow({ row, dayStyle, onOpen }: { row: MeetingRow; dayStyle?: DayStyle; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const phase = phaseOf(row, now());
  return (
    <li>
      <button type="button" onClick={() => onOpen(row.id)} className="pressable flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start transition-colors hover:bg-fill/50">
        <span className="tabular w-20 shrink-0 text-subheadline font-semibold text-ink">
          {dayStyle && <span className="block text-footnote font-normal text-ink-2">{formatDay(stampDay(row.startsAt), lang, dayStyle)}</span>}
          {clockFormat(lang).format(new Date(row.startsAt))}
        </span>
        <span className="min-w-0 flex-1">
          <bdi className={`block truncate text-subheadline font-medium ${phase === 'cancelled' ? 'text-ink-2 line-through' : 'text-ink'}`}>{row.title}</bdi>
          <span className="block truncate text-footnote text-ink-2">
            {t(`meetings.kind.${row.kind}`)} · <bdi>{row.project ? shownName(row.project, lang) : t('office.word')}</bdi>
            {phase === 'now' || phase === 'cancelled' || phase === 'done' ? <> · {t(`meetings.state.${phase}`)}</> : null}
          </span>
        </span>
        {row.project && <ProjectTile id={row.project.id} mark={row.project.mark} shape={row.project.shape} size={28} />}
      </button>
    </li>
  );
});

/** The sign of a meeting that is on, over or cancelled. A meeting that has not started has none. */
const SIGN: Record<'now' | 'done' | 'cancelled', SignState> = { now: 'on_track', done: 'completed', cancelled: 'archived' };

/** The class of the Join anchor: the secondary look of a button. The one navy button of the screen is "New meeting". */
const JOIN = 'pressable inline-flex min-h-11 items-center justify-center rounded-full bg-fill px-5 text-subheadline font-semibold text-ink hover:bg-fill-strong';

/**
 * One meeting as a card on a phone (phone design D). The lines, top to bottom: the kind word with the state sign; the title (two lines at
 * most); the time range, with the day before it outside Today; the place when it is plain text (a link stays off the card, Join and the sheet show
 * it); the project tile and name, or the word Office; the number of people (when above 0) and the repeat line. The info block is one button of 44 px or
 * more that opens the sheet. When the meeting has a Join, a hairline and one secondary anchor "Join" follow. Edit, Cancel and the minutes stay in
 * the sheet, where `viewerCan` decides them.
 * The card takes plain props (`nowMs` is the minute of the list tick) and a stable handler, so a link change that only opens the sheet renders
 * no card again.
 */
export const MeetingCard = memo(function MeetingCard({ row, dayStyle, nowMs, onOpen }: { row: MeetingRow; dayStyle?: DayStyle; nowMs: number; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const at = new Date(nowMs);
  const phase = phaseOf(row, at);
  const clock = clockFormat(lang);
  const range = t('meetings.range', { from: clock.format(new Date(row.startsAt)), to: clock.format(new Date(row.endsAt)) });
  const day = dayStyle ? formatDay(stampDay(row.startsAt), lang, dayStyle) : '';
  const place = row.where.trim() !== '' && joinLink(row.where) === null ? row.where.trim() : '';
  const join = mainAction(row, at, null);
  const repeat = row.repeat
    ? row.repeat.until
      ? t(`series.lineUntil.${row.repeat.every}`, { day: formatDay(row.repeat.until, lang, 'short') })
      : t(`series.line.${row.repeat.every}`)
    : '';
  // A meeting with no other attendee has no line of people ("0 people" would be wrong: the organizer is there).
  const people = row.attendeeCount > 0 ? t('phoneWork.meetings.people', { count: row.attendeeCount }) : '';
  const last = [people, repeat].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" onClick={() => onOpen(row.id)} className="pressable flex min-h-11 w-full flex-col items-start gap-1 px-4 py-3 text-start transition-colors hover:bg-fill/50">
        <span className="flex items-center gap-2 text-footnote text-ink-2">
          {t(`meetings.kind.${row.kind}`)}
          {phase !== 'upcoming' && <StatusSign state={SIGN[phase]}>{t(`meetings.state.${phase}`)}</StatusSign>}
        </span>
        <span dir="auto" className={`line-clamp-2 text-headline ${phase === 'cancelled' ? 'text-ink-2 line-through' : 'text-ink'}`}>{row.title}</span>
        <span className="tabular text-subheadline text-ink">{day && <>{day}{' · '}</>}{range}</span>
        {place && <span dir="auto" className="text-subheadline text-ink-2">{place}</span>}
        <span className="flex items-center gap-2 text-subheadline text-ink-2">
          {row.project && <ProjectTile id={row.project.id} mark={row.project.mark} shape={row.project.shape} size={24} />}
          <bdi className="min-w-0 truncate">{row.project ? shownName(row.project, lang) : t('office.word')}</bdi>
        </span>
        {last && <span className="text-footnote text-ink-2">{last}</span>}
      </button>
      {join?.kind === 'join' && (
        <div className="border-t border-hairline px-4 py-2">
          <a href={join.href} target="_blank" rel="noopener noreferrer" className={JOIN}>{t('meetings.sheet.join')}</a>
        </div>
      )}
    </li>
  );
});

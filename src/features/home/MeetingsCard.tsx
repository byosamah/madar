import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MeetingRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { useIsPhone } from '../../app/useIsPhone';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { clockFormat, now, todayISO } from '../../lib/dates';
import { meetingLink, phaseOf } from '../../lib/meetings';
import { mainAction } from '../meetings/meetingLinks';
import { todayMeetingsInput } from '../meetings/readInputs';

/** The most rows the card shows. Every meeting of the day is one press away in "All meetings". */
const ROWS = 3;

/**
 * "Meetings today" on Home (fbk_022, owner 2026-10-19): my meetings of today that are on or still to come, three rows at most, and one
 * quiet link to all meetings. It draws nothing while it loads and on a day with no such meeting, so Home keeps its one next step.
 * It reads its own list, so a change of the card never renders the rows of Today again.
 * On a phone (Direction D) a row adds the kind and the project under the title, a chevron, and a secondary Join button from 30 minutes
 * before the start. A timer of 60 s draws the card again, so a phone left open shows the Join button with no pull to refresh.
 */
export function MeetingsCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const phone = useIsPhone();
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!phone) return;
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [phone]);
  const list = useCall('meetings.list', todayMeetingsInput(todayISO()));
  const at = now();
  const rows = (list.data ?? []).filter((row) => {
    const phase = phaseOf(row, at);
    return phase === 'upcoming' || phase === 'now';
  });
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="meetings-today-title" className="panel flex flex-col px-3 pb-2 pt-4">
      <h2 id="meetings-today-title" className="px-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t('meetings.home.title')}</h2>
      <ul className="hairline">
        {rows.slice(0, ROWS).map((row) => (
          <li key={row.id} className={phone ? 'relative flex items-center' : undefined}>
            <Link to={meetingLink(row.id)} className={`pressable flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-fill/50${phone ? ' min-w-0 flex-1 after:absolute after:inset-0' : ''}`}>
              <span className="tabular w-20 shrink-0 text-subheadline font-semibold text-ink">{clockFormat(lang).format(new Date(row.startsAt))}</span>
              {phone ? <PhoneTitle row={row} /> : <bdi className="min-w-0 flex-1 truncate text-subheadline text-ink">{row.title}</bdi>}
            </Link>
            {phone && <PhoneEnd row={row} at={at} />}
          </li>
        ))}
      </ul>
      <Link to="/meetings" className="flex min-h-11 items-center px-2 text-subheadline font-semibold text-link">{t('meetings.home.all')}</Link>
    </section>
  );
}

/** The title with the kind and the project under it (one line each). An office meeting names only the kind. */
function PhoneTitle({ row }: { row: MeetingRow }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <bdi className="block min-w-0 truncate text-subheadline text-ink">{row.title}</bdi>
      <span className="block min-w-0 truncate text-footnote text-ink-2">
        {t(`meetings.kind.${row.kind}`)}{row.project && <> · <bdi>{row.project.name}</bdi></>}
      </span>
    </span>
  );
}

/** The Join button (an https place, from 30 minutes before the start) and the chevron. The button sits above the row press area. */
function PhoneEnd({ row, at }: { row: MeetingRow; at: Date }) {
  const { t } = useTranslation();
  const action = mainAction(row, at, null);
  return (
    <>
      {action?.kind === 'join' && (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('phoneToday.joinLabel', { title: row.title })}
          className="pressable relative z-10 flex min-h-11 shrink-0 items-center rounded-full bg-fill px-4 text-subheadline font-semibold text-ink"
        >
          {t('meetings.sheet.join')}
        </a>
      )}
      <AnimatedIcon icon={ChevronRightIcon} size={18} className="pointer-events-none shrink-0 px-1 text-ink-2 rtl:-scale-x-100" aria-hidden />
    </>
  );
}

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { clockFormat, now, todayISO } from '../../lib/dates';
import { meetingLink, phaseOf } from '../../lib/meetings';
import { todayMeetingsInput } from '../meetings/readInputs';

/** The most rows the card shows. Every meeting of the day is one press away in "All meetings". */
const ROWS = 3;

/**
 * "Meetings today" on Home (fbk_022, owner 2026-10-19): my meetings of today that are on or still to come, three rows at most, and one
 * quiet link to all meetings. It draws nothing while it loads and on a day with no such meeting, so Home keeps its one next step.
 * It reads its own list, so a change of the card never renders the rows of Today again.
 */
export function MeetingsCard() {
  const { t } = useTranslation();
  const lang = useLang();
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
          <li key={row.id}>
            <Link to={meetingLink(row.id)} className="pressable flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-fill/50">
              <span className="tabular w-20 shrink-0 text-subheadline font-semibold text-ink">{clockFormat(lang).format(new Date(row.startsAt))}</span>
              <bdi className="min-w-0 flex-1 truncate text-subheadline text-ink">{row.title}</bdi>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/meetings" className="flex min-h-11 items-center px-2 text-subheadline font-semibold text-link">{t('meetings.home.all')}</Link>
    </section>
  );
}

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeetingRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { ProjectTile } from '../../components/ProjectTile';
import { clockFormat, formatDay, now, stampDay, type DayStyle } from '../../lib/dates';
import { phaseOf } from '../../lib/meetings';

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
            {t(`meetings.kind.${row.kind}`)} · <bdi>{row.project ? row.project.name : t('office.word')}</bdi>
            {phase === 'now' || phase === 'cancelled' || phase === 'done' ? <> · {t(`meetings.state.${phase}`)}</> : null}
          </span>
        </span>
        {row.project && <ProjectTile id={row.project.id} mark={row.project.mark} size={28} />}
      </button>
    </li>
  );
});

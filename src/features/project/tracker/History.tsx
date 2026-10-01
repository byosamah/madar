import { useTranslation } from 'react-i18next';
import type { TrackerRow } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { StatusSign } from '../../../components/StatusSign';
import { formatDay, todayISO } from '../../../lib/dates';
import { groupByWeek, isOpen } from '../../../lib/tracker';
import { FileChips } from '../../files/Attachments';
import { DirectionMark, TypeIcon } from './marks';

function Line({ row, onOpen }: { row: TrackerRow; onOpen: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { entry } = row;
  const open = isOpen(entry);
  const closedLoop = entry.waiting !== null && !open;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 hover:bg-fill">
      <button type="button" onClick={onOpen} className="pressable flex min-h-12 min-w-0 flex-1 items-center gap-3 text-start">
        <span className="shrink-0 text-ink-2">
          <TypeIcon type={entry.type} />
          <span className="sr-only">{t(`tracker.type.${entry.type}`)}</span>
        </span>
        <DirectionMark direction={entry.direction} />
        <bdi className="truncate text-body">{entry.title}</bdi>
        {open && <StatusSign state="active">{t('tracker.openMark')}</StatusSign>}
        {closedLoop && <StatusSign state="completed">{t(entry.waiting === 'us' ? 'tracker.answered' : 'tracker.received')}</StatusSign>}
      </button>
      <FileChips files={row.files} />
      <time dateTime={entry.date} className="tabular shrink-0 text-footnote text-ink-2">{formatDay(entry.date, lang)}</time>
    </li>
  );
}

/** Every entry, newest first, in one list per week. A line opens the entry. */
export function History({ rows, onOpen }: { rows: TrackerRow[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const groups = groupByWeek(rows, (row) => row.entry.date, todayISO());
  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => {
        const id = `tracker-week-${group.weekStart}`;
        const title = group.label === 'this' ? t('tracker.thisWeek') : group.label === 'last' ? t('tracker.lastWeek') : t('tracker.weekOf', { date: formatDay(group.weekStart, lang) });
        return (
          <section key={group.weekStart} aria-labelledby={id} className="panel p-2">
            <h3 id={id} className="px-2 pt-1 text-footnote font-semibold text-ink-2">{title}</h3>
            <ul>{group.items.map((row) => <Line key={row.entry.id} row={row} onOpen={() => onOpen(row.entry.id)} />)}</ul>
          </section>
        );
      })}
    </div>
  );
}

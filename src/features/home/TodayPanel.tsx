import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { User } from '../../api/contract/entities';
import type { TaskRow } from '../../api/contract/views';
import { warmDragLayer } from '../project/tasks/dragLayerLoader';
import { SortableTaskRows } from '../project/tasks/SortableTaskRows';

/**
 * My open tasks that are due today or past due (redesign spec 3.2). With none, the panel is "Coming up": my next tasks with a due
 * date (`later`, owner 2026-10-07). With neither, it says that nothing is due today.
 */
export function TodayPanel({ rows, later = [], me, onOpen }: {
  rows: TaskRow[]; later?: TaskRow[]; me: User | undefined; onOpen: (row: TaskRow, thread?: boolean) => void;
}) {
  const { t } = useTranslation();
  // Home is the first screen of everyone. The drag layer of the Today list loads at an idle moment, so the Tasks screen finds it ready (FL-2).
  useEffect(() => { warmDragLayer(); }, []);
  const coming = rows.length === 0 && later.length > 0;
  const shown = coming ? later : rows;
  return (
    <section aria-labelledby="today-title" className="panel flex flex-col px-3 pb-2 pt-4">
      <h2 id="today-title" className="px-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t(coming ? 'home.comingUp' : 'home.today')}</h2>
      {shown.length === 0 && <p className="px-2 py-3 text-subheadline text-ink-2">{t('home.todayClear')}</p>}
      {shown.length > 0 && (
        <SortableTaskRows rows={shown} me={me} onOpen={onOpen} showProject draggable={!coming} listClassName="hairline" />
      )}
      <Link to="/work" className="flex min-h-11 items-center px-2 text-subheadline font-semibold text-link">{t('home.allTasks')}</Link>
    </section>
  );
}

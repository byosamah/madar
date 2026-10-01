import { Clock } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { TaskRowItem } from '../project/tasks/TaskRowItem';

/** My open tasks that are due today or past due, and a reminder to log hours (redesign spec 3.2). */
export function TodayPanel({ rows, logHours, onOpen }: { rows: TaskRow[]; logHours: boolean; onOpen: (row: TaskRow) => void }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="today-title" className="panel flex flex-col px-3 pb-2 pt-4">
      <h2 id="today-title" className="px-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t('home.today')}</h2>
      {rows.length === 0 && !logHours && <p className="px-2 py-3 text-subheadline text-ink-2">{t('home.todayClear')}</p>}
      {rows.length > 0 && (
        <ul className="hairline">
          <AnimatePresence initial={false}>
            {rows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={() => onOpen(row)} showProject />)}
          </AnimatePresence>
        </ul>
      )}
      {logHours && (
        <Link to="/work?tab=hours" className="pressable flex min-h-12 items-center gap-3 border-t border-hairline px-2 text-body text-ink">
          <span className="grid size-11 place-items-center"><Clock size={20} className="text-ink-2" aria-hidden /></span>
          {t('home.logToday')}
        </Link>
      )}
      <Link to="/work" className="flex min-h-11 items-center px-2 text-subheadline font-semibold text-link">{t('home.allTasks')}</Link>
    </section>
  );
}

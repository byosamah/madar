import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { TaskRowItem } from '../project/tasks/TaskRowItem';

/** My open tasks that are due today or past due (redesign spec 3.2). */
export function TodayPanel({ rows, onOpen }: { rows: TaskRow[]; onOpen: (row: TaskRow) => void }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="today-title" className="panel flex flex-col px-3 pb-2 pt-4">
      <h2 id="today-title" className="px-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t('home.today')}</h2>
      {rows.length === 0 && <p className="px-2 py-3 text-subheadline text-ink-2">{t('home.todayClear')}</p>}
      {rows.length > 0 && (
        <ul className="hairline">
          <AnimatePresence initial={false}>
            {rows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={() => onOpen(row)} showProject />)}
          </AnimatePresence>
        </ul>
      )}
      <Link to="/work" className="flex min-h-11 items-center px-2 text-subheadline font-semibold text-link">{t('home.allTasks')}</Link>
    </section>
  );
}

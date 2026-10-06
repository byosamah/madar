import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePersonName } from '../../app/personName';
import { Avatar } from '../../components/Avatar';
import { counted } from '../../lib/grammar';
import { taskLink } from '../../lib/params';
import { projectKey } from '../../lib/projectCode';
import { AttentionCard, ROW } from './AttentionCard';
import type { DashboardData } from './Tiles';

/**
 * The tasks that wait for review, one group for each reviewer, the longest wait first (owner, 2026-10-06). No list shows the
 * reviews of another person (tasks.list review_for_me is the viewer's own), so the tasks show here, and each one opens its task.
 * The card is not there when no task waits.
 */
export function ReviewWaits({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const rows = view.inReview;
  if (rows.length === 0) return null;
  return (
    <AttentionCard title={t('dashboard.inReview.title')} count={rows.reduce((sum, row) => sum + row.count, 0)}>
      {rows.map((row) => {
        const name = nameOf(row.reviewer);
        return (
          <li key={row.reviewer.id} className="flex flex-col py-2">
            <div className="flex min-w-0 items-center gap-2 py-1">
              <Avatar user={row.reviewer} size={24} />
              <span className="min-w-0 flex-1">
                <bdi className="block truncate text-subheadline font-semibold text-ink">{name}</bdi>
                <span className="tabular block truncate text-footnote text-ink-2">
                  {counted(t, 'dashboard.cellTasks', row.count)} · {t('dashboard.inReview.oldest', { days: counted(t, 'dashboard.inReview.age', row.oldestDays) })}
                </span>
              </span>
            </div>
            <ul aria-label={t('dashboard.inReview.of', { name })} className="flex flex-col ps-8">
              {row.tasks.map((task) => (
                <li key={task.id}>
                  <Link to={taskLink(task.projectId, task.id)} className={ROW}>
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate text-subheadline text-ink">{task.title}</bdi>
                      <span className="tabular block truncate text-footnote text-ink-2">
                        {projectKey(task.projectCode)} · {counted(t, 'dashboard.inReview.days', task.days)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </AttentionCard>
  );
}

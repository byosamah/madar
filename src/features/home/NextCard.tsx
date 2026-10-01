import { ArrowRight, Crosshair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import type { NextItem } from '../../lib/home';

/** "Next for you": one thing to do, on the glow (redesign spec 3.2). */
export function NextCard({ item, onOpen, onFocus }: { item: NextItem; onOpen: (projectId: string, taskId: string) => void; onFocus: (taskId: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  let line = t('home.next.clear');
  let context = '';
  let action: { label: string; run: () => void } | null = null;
  if (item.kind === 'hours') {
    line = t('home.next.hours');
    action = { label: t('home.next.logHours'), run: () => navigate('/work?tab=hours') };
  } else if (item.kind !== 'clear') {
    const { task, project } = item.row;
    line = t(item.kind === 'review' ? 'home.next.reviewLine' : `home.next.${item.kind}`, { title: task.title });
    context = project.name;
    action = { label: t(item.kind === 'review' ? 'home.next.review' : 'home.next.open'), run: () => onOpen(project.id, task.id) };
  }
  return (
    <section aria-labelledby="next-title" className="glow flex flex-col gap-1.5 p-5 sm:p-6">
      <h2 id="next-title" className="text-caption font-semibold uppercase tracking-[0.06em] text-[var(--sig-from)] dark:text-[#A5ABFF]">{t('home.next.title')}</h2>
      <p dir="auto" className="text-[calc(19px*var(--boost))] font-semibold leading-snug tracking-[-0.01em] text-ink [text-wrap:balance]">{line}</p>
      {context && <p dir="auto" className="text-subheadline text-ink-2">{context}</p>}
      {action && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={action.run}>
            {action.label}
            <ArrowRight size={16} className="rtl:-scale-x-100" aria-hidden />
          </Button>
          {(item.kind === 'pastDue' || item.kind === 'dueToday' || item.kind === 'continue') && (
            <Button variant="plain" className="px-3" onClick={() => onFocus(item.row.task.id)}>
              <Crosshair size={16} aria-hidden />
              {t('focus.open')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

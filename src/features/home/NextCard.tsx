import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ArrowRightIcon } from '../../components/icons/animated/arrow-right';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import type { NextItem } from '../../lib/home';
import { TimerIcon } from '../../components/icons/animated/timer';

/** "Next for you": one thing to do, on the glow (redesign spec 3.2). */
export function NextCard({ item, onOpen, onFocus, left }: { item: NextItem; onOpen: (projectId: string, taskId: string) => void; onFocus: (taskId: string) => void; left: number | null }) {
  const { t } = useTranslation();
  let line = t('home.next.clear');
  let context = '';
  let action: { label: string; run: () => void } | null = null;
  if (item.kind !== 'clear') {
    const { task, project } = item.row;
    line = t(item.kind === 'review' ? 'home.next.reviewLine' : `home.next.${item.kind}`, { title: task.title });
    context = project.name;
    action = { label: t(item.kind === 'review' ? 'home.next.review' : 'home.next.open'), run: () => onOpen(project.id, task.id) };
  }
  return (
    <section aria-labelledby="next-title" className="glow flex flex-col gap-1.5 overflow-hidden p-5 sm:p-6">
      <h2 id="next-title" className="text-caption font-semibold uppercase tracking-[0.06em] text-[var(--sig-text)]">{t('home.next.title')}</h2>
      {/* Moment 3 (redesign spec 4): the done item lifts away and the next one rises into place. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={item.kind === 'clear' ? 'clear' : `${item.kind}-${item.row.task.id}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { type: 'spring', bounce: 0, duration: 0.48 } }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.26, ease: 'easeIn' } }}
          className="flex flex-col gap-1.5"
        >
          <p dir="auto" className="text-[calc(19px*var(--boost))] font-semibold leading-snug tracking-[-0.01em] text-ink [text-wrap:balance]">{line}</p>
          {context && <p dir="auto" className="text-subheadline text-[var(--c-glow-ink-2)]">{context}</p>}
          {action && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={action.run}>
                {action.label}
                <AnimatedIcon icon={ArrowRightIcon} size={16} className="rtl:-scale-x-100" aria-hidden />
              </Button>
              {(item.kind === 'pastDue' || item.kind === 'dueToday' || item.kind === 'continue') && (
                <Button variant="plain" className="px-3" onClick={() => onFocus(item.row.task.id)}>
                  <AnimatedIcon icon={TimerIcon} size={16} aria-hidden />
                  {t('focus.open')}
                </Button>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {left !== null && <p role="status" className="pt-1 text-footnote font-medium text-[var(--c-glow-ink-2)]">{t('home.next.doneLeft', { count: left, n: left })}</p>}
    </section>
  );
}

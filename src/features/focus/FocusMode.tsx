import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../components/icons/animated/check';
import { CircleCheckIcon } from '../../components/icons/animated/circle-check';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { isWaiting, waitingNames } from '../../lib/waiting';
import type { TaskDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { usePanelOpen } from '../../app/panelOpen';
import { useAction, useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { ProjectTile } from '../../components/ProjectTile';
import { RichText } from '../../components/RichText';
import { spring } from '../../design/motion';
import { FocusTimer } from './FocusTimer';
import { returnFocus, useFocusLink } from './focusLink';
import { CircleIcon } from '../../components/icons/animated/circle';

function FocusPage({ data, onExit }: { data: TaskDetail; onExit: (done?: boolean) => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const { task, project } = data;
  const [finished, setFinished] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const exitTimer = useRef(0);
  const [items, setItems] = useState(task.checklist);
  const update = useAction('tasks.update');
  const complete = useUndoable('tasks.complete', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.completed')),
    onSuccess: () => {
      setFinished(true);
      exitTimer.current = window.setTimeout(() => onExit(true), 600);
    },
  });
  const lang = useLang();
  // A task that waits for another task or a stage cannot be finished yet, so Done hides and a word says why (audit PER-9).
  const waiting = isWaiting(data);
  const canDone = data.canMove && !waiting && task.status !== 'done' && task.status !== 'in_review';
  // A helper may tick the checklist, as in the task panel (spec 5.1, audit PER-6).
  const edit = data.viewerCan.contribute;
  // One clear state word when there is no Done: done, in review, waiting, or who finishes it (a helper sees the lead).
  const state = task.status === 'done' ? t('taskStatus.done')
    : task.status === 'in_review' ? t('taskStatus.in_review')
    : waiting ? t('tasks.waitingFor', { names: waitingNames(data, lang) })
    : !data.canMove ? `${t('taskSheet.owner')}: ${data.owner ? nameOf(data.owner) : t('lead.noLead')}`
    : null;
  useEffect(() => setItems(task.checklist), [task.checklist]);
  // Focus moves into the page at once; a late exit after Done never fires once the page is gone.
  useEffect(() => {
    page.current?.querySelector<HTMLElement>('[data-focus-start]')?.focus();
    return () => window.clearTimeout(exitTimer.current);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);
  const tick = (id: string, done: boolean) => {
    const next = items.map((item) => (item.id === id ? { ...item, done } : item));
    setItems(next);
    update.mutate({ id: task.id, patch: { checklist: next } });
  };
  return (
    <div ref={page} className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] sm:pt-16">
      <div className="flex items-center gap-3">
        {/* An office task has no project: the word Office takes its place (owner, 2026-10-06). */}
        {project ? (
          <span className="flex min-w-0 items-center gap-3">
            <ProjectTile id={project.id} mark={project.mark} size={32} />
            <bdi className="truncate text-subheadline font-semibold text-ink-2">{project.name}</bdi>
          </span>
        ) : <span className="text-subheadline font-semibold text-ink-2">{t('office.word')}</span>}
      </div>
      <div className="flex flex-col gap-4">
        <p className="text-footnote font-semibold uppercase tracking-[0.06em] text-[var(--sig-text)]">{t('focus.label')}</p>
        <h1 dir="auto" className={`text-page-title [text-wrap:balance] transition-colors duration-300 ${finished ? 'text-ink-2' : 'text-ink'}`}>
          <AnimatePresence>
            {finished && (
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.flick} className="me-3 inline-grid size-9 place-items-center rounded-full bg-done align-middle text-panel">
                <AnimatedIcon icon={CheckIcon} size={20} aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
          {task.title}
        </h1>
        {state && <p className="text-subheadline font-semibold text-ink-2"><bdi>{state}</bdi></p>}
        {task.description && <div dir="auto" className="text-body text-ink-2"><RichText body={task.description} /></div>}
      </div>
      {items.length > 0 && (
        <section aria-labelledby="focus-checklist" className="panel flex flex-col px-3 py-2">
          <h2 id="focus-checklist" className="px-2 pb-1 pt-2 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2">{t('taskSheet.checklist')}</h2>
          <ul className="hairline">
            {items.map((item) => (
              <li key={item.id} className="flex min-h-12 items-center gap-3 px-2">
                {edit ? (
                  <input type="checkbox" aria-label={item.text} checked={item.done} onChange={(event) => tick(item.id, event.target.checked)} className="size-5 shrink-0 accent-[var(--sig-from)]" />
                ) : item.done ? <AnimatedIcon icon={CircleCheckIcon} size={20} className="shrink-0 text-link" aria-label={t('common.done')} /> : <AnimatedIcon icon={CircleIcon} size={20} className="shrink-0 text-ink-2" aria-hidden />}
                <span dir="auto" className={`min-w-0 flex-1 text-body ${item.done ? 'text-ink-2 line-through' : 'text-ink'}`}>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <FocusTimer />
      <div className="flex flex-wrap items-center justify-center gap-3">
        {canDone && <Button data-focus-start variant="primary" className="min-w-36" disabled={complete.isPending || finished} onClick={() => complete.mutate({ id: task.id })}>{t('focus.done')}</Button>}
        <Button data-focus-start={canDone ? undefined : true} variant="plain" onClick={() => onExit()}>{t('focus.exit')}</Button>
      </div>
    </div>
  );
}

/** Focus mode (redesign spec 5.1): one task on a calm full page. The page behind steps back while it is open. */
export function FocusMode() {
  const { t } = useTranslation();
  const { taskId, close } = useFocusLink();
  const task = useCall('tasks.get', { id: taskId ?? '' }, { enabled: taskId !== null });
  usePanelOpen(taskId !== null);
  const visible = taskId !== null && task.data !== undefined;
  // While Focus mode shows, the page and the tab pill behind it take no focus and no clicks (aria-modal).
  useEffect(() => {
    if (!visible) return;
    const behind = [...document.querySelectorAll<HTMLElement>('.app-page, nav[data-pill]')];
    for (const element of behind) element.inert = true;
    return () => {
      for (const element of behind) element.inert = false;
      returnFocus();
    };
  }, [visible]);
  useEffect(() => {
    if (taskId && task.error) close();
  }, [taskId, task.error, close]);
  return createPortal(
    <AnimatePresence>
      {taskId && task.data && (
        <motion.div
          key="focus"
          role="dialog"
          aria-modal="true"
          aria-label={t('focus.label')}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
          className="fixed inset-0 z-[70] overflow-y-auto bg-[linear-gradient(180deg,var(--c-page-top),var(--c-page-bottom))]"
        >
          <FocusPage data={task.data} onExit={close} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

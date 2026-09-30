import { Circle, CircleCheck, CircleDot, Flag, MessageCircle, Paperclip } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { spring } from '../../../design/motion';
import { formatDay } from '../../../lib/dates';

/**
 * One task: the tick, the title, the due date (red when overdue), the flag and the counts (spec 5.3).
 * A tick fills the circle at once, and the call runs after 0.5 s, so the row slides away then (spec 5.5).
 */
export function TaskRowItem({ row, onOpen, showProject = false }: { row: TaskRow; onOpen: (taskId: string) => void; showProject?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [ticking, setTicking] = useState(false);
  const complete = useUndoable('tasks.complete', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.completed')),
  });
  const { task } = row;
  const done = task.status === 'done';
  const inReview = task.status === 'in_review';
  const canTick = row.canMove && !done && !inReview;
  const tick = () => {
    if (!canTick || ticking) return;
    setTicking(true);
    window.setTimeout(() => complete.mutate({ id: task.id }, { onSettled: () => setTicking(false) }), 500);
  };
  const rtl = document.documentElement.dir === 'rtl';
  return (
    <motion.li layout exit={{ opacity: 0, x: rtl ? -24 : 24 }} transition={spring.standard} className="flex min-h-14 items-center gap-2 px-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done || ticking}
        aria-label={t('tasks.complete', { title: task.title })}
        disabled={!canTick}
        onClick={tick}
        className="pressable grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-60"
      >
        {done || ticking
          ? <CircleCheck size={22} className="text-accent" aria-hidden />
          : inReview ? <CircleDot size={22} className="text-orange" aria-hidden /> : <Circle size={22} className="text-label-3" aria-hidden />}
      </button>
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 py-2 text-start">
        <span dir="auto" className={`block truncate text-body ${done ? 'text-label-2 line-through' : ''}`}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-label-2">
          {(task.status === 'in_progress' || inReview) && <span>{t(`taskStatus.${task.status}`)}</span>}
          {task.dueDate && (
            <span className={`tabular ${row.overdue ? 'font-medium text-red-text' : ''}`}>
              {formatDay(task.dueDate, lang)}{row.overdue && ` · ${t('tasks.overdue')}`}
            </span>
          )}
          {task.flagged && <span className="inline-flex items-center gap-1 text-orange-text"><Flag size={12} aria-hidden />{t('tasks.flagged')}</span>}
          {row.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageCircle size={12} aria-hidden />{t('tasks.comments', { n: row.commentCount })}</span>}
          {row.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} aria-hidden />{t('tasks.files', { n: row.fileCount })}</span>}
        </span>
      </button>
      {showProject
        ? <span className="tabular shrink-0 pe-2 text-footnote text-label-2">{row.project.code}</span>
        : <Avatar user={row.owner} size={28} />}
    </motion.li>
  );
}

import { Circle, CircleCheck, CircleDot, Flag, MessageCircle, Paperclip } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { ProjectTile } from '../../../components/ProjectTile';
import { StateWord } from '../../../components/StateWord';
import { spring } from '../../../design/motion';
import { todayISO } from '../../../lib/dates';
import { dueText, dueWord } from '../../../lib/due';

/**
 * One task: the round tick, the title, a gentle due word, and the flag and counts only when there are some (redesign spec 3.4).
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
  const word = dueWord(task.dueDate, todayISO(), task.status);
  const when = word && task.dueDate ? dueText(word, t, lang, task.dueDate) : null;
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
          ? <CircleCheck size={22} className="text-[var(--sig-from)] dark:text-[#A5ABFF]" aria-hidden />
          : inReview ? <CircleDot size={22} className="text-attn" aria-hidden /> : <Circle size={22} strokeWidth={1.75} className="text-ink-2" aria-hidden />}
      </button>
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 py-2 text-start">
        <span dir="auto" className={`block truncate text-[calc(15px*var(--boost))] font-medium ${done ? 'text-ink-2 line-through' : 'text-ink'}`}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-footnote text-ink-2">
          {(task.status === 'in_progress' || inReview) && <span>{t(`taskStatus.${task.status}`)}</span>}
          {when && (word?.tone === 'attn' ? <StateWord tone="attn">{when}</StateWord> : <span className="tabular">{when}</span>)}
          {task.flagged && <span className="inline-flex items-center gap-1 text-attn"><Flag size={12} aria-hidden />{t('tasks.flagged')}</span>}
          {row.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageCircle size={12} aria-hidden />{t('tasks.comments', { n: row.commentCount })}</span>}
          {row.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} aria-hidden />{t('tasks.files', { n: row.fileCount })}</span>}
          {showProject && <bdi className="truncate">{row.project.name}</bdi>}
        </span>
      </button>
      {showProject
        ? <span className="pe-2"><ProjectTile id={row.project.id} name={row.project.name} size={28} /></span>
        : <span className="pe-1"><Avatar user={row.owner} size={26} /></span>}
    </motion.li>
  );
}

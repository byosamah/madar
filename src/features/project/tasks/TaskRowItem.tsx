import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CircleCheckIcon } from '../../../components/icons/animated/circle-check';
import { MessageCircleIcon } from '../../../components/icons/animated/message-circle';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { AvatarStack } from '../../../components/AvatarStack';
import { ProjectTile } from '../../../components/ProjectTile';
import { StatusSign } from '../../../components/StatusSign';
import { spring } from '../../../design/motion';
import { todayISO } from '../../../lib/dates';
import { dueText, dueWord, startsLater, startsText } from '../../../lib/due';
import { actorContext } from '../../../lib/grammar';
import { helpersOf, versionOf } from '../../../lib/taskPeople';
import { isWaiting, waitingNames } from './waiting';
import { PauseIcon } from '../../../components/icons/animated/pause';
import { CircleIcon } from '../../../components/icons/animated/circle';
import { CircleDashedIcon } from '../../../components/icons/animated/circle-dashed';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { AttachFileIcon } from '../../../components/icons/animated/attach-file';

/**
 * One task: the round tick, the title, a gentle due word, and the flag and counts only when there are some (redesign spec 3.4).
 * A tick fills the circle at once, and the call runs after 0.5 s, so the row slides away then (spec 5.5).
 */
export function TaskRowItem({ row, onOpen, showProject = false }: { row: TaskRow; onOpen: (taskId: string, thread?: boolean) => void; showProject?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const [ticking, setTicking] = useState(false);
  const complete = useUndoable('tasks.complete', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.completed')),
  });
  const { task } = row;
  // A helper cannot finish the task, so the row says that they help and who leads it (audit 2026-10-03, V-35).
  const me = useCall('session.get', {}).data?.authority;
  const helping = Boolean(me && task.ownerId !== me.id && helpersOf(task).includes(me.id));
  const done = task.status === 'done';
  const inReview = task.status === 'in_review';
  const canTick = row.canMove && !done && !inReview;
  // A task that waits for another task or stage cannot be finished. The tick stays focusable and says why, in its name and in a toast.
  const waiting = !done && isWaiting(row);
  const names = waiting ? waitingNames(row, lang) : '';
  const tick = () => {
    if (!canTick || ticking) return;
    if (waiting) {
      toast.show({ message: t('tasks.waitingToast', { names }) });
      return;
    }
    setTicking(true);
    window.setTimeout(() => complete.mutate({ id: task.id }, { onSettled: () => setTicking(false) }), 500);
  };
  const rtl = document.documentElement.dir === 'rtl';
  const word = dueWord(task.dueDate, todayISO(), task.status);
  const starts = startsLater(task.startDate, todayISO(), task.status);
  const when = starts ? startsText(task.startDate as string, t, lang) : word && task.dueDate ? dueText(word, t, lang, task.dueDate) : null;
  return (
    // Moments 2 and 8 (redesign spec 4): a ticked row slides out toward the end side; a row that Undo brings back slides in from there.
    <motion.li
      layout="position"
      initial={{ opacity: 0, x: rtl ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: rtl ? -32 : 32 }}
      transition={{ ...spring.standard, duration: 0.46 }}
      className="flex min-h-14 items-center gap-2 rounded-xl px-2 transition-colors hover:bg-fill/50"
    >
      {/* A person who cannot tick gets a plain mark, not a dead button (spec 2.3; audit 2026-10-03, BRW-13). */}
      {canTick ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={ticking}
          aria-label={waiting ? t('tasks.completeBlocked', { title: task.title, names }) : t('tasks.complete', { title: task.title })}
          aria-disabled={waiting ? true : undefined}
          onClick={tick}
          className={`pressable grid size-11 shrink-0 place-items-center rounded-full ${waiting ? 'opacity-60' : ''}`}
        >
          <motion.span
            animate={ticking ? { scale: [1, 0.82, 1] } : { scale: 1 }}
            transition={{ duration: 0.42, times: [0, 0.35, 1], ease: 'easeOut' }}
            className="grid place-items-center"
          >
            {ticking
              ? <AnimatedIcon icon={CircleCheckIcon} size={22} className="text-[var(--sig-from)]" aria-hidden />
              : <AnimatedIcon icon={CircleIcon} size={22} className="text-ink-2" aria-hidden />}
          </motion.span>
        </button>
      ) : (
        <span className="grid size-11 shrink-0 place-items-center">
          {done
            ? <AnimatedIcon icon={CircleCheckIcon} size={22} className="text-[var(--sig-from)]" aria-hidden />
            : inReview ? <AnimatedIcon icon={CircleDashedIcon} size={22} className="text-attn" aria-hidden /> : <AnimatedIcon icon={CircleIcon} size={22} className="text-ink-2/60" aria-hidden />}
          {done && <span className="sr-only">{t('common.done')}</span>}
        </span>
      )}
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 py-2 text-start">
        <span className="flex items-center gap-2">
          <span dir="auto" className={`block min-w-0 truncate text-[calc(15px*var(--boost))] font-medium transition-colors duration-300 ${done ? 'text-ink-2 line-through' : ticking ? 'text-ink-2' : 'text-ink'}`}>{task.title}</span>
          {versionOf(task) > 1 && (
            <span title={t('tasks.versionLabel', { n: versionOf(task) })} className="tabular shrink-0 rounded-full bg-fill px-1.5 text-caption font-semibold text-ink-2">
              <span aria-hidden>{t('tasks.versionBadge', { n: versionOf(task) })}</span>
              <span className="sr-only">{t('tasks.versionLabel', { n: versionOf(task) })}</span>
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-footnote text-ink-2">
          {helping && <span dir="auto" className="min-w-0 truncate">{t('tasks.helperLine', { name: row.owner.name, context: actorContext(me) })}</span>}
          {(task.status === 'in_progress' || inReview) && <span>{t(`taskStatus.${task.status}`)}</span>}
          {when && (!starts && word?.tone === 'attn' ? <StatusSign state="late">{when}</StatusSign> : <span className="tabular">{when}</span>)}
          {waiting && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <AnimatedIcon icon={PauseIcon} size={12} className="shrink-0" aria-hidden />
              <span dir="auto" className="truncate">{t('tasks.waitingFor', { names })}</span>
            </span>
          )}
          {task.flagged && <span className="inline-flex items-center gap-1 text-attn"><AnimatedIcon icon={BadgeAlertIcon} size={12} aria-hidden />{t('tasks.flagged')}</span>}
          {row.fileCount > 0 && <span className="inline-flex items-center gap-1"><AnimatedIcon icon={AttachFileIcon} size={12} aria-hidden />{t('tasks.files', { n: row.fileCount })}</span>}
          {showProject && <bdi className="truncate">{row.project.name}</bdi>}
        </span>
      </button>
      {/* The task's conversation, one press away (owner, 2026-10-01). The count shows when there are comments. */}
      <button
        type="button"
        onClick={() => onOpen(task.id, true)}
        aria-label={row.commentCount > 0 ? `${t('tasks.openConversation', { title: task.title })}, ${t('tasks.comments', { n: row.commentCount })}` : t('tasks.openConversation', { title: task.title })}
        className="pressable relative grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-fill hover:text-ink"
      >
        <AnimatedIcon icon={MessageCircleIcon} size={18} aria-hidden />
        {row.commentCount > 0 && (
          <span aria-hidden className="tabular absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-semibold leading-none text-panel">{row.commentCount}</span>
        )}
      </button>
      {showProject
        ? <span className="pe-2"><ProjectTile id={row.project.id} mark={row.project.mark} size={22} /></span>
        : <span className="pe-1">{row.helpers.length > 0
          ? <AvatarStack leader={row.owner} team={row.helpers} max={3} size={20} leaderSize={28} />
          : <Avatar user={row.owner} size={26} />}</span>}
    </motion.li>
  );
}

import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CircleCheckIcon } from '../../../components/icons/animated/circle-check';
import { MessageCircleIcon } from '../../../components/icons/animated/message-circle';
import { motion } from 'motion/react';
import { memo, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useToast } from '../../../app/toasts';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { ProjectTile } from '../../../components/ProjectTile';
import { StatusSign } from '../../../components/StatusSign';
import { spring } from '../../../design/motion';
import { todayISO } from '../../../lib/dates';
import { dueText, dueWord, startsLater, startsText } from '../../../lib/due';
import { actorContext } from '../../../lib/grammar';
import { helpersOf, versionOf } from '../../../lib/taskPeople';
import { isWaiting, waitingNames } from '../../../lib/waiting';
import { PauseIcon } from '../../../components/icons/animated/pause';
import { CircleIcon } from '../../../components/icons/animated/circle';
import { CircleDashedIcon } from '../../../components/icons/animated/circle-dashed';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { AttachFileIcon } from '../../../components/icons/animated/attach-file';
import { TaskPeople } from './TaskPeople';
import { shownName } from '../../../lib/projectLabel';

/** A mark that no translation contains. It shows where the name sits in a translated line. */
const NAME_MARK = '\u0001';

/**
 * "Helper · Lead: <name>". The name sits in its own box, so a narrow line wraps before the name, and a name too long for the
 * whole line is cut at its own end. One truncated Arabic line cut the start of a Latin name instead (audit 2026-10-03, F-7).
 */
function HelperLine({ name, context }: { name: string; context: string | undefined }) {
  const { t } = useTranslation();
  const [before, after = ''] = t('tasks.helperLine', { name: NAME_MARK, context }).split(NAME_MARK);
  return (
    <span dir="auto" className="min-w-0">
      {before}<bdi className="inline-block max-w-full truncate align-bottom">{name}</bdi>{after}
    </span>
  );
}

/**
 * The parts that the sortable list of the Tasks screen gives a row (owner, 2026-10-07): the box that the drag moves, its style,
 * and the grip at the end. `still` turns off the slide of the row while a drag runs, so the two motions do not fight.
 * `listeners` is set only on a touch phone (phone design D): the whole row then starts the drag with a press and hold of 400 ms.
 */
export type RowDrag = {
  ref?: (node: HTMLElement | null) => void; style?: CSSProperties; lifted: boolean; still: boolean; grip: ReactNode;
  listeners?: Pick<HTMLAttributes<HTMLElement>, 'onMouseDown' | 'onTouchStart'>;
};

// A row that a finger can hold: it lets the page scroll, keeps the text from selecting, and shows no callout menu of the browser.
const HOLDABLE = 'touch-manipulation pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]';
// The lift of a held row. The CSS `scale` property does not clash with the `transform` of dnd-kit. The curve is the drop curve of the Board.
const LIFT = 'scale-[1.02] transition-[scale] duration-[350ms] ease-[cubic-bezier(0.2,0.9,0.3,1.15)] motion-reduce:scale-100 motion-reduce:transition-none';

/**
 * One task: the round tick, the title, a gentle due word, and the flag and counts only when there are some (redesign spec 3.4).
 * A tick fills the circle at once, and the call runs after 0.5 s, so the row slides away then (spec 5.5).
 * "me" is the person who looks at the list (the authority of session.get). The list asks for it once and gives it to each row,
 * so a long list does not hold one session.get for each row (cleanup 2026-10-06).
 * The row is memoized (performance audit 2026-10-21, RN-5): a list that reloads for one changed task renders only that row. So `onOpen`
 * takes the row (the caller gives one stable handler, never a closure for each row), and the list gives `today`: a row never reads the
 * clock alone, so a new day still gives new due words at the next render of the list. Without `today` the row reads the clock.
 */
export const TaskRowItem = memo(function TaskRowItem({ row, me, onOpen, showProject = false, drag, today }: {
  row: TaskRow; me: User | undefined; onOpen: (row: TaskRow, thread?: boolean) => void; showProject?: boolean; drag?: RowDrag; today?: string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const toast = useToast();
  const [ticking, setTicking] = useState(false);
  const complete = useUndoable('tasks.complete', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.completed')),
  });
  const { task } = row;
  // A helper cannot finish the task, so the row says that they help and who leads it (audit 2026-10-03, V-35).
  const helping = Boolean(me && task.ownerId !== me.id && helpersOf(task).includes(me.id));
  const done = task.status === 'done';
  const inReview = task.status === 'in_review';
  const canTick = row.canMove && !done && !inReview;
  // A task that waits for another task or stage cannot be finished. The tick stays focusable and says why, in its name and in a toast.
  const waiting = !done && isWaiting(row);
  const names = waiting ? waitingNames(row, lang) : '';
  // A task with no lead cannot be finished either, so its tick says the same way that it needs a lead (owner, 2026-10-05).
  const noLead = row.owner === null;
  const blocked = waiting || noLead;
  const tick = () => {
    if (!canTick || ticking) return;
    if (noLead) {
      toast.show({ message: t('lead.needsLeadToast') });
      return;
    }
    if (waiting) {
      toast.show({ message: t('tasks.waitingToast', { names }) });
      return;
    }
    setTicking(true);
    window.setTimeout(() => complete.mutate({ id: task.id }, { onSettled: () => setTicking(false) }), 500);
  };
  const holdable = Boolean(drag?.listeners);
  const rtl = document.documentElement.dir === 'rtl';
  const day = today ?? todayISO();
  const word = dueWord(task.dueDate, day, task.status);
  const starts = startsLater(task.startDate, day, task.status);
  const when = starts ? startsText(task.startDate as string, t, lang) : word && task.dueDate ? dueText(word, t, lang, task.dueDate) : null;
  return (
    // Moments 2 and 8 (redesign spec 4): a ticked row slides out toward the end side; a row that Undo brings back slides in from there.
    <motion.li
      layout={drag?.still ? false : 'position'}
      initial={{ opacity: 0, x: rtl ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: rtl ? -32 : 32 }}
      transition={{ ...spring.standard, duration: 0.46 }}
      className="rounded-xl transition-colors hover:bg-fill/50"
    >
      {/* The drag moves this box, so the slide of the row and the drag never set the same transform. */}
      {/* A long press on a touch screen can fire a context menu, so a held row stops it. */}
      <div
        ref={drag?.ref}
        style={drag?.style}
        {...drag?.listeners}
        onContextMenu={holdable ? (event) => event.preventDefault() : undefined}
        className={`flex min-h-14 items-center gap-2 rounded-xl px-2 ${holdable ? HOLDABLE : ''} ${drag?.lifted ? `surface relative z-10 shadow-float ${holdable ? LIFT : ''}` : ''}`}
      >
        {/* A person who cannot tick gets a plain mark, not a dead button (spec 2.3; audit 2026-10-03, BRW-13). */}
        {canTick ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={ticking}
            aria-label={noLead ? t('lead.completeNeedsLead', { title: task.title })
              : waiting ? t('tasks.completeBlocked', { title: task.title, names }) : t('tasks.complete', { title: task.title })}
            aria-disabled={blocked ? true : undefined}
            onClick={tick}
            className={`pressable grid size-11 shrink-0 place-items-center rounded-full ${blocked ? 'opacity-60' : ''}`}
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
        <button type="button" onClick={() => onOpen(row)} className="min-w-0 flex-1 py-2 text-start">
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
            {helping && row.owner && <HelperLine name={nameOf(row.owner)} context={actorContext(me)} />}
            {(task.status === 'in_progress' || inReview) && <span>{t(`taskStatus.${task.status}`)}</span>}
            {when && (!starts && word?.tone === 'attn' ? <StatusSign state="late" wrap>{when}</StatusSign> : <span className="tabular">{when}</span>)}
            {waiting && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <AnimatedIcon icon={PauseIcon} size={12} className="shrink-0" aria-hidden />
                <span dir="auto" className="truncate">{t('tasks.waitingFor', { names })}</span>
              </span>
            )}
            {task.flagged && <span className="inline-flex items-center gap-1 text-attn"><AnimatedIcon icon={BadgeAlertIcon} size={12} aria-hidden />{t('tasks.flagged')}</span>}
            {row.fileCount > 0 && <span className="inline-flex items-center gap-1"><AnimatedIcon icon={AttachFileIcon} size={12} aria-hidden />{t('tasks.files', { n: row.fileCount })}</span>}
            {/* An office task shows the word Office where a project shows (owner, 2026-10-06). */}
            {showProject && (row.project ? <bdi className="truncate">{shownName(row.project, lang)}</bdi> : <span>{t('office.word')}</span>)}
          </span>
        </button>
        {/* The task's conversation, one press away (owner, 2026-10-01). The count shows when there are comments. */}
        <button
          type="button"
          onClick={() => onOpen(row, true)}
          aria-label={row.commentCount > 0 ? `${t('tasks.openConversation', { title: task.title })}, ${t('tasks.comments', { n: row.commentCount })}` : t('tasks.openConversation', { title: task.title })}
          className="pressable relative grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-fill hover:text-ink"
        >
          <AnimatedIcon icon={MessageCircleIcon} size={18} aria-hidden />
          {row.commentCount > 0 && (
            <span aria-hidden className="tabular absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-semibold leading-none text-panel">{row.commentCount}</span>
          )}
        </button>
        {showProject && row.project
          ? <span className="pe-2"><ProjectTile id={row.project.id} mark={row.project.mark} size={22} /></span>
          : <span className="pe-1"><TaskPeople row={row} /></span>}
        {drag?.grip}
      </div>
    </motion.li>
  );
});

import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../../app/lang';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CircleCheckIcon } from '../../../components/icons/animated/circle-check';
import { PauseIcon } from '../../../components/icons/animated/pause';
import { fade } from '../../../design/motion';
import { waitingNames } from '../../../lib/waiting';
import { nextStep } from './nextStep';
import { JoinBlock, ReviewBlock, TakeBlock, type StepLook } from './StepBlocks';
import { NewVersion } from './TaskVersions';
import type { TaskPanel } from './useTaskPanel';

const QUIET = 'rounded-2xl bg-fill p-3 text-footnote text-ink-2';
const MAIN = 'min-h-[52px] w-full';
const HINT = 'text-footnote text-ink-2';

/**
 * The one next step of a to-do on a phone, in one slot. `nextStep` picks the answer; this part draws it. One main button at most. In the
 * Conversation view `demote` turns the main button secondary, because the Send button of the comment box is the main button there. The slot
 * takes no space when no step applies, and it changes with the usual fade.
 */
export function NextStep({ panel, demote = false }: { panel: TaskPanel; demote?: boolean }) {
  const step = nextStep(panel.data, panel.viewerCan, panel.makerId);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {step && (
        <motion.div key={step.kind} data-next-step={step.kind} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
          <Step kind={step.kind} word={step.completeWord} panel={panel} demote={demote} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Step({ kind, word, panel, demote }: { kind: NonNullable<ReturnType<typeof nextStep>>['kind']; word?: 'markDone' | 'sendToReview'; panel: TaskPanel; demote: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { task, detail, complete } = panel;
  const main = demote ? 'secondary' : 'primary';
  const look: StepLook = { variant: main, className: MAIN, hint: HINT };
  // The press flag shuts a second tap at once. The pending flag of the call follows one render later.
  const pressed = useRef(false);
  switch (kind) {
    case 'review':
      return <ReviewBlock panel={panel} look={look} />;
    case 'take':
      return <TakeBlock panel={panel} look={look} />;
    case 'complete':
      return (
        <Button
          variant={main}
          className={MAIN}
          disabled={complete.isPending}
          onClick={() => {
            if (pressed.current || complete.isPending) return;
            pressed.current = true;
            complete.mutate({ id: task.id }, { onSettled: () => { pressed.current = false; } });
          }}
        >
          <motion.span
            animate={complete.isPending ? { scale: [1, 0.82, 1] } : { scale: 1 }}
            transition={{ duration: 0.42, times: [0, 0.35, 1], ease: 'easeOut' }}
            className="grid place-items-center"
          >
            <AnimatedIcon icon={CircleCheckIcon} size={20} aria-hidden />
          </motion.span>
          {t(word === 'sendToReview' ? 'phoneTask.sendToReview' : 'phoneTask.markDone')}
        </Button>
      );
    case 'waiting':
      return (
        <p className={`${QUIET} flex items-center gap-2`}>
          <AnimatedIcon icon={PauseIcon} size={14} className="shrink-0" aria-hidden />
          <span dir="auto" className="min-w-0">{t('tasks.waitingFor', { names: waitingNames(panel.data, lang) })}</span>
        </p>
      );
    case 'needs_lead':
      return <p className={QUIET}>{t('lead.needsLeadToast')}</p>;
    case 'wait_approval':
      return <p className={QUIET}>{t('tasks.waitsForApproval')}</p>;
    case 'new_version':
      return <NewVersion key={task.version ?? 1} task={task} />;
    case 'join':
      return <JoinBlock panel={panel} look={look} />;
    case 'none':
      return <p className={QUIET}>{t(detail ? 'taskSheet.readOnly' : 'office.readOnly')}</p>;
  }
}

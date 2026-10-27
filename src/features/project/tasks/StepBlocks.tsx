import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { TextArea } from '../../../components/Fields';
import type { TaskPanel } from './useTaskPanel';

/** How a block draws its main button and its hint. The desk and the phone differ in these classes only. */
export type StepLook = { variant: 'primary' | 'secondary'; className?: string; hint: string };

/**
 * For the person who reviews a task in review, Approve and Send back are the one next step, so they come first (audit 2026-10-03, PRJ-8).
 * After "Send back with a note" on the board, the note takes the focus, Send back is the main button and Approve steps back to the end
 * (audit 2026-10-03, F-8).
 */
export function ReviewBlock({ panel, look }: { panel: TaskPanel; look: StepLook }) {
  const { t } = useTranslation();
  const { task, noteFirst, approve, sendBack, note, setNote, reviewBlock } = panel;
  const approveTask = () => approve.mutate({ id: task.id });
  return (
    <section ref={reviewBlock} aria-label={t('taskSheet.review')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
      {!noteFirst && <Button variant={look.variant} className={look.className} disabled={approve.isPending} onClick={approveTask}>{t('taskSheet.approve')}</Button>}
      <TextArea id="task-note" label={t('taskSheet.sendBackNote')} value={note} dir="auto" onChange={(event) => setNote(event.target.value)} />
      <Button variant={noteFirst ? look.variant : 'secondary'} className={noteFirst ? look.className : undefined} disabled={!note.trim() || sendBack.isPending} onClick={() => sendBack.mutate({ id: task.id, note: note.trim() })}>{t('taskSheet.sendBack')}</Button>
      {noteFirst && <Button disabled={approve.isPending} onClick={approveTask}>{t('taskSheet.approve')}</Button>}
    </section>
  );
}

/** A task with no lead: one next step, Take it (owner, 2026-10-05). Nobody can finish the task before it has a lead. */
export function TakeBlock({ panel, look }: { panel: TaskPanel; look: StepLook }) {
  const { t } = useTranslation();
  const { task, take } = panel;
  return (
    <section aria-label={t('lead.noLead')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
      <p className={look.hint}>{t('lead.takeHint')}</p>
      <Button variant={look.variant} className={look.className} disabled={take.isPending} onClick={() => take.mutate({ taskId: task.id })}>{t('lead.takeIt')}</Button>
    </section>
  );
}

/** A team member who neither leads nor helps joins as a helper in one press, so their part shows on the task (fbk_035). */
export function JoinBlock({ panel, look }: { panel: TaskPanel; look: StepLook }) {
  const { t } = useTranslation();
  const { task, join } = panel;
  return (
    <section aria-label={t('taskHelp.join')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
      <p className={look.hint}>{t('taskHelp.hint')}</p>
      <Button disabled={join.isPending} onClick={() => join.mutate({ taskId: task.id, help: true })}>{t('taskHelp.join')}</Button>
    </section>
  );
}

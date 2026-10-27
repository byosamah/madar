import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../../api/contract/entities';
import type { ProjectDetail } from '../../../api/contract/views';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useSheetSteps } from '../../../app/insight/useSheetSteps';
import { useAction, useCall } from '../../../app/runtime';
import { useRight } from '../../../app/useRight';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { DateField } from '../../../components/DateField';
import { SelectField, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { useStageBack } from './StageBack';

/**
 * The "+" of a stage opens this panel (feedback fbk_005, 2026-10-11): a new task in that stage with three fields, the title, the lead
 * and the due date, as the office task panel has. The words next to the "+" stay the quick add. A new task has no lead until a
 * person picks one, as the quick add makes it (owner, 2026-10-05). The lead comes from the team: only the leader and the Admin add
 * a person to it, and they do that in the task panel. The rest lives in the task panel too, one press away from the toast.
 * It is memoized: the quick add of the stage renders on each key, and its props stay the same between keys, so the closed sheet waits.
 */
export const NewTaskSheet = memo(function NewTaskSheet({ detail, stage, open, onOpenChange, onOpen }: {
  detail: ProjectDetail; stage: Stage; open: boolean; onOpenChange: (open: boolean) => void; onOpen: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const back = useStageBack();
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  // '' is no date, as DateField gives it.
  const [due, setDue] = useState('');
  const stepSaved = useSheetSteps('newTask', open);
  const create = useAction('tasks.create', {
    onSuccess: (made) => {
      stepSaved();
      onOpenChange(false);
      toast.show({ message: t('newTask.created'), action: { label: t('newTask.open'), run: () => onOpen(made.task.id), isUndo: false } });
    },
    // Adding a task to an earlier stage moves the project back: the server asks why, and the same call goes again with the reason.
    onRefused: (error, input) => back.refused(error, input, (next) => create.mutate(next)),
  });
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setLead('');
    setDue('');
  }, [open]);
  const team = new Map(detail.members.map((member) => [member.user.id, member.user]));
  if (detail.leader) team.set(detail.leader.id, detail.leader);
  // Naming another person as the lead needs task.assign (role rights version 2): without it the lead is the person or nobody.
  const mayAssign = useRight('task.assign');
  const me = useCall('session.get', {}).data?.authority.id;
  const people = [...team.values()].filter((person) => person.kind === 'human' && (mayAssign || person.id === me)).sort(byName);
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={t('tasks.newTaskIn', { stage: stage.name })}
        footer={(
          <Button
            variant="primary"
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate({
              projectId: detail.project.id, stageId: stage.id, title: title.trim(), ...(lead ? { ownerId: lead } : {}), ...(due ? { dueDate: due } : {}),
            })}
          >
            {t('newTask.create')}
          </Button>
        )}
      >
        <div className="flex flex-col gap-4 pt-1">
          <TextField id={`new-task-title-${stage.id}`} label={t('newTask.name')} required value={title} dir="auto" onChange={(event) => setTitle(event.target.value)} />
          <SelectField id={`new-task-lead-${stage.id}`} label={t('taskSheet.owner')} value={lead} onChange={(event) => setLead(event.target.value)}>
            <option value="">{t('lead.noLead')}</option>
            {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
          </SelectField>
          <DateField id={`new-task-due-${stage.id}`} label={t('taskSheet.dueDate')} value={due} onChange={setDue} />
        </div>
      </Sheet>
      {back.sheet}
    </>
  );
});

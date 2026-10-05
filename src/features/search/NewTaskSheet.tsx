import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField, TextField } from '../../components/Fields';
import { TaskTiming, type Timing } from '../project/tasks/TaskTiming';
import { Sheet } from '../../components/Sheet';
import { useStageBack } from '../project/tasks/StageBack';
import { taskLink } from '../../lib/params';

const NO_TIMING: Timing = { startDate: null, schedule: 'static', durationDays: null, dueDate: null };

/**
 * The "New task" command: a task on one of my projects, in its current stage unless I pick another. Like every new task, it has
 * no lead until a person takes it or the leader names one (owner, 2026-10-05).
 */
export function NewTaskSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const projects = useCall('projects.list', { status: 'active', sort: 'name' });
  const options = (projects.data ?? []).filter((summary) => summary.viewerCan.createTaskForSelf);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [stageId, setStageId] = useState('');
  const [timing, setTiming] = useState<Timing>(NO_TIMING);
  const dynamic = timing.schedule === 'dynamic';
  const summary = options.find((option) => option.project.id === projectId);
  const back = useStageBack();
  const create = useAction('tasks.create', {
    onRefused: (error, input) => back.refused(error, input, (next) => create.mutate(next)),
    onSuccess: (detail) => {
      onOpenChange(false);
      toast.show({
        message: t('newTask.created'),
        action: { label: t('newTask.open'), run: () => navigate(taskLink(detail.task.projectId, detail.task.id)), isUndo: false },
      });
    },
  });

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setTitle('');
    setStageId('');
    setTiming(NO_TIMING);
  }, [open]);

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('newTask.title')}
      footer={(
        <Button
          variant="primary"
          disabled={!projectId || !title.trim() || (dynamic && !timing.startDate) || create.isPending}
          onClick={() => create.mutate({
            projectId, title: title.trim(), stageId: stageId || undefined, startDate: timing.startDate, schedule: timing.schedule,
            ...(dynamic ? { durationDays: timing.durationDays } : { dueDate: timing.dueDate }),
          })}
        >
          {t('newTask.create')}
        </Button>
      )}
    >
      {projects.data && options.length === 0 ? <p className="text-subheadline text-label-2">{t('newTask.noProjects')}</p> : (
        <div className="flex flex-col gap-4 pt-1">
          <SelectField
            id="new-task-project"
            label={t('newTask.project')}
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setStageId(options.find((option) => option.project.id === event.target.value)?.currentStage.id ?? '');
            }}
          >
            <option value="" disabled>{t('newTask.project')}</option>
            {options.map((option) => <option key={option.project.id} value={option.project.id}>{`${option.project.code} · ${option.project.name}`}</option>)}
          </SelectField>
          <TextField id="new-task-title" label={t('newTask.name')} value={title} dir="auto" onChange={(event) => setTitle(event.target.value)} />
          <SelectField id="new-task-stage" label={t('newTask.stage')} value={stageId} disabled={!summary} onChange={(event) => setStageId(event.target.value)}>
            {(summary?.stages ?? []).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </SelectField>
          <TaskTiming idPrefix="new-task" value={timing} onPatch={(changes) => setTiming((current) => ({ ...current, ...changes, ...(changes.schedule === 'dynamic' ? { dueDate: null } : {}) }))} />
        </div>
      )}
    </Sheet>
    {back.sheet}
    </>
  );
}

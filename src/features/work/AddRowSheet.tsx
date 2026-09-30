import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';

/** A new timesheet row: a project, a stage and, when the person wants, a task (spec 6.2). */
export function AddRowSheet({ open, onOpenChange, weekStart }: { open: boolean; onOpenChange: (open: boolean) => void; weekStart: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const projects = useCall('projects.list', { status: 'active', sort: 'name' });
  const options = (projects.data ?? []).filter((summary) => summary.viewerCan.logTime);
  const [projectId, setProjectId] = useState('');
  const [stageId, setStageId] = useState('');
  const [taskId, setTaskId] = useState('');
  const tasks = useCall('tasks.list', { projectId: projectId || undefined, includeDone: false });
  const summary = options.find((option) => option.project.id === projectId);
  const stageTasks = (tasks.data ?? []).filter((row) => row.task.projectId === projectId && row.task.stageId === stageId);
  const add = useAction('time.addRow', {
    onSuccess: () => {
      toast.show({ message: t('hours.rowAdded') });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setStageId('');
    setTaskId('');
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('hours.addTitle')}
      footer={(
        <Button variant="primary" disabled={!projectId || !stageId || add.isPending} onClick={() => add.mutate({ weekStart, projectId, stageId, taskId: taskId || null })}>
          {t('hours.addRow')}
        </Button>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <SelectField
          id="row-project"
          label={t('hours.project')}
          value={projectId}
          onChange={(event) => {
            const id = event.target.value;
            setProjectId(id);
            setStageId(options.find((option) => option.project.id === id)?.currentStage.id ?? '');
            setTaskId('');
          }}
        >
          <option value="" disabled>{t('hours.project')}</option>
          {options.map((option) => <option key={option.project.id} value={option.project.id}>{`${option.project.code} · ${option.project.name}`}</option>)}
        </SelectField>
        <SelectField
          id="row-stage"
          label={t('hours.stage')}
          value={stageId}
          disabled={!summary}
          onChange={(event) => {
            setStageId(event.target.value);
            setTaskId('');
          }}
        >
          {(summary?.stages ?? []).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </SelectField>
        <SelectField id="row-task" label={t('hours.task')} value={taskId} disabled={!summary} onChange={(event) => setTaskId(event.target.value)}>
          <option value="">{t('hours.noTask')}</option>
          {stageTasks.map((row) => <option key={row.task.id} value={row.task.id}>{row.task.title}</option>)}
        </SelectField>
      </div>
    </Sheet>
  );
}

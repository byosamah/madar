import { useTranslation } from 'react-i18next';
import type { Task } from '../../../api/contract/entities';
import { Button } from '../../../components/Button';
import { TextArea } from '../../../components/Fields';
import { formatDay, type Lang } from '../../../lib/dates';
import { durationText } from './TaskTiming';
import type { TaskPanel } from './useTaskPanel';

/** The description box of a person who may change the details. It keeps the saved text rules of `useTaskPanel` (a failed save marks it "Not saved"). */
export function DescriptionField({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const { task, description, setDescription, unsaved, patch } = panel;
  return (
    <TextArea
      id="task-description"
      label={t('taskSheet.description')}
      value={description}
      dir="auto"
      error={unsaved && description !== task.description ? t('taskSheet.notSaved') : undefined}
      onChange={(event) => setDescription(event.target.value)}
      onBlur={() => {
        if (description !== task.description) patch({ description });
      }}
    />
  );
}

/** The dates as plain text, for a person who cannot change them (spec 2.3: no dead controls). `duration` is null unless the task is dynamic. */
export function readOnlyDates(task: Task, lang: Lang, t: ReturnType<typeof useTranslation>['t']) {
  return {
    start: task.startDate ? formatDay(task.startDate, lang, 'long') : t('overview.none'),
    due: task.dueDate ? formatDay(task.dueDate, lang, 'long') : t('overview.none'),
    duration: task.schedule === 'dynamic' && task.durationDays ? durationText(task.durationDays, t) : null,
  };
}

/** Leave, Save as template and Delete, each for the person who may use it. The desk and the phone pass their own box and button classes. */
export function FooterActions({ panel, className, buttonClass }: { panel: TaskPanel; className: string; buttonClass?: string }) {
  const { t } = useTranslation();
  const { task, viewerCan, helping, leave, saveTemplate, remove } = panel;
  if (!(viewerCan.saveTemplate || viewerCan.delete || helping)) return null;
  return (
    <div className={className}>
      {helping && <Button className={buttonClass} disabled={leave.isPending} onClick={() => leave.mutate({ taskId: task.id, help: false })}>{t('taskHelp.leave')}</Button>}
      {viewerCan.saveTemplate && (
        <Button className={buttonClass} disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate({ fromTaskId: task.id })}>{t('taskSheet.saveTemplate')}</Button>
      )}
      {viewerCan.delete && (
        <Button variant="destructive" className={buttonClass} disabled={remove.isPending} onClick={() => remove.mutate({ id: task.id })}>{t('taskSheet.delete')}</Button>
      )}
    </div>
  );
}

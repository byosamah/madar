import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../../api/contract/entities';
import type { ProjectDetail, TaskRow } from '../../../api/contract/views';
import { useAction } from '../../../app/runtime';
import { EmptyState } from '../../../components/EmptyState';
import { useStageBack } from './StageBack';
import { TaskRowItem } from './TaskRowItem';
import { TemplateMenu } from './TemplateMenu';

/** "Add a task" at the top of a group. Enter creates it. The owner is the creator and the stage is the group's (spec 5.3). */
function QuickAdd({ projectId, stage }: { projectId: string; stage: Stage }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const back = useStageBack();
  const create = useAction('tasks.create', {
    onSuccess: () => setTitle(''),
    onRefused: (error, input) => back.refused(error, input, (next) => create.mutate(next)),
  });
  return (
    <>
    <form
      className="flex items-center gap-3 px-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) create.mutate({ projectId, stageId: stage.id, title: title.trim() });
      }}
    >
      <AnimatedIcon icon={PlusIcon} size={18} className="shrink-0 text-label-3" aria-hidden />
      <input
        aria-label={t('tasks.addTaskIn', { stage: stage.name })}
        placeholder={t('tasks.addTask')}
        value={title}
        dir="auto"
        disabled={create.isPending}
        onChange={(event) => setTitle(event.target.value)}
        className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label placeholder:text-label-2"
      />
      <TemplateMenu stage={stage} />
    </form>
    {back.sheet}
    </>
  );
}

/** Tasks grouped by stage (spec 5.3). With a filter on, empty groups hide. */
export function TaskList({ detail, rows, filtered, onOpen, doneCounts }: {
  detail: ProjectDetail; rows: TaskRow[]; filtered: boolean; onOpen: (taskId: string, thread?: boolean) => void; doneCounts: Record<string, number>;
}) {
  const { t } = useTranslation();
  const groups = detail.stages
    .map((stage) => ({ stage, rows: rows.filter((row) => row.task.stageId === stage.id) }))
    .filter((group) => !filtered || group.rows.length > 0);
  if (filtered && groups.length === 0) return <EmptyState title={t('project.tab.tasks')} body={t('tasks.emptyFiltered')} />;
  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ stage, rows: stageRows }) => (
        <section key={stage.id} aria-labelledby={`stage-${stage.id}`} className="surface overflow-hidden rounded-card pb-2">
          <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
            <h3 id={`stage-${stage.id}`} dir="auto" className="text-headline">{stage.name}</h3>
            <span className="tabular text-footnote text-label-2">{t('tasks.count', { n: stageRows.length })}</span>
          </header>
          {detail.viewerCan.createTaskForSelf && <QuickAdd projectId={detail.project.id} stage={stage} />}
          <ul>
            <AnimatePresence initial={false}>
              {stageRows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={onOpen} />)}
            </AnimatePresence>
          </ul>
          {stageRows.length === 0 && (
            <p className="px-4 pb-2 text-footnote text-label-2">{(doneCounts[stage.id] ?? 0) > 0 ? t('tasks.allDone') : t('tasks.empty')}</p>
          )}
        </section>
      ))}
    </div>
  );
}

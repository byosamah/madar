import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { useState } from 'react';
import { useStableHandler } from '../../../app/useStableHandler';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../../api/contract/entities';
import type { ProjectDetail, TaskRow } from '../../../api/contract/views';
import { useAction, useCall } from '../../../app/runtime';
import { EmptyState } from '../../../components/EmptyState';
import { useStageBack } from './StageBack';
import { arranged } from '../../../lib/arrange';
import { NewTaskSheet } from './NewTaskSheet';
import { SortableTaskRows } from './SortableTaskRows';
import { TemplateMenu } from './TemplateMenu';

/**
 * "Add a task" at the top of a group. The words are the quick add: Enter creates a task with no lead (owner, 2026-10-05), in the
 * group's stage (spec 5.3). The "+" opens a panel for a new task, with a lead and a date (feedback fbk_005, 2026-10-11).
 */
function QuickAdd({ detail, stage, onOpen }: { detail: ProjectDetail; stage: Stage; onOpen: (taskId: string) => void }) {
  const { t } = useTranslation();
  const projectId = detail.project.id;
  const [panel, setPanel] = useState(false);
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
        if (title.trim() && !create.isPending) create.mutate({ projectId, stageId: stage.id, title: title.trim() });
      }}
    >
      {/* The button is 44 px wide for a finger, and its side margins keep the "+" and the words where they were. */}
      <button
        type="button"
        aria-label={t('tasks.newTaskIn', { stage: stage.name })}
        title={t('tasks.newTaskIn', { stage: stage.name })}
        onClick={() => setPanel(true)}
        className="pressable -mx-3 grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-fill hover:text-ink"
      >
        <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
      </button>
      <input
        aria-label={t('tasks.addTaskIn', { stage: stage.name })}
        placeholder={t('tasks.addTask')}
        value={title}
        dir="auto"
        // Read only, not disabled, while it saves: a disabled field loses the focus, and the next title would go nowhere (audit 2026-10-03, BRW-11).
        readOnly={create.isPending}
        aria-busy={create.isPending || undefined}
        onChange={(event) => setTitle(event.target.value)}
        className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label placeholder:text-label-2"
      />
      <TemplateMenu stage={stage} />
    </form>
    {back.sheet}
    <NewTaskSheet detail={detail} stage={stage} open={panel} onOpenChange={setPanel} onOpen={onOpen} />
    </>
  );
}

/** Tasks grouped by stage (spec 5.3). With a filter on, empty groups hide. */
export function TaskList({ detail, rows, filtered, onOpen, doneCounts }: {
  detail: ProjectDetail; rows: TaskRow[]; filtered: boolean; onOpen: (taskId: string, thread?: boolean) => void; doneCounts: Record<string, number>;
}) {
  const { t } = useTranslation();
  // One session.get for the whole list. Each row takes the person from here.
  const me = useCall('session.get', {}).data?.authority;
  // One handler for every row (RN-5): a row that did not change renders no more.
  const openRow = useStableHandler((row: TaskRow, thread?: boolean) => onOpen(row.task.id, thread));
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
          {detail.viewerCan.addTask && <QuickAdd detail={detail} stage={stage} onOpen={onOpen} />}
          <SortableTaskRows rows={arranged(stageRows)} me={me} onOpen={openRow} />
          {stageRows.length === 0 && (
            <p className="px-4 pb-2 text-footnote text-label-2">{(doneCounts[stage.id] ?? 0) > 0 ? t('tasks.allDone') : t('tasks.empty')}</p>
          )}
        </section>
      ))}
    </div>
  );
}

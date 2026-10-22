import type { ReactNode } from 'react';
import { vi, type Mock } from 'vitest';
import type { Task } from '../api/contract/entities';
import type { State } from '../api/store';
import { useCall } from '../app/runtime';
import { ProjectTaskSheet } from '../features/project/tasks/TaskSheet';
import { useTaskPanel, type TaskPanel } from '../features/project/tasks/useTaskPanel';
import { phoneMedia } from './phoneMedia';
import { renderWithRuntime } from './render';

/** Sets the person, applies the patch to the to-do, and empties the prerequisites of the to-do and of its stage, so it waits for nothing. */
export function setupTask(taskId: string, userId: string, patch: Partial<Task> = {}): (state: State) => void {
  return (state) => {
    state.session.currentUserId = userId;
    const task = state.tasks[taskId];
    Object.assign(task, patch, { prerequisiteIds: [] });
    const stage = task.stageId ? state.stages[task.stageId] : undefined;
    if (stage) stage.prerequisiteIds = [];
  };
}

/** An office to-do (tsk_900) that Omar made and Sara leads, as in TaskSheetPrefetch.test.tsx. */
export function addOfficeTask(state: State, patch: Partial<Task> = {}): void {
  state.tasks.tsk_900 = {
    id: 'tsk_900', projectId: null, stageId: null, title: 'Renew the trade licence', description: '', ownerId: 'usr_005', status: 'todo',
    dueDate: '2026-09-28', flagged: false, needsReview: true, checklist: [], createdBy: 'usr_004', createdAt: '2026-09-29T09:00:00.000+03:00',
    completedAt: null, ...patch,
  };
  state.counters.tsk = Math.max(state.counters.tsk ?? 0, 900);
}

type Options = {
  prepare?: (state: State) => void;
  path?: string;
  /** Default: the project of the to-do. */
  projectId?: string | null;
  /** True answers (max-width: 639px). Default false, a desk. */
  phone?: boolean;
  /** With render, the page shows only that node, fed by useTaskPanel. Without it, the page shows the real ProjectTaskSheet. */
  render?: (panel: TaskPanel) => ReactNode;
};

/** Reads the to-do and its project, then draws the real sheet or the node that `render` gives. */
function Host({ taskId, projectId, onClose, render }: { taskId: string; projectId?: string | null; onClose: () => void; render?: Options['render'] }) {
  const task = useCall('tasks.get', { id: taskId });
  const owner = projectId === undefined ? (task.data ? task.data.task.projectId : undefined) : projectId;
  const detail = useCall('projects.get', { id: owner ?? '' }, { enabled: typeof owner === 'string' });
  if (!task.data || owner === undefined) return null;
  if (!render) return <ProjectTaskSheet projectId={owner} taskId={taskId} onClose={onClose} />;
  if (owner !== null && !detail.data) return null;
  return <Panel data={task.data} detail={detail.data ?? null} onClose={onClose} render={render} />;
}

function Panel({ data, detail, onClose, render }: { data: NonNullable<ReturnType<typeof useCall<'tasks.get'>>['data']>; detail: Parameters<typeof useTaskPanel>[0]['detail']; onClose: () => void; render: NonNullable<Options['render']> }) {
  const panel = useTaskPanel({ detail, data, onClose, noteFirst: false });
  return <>{render(panel)}</>;
}

export async function renderPanel(taskId: string, options: Options = {}): Promise<Awaited<ReturnType<typeof renderWithRuntime>> & { onClose: Mock }> {
  phoneMedia(options.phone === true);
  const onClose = vi.fn();
  const view = await renderWithRuntime(
    <Host taskId={taskId} projectId={options.projectId} onClose={onClose} render={options.render} />,
    options.prepare,
    { path: options.path ?? `/?task=${taskId}` },
  );
  return { ...view, onClose };
}

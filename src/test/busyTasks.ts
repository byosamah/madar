import type { Task } from '../api/contract/entities';
import type { State } from '../api/store';

/** Takes the due date off every to-do that the person leads, so a busy-week test counts only the to-dos that it adds. */
export function clearLead(state: State, userId: string): void {
  for (const task of Object.values(state.tasks)) if (task.ownerId === userId) task.dueDate = null;
}

/**
 * Adds an open to-do that Sara (usr_005) leads, due Wednesday 2027-03-10, in the first stage of the project (prj_001 by default).
 * `projectId: null` makes an office to-do. The week of 2027-03-10 runs from Sunday 2027-03-07 to Saturday 2027-03-13.
 */
export function addTodo(state: State, id: string, o: Partial<Task> = {}): void {
  const projectId = o.projectId === undefined ? 'prj_001' : o.projectId;
  const stage = projectId ? Object.values(state.stages).find((candidate) => candidate.projectId === projectId) : undefined;
  state.tasks[id] = {
    id, projectId, stageId: stage?.id ?? null, title: `To-do ${id}`, description: '', ownerId: 'usr_005', status: 'todo', dueDate: '2027-03-10',
    flagged: false, needsReview: false, checklist: [], createdBy: 'usr_002', createdAt: '2026-09-29T09:00:00.000+03:00', completedAt: null, ...o,
  };
  state.counters.tsk = Math.max(state.counters.tsk ?? 0, Number(id.replace(/\D/g, '')) || 0);
}

import type { TaskRow } from '../api/contract/views';
import { listFormat, type Lang } from './dates';

/** True while the task waits for a task or a stage that is not done. */
export function isWaiting(row: Pick<TaskRow, 'waitingFor'>): boolean {
  return row.waitingFor.tasks.length > 0 || row.waitingFor.stages.length > 0;
}

/** What the task waits for, as one list in the interface language: "Stair details and Permits". */
export function waitingNames(row: Pick<TaskRow, 'waitingFor'>, lang: Lang): string {
  const names = [...row.waitingFor.tasks.map((task) => task.title), ...row.waitingFor.stages.map((stage) => stage.name)];
  return listFormat(lang).format(names);
}

import type { ChecklistItem, Task } from '../api/contract/entities';

type People = Pick<Task, 'ownerId' | 'helperIds'>;

/** The helpers of a task. A task saved before helpers has none. */
export const helpersOf = (task: Pick<Task, 'helperIds'>): string[] => task.helperIds ?? [];

/** The lead and the helpers: every person who gets the task in their own list and its reminders. A task with no lead has only its helpers. */
export const peopleOfTask = (task: People): string[] => [...(task.ownerId ? [task.ownerId] : []), ...helpersOf(task)];

/** True when this person leads the task or helps with it. Nobody leads a task with no lead. */
export const involves = (task: People, userId: string): boolean => task.ownerId === userId || helpersOf(task).includes(userId);

/** True when the task has no lead (owner, 2026-10-05). */
export const hasNoLead = (task: Pick<Task, 'ownerId'>): boolean => task.ownerId === null;

/** The version a task is at. A task saved before versions is at version 1. */
export const versionOf = (task: Pick<Task, 'version'>): number => task.version ?? 1;

/** True when two checklists differ only in which items are ticked: the same items, in the same order, with the same texts. */
export function onlyTicks(current: ChecklistItem[], next: ChecklistItem[]): boolean {
  return current.length === next.length && current.every((item, i) => item.id === next[i].id && item.text === next[i].text);
}

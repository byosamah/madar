import { addDays } from './dates';
import { dueFromDuration, firstWorkingDay, isWorkingDay } from './workdays';

/** The parts of a stage that the order and the tag need. */
export type StageShape = { id: string; order: number; startDate: string | null; endDate: string | null; prerequisiteIds?: string[] };
/** The parts of a task that the order, the tag and the waiting rules need. */
export type TaskShape = { id: string; stageId: string; title: string; status: string; startDate?: string | null; dueDate: string | null; prerequisiteIds?: string[] };

const LATE = '9999-12-31';

/** Stages in time order: start date, then end date, then the order the office gave them. A stage with no dates comes after the dated ones. */
export function compareStages(a: StageShape, b: StageShape): number {
  return (a.startDate ?? LATE).localeCompare(b.startDate ?? LATE) || (a.endDate ?? LATE).localeCompare(b.endDate ?? LATE) || a.order - b.order;
}

export function stagesChrono<S extends StageShape>(stages: S[]): S[] {
  return [...stages].sort(compareStages);
}

/** Tasks in time order: start date, then due date, then the stage's place in time, then the title. A date that is not set comes last. */
export function compareTasks(a: TaskShape, b: TaskShape, stageRank: (stageId: string) => number = () => 0): number {
  return (a.startDate ?? LATE).localeCompare(b.startDate ?? LATE)
    || (a.dueDate ?? LATE).localeCompare(b.dueDate ?? LATE)
    || stageRank(a.stageId) - stageRank(b.stageId)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

/** A project's tasks in time order, given its stages. */
export function tasksChrono<T extends TaskShape>(tasks: T[], stages: StageShape[]): T[] {
  const rank = new Map(stagesChrono(stages).map((stage, index) => [stage.id, index]));
  return [...tasks].sort((a, b) => compareTasks(a, b, (id) => rank.get(id) ?? 0));
}

/**
 * The stage the project is "in" (owner, 2026-10-02): the earliest stage that has an open task. With no open task, the last stage
 * that has any task. With no task at all, the first stage. Callers pass at least one stage.
 */
export function stageTagOf<S extends StageShape>(stages: S[], tasks: Pick<TaskShape, 'stageId' | 'status'>[]): S {
  const chrono = stagesChrono(stages);
  const open = chrono.find((stage) => tasks.some((task) => task.stageId === stage.id && task.status !== 'done'));
  if (open) return open;
  const used = chrono.filter((stage) => tasks.some((task) => task.stageId === stage.id));
  return used[used.length - 1] ?? chrono[0];
}

/** The tasks, among the ones given, that this task needs first and that are not done yet. A task that does not exist is ignored. */
export function openPrerequisites<T extends TaskShape>(task: TaskShape, tasks: T[]): T[] {
  const ids = new Set(task.prerequisiteIds ?? []);
  return tasks.filter((other) => ids.has(other.id) && other.status !== 'done');
}

/** The stages that a stage needs first and that still have an open task. */
export function openStagesNeededBy<S extends StageShape>(stageId: string, stages: S[], tasks: Pick<TaskShape, 'stageId' | 'status'>[]): S[] {
  const ids = new Set(stages.find((stage) => stage.id === stageId)?.prerequisiteIds ?? []);
  return stagesChrono(stages).filter((stage) => ids.has(stage.id) && tasks.some((other) => other.stageId === stage.id && other.status !== 'done'));
}

/** The prerequisite stages of the task's stage that still have an open task. */
export function openPrerequisiteStages<S extends StageShape>(task: Pick<TaskShape, 'stageId'>, stages: S[], tasks: Pick<TaskShape, 'stageId' | 'status'>[]): S[] {
  return openStagesNeededBy(task.stageId, stages, tasks);
}

/** The working days after the due day, up to and including the day it was finished. Zero when it was finished on time. */
export function workingDaysLate(dueDate: string, finishedOn: string): number {
  let count = 0;
  for (let day = addDays(dueDate, 1); day <= finishedOn; day = addDays(day, 1)) if (isWorkingDay(day)) count += 1;
  return count;
}

/** The day that is n working days after a day. A weekend day counts from the next working day. */
export function addWorkingDays(day: string, n: number): string {
  let out = firstWorkingDay(day);
  for (let left = n; left > 0; ) {
    out = addDays(out, 1);
    if (isWorkingDay(out)) left -= 1;
  }
  return out;
}

/** The parts of a dependent task that the shift plan needs. "dateNotes" tells how far a task already moved it. */
export type ShiftShape = {
  id: string; status: string; schedule?: string | null; startDate?: string | null; dueDate: string | null; durationDays?: number | null;
  dateNotes?: { byTaskId?: string; lateDays?: number; forDueDate?: string }[];
};
/** "lateDays" is how many working days the dependent moves. "taskLateDays" is how late the finished task is. */
export type PlannedMove = {
  id: string; lateDays: number; taskLateDays: number; from: { startDate: string; dueDate: string | null }; to: { startDate: string; dueDate: string };
};

/**
 * Where each dependent moves when a task finishes on a given day. A dependent moves when it is not done, is dynamic, and has a start
 * day and a duration. It moves later by the working days the task is late. The list is empty when the task is not late.
 * A task that opened again and finishes late again moves a dependent only by the days it did not move it yet (audit 2026-10-03, API-3).
 * That is true only when the earlier move was for the same due day. A new version with a new due day is late against that day, so it
 * moves the dependent by the full lateness (audit 2026-10-03, V-3). The real shift and the meeting preview both use this, so they cannot disagree.
 */
export function shiftPlan(task: { id?: string; dueDate: string | null }, dependents: ShiftShape[], finishDay: string): PlannedMove[] {
  if (!task.dueDate) return [];
  const taskLateDays = workingDaysLate(task.dueDate, finishDay);
  if (taskLateDays < 1) return [];
  const moves: PlannedMove[] = [];
  for (const dependent of dependents) {
    if (dependent.status === 'done' || (dependent.schedule ?? 'static') !== 'dynamic' || !dependent.startDate || !dependent.durationDays) continue;
    const before = [...(dependent.dateNotes ?? [])].reverse().find((note) => task.id !== undefined && note.byTaskId === task.id);
    const moved = before?.forDueDate === task.dueDate ? (before.lateDays ?? 0) : 0;
    const lateDays = taskLateDays - moved;
    if (lateDays < 1) continue;
    const startDate = addWorkingDays(dependent.startDate, lateDays);
    moves.push({
      id: dependent.id, lateDays, taskLateDays,
      from: { startDate: dependent.startDate, dueDate: dependent.dueDate },
      to: { startDate, dueDate: dueFromDuration(startDate, dependent.durationDays) },
    });
  }
  return moves;
}

export type Overlap = { start: string; end: string; stageIds: [string, string] };

/**
 * The runs of days where two stages go on at the same time. Two stages overlap when they share at least one working day
 * (Sunday to Thursday), so a stage that starts on the Friday after another ends does not overlap it.
 */
export function stageOverlaps(stages: StageShape[]): Overlap[] {
  const dated = stagesChrono(stages).filter((stage): stage is StageShape & { startDate: string; endDate: string } => stage.startDate !== null && stage.endDate !== null);
  const out: Overlap[] = [];
  for (let i = 0; i < dated.length; i += 1) {
    for (let j = i + 1; j < dated.length; j += 1) {
      if (dated[j].startDate > dated[i].endDate) continue;
      const start = dated[j].startDate > dated[i].startDate ? dated[j].startDate : dated[i].startDate;
      const end = dated[j].endDate < dated[i].endDate ? dated[j].endDate : dated[i].endDate;
      let working = false;
      for (let day = start; day <= end && !working; day = addDays(day, 1)) working = isWorkingDay(day);
      if (working) out.push({ start, end, stageIds: [dated[i].id, dated[j].id] });
    }
  }
  return out;
}

/** The ids of the stages that overlap the given stage. */
export function overlappingWith(stageId: string, overlaps: Overlap[]): string[] {
  return overlaps.filter((overlap) => overlap.stageIds.includes(stageId)).map((overlap) => (overlap.stageIds[0] === stageId ? overlap.stageIds[1] : overlap.stageIds[0]));
}

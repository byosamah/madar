/**
 * The open and the done to-dos of each stage, in the order of the stages given. A continuous project (its stages run together) shows
 * these counts in place of a current stage (fbk_084). A to-do of no listed stage is left out. Lazy screens use this file, never Home.
 */
export function stageCounts<S extends { id: string }>(stages: readonly S[], tasks: readonly { stageId: string | null; status: string }[]): { stage: S; open: number; done: number }[] {
  const counts = new Map<string, { open: number; done: number }>(stages.map((stage) => [stage.id, { open: 0, done: 0 }]));
  for (const task of tasks) {
    const count = task.stageId === null ? undefined : counts.get(task.stageId);
    if (count) count[task.status === 'done' ? 'done' : 'open'] += 1;
  }
  return stages.map((stage) => ({ stage, ...counts.get(stage.id)! }));
}

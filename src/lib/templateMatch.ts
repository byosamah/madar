import type { ProjectTemplate, Stage, Task } from '../api/contract/entities';

/** The pairs that the names give: each part of a template with its item of a project, or null when no item matches. */
export type NameMatches = { stages: Record<string, string | null>; tasks: Record<string, string | null> };

/**
 * The name of a stage or a task, as Madar compares it (fbk_008 item 4). No spaces at the ends, lower case, one space between
 * words. Arabic: no short vowels (fathatan to kasra) and no tatweel; the alef forms become a plain alef; alef maksura becomes ya;
 * ta marbuta becomes ha.
 */
export function normalName(text: string): string {
  return text
    .replace(/[ً-ِ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The items of one project that match each part of a template, by name (fbk_008 item 4). A stage matches the first stage of
 * the same name, in stage order. A task matches a task of the same title inside its matched stage first, then in any stage.
 * Each project item matches one part only.
 */
export function matchByNames(template: ProjectTemplate, stages: Stage[], tasks: Task[]): NameMatches {
  const stageMatch: Record<string, string | null> = {};
  const takenStages = new Set<string>();
  const inOrder = [...stages].sort((a, b) => a.order - b.order);
  for (const part of template.stages) {
    const name = normalName(part.name);
    const hit = inOrder.find((stage) => !takenStages.has(stage.id) && normalName(stage.name) === name);
    stageMatch[part.id] = hit?.id ?? null;
    if (hit) takenStages.add(hit.id);
  }
  const taskMatch: Record<string, string | null> = {};
  const takenTasks = new Set<string>();
  for (const part of template.tasks) {
    const title = normalName(part.title);
    const free = (candidate: Task) => !takenTasks.has(candidate.id) && normalName(candidate.title) === title;
    const ownStage = stageMatch[part.stageId];
    const hit = (ownStage ? tasks.find((candidate) => candidate.stageId === ownStage && free(candidate)) : undefined)
      ?? tasks.find(free);
    taskMatch[part.id] = hit?.id ?? null;
    if (hit) takenTasks.add(hit.id);
  }
  return { stages: stageMatch, tasks: taskMatch };
}

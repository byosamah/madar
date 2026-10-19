import { hierarchy, tree } from 'd3-hierarchy';
import type { Stage } from '../../api/contract/entities';
import type { ProjectSummary, TaskRow } from '../../api/contract/views';

/** One node of the Open space map: what it is, where it sits, and whether it is open or faded. */
export type SpaceNode = {
  id: string;
  kind: 'office' | 'project' | 'stage' | 'task';
  /** 0 for the office, 1 for a project, 2 for a stage, 3 for a task. */
  depth: number;
  /** Across the map: the left edge of the card, mirrored in a right to left layout. */
  x: number;
  /** Down the map: the top edge of the card. */
  y: number;
  /** True while the node shows its next level. The office is always open. */
  open: boolean;
  /** True for a task, a stage or a project that the focused person has no open task in. */
  faded: boolean;
};

export type SpaceTreeInput = {
  projects: ProjectSummary[];
  tasks: TaskRow[];
  /** The ids of the projects and stages that show their next level. */
  opened: ReadonlySet<string>;
  /** The person whose work stays bright. Null: everything stays bright. */
  focusPersonId: string | null;
  dir: 'ltr' | 'rtl';
};

export type SpaceTree = { nodes: SpaceNode[]; edges: { from: string; to: string }[] };

/** The id of the office node. Project, stage and task ids never equal it. */
export const OFFICE_ID = 'office';

/** A project shows on the map while it is active or paused. A completed or archived project never shows. */
export function isOpenProject(summary: ProjectSummary): boolean {
  return summary.project.status === 'active' || summary.project.status === 'on_hold';
}

// The distance between two levels (across the map), in pixels.
const LEVEL_GAP = 340;
/**
 * The height of each kind of card, in pixels, as the browser draws it (PRJ-07, 2026-10-19). A row is as tall as its card plus ROW_AIR,
 * so a card never covers the next one. A project card holds a name, a sign, the stage and the summary line, so it is the tallest.
 */
export const CARD_HEIGHT = { office: 60, project: 133, stage: 62, task: 74 } as const;
export const ROW_AIR = 16;
// A row of cousins (cards of one level under two parents) gets more air, so the two families read apart.
const COUSIN_AIR = 1.4;

const rowOf = (kind: SpaceNode['kind']): number => CARD_HEIGHT[kind] + ROW_AIR;

/** True when the person leads or helps the task. */
function involves(row: TaskRow, personId: string): boolean {
  return row.owner?.id === personId || row.helpers.some((helper) => helper.id === personId);
}

/** The open tasks that sit in a stage of a project that shows on the map. */
function openStageTasks(projects: ProjectSummary[], tasks: TaskRow[]): TaskRow[] {
  const shown = new Set(projects.filter(isOpenProject).map((summary) => summary.project.id));
  return tasks.filter((row) => row.task.status !== 'done' && row.task.stageId !== null && row.task.projectId !== null && shown.has(row.task.projectId));
}

/** The people who lead or help an open task of a project on the map: the choices of "Focus on a person". */
export function peopleWithOpenTasks(projects: ProjectSummary[], tasks: TaskRow[]): Set<string> {
  const found = new Set<string>();
  for (const row of openStageTasks(projects, tasks)) {
    if (row.owner) found.add(row.owner.id);
    for (const helper of row.helpers) found.add(helper.id);
  }
  return found;
}

/**
 * What a focus on a person opens (PRJ-06, 2026-10-19): every project and every stage where the person leads or helps an open task.
 * "bright" lists the nodes that stay bright, for the view to fit. "tasks" and "projects" are the two numbers of the line under the picker.
 */
export function focusPlan(input: { projects: ProjectSummary[]; tasks: TaskRow[]; personId: string }) {
  const own = openStageTasks(input.projects, input.tasks).filter((row) => involves(row, input.personId));
  const stageIds = new Set(own.map((row) => row.task.stageId as string));
  const projectIds = new Set(own.map((row) => row.task.projectId as string));
  const bright = [...projectIds, ...stageIds, ...own.map((row) => row.task.id)];
  return { opened: new Set([...projectIds, ...stageIds]), tasks: own.length, projects: projectIds.size, bright };
}

type Item = { id: string; kind: SpaceNode['kind']; faded: boolean; children: Item[] };

/** Dates sort oldest first, and a missing date goes last. */
function byDay(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** A stage sorts by its start, then by its place in the project. */
function byStageTime(a: Stage, b: Stage): number {
  return byDay(a.startDate, b.startDate) || a.order - b.order;
}

function byTaskDue(a: TaskRow, b: TaskRow): number {
  return byDay(a.task.dueDate, b.task.dueDate) || (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0);
}

/**
 * The map of the office as a tree (feedback fbk_015, 2026-10-18). The office has every open project (active or paused). A
 * project shows its stages, and a stage shows its open tasks, only once each is opened. A done task never shows. The
 * layout comes from d3-hierarchy. The office stays at x 0 in both layouts, so a card never moves when a level opens or
 * closes. In a right to left layout the levels grow to the negative side, so the tree reads from the end side.
 */
export function buildSpaceTree(input: SpaceTreeInput): SpaceTree {
  const { opened, focusPersonId, dir } = input;
  const projects = input.projects
    .filter(isOpenProject)
    .sort((a, b) => (a.project.code < b.project.code ? -1 : a.project.code > b.project.code ? 1 : 0));

  const tasksByStage = new Map<string, TaskRow[]>();
  for (const row of input.tasks) {
    const stageId = row.task.stageId;
    if (row.task.status === 'done' || stageId === null) continue;
    tasksByStage.set(stageId, [...(tasksByStage.get(stageId) ?? []), row]);
  }

  const involvedIn = (rows: TaskRow[]) => focusPersonId !== null && rows.some((row) => involves(row, focusPersonId));
  const fadedBy = (rows: TaskRow[]) => focusPersonId !== null && !involvedIn(rows);

  const taskItem = (row: TaskRow): Item => ({ id: row.task.id, kind: 'task', faded: fadedBy([row]), children: [] });
  const stageItem = (stage: Stage): Item => ({
    id: stage.id,
    kind: 'stage',
    faded: fadedBy(tasksByStage.get(stage.id) ?? []),
    children: opened.has(stage.id) ? [...(tasksByStage.get(stage.id) ?? [])].sort(byTaskDue).map(taskItem) : [],
  });
  const projectItem = (summary: ProjectSummary): Item => ({
    id: summary.project.id,
    kind: 'project',
    faded: fadedBy(summary.stages.flatMap((stage) => tasksByStage.get(stage.id) ?? [])),
    children: opened.has(summary.project.id) ? [...summary.stages].sort(byStageTime).map(stageItem) : [],
  });

  const root: Item = { id: OFFICE_ID, kind: 'office', faded: false, children: projects.map(projectItem) };
  // The breadth axis (down the map) holds the middle of each card. A row is as tall as its card plus air, and the unit of the
  // layout is the smallest row, so a taller card takes more units. Two cards that share no parent get more air.
  const unit = rowOf('task');
  const laid = tree<Item>()
    .nodeSize([unit, LEVEL_GAP])
    .separation((a, b) => (Math.max(rowOf(a.data.kind), rowOf(b.data.kind)) / unit) * (a.parent === b.parent ? 1 : COUSIN_AIR))(hierarchy(root, (item) => item.children));
  const placed = laid.descendants();

  // The office sits level with the first project, so the first view shows the office and the first projects together. The layout
  // would put it in the middle of the whole list.
  const firstProject = placed.find((node) => node.depth === 1);
  const officeTop = firstProject ? firstProject.x - CARD_HEIGHT.office / 2 : undefined;
  const nodes = placed.map((node): SpaceNode => ({
    id: node.data.id,
    kind: node.data.kind,
    depth: node.depth,
    x: (dir === 'rtl' ? -node.depth : node.depth) * LEVEL_GAP,
    // The layout gives the middle of the card, and the map wants its top.
    y: node.depth === 0 && officeTop !== undefined ? officeTop : node.x - CARD_HEIGHT[node.data.kind] / 2,
    open: node.data.kind === 'office' || (node.data.kind !== 'task' && opened.has(node.data.id)),
    faded: node.data.faded,
  }));
  const edges = laid.links().map((link) => ({ from: link.source.data.id, to: link.target.data.id }));
  return { nodes, edges };
}

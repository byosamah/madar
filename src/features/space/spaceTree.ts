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
  /** True for a task that the focused person neither leads nor helps. */
  faded: boolean;
};

export type SpaceTreeInput = {
  projects: ProjectSummary[];
  tasks: TaskRow[];
  /** The ids of the projects and stages that show their next level. */
  opened: ReadonlySet<string>;
  /** The person whose tasks stay bright. Null: every task stays bright. */
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

// The distance between two levels (across the map) and between two neighbours (down the map), in pixels.
const LEVEL_GAP = 300;
const NEIGHBOUR_GAP = 136;

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

  const taskItem = (row: TaskRow): Item => {
    const involved = row.owner?.id === focusPersonId || row.helpers.some((helper) => helper.id === focusPersonId);
    return { id: row.task.id, kind: 'task', faded: focusPersonId !== null && !involved, children: [] };
  };
  const stageItem = (stage: Stage): Item => ({
    id: stage.id,
    kind: 'stage',
    faded: false,
    children: opened.has(stage.id) ? [...(tasksByStage.get(stage.id) ?? [])].sort(byTaskDue).map(taskItem) : [],
  });
  const projectItem = (summary: ProjectSummary): Item => ({
    id: summary.project.id,
    kind: 'project',
    faded: false,
    children: opened.has(summary.project.id) ? [...summary.stages].sort(byStageTime).map(stageItem) : [],
  });

  const root: Item = { id: OFFICE_ID, kind: 'office', faded: false, children: projects.map(projectItem) };
  const laid = tree<Item>().nodeSize([NEIGHBOUR_GAP, LEVEL_GAP])(hierarchy(root, (item) => item.children));
  const placed = laid.descendants();

  const nodes = placed.map((node): SpaceNode => ({
    id: node.data.id,
    kind: node.data.kind,
    depth: node.depth,
    x: (dir === 'rtl' ? -node.depth : node.depth) * LEVEL_GAP,
    y: node.x,
    open: node.data.kind === 'office' || (node.data.kind !== 'task' && opened.has(node.data.id)),
    faded: node.data.faded,
  }));
  const edges = laid.links().map((link) => ({ from: link.source.data.id, to: link.target.data.id }));
  return { nodes, edges };
}

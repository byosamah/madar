import { hierarchy, tree } from 'd3-hierarchy';
import type { Deadline, Stage } from '../../api/contract/entities';
import type { DeadlineRow, ProjectSummary, TaskRow } from '../../api/contract/views';

/**
 * The kinds of card. A deadline is a named date of a project (the "milestone" of the team). A check is one item of the checklist of a
 * to-do (the "sub-task" of the team). A "more" card stands for the checklist items past the first CHECK_CAP.
 */
export type SpaceKind = 'office' | 'subcompany' | 'project' | 'stage' | 'task' | 'deadline' | 'check' | 'more';

/** One node of the Open space map: what it is, where it sits, and whether it is open or faded. */
export type SpaceNode = {
  id: string;
  kind: SpaceKind;
  /** The id of the parent card. The office has none. */
  parentId: string | null;
  /** The column: 0 for the office, then one more for each level that the map shows (the sub-company column is there only when it has cards). */
  depth: number;
  /** Across the map: the left edge of the card, mirrored in a right to left layout. */
  x: number;
  /** Down the map: the top edge of the card. */
  y: number;
  /** True while the node shows its next level. The office is always open. */
  open: boolean;
  /** True for a card that the focused person has no part in. */
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
  /** The deadlines of the office. A deadline of a project that is not on the map never shows. */
  deadlines?: DeadlineRow[];
  /**
   * The sub-companies of the office. With at least one, the map gets a sub-company column between the office and the projects.
   * Leave it out (or empty) for an office with none, or when the link already filters one sub-company.
   */
  subCompanies?: { id: string; name: string }[];
};

export type SpaceTree = { nodes: SpaceNode[]; edges: { from: string; to: string }[] };

/** The id of the office node. Project, stage and task ids never equal it. */
export const OFFICE_ID = 'office';
/** The id of the card for the projects that have no sub-company. */
export const NO_SUB_ID = 'sub_none';
/** At most this many checklist items show for one to-do. The rest sit behind one "more" card. */
export const CHECK_CAP = 12;

/** The id of the card of one checklist item, and of the "more" card of a to-do. */
export const checkNodeId = (taskId: string, itemId: string) => `${taskId}#${itemId}`;
export const moreNodeId = (taskId: string) => `${taskId}#+more`;

/** The steps of the Detail control, from the least to the most. */
export const LEVELS = ['subcompanies', 'projects', 'stages', 'todos', 'checklists'] as const;
export type Level = (typeof LEVELS)[number];
/** The steps that the person can pick. An office with no sub-company column starts at Projects. */
export const levelsFor = (subColumn: boolean): readonly Level[] => (subColumn ? LEVELS : LEVELS.slice(1));

/** A project shows on the map while it is active or paused. A completed or archived project never shows. */
export function isOpenProject(summary: ProjectSummary): boolean {
  return summary.project.status === 'active' || summary.project.status === 'on_hold';
}

// The distance between two levels (across the map), in pixels.
const LEVEL_GAP = 340;
/**
 * The height of each kind of card, in pixels, as the browser draws it (PRJ-07, 2026-10-19). A row is as tall as its card plus ROW_AIR,
 * so a card never covers the next one. A project card holds a name, a sign, the stage and the summary line, so it is the tallest.
 * The values of "subcompany", "deadline", "check" and "more" (fbk_055, 2026-10-25) come from the padding and the line heights of the
 * card, as the stage card and the to-do card do (24 + 20 + 18 = 62, 24 + 18 + 6 + 26 = 74). A browser has not measured them yet:
 * measure each one again (offsetHeight), and change the value here when it differs.
 */
export const CARD_HEIGHT = { office: 60, subcompany: 80, project: 133, stage: 62, task: 74, deadline: 58, check: 42, more: 42 } as const;
export const ROW_AIR = 16;
// A row of cousins (cards of one level under two parents) gets more air, so the two families read apart.
const COUSIN_AIR = 1.4;

const rowOf = (kind: SpaceKind): number => CARD_HEIGHT[kind] + ROW_AIR;

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

/** The sub-company card that holds a project: its own, or "No sub-company" when it has none or the sub-company is not in the list. */
export function subGroupOf(summary: ProjectSummary, known: ReadonlySet<string>): string {
  return summary.subCompanyId && known.has(summary.subCompanyId) ? summary.subCompanyId : NO_SUB_ID;
}

/**
 * The ids that a step opens for the whole map (fbk_055). Each step opens one more level for every project that shows: the
 * sub-company cards, the projects, the stages, the to-dos that have a checklist. A person in focus adds the projects and stages
 * where the person works. A tap on a card changes this set by one id, and a step change makes it again, so it clears the taps.
 */
export function openedForLevel(
  level: Level,
  input: { projects: ProjectSummary[]; tasks: TaskRow[]; subCompanies?: { id: string }[]; focusPersonId?: string | null },
): Set<string> {
  const step = LEVELS.indexOf(level);
  const shown = input.projects.filter(isOpenProject);
  const known = new Set((input.subCompanies ?? []).map((sub) => sub.id));
  const opened = new Set<string>();
  if (step >= 1 && known.size > 0) for (const summary of shown) opened.add(subGroupOf(summary, known));
  if (step >= 2) for (const summary of shown) opened.add(summary.project.id);
  if (step >= 3) for (const summary of shown) for (const stage of summary.stages) opened.add(stage.id);
  if (step >= 4) for (const row of openStageTasks(shown, input.tasks)) if (row.task.checklist.length > 0) opened.add(row.task.id);
  if (input.focusPersonId) for (const id of focusPlan({ projects: input.projects, tasks: input.tasks, personId: input.focusPersonId }).opened) opened.add(id);
  return opened;
}

type Item = { id: string; kind: SpaceKind; faded: boolean; children: Item[] };

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
 * The map of the office as a tree (feedback fbk_015, 2026-10-18; levels fbk_055, 2026-10-25). The office has every open project
 * (active or paused), grouped under the cards of the sub-companies when the office has sub-companies. A project shows its stages and
 * its deadlines with no stage, a stage shows its open tasks and its deadlines, and a task shows its checklist, only once each is
 * opened. A done task never shows. The layout comes from d3-hierarchy. The office stays at x 0 in both layouts, and the column of a
 * card follows its level, so a card never moves when a level opens or closes. In a right to left layout the levels grow to the
 * negative side, so the tree reads from the end side.
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

  // A deadline sits under its stage. A deadline with no stage, or with a stage that the project no longer has, sits under the project.
  // A deadline of a project that is not on the map has no place: a hidden project never reaches the map through its deadlines.
  const stageIdsOf = new Map(projects.map((summary) => [summary.project.id, new Set(summary.stages.map((stage) => stage.id))]));
  const deadlinesByStage = new Map<string, Deadline[]>();
  const deadlinesByProject = new Map<string, Deadline[]>();
  for (const { deadline } of input.deadlines ?? []) {
    const stages = stageIdsOf.get(deadline.projectId);
    if (!stages) continue;
    const bucket = deadline.stageId !== null && stages.has(deadline.stageId) ? deadlinesByStage : deadlinesByProject;
    const key = bucket === deadlinesByStage ? (deadline.stageId as string) : deadline.projectId;
    bucket.set(key, [...(bucket.get(key) ?? []), deadline]);
  }
  const byDeadline = (a: Deadline, b: Deadline) => byDay(a.date, b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const involvedIn = (rows: TaskRow[]) => focusPersonId !== null && rows.some((row) => involves(row, focusPersonId));
  const fadedBy = (rows: TaskRow[]) => focusPersonId !== null && !involvedIn(rows);
  const stageTasks = (summary: ProjectSummary) => summary.stages.flatMap((stage) => tasksByStage.get(stage.id) ?? []);

  const checkItems = (row: TaskRow, faded: boolean): Item[] => {
    const list = row.task.checklist;
    const items = list.slice(0, CHECK_CAP).map((entry): Item => ({ id: checkNodeId(row.task.id, entry.id), kind: 'check', faded, children: [] }));
    if (list.length > CHECK_CAP) items.push({ id: moreNodeId(row.task.id), kind: 'more', faded, children: [] });
    return items;
  };
  const taskItem = (row: TaskRow): Item => {
    const faded = fadedBy([row]);
    return { id: row.task.id, kind: 'task', faded, children: opened.has(row.task.id) ? checkItems(row, faded) : [] };
  };
  // A deadline is no person's work: while a person is in focus it fades, so the work of the person stands out.
  const deadlineItem = (deadline: Deadline): Item => ({ id: deadline.id, kind: 'deadline', faded: focusPersonId !== null, children: [] });
  // The to-dos and the deadlines of a stage share one column, in date order. A deadline comes before a to-do of the same day.
  const stageChildren = (stage: Stage): Item[] => {
    const timeline = [
      ...(tasksByStage.get(stage.id) ?? []).map((row) => ({ day: row.task.dueDate, rank: 1, id: row.task.id, item: () => taskItem(row) })),
      ...(deadlinesByStage.get(stage.id) ?? []).map((deadline) => ({ day: deadline.date, rank: 0, id: deadline.id, item: () => deadlineItem(deadline) })),
    ];
    return timeline.sort((a, b) => byDay(a.day, b.day) || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((entry) => entry.item());
  };
  const stageItem = (stage: Stage): Item => ({
    id: stage.id,
    kind: 'stage',
    faded: fadedBy(tasksByStage.get(stage.id) ?? []),
    children: opened.has(stage.id) ? stageChildren(stage) : [],
  });
  const projectItem = (summary: ProjectSummary): Item => ({
    id: summary.project.id,
    kind: 'project',
    faded: fadedBy(stageTasks(summary)),
    children: opened.has(summary.project.id)
      ? [
        ...[...summary.stages].sort(byStageTime).map(stageItem),
        ...[...(deadlinesByProject.get(summary.project.id) ?? [])].sort(byDeadline).map(deadlineItem),
      ]
      : [],
  });

  // The sub-company column: the sub-companies by name, then "No sub-company". A sub-company with no project on the map has no card.
  const subs = [...(input.subCompanies ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set(subs.map((sub) => sub.id));
  let top: Item[];
  if (subs.length > 0) {
    const groups = new Map<string, ProjectSummary[]>();
    for (const summary of projects) {
      const key = subGroupOf(summary, known);
      groups.set(key, [...(groups.get(key) ?? []), summary]);
    }
    top = [...subs.map((sub) => sub.id), NO_SUB_ID]
      .filter((id) => groups.has(id))
      .map((id): Item => {
        const members = groups.get(id)!;
        return { id, kind: 'subcompany', faded: fadedBy(members.flatMap(stageTasks)), children: opened.has(id) ? members.map(projectItem) : [] };
      });
  } else {
    top = projects.map(projectItem);
  }

  const root: Item = { id: OFFICE_ID, kind: 'office', faded: false, children: top };
  // The breadth axis (down the map) holds the middle of each card. A row is as tall as its card plus air, and the unit of the
  // layout is the smallest row, so a taller card takes more units. Two cards that share no parent get more air.
  const unit = rowOf('task');
  const laid = tree<Item>()
    .nodeSize([unit, LEVEL_GAP])
    .separation((a, b) => (Math.max(rowOf(a.data.kind), rowOf(b.data.kind)) / unit) * (a.parent === b.parent ? 1 : COUSIN_AIR))(hierarchy(root, (item) => item.children));
  const placed = laid.descendants();

  // The office sits level with the first card of the next column, so the first view shows the office and the first cards together.
  // The layout would put it in the middle of the whole list.
  const firstChild = placed.find((node) => node.depth === 1);
  const officeTop = firstChild ? firstChild.x - CARD_HEIGHT.office / 2 : undefined;
  const nodes = placed.map((node): SpaceNode => ({
    id: node.data.id,
    kind: node.data.kind,
    parentId: node.parent ? node.parent.data.id : null,
    depth: node.depth,
    x: (dir === 'rtl' ? -node.depth : node.depth) * LEVEL_GAP,
    // The layout gives the middle of the card, and the map wants its top.
    y: node.depth === 0 && officeTop !== undefined ? officeTop : node.x - CARD_HEIGHT[node.data.kind] / 2,
    open: node.data.kind === 'office' || (node.data.kind !== 'deadline' && node.data.kind !== 'check' && node.data.kind !== 'more' && opened.has(node.data.id)),
    faded: node.data.faded,
  }));
  const edges = laid.links().map((link) => ({ from: link.source.data.id, to: link.target.data.id }));
  return { nodes, edges };
}

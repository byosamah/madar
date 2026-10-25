import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Position, ReactFlow, type Edge, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useByPersonName, usePersonName } from '../../app/personName';
import { PicturesProvider } from '../../app/pictures';
import { SubCompaniesProvider } from '../../app/subCompanies';
import { useCall } from '../../app/runtime';
import { useScope } from '../../app/useScope';
import type { Deadline, Stage } from '../../api/contract/entities';
import type { ProjectSummary, TaskRow } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { ScreenTitle } from '../../components/ScreenTitle';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { counted } from '../../lib/grammar';
import { openTask } from '../../lib/params';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { SpaceCard, type SpaceCardData, type SpaceFlowNode } from './SpaceNode';
import {
  buildSpaceTree, CARD_HEIGHT, CHECK_CAP, focusPlan, isOpenProject, levelsFor, LEVELS, NO_SUB_ID, OFFICE_ID, openedForLevel, peopleWithOpenTasks, ROW_AIR,
  subGroupOf, type Level, type SpaceNode, type SpaceTree,
} from './spaceTree';

const NODE_TYPES: NodeTypes = { space: SpaceCard };
const LABEL = 'flex flex-col gap-1 text-footnote font-semibold text-ink-2';
const SELECT = 'field mt-1.5 font-normal';
// The "React Flow" label keeps the library colours unless the map sets its own: a light patch in dark mode, and a corner that the
// round box cuts. The map gives it a token fill, a token link colour and a margin.
const FLOW_CLASS = '[&_.react-flow__attribution]:m-2 [&_.react-flow__attribution]:rounded-md [&_.react-flow__attribution_a]:text-label-2';
const FLOW_STYLE = { '--xy-attribution-background-color': 'var(--c-fill)' } as CSSProperties;

type FitOptions = {
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
  duration?: number;
  nodes?: { id: string }[];
  includeHiddenNodes?: boolean;
};

/** The part of the React Flow instance that the screen uses. */
type FlowHandle = {
  fitView: (options?: FitOptions) => unknown;
  zoomIn: (options?: { duration?: number }) => unknown;
  zoomOut: (options?: { duration?: number }) => unknown;
};

// The first view and the Overview keep the cards readable. They show the office and the first projects from the top of the map, and
// the person moves down with the wheel or a drag. A project that opens, or a person in focus, moves the view to what it shows.
// Without a measured box the first view shows four projects. With one, it shows as many rows as fit at the zoom of the window, and at
// least three projects.
const FIRST_PROJECTS = 4;
const MIN_PROJECTS = 3;
// A phone is narrow: it shows the first cards of the new level alone, with no office card, so the cards keep a readable size.
const FIRST_PROJECTS_PHONE = 3;
// The keys that zoom the map with the wheel. The plain wheel only moves the map (PRJ-05).
const ZOOM_KEYS = ['Control', 'Meta'];
// The width of a card (w-72) and the time the map waits after the last change of its box before it fits again.
const CARD_WIDTH = 288;
const REFIT_DELAY_MS = 150;
// A change of the box under this share of its size does not fit the map again.
const REFIT_SHARE = 0.1;
// The window width where the zoom ceiling of a fit starts to grow, the width where it stops, and the highest ceiling.
const WIDE_FROM = 1400;
const WIDE_TO = 2200;
const WIDE_ZOOM = 1.6;
const FLOW_MAX_ZOOM = 1.6;

type Box = { width: number; height: number } | null;

/** The most zoom of a fit: 1 up to a 1400 px window, then it grows to 1.6 at 2200 px, so the text of a wide screen grows with it. */
export function maxZoomFor(windowWidth: number): number {
  if (windowWidth <= WIDE_FROM) return 1;
  return Math.min(WIDE_ZOOM, 1 + ((WIDE_ZOOM - 1) * (windowWidth - WIDE_FROM)) / (WIDE_TO - WIDE_FROM));
}

/** The least and the most zoom of a fit that keeps the cards readable. A phone is narrow, so it may zoom out further. */
function readableLimits() {
  const width = typeof window !== 'undefined' ? window.innerWidth : WIDE_FROM;
  const narrow = width < 640;
  return { padding: 0.1, minZoom: narrow ? 0.45 : 0.7, maxZoom: maxZoomFor(width) };
}

/** The kinds of the cards that a step adds: a phone fits these alone. */
const KINDS_OF_LEVEL: Record<Level, SpaceNode['kind'][]> = {
  subcompanies: ['subcompany'],
  projects: ['project'],
  stages: ['stage'],
  todos: ['task', 'deadline'],
  checklists: ['check', 'more'],
};

const byTop = (a: SpaceNode, b: SpaceNode) => a.y - b.y || a.x - b.x;

/**
 * The first cards of the new level, from the top, for a phone. A level with no card of its own falls back to the projects. With a
 * measured box the cards fill its height at the zoom that one card column allows, at least three (phone check, 2026-10-25: three
 * centred cards left a gap of up to 250 px above them).
 */
export function phoneNodes(tree: SpaceTree, level: Level, box: Box, limits: ReturnType<typeof readableLimits>): string[] {
  for (const kinds of [KINDS_OF_LEVEL[level], KINDS_OF_LEVEL.projects]) {
    const found = tree.nodes.filter((node) => kinds.includes(node.kind)).sort(byTop);
    if (found.length === 0) continue;
    let count = FIRST_PROJECTS_PHONE;
    if (box && box.width > 0 && box.height > 0) {
      const room = 1 + limits.padding * 2;
      const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, box.width / (CARD_WIDTH * room)));
      const height = box.height / (room * zoom);
      const top = found[0].y;
      count = Math.max(FIRST_PROJECTS_PHONE, found.filter((node) => node.y + CARD_HEIGHT[node.kind] - top <= height).length);
    }
    return found.slice(0, count).map((node) => node.id);
  }
  return [];
}

/**
 * The cards of the first rows for a desk: the nodes that sit inside the height that the box shows at the zoom of the window, from the
 * top of the map, with the office first and the parents of what shows. At the first two steps at least three cards of the step show.
 */
function deskNodes(tree: SpaceTree, level: Level, box: Box, limits: ReturnType<typeof readableLimits>): string[] {
  if (tree.nodes.length === 0) return [];
  const top = Math.min(...tree.nodes.map((node) => node.y));
  const bottomOf = (node: SpaceNode) => node.y + CARD_HEIGHT[node.kind];
  let height = FIRST_PROJECTS * (CARD_HEIGHT.project + ROW_AIR);
  if (box && box.width > 0 && box.height > 0) {
    const widest = Math.max(...tree.nodes.map((node) => Math.abs(node.x))) + CARD_WIDTH;
    const room = 1 + limits.padding * 2;
    const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, box.width / (widest * room)));
    height = box.height / (room * zoom);
  }
  if (level === 'subcompanies' || level === 'projects') {
    const own = tree.nodes.filter((node) => KINDS_OF_LEVEL[level].includes(node.kind)).sort(byTop);
    const least = own[Math.min(MIN_PROJECTS, own.length) - 1];
    if (least) height = Math.max(height, bottomOf(least) - top);
  }
  const shown = tree.nodes.filter((node) => node.kind !== 'office' && bottomOf(node) <= top + height).sort(byTop);
  // A first row that is taller than the window still shows its first card.
  if (shown.length === 0) shown.push(...tree.nodes.filter((node) => node.kind !== 'office').sort(byTop).slice(0, 1));
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };
  if (tree.nodes.some((node) => node.id === OFFICE_ID)) add(OFFICE_ID);
  for (const node of shown) add(node.id);
  const parentOf = new Map(tree.nodes.map((node) => [node.id, node.parentId]));
  for (const node of shown) for (let up = parentOf.get(node.id); up; up = parentOf.get(up)) add(up);
  return order;
}

/**
 * The view that keeps the cards readable: the office and the first rows, as the tree starts. A phone shows the first cards of the
 * new level alone. With a project open, the tree spreads, so the view follows what opens instead (see toggle). The nodes are the
 * declared size of a card, so a card that React Flow does not draw yet (it draws only the cards in view) still counts in the fit.
 */
function readableView(tree: SpaceTree, level: Level, box: Box) {
  const limits = readableLimits();
  const phone = limits.minZoom < 0.7;
  const ids = phone ? phoneNodes(tree, level, box, limits) : deskNodes(tree, level, box, limits);
  return { ...limits, includeHiddenNodes: true, nodes: ids.map((id) => ({ id })) };
}

/** The ids that the person tapped: opened beyond the step, and closed against the step. A step change clears both. */
type Taps = { extra: ReadonlySet<string>; closed: ReadonlySet<string> };
const NO_TAPS: Taps = { extra: new Set(), closed: new Set() };

function openTap(taps: Taps, id: string, step: ReadonlySet<string>): Taps {
  const extra = new Set(taps.extra);
  const closed = new Set(taps.closed);
  closed.delete(id);
  if (!step.has(id)) extra.add(id);
  return { extra, closed };
}

function closeTap(taps: Taps, id: string, step: ReadonlySet<string>): Taps {
  const extra = new Set(taps.extra);
  const closed = new Set(taps.closed);
  extra.delete(id);
  if (step.has(id)) closed.add(id);
  return { extra, closed };
}

/** The same fields, one by one: a card whose data did not change keeps its old data object, so React Flow leaves it alone. */
function sameData(a: SpaceCardData, b: SpaceCardData): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SpaceCardData>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * The Open space (feedback fbk_015, 2026-10-18; review 2026-10-19): a read-only mind map of the office, for the managers who want
 * the whole office at one look. It sits outside the app frame, as the meeting view does, so it reads the profile pictures and the
 * sub-companies itself. One project is open at a time, and the view follows what opens. A task opens its panel over the map.
 */
export function OpenSpaceScreen() {
  return <PicturesProvider><SubCompaniesProvider><SpaceScreen /></SubCompaniesProvider></PicturesProvider>;
}

/** The glyph of a zoom button: a plus, or a minus. */
function ZoomGlyph({ plus }: { plus: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d={plus ? 'M10 4v12M4 10h12' : 'M4 10h12'} />
    </svg>
  );
}

const without = (set: ReadonlySet<string>, ids: string[]) => new Set([...set].filter((id) => !ids.includes(id)));

function SpaceScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [params, setParams] = useSearchParams();
  // The Dashboard filters reach the map in the link, so it holds the projects that the numbers counted (INT-11).
  const { leaderId, clientId, teamId, subCompanyId, scopeText } = useScope();
  const filters = { leaderId, clientId, teamId, subCompanyId };
  // The reads of the office: the projects, their open tasks, their deadlines and the sub-companies. A done task never shows on the map.
  const projects = useCall('projects.list', { status: 'all', ...filters });
  const tasks = useCall('tasks.list', { activeProjectsOnly: false, includeDone: false, ...filters });
  const deadlineRows = useCall('deadlines.list', { status: 'all', ...filters });
  const subList = useCall('subCompanies.list', {});
  const users = useCall('users.list', {});
  const [level, setLevel] = useState<Level>('projects');
  const [taps, setTaps] = useState<Taps>(NO_TAPS);
  const [focusPersonId, setFocusPersonId] = useState<string | null>(null);
  const flow = useRef<FlowHandle | null>(null);
  const boxElement = useRef<HTMLDivElement | null>(null);
  // The size of the map box, as the last settled change reported it. Null until the browser measures it.
  const box = useRef<Box>(null);
  // Each change that moves the view counts one. "nodes" are what the view fits to; null means the overview. A phone is narrow, so it
  // fits "phone" instead: the new level alone, which keeps the cards readable.
  const [fit, setFit] = useState<{ n: number; nodes: string[] | null; phone: string[] | null }>({ n: 0, nodes: null, phone: null });
  const moveView = (nodes: string[] | null, phone: string[] | null = null) => setFit((current) => ({ n: current.n + 1, nodes, phone }));

  const summaries = useMemo(() => projects.data ?? [], [projects.data]);
  const rows = useMemo(() => tasks.data ?? [], [tasks.data]);
  const deadlines = useMemo(() => deadlineRows.data ?? [], [deadlineRows.data]);
  // The sub-company column: only when the office has sub-companies, and not when the link already filters one of them.
  const subCompanies = useMemo(
    () => (subCompanyId === undefined && (subList.data?.length ?? 0) > 0 ? (subList.data ?? []).map((sub) => ({ id: sub.id, name: sub.name })) : undefined),
    [subList.data, subCompanyId],
  );
  const steps = levelsFor(subCompanies !== undefined);
  const current: Level = steps.includes(level) ? level : 'projects';
  // The choices of the focus: the people who lead or help an open task of a project on the map. The person in focus stays in the list.
  const people = useMemo(() => {
    const working = peopleWithOpenTasks(summaries, rows);
    return (users.data ?? []).filter((user) => user.kind === 'human' && user.active && (working.has(user.id) || user.id === focusPersonId)).sort(byName);
  }, [users.data, summaries, rows, focusPersonId, byName]);
  // What the step opens, and what the person tapped on top of it.
  const step = useMemo(
    () => openedForLevel(current, { projects: summaries, tasks: rows, subCompanies, focusPersonId }),
    [current, summaries, rows, subCompanies, focusPersonId],
  );
  const opened = useMemo(() => {
    const ids = new Set(step);
    for (const id of taps.extra) ids.add(id);
    for (const id of taps.closed) ids.delete(id);
    return ids;
  }, [step, taps]);
  const tree = useMemo(
    () => buildSpaceTree({ projects: summaries, tasks: rows, opened, focusPersonId, dir, deadlines, subCompanies }),
    [summaries, rows, opened, focusPersonId, dir, deadlines, subCompanies],
  );

  // The latest tree, step and box, for a fit that runs later (a resize, a step change, a tap).
  const latest = useRef({ tree, level: current, fit, step, opened });
  latest.current = { tree, level: current, fit, step, opened };
  const view = readableView(tree, current, box.current);

  // The lookups that fill each card. A stage has a next level only when it has an open task or a deadline.
  const projectById = useMemo(() => new Map(summaries.map((summary): [string, ProjectSummary] => [summary.project.id, summary])), [summaries]);
  const stageById = useMemo(() => {
    const found = new Map<string, { stage: Stage; summary: ProjectSummary }>();
    for (const summary of summaries) for (const stage of summary.stages) found.set(stage.id, { stage, summary });
    return found;
  }, [summaries]);
  const taskById = useMemo(() => new Map(rows.map((row): [string, TaskRow] => [row.task.id, row])), [rows]);
  const deadlineById = useMemo(() => new Map(deadlines.map((row): [string, Deadline] => [row.deadline.id, row.deadline])), [deadlines]);
  const stagesWithTasks = useMemo(() => {
    const found = new Set<string>();
    for (const row of rows) if (row.task.status !== 'done' && row.task.stageId) found.add(row.task.stageId);
    for (const row of deadlines) {
      const known = stageById.get(row.deadline.stageId ?? '');
      if (known && known.summary.project.id === row.deadline.projectId) found.add(known.stage.id);
    }
    return found;
  }, [rows, deadlines, stageById]);
  // A project has a next level when it has a stage, or a deadline with no stage.
  const projectsWithDeadlines = useMemo(() => {
    const found = new Set<string>();
    for (const row of deadlines) found.add(row.deadline.projectId);
    return found;
  }, [deadlines]);
  // The facts of a project card: its stages, its open tasks and the open tasks past due.
  const factsOf = useMemo(() => {
    const found = new Map<string, { stages: number; tasks: number; late: number }>();
    for (const summary of summaries) found.set(summary.project.id, { stages: summary.stages.length, tasks: 0, late: 0 });
    for (const row of rows) {
      const facts = row.task.projectId ? found.get(row.task.projectId) : undefined;
      if (!facts || row.task.status === 'done') continue;
      facts.tasks += 1;
      if (row.overdue) facts.late += 1;
    }
    return found;
  }, [summaries, rows]);
  // The facts of a sub-company card: its open projects and the open tasks past due in them.
  const subFacts = useMemo(() => {
    const found = new Map<string, { projects: number; late: number }>();
    if (!subCompanies) return found;
    const known = new Set(subCompanies.map((sub) => sub.id));
    for (const summary of summaries.filter(isOpenProject)) {
      const key = subGroupOf(summary, known);
      const facts = found.get(key) ?? { projects: 0, late: 0 };
      facts.projects += 1;
      facts.late += factsOf.get(summary.project.id)?.late ?? 0;
      found.set(key, facts);
    }
    return found;
  }, [summaries, subCompanies, factsOf]);
  const kindById = useMemo(() => new Map(tree.nodes.map((node): [string, SpaceNode['kind']] => [node.id, node.kind])), [tree]);

  // A project opens alone at the Projects step: the one that was open closes (an accordion), and the view moves to the project and its
  // stages. From the Stages step every project is open, and a tap closes only that project. A stage opens beside the others, and the
  // view moves to it and its tasks. A card that closes sends the view back to the overview at the first steps.
  const toggleNow = (id: string) => {
    const { opened: open, step: base, level: at } = latest.current;
    const early = at === 'subcompanies' || at === 'projects';
    const summary = projectById.get(id);
    if (summary) {
      const stageIds = summary.stages.map((stage) => stage.id);
      if (open.has(id)) {
        setTaps((now) => (early ? stageIds : []).reduce((next, stageId) => closeTap(next, stageId, base), closeTap(now, id, base)));
        if (early) moveView(null);
        return;
      }
      setTaps((now) => {
        let next = now;
        if (early) {
          for (const other of open) {
            const otherSummary = projectById.get(other);
            if (!otherSummary || other === id) continue;
            next = closeTap(next, other, base);
            for (const stage of otherSummary.stages) next = closeTap(next, stage.id, base);
          }
        }
        return openTap(next, id, base);
      });
      moveView([id, ...stageIds], stageIds);
      return;
    }
    if (kindById.get(id) === 'subcompany') {
      if (open.has(id)) {
        setTaps((now) => closeTap(now, id, base));
        moveView(null);
        return;
      }
      const projectIds = [...projectById.values()].filter((item) => isOpenProject(item) && subGroupOf(item, new Set((subCompanies ?? []).map((sub) => sub.id))) === id).map((item) => item.project.id);
      setTaps((now) => openTap(now, id, base));
      moveView([id, ...projectIds], projectIds);
      return;
    }
    const found = stageById.get(id);
    if (open.has(id)) {
      setTaps((now) => closeTap(now, id, base));
      return;
    }
    setTaps((now) => openTap(now, id, base));
    const taskIds = rows.filter((row) => row.task.stageId === id && row.task.status !== 'done').map((row) => row.task.id);
    moveView([found?.summary.project.id ?? id, id, ...taskIds], taskIds);
  };
  // The cards keep one toggle for all their life, so a tap does not change the data of every card.
  const toggleRef = useRef(toggleNow);
  toggleRef.current = toggleNow;
  const toggle = useCallback((id: string) => toggleRef.current(id), []);

  // A person in focus opens every project and stage where that person works, and the view fits what stays bright (PRJ-06).
  const focusOn = (personId: string | null) => {
    setFocusPersonId(personId);
    setTaps(NO_TAPS);
    if (personId === null) {
      moveView(null);
      return;
    }
    const plan = focusPlan({ projects: summaries, tasks: rows, personId });
    const brightTasks = rows.filter((row) => plan.bright.includes(row.task.id)).map((row) => row.task.id);
    moveView(plan.bright.length > 0 ? plan.bright : null, brightTasks);
  };
  const overview = () => {
    setFocusPersonId(null);
    setTaps(NO_TAPS);
    setLevel('projects');
    moveView(null);
  };
  // Show more and Show less move one step. The step opens its level for the whole map and clears the taps.
  const changeLevel = (move: number) => {
    const next = steps[steps.indexOf(current) + move];
    if (!next) return;
    setLevel(next);
    setTaps(NO_TAPS);
    moveView(null);
  };
  const focused = focusPersonId ? people.find((person) => person.id === focusPersonId) : undefined;
  const plan = focusPersonId ? focusPlan({ projects: summaries, tasks: rows, personId: focusPersonId }) : null;

  const taskId = params.get('task');
  const panelProjectId = params.get('project');
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  const showTask = useCallback((id: string, projectId: string | null) => setParamsRef.current((now) => openTask(now, id, projectId)), []);
  const closeTask = useCallback(() => setParams((now) => {
    const next = new URLSearchParams(now);
    for (const key of ['task', 'project', 'thread']) next.delete(key);
    return next;
  }), [setParams]);

  const cardOf = (node: SpaceNode): SpaceCardData => {
    const base = { id: node.id, kind: node.kind, open: node.open, faded: node.faded, onToggle: toggle, onOpenTask: showTask };
    if (node.kind === 'subcompany') return { ...base, subId: node.id === NO_SUB_ID ? null : node.id, subFacts: subFacts.get(node.id), expandable: true };
    if (node.kind === 'project') {
      const summary = projectById.get(node.id);
      return { ...base, summary, facts: factsOf.get(node.id), expandable: (summary?.stages.length ?? 0) > 0 || projectsWithDeadlines.has(node.id) };
    }
    if (node.kind === 'stage') {
      const found = stageById.get(node.id);
      return {
        ...base,
        stage: found?.stage,
        current: found ? found.summary.project.currentStageId === node.id : false,
        expandable: stagesWithTasks.has(node.id),
      };
    }
    if (node.kind === 'task') return { ...base, row: taskById.get(node.id), expandable: false };
    if (node.kind === 'deadline') return { ...base, deadline: deadlineById.get(node.id), expandable: false };
    if (node.kind === 'check' || node.kind === 'more') {
      const [ownerId = '', itemId = ''] = node.id.split('#');
      const row = taskById.get(ownerId);
      if (node.kind === 'more') return { ...base, row, moreCount: row ? row.task.checklist.length - CHECK_CAP : 0, expandable: false };
      return { ...base, row, item: row?.task.checklist.find((item) => item.id === itemId), expandable: false };
    }
    return { ...base, expandable: false };
  };

  // The nodes keep their old object when nothing about them changed (their data, their place), so a tap redraws only the cards that
  // changed (fbk_055, the speed rule).
  const made = useRef(new Map<string, SpaceFlowNode>());
  const nodes = useMemo(() => {
    const before = made.current;
    const after = new Map<string, SpaceFlowNode>();
    const list = tree.nodes.map((node): SpaceFlowNode => {
      const fresh = cardOf(node);
      const old = before.get(node.id);
      const data = old && sameData(old.data, fresh) ? old.data : fresh;
      const keep = old && old.data === data && old.position.x === node.x && old.position.y === node.y ? old : undefined;
      const flowNode = keep ?? {
        id: node.id,
        type: 'space' as const,
        position: { x: node.x, y: node.y },
        // The lines leave a card on its end side and enter the next card on its start side, so an Arabic map reads from the end side.
        sourcePosition: dir === 'rtl' ? Position.Left : Position.Right,
        targetPosition: dir === 'rtl' ? Position.Right : Position.Left,
        // The declared size lets React Flow place a card that it does not draw yet, and fit the view to it.
        initialWidth: CARD_WIDTH,
        initialHeight: CARD_HEIGHT[node.kind],
        draggable: false,
        selectable: false,
        focusable: false,
        data,
      };
      after.set(node.id, flowNode);
      return flowNode;
    });
    made.current = after;
    return list;
    // cardOf reads the lookups below. The toggle and the task opener never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, dir, projectById, factsOf, stageById, stagesWithTasks, taskById, deadlineById, subFacts, projectsWithDeadlines, toggle, showTask]);
  const edges: Edge[] = useMemo(() => tree.edges.map((edge) => ({
    id: `${edge.from}>${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    selectable: false,
    focusable: false,
    style: { stroke: 'var(--c-ink-2)', strokeOpacity: 0.5 },
  })), [tree]);

  // The options of a fit to a target: the cards that a move named, or the first rows. A phone fits the new level alone.
  const optionsFor = (target: { nodes: string[] | null; phone: string[] | null }, duration: number): FitOptions => {
    const limits = readableLimits();
    const ids = limits.minZoom < 0.7 && target.phone && target.phone.length > 0 ? target.phone : target.nodes;
    if (ids) return { ...limits, includeHiddenNodes: true, duration, nodes: ids.map((id) => ({ id })) };
    return { ...readableView(latest.current.tree, latest.current.level, box.current), duration };
  };

  useEffect(() => {
    if (fit.n === 0) return;
    const frame = requestAnimationFrame(() => {
      void flow.current?.fitView(optionsFor(fit, 250));
    });
    return () => cancelAnimationFrame(frame);
    // optionsFor reads only refs and the window, so a move of the view is the one thing that runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  // A change of the map box (a window resize, a phone turn) fits the map again to its last target, after the box has been still for a
  // moment. A change under 10 percent keeps the view, and a pan never fits again.
  const settled = useRef<Box>(null);
  const refit = () => {
    void flow.current?.fitView(optionsFor(latest.current.fit, 0));
  };
  const refitRef = useRef(refit);
  refitRef.current = refit;
  useEffect(() => {
    const element = boxElement.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const size = { width: rect.width, height: rect.height };
        const before = settled.current;
        box.current = size;
        // The map draws only after the projects arrive. Until then the size waits, and the first fit uses it.
        if (!flow.current) return;
        const moved = !before || Math.abs(size.width - before.width) / before.width >= REFIT_SHARE || Math.abs(size.height - before.height) / before.height >= REFIT_SHARE;
        if (!moved) return;
        settled.current = size;
        refitRef.current();
      }, REFIT_DELAY_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const kept = summaries.filter(isOpenProject);
  // The way back keeps the Dashboard filters, so the Dashboard shows the same office as the map.
  const back = new URLSearchParams([...params].filter(([key]) => ['leader', 'client', 'team', 'subCompany'].includes(key))).toString();
  const detailLabel = useId();
  const levelWord = t(`space.level${{ subcompanies: 'SubCompanies', projects: 'Projects', stages: 'Stages', todos: 'Todos', checklists: 'Checklists' }[current]}`);
  const position = steps.indexOf(current);
  const ready = projects.data !== undefined && !subList.isPending;

  return (
    // On a phone the page is one screen high and the map takes the rest, so the page never scrolls and the zoom buttons stay in view.
    <main className="flex min-h-dvh flex-col p-4 max-sm:h-dvh sm:p-6">
      <Link to={{ pathname: '/dashboard', search: back }} className="-ms-2 mb-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-subheadline font-semibold text-link hover:underline">
        <AnimatedIcon icon={ChevronLeftIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
        {t('screens.dashboard')}
      </Link>
      <ScreenTitle
        title={t('space.title')}
        action={(
          <div className="flex flex-wrap items-end gap-2">
            <div role="group" aria-labelledby={detailLabel} className={LABEL}>
              <span id={detailLabel}>{t('space.detail')}</span>
              <div className="mt-1.5 flex items-center gap-1">
                {/* A phone shows the short words, so the row never wraps; the full words stay the names of the buttons. */}
                <Button className="px-3" aria-label={t('space.less')} disabled={position <= 0} onClick={() => changeLevel(-1)}>
                  <span className="sm:hidden">{t('space.lessShort')}</span><span className="max-sm:hidden">{t('space.less')}</span>
                </Button>
                <span aria-live="polite" className="min-w-24 px-1 text-center text-subheadline font-semibold text-ink">{levelWord}</span>
                <Button className="px-3" aria-label={t('space.more')} disabled={position >= steps.length - 1} onClick={() => changeLevel(1)}>
                  <span className="sm:hidden">{t('space.moreShort')}</span><span className="max-sm:hidden">{t('space.more')}</span>
                </Button>
              </div>
            </div>
            <label className={LABEL}>{t('space.focus')}
              <select value={focusPersonId ?? ''} onChange={(event) => focusOn(event.target.value === '' ? null : event.target.value)} className={SELECT}>
                <option value="">{t('space.focusAnyone')}</option>
                {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
              </select>
            </label>
            <Button onClick={overview}>{t('space.overview')}</Button>
          </div>
        )}
      >
        {/* A phone has no room for the hint: it stays for a screen reader. */}
        <span className="sr-only sm:not-sr-only">{t('space.intro')} {t('space.introDetail')}</span>
      </ScreenTitle>
      {scopeText && <p className="pb-3 text-subheadline text-ink-2">{t('space.scope', { scope: scopeText })}</p>}
      {focused && plan && (
        <p aria-live="polite" className="pb-3 text-subheadline text-ink">
          {t('space.focusLine', { name: nameOf(focused), tasks: counted(t, 'space.tasksCount', plan.tasks), projects: counted(t, 'subCompanies.projectCount', plan.projects) })}
        </p>
      )}
      {projects.error && (
        <EmptyState title={t('space.title')} body={errorMessage(projects.error, t)} action={<Button onClick={() => void projects.refetch()}>{t('common.retry')}</Button>} />
      )}
      {projects.data && kept.length === 0 && <p className="pb-4 text-subheadline text-ink-2">{t('space.noProjects')}</p>}
      <div ref={boxElement} data-space-map="" className="relative overflow-hidden rounded-card max-sm:min-h-[16rem] max-sm:flex-1 sm:h-[calc(100dvh-12rem)] sm:min-h-[26rem]">
        {/* The map waits for the projects and the sub-companies: fitView sets the first view once, so every card must exist at that first draw. */}
        {ready ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            className={FLOW_CLASS}
            style={FLOW_STYLE}
            onInit={(instance) => {
              flow.current = instance;
              // The box was measured before the map was drawn: fit once to the first rows that its size allows.
              if (box.current && !settled.current) {
                settled.current = box.current;
                refitRef.current();
              }
            }}
            fitView
            fitViewOptions={view}
            onlyRenderVisibleElements
            panOnScroll
            zoomOnScroll={false}
            zoomActivationKeyCode={ZOOM_KEYS}
            minZoom={0.25}
            maxZoom={FLOW_MAX_ZOOM}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
          />
        ) : null}
        {/* Zoom buttons at the bottom start, so a mouse user zooms in again after a zoom out (PRJ-05). */}
        <div className="absolute bottom-3 start-3 z-10 flex flex-col gap-2">
          <IconButton label={t('space.zoomIn')} onClick={() => void flow.current?.zoomIn({ duration: 200 })} className="bg-card text-ink shadow-card ring-1 ring-ink/10">
            <ZoomGlyph plus />
          </IconButton>
          <IconButton label={t('space.zoomOut')} onClick={() => void flow.current?.zoomOut({ duration: 200 })} className="bg-card text-ink shadow-card ring-1 ring-ink/10">
            <ZoomGlyph plus={false} />
          </IconButton>
        </div>
      </div>
      {taskId && <ProjectTaskSheet key={taskId} projectId={panelProjectId} taskId={taskId} onClose={closeTask} />}
    </main>
  );
}

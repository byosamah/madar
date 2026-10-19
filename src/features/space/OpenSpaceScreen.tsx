import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import type { Stage } from '../../api/contract/entities';
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
import { buildSpaceTree, focusPlan, isOpenProject, OFFICE_ID, peopleWithOpenTasks, type SpaceNode, type SpaceTree } from './spaceTree';

const NODE_TYPES: NodeTypes = { space: SpaceCard };
const LABEL = 'flex flex-col gap-1 text-footnote font-semibold text-ink-2';
const SELECT = 'field mt-1.5 font-normal';
// The "React Flow" label keeps the library colours unless the map sets its own: a light patch in dark mode, and a corner that the
// round box cuts. The map gives it a token fill, a token link colour and a margin.
const FLOW_CLASS = '[&_.react-flow__attribution]:m-2 [&_.react-flow__attribution]:rounded-md [&_.react-flow__attribution_a]:text-label-2';
const FLOW_STYLE = { '--xy-attribution-background-color': 'var(--c-fill)' } as CSSProperties;

/** The part of the React Flow instance that the screen uses. */
type FlowHandle = {
  fitView: (options?: { padding?: number; minZoom?: number; maxZoom?: number; duration?: number; nodes?: { id: string }[] }) => unknown;
  zoomIn: (options?: { duration?: number }) => unknown;
  zoomOut: (options?: { duration?: number }) => unknown;
};

// The first view and the Overview keep the cards readable. They show the office and the first projects from the top of the map, and
// the person moves down with the wheel or a drag. A project that opens, or a person in focus, moves the view to what it shows.
const FIRST_PROJECTS = 5;
// The keys that zoom the map with the wheel. The plain wheel only moves the map (PRJ-05).
const ZOOM_KEYS = ['Control', 'Meta'];

/** The least and the most zoom of a fit that keeps the cards readable. A phone is narrow, so it may zoom out further. */
function readableLimits() {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  return { padding: 0.15, minZoom: narrow ? 0.45 : 0.7, maxZoom: 1 };
}

/**
 * The view that keeps the cards readable. A phone is narrow, so it may zoom out further than a computer. With every project closed it
 * shows the first five projects. When the first project is open it shows that project and its stages, as the open projects spread the tree.
 */
function readableView(tree: SpaceTree) {
  const projects = tree.nodes.filter((node) => node.kind === 'project').sort((a, b) => a.y - b.y);
  const first = projects[0];
  const shown = first?.open
    ? [first, ...tree.edges.filter((edge) => edge.from === first.id).map((edge) => ({ id: edge.to }))]
    : projects.slice(0, FIRST_PROJECTS);
  return { ...readableLimits(), nodes: [{ id: OFFICE_ID }, ...shown.map((node) => ({ id: node.id }))] };
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
  // Two reads of the office: the projects, and their open tasks. A done task never shows on the map.
  const projects = useCall('projects.list', { status: 'all', ...filters });
  const tasks = useCall('tasks.list', { activeProjectsOnly: false, includeDone: false, ...filters });
  const users = useCall('users.list', {});
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [focusPersonId, setFocusPersonId] = useState<string | null>(null);
  const flow = useRef<FlowHandle | null>(null);
  // Each change that moves the view counts one. "nodes" are what the view fits to; null means the overview.
  const [fit, setFit] = useState<{ n: number; nodes: string[] | null }>({ n: 0, nodes: null });
  const moveView = (nodes: string[] | null) => setFit((current) => ({ n: current.n + 1, nodes }));

  const summaries = useMemo(() => projects.data ?? [], [projects.data]);
  const rows = useMemo(() => tasks.data ?? [], [tasks.data]);
  // The choices of the focus: the people who lead or help an open task of a project on the map. The person in focus stays in the list.
  const people = useMemo(() => {
    const working = peopleWithOpenTasks(summaries, rows);
    return (users.data ?? []).filter((user) => user.kind === 'human' && user.active && (working.has(user.id) || user.id === focusPersonId)).sort(byName);
  }, [users.data, summaries, rows, focusPersonId, byName]);
  const tree = useMemo(
    () => buildSpaceTree({ projects: summaries, tasks: rows, opened, focusPersonId, dir }),
    [summaries, rows, opened, focusPersonId, dir],
  );

  const view = readableView(tree);
  const viewRef = useRef(view);
  viewRef.current = view;

  // The lookups that fill each card. A stage has a next level only when it has an open task.
  const projectById = useMemo(() => new Map(summaries.map((summary): [string, ProjectSummary] => [summary.project.id, summary])), [summaries]);
  const stageById = useMemo(() => {
    const found = new Map<string, { stage: Stage; summary: ProjectSummary }>();
    for (const summary of summaries) for (const stage of summary.stages) found.set(stage.id, { stage, summary });
    return found;
  }, [summaries]);
  const taskById = useMemo(() => new Map(rows.map((row): [string, TaskRow] => [row.task.id, row])), [rows]);
  const stagesWithTasks = useMemo(() => {
    const found = new Set<string>();
    for (const row of rows) if (row.task.status !== 'done' && row.task.stageId) found.add(row.task.stageId);
    return found;
  }, [rows]);
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

  // A project opens alone: the one that was open closes (an accordion), and the view moves to the project and its stages. A stage
  // opens beside the others, and the view moves to it and its tasks. A card that closes sends the view back to the overview.
  const toggle = useCallback((id: string) => {
    const summary = projectById.get(id);
    if (summary) {
      const stageIds = summary.stages.map((stage) => stage.id);
      if (opened.has(id)) {
        setOpened(without(opened, [id, ...stageIds]));
        moveView(null);
      } else {
        setOpened(new Set([id]));
        moveView([id, ...stageIds]);
      }
      return;
    }
    const found = stageById.get(id);
    if (opened.has(id)) {
      setOpened(without(opened, [id]));
      return;
    }
    setOpened(new Set([...opened, id]));
    moveView([found?.summary.project.id ?? id, id, ...rows.filter((row) => row.task.stageId === id && row.task.status !== 'done').map((row) => row.task.id)]);
  }, [opened, projectById, stageById, rows]);

  // A person in focus opens every project and stage where that person works, and the view fits what stays bright (PRJ-06).
  const focusOn = (personId: string | null) => {
    setFocusPersonId(personId);
    if (personId === null) {
      setOpened(new Set());
      moveView(null);
      return;
    }
    const plan = focusPlan({ projects: summaries, tasks: rows, personId });
    setOpened(plan.opened);
    moveView(plan.bright.length > 0 ? plan.bright : null);
  };
  const overview = () => {
    setFocusPersonId(null);
    setOpened(new Set());
    moveView(null);
  };
  const focused = focusPersonId ? people.find((person) => person.id === focusPersonId) : undefined;
  const plan = focusPersonId ? focusPlan({ projects: summaries, tasks: rows, personId: focusPersonId }) : null;

  const taskId = params.get('task');
  const panelProjectId = params.get('project');
  const showTask = useCallback((id: string, projectId: string | null) => setParams((current) => openTask(current, id, projectId)), [setParams]);
  const closeTask = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const key of ['task', 'project', 'thread']) next.delete(key);
    return next;
  }), [setParams]);

  const cardOf = (node: SpaceNode): SpaceCardData => {
    const base = { id: node.id, kind: node.kind, open: node.open, faded: node.faded, onToggle: toggle, onOpenTask: showTask };
    if (node.kind === 'project') {
      const summary = projectById.get(node.id);
      return { ...base, summary, facts: factsOf.get(node.id), expandable: (summary?.stages.length ?? 0) > 0 };
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
    return { ...base, expandable: false };
  };

  const nodes: SpaceFlowNode[] = tree.nodes.map((node) => ({
    id: node.id,
    type: 'space',
    position: { x: node.x, y: node.y },
    // The lines leave a card on its end side and enter the next card on its start side, so an Arabic map reads from the end side.
    sourcePosition: dir === 'rtl' ? Position.Left : Position.Right,
    targetPosition: dir === 'rtl' ? Position.Right : Position.Left,
    draggable: false,
    selectable: false,
    focusable: false,
    data: cardOf(node),
  }));
  const edges: Edge[] = tree.edges.map((edge) => ({
    id: `${edge.from}>${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    selectable: false,
    focusable: false,
    style: { stroke: 'var(--c-ink-2)', strokeOpacity: 0.5 },
  }));

  useEffect(() => {
    if (fit.n === 0) return;
    const frame = requestAnimationFrame(() => {
      const options = fit.nodes ? { ...readableLimits(), duration: 250, nodes: fit.nodes.map((id) => ({ id })) } : viewRef.current;
      void flow.current?.fitView(options);
    });
    return () => cancelAnimationFrame(frame);
  }, [fit]);

  const kept = summaries.filter(isOpenProject);
  // The way back keeps the Dashboard filters, so the Dashboard shows the same office as the map.
  const back = new URLSearchParams([...params].filter(([key]) => ['leader', 'client', 'team', 'subCompany'].includes(key))).toString();

  return (
    <main className="min-h-dvh p-4 sm:p-6">
      <Link to={{ pathname: '/dashboard', search: back }} className="-ms-2 mb-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-subheadline font-semibold text-link hover:underline">
        <AnimatedIcon icon={ChevronLeftIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
        {t('screens.dashboard')}
      </Link>
      <ScreenTitle
        title={t('space.title')}
        action={(
          <div className="flex flex-wrap items-end gap-2">
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
        {t('space.intro')}
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
      <div className="relative h-[70dvh] min-h-[28rem] overflow-hidden rounded-card">
        {/* The map waits for the projects: fitView sets the first view once, so every card must exist at that first draw. */}
        {projects.data ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            className={FLOW_CLASS}
            style={FLOW_STYLE}
            onInit={(instance) => {
              flow.current = instance;
            }}
            fitView
            fitViewOptions={view}
            panOnScroll
            zoomOnScroll={false}
            zoomActivationKeyCode={ZOOM_KEYS}
            minZoom={0.25}
            maxZoom={1.5}
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

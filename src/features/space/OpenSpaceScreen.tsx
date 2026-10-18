import { useCallback, useMemo, useRef, useState } from 'react';
import { Position, ReactFlow, type Edge, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useByPersonName, usePersonName } from '../../app/personName';
import { PicturesProvider } from '../../app/pictures';
import { useCall } from '../../app/runtime';
import type { Stage } from '../../api/contract/entities';
import type { ProjectSummary, TaskRow } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { SpaceCard, type SpaceCardData, type SpaceFlowNode } from './SpaceNode';
import { buildSpaceTree, isOpenProject, type SpaceNode } from './spaceTree';

const NODE_TYPES: NodeTypes = { space: SpaceCard };
const LABEL = 'flex flex-col gap-1 text-footnote font-semibold text-ink-2';
const SELECT = 'field mt-1.5 font-normal';

/** The part of the React Flow instance that the screen uses. */
type FlowHandle = { fitView: (options?: { padding?: number }) => unknown };

/**
 * The Open space (feedback fbk_015, 2026-10-18): a read-only mind map of the office, for the managers who want the whole office
 * at one look. It sits outside the app frame, as the meeting view does, so it reads the profile pictures itself.
 */
export function OpenSpaceScreen() {
  return <PicturesProvider><SpaceScreen /></PicturesProvider>;
}

function SpaceScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  // Two reads of the office: the projects, and their open tasks. A done task never shows on the map.
  const projects = useCall('projects.list', { status: 'all' });
  const tasks = useCall('tasks.list', { activeProjectsOnly: false, includeDone: false });
  const users = useCall('users.list', {});
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [focusPersonId, setFocusPersonId] = useState<string | null>(null);
  const flow = useRef<FlowHandle | null>(null);

  const summaries = useMemo(() => projects.data ?? [], [projects.data]);
  const rows = useMemo(() => tasks.data ?? [], [tasks.data]);
  const people = useMemo(() => [...(users.data ?? [])].sort(byName), [users.data, byName]);
  const tree = useMemo(
    () => buildSpaceTree({ projects: summaries, tasks: rows, opened, focusPersonId, dir }),
    [summaries, rows, opened, focusPersonId, dir],
  );

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

  const toggle = useCallback((id: string) => {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cardOf = (node: SpaceNode): SpaceCardData => {
    const base = { id: node.id, kind: node.kind, open: node.open, faded: node.faded, onToggle: toggle };
    if (node.kind === 'project') {
      const summary = projectById.get(node.id);
      return { ...base, summary, expandable: (summary?.stages.length ?? 0) > 0 };
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

  const openEverything = () => {
    const ids = summaries.filter(isOpenProject).flatMap((summary) => [summary.project.id, ...summary.stages.map((stage) => stage.id)]);
    setOpened(new Set(ids));
  };
  const openNone = () => setOpened(new Set());
  const kept = summaries.filter(isOpenProject);

  return (
    <main className="min-h-dvh p-4 sm:p-6">
      <ScreenTitle
        title={t('space.title')}
        action={(
          <div className="flex flex-wrap items-end gap-2">
            <Button variant="plain" onClick={() => navigate({ pathname: '/dashboard' })}>
              <AnimatedIcon icon={ChevronLeftIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
              {t('screens.dashboard')}
            </Button>
            <Button onClick={openEverything}>{t('space.openAll')}</Button>
            <Button onClick={openNone}>{t('space.closeAll')}</Button>
            <Button onClick={() => void flow.current?.fitView({ padding: 0.2 })}>{t('space.fit')}</Button>
            <label className={LABEL}>{t('space.focus')}
              <select value={focusPersonId ?? ''} onChange={(event) => setFocusPersonId(event.target.value === '' ? null : event.target.value)} className={SELECT}>
                <option value="">{t('space.focusAnyone')}</option>
                {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
              </select>
            </label>
          </div>
        )}
      >
        {t('space.intro')}
      </ScreenTitle>
      {projects.error && (
        <EmptyState title={t('space.title')} body={errorMessage(projects.error, t)} action={<Button onClick={() => void projects.refetch()}>{t('common.retry')}</Button>} />
      )}
      {projects.data && kept.length === 0 && <p className="pb-4 text-subheadline text-ink-2">{t('space.noProjects')}</p>}
      <div className="relative h-[70dvh] min-h-[28rem] overflow-hidden rounded-card">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onInit={(instance) => {
            flow.current = instance;
          }}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
        />
      </div>
    </main>
  );
}
